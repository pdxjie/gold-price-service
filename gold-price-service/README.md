# 金脉

金脉是一款面向个人黄金持仓的桌面悬浮行情工具。它将积存金实时报价、黄金回收价、短线波动信号、持仓盈亏和 AI 辅助分析整合到一个轻量 Electron 浮窗中，适合长期挂在桌面右上角观察黄金价格变化。

> 数据和 AI 分析仅供参考，不构成投资建议。

## 核心功能

- **桌面悬浮窗**：Electron 常驻桌面展示实时金价、涨跌、回收价、汇率和历史曲线，支持折叠成小卡片。
- **三路积存金报价**：支持浙商积存金、民生积存金、工行积存金，统一按 `元/克` 展示。
- **持仓盈亏计算**：支持手动录入多条积存金资产，记录克数、买入价和报价来源，实时计算估值、盈亏和扣手续费后的真实卖出收益。
- **短线辅助信号**：基于本地 SQLite 采样数据计算 5/15/30/60 分钟涨跌、近 60 分钟波动率、连续上涨/下跌、支撑位和压力位。
- **黄金回收价**：后台定时采集黄金回收价，可用于估算实体黄金回收金额。
- **AI 黄金分析**：可配置 OpenAI 兼容大模型接口，结合实时行情、短线信号、持仓和金友圈观点生成短线分析报告。
- **提醒与通知**：支持价格高于/低于阈值提醒，桌面通知之外还支持飞书群机器人和企业微信群机器人。
- **本地数据存储**：行情、回收价、提醒、通知配置、AI 配置和分析记录保存在本地 SQLite。
- **数据导入导出**：桌面设置页支持 JSON、CSV、XLSX 导出和 JSON 备份导入。

## 数据源逻辑

### 积存金实时行情

服务启动后默认轮询京东金融相关行情接口，当前支持：

| 标识 | 名称 | 单位 | 用途 |
|---|---|---|---|
| `CZB-JCJ` | 浙商积存金 | 元/克 | 默认主报价、历史曲线、短线信号 |
| `MS-JCJ` | 民生积存金 | 元/克 | 对比报价、持仓来源 |
| `ICBC-JCJ` | 工行积存金 | 元/克 | 对比报价、持仓来源 |
| `AUTD` | 黄金 T+D | 元/克 | 国内行情参考 |

轮询间隔默认由 `JD_GOLD_POLL_INTERVAL_MS=2000` 控制。每次价格变化会写入 SQLite，并通过 WebSocket 推送给桌面端。

### 国内参考行情

通用金价接口会优先使用黄金价格网爬虫，失败后降级到招商银行接口：

```text
黄金价格网爬虫 -> 招商银行接口 -> 本地缓存/旧数据
```

该逻辑主要用于 `AU9999`、`AUTD` 等国内参考行情。

### 国际金价

BullionVault SockJS/STOMP 长连接默认开启，订阅 `XAUUSD` 国际黄金行情。服务会将美元/盎司行情写入 SQLite，并在启动时尝试回填近 90 天历史数据。

桌面端可按：

```text
美元/盎司 × USD/CNY ÷ 31.1034768
```

换算为国内 `元/克` 参考价格。

### 历史曲线

历史曲线优先读取本地 SQLite。浙商积存金在长周期数据不足时会使用 AKShare/上海黄金交易所历史行情作为参考回填。

支持的范围：

```text
15m, 1h, 6h, 1d, 3d, 7d, 30d, 90d, 3m
```

## AI 分析逻辑

AI 分析不是单纯把金价丢给模型，而是由服务端先聚合结构化上下文：

- BullionVault 国际金价
- 浙商、民生、工行积存金报价
- USD/CNH 汇率
- 黄金 T+D
- 本地 1 小时与 1 天历史摘要
- 5/15/30/60 分钟短线信号
- 用户手动录入的积存金持仓
- 可选的京东金融金友圈观点
- 内置黄金分析 Skill 和报告模板

大模型配置保存在本地 SQLite，可在设置页新增、测试、设为默认。接口兼容 OpenAI Chat Completions 风格：

```text
baseUrl + /chat/completions
```

如果配置的是 DeepSeek 官方地址 `https://api.deepseek.com`，服务会走 Responses API，并尝试启用 `web_search` 工具做联网消息面分析：

```text
https://api.deepseek.com/responses
```

如果配置的是第三方 OpenAI 兼容中转，则使用普通流式 Chat Completions，能生成分析报告，但是否具备联网搜索能力取决于中转服务本身。

## 快速开始

项目依赖 Node.js 24，建议使用 `.nvmrc`：

```bash
nvm use
npm install
```

启动本地后端：

```bash
PORT=3001 npm run dev
```

启动桌面浮窗：

```bash
npm run desktop
```

构建 TypeScript：

```bash
npm run build
```

如果 Electron 下载较慢：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

## 打包

生成 Windows 安装包：

```bash
npm run pack:win
```

生成 Windows 便携版：

```bash
npm run pack:portable
```

生成 macOS 安装包：

```bash
npm run pack:mac:x64    # Intel Mac
npm run pack:mac:arm64  # Apple Silicon
```

当前 macOS 构建默认是 ad-hoc 签名，能保证 `.app` 包结构完整，但不是 Apple Developer ID 签名，也未经过 Apple notarization 公证。首次打开外部分发包时，macOS 仍可能拦截。

本地自用时可在复制到“应用程序”后执行：

```bash
xattr -dr com.apple.quarantine /Applications/金脉.app
```

正式面向用户分发时，建议配置 Apple Developer ID 证书和 notarization。GitHub Actions 可通过版本标签自动构建并上传 Release 产物，Secrets 通常需要包含：

```text
CSC_LINK
CSC_KEY_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

## API

### 基础状态

```http
GET /health
GET /api/admin/stats
GET /api/collector/status
GET /api/gold/websocket/status
```

### 最新行情

```http
GET /api/gold/latest?symbol=CZB-JCJ
GET /api/gold/latest?symbol=MS-JCJ
GET /api/gold/latest?symbol=ICBC-JCJ
GET /api/gold/latest?symbol=AU9999
GET /api/gold/latest?symbol=AUTD
GET /api/gold/latest?symbol=XAUUSD
```

京东积存金完整报价：

```http
GET /api/jd-gold/latest
GET /api/jd-gold/status
```

BullionVault 国际行情：

```http
GET /api/gold/bullionvault/latest
GET /api/bullionvault/status
```

完整金价、金店价、银行金条价、回收价：

```http
GET /api/gold/full
GET /api/gold/recycle/latest
```

### 历史与短线信号

```http
GET /api/gold/history?symbol=AU9999&range=1h
GET /api/jd-gold/history?symbol=CZB-JCJ&range=1h
GET /api/jd-gold/history?symbol=MS-JCJ&range=1h
GET /api/jd-gold/history?symbol=ICBC-JCJ&range=1h
GET /api/jd-gold/signals?symbol=CZB-JCJ
```

AKShare/上海黄金交易所历史参考：

```http
GET /api/gold/historical?period=1m
GET /api/gold/historical?period=3m
```

数据源偏差检测：

```http
GET /api/gold/deviation?symbol=AU9999
```

### 提醒规则

```http
GET /api/alerts/rules
POST /api/alerts/rules
PATCH /api/alerts/rules/:id
DELETE /api/alerts/rules/:id
GET /api/alerts/events?sinceId=0
POST /api/alerts/test
```

创建规则示例：

```json
{
  "symbol": "CZB-JCJ",
  "direction": "below",
  "targetPrice": 950,
  "enabled": true,
  "cooldownSeconds": 1800
}
```

`symbol` 可使用 `CZB-JCJ`、`MS-JCJ`、`ICBC-JCJ`、`AU9999-RECYCLE` 等标识。触发后规则会进入已触发状态，价格回到阈值内后自动复位。

### 通知配置

飞书：

```http
GET /api/notifications/feishu
PATCH /api/notifications/feishu
POST /api/notifications/feishu/test
```

企业微信：

```http
GET /api/notifications/wecom
PATCH /api/notifications/wecom
POST /api/notifications/wecom/test
```

Webhook 和密钥只保存在本地 SQLite，读取配置时仅返回是否已配置和脱敏预览。

### 大模型配置与 AI 分析

```http
GET /api/llm/configs
POST /api/llm/configs
PATCH /api/llm/configs/:id
DELETE /api/llm/configs/:id
POST /api/llm/configs/:id/default
POST /api/llm/test
```

AI 分析使用 SSE 流式返回：

```http
POST /api/ai/analysis
```

请求体示例：

```json
{
  "configId": 1,
  "holdings": {
    "holdings": {
      "market": [
        {
          "quoteKey": "CZB-JCJ",
          "grams": 10,
          "buyPrice": 930
        }
      ]
    }
  }
}
```

分析记录：

```http
GET /api/ai/analysis/status
GET /api/ai/analysis/records
GET /api/ai/analysis/records/:id
```

## WebSocket

服务端 WebSocket 默认路径：

```text
ws://localhost:3001/ws/gold
```

推送事件包括：

| 类型 | 说明 |
|---|---|
| `jd-gold.quote` | 浙商、民生、工行积存金和相关国内报价 |
| `bullionvault.quote` | BullionVault 国际金价 |

路径可通过 `GOLD_WEBSOCKET_PATH` 覆盖。

## 环境变量

| 名称 | 默认值 | 说明 |
|---|---:|---|
| `PORT` | `3000` | 后端 HTTP 服务端口 |
| `GOLD_DESKTOP_PORT` | `3001` | Electron 内置后端端口 |
| `GOLD_DB_PATH` | `data/gold-prices.sqlite` | SQLite 文件路径 |
| `NODE_BINARY` | 自动探测 | Electron 启动后端时使用的 Node 路径 |
| `GOLD_DESKTOP_USE_DIST` | `false` | Electron 开发模式是否使用 `dist/server.js` |
| `COLLECTOR_ENABLED` | `true` | 是否启动后台采集器 |
| `COLLECT_SYMBOL` | `AU9999` | 后台通用金价采集品种 |
| `COLLECT_INTERVAL_MS` | `5000` | 通用金价采集间隔 |
| `RECYCLE_COLLECT_INTERVAL_MS` | `60000` | 回收价采集间隔 |
| `JD_GOLD_ENABLED` | `true` | 是否启动京东积存金轮询 |
| `JD_GOLD_POLL_INTERVAL_MS` | `2000` | 京东积存金轮询间隔 |
| `JD_GOLD_REQUEST_TIMEOUT_MS` | `5000` | 京东积存金请求超时 |
| `JD_GOLD_STALE_AFTER_MS` | `30000` | 积存金数据过期判定 |
| `JD_ZHEJIANG_GOLD_URL` | 内置地址 | 浙商积存金接口覆盖 |
| `JD_MINSHENG_GOLD_URL` | 内置地址 | 民生积存金接口覆盖 |
| `JD_ICBC_GOLD_URL` | 内置地址 | 工行积存金接口覆盖 |
| `BULLIONVAULT_ENABLED` | `true` | 是否启动 BullionVault 实时行情 |
| `BULLIONVAULT_STOMP_URL` | 内置地址 | BullionVault STOMP 地址 |
| `BULLIONVAULT_SECURITY_ID` | `AUX` | BullionVault 品种 |
| `BULLIONVAULT_CURRENCY` | `USD` | BullionVault 计价货币 |
| `BULLIONVAULT_STOMP_DEBUG` | `false` | STOMP 调试日志 |
| `GOLD_SELL_FEE_RATE` | `0.004` | 积存金卖出手续费率，用于真实盈亏估算 |

## 数据存储

开发模式下 SQLite 默认保存到：

```text
data/gold-prices.sqlite
```

Electron 打包应用中默认保存到系统用户数据目录：

```text
<userData>/data/gold-prices.sqlite
```

数据库中保存：

- 实时价格采样
- 黄金回收价
- 提醒规则和提醒事件
- 飞书/企业微信通知配置
- 大模型配置
- AI 分析记录

## 项目结构

```text
gold-price-service/
├── electron/
│   ├── main.js
│   ├── preload.js
│   └── renderer/
│       ├── index.html
│       ├── app.js
│       ├── styles.css
│       ├── settings.html
│       ├── settings.js
│       ├── analysis.html
│       └── analysis.js
├── src/
│   ├── server.ts
│   ├── types.ts
│   ├── ai/
│   │   └── skill/
│   └── services/
│       ├── jd-gold-live.ts
│       ├── bullionvault-live.ts
│       ├── gold-scraper.ts
│       ├── cmbchina.ts
│       ├── akshare.ts
│       ├── price-aggregator.ts
│       ├── price-collector.ts
│       ├── short-term-signals.ts
│       ├── ai-analysis.ts
│       ├── llm-client.ts
│       └── sqlite-store.ts
├── data/
├── package.json
├── test-api.sh
└── tsconfig.json
```

## 注意事项

- 项目依赖 `node:sqlite`，需要 Node.js 22.5+，推荐 Node.js 24。
- 京东金融、黄金价格网、招商银行等接口并非正式公开商业 API，生产分发前需要评估稳定性和合规风险。
- 网页爬虫依赖页面结构，若上游页面改版，可能需要同步调整解析逻辑。
- AI 报告会受到模型能力、数据源延迟和联网搜索可用性的影响，不能替代独立判断。
