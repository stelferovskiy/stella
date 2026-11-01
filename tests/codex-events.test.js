const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEventAdapter } = require('../src/main/providers/codex-events');
const reducer = require('../src/shared/reducer');

function setup(cwd) {
  const events = [], live = [], completions = [], usages = [], rates = [], turns = [];
  const adapter = createEventAdapter({ cwd, emit: e => events.push(e), emitLive: e => live.push(e), onComplete: r => completions.push(r), onUsage: u => usages.push(u), onRateLimits: r => rates.push(r), onTurn: t => turns.push(t) });
  const send = (method, params = {}) => adapter.handle(method, { threadId: 'thread', turnId: 'turn', ...params });
  const item = (value, done = false) => send(done ? 'item/completed' : 'item/started', { item: value });
  return { adapter, send, item, events, live, completions, usages, rates, turns };
}

test('messages accumulate per item and empty or missing final snapshots preserve deltas', () => {
  const h = setup();
  h.item({ type: 'agentMessage', id: 'a', text: '' });
  h.send('item/agentMessage/delta', { itemId: 'a', delta: 'hello' });
  h.send('item/agentMessage/delta', { itemId: 'b', delta: 'other' });
  h.send('item/agentMessage/delta', { itemId: 'a', delta: ' world' });
  h.item({ type: 'agentMessage', id: 'a', text: '' }, true);
  h.item({ type: 'agentMessage', id: 'b' }, true);
  const msg = h.events.reduce(reducer.apply, {});
  assert.deepEqual(msg.blocks.filter(b => b.type === 'text').map(b => b.text), ['hello world', 'other']);
});

test('reasoning summary and content indices have independent accumulators and snapshots', () => {
  const h = setup();
  for (const [method, extra, delta] of [
    ['summaryTextDelta', { summaryIndex: 0 }, 'sum'], ['summaryTextDelta', { summaryIndex: 1 }, 'second'],
    ['textDelta', { contentIndex: 0 }, 'raw'], ['summaryTextDelta', { summaryIndex: 0 }, 'mary']
  ]) h.send('item/reasoning/' + method, { itemId: 'r', ...extra, delta });
  h.item({ type: 'reasoning', id: 'r', summary: [], content: [] }, true);
  const blocks = h.events.reduce(reducer.apply, {}).blocks;
  assert.deepEqual(blocks.map(b => b.text), ['summary', 'second', 'raw']);
  assert.equal(new Set(blocks.map(b => b.key)).size, 3);
});

test('commands stream aggregate output and preserve it when completion omits output', () => {
  const h = setup();
  h.item({ type: 'commandExecution', id: 'c', command: 'echo ok', aggregatedOutput: null });
  h.send('item/commandExecution/outputDelta', { itemId: 'c', delta: 'ok\n' });
  h.item({ type: 'commandExecution', id: 'c', command: 'echo ok', aggregatedOutput: null, exitCode: 7, status: 'failed' }, true);
  assert.equal(h.live.filter(e => e.t === 'tool-start').length, 1);
  assert.deepEqual(h.live.filter(e => e.t === 'cmd').at(-1), { t: 'cmd', id: 'cx-c', command: 'echo ok', output: 'ok\n', done: true, exitCode: 7 });
  assert.equal(h.events.find(e => e.t === 'tool-result').isError, true);
});

test('long commands retain newest output in progress, final snapshots and tool results', () => {
  for (const snapshot of [null, 'snapshot-' + 's'.repeat(21000) + '-last']) {
    const h = setup();
    h.item({ type: 'commandExecution', id: 'c', command: 'build', aggregatedOutput: null });
    h.send('item/commandExecution/outputDelta', { itemId: 'c', delta: 'a'.repeat(20000) });
    h.send('item/commandExecution/outputDelta', { itemId: 'c', delta: 'latest failure' });
    const expected = ('a'.repeat(20000) + 'latest failure').slice(-20000);
    assert.equal(h.live.filter(e => e.t === 'cmd').at(-1).output, expected);
    h.item({ type: 'commandExecution', id: 'c', command: 'build', aggregatedOutput: snapshot, exitCode: 1, status: 'failed' }, true);
    const final = (snapshot || expected).slice(-20000);
    assert.equal(h.live.filter(e => e.t === 'cmd').at(-1).output, final);
    assert.equal(h.events.find(e => e.t === 'tool-result').output, final.slice(-6000));
    assert.equal(h.live.find(e => e.t === 'result').output, final);
  }
});

test('file changes expose unified diffs, secure replay, removed and moved paths', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-events-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'old');
  fs.writeFileSync(path.join(cwd, 'large'), Buffer.alloc(300001));
  const h = setup(cwd);
  const changes = [{ path: 'a.txt', kind: { type: 'update', move_path: 'b.txt' }, diff: '@@ -1 +1 @@\n-old\n+new' }, { path: 'gone', kind: { type: 'delete' }, diff: '-gone' }, { path: 'large', kind: { type: 'add' }, diff: '+big' }, { path: '../outside', kind: { type: 'add' }, diff: '+secret' }];
  h.item({ type: 'fileChange', id: 'f', changes, status: 'inProgress' });
  fs.renameSync(path.join(cwd, 'a.txt'), path.join(cwd, 'b.txt'));
  fs.writeFileSync(path.join(cwd, 'b.txt'), 'new');
  h.item({ type: 'fileChange', id: 'f', changes, status: 'completed' }, true);
  const replay = h.live.filter(e => e.t === 'code' && e.replay);
  assert.equal(replay.find(e => e.path === path.join(cwd, 'b.txt')).text, 'new');
  assert.equal(replay.find(e => e.path === path.join(cwd, 'b.txt')).old, 'old');
  assert.ok(!replay.some(e => e.path.endsWith('large') || e.path.endsWith('outside')));
  assert.ok(h.live.some(e => e.t === 'code' && e.text.includes('@@')));
  const paths = h.events.find(e => e.t === 'files').paths;
  assert.ok(paths.includes(path.join(cwd, 'gone')));
  assert.ok(paths.includes(path.join(cwd, 'a.txt')) && paths.includes(path.join(cwd, 'b.txt')));
});

test('turn completion honors status; retries and model warnings are nonfatal', () => {
  for (const [status, expected] of [['completed', 'done'], ['interrupted', 'stopped'], ['failed', 'error']]) {
    const h = setup();
    h.send('turn/started', { turn: { id: 'turn', status: 'inProgress' } });
    h.send('error', { error: { message: 'reconnecting' }, willRetry: true });
    h.send('model/rerouted', { fromModel: 'a', toModel: 'b', reason: 'fallback' });
    h.send('model/verification', { verifications: [] });
    h.send('warning', { message: 'warning' });
    assert.equal(h.events.filter(e => e.t === 'error').length, 0);
    h.send('turn/completed', { turn: { id: 'turn', status, error: status === 'failed' ? { message: 'bad' } : null } });
    assert.equal(h.completions[0].status, expected);
    assert.equal(h.turns[0].id, 'turn');
    assert.equal(h.events.some(e => e.t === 'error'), status === 'failed');
  }
});

test('usage uses last including cached tokens and rate limits forward unchanged', () => {
  const h = setup();
  h.send('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 9999 }, last: { inputTokens: 12, outputTokens: 5, cachedInputTokens: 8, reasoningOutputTokens: 2 } } });
  assert.equal(h.adapter.usage.input, 12);
  assert.equal(h.adapter.usage.output, 5);
  assert.equal(h.adapter.usage.cachedInput, 8);
  assert.deepEqual(h.usages[0], h.adapter.usage);
  const limits = { primary: { usedPercent: 20 } };
  h.send('account/rateLimits/updated', { rateLimits: limits });
  assert.deepEqual(h.rates, [limits]);
});

test('tools, plans, subagents, compaction and patch notifications map to reducer events', () => {
  const h = setup();
  const items = [
    { type: 'mcpToolCall', id: 'm', server: 's', tool: 'fetch', arguments: {}, status: 'failed', error: { message: 'oops' } },
    { type: 'dynamicToolCall', id: 'd', tool: 'custom', success: false, contentItems: [{ type: 'inputText', text: 'bad' }] },
    { type: 'webSearch', id: 'w', query: 'weather', results: [{ title: 'result' }] },
    { type: 'collabAgentToolCall', id: 'a', tool: 'spawnAgent', receiverThreadIds: ['child'], agentsStates: { child: { status: 'completed' } } },
    { type: 'subAgentActivity', id: 's', kind: 'started', agentThreadId: 'child', agentPath: 'root/child' },
    { type: 'contextCompaction', id: 'x' }
  ];
  for (const item of items) { h.item(item); h.item(item, true); }
  h.send('turn/plan/updated', { explanation: 'next', plan: [{ step: 'Ship', status: 'inProgress' }] });
  h.send('item/plan/delta', { itemId: 'p', delta: 'Plan text' });
  h.send('item/fileChange/patchUpdated', { itemId: 'f', changes: [] });
  assert.equal(h.events.filter(e => e.t === 'tool-result').length, items.length);
  assert.equal(h.events.find(e => e.t === 'tool-result' && e.id === 'cx-d').isError, true);
  assert.ok(h.events.some(e => e.t === 'tool' && e.detail.includes('Ship')));
  const count = h.events.length;
  assert.equal(h.send('unknown/new', {}), false);
  assert.equal(h.events.length, count);
});

test('file replay rejects junction escapes and reads exact size boundary', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-outside-'));
  t.after(() => { fs.rmSync(cwd, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(outside, 'secret'), 'private');
  fs.symlinkSync(outside, path.join(cwd, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(cwd, 'boundary'), Buffer.alloc(300000, 'x'));
  const h = setup(cwd);
  h.item({ type: 'fileChange', id: 'f', status: 'completed', changes: [
    { path: 'escape/secret', kind: { type: 'update', move_path: null }, diff: '+private' },
    { path: 'boundary', kind: { type: 'add' }, diff: '+x' }
  ] }, true);
  assert.ok(!h.live.some(e => e.path?.includes('escape')));
  assert.equal(h.live.find(e => e.replay).text.length, 300000);
  assert.deepEqual(h.events.find(e => e.t === 'files').paths, [path.join(cwd, 'boundary')]);
});

test('completion is idempotent, in-progress completion ignored and usage resets on next turn', () => {
  const h = setup();
  h.send('thread/tokenUsage/updated', { tokenUsage: { last: { inputTokens: 10 } } });
  h.send('turn/completed', { turn: { id: 'turn', status: 'inProgress' } });
  assert.equal(h.completions.length, 0);
  h.send('error', { willRetry: false, error: { message: 'fatal' } });
  h.send('turn/completed', { turn: { id: 'turn', status: 'failed', error: { message: 'fatal' } } });
  h.send('turn/completed', { turn: { id: 'turn', status: 'failed', error: { message: 'fatal' } } });
  assert.equal(h.completions.length, 1);
  assert.equal(h.completions[0].usage.input, 10);
  assert.equal(h.events.filter(e => e.t === 'error').length, 1);
  h.send('turn/started', { turn: { id: 'next', status: 'inProgress' } });
  assert.equal(h.adapter.usage, null);
});
