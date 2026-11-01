const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE = 300000;
const short = (value, limit = 20000) => String(value ?? '').slice(0, limit);
const tail = (value, limit = 20000) => String(value ?? '').slice(-limit);
const json = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);

/**
 * One adapter per run; the transport must filter notifications by threadId.
 * handle(method, params) is synchronous, returning true for recognized methods.
 * usage is null until updated, then {input, output, cachedInput, cacheWriteInput,
 * reasoningOutput, cost: 0}, sourced from tokenUsage.last (not thread totals).
 * onUsage(usage), onRateLimits(snapshot), onTurn(turn) on turn/started, and
 * onComplete({status: 'done'|'stopped'|'error', usage, turn}) are synchronous.
 * Completion never emits Stella's `done`: the run owner does that exactly once.
 * File reads are bounded and confined to cwd, including resolved symlink targets.
 */
function createEventAdapter({ emit = () => {}, emitLive = () => {}, cwd = process.cwd(), onComplete = () => {}, onUsage = () => {}, onRateLimits = () => {}, onTurn = () => {} } = {}) {
  const root = path.resolve(cwd);
  const texts = new Map(), commands = new Map(), items = new Map(), before = new Map();
  const started = new Set(), completed = new Set(), finishedTurns = new Set(), errors = new Set();
  let usage = null;
  const idFor = id => 'cx-' + id;
  const state = s => emit({ t: 'state', s });
  function setText(key, value, thinking = false, append = false) {
    if (append) value = (texts.get(key) || '') + (value || '');
    else if (!value && texts.has(key)) return;
    if (typeof value !== 'string') return;
    texts.set(key, value);
    emit({ t: thinking ? 'thinking-set' : 'text-set', key, text: value });
    state(thinking ? 'thinking' : 'streaming');
  }
  function reportError(error) {
    const text = error?.message || String(error || 'Codex turn failed.');
    if (errors.has(text)) return;
    errors.add(text);
    emit({ t: 'error', text, action: /401|unauthori|not logged|log in|missing bearer/i.test(text) ? 'login-codex' : null });
  }
  const inside = (base, target) => { const rel = path.relative(base, target); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); };
  function safePath(value) {
    if (typeof value !== 'string' || !value || value.includes('\0')) return null;
    const target = path.resolve(root, value);
    if (!inside(root, target)) return null;
    try {
      const realRoot = fs.realpathSync(root);
      let existing = target;
      while (!fs.existsSync(existing)) {
        const parent = path.dirname(existing);
        if (parent === existing) return null;
        existing = parent;
      }
      if (!inside(realRoot, fs.realpathSync(existing))) return null;
      return target;
    } catch { return null; }
  }
  function readSmall(target) {
    if (!target || !safePath(target)) return null;
    let fd;
    try {
      fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_FILE) return null;
      const data = Buffer.alloc(MAX_FILE + 1);
      let size = 0, n;
      while (size < data.length && (n = fs.readSync(fd, data, size, data.length - size, null)) > 0) size += n;
      if (size > MAX_FILE || !safePath(target)) return null;
      return data.subarray(0, size).toString('utf8');
    } catch { return null; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  function tool(id, name, title, detail, done, output = '', isError = false, outputTail = false) {
    emit({ t: 'tool', id, name, title, detail: detail || '' });
    if (!started.has(id)) { started.add(id); emitLive({ t: 'tool-start', id, name }); }
    if (done) {
      if (!completed.has(id)) {
        completed.add(id);
        const truncate = outputTail ? tail : short;
        emit({ t: 'tool-result', id, output: truncate(output, 6000), isError });
        emitLive({ t: 'result', id, output: truncate(output), isError });
      }
    } else state('tool');
  }
  function command(it, done) {
    const id = idFor(it.id);
    const previous = commands.get(it.id) || { command: '', output: '' };
    const next = { command: it.command ?? previous.command, output: tail(it.aggregatedOutput || previous.output) };
    commands.set(it.id, next);
    tool(id, 'Shell', 'Command: ' + short(next.command, 90), next.command, done, next.output, it.status === 'failed' || it.status === 'declined' || (it.exitCode != null && it.exitCode !== 0), true);
    emitLive({ t: 'cmd', id, command: next.command, output: short(next.output), done, exitCode: it.exitCode ?? null });
  }
  function files(it, done) {
    const id = idFor(it.id), changes = it.changes || [], paths = [];
    changes.forEach((change, index) => {
      const source = safePath(change.path), moved = change.kind?.move_path;
      const target = moved ? safePath(moved) : source;
      for (const p of [source, target]) if (p && !paths.includes(p)) paths.push(p);
      const key = id + ':' + index;
      if (!done && source && !before.has(key)) before.set(key, readSmall(source) ?? '');
      if (target && change.diff) emitLive({ t: 'code', id: key + ':diff', tool: 'Diff', path: target, old: '', text: change.diff, done, replay: false });
      if (done && target) {
        const text = change.kind?.type === 'delete' ? '' : readSmall(target);
        if (text != null) emitLive({ t: 'code', id: key, tool: 'Replay', path: target, old: before.get(key) || '', text, done: true, replay: true });
      }
    });
    tool(id, 'Files', 'File changes (' + changes.length + ')', changes.map(c => (c.kind?.type || 'update') + ': ' + c.path + '\n' + (c.diff || '')).join('\n'), done, '', ['failed', 'declined'].includes(it.status));
    if (done) emit({ t: 'files', paths });
  }
  function item(it, done) {
    if (!it || !it.id) return;
    it = { ...items.get(it.id), ...it };
    items.set(it.id, it);
    const id = idFor(it.id);
    switch (it.type) {
      case 'agentMessage': setText(id, it.text); break;
      case 'reasoning':
        for (const [kind, list] of [['summary', it.summary], ['content', it.content]])
          (list || []).forEach((text, index) => setText(id + ':' + kind + ':' + index, text, true));
        state('thinking'); break;
      case 'commandExecution': command(it, done); break;
      case 'fileChange': files(it, done); break;
      case 'plan':
        setText(id + ':plan', it.text, true); break;
      case 'mcpToolCall':
        tool(id, 'MCP', it.server + ' · ' + it.tool, json(it.arguments), done, json(it.error || it.result), it.status === 'failed' || !!it.error); break;
      case 'dynamicToolCall':
        tool(id, 'DynamicTool', [it.namespace, it.tool].filter(Boolean).join(' · '), json(it.arguments), done, json(it.contentItems), it.success === false || it.status === 'failed'); break;
      case 'webSearch':
        tool(id, 'WebSearch', 'Search: ' + it.query, json(it.action), done, json(it.results)); break;
      case 'collabAgentToolCall':
        tool(id, 'Agent', it.tool, [it.prompt, ...(it.receiverThreadIds || [])].filter(Boolean).join('\n'), done, json(it.agentsStates), it.status === 'failed'); break;
      case 'subAgentActivity':
        tool(id, 'Agent', 'Agent: ' + it.kind, [it.agentThreadId, it.agentPath, it.model].filter(Boolean).join('\n'), done); break;
      case 'contextCompaction': tool(id, 'Compaction', 'Context compaction', '', done); break;
      default: break;
    }
  }
  function handle(method, p = {}) {
    const id = idFor(p.itemId);
    switch (method) {
      case 'item/started': item(p.item, false); break;
      case 'item/completed': item(p.item, true); break;
      case 'item/agentMessage/delta': setText(id, p.delta, false, true); break;
      case 'item/plan/delta': setText(id + ':plan', p.delta, true, true); break;
      case 'item/reasoning/summaryTextDelta': setText(id + ':summary:' + p.summaryIndex, p.delta, true, true); break;
      case 'item/reasoning/textDelta': setText(id + ':content:' + p.contentIndex, p.delta, true, true); break;
      case 'item/reasoning/summaryPartAdded': state('thinking'); break;
      case 'item/commandExecution/outputDelta': {
        const c = commands.get(p.itemId) || { command: '', output: '' };
        c.output = tail(c.output + p.delta);
        commands.set(p.itemId, c);
        emitLive({ t: 'cmd', id, command: c.command, output: c.output, done: false, exitCode: null });
        break;
      }
      case 'item/fileChange/patchUpdated': item({ ...items.get(p.itemId), id: p.itemId, type: 'fileChange', changes: p.changes }, false); break;
      case 'item/fileChange/outputDelta':
      case 'item/mcpToolCall/progress': emitLive({ t: 'result', id, output: p.delta ?? p.message ?? '', isError: false }); break;
      case 'turn/started': usage = null; errors.clear(); onTurn(p.turn); state('thinking'); break;
      case 'turn/completed': {
        const turn = p.turn;
        if (!turn || !['completed', 'failed', 'interrupted'].includes(turn.status) || finishedTurns.has(turn.id)) break;
        finishedTurns.add(turn.id);
        if (turn.status === 'failed') reportError(turn.error);
        onComplete({ status: turn.status === 'failed' ? 'error' : turn.status === 'interrupted' ? 'stopped' : 'done', usage, turn });
        break;
      }
      case 'error': if (p.willRetry) state('thinking'); else reportError(p.error); break;
      case 'thread/tokenUsage/updated': {
        const u = p.tokenUsage?.last;
        if (u) { usage = { input: u.inputTokens || 0, output: u.outputTokens || 0, cachedInput: u.cachedInputTokens || 0, cacheWriteInput: u.cacheWriteInputTokens || 0, reasoningOutput: u.reasoningOutputTokens || 0, cost: 0 }; onUsage(usage); }
        break;
      }
      case 'account/rateLimits/updated': onRateLimits(p.rateLimits); break;
      case 'turn/plan/updated': tool('cx-plan-' + p.turnId, 'Plan', 'Plan', [p.explanation, ...(p.plan || []).map(s => '[' + s.status + '] ' + s.step)].filter(Boolean).join('\n'), false); break;
      case 'thread/compacted': tool('cx-compaction-' + p.turnId, 'Compaction', 'Context compacted', '', true); break;
      case 'turn/diff/updated': emitLive({ t: 'code', id: 'cx-diff-' + p.turnId, tool: 'Diff', path: '', old: '', text: p.diff || '', done: false, replay: false }); break;
      case 'warning': case 'guardianWarning': case 'configWarning': case 'deprecationNotice':
      case 'model/rerouted': case 'model/verification': case 'model/safetyBuffering/updated':
        setText('cx-notice:' + method + ':' + (p.turnId || ''), p.message || [p.summary, p.details].filter(Boolean).join('\n') || json(p), true); break;
      default: return false;
    }
    return true;
  }
  return { handle, get usage() { return usage; } };
}

module.exports = { createEventAdapter };
