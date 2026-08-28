// Express HTTP 服务器
import express, { Request, Response } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { AlertDirection } from './types';
import { priceAggregator } from './services/price-aggregator';
import { bullionVaultLiveService } from './services/bullionvault-live';
import { jdGoldLiveService } from './services/jd-gold-live';
import { goldWebSocketService, GoldWebSocketMessage } from './services/gold-websocket';
import { priceCollector } from './services/price-collector';
import { sqliteStore } from './services/sqlite-store';
import akshareService from './services/akshare';

const app = express();
const PORT = process.env.PORT || 3000;
const httpServer = createServer(app);

goldWebSocketService.attach(httpServer, () => {
  const messages: GoldWebSocketMessage[] = [];
  const jdQuote = jdGoldLiveService.getLatestQuote();
  const bullionVaultQuote = bullionVaultLiveService.getLatestQuote();
  if (jdQuote) {
    messages.push({
      type: 'jd-gold.quote',
      emittedAt: new Date().toISOString(),
      data: jdQuote,
    });
  }
  if (bullionVaultQuote) {
    messages.push({
      type: 'bullionvault.quote',
      emittedAt: new Date().toISOString(),
      data: bullionVaultQuote,
    });
  }
  return messages;
});

// 中间件
app.use(cors());
app.use(express.json());

// 请求日志中间件
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/**
 * 健康检查
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    collector: priceCollector.getStatus(),
    jdGold: jdGoldLiveService.getStatus(),
    bullionVault: bullionVaultLiveService.getStatus(),
    websocket: goldWebSocketService.getStatus(),
  });
});

/**
 * 获取最新金价
 * GET /api/gold/latest?symbol=AU9999
 */
app.get('/api/gold/latest', async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || 'AU9999';
    const price = await priceAggregator.getLatestPrice(symbol);

    res.json({
      code: 200,
      message: '获取成功',
      data: price,
    });
  } catch (error) {
    console.error('Get latest price error:', error);
    res.status(500).json({
      code: 500,
      message: error instanceof Error ? error.message : 'Internal server error',
      data: null,
    });
  }
});

/**
 * 获取 BullionVault STOMP 实时国际金价
 * GET /api/gold/bullionvault/latest
 */
app.get('/api/gold/bullionvault/latest', async (_req: Request, res: Response) => {
  try {
    const price = await priceAggregator.getBullionVaultLatestPrice();

    res.json({
      code: 200,
      message: '获取成功',
      data: price,
    });
  } catch (error) {
    console.error('Get BullionVault price error:', error);
    res.status(503).json({
      code: 503,
      message: error instanceof Error ? error.message : 'BullionVault unavailable',
      data: null,
    });
  }
});

/**
 * 获取 BullionVault STOMP 连接状态
 * GET /api/bullionvault/status
 */
app.get('/api/bullionvault/status', (_req: Request, res: Response) => {
  res.json({
    code: 200,
    message: '获取成功',
    data: bullionVaultLiveService.getStatus(),
  });
});

app.get('/api/jd-gold/latest', async (_req: Request, res: Response) => {
  try {
    const quote = await jdGoldLiveService.waitForLatestQuote(5000);
    res.json({
      code: 200,
      message: '获取成功',
      data: quote,
    });
  } catch (error) {
    res.status(503).json({
      code: 503,
      message: error instanceof Error ? error.message : '京东黄金行情不可用',
      data: null,
    });
  }
});

app.get('/api/jd-gold/status', (_req: Request, res: Response) => {
  res.json({
    code: 200,
    message: '获取成功',
    data: jdGoldLiveService.getStatus(),
  });
});

app.get('/api/gold/websocket/status', (_req: Request, res: Response) => {
  res.json({
    code: 200,
    message: '获取成功',
    data: goldWebSocketService.getStatus(),
  });
});

/**
 * 获取完整金价数据（包括金店价、回收价）
 * GET /api/gold/full
 */
app.get('/api/gold/full', async (_req: Request, res: Response) => {
  try {
    const data = await priceAggregator.getFullGoldData();
    res.json(data);
  } catch (error) {
    console.error('Get full data error:', error);
    res.status(500).json({
      code: 500,
      message: error instanceof Error ? error.message : 'Internal server error',
      data: null,
    });
  }
});

/**
 * 获取历史价格数据
 * GET /api/gold/history?symbol=AU9999&range=1h
 */
app.get('/api/gold/history', (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || 'AU9999';
    const range = (req.query.range as string) || '1h';

    const history = sqliteStore.getPriceHistory(symbol, range);
    const data = history.data.length > 0 ? history : priceAggregator.getHistory(symbol, range);

    res.json({
      code: 200,
      message: '获取成功',
      data,
    });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({
      code: 500,
      message: error instanceof Error ? error.message : 'Internal server error',
      data: null,
    });
  }
});

app.get('/api/jd-gold/history', (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) || '1h';
    const symbol = 'CZB-JCJ';
    res.json({
      code: 200,
      message: '获取成功',
      data: sqliteStore.getPriceHistory(symbol, range),
    });
  } catch (error) {
    console.error('Get JD gold history error:', error);
    res.status(500).json({
      code: 500,
      message: error instanceof Error ? error.message : 'Internal server error',
      data: null,
    });
  }
});

/**
 * 获取最新回收价
 * GET /api/gold/recycle/latest
 */
app.get('/api/gold/recycle/latest', (_req: Request, res: Response) => {
  try {
    const recycle = sqliteStore.getLatestRecyclePrices();

    res.json({
      code: 200,
      message: '获取成功',
      data: recycle,
    });
  } catch (error) {
    console.error('Get recycle price error:', error);
    res.status(500).json({
      code: 500,
      message: error instanceof Error ? error.message : 'Internal server error',
      data: null,
    });
  }
});

/**
 * 获取历史价格数据（AKShare）
 * GET /api/gold/historical?period=1m
 */
app.get('/api/gold/historical', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as '1m' | '3m') || '1m';
    const data = await akshareService.getGoldHistory(period);

    res.json({
      code: 200,
      message: '获取成功',
      data,
    });
  } catch (error) {
    console.error('Get historical data error:', error);
    res.status(500).json({
      code: 500,
      message: error instanceof Error ? error.message : 'Internal server error',
      data: null,
    });
  }
});

/**
 * 检查价格偏差
 * GET /api/gold/deviation?symbol=AU9999
 */
app.get('/api/gold/deviation', async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || 'AU9999';
    const deviation = await priceAggregator.checkPriceDeviation(symbol);

    res.json({
      code: 200,
      message: '获取成功',
      data: deviation,
    });
  } catch (error) {
    console.error('Check deviation error:', error);
    res.status(500).json({
      code: 500,
      message: error instanceof Error ? error.message : 'Internal server error',
      data: null,
    });
  }
});

/**
 * 清空缓存
 * POST /api/admin/clear-cache
 */
app.post('/api/admin/clear-cache', (_req: Request, res: Response) => {
  try {
    priceAggregator.clearCache();
    res.json({
      code: 200,
      message: '缓存已清空',
      data: null,
    });
  } catch (error) {
    console.error('Clear cache error:', error);
    res.status(500).json({
      code: 500,
      message: error instanceof Error ? error.message : 'Internal server error',
      data: null,
    });
  }
});

/**
 * 获取缓存统计
 * GET /api/admin/stats
 */
app.get('/api/admin/stats', (_req: Request, res: Response) => {
  try {
    const stats = {
      cache: priceAggregator.getCacheStats(),
      database: sqliteStore.getStats(),
      collector: priceCollector.getStatus(),
      bullionVault: bullionVaultLiveService.getStatus(),
    };
    res.json({
      code: 200,
      message: '获取成功',
      data: stats,
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      code: 500,
      message: error instanceof Error ? error.message : 'Internal server error',
      data: null,
    });
  }
});

/**
 * 获取采集器状态
 * GET /api/collector/status
 */
app.get('/api/collector/status', (_req: Request, res: Response) => {
  res.json({
    code: 200,
    message: '获取成功',
    data: priceCollector.getStatus(),
  });
});

/**
 * 获取提醒规则
 * GET /api/alerts/rules
 */
app.get('/api/alerts/rules', (_req: Request, res: Response) => {
  try {
    res.json({
      code: 200,
      message: '获取成功',
      data: sqliteStore.getAlertRules(),
    });
  } catch (error) {
    console.error('Get alert rules error:', error);
    res.status(500).json({
      code: 500,
      message: error instanceof Error ? error.message : 'Internal server error',
      data: null,
    });
  }
});

/**
 * 创建提醒规则
 * POST /api/alerts/rules
 */
app.post('/api/alerts/rules', (req: Request, res: Response) => {
  try {
    const input = parseAlertRuleBody(req.body);
    const rule = sqliteStore.createAlertRule(input);

    res.status(201).json({
      code: 201,
      message: '创建成功',
      data: rule,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    res.status(400).json({
      code: 400,
      message,
      data: null,
    });
  }
});

/**
 * 更新提醒规则
 * PATCH /api/alerts/rules/:id
 */
app.patch('/api/alerts/rules/:id', (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid alert rule id');
    }

    const input = parseAlertRuleBody(req.body, true);
    const rule = sqliteStore.updateAlertRule(id, input);
    if (!rule) {
      res.status(404).json({
        code: 404,
        message: '提醒规则不存在',
        data: null,
      });
      return;
    }

    res.json({
      code: 200,
      message: '更新成功',
      data: rule,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    res.status(400).json({
      code: 400,
      message,
      data: null,
    });
  }
});

/**
 * 删除提醒规则
 * DELETE /api/alerts/rules/:id
 */
app.delete('/api/alerts/rules/:id', (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid alert rule id');
    }

    const deleted = sqliteStore.deleteAlertRule(id);
    res.status(deleted ? 200 : 404).json({
      code: deleted ? 200 : 404,
      message: deleted ? '删除成功' : '提醒规则不存在',
      data: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    res.status(400).json({
      code: 400,
      message,
      data: null,
    });
  }
});

/**
 * 获取提醒事件
 * GET /api/alerts/events?sinceId=0
 */
app.get('/api/alerts/events', (req: Request, res: Response) => {
  try {
    const sinceId = Number(req.query.sinceId || 0);
    const limit = Math.min(Number(req.query.limit || 50), 200);

    res.json({
      code: 200,
      message: '获取成功',
      data: sqliteStore.getAlertEvents(sinceId, limit),
    });
  } catch (error) {
    console.error('Get alert events error:', error);
    res.status(500).json({
      code: 500,
      message: error instanceof Error ? error.message : 'Internal server error',
      data: null,
    });
  }
});

/**
 * 404 处理
 */
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    code: 404,
    message: 'Not found',
    data: null,
  });
});

/**
 * 错误处理中间件
 */
app.use((err: Error, _req: Request, res: Response, _next: any) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    code: 500,
    message: 'Internal server error',
    data: null,
  });
});

let lastJdPrice: number | undefined;

jdGoldLiveService.addListener((quote) => {
  goldWebSocketService.broadcast('jd-gold.quote', quote);
  if (lastJdPrice === quote.zhejiangGold.price) {
    return;
  }

  try {
    sqliteStore.savePriceTick(priceAggregator.toJdGoldPrice(quote, 'CZB-JCJ'));
    lastJdPrice = quote.zhejiangGold.price;
  } catch (error) {
    console.error('Persist JD gold quote error:', error);
  }
});

bullionVaultLiveService.addListener((quote) => {
  try {
    sqliteStore.savePriceTick(priceAggregator.toBullionVaultGoldPrice(quote));
    goldWebSocketService.broadcast('bullionvault.quote', quote);
  } catch (error) {
    console.error('Persist BullionVault quote error:', error);
  }
});

async function backfillBullionVaultHistory(): Promise<void> {
  try {
    const quotes = await bullionVaultLiveService.getHistoricalQuotes(90);
    for (const quote of quotes) {
      sqliteStore.savePriceTick(
        priceAggregator.toBullionVaultGoldPrice(quote),
        quote.timestamp,
      );
    }
    console.log(`📚 BullionVault history backfilled: ${quotes.length} points`);
  } catch (error) {
    console.error('BullionVault history backfill failed:', error);
  }
}
/**
 * 启动服务器
 */
httpServer.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🚀 Gold Price Service Started');
  console.log('='.repeat(50));
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}${goldWebSocketService.getStatus().path}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
  console.log(`💰 Latest: http://localhost:${PORT}/api/gold/latest`);
  console.log(`📊 History: http://localhost:${PORT}/api/gold/history`);
  console.log(`📈 Historical: http://localhost:${PORT}/api/gold/historical?period=1m`);
  console.log(`📈 Full: http://localhost:${PORT}/api/gold/full`);
  console.log(`🔔 Alerts: http://localhost:${PORT}/api/alerts/rules`);
  console.log('='.repeat(50));

  if (process.env.BULLIONVAULT_ENABLED !== 'false') {
    bullionVaultLiveService.start();
    void backfillBullionVaultHistory();
    console.log('📡 BullionVault STOMP live feed enabled');
  }

  if (process.env.JD_GOLD_ENABLED !== 'false') {
    jdGoldLiveService.start();
    console.log(`📡 JD gold polling enabled (${jdGoldLiveService.getStatus().pollIntervalMs}ms)`);
  }

  if (process.env.COLLECTOR_ENABLED !== 'false') {
    priceCollector.start();
    console.log(`⏱️  Collector started: ${priceCollector.getStatus().priceIntervalMs}ms`);
  }
});

// 优雅关闭
const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down gracefully...`);
  priceCollector.stop();
  jdGoldLiveService.stop();
  bullionVaultLiveService.stop();
  goldWebSocketService.close();
  httpServer.close();
  sqliteStore.close();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function parseAlertRuleBody(body: any, partial = false): Partial<{
  symbol: string;
  targetPrice: number;
  direction: AlertDirection;
  enabled: boolean;
  cooldownSeconds: number;
}> & { targetPrice: number } {
  const input: Partial<{
    symbol: string;
    targetPrice: number;
    direction: AlertDirection;
    enabled: boolean;
    cooldownSeconds: number;
  }> = {};

  if (body.symbol !== undefined) {
    if (typeof body.symbol !== 'string' || body.symbol.trim().length === 0) {
      throw new Error('symbol must be a non-empty string');
    }
    input.symbol = body.symbol.trim().toUpperCase();
  }

  if (body.targetPrice !== undefined) {
    const targetPrice = Number(body.targetPrice);
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      throw new Error('targetPrice must be a positive number');
    }
    input.targetPrice = targetPrice;
  } else if (!partial) {
    throw new Error('targetPrice is required');
  }

  if (body.direction !== undefined) {
    if (body.direction !== 'below' && body.direction !== 'above') {
      throw new Error('direction must be below or above');
    }
    input.direction = body.direction;
  }

  if (body.enabled !== undefined) {
    input.enabled = Boolean(body.enabled);
  }

  if (body.cooldownSeconds !== undefined) {
    const cooldownSeconds = Number(body.cooldownSeconds);
    if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0) {
      throw new Error('cooldownSeconds must be a non-negative integer');
    }
    input.cooldownSeconds = cooldownSeconds;
  }

  return input as Partial<{
    symbol: string;
    targetPrice: number;
    direction: AlertDirection;
    enabled: boolean;
    cooldownSeconds: number;
  }> & { targetPrice: number };
}
