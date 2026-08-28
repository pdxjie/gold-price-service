# Gold Price Desktop

黄金实时价格桌面浮窗 + 本地数据服务。

## 当前状态

- 本地 Node/TypeScript 后端已完成
- 黄金价格网为主数据源，招商银行为备用源
- 后台采集器已完成，默认每 5 秒采集一次
- SQLite 历史数据已接入
- 回收价采集已接入
- 到价提醒规则和事件已接入
- Electron 悬浮窗口已完成第一版

## BullionVault STOMP 实时行情

服务启动时默认建立 BullionVault SockJS/STOMP 长连接，订阅黄金 `/t/AUX/USD` 实时主题。收到推送后会立即更新内存中的最新报价，并写入 SQLite，页面或接口读取时不再等待下一次 HTTP 抓取。

实时国际金价接口：

```text
http://localhost:3001/api/gold/bullionvault/latest
```

返回单位为美元/盎司；也可以通过通用接口使用 `XAUUSD` 或 `AUX`：

```text
http://localhost:3001/api/gold/latest?symbol=XAUUSD
```

连接状态：

```text
http://localhost:3001/api/bullionvault/status
```

可通过环境变量关闭或调整：

```text
BULLIONVAULT_ENABLED=false
BULLIONVAULT_STOMP_DEBUG=true
BULLIONVAULT_BOOTSTRAP_INTERVAL=5
BULLIONVAULT_STALE_AFTER_MS=120000
```

原有 `AU9999` 国内行情源保持不变，BullionVault 实时源使用独立的 `XAUUSD` 标识，避免把国际美元/盎司报价误当成国内元/克报价。
## 启动桌面浮窗

```bash
./desktop.sh
```

脚本会进入 `gold-price-service/`，读取 `.nvmrc`，并启动 Electron。Electron 会自动检查 `http://localhost:3001`，如果后端没运行，会自动拉起本地后端。

## 只启动后端

```bash
./start.sh
```

后端地址：

```text
http://localhost:3001
```

停止后端：

```bash
./stop.sh
```

查看状态：

```bash
./status.sh
```

## 测试接口

```bash
cd gold-price-service
./test-api.sh
```

## 核心接口

- 实时金价：`/api/gold/latest?symbol=AU9999`
- 历史曲线：`/api/gold/history?symbol=AU9999&range=1h`
- 回收价：`/api/gold/recycle/latest`
- 采集器状态：`/api/collector/status`
- 到价提醒：`/api/alerts/rules`
- 提醒事件：`/api/alerts/events?sinceId=0`

## 目录结构

```text
gold-price-service/
├── desktop.sh
├── start.sh
├── stop.sh
├── status.sh
├── README.md
└── gold-price-service/
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
    │       ├── gold-scraper.ts
    │       ├── cmbchina.ts
    │       ├── price-aggregator.ts
    │       ├── price-collector.ts
    │       └── sqlite-store.ts
    ├── data/
    │   └── gold-prices.sqlite
    ├── package.json
    └── tsconfig.json
```

## 技术栈

- 后端：Node.js、TypeScript、Express
- 数据存储：SQLite
- 桌面端：Electron
- 图表：Canvas

## 注意

- 当前项目需要 Node `24.4.0`，已写入 `.nvmrc`。
- 如果 Electron 下载失败，可使用镜像：

```bash
cd gold-price-service
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

- 数据仅供参考，不构成投资建议。
