/* Запуск агентов: сообщения, поток событий в интерфейс, подтверждения, сохранение. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const reducer = require('../shared/reducer');
const claude = require('./providers/claude');
const codex = require('./providers/codex');
const openai = require('./providers/openai');

const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function createRunner({ store, broadcast, notify, getApiKey }) {
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
    broadcast('chats:changed', store.saveChat(chat));
    broadcast('chat:message', { chatId, message: userMsg });
    broadcast('chat:message', { chatId, message: msg });

    const abortController = new AbortController();
    const entry = { abort: abortController, approvals: new Map(), msgId: msg.id, state: 'thinking' };
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
    const WATCH_EXT = /\.(html?|css|js|svg|png|jpe?g|gif|webp|md)$/i;
    if (chat.agent !== 'chatgpt') {
      try {
        watcher = fs.watch(chat.cwd, { recursive: true }, (_ev, name) => {
          if (!name || !WATCH_EXT.test(name) || /(^|[\\/])(node_modules|\.git|AppData|dist)([\\/]|$)/i.test(name)) return;
          const full = path.join(chat.cwd, name);
          clearTimeout(fsTimers.get(full));
          fsTimers.set(full, setTimeout(() => { fsTimers.delete(full); emitLive({ t: 'fs', path: full }); }, 350));
        });
        watcher.on('error', () => {});
      } catch (e) { watcher = null; }
    }

    const requestApproval = ({ title, detail, reason }) => new Promise((resolve) => {
      const reqId = 'ap-' + crypto.randomUUID();
      entry.approvals.set(reqId, resolve);
      emit({ t: 'approval', reqId, title, detail: reason ? detail + (detail ? '\n\n' : '') + 'Причина: ' + reason : detail });
      setState(chatId, 'waiting');
      notify({ title: 'Stella ждёт подтверждения', body: title, chatId, onlyIfHidden: true });
      abortController.signal.addEventListener('abort', () => { if (entry.approvals.has(reqId)) { entry.approvals.delete(reqId); resolve('deny'); } });
    });

    let result = { status: 'error' };
    try {
      if (chat.agent === 'claude') {
        result = await claude.run({
          chat, text, attachments: atts, settings, emit, emitLive, requestApproval, abortController, mode,
          onSession: (id) => { chat.claudeSession = id; scheduleSave(); },
          onLimit: (info) => { store.setLimit('claude', info.rateLimitType || 'unknown', info); broadcast('usage:changed', store.getUsage()); }
        });
      } else if (chat.agent === 'codex') {
        result = await codex.run({ chat, text, attachments: atts, settings, emit, emitLive, abortController, mode, flavor: 'codex', onThread: (id) => { chat.codexThread = id; scheduleSave(); } });
      } else if (chat.agent === 'chatgpt') {
        if (settings.chatgpt.backend === 'api') {
          result = await openai.run({ chat, text, attachments: atts, settings, apiKey: getApiKey(), emit, abortController, historyIndex });
        } else {
          const space = path.join(store.dir, 'chatgpt-space');
          fs.mkdirSync(space, { recursive: true });
          const proxy = Object.assign({}, chat, { cwd: space });
          result = await codex.run({ chat: proxy, text, attachments: atts, settings, emit, abortController, flavor: 'chatgpt', onThread: (id) => { chat.codexThread = id; scheduleSave(); } });
        }
      }
    } catch (err) {
      emit({ t: 'error', text: 'Сбой: ' + (err && err.message || err) });
      result = { status: 'error' };
    }

    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (watcher) { try { watcher.close(); } catch (e) {} }
    for (const t of fsTimers.values()) clearTimeout(t);
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
    a.state = 'thinking';
    setState(chatId, 'thinking');
    resolve(answer);
    return true;
  }

  function states() {
    const out = {};
    for (const [id, a] of active) out[id] = a.state;
    return out;
  }

  function stopAll() { for (const a of active.values()) a.abort.abort(); }

  return { send, stop, approve, states, stopAll, isRunning: (id) => active.has(id) };
}

module.exports = { createRunner };
