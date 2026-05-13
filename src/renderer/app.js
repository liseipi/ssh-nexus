/* ════════════════════════════════════════════════════════
   SSH Nexus — 渲染进程主逻辑
   ════════════════════════════════════════════════════════ */

// ── 状态管理 ──────────────────────────────────────────────
const State = {
  connections: [],
  groups: [],
  settings: {},
  tabs: [],          // { id, type:'ssh'|'local', title, sessionId, connectionId? }
  activeTab: null,
  terminals: {},     // sessionId → Terminal 实例
  fitAddons: {},     // sessionId → FitAddon
  cleanups: {},      // sessionId → cleanup 函数数组
  connectedSessions: new Set(),
  contextTarget: null, // 右键菜单目标连接
};

// ── DOM 引用 ──────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const DOM = {
  connectionList: $('#connection-list'),
  tabsContainer: $('#tabs-container'),
  terminalsContainer: $('#terminals-container'),
  welcomeScreen: $('#welcome-screen'),
  modalOverlay: $('#modal-overlay'),
  contextMenu: $('#context-menu'),
  toastContainer: $('#toast-container'),
  searchInput: $('#search-input'),
  testResult: $('#test-result'),
  groupSelect: $('#conn-group'),
};

// ── 初始化 ──────────────────────────────────────────────
async function init() {
  State.connections = await window.electron.connections.getAll();
  State.groups = await window.electron.groups.getAll();
  State.settings = await window.electron.settings.get();

  renderConnections();
  populateGroupSelect();
  bindEvents();
}

// ── 渲染连接列表 ─────────────────────────────────────────
function renderConnections(filter = '') {
  const filtered = State.connections.filter(c =>
    c.name.toLowerCase().includes(filter.toLowerCase()) ||
    c.host.toLowerCase().includes(filter.toLowerCase())
  );

  DOM.connectionList.innerHTML = '';

  if (filtered.length === 0) {
    DOM.connectionList.innerHTML = `
      <div class="empty-state" id="empty-connections">
        <div class="empty-icon">⌁</div>
        <p>${filter ? '未找到匹配连接' : '暂无连接'}</p>
        <span>${filter ? '尝试其他关键词' : '点击 + 添加你的第一个 SSH 连接'}</span>
      </div>`;
    return;
  }

  // 按分组归类
  const grouped = {};
  filtered.forEach(c => {
    const g = c.group || '默认分组';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(c);
  });

  Object.entries(grouped).forEach(([group, conns]) => {
    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="6,9 12,15 18,9"/>
      </svg>
      ${group} <span style="color:var(--text-muted);margin-left:4px">${conns.length}</span>
    `;
    DOM.connectionList.appendChild(header);

    conns.forEach(c => {
      const item = document.createElement('div');
      item.className = 'conn-item';
      item.dataset.id = c.id;
      if (State.connectedSessions.has(c.id)) item.classList.add('connected');

      const initials = c.name.slice(0, 2).toUpperCase();
      item.innerHTML = `
        <div class="conn-icon">${initials}</div>
        <div class="conn-info">
          <div class="conn-name">${escHtml(c.name)}</div>
          <div class="conn-addr">${escHtml(c.username)}@${escHtml(c.host)}:${c.port || 22}</div>
        </div>
        <div class="conn-status"></div>
      `;

      item.addEventListener('dblclick', () => connectToServer(c.id));
      item.addEventListener('contextmenu', (e) => showContextMenu(e, c.id));
      DOM.connectionList.appendChild(item);
    });
  });
}

function populateGroupSelect() {
  DOM.groupSelect.innerHTML = State.groups.map(g =>
    `<option value="${g}">${g}</option>`
  ).join('');
}

// ── 标签页管理 ───────────────────────────────────────────
function createTab(opts) {
  const { type, title, connectionId } = opts;
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const tab = { id: sessionId, type, title, sessionId, connectionId };
  State.tabs.push(tab);

  // 渲染标签
  const tabEl = document.createElement('div');
  tabEl.className = `tab ${type}`;
  tabEl.dataset.sid = sessionId;
  tabEl.innerHTML = `
    <div class="tab-dot"></div>
    <span class="tab-title">${escHtml(title)}</span>
    <button class="tab-close" title="关闭">
      <svg width="8" height="8" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.5"/></svg>
    </button>
  `;
  tabEl.addEventListener('click', (e) => {
    if (!e.target.closest('.tab-close')) switchTab(sessionId);
  });
  tabEl.querySelector('.tab-close').addEventListener('click', () => closeTab(sessionId));
  DOM.tabsContainer.appendChild(tabEl);

  // 创建终端容器
  const wrapper = document.createElement('div');
  wrapper.className = 'terminal-wrapper';
  wrapper.id = `tw-${sessionId}`;
  wrapper.innerHTML = `
    <div class="terminal-toolbar">
      <div class="terminal-info">${type === 'ssh' ? `SSH → ${title}` : '本地终端'}</div>
      <div class="terminal-status" id="status-${sessionId}">
        <div class="status-dot"></div>
        <span>连接中…</span>
      </div>
    </div>
    <div class="terminal-body" id="tb-${sessionId}"></div>
  `;
  DOM.terminalsContainer.appendChild(wrapper);

  // 隐藏欢迎页
  DOM.welcomeScreen.style.display = 'none';

  switchTab(sessionId);
  return { tab, sessionId };
}

function switchTab(sessionId) {
  State.activeTab = sessionId;

  // 更新标签样式
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const tabEl = document.querySelector(`.tab[data-sid="${sessionId}"]`);
  if (tabEl) tabEl.classList.add('active');

  // 显示对应终端
  document.querySelectorAll('.terminal-wrapper').forEach(w => w.classList.remove('active'));
  const wrapper = $(`#tw-${sessionId}`);
  if (wrapper) wrapper.classList.add('active');

  // 重新 fit 终端
  const fitAddon = State.fitAddons[sessionId];
  if (fitAddon) {
    setTimeout(() => {
      try { fitAddon.fit(); } catch(e) {}
    }, 50);
  }
}

function closeTab(sessionId) {
  // 断开连接
  window.electron.ssh.disconnect(sessionId);

  // 清理事件监听
  const cleanups = State.cleanups[sessionId] || [];
  cleanups.forEach(fn => fn());

  // 销毁终端
  const term = State.terminals[sessionId];
  if (term) { try { term.dispose(); } catch(e) {} }

  delete State.terminals[sessionId];
  delete State.fitAddons[sessionId];
  delete State.cleanups[sessionId];

  // 移除 DOM
  document.querySelector(`.tab[data-sid="${sessionId}"]`)?.remove();
  $(`#tw-${sessionId}`)?.remove();

  // 从状态中移除
  const idx = State.tabs.findIndex(t => t.id === sessionId);
  if (idx >= 0) State.tabs.splice(idx, 1);

  // 切换到其他标签或显示欢迎页
  if (State.activeTab === sessionId) {
    if (State.tabs.length > 0) {
      switchTab(State.tabs[State.tabs.length - 1].id);
    } else {
      State.activeTab = null;
      DOM.welcomeScreen.style.display = 'flex';
    }
  }
}

// ── 终端创建 ─────────────────────────────────────────────
function createTerminal(sessionId) {
  const term = new Terminal({
    fontFamily: State.settings.fontFamily || 'JetBrains Mono, Fira Code, monospace',
    fontSize: State.settings.fontSize || 14,
    lineHeight: 1.4,
    letterSpacing: 0,
    cursorStyle: State.settings.cursorStyle || 'block',
    cursorBlink: true,
    scrollback: State.settings.scrollback || 1000,
    allowTransparency: true,
    theme: {
      background: '#0d1117',
      foreground: '#e6edf3',
      cursor: '#4ade80',
      cursorAccent: '#0d1117',
      black: '#21262d',
      red: '#f85149',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#b1bac4',
      brightBlack: '#6e7681',
      brightRed: '#ff7b72',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#f0f6fc',
      selectionBackground: 'rgba(74,222,128,0.2)',
    }
  });

  const fitAddon = new FitAddon.FitAddon();
  const webLinksAddon = new WebLinksAddon.WebLinksAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(webLinksAddon);

  const container = $(`#tb-${sessionId}`);
  term.open(container);
  setTimeout(() => { try { fitAddon.fit(); } catch(e) {} }, 100);

  State.terminals[sessionId] = term;
  State.fitAddons[sessionId] = fitAddon;

  // 窗口 resize 时重新 fit
  const resizeObserver = new ResizeObserver(() => {
    if (State.activeTab === sessionId) {
      try { fitAddon.fit(); } catch(e) {}
      const { cols, rows } = term;
      window.electron.ssh.resize({ sessionId, cols, rows });
    }
  });
  resizeObserver.observe(container);

  // 键盘输入 → SSH
  term.onData((data) => {
    window.electron.ssh.write({ sessionId, data });
  });

  // 注册清理
  if (!State.cleanups[sessionId]) State.cleanups[sessionId] = [];
  State.cleanups[sessionId].push(() => resizeObserver.disconnect());

  return { term, fitAddon };
}

// ── SSH 连接 ──────────────────────────────────────────────
async function connectToServer(connectionId) {
  const conn = State.connections.find(c => c.id === connectionId);
  if (!conn) return;

  const { tab, sessionId } = createTab({
    type: 'ssh',
    title: conn.name,
    connectionId
  });

  // 显示连接中的遮罩
  const wrapper = $(`#tw-${sessionId}`);
  const overlay = document.createElement('div');
  overlay.className = 'connecting-overlay';
  overlay.innerHTML = `
    <div class="spinner"></div>
    <div class="connecting-label">正在连接 ${conn.host}…</div>
  `;
  wrapper.appendChild(overlay);

  // 创建终端（先建好，连接成功后激活）
  createTerminal(sessionId);
  $(`#tb-${sessionId}`).style.visibility = 'hidden';

  try {
    await window.electron.ssh.connect({ sessionId, connectionId });

    // 连接成功
    overlay.remove();
    $(`#tb-${sessionId}`).style.visibility = 'visible';

    updateTerminalStatus(sessionId, true);
    State.connectedSessions.add(connectionId);
    renderConnections(DOM.searchInput.value);

    // 接收数据
    const offData = window.electron.ssh.onData(sessionId, (data) => {
      State.terminals[sessionId]?.write(data);
    });

    // 连接关闭
    const offClose = window.electron.ssh.onClose(sessionId, () => {
      updateTerminalStatus(sessionId, false);
      State.connectedSessions.delete(connectionId);
      renderConnections(DOM.searchInput.value);
      State.terminals[sessionId]?.writeln('\r\n\x1b[33m── 连接已断开 ──\x1b[0m');
    });

    State.cleanups[sessionId] = [...(State.cleanups[sessionId] || []), offData, offClose];

    showToast(`已连接到 ${conn.name}`, 'success');

  } catch (err) {
    overlay.innerHTML = `
      <div style="color:var(--red);font-family:var(--font-mono);font-size:13px;text-align:center;padding:20px">
        <div style="font-size:24px;margin-bottom:12px">✗</div>
        <div>连接失败</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:6px">${escHtml(err.message)}</div>
        <button onclick="this.closest('.terminal-wrapper').querySelector('.connecting-overlay').remove()" 
          style="margin-top:14px;padding:6px 14px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-secondary);cursor:pointer;font-size:12px">
          关闭
        </button>
      </div>
    `;
    showToast(`连接失败：${err.message}`, 'error');
  }
}

// ── 本地 Shell ───────────────────────────────────────────
async function openLocalShell() {
  const { tab, sessionId } = createTab({
    type: 'local',
    title: '本地终端',
  });

  createTerminal(sessionId);
  updateTerminalStatus(sessionId, true, '本地 Shell');

  await window.electron.local.shell({ sessionId });

  const offData = window.electron.ssh.onData(sessionId, (data) => {
    State.terminals[sessionId]?.write(data);
  });

  const offClose = window.electron.ssh.onClose(sessionId, () => {
    updateTerminalStatus(sessionId, false);
    State.terminals[sessionId]?.writeln('\r\n\x1b[33m── Shell 已退出 ──\x1b[0m');
  });

  State.cleanups[sessionId] = [...(State.cleanups[sessionId] || []), offData, offClose];
}

function updateTerminalStatus(sessionId, connected, label) {
  const statusEl = $(`#status-${sessionId}`);
  if (!statusEl) return;
  statusEl.className = `terminal-status ${connected ? '' : 'disconnected'}`;
  statusEl.innerHTML = `
    <div class="status-dot"></div>
    <span>${label || (connected ? '已连接' : '已断开')}</span>
  `;
}

// ── 连接配置 Modal ───────────────────────────────────────
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
  $('#conn-remark').value = conn?.remark || '';

  // 分组
  populateGroupSelect();
  if (conn?.group) DOM.groupSelect.value = conn.group;

  // 认证方式
  const authType = conn?.authType || 'password';
  document.querySelector(`input[name="auth-type"][value="${authType}"]`).checked = true;
  toggleAuthType(authType);

  // 跳板机
  $('#jump-host').value = conn?.jumpHost?.host || '';
  $('#jump-port').value = conn?.jumpHost?.port || 22;
  $('#jump-username').value = conn?.jumpHost?.username || '';
  $('#jump-password').value = conn?.jumpHost?.password || '';

  // 重置测试结果
  DOM.testResult.className = 'test-result';
  DOM.testResult.textContent = '';

  DOM.modalOverlay.classList.remove('hidden');
  $('#conn-name').focus();
}

function closeModal() {
  DOM.modalOverlay.classList.add('hidden');
}

function toggleAuthType(type) {
  if (type === 'password') {
    $('#auth-password-section').classList.remove('hidden');
    $('#auth-key-section').classList.add('hidden');
  } else {
    $('#auth-password-section').classList.add('hidden');
    $('#auth-key-section').classList.remove('hidden');
  }
}

async function saveConnection() {
  const name = $('#conn-name').value.trim();
  const host = $('#conn-host').value.trim();
  const username = $('#conn-username').value.trim();

  if (!name || !host || !username) {
    showToast('请填写必填项：名称、主机地址、用户名', 'error');
    return;
  }

  const authType = document.querySelector('input[name="auth-type"]:checked').value;
  const jumpHost = $('#jump-host').value.trim();

  const conn = {
    id: $('#conn-id').value || undefined,
    name,
    host,
    port: parseInt($('#conn-port').value) || 22,
    username,
    authType,
    password: authType === 'password' ? $('#conn-password').value : undefined,
    privateKeyPath: authType === 'privateKey' ? $('#conn-private-key').value : undefined,
    passphrase: authType === 'privateKey' ? $('#conn-passphrase').value : undefined,
    group: DOM.groupSelect.value,
    remark: $('#conn-remark').value.trim(),
    jumpHost: jumpHost ? {
      host: jumpHost,
      port: parseInt($('#jump-port').value) || 22,
      username: $('#jump-username').value.trim(),
      password: $('#jump-password').value,
    } : null,
  };

  const saved = await window.electron.connections.save(conn);
  State.connections = await window.electron.connections.getAll();
  renderConnections(DOM.searchInput.value);
  closeModal();
  showToast(`连接 "${saved.name}" 已保存`, 'success');
}

async function deleteConnection(id) {
  const conn = State.connections.find(c => c.id === id);
  if (!conn) return;
  if (!confirm(`确定删除连接 "${conn.name}"？`)) return;

  await window.electron.connections.delete(id);
  State.connections = await window.electron.connections.getAll();
  renderConnections(DOM.searchInput.value);
  showToast(`连接 "${conn.name}" 已删除`, 'info');
}

// ── 右键菜单 ─────────────────────────────────────────────
function showContextMenu(e, connId) {
  e.preventDefault();
  State.contextTarget = connId;

  const menu = DOM.contextMenu;
  menu.classList.remove('hidden');
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - 160)}px`;
}

function hideContextMenu() {
  DOM.contextMenu.classList.add('hidden');
  State.contextTarget = null;
}

// ── 测试连接 ─────────────────────────────────────────────
async function testConnection() {
  const config = {
    host: $('#conn-host').value.trim(),
    port: parseInt($('#conn-port').value) || 22,
    username: $('#conn-username').value.trim(),
    authType: document.querySelector('input[name="auth-type"]:checked').value,
    password: $('#conn-password').value,
    privateKeyPath: $('#conn-private-key').value,
  };

  if (!config.host || !config.username) {
    showToast('请先填写主机地址和用户名', 'error');
    return;
  }

  DOM.testResult.className = 'test-result';
  DOM.testResult.textContent = '测试中…';

  const result = await window.electron.ssh.test(config);
  DOM.testResult.className = `test-result ${result.success ? 'success' : 'error'}`;
  DOM.testResult.textContent = result.success ? '✓ ' + result.message : '✗ ' + result.message;
}

// ── Toast 通知 ───────────────────────────────────────────
function showToast(msg, type = 'info') {
  const icons = { success: '✓', error: '✗', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type]}</span><span>${escHtml(msg)}</span>`;
  DOM.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'none';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── 工具函数 ─────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── 事件绑定 ─────────────────────────────────────────────
function bindEvents() {
  // 标题栏
  $('#btn-minimize').addEventListener('click', () => window.electron.window.minimize());
  $('#btn-maximize').addEventListener('click', () => window.electron.window.maximize());
  $('#btn-close').addEventListener('click', () => window.electron.window.close());

  // 新建连接
  $('#btn-new-conn').addEventListener('click', () => openModal());
  $('#welcome-new-conn').addEventListener('click', () => openModal());

  // 本地终端
  $('#btn-local-shell').addEventListener('click', openLocalShell);
  $('#welcome-local-shell').addEventListener('click', openLocalShell);
  $('#btn-new-tab').addEventListener('click', openLocalShell);

  // 搜索
  DOM.searchInput.addEventListener('input', (e) => renderConnections(e.target.value));

  // Modal
  $('#modal-close').addEventListener('click', closeModal);
  $('#btn-cancel-conn').addEventListener('click', closeModal);
  $('#btn-save-conn').addEventListener('click', saveConnection);
  $('#btn-test-conn').addEventListener('click', testConnection);

  // 认证类型切换
  document.querySelectorAll('input[name="auth-type"]').forEach(r => {
    r.addEventListener('change', (e) => toggleAuthType(e.target.value));
  });

  // 跳板机展开
  $('#jump-toggle').addEventListener('click', () => {
    const sec = $('#jump-section');
    const tog = $('#jump-toggle');
    sec.classList.toggle('hidden');
    tog.classList.toggle('open');
  });

  // 右键菜单操作
  DOM.contextMenu.querySelectorAll('.ctx-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      const id = State.contextTarget;
      hideContextMenu();

      if (action === 'connect') connectToServer(id);
      else if (action === 'edit') {
        const conn = State.connections.find(c => c.id === id);
        if (conn) openModal(conn);
      }
      else if (action === 'duplicate') {
        await window.electron.connections.duplicate(id);
        State.connections = await window.electron.connections.getAll();
        renderConnections(DOM.searchInput.value);
        showToast('连接已复制', 'success');
      }
      else if (action === 'delete') deleteConnection(id);
    });
  });

  // 点击其他地方关闭右键菜单
  document.addEventListener('click', (e) => {
    if (!DOM.contextMenu.contains(e.target)) hideContextMenu();
  });

  // 点击遮罩关闭 Modal
  DOM.modalOverlay.addEventListener('click', (e) => {
    if (e.target === DOM.modalOverlay) closeModal();
  });

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openModal(); }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); openLocalShell(); }
      if (e.key === 'w' || e.key === 'W') { e.preventDefault(); if (State.activeTab) closeTab(State.activeTab); }
    }
    if (e.key === 'Escape') {
      closeModal();
      hideContextMenu();
    }
  });

  // Enter 键保存
  $('#modal-conn').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const active = document.activeElement;
      if (active.tagName === 'INPUT' && active.type !== 'submit') saveConnection();
    }
  });
}

// ── 启动 ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
