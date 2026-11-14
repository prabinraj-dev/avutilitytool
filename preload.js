const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel) => (callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

// Everything the renderer is allowed to touch lives here. No Node or
// Electron internals are exposed directly -- only these narrow functions.
contextBridge.exposeInMainWorld('api', {
  theme: {
    // Read synchronously so the page can paint in the saved theme with no flash.
    initial: ipcRenderer.sendSync('theme:getSync'),
    set: (theme) => ipcRenderer.invoke('theme:set', theme),
  },
  devices: {
    list: () => ipcRenderer.invoke('devices:list'),
    add: (device) => ipcRenderer.invoke('devices:add', device),
    update: (id, patch) => ipcRenderer.invoke('devices:update', { id, patch }),
    remove: (id) => ipcRenderer.invoke('devices:remove', id),
    onStatusUpdate: subscribe('devices:statusUpdate'),
  },
  discovery: {
    scan: (params) => ipcRenderer.invoke('discovery:scan', params),
    cancel: () => ipcRenderer.invoke('discovery:cancel'),
    localNetworks: () => ipcRenderer.invoke('discovery:localNetworks'),
    onProgress: subscribe('discovery:progress'),
  },
  heartbeat: {
    start: () => ipcRenderer.invoke('heartbeat:start'),
    stop: () => ipcRenderer.invoke('heartbeat:stop'),
    configure: (params) => ipcRenderer.invoke('heartbeat:configure', params),
  },
  console: {
    send: (params) => ipcRenderer.invoke('console:send', params),
  },
  link: {
    open: (cfg) => ipcRenderer.invoke('link:open', cfg),
    close: () => ipcRenderer.invoke('link:close'),
    status: () => ipcRenderer.invoke('link:status'),
    serialList: () => ipcRenderer.invoke('link:serialList'),
    setLine: (line, on) => ipcRenderer.invoke('link:setLine', { line, on }),
    send: (params) => ipcRenderer.invoke('link:send', params),
    onData: subscribe('link:data'),
    onStatus: subscribe('link:status'),
  },
  mappings: {
    get: (deviceId) => ipcRenderer.invoke('mappings:get', deviceId),
    set: (deviceId, mapping) => ipcRenderer.invoke('mappings:set', { deviceId, mapping }),
  },
  control: {
    trigger: (deviceId, command) => ipcRenderer.invoke('control:trigger', { deviceId, command }),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
  },
  updater: {
    status: () => ipcRenderer.invoke('updater:status'),
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: subscribe('updater:status'),
  },
});
