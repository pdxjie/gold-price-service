// AI 积存金分析服务：聚合行情 + 完整 SKILL.md 指令 + DeepSeek（联网搜索）+ 持仓
import fs from 'fs';
import path from 'path';
import { LlmConfig } from '../types';
import { sqliteStore } from './sqlite-store';
import { jdGoldLiveService } from './jd-gold-live';
import { bullionVaultLiveService } from './bullionvault-live';
import { shortTermSignalService } from './short-term-signals';
import { responsesCompletionStream, chatCompletionStream } from './llm-client';

export interface AiAnalysisRequest {
  jdPost?: unknown;
  holdings?: unknown;
}

export interface AiAnalysisCallbacks {
  onStage?: (stage: string) => void;
  onDelta?: (delta: string) => void;
}

interface AnalysisState {
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  lastRecordId?: number;
  lastTitle?: string;
}

const analysisState: AnalysisState = { running: false };

export function getAnalysisStatus(): AnalysisState {
  return { ...analysisState };
}

function readSkillPrompt(): string {
  const base = path.join(__dirname, '..', 'ai', 'skill');
  const skill = fs.readFileSync(path.join(base, 'SKILL.md'), 'utf8');
  const refs = ['accumulation-gold.md', 'report-template.md'].map((name) => {
    const filePath = path.join(base, 'references', name);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  });
  return [skill, ...refs.filter(Boolean)].join('\n\n---\n\n');
}

function fmt(value: unknown, digits = 2): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '--';
}

function summarizeHistory(symbol: string, label: string, range: string): string {
  const history = sqliteStore.getPriceHistory(symbol, range);
  const points = (history.data || []).filter((point) => Number.isFinite(Number(point.price)));
  if (points.length < 2) {
    return `${label}（${symbol}）${range} 走势：本地样本不足`;
  }
  const prices = points.map((point) => Number(point.price));
  const first = prices[0];
  const last = prices[prices.length - 1];
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const change = last - first;
  const changePercent = first > 0 ? (change / first) * 100 : 0;
  const sign = change >= 0 ? '+' : '';
  return `${label}（${symbol}）${range} 走势：${prices.length} 个采样点，最新 ${last.toFixed(2)}，区间 ${low.toFixed(2)}~${high.toFixed(2)}，较区间起点 ${sign}${change.toFixed(2)}（${sign}${changePercent.toFixed(2)}%）`;
}

function collectMarketData(): string {
  const jdQuote = jdGoldLiveService.getLatestQuote();
  const bullionQuote = bullionVaultLiveService.getLatestQuote();
  const now = new Date().toISOString();
  const lines: string[] = [`当前行情数据（获取时间 ${now}）：`];

  if (bullionQuote) {
    lines.push(
      `- XAUUSD（BullionVault 实时）：${bullionQuote.pricePerTroyOunce.toFixed(2)} 美元/盎司，今日高 ${bullionQuote.highPerTroyOunce.toFixed(2)}，今日低 ${bullionQuote.lowPerTroyOunce.toFixed(2)}`,
    );
  } else {
    lines.push('- XAUUSD：暂不可用');
  }

  if (jdQuote) {
    const z = jdQuote.zhejiangGold;
    lines.push(
      `- 浙商积存金（CZB-JCJ）：${z.price} 元/克，涨跌 ${z.change}（${fmt(z.changePercent)}%），昨收 ${fmt(z.preClose)}，开 ${fmt(z.open)}，高 ${fmt(z.high)}，低 ${fmt(z.low)}`,
    );
    if (jdQuote.minshengGold) {
      const m = jdQuote.minshengGold;
      lines.push(
        `- 民生积存金（MS-JCJ）：${m.price} 元/克，涨跌 ${m.change}（${fmt(m.changePercent)}%），昨收 ${fmt(m.preClose)}`,
      );
    }
    if (jdQuote.icbcGold) {
      const icbc = jdQuote.icbcGold;
      lines.push(
        `- 工行积存金（ICBC-JCJ）：${icbc.price} 元/克，涨跌 ${icbc.change}（${fmt(icbc.changePercent)}%），昨收 ${fmt(icbc.preClose)}`,
      );
    }
    if (jdQuote.exchangeRate) {
      lines.push(`- 离岸人民币汇率（USD/CNH）：${jdQuote.exchangeRate.price}`);
    }
    if (jdQuote.goldTd) {
      lines.push(`- 黄金 T+D（SGE-Au(T+D)）：${jdQuote.goldTd.price} 元/克`);
    }
  } else {
    lines.push('- 积存金实时报价：暂不可用');
  }

  const depositSymbols = [
    { key: 'CZB-JCJ', label: '浙商积存金' },
    { key: 'MS-JCJ', label: '民生积存金' },
    { key: 'ICBC-JCJ', label: '工行积存金' },
  ];

  for (const { key, label } of depositSymbols) {
    const signals = shortTermSignalService.getSignals(key);
    if (!signals) {
      continue;
    }
    const windows = (signals.windows || [])
      .map((w) => `${w.label} ${fmt(w.changePercent)}%`)
      .join('，');
    const trend = signals.consecutive || { direction: 'unknown', count: 0 };
    const sup = Number(signals.supportResistance?.support);
    const res = Number(signals.supportResistance?.resistance);
    const trendText = trend.direction === 'up' ? '连涨' : trend.direction === 'down' ? '连跌' : trend.direction === 'flat' ? '横盘' : '待采集';
    lines.push(
      `- ${label}（${key}）短线信号：${windows}；${trendText} ${trend.count || 0} 点；支撑 ${fmt(sup)}，压力 ${fmt(res)}`,
    );
  }

  lines.push('本地存储的近期价格曲线（历史走势）：');
  for (const { key, label } of depositSymbols) {
    lines.push(`  - ${summarizeHistory(key, label, '1d')}`);
    lines.push(`  - ${summarizeHistory(key, label, '1h')}`);
  }

  return lines.join('\n');
}

function formatHoldings(holdings: unknown): string {
  const label: Record<string, string> = {
    'CZB-JCJ': '浙商积存金',
    'MS-JCJ': '民生积存金',
    'ICBC-JCJ': '工行积存金',
  };

  try {
    const marketList = (holdings as { holdings?: { market?: unknown[] } })?.holdings?.market;
    if (!Array.isArray(marketList) || marketList.length === 0) {
      return '（用户未提供积存金持仓）';
    }

    return marketList
      .map((item, index) => {
        const key = String((item as { quoteKey?: string })?.quoteKey || 'CZB-JCJ');
        const grams = Number((item as { grams?: unknown })?.grams);
        const buyPrice = Number((item as { buyPrice?: unknown })?.buyPrice);
        const name = label[key] || key;
        if (!Number.isFinite(grams) || grams <= 0 || !Number.isFinite(buyPrice) || buyPrice <= 0) {
          return `${index + 1}. ${name}（${key}）：未填写克数/买入价`;
        }
        return `${index + 1}. ${name}（${key}）：持有 ${grams} 克，买入价 ${buyPrice} 元/克，成本约 ${(grams * buyPrice).toFixed(2)} 元`;
      })
      .join('\n');
  } catch {
    return '（持仓数据解析失败）';
  }
}

function hasValidHoldings(holdings: unknown): boolean {
  try {
    const marketList = (holdings as { holdings?: { market?: unknown[] } })?.holdings?.market;
    if (!Array.isArray(marketList) || marketList.length === 0) {
      return false;
    }
    return marketList.some((item) => {
      const grams = Number((item as { grams?: unknown })?.grams);
      const buyPrice = Number((item as { buyPrice?: unknown })?.buyPrice);
      return Number.isFinite(grams) && grams > 0 && Number.isFinite(buyPrice) && buyPrice > 0;
    });
  } catch {
    return false;
  }
}

function extractTitle(report: string): string {
  const lines = report.split('\n');
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/);
    if (match && match[1].trim()) {
      return match[1].trim().slice(0, 60);
    }
  }
  return report.replace(/[#*\n]/g, '').trim().slice(0, 40) || 'AI 分析';
}

function isDeepSeekOfficial(baseUrl: string): boolean {
  return /api\.deepseek\.com/.test(baseUrl);
}

export async function runAiAnalysis(
  config: LlmConfig,
  request: AiAnalysisRequest,
  callbacks: AiAnalysisCallbacks,
): Promise<string> {
  const skillPrompt = readSkillPrompt();
  const marketData = collectMarketData();

  const jdPostText = request.jdPost
    ? JSON.stringify(request.jdPost, null, 2)
    : '（金友圈未获取，报告中如实标注降级）';
  const holdingsText = formatHoldings(request.holdings);
  const hasHoldings = hasValidHoldings(request.holdings);
  const holdingInstruction = hasHoldings
    ? '2. 紧接着输出「📌 持仓操作建议」章节：根据下方【用户持仓情况】中每家银行积存金的持有克数和买入价，结合实时行情分别给出「是否加仓、什么价位加仓/减仓、止盈止损」的明确建议（每家一行，含具体价位）。'
    : '2. 紧接着输出「📌 入手时机建议」章节：用户目前未设置持仓积存金，请基于实时行情、消息面、技术点位，重点分析「现在是否适合入手、什么价位适合入场、如何分批建仓」，给出明确的买入建议（含入场价、止损价、目标价和 R:R）。';

  const userInput = [
    '请对当前中国黄金积存金进行一次完整的短线交易分析。',
    '',
    '【输出格式要求（重要，必须遵守）】',
    '1. 报告第一行必须输出一行结论标题，格式为 `# {结论}`（例如 `# 🟢偏多·回调低吸`），作为本次分析的标题。',
    holdingInstruction,
    '3. 之后再按 SKILL.md 四阶段与 report-template.md 输出完整详细分析（情绪、点位、三轴、R:R、风险、来源）。',
    '',
    '【实时行情数据】',
    marketData,
    '',
    '【京东金融金友圈观点】',
    jdPostText,
    '',
    '【用户持仓情况】',
    holdingsText,
    '',
    '【要求】',
    '1. 若本次已启用联网搜索工具，请使用 web_search 搜集最近 1-4 小时黄金相关消息（美联储/地缘/央行购金/美元指数/国内金价），判断市场情绪。',
    '2. 严格按报告模板输出完整报告，禁止省略章节。',
  ].join('\n');

  analysisState.running = true;
  analysisState.startedAt = new Date().toISOString();
  analysisState.finishedAt = undefined;
  analysisState.lastRecordId = undefined;
  analysisState.lastTitle = undefined;

  callbacks.onStage?.('正在聚合行情并联网分析…');

  try {
    const report = isDeepSeekOfficial(config.baseUrl)
      ? await responsesCompletionStream(
          {
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            model: config.model,
            instructions: skillPrompt,
            input: userInput,
            tools: [{ type: 'web_search' }],
            timeoutMs: 600000,
          },
          (delta) => callbacks.onDelta?.(delta),
        )
      : await chatCompletionStream(
          {
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            model: config.model,
            messages: [
              { role: 'system', content: skillPrompt },
              { role: 'user', content: userInput },
            ],
            timeoutMs: 600000,
          },
          { onChunk: (delta) => callbacks.onDelta?.(delta) },
        );

    const title = extractTitle(report);
    analysisState.lastTitle = title;
    analysisState.lastRecordId = sqliteStore.saveAiAnalysisRecord(title, report, config.model);
    return report;
  } finally {
    analysisState.running = false;
    analysisState.finishedAt = new Date().toISOString();
  }
}
