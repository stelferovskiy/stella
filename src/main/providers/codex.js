/* Codex CLI (codex exec --json): агент OpenAI. Тот же движок обслуживает ChatGPT через аккаунт ChatGPT. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function findCodexJs(settings) {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const candidates = [
    settings && settings.codex && settings.codex.jsPath,
    path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  ].filter(Boolean);
  for (const p of candidates) { try { if (fs.statSync(p).isFile()) return p; } catch (e) {} }
  return null;
}

function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }

function killTree(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch (e) {}
  } else { try { child.kill('SIGTERM'); } catch (e) {} }
}

const CHATGPT_PREFIX = 'Ты — ChatGPT внутри настольного приложения Stella. Веди себя как обычный чат-ассистент: отвечай на вопросы, помогай с текстами, идеями, переводами и объяснениями. Отвечай на языке пользователя. Не создавай и не меняй файлы и не запускай команды, если пользователь прямо об этом не попросил.\n\nСообщение пользователя:\n';

function readSmall(p) {
  try { const st = fs.statSync(p); if (!st.isFile() || st.size > 300000) return null; return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

async function run({ chat, text, attachments, settings, emit, emitLive, onThread, abortController, mode, flavor }) {
  emitLive = emitLive || (() => {});
  const before = new Map(); // путь -> содержимое до правки
  const js = findCodexJs(settings);
  if (!js) {
    emit({ t: 'error', text: 'Codex не найден на компьютере. Установите его: npm.cmd install -g @openai/codex', action: 'install-codex' });
    return { status: 'error' };
  }
  const isChat = flavor === 'chatgpt';
  const sandbox = isChat ? 'read-only' : (mode || settings.codex.sandbox || 'read-only');
  const model = isChat ? settings.chatgpt.model : settings.codex.model;
  const effort = isChat ? settings.chatgpt.effort : settings.codex.effort;

  const args = [js, 'exec', '--json', '--skip-git-repo-check', '-C', chat.cwd];
  if (sandbox === 'danger-full-access') args.push('--dangerously-bypass-approvals-and-sandbox');
  else args.push('-s', sandbox);
  if (model) args.push('-m', model);
  if (['minimal', 'low', 'medium', 'high', 'xhigh'].includes(effort)) args.push('-c', 'model_reasoning_effort="' + effort + '"');
  if (chat.codexThread) args.push('resume', chat.codexThread);
  args.push('-');
  const images = (attachments || []).filter((a) => a.kind === 'image');
  for (const im of images) args.push('-i', im.path);

  let prompt = text || '';
  const others = (attachments || []).filter((a) => a.kind !== 'image');
  if (others.length) prompt += '\n\nПрикреплённые файлы:\n' + others.map((a) => '- ' + a.path).join('\n');
  if (!prompt.trim()) prompt = 'Посмотри вложения.';
  if (isChat && !chat.codexThread) prompt = CHATGPT_PREFIX + prompt;

  const child = spawn(process.execPath, args, {
    cwd: chat.cwd,
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' }),
    windowsHide: true
  });
  abortController.signal.addEventListener('abort', () => killTree(child));
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);

  let status = 'done';
  let usage = null;
  let sawError = false;
  let lastError = '';
  const LOGIN_RE = /401|unauthori|not logged|log in|login|missing bearer|auth/i;
  function reportError(text) {
    text = String(text || 'Ошибка Codex.');
    // временные сообщения о переподключении — не ошибки
    if (/^(reconnecting|falling back|retrying)/i.test(text.trim())) { emit({ t: 'state', s: 'thinking' }); return; }
    sawError = true; status = 'error';
    if (text === lastError) return;
    lastError = text;
    const login = LOGIN_RE.test(text);
    emit({ t: 'error', text: login ? 'Codex: нужно войти в аккаунт.\n\n' + short(text, 400) : text, action: login ? 'login-codex' : null });
  }
  let stderrTail = '';
  let buf = '';

  function handle(e) {
    const type = e.type || '';
    if (type === 'thread.started' && e.thread_id) { onThread(e.thread_id); return; }
    if (type === 'turn.started') { emit({ t: 'state', s: 'thinking' }); return; }
    if (type === 'turn.completed') {
      const u = e.usage || {};
      usage = { input: (u.input_tokens || 0), output: (u.output_tokens || 0), cost: 0 };
      return;
    }
    if (type === 'turn.failed') { reportError((e.error && e.error.message) || 'Ход завершился ошибкой.'); return; }
    if (type === 'error') { reportError(e.message); return; }
    if (!type.startsWith('item.') || !e.item) return;
    const it = e.item;
    const done = type === 'item.completed';
    const id = 'cx-' + (it.id || Math.random());
    switch (it.type) {
      case 'agent_message':
        emit({ t: 'text-set', key: id, text: it.text || '' });
        emit({ t: 'state', s: 'streaming' });
        break;
      case 'reasoning':
        if (it.text) emit({ t: 'thinking-set', key: id, text: it.text });
        emit({ t: 'state', s: 'thinking' });
        break;
      case 'command_execution':
        emit({ t: 'tool', id, name: 'Shell', title: 'Команда: ' + short(it.command, 90), detail: it.command || '' });
        if (type === 'item.started') emitLive({ t: 'tool-start', id, name: 'Shell' });
        emitLive({ t: 'cmd', id, command: it.command || '', output: short(it.aggregated_output || '', 20000), done, exitCode: it.exit_code });
        if (done) emit({ t: 'tool-result', id, output: short(it.aggregated_output || '', 6000), isError: it.exit_code != null && it.exit_code !== 0 });
        else emit({ t: 'state', s: 'tool' });
        break;
      case 'file_change': {
        const changes = Array.isArray(it.changes) ? it.changes : [];
        const paths = changes.map((c) => (path.isAbsolute(c.path) ? c.path : path.join(chat.cwd, c.path)));
        if (!done) { for (const p of paths) if (!before.has(p)) before.set(p, readSmall(p) || ''); emitLive({ t: 'tool-start', id, name: 'Files' }); }
        else paths.forEach((p, k) => {
          const after = readSmall(p);
          if (after != null) emitLive({ t: 'code', id: id + ':' + k, tool: 'Replay', path: p, old: before.has(p) ? before.get(p) : '', text: after, done: true, replay: true });
        });
        emit({ t: 'tool', id, name: 'Files', title: 'Изменение файлов (' + changes.length + ')', detail: changes.map((c) => (c.kind || 'update') + ': ' + c.path).join('\n') });
        if (done) { emit({ t: 'tool-result', id, output: '', isError: it.status === 'failed' }); emit({ t: 'files', paths }); }
        break;
      }
      case 'mcp_tool_call':
        emit({ t: 'tool', id, name: 'MCP', title: (it.server || 'MCP') + ' · ' + (it.tool || ''), detail: '' });
        if (done) emit({ t: 'tool-result', id, output: short(it.error ? (it.error.message || JSON.stringify(it.error)) : (it.result ? JSON.stringify(it.result) : ''), 4000), isError: it.status === 'failed' });
        break;
      case 'web_search':
        emit({ t: 'tool', id, name: 'WebSearch', title: 'Поиск в интернете: ' + short(it.query, 80), detail: '' });
        if (done) emit({ t: 'tool-result', id, output: '', isError: false });
        break;
      case 'todo_list': {
        const items = Array.isArray(it.items) ? it.items : [];
        emit({ t: 'tool', id, name: 'Plan', title: 'План задач', detail: items.map((x) => (x.completed ? '[x] ' : '[ ] ') + x.text).join('\n') });
        if (done) emit({ t: 'tool-result', id, output: '', isError: false });
        break;
      }
      case 'error':
        reportError(it.message);
        break;
      default:
        break;
    }
  }

  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try { handle(JSON.parse(line)); } catch (e) {}
    }
  });
  child.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString('utf8')).slice(-3000); });

  const code = await new Promise((resolve) => {
    child.on('error', (err) => { stderrTail += '\n' + err.message; resolve(-1); });
    child.on('close', (c) => resolve(c));
  });

  if (abortController.signal.aborted) return { status: 'stopped', usage };
  if (code !== 0 && !sawError) {
    reportError(short(stderrTail.trim() || ('Codex завершился с кодом ' + code), 1500));
  }
  return { status, usage };
}

module.exports = { run, findCodexJs, killTree };
