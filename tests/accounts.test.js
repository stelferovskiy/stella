const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stella-acc-'));
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-1');
process.env.CODEX_HOME = path.join(tmp, 'codex-1');
const accounts = require('../src/main/accounts');
accounts.configure({ baseDir: path.join(tmp, 'data') });

const write = (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data)); };
const s2 = (p) => ({ accounts: { [p]: { active: 2, ack: true } } });

test('slot 1 keeps the default environment, slot 2 gets its own folder', () => {
  assert.deepStrictEqual(accounts.envFor({}, 'claude'), {});
  const env = accounts.envFor(s2('claude'), 'claude');
  assert.strictEqual(env.CLAUDE_CONFIG_DIR, path.join(tmp, 'data', 'accounts', 'claude-2'));
  assert.ok(fs.existsSync(env.CLAUDE_CONFIG_DIR));
  assert.deepStrictEqual(Object.keys(accounts.envFor(s2('codex'), 'codex')), ['CODEX_HOME']);
  assert.deepStrictEqual(accounts.envFor(s2('codex'), 'codex', 1), {});
});

test('providerFor maps agents, API-backed ChatGPT has no account', () => {
  assert.strictEqual(accounts.providerFor('claude', {}), 'claude');
  assert.strictEqual(accounts.providerFor('chatgpt', { chatgpt: { backend: 'codex' } }), 'codex');
  assert.strictEqual(accounts.providerFor('chatgpt', { chatgpt: { backend: 'api' } }), null);
});

test('claudeInfo reads plan and paid status', () => {
  write(path.join(tmp, 'claude-1', '.credentials.json'), { claudeAiOauth: { accessToken: 'x', subscriptionType: 'max' } });
  write(path.join(tmp, 'claude-1', '.claude.json'), { oauthAccount: { emailAddress: 'a@b.c' } });
  assert.deepStrictEqual(accounts.claudeInfo(1), { slot: 1, signedIn: true, plan: 'max', paid: true, email: 'a@b.c' });
  write(path.join(tmp, 'data', 'accounts', 'claude-2', '.credentials.json'), { claudeAiOauth: { accessToken: 'y', subscriptionType: 'free' } });
  assert.strictEqual(accounts.claudeInfo(2).paid, false);
  assert.strictEqual(accounts.claudeToken(s2('claude')), 'y');
});

test('codexInfo requires a ChatGPT paid plan', async () => {
  assert.strictEqual((await accounts.codexInfo(1, async () => ({}))).signedIn, false);
  write(path.join(tmp, 'codex-1', 'auth.json'), {});
  assert.strictEqual((await accounts.codexInfo(1, async () => ({ account: { type: 'chatgpt', planType: 'plus', email: 'e' } }))).paid, true);
  assert.strictEqual((await accounts.codexInfo(1, async () => ({ account: { type: 'chatgpt', planType: 'free' } }))).paid, false);
  assert.strictEqual((await accounts.codexInfo(1, async () => { throw new Error('boom'); })).paid, false);
});

test('copySession copies Claude and Codex transcripts between slots', () => {
  write(path.join(tmp, 'claude-1', 'projects', 'C--proj', 'abc-123.jsonl'), 'line\n');
  assert.ok(accounts.copySession('claude', 'abc-123', 1, 2));
  assert.strictEqual(fs.readFileSync(path.join(tmp, 'data', 'accounts', 'claude-2', 'projects', 'C--proj', 'abc-123.jsonl'), 'utf8'), 'line\n');
  write(path.join(tmp, 'codex-1', 'sessions', '2026', '11', '01', 'rollout-2026-11-01T10-00-00-th-9.jsonl'), 'r\n');
  assert.ok(accounts.copySession('codex', 'th-9', 1, 2));
  assert.ok(fs.existsSync(path.join(tmp, 'data', 'accounts', 'codex-2', 'sessions', '2026', '11', '01', 'rollout-2026-11-01T10-00-00-th-9.jsonl')));
  assert.strictEqual(accounts.copySession('claude', 'missing', 1, 2), false);
  assert.strictEqual(accounts.copySession('claude', '../x', 1, 2), false);
  assert.ok(accounts.copySession('claude', 'abc-123', 2, 2));
});

test('isLimitText recognises usage-limit errors only', () => {
  assert.ok(accounts.isLimitText('Claude AI usage limit reached|1730000000'));
  assert.ok(accounts.isLimitText("You've hit your usage limit. Upgrade to Pro"));
  assert.ok(!accounts.isLimitText('Permission denied'));
});

test('plugins, settings and MCP are shared; removing slot 2 keeps slot 1 intact', () => {
  const c1 = path.join(tmp, 'claude-1'), c2 = path.join(tmp, 'data', 'accounts', 'claude-2');
  write(path.join(c1, 'plugins', 'installed_plugins.json'), '{"p":1}');
  write(path.join(c1, 'settings.json'), '{"enabledPlugins":{"a":true}}');
  write(path.join(c1, '.claude.json'), { oauthAccount: { emailAddress: 'a@b.c' }, mcpServers: { srv: { command: 'x' } }, projects: { 'C:/p': { mcpServers: { loc: { command: 'y' } }, allowedTools: ['Read'] } } });
  write(path.join(c2, '.claude.json'), { oauthAccount: { emailAddress: 'second@b.c' } });
  write(path.join(c2, 'skills', 'mine', 'SKILL.md'), 'only in slot 2');

  assert.ok(accounts.syncShared('claude', 1));
  // folders are linked: same content, and a slot-2-only skill moved into the shared folder
  assert.strictEqual(fs.readFileSync(path.join(c2, 'plugins', 'installed_plugins.json'), 'utf8'), '{"p":1}');
  assert.ok(fs.lstatSync(path.join(c2, 'plugins')).isSymbolicLink());
  assert.strictEqual(fs.readFileSync(path.join(c1, 'skills', 'mine', 'SKILL.md'), 'utf8'), 'only in slot 2');
  // files and MCP copied, account data untouched
  assert.strictEqual(fs.readFileSync(path.join(c2, 'settings.json'), 'utf8'), '{"enabledPlugins":{"a":true}}');
  const j2 = JSON.parse(fs.readFileSync(path.join(c2, '.claude.json'), 'utf8'));
  assert.strictEqual(j2.oauthAccount.emailAddress, 'second@b.c');
  assert.deepStrictEqual(j2.mcpServers, { srv: { command: 'x' } });
  assert.deepStrictEqual(j2.projects['C:/p'].mcpServers, { loc: { command: 'y' } });

  // a change made under slot 2 flows back to slot 1, including MCP removal
  write(path.join(c2, 'settings.json'), '{"enabledPlugins":{"b":true}}');
  const j = JSON.parse(fs.readFileSync(path.join(c2, '.claude.json'), 'utf8')); delete j.mcpServers; write(path.join(c2, '.claude.json'), j);
  accounts.syncShared('claude', 2);
  assert.strictEqual(fs.readFileSync(path.join(c1, 'settings.json'), 'utf8'), '{"enabledPlugins":{"b":true}}');
  const j1 = JSON.parse(fs.readFileSync(path.join(c1, '.claude.json'), 'utf8'));
  assert.strictEqual(j1.mcpServers, undefined);
  assert.strictEqual(j1.oauthAccount.emailAddress, 'a@b.c');
  assert.deepStrictEqual(j1.projects['C:/p'].allowedTools, ['Read']);

  assert.ok(accounts.removeSecond('claude'));
  assert.ok(!fs.existsSync(c2));
  assert.strictEqual(fs.readFileSync(path.join(c1, 'plugins', 'installed_plugins.json'), 'utf8'), '{"p":1}');
  assert.ok(fs.existsSync(path.join(c1, 'skills', 'mine', 'SKILL.md')));
});

test('codex shares config.toml and skills', () => {
  const h1 = path.join(tmp, 'codex-1'), h2 = path.join(tmp, 'data', 'accounts', 'codex-2');
  write(path.join(h1, 'config.toml'), '[mcp_servers.x]\ncommand = "x"\n');
  write(path.join(h1, 'skills', 's', 'SKILL.md'), 's');
  fs.mkdirSync(h2, { recursive: true });
  accounts.syncShared('codex', 1);
  assert.strictEqual(fs.readFileSync(path.join(h2, 'config.toml'), 'utf8'), '[mcp_servers.x]\ncommand = "x"\n');
  assert.ok(fs.existsSync(path.join(h2, 'skills', 's', 'SKILL.md')));
});

test('with no sync snapshot the empty side never wipes the other account', () => {
  const h1 = path.join(tmp, 'codex-1'), h2 = path.join(tmp, 'data', 'accounts', 'codex-2');
  // Slot 2 is active and has neither file; the snapshot is gone (lost state file or a newly shared item).
  fs.rmSync(path.join(tmp, 'data', 'accounts', 'codex-shared.json'), { force: true });
  fs.rmSync(path.join(h2, 'config.toml'), { force: true });
  write(path.join(h1, 'AGENTS.md'), 'rules of slot 1');
  accounts.syncShared('codex', 2);
  assert.strictEqual(fs.readFileSync(path.join(h1, 'AGENTS.md'), 'utf8'), 'rules of slot 1');
  assert.strictEqual(fs.readFileSync(path.join(h2, 'AGENTS.md'), 'utf8'), 'rules of slot 1');
  assert.ok(fs.existsSync(path.join(h1, 'config.toml')));
  // With a snapshot, a deliberate removal under the active slot still goes through.
  fs.rmSync(path.join(h2, 'AGENTS.md'));
  accounts.syncShared('codex', 2);
  assert.ok(!fs.existsSync(path.join(h1, 'AGENTS.md')));

  const c1 = path.join(tmp, 'claude-1'), c2 = path.join(tmp, 'data', 'accounts', 'claude-2');
  fs.rmSync(path.join(tmp, 'data', 'accounts', 'claude-shared.json'), { force: true });
  write(path.join(c1, '.claude.json'), { mcpServers: { srv: { command: 'x' } } });
  write(path.join(c2, '.claude.json'), { oauthAccount: { emailAddress: 'second@b.c' } });
  accounts.syncShared('claude', 2);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(c1, '.claude.json'), 'utf8')).mcpServers, { srv: { command: 'x' } });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(c2, '.claude.json'), 'utf8')).mcpServers, { srv: { command: 'x' } });
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
