/* Up to two accounts per provider (Claude, Codex/ChatGPT).
   Slot 1 is the user's normal sign-in (default config folder). Slot 2 lives in its own folder
   inside Stella's data dir and is selected via CLAUDE_CONFIG_DIR / CODEX_HOME.
   Switching on a usage limit only happens after the user confirms it in the UI. */
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROVIDERS = ['claude', 'codex'];
const PAID_CLAUDE = new Set(['pro', 'max', 'team', 'enterprise']);
const FREE_CODEX = new Set(['free', 'unknown', '']);
// Text of usage-limit errors from Claude Code and Codex.
const LIMIT_RE = /usage limit|limit reached|hit your (usage )?limit|reached your (usage )?limit|out of (extra )?usage|(5-hour|weekly|session) limit|usageLimitExceeded|rate.?limit/i;

let baseDir = null;
function configure(opts) { baseDir = opts.baseDir; }

function cfg(settings, provider) {
  const a = (settings && settings.accounts && settings.accounts[provider]) || {};
  return { active: a.active === 2 ? 2 : 1, ack: !!a.ack };
}
function defaultDir(provider) {
  if (provider === 'claude') return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}
function slotDir(provider, slot) {
  if (slot !== 2) return defaultDir(provider);
  if (!baseDir) return null;
  return path.join(baseDir, 'accounts', provider + '-2');
}
function activeSlot(settings, provider) { return cfg(settings, provider).active; }
// Env overrides for the active slot; empty object for slot 1 so existing setups are untouched.
function envFor(settings, provider, slot) {
  const s = slot || activeSlot(settings, provider);
  if (s !== 2) return {};
  const dir = slotDir(provider, 2);
  if (!dir) return {};
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return provider === 'claude' ? { CLAUDE_CONFIG_DIR: dir } : { CODEX_HOME: dir };
}
// Which account provider a chat agent uses; null for the API-key ChatGPT backend.
function providerFor(agent, settings) {
  if (agent === 'claude') return 'claude';
  if (agent === 'codex') return 'codex';
  if (agent === 'chatgpt' && !(settings && settings.chatgpt && settings.chatgpt.backend === 'api')) return 'codex';
  return null;
}
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function claudeCredsPath(slot) { const d = slotDir('claude', slot); return d && path.join(d, '.credentials.json'); }
function claudeInfo(slot) {
  const creds = readJson(claudeCredsPath(slot));
  const oauth = creds && creds.claudeAiOauth;
  if (!oauth || !oauth.accessToken) return { slot, signedIn: false, paid: false, plan: '', email: '' };
  // The global config sits next to the folder for the default location, inside it for CLAUDE_CONFIG_DIR.
  const d = slotDir('claude', slot);
  const conf = readJson(path.join(d, '.claude.json')) || (slot === 1 && !process.env.CLAUDE_CONFIG_DIR ? readJson(path.join(os.homedir(), '.claude.json')) : null);
  const plan = String(oauth.subscriptionType || '').toLowerCase();
  return { slot, signedIn: true, plan, paid: PAID_CLAUDE.has(plan), email: (conf && conf.oauthAccount && conf.oauthAccount.emailAddress) || '' };
}
function claudeToken(settings) {
  const creds = readJson(claudeCredsPath(activeSlot(settings, 'claude')));
  return creds && creds.claudeAiOauth && creds.claudeAiOauth.accessToken;
}
function codexSignedIn(slot) { const d = slotDir('codex', slot); return !!(d && fs.existsSync(path.join(d, 'auth.json'))); }
// getAccount: async (env) => app-server account/read result.
async function codexInfo(slot, getAccount) {
  if (!codexSignedIn(slot)) return { slot, signedIn: false, paid: false, plan: '', email: '' };
  try {
    const r = await getAccount(slot);
    const acc = r && r.account;
    const plan = String((acc && acc.planType) || '').toLowerCase();
    return { slot, signedIn: !!acc, plan, paid: !!acc && acc.type === 'chatgpt' && !FREE_CODEX.has(plan), email: (acc && acc.email) || '' };
  } catch (e) { return { slot, signedIn: true, paid: false, plan: '', email: '', error: String(e.message || e) }; }
}
async function info(provider, slot, getAccount) { return provider === 'claude' ? claudeInfo(slot) : codexInfo(slot, getAccount); }

function walk(dir, depth, test) {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && test(e.name)) return p;
    if (e.isDirectory() && depth > 0) { const r = walk(p, depth - 1, test); if (r) return r; }
  }
  return null;
}
// Copies a Claude session / Codex thread transcript so the other account can resume it.
// Returns true when the transcript is present in the target slot.
function copySession(provider, id, from, to) {
  if (!id || from === to) return true;
  const src = slotDir(provider, from), dst = slotDir(provider, to);
  if (!src || !dst) return false;
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return false;
  const roots = provider === 'claude' ? ['projects'] : ['sessions', 'archived_sessions'];
  const test = provider === 'claude' ? (n) => n === safe + '.jsonl' : (n) => n.endsWith(safe + '.jsonl');
  for (const root of roots) {
    const file = walk(path.join(src, root), provider === 'claude' ? 1 : 4, test);
    if (!file) continue;
    try {
      const target = path.join(dst, path.relative(src, file));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
      return true;
    } catch (e) { return false; }
  }
  return false;
}
/* ---------- plugins, skills, settings and MCP shared between the two accounts ----------
   Folders are linked: slot 2 gets a junction to slot 1's folder, so both see the same files.
   Files and MCP server lists are synced three-way against the last synced snapshot:
   whichever side changed wins; if both changed, the preferred (active) slot wins. */
const SHARED = {
  claude: { dirs: ['plugins', 'skills', 'agents', 'commands', 'hooks', 'output-styles'], files: ['settings.json', 'CLAUDE.md', 'keybindings.json'] },
  codex: { dirs: ['skills', 'plugins', 'prompts', 'rules'], files: ['config.toml', 'AGENTS.md'] }
};
const MCP_PROJECT_KEYS = ['mcpServers', 'enabledMcpjsonServers', 'disabledMcpjsonServers'];

function isLink(p) { try { return fs.lstatSync(p).isSymbolicLink(); } catch (e) { return false; } }
function exists(p) { try { fs.lstatSync(p); return true; } catch (e) { return false; } }
function unlinkLink(p) {
  try { fs.unlinkSync(p); } catch (e) { try { fs.rmdirSync(p); } catch (_) {} }
  return !exists(p);
}
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function linkDir(src, dst) {
  const target = path.resolve(src);
  if (isLink(dst)) {
    let cur = ''; try { cur = path.resolve(fs.readlinkSync(dst)); } catch (e) {}
    if (cur.toLowerCase() === target.toLowerCase()) return;
    if (!unlinkLink(dst)) return;
  } else if (exists(dst)) {
    // Something was installed while only the second account had it: keep it, then share.
    try { fs.mkdirSync(target, { recursive: true }); fs.cpSync(dst, target, { recursive: true, force: false, errorOnExist: false }); fs.rmSync(dst, { recursive: true, force: true }); }
    catch (e) { return; }
  }
  if (!exists(target)) return;
  try { fs.symlinkSync(target, dst, process.platform === 'win32' ? 'junction' : 'dir'); } catch (e) {}
}
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }
function writeText(p, v) {
  if (v == null) { try { fs.unlinkSync(p); } catch (e) {} return; }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, v);
}
// Claude keeps user/local MCP servers in .claude.json next to account data; only those keys are shared.
function claudeJsonPath(slot) {
  if (slot === 1 && !process.env.CLAUDE_CONFIG_DIR) return path.join(os.homedir(), '.claude.json');
  return path.join(slotDir('claude', slot), '.claude.json');
}
function readMcp(slot) {
  const j = readJson(claudeJsonPath(slot)) || {};
  const out = {};
  if (j.mcpServers && Object.keys(j.mcpServers).length) out.mcpServers = j.mcpServers;
  const projects = {};
  for (const [k, p] of Object.entries(j.projects || {})) {
    const pick = {};
    for (const key of MCP_PROJECT_KEYS) if (p && p[key] && (Array.isArray(p[key]) ? p[key].length : Object.keys(p[key]).length)) pick[key] = p[key];
    if (Object.keys(pick).length) projects[k] = pick;
  }
  if (Object.keys(projects).length) out.projects = projects;
  return stable(out);
}
function writeMcp(slot, value) {
  const file = claudeJsonPath(slot);
  const want = JSON.parse(value);
  const j = readJson(file) || {};
  if (want.mcpServers) j.mcpServers = want.mcpServers; else delete j.mcpServers;
  const projects = j.projects || {};
  for (const k of new Set([...Object.keys(projects), ...Object.keys(want.projects || {})])) {
    const src = (want.projects || {})[k] || {};
    const p = projects[k] = projects[k] || {};
    for (const key of MCP_PROJECT_KEYS) {
      if (src[key]) p[key] = src[key];
      else if (key === 'mcpServers') delete p[key];
      else if (p[key]) p[key] = [];
    }
  }
  if (Object.keys(projects).length) j.projects = projects;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.stella-tmp';
  fs.writeFileSync(tmp, JSON.stringify(j, null, 2));
  fs.renameSync(tmp, file);
}
function syncValue(state, key, a, b, prefer) {
  const base = state[key];
  let v = null;
  if (a.value === b.value) v = a.value;
  else {
    const ca = a.value !== base, cb = b.value !== base;
    const winner = ca && !cb ? a : cb && !ca ? b : prefer === 2 ? b : a;
    const loser = winner === a ? b : a;
    loser.write(winner.value); v = winner.value;
  }
  state[key] = v;
}
// prefer: slot whose changes win when both accounts changed the same thing (normally the active one).
function syncShared(provider, prefer) {
  const s1 = slotDir(provider, 1), s2 = slotDir(provider, 2);
  if (!s1 || !s2 || !baseDir || !exists(s2)) return false;
  const conf = SHARED[provider];
  if (!conf) return false;
  try { fs.mkdirSync(s1, { recursive: true }); } catch (e) {}
  for (const d of conf.dirs) if (exists(path.join(s1, d)) || exists(path.join(s2, d))) linkDir(path.join(s1, d), path.join(s2, d));
  const stateFile = path.join(baseDir, 'accounts', provider + '-shared.json');
  const state = readJson(stateFile) || {};
  for (const f of conf.files) {
    const p1 = path.join(s1, f), p2 = path.join(s2, f);
    try { syncValue(state, 'file:' + f, { value: readText(p1), write: (v) => writeText(p1, v) }, { value: readText(p2), write: (v) => writeText(p2, v) }, prefer); } catch (e) {}
  }
  if (provider === 'claude') {
    try { syncValue(state, 'mcp', { value: readMcp(1), write: (v) => writeMcp(1, v) }, { value: readMcp(2), write: (v) => writeMcp(2, v) }, prefer); } catch (e) {}
  }
  try { writeText(stateFile, JSON.stringify(state)); } catch (e) {}
  return true;
}

function removeSecond(provider) {
  const d = slotDir(provider, 2);
  if (!d || !exists(d)) return true;
  // Drop the shared-folder links first so deleting slot 2 can never touch slot 1's plugins.
  let entries = [];
  try { entries = fs.readdirSync(d); } catch (e) { return false; }
  for (const name of entries) { const p = path.join(d, name); if (isLink(p) && !unlinkLink(p)) return false; }
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { return false; }
  try { fs.unlinkSync(path.join(baseDir, 'accounts', provider + '-shared.json')); } catch (e) {}
  return true;
}
function isLimitText(text) { return LIMIT_RE.test(String(text || '')); }

module.exports = { PROVIDERS, configure, cfg, slotDir, activeSlot, envFor, providerFor, claudeInfo, claudeToken, codexInfo, info, copySession, syncShared, removeSecond, isLimitText };
