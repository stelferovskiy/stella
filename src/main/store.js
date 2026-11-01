/* Хранилище Stella: настройки, чаты, расписание, расход. Всё — JSON в папке данных приложения. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_SKILLS = [
  { label: 'Утренний бриф', prompt: 'Сделай короткий утренний бриф по этому проекту: что изменилось со вчера (git log, открытые TODO) и что стоит сделать сегодня.' },
  { label: 'Ревью кода', prompt: 'Проверь незакоммиченные изменения (git diff) и дай короткое ревью: баги, риски, что поправить.' },
  { label: 'Разбор проекта', prompt: 'Изучи структуру этого проекта и опиши архитектуру, ключевые модули и слабые места.' },
  { label: 'Починить тесты', prompt: 'Запусти тесты проекта, найди падающие и исправь их.' },
  { label: 'План недели', prompt: 'Посмотри TODO, issues и последние коммиты и предложи план работ на неделю.' },
  { label: 'Объясни код', prompt: 'Объясни простыми словами, что делает этот проект и как его запустить.' }
];

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
    chatgpt: { backend: 'codex', model: '', apiModel: 'gpt-5' },
    apiKeyEnc: '',
    hotkey: 'Control+Shift+Space',
    closeToTray: true,
    autostart: false,
    notifications: true,
    hudOpen: true,
    skills: DEFAULT_SKILLS,
    directives: [
      { text: 'Войти в Claude и Codex', done: false },
      { text: 'Добавить свою папку проекта', done: false },
      { text: 'Настроить навыки под себя', done: false }
    ]
  };
  let settings = Object.assign({}, defaults, readJson(settingsFile, {}));
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
      title: title || 'Новый чат',
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
  function getUsage() {
    return { week: usage.weeks[weekKey(new Date())] || {}, limits: usage.limits || {} };
  }

  return {
    dir, getSettings, saveSettings,
    listChats, getChat, saveChat, createChat, deleteChat,
    getTasks, saveTasks,
    addUsage, setLimit, getUsage
  };
}

module.exports = { createStore, DEFAULT_SKILLS };
