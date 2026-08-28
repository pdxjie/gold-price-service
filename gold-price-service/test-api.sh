#!/bin/bash

echo "=========================================="
echo "Gold Price Service API 测试"
echo "=========================================="
echo ""

echo "1. 健康检查"
echo "---"
curl -s http://localhost:3001/health | python3 -m json.tool
echo ""
echo ""

echo "2. 获取最新金价 (AU9999)"
echo "---"
curl -s http://localhost:3001/api/gold/latest | python3 -m json.tool
echo ""
echo ""

echo "3. 获取历史数据 (1小时)"
echo "---"
curl -s "http://localhost:3001/api/gold/history?range=1h" | python3 -m json.tool
echo ""
echo ""

echo "4. 检查价格偏差"
echo "---"
curl -s http://localhost:3001/api/gold/deviation | python3 -m json.tool
echo ""
echo ""

echo "5. 缓存统计"
echo "---"
curl -s http://localhost:3001/api/admin/stats | python3 -m json.tool
echo ""
echo ""

echo "6. 采集器状态"
echo "---"
curl -s http://localhost:3001/api/collector/status | python3 -m json.tool
echo ""
echo ""

echo "7. 最新回收价"
echo "---"
curl -s http://localhost:3001/api/gold/recycle/latest | python3 -m json.tool
echo ""
echo ""

echo "8. 提醒规则"
echo "---"
curl -s http://localhost:3001/api/alerts/rules | python3 -m json.tool
echo ""
echo ""

echo "=========================================="
echo "测试完成"
echo "=========================================="
