import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import axios from 'axios';
import SockJS from 'sockjs-client';

const TROY_OUNCE_GRAMS = 31.1034768;
const DEFAULT_ENDPOINT = 'https://chart-data.bullionvault.com/price_feed';
const DEFAULT_STALE_AFTER_MS = 120000;

export interface BullionVaultLiveQuote {
  securityId: string;
  valuationSecurityId: string;
  pricePerKg: number;
  highPerKg: number;
  lowPerKg: number;
  pricePerTroyOunce: number;
  highPerTroyOunce: number;
  lowPerTroyOunce: number;
  timestamp: string;
  timestampMs: number;
  source: 'bullionvault-stomp' | 'bullionvault-history';
}

export interface BullionVaultLiveStatus {
  running: boolean;
  connected: boolean;
  endpoint: string;
  topic: string;
  lastMessageAt?: string;
  lastPriceTime?: string;
  messageCount: number;
  latestQuote?: BullionVaultLiveQuote;
  lastError?: string;
}

type PricePayload = {
  latestPrice?: unknown;
  price?: unknown;
  high?: unknown;
  low?: unknown;
  priceTime?: unknown;
  ts?: unknown;
};

type BatchPayload = {
  securityId?: unknown;
  valuationSecurityId?: unknown;
  prices?: PricePayload[];
};

type QuoteListener = (quote: BullionVaultLiveQuote) => void;

export class BullionVaultLiveService {
  private readonly endpoint = process.env.BULLIONVAULT_STOMP_URL || DEFAULT_ENDPOINT;
  private readonly securityId = process.env.BULLIONVAULT_SECURITY_ID || 'AUX';
  private readonly valuationSecurityId = process.env.BULLIONVAULT_CURRENCY || 'USD';
  private readonly bootstrapInterval = Number(process.env.BULLIONVAULT_BOOTSTRAP_INTERVAL || 5);
  private readonly staleAfterMs = Number(
    process.env.BULLIONVAULT_STALE_AFTER_MS || DEFAULT_STALE_AFTER_MS,
  );
  private readonly topic = `/t/${this.securityId}/${this.valuationSecurityId}`;
  private readonly bootstrapTopic = `${this.topic}/${this.bootstrapInterval}`;
  private readonly historyInterval = Number(process.env.BULLIONVAULT_HISTORY_INTERVAL || 43200);

  private client?: Client;
  private bootstrapSubscription?: StompSubscription;
  private liveSubscription?: StompSubscription;
  private latestQuote?: BullionVaultLiveQuote;
  private running = false;
  private connected = false;
  private lastMessageAt?: string;
  private lastError?: string;
  private messageCount = 0;
  private readonly listeners = new Set<QuoteListener>();

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.client = new Client({
      webSocketFactory: () => new SockJS(this.endpoint) as any,
      reconnectDelay: 2000,
      connectionTimeout: 10000,
      heartbeatIncoming: 0,
      heartbeatOutgoing: 10000,
      debug: process.env.BULLIONVAULT_STOMP_DEBUG === 'true'
        ? (message) => console.log(`[bullionvault-stomp] ${message}`)
        : () => undefined,
      onConnect: () => {
        this.connected = true;
        this.lastError = undefined;
        this.subscribeToQuotes();
        console.log('[bullionvault-stomp] connected');
      },
      onStompError: (frame) => {
        this.recordError(`STOMP error: ${frame.headers.message || frame.body || 'unknown error'}`);
      },
      onWebSocketError: (error) => {
        this.recordError(`WebSocket error: ${this.errorMessage(error)}`);
      },
      onWebSocketClose: (event) => {
        this.connected = false;
        this.bootstrapSubscription = undefined;
        this.liveSubscription = undefined;
        console.warn(`[bullionvault-stomp] disconnected (${event.code} ${event.reason || ''})`);
      },
    });

    try {
      this.client.activate();
    } catch (error) {
      this.recordError('Activation failed: ' + this.errorMessage(error));
    }
  }

  stop(): void {
    this.running = false;
    this.connected = false;
    this.unsubscribeAll();

    const client = this.client;
    this.client = undefined;
    if (client) {
      void client.deactivate().catch((error) => {
        this.recordError(`Deactivation failed: ${this.errorMessage(error)}`);
      });
    }
  }

  async getHistoricalQuotes(days = 90): Promise<BullionVaultLiveQuote[]> {
    const url = new URL(
      `/prices/CSV/${encodeURIComponent(this.securityId)}/${encodeURIComponent(this.valuationSecurityId)}/${this.historyInterval}/Full`,
      this.endpoint,
    ).toString();
    const response = await axios.get<string>(url, {
      responseType: 'text',
      timeout: 20000,
    });
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

    return response.data
      .split(/\r?\n/)
      .slice(1)
      .map((line) => this.parseHistoricalLine(line))
      .filter((quote): quote is BullionVaultLiveQuote => quote !== null)
      .filter((quote) => quote.timestampMs >= cutoffMs)
      .sort((left, right) => left.timestampMs - right.timestampMs);
  }

  getLatestQuote(): BullionVaultLiveQuote | null {
    if (!this.latestQuote) {
      return null;
    }

    if (Date.now() - this.latestQuote.timestampMs > this.staleAfterMs) {
      return null;
    }

    return this.latestQuote;
  }

  async waitForLatestQuote(timeoutMs = 10000): Promise<BullionVaultLiveQuote> {
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
        reject(new Error('BullionVault real-time quote is not available'));
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

  getStatus(): BullionVaultLiveStatus {
    return {
      running: this.running,
      connected: this.connected,
      endpoint: this.endpoint,
      topic: this.topic,
      lastMessageAt: this.lastMessageAt,
      lastPriceTime: this.latestQuote?.timestamp,
      messageCount: this.messageCount,
      latestQuote: this.latestQuote,
      lastError: this.lastError,
    };
  }

  private parseHistoricalLine(line: string): BullionVaultLiveQuote | null {
    if (!line.trim()) {
      return null;
    }

    const values = line.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
    if (values.length < 8) {
      return null;
    }

    const timestampMs = this.parseHistoricalTimestamp(values[0]);
    const pricePerKg = Number(values[3]);
    const highPerKg = Number(values[1]);
    const lowPerKg = Number(values[2]);
    const pricePerTroyOunce = Number(values[7]);
    const highPerTroyOunce = Number(values[5]);
    const lowPerTroyOunce = Number(values[6]);
    if (![timestampMs, pricePerKg, highPerKg, lowPerKg, pricePerTroyOunce, highPerTroyOunce, lowPerTroyOunce]
      .every((value) => Number.isFinite(value) && value > 0)) {
      return null;
    }

    return {
      securityId: this.securityId,
      valuationSecurityId: this.valuationSecurityId,
      pricePerKg,
      highPerKg,
      lowPerKg,
      pricePerTroyOunce,
      highPerTroyOunce,
      lowPerTroyOunce,
      timestamp: new Date(timestampMs).toISOString(),
      timestampMs,
      source: 'bullionvault-history',
    };
  }

  private parseHistoricalTimestamp(value: string): number {
    const match = value.match(/^(\d{2}):(\d{2}):(\d{2}) (\d{2})-([A-Za-z]{3})-(\d{4})$/);
    if (!match) {
      return NaN;
    }

    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = months.indexOf(match[5].toLowerCase());
    if (month < 0) {
      return NaN;
    }

    return Date.UTC(
      Number(match[6]),
      month,
      Number(match[4]),
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );
  }

  private subscribeToQuotes(): void {
    if (!this.client?.connected) {
      return;
    }

    this.unsubscribeAll();
    this.bootstrapSubscription = this.client.subscribe(
      this.bootstrapTopic,
      (message) => this.handleBootstrapMessage(message),
    );
  }

  private handleBootstrapMessage(message: IMessage): void {
    try {
      const payload = JSON.parse(message.body) as BatchPayload;
      const prices = Array.isArray(payload.prices) ? payload.prices : [];
      const latest = prices.reduce<PricePayload | undefined>((current, candidate) => {
        const currentTime = current ? this.toTimestampMs(current.priceTime) : -1;
        const candidateTime = this.toTimestampMs(candidate.priceTime);
        return !current || candidateTime > currentTime ? candidate : current;
      }, undefined);

      if (!latest) {
        throw new Error('Bootstrap message does not contain prices');
      }

      const quote = this.toQuote(latest);
      this.publishQuote(quote);
      this.bootstrapSubscription?.unsubscribe();
      this.bootstrapSubscription = undefined;
      this.liveSubscription = this.client?.subscribe(
        this.topic,
        (liveMessage) => this.handleLiveMessage(liveMessage),
      );
    } catch (error) {
      this.recordError(`Bootstrap message parse failed: ${this.errorMessage(error)}`);
    }
  }

  private handleLiveMessage(message: IMessage): void {
    try {
      const payload = JSON.parse(message.body) as PricePayload;
      this.publishQuote(this.toQuote(payload));
    } catch (error) {
      this.recordError(`Live message parse failed: ${this.errorMessage(error)}`);
    }
  }

  private publishQuote(quote: BullionVaultLiveQuote): void {
    this.latestQuote = quote;
    this.lastMessageAt = new Date().toISOString();
    this.messageCount += 1;
    this.lastError = undefined;

    for (const listener of this.listeners) {
      try {
        listener(quote);
      } catch (error) {
        this.recordError(`Quote listener failed: ${this.errorMessage(error)}`);
      }
    }
  }

  private toQuote(payload: PricePayload): BullionVaultLiveQuote {
    const pricePerKg = this.requiredNumber(payload.latestPrice ?? payload.price, 'price');
    const highPerKg = this.optionalNumber(payload.high) ?? pricePerKg;
    const lowPerKg = this.optionalNumber(payload.low) ?? pricePerKg;
    const timestampMs = this.toTimestampMs(payload.priceTime ?? payload.ts);

    return {
      securityId: this.securityId,
      valuationSecurityId: this.valuationSecurityId,
      pricePerKg,
      highPerKg,
      lowPerKg,
      pricePerTroyOunce: this.toTroyOunce(pricePerKg),
      highPerTroyOunce: this.toTroyOunce(highPerKg),
      lowPerTroyOunce: this.toTroyOunce(lowPerKg),
      timestamp: new Date(timestampMs).toISOString(),
      timestampMs,
      source: 'bullionvault-stomp',
    };
  }

  private toTroyOunce(pricePerKg: number): number {
    return pricePerKg * TROY_OUNCE_GRAMS / 1000;
  }

  private toTimestampMs(value: unknown): number {
    const timestamp = this.requiredNumber(value, 'timestamp');
    const timestampMs = timestamp < 100000000000 ? timestamp * 1000 : timestamp;
    if (!Number.isInteger(timestampMs) || timestampMs <= 0) {
      throw new Error('invalid timestamp');
    }
    return timestampMs;
  }

  private requiredNumber(value: unknown, field: string): number {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      throw new Error(`invalid ${field}`);
    }
    return number;
  }

  private optionalNumber(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
  }

  private unsubscribeAll(): void {
    this.bootstrapSubscription?.unsubscribe();
    this.liveSubscription?.unsubscribe();
    this.bootstrapSubscription = undefined;
    this.liveSubscription = undefined;
  }

  private recordError(message: string): void {
    this.lastError = message;
    console.error(`[bullionvault-stomp] ${message}`);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export const bullionVaultLiveService = new BullionVaultLiveService();
