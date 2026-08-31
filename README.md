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
- 桌面端支持浙商/民生积存金双报价展示，积存金资产可按来源添加多条

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

## 跨平台打包

项目支持 Windows 和 macOS。GitHub Actions 工作流位于 `.github/workflows/build-desktop.yml`，支持 Windows x64、macOS Intel 和 macOS Apple Silicon。

推送版本标签即可自动构建并创建 GitHub Release：

```bash
git tag v1.0.1
git push origin v1.0.1
```

也可以在 GitHub 的 Actions 页面手动运行 `Build Desktop Apps`；手动运行只上传构建产物，不创建 Release。macOS 安装包包含 `.dmg` 和 `.zip` 两种格式。当前没有配置 Apple Developer 签名和公证，首次打开可能需要在 Finder 中右键应用并选择“打开”。

GitHub Actions 的 macOS 包默认使用 ad-hoc 签名，能保证 `.app` 包内签名结构完整，但它仍不是 Apple Developer ID 签名，也没有经过 Apple 公证。下载后如果 macOS 仍提示“已损坏”或阻止打开，本地测试可以先把应用复制到“应用程序”，然后执行：

```bash
xattr -dr com.apple.quarantine /Applications/金脉.app
```

正式对外分发要彻底消除 Gatekeeper 拦截，需要 Apple Developer ID 证书签名并完成 notarization 公证。

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
