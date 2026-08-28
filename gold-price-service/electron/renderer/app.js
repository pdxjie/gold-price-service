const apiBase = window.goldDesktop?.apiBase || 'http://localhost:3001';

const state = {
  latest: null,
  history: [],
  recycle: [],
  rules: [],
  collector: null,
  selectedRange: '1h',
  selectedDirection: 'below',
  lastAlertEventId: Number(localStorage.getItem('lastAlertEventId') || 0),
  pinned: true,
};

const els = {
  sourceBadge: document.getElementById('sourceBadge'),
  quoteTime: document.getElementById('quoteTime'),
  currentPrice: document.getElementById('currentPrice'),
  changeText: document.getElementById('changeText'),
  highPrice: document.getElementById('highPrice'),
  lowPrice: document.getElementById('lowPrice'),
  priceChart: document.getElementById('priceChart'),
  recyclePrice: document.getElementById('recyclePrice'),
  spreadPrice: document.getElementById('spreadPrice'),
  collectorStatus: document.getElementById('collectorStatus'),
  updatedAt: document.getElementById('updatedAt'),
  alertEnabled: document.getElementById('alertEnabled'),
  targetPriceInput: document.getElementById('targetPriceInput'),
  saveAlertButton: document.getElementById('saveAlertButton'),
  alertStatus: document.getElementById('alertStatus'),
  pinButton: document.getElementById('pinButton'),
  minimizeButton: document.getElementById('minimizeButton'),
  closeButton: document.getElementById('closeButton'),
};

function formatNumber(value, digits = 2) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return '--';
  }
  return Number(value).toFixed(digits);
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

async function refreshAll() {
  try {
    const [latest, history, recycle, collector, rules] = await Promise.all([
      fetchJson('/api/gold/latest?symbol=AU9999'),
      fetchJson(`/api/gold/history?symbol=AU9999&range=${state.selectedRange}`),
      fetchJson('/api/gold/recycle/latest'),
      fetchJson('/api/collector/status'),
      fetchJson('/api/alerts/rules'),
    ]);

    state.latest = latest;
    state.history = history.data || [];
    state.recycle = recycle;
    state.collector = collector;
    state.rules = rules;

    if (state.recycle.length === 0) {
      const full = await fetchJson('/api/gold/full');
      state.recycle = full.recycle || [];
    }

    render();
  } catch (error) {
    els.collectorStatus.textContent = '连接失败';
    els.alertStatus.textContent = error.message;
  }
}

async function pollAlertEvents() {
  try {
    const events = await fetchJson(`/api/alerts/events?sinceId=${state.lastAlertEventId}`);
    for (const event of events) {
      state.lastAlertEventId = Math.max(state.lastAlertEventId, event.id);
      window.goldDesktop?.notify('金价提醒', event.message);
    }
    localStorage.setItem('lastAlertEventId', String(state.lastAlertEventId));
  } catch {
    // 通知轮询失败不影响主价格显示。
  }
}

function render() {
  renderLatest();
  renderRecycle();
  renderAlertRule();
  drawChart();
}

function renderLatest() {
  const latest = state.latest;
  if (!latest) {
    return;
  }

  els.sourceBadge.textContent = latest.source === 'scraper' ? '黄金价格网' : '招商银行';
  els.quoteTime.textContent = formatTime(latest.quoteTime || latest.fetchTime);
  els.currentPrice.textContent = formatNumber(latest.price, 2);
  els.highPrice.textContent = formatNumber(latest.high, 2);
  els.lowPrice.textContent = formatNumber(latest.low, 2);
  els.updatedAt.textContent = formatTime(latest.fetchTime);
  els.collectorStatus.textContent = state.collector?.running ? '5 秒采集' : '采集暂停';

  const change = getRangeChange();
  const sign = change.value > 0 ? '+' : '';
  els.changeText.textContent = `${sign}${formatNumber(change.value, 2)} / ${sign}${formatNumber(change.percent, 2)}%`;
  els.changeText.className = `change ${change.value > 0 ? 'up' : change.value < 0 ? 'down' : 'neutral'}`;
}

function renderRecycle() {
  const mainRecycle = state.recycle.find((item) => item.type.includes('黄金')) || state.recycle[0];
  const recyclePrice = mainRecycle?.price;
  els.recyclePrice.textContent = recyclePrice ? `${formatNumber(recyclePrice, 2)}` : '--';

  if (state.latest && recyclePrice) {
    els.spreadPrice.textContent = formatNumber(state.latest.price - recyclePrice, 2);
  } else {
    els.spreadPrice.textContent = '--';
  }
}

function renderAlertRule() {
  const rule = state.rules.find((item) => item.symbol === 'AU9999') || state.rules[0];
  if (!rule) {
    els.alertStatus.textContent = '未设置提醒';
    return;
  }

  state.selectedDirection = rule.direction;
  els.alertEnabled.checked = rule.enabled;
  els.targetPriceInput.value = formatNumber(rule.targetPrice, 2);

  document.querySelectorAll('.segment').forEach((button) => {
    button.classList.toggle('active', button.dataset.direction === rule.direction);
  });

  const directionText = rule.direction === 'below' ? '低于' : '高于';
  els.alertStatus.textContent = `${directionText} ${formatNumber(rule.targetPrice, 2)} 元/克提醒`;
}

function getRangeChange() {
  const points = state.history;
  if (points.length >= 2) {
    const first = points[0].price;
    const last = points[points.length - 1].price;
    const value = last - first;
    return {
      value,
      percent: first > 0 ? (value / first) * 100 : 0,
    };
  }

  return {
    value: state.latest?.change || 0,
    percent: state.latest?.changePercent || 0,
  };
}

function drawChart() {
  const canvas = els.priceChart;
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 18, right: 10, bottom: 20, left: 42 };

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(64, 54, 38, 0.11)';
  ctx.lineWidth = 1;

  for (let i = 0; i < 4; i += 1) {
    const y = padding.top + ((height - padding.top - padding.bottom) / 3) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  const points = state.history;
  if (points.length < 2) {
    ctx.fillStyle = '#7c756b';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('等待更多采集点', padding.left, height / 2);
    return;
  }

  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(max - min, 0.01);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const coords = points.map((point, index) => ({
    x: padding.left + (plotWidth * index) / (points.length - 1),
    y: padding.top + plotHeight - ((point.price - min) / span) * plotHeight,
  }));

  const rising = prices[prices.length - 1] >= prices[0];
  const lineColor = rising ? '#c63f35' : '#16805e';

  const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  gradient.addColorStop(0, rising ? 'rgba(198, 63, 53, 0.22)' : 'rgba(22, 128, 94, 0.20)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.beginPath();
  coords.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.lineTo(coords[coords.length - 1].x, height - padding.bottom);
  ctx.lineTo(coords[0].x, height - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  coords.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  const last = coords[coords.length - 1];
  ctx.fillStyle = lineColor;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#7c756b';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(formatNumber(max, 2), 2, padding.top + 4);
  ctx.fillText(formatNumber(min, 2), 2, height - padding.bottom + 4);
}

async function saveAlertRule() {
  const targetPrice = Number(els.targetPriceInput.value);
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
    els.alertStatus.textContent = '请输入有效金额';
    return;
  }

  const body = {
    symbol: 'AU9999',
    targetPrice,
    direction: state.selectedDirection,
    enabled: els.alertEnabled.checked,
    cooldownSeconds: 1800,
  };

  const currentRule = state.rules.find((item) => item.symbol === 'AU9999');
  const path = currentRule ? `/api/alerts/rules/${currentRule.id}` : '/api/alerts/rules';
  const method = currentRule ? 'PATCH' : 'POST';

  try {
    await fetchJson(path, {
      method,
      body: JSON.stringify(body),
    });
    await refreshAll();
    els.alertStatus.textContent = '提醒已保存';
  } catch (error) {
    els.alertStatus.textContent = error.message;
  }
}

document.querySelectorAll('.range-tab').forEach((button) => {
  button.addEventListener('click', () => {
    state.selectedRange = button.dataset.range;
    document.querySelectorAll('.range-tab').forEach((item) => {
      item.classList.toggle('active', item === button);
    });
    refreshAll();
  });
});

document.querySelectorAll('.segment').forEach((button) => {
  button.addEventListener('click', () => {
    state.selectedDirection = button.dataset.direction;
    document.querySelectorAll('.segment').forEach((item) => {
      item.classList.toggle('active', item === button);
    });
  });
});

els.saveAlertButton.addEventListener('click', saveAlertRule);
els.pinButton.addEventListener('click', async () => {
  state.pinned = !state.pinned;
  const actual = await window.goldDesktop?.setAlwaysOnTop(state.pinned);
  els.pinButton.classList.toggle('active', Boolean(actual));
});
els.minimizeButton.addEventListener('click', () => window.goldDesktop?.minimize());
els.closeButton.addEventListener('click', () => window.goldDesktop?.close());

window.addEventListener('resize', drawChart);

refreshAll();
pollAlertEvents();
setInterval(refreshAll, 5000);
setInterval(pollAlertEvents, 5000);
