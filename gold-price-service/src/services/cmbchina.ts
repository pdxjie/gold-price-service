// 招商银行金价接口服务
import axios from 'axios';
import { GoldPrice } from '../types';

interface CMBGoldData {
  variety: string;      // 品种名称，如 Au99.99
  curPrice: string;     // 当前价
  upDown: string;       // 涨跌额
  open: string;         // 开盘价
  preClose: string;     // 昨收价
  high: string;         // 最高价
  low: string;          // 最低价
  avePrice: string;     // 均价
  tradeCount: string;   // 成交量
  time: string;         // 行情时间（秒级），如 13:28:36
  goldNo: string;       // 品种代码，如 AU9999
}

interface CMBResponse {
  returnCode: string;
  errorMsg: string | null;
  body: {
    data: CMBGoldData[];
    time: string;       // 接口更新时间，如 2026-08-27 13:29
  };
}

export class CMBChinaService {
  private readonly baseURL = 'https://m.cmbchina.com/api/rate/gold';
  private readonly timeout = 5000; // 5秒超时

  /**
   * 获取招商银行金价数据
   */
  async fetchGoldPrices(): Promise<GoldPrice[]> {
    try {
      const response = await axios.get<CMBResponse>(this.baseURL, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      if (response.data.returnCode !== 'SUC0000') {
        throw new Error(`CMB API error: ${response.data.errorMsg || 'Unknown error'}`);
      }

      const fetchTime = new Date().toISOString();
      const bodyTime = response.data.body.time;

      return response.data.body.data.map((item) => this.transformData(item, bodyTime, fetchTime));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          throw new Error('CMB API timeout');
        }
        throw new Error(`CMB API request failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 获取特定品种的金价
   */
  async fetchGoldPrice(symbol: string): Promise<GoldPrice | null> {
    const prices = await this.fetchGoldPrices();
    return prices.find((p) => p.symbol === symbol) || null;
  }

  /**
   * 转换数据格式
   */
  private transformData(data: CMBGoldData, bodyTime: string, fetchTime: string): GoldPrice {
    const price = parseFloat(data.curPrice);
    const change = parseFloat(data.upDown);
    const preClose = parseFloat(data.preClose);

    // 计算涨跌幅
    let changePercent = 0;
    if (preClose > 0) {
      changePercent = (change / preClose) * 100;
    }

    return {
      symbol: data.goldNo,
      name: data.variety,
      price: price,
      unit: '元/克',
      change: change,
      changePercent: parseFloat(changePercent.toFixed(2)),
      open: parseFloat(data.open),
      high: parseFloat(data.high),
      low: parseFloat(data.low),
      preClose: preClose,
      volume: data.tradeCount,
      quoteTime: this.parseQuoteTime(bodyTime, data.time),
      fetchTime: fetchTime,
      source: 'cmbchina',
    };
  }

  /**
   * 解析行情时间
   * @param date 日期部分，如 "2026-08-27 13:29"
   * @param time 时间部分，如 "13:28:36"
   * @returns ISO 格式时间字符串
   */
  private parseQuoteTime(date: string, time: string): string {
    // date 格式: "2026-08-27 13:29"
    // time 格式: "13:28:36"
    // 我们使用 date 的日期部分 + time 的时间部分
    const datePart = date.split(' ')[0]; // "2026-08-27"
    const dateTime = `${datePart} ${time}`;

    try {
      // 转换为 ISO 格式
      return new Date(dateTime).toISOString();
    } catch (error) {
      // 如果解析失败，返回当前时间
      return new Date().toISOString();
    }
  }

  /**
   * 检查数据是否过期（超过30秒）
   */
  isDataStale(quoteTime: string): boolean {
    const now = new Date().getTime();
    const quoteTimestamp = new Date(quoteTime).getTime();
    const diffSeconds = (now - quoteTimestamp) / 1000;
    return diffSeconds > 30;
  }
}

// 导出单例
export const cmbChinaService = new CMBChinaService();
