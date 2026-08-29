# 金脉

金脉启动时会从上海黄金交易所历史数据接口加载近三个月 Au99.99 日线数据，写入本地 SQLite；实时行情到达后继续写入同一条历史链路，曲线会持续累计。该接口与 AKShare 的 `spot_hist_sge(symbol="Au99.99")` 使用相同的数据源和字段，不需要终端用户额外安装 Python。

本地金价数据服务 + Electron 桌面浮窗。

## 功能

- BullionVault SockJS/STOMP 实时国际金价，原有国内行情接口继续作为独立数据源
- 每条 BullionVault 实时推送写入 SQLite，并在首次启动时回填近 90 天历史数据
- 保存黄金回收价，默认每 60 秒刷新一次
- 提供历史曲线数据接口
- 支持金价到价提醒规则和提醒事件
- Electron 悬浮窗口展示实时金价、回收价、浮动和平滑曲线，支持折叠为桌面悬浮小球

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

生成 Windows 安装包：

```bash
npm run pack:win
```

生成 macOS 安装包：

```bash
npm run pack:mac:x64     # Intel Mac
npm run pack:mac:arm64  # Apple Silicon（M1/M2/M3/M4）
```

也可以通过 GitHub Actions 自动构建 Windows、macOS Intel 和 macOS Apple Silicon。推送 `v1.0.1` 这类版本标签后，工作流会自动创建 GitHub Release 并上传全部安装包；在 Actions 页面手动运行工作流时只构建并上传构建产物，不创建 Release。

macOS 构建当前未配置 Apple Developer 签名与公证，首次打开时可能需要在 Finder 中右键应用选择“打开”。正式面向大量用户发布时，建议在 GitHub Secrets 中加入 Developer ID、签名证书和公证凭据。

安装包会输出到 `release/` 目录。普通用户安装后不需要 Node.js，后端由 Electron 内置运行时启动；行情和提醒数据会保存到系统用户数据目录。

如果 Electron 下载较慢：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

## BullionVault STOMP 实时行情

服务启动时默认建立 BullionVault SockJS/STOMP 长连接，订阅黄金 `/t/AUX/USD` 实时主题。收到推送后立即更新内存中的最新报价，并写入 SQLite。

实时国际金价：

```http
GET /api/gold/bullionvault/latest
```

也可以通过通用接口获取：

```http
GET /api/gold/latest?symbol=XAUUSD
```

连接状态：

```http
GET /api/bullionvault/status
```

该实时源返回美元/盎司，使用独立的 `XAUUSD` 标识。桌面端按 `美元/盎司 × USD/CNY ÷ 31.1034768` 换算为国内元/克，主显示截断到两位小数，计算明细保留 JavaScript 原始结果。可通过 `BULLIONVAULT_ENABLED=false` 关闭，或设置 `BULLIONVAULT_STOMP_DEBUG=true` 输出协议调试日志。
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

`range` 支持：`15m`、`1h`、`6h`、`1d`、`3d`、`7d`、`30d`、`90d`、`3m`。`XAUUSD` 数据包含首次启动回填的近 90 天历史，以及之后的每条实时推送。

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

### 飞书机器人通知

设置页面支持配置飞书群机器人 Webhook。提醒事件首次穿越高价或低价阈值时，会在系统通知之外发送一条飞书消息；价格回到正常范围后规则自动复位。

```http
GET /api/notifications/feishu
PATCH /api/notifications/feishu
POST /api/notifications/feishu/test
```

Webhook 只保存在本地 SQLite 中，接口和设置页面不会返回完整地址。机器人开启签名校验时，可在设置页面填写签名密钥。飞书通知发送失败不会阻塞价格采集或本地提醒事件。

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
