// 金价数据类型定义

export interface GoldPrice {
  symbol: string;           // 品种代码，如 AU9999
  name: string;             // 品种名称，如 Au99.99
  price: number;            // 当前价格
  unit: string;             // 单位，如 元/克
  change?: number;          // 涨跌额
  changePercent?: number;   // 涨跌幅 %
  open?: number;            // 开盘价
  high?: number;            // 最高价
  low?: number;             // 最低价
  preClose?: number;        // 昨收价
  volume?: string;          // 成交量
  quoteTime?: string;       // 行情时间
  fetchTime: string;        // 采集时间
  source: string;           // 数据源
}

export interface MetalPrice {
  name: string;             // 品种名称
  sellPrice: number;        // 卖出价
  todayPrice?: number;      // 今日价
  highPrice?: number;       // 最高价
  lowPrice?: number;        // 最低价
  unit: string;             // 单位
  updated: string;          // 更新时间
  updatedAt: number;        // 毫秒时间戳
}

export interface RetailPrice {
  brand: string;            // 品牌
  product: string;          // 产品
  price: number;            // 价格
  unit: string;             // 单位
  formatted: string;        // 格式化价格
  updated: string;          // 报价日期
  updatedAt: number;        // 毫秒时间戳
}

export interface RecyclePrice {
  type: string;             // 回收类型
  price: number;            // 回收价格
  unit: string;             // 单位
  formatted: string;        // 格式化价格
  purity?: string;          // 纯度
  updated: string;          // 报价日期
  updatedAt: number;        // 毫秒时间戳
}

export interface GoldDataResponse {
  code: number;
  message: string;
  data: {
    date: string;
    metals: MetalPrice[];
    stores?: RetailPrice[];
    banks?: RetailPrice[];
    recycle?: RecyclePrice[];
  };
}

export interface PriceHistory {
  symbol: string;
  data: Array<{
    timestamp: string;
    price: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
  }>;
}

export type AlertDirection = 'below' | 'above';

export interface AlertRule {
  id: number;
  symbol: string;
  targetPrice: number;
  direction: AlertDirection;
  enabled: boolean;
  cooldownSeconds: number;
  triggered: boolean;
  lastTriggeredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertEvent {
  id: number;
  ruleId: number;
  symbol: string;
  price: number;
  targetPrice: number;
  direction: AlertDirection;
  message: string;
  triggeredAt: string;
}

export interface FeishuSettings {
  enabled: boolean;
  webhook?: string;
  secret?: string;
  lastSentAt?: string;
  lastError?: string;
}

export interface WecomSettings {
  enabled: boolean;
  webhook?: string;
  lastSentAt?: string;
  lastError?: string;
}

export interface CollectorStatus {
  running: boolean;
  symbol: string;
  priceIntervalMs: number;
  recycleIntervalMs: number;
  lastPriceCollectAt?: string;
  lastRecycleCollectAt?: string;
  lastError?: string;
}
