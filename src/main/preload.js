const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // 窗口控制
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },

  // 连接配置
  connections: {
    getAll: () => ipcRenderer.invoke('connections:getAll'),
    save: (conn) => ipcRenderer.invoke('connections:save', conn),
    delete: (id) => ipcRenderer.invoke('connections:delete', id),
    duplicate: (id) => ipcRenderer.invoke('connections:duplicate', id),
    export: () => ipcRenderer.invoke('connections:export'),
    import: () => ipcRenderer.invoke('connections:import'),
  },

  // 分组
  groups: {
    getAll: () => ipcRenderer.invoke('groups:getAll'),
    save: (groups) => ipcRenderer.invoke('groups:save', groups),
  },

  // 设置
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (s) => ipcRenderer.invoke('settings:save', s),
  },

  // SSH
  ssh: {
    connect: (opts) => ipcRenderer.invoke('ssh:connect', opts),
    write: (opts) => ipcRenderer.invoke('ssh:write', opts),
    resize: (opts) => ipcRenderer.invoke('ssh:resize', opts),
    disconnect: (sessionId) => ipcRenderer.invoke('ssh:disconnect', sessionId),
    test: (config) => ipcRenderer.invoke('ssh:test', config),
    onData: (sessionId, cb) => {
      const channel = `terminal:data:${sessionId}`;
      const handler = (_, data) => cb(data);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
    onClose: (sessionId, cb) => {
      const channel = `terminal:close:${sessionId}`;
      const handler = () => cb();
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
    onReconnecting: (sessionId, cb) => {
      const channel = `terminal:reconnecting:${sessionId}`;
      const handler = (_, data) => cb(data);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
    onReconnected: (sessionId, cb) => {
      const channel = `terminal:reconnected:${sessionId}`;
      const handler = () => cb();
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  },

  // 本地 Shell
  local: {
    shell: (opts) => ipcRenderer.invoke('local:shell', opts),
  },

  // 命令片段
  snippets: {
    getAll: () => ipcRenderer.invoke('snippets:getAll'),
    save: (snippet) => ipcRenderer.invoke('snippets:save', snippet),
    delete: (id) => ipcRenderer.invoke('snippets:delete', id),
  },

  // SSH 隧道
  tunnel: {
    getSaved: () => ipcRenderer.invoke('tunnels:getSaved'),
    saveTunnel: (tunnel) => ipcRenderer.invoke('tunnels:save', tunnel),
    deleteTunnel: (id) => ipcRenderer.invoke('tunnels:delete', id),
    start: (opts) => ipcRenderer.invoke('tunnel:start', opts),
    stop: (id) => ipcRenderer.invoke('tunnel:stop', id),
    onStatus: (cb) => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('tunnel:status', handler);
      return () => ipcRenderer.removeListener('tunnel:status', handler);
    }
  },

  // SFTP
  sftp: {
    open: (opts) => ipcRenderer.invoke('sftp:open', opts),
    list: (opts) => ipcRenderer.invoke('sftp:list', opts),
    download: (opts) => ipcRenderer.invoke('sftp:download', opts),
    upload: (opts) => ipcRenderer.invoke('sftp:upload', opts),
    mkdir: (opts) => ipcRenderer.invoke('sftp:mkdir', opts),
    delete: (opts) => ipcRenderer.invoke('sftp:delete', opts),
    rename: (opts) => ipcRenderer.invoke('sftp:rename', opts),
    close: (id) => ipcRenderer.invoke('sftp:close', id),
    onProgress: (cb) => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('sftp:progress', handler);
      return () => ipcRenderer.removeListener('sftp:progress', handler);
    }
  },

  // 日志
  log: {
    openDir: () => ipcRenderer.invoke('log:openDir'),
    listFiles: () => ipcRenderer.invoke('log:listFiles'),
  }
});
