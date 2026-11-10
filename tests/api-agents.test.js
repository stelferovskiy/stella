const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../src/main/store');
const { createMemory } = require('../src/main/memory');
const { createRunner } = require('../src/main/runner');
const openai = require('../src/main/providers/openai');
const chatExport = require('../src/main/chat-export');

// A streamed chat completion as the OpenAI-compatible APIs send it.
function sse(events) {
  const body = events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

function withTmp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stella-api-'));
  return Promise.resolve(fn(root)).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

test('DeepSeek: model picked from its list, thinking and answer streamed, key sent to its endpoint', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/models')) return json({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] });
    return sse([
      { choices: [{ delta: { reasoning_content: 'hmm' } }] },
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: '!' } }], usage: { prompt_tokens: 7, completion_tokens: 2 } }
    ]);
  });
  const events = [];
  const r = await openai.run({ chat: { messages: [] }, text: 'hi', settings: { deepseek: { model: '', effort: 'high' } }, apiKey: 'sk-ds', emit: (e) => events.push(e), abortController: new AbortController(), historyIndex: 0, provider: 'deepseek' });
  assert.equal(r.status, 'done');
  assert.deepEqual(r.usage, { input: 7, output: 2, cost: 0 });
  const post = calls.find((c) => c.url === 'https://api.deepseek.com/chat/completions');
  assert.ok(post, 'request goes to DeepSeek');
  assert.equal(post.init.headers.Authorization, 'Bearer sk-ds');
  const body = JSON.parse(post.init.body);
  assert.equal(body.model, 'deepseek-v4-pro');
  assert.equal(body.reasoning_effort, undefined, 'DeepSeek does not take reasoning_effort');
  assert.match(body.messages[0].content, /DeepSeek/);
  assert.equal(events.filter((e) => e.t === 'thinking').map((e) => e.text).join(''), 'hmm');
  assert.equal(events.filter((e) => e.t === 'text').map((e) => e.text).join(''), 'Hello!');
});

test('Gemini: chat models only, without the "models/" prefix; effort is passed on', async (t) => {
  let posted;
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (String(url).endsWith('/models')) return json({ data: [{ id: 'models/gemini-embedding-001' }, { id: 'models/gemini-3-pro' }, { id: 'models/gemini-3-flash' }, { id: 'models/gemini-3-flash-lite' }, { id: 'models/imagen-4' }] });
    posted = { url: String(url), body: JSON.parse(init.body) };
    return sse([{ choices: [{ delta: { content: 'ok' } }] }]);
  });
  assert.deepEqual(await openai.listModels('g-key', 'gemini'), ['gemini-3-flash', 'gemini-3-flash-lite', 'gemini-3-pro']);
  const r = await openai.run({ chat: { messages: [] }, text: 'hi', settings: { gemini: { model: '', effort: 'low' } }, apiKey: 'g-key-2', emit() {}, abortController: new AbortController(), historyIndex: 0, provider: 'gemini' });
  assert.equal(r.status, 'done');
  assert.equal(posted.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(posted.body.model, 'gemini-3-flash');
  assert.equal(posted.body.reasoning_effort, 'low');
});

test('out of balance or quota is reported as a limit, a bad key points to settings', async (t) => {
  for (const [status, limit, action] of [[402, true, null], [429, true, null], [401, false, 'settings']]) {
    t.mock.method(globalThis, 'fetch', async () => json({ error: { message: 'nope' } }, status));
    const events = [];
    const r = await openai.run({ chat: { messages: [] }, text: 'hi', settings: { deepseek: { model: 'deepseek-v4-pro' } }, apiKey: 'k', emit: (e) => events.push(e), abortController: new AbortController(), historyIndex: 0, provider: 'deepseek' });
    assert.equal(r.status, 'error');
    assert.equal(!!r.limitHit, limit, 'status ' + status);
    const err = events.find((e) => e.t === 'error');
    assert.match(err.text, /nope/);
    assert.equal(err.action, action);
    t.mock.restoreAll();
  }
  const events = [];
  const r = await openai.run({ chat: { messages: [] }, text: 'hi', settings: {}, apiKey: '', emit: (e) => events.push(e), abortController: new AbortController(), historyIndex: 0, provider: 'gemini' });
  assert.equal(r.status, 'error');
  assert.equal(events[0].action, 'settings');
});

test('handing a chat to another agent: the new agent gets the dialog, even with project memory off', (t) => withTmp(async (root) => {
  const store = createStore(root);
  store.saveSettings({ memoryEnabled: false });
  const memory = createMemory(root);
  const old = store.createChat({ agent: 'claude', cwd: root, title: 'Fix login' });
  old.messages.push(
    { id: 'u1', role: 'user', text: 'Fix the login form validation', time: 1 },
    { id: 'a1', role: 'assistant', agent: 'claude', status: 'error', time: 2, blocks: [
      { type: 'text', text: 'I updated validate.js, tests next.' },
      { type: 'tool', name: 'Edit', title: 'Edit validate.js', status: 'done' },
      { type: 'error', text: 'Claude AI usage limit reached' }
    ], files: [path.join(root, 'validate.js')] }
  );
  store.saveChat(old);
  const handoff = memory.transcript(old);
  assert.match(handoff, /Fix the login form validation/);
  assert.match(handoff, /I updated validate\.js/);
  assert.match(handoff, /Edit validate\.js/);
  assert.match(handoff, /usage limit/);

  const next = store.createChat({ agent: 'deepseek', cwd: root, title: '↪ Fix login' });
  next.handoff = handoff;
  store.saveChat(next);
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent = JSON.parse(init.body);
    return sse([{ choices: [{ delta: { content: 'Picking up from the tests.' } }] }]);
  });
  store.saveSettings({ deepseek: { model: 'deepseek-v4-pro', effort: '' } });
  const events = [];
  const runner = createRunner({ store, memory, notify() {}, getApiKey: (p) => (p === 'deepseek' ? 'sk' : ''), broadcast: (channel, payload) => events.push({ channel, payload }) });
  assert.equal(await runner.send(next.id, { text: 'Continue' }), 'done');
  const prompt = sent.messages[sent.messages.length - 1].content;
  assert.match(prompt, /Fix the login form validation/);
  assert.match(prompt, /Continue$/);
  // the context is for the model only, the chat shows what the user sent
  assert.equal(store.getChat(next.id).messages[0].text, 'Continue');
  assert.ok(!events.some((e) => e.channel === 'agent:live'), 'API agents do not watch project files');
}));

test('a reply that ran out of limits is marked so the chat offers a handoff', (t) => withTmp(async (root) => {
  const store = createStore(root);
  const chat = store.createChat({ agent: 'gemini', cwd: root });
  t.mock.method(globalThis, 'fetch', async () => json({ error: { message: 'quota' } }, 429));
  store.saveSettings({ gemini: { model: 'gemini-3-flash' } });
  const runner = createRunner({ store, memory: createMemory(root), notify() {}, getApiKey: () => 'k', broadcast() {} });
  assert.equal(await runner.send(chat.id, { text: 'hi' }), 'error');
  const reply = store.getChat(chat.id).messages[1];
  assert.equal(reply.limitHit, true);
}));

test('pin and archive keep the chat in its place in time; archiving unpins', () => withTmp((root) => {
  const store = createStore(root);
  const c = store.createChat({ agent: 'claude', cwd: root });
  const before = store.listChats()[0].updated;
  let s = store.markChat(c.id, { pinned: true });
  assert.equal(s.pinned, true);
  assert.equal(s.updated, before);
  s = store.markChat(c.id, { archived: true });
  assert.equal(s.archived, true);
  assert.equal(s.pinned, false);
  assert.equal(createStore(root).listChats()[0].archived, true);
  assert.equal(store.markChat('missing', { pinned: true }), null);
}));

test('search finds text inside messages and answers, best match first, with a snippet', () => withTmp((root) => {
  const store = createStore(root);
  const a = store.createChat({ agent: 'claude', cwd: root, title: 'Alpha' });
  a.messages.push({ id: '1', role: 'user', text: 'How do I configure the Webpack dev server?' }, { id: '2', role: 'assistant', blocks: [{ type: 'text', text: 'Set devServer.port in webpack.config.js. Webpack reloads it.' }] });
  store.saveChat(a);
  const b = store.createChat({ agent: 'codex', cwd: root, title: 'Beta' });
  b.messages.push({ id: '3', role: 'user', text: 'Mention webpack once' });
  store.saveChat(b);
  store.createChat({ agent: 'codex', cwd: root, title: 'Gamma' });
  const r = store.searchChats('WEBPACK');
  assert.deepEqual(r.map((x) => x.id), [a.id, b.id]);
  assert.equal(r[0].hits, 3);
  assert.match(r[0].snippet, /Webpack dev server/);
  assert.deepEqual(store.searchChats('w'), [], 'one letter is not searched');
  assert.deepEqual(store.searchChats('nothing like this'), []);
}));

test('export writes a readable Markdown document and a safe file name', () => {
  const chat = { title: 'Fix: login <form>?', agent: 'codex', cwd: 'C:\\p', created: 0, messages: [
    { role: 'user', text: 'line one\nline two', time: 0, attachments: [{ name: 'a.png', path: 'C:\\p\\a.png' }] },
    { role: 'assistant', agent: 'codex', time: 0, status: 'stopped', blocks: [{ type: 'text', text: 'Answer with ```code```' }, { type: 'tool', title: 'npm test', status: 'error' }, { type: 'error', text: 'boom ``` x' }] }
  ] };
  const md = chatExport.toMarkdown(chat, { locale: 'en' });
  assert.match(md, /^# Fix: login <form>\?/);
  assert.match(md, /> line one\n> line two/);
  assert.match(md, /📎 C:\\p\\a\.png/);
  assert.match(md, /## Codex/);
  assert.match(md, /- 🔧 npm test/);
  assert.match(md, /````\nboom ``` x\n````/, 'a fence longer than any backtick run inside');
  assert.equal(chatExport.fileName(chat), 'Fix login form.md');
  assert.equal(chatExport.fileName({ title: '↪ ...' }), 'chat.md');
});

test('a refused key while choosing the model points to settings, and a handoff chat keeps its title', (t) => withTmp(async (root) => {
  t.mock.method(globalThis, 'fetch', async () => json({ error: { message: 'bad key' } }, 401));
  const events = [];
  const r = await openai.run({ chat: { messages: [] }, text: 'hi', settings: { deepseek: { model: '' } }, apiKey: 'wrong', emit: (e) => events.push(e), abortController: new AbortController(), historyIndex: 0, provider: 'deepseek' });
  assert.equal(r.status, 'error');
  assert.equal(events[0].action, 'settings');
  assert.match(events[0].text, /401/);

  const store = createStore(root);
  const c = store.createChat({ agent: 'deepseek', cwd: root, title: '↪ Fix login' });
  c.handoff = 'dialog so far';
  store.saveChat(c);
  const runner = createRunner({ store, memory: createMemory(root), notify() {}, getApiKey: () => 'k', broadcast() {} });
  await runner.send(c.id, { text: 'You are continuing work started by Claude…' });
  assert.equal(store.getChat(c.id).title, '↪ Fix login');
}));

test('OpenRouter: free models first, image generators left out, a free DeepSeek picked on "auto"', async (t) => {
  let posted;
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (String(url).endsWith('/models')) return json({ data: [
      { id: 'anthropic/claude-x', pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { output_modalities: ['text'] } },
      { id: 'qwen/qwen3:free', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['text'] } },
      { id: 'deepseek/deepseek-v4-flash:free', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['text'] } },
      { id: 'google/image-maker', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['image'] } }
    ] });
    posted = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
    return sse([{ choices: [{ delta: { reasoning: 'let me see' } }] }, { choices: [{ delta: { content: 'Hi' } }] }]);
  });
  assert.deepEqual(await openai.listModels('or-key', 'openrouter'), ['deepseek/deepseek-v4-flash:free', 'qwen/qwen3:free', 'anthropic/claude-x']);
  const events = [];
  const r = await openai.run({ chat: { messages: [] }, text: 'hi', settings: { openrouter: { model: '', effort: 'high' } }, apiKey: 'or-key-2', emit: (e) => events.push(e), abortController: new AbortController(), historyIndex: 0, provider: 'openrouter' });
  assert.equal(r.status, 'done');
  assert.equal(posted.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(posted.body.model, 'deepseek/deepseek-v4-flash:free');
  assert.deepEqual(posted.body.reasoning, { effort: 'high' });
  assert.equal(posted.body.reasoning_effort, undefined);
  assert.equal(posted.headers['X-Title'], 'Stella');
  assert.equal(events.filter((e) => e.t === 'thinking').map((e) => e.text).join(''), 'let me see');
});

test('OpenRouter: a daily cap hit in the middle of the stream ends the reply as a limit', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => sse([{ choices: [{ delta: { content: 'Par' } }] }, { error: { code: 429, message: 'Rate limit exceeded: free-models-per-day' } }]));
  const events = [];
  const r = await openai.run({ chat: { messages: [] }, text: 'hi', settings: { openrouter: { model: 'qwen/qwen3:free' } }, apiKey: 'k', emit: (e) => events.push(e), abortController: new AbortController(), historyIndex: 0, provider: 'openrouter' });
  assert.equal(r.status, 'error');
  assert.equal(r.limitHit, true);
  assert.match(events.find((e) => e.t === 'error').text, /free-models-per-day/);
});
