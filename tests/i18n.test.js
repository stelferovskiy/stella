const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranslator } = require('../src/shared/i18n-core');

test('locale files are complete, consistent and every UI string goes through them', () => {
  delete require.cache[require.resolve('../tools/i18n-scan')];
  const { problems } = require('../tools/i18n-scan');
  assert.deepEqual(problems.map((p) => p.where + ' [' + p.kind + '] ' + p.value), []);
});

test('translator formats placeholders, picks plural forms and falls back to Russian, then the key', () => {
  let lang = 'ru';
  const L = createTranslator({
    ru: { hi: 'Привет, {name}', files: { one: '{n} файл', few: '{n} файла', many: '{n} файлов', other: '{n} файла' }, onlyRu: 'Только' },
    en: { hi: 'Hi, {name}', files: { one: '{n} file', other: '{n} files' } }
  }, () => lang);
  assert.equal(L('hi', { name: 'Ann' }), 'Привет, Ann');
  assert.deepEqual([1, 3, 5, 21].map((n) => L('files', { n })), ['1 файл', '3 файла', '5 файлов', '21 файл']);
  lang = 'en';
  assert.equal(L('hi', { name: 'Ann' }), 'Hi, Ann');
  assert.deepEqual([1, 2].map((n) => L('files', { n })), ['1 file', '2 files']);
  assert.equal(L('onlyRu'), 'Только');
  assert.equal(L('missing.key'), 'missing.key');
  assert.equal(L('hi'), 'Hi, {name}');
  assert.equal(L.has('hi'), true); assert.equal(L.has('nope'), false);
});

test('main process follows the language setting', () => {
  const i18n = require('../src/main/i18n');
  let language = 'en';
  i18n.configure({ getSettings: () => ({ language }), systemLocale: 'ru-RU' });
  try {
    assert.equal(i18n.L('chat.new'), 'New chat');
    language = 'ru'; assert.equal(i18n.L('chat.new'), 'Новый чат');
    language = undefined; assert.equal(i18n.lang(), 'ru');
  } finally { i18n.configure({ getSettings: () => ({ language: 'ru' }) }); }
});
