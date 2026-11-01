const { test } = require('node:test');
const assert = require('node:assert/strict');
const codex = require('../src/main/providers/codex');
test('each mode maps to explicit sandbox and review policy, ChatGPT can edit its project', () => {
  assert.deepEqual(codex.policyFor('read-only', 'C:/project'), { approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly', networkAccess: false } });
  assert.equal(codex.policyFor('workspace-write', 'C:/project').sandboxPolicy.type, 'workspaceWrite');
  assert.equal(codex.policyFor('danger-full-access', 'C:/project').approvalPolicy, 'never');
  assert.throws(() => codex.policyFor('typo', 'C:/project'), /режим/i);
});
test('command approval answers are mapped without implicitly escalating', async () => {
  const request = { method: 'item/commandExecution/requestApproval', params: { command: 'npm test' } };
  assert.deepEqual(await codex.handleServerRequest(request, { requestApproval: async () => 'always' }), { decision: 'acceptForSession' });
  assert.deepEqual(await codex.handleServerRequest(request, { requestApproval: async () => 'deny' }), { decision: 'decline' });
  assert.deepEqual(await codex.handleServerRequest(request, {}), { decision: 'decline' });
});
test('permission approval returns only requested permission groups', async () => {
  const request = { method: 'item/permissions/requestApproval', params: { permissions: { network: { enabled: true }, fileSystem: null } } };
  assert.deepEqual(await codex.handleServerRequest(request, { requestApproval: async () => 'allow' }), { permissions: { network: { enabled: true } }, scope: 'turn' });
  assert.deepEqual(await codex.handleServerRequest(request, { requestApproval: async () => 'deny' }), { permissions: {}, scope: 'turn' });
});
test('user input forwards questions and answers verbatim; unknown calls fail explicitly', async () => {
  const answers = { q: { answers: ['Some text'] } };
  assert.deepEqual(await codex.handleServerRequest({ method: 'item/tool/requestUserInput', params: { questions: [{ id: 'q', question: 'Name?' }] } }, { requestUserInput: async ({ questions }) => { assert.equal(questions[0].id, 'q'); return answers; } }), { answers });
  await assert.rejects(codex.handleServerRequest({ method: 'unknown/tool', params: {} }, {}), /не поддерживается/i);
});

for (const [name, property] of [
  ['titled enum', { type: 'string', oneOf: [{ const: 'a', title: 'Option A' }] }],
  ['multi-select array', { type: 'array', items: { type: 'string', enum: ['a', 'b'] } }]
]) {
  test('MCP unsupported ' + name + ' form declines before requesting UI input', async () => {
    let asked = 0;
    const result = await codex.handleServerRequest({ method: 'mcpServer/elicitation/request', params: {
      mode: 'form', serverName: 'fixture', message: 'Select',
      requestedSchema: { type: 'object', properties: { choice: property }, required: ['choice'] }
    } }, { requestUserInput: async () => { asked++; return { choice: { answers: ['a'] } }; } });
    assert.equal(asked, 0, 'unsupported schema must be rejected before displaying a misleading form');
    assert.deepEqual(result, { action: 'decline', content: null, _meta: null });
  });
}

test('MCP optional primitive fields left empty are omitted without coercing defaults', async () => {
  let asked = 0;
  const result = await codex.handleServerRequest({ method: 'mcpServer/elicitation/request', params: {
    mode: 'form', serverName: 'fixture', message: 'Optional details',
    requestedSchema: { type: 'object', properties: {
      name: { type: 'string' },
      count: { type: 'integer', default: 7 }, enabled: { type: 'boolean', default: true }, note: { type: 'string', default: 'fallback' }
    }, required: ['name'] }
  } }, { requestUserInput: async ({ questions }) => {
    asked++;
    assert.equal(questions.find(q => q.id === 'name').required, true);
    for (const id of ['count', 'enabled', 'note']) assert.equal(questions.find(q => q.id === id).required, false);
    return { name: { answers: ['Stella'] }, count: { answers: [''] }, enabled: { answers: [''] }, note: { answers: [''] } };
  } });
  assert.equal(asked, 1);
  assert.deepEqual(result, { action: 'accept', content: { name: 'Stella' }, _meta: null });
});
