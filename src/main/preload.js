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
    }
  },

  // 本地 Shell
  local: {
    shell: (opts) => ipcRenderer.invoke('local:shell', opts),
  }
});
