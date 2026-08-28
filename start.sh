#!/bin/bash

# 金价监控项目启动脚本
# 用于一键启动所有服务

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          Gold Price Monitor - 启动脚本                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

# 使用项目声明的 Node 版本
cd "$PROJECT_ROOT/gold-price-service"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    . "$HOME/.nvm/nvm.sh" 2>/dev/null
    nvm use >/dev/null 2>&1
fi

# 检查 Node.js
echo "🔍 检查环境..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js 未安装${NC}"
    echo "请安装 Node.js: https://nodejs.org/"
    exit 1
fi

echo -e "${GREEN}✅ Node.js $(node --version)${NC}"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm 未安装${NC}"
    exit 1
fi

echo -e "${GREEN}✅ npm $(npm --version)${NC}"
echo ""

# 检查依赖
echo "📦 检查依赖..."

if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  依赖未安装，开始安装...${NC}"
    npm install
    echo -e "${GREEN}✅ 依赖安装完成${NC}"
else
    echo -e "${GREEN}✅ 依赖已安装${NC}"
fi

echo ""

# 检查端口占用
echo "🔍 检查端口..."
PORT=3001

if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  端口 $PORT 已被占用${NC}"
    echo "是否终止占用该端口的进程？(y/n)"
    read -r response
    if [[ "$response" == "y" ]]; then
        PID=$(lsof -ti:$PORT)
        kill -9 $PID
        echo -e "${GREEN}✅ 已终止进程 $PID${NC}"
    else
        echo "请手动处理端口占用问题"
        exit 1
    fi
fi

echo ""

# 启动服务
echo "🚀 启动金价数据服务..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 创建日志目录
mkdir -p logs

# 启动服务（后台运行）
nohup env PORT=$PORT node node_modules/ts-node/dist/bin.js src/server.ts > logs/service.log 2>&1 < /dev/null &
SERVICE_PID=$!
disown "$SERVICE_PID" 2>/dev/null || true

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 3

# 检查服务状态
if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ 服务启动成功！${NC}"
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║                    服务信息                                    ║"
    echo "╠════════════════════════════════════════════════════════════════╣"
    echo "║ 服务地址：http://localhost:$PORT                              "
    echo "║ 进程 ID： $SERVICE_PID                                         "
    echo "║ 日志文件：$PROJECT_ROOT/gold-price-service/logs/service.log"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""

    # 测试 API
    echo "🧪 测试 API..."
    GOLD_PRICE=$(curl -s http://localhost:$PORT/api/gold/latest | grep -o '"price":[0-9.]*' | cut -d: -f2)

    if [ -n "$GOLD_PRICE" ]; then
        echo -e "${GREEN}✅ API 测试成功${NC}"
        echo "当前金价：$GOLD_PRICE 元/克"
    else
        echo -e "${YELLOW}⚠️  API 返回数据异常${NC}"
    fi

    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║                    常用命令                                    ║"
    echo "╠════════════════════════════════════════════════════════════════╣"
    echo "║ 查看日志：tail -f logs/service.log                            "
    echo "║ 停止服务：kill $SERVICE_PID                                   "
    echo "║ 测试接口：./test-api.sh                                       "
    echo "║ 查看进程：ps aux | grep node                                  "
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""

    echo "📱 下一步："
    echo "   1. 数据服务已启动"
    echo "   2. 运行 ./desktop.sh 打开桌面浮窗"
    echo "   3. 或直接通过 http://localhost:$PORT 调试接口"
    echo ""

    # 保存 PID
    echo $SERVICE_PID > logs/service.pid

    echo -e "${GREEN}🎉 启动完成！${NC}"

else
    echo -e "${RED}❌ 服务启动失败${NC}"
    echo "请查看日志：cat logs/service.log"
    exit 1
fi
