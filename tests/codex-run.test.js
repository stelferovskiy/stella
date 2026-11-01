const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const provider = require('../src/main/providers/codex');
const reducer = require('../src/shared/reducer');
const fixture = path.join(__dirname, 'fixtures', 'codex-interactive.cjs');

function harness(t, config = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stella-run-'));
  fs.writeFileSync(path.join(cwd, '.codex-fixture.json'), JSON.stringify(config));
  // Windows can retain the child's cwd until its asynchronous close completes.
  t.after(() => fs.promises.rm(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }));
  const settings = { codex: { jsPath: fixture, model: 'fixture-codex', effort: 'high', sandbox: 'read-only' }, chatgpt: { model: 'fixture-chatgpt', effort: 'medium' } };
  // Fail closed before run if launch resolution ever selects a real binary.
  const spec = provider.launchSpec(settings);
  assert.equal(spec.command, process.execPath);
  assert.deepEqual(spec.args, [fixture, 'app-server', '--listen', 'stdio://']);
  const events = [], live = [], threads = [], limits = [];
  const abortController = new AbortController();
  t.after(() => abortController.abort());
  return {
    cwd, settings, events, live, threads, limits, abortController,
    run: (overrides = {}) => provider.run({ chat: { cwd }, text: 'Hello fixture', settings, emit: e => events.push(e), emitLive: e => live.push(e), onThread: id => threads.push(id), onLimit: value => limits.push(value), abortController, ...overrides })
  };
}
function report(h) {
  const msg = h.events.reduce(reducer.apply, { blocks: [] });
  const text = msg.blocks.find(b => b.type === 'text' && b.key === 'cx-answer')?.text;
  assert.ok(text?.startsWith('fixture:'), 'final accumulated agent text contains fixture report');
  assert.ok(!JSON.stringify(msg).includes('DO NOT DISPLAY'), 'wrong-thread notifications are filtered');
  return JSON.parse(text.slice('fixture:'.length));
}

test('actual run starts a thread, streams deltas, forwards limits and completes with last usage', { timeout: 10000 }, async t => {
  const h = harness(t);
  const result = await h.run();
  assert.equal(result.status, 'done');
  assert.equal(result.usage.input, 17);
  assert.equal(result.usage.output, 4);
  assert.equal(result.usage.cachedInput, 9);
  assert.deepEqual(h.threads, ['fixture-thread']);
  assert.equal(h.limits[0].primary.usedPercent, 25);
  assert.ok(h.events.filter(e => e.t === 'text-set').length >= 3);
  assert.ok(h.events.some(e => e.t === 'state' && e.s === 'streaming'));
  assert.ok(!h.events.some(e => e.t === 'error'));
  const r = report(h);
  assert.equal(r.threadMethod, 'thread/start');
  assert.equal(r.marker, 'Привет 🌟');
  assert.equal(r.initialize.capabilities.experimentalApi, true);
  assert.deepEqual(r.argv, ['app-server', '--listen', 'stdio://']);
  assert.equal(r.cwd, h.cwd);
  assert.equal(r.turnParams.threadId, 'fixture-thread');
});

test('actual run resumes the persisted thread with current model, effort and policy', { timeout: 10000 }, async t => {
  const h = harness(t);
  assert.equal((await h.run({ chat: { cwd: h.cwd, codexThread: 'persisted-thread' }, mode: 'workspace-write' })).status, 'done');
  const r = report(h);
  assert.equal(r.threadMethod, 'thread/resume');
  assert.equal(r.threadParams.threadId, 'persisted-thread');
  assert.deepEqual(h.threads, ['persisted-thread']);
  assert.equal(r.threadParams.model, 'fixture-codex');
  assert.equal(r.turnParams.effort, 'high');
  assert.equal(r.threadParams.sandbox, 'workspace-write');
  assert.deepEqual(r.turnParams.sandboxPolicy.writableRoots, [h.cwd]);
});

for (const resumed of [true, false]) {
  test('same-buffer ' + (resumed ? 'thread/resume' : 'thread/start') + ' response preserves approval and notification wire order', { timeout: 10000 }, async t => {
    const h = harness(t, { scenario: 'startup-batch' });
    const order = [], approvals = [];
    const chat = { cwd: h.cwd, ...(resumed ? { codexThread: 'persisted-thread' } : {}) };
    const result = await h.run({ chat,
      emit: event => {
        h.events.push(event);
        if (event.t === 'text-set' && event.key === 'cx-startup-order') order.push(event.text);
      },
      requestApproval: async value => { approvals.push(value); order.push('approval'); return 'allow'; }
    });
    assert.equal(result.status, 'done');
    const r = report(h);
    assert.equal(r.threadMethod, resumed ? 'thread/resume' : 'thread/start');
    assert.equal(approvals.length, 1, 'correct thread reaches UI, foreign thread does not');
    assert.equal(approvals[0].detail, 'echo startup approval');
    assert.equal(approvals[0].reason, 'startup batch');
    assert.ok(approvals[0].serverRequestId);
    assert.deepEqual(order, ['before', 'approval', 'beforeafter']);
    assert.deepEqual(r.answers.startup.approval, { decision: 'accept' });
    assert.equal(r.answers.startup.rejected.error.code, -32601);
    assert.ok(!h.events.some(event => event.t === 'error'));
  });
}

test('approval, permissions and user input roundtrip; unsupported server request receives RPC rejection', { timeout: 10000 }, async t => {
  const h = harness(t, { scenario: 'interactive' });
  const approvals = [], questions = [];
  const replies = ['always', 'deny', 'allow'];
  const result = await h.run({
    requestApproval: async value => { approvals.push(value); return replies.shift(); },
    requestUserInput: async value => { questions.push(value); return { q: { answers: ['custom answer'] } }; }
  });
  assert.equal(result.status, 'done');
  const r = report(h);
  assert.equal(approvals.length, 3);
  assert.equal(approvals[0].detail, 'echo fixture');
  assert.equal(approvals[0].reason, 'test command');
  assert.equal(approvals[1].detail, h.cwd);
  assert.equal(questions[0].questions[0].id, 'q');
  assert.equal(questions[0].questions[0].isOther, true);
  assert.deepEqual(r.answers.command, { decision: 'acceptForSession' });
  assert.deepEqual(r.answers.file, { decision: 'decline' });
  assert.deepEqual(r.answers.permissions, { permissions: { network: { enabled: true } }, scope: 'turn' });
  assert.deepEqual(r.answers.input, { answers: { q: { answers: ['custom answer'] } } });
  assert.equal(r.answers.unknown.error.code, -32601);
  assert.match(r.answers.unknown.error.message, /fixture\/unknownRequest/);
});

test('missing interactive callbacks deny approvals and return empty answers without hanging', { timeout: 10000 }, async t => {
  const h = harness(t, { scenario: 'defaults' });
  assert.equal((await h.run()).status, 'done');
  const r = report(h);
  assert.deepEqual(r.answers.command, { decision: 'decline' });
  assert.deepEqual(r.answers.file, { decision: 'decline' });
  assert.deepEqual(r.answers.permissions, { permissions: {}, scope: 'turn' });
  assert.deepEqual(r.answers.input, { answers: {} });
});

test('warnings, model metadata and retrying errors do not fail a completed run', { timeout: 10000 }, async t => {
  const h = harness(t, { scenario: 'warnings' });
  assert.equal((await h.run()).status, 'done');
  assert.ok(!h.events.some(e => e.t === 'error'));
  assert.ok(h.events.some(e => e.t === 'thinking-set' && e.text.includes('harmless warning')));
  report(h);
});

test('nonretry error followed by failed completion returns error and reports failure once', { timeout: 10000 }, async t => {
  const h = harness(t, { scenario: 'failed' });
  assert.equal((await h.run()).status, 'error');
  assert.deepEqual(h.events.filter(e => e.t === 'error').map(e => e.text), ['fixture fatal error']);
});

test('interrupted completion returns stopped without a fatal error', { timeout: 10000 }, async t => {
  const h = harness(t, { scenario: 'interrupted' });
  assert.equal((await h.run()).status, 'stopped');
  assert.ok(!h.events.some(e => e.t === 'error'));
});

for (const scenario of ['exit-active', 'exit-request']) {
  test('unexpected server exit returns error: ' + scenario, { timeout: 10000 }, async t => {
    const h = harness(t, { scenario });
    assert.equal((await h.run()).status, 'error');
    assert.ok(h.events.some(e => e.t === 'error' && /fixture.*exit|23|24/i.test(e.text)));
  });
}

for (const method of ['initialize', 'thread/start', 'turn/start']) {
  test('abort releases hung RPC request: ' + method, { timeout: 10000 }, async t => {
    const h = harness(t, { hangRequest: method });
    let ready = false;
    const result = await h.run({ emit: e => {
      h.events.push(e);
      if (e.text?.includes('fixture ready to abort')) { ready = true; h.abortController.abort(); }
    } });
    assert.equal(ready, true, 'abort occurs after fixture receives the hanging request');
    assert.equal(result.status, 'stopped');
    assert.ok(!h.events.some(e => e.t === 'error'));
  });
}

test('abort interrupts an active turn while its approval callback remains unanswered', { timeout: 10000 }, async t => {
  const h = harness(t, { scenario: 'hang-callback' });
  let asked = false;
  const result = await h.run({ requestApproval: () => {
    asked = true;
    h.abortController.abort();
    return new Promise(() => {});
  } });
  assert.equal(asked, true);
  assert.equal(result.status, 'stopped');
  assert.ok(!h.events.some(e => e.t === 'error'));
});

for (const ignoreInterrupt of [false, true]) {
  test('active turn abort returns stopped when server ' + (ignoreInterrupt ? 'ignores' : 'accepts') + ' interrupt', { timeout: 10000 }, async t => {
    const h = harness(t, { scenario: 'hang-active', ignoreInterrupt });
    let ready = false;
    const result = await h.run({ emit: e => {
      h.events.push(e);
      if (e.text?.includes('fixture ready to abort')) { ready = true; h.abortController.abort(); }
    } });
    assert.equal(ready, true);
    assert.equal(result.status, 'stopped');
    assert.ok(!h.events.some(e => e.t === 'error'));
  });
}

test('pre-aborted run returns stopped without launching the server', { timeout: 10000 }, async t => {
  const h = harness(t);
  h.abortController.abort();
  // An invalid executable would produce an error if run attempted to spawn.
  const result = await h.run({ settings: { codex: { jsPath: 'does-not-exist' } } });
  assert.equal(result.status, 'stopped');
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.threads, []);
});

test('ChatGPT sends local images and file references with its model and cwd write policy', { timeout: 10000 }, async t => {
  const h = harness(t);
  const image = path.join(h.cwd, 'image.png'), file = path.join(h.cwd, 'notes.txt');
  fs.writeFileSync(image, 'fixture image placeholder');
  fs.writeFileSync(file, 'fixture notes');
  const result = await h.run({ flavor: 'chatgpt', text: 'Inspect these', attachments: [{ kind: 'image', path: image }, { kind: 'file', path: file }] });
  assert.equal(result.status, 'done');
  const r = report(h);
  assert.equal(r.threadParams.model, 'fixture-chatgpt');
  assert.equal(r.turnParams.model, 'fixture-chatgpt');
  assert.equal(r.turnParams.effort, 'medium');
  assert.equal(r.threadParams.cwd, h.cwd);
  assert.equal(r.turnParams.cwd, h.cwd);
  assert.equal(r.threadParams.sandbox, 'workspace-write');
  assert.match(r.threadParams.developerInstructions, /conversational assistant/i);
  assert.equal(r.turnParams.approvalPolicy, 'on-request');
  assert.equal(r.turnParams.sandboxPolicy.type, 'workspaceWrite');
  assert.deepEqual(r.turnParams.sandboxPolicy.writableRoots, [h.cwd]);
  assert.equal(r.turnParams.sandboxPolicy.networkAccess, false);
  assert.deepEqual(r.turnParams.input[1], { type: 'localImage', path: image });
  assert.equal(r.turnParams.input[0].type, 'text');
  assert.ok(r.turnParams.input[0].text.includes(file));
  assert.ok(r.turnParams.input[0].text.startsWith('Inspect these'));
  assert.deepEqual(r.turnParams.input[0].text_elements, []);
});

test('ChatGPT honors an explicit read-only mode rather than its write default', { timeout: 10000 }, async t => {
  const h = harness(t);
  assert.equal((await h.run({ flavor: 'chatgpt', mode: 'read-only', text: '' })).status, 'done');
  const r = report(h);
  assert.equal(r.threadParams.sandbox, 'read-only');
  assert.deepEqual(r.turnParams.sandboxPolicy, { type: 'readOnly', networkAccess: false });
  assert.ok(r.turnParams.input[0].text.trim());
});
