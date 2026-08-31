const { app, BrowserWindow, dialog, ipcMain, Notification, screen, Tray, Menu, globalShortcut } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BACKEND_PORT = Number(process.env.GOLD_DESKTOP_PORT || 3001);
const API_BASE = `http://localhost:${BACKEND_PORT}`;

let mainWindow = null;
let settingsWindow = null;
let backendProcess = null;
let backendStartedByUs = false;
let tray = null;
let isQuitting = false;
const expandedWindowSize = [420, 850];
const collapsedWindowSize = [260, 124];
const settingsWindowSize = [420, 1040];
let windowCollapsed = false;
let mainWindowFloatingEnabled = true;
const dragSessions = new Map();
const allWorkspaceWindows = new WeakSet();

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  });
}

const collapsedSizes = {
  compact: [236, 96],
  normal: [260, 124],
  wide: [320, 124],
};

function moveWindowFromDrag(session, pointerX, pointerY) {
  if (!session || session.window.isDestroyed()) {
    return;
  }

  if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) {
    return;
  }

  const nextX = session.windowX + Math.round(pointerX - session.pointerX);
  const nextY = session.windowY + Math.round(pointerY - session.pointerY);
  if (nextX === session.lastWindowX && nextY === session.lastWindowY) {
    return;
  }

  session.lastWindowX = nextX;
  session.lastWindowY = nextY;
  session.window.setPosition(nextX, nextY, false);
}

function endWindowDrag(sender) {
  const session = dragSessions.get(sender);
  if (session?.cursorTimer) {
    clearInterval(session.cursorTimer);
  }
  dragSessions.delete(sender);
}

function keepWindowVisible() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) {
    return;
  }

  const bounds = mainWindow.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const visibleMargin = 28;
  const titlebarHeight = Math.min(36, bounds.height);
  const minX = workArea.x - bounds.width + visibleMargin;
  const maxX = workArea.x + workArea.width - visibleMargin;
  const minY = workArea.y;
  const maxY = workArea.y + workArea.height - titlebarHeight;
  const nextX = Math.min(maxX, Math.max(minX, bounds.x));
  const nextY = Math.min(maxY, Math.max(minY, bounds.y));

  if (nextX !== bounds.x || nextY !== bounds.y) {
    mainWindow.setPosition(nextX, nextY, false);
  }
}

function applyFloatingWindowBehavior(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  const level = process.platform === 'darwin' ? 'screen-saver' : 'floating';
  window.setAlwaysOnTop(true, level);
  window.setSkipTaskbar(true);

  if (process.platform === 'darwin' && !allWorkspaceWindows.has(window)) {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    allWorkspaceWindows.add(window);
  }

  if (window.isVisible()) {
    window.moveTop();
  }
}

function disableFloatingWindowBehavior(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  window.setAlwaysOnTop(false);
  if (process.platform === 'darwin') {
    window.setVisibleOnAllWorkspaces(false);
    allWorkspaceWindows.delete(window);
  }
}

function restoreMainWindowFloatingBehavior() {
  if (mainWindowFloatingEnabled) {
    applyFloatingWindowBehavior(mainWindow);
  }
}

function healthCheck() {
  return new Promise((resolve) => {
    const req = http.get(`${API_BASE}/health`, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 300);
    });

    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function resolveNodeBinary() {
  const candidates = [
    process.env.NODE_BINARY,
    path.join(app.getPath('home'), '.nvm/versions/node/v24.4.0/bin/node'),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    'node',
  ].filter(Boolean);

  return candidates.find((candidate) => candidate === 'node' || fs.existsSync(candidate)) || 'node';
}

function resolveBackendEntry() {
  if (app.isPackaged) {
    return {
      binary: process.execPath,
      args: [path.join(app.getAppPath(), 'dist', 'server.js')],
      cwd: app.getPath('userData'),
      runAsElectronNode: true,
    };
  }

  const nodeBinary = resolveNodeBinary();
  const tsNodeBin = path.join(PROJECT_ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');
  const distServer = path.join(PROJECT_ROOT, 'dist', 'server.js');
  const useDist = process.env.GOLD_DESKTOP_USE_DIST === 'true';
  return {
    binary: nodeBinary,
    args: useDist ? [distServer] : [tsNodeBin, path.join(PROJECT_ROOT, 'src', 'server.ts')],
    cwd: PROJECT_ROOT,
    runAsElectronNode: false,
  };
}

async function waitForBackend(timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await healthCheck()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function ensureBackend() {
  if (await healthCheck()) {
    return true;
  }

  const backend = resolveBackendEntry();
  if (!fs.existsSync(backend.args[backend.args.length - 1])) {
    throw new Error(`后端入口不存在：${backend.args[backend.args.length - 1]}`);
  }

  backendProcess = spawn(backend.binary, backend.args, {
    cwd: backend.cwd,
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      GOLD_DB_PATH: process.env.GOLD_DB_PATH || path.join(app.getPath('userData'), 'data', 'gold-prices.sqlite'),
      JD_GOLD_POLL_INTERVAL_MS: process.env.JD_GOLD_POLL_INTERVAL_MS || '2000',
      COLLECT_INTERVAL_MS: process.env.COLLECT_INTERVAL_MS || '5000',
      RECYCLE_COLLECT_INTERVAL_MS: process.env.RECYCLE_COLLECT_INTERVAL_MS || '60000',
      ...(backend.runAsElectronNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  backendStartedByUs = true;

  backendProcess.stdout.on('data', (chunk) => {
    console.log(`[backend] ${chunk.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (chunk) => {
    console.error(`[backend] ${chunk.toString().trim()}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`[backend] exited with code ${code}`);
    backendProcess = null;
    backendStartedByUs = false;
  });

  return waitForBackend();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: expandedWindowSize[0],
    height: expandedWindowSize[1],
    minWidth: collapsedWindowSize[0],
    minHeight: collapsedWindowSize[1],
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    title: '金脉',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--api-base=${API_BASE}`],
    },
  });

  applyFloatingWindowBehavior(mainWindow);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('show', restoreMainWindowFloatingBehavior);
  mainWindow.on('restore', restoreMainWindowFloatingBehavior);
  mainWindow.on('blur', restoreMainWindowFloatingBehavior);
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('move', keepWindowVisible);
  mainWindow.on('resize', keepWindowVisible);
}

function createTray() {
  if (tray) return;
  tray = new Tray(path.join(__dirname, 'renderer', 'icon-tray.png'));
  tray.setToolTip('金脉');
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else mainWindow?.show();
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示金脉', click: () => mainWindow?.show() },
    { label: '打开设置', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: settingsWindowSize[0],
    height: settingsWindowSize[1],
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    title: '金脉设置',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--api-base=${API_BASE}`],
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show();
  });
  return settingsWindow;
}

if (hasSingleInstanceLock) {
app.whenReady().then(async () => {
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
  }
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  try {
    await ensureBackend();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('金脉启动失败', `后端服务无法启动。\n\n${message}`);
    app.quit();
    return;
  }
  createWindow();
  createTray();
  globalShortcut.register('CommandOrControl+Shift+G', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.webContents.send('window:toggle-collapsed');
  });
});
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    return;
  }
});

function stopOwnedBackend() {
  if (!backendProcess || !backendStartedByUs) {
    return Promise.resolve();
  }

  const child = backendProcess;
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      resolve();
    };

    child.once('exit', finish);
    if (child.connected) {
      child.send({ type: 'shutdown' }, (error) => {
        if (error) {
          child.kill('SIGTERM');
        }
      });
    } else {
      child.kill('SIGTERM');
    }

    setTimeout(() => {
      if (!finished) {
        child.kill();
        finish();
      }
    }, 5000).unref();
  });
}

app.on('before-quit', (event) => {
  if (isQuitting) {
    return;
  }

  isQuitting = true;
  globalShortcut.unregisterAll();
  tray?.destroy();
  tray = null;
  if (backendProcess && backendStartedByUs) {
    event.preventDefault();
    void stopOwnedBackend().finally(() => app.quit());
  }
});

ipcMain.handle('window:set-collapsed', (_event, collapsed) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  const nextCollapsed = Boolean(collapsed);
  if (nextCollapsed === windowCollapsed) {
    return windowCollapsed;
  }

  const [width, height] = nextCollapsed ? collapsedWindowSize : expandedWindowSize;
  const bounds = mainWindow.getBounds();
  mainWindow.setBounds({
    x: bounds.x + Math.round((bounds.width - width) / 2),
    y: bounds.y + Math.round((bounds.height - height) / 2),
    width,
    height,
  }, false);
  keepWindowVisible();

  windowCollapsed = nextCollapsed;
  return windowCollapsed;
});
ipcMain.handle('window:set-collapsed-size', (_event, sizeName) => {
  const size = collapsedSizes[sizeName] || collapsedSizes.normal;
  if (!mainWindow || mainWindow.isDestroyed() || !windowCollapsed) return sizeName;
  const bounds = mainWindow.getBounds();
  mainWindow.setBounds({
    x: bounds.x + Math.round((bounds.width - size[0]) / 2),
    y: bounds.y + Math.round((bounds.height - size[1]) / 2),
    width: size[0],
    height: size[1],
  }, false);
  keepWindowVisible();
  return sizeName;
});
ipcMain.on('window:drag-start', (event, payload) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) {
    return;
  }

  const pointerX = Number(payload?.pointerX);
  const pointerY = Number(payload?.pointerY);
  if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) {
    return;
  }

  const [windowX, windowY] = window.getPosition();
  endWindowDrag(event.sender);
  const session = {
    window,
    pointerX,
    pointerY,
    windowX,
    windowY,
    lastWindowX: windowX,
    lastWindowY: windowY,
    cursorTimer: null,
  };

  session.cursorTimer = setInterval(() => {
    if (session.window.isDestroyed()) {
      endWindowDrag(event.sender);
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    moveWindowFromDrag(session, cursor.x, cursor.y);
  }, 16);
  dragSessions.set(event.sender, session);
});
ipcMain.on('window:drag-move', (event, payload) => {
  const session = dragSessions.get(event.sender);
  if (!session || session.window.isDestroyed()) {
    return;
  }

  const pointerX = Number(payload?.pointerX);
  const pointerY = Number(payload?.pointerY);
  if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) {
    return;
  }

  moveWindowFromDrag(session, pointerX, pointerY);
});
ipcMain.on('window:drag-end', (event) => {
  endWindowDrag(event.sender);
});
ipcMain.handle('window:minimize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.minimize();
});

ipcMain.handle('window:close', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.close();
});

ipcMain.handle('settings:open', () => {
  createSettingsWindow();
  return true;
});

ipcMain.handle('settings:set-startup', (_event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath });
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('settings:get-startup', () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle('settings:apply-appearance', (_event, settings) => {
  mainWindow?.webContents.send('appearance:changed', settings || {});
  return true;
});

ipcMain.handle('data:export', async (_event, payload) => {
  const format = ['xlsx', 'csv', 'json'].includes(payload?.format) ? payload.format : 'json';
  const extension = format;
  const result = await dialog.showSaveDialog({
    title: '导出金脉数据',
    defaultPath: path.join(app.getPath('documents'), `jinmai-backup-${new Date().toISOString().slice(0, 10)}.${extension}`),
    filters: [{ name: format.toUpperCase(), extensions: [extension] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const safePayload = { ...payload, exportedAt: new Date().toISOString(), notifications: undefined };
  if (format === 'json') {
    fs.writeFileSync(result.filePath, JSON.stringify(safePayload, null, 2), 'utf8');
  } else {
    const XLSX = require('xlsx');
    const holdings = Object.entries(payload?.holdings?.holdings || {}).flatMap(([mode, items]) => (items || []).map((item) => ({ mode, ...item })));
    const rules = payload?.rules || [];
    const rows = format === 'csv'
      ? [{ type: 'meta', exportedAt: safePayload.exportedAt }, ...holdings.map((item) => ({ type: 'holding', ...item })), ...rules.map((item) => ({ type: 'alert', ...item }))]
      : undefined;
    if (format === 'csv') {
      const sheet = XLSX.utils.json_to_sheet(rows);
      fs.writeFileSync(result.filePath, XLSX.utils.sheet_to_csv(sheet), 'utf8');
    } else {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(holdings), '资产');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rules), '提醒');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ exportedAt: safePayload.exportedAt }]), '信息');
      XLSX.writeFile(workbook, result.filePath);
    }
  }
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('data:import', async () => {
  const result = await dialog.showOpenDialog({
    title: '导入金脉数据',
    properties: ['openFile'],
    filters: [{ name: '备份文件', extensions: ['json', 'csv', 'xlsx'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (extension === 'json') return { canceled: false, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);
  const rows = extension === 'csv'
    ? XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
    : (workbook.SheetNames.includes('资产') ? XLSX.utils.sheet_to_json(workbook.Sheets['资产']) : []);
  const rules = extension === 'xlsx' && workbook.SheetNames.includes('提醒')
    ? XLSX.utils.sheet_to_json(workbook.Sheets['提醒'])
    : rows.filter((row) => row.type === 'alert');
  const holdings = rows.filter((row) => row.type !== 'meta' && row.type !== 'alert');
  return { canceled: false, data: { holdings: { holdings: holdings.reduce((result, item) => { const mode = item.mode || 'market'; (result[mode] ||= []).push(item); return result; }, {}) }, rules } };
});

ipcMain.handle('window:set-always-on-top', (_event, enabled) => {
  mainWindowFloatingEnabled = Boolean(enabled);
  if (mainWindowFloatingEnabled) {
    applyFloatingWindowBehavior(mainWindow);
  } else {
    disableFloatingWindowBehavior(mainWindow);
  }
  return mainWindow?.isAlwaysOnTop() || false;
});

ipcMain.handle('notify', (_event, payload) => {
  if (!Notification.isSupported()) {
    return false;
  }

  new Notification({
    title: payload.title || '金价提醒',
    body: payload.body || '',
    silent: false,
  }).show();

  return true;
});
