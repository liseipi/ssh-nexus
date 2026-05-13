#!/bin/bash
# SSH Nexus 安装脚本

echo "🚀 SSH Nexus 安装中..."
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "❌ 未检测到 Node.js，请先安装 Node.js >= 18"
  echo "   下载地址: https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 版本过低 (当前: $(node -v))，需要 >= 18"
  exit 1
fi

echo "✅ Node.js $(node -v) 已就绪"

# 安装依赖
echo ""
echo "📦 安装依赖包..."
npm install

if [ $? -ne 0 ]; then
  echo ""
  echo "❌ 依赖安装失败。如果是 node-pty 编译问题，请确保安装了构建工具："
  echo ""
  echo "   macOS:   xcode-select --install"
  echo "   Ubuntu:  sudo apt-get install python3 make g++"
  echo "   Windows: npm install -g windows-build-tools"
  exit 1
fi

echo ""
echo "✅ 所有依赖安装完成！"
echo ""
echo "══════════════════════════════════════"
echo "  启动命令: npm start"
echo "  开发模式: npm run dev  (带 DevTools)"
echo "══════════════════════════════════════"
echo ""
