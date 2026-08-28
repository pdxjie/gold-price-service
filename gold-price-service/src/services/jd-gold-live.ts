import axios from 'axios';

const JD_LOCAL_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;

const DEFAULT_SIMPLE_QUOTE_URL = 'https://ms.jr.jd.com/gw2/generic/jdtwt/h5/m/getSimpleQuoteUseUniqueCodes';
const DEFAULT_ZHEJIANG_GOLD_URL = 'https://api.jdjygold.com/gw2/generic/produTools/h5/m/getGoldPrice';
const DEFAULT_MINSHENG_GOLD_URL = 'https://ms.jr.jd.com/gw2/generic/CreatorSer/newh5/m/getFirstRelatedProductInfo';
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_STALE_AFTER_MS = 5000;

export interface JdMarketInstrument {
  uniqueCode: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open?: number;
  high?: number;
  low?: number;
  preClose?: number;
  volume?: number;
  quoteTime: string;
}

export interface JdGoldLiveQuote {
  source: 'jd-gold-poll';
  fetchedAt: string;
  fetchedAtMs: number;
  zhejiangGold: JdMarketInstrument;
  minshengGold?: JdMarketInstrument;
  exchangeRate: JdMarketInstrument;
  londonGold?: JdMarketInstrument;
  goldTd?: JdMarketInstrument;
  usdIndex?: JdMarketInstrument;
}

export interface JdGoldLiveStatus {
  running: boolean;
  connected: boolean;
  pollIntervalMs: number;
  staleAfterMs: number;
  simpleQuoteUrl: string;
  zhejiangGoldUrl: string;
  minshengGoldUrl: string;
  lastSuccessAt?: string;
  lastQuoteTime?: string;
  pollCount: number;
  latestQuote?: JdGoldLiveQuote;
  lastError?: string;
}

type QuotePayload = {
  uniqueCode?: unknown;
  code?: unknown;
  name?: unknown;
  lastPrice?: unknown;
  raise?: unknown;
  raisePercent?: unknown;
  openPrice?: unknown;
  highPrice?: unknown;
  lowPrice?: unknown;
  preClose?: unknown;
  tradeVol?: unknown;
  tradeDateTime?: unknown;
};

type SimpleQuoteResponse = {
  resultData?: {
    data?: QuotePayload[];
    systime?: unknown;
  };
  success?: boolean;
};

type ZhejiangGoldResponse = {
  resultData?: {
    data?: QuotePayload;
    success?: boolean;
  };
  success?: boolean;
};

type MinshengGoldResponse = {
  resultData?: {
    data?: {
      productId?: unknown;
      productName?: unknown;
      goldName?: unknown;
      minimumPriceValue?: unknown;
      dayFluctuateNum?: unknown;
      rateValue?: unknown;
    };
    success?: boolean;
  };
  success?: boolean;
};

type QuoteListener = (quote: JdGoldLiveQuote) => void;

export class JdGoldLiveService {
  private readonly simpleQuoteUrl = process.env.JD_SIMPLE_QUOTE_URL || DEFAULT_SIMPLE_QUOTE_URL;
  private readonly zhejiangGoldUrl = process.env.JD_ZHEJIANG_GOLD_URL || DEFAULT_ZHEJIANG_GOLD_URL;
  private readonly minshengGoldUrl = process.env.JD_MINSHENG_GOLD_URL || DEFAULT_MINSHENG_GOLD_URL;
  private readonly pollIntervalMs = this.readPositiveNumber('JD_GOLD_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS);
  private readonly staleAfterMs = this.readPositiveNumber(
    'JD_GOLD_STALE_AFTER_MS',
    Math.max(DEFAULT_STALE_AFTER_MS, this.pollIntervalMs * 3),
  );
  private readonly requestTimeoutMs = this.readPositiveNumber('JD_GOLD_REQUEST_TIMEOUT_MS', 5000);
  private timer?: NodeJS.Timeout;
  private running = false;
  private polling = false;
  private connected = false;
  private lastSuccessAt?: string;
  private latestQuote?: JdGoldLiveQuote;
  private lastError?: string;
  private pollCount = 0;
  private readonly listeners = new Set<QuoteListener>();

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    void this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.running = false;
    this.connected = false;
  }

  getLatestQuote(): JdGoldLiveQuote | null {
    if (!this.latestQuote || !this.lastSuccessAt) {
      return null;
    }

    if (Date.now() - new Date(this.lastSuccessAt).getTime() > this.staleAfterMs) {
      return null;
    }

    return this.latestQuote;
  }

  async waitForLatestQuote(timeoutMs = 5000): Promise<JdGoldLiveQuote> {
    const current = this.getLatestQuote();
    if (current) {
      return current;
    }

    if (!this.running) {
      this.start();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error('京东黄金实时行情暂不可用'));
      }, timeoutMs);

      const listener: QuoteListener = (quote) => {
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(quote);
      };

      this.listeners.add(listener);
    });
  }

  addListener(listener: QuoteListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): JdGoldLiveStatus {
    return {
      running: this.running,
      connected: this.connected && Boolean(this.getLatestQuote()),
      pollIntervalMs: this.pollIntervalMs,
      staleAfterMs: this.staleAfterMs,
      simpleQuoteUrl: this.simpleQuoteUrl,
      zhejiangGoldUrl: this.zhejiangGoldUrl,
      minshengGoldUrl: this.minshengGoldUrl,
      lastSuccessAt: this.lastSuccessAt,
      lastQuoteTime: this.latestQuote?.zhejiangGold.quoteTime,
      pollCount: this.pollCount,
      latestQuote: this.getLatestQuote() || undefined,
      lastError: this.lastError,
    };
  }

  private async poll(): Promise<void> {
    if (!this.running || this.polling) {
      return;
    }

    this.polling = true;
    try {
      const quote = await this.fetchQuote();
      this.latestQuote = quote;
      this.lastSuccessAt = quote.fetchedAt;
      this.lastError = undefined;
      this.connected = true;
      this.pollCount += 1;
      for (const listener of this.listeners) {
        listener(quote);
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.connected = Boolean(this.getLatestQuote());
      console.error('[jd-gold] poll failed:', this.lastError);
    } finally {
      this.polling = false;
      if (this.running) {
        this.timer = setTimeout(() => {
          void this.poll();
        }, this.pollIntervalMs);
      }
    }
  }

  private async fetchQuote(): Promise<JdGoldLiveQuote> {
    const simpleRequest = {
      ticket: 'gold-price-h5',
      uniqueCodes: ['WG-XAUUSD', 'SGE-Au(T+D)', 'FX-USDCNH', 'FX-DXY'],
    };
    const minshengRequest = {
      circleId: '13245',
      invokeSource: 5,
      productId: '21001001000001',
    };
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 GoldPriceService/1.0',
      Origin: 'https://gold-price-pro.pf.jd.com',
    };
    const [simpleResponse, zhejiangResponse, minshengResponse] = await Promise.all([
      axios.get<SimpleQuoteResponse>(this.simpleQuoteUrl, {
        params: { reqData: JSON.stringify(simpleRequest) },
        headers,
        timeout: this.requestTimeoutMs,
      }),
      axios.get<ZhejiangGoldResponse>(this.zhejiangGoldUrl, {
        params: { goldCode: 'CZB-JCJ' },
        headers,
        timeout: this.requestTimeoutMs,
      }),
      axios.get<MinshengGoldResponse>(this.minshengGoldUrl, {
        params: { reqData: JSON.stringify(minshengRequest) },
        headers,
        timeout: this.requestTimeoutMs,
      }).catch(() => undefined),
    ]);

    const simpleData = simpleResponse.data?.resultData?.data || [];
    const zhejiangData = zhejiangResponse.data?.resultData?.data;
    const zhejiangGold = this.mapInstrument(zhejiangData, 'CZB-JCJ', '浙商银行积存金', Date.now());
    const minshengGold = this.mapMinshengInstrument(minshengResponse?.data?.resultData?.data, Date.now());
    const exchangeRate = this.findInstrument(simpleData, 'FX-USDCNH', '离岸人民币');
    if (!zhejiangGold || !exchangeRate) {
      throw new Error('京东接口缺少浙商黄金或汇率数据');
    }

    const simpleTime = Number(simpleResponse.data?.resultData?.systime);
    const fetchedAtMs = Date.now();
    const quote: JdGoldLiveQuote = {
      source: 'jd-gold-poll',
      fetchedAt: new Date(fetchedAtMs).toISOString(),
      fetchedAtMs,
      zhejiangGold,
      minshengGold: minshengGold || undefined,
      exchangeRate,
      londonGold: this.findInstrument(simpleData, 'WG-XAUUSD', '伦敦金'),
      goldTd: this.findInstrument(simpleData, 'SGE-Au(T+D)', '黄金T+D'),
      usdIndex: this.findInstrument(simpleData, 'FX-DXY', '美元指数'),
    };

    if (Number.isFinite(simpleTime) && simpleTime > 0) {
      quote.exchangeRate.quoteTime = new Date(simpleTime).toISOString();
      if (quote.londonGold) {
        quote.londonGold.quoteTime = new Date(simpleTime).toISOString();
      }
      if (quote.goldTd) {
        quote.goldTd.quoteTime = new Date(simpleTime).toISOString();
      }
      if (quote.usdIndex) {
        quote.usdIndex.quoteTime = new Date(simpleTime).toISOString();
      }
    }

    return quote;
  }

  private findInstrument(items: QuotePayload[], uniqueCode: string, fallbackName: string): JdMarketInstrument | undefined {
    const item = items.find((candidate) => candidate.uniqueCode === uniqueCode);
    return this.mapInstrument(item, uniqueCode, fallbackName, Date.now()) || undefined;
  }

  private mapMinshengInstrument(
    item: NonNullable<MinshengGoldResponse['resultData']>['data'],
    fallbackTimeMs: number,
  ): JdMarketInstrument | null {
    if (!item) {
      return null;
    }

    const price = Number(item.minimumPriceValue);
    if (!Number.isFinite(price)) {
      return null;
    }

    return {
      uniqueCode: String(item.productId || '21001001000001'),
      name: String(item.goldName || item.productName || '民生积存金'),
      price,
      change: this.parseFormattedNumber(item.dayFluctuateNum),
      changePercent: this.parseFormattedNumber(item.rateValue),
      quoteTime: new Date(fallbackTimeMs).toISOString(),
    };
  }

  private mapInstrument(
    item: QuotePayload | undefined,
    fallbackCode: string,
    fallbackName: string,
    fallbackTimeMs: number,
  ): JdMarketInstrument | null {
    if (!item) {
      return null;
    }

    const price = Number(item.lastPrice);
    if (!Number.isFinite(price)) {
      return null;
    }

    const quoteTime = this.parseTradeTime(item.tradeDateTime, fallbackTimeMs);
    return {
      uniqueCode: String(item.uniqueCode || item.code || fallbackCode),
      name: String(item.name || fallbackName),
      price,
      change: this.toNumber(item.raise),
      changePercent: this.toNumber(item.raisePercent) * 100,
      open: this.optionalNumber(item.openPrice),
      high: this.optionalNumber(item.highPrice),
      low: this.optionalNumber(item.lowPrice),
      preClose: this.optionalNumber(item.preClose),
      volume: this.optionalNumber(item.tradeVol),
      quoteTime,
    };
  }

  private parseTradeTime(value: unknown, fallbackTimeMs: number): string {
    if (!value || typeof value !== 'object') {
      return new Date(fallbackTimeMs).toISOString();
    }

    const input = value as Record<string, unknown>;
    const year = Number(input.year);
    const month = Number(input.monthValue);
    const day = Number(input.dayOfMonth);
    const hour = Number(input.hour);
    const minute = Number(input.minute);
    const second = Number(input.second);
    if (![year, month, day, hour, minute, second].every((item) => Number.isFinite(item))) {
      return new Date(fallbackTimeMs).toISOString();
    }

    return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - JD_LOCAL_TIME_OFFSET_MS).toISOString();
  }

  private optionalNumber(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  private toNumber(value: unknown): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  private parseFormattedNumber(value: unknown): number {
    const number = Number(String(value ?? '').replace(/[+,%]/g, ''));
    return Number.isFinite(number) ? number : 0;
  }

  private readPositiveNumber(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}

export const jdGoldLiveService = new JdGoldLiveService();
