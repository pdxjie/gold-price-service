const apiBase = window.goldDesktop?.apiBase || 'http://localhost:3001';

const els = {
  alertEnabled: document.getElementById('alertEnabled'),
  highAlertPriceInput: document.getElementById('highAlertPriceInput'),
  lowAlertPriceInput: document.getElementById('lowAlertPriceInput'),
  saveAlertButton: document.getElementById('saveAlertButton'),
  alertStatus: document.getElementById('alertStatus'),
  minimizeButton: document.getElementById('settingsMinimizeButton'),
  closeButton: document.getElementById('settingsCloseButton'),
  feishuEnabled: document.getElementById('feishuEnabled'),
  feishuWebhook: document.getElementById('feishuWebhook'),
  feishuSecret: document.getElementById('feishuSecret'),
  feishuWebhookHint: document.getElementById('feishuWebhookHint'),
  feishuSecretHint: document.getElementById('feishuSecretHint'),
  saveFeishuButton: document.getElementById('saveFeishuButton'),
  testFeishuButton: document.getElementById('testFeishuButton'),
  clearFeishuButton: document.getElementById('clearFeishuButton'),
  feishuStatus: document.getElementById('feishuStatus'),
  wecomEnabled: document.getElementById('wecomEnabled'),
  wecomWebhook: document.getElementById('wecomWebhook'),
  wecomWebhookHint: document.getElementById('wecomWebhookHint'),
  saveWecomButton: document.getElementById('saveWecomButton'),
  testWecomButton: document.getElementById('testWecomButton'),
  clearWecomButton: document.getElementById('clearWecomButton'),
  wecomStatus: document.getElementById('wecomStatus'),
};

let feishuWebhookConfigured = false;
let feishuSecretConfigured = false;
let clearFeishuWebhook = false;
let clearFeishuSecret = false;
let clearWecomWebhook = false;

function formatPrice(value) {
  return Number(value).toFixed(2);
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || payload.code >= 400) {
    throw new Error(payload.message || '接口请求失败');
  }
  return payload.data;
}

function renderRules(rules) {
  const alertRules = (rules || []).filter((item) => item.symbol === 'AU9999');
  const highRule = alertRules.find((item) => item.direction === 'above');
  const lowRule = alertRules.find((item) => item.direction === 'below');

  els.alertEnabled.checked = alertRules.length === 0 || alertRules.some((item) => item.enabled);
  els.highAlertPriceInput.value = highRule ? formatPrice(highRule.targetPrice) : '';
  els.lowAlertPriceInput.value = lowRule ? formatPrice(lowRule.targetPrice) : '';

  const status = [];
  if (highRule) status.push(`高价 ${formatPrice(highRule.targetPrice)} 元/克`);
  if (lowRule) status.push(`低价 ${formatPrice(lowRule.targetPrice)} 元/克`);
  els.alertStatus.textContent = status.length ? `${status.join('，')}提醒已设置` : '未设置提醒';
}

async function loadRules() {
  try {
    renderRules(await fetchJson('/api/alerts/rules'));
  } catch (error) {
    els.alertStatus.textContent = error.message;
  }
}

function renderFeishuSettings(settings) {
  feishuWebhookConfigured = Boolean(settings.webhookConfigured);
  feishuSecretConfigured = Boolean(settings.secretConfigured);
  clearFeishuWebhook = false;
  clearFeishuSecret = false;
  els.feishuEnabled.checked = settings.enabled === true;
  els.feishuWebhook.value = '';
  els.feishuSecret.value = '';
  els.feishuWebhook.placeholder = settings.webhookPreview
    ? `已配置：${settings.webhookPreview}，留空则保持不变`
    : '粘贴飞书群机器人 Webhook';
  els.feishuWebhookHint.textContent = settings.webhookConfigured ? '已配置，输入新地址可替换' : '未配置';
  els.feishuSecretHint.textContent = settings.secretConfigured ? '已配置，输入新密钥可替换' : '未配置';
  els.feishuStatus.textContent = settings.lastError
    ? `上次发送失败：${settings.lastError}`
    : settings.lastSentAt
      ? `上次发送：${settings.lastSentAt}`
      : '尚未发送消息';
}

function clearPendingRemovalWhenTyping() {
  if (els.feishuWebhook.value.trim()) {
    clearFeishuWebhook = false;
  }
  if (els.feishuSecret.value.trim()) {
    clearFeishuSecret = false;
  }
}

async function loadFeishuSettings() {
  try {
    renderFeishuSettings(await fetchJson('/api/notifications/feishu'));
  } catch (error) {
    els.feishuStatus.textContent = error.message;
  }
}

async function saveFeishuSettings() {
  els.saveFeishuButton.disabled = true;
  els.feishuStatus.textContent = '正在保存…';
  try {
    const body = {
      enabled: els.feishuEnabled.checked,
      ...(els.feishuWebhook.value.trim() ? { webhook: els.feishuWebhook.value.trim() } : {}),
      ...(els.feishuSecret.value.trim() ? { secret: els.feishuSecret.value.trim() } : {}),
      ...(clearFeishuWebhook ? { clearWebhook: true } : {}),
      ...(clearFeishuSecret ? { clearSecret: true } : {}),
    };
    renderFeishuSettings(await fetchJson('/api/notifications/feishu', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }));
    els.feishuStatus.textContent = '飞书设置已保存';
    return true;
  } catch (error) {
    els.feishuStatus.textContent = error.message;
    return false;
  } finally {
    els.saveFeishuButton.disabled = false;
  }
}

async function testFeishuSettings() {
  els.testFeishuButton.disabled = true;
  els.feishuStatus.textContent = '正在发送测试消息…';
  try {
    const saved = await saveFeishuSettings();
    if (!saved) {
      return;
    }
    const result = await fetchJson('/api/notifications/feishu/test', { method: 'POST' });
    els.feishuStatus.textContent = `测试消息已发送：${result.sentAt}`;
    await loadFeishuSettings();
    els.feishuStatus.textContent = `测试消息已发送：${result.sentAt}`;
  } catch (error) {
    els.feishuStatus.textContent = error.message;
  } finally {
    els.testFeishuButton.disabled = false;
  }
}

function clearFeishuSettings() {
  els.feishuEnabled.checked = false;
  els.feishuWebhook.value = '';
  els.feishuSecret.value = '';
  clearFeishuWebhook = true;
  clearFeishuSecret = true;
  els.feishuWebhookHint.textContent = '将清除 Webhook';
  els.feishuSecretHint.textContent = '将清除签名密钥';
  els.feishuStatus.textContent = '点击保存后清除飞书配置';
}

function renderWecomSettings(settings) {
  clearWecomWebhook = false;
  els.wecomEnabled.checked = settings.enabled === true;
  els.wecomWebhook.value = '';
  els.wecomWebhook.placeholder = settings.webhookPreview
    ? `已配置：${settings.webhookPreview}，留空则保持不变`
    : '粘贴企业微信群机器人 Webhook';
  els.wecomWebhookHint.textContent = settings.webhookConfigured ? '已配置，输入新地址可替换' : '未配置';
  els.wecomStatus.textContent = settings.lastError
    ? `上次发送失败：${settings.lastError}`
    : settings.lastSentAt
      ? `上次发送：${settings.lastSentAt}`
      : '尚未发送消息';
}

async function loadWecomSettings() {
  try {
    renderWecomSettings(await fetchJson('/api/notifications/wecom'));
  } catch (error) {
    els.wecomStatus.textContent = error.message;
  }
}

async function saveWecomSettings() {
  els.saveWecomButton.disabled = true;
  els.wecomStatus.textContent = '正在保存…';
  try {
    const body = {
      enabled: els.wecomEnabled.checked,
      ...(els.wecomWebhook.value.trim() ? { webhook: els.wecomWebhook.value.trim() } : {}),
      ...(clearWecomWebhook ? { clearWebhook: true } : {}),
    };
    renderWecomSettings(await fetchJson('/api/notifications/wecom', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }));
    els.wecomStatus.textContent = '企业微信设置已保存';
    return true;
  } catch (error) {
    els.wecomStatus.textContent = error.message;
    return false;
  } finally {
    els.saveWecomButton.disabled = false;
  }
}

async function testWecomSettings() {
  els.testWecomButton.disabled = true;
  els.wecomStatus.textContent = '正在发送测试消息…';
  try {
    const saved = await saveWecomSettings();
    if (!saved) return;
    const result = await fetchJson('/api/notifications/wecom/test', { method: 'POST' });
    els.wecomStatus.textContent = `测试消息已发送：${result.sentAt}`;
    await loadWecomSettings();
    els.wecomStatus.textContent = `测试消息已发送：${result.sentAt}`;
  } catch (error) {
    els.wecomStatus.textContent = error.message;
  } finally {
    els.testWecomButton.disabled = false;
  }
}

function clearWecomSettings() {
  els.wecomEnabled.checked = false;
  els.wecomWebhook.value = '';
  clearWecomWebhook = true;
  els.wecomWebhookHint.textContent = '将清除 Webhook';
  els.wecomStatus.textContent = '点击保存后清除企业微信配置';
}

function clearWecomPendingRemovalWhenTyping() {
  if (els.wecomWebhook.value.trim()) clearWecomWebhook = false;
}

function setNotificationTab(tabName) {
  document.querySelectorAll('.notification-tab').forEach((tab) => {
    const active = tab.dataset.notificationTab === tabName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.notification-panel').forEach((panel) => {
    panel.hidden = panel.id !== `${tabName}Panel`;
  });
}

async function saveAlertRules() {
  els.saveAlertButton.disabled = true;
  els.alertStatus.textContent = '正在保存…';
  try {
    const thresholds = [
      { direction: 'above', input: els.highAlertPriceInput, label: '高价' },
      { direction: 'below', input: els.lowAlertPriceInput, label: '低价' },
    ];
    const currentRules = (await fetchJson('/api/alerts/rules')).filter((item) => item.symbol === 'AU9999');
    const requests = [];

    for (const threshold of thresholds) {
      const rawValue = threshold.input.value.trim();
      const currentRule = currentRules.find((item) => item.direction === threshold.direction);
      if (!rawValue) {
        if (currentRule) requests.push(fetchJson(`/api/alerts/rules/${currentRule.id}`, { method: 'DELETE' }));
        continue;
      }

      const targetPrice = Number(rawValue);
      if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
        els.alertStatus.textContent = `${threshold.label}提醒请输入有效金额`;
        threshold.input.focus();
        return;
      }

      const body = JSON.stringify({
        symbol: 'AU9999',
        targetPrice,
        direction: threshold.direction,
        enabled: els.alertEnabled.checked,
        cooldownSeconds: 0,
      });
      const path = currentRule ? `/api/alerts/rules/${currentRule.id}` : '/api/alerts/rules';
      requests.push(fetchJson(path, { method: currentRule ? 'PATCH' : 'POST', body }));
    }

    await Promise.all(requests);
    await loadRules();
    els.alertStatus.textContent = '提醒已保存';
  } catch (error) {
    els.alertStatus.textContent = error.message;
  } finally {
    els.saveAlertButton.disabled = false;
  }
}

els.saveAlertButton.addEventListener('click', saveAlertRules);
els.minimizeButton.addEventListener('click', () => window.goldDesktop?.minimize());
els.closeButton.addEventListener('click', () => window.goldDesktop?.close());
els.saveFeishuButton.addEventListener('click', saveFeishuSettings);
els.testFeishuButton.addEventListener('click', testFeishuSettings);
els.clearFeishuButton.addEventListener('click', clearFeishuSettings);
els.feishuWebhook.addEventListener('input', clearPendingRemovalWhenTyping);
els.feishuSecret.addEventListener('input', clearPendingRemovalWhenTyping);
els.saveWecomButton.addEventListener('click', saveWecomSettings);
els.testWecomButton.addEventListener('click', testWecomSettings);
els.clearWecomButton.addEventListener('click', clearWecomSettings);
els.wecomWebhook.addEventListener('input', clearWecomPendingRemovalWhenTyping);
document.querySelectorAll('.notification-tab').forEach((tab) => {
  tab.addEventListener('click', () => setNotificationTab(tab.dataset.notificationTab));
});
loadRules();
loadFeishuSettings();
loadWecomSettings();
