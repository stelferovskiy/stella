/* Image generation through the signed-in Codex/ChatGPT account; no API key fallback. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CodexClient } = require('./providers/codex-client');
const { launchSpec } = require('./providers/codex');
const { L } = require('./i18n');
const MAX_BYTES = 64 * 1024 * 1024;
const fail = (message, code) => Object.assign(new Error(message), { code });
function extension(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
  if (buf.length > 3 && buf[0] === 255 && buf[1] === 216 && buf[2] === 255) return '.jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  throw fail(L('gptImages.error.invalidData'), 'invalid-image');
}
function createGptImages({ store, broadcast = () => {}, clientFactory } = {}) {
  const dir = path.join(store.dir, 'gpt-images'); fs.mkdirSync(dir, { recursive: true });
  const indexFile = path.join(dir, 'index.json');
  let index; try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); if (!Array.isArray(index)) index = []; } catch (_) { index = []; }
  let active = null, last = { active: false }, cachedAvailability = null;
  const newClient = () => clientFactory ? clientFactory() : new CodexClient({ ...launchSpec(store.getSettings()), cwd: dir });
  const writeIndex = () => { fs.writeFileSync(indexFile + '.tmp', JSON.stringify(index, null, 2)); fs.renameSync(indexFile + '.tmp', indexFile); };
  function managed(file) {
    if (typeof file !== 'string' || path.dirname(path.resolve(file)) !== path.resolve(dir)) return false;
    try { return path.dirname(fs.realpathSync(file)) === fs.realpathSync(dir); } catch (_) { return false; }
  }
  function status() { return active ? { active: true, requestId: active.id, stage: active.stage } : { ...last, active: false }; }
  function progress(entry, stage, message, item) {
    entry.stage = stage;
    const ev = { requestId: entry.id, stage, ...(message ? { message } : {}), ...(item ? { item } : {}) };
    last = { ...ev, active: !['done', 'error', 'stopped'].includes(stage) }; broadcast('gpt-images:progress', ev);
  }
  function list() { return { items: index.filter((x) => managed(x.file)), active: !!active, status: status() }; }
  function get(id) { const item = index.find((x) => x.id === id); if (!item || !managed(item.file)) throw fail(L('gptImages.error.notFound'), 'not-found'); return item; }
  function remove(id) {
    const item = get(id); fs.unlinkSync(item.file); index = index.filter((x) => x.id !== id); writeIndex(); return index.filter((x) => managed(x.file));
  }
  async function availability() {
    if (cachedAvailability && Date.now() - cachedAvailability.time < 30000) return cachedAvailability.value;
    const c = newClient(); c.on('request', (m) => { try { c.reject(m.id, -32601, 'No active image request'); } catch (_) {} });
    try {
      await c.start();
      const [capabilities, account] = await Promise.all([c.request('modelProvider/capabilities/read', {}), c.request('account/read', { refreshToken: false })]);
      const value = { capabilities, account: { loggedIn: account.account?.type === 'chatgpt', type: account.account?.type, planType: account.account?.planType }, supported: capabilities.imageGeneration === true };
      cachedAvailability = { time: Date.now(), value }; return value;
    } finally { await c.close(); }
  }
  async function generate({ prompt, size = 'auto', transparent = false } = {}) {
    prompt = String(prompt || '').trim();
    if (!prompt) throw fail(L('gptImages.error.emptyPrompt'), 'empty-prompt');
    if (prompt.length > 32000) throw fail(L('gptImages.error.promptLength'), 'prompt-length');
    if (!['auto', 'square', 'landscape', 'portrait'].includes(size)) throw fail(L('gptImages.error.invalidSize'), 'invalid-size');
    if (active) throw fail(L('gptImages.error.busy'), 'busy');
    const entry = { id: crypto.randomUUID(), stage: 'thinking', abort: new AbortController(), client: null, threadId: null, turnId: null, finish: null };
    active = entry;
    let timer, stopTimer, usage = null, failure = null, lastText = '', candidate = null;
    const terminal = new Promise((resolve) => { entry.finish = resolve; });
    const stopped = () => entry.abort.signal.aborted;
    const checkStop = () => { if (stopped()) throw fail(L('gptImages.error.stopped'), 'stopped'); };
    progress(entry, 'thinking');
    try {
      const c = entry.client = newClient();
      c.on('closed', (err) => entry.finish({ status: stopped() ? 'interrupted' : 'failed', error: err }));
      c.on('request', (m) => {
        // Image workers cannot acquire shell/filesystem permissions or arbitrary dynamic tools.
        try {
          if (/requestApproval$/.test(m.method) && m.method !== 'item/permissions/requestApproval') c.respond(m.id, { decision: 'decline' });
          else if (m.method === 'item/permissions/requestApproval') c.respond(m.id, { permissions: {}, scope: 'turn' });
          else if (m.method === 'item/tool/requestUserInput') c.respond(m.id, { answers: {} });
          else if (m.method === 'mcpServer/elicitation/request') c.respond(m.id, { action: 'decline', content: null, _meta: null });
          else c.reject(m.id, -32601, 'Only built-in image generation is supported in this tab');
        } catch (_) {}
      });
      c.on('notification', (m) => {
        const p = m.params || {}; if (p.threadId && entry.threadId && p.threadId !== entry.threadId) return;
        if (m.method === 'turn/started') entry.turnId = p.turn.id;
        if (m.method === 'account/rateLimits/updated' && p.rateLimits && store.setLimit) {
          store.setLimit('chatgpt', 'account', p.rateLimits); store.setLimit('codex', 'account', p.rateLimits);
          if (store.getUsage) broadcast('usage:changed', store.getUsage());
        }
        if (m.method === 'thread/tokenUsage/updated') { const u = p.tokenUsage?.last; if (u) usage = { input: u.inputTokens || 0, output: u.outputTokens || 0, cost: 0 }; }
        if (m.method === 'error' && !p.willRetry) failure = p.error?.message || L('gptImages.error.openai');
        if (m.method === 'item/started' && p.item?.type === 'imageGeneration') progress(entry, 'generating');
        if (m.method === 'item/completed') {
          const it = p.item || {};
          if (it.type === 'agentMessage' && it.text) lastText = it.text;
          if (it.type === 'imageGeneration') {
            if (it.failure?.type === 'usageLimitExceeded') failure = it.failure.resetsAt ? L('gptImages.error.limitResets', { when: new Date(it.failure.resetsAt * 1000).toLocaleString(L('locale')) }) : L('gptImages.error.limit');
            else if (it.status === 'completed' && (it.result || it.savedPath)) candidate = it;
            else if (it.status === 'failed') failure = L('gptImages.error.failed');
          }
        }
        if (m.method === 'turn/completed') entry.finish(p.turn);
      });
      const cancel = () => {
        if (entry.threadId && entry.turnId && !c.closed) c.request('turn/interrupt', { threadId: entry.threadId, turnId: entry.turnId }, 4000).catch(() => {});
        clearTimeout(stopTimer); stopTimer = setTimeout(() => { entry.finish({ status: 'interrupted' }); c.close().catch(() => {}); }, 1800);
      };
      entry.abort.signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => { failure = L('gptImages.error.timeout'); entry.abort.abort(); }, 5 * 60 * 1000);
      await c.start(); checkStop();
      const account = await c.request('account/read', { refreshToken: false }); checkStop();
      if (!account.account || account.account.type !== 'chatgpt') throw fail(L('gptImages.error.login'), 'login-codex');
      const capabilities = await c.request('modelProvider/capabilities/read', {}); checkStop();
      if (!capabilities.imageGeneration) throw fail(L('gptImages.error.unsupported'), 'unsupported');
      const model = store.getSettings()?.chatgpt?.model;
      const thread = await c.request('thread/start', {
        cwd: dir, sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user', ephemeral: true,
        ...(model ? { model } : {}), config: { 'features.image_generation': true },
        developerInstructions: 'You are the image generation worker for Stella. Generate exactly one image using the built-in image_generation tool. Do not invoke skills, shell commands, web search, MCP, external APIs, scripts, or code renderers. Do not ask clarifying questions. Respect the user prompt and requested aspect ratio/background. Finish after the image tool completes. If unavailable, explain the failure and do not substitute SVG or text.'
      }); entry.threadId = thread.thread.id; checkStop();
      const aspect = { auto: 'Choose a suitable aspect ratio.', square: 'Use a square 1:1 composition.', landscape: 'Use a landscape 3:2 composition.', portrait: 'Use a portrait 2:3 composition.' }[size];
      const input = [{ type: 'text', text: 'Generate one image using the built-in image_generation tool.\n' + aspect + '\n' + (transparent ? 'Use a transparent background.' : 'Use an opaque background.') + '\n\nUser image description:\n' + prompt, text_elements: [] }];
      const turn = await c.request('turn/start', { threadId: entry.threadId, input, effort: 'low' }, 60000); entry.turnId = turn.turn.id;
      if (stopped()) cancel();
      const result = await terminal; checkStop();
      if (result.status !== 'completed') throw fail(failure || result.error?.message || L('gptImages.error.generic'), 'generation-failed');
      if (!candidate) throw fail(failure || lastText || L('gptImages.error.noImage'), 'no-image');
      progress(entry, 'saving');
      let buffer;
      if (candidate.result) {
        if (candidate.result.length > MAX_BYTES * 4 / 3 + 10) throw fail(L('gptImages.error.tooLarge'), 'image-size');
        buffer = Buffer.from(candidate.result.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      } else {
        const stat = fs.statSync(candidate.savedPath); if (!stat.isFile() || stat.size > MAX_BYTES) throw fail(L('gptImages.error.badFile'), 'image-size');
        buffer = fs.readFileSync(candidate.savedPath);
      }
      const ext = extension(buffer), file = path.join(dir, entry.id + ext);
      checkStop(); fs.writeFileSync(file, buffer, { flag: 'wx' });
      const item = { id: entry.id, file, prompt, usedPrompt: candidate.revisedPrompt || prompt, model: 'GPT Image · ChatGPT account', size, transparent: !!transparent, time: Date.now() };
      index.unshift(item);
      try { writeIndex(); } catch (err) { index.shift(); fs.unlinkSync(file); throw err; }
      if (usage && store.addUsage) { store.addUsage('chatgpt', usage); if (store.getUsage) broadcast('usage:changed', store.getUsage()); }
      cachedAvailability = null; progress(entry, 'done', null, item); return item;
    } catch (err) {
      if (stopped()) { const e = fail(failure || L('gptImages.error.stopped'), failure ? 'timeout' : 'stopped'); progress(entry, failure ? 'error' : 'stopped', e.message); throw e; }
      progress(entry, 'error', err.message); throw err;
    } finally { clearTimeout(timer); clearTimeout(stopTimer); if (entry.client) await entry.client.close(); if (active === entry) active = null; }
  }
  function stop() { if (!active) return false; active.abort.abort(); return true; }
  return { generate, list, get, remove, status, stop, availability };
}
module.exports = { createGptImages, extension };
