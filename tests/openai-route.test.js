const test = require('node:test');
const assert = require('node:assert/strict');
const { choosePurpose } = require('../src/shared/openai-route');

test('clear image, project work and conversation requests choose their tools', () => {
  assert.equal(choosePurpose('Нарисуй картинку ночного города'), 'gpt-images');
  assert.equal(choosePurpose('Generate an image of a lighthouse'), 'gpt-images');
  assert.equal(choosePurpose('Исправь ошибку в файле app.js'), 'codex');
  assert.equal(choosePurpose('Refactor this repository and run tests'), 'codex');
  assert.equal(choosePurpose('Почему небо голубое?'), 'chatgpt');
  assert.equal(choosePurpose('Explain how promises work'), 'chatgpt');
});

test('unclear or conflicting requests wait for a user choice', () => {
  assert.equal(choosePurpose('Создай что-нибудь интересное'), null);
  assert.equal(choosePurpose('Нарисуй картинку и исправь код в app.js'), null);
  assert.equal(choosePurpose(''), null);
});
