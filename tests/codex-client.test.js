const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { CodexClient } = require('../src/main/providers/codex-client');
const fixture = path.join(__dirname, 'fixtures/codex-server.cjs');
const create = () => new CodexClient({ command: process.execPath, args: [fixture], timeout: 500 });

test('handshake, interleaved RPC responses and split UTF-8 are lossless', async () => {
  const client = create();
  try { await client.start(); const results = await Promise.all([client.request('echo', { text: 'Привет 🌟' }), client.request('echo', { value: 2 })]); assert.deepEqual(results, [{ text: 'Привет 🌟' }, { value: 2 }]); }
  finally { await client.close(); }
});
test('server requests can be answered without blocking notification delivery', async () => {
  const client = create();
  try { await client.start(); client.on('request', (m) => client.respond(m.id, { answers: {} })); const notice = once(client, 'notification'); await client.request('ask', {}); const [m] = await notice; assert.equal(m.method, 'answered'); assert.deepEqual(m.params, { answers: {} }); }
  finally { await client.close(); }
});
test('RPC errors and unexpected process exits reject pending requests', async () => {
  const client = create();
  try { await client.start(); await assert.rejects(client.request('rpcError', {}), /Invalid model/); await assert.rejects(client.request('crash', {}), /7|заверш/i); }
  finally { await client.close(); }
});
test('timeout cleans up pending requests', async () => {
  const client = create();
  try { await client.start(); await assert.rejects(client.request('never', {}), /timeout|время/i); assert.equal(client.pending.size, 0); }
  finally { await client.close(); }
});
