// ── 主题配置 ─────────────────────────────────────
const THEMES = {
  dark:      { bg:'#0d1117', fg:'#e6edf3', cursor:'#4ade80', sel:'rgba(74,222,128,.2)', black:'#21262d', red:'#f85149', green:'#3fb950', yellow:'#d29922', blue:'#58a6ff', magenta:'#bc8cff', cyan:'#39c5cf', white:'#b1bac4', brightBlack:'#6e7681', brightRed:'#ff7b72', brightGreen:'#56d364', brightYellow:'#e3b341', brightBlue:'#79c0ff', brightMagenta:'#d2a8ff', brightCyan:'#56d4dd', brightWhite:'#f0f6fc' },
  darker:    { bg:'#080c10', fg:'#e6edf3', cursor:'#4ade80', sel:'rgba(74,222,128,.2)', black:'#161b22', red:'#f85149', green:'#3fb950', yellow:'#d29922', blue:'#58a6ff', magenta:'#bc8cff', cyan:'#39c5cf', white:'#b1bac4', brightBlack:'#484f58', brightRed:'#ff7b72', brightGreen:'#56d364', brightYellow:'#e3b341', brightBlue:'#79c0ff', brightMagenta:'#d2a8ff', brightCyan:'#56d4dd', brightWhite:'#f0f6fc' },
  light:     { bg:'#ffffff', fg:'#1f2328', cursor:'#0969da', sel:'rgba(9,105,218,.15)', black:'#24292f', red:'#cf222e', green:'#116329', yellow:'#9a6700', blue:'#0969da', magenta:'#8250df', cyan:'#0550ae', white:'#6e7781', brightBlack:'#57606a', brightRed:'#a40e26', brightGreen:'#1a7f37', brightYellow:'#633c01', brightBlue:'#0349b4', brightMagenta:'#6639ba', brightCyan:'#003d82', brightWhite:'#8c959f' },
  nord:      { bg:'#2e3440', fg:'#eceff4', cursor:'#88c0d0', sel:'rgba(136,192,208,.25)', black:'#3b4252', red:'#bf616a', green:'#a3be8c', yellow:'#ebcb8b', blue:'#81a1c1', magenta:'#b48ead', cyan:'#88c0d0', white:'#e5e9f0', brightBlack:'#4c566a', brightRed:'#bf616a', brightGreen:'#a3be8c', brightYellow:'#ebcb8b', brightBlue:'#81a1c1', brightMagenta:'#b48ead', brightCyan:'#8fbcbb', brightWhite:'#eceff4' },
  solarized: { bg:'#002b36', fg:'#839496', cursor:'#2aa198', sel:'rgba(42,161,152,.25)', black:'#073642', red:'#dc322f', green:'#859900', yellow:'#b58900', blue:'#268bd2', magenta:'#d33682', cyan:'#2aa198', white:'#eee8d5', brightBlack:'#002b36', brightRed:'#cb4b16', brightGreen:'#586e75', brightYellow:'#657b83', brightBlue:'#839496', brightMagenta:'#6c71c4', brightCyan:'#93a1a1', brightWhite:'#fdf6e3' },
  dracula:   { bg:'#282a36', fg:'#f8f8f2', cursor:'#50fa7b', sel:'rgba(80,250,123,.2)', black:'#21222c', red:'#ff5555', green:'#50fa7b', yellow:'#f1fa8c', blue:'#bd93f9', magenta:'#ff79c6', cyan:'#8be9fd', white:'#f8f8f2', brightBlack:'#6272a4', brightRed:'#ff6e6e', brightGreen:'#69ff94', brightYellow:'#ffffa5', brightBlue:'#d6acff', brightMagenta:'#ff92df', brightCyan:'#a4ffff', brightWhite:'#ffffff' },
};

// ── 全局状态 ─────────────────────────────────────
const State = {
  connections: [], groups: [], settings: {}, snippets: [], savedTunnels: [],
  tabs: [], activeTab: null,
  terminals: {}, fitAddons: {}, cleanups: {},
  panes: {},       // sessionId → [{ paneId, term, fitAddon, sessionId }]
  activePanes: {}, // sessionId → paneId
  connectedSessions: new Set(),
  contextTarget: null,
  terminalCtxTarget: null, // { sessionId, paneId }
  sftpState: { id: null, connectionId: null, currentPath: '/' },
  activeTunnels: new Set(),
};

const $ = (s) => document.querySelector(s);

// ── 初始化 ───────────────────────────────────────
async function init() {
  State.connections = await window.electron.connections.getAll();
  State.groups      = await window.electron.groups.getAll();
  State.settings    = await window.electron.settings.get();
  State.snippets    = await window.electron.snippets.getAll();
  State.savedTunnels= await window.electron.tunnel.getSaved();

  applyTheme(State.settings.theme || 'dark');
  renderConnections();
  populateGroupSelect();
  bindEvents();

  // 隧道状态监听
  window.electron.tunnel.onStatus(({ tunnelId, status }) => {
    if (status === 'active') State.activeTunnels.add(tunnelId);
    else State.activeTunnels.delete(tunnelId);
    renderTunnelList();
  });
}

// ── 主题 ──────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  // 更新所有已开终端的主题
  const t = THEMES[theme] || THEMES.dark;
  Object.values(State.terminals).forEach(term => {
    try { term.options.theme = buildTermTheme(t, theme); } catch(e) {}
  });
  // 更新设置面板的选中状态
  document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === theme));
}

function buildTermTheme(t, themeName) {
  const bg = themeName === 'light' ? '#ffffff' : (t.bg || '#0d1117');
  return { background: bg, foreground: t.fg, cursor: t.cursor, cursorAccent: t.bg, selectionBackground: t.sel, black: t.black, red: t.red, green: t.green, yellow: t.yellow, blue: t.blue, magenta: t.magenta, cyan: t.cyan, white: t.white, brightBlack: t.brightBlack, brightRed: t.brightRed, brightGreen: t.brightGreen, brightYellow: t.brightYellow, brightBlue: t.brightBlue, brightMagenta: t.brightMagenta, brightCyan: t.brightCyan, brightWhite: t.brightWhite };
}

// ── 连接列表 ─────────────────────────────────────
function renderConnections(filter = '') {
  const list = $('#connection-list');
  const filtered = State.connections.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()) || c.host.toLowerCase().includes(filter.toLowerCase()));
  list.innerHTML = '';
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⌁</div><p>${filter ? '未找到匹配连接' : '暂无连接'}</p><span>${filter ? '尝试其他关键词' : '点击 + 添加第一个连接'}</span></div>`;
    return;
  }
  const grouped = {};
  filtered.forEach(c => { const g = c.group || '默认分组'; if (!grouped[g]) grouped[g] = []; grouped[g].push(c); });
  Object.entries(grouped).forEach(([group, conns]) => {
    const h = document.createElement('div'); h.className = 'group-header';
    h.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6,9 12,15 18,9"/></svg>${escHtml(group)}<span style="color:var(--text-muted);margin-left:4px">${conns.length}</span>`;
    list.appendChild(h);
    conns.forEach(c => {
      const item = document.createElement('div');
      item.className = 'conn-item' + (State.connectedSessions.has(c.id) ? ' connected' : '');
      item.dataset.id = c.id;
      item.innerHTML = `<div class="conn-icon">${c.name.slice(0,2).toUpperCase()}</div><div class="conn-info"><div class="conn-name">${escHtml(c.name)}</div><div class="conn-addr">${escHtml(c.username)}@${escHtml(c.host)}:${c.port||22}</div></div><div class="conn-status"></div>`;
      item.addEventListener('dblclick', () => connectToServer(c.id));
      item.addEventListener('contextmenu', e => showContextMenu(e, c.id));
      list.appendChild(item);
    });
  });
}

function populateGroupSelect() {
  $('#conn-group').innerHTML = State.groups.map(g => `<option value="${g}">${g}</option>`).join('');
}

// ── 标签页 ───────────────────────────────────────
function createTab({ type, title, connectionId }) {
  const sessionId = `s-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  State.tabs.push({ id: sessionId, type, title, sessionId, connectionId });

  const tabEl = document.createElement('div');
  tabEl.className = `tab ${type}`; tabEl.dataset.sid = sessionId;
  tabEl.innerHTML = `<div class="tab-dot"></div><span class="tab-title">${escHtml(title)}</span><button class="tab-close"><svg width="8" height="8" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.5"/></svg></button>`;
  tabEl.addEventListener('click', e => { if (!e.target.closest('.tab-close')) switchTab(sessionId); });
  tabEl.querySelector('.tab-close').addEventListener('click', () => closeTab(sessionId));
  $('#tabs-container').appendChild(tabEl);

  const wrapper = document.createElement('div');
  wrapper.className = 'terminal-wrapper'; wrapper.id = `tw-${sessionId}`;
  wrapper.innerHTML = `<div id="tc-${sessionId}" style="flex:1;position:relative;overflow:hidden;display:flex"></div>`;
  $('#terminals-container').appendChild(wrapper);

  $('#welcome-screen').style.display = 'none';
  switchTab(sessionId);
  return sessionId;
}

function switchTab(sessionId) {
  State.activeTab = sessionId;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[data-sid="${sessionId}"]`)?.classList.add('active');
  document.querySelectorAll('.terminal-wrapper').forEach(w => w.classList.remove('active'));
  $(`#tw-${sessionId}`)?.classList.add('active');
  // fit 所有 pane
  setTimeout(() => {
    (State.panes[sessionId] || []).forEach(p => { try { p.fitAddon.fit(); } catch(e){} });
  }, 50);
}

function closeTab(sessionId) {
  window.electron.ssh.disconnect(sessionId);
  (State.cleanups[sessionId] || []).forEach(fn => fn());
  (State.panes[sessionId] || []).forEach(p => { try { p.term.dispose(); } catch(e){} });
  delete State.terminals[sessionId]; delete State.fitAddons[sessionId]; delete State.cleanups[sessionId]; delete State.panes[sessionId]; delete State.activePanes[sessionId];
  document.querySelector(`.tab[data-sid="${sessionId}"]`)?.remove();
  $(`#tw-${sessionId}`)?.remove();
  const idx = State.tabs.findIndex(t => t.id === sessionId);
  if (idx >= 0) State.tabs.splice(idx, 1);
  if (State.activeTab === sessionId) {
    State.tabs.length ? switchTab(State.tabs[State.tabs.length - 1].id) : (() => { State.activeTab = null; $('#welcome-screen').style.display = 'flex'; })();
  }
}

// ── 终端创建（支持分屏）────────────────────────
function createPane(sessionId, container, isSecondary = false) {
  const paneId = `p-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
  const pane = document.createElement('div');
  pane.className = 'split-pane'; pane.id = `pane-${paneId}`;
  pane.innerHTML = `
    <div class="terminal-toolbar">
      <div class="terminal-info" id="tinfo-${paneId}">${isSecondary ? '终端' : ''}</div>
      <div class="terminal-status" id="tstatus-${paneId}"><div class="status-dot"></div><span>初始化…</span></div>
      <div class="terminal-toolbar-actions">
        <button class="icon-btn" title="发送命令片段" data-action="snippets" data-pane="${paneId}" data-sid="${sessionId}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16,18 22,12 16,6"/><polyline points="8,6 2,12 8,18"/></svg>
        </button>
        <button class="icon-btn" title="左右分屏" data-action="split-h" data-pane="${paneId}" data-sid="${sessionId}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
        </button>
        <button class="icon-btn" title="上下分屏" data-action="split-v" data-pane="${paneId}" data-sid="${sessionId}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/></svg>
        </button>
      </div>
    </div>
    <div class="terminal-body" id="tb-${paneId}"></div>`;

  container.appendChild(pane);

  const t = State.settings;
  const theme = THEMES[t.theme || 'dark'] || THEMES.dark;
  const term = new Terminal({
    fontFamily: t.fontFamily || 'JetBrains Mono, Fira Code, monospace',
    fontSize: t.fontSize || 14, lineHeight: 1.4, cursorStyle: t.cursorStyle || 'block',
    cursorBlink: true, scrollback: t.scrollback || 5000, allowTransparency: true,
    theme: buildTermTheme(theme, t.theme || 'dark'),
  });
  const fitAddon = new FitAddon.FitAddon();
  const webLinksAddon = new WebLinksAddon.WebLinksAddon();
  term.loadAddon(fitAddon); term.loadAddon(webLinksAddon);
  const body = $(`#tb-${paneId}`);
  term.open(body);
  setTimeout(() => { try { fitAddon.fit(); } catch(e){} }, 80);

  const ro = new ResizeObserver(() => {
    if (State.activeTab === sessionId) {
      try { fitAddon.fit(); } catch(e){}
      window.electron.ssh.resize({ sessionId, cols: term.cols, rows: term.rows });
    }
  });
  ro.observe(body);

  term.onData(data => window.electron.ssh.write({ sessionId, data }));

  // 分屏按钮
  pane.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const action = btn.dataset.action, sid = btn.dataset.sid;
      if (action === 'split-h') splitPane(sid, 'horizontal');
      else if (action === 'split-v') splitPane(sid, 'vertical');
      else if (action === 'snippets') openSnippetSendPanel(e, sid);
    });
  });

  // 右键菜单
  pane.addEventListener('contextmenu', e => {
    e.preventDefault();
    State.terminalCtxTarget = { sessionId, paneId };
    const menu = $('#terminal-ctx-menu');
    menu.classList.remove('hidden');
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - 160)}px`;
  });

  if (!State.panes[sessionId]) State.panes[sessionId] = [];
  State.panes[sessionId].push({ paneId, term, fitAddon });
  State.activePanes[sessionId] = paneId;
  State.terminals[sessionId] = term; // 主 terminal 引用
  State.fitAddons[sessionId] = fitAddon;

  if (!State.cleanups[sessionId]) State.cleanups[sessionId] = [];
  State.cleanups[sessionId].push(() => ro.disconnect());

  return { paneId, term, fitAddon };
}

function splitPane(sessionId, direction) {
  const container = $(`#tc-${sessionId}`);
  if (!container) return;
  // 把现有内容包进 split-container
  if (!container.querySelector('.split-container')) {
    const sc = document.createElement('div');
    sc.className = `split-container${direction === 'vertical' ? ' vertical' : ''}`;
    while (container.firstChild) sc.appendChild(container.firstChild);
    container.appendChild(sc);
    createPane(sessionId, sc, true);
  } else {
    const sc = container.querySelector('.split-container');
    sc.className = `split-container${direction === 'vertical' ? ' vertical' : ''}`;
    createPane(sessionId, sc, true);
  }
  setTimeout(() => { (State.panes[sessionId] || []).forEach(p => { try { p.fitAddon.fit(); } catch(e){} }); }, 80);
  showToast('分屏已创建', 'info');
}

// ── SSH 连接 ─────────────────────────────────────
async function connectToServer(connectionId) {
  const conn = State.connections.find(c => c.id === connectionId);
  if (!conn) return;

  const sessionId = createTab({ type: 'ssh', title: conn.name, connectionId });
  const container = $(`#tc-${sessionId}`);
  const { paneId, term } = createPane(sessionId, container);

  // 连接中遮罩
  const overlay = document.createElement('div');
  overlay.className = 'connecting-overlay';
  overlay.innerHTML = `<div class="spinner"></div><div class="connecting-label">正在连接 ${escHtml(conn.host)}…</div>`;
  $(`#pane-${paneId}`).appendChild(overlay);

  try {
    await window.electron.ssh.connect({ sessionId, connectionId });
    overlay.remove();
    updatePaneStatus(sessionId, paneId, true, conn.name);
    State.connectedSessions.add(connectionId);
    renderConnections($('#search-input').value);

    const offData = window.electron.ssh.onData(sessionId, d => {
      (State.panes[sessionId] || []).forEach(p => p.term.write(d));
    });
    const offClose = window.electron.ssh.onClose(sessionId, () => {
      updatePaneStatus(sessionId, paneId, false);
      State.connectedSessions.delete(connectionId);
      renderConnections($('#search-input').value);
      term.writeln('\r\n\x1b[33m── 连接已断开 ──\x1b[0m');
    });
    const offRecon = window.electron.ssh.onReconnecting(sessionId, ({ tries, delay }) => {
      showReconnectBanner(sessionId, paneId, tries, delay);
    });
    const offReconned = window.electron.ssh.onReconnected(sessionId, () => {
      hideReconnectBanner(sessionId, paneId);
      updatePaneStatus(sessionId, paneId, true, conn.name);
      term.writeln('\r\n\x1b[32m── 重新连接成功 ──\x1b[0m');
    });
    State.cleanups[sessionId].push(offData, offClose, offRecon, offReconned);
    showToast(`已连接到 ${conn.name}`, 'success');
  } catch (err) {
    overlay.innerHTML = `<div style="text-align:center;color:var(--red);font-family:var(--font-mono);font-size:12px;padding:20px"><div style="font-size:22px;margin-bottom:10px">✗</div><div>连接失败</div><div style="color:var(--text-muted);margin-top:6px;font-size:11px">${escHtml(err.message)}</div><button onclick="this.closest('.connecting-overlay').remove()" style="margin-top:12px;padding:5px 14px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:4px;color:var(--text-secondary);cursor:pointer;font-size:11.5px">关闭</button></div>`;
    showToast(`连接失败：${err.message}`, 'error');
  }
}

function updatePaneStatus(sessionId, paneId, connected, label) {
  const el = $(`#tstatus-${paneId}`);
  if (!el) return;
  el.className = `terminal-status${connected ? '' : ' disconnected'}`;
  el.innerHTML = `<div class="status-dot"></div><span>${label || (connected ? '已连接' : '已断开')}</span>`;
}

function showReconnectBanner(sessionId, paneId, tries, delay) {
  const pane = $(`#pane-${paneId}`);
  if (!pane) return;
  let b = pane.querySelector('.reconnect-banner');
  if (!b) { b = document.createElement('div'); b.className = 'reconnect-banner'; pane.insertBefore(b, pane.querySelector('.terminal-body')); }
  b.innerHTML = `<span>第 ${tries} 次重连中，${delay/1000}s 后尝试…</span><button onclick="window.electron.ssh.disconnect('${sessionId}')">取消</button>`;
}

function hideReconnectBanner(sessionId, paneId) {
  $(`#pane-${paneId}`)?.querySelector('.reconnect-banner')?.remove();
}

// ── 本地 Shell ───────────────────────────────────
async function openLocalShell() {
  const sessionId = createTab({ type: 'local', title: '本地终端' });
  const container = $(`#tc-${sessionId}`);
  const { paneId, term } = createPane(sessionId, container);
  updatePaneStatus(sessionId, paneId, true, '本地 Shell');
  await window.electron.local.shell({ sessionId });
  const offData = window.electron.ssh.onData(sessionId, d => { (State.panes[sessionId]||[]).forEach(p => p.term.write(d)); });
  const offClose = window.electron.ssh.onClose(sessionId, () => { updatePaneStatus(sessionId, paneId, false); term.writeln('\r\n\x1b[33m── Shell 已退出 ──\x1b[0m'); });
  State.cleanups[sessionId].push(offData, offClose);
}

// ── SFTP ─────────────────────────────────────────
async function openSftp(connectionId) {
  const conn = State.connections.find(c => c.id === connectionId);
  if (!conn) return;
  const sftpId = `sftp-${Date.now()}`;
  State.sftpState = { id: sftpId, connectionId, currentPath: '/' };
  showToast('SFTP 连接中…', 'info');
  try {
    await window.electron.sftp.open({ sftpId, connectionId });
    const panel = $('#sftp-panel');
    panel.classList.remove('hidden');
    await loadSftpDir('/');
    showToast(`SFTP 已连接 ${conn.name}`, 'success');
  } catch(e) { showToast('SFTP 连接失败：' + e.message, 'error'); }

  window.electron.sftp.onProgress(({ transferred, total, filename }) => {
    const pct = total ? Math.round(transferred/total*100) : 0;
    const bar = $('#sftp-progress-bar'), inner = $('#sftp-progress-inner'), label = $('#sftp-progress-label');
    bar.classList.remove('hidden'); inner.style.width = pct + '%'; label.textContent = `${pct}% — ${filename}`;
    if (pct >= 100) setTimeout(() => bar.classList.add('hidden'), 1200);
  });
}

async function loadSftpDir(remotePath) {
  const { id } = State.sftpState;
  try {
    const items = await window.electron.sftp.list({ sftpId: id, remotePath });
    State.sftpState.currentPath = remotePath;
    $('#sftp-path-input').value = remotePath;
    const list = $('#sftp-file-list');
    list.innerHTML = '';
    const sorted = items.sort((a,b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
    sorted.forEach(f => {
      const row = document.createElement('div'); row.className = 'sftp-item';
      const icon = f.isDir ? `<svg class="sftp-item-icon dir" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>` : `<svg class="sftp-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13,2 13,9 20,9"/></svg>`;
      const size = f.isFile ? fmtSize(f.size) : '';
      row.innerHTML = `${icon}<span class="sftp-item-name">${escHtml(f.name)}</span><span class="sftp-item-size">${size}</span><div class="sftp-item-actions"><button class="icon-btn small" data-action="download" title="下载"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button><button class="icon-btn small" data-action="delete" title="删除"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button></div>`;

      if (f.isDir) row.addEventListener('dblclick', () => { const np = remotePath.endsWith('/') ? remotePath + f.name : remotePath + '/' + f.name; loadSftpDir(np); });
      row.querySelector('[data-action="download"]').addEventListener('click', async e => { e.stopPropagation(); const fp = remotePath.endsWith('/') ? remotePath + f.name : remotePath + '/' + f.name; const r = await window.electron.sftp.download({ sftpId: id, remotePath: fp }); if (r.success) showToast('下载完成', 'success'); });
      row.querySelector('[data-action="delete"]').addEventListener('click', async e => { e.stopPropagation(); if (!confirm(`删除 ${f.name}？`)) return; const fp = remotePath.endsWith('/') ? remotePath + f.name : remotePath + '/' + f.name; await window.electron.sftp.delete({ sftpId: id, remotePath: fp, isDir: f.isDir }); loadSftpDir(remotePath); showToast('已删除', 'info'); });
      list.appendChild(row);
    });
  } catch(e) { showToast('目录读取失败：' + e.message, 'error'); }
}

function fmtSize(bytes) {
  if (!bytes) return '0 B';
  const u = ['B','KB','MB','GB']; let i = 0, n = bytes;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + ' ' + u[i];
}

// ── Snippets ─────────────────────────────────────
function openSnippetsModal() {
  $('#modal-snippets-overlay').classList.remove('hidden');
  renderSnippetList();
}

function renderSnippetList(filter = '') {
  const list = $('#snippet-list');
  list.innerHTML = '';
  const items = filter ? State.snippets.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()) || (s.command||'').toLowerCase().includes(filter.toLowerCase())) : State.snippets;
  items.forEach(s => {
    const item = document.createElement('div'); item.className = 'snippet-item'; item.dataset.id = s.id;
    item.innerHTML = `<span>${escHtml(s.name)}</span><button class="snippet-item-del" title="删除">×</button>`;
    item.addEventListener('click', e => { if (!e.target.classList.contains('snippet-item-del')) openSnippetEdit(s.id); });
    item.querySelector('.snippet-item-del').addEventListener('click', async e => { e.stopPropagation(); if (!confirm(`删除片段 "${s.name}"？`)) return; await window.electron.snippets.delete(s.id); State.snippets = await window.electron.snippets.getAll(); renderSnippetList(); showToast('已删除', 'info'); });
    list.appendChild(item);
  });
}

function openSnippetEdit(id) {
  document.querySelectorAll('.snippet-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`.snippet-item[data-id="${id}"]`)?.classList.add('active');
  const s = id === 'new' ? { id: '', name: '', command: '', description: '', tags: '' } : State.snippets.find(x => x.id === id);
  if (!s) return;
  const editor = $('#snippet-editor');
  editor.innerHTML = `
    <div class="form-group"><label>名称</label><input type="text" id="snip-name" value="${escHtml(s.name)}" placeholder="片段名称"></div>
    <div class="form-group"><label>命令</label><textarea id="snip-cmd" placeholder="输入命令，支持多行">${escHtml(s.command||'')}</textarea></div>
    <div class="form-group"><label>描述（可选）</label><input type="text" id="snip-desc" value="${escHtml(s.description||'')}" placeholder="简短描述"></div>
    <div class="form-group"><label>标签（逗号分隔）</label><input type="text" id="snip-tags" value="${escHtml(Array.isArray(s.tags) ? s.tags.join(',') : (s.tags||''))}" placeholder="linux,monitor"></div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="btn primary" id="snip-save">保存</button>
      ${id !== 'new' && s.id ? `<button class="btn outline" id="snip-run" title="发送到当前终端">发送到终端</button>` : ''}
    </div>`;
  $('#snip-save').addEventListener('click', async () => {
    const name = $('#snip-name').value.trim(), command = $('#snip-cmd').value.trim();
    if (!name || !command) { showToast('名称和命令不能为空', 'error'); return; }
    const tagsRaw = $('#snip-tags').value.trim();
    const updated = { id: s.id || undefined, name, command, description: $('#snip-desc').value.trim(), tags: tagsRaw ? tagsRaw.split(',').map(t => t.trim()) : [] };
    await window.electron.snippets.save(updated);
    State.snippets = await window.electron.snippets.getAll();
    renderSnippetList(); showToast('片段已保存', 'success');
  });
  $('#snip-run')?.addEventListener('click', () => {
    if (!State.activeTab) { showToast('没有活动的终端', 'error'); return; }
    window.electron.ssh.write({ sessionId: State.activeTab, data: s.command + '\n' });
    showToast(`已发送：${s.name}`, 'success');
  });
}

function openSnippetSendPanel(e, sessionId) {
  const panel = $('#snippet-send-panel');
  panel.classList.remove('hidden');
  panel.style.left = `${Math.min(e.clientX, window.innerWidth - 310)}px`;
  panel.style.top = `${Math.min(e.clientY + 10, window.innerHeight - 280)}px`;
  renderSnippetSendList('', sessionId);
  $('#snippet-send-search').value = '';
  $('#snippet-send-search').focus();
  $('#snippet-send-search').oninput = e => renderSnippetSendList(e.target.value, sessionId);
  panel.dataset.sid = sessionId;
}

function renderSnippetSendList(filter, sessionId) {
  const list = $('#snippet-send-list'); list.innerHTML = '';
  const items = filter ? State.snippets.filter(s => s.name.toLowerCase().includes(filter.toLowerCase())) : State.snippets;
  if (!items.length) { list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px">暂无片段</div>'; return; }
  items.forEach(s => {
    const item = document.createElement('div'); item.className = 'snippet-send-item';
    item.innerHTML = `<div class="snippet-send-item-name">${escHtml(s.name)}</div><div class="snippet-send-item-cmd">${escHtml(s.command)}</div>`;
    item.addEventListener('click', () => {
      window.electron.ssh.write({ sessionId, data: s.command + '\n' });
      $('#snippet-send-panel').classList.add('hidden');
      showToast(`已发送：${s.name}`, 'success');
    });
    list.appendChild(item);
  });
}

// ── SSH 隧道 ─────────────────────────────────────
function openTunnelsModal() {
  $('#modal-tunnels-overlay').classList.remove('hidden');
  // 填充连接下拉
  const sel = $('#tunnel-conn');
  sel.innerHTML = State.connections.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  renderTunnelList();
}

function renderTunnelList() {
  const list = $('#tunnel-list'); if (!list) return;
  list.innerHTML = '';
  if (!State.savedTunnels.length) { list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px">暂无隧道配置</div>'; return; }
  State.savedTunnels.forEach(t => {
    const active = State.activeTunnels.has(t.id);
    const conn = State.connections.find(c => c.id === t.connectionId);
    const detail = t.type === 'dynamic' ? `SOCKS5 代理 → 本地:${t.localPort}` : `本地:${t.localPort} → ${t.remoteHost}:${t.remotePort}`;
    const row = document.createElement('div'); row.className = 'tunnel-row';
    row.innerHTML = `<div class="tunnel-status-dot${active ? ' active' : ''}"></div><div class="tunnel-row-info"><div class="tunnel-row-name">${escHtml(t.name||'未命名')}</div><div class="tunnel-row-detail">${escHtml(conn?.name||'')} · ${detail}</div></div><div class="tunnel-actions"><button class="btn small ${active ? 'outline' : 'primary'}" data-id="${t.id}">${active ? '停止' : '启动'}</button><button class="btn small outline" data-del="${t.id}">删除</button></div>`;
    row.querySelector(`[data-id="${t.id}"]`).addEventListener('click', async () => {
      if (active) {
        await window.electron.tunnel.stop(t.id);
        State.activeTunnels.delete(t.id);
      } else {
        try {
          await window.electron.tunnel.start({ tunnelId: t.id, connectionId: t.connectionId, localPort: t.localPort, remoteHost: t.remoteHost, remotePort: t.remotePort, type: t.type });
          State.activeTunnels.add(t.id);
          showToast(`隧道 ${t.name} 已启动，本地端口：${t.localPort}`, 'success');
        } catch(e) { showToast('隧道启动失败：' + e.message, 'error'); }
      }
      renderTunnelList();
    });
    row.querySelector(`[data-del="${t.id}"]`).addEventListener('click', async () => {
      if (!confirm(`删除隧道 "${t.name}"？`)) return;
      if (active) await window.electron.tunnel.stop(t.id);
      await window.electron.tunnel.deleteTunnel(t.id);
      State.savedTunnels = await window.electron.tunnel.getSaved();
      renderTunnelList();
    });
    list.appendChild(row);
  });
}

// ── 设置面板 ─────────────────────────────────────
function openSettings() {
  const s = State.settings;
  $('#s-font-size').value = s.fontSize || 14;
  $('#s-cursor-style').value = s.cursorStyle || 'block';
  $('#s-font-family').value = s.fontFamily || '';
  $('#s-scrollback').value = s.scrollback || 5000;
  $('#s-auto-reconnect').checked = !!s.autoReconnect;
  $('#s-reconnect-delay').value = s.autoReconnectDelay || 3000;
  $('#s-reconnect-max').value = s.autoReconnectMaxTries || 5;
  $('#s-log-enabled').checked = !!s.logEnabled;
  $('#s-log-dir').value = s.logDir || '';
  document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === (s.theme || 'dark')));
  // 切换到第一个 tab
  document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.stab-panel').forEach(p => p.classList.remove('active'));
  $('#stab-terminal').classList.add('active');
  document.querySelector('.stab[data-tab="terminal"]').classList.add('active');
  loadLogFiles();
  $('#modal-settings-overlay').classList.remove('hidden');
}

async function saveSettings() {
  const theme = document.querySelector('.theme-card.active')?.dataset.theme || 'dark';
  const newSettings = {
    ...State.settings,
    fontSize:             parseInt($('#s-font-size').value) || 14,
    cursorStyle:          $('#s-cursor-style').value,
    fontFamily:           $('#s-font-family').value || 'JetBrains Mono, monospace',
    scrollback:           parseInt($('#s-scrollback').value) || 5000,
    theme,
    autoReconnect:        $('#s-auto-reconnect').checked,
    autoReconnectDelay:   parseInt($('#s-reconnect-delay').value) || 3000,
    autoReconnectMaxTries:parseInt($('#s-reconnect-max').value) || 5,
    logEnabled:           $('#s-log-enabled').checked,
    logDir:               $('#s-log-dir').value.trim(),
  };
  await window.electron.settings.save(newSettings);
  State.settings = newSettings;
  applyTheme(theme);
  // 更新所有终端字体/大小
  Object.values(State.terminals).forEach(t => {
    try { t.options.fontSize = newSettings.fontSize; t.options.fontFamily = newSettings.fontFamily; t.options.cursorStyle = newSettings.cursorStyle; } catch(e){}
  });
  Object.values(State.fitAddons).forEach(f => { try { f.fit(); } catch(e){} });
  $('#modal-settings-overlay').classList.add('hidden');
  showToast('设置已保存', 'success');
}

async function loadLogFiles() {
  const files = await window.electron.log.listFiles();
  const el = $('#log-file-list');
  if (!el) return;
  el.innerHTML = files.slice(0, 20).map(f => `<div style="display:flex;justify-content:space-between;padding:5px 2px;border-bottom:1px solid var(--border-subtle);font-size:11.5px"><span style="font-family:var(--font-mono);color:var(--text-secondary)">${f.name}</span><span style="color:var(--text-muted)">${fmtSize(f.size)}</span></div>`).join('') || '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">暂无日志文件</div>';
}

// ── 连接 Modal ───────────────────────────────────
function openModal(conn = null) {
  $('#modal-title').textContent = conn ? '编辑连接' : '新建 SSH 连接';
  $('#conn-id').value = conn?.id || '';
  $('#conn-name').value = conn?.name || '';
  $('#conn-host').value = conn?.host || '';
  $('#conn-port').value = conn?.port || 22;
  $('#conn-username').value = conn?.username || '';
  $('#conn-password').value = conn?.password || '';
  $('#conn-private-key').value = conn?.privateKeyPath || '~/.ssh/id_rsa';
  $('#conn-passphrase').value = conn?.passphrase || '';
  $('#conn-keepalive').value = conn?.keepAliveSeconds ?? 300;
  $('#conn-remark').value = conn?.remark || '';
  populateGroupSelect();
  if (conn?.group) $('#conn-group').value = conn.group;
  const authType = conn?.authType || 'password';
  document.querySelector(`input[name="auth-type"][value="${authType}"]`).checked = true;
  toggleAuthType(authType);
  $('#jump-host').value = conn?.jumpHost?.host || '';
  $('#jump-port').value = conn?.jumpHost?.port || 22;
  $('#jump-username').value = conn?.jumpHost?.username || '';
  $('#jump-password').value = conn?.jumpHost?.password || '';
  $('#test-result').className = 'test-result'; $('#test-result').textContent = '';
  $('#modal-overlay').classList.remove('hidden');
  $('#conn-name').focus();
}

function toggleAuthType(type) {
  $('#auth-password-section').classList.toggle('hidden', type !== 'password');
  $('#auth-key-section').classList.toggle('hidden', type !== 'privateKey');
}

async function saveConnection() {
  const name = $('#conn-name').value.trim(), host = $('#conn-host').value.trim(), username = $('#conn-username').value.trim();
  if (!name || !host || !username) { showToast('请填写必填项：名称、主机、用户名', 'error'); return; }
  const authType = document.querySelector('input[name="auth-type"]:checked').value;
  const jumpHost = $('#jump-host').value.trim();
  const conn = {
    id: $('#conn-id').value || undefined, name, host, port: parseInt($('#conn-port').value)||22, username, authType,
    password: authType === 'password' ? $('#conn-password').value : undefined,
    privateKeyPath: authType === 'privateKey' ? $('#conn-private-key').value : undefined,
    passphrase: authType === 'privateKey' ? $('#conn-passphrase').value : undefined,
    group: $('#conn-group').value, remark: $('#conn-remark').value.trim(),
    keepAliveSeconds: parseInt($('#conn-keepalive').value) || 300,
    jumpHost: jumpHost ? { host: jumpHost, port: parseInt($('#jump-port').value)||22, username: $('#jump-username').value.trim(), password: $('#jump-password').value } : null,
  };
  const saved = await window.electron.connections.save(conn);
  State.connections = await window.electron.connections.getAll();
  renderConnections($('#search-input').value);
  $('#modal-overlay').classList.add('hidden');
  showToast(`连接 "${saved.name}" 已保存`, 'success');
}

async function testConnection() {
  const config = { host: $('#conn-host').value.trim(), port: parseInt($('#conn-port').value)||22, username: $('#conn-username').value.trim(), authType: document.querySelector('input[name="auth-type"]:checked').value, password: $('#conn-password').value, privateKeyPath: $('#conn-private-key').value };
  if (!config.host || !config.username) { showToast('请先填写主机和用户名', 'error'); return; }
  $('#test-result').className = 'test-result'; $('#test-result').textContent = '测试中…';
  const r = await window.electron.ssh.test(config);
  $('#test-result').className = `test-result ${r.success ? 'success' : 'error'}`;
  $('#test-result').textContent = (r.success ? '✓ ' : '✗ ') + r.message;
}

async function deleteConnection(id) {
  const conn = State.connections.find(c => c.id === id);
  if (!conn || !confirm(`删除连接 "${conn.name}"？`)) return;
  await window.electron.connections.delete(id);
  State.connections = await window.electron.connections.getAll();
  renderConnections($('#search-input').value);
  showToast(`"${conn.name}" 已删除`, 'info');
}

// ── 右键菜单 ─────────────────────────────────────
function showContextMenu(e, connId) {
  e.preventDefault(); State.contextTarget = connId;
  const m = $('#context-menu'); m.classList.remove('hidden');
  m.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
  m.style.top = `${Math.min(e.clientY, window.innerHeight - 220)}px`;
}

// ── Toast ─────────────────────────────────────────
function showToast(msg, type = 'info') {
  const icons = { success:'✓', error:'✗', info:'ℹ' };
  const t = document.createElement('div'); t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]}</span><span>${escHtml(msg)}</span>`;
  $('#toast-container').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── 事件绑定 ─────────────────────────────────────
function bindEvents() {
  // 标题栏
  $('#btn-minimize').onclick = () => window.electron.window.minimize();
  $('#btn-maximize').onclick = () => window.electron.window.maximize();
  $('#btn-close').onclick    = () => window.electron.window.close();

  // 新建连接
  $('#btn-new-conn').onclick     = () => openModal();
  $('#welcome-new-conn').onclick = () => openModal();

  // 本地终端
  $('#btn-local-shell').onclick    = openLocalShell;
  $('#welcome-local-shell').onclick= openLocalShell;
  $('#btn-new-tab').onclick        = openLocalShell;

  // 侧栏功能
  $('#btn-snippets').onclick = openSnippetsModal;
  $('#btn-tunnels').onclick  = openTunnelsModal;
  $('#btn-settings').onclick = openSettings;

  // 导入/导出
  $('#btn-export').onclick = async () => {
    const r = await window.electron.connections.export();
    if (r.success) showToast('导出成功：' + r.filePath, 'success');
  };
  $('#btn-import').onclick = async () => {
    const r = await window.electron.connections.import();
    if (r.success) { State.connections = await window.electron.connections.getAll(); renderConnections(); showToast(`导入完成，新增 ${r.added} 条`, 'success'); }
    else if (r.error) showToast('导入失败：' + r.error, 'error');
  };

  // 搜索
  $('#search-input').oninput = e => renderConnections(e.target.value);

  // 连接 Modal
  $('#modal-close').onclick    = () => $('#modal-overlay').classList.add('hidden');
  $('#btn-cancel-conn').onclick= () => $('#modal-overlay').classList.add('hidden');
  $('#btn-save-conn').onclick  = saveConnection;
  $('#btn-test-conn').onclick  = testConnection;
  $('#modal-overlay').onclick  = e => { if (e.target === $('#modal-overlay')) $('#modal-overlay').classList.add('hidden'); };

  document.querySelectorAll('input[name="auth-type"]').forEach(r => r.addEventListener('change', e => toggleAuthType(e.target.value)));
  $('#jump-toggle').onclick = () => { $('#jump-section').classList.toggle('hidden'); $('#jump-toggle').classList.toggle('open'); };

  // 连接右键菜单
  $('#context-menu').querySelectorAll('.ctx-item').forEach(item => {
    item.onclick = async () => {
      const action = item.dataset.action, id = State.contextTarget;
      $('#context-menu').classList.add('hidden'); State.contextTarget = null;
      if (action === 'connect') connectToServer(id);
      else if (action === 'sftp') openSftp(id);
      else if (action === 'edit') { const c = State.connections.find(x => x.id === id); if (c) openModal(c); }
      else if (action === 'duplicate') { await window.electron.connections.duplicate(id); State.connections = await window.electron.connections.getAll(); renderConnections(); showToast('已复制', 'success'); }
      else if (action === 'split') { connectToServer(id); }
      else if (action === 'delete') deleteConnection(id);
    };
  });

  // 终端右键菜单
  $('#terminal-ctx-menu').querySelectorAll('.ctx-item').forEach(item => {
    item.onclick = () => {
      const action = item.dataset.action;
      const { sessionId, paneId } = State.terminalCtxTarget || {};
      $('#terminal-ctx-menu').classList.add('hidden');
      if (action === 'split-h' && sessionId) splitPane(sessionId, 'horizontal');
      else if (action === 'split-v' && sessionId) splitPane(sessionId, 'vertical');
      else if (action === 'snippets-send' && sessionId) { const fakeE = { clientX: window.innerWidth/2, clientY: window.innerHeight/2 }; openSnippetSendPanel(fakeE, sessionId); }
      else if (action === 'clear' && sessionId) { const t = State.terminals[sessionId]; if (t) t.clear(); }
    };
  });

  // 关闭菜单
  document.addEventListener('click', e => {
    if (!$('#context-menu').contains(e.target)) $('#context-menu').classList.add('hidden');
    if (!$('#terminal-ctx-menu').contains(e.target)) $('#terminal-ctx-menu').classList.add('hidden');
    if (!$('#snippet-send-panel').contains(e.target) && !e.target.closest('[data-action="snippets"]')) $('#snippet-send-panel').classList.add('hidden');
  });

  // Snippets Modal
  $('#snippets-close').onclick = () => $('#modal-snippets-overlay').classList.add('hidden');
  $('#modal-snippets-overlay').onclick = e => { if (e.target === $('#modal-snippets-overlay')) $('#modal-snippets-overlay').classList.add('hidden'); };
  $('#snippet-new').onclick = () => { const newItem = document.createElement('div'); newItem.className = 'snippet-item active'; newItem.dataset.id = 'new'; newItem.innerHTML = '<span>新片段</span>'; $('#snippet-list').prepend(newItem); openSnippetEdit('new'); };
  $('#snippet-send-close').onclick = () => $('#snippet-send-panel').classList.add('hidden');

  // Tunnels Modal
  $('#tunnels-close').onclick = () => $('#modal-tunnels-overlay').classList.add('hidden');
  $('#modal-tunnels-overlay').onclick = e => { if (e.target === $('#modal-tunnels-overlay')) $('#modal-tunnels-overlay').classList.add('hidden'); };
  $('#tunnel-type').onchange = () => {
    const isDynamic = $('#tunnel-type').value === 'dynamic';
    $('#tunnel-target-row').style.opacity = isDynamic ? '.4' : '1';
    $('#tunnel-remote-host').disabled = isDynamic;
    $('#tunnel-remote-port').disabled = isDynamic;
  };
  $('#tunnel-save-btn').onclick = async () => {
    const tunnel = { id: $('#tunnel-id').value || undefined, name: $('#tunnel-name').value.trim(), connectionId: $('#tunnel-conn').value, type: $('#tunnel-type').value, localPort: parseInt($('#tunnel-local-port').value), remoteHost: $('#tunnel-remote-host').value.trim(), remotePort: parseInt($('#tunnel-remote-port').value) };
    if (!tunnel.name || !tunnel.connectionId || !tunnel.localPort) { showToast('请填写名称、连接和本地端口', 'error'); return; }
    await window.electron.tunnel.saveTunnel(tunnel);
    State.savedTunnels = await window.electron.tunnel.getSaved();
    $('#tunnel-id').value = ''; $('#tunnel-name').value = ''; $('#tunnel-local-port').value = ''; $('#tunnel-remote-host').value = ''; $('#tunnel-remote-port').value = '';
    renderTunnelList(); showToast('隧道已保存', 'success');
  };

  // 设置 Modal
  $('#settings-close').onclick  = () => $('#modal-settings-overlay').classList.add('hidden');
  $('#settings-cancel').onclick = () => $('#modal-settings-overlay').classList.add('hidden');
  $('#settings-save').onclick   = saveSettings;
  $('#modal-settings-overlay').onclick = e => { if (e.target === $('#modal-settings-overlay')) $('#modal-settings-overlay').classList.add('hidden'); };
  document.querySelectorAll('.stab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.stab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#stab-${btn.dataset.tab}`)?.classList.add('active');
      if (btn.dataset.tab === 'log') loadLogFiles();
    };
  });
  document.querySelectorAll('.theme-card').forEach(card => {
    card.onclick = () => { document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active')); card.classList.add('active'); applyTheme(card.dataset.theme); };
  });
  $('#s-log-open').onclick = () => window.electron.log.openDir();

  // SFTP
  $('#sftp-up').onclick = () => {
    const p = State.sftpState.currentPath;
    const parent = p === '/' ? '/' : p.replace(/\/[^/]+\/?$/, '') || '/';
    loadSftpDir(parent);
  };
  $('#sftp-refresh').onclick = () => loadSftpDir(State.sftpState.currentPath);
  $('#sftp-path-input').addEventListener('keydown', e => { if (e.key === 'Enter') loadSftpDir(e.target.value); });
  $('#sftp-upload-btn').onclick = async () => {
    const r = await window.electron.sftp.upload({ sftpId: State.sftpState.id, remotePath: State.sftpState.currentPath });
    if (r?.success) { loadSftpDir(State.sftpState.currentPath); showToast(`已上传 ${r.files.join(', ')}`, 'success'); }
  };
  $('#sftp-mkdir-btn').onclick = async () => {
    const name = prompt('新目录名称：'); if (!name) return;
    const p = State.sftpState.currentPath;
    await window.electron.sftp.mkdir({ sftpId: State.sftpState.id, remotePath: p.endsWith('/') ? p + name : p + '/' + name });
    loadSftpDir(p); showToast('目录已创建', 'success');
  };
  $('#sftp-close-btn').onclick = () => {
    if (State.sftpState.id) window.electron.sftp.close(State.sftpState.id);
    $('#sftp-panel').classList.add('hidden');
    State.sftpState = { id: null, connectionId: null, currentPath: '/' };
  };

  // 全局快捷键
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'n') { e.preventDefault(); openModal(); }
      if (e.key === 't') { e.preventDefault(); openLocalShell(); }
      if (e.key === 'w') { e.preventDefault(); if (State.activeTab) closeTab(State.activeTab); }
      if (e.key === 'd') { e.preventDefault(); if (State.activeTab) splitPane(State.activeTab, 'horizontal'); }
    }
    if (e.key === 'Escape') {
      ['#modal-overlay','#modal-snippets-overlay','#modal-tunnels-overlay','#modal-settings-overlay'].forEach(s => $(s)?.classList.add('hidden'));
      $('#context-menu').classList.add('hidden');
      $('#terminal-ctx-menu').classList.add('hidden');
      $('#snippet-send-panel').classList.add('hidden');
    }
  });

  // Enter 保存连接
  $('#modal-conn').addEventListener('keydown', e => { if (e.key === 'Enter' && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'submit') saveConnection(); });
}

document.addEventListener('DOMContentLoaded', init);