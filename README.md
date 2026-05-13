# SSH Nexus

一个现代化的 SSH 连接管理工具，基于 Electron + xterm.js 构建。

---

## 技术架构

```
SSH Nexus (Electron)
    └── xterm.js          ← 终端 UI 渲染
    └── node-pty          ← 伪终端 (PTY)，处理本地 Shell
    └── ssh2              ← SSH 协议实现，处理远程连接
    └── electron-store    ← 本地配置持久化存储
```

## 功能特性

- **SSH 连接管理** — 新建、编辑、删除、复制连接配置
- **分组管理** — 将连接按环境分组（生产/测试/开发）
- **多标签终端** — 同时打开多个 SSH 会话和本地终端
- **认证方式** — 支持密码认证和 SSH 私钥认证
- **跳板机支持** — 通过跳板机连接内网服务器
- **连通性测试** — 保存前验证连接是否可用
- **本地终端** — 内置本地 Shell 终端
- **搜索过滤** — 快速搜索连接列表

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 8
- macOS / Linux / Windows

### 安装依赖

```bash
# macOS / Linux
chmod +x install.sh && ./install.sh

# 或手动安装
npm install
```

**构建工具（编译 node-pty 需要）：**

```bash
# macOS
xcode-select --install

# Ubuntu / Debian
sudo apt-get install python3 make g++

# Windows
npm install -g windows-build-tools
```

### 启动应用

```bash
npm start          # 正常启动
npm run dev        # 开发模式（带 DevTools）
```

---

## 项目结构

```
ssh-nexus/
├── package.json
├── install.sh
├── src/
│   ├── main/
│   │   ├── main.js          ← Electron 主进程
│   │   └── preload.js       ← 安全桥接层 (contextBridge)
│   └── renderer/
│       ├── index.html       ← 应用入口 HTML
│       ├── app.js           ← 渲染进程逻辑
│       └── styles/
│           └── app.css      ← 全局样式
└── README.md
```

```shell
#打包
npm run build:mac

#解决“包含恶意软件”问题
sudo xattr -rd com.apple.quarantine "dist/mac/SSH Nexus.app"

#用 Control + 右键 方式打开
#右键 dist/mac/SSH Nexus.app → 按住 Control 键 → 点击 打开 → 再点 打开。
```

---

## 使用说明

### 新建 SSH 连接

1. 点击侧边栏 **+** 按钮，或使用快捷键 `Ctrl+N`
2. 填写连接名称、主机地址、用户名
3. 选择认证方式（密码 / 私钥）
4. 可选：配置跳板机
5. 点击「测试连接」验证，然后保存

### 连接到服务器

- **双击**侧边栏中的连接项，即可开启新标签连接

### 右键菜单

右键点击连接项，可以：
- 连接 / 编辑 / 复制 / 删除

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 新建连接 |
| `Ctrl+T` | 新建本地终端 |
| `Ctrl+W` | 关闭当前标签 |
| `Esc` | 关闭弹窗 |

---

## 扩展建议

后续可以添加的功能：

- [ ] SFTP 文件传输
- [ ] 终端日志记录
- [ ] 多窗口分屏
- [ ] 命令片段管理（Snippets）
- [ ] 主题切换
- [ ] 连接分享/导入导出
- [ ] 自动重连
- [ ] SSH Tunnel / 端口转发
