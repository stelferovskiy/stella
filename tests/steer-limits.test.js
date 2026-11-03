const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRunner } = require('../src/main/runner');
const { createStore } = require('../src/main/store');
const reducer = require('../src/shared/reducer');
const codex = require('../src/main/providers/codex');

function fakeStore(chat, settings) {
  return { dir: os.tmpdir(), getChat: () => chat, getSettings: () => settings, saveChat: () => ({}), addUsage() {}, getUsage: () => ({}), setLimit() {} };
}

test('a message typed during a run joins the running turn and is kept in the reply', async (t) => {
  const chat = { id: 'c', agent: 'codex', cwd: process.cwd(), title: 't', messages: [] };
  const settings = { codex: { sandbox: 'read-only' }, memoryEnabled: false };
  let runner, steeredWith = null, release;
  t.mock.method(codex, 'run', async (o) => {
    o.registerSteer(async (text) => { steeredWith = text; return true; });
    await new Promise((r) => { release = r; });
    return { status: 'done' };
  });
  runner = createRunner({ store: fakeStore(chat, settings), getApiKey: () => '', notify() {}, broadcast() {} });
  const run = runner.send('c', { text: 'Build it' });
  await new Promise((r) => setImmediate(r));
  assert.equal(await runner.steer('c', { text: 'also add tests' }), 'steered');
  assert.equal(steeredWith, 'also add tests');
  release();
  assert.equal(await run, 'done');
  const reply = chat.messages[1];
  assert.deepEqual(reply.blocks.filter((b) => b.type === 'steer').map((b) => b.text), ['also add tests']);
});

test('a message the provider cannot take is sent right after the reply, and dropped on Stop', async (t) => {
  const chat = { id: 'c', agent: 'codex', cwd: process.cwd(), title: 't', messages: [] };
  const settings = { codex: { sandbox: 'read-only' }, memoryEnabled: false };
  const prompts = []; let release;
  t.mock.method(codex, 'run', async (o) => {
    prompts.push(o.text);
    o.registerSteer(async () => false);
    if (prompts.length === 1) await new Promise((r) => { release = r; });
    return { status: 'done' };
  });
  const toasts = [];
  const runner = createRunner({ store: fakeStore(chat, settings), getApiKey: () => '', notify() {}, broadcast(ch, p) { if (ch === 'toast') toasts.push(p); } });
  const run = runner.send('c', { text: 'first' });
  await new Promise((r) => setImmediate(r));
  assert.equal(await runner.steer('c', { text: 'second' }), 'queued');
  release();
  await run;
  for (let i = 0; i < 20 && prompts.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(prompts, ['first', 'second']);

  // Stop: the queued text is not sent.
  prompts.length = 0;
  const run2 = runner.send('c', { text: 'third' });
  await new Promise((r) => setImmediate(r));
  assert.equal(await runner.steer('c', { text: 'never' }), 'queued');
  runner.stop('c'); release();
  assert.equal(await run2, 'stopped');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(prompts, ['third']);
  assert.equal(toasts.length, 1);
});

test('steer block is a separate block so later text does not merge into it', () => {
  const msg = { blocks: [] };
  reducer.apply(msg, { t: 'text', text: 'Working' });
  reducer.apply(msg, { t: 'steer', text: 'faster please' });
  reducer.apply(msg, { t: 'text', text: 'OK' });
  assert.deepEqual(msg.blocks.map((b) => b.type), ['text', 'steer', 'text']);
});

test('limits are kept per account across switches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stella-limits-'));
  try {
    const store = createStore(dir);
    store.setLimit('claude', 'five_hour', { utilization: 0.3 });
    store.swapLimits('claude', 1, 2); // to a never-seen account: nothing to show yet
    assert.equal(store.getUsage().limits.claude, undefined);
    store.setLimit('claude', 'five_hour', { utilization: 0.9 });
    store.swapLimits('claude', 2, 1); // back: account 1 values return
    assert.equal(store.getUsage().limits.claude.five_hour.utilization, 0.3);
    store.swapLimits('claude', 1, 2);
    assert.equal(store.getUsage().limits.claude.five_hour.utilization, 0.9);
    // survives a restart
    assert.equal(createStore(dir).getUsage().limits.claude.five_hour.utilization, 0.9);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
