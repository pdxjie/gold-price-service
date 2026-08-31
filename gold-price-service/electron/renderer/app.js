const apiBase = window.goldDesktop?.apiBase || 'http://localhost:3001';
const TROY_OUNCE_GRAMS = 31.1034768;
const USD_CNY_RATE = 6.7207;
const JD_QUOTE_STALE_MS = 7000;
const HOLDING_STORAGE_KEY = 'goldHoldingSettings';
const APPEARANCE_STORAGE_KEY = 'jinmaiAppearance';

const rangeLabels = {
  '15m': '15分钟',
  '1h': '1小时',
  '1d': '1天',
  '3m': '3个月',
};

const state = {
  latest: null,
  liveQuote: null,
  jdQuote: null,
  jdConnected: false,
  jdSocket: null,
  jdSocketOpen: false,
  jdReconnectTimer: null,
  historyIsDomestic: false,
  history: [],
  historyError: null,
  latestError: null,
  recycleError: null,
  collectorError: null,
  recycle: [],
  fullGold: null,
  collector: null,
  selectedRange: '3m',
  liveConnected: false,
  collapsed: false,
  collapseInFlight: false,
  refreshInFlight: false,
  refreshQueued: false,
  liveRefreshInFlight: false,
  fullGoldLoadedAt: 0,
  lastAlertEventId: Number(localStorage.getItem('lastAlertEventId') || 0),
  holding: loadHoldingSettings(),
  chartPoints: [],
  chartMetrics: null,
  chartHoverIndex: -1,
  alertEvents: [],
  appearance: loadAppearanceSettings(),
};

const els = {
  collapsedCard: document.getElementById('collapsedBall'),
  collapsedZhejiangPrice: document.getElementById('collapsedZhejiangPrice'),
  collapsedMinshengPrice: document.getElementById('collapsedMinshengPrice'),
  collapsedProfit: document.getElementById('collapsedProfit'),
  collapsedUpdated: document.getElementById('collapsedUpdated'),
  collapsedLiveDot: document.querySelector('.collapsed-live-dot'),
  currentPrice: document.getElementById('currentPrice'),
  changeText: document.getElementById('changeText'),
  minshengPrice: document.getElementById('minshengPrice'),
  minshengChangeText: document.getElementById('minshengChangeText'),
  exchangeRate: document.getElementById('exchangeRate'),
  priceChart: document.getElementById('priceChart'),
  chartSection: document.querySelector('.chart-section'),
  chartTooltip: document.getElementById('chartTooltip'),
  collectorStatus: document.getElementById('collectorStatus'),
  updatedAt: document.getElementById('updatedAt'),
  liveStatus: document.getElementById('liveStatus'),
  liveStatusDot: document.getElementById('liveStatusDot'),
  holdingModeHint: document.getElementById('holdingModeHint'),
  holdingModes: [...document.querySelectorAll('.holding-mode')],
  holdingAssetCount: document.getElementById('holdingAssetCount'),
  addHoldingButton: document.getElementById('addHoldingButton'),
  holdingAssetList: document.getElementById('holdingAssetList'),
  holdingForm: document.getElementById('holdingForm'),
  holdingGrams: document.getElementById('holdingGrams'),
  holdingBuyPrice: document.getElementById('holdingBuyPrice'),
  holdingMarketSourceField: document.getElementById('holdingMarketSourceField'),
  holdingMarketSource: document.getElementById('holdingMarketSource'),
  holdingBrandField: document.getElementById('holdingBrandField'),
  holdingBrand: document.getElementById('holdingBrand'),
  holdingQuoteNote: document.getElementById('holdingQuoteNote'),
  holdingValueLabel: document.getElementById('holdingValueLabel'),
  holdingValue: document.getElementById('holdingValue'),
  holdingCost: document.getElementById('holdingCost'),
  holdingProfit: document.getElementById('holdingProfit'),
  holdingSale: document.getElementById('holdingSale'),
  holdingRecycleRate: document.getElementById('holdingRecycleRate'),
  holdingSaleValue: document.getElementById('holdingSaleValue'),
  holdingSaleProfit: document.getElementById('holdingSaleProfit'),
  settingsButton: document.getElementById('settingsButton'),
  toggleButton: document.getElementById('toggleButton'),
  minimizeButton: document.getElementById('minimizeButton'),
  closeButton: document.getElementById('closeButton'),
};

function loadAppearanceSettings() {
  return {
    theme: 'system',
    opacity: 92,
    radius: 20,
    collapsedDisplay: 'assets',
    collapsedSize: 'normal',
    animationEnabled: true,
    desktopNotificationEnabled: true,
  };
}

function applyAppearance(settings = {}) {
  state.appearance = { ...state.appearance, ...settings };
  document.documentElement.dataset.theme = state.appearance.theme;
  document.documentElement.style.setProperty('--window-opacity', String(Number(state.appearance.opacity) / 100));
  document.documentElement.style.setProperty('--window-radius', `${Number(state.appearance.radius)}px`);
  document.body.classList.toggle('animations-paused', state.appearance.animationEnabled === false);
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(state.appearance));
  if (state.collapsed) void window.goldDesktop?.setCollapsedSize(state.appearance.collapsedSize);
  renderCollapsedCard();
}

function loadHoldingSettings() {
  const modes = ['market', 'brand', 'recycle'];
  const createAsset = (mode, values = {}) => ({
    id: values.id || `${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode,
    grams: values.grams || '',
    buyPrice: values.buyPrice || '',
    quoteKey: values.quoteKey || (mode === 'market' ? 'CZB-JCJ' : ''),
    brandKey: values.brandKey || '',
  });

  try {
    const saved = JSON.parse(localStorage.getItem(HOLDING_STORAGE_KEY) || '{}');
    const holdings = Object.fromEntries(modes.map((mode) => [
      mode,
      Array.isArray(saved.holdings?.[mode])
        ? saved.holdings[mode].map((item) => createAsset(mode, item))
        : [],
    ]));

    if (!saved.holdings) {
      const legacyMode = modes.includes(saved.mode) ? saved.mode : 'market';
      holdings[legacyMode].push(createAsset(legacyMode, saved));
    }

    modes.forEach((mode) => {
      if (mode === 'recycle') {
        holdings[mode] = holdings[mode].slice(0, 1);
      }
      if (holdings[mode].length === 0) {
        holdings[mode].push(createAsset(mode));
      }
    });

    const activeIds = Object.fromEntries(modes.map((mode) => [
      mode,
      saved.activeIds?.[mode] && holdings[mode].some((item) => item.id === saved.activeIds[mode])
        ? saved.activeIds[mode]
        : holdings[mode][0].id,
    ]));

    return {
      mode: modes.includes(saved.mode) ? saved.mode : 'market',
      holdings,
      activeIds,
    };
  } catch {
    const holdings = Object.fromEntries(modes.map((mode) => [mode, [createAsset(mode)]]));
    return {
      mode: 'market',
      holdings,
      activeIds: Object.fromEntries(modes.map((mode) => [mode, holdings[mode][0].id])),
    };
  }
}

function saveHoldingSettings() {
  localStorage.setItem(HOLDING_STORAGE_KEY, JSON.stringify(state.holding));
}

function getHoldingList(mode = state.holding.mode) {
  return state.holding.holdings[mode] || [];
}

function getActiveHolding(mode = state.holding.mode) {
  const list = getHoldingList(mode);
  return list.find((item) => item.id === state.holding.activeIds[mode]) || list[0] || null;
}

function syncFieldValue(field, value) {
  const nextValue = value || '';
  if (field.value !== nextValue) {
    field.value = nextValue;
  }
}

function createHoldingAsset() {
  return {
    id: `${state.holding.mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode: state.holding.mode,
    grams: '',
    buyPrice: '',
    quoteKey: state.holding.mode === 'market' ? 'CZB-JCJ' : '',
    brandKey: '',
  };
}

function formatNumber(value, digits = 2) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return '--';
  }

  const number = Number(value);
  const factor = 10 ** digits;
  const truncated = Math.trunc(number * factor) / factor;
  return truncated.toFixed(digits);
}

function formatMoney(value) {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) {
    return '--';
  }
  return `${formatNumber(value, 2)} 元`;
}

function formatProfit(value) {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) {
    return '--';
  }
  const number = Number(value);
  const sign = number > 0 ? '+' : '';
  return `${sign}${formatNumber(number, 2)} 元`;
}

function renderRollingNumber(element, value, digits = 2) {
  if (!element) {
    return;
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    if (element.dataset.rollingText !== '--') {
      element.replaceChildren(document.createTextNode('--'));
      element.dataset.rollingText = '--';
      element.setAttribute('aria-label', '--');
    }
    return;
  }

  const text = formatNumber(number, digits);
  const currentText = element.dataset.rollingText;
  if (currentText === text) {
    return;
  }

  if (state.appearance?.animationEnabled === false) {
    element.textContent = text;
    element.dataset.rollingText = text;
    element.setAttribute('aria-label', text);
    return;
  }

  const chars = [...text];
  const currentSlots = [...element.children];
  const canReuse = currentSlots.length === chars.length
    && currentSlots.every((slot, index) => slot.dataset.kind === (/\d/.test(chars[index]) ? 'digit' : 'symbol'));

  if (!canReuse) {
    element.replaceChildren(...chars.map((char) => {
      if (/\d/.test(char)) {
        const slot = document.createElement('span');
        slot.className = 'rolling-slot';
        slot.dataset.kind = 'digit';
        const track = document.createElement('span');
        track.className = 'rolling-track';
        for (let digit = 0; digit <= 9; digit += 1) {
          const digitElement = document.createElement('span');
          digitElement.className = 'rolling-digit';
          digitElement.textContent = String(digit);
          track.appendChild(digitElement);
        }
        slot.appendChild(track);
        return slot;
      }

      const symbol = document.createElement('span');
      symbol.className = 'rolling-symbol';
      symbol.dataset.kind = 'symbol';
      symbol.textContent = char;
      return symbol;
    }));
  }

  chars.forEach((char, index) => {
    const slot = element.children[index];
    if (/\d/.test(char)) {
      slot.firstElementChild.style.setProperty('--digit-index', char);
    } else {
      slot.textContent = char;
    }
  });

  element.classList.add('rolling-number');
  element.dataset.rollingText = text;
  element.setAttribute('aria-label', text);
}

function formatTime(value) {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).split(' ').pop() || String(value);
  }

  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function formatHistoryTime(value) {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json();
  if (!response.ok || payload.code >= 400) {
    throw new Error(payload.message || '接口请求失败');
  }
  return payload.data;
}

function fetchJsonWithTimeout(path, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchJson(path, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function loadFullGoldData(force = false) {
  if (!force && state.fullGold && Date.now() - state.fullGoldLoadedAt < 30000) {
    return state.fullGold;
  }

  try {
    state.fullGold = await fetchJson('/api/gold/full');
    state.fullGoldLoadedAt = Date.now();
    renderBrandOptions();
    return state.fullGold;
  } catch (error) {
    console.warn('品牌金价加载失败:', error);
    return state.fullGold;
  }
}

async function refreshAll() {
  if (state.refreshInFlight) {
    state.refreshQueued = true;
    return;
  }

  state.refreshInFlight = true;
  try {
    const results = await Promise.allSettled([
      fetchJsonWithTimeout('/api/gold/latest?symbol=XAUUSD', 3000),
      fetchJsonWithTimeout(`/api/jd-gold/history?range=${state.selectedRange}`, 8000),
      fetchJsonWithTimeout('/api/gold/recycle/latest', 3000),
      fetchJsonWithTimeout('/api/collector/status', 3000),
    ]);

    const [latestResult, historyResult, recycleResult, collectorResult] = results;
    state.latestError = latestResult.status === 'rejected' ? latestResult.reason : null;
    state.historyError = historyResult.status === 'rejected' ? historyResult.reason : null;
    state.recycleError = recycleResult.status === 'rejected' ? recycleResult.reason : null;
    state.collectorError = collectorResult.status === 'rejected' ? collectorResult.reason : null;

    if (latestResult.status === 'fulfilled') {
      state.latest = latestResult.value;
    }
    if (historyResult.status === 'fulfilled') {
      state.history = historyResult.value?.data || [];
      state.historyIsDomestic = historyResult.value?.symbol === 'CZB-JCJ';
    }
    if (recycleResult.status === 'fulfilled') {
      state.recycle = recycleResult.value || [];
    }
    if (collectorResult.status === 'fulfilled') {
      state.collector = collectorResult.value;
    }

    await loadFullGoldData();
    if (state.recycle.length === 0 && !state.recycleError) {
      state.recycle = state.fullGold?.recycle || [];
    }
    render();
  } catch (error) {
    state.historyError = error;
    els.collectorStatus.textContent = '曲线连接失败';
  } finally {
    state.refreshInFlight = false;
    if (state.refreshQueued) {
      state.refreshQueued = false;
      void refreshAll();
    }
  }
}

async function refreshLiveQuote() {
  if (state.liveRefreshInFlight) {
    return;
  }

  state.liveRefreshInFlight = true;
  try {
    const status = await fetchJson('/api/bullionvault/status');
    state.liveConnected = status?.connected === true;
    state.liveQuote = status?.latestQuote || state.liveQuote;
    renderRealtimeViews();
  } catch {
    state.liveConnected = false;
    renderRealtimeViews();
  } finally {
    state.liveRefreshInFlight = false;
  }
}

function renderRealtimeViews() {
  renderLiveStatus();
  renderMarketSourceOptions();
  renderLatest();
  renderHolding();
  renderCollapsedCard();
  if (state.chartHoverIndex >= 0) {
    drawChart();
  }
}

function getFreshJdQuote() {
  if (!state.jdSocketOpen || !state.jdConnected || !state.jdQuote) {
    return null;
  }

  const fetchedAtMs = Number(state.jdQuote.fetchedAtMs || new Date(state.jdQuote.fetchedAt).getTime());
  if (!Number.isFinite(fetchedAtMs) || Date.now() - fetchedAtMs > JD_QUOTE_STALE_MS) {
    state.jdConnected = false;
    return null;
  }

  return state.jdQuote;
}

function getFreshBullionVaultQuote() {
  return state.liveConnected && state.liveQuote ? state.liveQuote : null;
}

function connectJdWebSocket() {
  if (state.jdSocket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(state.jdSocket.readyState)) {
    return;
  }

  const socketUrl = new URL('/ws/gold', apiBase);
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  let socket;
  try {
    socket = new WebSocket(socketUrl.toString());
  } catch {
    state.jdSocketOpen = false;
    state.jdConnected = false;
    renderRealtimeViews();
    scheduleJdReconnect();
    return;
  }

  state.jdSocket = socket;
  state.jdSocketOpen = false;
  state.jdConnected = false;
  renderLiveStatus();

  socket.addEventListener('open', () => {
    if (state.jdSocket !== socket) {
      return;
    }
    state.jdSocketOpen = true;
    renderLiveStatus();
  });

  socket.addEventListener('message', (event) => {
    if (state.jdSocket !== socket) {
      return;
    }

    try {
      const message = JSON.parse(String(event.data));
      const quote = message?.type === 'jd-gold.quote' ? message.data : null;
      if (message?.type === 'bullionvault.quote' && Number.isFinite(Number(message.data?.pricePerTroyOunce))) {
        state.liveQuote = message.data;
        state.liveConnected = true;
        renderRealtimeViews();
        return;
      }

      if (!quote?.zhejiangGold || !Number.isFinite(Number(quote.zhejiangGold.price))) {
        return;
      }

      state.jdQuote = quote;
      state.jdSocketOpen = true;
      state.jdConnected = true;
      renderRealtimeViews();
    } catch {
      console.warn('京东 WebSocket 消息解析失败');
    }
  });

  socket.addEventListener('error', () => {
    if (state.jdSocket === socket) {
      state.jdConnected = false;
      renderRealtimeViews();
    }
  });

  socket.addEventListener('close', () => {
    if (state.jdSocket !== socket) {
      return;
    }
    state.jdSocket = null;
    state.jdSocketOpen = false;
    state.jdConnected = false;
    renderRealtimeViews();
    scheduleJdReconnect();
  });
}

function scheduleJdReconnect() {
  if (state.jdReconnectTimer) {
    return;
  }

  state.jdReconnectTimer = window.setTimeout(() => {
    state.jdReconnectTimer = null;
    connectJdWebSocket();
  }, 1500);
}

async function pollAlertEvents() {
  try {
    const events = await fetchJson(`/api/alerts/events?sinceId=${state.lastAlertEventId}`);
    state.alertEvents = [...state.alertEvents, ...events].slice(-8);
    for (const event of events) {
      state.lastAlertEventId = Math.max(state.lastAlertEventId, event.id);
      const notified = state.appearance.desktopNotificationEnabled === false
        ? true
        : await window.goldDesktop?.notify('金价提醒', event.message);
      if (notified === false) {
        console.warn('系统通知不可用，金价提醒未弹出系统通知');
      }
    }
    localStorage.setItem('lastAlertEventId', String(state.lastAlertEventId));
    renderCollapsedCard();
  } catch {
  }
}

function render() {
  renderLiveStatus();
  renderMarketSourceOptions();
  renderBrandOptions();
  renderLatest();
  renderHolding();
  renderCollapsedCard();
  drawChart();
}

function domesticPricePerGram(pricePerTroyOunce, exchangeRate = USD_CNY_RATE) {
  const price = Number(pricePerTroyOunce);
  const rate = Number(exchangeRate);
  if (!Number.isFinite(price) || !Number.isFinite(rate) || rate <= 0) {
    return null;
  }
  return price * rate / TROY_OUNCE_GRAMS;
}

function getDomesticFallbackPrice() {
  const liveQuote = getFreshBullionVaultQuote();
  const livePrice = liveQuote
    ? domesticPricePerGram(liveQuote.pricePerTroyOunce)
    : null;
  if (livePrice !== null) {
    return livePrice;
  }

  if (!state.latest) {
    return null;
  }

  return state.latest.symbol === 'XAUUSD'
    ? domesticPricePerGram(state.latest.price)
    : Number(state.latest.price);
}

function getDepositQuoteItems() {
  const jdQuote = getFreshJdQuote();
  return [
    { key: 'CZB-JCJ', label: '浙商积存金', shortLabel: '浙商', instrument: jdQuote?.zhejiangGold },
    { key: 'MS-JCJ', label: '民生积存金', shortLabel: '民生', instrument: jdQuote?.minshengGold },
  ];
}

function getDepositQuoteItem(quoteKey = 'CZB-JCJ') {
  return getDepositQuoteItems().find((item) => item.key === quoteKey) || getDepositQuoteItems()[0];
}

function getDepositQuoteLabel(quoteKey = 'CZB-JCJ', short = false) {
  const item = getDepositQuoteItem(quoteKey);
  return short ? item.shortLabel : item.label;
}

function getDepositQuotePrice(quoteKey = 'CZB-JCJ') {
  const item = getDepositQuoteItem(quoteKey);
  const price = Number(item?.instrument?.price);
  if (Number.isFinite(price)) {
    return price;
  }

  return quoteKey === 'CZB-JCJ' ? getDomesticFallbackPrice() : null;
}

function renderMarketSourceOptions() {
  if (!els.holdingMarketSource) {
    return;
  }

  const activeHolding = getActiveHolding('market');
  if (activeHolding && !activeHolding.quoteKey) {
    activeHolding.quoteKey = 'CZB-JCJ';
    saveHoldingSettings();
  }

  const options = getDepositQuoteItems();
  const getOptionLabel = (item) => {
    const price = getDepositQuotePrice(item.key);
    return `${item.label}${Number.isFinite(Number(price)) ? ` · ${formatNumber(price, 2)} 元/克` : ' · 等待报价'}`;
  };
  const currentSignature = [...els.holdingMarketSource.options].map((option) => `${option.value}:${option.textContent}`).join('|');
  const nextSignature = options.map((item) => `${item.key}:${getOptionLabel(item)}`).join('|');
  if (currentSignature !== nextSignature) {
    els.holdingMarketSource.replaceChildren(...options.map((item) => {
      const option = document.createElement('option');
      option.value = item.key;
      option.textContent = getOptionLabel(item);
      return option;
    }));
  }

  els.holdingMarketSource.value = activeHolding?.quoteKey || 'CZB-JCJ';
}

function getCurrentDomesticPrice() {
  return getDepositQuotePrice('CZB-JCJ') ?? getDomesticFallbackPrice();
}

function getDisplayHistoryPrice(point) {
  if (state.historyIsDomestic) {
    return Number(point.price);
  }

  const domesticPrice = domesticPricePerGram(point.price);
  return domesticPrice === null ? Number(point.price) : domesticPrice;
}

function getGoldRecyclePrice() {
  const item = state.recycle.find((entry) => entry.type && entry.type.includes('黄金') && !entry.type.includes('22k') && !entry.type.includes('18k') && !entry.type.includes('14k')) || state.recycle[0];
  return item?.price && Number.isFinite(Number(item.price)) ? Number(item.price) : null;
}

function getBrandEntries() {
  const stores = state.fullGold?.stores || [];
  const banks = state.fullGold?.banks || [];
  const entries = [...stores, ...banks].filter((item) => item && Number.isFinite(Number(item.price)) && item.unit === '元/克');
  const seen = new Set();
  return entries.filter((item) => {
    const key = `${item.brand}|${item.product}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getBrandKey(item) {
  return `${item.brand}|${item.product}`;
}

function getSelectedBrand() {
  const entries = getBrandEntries();
  const activeBrand = getActiveHolding('brand');
  return entries.find((item) => getBrandKey(item) === activeBrand?.brandKey) || entries[0] || null;
}

function renderBrandOptions() {
  if (!els.holdingBrand) {
    return;
  }

  const entries = getBrandEntries();
  const selectedBrand = getSelectedBrand();
  const selectedKey = selectedBrand ? getBrandKey(selectedBrand) : '';
  const brandHolding = getActiveHolding('brand');
  if (brandHolding && brandHolding.brandKey !== selectedKey) {
    brandHolding.brandKey = selectedKey;
    saveHoldingSettings();
  }

  const getOptionLabel = (item) => `${item.brand} · ${item.product} · ${formatNumber(item.price, 2)} 元/克`;
  const currentSignature = [...els.holdingBrand.options].map((option) => `${option.value}:${option.textContent}`).join('|');
  const nextSignature = entries.map((item) => `${getBrandKey(item)}:${getOptionLabel(item)}`).join('|');
  if (currentSignature !== nextSignature) {
    els.holdingBrand.replaceChildren(...entries.map((item) => {
      const option = document.createElement('option');
      option.value = getBrandKey(item);
      option.textContent = getOptionLabel(item);
      return option;
    }));
  }
  els.holdingBrand.value = selectedKey;
}

function renderLiveStatus() {
  const jdQuote = getFreshJdQuote();
  const fallbackQuote = getFreshBullionVaultQuote();
  const status = jdQuote
    ? '实时'
    : fallbackQuote
      ? '备用'
      : state.jdSocketOpen
        ? '京东连接中'
        : state.liveQuote || state.jdQuote
          ? '等待恢复'
          : '离线';
  const connected = Boolean(jdQuote || fallbackQuote);
  const stale = !connected && Boolean(state.liveQuote || state.jdQuote);
  els.liveStatus.textContent = status;
  els.liveStatusDot.className = `live-status-dot ${connected ? 'connected' : stale ? 'stale' : 'offline'}`;
  els.collapsedLiveDot.className = `collapsed-live-dot ${connected ? 'connected' : stale ? 'stale' : 'offline'}`;
}

function getChangeView(changeValue, changePercent) {
  const value = Number(changeValue);
  const percent = Number(changePercent);
  if (!Number.isFinite(value) && !Number.isFinite(percent)) {
    return { text: '等待采集', className: 'change neutral' };
  }

  const safeValue = Number.isFinite(value) ? value : 0;
  const safePercent = Number.isFinite(percent) ? percent : 0;
  const sign = safeValue > 0 ? '+' : '';
  return {
    text: `${sign}${formatNumber(safeValue, 2)} / ${sign}${formatNumber(safePercent, 2)}%`,
    className: `change ${safeValue > 0 ? 'up' : safeValue < 0 ? 'down' : 'neutral'}`,
  };
}

function renderLatest() {
  const jdQuote = getFreshJdQuote();
  const fallbackQuote = getFreshBullionVaultQuote();
  const current = getCurrentDomesticPrice();
  if (current === null || !Number.isFinite(current)) {
    return;
  }

  renderRollingNumber(els.currentPrice, current, 2);
  renderRollingNumber(els.minshengPrice, getDepositQuotePrice('MS-JCJ'), 2);
  renderRollingNumber(els.exchangeRate, jdQuote?.exchangeRate?.price, 4);
  els.updatedAt.textContent = formatTime(
    jdQuote?.fetchedAt
      || jdQuote?.zhejiangGold?.quoteTime
      || fallbackQuote?.timestamp
      || state.latest?.fetchTime,
  );
  const dataStatus = jdQuote
    ? '实时更新'
    : fallbackQuote
      ? '备用更新'
      : state.collector?.running ? '5 秒采集' : '采集暂停';
  els.collectorStatus.textContent = state.historyError
    ? (state.history.length > 0 ? `${dataStatus} · 曲线暂时无法更新` : '曲线连接失败')
    : dataStatus;

  const change = getRangeChange();
  const zhejiangChange = getChangeView(change.value, change.percent);
  els.changeText.textContent = zhejiangChange.text;
  els.changeText.className = zhejiangChange.className;

  const minshengChange = getChangeView(jdQuote?.minshengGold?.change, jdQuote?.minshengGold?.changePercent);
  els.minshengChangeText.textContent = minshengChange.text;
  els.minshengChangeText.className = minshengChange.className;
}

function getHoldingQuote(holding = getActiveHolding()) {
  const mode = holding?.mode || state.holding.mode;
  if (mode === 'brand') {
    const selectedBrand = getBrandEntries().find((item) => getBrandKey(item) === holding?.brandKey);
    return selectedBrand ? Number(selectedBrand.price) : null;
  }
  if (mode === 'recycle') {
    return getGoldRecyclePrice();
  }
  return getDepositQuotePrice(holding?.quoteKey || 'CZB-JCJ');
}

function getHoldingInputs(holding = getActiveHolding()) {
  const grams = Number(holding?.grams);
  const buyPrice = Number(holding?.buyPrice);
  return {
    grams,
    buyPrice,
    valid: Number.isFinite(grams) && grams > 0 && Number.isFinite(buyPrice) && buyPrice > 0,
  };
}

function calculateHolding(holding = getActiveHolding()) {
  const inputs = getHoldingInputs(holding);
  const quote = getHoldingQuote(holding);
  if (!inputs.valid || !Number.isFinite(Number(quote))) {
    return null;
  }

  const cost = inputs.grams * inputs.buyPrice;
  const value = inputs.grams * Number(quote);
  const recyclePrice = getGoldRecyclePrice();
  const saleValue = recyclePrice === null ? null : inputs.grams * recyclePrice;
  return {
    cost,
    value,
    profit: value - cost,
    saleValue,
    saleProfit: saleValue === null ? null : saleValue - cost,
  };
}

function getHoldingAssetLabel(holding, mode, index) {
  if (mode === 'brand') {
    const brand = getBrandEntries().find((item) => getBrandKey(item) === holding.brandKey);
    return brand ? `${brand.brand} · ${brand.product}` : `品牌金 ${index + 1}`;
  }
  return mode === 'recycle' ? '回收金' : getDepositQuoteLabel(holding?.quoteKey || 'CZB-JCJ');
}

function renderHoldingAssets(holdings, activeHolding, mode) {
  els.holdingAssetCount.textContent = `当前 ${holdings.length} 项资产`;
  els.holdingAssetList.replaceChildren(...holdings.map((holding, index) => {
    const row = document.createElement('div');
    row.className = `holding-asset-item${holding.id === activeHolding?.id ? ' active' : ''}`;

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'holding-asset-select';
    select.dataset.holdingId = holding.id;
    select.title = '编辑此资产';

    const title = document.createElement('strong');
    title.textContent = getHoldingAssetLabel(holding, mode, index);
    const detail = document.createElement('span');
    const grams = Number(holding.grams);
    const calculation = calculateHolding(holding);
    detail.textContent = Number.isFinite(grams) && grams > 0
      ? `${formatNumber(grams, 2)} 克${calculation ? ` · ${formatProfit(calculation.profit)}` : ''}`
      : '待填写克数和买入价';
    select.append(title, detail);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'holding-asset-remove';
    remove.dataset.removeHoldingId = holding.id;
    remove.title = '删除资产';
    remove.setAttribute('aria-label', `删除${title.textContent}`);
    remove.textContent = '×';

    row.append(select, remove);
    return row;
  }));
}

function renderHolding() {
  const mode = state.holding.mode;
  const activeHolding = getActiveHolding(mode);
  const holdings = getHoldingList(mode);
  const selectedBrand = getSelectedBrand();
  const brandPrice = selectedBrand ? Number(selectedBrand.price) : null;
  const recyclePrice = getGoldRecyclePrice();
  const calculations = holdings.map((item) => calculateHolding(item)).filter(Boolean);
  const totals = calculations
    .reduce((total, item) => ({
      cost: total.cost + item.cost,
      value: total.value + item.value,
      profit: total.profit + item.profit,
      saleValue: total.saleValue + (item.saleValue || 0),
      saleProfit: total.saleProfit + (item.saleProfit || 0),
      saleAvailable: total.saleAvailable || item.saleValue !== null,
    }), { cost: 0, value: 0, profit: 0, saleValue: 0, saleProfit: 0, saleAvailable: false });

  renderHoldingAssets(holdings, activeHolding, mode);
  els.addHoldingButton.hidden = mode === 'recycle';
  els.holdingAssetCount.textContent = mode === 'recycle' ? '单项资产' : `当前 ${holdings.length} 项资产`;

  els.holdingModes.forEach((button) => {
    const selected = button.dataset.holdingMode === mode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  els.holdingMarketSourceField.hidden = mode !== 'market';
  els.holdingBrandField.hidden = mode !== 'brand';
  els.holdingSale.hidden = mode !== 'brand';
  els.holdingForm.classList.toggle('market-mode', mode === 'market');
  els.holdingForm.classList.toggle('brand-mode', mode === 'brand');
  syncFieldValue(els.holdingGrams, activeHolding?.grams);
  syncFieldValue(els.holdingBuyPrice, activeHolding?.buyPrice);
  syncFieldValue(els.holdingMarketSource, activeHolding?.quoteKey || 'CZB-JCJ');
  syncFieldValue(els.holdingBrand, activeHolding?.brandKey);
  els.holdingRecycleRate.textContent = recyclePrice === null ? '回收价 --' : `回收价 ${formatNumber(recyclePrice, 2)} 元/克`;

  const modeLabel = mode === 'brand' && selectedBrand
    ? `${selectedBrand.brand} ${selectedBrand.product}`
    : mode === 'recycle' ? '回收参考价' : '按积存来源估值';
  els.holdingModeHint.textContent = modeLabel;
  els.holdingValueLabel.textContent = mode === 'recycle' ? '现在可卖' : '当前估值';
  els.holdingQuoteNote.textContent = mode === 'brand'
    ? selectedBrand ? `${selectedBrand.brand}当前报价 ${formatNumber(brandPrice, 2)} 元/克；回收价用于估算实际卖出` : '正在加载品牌价格'
    : mode === 'recycle' ? `当前黄金回收价 ${recyclePrice === null ? '--' : formatNumber(recyclePrice, 2)} 元/克`
      : '每条积存金资产可选择浙商或民生，并按对应实时价计算盈亏';
  els.holdingQuoteNote.classList.toggle('brand-note', mode === 'brand');

  if (calculations.length === 0) {
    els.holdingValue.textContent = '--';
    els.holdingCost.textContent = '--';
    els.holdingProfit.textContent = '--';
    els.holdingProfit.className = '';
    els.holdingSaleValue.textContent = '可卖 --';
    els.holdingSaleProfit.textContent = '卖出盈亏 --';
    els.holdingSaleProfit.className = '';
    return;
  }

  els.holdingValue.textContent = formatMoney(totals.value);
  els.holdingCost.textContent = formatMoney(totals.cost);
  els.holdingProfit.textContent = formatProfit(totals.profit);
  els.holdingProfit.className = totals.profit > 0 ? 'up' : totals.profit < 0 ? 'down' : 'neutral';

  if (totals.saleAvailable && mode === 'brand') {
    els.holdingSaleValue.textContent = `可卖 ${formatMoney(totals.saleValue)}`;
    els.holdingSaleProfit.textContent = `卖出盈亏 ${formatProfit(totals.saleProfit)}`;
    els.holdingSaleProfit.className = totals.saleProfit > 0 ? 'up' : totals.saleProfit < 0 ? 'down' : 'neutral';
  }
}

function renderCollapsedCard() {
  const current = getCurrentDomesticPrice();
  const modeLabels = { brand: '品牌', recycle: '回收金' };
  const assets = ['market', 'brand', 'recycle'].flatMap((mode) => getHoldingList(mode).map((item, index) => ({
    mode,
    index,
    item,
    calculation: calculateHolding(item),
  }))).filter((entry) => entry.calculation);
  renderRollingNumber(els.collapsedZhejiangPrice, current, 2);
  renderRollingNumber(els.collapsedMinshengPrice, getDepositQuotePrice('MS-JCJ'), 2);
  els.collapsedUpdated.textContent = formatTime(
    getFreshJdQuote()?.fetchedAt
      || getFreshJdQuote()?.zhejiangGold?.quoteTime
      || getFreshBullionVaultQuote()?.timestamp
      || state.latest?.fetchTime,
  );
  els.collapsedProfit.className = 'collapsed-assets';
  const displayMode = state.appearance?.collapsedDisplay || 'price';
  if (displayMode === 'price') {
    els.collapsedProfit.textContent = '报价实时刷新';
    return;
  }
  if (displayMode === 'alerts') {
    const event = state.alertEvents[state.alertEvents.length - 1];
    els.collapsedProfit.textContent = event ? `提醒：${event.message}` : '暂无提醒';
    return;
  }
  if (assets.length === 0) {
    els.collapsedProfit.textContent = '未设置资产';
    return;
  }

  const totalProfit = assets.reduce((total, entry) => total + entry.calculation.profit, 0);
  const detailLimit = assets.length > 3 ? 2 : 3;
  const summary = document.createElement('span');
  summary.className = `collapsed-asset-summary ${totalProfit > 0 ? 'up' : totalProfit < 0 ? 'down' : 'neutral'}`;
  summary.textContent = `${assets.length}项 ${formatProfit(totalProfit)}`;

  const detailItems = assets.slice(0, detailLimit).map(({ mode, item, calculation }) => {
    const entry = document.createElement('span');
    entry.className = `collapsed-asset-item ${calculation.profit > 0 ? 'up' : calculation.profit < 0 ? 'down' : 'neutral'}`;
    const brand = mode === 'brand'
      ? getBrandEntries().find((candidate) => getBrandKey(candidate) === item.brandKey)
      : null;
    const label = mode === 'market'
      ? getDepositQuoteLabel(item.quoteKey || 'CZB-JCJ', true)
      : brand ? brand.brand : modeLabels[mode];
    entry.textContent = `${label} ${formatProfit(calculation.profit)}`;
    return entry;
  });

  if (assets.length > detailLimit) {
    const more = document.createElement('span');
    more.className = 'collapsed-asset-more';
    more.textContent = `+${assets.length - detailLimit}`;
    detailItems.push(more);
  }

  els.collapsedProfit.replaceChildren(summary, ...detailItems);
}

function getRangeChange() {
  const jdQuote = getFreshJdQuote();
  if (jdQuote?.zhejiangGold) {
    return {
      value: Number(jdQuote.zhejiangGold.change) || 0,
      percent: Number(jdQuote.zhejiangGold.changePercent) || 0,
    };
  }

  const points = state.history;
  if (points.length >= 2) {
    const first = getDisplayHistoryPrice(points[0]);
    const last = getDisplayHistoryPrice(points[points.length - 1]);
    const value = last - first;
    return { value, percent: first > 0 ? (value / first) * 100 : 0 };
  }

  const storedChange = Number(state.latest?.change);
  const change = Number.isFinite(storedChange)
    ? state.latest?.symbol === 'XAUUSD' ? domesticPricePerGram(storedChange) || 0 : storedChange
    : 0;
  return { value: change, percent: Number(state.latest?.changePercent) || 0 };
}

function traceSmoothPath(ctx, coordinates) {
  if (coordinates.length === 0) {
    return;
  }

  ctx.moveTo(coordinates[0].x, coordinates[0].y);
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const current = coordinates[index];
    const next = coordinates[index + 1];
    const midpoint = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
    ctx.quadraticCurveTo(current.x, current.y, midpoint.x, midpoint.y);
  }

  const last = coordinates[coordinates.length - 1];
  ctx.quadraticCurveTo(last.x, last.y, last.x, last.y);
}

function drawChart() {
  const canvas = els.priceChart;
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }

  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 18, right: 10, bottom: 20, left: 52 };
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(60, 60, 67, 0.12)';
  ctx.lineWidth = 1;
  for (let index = 0; index < 4; index += 1) {
    const y = padding.top + (plotHeight / 3) * index;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  const points = state.history;
  state.chartPoints = [];
  state.chartMetrics = { padding, plotWidth };
  if (points.length === 0) {
    ctx.fillStyle = '#6e6e73';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('等待采集数据', padding.left, height / 2);
    hideChartTooltip();
    return;
  }

  const prices = points.map((point) => getDisplayHistoryPrice(point));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(max - min, 0.01);
  const coordinates = points.map((point, index) => ({
    x: points.length === 1 ? padding.left + plotWidth / 2 : padding.left + (plotWidth * index) / (points.length - 1),
    y: padding.top + plotHeight - ((prices[index] - min) / span) * plotHeight,
    point,
    price: prices[index],
  }));
  state.chartPoints = coordinates;

  const rising = prices[prices.length - 1] >= prices[0];
  const lineColor = rising ? '#ba3a32' : '#16805e';
  const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  gradient.addColorStop(0, rising ? 'rgba(186, 58, 50, 0.2)' : 'rgba(22, 128, 94, 0.18)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.beginPath();
  traceSmoothPath(ctx, coordinates);
  ctx.lineTo(coordinates[coordinates.length - 1].x, height - padding.bottom);
  ctx.lineTo(coordinates[0].x, height - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  traceSmoothPath(ctx, coordinates);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  const last = coordinates[coordinates.length - 1];
  ctx.fillStyle = lineColor;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#6e6e73';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(formatNumber(max, 2), 2, padding.top + 4);
  ctx.fillText(formatNumber(min, 2), 2, height - padding.bottom + 4);

  if (state.chartHoverIndex >= 0 && state.chartHoverIndex < coordinates.length) {
    const hover = coordinates[state.chartHoverIndex];
    ctx.strokeStyle = 'rgba(60, 60, 67, 0.28)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(hover.x, padding.top);
    ctx.lineTo(hover.x, height - padding.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(hover.x, hover.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(hover.x, hover.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function handleChartMove(event) {
  if (!state.chartPoints.length || !state.chartMetrics) {
    return;
  }

  const rect = els.priceChart.getBoundingClientRect();
  const localX = Math.max(state.chartMetrics.padding.left, Math.min(rect.width - state.chartMetrics.padding.right, event.clientX - rect.left));
  const ratio = (localX - state.chartMetrics.padding.left) / state.chartMetrics.plotWidth;
  const index = Math.max(0, Math.min(state.chartPoints.length - 1, Math.round(ratio * (state.chartPoints.length - 1))));
  state.chartHoverIndex = index;
  showChartTooltip(state.chartPoints[index], event.clientX, event.clientY);
  drawChart();
}

function showChartTooltip(item, clientX, clientY) {
  const sectionRect = els.chartSection.getBoundingClientRect();
  const tooltip = els.chartTooltip;
  tooltip.hidden = false;
  tooltip.innerHTML = `<strong>${formatNumber(item.price, 2)} 元/克</strong><span>${formatHistoryTime(item.point.timestamp)}</span>`;
  const tooltipWidth = tooltip.offsetWidth || 150;
  const tooltipHeight = tooltip.offsetHeight || 48;
  let left = clientX - sectionRect.left + 12;
  let top = clientY - sectionRect.top - tooltipHeight - 12;
  if (left + tooltipWidth > sectionRect.width - 8) {
    left = sectionRect.width - tooltipWidth - 8;
  }
  if (left < 8) {
    left = 8;
  }
  if (top < 8) {
    top = clientY - sectionRect.top + 12;
  }
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideChartTooltip() {
  state.chartHoverIndex = -1;
  els.chartTooltip.hidden = true;
}

function toggleCollapsed() {
  if (!state.collapseInFlight) {
    els.toggleButton.click();
  }
}

let collapsedDragState = null;
let suppressWindowClick = false;
let suppressWindowClickTimer = null;

function suppressClickAfterDrag() {
  suppressWindowClick = true;
  if (suppressWindowClickTimer) {
    window.clearTimeout(suppressWindowClickTimer);
  }
  suppressWindowClickTimer = window.setTimeout(() => {
    suppressWindowClick = false;
    suppressWindowClickTimer = null;
  }, 250);
}

function getPointerPosition(event) {
  const screenX = Number(event.screenX);
  const screenY = Number(event.screenY);
  if (Number.isFinite(screenX) && Number.isFinite(screenY)) {
    return { x: screenX, y: screenY };
  }

  const clientX = Number(event.clientX);
  const clientY = Number(event.clientY);
  return Number.isFinite(clientX) && Number.isFinite(clientY)
    ? { x: clientX, y: clientY }
    : null;
}

function isWindowDragBlocked(event) {
  return event.button !== undefined && event.button !== 0
    || Boolean(event.target.closest('button, input, select, textarea, a'));
}

function handleWindowPointerDown(event) {
  if (isWindowDragBlocked(event)) {
    return;
  }

  const position = getPointerPosition(event);
  if (!position) {
    return;
  }

  collapsedDragState = {
    pointerId: event.pointerId,
    target: event.currentTarget,
    startX: position.x,
    startY: position.y,
    moved: false,
  };
  window.goldDesktop?.beginWindowDrag(position.x, position.y);
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function handleCollapsedPointerMove(event) {
  if (!collapsedDragState || collapsedDragState.pointerId !== event.pointerId) {
    return;
  }

  const position = getPointerPosition(event);
  if (!position) {
    return;
  }

  const distance = Math.hypot(
    position.x - collapsedDragState.startX,
    position.y - collapsedDragState.startY,
  );
  if (distance >= 4) {
    if (!collapsedDragState.moved) {
      suppressClickAfterDrag();
    }
    collapsedDragState.moved = true;
  }

  if (collapsedDragState.moved) {
    window.goldDesktop?.moveWindowDrag(position.x, position.y);
    event.preventDefault();
  }
}

function handleCollapsedPointerUp(event) {
  if (!collapsedDragState || collapsedDragState.pointerId !== event.pointerId) {
    return;
  }

  const moved = collapsedDragState.moved;
  window.goldDesktop?.endWindowDrag();
  collapsedDragState.target?.releasePointerCapture?.(event.pointerId);
  collapsedDragState = null;
  if (moved) {
    suppressClickAfterDrag();
  }
}

function handleCollapsedPointerCancel(event) {
  if (!collapsedDragState || collapsedDragState.pointerId !== event.pointerId) {
    return;
  }

  window.goldDesktop?.endWindowDrag();
  collapsedDragState.target?.releasePointerCapture?.(event.pointerId);
  collapsedDragState = null;
  suppressClickAfterDrag();
}

function applyHoldingInputState() {
  const activeHolding = getActiveHolding();
  syncFieldValue(els.holdingGrams, activeHolding?.grams);
  syncFieldValue(els.holdingBuyPrice, activeHolding?.buyPrice);
  renderMarketSourceOptions();
  renderBrandOptions();
  renderHolding();
  renderCollapsedCard();
}

function setHoldingMode(mode) {
  state.holding.mode = mode;
  if (!getActiveHolding(mode)) {
    const asset = createHoldingAsset();
    state.holding.holdings[mode] = [asset];
    state.holding.activeIds[mode] = asset.id;
  }
  saveHoldingSettings();
  applyHoldingInputState();
  if (mode === 'brand') {
    loadFullGoldData().then(() => {
      renderBrandOptions();
      renderHolding();
      renderCollapsedCard();
    });
  }
}

document.querySelectorAll('.range-tab').forEach((button) => {
  button.addEventListener('click', () => {
    state.selectedRange = button.dataset.range;
    state.history = [];
    state.historyError = null;
    state.chartHoverIndex = -1;
    document.querySelectorAll('.range-tab').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
    });
    drawChart();
    refreshAll();
  });
});

els.holdingModes.forEach((button) => {
  button.addEventListener('click', () => setHoldingMode(button.dataset.holdingMode));
});

els.holdingGrams.addEventListener('input', () => {
  const activeHolding = getActiveHolding();
  if (!activeHolding) {
    return;
  }
  activeHolding.grams = els.holdingGrams.value;
  saveHoldingSettings();
  renderHolding();
  renderCollapsedCard();
});

els.holdingBuyPrice.addEventListener('input', () => {
  const activeHolding = getActiveHolding();
  if (!activeHolding) {
    return;
  }
  activeHolding.buyPrice = els.holdingBuyPrice.value;
  saveHoldingSettings();
  renderHolding();
  renderCollapsedCard();
});

els.holdingMarketSource.addEventListener('change', () => {
  const activeHolding = getActiveHolding('market');
  if (!activeHolding) {
    return;
  }
  activeHolding.quoteKey = els.holdingMarketSource.value || 'CZB-JCJ';
  saveHoldingSettings();
  renderHolding();
  renderCollapsedCard();
});

els.holdingBrand.addEventListener('change', () => {
  const activeHolding = getActiveHolding('brand');
  if (!activeHolding) {
    return;
  }
  activeHolding.brandKey = els.holdingBrand.value;
  saveHoldingSettings();
  renderHolding();
  renderCollapsedCard();
});

els.addHoldingButton.addEventListener('click', () => {
  if (state.holding.mode === 'recycle') {
    return;
  }
  const asset = createHoldingAsset();
  const holdings = getHoldingList();
  holdings.push(asset);
  state.holding.activeIds[state.holding.mode] = asset.id;
  saveHoldingSettings();
  applyHoldingInputState();
  els.holdingGrams.focus();
});

els.holdingAssetList.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove-holding-id]');
  if (removeButton) {
    const mode = state.holding.mode;
    const holdings = getHoldingList(mode);
    const remaining = holdings.filter((item) => item.id !== removeButton.dataset.removeHoldingId);
    if (remaining.length === 0) {
      const replacement = createHoldingAsset();
      state.holding.holdings[mode] = [replacement];
      state.holding.activeIds[mode] = replacement.id;
    } else {
      state.holding.holdings[mode] = remaining;
      if (!remaining.some((item) => item.id === state.holding.activeIds[mode])) {
        state.holding.activeIds[mode] = remaining[0].id;
      }
    }
    saveHoldingSettings();
    applyHoldingInputState();
    return;
  }

  const selectButton = event.target.closest('[data-holding-id]');
  if (!selectButton) {
    return;
  }

  state.holding.activeIds[state.holding.mode] = selectButton.dataset.holdingId;
  saveHoldingSettings();
  applyHoldingInputState();
});

function applyCollapsedState() {
  document.body.classList.toggle('collapsed', state.collapsed);
  els.toggleButton.title = state.collapsed ? '展开' : '折叠';
  els.toggleButton.setAttribute('aria-label', state.collapsed ? '展开' : '折叠');
  els.toggleButton.setAttribute('aria-expanded', String(!state.collapsed));
  els.toggleButton.classList.toggle('is-collapsed', state.collapsed);
  els.collapsedCard.setAttribute('aria-label', state.collapsed ? '点击展开金价详情' : '金价详情');
  els.toggleButton.classList.toggle('active', !state.collapsed);
}

els.collapsedCard.addEventListener('click', (event) => {
  if (suppressWindowClick) {
    suppressWindowClick = false;
    if (suppressWindowClickTimer) {
      window.clearTimeout(suppressWindowClickTimer);
      suppressWindowClickTimer = null;
    }
    event.preventDefault();
    return;
  }
  toggleCollapsed();
});
els.collapsedCard.addEventListener('pointerdown', handleWindowPointerDown);
els.collapsedCard.addEventListener('pointerup', handleCollapsedPointerUp);
els.collapsedCard.addEventListener('pointercancel', handleCollapsedPointerCancel);
document.addEventListener('pointermove', handleCollapsedPointerMove);
document.addEventListener('pointerup', handleCollapsedPointerUp);
document.addEventListener('pointercancel', handleCollapsedPointerCancel);
els.collapsedCard.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleCollapsed();
  }
});
els.toggleButton.addEventListener('click', async () => {
  if (state.collapseInFlight) {
    return;
  }

  state.collapseInFlight = true;
  const nextCollapsed = !state.collapsed;
  state.collapsed = nextCollapsed;
  applyCollapsedState();
  try {
    const actualCollapsed = await window.goldDesktop?.setCollapsed(nextCollapsed);
    if (typeof actualCollapsed === 'boolean') {
      state.collapsed = actualCollapsed;
      applyCollapsedState();
      if (actualCollapsed) {
        await window.goldDesktop?.setCollapsedSize(state.appearance.collapsedSize);
      }
    }
  } catch {
    state.collapsed = !nextCollapsed;
    applyCollapsedState();
  } finally {
    state.collapseInFlight = false;
  }
});
els.minimizeButton.addEventListener('click', () => window.goldDesktop?.minimize());
els.closeButton.addEventListener('click', () => window.goldDesktop?.close());
els.settingsButton.addEventListener('click', () => window.goldDesktop?.openSettings());
window.goldDesktop?.onWindowToggleCollapsed?.(() => toggleCollapsed());
window.goldDesktop?.onAppearanceChanged?.((settings) => applyAppearance(settings));

els.priceChart.addEventListener('mousemove', handleChartMove);
els.priceChart.addEventListener('mouseleave', () => {
  hideChartTooltip();
  drawChart();
});

window.addEventListener('resize', drawChart);

  applyAppearance(state.appearance);
  applyHoldingInputState();
  connectJdWebSocket();
  refreshAll();
refreshLiveQuote();
pollAlertEvents();
setInterval(refreshLiveQuote, 2000);
setInterval(refreshAll, 5000);
setInterval(pollAlertEvents, 5000);
setInterval(() => loadFullGoldData(true).then(() => {
  renderBrandOptions();
  renderHolding();
  renderCollapsedCard();
}), 30000);
