/* Claude через Claude Agent SDK: поток ответа, инструменты, подтверждения, лимиты. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { L } = require('../i18n');

// Claude Agent SDK распространяется Anthropic под собственной (не открытой) лицензией,
// поэтому Stella его не включает в сборку, а берёт из глобальной установки npm у пользователя.
function findSdk(settings) {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const candidates = [
    settings && settings.claude && settings.claude.sdkPath,
    path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs')
  ].filter(Boolean);
  for (const p of candidates) { try { if (fs.statSync(p).isFile()) return p; } catch (e) {} }
  return null;
}

let sdkPromise = null;
let sdkFrom = null;
function loadSdk(settings) {
  const p = findSdk(settings);
  if (!p) return null;
  if (!sdkPromise || sdkFrom !== p) { sdkFrom = p; sdkPromise = import(pathToFileURL(p).href); }
  return sdkPromise;
}

function findClaudeExe(settings) {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const candidates = [
    settings && settings.claude && settings.claude.exePath,
    path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'node_modules', '@anthropic-ai', 'claude-code-win32-x64', 'claude.exe')
  ].filter(Boolean);
  for (const p of candidates) { try { if (fs.statSync(p).isFile()) return p; } catch (e) {} }
  return null;
}

function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }

function describeTool(name, input) {
  input = input || {};
  const f = input.file_path || input.notebook_path || input.path || '';
  switch (name) {
    case 'Bash': return { title: L('tool.command', { text: short(input.description || input.command, 90) }), detail: input.command || '' };
    case 'PowerShell': return { title: L('tool.command', { text: short(input.description || input.command, 90) }), detail: input.command || '' };
    case 'Read': return { title: L('tool.read', { file: path.basename(f) }), detail: f };
    case 'Write': return { title: L('tool.write', { file: path.basename(f) }), detail: f };
    case 'Edit': case 'MultiEdit': return { title: L('tool.edit', { file: path.basename(f) }), detail: f };
    case 'NotebookEdit': return { title: L('tool.editNotebook', { file: path.basename(f) }), detail: f };
    case 'Glob': return { title: L('tool.glob', { pattern: short(input.pattern, 80) }), detail: input.path || '' };
    case 'Grep': return { title: L('tool.grep', { pattern: short(input.pattern, 80) }), detail: input.path || '' };
    case 'WebSearch': return { title: L('tool.webSearch', { query: short(input.query, 80) }), detail: '' };
    case 'WebFetch': return { title: L('tool.webFetch'), detail: input.url || '' };
    case 'Task': case 'Agent': return { title: L('tool.agent', { text: short(input.description, 80) }), detail: short(input.prompt, 600) };
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      return { title: L('tool.todo'), detail: todos.map((t) => (t.status === 'completed' ? '[x] ' : t.status === 'in_progress' ? '[>] ' : '[ ] ') + (t.content || t.activeForm || '')).join('\n') };
    }
    default: {
      let d = '';
      try { d = JSON.stringify(input, null, 2); } catch (e) {}
      return { title: name.replace(/^mcp__/, '').replace(/__/g, ' · '), detail: short(d, 1500) };
    }
  }
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && c.type === 'text' ? c.text : c && c.type === 'image' ? '[image]' : '')).join('\n');
  return '';
}

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// Достаёт значение строкового поля из ещё не дописанного JSON (поток input_json_delta)
function partialField(json, key) {
  const k = '"' + key + '"';
  const i = json.indexOf(k);
  if (i < 0) return null;
  let j = i + k.length;
  while (j < json.length && (json[j] === ' ' || json[j] === ':' || json[j] === '\n')) j++;
  if (json[j] !== '"') return null;
  j++;
  let out = '';
  while (j < json.length) {
    const c = json[j];
    if (c === '"') return { value: out, done: true };
    if (c === '\\') {
      const n = json[j + 1];
      if (n === undefined) break;
      if (n === 'u') {
        const hex = json.substr(j + 2, 4);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        j += 6;
        continue;
      }
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '' : n === 'b' || n === 'f' ? '' : n;
      j += 2;
      continue;
    }
    out += c;
    j++;
  }
  return { value: out, done: false };
}

async function run({ chat, text, attachments, settings, emit, emitLive, requestApproval, onSession, onLimit, abortController, mode }) {
  emitLive = emitLive || (() => {});
  const exe = findClaudeExe(settings);
  if (!exe) {
    emit({ t: 'error', text: L('claude.missing'), action: 'install-claude' });
    return { status: 'error' };
  }
  const sdk = loadSdk(settings);
  if (!sdk) {
    emit({ t: 'error', text: L('claude.sdkMissing'), action: 'install-sdk' });
    return { status: 'error' };
  }
  const { query } = await sdk;

  // содержимое сообщения: текст + картинки, остальные файлы — путями
  const content = [];
  const images = (attachments || []).filter((a) => a.kind === 'image');
  const others = (attachments || []).filter((a) => a.kind !== 'image');
  let fullText = text || '';
  if (others.length) fullText += '\n\nAttached files (read them when relevant):\n' + others.map((a) => '- ' + a.path).join('\n');
  content.push({ type: 'text', text: fullText || L('prompt.seeAttachments') });
  for (const im of images) {
    try {
      const data = fs.readFileSync(im.path).toString('base64');
      content.push({ type: 'image', source: { type: 'base64', media_type: im.mime || 'image/png', data } });
    } catch (e) {}
  }

  let finishInput;
  const inputDone = new Promise((r) => { finishInput = r; });
  async function* prompt() {
    yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
    await inputDone; // держим ввод открытым до конца хода, чтобы работали подтверждения
  }

  const permissionMode = mode || settings.claude.permissionMode || 'default';
  const options = {
    cwd: chat.cwd,
    pathToClaudeCodeExecutable: exe,
    includePartialMessages: true,
    permissionMode,
    allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
    settingSources: ['user', 'project', 'local'],
    abortController,
    stderr: () => {},
    canUseTool: async (toolName, input, opts) => {
      const d = describeTool(toolName, input);
      const answer = await requestApproval({ title: opts && opts.title ? opts.title : d.title, detail: d.detail, reason: opts && opts.decisionReason });
      if (answer === 'deny') return { behavior: 'deny', message: 'The user denied this action.' };
      const res = { behavior: 'allow', updatedInput: input };
      if (answer === 'always' && opts && opts.suggestions) res.updatedPermissions = opts.suggestions;
      return res;
    }
  };
  if (chat.claudeSession) options.resume = chat.claudeSession;
  if (settings.claude.model) options.model = settings.claude.model;
  if (['low', 'medium', 'high', 'xhigh', 'max'].includes(settings.claude.effort)) options.effort = settings.claude.effort;

  const streamed = new Set();
  let currentStreamId = null;
  let status = 'done';
  let usage = null;
  let gotText = false;
  let errored = false;
  const liveBlocks = new Map(); // индекс блока -> { id, name, json, last }
  function pushLive(b, final) {
    const now = Date.now();
    if (!final && now - b.last < 50) return;
    b.last = now;
    const fp = partialField(b.json, 'file_path') || partialField(b.json, 'notebook_path');
    const abs = fp && fp.done ? (path.isAbsolute(fp.value) ? fp.value : path.join(chat.cwd, fp.value)) : null;
    if (b.name === 'Write') {
      const c = partialField(b.json, 'content');
      if (c) emitLive({ t: 'code', id: b.id, tool: 'Write', path: abs, text: c.value, done: !!final });
    } else if (b.name === 'Edit') {
      const o = partialField(b.json, 'old_string');
      const n = partialField(b.json, 'new_string');
      if (o || n) emitLive({ t: 'code', id: b.id, tool: 'Edit', path: abs, old: o ? o.value : '', text: n ? n.value : '', done: !!final });
    } else if (b.name === 'Bash' || b.name === 'PowerShell') {
      const c = partialField(b.json, 'command');
      if (c) emitLive({ t: 'cmd', id: b.id, command: c.value, output: '', done: false });
    }
  }

  try {
    const q = query({ prompt: prompt(), options });
    for await (const m of q) {
      if (m.session_id && m.session_id !== chat.claudeSession) onSession(m.session_id);
      if (m.type === 'stream_event') {
        if (m.parent_tool_use_id) continue;
        const e = m.event || {};
        if (e.type === 'message_start' && e.message) { currentStreamId = e.message.id; liveBlocks.clear(); }
        if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'tool_use') {
          liveBlocks.set(e.index, { id: e.content_block.id, name: e.content_block.name, json: '', last: 0 });
          emitLive({ t: 'tool-start', id: e.content_block.id, name: e.content_block.name });
          emit({ t: 'state', s: 'tool' });
        }
        if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'input_json_delta') {
          const b = liveBlocks.get(e.index);
          if (b) { b.json += e.delta.partial_json || ''; pushLive(b, false); }
        }
        if (e.type === 'content_block_stop') {
          const b = liveBlocks.get(e.index);
          if (b) { pushLive(b, true); liveBlocks.delete(e.index); }
        }
        if (e.type === 'content_block_delta' && e.delta) {
          if (e.delta.type === 'text_delta') { emit({ t: 'text', text: e.delta.text }); emit({ t: 'state', s: 'streaming' }); gotText = true; if (currentStreamId) streamed.add(currentStreamId); }
          else if (e.delta.type === 'thinking_delta') { emit({ t: 'thinking', text: e.delta.thinking || '' }); emit({ t: 'state', s: 'thinking' }); }
        }
      } else if (m.type === 'assistant') {
        const msg = m.message || {};
        if (m.error) continue; // текст такого сообщения — это текст ошибки, его покажет итог хода
        for (const b of msg.content || []) {
          if (b.type === 'text' && !m.parent_tool_use_id && !streamed.has(msg.id) && b.text) { emit({ t: 'text', text: b.text }); gotText = true; }
          if (b.type === 'tool_use') {
            const d = describeTool(b.name, b.input);
            emit({ t: 'tool', id: b.id, name: b.name, title: d.title, detail: d.detail });
            emit({ t: 'state', s: 'tool' });
            if (EDIT_TOOLS.has(b.name) && b.input) {
              const p = b.input.file_path || b.input.notebook_path;
              if (p) emit({ t: 'files', paths: [path.isAbsolute(p) ? p : path.join(chat.cwd, p)] });
            }
          }
        }
      } else if (m.type === 'user') {
        const c = m.message && m.message.content;
        if (Array.isArray(c)) for (const b of c) {
          if (b.type === 'tool_result') {
            const out = short(toolResultText(b.content), 6000);
            emit({ t: 'tool-result', id: b.tool_use_id, output: out, isError: !!b.is_error });
            emitLive({ t: 'result', id: b.tool_use_id, output: out, isError: !!b.is_error });
          }
        }
        emit({ t: 'state', s: 'thinking' });
      } else if (m.type === 'rate_limit_event' && m.rate_limit_info) {
        onLimit(m.rate_limit_info);
      } else if (m.type === 'result') {
        let input = 0, output = 0;
        if (m.modelUsage) for (const k of Object.keys(m.modelUsage)) {
          const u = m.modelUsage[k] || {};
          input += (u.inputTokens || 0) + (u.cacheReadInputTokens || 0) + (u.cacheCreationInputTokens || 0);
          output += u.outputTokens || 0;
        } else if (m.usage) { input = m.usage.input_tokens || 0; output = m.usage.output_tokens || 0; }
        usage = { input, output, cost: m.total_cost_usd || 0 };
        if (m.subtype !== 'success' || m.is_error) {
          const errText = (m.errors && m.errors.length ? m.errors.join('\n') : '') || m.result || L('claude.failed');
          const needLogin = /login|log in|api key|auth|credential|unauthori/i.test(errText);
          emit({ t: 'error', text: needLogin ? L('claude.needLogin') + '\n\n' + errText : errText, action: needLogin ? 'login-claude' : null });
          status = 'error';
          errored = true;
        }
        finishInput();
      }
    }
  } catch (err) {
    finishInput();
    if (abortController.signal.aborted) return { status: 'stopped', usage };
    if (errored) return { status: 'error', usage };
    const t = String(err && err.message || err);
    const needLogin = /login|log in|api key|auth|credential|unauthori/i.test(t);
    emit({ t: 'error', text: L('claude.requestFailed', { message: t }), action: needLogin ? 'login-claude' : null });
    return { status: 'error', usage };
  }
  finishInput();
  return { status: abortController.signal.aborted ? 'stopped' : status, usage };
}

module.exports = { run, findClaudeExe, findSdk, describeTool, partialField };
