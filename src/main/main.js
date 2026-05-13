const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { Client } = require('ssh2');
const pty = require('node-pty');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

// ─── Store 初始化 ───────────────────────────────────────────────
const store = new Store({
  name: 'ssh-nexus-config',
  defaults: {
    connections: [],
    groups: ['默认分组', '生产环境', '测试环境', '开发环境'],
    settings: {
      theme: 'dark',
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Fira Code, monospace',
      cursorStyle: 'block',
      scrollback: 1000
    }
  }
});

// ─── 窗口管理 ───────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0d1117',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── 窗口控制 ───────────────────────────────────────────────────
ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow.close());

// ─── 连接配置 CRUD ──────────────────────────────────────────────
ipcMain.handle('connections:getAll', () => store.get('connections'));

ipcMain.handle('connections:save', (_, connection) => {
  const connections = store.get('connections');
  const idx = connections.findIndex(c => c.id === connection.id);
  if (idx >= 0) {
    connections[idx] = connection;
  } else {
    connection.id = uuidv4();
    connection.createdAt = new Date().toISOString();
    connections.push(connection);
  }
  store.set('connections', connections);
  return connection;
});

ipcMain.handle('connections:delete', (_, id) => {
  const connections = store.get('connections').filter(c => c.id !== id);
  store.set('connections', connections);
  return true;
});

ipcMain.handle('connections:duplicate', (_, id) => {
  const connections = store.get('connections');
  const original = connections.find(c => c.id === id);
  if (!original) return null;
  const copy = {
    ...original,
    id: uuidv4(),
    name: original.name + ' (副本)',
    createdAt: new Date().toISOString()
  };
  connections.push(copy);
  store.set('connections', connections);
  return copy;
});

// ─── 分组管理 ───────────────────────────────────────────────────
ipcMain.handle('groups:getAll', () => store.get('groups'));

ipcMain.handle('groups:save', (_, groups) => {
  store.set('groups', groups);
  return true;
});

// ─── 设置管理 ───────────────────────────────────────────────────
ipcMain.handle('settings:get', () => store.get('settings'));
ipcMain.handle('settings:save', (_, settings) => {
  store.set('settings', settings);
  return true;
});

// ─── SSH 会话管理 ───────────────────────────────────────────────
const sshSessions = new Map(); // sessionId → { client, stream }
const localPtySessions = new Map(); // sessionId → ptyProcess

ipcMain.handle('ssh:connect', async (event, { sessionId, connectionId }) => {
  const connections = store.get('connections');
  const conn = connections.find(c => c.id === connectionId);
  if (!conn) throw new Error('连接配置不存在');

  return new Promise((resolve, reject) => {
    const client = new Client();

    client.on('ready', () => {
      client.shell({ term: 'xterm-256color', cols: 220, rows: 50 }, (err, stream) => {
        if (err) { client.end(); return reject(err); }

        sshSessions.set(sessionId, { client, stream });

        stream.on('data', (data) => {
          mainWindow.webContents.send(`terminal:data:${sessionId}`, data.toString());
        });

        stream.stderr.on('data', (data) => {
          mainWindow.webContents.send(`terminal:data:${sessionId}`, data.toString());
        });

        stream.on('close', () => {
          mainWindow.webContents.send(`terminal:close:${sessionId}`);
          sshSessions.delete(sessionId);
          client.end();
        });

        resolve({ success: true, host: conn.host });
      });
    });

    client.on('error', (err) => {
      reject(new Error(err.message));
    });

    // 构建认证配置
    const authConfig = {
      host: conn.host,
      port: conn.port || 22,
      username: conn.username,
      readyTimeout: 15000
    };

    if (conn.authType === 'password') {
      authConfig.password = conn.password;
    } else if (conn.authType === 'privateKey') {
      const fs = require('fs');
      try {
        const keyPath = conn.privateKeyPath.replace('~', os.homedir());
        authConfig.privateKey = fs.readFileSync(keyPath);
        if (conn.passphrase) authConfig.passphrase = conn.passphrase;
      } catch (e) {
        return reject(new Error(`无法读取私钥文件: ${e.message}`));
      }
    }

    // 跳板机支持
    if (conn.jumpHost) {
      const jumpClient = new Client();
      jumpClient.connect({
        host: conn.jumpHost.host,
        port: conn.jumpHost.port || 22,
        username: conn.jumpHost.username,
        password: conn.jumpHost.password
      });
      jumpClient.on('ready', () => {
        jumpClient.forwardOut('127.0.0.1', 0, conn.host, conn.port || 22, (err, stream) => {
          if (err) return reject(err);
          authConfig.sock = stream;
          client.connect(authConfig);
        });
      });
    } else {
      client.connect(authConfig);
    }
  });
});

ipcMain.handle('ssh:write', (_, { sessionId, data }) => {
  const session = sshSessions.get(sessionId);
  if (session) session.stream.write(data);

  const ptySession = localPtySessions.get(sessionId);
  if (ptySession) ptySession.write(data);
});

ipcMain.handle('ssh:resize', (_, { sessionId, cols, rows }) => {
  const session = sshSessions.get(sessionId);
  if (session) session.stream.setWindow(rows, cols);

  const ptySession = localPtySessions.get(sessionId);
  if (ptySession) ptySession.resize(cols, rows);
});

ipcMain.handle('ssh:disconnect', (_, sessionId) => {
  const session = sshSessions.get(sessionId);
  if (session) {
    session.stream.close();
    session.client.end();
    sshSessions.delete(sessionId);
  }
  const ptySession = localPtySessions.get(sessionId);
  if (ptySession) {
    ptySession.kill();
    localPtySessions.delete(sessionId);
  }
});

// ─── 本地 Shell ─────────────────────────────────────────────────
ipcMain.handle('local:shell', (event, { sessionId }) => {
  const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 220,
    rows: 50,
    cwd: os.homedir(),
    env: process.env
  });

  ptyProcess.onData((data) => {
    mainWindow.webContents.send(`terminal:data:${sessionId}`, data);
  });

  ptyProcess.onExit(() => {
    mainWindow.webContents.send(`terminal:close:${sessionId}`);
    localPtySessions.delete(sessionId);
  });

  localPtySessions.set(sessionId, ptyProcess);
  return { success: true };
});

// ─── SSH 连通性测试 ─────────────────────────────────────────────
ipcMain.handle('ssh:test', async (_, config) => {
  return new Promise((resolve) => {
    const client = new Client();
    const timer = setTimeout(() => {
      client.destroy();
      resolve({ success: false, message: '连接超时' });
    }, 8000);

    client.on('ready', () => {
      clearTimeout(timer);
      client.end();
      resolve({ success: true, message: '连接成功！' });
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, message: err.message });
    });

    const authConfig = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
      readyTimeout: 8000
    };

    if (config.authType === 'password') {
      authConfig.password = config.password;
    } else {
      const fs = require('fs');
      try {
        const keyPath = config.privateKeyPath.replace('~', os.homedir());
        authConfig.privateKey = fs.readFileSync(keyPath);
      } catch (e) {
        return resolve({ success: false, message: `无法读取私钥: ${e.message}` });
      }
    }

    client.connect(authConfig);
  });
});
