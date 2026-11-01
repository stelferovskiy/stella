const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdater } = require('../src/main/updater');
test('a newer local build is not replaced by an older public release', async (t) => {
  let requests = 0;
  t.mock.method(global, 'fetch', async () => { requests++; return { ok: true, json: async () => ({ version: '1.6.0', file: 'Stella-Setup-1.6.0.exe', sha256: 'a'.repeat(64) }) }; });
  const updater = createUpdater({ app: { getVersion: () => '1.7.0' }, dialog: { showMessageBox: async () => ({ response: 0 }) }, getWindow: () => null, broadcast() {} });
  await updater.check({ silent: true });
  assert.equal(requests, 1); assert.equal(updater.readyInfo(), null);
});
