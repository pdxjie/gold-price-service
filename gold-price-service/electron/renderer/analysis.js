const apiBase = window.goldDesktop?.apiBase || 'http://localhost:3001';

const els = {
  startButton: document.getElementById('analysisStartButton'),
  historyButton: document.getElementById('analysisHistoryButton'),
  exportButton: document.getElementById('analysisExportButton'),
  minimizeButton: document.getElementById('analysisMinimizeButton'),
  closeButton: document.getElementById('analysisCloseButton'),
  status: document.getElementById('analysisStatus'),
  body: document.getElementById('analysisBody'),
  empty: document.getElementById('analysisEmpty'),
  historyPanel: document.getElementById('historyPanel'),
  historyList: document.getElementById('historyList'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  loadingText: document.getElementById('loadingText'),
};

let analyzing = false;
let reportText = '';

async function fetchJson(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code >= 400) {
    throw new Error(payload.message || `请求失败（${response.status}）`);
  }
  return payload.data;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderMarkdown(markdown) {
  const lines = String(markdown || '').split('\n');
  let html = '';
  let inTable = false;
  let inCode = false;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');

    if (line.trim().startsWith('```')) {
      inCode = !inCode;
      html += inCode ? '<pre>' : '</pre>';
      continue;
    }
    if (inCode) {
      html += `${escapeHtml(line)}\n`;
      continue;
    }

    if (line.trim().startsWith('|')) {
      if (!inTable) {
        inTable = true;
        html += '<table>';
      }
      const cells = line.trim().split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) {
        continue;
      }
      html += `<tr>${cells.map((c) => `<td>${inlineMarkdown(c)}</td>`).join('')}</tr>`;
      continue;
    }
    if (inTable) {
      inTable = false;
      html += '</table>';
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html += `<h${level}>${inlineMarkdown(heading[2])}</h${level}>`;
      continue;
    }

    if (/^-{3,}$/.test(line.trim())) {
      html += '<hr>';
      continue;
    }

    if (line.trim().startsWith('>')) {
      html += `<blockquote>${inlineMarkdown(line.trim().slice(1).trim())}</blockquote>`;
      continue;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      html += `<div class="md-li"><span>•</span><div>${inlineMarkdown(line.trim().replace(/^[-*]\s+/, ''))}</div></div>`;
      continue;
    }

    if (/^\d+\.\s+/.test(line.trim())) {
      const num = line.trim().match(/^(\d+)\./)[1];
      html += `<div class="md-li"><span>${num}.</span><div>${inlineMarkdown(line.trim().replace(/^\d+\.\s+/, ''))}</div></div>`;
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    html += `<p>${inlineMarkdown(line)}</p>`;
  }

  if (inTable) {
    html += '</table>';
  }
  if (inCode) {
    html += '</pre>';
  }
  return html;
}

function render() {
  els.body.innerHTML = reportText
    ? renderMarkdown(reportText)
    : '<div class="analysis-empty">点击上方「开始分析」，AI 将结合实时行情、消息面、金友圈观点与你的持仓生成短线分析报告（含建议与风险预警）。</div>';
  els.body.scrollTop = els.body.scrollHeight;
}

function showLoading() {
  els.loadingOverlay.hidden = false;
}

function hideLoading() {
  els.loadingOverlay.hidden = true;
}

function setLoadingText(text) {
  els.loadingText.textContent = text;
}

function handleSseEvent(event, payload) {
  if (event === 'stage') {
    const message = payload.message || '';
    els.status.textContent = message;
    setLoadingText(message);
  } else if (event === 'delta') {
    if (!els.loadingOverlay.hidden) {
      hideLoading();
    }
    reportText += payload.text || '';
    render();
  } else if (event === 'done') {
    els.status.textContent = '分析完成';
  } else if (event === 'error') {
    els.status.textContent = `分析失败：${payload.message}`;
  }
}

function formatRecordTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

async function loadHistory() {
  const records = await fetchJson('/api/ai/analysis/records');
  if (!records || records.length === 0) {
    els.historyList.innerHTML = '<div class="history-empty">暂无分析记录</div>';
  } else {
    els.historyList.replaceChildren(...records.map((record) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'history-item';
      const title = document.createElement('span');
      title.className = 'history-item-title';
      title.textContent = record.title || 'AI 分析';
      const time = document.createElement('span');
      time.className = 'history-item-time';
      time.textContent = formatRecordTime(record.createdAt);
      item.append(title, time);
      item.addEventListener('click', () => showRecord(record.id));
      return item;
    }));
  }
  els.historyPanel.hidden = false;
}

async function showRecord(id) {
  try {
    const record = await fetchJson(`/api/ai/analysis/records/${id}`);
    reportText = record.content || '';
    els.status.textContent = `历史记录：${record.title || 'AI 分析'}`;
    els.historyPanel.hidden = true;
    render();
  } catch (error) {
    els.status.textContent = `加载记录失败：${error?.message || String(error)}`;
  }
}

async function startAnalysis() {
  if (analyzing) {
    return;
  }
  analyzing = true;
  els.startButton.disabled = true;
  els.startButton.textContent = '分析中…';
  reportText = '';
  els.historyPanel.hidden = true;
  els.status.textContent = '正在抓取金友圈观点…';
  setLoadingText('正在抓取金友圈观点…');
  showLoading();
  render();

  let jdPost = null;
  try {
    jdPost = await window.goldDesktop?.fetchJdPost();
  } catch (error) {
    jdPost = { status: 'error', error: error?.message || String(error) };
  }

  let holdings = {};
  try {
    holdings = JSON.parse(localStorage.getItem('goldHoldingSettings') || '{}');
  } catch {
    holdings = {};
  }

  setLoadingText('正在联网分析（通常 30-90 秒）…');

  try {
    const response = await fetch(`${apiBase}/api/ai/analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jdPost, holdings }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || `请求失败（${response.status}）`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('响应不可读');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        let event = 'message';
        let data = '';
        for (const line of chunk.split('\n')) {
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            data += line.slice(5).trim();
          }
        }
        if (!data) {
          continue;
        }
        try {
          handleSseEvent(event, JSON.parse(data));
        } catch {
          // 忽略无法解析的事件
        }
      }
    }
  } catch (error) {
    els.status.textContent = `分析失败：${error?.message || String(error)}`;
    if (!reportText) {
      els.body.innerHTML = `<div class="analysis-empty">分析失败：${escapeHtml(error?.message || String(error))}</div>`;
    }
  } finally {
    analyzing = false;
    els.startButton.disabled = false;
    els.startButton.textContent = '重新分析';
    hideLoading();
  }
}

els.startButton.addEventListener('click', startAnalysis);
els.minimizeButton.addEventListener('click', () => window.goldDesktop?.minimize());
els.closeButton.addEventListener('click', () => window.goldDesktop?.close());
els.historyButton.addEventListener('click', () => {
  if (!els.historyPanel.hidden) {
    els.historyPanel.hidden = true;
    return;
  }
  loadHistory().catch((error) => {
    els.status.textContent = `加载记录失败：${error?.message || String(error)}`;
  });
});

// 接续进行中的分析：打开窗口时若后端分析仍在跑，则显示 loading 并禁用重复触发
let resuming = false;

function enterResumeMode() {
  if (resuming || analyzing) {
    return;
  }
  resuming = true;
  analyzing = true;
  els.startButton.disabled = true;
  els.startButton.textContent = '分析中…';
  els.status.textContent = 'AI 分析进行中，完成后将自动加载结果…';
  setLoadingText('AI 分析进行中…');
  showLoading();

  const poll = async () => {
    try {
      const status = await fetchJson('/api/ai/analysis/status');
      if (!status?.running) {
        resuming = false;
        analyzing = false;
        els.startButton.disabled = false;
        els.startButton.textContent = '重新分析';
        hideLoading();
        els.status.textContent = '分析完成，正在加载结果…';
        await loadLatestRecord();
        return;
      }
    } catch {
      // 忽略轮询失败
    }
    setTimeout(poll, 3000);
  };
  setTimeout(poll, 3000);
}

async function loadLatestRecord() {
  try {
    const records = await fetchJson('/api/ai/analysis/records');
    if (records && records.length > 0) {
      await showRecord(records[0].id);
    } else {
      els.status.textContent = '分析完成，但暂无可查看记录';
    }
  } catch {
    els.status.textContent = '分析完成';
  }
}

async function checkResumeStatus() {
  try {
    const status = await fetchJson('/api/ai/analysis/status');
    if (status?.running) {
      enterResumeMode();
    }
  } catch {
    // 忽略
  }
}

async function exportImage() {
  if (!reportText) {
    els.status.textContent = '暂无内容可导出，请先分析或选择历史记录';
    return;
  }
  els.exportButton.disabled = true;
  els.status.textContent = '正在生成图片…';
  setLoadingText('正在生成图片…');
  showLoading();
  let container = null;
  try {
    container = document.createElement('div');
    container.className = 'export-container';
    container.style.position = 'absolute';
    container.style.left = '0';
    container.style.top = '0';

    const title = document.createElement('div');
    title.className = 'export-title';
    title.textContent = '金脉 · AI 积存金分析';

    const body = document.createElement('div');
    body.className = 'export-md';
    body.innerHTML = renderMarkdown(reportText);

    const footer = document.createElement('div');
    footer.className = 'export-footer';
    footer.textContent = `生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })} · 仅供参考，不构成投资建议`;

    container.append(title, body, footer);
    document.body.appendChild(container);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const dataUrl = await window.htmlToImage.toPng(container, {
      pixelRatio: 2,
      width: container.scrollWidth,
      height: container.scrollHeight,
      backgroundColor: '#ffffff',
    });

    const result = await window.goldDesktop?.exportImage(dataUrl, `jinmai-analysis-${Date.now()}.png`);
    if (result?.canceled) {
      els.status.textContent = '已取消导出';
    } else if (result?.filePath) {
      els.status.textContent = `图片已导出：${result.filePath}`;
    } else if (result?.error) {
      els.status.textContent = `导出失败：${result.error}`;
    } else {
      els.status.textContent = '图片已导出';
    }
  } catch (error) {
    els.status.textContent = `导出失败：${error?.message || String(error)}`;
  } finally {
    if (container) {
      container.remove();
    }
    hideLoading();
    els.exportButton.disabled = false;
  }
}

els.exportButton.addEventListener('click', exportImage);

checkResumeStatus();
