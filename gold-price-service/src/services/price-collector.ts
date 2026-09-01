// 后台价格采集器
import { CollectorStatus, GoldPrice } from '../types';
import { priceAggregator } from './price-aggregator';
import { sqliteStore } from './sqlite-store';
import { sendFeishuAlert } from './feishu-notifier';
import { sendWecomAlert } from './wecom-notifier';

export class PriceCollector {
  private priceTimer?: NodeJS.Timeout;
  private recycleTimer?: NodeJS.Timeout;
  private running = false;
  private collectingPrice = false;
  private collectingRecycle = false;
  private lastPriceCollectAt?: string;
  private lastRecycleCollectAt?: string;
  private lastError?: string;
  private readonly symbol = process.env.COLLECT_SYMBOL || 'AU9999';
  private readonly priceIntervalMs = Number(process.env.COLLECT_INTERVAL_MS || 5000);
  private readonly recycleIntervalMs = Number(process.env.RECYCLE_COLLECT_INTERVAL_MS || 60000);

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.collectPrice();
    this.collectRecyclePrices();

    this.priceTimer = setInterval(() => this.collectPrice(), this.priceIntervalMs);
    this.recycleTimer = setInterval(() => this.collectRecyclePrices(), this.recycleIntervalMs);
  }

  stop(): void {
    if (this.priceTimer) {
      clearInterval(this.priceTimer);
    }
    if (this.recycleTimer) {
      clearInterval(this.recycleTimer);
    }

    this.running = false;
  }

  getStatus(): CollectorStatus {
    return {
      running: this.running,
      symbol: this.symbol,
      priceIntervalMs: this.priceIntervalMs,
      recycleIntervalMs: this.recycleIntervalMs,
      lastPriceCollectAt: this.lastPriceCollectAt,
      lastRecycleCollectAt: this.lastRecycleCollectAt,
      lastError: this.lastError,
    };
  }

  private async collectPrice(): Promise<void> {
    if (this.collectingPrice) {
      return;
    }

    this.collectingPrice = true;
    try {
      const price = await priceAggregator.getLatestPrice(this.symbol, { bypassCache: true });
      sqliteStore.savePriceTick(price);
      this.evaluateAlerts(price);
      this.lastPriceCollectAt = new Date().toISOString();
      this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error('Price collector error:', error);
    } finally {
      this.collectingPrice = false;
    }
  }

  private async collectRecyclePrices(): Promise<void> {
    if (this.collectingRecycle) {
      return;
    }

    this.collectingRecycle = true;
    try {
      const fullData = await priceAggregator.getFullGoldData();
      const recyclePrices = fullData.data.recycle || [];
      sqliteStore.saveRecyclePrices(recyclePrices);
      const goldRecycle = recyclePrices.find((item) => item.type.includes('黄金') && !item.type.includes('22k') && !item.type.includes('18k') && !item.type.includes('14k')) || recyclePrices[0];
      if (goldRecycle) {
        this.evaluateExternalPrice({
          symbol: 'AU9999-RECYCLE',
          name: '黄金回收价',
          price: goldRecycle.price,
          unit: goldRecycle.unit,
          quoteTime: new Date(goldRecycle.updatedAt).toISOString(),
          fetchTime: new Date().toISOString(),
          source: 'gold-recycle',
        });
      }
      sqliteStore.cleanupOldPriceTicks();
      this.lastRecycleCollectAt = new Date().toISOString();
      this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error('Recycle collector error:', error);
    } finally {
      this.collectingRecycle = false;
    }
  }

  evaluateExternalPrice(price: GoldPrice, ruleIds?: ReadonlySet<number>): void {
    this.evaluateAlerts(price, ruleIds);
  }

  private evaluateAlerts(price: GoldPrice, ruleIds?: ReadonlySet<number>): void {
    const rules = [
      ...sqliteStore.getEnabledAlertRules(price.symbol),
      ...sqliteStore.getEnabledAlertRules(`${price.symbol}-REDEEM`),
    ].filter((rule) => !ruleIds || ruleIds.has(rule.id));

    for (const rule of rules) {
      const outsideThreshold = rule.direction === 'below'
        ? price.price <= rule.targetPrice
        : price.price >= rule.targetPrice;

      if (!outsideThreshold) {
        if (rule.triggered) {
          sqliteStore.setAlertTriggered(rule.id, false);
        }
        continue;
      }

      if (rule.triggered) {
        continue;
      }

      const cooldownReady = rule.cooldownSeconds <= 0 || !rule.lastTriggeredAt
        || Date.now() - new Date(rule.lastTriggeredAt).getTime() >= rule.cooldownSeconds * 1000;
      if (!cooldownReady) {
        sqliteStore.setAlertTriggered(rule.id, true);
        continue;
      }

      const directionText = rule.direction === 'below' ? '低于' : '高于';
      const actionText = rule.direction === 'below' ? '是否可以考虑买入？' : '是否可以考虑卖出？';
      const event = sqliteStore.recordAlertEvent({
        ruleId: rule.id,
        symbol: rule.symbol,
        price: price.price,
        targetPrice: rule.targetPrice,
        direction: rule.direction,
        message: `${getAlertSymbolLabel(price.symbol)}当前 ${price.price}${price.unit}，已${directionText}提醒价 ${rule.targetPrice}${price.unit}，${actionText}`,
      });
      sqliteStore.setAlertTriggered(rule.id, true);
      void this.sendNotifications(event);
    }
  }

  private async sendNotifications(event: Awaited<ReturnType<typeof sqliteStore.recordAlertEvent>>): Promise<void> {
    await Promise.all([
      this.sendFeishuNotification(event),
      this.sendWecomNotification(event),
    ]);
  }

  private async sendFeishuNotification(event: Awaited<ReturnType<typeof sqliteStore.recordAlertEvent>>): Promise<void> {
    const settings = sqliteStore.getFeishuSettings();
    if (!settings.enabled || !settings.webhook) return;

    try {
      const result = await sendFeishuAlert(event, settings);
      sqliteStore.updateFeishuSettings({ lastSentAt: result.sentAt, lastError: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sqliteStore.updateFeishuSettings({ lastError: message });
      console.error('Feishu alert error:', message);
    }
  }

  private async sendWecomNotification(event: Awaited<ReturnType<typeof sqliteStore.recordAlertEvent>>): Promise<void> {
    const settings = sqliteStore.getWecomSettings();
    if (!settings.enabled || !settings.webhook) return;

    try {
      const result = await sendWecomAlert(event, settings);
      sqliteStore.updateWecomSettings({ lastSentAt: result.sentAt, lastError: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sqliteStore.updateWecomSettings({ lastError: message });
      console.error('WeCom alert error:', message);
    }
  }
}

function getAlertSymbolLabel(symbol: string): string {
  const labels: Record<string, string> = {
    AU9999: '国内参考金价',
    'CZB-JCJ': '浙商积存金',
    'MS-JCJ': '民生积存金',
    'ICBC-JCJ': '工行积存金',
    'AU9999-REDEEM': '国内参考赎回价',
    'CZB-JCJ-REDEEM': '浙商积存金赎回价',
    'MS-JCJ-REDEEM': '民生积存金赎回价',
    'ICBC-JCJ-REDEEM': '工行积存金赎回价',
    'AU9999-RECYCLE': '黄金回收价',
    'CZB-JCJ-RECYCLE': '浙商积存金回收价',
    'MS-JCJ-RECYCLE': '民生积存金回收价',
    'ICBC-JCJ-RECYCLE': '工行积存金回收价',
  };
  return `${labels[symbol] || symbol} `;
}

export const priceCollector = new PriceCollector();
