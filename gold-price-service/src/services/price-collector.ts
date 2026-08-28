// 后台价格采集器
import { CollectorStatus, GoldPrice } from '../types';
import { priceAggregator } from './price-aggregator';
import { sqliteStore } from './sqlite-store';
import { sendFeishuAlert } from './feishu-notifier';

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
      sqliteStore.saveRecyclePrices(fullData.data.recycle || []);
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

  private evaluateAlerts(price: GoldPrice): void {
    const rules = sqliteStore.getEnabledAlertRules(price.symbol);

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

      const directionText = rule.direction === 'below' ? '低于' : '高于';
      const event = sqliteStore.recordAlertEvent({
        ruleId: rule.id,
        symbol: rule.symbol,
        price: price.price,
        targetPrice: rule.targetPrice,
        direction: rule.direction,
        message: `${price.symbol} 当前 ${price.price}${price.unit}，已${directionText}提醒价 ${rule.targetPrice}${price.unit}`,
      });
      sqliteStore.setAlertTriggered(rule.id, true);
      void this.sendFeishuNotification(event);
    }
  }

  private async sendFeishuNotification(event: Awaited<ReturnType<typeof sqliteStore.recordAlertEvent>>): Promise<void> {
    const settings = sqliteStore.getFeishuSettings();
    if (!settings.enabled || !settings.webhook) {
      return;
    }

    try {
      const result = await sendFeishuAlert(event, settings);
      sqliteStore.updateFeishuSettings({ lastSentAt: result.sentAt, lastError: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sqliteStore.updateFeishuSettings({ lastError: message });
      console.error('Feishu alert error:', message);
    }
  }
}

export const priceCollector = new PriceCollector();
