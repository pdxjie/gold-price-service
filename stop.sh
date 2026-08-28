#!/bin/bash

# 金价监控项目停止脚本

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          Gold Price Monitor - 停止脚本                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$PROJECT_ROOT/gold-price-service/logs/service.pid"

# 检查 PID 文件
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")

    # 检查进程是否存在
    if ps -p $PID > /dev/null 2>&1; then
        echo "🛑 停止服务（PID: $PID）..."
        kill $PID

        # 等待进程结束
        for i in {1..5}; do
            if ! ps -p $PID > /dev/null 2>&1; then
                echo -e "${GREEN}✅ 服务已停止${NC}"
                rm "$PID_FILE"
                break
            fi
            sleep 1
        done

        # 如果还没停止，强制终止
        if ps -p $PID > /dev/null 2>&1; then
            echo -e "${YELLOW}⚠️  强制终止进程...${NC}"
            kill -9 $PID
            rm "$PID_FILE"
            echo -e "${GREEN}✅ 服务已强制停止${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  进程不存在（PID: $PID）${NC}"
        rm "$PID_FILE"
    fi
else
    echo -e "${YELLOW}⚠️  未找到 PID 文件，尝试查找运行中的进程...${NC}"

    # 查找并终止 gold-price-service 进程
    PIDS=$(ps aux | grep "gold-price-service" | grep -v grep | awk '{print $2}')

    if [ -n "$PIDS" ]; then
        echo "找到以下进程："
        ps aux | grep "gold-price-service" | grep -v grep
        echo ""
        echo "是否终止这些进程？(y/n)"
        read -r response

        if [[ "$response" == "y" ]]; then
            for pid in $PIDS; do
                kill $pid
                echo "已终止进程: $pid"
            done
            echo -e "${GREEN}✅ 所有进程已停止${NC}"
        fi
    else
        echo -e "${GREEN}✅ 没有运行中的服务${NC}"
    fi
fi

echo ""
echo "🔍 检查端口 3001..."
if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  端口 3001 仍被占用${NC}"
    lsof -i :3001
else
    echo -e "${GREEN}✅ 端口 3001 已释放${NC}"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    清理完成                                    ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║ 重新启动：./start.sh                                          "
echo "║ 查看日志：cat gold-price-service/logs/service.log             "
echo "╚════════════════════════════════════════════════════════════════╝"
