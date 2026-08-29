// akshare.ts - AKShare 历史数据服务
import axios from 'axios';

interface HistoricalPrice {
    date: string;
    price: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
}

interface HistoricalDataResponse {
    symbol: string;
    period: string;
    data: HistoricalPrice[];
    source: string;
}

/**
 * 获取 AKShare spot_hist_sge 使用的上海黄金交易所历史数据。
 *
 * AKShare 是 Python 库，桌面端不要求用户额外安装 Python；这里直接调用
 * AKShare 的公开数据源，返回与 spot_hist_sge 相同的 Au99.99 日线字段。
 */
class AKShareService {
    private readonly historyURL = 'https://www.sge.com.cn/graph/Dailyhq';

    async getGoldHistory(period: '1m' | '3m' = '1m'): Promise<HistoricalDataResponse> {
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - (period === '3m' ? 3 : 1));
        const startDay = startDate.toISOString().slice(0, 10);

        try {
            const response = await axios.post<{ time?: unknown }>(
                this.historyURL,
                new URLSearchParams({ instid: 'Au99.99' }).toString(),
                {
                    timeout: 15000,
                    headers: {
                        Accept: 'text/html, */*; q=0.01',
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        Origin: 'https://www.sge.com.cn',
                        Referer: 'https://www.sge.com.cn/sjzx/mrhq',
                        'X-Requested-With': 'XMLHttpRequest',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
                    },
                },
            );

            const rawRows = Array.isArray(response.data?.time) ? response.data.time : [];
            const data = rawRows
                .map((row): HistoricalPrice | null => {
                    if (!Array.isArray(row) || row.length < 5) {
                        return null;
                    }

                    const [date, open, close, low, high] = row;
                    const price = Number(close);
                    if (typeof date !== 'string' || !Number.isFinite(price)) {
                        return null;
                    }

                    return {
                        date,
                        price,
                        open: Number(open),
                        high: Number(high),
                        low: Number(low),
                        close: price,
                    };
                })
                .filter((item): item is HistoricalPrice => item !== null && item.date >= startDay);

            if (data.length === 0) {
                throw new Error('上海黄金交易所未返回有效历史金价');
            }

            return {
                symbol: 'AU9999',
                period,
                data,
                source: 'AKShare/SGE spot_hist_sge',
            };
        } catch (error) {
            console.error('AKShare historical data error:', error);
            throw error;
        }
    }
}

export default new AKShareService();
export { HistoricalPrice, HistoricalDataResponse };
