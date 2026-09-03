const apiBase = window.goldDesktop?.apiBase || 'http://localhost:3001';

const els = {
  alertEnabled: document.getElementById('alertEnabled'),
  highAlertPriceInput: document.getElementById('highAlertPriceInput'),
  lowAlertPriceInput: document.getElementById('lowAlertPriceInput'),
  alertCooldownSelect: document.getElementById('alertCooldownSelect'),
  alertCooldownHint: document.getElementById('alertCooldownHint'),
  saveAlertButton: document.getElementById('saveAlertButton'),
  alertStatus: document.getElementById('alertStatus'),
  testAlertButton: document.getElementById('testAlertButton'),
  simulateAlertButton: document.getElementById('simulateAlertButton'),
  alertHistory: document.getElementById('alertHistory'),
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
  exportJsonButton: document.getElementById('exportJsonButton'),
  exportCsvButton: document.getElementById('exportCsvButton'),
  exportXlsxButton: document.getElementById('exportXlsxButton'),
  importDataButton: document.getElementById('importDataButton'),
  backupStatus: document.getElementById('backupStatus'),
  llmConfigList: document.getElementById('llmConfigList'),
  addLlmButton: document.getElementById('addLlmButton'),
  llmForm: document.getElementById('llmForm'),
  llmFormTitle: document.getElementById('llmFormTitle'),
  llmName: document.getElementById('llmName'),
  llmBaseUrl: document.getElementById('llmBaseUrl'),
  llmApiKey: document.getElementById('llmApiKey'),
  llmApiKeyHint: document.getElementById('llmApiKeyHint'),
  llmModel: document.getElementById('llmModel'),
  llmSaveButton: document.getElementById('llmSaveButton'),
  llmCancelButton: document.getElementById('llmCancelButton'),
  llmStatus: document.getElementById('llmStatus'),
};

let feishuWebhookConfigured = false;
let feishuSecretConfigured = false;
let clearFeishuWebhook = false;
let clearFeishuSecret = false;
let clearWecomWebhook = false;

function formatPrice(value) {
  return Number(value).toFixed(2);
}

function formatBeijingTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replaceAll('/', '-');
}

function updateCooldownHint() {
  const descriptions = {
    '0': '仅首次穿越提醒，价格回到正常区间后自动复位。',
    '1800': '同一价格方向在 30 分钟内只提醒一次，期间再次穿越不会重复推送。',
    '3600': '同一价格方向在 1 小时内只提醒一次，期间再次穿越不会重复推送。',
    '86400': '同一价格方向在 1 天内只提醒一次，期间再次穿越不会重复推送。',
  };
  els.alertCooldownHint.textContent = descriptions[els.alertCooldownSelect.value] || descriptions['0'];
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
  const symbol = 'AU9999';
  const alertRules = (rules || []).filter((item) => item.symbol === symbol);
  const highRule = alertRules.find((item) => item.direction === 'above');
  const lowRule = alertRules.find((item) => item.direction === 'below');

  els.alertEnabled.checked = alertRules.length === 0 || alertRules.some((item) => item.enabled);
  els.highAlertPriceInput.value = highRule ? formatPrice(highRule.targetPrice) : '';
  els.lowAlertPriceInput.value = lowRule ? formatPrice(lowRule.targetPrice) : '';
  const selection = JSON.parse(localStorage.getItem('alertSelection') || '{}');
  els.alertCooldownSelect.value = String(highRule?.cooldownSeconds ?? lowRule?.cooldownSeconds ?? selection.cooldownSeconds ?? 0);

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

async function loadAlertHistory() {
  try {
    const events = await fetchJson('/api/alerts/events?limit=8&latest=true');
    els.alertHistory.replaceChildren(...(events.length ? events.map((event) => {
      const item = document.createElement('div');
      item.className = 'alert-history-item';
       item.innerHTML = `<strong>${event.message}</strong><small>${formatBeijingTime(event.triggeredAt)}</small>`;
      return item;
    }) : [Object.assign(document.createElement('span'), { className: 'empty-state', textContent: '暂无通知记录' })]));
  } catch (error) {
    els.alertHistory.textContent = error.message;
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
       ? `上次发送：${formatBeijingTime(settings.lastSentAt)}`
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
       ? `上次发送：${formatBeijingTime(settings.lastSentAt)}`
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
    const symbol = 'AU9999';
    const cooldownSeconds = Number(els.alertCooldownSelect.value);
    localStorage.setItem('alertSelection', JSON.stringify({ symbol, cooldownSeconds }));
    const currentRules = (await fetchJson('/api/alerts/rules')).filter((item) => item.symbol === symbol);
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
        symbol,
        targetPrice,
        direction: threshold.direction,
        enabled: els.alertEnabled.checked,
        cooldownSeconds,
      });
      const path = currentRule ? `/api/alerts/rules/${currentRule.id}` : '/api/alerts/rules';
      requests.push(fetchJson(path, { method: currentRule ? 'PATCH' : 'POST', body }));
    }

    await Promise.all(requests);
    await loadRules();
    await loadAlertHistory();
    els.alertStatus.textContent = '提醒已保存';
  } catch (error) {
    els.alertStatus.textContent = error.message;
  } finally {
    els.saveAlertButton.disabled = false;
  }
}

function readAppearance() {
  return {
    theme: 'system',
    collapsedDisplay: 'assets',
    collapsedSize: 'normal',
    radius: 20,
    opacity: 92,
    animationEnabled: true,
    desktopNotificationEnabled: true,
  };
}

async function exportData(format) {
  els.backupStatus.textContent = '正在导出…';
  try {
    const rules = await fetchJson('/api/alerts/rules');
    const holdings = JSON.parse(localStorage.getItem('goldHoldingSettings') || '{}');
    const result = await window.goldDesktop?.exportData({ format, holdings, rules, appearance: readAppearance() });
    els.backupStatus.textContent = result?.canceled ? '已取消导出' : `已导出：${result?.filePath || '完成'}`;
  } catch (error) { els.backupStatus.textContent = `导出失败：${error.message}`; }
}

async function importData() {
  els.backupStatus.textContent = '请选择备份文件…';
  try {
    const result = await window.goldDesktop?.importData();
    if (!result || result.canceled) { els.backupStatus.textContent = '已取消导入'; return; }
    if (result.data?.holdings) localStorage.setItem('goldHoldingSettings', JSON.stringify(result.data.holdings));
    for (const rule of result.data?.rules || []) {
      const body = { symbol: rule.symbol, targetPrice: Number(rule.targetPrice), direction: rule.direction, enabled: Boolean(rule.enabled), cooldownSeconds: Number(rule.cooldownSeconds) || 0 };
      if (body.symbol && body.targetPrice > 0) await fetchJson('/api/alerts/rules', { method: 'POST', body: JSON.stringify(body) });
    }
    await loadRules(); await loadAlertHistory();
    els.backupStatus.textContent = '导入完成，重新打开主窗口后资产设置生效';
  } catch (error) { els.backupStatus.textContent = `导入失败：${error.message}`; }
}

async function testAlert() {
  els.testAlertButton.disabled = true;
  try {
    const target = Number(els.highAlertPriceInput.value || els.lowAlertPriceInput.value || 980);
    const direction = els.highAlertPriceInput.value ? 'above' : 'below';
    const symbol = 'AU9999';
    const result = await fetchJson('/api/alerts/test', { method: 'POST', body: JSON.stringify({ symbol, price: target, targetPrice: target, direction, message: `实时金价突破测试阈值 ${formatPrice(target)} 元/克` }) });
    await window.goldDesktop?.notify('金脉提醒测试', result.message);
    els.alertStatus.textContent = '测试提醒已发送';
  } catch (error) { els.alertStatus.textContent = `测试失败：${error.message}`; }
  finally { els.testAlertButton.disabled = false; }
}

async function simulateAlert() {
  els.simulateAlertButton.disabled = true;
  els.simulateAlertButton.textContent = '演示中…';
  try {
    const result = await fetchJson('/api/alerts/simulation/start', {
      method: 'POST',
      body: JSON.stringify({
        highTarget: Number(els.highAlertPriceInput.value),
        lowTarget: Number(els.lowAlertPriceInput.value),
      }),
    });
    els.alertStatus.textContent = `动态行情演示已开始，价格将临时波动 ${result.durationSeconds ?? 30} 秒`;
    window.setTimeout(() => {
      els.simulateAlertButton.disabled = false;
      els.simulateAlertButton.textContent = '动态演示';
    }, 31000);
  } catch (error) {
    els.alertStatus.textContent = `动态演示失败：${error.message}`;
    els.simulateAlertButton.disabled = false;
    els.simulateAlertButton.textContent = '动态演示';
  }
}

els.saveAlertButton.addEventListener('click', saveAlertRules);
els.alertCooldownSelect.addEventListener('change', updateCooldownHint);
els.testAlertButton.addEventListener('click', testAlert);
els.simulateAlertButton.addEventListener('click', simulateAlert);
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
els.exportJsonButton.addEventListener('click', () => exportData('json'));
els.exportCsvButton.addEventListener('click', () => exportData('csv'));
els.exportXlsxButton.addEventListener('click', () => exportData('xlsx'));
els.importDataButton.addEventListener('click', importData);
// ===== 大模型配置 =====
let editingLlmId = null;
let llmConfigs = [];

async function loadLlmConfigs() {
  try {
    llmConfigs = await fetchJson('/api/llm/configs');
    renderLlmConfigs();
  } catch (error) {
    els.llmStatus.textContent = error.message;
  }
}

function renderLlmConfigs() {
  if (llmConfigs.length === 0) {
    els.llmConfigList.replaceChildren();
    els.llmStatus.textContent = '尚未配置模型，点击下方按钮添加';
    return;
  }

  els.llmConfigList.replaceChildren(...llmConfigs.map((config) => {
    const item = document.createElement('div');
    item.className = 'llm-config-item';

    const main = document.createElement('div');
    main.className = 'llm-config-main';

    const name = document.createElement('div');
    name.className = 'llm-config-name';
    name.textContent = config.name || config.model;
    if (config.isDefault) {
      const badge = document.createElement('span');
      badge.className = 'llm-badge';
      badge.textContent = '默认';
      name.append(badge);
    }

    const model = document.createElement('div');
    model.className = 'llm-config-model';
    model.textContent = `${config.model} · ${config.baseUrl}`;

    main.append(name, model);

    const actions = document.createElement('div');
    actions.className = 'llm-config-actions';
    actions.append(
      llmActionButton('测试', () => testLlmConfig(config.id)),
      llmActionButton('默认', () => setDefaultLlmConfig(config.id)),
      llmActionButton('编辑', () => showLlmForm(config)),
      llmActionButton('删除', () => deleteLlmConfig(config.id), true),
    );

    item.append(main, actions);
    return item;
  }));

  els.llmStatus.textContent = `已配置 ${llmConfigs.length} 个模型`;
}

function llmActionButton(label, onClick, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `llm-action-button${danger ? ' danger' : ''}`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function showLlmForm(config = null) {
  editingLlmId = config ? config.id : null;
  els.llmFormTitle.textContent = config ? '编辑模型' : '添加模型';
  els.llmName.value = config ? config.name : '';
  els.llmBaseUrl.value = config ? config.baseUrl : 'https://api.deepseek.com';
  els.llmModel.value = config ? config.model : 'deepseek-v4-pro';
  els.llmApiKey.value = '';
  els.llmApiKeyHint.textContent = config && config.apiKeyConfigured
    ? `已配置：${config.apiKey}，留空则保持不变`
    : '密钥仅保存在本地';
  els.llmForm.hidden = false;
  els.addLlmButton.hidden = true;
  els.llmName.focus();
}

function hideLlmForm() {
  els.llmForm.hidden = true;
  els.addLlmButton.hidden = false;
  editingLlmId = null;
}

async function saveLlmConfig() {
  els.llmSaveButton.disabled = true;
  els.llmStatus.textContent = '正在保存…';
  try {
    const body = {
      name: els.llmName.value.trim(),
      baseUrl: els.llmBaseUrl.value.trim(),
      model: els.llmModel.value.trim(),
      ...(els.llmApiKey.value.trim() ? { apiKey: els.llmApiKey.value.trim() } : {}),
    };
    if (editingLlmId) {
      await fetchJson(`/api/llm/configs/${editingLlmId}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      await fetchJson('/api/llm/configs', { method: 'POST', body: JSON.stringify(body) });
    }
    els.llmStatus.textContent = '模型已保存';
    hideLlmForm();
    await loadLlmConfigs();
  } catch (error) {
    els.llmStatus.textContent = error.message;
  } finally {
    els.llmSaveButton.disabled = false;
  }
}

async function deleteLlmConfig(id) {
  try {
    await fetchJson(`/api/llm/configs/${id}`, { method: 'DELETE' });
    els.llmStatus.textContent = '已删除';
    if (editingLlmId === id) {
      hideLlmForm();
    }
    await loadLlmConfigs();
  } catch (error) {
    els.llmStatus.textContent = error.message;
  }
}

async function setDefaultLlmConfig(id) {
  try {
    await fetchJson(`/api/llm/configs/${id}/default`, { method: 'POST' });
    els.llmStatus.textContent = '已设为默认';
    await loadLlmConfigs();
  } catch (error) {
    els.llmStatus.textContent = error.message;
  }
}

async function testLlmConfig(id) {
  els.llmStatus.textContent = '正在测试连接…';
  try {
    const result = await fetchJson('/api/llm/test', { method: 'POST', body: JSON.stringify({ configId: id }) });
    els.llmStatus.textContent = `连接成功（${result.elapsedMs}ms）：${result.reply}`;
  } catch (error) {
    els.llmStatus.textContent = `连接失败：${error.message}`;
  }
}

els.addLlmButton.addEventListener('click', () => showLlmForm());
els.llmCancelButton.addEventListener('click', hideLlmForm);
els.llmSaveButton.addEventListener('click', saveLlmConfig);
loadLlmConfigs();

loadRules();
loadAlertHistory();
updateCooldownHint();
loadFeishuSettings();
loadWecomSettings();
