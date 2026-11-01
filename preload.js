const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('stella', {
  init: () => ipcRenderer.invoke('app:init'),
  checkEnv: () => ipcRenderer.invoke('env:check'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  setApiKey: (key) => ipcRenderer.invoke('apikey:set', key),
  chatgptModels: () => ipcRenderer.invoke('chatgpt:models'),
  setCfToken: (t) => ipcRenderer.invoke('cf:setToken', t),
  imagesList: () => ipcRenderer.invoke('images:list'),
  imagesGenerate: (opts) => ipcRenderer.invoke('images:generate', opts),
  imagesDelete: (id) => ipcRenderer.invoke('images:delete', id),
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
  onToast: on('toast'),
  onTermData: on('term:data'),
  onTermExit: on('term:exit')
});
