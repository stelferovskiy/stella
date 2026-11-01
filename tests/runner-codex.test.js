const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRunner } = require('../src/main/runner');
const codex = require('../src/main/providers/codex');
test('ChatGPT forwards project, live events, approvals and input to Codex and expires stale requests', async (t) => {
  const chat = { id: 'c', agent: 'chatgpt', cwd: process.cwd(), title: 'test', messages: [] };
  const settings = { chatgpt: { backend: 'codex', sandbox: 'workspace-write' }, memoryEnabled: false };
  let runner; const events = [];
  const store = { dir: process.cwd(), getChat: () => chat, getSettings: () => settings, saveChat: () => ({}), addUsage() {}, getUsage: () => ({}), setLimit() {} };
  t.mock.method(codex, 'run', async (options) => {
    assert.equal(options.chat.cwd, chat.cwd);
    assert.equal(options.mode, 'workspace-write');
    assert.equal(typeof options.emitLive, 'function');
    const answers = await options.requestUserInput({ questions: [{ id: 'q', question: 'Name?', options: null }] });
    assert.deepEqual(answers, { q: { answers: ['Stella'] } });
    assert.equal(await options.requestApproval({ title: 'Command', detail: 'npm test' }), 'allow');
    options.emitLive({ t: 'cmd', command: 'npm test' });
    return { status: 'done' };
  });
  runner = createRunner({ store, getApiKey: () => '', notify() {}, broadcast(channel, payload) {
    events.push({ channel, payload });
    if (channel === 'chat:event' && payload.ev.t === 'user-input') queueMicrotask(() => { assert.equal(runner.answerInput('c', payload.ev.reqId, { q: { answers: ['Stella'] } }), true); assert.equal(runner.answerInput('c', payload.ev.reqId, {}), false); });
    if (channel === 'chat:event' && payload.ev.t === 'approval') queueMicrotask(() => runner.approve('c', payload.ev.reqId, 'allow'));
  } });
  assert.equal(await runner.send('c', { text: 'Hello' }), 'done');
  assert.ok(events.some((x) => x.channel === 'agent:live'));
  assert.equal(runner.isRunning('c'), false);
});
