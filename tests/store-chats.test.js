const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../src/main/store');

function withStore(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stella-chats-'));
  try { return fn(root, path.join(root, 'data')); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('a chat deleted while its run is finishing does not come back', () => withStore((root, dir) => {
  const store = createStore(root);
  const chat = store.createChat({ agent: 'claude', cwd: root });
  const attachments = path.join(dir, 'attachments', chat.id);
  fs.mkdirSync(attachments, { recursive: true });
  fs.writeFileSync(path.join(attachments, 'pasted.png'), 'x');
  store.deleteChat(chat.id);
  // the run still holds the chat object and saves it when it ends
  assert.equal(store.saveChat(chat), null);
  assert.deepEqual(store.listChats(), []);
  assert.ok(!fs.existsSync(path.join(dir, 'chats', chat.id + '.json')));
  assert.ok(!fs.existsSync(attachments));
  assert.deepEqual(createStore(root).listChats(), []);
}));

test('ids that are not chat ids never reach the file system', () => withStore((root, dir) => {
  const store = createStore(root);
  fs.writeFileSync(path.join(dir, 'secret.json'), JSON.stringify({ id: 'x', messages: [] }));
  for (const id of ['../secret', '..\\secret', '', null, undefined, 42, { id: 1 }]) {
    assert.equal(store.getChat(id), null);
    store.deleteChat(id);
  }
  assert.ok(fs.existsSync(path.join(dir, 'secret.json')));
}));

test('a lost or broken chat list is rebuilt from the chats themselves', () => withStore((root, dir) => {
  const first = createStore(root);
  const a = first.createChat({ agent: 'claude', cwd: root, title: 'One' });
  const b = first.createChat({ agent: 'codex', cwd: root, title: 'Two' });
  fs.writeFileSync(path.join(dir, 'chats.json'), '{ broken');
  assert.deepEqual(createStore(root).listChats().map((c) => c.title).sort(), ['One', 'Two']);
  fs.rmSync(path.join(dir, 'chats.json'));
  const again = createStore(root);
  assert.deepEqual(again.listChats().map((c) => c.id).sort(), [a.id, b.id].sort());
  assert.equal(again.getChat(a.id).title, 'One');
}));

test('unreadable settings are kept aside, and broken usage or tasks files do not stop the app', () => withStore((root, dir) => {
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'settings.json'), '{"hotkey": "Alt+S", ');
  fs.writeFileSync(path.join(dir, 'usage.json'), '[]');
  fs.writeFileSync(path.join(dir, 'tasks.json'), '{}');
  const store = createStore(root);
  assert.equal(store.getSettings().hotkey, 'Control+Shift+Space');
  const kept = fs.readdirSync(dir).filter((n) => n.startsWith('settings.json.broken-'));
  assert.equal(kept.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, kept[0]), 'utf8'), '{"hotkey": "Alt+S", ');
  store.addUsage('claude', { input: 1, output: 2, cost: 0 });
  assert.equal(store.getUsage().week.claude.runs, 1);
  assert.deepEqual(store.getTasks(), []);
}));
