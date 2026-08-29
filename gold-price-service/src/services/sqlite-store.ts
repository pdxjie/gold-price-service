// SQLite 数据存储服务
import fs from 'fs';
import path from 'path';
import {
  AlertDirection,
  AlertEvent,
  FeishuSettings,
  WecomSettings,
  AlertRule,
  GoldPrice,
  PriceHistory,
  RecyclePrice,
} from '../types';

const { DatabaseSync } = require('node:sqlite');

type Database = InstanceType<typeof DatabaseSync>;

interface PriceTickRow {
  symbol: string;
  name: string;
  price: number;
  unit: string;
  change: number | null;
  change_percent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  pre_close: number | null;
  volume: string | null;
  quote_time: string | null;
  fetch_time: string;
  source: string;
  created_at: string;
}

interface RecycleRow {
  type: string;
  price: number;
  unit: string;
  formatted: string;
  purity: string | null;
  updated: string;
  updated_at: number;
}

interface AlertRuleRow {
  id: number;
  symbol: string;
  target_price: number;
  direction: AlertDirection;
  enabled: number;
  cooldown_seconds: number;
  triggered: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AlertEventRow {
  id: number;
  rule_id: number;
  symbol: string;
  price: number;
  target_price: number;
  direction: AlertDirection;
  message: string;
  triggered_at: string;
}

export class SQLiteStore {
  private db: Database;
  readonly dbPath: string;

  constructor(dbPath = process.env.GOLD_DB_PATH || path.join(process.cwd(), 'data', 'gold-prices.sqlite')) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.init();
  }

  savePriceTick(
    price: GoldPrice,
    createdAt = new Date().toISOString(),
    deduplicate = price.source === 'bullionvault-history',
  ): number {
    if (deduplicate && price.quoteTime) {
      const existing = this.db.prepare(`
        SELECT id
        FROM price_ticks
        WHERE symbol = ? AND quote_time = ?
        LIMIT 1
      `).get(price.symbol, price.quoteTime) as { id: number } | undefined;

      if (existing) {
        return existing.id;
      }
    }
    const result = this.db.prepare(`
      INSERT INTO price_ticks (
        symbol, name, price, unit, change, change_percent, open, high, low,
        pre_close, volume, quote_time, fetch_time, source, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      price.symbol,
      price.name,
      price.price,
      price.unit,
      price.change ?? null,
      price.changePercent ?? null,
      price.open ?? null,
      price.high ?? null,
      price.low ?? null,
      price.preClose ?? null,
      price.volume ?? null,
      price.quoteTime ?? null,
      price.fetchTime,
      price.source,
      createdAt,
    );

    return Number(result.lastInsertRowid);
  }

  getLatestPrice(symbol = 'AU9999'): GoldPrice | null {
    const row = this.db.prepare(`
      SELECT *
      FROM price_ticks
      WHERE symbol = ?
      ORDER BY COALESCE(quote_time, created_at) DESC, id DESC
      LIMIT 1
    `).get(symbol) as PriceTickRow | undefined;

    return row ? this.mapPriceTick(row) : null;
  }

  getPriceHistory(symbol = 'AU9999', range = '1h'): PriceHistory {
    const cutoff = new Date(Date.now() - this.rangeToMs(range)).toISOString();
    const rows = this.db.prepare(`
      SELECT *
      FROM price_ticks
      WHERE symbol = ? AND created_at >= ?
      ORDER BY created_at ASC
    `).all(symbol, cutoff) as PriceTickRow[];
    const sampledRows = this.samplePriceRows(rows, 1200);

    return {
      symbol,
      data: sampledRows.map((row) => ({
        timestamp: row.created_at,
        price: row.price,
        open: row.open ?? undefined,
        high: row.high ?? undefined,
        low: row.low ?? undefined,
        close: row.price,
      })),
    };
  }

  private samplePriceRows(rows: PriceTickRow[], maxPoints: number): PriceTickRow[] {
    if (rows.length <= maxPoints) {
      return rows;
    }

    const sampled: PriceTickRow[] = [];
    const step = (rows.length - 1) / (maxPoints - 1);
    for (let index = 0; index < maxPoints; index += 1) {
      sampled.push(rows[Math.round(index * step)]);
    }
    return sampled;
  }

  saveRecyclePrices(recyclePrices: RecyclePrice[], fetchTime = new Date().toISOString()): void {
    if (recyclePrices.length === 0) {
      return;
    }

    const insert = this.db.prepare(`
      INSERT INTO recycle_prices (
        type, price, unit, formatted, purity, updated, updated_at, fetch_time
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec('BEGIN');
    try {
      for (const item of recyclePrices) {
        insert.run(
          item.type,
          item.price,
          item.unit,
          item.formatted,
          item.purity ?? null,
          item.updated,
          item.updatedAt,
          fetchTime,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getLatestRecyclePrices(): RecyclePrice[] {
    const rows = this.db.prepare(`
      SELECT rp.*
      FROM recycle_prices rp
      JOIN (
        SELECT type, MAX(id) AS id
        FROM recycle_prices
        GROUP BY type
      ) latest ON rp.id = latest.id
      ORDER BY rp.price DESC
    `).all() as RecycleRow[];

    return rows.map((row) => ({
      type: row.type,
      price: row.price,
      unit: row.unit,
      formatted: row.formatted,
      purity: row.purity ?? undefined,
      updated: row.updated,
      updatedAt: row.updated_at,
    }));
  }

  createAlertRule(input: {
    symbol?: string;
    targetPrice: number;
    direction?: AlertDirection;
    enabled?: boolean;
    cooldownSeconds?: number;
  }): AlertRule {
    const now = new Date().toISOString();
    const symbol = input.symbol || 'AU9999';
    const direction = input.direction || 'below';
    const cooldownSeconds = input.cooldownSeconds ?? 1800;

    const result = this.db.prepare(`
      INSERT INTO alert_rules (
        symbol, target_price, direction, enabled, cooldown_seconds,
        triggered, last_triggered_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)
    `).run(
      symbol,
      input.targetPrice,
      direction,
      input.enabled === false ? 0 : 1,
      cooldownSeconds,
      now,
      now,
    );

    const rule = this.getAlertRule(Number(result.lastInsertRowid));
    if (!rule) {
      throw new Error('Failed to create alert rule');
    }
    return rule;
  }

  getAlertRules(): AlertRule[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM alert_rules
      ORDER BY enabled DESC, updated_at DESC
    `).all() as AlertRuleRow[];

    return rows.map((row) => this.mapAlertRule(row));
  }

  getEnabledAlertRules(symbol: string): AlertRule[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM alert_rules
      WHERE symbol = ? AND enabled = 1
      ORDER BY updated_at DESC
    `).all(symbol) as AlertRuleRow[];

    return rows.map((row) => this.mapAlertRule(row));
  }

  updateAlertRule(id: number, input: Partial<{
    symbol: string;
    targetPrice: number;
    direction: AlertDirection;
    enabled: boolean;
    cooldownSeconds: number;
  }>): AlertRule | null {
    const current = this.getAlertRule(id);
    if (!current) {
      return null;
    }

    const next = {
      symbol: input.symbol ?? current.symbol,
      targetPrice: input.targetPrice ?? current.targetPrice,
      direction: input.direction ?? current.direction,
      enabled: input.enabled ?? current.enabled,
      cooldownSeconds: input.cooldownSeconds ?? current.cooldownSeconds,
      triggered: (input.targetPrice ?? current.targetPrice) === current.targetPrice
        && (input.direction ?? current.direction) === current.direction
        ? current.triggered
        : false,
      updatedAt: new Date().toISOString(),
    };

    this.db.prepare(`
      UPDATE alert_rules
      SET symbol = ?,
          target_price = ?,
          direction = ?,
          enabled = ?,
          cooldown_seconds = ?,
          triggered = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      next.symbol,
      next.targetPrice,
      next.direction,
      next.enabled ? 1 : 0,
      next.cooldownSeconds,
      next.triggered ? 1 : 0,
      next.updatedAt,
      id,
    );

    return this.getAlertRule(id);
  }

  deleteAlertRule(id: number): boolean {
    const result = this.db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id);
    return result.changes > 0;
  }

  setAlertTriggered(id: number, triggered: boolean): void {
    this.db.prepare(`
      UPDATE alert_rules
      SET triggered = ?, updated_at = ?
      WHERE id = ?
    `).run(triggered ? 1 : 0, new Date().toISOString(), id);
  }

  getFeishuSettings(): FeishuSettings {
    const rows = this.db.prepare(`
      SELECT key, value
      FROM app_settings
      WHERE key IN ('feishu_enabled', 'feishu_webhook', 'feishu_secret', 'feishu_last_sent_at', 'feishu_last_error')
    `).all() as Array<{ key: string; value: string }>;
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));

    return {
      enabled: values.feishu_enabled === '1',
      webhook: values.feishu_webhook || undefined,
      secret: values.feishu_secret || undefined,
      lastSentAt: values.feishu_last_sent_at || undefined,
      lastError: values.feishu_last_error || undefined,
    };
  }

  updateFeishuSettings(input: Partial<FeishuSettings>): FeishuSettings {
    if (input.enabled !== undefined) {
      this.setAppSetting('feishu_enabled', input.enabled ? '1' : '0');
    }
    if (input.webhook !== undefined) {
      this.setAppSetting('feishu_webhook', input.webhook);
    }
    if (input.secret !== undefined) {
      this.setAppSetting('feishu_secret', input.secret);
    }
    if (input.lastSentAt !== undefined) {
      this.setAppSetting('feishu_last_sent_at', input.lastSentAt);
    }
    if (input.lastError !== undefined) {
      this.setAppSetting('feishu_last_error', input.lastError);
    }
    return this.getFeishuSettings();
  }

  getWecomSettings(): WecomSettings {
    const rows = this.db.prepare(`
      SELECT key, value
      FROM app_settings
      WHERE key IN ('wecom_enabled', 'wecom_webhook', 'wecom_last_sent_at', 'wecom_last_error')
    `).all() as Array<{ key: string; value: string }>;
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));

    return {
      enabled: values.wecom_enabled === '1',
      webhook: values.wecom_webhook || undefined,
      lastSentAt: values.wecom_last_sent_at || undefined,
      lastError: values.wecom_last_error || undefined,
    };
  }

  updateWecomSettings(input: Partial<WecomSettings>): WecomSettings {
    if (input.enabled !== undefined) {
      this.setAppSetting('wecom_enabled', input.enabled ? '1' : '0');
    }
    if (input.webhook !== undefined) {
      this.setAppSetting('wecom_webhook', input.webhook);
    }
    if (input.lastSentAt !== undefined) {
      this.setAppSetting('wecom_last_sent_at', input.lastSentAt);
    }
    if (input.lastError !== undefined) {
      this.setAppSetting('wecom_last_error', input.lastError);
    }
    return this.getWecomSettings();
  }

  recordAlertEvent(input: {
    ruleId: number;
    symbol: string;
    price: number;
    targetPrice: number;
    direction: AlertDirection;
    message: string;
  }): AlertEvent {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO alert_events (
        rule_id, symbol, price, target_price, direction, message, triggered_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.ruleId,
      input.symbol,
      input.price,
      input.targetPrice,
      input.direction,
      input.message,
      now,
    );

    this.db.prepare(`
      UPDATE alert_rules
      SET last_triggered_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, input.ruleId);

    const event = this.getAlertEvent(Number(result.lastInsertRowid));
    if (!event) {
      throw new Error('Failed to record alert event');
    }
    return event;
  }

  getAlertEvents(sinceId = 0, limit = 50): AlertEvent[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM alert_events
      WHERE id > ?
      ORDER BY id ASC
      LIMIT ?
    `).all(sinceId, limit) as AlertEventRow[];

    return rows.map((row) => this.mapAlertEvent(row));
  }

  getStats(): {
    dbPath: string;
    priceTicks: number;
    recycleTicks: number;
    alertRules: number;
    alertEvents: number;
  } {
    const count = (table: string) => {
      const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      return row.count;
    };

    return {
      dbPath: this.dbPath,
      priceTicks: count('price_ticks'),
      recycleTicks: count('recycle_prices'),
      alertRules: count('alert_rules'),
      alertEvents: count('alert_events'),
    };
  }

  cleanupOldPriceTicks(days = 100): number {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare('DELETE FROM price_ticks WHERE created_at < ?').run(cutoff);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  private init(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS price_ticks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        unit TEXT NOT NULL,
        change REAL,
        change_percent REAL,
        open REAL,
        high REAL,
        low REAL,
        pre_close REAL,
        volume TEXT,
        quote_time TEXT,
        fetch_time TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_price_ticks_symbol_created
        ON price_ticks(symbol, created_at);

      CREATE TABLE IF NOT EXISTS recycle_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        price REAL NOT NULL,
        unit TEXT NOT NULL,
        formatted TEXT NOT NULL,
        purity TEXT,
        updated TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        fetch_time TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_recycle_prices_type_id
        ON recycle_prices(type, id);

      CREATE TABLE IF NOT EXISTS alert_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        target_price REAL NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('below', 'above')),
        enabled INTEGER NOT NULL DEFAULT 1,
        cooldown_seconds INTEGER NOT NULL DEFAULT 1800,
        triggered INTEGER NOT NULL DEFAULT 0,
        last_triggered_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_alert_rules_symbol_enabled
        ON alert_rules(symbol, enabled);

      CREATE TABLE IF NOT EXISTS alert_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        price REAL NOT NULL,
        target_price REAL NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('below', 'above')),
        message TEXT NOT NULL,
        triggered_at TEXT NOT NULL,
        FOREIGN KEY(rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_alert_events_id
        ON alert_events(id);

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const alertRuleColumns = this.db.prepare('PRAGMA table_info(alert_rules)').all() as Array<{ name: string }>;
    if (!alertRuleColumns.some((column) => column.name === 'triggered')) {
      this.db.exec('ALTER TABLE alert_rules ADD COLUMN triggered INTEGER NOT NULL DEFAULT 0');
    }
  }

  private getAlertRule(id: number): AlertRule | null {
    const row = this.db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(id) as AlertRuleRow | undefined;
    return row ? this.mapAlertRule(row) : null;
  }

  private setAppSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, new Date().toISOString());
  }

  private getAlertEvent(id: number): AlertEvent | null {
    const row = this.db.prepare('SELECT * FROM alert_events WHERE id = ?').get(id) as AlertEventRow | undefined;
    return row ? this.mapAlertEvent(row) : null;
  }

  private mapPriceTick(row: PriceTickRow): GoldPrice {
    return {
      symbol: row.symbol,
      name: row.name,
      price: row.price,
      unit: row.unit,
      change: row.change ?? undefined,
      changePercent: row.change_percent ?? undefined,
      open: row.open ?? undefined,
      high: row.high ?? undefined,
      low: row.low ?? undefined,
      preClose: row.pre_close ?? undefined,
      volume: row.volume ?? undefined,
      quoteTime: row.quote_time ?? undefined,
      fetchTime: row.fetch_time,
      source: row.source,
    };
  }

  private mapAlertRule(row: AlertRuleRow): AlertRule {
    return {
      id: row.id,
      symbol: row.symbol,
      targetPrice: row.target_price,
      direction: row.direction,
      enabled: row.enabled === 1,
      cooldownSeconds: row.cooldown_seconds,
      triggered: row.triggered === 1,
      lastTriggeredAt: row.last_triggered_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapAlertEvent(row: AlertEventRow): AlertEvent {
    return {
      id: row.id,
      ruleId: row.rule_id,
      symbol: row.symbol,
      price: row.price,
      targetPrice: row.target_price,
      direction: row.direction,
      message: row.message,
      triggeredAt: row.triggered_at,
    };
  }

  private rangeToMs(range: string): number {
    const ranges: Record<string, number> = {
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '3d': 3 * 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
      '3m': 90 * 24 * 60 * 60 * 1000,
    };

    return ranges[range] || ranges['1h'];
  }
}

export const sqliteStore = new SQLiteStore();
