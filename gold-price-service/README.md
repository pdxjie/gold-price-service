# Gold Price Service

本地金价数据服务 + Electron 桌面浮窗。

## 功能

- 黄金价格网实时行情为主源，招商银行行情为备用源
- 每 5 秒后台采集 `AU9999`，写入 SQLite
- 保存黄金回收价，默认每 60 秒刷新一次
- 提供历史曲线数据接口
- 支持金价到价提醒规则和提醒事件
- Electron 悬浮窗口展示实时金价、回收价、浮动和曲线

## 快速开始

建议使用项目内 `.nvmrc` 指定的 Node 版本：

```bash
nvm use
npm install
```

启动后端：

```bash
PORT=3001 npm run dev
```

启动桌面浮窗：

```bash
npm run desktop
```

如果 Electron 下载较慢：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

## API

### 健康检查

```http
GET /health
```

返回服务状态和采集器状态。

### 最新金价

```http
GET /api/gold/latest?symbol=AU9999
```

默认 `AU9999`，也支持 `AUTD`。当前策略为：黄金价格网优先，失败后降级到招商银行。

### 完整金价数据

```http
GET /api/gold/full
```

返回贵金属行情、金店价、银行金条价、回收价。

### 历史曲线

```http
GET /api/gold/history?symbol=AU9999&range=1h
```

`range` 支持：`15m`、`1h`、`6h`、`1d`、`3d`、`7d`、`30d`。

历史数据来自 SQLite 后台采集器；如果数据库暂时为空，会回退到内存历史。

### 最新回收价

```http
GET /api/gold/recycle/latest
```

返回最近一次入库的各类回收价格。

### 价格偏差

```http
GET /api/gold/deviation?symbol=AU9999
```

同时拉取黄金价格网和招商银行，对比两者价格偏差。

### 采集器状态

```http
GET /api/collector/status
```

返回是否运行、采集品种、采集间隔、最近采集时间和最近错误。

### 提醒规则

```http
GET /api/alerts/rules
POST /api/alerts/rules
PATCH /api/alerts/rules/:id
DELETE /api/alerts/rules/:id
```

创建规则示例：

```json
{
  "symbol": "AU9999",
  "direction": "below",
  "targetPrice": 980,
  "enabled": true,
  "cooldownSeconds": 1800
}
```

### 提醒事件

```http
GET /api/alerts/events?sinceId=0
```

桌面浮窗通过该接口轮询新事件，并触发系统通知。

### 管理接口

```http
GET /api/admin/stats
POST /api/admin/clear-cache
```

`stats` 会返回缓存、SQLite 和采集器统计。

## 数据存储

SQLite 文件默认保存到：

```text
data/gold-prices.sqlite
```

可通过环境变量覆盖：

```bash
GOLD_DB_PATH=/path/to/gold-prices.sqlite npm run dev
```

## 环境变量

| 名称 | 默认值 | 说明 |
|---|---:|---|
| `PORT` | `3000` | 后端服务端口 |
| `COLLECT_SYMBOL` | `AU9999` | 后台采集品种 |
| `COLLECT_INTERVAL_MS` | `5000` | 实时金价采集间隔 |
| `RECYCLE_COLLECT_INTERVAL_MS` | `60000` | 回收价采集间隔 |
| `COLLECTOR_ENABLED` | `true` | 设置为 `false` 可关闭采集器 |
| `GOLD_DB_PATH` | `data/gold-prices.sqlite` | SQLite 文件路径 |
| `GOLD_DESKTOP_PORT` | `3001` | Electron 启动后端的端口 |
| `NODE_BINARY` | 自动探测 | Electron 启动后端时使用的 Node 路径 |

## 项目结构

```text
gold-price-service/
├── electron/
│   ├── main.js
│   ├── preload.js
│   └── renderer/
│       ├── index.html
│       ├── styles.css
│       └── app.js
├── src/
│   ├── server.ts
│   ├── types.ts
│   └── services/
│       ├── akshare.ts
│       ├── cmbchina.ts
│       ├── gold-scraper.ts
│       ├── price-aggregator.ts
│       ├── price-collector.ts
│       └── sqlite-store.ts
├── data/
├── package.json
├── test-api.sh
└── tsconfig.json
```

## 注意

- `node:sqlite` 在 Node 24 下可用，但会输出实验特性 warning。
- 招商银行接口不是公开商业 API，生产环境需要评估合规风险。
- 黄金价格网页面结构变化会影响爬虫解析，需要保留偏差检测和备用源。
- 所有数据仅供参考，不构成投资建议。
