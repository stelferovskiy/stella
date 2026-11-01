/* Stella — основной процесс */
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, globalShortcut, Notification, nativeImage, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore } = require('./src/main/store');
const { createRunner } = require('./src/main/runner');
const { createScheduler } = require('./src/main/scheduler');
const { createTerminals } = require('./src/main/terminals');
const claudeProvider = require('./src/main/providers/claude');
const codexProvider = require('./src/main/providers/codex');
const openaiProvider = require('./src/main/providers/openai');
const { createImages } = require('./src/main/images');
const { createGptImages } = require('./src/main/gpt-images');
const { createI18n } = require('./src/main/i18n');
const { createPlugins } = require('./src/main/plugins');
const { createMemory } = require('./src/main/memory');
const { createUpdater } = require('./src/main/updater');

app.setAppUserModelId('com.stella.desktop');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null;
let tray = null;
let quitting = false;
let tr = (s) => s, plugins, memory, store, runner, scheduler, terms, images, gptImages, updater;
const startHidden = process.argv.includes('--hidden');
const ICON = path.join(__dirname, 'src', 'assets', 'icon.png');
const ICON_ICO = path.join(__dirname, 'src', 'assets', 'icon.ico');

function broadcast(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function showWindow(chatId) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (chatId) broadcast('chat:open', chatId);
}

function notify({ title, body, chatId, onlyIfHidden }) {
  const s = store.getSettings();
  if (!s.notifications || !Notification.isSupported()) return;
  if (onlyIfHidden && win && win.isVisible() && win.isFocused()) return;
  const n = new Notification({ title: tr(title), body: tr(body || ''), icon: ICON, silent: false });
  n.on('click', () => showWindow(chatId));
  n.show();
}

function getApiKey() {
  const enc = store.getSettings().apiKeyEnc;
  if (!enc) return '';
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch (e) { return ''; }
}

function getCfCreds() {
  const s = store.getSettings();
  let token = '';
  if (s.cfTokenEnc) { try { token = safeStorage.decryptString(Buffer.from(s.cfTokenEnc, 'base64')); } catch (e) {} }
  return { accountId: (s.cfAccountId || '').trim(), token };
}

function publicSettings() {
  const s = Object.assign({}, store.getSettings());
  s.hasApiKey = !!s.apiKeyEnc;
  s.hasCfToken = !!s.cfTokenEnc;
  delete s.apiKeyEnc;
  delete s.cfTokenEnc;
  return s;
}

function envInfo() {
  const s = store.getSettings();
  return {
    claudeExe: claudeProvider.findClaudeExe(s),
    claudeSdk: claudeProvider.findSdk(s),
    codexJs: codexProvider.findCodexJs(s),
    version: app.getVersion(),
    platform: process.platform,
    home: app.getPath('home')
  };
}

function registerHotkey(accel) {
  globalShortcut.unregisterAll();
  if (!accel) return true;
  try {
    return globalShortcut.register(accel, () => {
      if (win && win.isVisible() && win.isFocused()) win.hide();
      else { showWindow(); broadcast('composer:focus'); }
    });
  } catch (e) { return false; }
}

function applyAutostart(on) {
  try { app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] }); } catch (e) {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 980, minHeight: 640,
    show: false,
    backgroundColor: '#08080D',
    title: 'Stella',
    icon: fs.existsSync(ICON_ICO) ? ICON_ICO : ICON,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#08080D', symbolColor: '#C9C7D1', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
  });
  win.on('close', (e) => {
    if (!quitting && store.getSettings().closeToTray) {
      e.preventDefault();
      win.hide();
      if (!store.getSettings().trayHintShown) {
        store.saveSettings({ trayHintShown: true });
        notify({ title: 'Stella работает в фоне', body: 'Окно свёрнуто в трей. Выйти можно через значок в трее.' });
      }
    }
  });
}

function createTray() {
  const img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Stella');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: tr('Открыть Stella'), click: () => showWindow() },
    { label: tr('Новый чат'), click: () => { showWindow(); broadcast('chat:new'); } },
    { type: 'separator' },
    { label: tr('Выход'), click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', () => showWindow());
}

/* ---------- IPC ---------- */
function wireIpc() {
  ipcMain.handle('app:init', () => ({
    settings: publicSettings(),
    chats: store.listChats(),
    states: runner.states(),
    usage: store.getUsage(),
    tasks: store.getTasks(),
    env: envInfo()
  }));
  ipcMain.handle('env:check', () => envInfo());

  ipcMain.handle('settings:save', (_e, patch) => {
    const safe = Object.assign({}, patch);
    delete safe.apiKeyEnc; delete safe.hasApiKey; delete safe.cfTokenEnc; delete safe.hasCfToken;
    const before = store.getSettings();
    store.saveSettings(safe);
    let hotkeyOk = true;
    if (safe.hotkey !== undefined && safe.hotkey !== before.hotkey) hotkeyOk = registerHotkey(safe.hotkey);
    if (safe.autostart !== undefined) applyAutostart(safe.autostart);
    return { settings: publicSettings(), hotkeyOk };
  });
  ipcMain.handle('apikey:set', (_e, key) => {
    key = String(key || '').trim();
    if (!key) { store.saveSettings({ apiKeyEnc: '' }); return publicSettings(); }
    const enc = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key).toString('base64') : '';
    if (!enc) throw new Error('Шифрование недоступно в этой системе');
    store.saveSettings({ apiKeyEnc: enc });
    return publicSettings();
  });
  ipcMain.handle('cf:setToken', (_e, token) => {
    token = String(token || '').trim();
    if (!token) { store.saveSettings({ cfTokenEnc: '' }); return publicSettings(); }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование недоступно в этой системе');
    store.saveSettings({ cfTokenEnc: safeStorage.encryptString(token).toString('base64') });
    return publicSettings();
  });
  ipcMain.handle('images:list', () => ({ items: images.list(), stats: images.stats() }));
  ipcMain.handle('images:generate', async (_e, opts) => {
    try { const item = await images.generate(opts || {}); return { ok: true, item, stats: images.stats() }; }
    catch (err) { return { ok: false, error: String(err && err.message || err), code: err && err.code }; }
  });
  ipcMain.handle('images:delete', (_e, id) => ({ items: images.remove(id), stats: images.stats() }));
  ipcMain.handle('gpt-images:list', async () => {
    try { const availability = await gptImages.availability(); return { ...gptImages.list(), ...availability }; }
    catch (err) { return { ...gptImages.list(), error: err.message, code: err.action || err.code || 'unavailable' }; }
  });
  ipcMain.handle('gpt-images:generate', async (_e, opts) => {
    try { return { ok: true, item: await gptImages.generate(opts || {}) }; }
    catch (err) { return { ok: false, error: err.message, code: err.action || err.code || 'generation-failed' }; }
  });
  ipcMain.handle('gpt-images:stop', () => gptImages.stop());
  ipcMain.handle('gpt-images:status', () => gptImages.status());
  ipcMain.handle('gpt-images:delete', (_e, id) => ({ items: gptImages.remove(id) }));
  ipcMain.handle('gpt-images:save', async (_e, id) => {
    try {
      const item = gptImages.get(id), ext = path.extname(item.file);
      const r = await dialog.showSaveDialog(win, { title: 'Сохранить изображение', defaultPath: path.join(app.getPath('pictures'), 'Stella-' + item.id.slice(0, 8) + ext), filters: [{ name: 'Image', extensions: [ext.slice(1)] }] });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      if (path.resolve(item.file) !== path.resolve(r.filePath)) fs.copyFileSync(item.file, r.filePath);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('chatgpt:models', async () => openaiProvider.listModels(getApiKey()));
  ipcMain.handle('codex:models', async () => codexProvider.listModels(store.getSettings()));
  ipcMain.handle('codex:account', async () => codexProvider.getAccount(store.getSettings()));

  ipcMain.handle('project:pick', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: tr('Папка проекта') });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    const s = store.getSettings();
    const projects = s.projects.includes(p) ? s.projects : s.projects.concat([p]);
    store.saveSettings({ projects, currentProject: p });
    return publicSettings();
  });

  ipcMain.handle('chat:create', (_e, { agent, cwd }) => {
    const c = store.createChat({ agent, cwd: cwd || store.getSettings().currentProject });
    broadcast('chats:changed', store.saveChat(c));
    return c;
  });
  // «Перенести в новую сессию»: локальная выжимка чата -> заметка проекта -> новый чат с этим контекстом.
  ipcMain.handle('chat:transfer', (_e, id) => {
    const old = store.getChat(id);
    if (!old || !old.messages.length) return null;
    const handoff = memory.digest(old);
    if (store.getSettings().memoryEnabled !== false) memory.add(old.cwd, handoff);
    const c = store.createChat({ agent: old.agent, cwd: old.cwd, title: '↪ ' + old.title });
    c.handoff = handoff;
    broadcast('chats:changed', store.saveChat(c));
    return c;
  });
  ipcMain.handle('plugins:state', (_e, agent) => (agent === 'codex' ? plugins.codexState() : plugins.claudeState()));
  ipcMain.handle('plugins:action', (_e, agent, action, arg) => (agent === 'codex' ? plugins.codexAction(action, arg) : plugins.claudeAction(action, arg)));
  ipcMain.handle('memory:get', (_e, cwd) => memory.get(cwd));
  ipcMain.handle('memory:set', (_e, cwd, text) => memory.set(cwd, text));
  ipcMain.handle('chat:get', (_e, id) => store.getChat(id));
  ipcMain.handle('chat:delete', (_e, id) => { runner.stop(id); store.deleteChat(id); return store.listChats(); });
  ipcMain.handle('chat:rename', (_e, id, title) => {
    const c = store.getChat(id);
    if (!c) return null;
    c.title = String(title || '').slice(0, 120) || c.title;
    const s = store.saveChat(c);
    broadcast('chats:changed', s);
    return s;
  });
  ipcMain.handle('chat:send', (_e, id, payload) => { runner.send(id, payload || {}).catch((err) => broadcast('toast', String(err.message || err))); return true; });
  ipcMain.handle('chat:stop', (_e, id) => { runner.stop(id); return true; });
  ipcMain.handle('chat:approve', (_e, id, reqId, answer) => runner.approve(id, reqId, answer));
  ipcMain.handle('chat:answerInput', (_e, id, reqId, answers) => runner.answerInput(id, reqId, answers));

  ipcMain.handle('files:pick', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], title: tr('Прикрепить файлы') });
    return r.canceled ? [] : r.filePaths.map((p) => ({ name: path.basename(p), path: p }));
  });
  ipcMain.handle('file:read', (_e, p) => {
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) return { ok: false, error: 'Это не файл' };
      const ext = path.extname(p).toLowerCase();
      const isText = !['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.exe', '.dll', '.bin', '.mp4', '.mp3', '.wav'].includes(ext);
      if (isText && st.size <= 600000) return { ok: true, size: st.size, ext, text: fs.readFileSync(p, 'utf8') };
      return { ok: true, size: st.size, ext, text: null };
    } catch (e) { return { ok: false, error: 'Файл не найден или недоступен' }; }
  });
  ipcMain.handle('file:open', (_e, p) => shell.openPath(p));
  ipcMain.handle('file:reveal', (_e, p) => { shell.showItemInFolder(p); return true; });
  ipcMain.handle('url:open', (_e, url) => { if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url); return true; });

  ipcMain.handle('tasks:save', (_e, list) => store.saveTasks(Array.isArray(list) ? list : []));
  ipcMain.handle('tasks:run', (_e, id) => {
    const t = store.getTasks().find((x) => x.id === id);
    return t ? scheduler.runTask(t) : null;
  });

  ipcMain.handle('term:spawn', (_e, opts) => terms.spawn(opts));
  ipcMain.on('term:write', (_e, { id, data }) => terms.write(id, data));
  ipcMain.on('term:resize', (_e, { id, cols, rows }) => terms.resize(id, cols, rows));
  ipcMain.on('term:kill', (_e, { id }) => terms.kill(id));
}

app.on('second-instance', () => showWindow());

app.whenReady().then(() => {
  store = createStore(app.getPath('userData'));
  tr = createI18n({ getSettings: () => store.getSettings(), systemLocale: app.getLocale() }).tr;
  plugins = createPlugins({ store });
  memory = createMemory(app.getPath('userData'));
  runner = createRunner({ store, broadcast, notify, getApiKey, memory });
  scheduler = createScheduler({ store, runner, broadcast, notify });
  terms = createTerminals({ broadcast });
  images = createImages({ store, getCreds: getCfCreds });
  gptImages = createGptImages({ store, broadcast });
  wireIpc();
  createWindow();
  createTray();
  const s = store.getSettings();
  if (!registerHotkey(s.hotkey)) broadcast('toast', 'Не удалось назначить горячую клавишу ' + s.hotkey);
  applyAutostart(s.autostart);
  scheduler.start();
  updater = createUpdater({ app, dialog, getWindow: () => win, broadcast, canInstall: () => !gptImages.status().active && !Object.values(runner.states()).some((s) => s && !['idle', 'error'].includes(s)), beforeInstall: () => { quitting = true; } });
  if (app.isPackaged) { setTimeout(() => updater.check({ silent: true }), 15000); setInterval(() => updater.check({ silent: true }), 6 * 3600 * 1000); }
  ipcMain.handle('update:check', () => updater.check({ silent: false }));
  ipcMain.handle('update:install', () => updater.installNow());
  ipcMain.handle('update:state', () => updater.readyInfo());
  pollClaudeLimits();
  limitsTimer = setInterval(pollClaudeLimits, 60 * 1000);
});

let limitsTimer = null;
async function pollClaudeLimits() {
  try {
    const credPath = path.join(require('os').homedir(), '.claude', '.credentials.json');
    const token = JSON.parse(fs.readFileSync(credPath, 'utf8')).claudeAiOauth?.accessToken;
    if (!token) return;
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: 'Bearer ' + token, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'stella' }
    });
    if (!res.ok) return;
    const data = await res.json();
    for (const k of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']) {
      const v = data[k];
      if (!v || v.utilization == null) continue;
      store.setLimit('claude', k, {
        utilization: v.utilization / 100,
        resetsAt: v.resets_at ? Math.floor(Date.parse(v.resets_at) / 1000) : undefined,
        status: v.utilization >= 100 ? 'rejected' : 'allowed'
      });
    }
    broadcast('usage:changed', store.getUsage());
  } catch (e) { /* offline or no credentials: keep last known values */ }
}

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  try { runner.stopAll(); gptImages.stop(); terms.killAll(); scheduler.stop(); } catch (e) {}
  try { updater && updater.installOnQuit(); } catch (e) {}
});
app.on('window-all-closed', () => { quitting = true; app.quit(); });
