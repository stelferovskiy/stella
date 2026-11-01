// Offline app-server peer for provider lifecycle tests. No SDK or network access.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.codex-fixture.json'), 'utf8'));
const pending = new Map();
let requestId = 1000, threadId, turnId = 'fixture-turn', threadParams, threadMethod, turnParams, initialize;
let startupAnswers;
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const notify = (method, params) => send({ method, params: { threadId, turnId, ...params } });
const reply = (id, result) => send({ id, result });
const ask = (method, params) => new Promise(resolve => {
  const id = ++requestId;
  pending.set(id, resolve);
  send({ id, method, params: { threadId, turnId, itemId: 'interactive', ...params } });
});
function complete(status = 'completed', error = null) {
  notify('turn/completed', { turn: { id: turnId, status, items: [], error } });
}
async function execute() {
  notify('turn/started', { turn: { id: turnId, status: 'inProgress', items: [], error: null } });
  if (config.scenario === 'exit-active') {
    process.stderr.write('fixture unexpected exit', () => process.exit(23));
    return;
  }
  if (config.scenario === 'interrupted') { complete('interrupted'); return; }
  if (config.scenario === 'failed') {
    notify('error', { error: { message: 'fixture fatal error' }, willRetry: false });
    complete('failed', { message: 'fixture fatal error' });
    return;
  }
  if (config.scenario === 'hang-active') {
    notify('warning', { message: 'fixture ready to abort' });
    return;
  }
  if (config.scenario === 'warnings') {
    notify('warning', { message: 'fixture harmless warning' });
    notify('configWarning', { summary: 'fixture config warning', details: null });
    notify('model/rerouted', { fromModel: 'old', toModel: 'new', reason: 'fallback' });
    notify('model/verification', { verifications: [] });
    notify('error', { error: { message: 'fixture retrying' }, willRetry: true });
  }
  const answers = {};
  if (startupAnswers) answers.startup = await startupAnswers;
  if (config.scenario === 'interactive' || config.scenario === 'defaults') {
    answers.command = await ask('item/commandExecution/requestApproval', { command: 'echo fixture', reason: 'test command' });
    answers.file = await ask('item/fileChange/requestApproval', { grantRoot: process.cwd(), reason: 'test file' });
    answers.permissions = await ask('item/permissions/requestApproval', { permissions: { network: { enabled: true }, fileSystem: null } });
    answers.input = await ask('item/tool/requestUserInput', { questions: [{ id: 'q', header: 'Choice', question: 'Which value?', isOther: true, isSecret: false, options: [{ label: 'One', description: 'First' }] }] });
    answers.unknown = await ask('fixture/unknownRequest', {});
  }
  if (config.scenario === 'hang-callback') {
    await ask('item/commandExecution/requestApproval', { command: 'never resolve' });
    return;
  }
  // A wrong-thread notification must never reach Stella's renderer/reducer.
  notify('item/agentMessage/delta', { threadId: 'unrelated-thread', itemId: 'foreign', delta: 'DO NOT DISPLAY' });
  const report = { marker: 'Привет 🌟', threadMethod, threadParams, turnParams, answers, initialize, argv: process.argv.slice(2), cwd: process.cwd() };
  const text = 'fixture:' + JSON.stringify(report);
  notify('item/started', { item: { type: 'agentMessage', id: 'answer', text: '' } });
  notify('item/agentMessage/delta', { itemId: 'answer', delta: text.slice(0, 19) });
  notify('item/agentMessage/delta', { itemId: 'answer', delta: text.slice(19) });
  // Empty final messages are seen on real server versions; preserve the deltas.
  notify('item/completed', { item: { type: 'agentMessage', id: 'answer', text: '' } });
  notify('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 9000, outputTokens: 8000 }, last: { inputTokens: 17, outputTokens: 4, cachedInputTokens: 9, reasoningOutputTokens: 2 }, modelContextWindow: 100000 } });
  notify('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 123456 } } });
  complete();
}
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  const m = JSON.parse(line);
  if (!m.method) {
    const resolve = pending.get(m.id);
    if (resolve) { pending.delete(m.id); resolve(m.error ? { error: m.error } : m.result); }
    return;
  }
  if (m.method === config.hangRequest) {
    notify('warning', { message: 'fixture ready to abort' });
    return;
  }
  switch (m.method) {
    case 'initialize': initialize = m.params; reply(m.id, { userAgent: 'stella-offline-fixture' }); break;
    case 'initialized': break;
    case 'thread/start': case 'thread/resume':
      threadMethod = m.method; threadParams = m.params;
      threadId = m.params.threadId || 'fixture-thread';
      if (config.scenario === 'startup-batch') {
        const correctId = ++requestId, foreignId = ++requestId;
        const correct = new Promise(resolve => pending.set(correctId, resolve));
        const foreign = new Promise(resolve => pending.set(foreignId, resolve));
        startupAnswers = Promise.all([correct, foreign]).then(([approval, rejected]) => ({ approval, rejected }));
        // A single write makes response + notifications + requests share a wire
        // batch, exposing promise-continuation vs synchronous parser ordering.
        const delta = text => ({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'startup-order', delta: text } });
        const approval = (id, target) => ({ id, method: 'item/commandExecution/requestApproval', params: { threadId: target, turnId, itemId: 'startup-command', command: 'echo startup approval', reason: 'startup batch' } });
        process.stdout.write([
          { id: m.id, result: { thread: { id: threadId } } },
          delta('before'), approval(correctId, threadId), delta('after'),
          approval(foreignId, 'unrelated-thread')
        ].map(value => JSON.stringify(value) + '\n').join(''));
        break;
      }
      reply(m.id, { thread: { id: threadId } }); break;
    case 'turn/start':
      turnParams = m.params;
      if (config.scenario === 'exit-request') { process.stderr.write('fixture exit during request', () => process.exit(24)); break; }
      reply(m.id, { turn: { id: turnId, status: 'inProgress', items: [], error: null } });
      execute().catch(error => { process.stderr.write(error.stack); process.exitCode = 1; lines.close(); });
      break;
    case 'turn/interrupt':
      if (config.ignoreInterrupt) break;
      if (m.params.threadId !== threadId || m.params.turnId !== turnId) {
        reply(m.id, {});
        complete('failed', { message: 'Fixture received incorrect interrupt target' });
        break;
      }
      reply(m.id, {}); complete('interrupted'); break;
    default: send({ id: m.id, error: { code: -32601, message: 'Unknown fixture method: ' + m.method } });
  }
});
lines.on('close', () => process.exit(0));
