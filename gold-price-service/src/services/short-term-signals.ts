import { ShortTermSignals, ShortTermWindowSignal } from '../types';
import { sqliteStore } from './sqlite-store';

const DEFAULT_WINDOWS = [5, 15, 30, 60];
const SELL_FEE_RATE = Number(process.env.GOLD_SELL_FEE_RATE || 0.004);
const FLAT_THRESHOLD = 0.005;

type SignalPoint = {
  timestamp: string;
  timeMs: number;
  price: number;
};

export class ShortTermSignalService {
  getSignals(symbol = 'CZB-JCJ'): ShortTermSignals {
    const normalizedSymbol = symbol.toUpperCase();
    const generatedAt = new Date().toISOString();
    const points = this.readPoints(normalizedSymbol);
    const latest = points[points.length - 1];

    const windows = DEFAULT_WINDOWS.map((minutes) => this.computeWindow(points, minutes));
    const volatility = this.computeVolatility(points, 60);
    const consecutive = this.computeConsecutive(points);
    const supportResistance = this.computeSupportResistance(points, 60);
    const insufficient = points.length < 2;

    return {
      symbol: normalizedSymbol,
      generatedAt,
      latestPrice: latest?.price,
      latestTime: latest?.timestamp,
      windows,
      volatility,
      consecutive,
      supportResistance,
      fee: {
        sellFeeRate: Number.isFinite(SELL_FEE_RATE) && SELL_FEE_RATE >= 0 ? SELL_FEE_RATE : 0.004,
      },
      dataQuality: {
        points: points.length,
        insufficient,
        message: insufficient ? '本地样本不足，等待采集更多价格变化' : '基于本地近 60 分钟采样计算',
      },
    };
  }

  private readPoints(symbol: string): SignalPoint[] {
    const history = sqliteStore.getPriceHistory(symbol, '1h');
    return history.data
      .map((point) => ({
        timestamp: point.timestamp,
        timeMs: new Date(point.timestamp).getTime(),
        price: Number(point.price),
      }))
      .filter((point) => Number.isFinite(point.timeMs) && Number.isFinite(point.price))
      .sort((left, right) => left.timeMs - right.timeMs);
  }

  private computeWindow(points: SignalPoint[], minutes: number): ShortTermWindowSignal {
    const latest = points[points.length - 1];
    const label = `${minutes}m`;
    if (!latest) {
      return { label, minutes, points: 0 };
    }

    const cutoff = latest.timeMs - minutes * 60 * 1000;
    const windowPoints = points.filter((point) => point.timeMs >= cutoff);
    if (windowPoints.length < 2) {
      return {
        label,
        minutes,
        points: windowPoints.length,
        endPrice: latest.price,
      };
    }

    const first = windowPoints[0];
    const change = latest.price - first.price;
    return {
      label,
      minutes,
      points: windowPoints.length,
      startPrice: first.price,
      endPrice: latest.price,
      change,
      changePercent: first.price > 0 ? (change / first.price) * 100 : 0,
    };
  }

  private computeVolatility(points: SignalPoint[], minutes: number) {
    const latest = points[points.length - 1];
    if (!latest) {
      return { label: '波动', minutes, points: 0 };
    }

    const cutoff = latest.timeMs - minutes * 60 * 1000;
    const prices = points
      .filter((point) => point.timeMs >= cutoff)
      .map((point) => point.price);
    if (prices.length < 2) {
      return { label: '波动', minutes, points: prices.length };
    }

    const average = prices.reduce((total, price) => total + price, 0) / prices.length;
    const variance = prices.reduce((total, price) => total + ((price - average) ** 2), 0) / prices.length;
    const value = average > 0 ? (Math.sqrt(variance) / average) * 100 : 0;
    return { label: '波动', minutes, value, points: prices.length };
  }

  private computeConsecutive(points: SignalPoint[]) {
    if (points.length < 2) {
      return { direction: 'unknown' as const, count: 0 };
    }

    let direction: 'up' | 'down' | 'flat' = 'flat';
    let count = 0;
    let change = 0;

    for (let index = points.length - 1; index > 0; index -= 1) {
      const diff = points[index].price - points[index - 1].price;
      const nextDirection = Math.abs(diff) <= FLAT_THRESHOLD ? 'flat' : diff > 0 ? 'up' : 'down';
      if (direction === 'flat' && count === 0) {
        direction = nextDirection;
      }
      if (nextDirection !== direction) {
        break;
      }
      count += 1;
      change += diff;
    }

    return {
      direction,
      count,
      change,
    };
  }

  private computeSupportResistance(points: SignalPoint[], minutes: number) {
    const latest = points[points.length - 1];
    if (!latest) {
      return { minutes };
    }

    const cutoff = latest.timeMs - minutes * 60 * 1000;
    const prices = points
      .filter((point) => point.timeMs >= cutoff)
      .map((point) => point.price);
    if (prices.length === 0) {
      return { minutes };
    }

    const support = Math.min(...prices);
    const resistance = Math.max(...prices);
    return {
      minutes,
      support,
      resistance,
      midpoint: (support + resistance) / 2,
    };
  }
}

export const shortTermSignalService = new ShortTermSignalService();
