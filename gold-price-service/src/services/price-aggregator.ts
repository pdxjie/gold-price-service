// 价格数据聚合服务
import NodeCache from 'node-cache';
import { cmbChinaService } from './cmbchina';
import { goldScraperService } from './gold-scraper';
import { GoldPrice, GoldDataResponse, PriceHistory } from '../types';

export class PriceAggregatorService {
  private cache: NodeCache;
  private priceHistory: Map<string, Array<{ timestamp: string; price: number }>> = new Map();
  private readonly maxHistoryPoints = 1000; // 最多保存1000个历史点

  constructor() {
    // 缓存配置：stdTTL 10秒，checkperiod 15秒
    this.cache = new NodeCache({ stdTTL: 10, checkperiod: 15 });
  }

  /**
   * 获取最新金价（带缓存和降级策略）
   */
  async getLatestPrice(symbol: string = 'AU9999', options: { bypassCache?: boolean } = {}): Promise<GoldPrice> {
    const cacheKey = `latest_${symbol}`;

    // 尝试从缓存获取
    if (!options.bypassCache) {
      const cached = this.cache.get<GoldPrice>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    let price: GoldPrice | null = null;

    // 策略1：尝试黄金价格网爬虫
    try {
      const metals = await goldScraperService.fetchMetalPrices();
      const metalMap: Record<string, string> = {
        'AU9999': '黄金_9999',
        'AUTD': '黄金_T+D',
      };

      const targetName = metalMap[symbol];
      if (targetName) {
        const metal = metals.find(m => m.name === targetName);
        if (metal) {
          price = {
            symbol: symbol,
            name: metal.name,
            price: metal.sellPrice,
            unit: metal.unit,
            high: metal.highPrice,
            low: metal.lowPrice,
            quoteTime: metal.updated,
            fetchTime: new Date().toISOString(),
            source: 'scraper',
          };
          this.cache.set(cacheKey, price);
          this.addToHistory(symbol, price.price);
          return price;
        }
      }
    } catch (error) {
      console.error('Scraper fetch error:', error);
    }

    // 策略2：尝试招商银行接口（作为备用）
    try {
      price = await cmbChinaService.fetchGoldPrice(symbol);
      if (price) {
        this.cache.set(cacheKey, price);
        this.addToHistory(symbol, price.price);
        return price;
      }
    } catch (error) {
      console.error('CMB fetch error:', error);
    }

    // 策略3：返回缓存中的旧数据（如果有）
    const staleCache = this.cache.get<GoldPrice>(cacheKey);
    if (staleCache) {
      console.warn('Returning stale cache data');
      return staleCache;
    }

    // 所有策略都失败，抛出错误
    throw new Error('All data sources failed');
  }

  /**
   * 获取完整的金价数据（包括零售价、回收价等）
   */
  async getFullGoldData(): Promise<GoldDataResponse> {
    const cacheKey = 'full_data';

    // 尝试从缓存获取
    const cached = this.cache.get<GoldDataResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // 并行获取所有数据
      const [metals, retailData] = await Promise.all([
        goldScraperService.fetchMetalPrices(),
        goldScraperService.fetchRetailAndRecyclePrices(),
      ]);

      const response: GoldDataResponse = {
        code: 200,
        message: '获取成功',
        data: {
          date: new Date().toLocaleDateString('zh-CN'),
          metals: metals,
          stores: retailData.stores,
          banks: retailData.banks,
          recycle: retailData.recycle,
        },
      };

      // 缓存30秒
      this.cache.set(cacheKey, response, 30);

      return response;
    } catch (error) {
      throw new Error(`Failed to fetch full data: ${error}`);
    }
  }

  /**
   * 获取历史价格数据
   */
  getHistory(symbol: string = 'AU9999', range: string = '1h'): PriceHistory {
    const history = this.priceHistory.get(symbol) || [];

    // 根据时间范围过滤数据
    const now = Date.now();
    let cutoffTime: number;

    switch (range) {
      case '1h':
        cutoffTime = now - 60 * 60 * 1000; // 1小时
        break;
      case '1d':
        cutoffTime = now - 24 * 60 * 60 * 1000; // 1天
        break;
      case '3d':
        cutoffTime = now - 3 * 24 * 60 * 60 * 1000; // 3天
        break;
      case '7d':
        cutoffTime = now - 7 * 24 * 60 * 60 * 1000; // 7天
        break;
      default:
        cutoffTime = now - 60 * 60 * 1000; // 默认1小时
    }

    const filteredData = history.filter(point => {
      const timestamp = new Date(point.timestamp).getTime();
      return timestamp >= cutoffTime;
    });

    return {
      symbol: symbol,
      data: filteredData,
    };
  }

  /**
   * 添加历史数据点
   */
  private addToHistory(symbol: string, price: number): void {
    if (!this.priceHistory.has(symbol)) {
      this.priceHistory.set(symbol, []);
    }

    const history = this.priceHistory.get(symbol)!;
    const timestamp = new Date().toISOString();

    // 检查是否与最后一个点的价格相同
    if (history.length > 0) {
      const lastPoint = history[history.length - 1];
      if (Math.abs(lastPoint.price - price) < 0.01) {
        // 价格变化小于0.01，不添加新点
        return;
      }
    }

    history.push({ timestamp, price });

    // 限制历史数据点数量
    if (history.length > this.maxHistoryPoints) {
      history.shift(); // 移除最旧的点
    }
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.flushAll();
  }

  /**
   * 清空历史数据
   */
  clearHistory(): void {
    this.priceHistory.clear();
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { keys: number; hits: number; misses: number } {
    const stats = this.cache.getStats();
    return {
      keys: this.cache.keys().length,
      hits: stats.hits,
      misses: stats.misses,
    };
  }

  /**
   * 检查价格偏差
   */
  async checkPriceDeviation(symbol: string = 'AU9999'): Promise<{
    deviation: number;
    cmbPrice: number | null;
    scraperPrice: number | null;
    warning: string | null;
  }> {
    let cmbPrice: number | null = null;
    let scraperPrice: number | null = null;

    try {
      const cmbData = await cmbChinaService.fetchGoldPrice(symbol);
      cmbPrice = cmbData?.price || null;
    } catch (error) {
      console.error('CMB check error:', error);
    }

    try {
      const metals = await goldScraperService.fetchMetalPrices();
      const metal = metals.find(m => m.name === '黄金_9999');
      scraperPrice = metal?.sellPrice || null;
    } catch (error) {
      console.error('Scraper check error:', error);
    }

    let deviation = 0;
    let warning: string | null = null;

    if (cmbPrice && scraperPrice) {
      deviation = Math.abs((cmbPrice - scraperPrice) / cmbPrice);

      if (deviation > 0.01) {
        warning = `价格偏差超过1%: CMB=${cmbPrice}, Scraper=${scraperPrice}`;
      } else if (deviation > 0.005) {
        warning = `价格偏差超过0.5%: CMB=${cmbPrice}, Scraper=${scraperPrice}`;
      } else if (deviation > 0.003) {
        warning = `价格偏差超过0.3%: CMB=${cmbPrice}, Scraper=${scraperPrice}`;
      }
    }

    return {
      deviation,
      cmbPrice,
      scraperPrice,
      warning,
    };
  }
}

// 导出单例
export const priceAggregator = new PriceAggregatorService();
