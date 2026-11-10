const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// These tests must never reach an installed Claude Code or Codex: they would change the real plugin
// setup. Point every place the CLIs are looked up in at an empty folder, then prove none is found.
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'stella-plugins-'));
for (const k of ['APPDATA', 'USERPROFILE', 'HOME']) process.env[k] = empty;
process.env.PATH = empty;
const { createPlugins } = require('../src/main/plugins');
const { L } = require('../src/main/i18n');
const store = { getSettings: () => ({ claude: {}, codex: {} }) };
assert.equal(require('../src/main/providers/claude').findClaudeExe(store.getSettings()), null);
assert.equal(require('../src/main/providers/codex').findCodexJs(store.getSettings()), null);
test.after(() => fs.rmSync(empty, { recursive: true, force: true }));

// With no CLI, a value that passes validation ends with the "not installed" error and a rejected
// one never gets that far.
const plugins = createPlugins({ store });
const REJECTED = [L('plugins.invalidSource'), L('plugins.invalidPlugin'), L('plugins.invalidMarketplace'), L('plugins.invalidName')];

test('plugin names and sources cannot be read as CLI options or carry shell characters', async () => {
  for (const arg of ['--help', '-x', 'a b', 'a|b', 'a`b', 'a^b', 'a{b}', 'a;b', '']) {
    assert.equal((await plugins.claudeAction('market-add', arg)).err, L('plugins.invalidSource'), 'source: ' + arg);
  }
  for (const arg of ['--scope', '-p', 'a b', 'a/b']) assert.equal((await plugins.claudeAction('install', arg)).err, L('plugins.invalidPlugin'), 'plugin: ' + arg);
  assert.equal((await plugins.claudeAction('market-remove', '--all')).err, L('plugins.invalidMarketplace'));
  assert.equal((await plugins.codexAction('remove', { name: '--help' })).err, L('plugins.invalidName'));
});

test('ordinary names and sources still pass validation', async () => {
  for (const arg of ['owner/repo', 'https://github.com/owner/repo.git', 'C:\\Users\\me\\market', '~/market', 'git@github.com:owner/repo-name.git']) {
    assert.ok(!REJECTED.includes((await plugins.claudeAction('market-add', arg)).err), arg);
  }
  assert.ok(!REJECTED.includes((await plugins.claudeAction('install', 'my-plugin@market.place')).err));
});
