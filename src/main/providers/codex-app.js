/* Interactive Codex app-server backend for both Codex and account-backed ChatGPT. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createRequire } = require('module');
const { spawn } = require('child_process');
const { CodexClient } = require('./codex-client');
const { L } = require('../i18n');
const accounts = require('../accounts');
function isFile(p) { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }
function findCodexJs(settings) {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  for (const p of [settings?.codex?.jsPath, path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')].filter(Boolean)) if (isFile(p)) return p;
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(d, process.platform === 'win32' ? 'codex.exe' : 'codex'); if (isFile(p)) return p;
  }
  return null;
}
// slot: account slot to launch with (default: the active one).
function launchSpec(settings, slot) {
  const entry = findCodexJs(settings);
  if (!entry) throw Object.assign(new Error(L('codex.missing')), { action: 'install-codex' });
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1', ...accounts.envFor(settings, 'codex', slot) };
  const args = ['app-server', '--listen', 'stdio://'];
  if (!/\.[cm]?js$/i.test(entry)) return { command: entry, args, env };
  // Prefer the native executable to avoid the npm wrapper's Windows signal lifecycle.
  const platforms = { win32: 'pc-windows-msvc', linux: 'unknown-linux-musl', darwin: 'apple-darwin' };
  const triple = (process.arch === 'arm64' ? 'aarch64' : 'x86_64') + '-' + platforms[process.platform];
  const exe = process.platform === 'win32' ? 'codex.exe' : 'codex'; let vendor;
  try { vendor = path.join(path.dirname(createRequire(path.resolve(entry)).resolve('@openai/codex-' + process.platform + '-' + process.arch + '/package.json')), 'vendor'); }
  catch (_) { vendor = path.join(path.dirname(entry), '..', 'vendor'); }
  for (const binary of [path.join(vendor, triple, 'bin', exe), path.join(vendor, triple, 'codex', exe)]) if (isFile(binary)) {
    env.PATH = path.join(vendor, triple, 'path') + path.delimiter + (env.PATH || ''); return { command: binary, args, env };
  }
  return { command: process.execPath, args: [entry, ...args], env };
}
function killTree(child) {
  if (!child || child.exitCode != null || !child.pid) return;
  if (process.platform === 'win32') { const k = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); k.on('error', () => {}); }
  else child.kill('SIGTERM');
}
function policyFor(mode, cwd) {
  if (mode === 'danger-full-access') return { approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } };
  if (mode === 'read-only') return { approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly', networkAccess: false } };
  if (mode === 'workspace-write') return { approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } };
  throw new Error(L('codex.unknownMode', { mode }));
}
async function handleServerRequest(message, { requestApproval, requestUserInput, signal } = {}) {
  const p = message.params || {};
  const ask = (title, detail) => signal?.aborted || !requestApproval ? 'deny' : requestApproval({ title, detail, reason: p.reason });
  switch (message.method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval': {
      const files = message.method.includes('fileChange');
      const a = await ask(files ? L('codex.approveFiles') : L('codex.approveCommand'), p.command || p.grantRoot || '');
      return { decision: a === 'always' ? 'acceptForSession' : a === 'allow' ? 'accept' : 'decline' };
    }
    case 'item/permissions/requestApproval': {
      const a = await ask(L('codex.approvePermissions'), JSON.stringify(p.permissions || {}, null, 2)); const permissions = {};
      if (a === 'allow' || a === 'always') for (const k of ['network', 'fileSystem']) if (p.permissions?.[k]) permissions[k] = p.permissions[k];
      return { permissions, scope: a === 'always' ? 'session' : 'turn' };
    }
    case 'item/tool/requestUserInput': return { answers: !signal?.aborted && requestUserInput ? await requestUserInput({ questions: p.questions || [] }) : {} };
    case 'mcpServer/elicitation/request': {
      if (p.mode === 'url') { const a = await ask('MCP · ' + p.serverName, (p.message || '') + '\n' + p.url); return { action: a === 'allow' || a === 'always' ? 'accept' : 'decline', content: null, _meta: null }; }
      if (!requestUserInput || signal?.aborted) return { action: 'decline', content: null, _meta: null };
      const props = p.requestedSchema?.properties || {};
      // Do not coerce rich JSON schemas into scalar strings. Decline forms we cannot render faithfully.
      if (Object.values(props).some((s) => !['string', 'boolean', 'number', 'integer'].includes(s.type) || s.oneOf || s.anyOf || (s.enum && s.enum.some((v) => v == null || typeof v === 'object')))) return { action: 'decline', content: null, _meta: null };
      const required = p.requestedSchema?.required || [];
      const questions = Object.entries(props).map(([id, s]) => ({ id, header: p.serverName || 'MCP', question: s.title || s.description || id, required: required.includes(id), isSecret: s.format === 'password', isOther: !s.enum, options: s.enum ? s.enum.map((v) => ({ label: String(v), description: '' })) : s.type === 'boolean' ? [{ label: 'true', description: '' }, { label: 'false', description: '' }] : null }));
      const answers = await requestUserInput({ questions }); const content = {};
      if (signal?.aborted || required.some((id) => !answers[id]?.answers?.length)) return { action: 'cancel', content: null, _meta: null };
      for (const [id, s] of Object.entries(props)) {
        const v = answers[id]?.answers?.[0]; if (v == null || v === '') continue;
        content[id] = s.type === 'boolean' ? v === 'true' : s.type === 'number' || s.type === 'integer' ? Number(v) : v;
        if (typeof content[id] === 'number' && !Number.isFinite(content[id])) throw new Error(L('codex.mcpNumber', { id }));
        if (s.type === 'integer' && !Number.isInteger(content[id])) throw new Error(L('codex.mcpInteger', { id }));
        if (s.enum && !s.enum.includes(content[id])) throw new Error(L('codex.mcpInvalid', { id }));
      }
      return { action: 'accept', content, _meta: null };
    }
    default: throw new Error(L('codex.unsupportedRequest', { method: message.method }));
  }
}
async function withClient(settings, action, slot) {
  const c = new CodexClient(launchSpec(settings, slot));
  c.on('request', (m) => { try { c.reject(m.id, -32601, 'Interactive request requires an active Stella chat'); } catch (_) {} });
  try { await c.start(); return await action(c); } finally { await c.close(); }
}
async function listModels(settings) {
  return withClient(settings, async (c) => { const models = []; let cursor; do { const r = await c.request('model/list', { limit: 100, ...(cursor ? { cursor } : {}) }); models.push(...(r.data || [])); cursor = r.nextCursor; } while (cursor); return models; });
}
async function getAccount(settings, slot) {
  return withClient(settings, async (c) => { const account = await c.request('account/read', { refreshToken: false }); try { return { ...account, ...await c.request('account/rateLimits/read', {}) }; } catch (_) { return { ...account, rateLimits: null }; } }, slot);
}
const CHAT_INSTRUCTIONS = 'You are the conversational assistant inside Stella. Answer in the user’s language. Help with questions, writing and projects. Use tools when needed for the user’s request, and respect their chosen approval policy.';
async function run({ chat, text, attachments = [], settings, emit: emitRaw, emitLive = () => {}, onThread, onLimit, abortController, mode, flavor, requestApproval, requestUserInput, onRequestResolved, resumeFallback }) {
  const signal = abortController.signal; if (signal.aborted) return { status: 'stopped' };
  let limitHit = false;
  const emit = (ev) => { if (ev && ev.t === 'error' && (ev.limit || accounts.isLimitText(ev.text))) limitHit = true; emitRaw(ev); };
  let client, threadId = chat.codexThread || null, turnId, stopTimer; let settled = false, resolveDone;
  const startupEvents = [];
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const finish = (result) => { if (!settled) { settled = true; resolveDone(result); } };
  const abort = () => {
    if (threadId && turnId && client && !client.closed) client.request('turn/interrupt', { threadId, turnId }, 4000).catch(() => {});
    clearTimeout(stopTimer); stopTimer = setTimeout(() => { finish({ status: 'stopped' }); if (client) client.close().catch(() => {}); }, 2000);
  };
  try {
    client = new CodexClient({ ...launchSpec(settings), cwd: chat.cwd });
    const isChat = flavor === 'chatgpt', cfg = settings[isChat ? 'chatgpt' : 'codex'] || {};
    const sandbox = mode || cfg.sandbox || (isChat ? 'workspace-write' : 'read-only');
    const policy = policyFor(sandbox, chat.cwd);
    const adapter = require('./codex-events').createEventAdapter({ emit, emitLive, cwd: chat.cwd, onComplete: finish, onRateLimits: onLimit, onTurn: (turn) => { turnId = turn.id; if (signal.aborted) abort(); } });
    const handleNotification = (m) => {
      if (m.params?.threadId && !threadId) { startupEvents.push(['notification', m]); return; }
      const p = m.params || {}; if (p.threadId && p.threadId !== threadId) return;
      if (m.method === 'serverRequest/resolved' && onRequestResolved) onRequestResolved(String(p.requestId));
      if (m.method === 'turn/started') turnId = p.turn?.id || turnId;
      adapter.handle(m.method, p);
    };
    client.on('notification', handleNotification);
    client.on('closed', (err) => { if (!settled) { if (!signal.aborted) emit({ t: 'error', text: err.message }); finish({ status: signal.aborted ? 'stopped' : 'error' }); } });
    const handleRequest = async (m) => {
      if (m.params?.threadId && !threadId) { startupEvents.push(['request', m]); return; }
      try {
        if (m.params?.threadId && m.params.threadId !== threadId) throw new Error(L('codex.otherChat'));
        const tag = (fn) => fn ? (p) => fn({ ...p, serverRequestId: String(m.id) }) : undefined;
        const result = await handleServerRequest(m, { requestApproval: tag(requestApproval), requestUserInput: tag(requestUserInput), signal });
        if (!client.closed && !settled) client.respond(m.id, result);
      }
      catch (err) { if (!client.closed && !settled) { try { client.reject(m.id, -32601, err.message); } catch (_) {} } }
    };
    client.on('request', handleRequest);
    signal.addEventListener('abort', abort, { once: true });
    await client.start(); if (signal.aborted) return { status: 'stopped' };
    const params = { cwd: chat.cwd, sandbox, approvalPolicy: policy.approvalPolicy, approvalsReviewer: 'user', ...(cfg.model ? { model: cfg.model } : {}), ...(isChat ? { developerInstructions: CHAT_INSTRUCTIONS } : {}) };
    // A thread moved from the other account may not resume there; then start fresh with a dialog digest.
    let r, fallbackContext = '';
    if (chat.codexThread) {
      try { r = await client.request('thread/resume', { ...params, threadId: chat.codexThread }); }
      catch (err) { if (!resumeFallback || signal.aborted) throw err; fallbackContext = resumeFallback() || ''; r = await client.request('thread/start', params); }
    } else r = await client.request('thread/start', params);
    threadId = r.thread.id; if (onThread) onThread(threadId);
    for (const [kind, message] of startupEvents.splice(0)) {
      if (kind === 'request') handleRequest(message); else handleNotification(message);
    }
    if (signal.aborted) return { status: 'stopped' };
    let prompt = fallbackContext + (text || ''); const files = attachments.filter((a) => a.kind !== 'image');
    if (files.length) prompt += '\n\nAttached files (read them when relevant):\n' + files.map((a) => '- ' + a.path).join('\n');
    const input = [{ type: 'text', text: prompt.trim() ? prompt : L('prompt.seeAttachments'), text_elements: [] }, ...attachments.filter((a) => a.kind === 'image').map((a) => ({ type: 'localImage', path: a.path }))];
    emit({ t: 'state', s: 'thinking' });
    const turn = await client.request('turn/start', { threadId, input, cwd: chat.cwd, ...policy, approvalsReviewer: 'user', ...(cfg.model ? { model: cfg.model } : {}), ...(cfg.effort ? { effort: cfg.effort } : {}) }, 60000);
    turnId = turn.turn.id; if (signal.aborted) abort();
    const result = await done;
    return result && result.status === 'error' && limitHit ? { ...result, limitHit } : result;
  } catch (err) {
    if (signal.aborted) return { status: 'stopped' };
    const login = /401|unauthori[sz]ed|not logged|authentication required|missing bearer/i.test(err.message);
    emit({ t: 'error', text: err.message, action: err.action || (login ? 'login-codex' : null) }); return { status: 'error', limitHit };
  } finally { settled = true; signal.removeEventListener('abort', abort); clearTimeout(stopTimer); if (client) await client.close(); }
}
module.exports = { run, findCodexJs, launchSpec, killTree, policyFor, handleServerRequest, listModels, getAccount };
