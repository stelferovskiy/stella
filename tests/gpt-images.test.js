const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createGptImages } = require('../src/main/gpt-images');
const { EventEmitter } = require('node:events');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5NsAAAAASUVORK5CYII=', 'base64');
class Client extends EventEmitter {
  async start() {}
  async close() { this.closed = true; }
  respond() {}
  reject() {}
  async request(method, p) {
    if (method === 'account/read') return { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
    if (method === 'modelProvider/capabilities/read') return { imageGeneration: true };
    if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: 12 } } };
    if (method === 'thread/start') { this.thread = p; return { thread: { id: 'image-thread' } }; }
    if (method === 'turn/start') {
      this.input = p;
      queueMicrotask(() => { this.emit('notification', { method: 'item/completed', params: { threadId: 'image-thread', item: { type: 'imageGeneration', id: 'img', status: 'completed', result: PNG.toString('base64'), revisedPrompt: 'star' } } }); this.emit('notification', { method: 'turn/completed', params: { threadId: 'image-thread', turn: { id: 'turn', status: 'completed' } } }); });
      return { turn: { id: 'turn' } };
    }
  }
}
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stella-gpt-images-test-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  const clients = [], notices = [];
  const store = { dir, getSettings: () => ({ codex: {}, chatgpt: {} }), addUsage() {}, setLimit() {}, getUsage: () => ({}) };
  const service = createGptImages({ store, broadcast: (c, e) => notices.push({ c, e }), clientFactory: () => { const c = new Client(); clients.push(c); return c; } });
  return { dir, clients, service, notices };
}
test('account generation saves native images, persists gallery, and never uses API keys', async (t) => {
  const h = setup(t); const item = await h.service.generate({ prompt: 'a star', size: 'square', transparent: true });
  assert.deepEqual(fs.readFileSync(item.file), PNG); assert.equal(item.prompt, 'a star');
  assert.equal(h.service.list().items.length, 1); assert.equal(h.service.status().active, false);
  const c = h.clients[0]; assert.equal(c.thread.sandbox, 'read-only'); assert.match(c.input.input[0].text, /square/i); assert.match(c.input.input[0].text, /transparent/i); assert.equal(c.closed, true);
  assert.equal(h.service.get(item.id).file, item.file); assert.throws(() => h.service.get('../settings'), /найден/i);
  h.service.remove(item.id); assert.equal(h.service.list().items.length, 0); assert.equal(fs.existsSync(item.file), false);
});
test('no image output is an error and text is never fabricated into a gallery image', async (t) => {
  const h = setup(t); const c = new Client(); c.request = async (m) => {
    if (m === 'account/read') return { account: { type: 'chatgpt' } };
    if (m === 'modelProvider/capabilities/read') return { imageGeneration: true };
    if (m === 'thread/start') return { thread: { id: 'image-thread' } };
    if (m === 'turn/start') { queueMicrotask(() => c.emit('notification', { method: 'turn/completed', params: { threadId: 'image-thread', turn: { id: 't', status: 'completed' } } })); return { turn: { id: 't' } }; }
  };
  const service = createGptImages({ store: { dir: h.dir, getSettings: () => ({}) }, clientFactory: () => c });
  await assert.rejects(service.generate({ prompt: 'star' }), /изображени/i); assert.equal(service.list().items.length, 0);
});
test('cancel interrupts a pending generation, prevents duplicate requests, and leaves gallery unchanged', async (t) => {
  const h = setup(t), c = new Client(); const original = c.request.bind(c);
  let started; const ready = new Promise((r) => { started = r; }); let interrupted = false;
  c.request = async (m, p) => {
    if (m === 'turn/start') { started(); return { turn: { id: 't' } }; }
    if (m === 'turn/interrupt') { interrupted = true; queueMicrotask(() => c.emit('notification', { method: 'turn/completed', params: { threadId: 'image-thread', turn: { id: 't', status: 'interrupted' } } })); return {}; }
    return original(m, p);
  };
  const service = createGptImages({ store: { dir: h.dir, getSettings: () => ({}) }, clientFactory: () => c });
  const generation = service.generate({ prompt: 'a star' }); const rejected = assert.rejects(generation, (e) => e.code === 'stopped');
  await ready; await assert.rejects(service.generate({ prompt: 'duplicate' }), (e) => e.code === 'busy');
  assert.equal(service.stop(), true); await rejected;
  assert.equal(interrupted, true); assert.equal(service.status().active, false); assert.equal(service.list().items.length, 0); assert.equal(service.stop(), false);
});
test('invalid image data never creates a file or gallery item', async (t) => {
  const h = setup(t), c = new Client(); const original = c.request.bind(c);
  c.request = async (m, p) => {
    if (m === 'turn/start') { queueMicrotask(() => {
      c.emit('notification', { method: 'item/completed', params: { item: { type: 'imageGeneration', status: 'completed', result: Buffer.from('not an image').toString('base64') } } });
      c.emit('notification', { method: 'turn/completed', params: { turn: { id: 't', status: 'completed' } } });
    }); return { turn: { id: 't' } }; }
    return original(m, p);
  };
  const service = createGptImages({ store: { dir: h.dir, getSettings: () => ({}) }, clientFactory: () => c });
  await assert.rejects(service.generate({ prompt: 'a star' }), (e) => e.code === 'invalid-image');
  assert.equal(service.list().items.length, 0); assert.deepEqual(fs.readdirSync(path.join(h.dir, 'gpt-images')), []);
});
