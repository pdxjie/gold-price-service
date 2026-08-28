#!/bin/bash

# 金价监控项目状态检查脚本

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          Gold Price Monitor - 状态检查                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT/gold-price-service" 2>/dev/null || true
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    . "$HOME/.nvm/nvm.sh" 2>/dev/null
    nvm use >/dev/null 2>&1 || true
fi

# 1. 检查环境
echo -e "${BLUE}【1】环境检查${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v node &> /dev/null; then
    echo -e "${GREEN}✅ Node.js: $(node --version)${NC}"
else
    echo -e "${RED}❌ Node.js: 未安装${NC}"
fi

if command -v npm &> /dev/null; then
    echo -e "${GREEN}✅ npm: $(npm --version)${NC}"
else
    echo -e "${RED}❌ npm: 未安装${NC}"
fi

if [ -f "$PROJECT_ROOT/gold-price-service/node_modules/.bin/electron" ]; then
    ELECTRON_VERSION=$(cd "$PROJECT_ROOT/gold-price-service" && npx electron --version 2>/dev/null)
    echo -e "${GREEN}✅ Electron: $ELECTRON_VERSION${NC}"
else
    echo -e "${YELLOW}⚠️  Electron: 未安装${NC}"
fi

echo ""

# 2. 检查项目文件
echo -e "${BLUE}【2】项目文件检查${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

files=(
    "README.md"
    "desktop.sh"
    "gold-price-service/package.json"
    "gold-price-service/src/server.ts"
    "gold-price-service/src/services/price-collector.ts"
    "gold-price-service/src/services/sqlite-store.ts"
    "gold-price-service/electron/main.js"
    "gold-price-service/electron/renderer/index.html"
)

for file in "${files[@]}"; do
    if [ -f "$PROJECT_ROOT/$file" ]; then
        echo -e "${GREEN}✅ $file${NC}"
    else
        echo -e "${RED}❌ $file 缺失${NC}"
    fi
done

echo ""

# 3. 检查依赖
echo -e "${BLUE}【3】依赖检查${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -d "$PROJECT_ROOT/gold-price-service/node_modules" ]; then
    MODULE_COUNT=$(ls -1 "$PROJECT_ROOT/gold-price-service/node_modules" | wc -l)
    echo -e "${GREEN}✅ Node 依赖已安装 ($MODULE_COUNT 个模块)${NC}"
else
    echo -e "${YELLOW}⚠️  Node 依赖未安装${NC}"
    echo "   运行：cd gold-price-service && npm install"
fi

echo ""

# 4. 检查服务状态
echo -e "${BLUE}【4】服务状态检查${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

PID_FILE="$PROJECT_ROOT/gold-price-service/logs/service.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p $PID > /dev/null 2>&1; then
        echo -e "${GREEN}✅ 服务运行中 (PID: $PID)${NC}"

        # 检查端口
        if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo -e "${GREEN}✅ 端口 3001 正在监听${NC}"
        else
            echo -e "${RED}❌ 端口 3001 未监听${NC}"
        fi
    else
        echo -e "${RED}❌ 服务未运行 (PID 文件存在但进程不存在)${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  服务未运行 (PID 文件不存在)${NC}"
    echo "   运行：./start.sh"
fi

echo ""

# 5. 测试 API
echo -e "${BLUE}【5】API 测试${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if curl -s --max-time 2 http://localhost:3001/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ 健康检查: 正常${NC}"

    # 获取金价
    RESPONSE=$(curl -s --max-time 5 http://localhost:3001/api/gold/latest 2>/dev/null)

    if [ -n "$RESPONSE" ]; then
        PRICE=$(echo $RESPONSE | grep -o '"price":[0-9.]*' | cut -d: -f2)
        SYMBOL=$(echo $RESPONSE | grep -o '"symbol":"[^"]*"' | cut -d'"' -f4)
        SOURCE=$(echo $RESPONSE | grep -o '"source":"[^"]*"' | cut -d'"' -f4)

        if [ -n "$PRICE" ]; then
            echo -e "${GREEN}✅ 金价接口: 正常${NC}"
            echo "   当前金价: $PRICE 元/克"
            echo "   品种代码: $SYMBOL"
            echo "   数据源: $SOURCE"
        else
            echo -e "${YELLOW}⚠️  金价接口: 返回异常${NC}"
        fi
    else
        echo -e "${RED}❌ 金价接口: 超时或无响应${NC}"
    fi
else
    echo -e "${RED}❌ 服务无响应${NC}"
    echo "   请先启动服务：./start.sh"
fi

echo ""

# 6. 磁盘空间
echo -e "${BLUE}【6】磁盘空间${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -d "$PROJECT_ROOT/gold-price-service/node_modules" ]; then
    NODE_MODULES_SIZE=$(du -sh "$PROJECT_ROOT/gold-price-service/node_modules" 2>/dev/null | cut -f1)
    echo "Node 模块占用: $NODE_MODULES_SIZE"
fi

if [ -d "$PROJECT_ROOT/gold-price-service/logs" ]; then
    LOGS_SIZE=$(du -sh "$PROJECT_ROOT/gold-price-service/logs" 2>/dev/null | cut -f1)
    echo "日志文件占用: $LOGS_SIZE"
fi

if [ -f "$PROJECT_ROOT/gold-price-service/data/gold-prices.sqlite" ]; then
    DB_SIZE=$(du -sh "$PROJECT_ROOT/gold-price-service/data/gold-prices.sqlite" 2>/dev/null | cut -f1)
    echo "SQLite 数据库: $DB_SIZE"
fi

PROJECT_SIZE=$(du -sh "$PROJECT_ROOT" 2>/dev/null | cut -f1)
echo "项目总大小: $PROJECT_SIZE"

echo ""

# 7. 日志查看
echo -e "${BLUE}【7】最近日志${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

LOG_FILE="$PROJECT_ROOT/gold-price-service/logs/service.log"

if [ -f "$LOG_FILE" ]; then
    echo "最后 10 行日志："
    echo "---"
    tail -10 "$LOG_FILE" 2>/dev/null || echo "(日志文件为空)"
    echo "---"
    echo "完整日志：tail -f $LOG_FILE"
else
    echo -e "${YELLOW}⚠️  日志文件不存在${NC}"
fi

echo ""

# 8. 快捷命令
echo -e "${BLUE}【8】常用命令${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "启动服务: ./start.sh"
echo "启动桌面浮窗: ./desktop.sh"
echo "停止服务: ./stop.sh"
echo "查看状态: ./status.sh"
echo "测试 API: cd gold-price-service && ./test-api.sh"
echo "查看日志: tail -f gold-price-service/logs/service.log"
echo "清理缓存: curl -X POST http://localhost:3001/api/admin/clear-cache"

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    检查完成                                    ║"
echo "╚════════════════════════════════════════════════════════════════╝"
