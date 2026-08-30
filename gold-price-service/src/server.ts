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
import { goldScraperService } from './services/gold-scraper';
import akshareService from './services/akshare';
import { sendFeishuTest } from './services/feishu-notifier';
import { sendFeishuAlert } from './services/feishu-notifier';
import { sendWecomTest } from './services/wecom-notifier';
import { sendWecomAlert } from './services/wecom-notifier';

const app = express();
const PORT = process.env.PORT || 3000;
const httpServer = createServer(app);
let alertSimulationTimer: NodeJS.Timeout | undefined;
let alertSimulationStopTimer: NodeJS.Timeout | undefined;
let alertSimulationRunning = false;
let alertSimulationRuleIds: number[] = [];

function cleanupAlertSimulationRules(): void {
  for (const ruleId of alertSimulationRuleIds) {
    sqliteStore.deleteAlertRule(ruleId);
  }
  alertSimulationRuleIds = [];
}

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
    if ((req.query.symbol as string || 'AU9999').toUpperCase() === 'XAUUSD') {
      try {
        const fallback = sqliteStore.getLatestPrice('XAUUSD');
        if (fallback) {
          res.json({
            code: 200,
            message: '国际行情暂不可用，已返回本地最近数据',
            data: fallback,
          });
          return;
        }
      } catch (fallbackError) {
        console.error('Get latest price fallback error:', fallbackError);
      }

      res.json({
        code: 200,
        message: '国际行情暂不可用',
        data: null,
      });
      return;
    }

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

let akshareBackfillPromise: Promise<void> = Promise.resolve();
const AKSHARE_HISTORY_CACHE_MS = 5 * 60 * 1000;
const akshareHistoryCache = new Map<string, {
  loadedAt: number;
  data: Awaited<ReturnType<typeof akshareService.getGoldHistory>>;
}>();

async function loadAkshareHistory(period: '1m' | '3m') {
  const cached = akshareHistoryCache.get(period);
  if (cached && Date.now() - cached.loadedAt < AKSHARE_HISTORY_CACHE_MS) {
    return cached.data;
  }

  const data = await akshareService.getGoldHistory(period);
  akshareHistoryCache.set(period, { loadedAt: Date.now(), data });
  return data;
}

function getHistoryCutoffMs(range: string): number {
  const durations: Record<string, number> = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '3d': 3 * 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
    '3m': 90 * 24 * 60 * 60 * 1000,
  };
  return Date.now() - (durations[range] || durations['1h']);
}

function mapAkshareHistory(
  history: Awaited<ReturnType<typeof akshareService.getGoldHistory>>,
  range: string,
) {
  const cutoff = getHistoryCutoffMs(range);
  return history.data
    .map((point) => ({
      timestamp: new Date(`${point.date}T08:00:00+08:00`).toISOString(),
      price: point.price,
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close ?? point.price,
    }))
    .filter((point) => new Date(point.timestamp).getTime() >= cutoff);
}

app.get('/api/jd-gold/history', async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) || '1h';
    const symbol = 'CZB-JCJ';
    let history = { symbol, data: [] as ReturnType<typeof sqliteStore.getPriceHistory>['data'] };
    let databaseError: unknown;

    try {
      history = sqliteStore.getPriceHistory(symbol, range);
      if (history.data.length < 2) {
        const fallback = sqliteStore.getPriceHistory('AU9999', range);
        if (fallback.data.length > history.data.length) {
          history = { symbol, data: fallback.data };
        }
      }
    } catch (error) {
      databaseError = error;
      console.error('Read JD gold history from database error:', error);
    }

    const isLongRange = range === '3m' || range === '90d';
    if (isLongRange || history.data.length < 2) {
      try {
        const akshareHistory = await loadAkshareHistory(isLongRange ? '3m' : '1m');
        const historicalData = mapAkshareHistory(akshareHistory, range);
        if (isLongRange) {
          history = {
            symbol,
            data: [...historicalData, ...history.data].sort((left, right) => (
              new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
            )),
          };
        } else if (historicalData.length > history.data.length) {
          history = { symbol, data: historicalData };
        }
      } catch (fallbackError) {
        console.error('Get AKShare history fallback error:', fallbackError);
        if (history.data.length === 0 && databaseError) {
          throw fallbackError;
        }
      }
    }

    res.json({
      code: 200,
      message: databaseError ? '本地历史不可用，已返回历史行情' : '获取成功',
      data: history,
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
app.get('/api/gold/recycle/latest', async (_req: Request, res: Response) => {
  try {
    const recycle = sqliteStore.getLatestRecyclePrices();

    res.json({
      code: 200,
      message: '获取成功',
      data: recycle,
    });
  } catch (error) {
    console.error('Get recycle price error:', error);
    try {
      const fallback = await goldScraperService.fetchRetailAndRecyclePrices();
      res.json({
        code: 200,
        message: '数据库暂不可用，已实时解析回收价',
        data: fallback.recycle,
      });
      return;
    } catch (fallbackError) {
      console.error('Get recycle price scraper fallback error:', fallbackError);
      res.json({
        code: 200,
        message: '回收价暂不可用',
        data: [],
      });
    }
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
 * 获取飞书机器人配置状态
 * GET /api/notifications/feishu
 */
app.get('/api/notifications/feishu', (_req: Request, res: Response) => {
  try {
    const settings = sqliteStore.getFeishuSettings();
    res.json({
      code: 200,
      message: '获取成功',
      data: {
        enabled: settings.enabled,
        webhookConfigured: Boolean(settings.webhook),
        webhookPreview: maskSecret(settings.webhook),
        secretConfigured: Boolean(settings.secret),
        lastSentAt: settings.lastSentAt,
        lastError: settings.lastError,
      },
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error instanceof Error ? error.message : 'Internal server error',
      data: null,
    });
  }
});

/**
 * 保存飞书机器人配置
 * PATCH /api/notifications/feishu
 */
app.patch('/api/notifications/feishu', (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const input: {
      enabled?: boolean;
      webhook?: string;
      secret?: string;
    } = {};

    if (body.enabled !== undefined) {
      input.enabled = Boolean(body.enabled);
    }
    if (body.webhook !== undefined) {
      if (typeof body.webhook !== 'string') {
        throw new Error('webhook must be a string');
      }
      const webhook = body.webhook.trim();
      if (webhook && !/^https:\/\/(open\.feishu\.cn|open\.larksuite\.com)\/open-apis\/bot\/v2\/hook\//.test(webhook)) {
        throw new Error('请输入有效的飞书群机器人 Webhook 地址');
      }
      input.webhook = webhook;
    }
    if (body.secret !== undefined) {
      if (typeof body.secret !== 'string') {
        throw new Error('secret must be a string');
      }
      input.secret = body.secret.trim();
    }
    if (body.clearWebhook === true) {
      input.webhook = '';
    }
    if (body.clearSecret === true) {
      input.secret = '';
    }

    const settings = sqliteStore.updateFeishuSettings(input);
    res.json({
      code: 200,
      message: '保存成功',
      data: {
        enabled: settings.enabled,
        webhookConfigured: Boolean(settings.webhook),
        webhookPreview: maskSecret(settings.webhook),
        secretConfigured: Boolean(settings.secret),
        lastSentAt: settings.lastSentAt,
        lastError: settings.lastError,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    res.status(400).json({ code: 400, message, data: null });
  }
});

/**
 * 测试发送飞书机器人消息
 * POST /api/notifications/feishu/test
 */
app.post('/api/notifications/feishu/test', async (_req: Request, res: Response) => {
  const settings = sqliteStore.getFeishuSettings();
  try {
    const result = await sendFeishuTest({ ...settings, enabled: true });
    sqliteStore.updateFeishuSettings({ lastSentAt: result.sentAt, lastError: '' });
    res.json({ code: 200, message: '测试消息已发送', data: { sentAt: result.sentAt } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '飞书测试发送失败';
    sqliteStore.updateFeishuSettings({ lastError: message });
    res.status(502).json({ code: 502, message, data: null });
  }
});

app.get('/api/notifications/wecom', (_req: Request, res: Response) => {
  try {
    const settings = sqliteStore.getWecomSettings();
    res.json({
      code: 200,
      message: '获取成功',
      data: {
        enabled: settings.enabled,
        webhookConfigured: Boolean(settings.webhook),
        webhookPreview: maskSecret(settings.webhook),
        lastSentAt: settings.lastSentAt,
        lastError: settings.lastError,
      },
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error instanceof Error ? error.message : 'Internal server error',
      data: null,
    });
  }
});

app.patch('/api/notifications/wecom', (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const input: { enabled?: boolean; webhook?: string } = {};

    if (body.enabled !== undefined) {
      input.enabled = Boolean(body.enabled);
    }
    if (body.webhook !== undefined) {
      if (typeof body.webhook !== 'string') {
        throw new Error('webhook must be a string');
      }
      const webhook = body.webhook.trim();
      if (webhook && !/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[\w-]+$/i.test(webhook)) {
        throw new Error('请输入有效的企业微信群机器人 Webhook 地址');
      }
      input.webhook = webhook;
    }
    if (body.clearWebhook === true) {
      input.webhook = '';
    }

    const settings = sqliteStore.updateWecomSettings(input);
    res.json({
      code: 200,
      message: '保存成功',
      data: {
        enabled: settings.enabled,
        webhookConfigured: Boolean(settings.webhook),
        webhookPreview: maskSecret(settings.webhook),
        lastSentAt: settings.lastSentAt,
        lastError: settings.lastError,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    res.status(400).json({ code: 400, message, data: null });
  }
});

app.post('/api/notifications/wecom/test', async (_req: Request, res: Response) => {
  const settings = sqliteStore.getWecomSettings();
  try {
    const result = await sendWecomTest({ ...settings, enabled: true });
    sqliteStore.updateWecomSettings({ lastSentAt: result.sentAt, lastError: '' });
    res.json({ code: 200, message: '测试消息已发送', data: { sentAt: result.sentAt } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '企业微信测试发送失败';
    sqliteStore.updateWecomSettings({ lastError: message });
    res.status(502).json({ code: 502, message, data: null });
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
    const latest = req.query.latest === 'true';

    res.json({
      code: 200,
      message: '获取成功',
      data: sqliteStore.getAlertEvents(sinceId, limit, latest),
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

app.post('/api/alerts/test', async (req: Request, res: Response) => {
  const body = req.body || {};
  const event = {
    id: 0,
    ruleId: 0,
    symbol: typeof body.symbol === 'string' ? body.symbol : 'AU9999',
    price: Number(body.price) || 980,
    targetPrice: Number(body.targetPrice) || 980,
    direction: body.direction === 'below' ? 'below' as const : 'above' as const,
    message: typeof body.message === 'string' ? body.message : '这是一条提醒测试消息',
    triggeredAt: new Date().toISOString(),
  };
  const result: Record<string, string> = {};
  const feishu = sqliteStore.getFeishuSettings();
  const wecom = sqliteStore.getWecomSettings();
  if (feishu.enabled && feishu.webhook) {
    try { const sent = await sendFeishuAlert(event, feishu); sqliteStore.updateFeishuSettings({ lastSentAt: sent.sentAt, lastError: '' }); result.feishu = 'sent'; }
    catch (error) { result.feishu = error instanceof Error ? error.message : String(error); }
  }
  if (wecom.enabled && wecom.webhook) {
    try { const sent = await sendWecomAlert(event, wecom); sqliteStore.updateWecomSettings({ lastSentAt: sent.sentAt, lastError: '' }); result.wecom = 'sent'; }
    catch (error) { result.wecom = error instanceof Error ? error.message : String(error); }
  }
  res.json({ code: 200, message: '测试提醒已处理', data: { ...event, channels: result } });
});

app.get('/api/alerts/simulation/status', (_req: Request, res: Response) => {
  res.json({ code: 200, message: '获取成功', data: { running: alertSimulationRunning } });
});

app.post('/api/alerts/simulation/start', async (req: Request, res: Response) => {
  if (alertSimulationRunning) {
    res.json({ code: 200, message: '动态行情演示已在运行', data: { running: true } });
    return;
  }

  const highTarget = Number(req.body?.highTarget);
  const lowTarget = Number(req.body?.lowTarget);
  const targetDefinitions: Array<{ direction: AlertDirection; targetPrice: number }> = [
    Number.isFinite(highTarget) && highTarget > 0 ? { direction: 'above', targetPrice: highTarget } : undefined,
    Number.isFinite(lowTarget) && lowTarget > 0 ? { direction: 'below', targetPrice: lowTarget } : undefined,
  ].filter((item): item is { direction: AlertDirection; targetPrice: number } => Boolean(item));
  let basePrice = Number(req.body?.basePrice);

  try {
    const currentQuote = jdGoldLiveService.getLatestQuote();
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      basePrice = currentQuote?.zhejiangGold.price || 980;
    }

    cleanupAlertSimulationRules();
    const simulationTargets = targetDefinitions.length > 0
      ? targetDefinitions
      : [{ direction: 'above' as const, targetPrice: Number((basePrice + 0.5).toFixed(2)) }];
    alertSimulationRuleIds = simulationTargets.map((target) => {
      const temporaryRule = sqliteStore.createAlertRule({
        symbol: 'AU9999',
        targetPrice: target.targetPrice,
        direction: target.direction,
        enabled: true,
        cooldownSeconds: 0,
      });
      return temporaryRule.id;
    });
    const simulationRuleIds = new Set(alertSimulationRuleIds);

    const high = targetDefinitions.find((target) => target.direction === 'above')?.targetPrice;
    const low = targetDefinitions.find((target) => target.direction === 'below')?.targetPrice;
    const normalPrice = high && low && low < high
      ? Number(((low + high) / 2).toFixed(2))
      : low
        ? Number((low + 0.5).toFixed(2))
        : high
          ? Number((high - 0.5).toFixed(2))
          : basePrice;
    const sequence = [normalPrice];
    if (high) {
      sequence.push(Number((high + 0.08).toFixed(2)), normalPrice);
    }
    if (low) {
      sequence.push(Number((low - 0.08).toFixed(2)), normalPrice);
    }
    if (sequence.length === 1) {
      sequence.push(Number((normalPrice + 0.58).toFixed(2)), normalPrice);
    }
    let index = 0;
    alertSimulationRunning = true;

    const emitSimulationTick = () => {
      const quote = jdGoldLiveService.getLatestQuote();
      const price = sequence[index % sequence.length];
      index += 1;
      if (quote) {
        const now = new Date();
        const syntheticQuote = {
          ...quote,
          fetchedAt: now.toISOString(),
          fetchedAtMs: now.getTime(),
          zhejiangGold: {
            ...quote.zhejiangGold,
            price,
            change: Number((price - (quote.zhejiangGold.preClose || price)).toFixed(2)),
            quoteTime: now.toISOString(),
          },
        };
        goldWebSocketService.broadcast('jd-gold.quote', syntheticQuote);
      }
      priceCollector.evaluateExternalPrice({
        symbol: 'AU9999',
        name: '实时金价动态演示',
        price,
        unit: '元/克',
        quoteTime: new Date().toISOString(),
        fetchTime: new Date().toISOString(),
        source: 'alert-simulation',
      }, simulationRuleIds);
    };

    emitSimulationTick();
    alertSimulationTimer = setInterval(emitSimulationTick, 1800);
    alertSimulationStopTimer = setTimeout(() => {
      if (alertSimulationTimer) clearInterval(alertSimulationTimer);
      alertSimulationTimer = undefined;
      alertSimulationStopTimer = undefined;
      alertSimulationRunning = false;
      cleanupAlertSimulationRules();
    }, 30000);

    res.json({ code: 200, message: '动态行情演示已开始', data: { running: true, durationSeconds: 30, temporaryRuleIds: alertSimulationRuleIds } });
  } catch (error) {
    alertSimulationRunning = false;
    cleanupAlertSimulationRules();
    res.status(500).json({ code: 500, message: error instanceof Error ? error.message : '动态行情演示启动失败', data: null });
  }
});

app.post('/api/alerts/simulation/stop', (_req: Request, res: Response) => {
  if (alertSimulationTimer) clearInterval(alertSimulationTimer);
  if (alertSimulationStopTimer) clearTimeout(alertSimulationStopTimer);
  alertSimulationTimer = undefined;
  alertSimulationStopTimer = undefined;
  alertSimulationRunning = false;
  cleanupAlertSimulationRules();
  res.json({ code: 200, message: '动态行情演示已停止', data: { running: false } });
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

const lastJdPrices = new Map<string, number>();

jdGoldLiveService.addListener((quote) => {
  goldWebSocketService.broadcast('jd-gold.quote', quote);
  const instruments = [
    { symbol: 'CZB-JCJ', instrument: quote.zhejiangGold },
    ...(quote.minshengGold ? [{ symbol: 'MS-JCJ', instrument: quote.minshengGold }] : []),
  ];
  for (const { symbol, instrument } of instruments) {
    if (lastJdPrices.get(symbol) === instrument.price) {
      continue;
    }
    try {
      const price = priceAggregator.toJdGoldPrice(quote, symbol, instrument);
      sqliteStore.savePriceTick(price);
      priceCollector.evaluateExternalPrice(price);
      lastJdPrices.set(symbol, instrument.price);
    } catch (error) {
      console.error(`Persist JD gold quote error (${symbol}):`, error);
    }
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

async function backfillAkshareHistory(): Promise<void> {
  try {
    const history = await akshareService.getGoldHistory('3m');
    let saved = 0;
    for (const point of history.data) {
      const timestamp = new Date(`${point.date}T08:00:00.000Z`).toISOString();
      sqliteStore.savePriceTick({
        symbol: 'CZB-JCJ',
        name: '积存金历史参考',
        price: point.price,
        unit: '元/克',
        open: point.open,
        high: point.high,
        low: point.low,
        quoteTime: timestamp,
        fetchTime: new Date().toISOString(),
        source: history.source,
      }, timestamp, true);
      saved += 1;
    }
    console.log(`📚 AKShare/SGE history backfilled: ${saved} points`);
  } catch (error) {
    console.error('AKShare history backfill failed:', error);
  }
}
/**
 * 启动服务器
 */
httpServer.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🚀 Jinmai Gold Monitor Started');
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

  akshareBackfillPromise = backfillAkshareHistory();

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
let shutdownStarted = false;

const shutdown = (signal: string) => {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  console.log(`${signal} received, shutting down gracefully...`);
  priceCollector.stop();
  jdGoldLiveService.stop();
  bullionVaultLiveService.stop();
  goldWebSocketService.close();
  const finish = () => {
    sqliteStore.close();
    process.exit(0);
  };
  httpServer.close(finish);
  setTimeout(finish, 5000).unref();
};

process.on('message', (message: unknown) => {
  if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'shutdown') {
    shutdown('IPC');
  }
});

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

function maskSecret(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.length <= 12) {
    return `${value.slice(0, 4)}****`;
  }
  return `${value.slice(0, 8)}****${value.slice(-4)}`;
}
