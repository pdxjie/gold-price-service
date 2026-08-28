// 后台价格采集器
import { CollectorStatus, GoldPrice } from '../types';
import { priceAggregator } from './price-aggregator';
import { sqliteStore } from './sqlite-store';

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
    const now = Date.now();

    for (const rule of rules) {
      const triggered = rule.direction === 'below'
        ? price.price <= rule.targetPrice
        : price.price >= rule.targetPrice;

      if (!triggered || !this.canTrigger(rule.lastTriggeredAt, rule.cooldownSeconds, now)) {
        continue;
      }

      const directionText = rule.direction === 'below' ? '低于' : '高于';
      sqliteStore.recordAlertEvent({
        ruleId: rule.id,
        symbol: rule.symbol,
        price: price.price,
        targetPrice: rule.targetPrice,
        direction: rule.direction,
        message: `${price.symbol} 当前 ${price.price}${price.unit}，已${directionText}提醒价 ${rule.targetPrice}${price.unit}`,
      });
    }
  }

  private canTrigger(lastTriggeredAt: string | undefined, cooldownSeconds: number, now: number): boolean {
    if (!lastTriggeredAt) {
      return true;
    }

    return now - new Date(lastTriggeredAt).getTime() >= cooldownSeconds * 1000;
  }
}

export const priceCollector = new PriceCollector();
