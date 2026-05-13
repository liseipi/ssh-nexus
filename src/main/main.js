const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');
const { Client } = require('ssh2');
const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');

const store = new Store({
  name: 'ssh-nexus-config',
  defaults: {
    connections: [],
    groups: ['默认分组', '生产环境', '测试环境', '开发环境'],
    snippets: [],
    tunnels: [],
    settings: {
      theme: 'dark',
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Fira Code, monospace',
      cursorStyle: 'block',
      scrollback: 5000,
      autoReconnect: true,
      autoReconnectDelay: 3000,
      autoReconnectMaxTries: 5,
      logEnabled: false,
      logDir: path.join(os.homedir(), 'ssh-nexus-logs'),
    }
  }
});

let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    frame: false, titleBarStyle: 'hidden', backgroundColor: '#0d1117',
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
    show: false
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// 窗口控制
ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:maximize', () => { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
ipcMain.handle('window:close', () => mainWindow.close());

// 连接 CRUD
ipcMain.handle('connections:getAll', () => store.get('connections'));
ipcMain.handle('connections:save', (_, conn) => {
  const list = store.get('connections');
  const idx = list.findIndex(c => c.id === conn.id);
  if (idx >= 0) list[idx] = conn; else { conn.id = uuidv4(); conn.createdAt = new Date().toISOString(); list.push(conn); }
  store.set('connections', list); return conn;
});
ipcMain.handle('connections:delete', (_, id) => { store.set('connections', store.get('connections').filter(c => c.id !== id)); return true; });
ipcMain.handle('connections:duplicate', (_, id) => {
  const list = store.get('connections'), orig = list.find(c => c.id === id);
  if (!orig) return null;
  const copy = { ...orig, id: uuidv4(), name: orig.name + ' (副本)', createdAt: new Date().toISOString() };
  list.push(copy); store.set('connections', list); return copy;
});

// 导入/导出
ipcMain.handle('connections:export', async () => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出连接配置', defaultPath: `ssh-nexus-export-${Date.now()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (!filePath) return { success: false };
  const data = {
    version: 1, exportedAt: new Date().toISOString(),
    connections: store.get('connections').map(c => ({ ...c, password: undefined })),
    groups: store.get('groups'), snippets: store.get('snippets'),
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return { success: true, filePath };
});
ipcMain.handle('connections:import', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '导入连接配置', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile']
  });
  if (!filePaths || !filePaths[0]) return { success: false };
  try {
    const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
    const existing = store.get('connections'), existingIds = new Set(existing.map(c => c.id));
    let added = 0;
    (data.connections || []).forEach(c => { if (!existingIds.has(c.id)) { existing.push({ ...c, id: c.id || uuidv4() }); added++; } });
    store.set('connections', existing);
    if (data.groups) { const eg = store.get('groups'); data.groups.forEach(g => { if (!eg.includes(g)) eg.push(g); }); store.set('groups', eg); }
    if (data.snippets) { const es = store.get('snippets'), esIds = new Set(es.map(s => s.id)); (data.snippets||[]).forEach(s => { if (!esIds.has(s.id)) es.push(s); }); store.set('snippets', es); }
    return { success: true, added };
  } catch (e) { return { success: false, error: e.message }; }
});

// 分组
ipcMain.handle('groups:getAll', () => store.get('groups'));
ipcMain.handle('groups:save', (_, groups) => { store.set('groups', groups); return true; });

// 设置
ipcMain.handle('settings:get', () => store.get('settings'));
ipcMain.handle('settings:save', (_, s) => { store.set('settings', s); return true; });

// Snippets
ipcMain.handle('snippets:getAll', () => store.get('snippets'));
ipcMain.handle('snippets:save', (_, snippet) => {
  const list = store.get('snippets'), idx = list.findIndex(s => s.id === snippet.id);
  if (idx >= 0) list[idx] = snippet; else { snippet.id = uuidv4(); snippet.createdAt = new Date().toISOString(); list.push(snippet); }
  store.set('snippets', list); return snippet;
});
ipcMain.handle('snippets:delete', (_, id) => { store.set('snippets', store.get('snippets').filter(s => s.id !== id)); return true; });

// SSH Tunnel
const activeTunnels = new Map();
ipcMain.handle('tunnel:start', async (_, { tunnelId, connectionId, localPort, remoteHost, remotePort, type }) => {
  const conn = store.get('connections').find(c => c.id === connectionId);
  if (!conn) throw new Error('连接不存在');
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on('ready', () => {
      const net = require('net');
      const server = net.createServer((sock) => {
        if (type === 'dynamic') {
          sock.once('data', (buf) => {
            if (buf[0] !== 5) { sock.destroy(); return; }
            sock.write(Buffer.from([5, 0]));
            sock.once('data', (req) => {
              let host, port;
              if (req[3] === 1) { host = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`; port = req.readUInt16BE(8); }
              else if (req[3] === 3) { const len = req[4]; host = req.slice(5, 5+len).toString(); port = req.readUInt16BE(5+len); }
              else { sock.destroy(); return; }
              client.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
                if (err) { sock.write(Buffer.from([5,5,0,1,0,0,0,0,0,0])); sock.destroy(); return; }
                sock.write(Buffer.from([5,0,0,1,0,0,0,0,0,0]));
                sock.pipe(stream); stream.pipe(sock);
                stream.on('close', () => sock.destroy()); sock.on('close', () => stream.destroy());
              });
            });
          });
        } else {
          client.forwardOut('127.0.0.1', sock.remotePort || 0, remoteHost, remotePort, (err, stream) => {
            if (err) { sock.destroy(); return; }
            sock.pipe(stream); stream.pipe(sock);
            stream.on('close', () => sock.destroy()); sock.on('close', () => stream.destroy());
          });
        }
      });
      server.listen(localPort, '127.0.0.1', () => {
        activeTunnels.set(tunnelId, { client, server });
        mainWindow.webContents.send('tunnel:status', { tunnelId, status: 'active', localPort });
        resolve({ success: true, localPort });
      });
      server.on('error', e => reject(new Error(e.message)));
    });
    client.on('error', e => reject(new Error(e.message)));
    client.connect(buildAuthConfig(conn));
  });
});
ipcMain.handle('tunnel:stop', (_, tunnelId) => {
  const t = activeTunnels.get(tunnelId);
  if (t) { if (t.server) t.server.close(); t.client.end(); activeTunnels.delete(tunnelId); }
  mainWindow.webContents.send('tunnel:status', { tunnelId, status: 'stopped' });
  return true;
});
ipcMain.handle('tunnel:getActive', () => Array.from(activeTunnels.keys()));
ipcMain.handle('tunnels:getSaved', () => store.get('tunnels'));
ipcMain.handle('tunnels:save', (_, tunnel) => {
  const list = store.get('tunnels'), idx = list.findIndex(t => t.id === tunnel.id);
  if (idx >= 0) list[idx] = tunnel; else { tunnel.id = uuidv4(); list.push(tunnel); }
  store.set('tunnels', list); return tunnel;
});
ipcMain.handle('tunnels:delete', (_, id) => { store.set('tunnels', store.get('tunnels').filter(t => t.id !== id)); return true; });

// SSH 核心
const sshSessions = new Map();
const localPtySessions = new Map();
const logStreams = new Map();

function buildAuthConfig(conn) {
  const cfg = { host: conn.host, port: conn.port || 22, username: conn.username, readyTimeout: 15000 };
  if (conn.authType === 'password') { cfg.password = conn.password; }
  else if (conn.authType === 'privateKey') {
    try { cfg.privateKey = fs.readFileSync(conn.privateKeyPath.replace('~', os.homedir())); } catch(e) {}
    if (conn.passphrase) cfg.passphrase = conn.passphrase;
  }
  const keepAlive = conn.keepAliveSeconds ?? 300;
  if (keepAlive > 0) {
    cfg.keepaliveInterval = keepAlive * 1000;
    cfg.keepaliveCountMax = 3;
  }
  return cfg;
}

function openLogStream(sessionId, connName) {
  const settings = store.get('settings');
  if (!settings.logEnabled) return;
  if (!fs.existsSync(settings.logDir)) fs.mkdirSync(settings.logDir, { recursive: true });
  const fname = `${connName.replace(/[^a-z0-9]/gi,'_')}_${new Date().toISOString().replace(/[:.]/g,'-')}.log`;
  const ws = fs.createWriteStream(path.join(settings.logDir, fname), { flags: 'a', encoding: 'utf8' });
  ws.write(`=== SSH Nexus Log — ${connName} — ${new Date().toLocaleString()} ===\n`);
  logStreams.set(sessionId, ws);
}
function writeLog(sessionId, data) { const ws = logStreams.get(sessionId); if (ws) ws.write(data); }
function closeLogStream(sessionId) {
  const ws = logStreams.get(sessionId);
  if (ws) { ws.write(`\n=== Session ended ${new Date().toLocaleString()} ===\n`); ws.end(); logStreams.delete(sessionId); }
}

function doReconnect(sessionId, conn, tries) {
  const settings = store.get('settings');
  if (!settings.autoReconnect || tries > (settings.autoReconnectMaxTries || 5)) return;
  const delay = settings.autoReconnectDelay || 3000;
  mainWindow.webContents.send(`terminal:reconnecting:${sessionId}`, { tries, delay });
  setTimeout(() => {
    const client = new Client();
    client.on('ready', () => {
      client.shell({ term: 'xterm-256color', cols: 220, rows: 50 }, (err, stream) => {
        if (err) { client.end(); doReconnect(sessionId, conn, tries+1); return; }
        const session = { client, stream, conn, reconnectTries: tries };
        sshSessions.set(sessionId, session);
        mainWindow.webContents.send(`terminal:reconnected:${sessionId}`);
        stream.on('data', d => { const s = d.toString(); mainWindow.webContents.send(`terminal:data:${sessionId}`, s); writeLog(sessionId, s); });
        stream.stderr.on('data', d => { const s = d.toString(); mainWindow.webContents.send(`terminal:data:${sessionId}`, s); });
        stream.on('close', () => { sshSessions.delete(sessionId); client.end(); mainWindow.webContents.send(`terminal:close:${sessionId}`); doReconnect(sessionId, conn, session.reconnectTries+1); });
      });
    });
    client.on('error', () => doReconnect(sessionId, conn, tries+1));
    client.connect(buildAuthConfig(conn));
  }, delay);
}

ipcMain.handle('ssh:connect', async (_, { sessionId, connectionId }) => {
  const conn = store.get('connections').find(c => c.id === connectionId);
  if (!conn) throw new Error('连接配置不存在');
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on('ready', () => {
      client.shell({ term: 'xterm-256color', cols: 220, rows: 50 }, (err, stream) => {
        if (err) { client.end(); return reject(err); }
        const session = { client, stream, conn, reconnectTries: 0 };
        sshSessions.set(sessionId, session);
        openLogStream(sessionId, conn.name);
        stream.on('data', d => { const s = d.toString(); mainWindow.webContents.send(`terminal:data:${sessionId}`, s); writeLog(sessionId, s); });
        stream.stderr.on('data', d => { const s = d.toString(); mainWindow.webContents.send(`terminal:data:${sessionId}`, s); writeLog(sessionId, s); });
        stream.on('close', () => {
          sshSessions.delete(sessionId); client.end(); closeLogStream(sessionId);
          mainWindow.webContents.send(`terminal:close:${sessionId}`);
          doReconnect(sessionId, conn, session.reconnectTries + 1);
        });
        resolve({ success: true, host: conn.host });
      });
    });
    client.on('error', e => reject(new Error(e.message)));
    if (conn.jumpHost && conn.jumpHost.host) {
      const jc = new Client();
      jc.connect({ host: conn.jumpHost.host, port: conn.jumpHost.port||22, username: conn.jumpHost.username, password: conn.jumpHost.password, readyTimeout: 10000 });
      jc.on('ready', () => { jc.forwardOut('127.0.0.1', 0, conn.host, conn.port||22, (err, sock) => { if (err) return reject(err); const cfg = buildAuthConfig(conn); cfg.sock = sock; client.connect(cfg); }); });
      jc.on('error', reject);
    } else { client.connect(buildAuthConfig(conn)); }
  });
});

ipcMain.handle('ssh:write', (_, { sessionId, data }) => {
  const s = sshSessions.get(sessionId); if (s) s.stream.write(data);
  const p = localPtySessions.get(sessionId); if (p) p.write(data);
});
ipcMain.handle('ssh:resize', (_, { sessionId, cols, rows }) => {
  const s = sshSessions.get(sessionId); if (s) s.stream.setWindow(rows, cols);
  const p = localPtySessions.get(sessionId); if (p) p.resize(cols, rows);
});
ipcMain.handle('ssh:disconnect', (_, sessionId) => {
  const s = sshSessions.get(sessionId);
  if (s) { s.reconnectTries = 999; try { s.stream.close(); } catch(e){} try { s.client.end(); } catch(e){} sshSessions.delete(sessionId); }
  const p = localPtySessions.get(sessionId);
  if (p) { try { p.kill(); } catch(e){} localPtySessions.delete(sessionId); }
  closeLogStream(sessionId);
});

ipcMain.handle('local:shell', (_, { sessionId }) => {
  const sh = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  const proc = pty.spawn(sh, [], { name: 'xterm-256color', cols: 220, rows: 50, cwd: os.homedir(), env: process.env });
  proc.onData(d => mainWindow.webContents.send(`terminal:data:${sessionId}`, d));
  proc.onExit(() => { mainWindow.webContents.send(`terminal:close:${sessionId}`); localPtySessions.delete(sessionId); });
  localPtySessions.set(sessionId, proc);
  return { success: true };
});

// SFTP
const sftpSessions = new Map();
ipcMain.handle('sftp:open', async (_, { sftpId, connectionId }) => {
  const conn = store.get('connections').find(c => c.id === connectionId);
  if (!conn) throw new Error('连接不存在');
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on('ready', () => { client.sftp((err, sftp) => { if (err) { client.end(); return reject(err); } sftpSessions.set(sftpId, { client, sftp, currentPath: '/' }); resolve({ success: true }); }); });
    client.on('error', reject);
    client.connect(buildAuthConfig(conn));
  });
});
ipcMain.handle('sftp:list', async (_, { sftpId, remotePath }) => {
  const s = sftpSessions.get(sftpId); if (!s) throw new Error('SFTP 会话不存在');
  return new Promise((resolve, reject) => {
    s.sftp.readdir(remotePath, (err, list) => {
      if (err) return reject(err);
      resolve(list.map(f => ({ name: f.filename, longname: f.longname, isDir: f.attrs.isDirectory(), isFile: f.attrs.isFile(), size: f.attrs.size, mtime: f.attrs.mtime, mode: f.attrs.mode })));
    });
  });
});
ipcMain.handle('sftp:download', async (_, { sftpId, remotePath }) => {
  const s = sftpSessions.get(sftpId); if (!s) throw new Error('SFTP 会话不存在');
  const { filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: path.basename(remotePath) });
  if (!filePath) return { success: false };
  return new Promise((resolve, reject) => {
    s.sftp.fastGet(remotePath, filePath, { step: (t, c, total) => mainWindow.webContents.send('sftp:progress', { sftpId, transferred: t, total, filename: path.basename(remotePath) }) }, (err) => { if (err) reject(err); else resolve({ success: true, filePath }); });
  });
});
ipcMain.handle('sftp:upload', async (_, { sftpId, remotePath }) => {
  const s = sftpSessions.get(sftpId); if (!s) throw new Error('SFTP 会话不存在');
  const { filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
  if (!filePaths || !filePaths.length) return { success: false };
  const results = [];
  for (const lf of filePaths) {
    const fn = path.basename(lf), dest = remotePath.endsWith('/') ? remotePath + fn : remotePath + '/' + fn;
    await new Promise((res, rej) => { s.sftp.fastPut(lf, dest, { step: (t, c, total) => mainWindow.webContents.send('sftp:progress', { sftpId, transferred: t, total, filename: fn }) }, (err) => { if (err) rej(err); else res(); }); });
    results.push(fn);
  }
  return { success: true, files: results };
});
ipcMain.handle('sftp:mkdir', async (_, { sftpId, remotePath }) => {
  const s = sftpSessions.get(sftpId); if (!s) throw new Error('SFTP 会话不存在');
  return new Promise((res, rej) => { s.sftp.mkdir(remotePath, (err) => { if (err) rej(err); else res(true); }); });
});
ipcMain.handle('sftp:delete', async (_, { sftpId, remotePath, isDir }) => {
  const s = sftpSessions.get(sftpId); if (!s) throw new Error('SFTP 会话不存在');
  return new Promise((res, rej) => { (isDir ? s.sftp.rmdir : s.sftp.unlink).call(s.sftp, remotePath, (err) => { if (err) rej(err); else res(true); }); });
});
ipcMain.handle('sftp:rename', async (_, { sftpId, oldPath, newPath }) => {
  const s = sftpSessions.get(sftpId); if (!s) throw new Error('SFTP 会话不存在');
  return new Promise((res, rej) => { s.sftp.rename(oldPath, newPath, (err) => { if (err) rej(err); else res(true); }); });
});
ipcMain.handle('sftp:close', (_, sftpId) => {
  const s = sftpSessions.get(sftpId); if (s) { try { s.client.end(); } catch(e){} sftpSessions.delete(sftpId); } return true;
});

// 日志
ipcMain.handle('log:openDir', () => { const dir = store.get('settings').logDir; if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); shell.openPath(dir); });
ipcMain.handle('log:listFiles', () => {
  const dir = store.get('settings').logDir;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.log')).map(f => { const st = fs.statSync(path.join(dir, f)); return { name: f, size: st.size, mtime: st.mtime }; }).sort((a,b) => b.mtime - a.mtime);
});

// 连通性测试
ipcMain.handle('ssh:test', async (_, config) => {
  return new Promise((resolve) => {
    const client = new Client();
    const timer = setTimeout(() => { client.destroy(); resolve({ success: false, message: '连接超时' }); }, 8000);
    client.on('ready', () => { clearTimeout(timer); client.end(); resolve({ success: true, message: '连接成功！' }); });
    client.on('error', (err) => { clearTimeout(timer); resolve({ success: false, message: err.message }); });
    client.connect(buildAuthConfig(config));
  });
});