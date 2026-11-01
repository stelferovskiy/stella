const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

// Locale dictionaries for the renderer translator (src/renderer/i18n.js).
contextBridge.exposeInMainWorld('stellaLocales', { ru: require('./src/locales/ru.json'), en: require('./src/locales/en.json') });

contextBridge.exposeInMainWorld('stella', {
  init: () => ipcRenderer.invoke('app:init'),
  checkEnv: () => ipcRenderer.invoke('env:check'),
  dnsStatus: () => ipcRenderer.invoke('dns:status'),
  dnsValidate: (entry) => ipcRenderer.invoke('dns:validate', entry),
  dnsTest: (id, host) => ipcRenderer.invoke('dns:test', id, host),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  setApiKey: (key) => ipcRenderer.invoke('apikey:set', key),
  codexModels: () => ipcRenderer.invoke('codex:models'),
  codexAccount: () => ipcRenderer.invoke('codex:account'),
  accountsState: () => ipcRenderer.invoke('accounts:state'),
  accountsAck: (p) => ipcRenderer.invoke('accounts:ack', p),
  accountsPrepare: (p) => ipcRenderer.invoke('accounts:prepare', p),
  accountsSetActive: (p, slot) => ipcRenderer.invoke('accounts:setActive', p, slot),
  accountsRemove: (p) => ipcRenderer.invoke('accounts:remove', p),
  accountsSwitchContinue: (id, p, to) => ipcRenderer.invoke('accounts:switchContinue', id, p, to),
  onAccountLimit: on('account:limit'),
  onAccountsChanged: on('accounts:changed'),
  answerInput: (id, reqId, answers) => ipcRenderer.invoke('chat:answerInput', id, reqId, answers),
  chatgptModels: () => ipcRenderer.invoke('chatgpt:models'),
  setCfToken: (t) => ipcRenderer.invoke('cf:setToken', t),
  imagesList: () => ipcRenderer.invoke('images:list'),
  imagesGenerate: (opts) => ipcRenderer.invoke('images:generate', opts),
  imagesDelete: (id) => ipcRenderer.invoke('images:delete', id),
  gptImagesList: () => ipcRenderer.invoke('gpt-images:list'),
  gptImagesGenerate: (opts) => ipcRenderer.invoke('gpt-images:generate', opts),
  gptImagesStop: () => ipcRenderer.invoke('gpt-images:stop'),
  gptImagesStatus: () => ipcRenderer.invoke('gpt-images:status'),
  gptImagesDelete: (id) => ipcRenderer.invoke('gpt-images:delete', id),
  gptImagesSave: (id) => ipcRenderer.invoke('gpt-images:save', id),
  onGptImagesProgress: on('gpt-images:progress'),
  pickProject: () => ipcRenderer.invoke('project:pick'),

  createChat: (opts) => ipcRenderer.invoke('chat:create', opts),
  getChat: (id) => ipcRenderer.invoke('chat:get', id),
  deleteChat: (id) => ipcRenderer.invoke('chat:delete', id),
  renameChat: (id, title) => ipcRenderer.invoke('chat:rename', id, title),
  send: (id, payload) => ipcRenderer.invoke('chat:send', id, payload),
  stop: (id) => ipcRenderer.invoke('chat:stop', id),
  approve: (id, reqId, answer) => ipcRenderer.invoke('chat:approve', id, reqId, answer),

  pickFiles: () => ipcRenderer.invoke('files:pick'),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } },
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  openFile: (p) => ipcRenderer.invoke('file:open', p),
  revealFile: (p) => ipcRenderer.invoke('file:reveal', p),
  transferChat: (id) => ipcRenderer.invoke('chat:transfer', id),
  memoryGet: (cwd) => ipcRenderer.invoke('memory:get', cwd),
  memorySet: (cwd, text) => ipcRenderer.invoke('memory:set', cwd, text),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  updateState: () => ipcRenderer.invoke('update:state'),
  onUpdateReady: on('update:ready'),
  pluginsState: (agent) => ipcRenderer.invoke('plugins:state', agent),
  pluginsAction: (agent, action, arg) => ipcRenderer.invoke('plugins:action', agent, action, arg),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openUrl: (u) => ipcRenderer.invoke('url:open', u),

  saveTasks: (list) => ipcRenderer.invoke('tasks:save', list),
  runTask: (id) => ipcRenderer.invoke('tasks:run', id),

  termSpawn: (opts) => ipcRenderer.invoke('term:spawn', opts),
  termWrite: (id, data) => ipcRenderer.send('term:write', { id, data }),
  termResize: (id, cols, rows) => ipcRenderer.send('term:resize', { id, cols, rows }),
  termKill: (id) => ipcRenderer.send('term:kill', { id }),

  onChatEvent: on('chat:event'),
  onChatMessage: on('chat:message'),
  onChatsChanged: on('chats:changed'),
  onAgentState: on('agent:state'),
  onLive: on('agent:live'),
  onUsage: on('usage:changed'),
  onTasks: on('tasks:changed'),
  onOpenChat: on('chat:open'),
  onNewChat: on('chat:new'),
  onFocusComposer: on('composer:focus'),
  onAlert: on('alert'),
  onToast: on('toast'),
  onTermData: on('term:data'),
  onTermExit: on('term:exit')
});
