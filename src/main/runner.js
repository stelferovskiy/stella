/* Запуск агентов: сообщения, поток событий в интерфейс, подтверждения, сохранение. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const reducer = require('../shared/reducer');
const { L } = require('./i18n');
const claude = require('./providers/claude');
const codex = require('./providers/codex');
const openai = require('./providers/openai');
// Agents that talk to an API with the user's key: conversation only, no project files.
const isApiAgent = (agent, settings) => ['deepseek', 'gemini', 'openrouter'].includes(agent) || (agent === 'chatgpt' && settings.chatgpt.backend === 'api');
const accounts = require('./accounts');

const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function createRunner({ store, broadcast, notify, getApiKey, memory, onAccountLimit }) {
  const active = new Map(); // chatId -> { abort, approvals: Map, msgId, state }

  function makeTitle(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return L('chat.new');
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

  // The chat's session/thread was created under another account: copy its transcript to the active one.
  // If that fails, start fresh and hand the model a local digest of the dialog instead.
  function migrateAccount(chat, settings) {
    const provider = accounts.providerFor(chat.agent, settings);
    if (!provider) return { provider: null, context: '' };
    const slot = accounts.activeSlot(settings, provider);
    try { accounts.syncShared(provider, slot); } catch (e) {}
    const key = provider === 'claude' ? 'claudeSession' : 'codexThread', slotKey = provider + 'Slot';
    const from = chat[slotKey] || 1;
    let context = '', resumeFallback = null;
    const digest = () => (memory && chat.messages.length ? memory.forHandoff(memory.digest(chat)) : '');
    if (chat[key] && from !== slot) {
      if (!accounts.copySession(provider, chat[key], from, slot)) { chat[key] = null; context = digest(); }
      else { const d = digest(); resumeFallback = () => d; }
    }
    chat[slotKey] = slot;
    return { provider, slot, context, resumeFallback };
  }

  async function send(chatId, { text, attachments, mode }) {
    if (active.has(chatId)) throw new Error(L('error.agentBusy'));
    const chat = store.getChat(chatId);
    if (!chat) throw new Error(L('error.chatNotFound'));
    const settings = store.getSettings();
    const account = migrateAccount(chat, settings);

    const atts = prepareAttachments(chatId, attachments);
    const userMsg = { id: crypto.randomUUID(), role: 'user', text: text || '', attachments: atts, time: Date.now() };
    const msg = { id: crypto.randomUUID(), role: 'assistant', agent: chat.agent, blocks: [], status: 'running', time: Date.now() };
    // A chat carried over from another one keeps its "↪ …" title instead of taking the service prompt.
    if (!chat.messages.length && !chat.handoff) chat.title = makeTitle(text || (atts[0] && atts[0].name));
    chat.messages.push(userMsg, msg);
    const historyIndex = chat.messages.length - 2;
    // Локальная память: в первое сообщение нового чата подмешиваем сжатый контекст (в историю чата он не пишется).
    let promptText = text;
    // A handoff (new session or another agent) is always passed on; project notes only when memory is on.
    if (historyIndex === 0 && memory) {
      const ctx = chat.handoff ? memory.forHandoff(chat.handoff) : store.getSettings().memoryEnabled !== false ? memory.forNewChat(chat.cwd) : '';
      if (ctx) promptText = ctx + (text || '');
    }
    if (account.context) promptText = account.context + (promptText || '');
    broadcast('chats:changed', store.saveChat(chat));
    broadcast('chat:message', { chatId, message: userMsg });
    broadcast('chat:message', { chatId, message: msg });

    const abortController = new AbortController();
    const entry = { abort: abortController, approvals: new Map(), inputs: new Map(), requests: new Map(), msgId: msg.id, state: 'thinking', steer: null, queue: [] };
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

    entry.emit = emit;
    const emitLive = (ev) => broadcast('agent:live', { chatId, agent: chat.agent, ev });

    // слежение за файлами проекта — для живого превью
    let watcher = null;
    const fsTimers = new Map();
    const WATCH_EXT = /\.(html?|css|js|ts|tsx|jsx|svg|png|jpe?g|gif|webp|md|txt|json|ya?ml|toml|xml|ini|py|rs|go|c|cpp|h|java|cs|ps1|sh|sql|vue|svelte)$/i;
    if (!isApiAgent(chat.agent, settings)) {
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
      emit({ t: 'approval', reqId, title, detail: reason ? detail + (detail ? '\n\n' : '') + L('approval.reason', { reason }) : detail });
      setState(chatId, 'waiting');
      notify({ title: L('notify.waitingApproval'), body: title, chatId, onlyIfHidden: true });
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
      notify({ title: L('notify.waitingInput'), body: questions.map((q) => q.question).join('\n'), chatId, onlyIfHidden: true });
      abortController.signal.addEventListener('abort', cancel, { once: true });
    });
    const onRequestResolved = (id) => { const cancel = entry.requests.get(id); if (cancel) cancel(); if (!entry.approvals.size && !entry.inputs.size) setState(chatId, 'thinking'); };
    const onLimit = (info) => {
      if (!info) return;
      if (account.slot && account.provider && accounts.activeSlot(store.getSettings(), account.provider) !== account.slot) return;
      store.setLimit(chat.agent, 'account', info); broadcast('usage:changed', store.getUsage());
    };
    // Messages typed while the agent works: the provider hands over a function that injects them into the running turn.
    const registerSteer = (fn) => { entry.steer = fn; };

    let result = { status: 'error' };
    try {
      if (chat.agent === 'claude') {
        result = await claude.run({
          chat, text: promptText, attachments: atts, settings, emit, emitLive, requestApproval, requestUserInput, abortController, mode,
          onSession: (id) => { chat.claudeSession = id; scheduleSave(); },
          onLimit: (info) => {
            // A run that started under the other account must not overwrite the active account's limits.
            if (account.slot && accounts.activeSlot(store.getSettings(), 'claude') !== account.slot) return;
            store.setLimit('claude', info.rateLimitType || 'unknown', info);
            // The event carries every window; keep the other bars fresh too, not only the one that triggered it.
            for (const [k, w] of Object.entries(info.unifiedWindows || {})) {
              if (k !== info.rateLimitType && w && w.utilization != null) store.setLimit('claude', k, { utilization: w.utilization, resetsAt: w.resetsAt, status: w.status });
            }
            broadcast('usage:changed', store.getUsage());
          },
          registerSteer
        });
      } else if (chat.agent === 'codex') {
        result = await codex.run({ chat, text: promptText, attachments: atts, settings, emit, emitLive, requestApproval, requestUserInput, onRequestResolved, onLimit, registerSteer, abortController, mode, flavor: 'codex', resumeFallback: account.resumeFallback, onThread: (id) => { chat.codexThread = id; scheduleSave(); } });
      } else if (isApiAgent(chat.agent, settings)) {
        result = await openai.run({ chat, text: promptText, attachments: atts, settings, apiKey: getApiKey(chat.agent), emit, abortController, historyIndex, provider: chat.agent });
      } else if (chat.agent === 'chatgpt') {
        result = await codex.run({ chat, text: promptText, attachments: atts, settings, emit, emitLive, requestApproval, requestUserInput, onRequestResolved, onLimit, registerSteer, abortController, mode: mode || settings.chatgpt.sandbox || 'workspace-write', flavor: 'chatgpt', resumeFallback: account.resumeFallback, onThread: (id) => { chat.codexThread = id; scheduleSave(); } });
      } else {
        emit({ t: 'error', text: L('error.unknownAgent', { agent: String(chat.agent) }) });
      }
    } catch (err) {
      emit({ t: 'error', text: L('error.failure', { message: err && err.message || err }) });
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
    // The chat must leave the running set even if writing usage fails (full disk), or it stays busy forever.
    active.delete(chatId);
    if (result.usage) { try { store.addUsage(chat.agent, result.usage); broadcast('usage:changed', store.getUsage()); } catch (e) {} }
    entry.steer = null;
    setState(chatId, status === 'error' ? 'error' : 'idle');
    // Messages that could not join the running turn go out as the next message, unless the user pressed Stop.
    const queued = entry.queue.splice(0);
    // A chat deleted during the run has nothing to send the queued text to.
    if (queued.length && store.getChat(chatId)) {
      if (status === 'stopped') broadcast('toast', L('chat.steerDropped'));
      else setTimeout(() => send(chatId, { text: queued.join('\n\n') }).catch((err) => broadcast('toast', String(err.message || err))), 0);
    }
    // Out of limits: the chat can be handed to another agent (button under the reply).
    if (status === 'error' && result.limitHit) { reducer.apply(msg, { t: 'limit' }); broadcast('chat:event', { chatId, msgId: msg.id, ev: { t: 'limit' } }); }
    if (status === 'error' && result.limitHit && account.provider && onAccountLimit) {
      Promise.resolve().then(() => onAccountLimit({ chatId, provider: account.provider, from: account.slot })).catch(() => {});
    }
    // null: the chat was deleted while this run was finishing.
    let saved = null;
    try { saved = store.saveChat(chat); } catch (e) { broadcast('toast', String(e && e.message || e)); }
    if (!saved) return status;
    broadcast('chats:changed', saved);

    if (status === 'done') {
      const firstText = (msg.blocks.find((b) => b.type === 'text') || {}).text || L('notify.done');
      notify({ title: 'Stella · ' + chat.title, body: firstText.replace(/[#*`>_]/g, '').slice(0, 140), chatId, onlyIfHidden: true });
    } else if (status === 'error') {
      notify({ title: L('notify.error'), body: chat.title, chatId, onlyIfHidden: true });
    }
    return status;
  }

  // A message typed while the agent works. It joins the running turn when the provider supports it
  // (Claude: queued user message, Codex: turn/steer); otherwise it is sent right after the reply.
  // Returns 'steered' | 'queued' | 'sent'.
  async function steer(chatId, { text }) {
    text = String(text || '').trim();
    if (!text) return false;
    const entry = active.get(chatId);
    if (!entry) { await send(chatId, { text }); return 'sent'; }
    let ok = false;
    if (entry.steer) { try { ok = await entry.steer(text); } catch (e) { ok = false; } }
    if (!ok || active.get(chatId) !== entry) {
      if (active.get(chatId) !== entry) { await send(chatId, { text }); return 'sent'; }
      entry.queue.push(text);
      return 'queued';
    }
    entry.emit({ t: 'steer', text, time: Date.now() });
    return 'steered';
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
      if (!Array.isArray(values) || !values.length || (values.length > 1 && !q.multiSelect)) return false;
      if (values.some((v) => typeof v !== 'string' || !v.trim())) return false;
      if (q.options?.length && !q.isOther && !q.isSecret && !values.every((v) => q.options.some((o) => o.label === v))) return false;
      clean[q.id] = { answers: values.slice() };
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

  return { send, steer, stop, approve, answerInput, states, stopAll, isRunning: (id) => active.has(id) };
}

module.exports = { createRunner };
