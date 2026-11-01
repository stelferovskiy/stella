const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createTranslator } = require('../src/shared/i18n-core');
const dicts = { ru: require('../src/locales/ru.json'), en: require('../src/locales/en.json') };
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/gpt-images.js'), 'utf8');
class Element {
  constructor() { this.children = []; this.listeners = {}; this.value = ''; this.hidden = false; this.classList = { add() {}, toggle() {} }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  focus() {}
  async fire(name) { for (const fn of this.listeners[name] || []) await fn({ preventDefault() {} }); }
}
function harness(overrides = {}, lang = 'en') {
  const elements = new Map(); const el = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  let progress, subscriptions = 0, opens = 0;
  const api = { gptImagesList: async () => ({ items: [], capabilities: { imageGeneration: true }, account: { loggedIn: true } }), gptImagesStatus: async () => ({ active: false }), onGptImagesProgress: (fn) => { progress = fn; subscriptions++; }, ...overrides };
  const window = { I18N: { lang }, L: createTranslator(dicts, () => lang), StellaApp: { api, S: { env: { codexJs: 'codex.js' } }, fileUrl: (p) => 'file:///' + p, openGptImages: () => opens++, runAction() {} } };
  vm.runInNewContext(source, { window, document: { readyState: 'complete', getElementById: el, createElement: () => new Element() }, setTimeout });
  return { el, window, progress: (p) => progress(p), get subscriptions() { return subscriptions; }, get opens() { return opens; } };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
test('reopening preserves prompt and binds one progress and submit listener', async () => {
  const h = harness(); h.window.StellaGptImages.open(); await flush();
  h.el('gptImagesPrompt').value = 'Keep this idea'; h.window.StellaGptImages.open(); await flush();
  assert.equal(h.el('gptImagesPrompt').value, 'Keep this idea'); assert.equal(h.subscriptions, 1); assert.equal(h.el('gptImagesForm').listeners.submit.length, 1); assert.equal(h.opens, 2);
  assert.match(h.el('gptImagesDescription').textContent, /shared with chats/);
});
test('generation forwards only dedicated options, displays progress and saved card', async () => {
  let resolve, params;
  const h = harness({ gptImagesGenerate: (p) => { params = p; return new Promise((r) => resolve = r); } });
  h.el('gptImagesPrompt').value = 'A forest'; h.el('gptImagesSize').value = 'landscape'; h.el('gptImagesTransparent').checked = true;
  const job = h.el('gptImagesForm').fire('submit');
  assert.equal(JSON.stringify(params), JSON.stringify({ prompt: 'A forest', size: 'landscape', transparent: true }));
  assert.equal(h.el('gptImagesGenerate').disabled, true);
  h.progress({ requestId: 'one', stage: 'generating' }); assert.match(h.el('gptImagesStatus').textContent, /Generating/);
  h.progress({ requestId: 'different', stage: 'error', message: 'ignore me' }); assert.notEqual(h.el('gptImagesError').textContent, 'ignore me');
  resolve({ ok: true, item: { id: 'image', file: 'local.png', prompt: 'A forest', time: Date.now() } }); await job;
  assert.equal(h.el('gptImagesGenerate').disabled, false); assert.equal(h.el('gptImagesGallery').children.length, 1); assert.equal(h.el('gptImagesPrompt').value, 'A forest');
});
test('stop prevents resubmission until backend settles and exposes login errors', async () => {
  let resolve, calls = 0;
  const h = harness({ gptImagesGenerate: () => { calls++; return new Promise((r) => resolve = r); }, gptImagesStop: async () => true });
  h.el('gptImagesPrompt').value = 'An idea'; const job = h.el('gptImagesForm').fire('submit'); await h.el('gptImagesStop').fire('click'); await h.el('gptImagesForm').fire('submit');
  assert.equal(calls, 1); assert.equal(h.el('gptImagesGenerate').disabled, true); resolve({ ok: false, code: 'stopped' }); await job; assert.equal(h.el('gptImagesGenerate').disabled, false);
  const login = harness({ gptImagesGenerate: async () => ({ ok: false, code: 'login-codex', error: 'Login required' }) }); login.el('gptImagesPrompt').value = 'Idea'; await login.el('gptImagesForm').fire('submit');
  assert.equal(login.el('gptImagesError').textContent, 'Login required'); assert.equal(login.el('gptImagesSetup').hidden, false);
});
test('Russian setup handles logged-out account and unavailable capability without inference', async () => {
  const h = harness({ gptImagesList: async () => ({ items: [], account: { loggedIn: false }, capabilities: { imageGeneration: false } }) }, 'ru');
  h.window.StellaGptImages.open(); await flush(); assert.match(h.el('gptImagesSetup').children[0].textContent, /Войдите/); assert.equal(h.el('gptImagesSetup').hidden, false);
});
test('gallery actions use local file open/reveal, native save and delete APIs', async () => {
  const calls = [];
  const h = harness({ gptImagesList: async () => ({ items: [{ id: 'local', file: 'C:/images/a.png', prompt: '<unsafe>', time: 1700000000000 }] }), openFile: async (p) => calls.push(['open', p]), revealFile: async (p) => calls.push(['reveal', p]), gptImagesSave: async (id) => { calls.push(['save', id]); return { ok: false, canceled: true }; }, gptImagesDelete: async (id) => { calls.push(['delete', id]); return { items: [] }; } });
  h.window.StellaGptImages.open(); await flush();
  const card = h.el('gptImagesGallery').children[0]; const caption = card.children[1];
  assert.equal(caption.children[0].textContent, '<unsafe>'); assert.ok(caption.children[1].textContent);
  for (const action of caption.children[2].children) await action.fire('click');
  assert.deepEqual(calls, [['open', 'C:/images/a.png'], ['reveal', 'C:/images/a.png'], ['save', 'local'], ['delete', 'local']]);
  assert.equal(h.el('gptImagesGallery').children[0].className, 'gallery-empty');
});
