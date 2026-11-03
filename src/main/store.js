/* Хранилище Stella: настройки, чаты, расписание, расход. Всё — JSON в папке данных приложения. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { L, dicts } = require('./i18n');

// Built-in skills and directives keep a `builtin` id so the UI shows them in the current language.
// Once the user edits one, the id is dropped and their own text is kept as is.
const SKILL_IDS = ['brief', 'review', 'overview', 'fixTests', 'weekPlan', 'explain', 'computerUse'];
const SKILLS_CATALOG_VERSION = 2;
const DIRECTIVE_IDS = ['signIn', 'addFolder', 'customizeSkills'];
const builtinSkill = (id) => ({ builtin: id, label: L('skill.' + id + '.label'), prompt: L('skill.' + id + '.prompt') });
const builtinDirective = (id) => ({ builtin: id, text: L('directive.' + id), done: false });
// Settings saved before 1.7.1 stored the built-ins as plain text (in Russian); tag exact matches.
function tagBuiltins(list, ids, keysOf) {
  if (!Array.isArray(list)) return list;
  return list.map((x) => {
    if (!x || x.builtin) return x;
    for (const id of ids) for (const d of Object.values(dicts)) {
      const keys = keysOf(id);
      if (Object.entries(keys).every(([field, key]) => d[key] && x[field] === d[key])) return Object.assign({}, x, { builtin: id });
    }
    return x;
  });
}

function createStore(baseDir) {
  const dir = path.join(baseDir, 'data');
  const chatsDir = path.join(dir, 'chats');
  fs.mkdirSync(chatsDir, { recursive: true });

  function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
  }
  function writeJson(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  /* ---------- настройки ---------- */
  const settingsFile = path.join(dir, 'settings.json');
  const defaults = {
    agent: 'claude',
    projects: [os.homedir()],
    currentProject: os.homedir(),
    showAllProjects: false,
    claude: { permissionMode: 'default', model: '', exePath: '' },
    codex: { sandbox: 'read-only', model: '', jsPath: '' },
    chatgpt: { backend: 'codex', model: '', apiModel: 'gpt-5', sandbox: 'workspace-write' },
    apiKeyEnc: '',
    hotkey: 'Control+Shift+Space',
    closeToTray: true,
    autostart: false,
    notifications: true,
    memoryEnabled: true,
    hudOpen: true,
    dns: { active: 'system', askOnStart: false, custom: [] },
    skills: SKILL_IDS.map(builtinSkill),
    directives: DIRECTIVE_IDS.map(builtinDirective)
  };
  let settings = Object.assign({}, defaults, readJson(settingsFile, {}));
  settings.skills = tagBuiltins(settings.skills, SKILL_IDS, (id) => ({ label: 'skill.' + id + '.label', prompt: 'skill.' + id + '.prompt' }));
  // Add new built-ins to existing installations once. Later user removal remains respected.
  if ((settings.skillsCatalogVersion || 0) < SKILLS_CATALOG_VERSION) {
    const computerUseLabels = [dicts.ru['skill.computerUse.label'], dicts.en['skill.computerUse.label']];
    if (Array.isArray(settings.skills) && !settings.skills.some((skill) => skill?.builtin === 'computerUse' || computerUseLabels.includes(skill?.label))) {
      settings.skills.push(builtinSkill('computerUse'));
    }
    settings.skillsCatalogVersion = SKILLS_CATALOG_VERSION;
    writeJson(settingsFile, settings);
  }
  settings.directives = tagBuiltins(settings.directives, DIRECTIVE_IDS, (id) => ({ text: 'directive.' + id }));
  for (const k of ['claude', 'codex', 'chatgpt']) settings[k] = Object.assign({}, defaults[k], settings[k] || {});
  if (!Array.isArray(settings.projects) || !settings.projects.length) settings.projects = [os.homedir()];

  function getSettings() { return settings; }
  function saveSettings(patch) {
    settings = Object.assign({}, settings, patch);
    writeJson(settingsFile, settings);
    return settings;
  }

  /* ---------- чаты ---------- */
  const indexFile = path.join(dir, 'chats.json');
  let index = readJson(indexFile, []);
  const cache = new Map();

  function chatFile(id) { return path.join(chatsDir, id.replace(/[^a-zA-Z0-9_-]/g, '') + '.json'); }
  function listChats() { return index.slice().sort((a, b) => b.updated - a.updated); }
  function getChat(id) {
    if (cache.has(id)) return cache.get(id);
    const c = readJson(chatFile(id), null);
    if (c) cache.set(id, c);
    return c;
  }
  function summary(c) {
    let last = '';
    for (let i = c.messages.length - 1; i >= 0 && !last; i--) {
      const m = c.messages[i];
      if (m.role === 'user') last = m.text;
      else for (const b of m.blocks || []) if (b.type === 'text' && b.text) last = b.text;
    }
    return { id: c.id, title: c.title, agent: c.agent, cwd: c.cwd, created: c.created, updated: c.updated, scheduled: !!c.scheduled, snippet: (last || '').slice(0, 140) };
  }
  function saveChat(c) {
    c.updated = Date.now();
    cache.set(c.id, c);
    writeJson(chatFile(c.id), c);
    const s = summary(c);
    const i = index.findIndex((x) => x.id === c.id);
    if (i >= 0) index[i] = s; else index.push(s);
    writeJson(indexFile, index);
    return s;
  }
  function createChat({ agent, cwd, title, scheduled }) {
    const c = {
      id: crypto.randomUUID(),
      title: title || L('chat.new'),
      agent, cwd,
      created: Date.now(), updated: Date.now(),
      scheduled: !!scheduled,
      claudeSession: null, codexThread: null,
      messages: []
    };
    saveChat(c);
    return c;
  }
  function deleteChat(id) {
    cache.delete(id);
    try { fs.unlinkSync(chatFile(id)); } catch (e) {}
    index = index.filter((x) => x.id !== id);
    writeJson(indexFile, index);
  }

  /* ---------- расписание ---------- */
  const tasksFile = path.join(dir, 'tasks.json');
  let tasks = readJson(tasksFile, []);
  function getTasks() { return tasks; }
  function saveTasks(t) { tasks = t; writeJson(tasksFile, tasks); return tasks; }

  /* ---------- расход ---------- */
  const usageFile = path.join(dir, 'usage.json');
  let usage = readJson(usageFile, { weeks: {}, limits: {} });
  function weekKey(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return date.getUTCFullYear() + '-W' + String(Math.ceil(((date - y0) / 86400000 + 1) / 7)).padStart(2, '0');
  }
  function addUsage(agent, u) {
    if (!u) return;
    const k = weekKey(new Date());
    usage.weeks[k] = usage.weeks[k] || {};
    const w = usage.weeks[k][agent] = usage.weeks[k][agent] || { input: 0, output: 0, cost: 0, runs: 0 };
    w.input += u.input || 0; w.output += u.output || 0; w.cost += u.cost || 0; w.runs += 1;
    writeJson(usageFile, usage);
  }
  function setLimit(agent, type, info) {
    usage.limits[agent] = usage.limits[agent] || {};
    usage.limits[agent][type] = Object.assign({}, info, { at: Date.now() });
    writeJson(usageFile, usage);
  }
  function clearLimits(agent) {
    if (!usage.limits[agent]) return;
    delete usage.limits[agent];
    writeJson(usageFile, usage);
  }
  // Limits belong to an account. On a switch the shown limits are parked under the old slot and
  // the new slot's last known values come back, so the panel is never empty for a known account.
  usage.saved = usage.saved || {};
  function swapLimits(agent, fromSlot, toSlot) {
    const park = (slot) => agent + '#' + slot;
    if (usage.limits[agent]) usage.saved[park(fromSlot)] = usage.limits[agent];
    if (usage.saved[park(toSlot)]) usage.limits[agent] = usage.saved[park(toSlot)];
    else delete usage.limits[agent];
    delete usage.saved[park(toSlot)];
    writeJson(usageFile, usage);
  }
  function getUsage() {
    return { week: usage.weeks[weekKey(new Date())] || {}, limits: usage.limits || {} };
  }

  return {
    dir, getSettings, saveSettings,
    listChats, getChat, saveChat, createChat, deleteChat,
    getTasks, saveTasks,
    addUsage, setLimit, clearLimits, swapLimits, getUsage
  };
}

module.exports = { createStore, SKILL_IDS, builtinSkill };
