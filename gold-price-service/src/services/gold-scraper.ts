// 金价网页爬虫服务（参考 60s API 实现）
import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { MetalPrice, RetailPrice, RecyclePrice } from '../types';

export class GoldScraperService {
  private readonly panJiaURL = 'http://res.huangjinjiage.com.cn/panjia2.js';
  private readonly jinRiJinJiaURL = 'http://www.huangjinjiage.cn/jinrijinjia.html';
  private readonly timeout = 10000; // 10秒超时

  /**
   * 获取实时贵金属行情（从 panjia2.js）
   */
  async fetchMetalPrices(): Promise<MetalPrice[]> {
    try {
      const response = await axios.get(this.panJiaURL, {
        timeout: this.timeout,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      // 解码 GB2312
      const html = iconv.decode(Buffer.from(response.data), 'gb2312');

      // 解析 JavaScript 变量
      const metals = this.parseMetalPrices(html);

      return metals;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Metal prices fetch failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 获取金店价、银行金条价、回收价（从 jinrijinjia.html）
   */
  async fetchRetailAndRecyclePrices(): Promise<{
    stores: RetailPrice[];
    banks: RetailPrice[];
    recycle: RecyclePrice[];
  }> {
    try {
      const response = await axios.get(this.jinRiJinJiaURL, {
        timeout: this.timeout,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      // 解码 GB2312
      const html = iconv.decode(Buffer.from(response.data), 'gb2312');
      const $ = cheerio.load(html);

      const stores = this.parseStorePrices($);
      const banks = this.parseBankPrices($);
      const recycle = this.parseRecyclePrices($);

      return { stores, banks, recycle };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Retail prices fetch failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 解析贵金属实时价格
   */
  private parseMetalPrices(jsContent: string): MetalPrice[] {
    const arrayMetals = this.parseArrayMetalPrices(jsContent);
    if (arrayMetals.length > 0) {
      return arrayMetals;
    }

    const metals: MetalPrice[] = [];
    const now = Date.now();

    try {
      // panjia2.js 包含类似这样的变量：
      // var gold_9999 = "997.60";
      // var gold_9999_zuigao = "1002.20";
      // 等等

      // 解析主要品种
      const varieties = [
        { key: 'gold_jinrijiage', name: '今日金价' },
        { key: 'gold_jiage', name: '黄金价格' },
        { key: 'gold_9999', name: '黄金_9999' },
        { key: 'gold_td', name: '黄金_T+D' },
        { key: 'lundunjin', name: '伦敦金(现货黄金)' },
        { key: 'niuyuehuangjin', name: '纽约黄金(美国)' },
        { key: 'baiyin', name: '白银价格' },
        { key: 'bojin', name: '铂金价格' },
        { key: 'bajin', name: '钯金价格' },
      ];

      for (const variety of varieties) {
        const priceMatch = jsContent.match(new RegExp(`var ${variety.key}\\s*=\\s*["']([\\d.]+)["']`));
        const highMatch = jsContent.match(new RegExp(`var ${variety.key}_zuigao\\s*=\\s*["']([\\d.]+)["']`));
        const lowMatch = jsContent.match(new RegExp(`var ${variety.key}_zuidi\\s*=\\s*["']([\\d.]+)["']`));
        const updateMatch = jsContent.match(new RegExp(`var ${variety.key}_shijian\\s*=\\s*["']([^"']+)["']`));

        if (priceMatch) {
          const price = parseFloat(priceMatch[1]);
          const highPrice = highMatch ? parseFloat(highMatch[1]) : undefined;
          const lowPrice = lowMatch ? parseFloat(lowMatch[1]) : undefined;
          const updated = updateMatch ? updateMatch[1] : new Date().toLocaleString('zh-CN');

          // 判断单位
          let unit = '元/克';
          if (variety.name.includes('伦敦金') || variety.name.includes('纽约黄金')) {
            unit = '美元/盎司';
          }

          metals.push({
            name: variety.name,
            sellPrice: price,
            todayPrice: price,
            highPrice: highPrice,
            lowPrice: lowPrice,
            unit: unit,
            updated: updated,
            updatedAt: now,
          });
        }
      }
    } catch (error) {
      console.error('Parse metal prices error:', error);
    }

    return metals;
  }

  /**
   * 解析新版 panjia2.js 数组格式：
   * const panjia2 = "[1,992.39,...]";
   */
  private parseArrayMetalPrices(jsContent: string): MetalPrice[] {
    const panjiaMatch = jsContent.match(/const\s+panjia2\s*=\s*["']([^"']+)["']/);
    if (!panjiaMatch) {
      return [];
    }

    const values = panjiaMatch[1].split(',').map((raw) => {
      const value = raw.trim();
      return value === '--' ? undefined : Number(value);
    });

    const now = Date.now();
    const updated = new Date(now).toLocaleString('zh-CN', { hour12: false });
    const mappings = [
      { name: '今日金价', sell: 1, today: 13, high: 14, low: 15, unit: '元/克' },
      { name: '黄金价格', sell: 1, today: 13, high: 14, low: 15, unit: '元/克' },
      { name: '黄金_9999', sell: 28, today: 29, high: 30, low: 31, unit: '元/克' },
      { name: '黄金_T+D', sell: 32, today: 33, high: 34, low: 35, unit: '元/克' },
      { name: '伦敦金(现货黄金)', sell: 36, today: 37, high: 38, low: 39, unit: '美元/盎司' },
      { name: '纽约黄金(美国)', sell: 61, today: 62, high: 63, low: 64, unit: '美元/盎司' },
      { name: '白银价格', sell: 16, today: 17, high: 18, low: 19, unit: '元/克' },
      { name: '铂金价格', sell: 20, today: 21, high: 22, low: 23, unit: '元/克' },
      { name: '钯金价格', sell: 24, today: 25, high: 26, low: 27, unit: '元/克' },
    ];

    return mappings.reduce<MetalPrice[]>((metals, mapping) => {
      const sellPrice = values[mapping.sell];
      if (typeof sellPrice !== 'number' || Number.isNaN(sellPrice)) {
        return metals;
      }

      const todayPrice = values[mapping.today];
      const highPrice = values[mapping.high];
      const lowPrice = values[mapping.low];

      metals.push({
        name: mapping.name,
        sellPrice,
        todayPrice: typeof todayPrice === 'number' && !Number.isNaN(todayPrice) ? todayPrice : sellPrice,
        highPrice: typeof highPrice === 'number' && !Number.isNaN(highPrice) ? highPrice : undefined,
        lowPrice: typeof lowPrice === 'number' && !Number.isNaN(lowPrice) ? lowPrice : undefined,
        unit: mapping.unit,
        updated,
        updatedAt: now,
      });

      return metals;
    }, []);
  }

  /**
   * 解析金店价格
   */
  private parseStorePrices($: cheerio.CheerioAPI): RetailPrice[] {
    const stores: RetailPrice[] = [];
    const now = Date.now();

    try {
      // 查找包含金店价格的表格
      $('table').each((_, table) => {
        const $table = $(table);
        const header = $table.find('tr:first-child').text();

        if (header.includes('金店') || header.includes('品牌')) {
          $table.find('tr').each((index, row) => {
            if (index === 0) return; // 跳过表头

            const $row = $(row);
            const cols = $row.find('td');

            if (cols.length >= 3) {
              const brand = $(cols[0]).text().trim();
              const product = $(cols[1]).text().trim();
              const priceText = $(cols[2]).text().trim();
              const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));

              if (brand && !isNaN(price)) {
                stores.push({
                  brand: brand,
                  product: product || '足金',
                  price: price,
                  unit: '元/克',
                  formatted: `${price}元/克`,
                  updated: new Date().toLocaleDateString('zh-CN'),
                  updatedAt: now,
                });
              }
            }
          });
        }
      });
    } catch (error) {
      console.error('Parse store prices error:', error);
    }

    return stores;
  }

  /**
   * 解析银行金条价格
   */
  private parseBankPrices($: cheerio.CheerioAPI): RetailPrice[] {
    const banks: RetailPrice[] = [];
    const now = Date.now();

    try {
      $('table').each((_, table) => {
        const $table = $(table);
        const header = $table.find('tr:first-child').text();

        if (header.includes('银行') || header.includes('金条')) {
          $table.find('tr').each((index, row) => {
            if (index === 0) return;

            const $row = $(row);
            const cols = $row.find('td');

            if (cols.length >= 3) {
              const bank = $(cols[0]).text().trim();
              const product = $(cols[1]).text().trim();
              const priceText = $(cols[2]).text().trim();
              const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));

              if (bank && !isNaN(price)) {
                banks.push({
                  brand: bank,
                  product: product || '金条',
                  price: price,
                  unit: '元/克',
                  formatted: `${price}元/克`,
                  updated: new Date().toLocaleDateString('zh-CN'),
                  updatedAt: now,
                });
              }
            }
          });
        }
      });
    } catch (error) {
      console.error('Parse bank prices error:', error);
    }

    return banks;
  }

  /**
   * 解析回收价格
   */
  private parseRecyclePrices($: cheerio.CheerioAPI): RecyclePrice[] {
    const recycle: RecyclePrice[] = [];
    const now = Date.now();

    try {
      $('table').each((_, table) => {
        const $table = $(table);
        const header = $table.find('tr:first-child').text();

        if (header.includes('回收')) {
          $table.find('tr').each((index, row) => {
            if (index === 0) return;

            const $row = $(row);
            const cols = $row.find('td');

            if (cols.length >= 2) {
              const type = $(cols[0]).text().trim();
              const priceText = $(cols[1]).text().trim();
              const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));

              if (type && !isNaN(price)) {
                // 提取纯度信息
                let purity = '';
                if (type.includes('999')) purity = '999';
                else if (type.includes('22k') || type.includes('22K')) purity = '22K';
                else if (type.includes('18k') || type.includes('18K')) purity = '18K';
                else if (type.includes('14k') || type.includes('14K')) purity = '14K';

                recycle.push({
                  type: type,
                  price: price,
                  unit: '元/克',
                  formatted: `${price}元/克`,
                  purity: purity,
                  updated: new Date().toLocaleDateString('zh-CN'),
                  updatedAt: now,
                });
              }
            }
          });
        }
      });
    } catch (error) {
      console.error('Parse recycle prices error:', error);
    }

    return recycle;
  }
}

// 导出单例
export const goldScraperService = new GoldScraperService();
