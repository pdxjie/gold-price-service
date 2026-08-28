#!/bin/bash

# 金价桌面浮窗启动脚本

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          Gold Price Desktop - 启动脚本                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVICE_ROOT="$PROJECT_ROOT/gold-price-service"

cd "$SERVICE_ROOT"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
    . "$HOME/.nvm/nvm.sh" 2>/dev/null
    nvm use >/dev/null 2>&1
fi

if [ ! -d "node_modules" ]; then
    echo "📦 依赖未安装，开始安装..."
    ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}" npm install
fi

echo "🚀 启动桌面浮窗..."
echo "   后端地址：http://localhost:3001"
echo "   采集频率：${COLLECT_INTERVAL_MS:-5000}ms"
echo ""

ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}" npm run desktop
