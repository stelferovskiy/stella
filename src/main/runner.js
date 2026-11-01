/* Запуск агентов: сообщения, поток событий в интерфейс, подтверждения, сохранение. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const reducer = require('../shared/reducer');
const claude = require('./providers/claude');
const codex = require('./providers/codex');
const openai = require('./providers/openai');

const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function createRunner({ store, broadcast, notify, getApiKey, memory }) {
  const active = new Map(); // chatId -> { abort, approvals: Map, msgId, state }

  function makeTitle(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return 'Новый чат';
    return t.length > 52 ? t.slice(0, 50).trim() + '…' : t;
  }

  function prepareAttachments(chatId, list) {
    const out = [];
    const dir = path.join(store.dir, 'attachments', chatId);
    for (const a of list || []) {
      let p = a.path;
      if (!p && a.data) {
        fs.mkdirSync(dir, { recursive: true });
        const safe = (a.name || 'file').replace(/[\\/:*?"<>|]/g, '_');
        p = path.join(dir, Date.now() + '-' + safe);
        fs.writeFileSync(p, Buffer.from(a.data, 'base64'));
      }
      if (!p) continue;
      const ext = path.extname(p).toLowerCase();
      out.push({ name: a.name || path.basename(p), path: p, kind: IMAGE_MIME[ext] ? 'image' : 'file', mime: IMAGE_MIME[ext] || a.mime || '' });
    }
    return out;
  }

  function setState(chatId, s) {
    const a = active.get(chatId);
    if (a) a.state = s;
    broadcast('agent:state', { chatId, state: s });
  }

  async function send(chatId, { text, attachments, mode }) {
    if (active.has(chatId)) throw new Error('Агент ещё отвечает в этом чате');
    const chat = store.getChat(chatId);
    if (!chat) throw new Error('Чат не найден');
    const settings = store.getSettings();

    const atts = prepareAttachments(chatId, attachments);
    const userMsg = { id: crypto.randomUUID(), role: 'user', text: text || '', attachments: atts, time: Date.now() };
    const msg = { id: crypto.randomUUID(), role: 'assistant', agent: chat.agent, blocks: [], status: 'running', time: Date.now() };
    if (!chat.messages.length) chat.title = makeTitle(text || (atts[0] && atts[0].name));
    chat.messages.push(userMsg, msg);
    const historyIndex = chat.messages.length - 2;
    // Локальная память: в первое сообщение нового чата подмешиваем сжатый контекст (в историю чата он не пишется).
    let promptText = text;
    if (historyIndex === 0 && memory && store.getSettings().memoryEnabled !== false) {
      const ctx = chat.handoff ? memory.forHandoff(chat.handoff) : memory.forNewChat(chat.cwd);
      if (ctx) promptText = ctx + (text || '');
    }
    broadcast('chats:changed', store.saveChat(chat));
    broadcast('chat:message', { chatId, message: userMsg });
    broadcast('chat:message', { chatId, message: msg });

    const abortController = new AbortController();
    const entry = { abort: abortController, approvals: new Map(), inputs: new Map(), requests: new Map(), msgId: msg.id, state: 'thinking' };
    active.set(chatId, entry);
    setState(chatId, 'thinking');

    let saveTimer = null;
    const scheduleSave = () => {
      if (saveTimer) return;
      saveTimer = setTimeout(() => { saveTimer = null; store.saveChat(chat); }, 800);
    };

    const emit = (ev) => {
      if (ev.t === 'state') { if (entry.state !== 'waiting') setState(chatId, ev.s); return; }
      reducer.apply(msg, ev);
      broadcast('chat:event', { chatId, msgId: msg.id, ev });
      scheduleSave();
    };

    const emitLive = (ev) => broadcast('agent:live', { chatId, agent: chat.agent, ev });

    // слежение за файлами проекта — для живого превью
    let watcher = null;
    const fsTimers = new Map();
    const WATCH_EXT = /\.(html?|css|js|ts|tsx|jsx|svg|png|jpe?g|gif|webp|md|txt|json|ya?ml|toml|xml|ini|py|rs|go|c|cpp|h|java|cs|ps1|sh|sql|vue|svelte)$/i;
    if (chat.agent !== 'chatgpt' || settings.chatgpt.backend !== 'api') {
      try {
        watcher = fs.watch(chat.cwd, { recursive: true }, (_ev, name) => {
          if (!name || !WATCH_EXT.test(name) || /(^|[\\/])(node_modules|\.git|\.codex|\.claude|AppData|dist)([\\/]|$)/i.test(name)) return;
          const full = path.join(chat.cwd, name);
          clearTimeout(fsTimers.get(full));
          fsTimers.set(full, setTimeout(() => { fsTimers.delete(full); emitLive({ t: 'fs', path: full }); emit({ t: 'files', paths: [full] }); }, 350));
        });
        watcher.on('error', () => {});
      } catch (e) { watcher = null; }
    }

    const requestApproval = ({ title, detail, reason, serverRequestId }) => new Promise((resolve) => {
      if (abortController.signal.aborted) { resolve('deny'); return; }
      const reqId = 'ap-' + crypto.randomUUID();
      const cancel = () => {
        if (!entry.approvals.has(reqId)) return;
        entry.approvals.delete(reqId); emit({ t: 'approval-resolved', reqId, status: 'expired' }); finish('deny');
      };
      const finish = (answer) => { abortController.signal.removeEventListener('abort', cancel); entry.requests.delete(serverRequestId); resolve(answer); };
      entry.approvals.set(reqId, finish);
      if (serverRequestId != null) entry.requests.set(serverRequestId, cancel);
      emit({ t: 'approval', reqId, title, detail: reason ? detail + (detail ? '\n\n' : '') + 'Причина: ' + reason : detail });
      setState(chatId, 'waiting');
      notify({ title: 'Stella ждёт подтверждения', body: title, chatId, onlyIfHidden: true });
      abortController.signal.addEventListener('abort', cancel, { once: true });
    });

    const requestUserInput = ({ questions, serverRequestId }) => new Promise((resolve) => {
      if (abortController.signal.aborted) { resolve({}); return; }
      const reqId = 'input-' + crypto.randomUUID();
      const cancel = () => {
        if (!entry.inputs.has(reqId)) return;
        entry.inputs.delete(reqId); emit({ t: 'user-input-resolved', reqId, status: 'expired' }); finish({});
      };
      const finish = (answers) => { abortController.signal.removeEventListener('abort', cancel); entry.requests.delete(serverRequestId); resolve(answers); };
      entry.inputs.set(reqId, { resolve: finish, questions });
      if (serverRequestId != null) entry.requests.set(serverRequestId, cancel);
      emit({ t: 'user-input', reqId, questions });
      setState(chatId, 'waiting');
      notify({ title: 'Stella ждёт ответа', body: questions.map((q) => q.question).join('\n'), chatId, onlyIfHidden: true });
      abortController.signal.addEventListener('abort', cancel, { once: true });
    });
    const onRequestResolved = (id) => { const cancel = entry.requests.get(id); if (cancel) cancel(); if (!entry.approvals.size && !entry.inputs.size) setState(chatId, 'thinking'); };
    const onLimit = (info) => { if (!info) return; store.setLimit(chat.agent, 'account', info); broadcast('usage:changed', store.getUsage()); };

    let result = { status: 'error' };
    try {
      if (chat.agent === 'claude') {
        result = await claude.run({
          chat, text: promptText, attachments: atts, settings, emit, emitLive, requestApproval, abortController, mode,
          onSession: (id) => { chat.claudeSession = id; scheduleSave(); },
          onLimit: (info) => { store.setLimit('claude', info.rateLimitType || 'unknown', info); broadcast('usage:changed', store.getUsage()); }
        });
      } else if (chat.agent === 'codex') {
        result = await codex.run({ chat, text: promptText, attachments: atts, settings, emit, emitLive, requestApproval, requestUserInput, onRequestResolved, onLimit, abortController, mode, flavor: 'codex', onThread: (id) => { chat.codexThread = id; scheduleSave(); } });
      } else if (chat.agent === 'chatgpt') {
        if (settings.chatgpt.backend === 'api') {
          result = await openai.run({ chat, text: promptText, attachments: atts, settings, apiKey: getApiKey(), emit, abortController, historyIndex });
        } else {
          result = await codex.run({ chat, text: promptText, attachments: atts, settings, emit, emitLive, requestApproval, requestUserInput, onRequestResolved, onLimit, abortController, mode: mode || settings.chatgpt.sandbox || 'workspace-write', flavor: 'chatgpt', onThread: (id) => { chat.codexThread = id; scheduleSave(); } });
        }
      }
    } catch (err) {
      emit({ t: 'error', text: 'Сбой: ' + (err && err.message || err) });
      result = { status: 'error' };
    }

    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    for (const resolve of entry.approvals.values()) resolve('deny');
    entry.approvals.clear();
    for (const pending of entry.inputs.values()) pending.resolve({});
    entry.inputs.clear();
    if (watcher) { try { watcher.close(); } catch (e) {} }
    for (const t of fsTimers.values()) clearTimeout(t);
    if (fsTimers.size) {
      const ev = { t: 'files', paths: [...fsTimers.keys()] };
      reducer.apply(msg, ev); broadcast('chat:event', { chatId, msgId: msg.id, ev });
      for (const file of ev.paths) emitLive({ t: 'fs', path: file });
      fsTimers.clear();
    }
    const status = abortController.signal.aborted ? 'stopped' : (result.status || 'done');
    reducer.apply(msg, { t: 'done', status, usage: result.usage });
    broadcast('chat:event', { chatId, msgId: msg.id, ev: { t: 'done', status, usage: result.usage } });
    if (result.usage) { store.addUsage(chat.agent, result.usage); broadcast('usage:changed', store.getUsage()); }
    active.delete(chatId);
    setState(chatId, status === 'error' ? 'error' : 'idle');
    broadcast('chats:changed', store.saveChat(chat));

    if (status === 'done') {
      const firstText = (msg.blocks.find((b) => b.type === 'text') || {}).text || 'Готово';
      notify({ title: 'Stella · ' + chat.title, body: firstText.replace(/[#*`>_]/g, '').slice(0, 140), chatId, onlyIfHidden: true });
    } else if (status === 'error') {
      notify({ title: 'Stella · ошибка', body: chat.title, chatId, onlyIfHidden: true });
    }
    return status;
  }

  function stop(chatId) {
    const a = active.get(chatId);
    if (a) a.abort.abort();
  }

  function approve(chatId, reqId, answer) {
    if (!['allow', 'always', 'deny'].includes(answer)) return false;
    const a = active.get(chatId);
    if (!a) return false;
    const resolve = a.approvals.get(reqId);
    if (!resolve) return false;
    a.approvals.delete(reqId);
    const status = answer === 'deny' ? 'denied' : answer === 'always' ? 'always' : 'allowed';
    const chat = store.getChat(chatId);
    const msg = chat && chat.messages.find((m) => m.id === a.msgId);
    if (msg) reducer.apply(msg, { t: 'approval-resolved', reqId, status });
    broadcast('chat:event', { chatId, msgId: a.msgId, ev: { t: 'approval-resolved', reqId, status } });
    a.state = a.inputs.size || a.approvals.size ? 'waiting' : 'thinking';
    setState(chatId, a.state);
    resolve(answer);
    return true;
  }

  function answerInput(chatId, reqId, answers) {
    const a = active.get(chatId), pending = a && a.inputs.get(reqId);
    if (!pending || !answers || typeof answers !== 'object') return false;
    const clean = {};
    for (const q of pending.questions) {
      const values = answers[q.id]?.answers;
      if (q.required === false && (!values || values.length === 0 || values[0] === '')) continue;
      if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string' || !values[0].trim()) return false;
      if (q.options?.length && !q.isOther && !q.isSecret && !q.options.some((o) => o.label === values[0])) return false;
      clean[q.id] = { answers: [values[0]] };
    }
    a.inputs.delete(reqId);
    const chat = store.getChat(chatId), msg = chat && chat.messages.find((m) => m.id === a.msgId);
    const ev = { t: 'user-input-resolved', reqId, status: 'resolved' };
    if (msg) reducer.apply(msg, ev);
    broadcast('chat:event', { chatId, msgId: a.msgId, ev });
    setState(chatId, a.inputs.size || a.approvals.size ? 'waiting' : 'thinking');
    pending.resolve(clean); return true;
  }

  function states() {
    const out = {};
    for (const [id, a] of active) out[id] = a.state;
    return out;
  }

  function stopAll() { for (const a of active.values()) a.abort.abort(); }

  return { send, stop, approve, answerInput, states, stopAll, isRunning: (id) => active.has(id) };
}

module.exports = { createRunner };
