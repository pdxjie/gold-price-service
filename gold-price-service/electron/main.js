const { app, BrowserWindow, ipcMain, Notification, screen } = require('electron');
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
const expandedWindowSize = [420, 850];
const collapsedWindowSize = [260, 124];
const settingsWindowSize = [420, 780];
let windowCollapsed = false;
const dragSessions = new Map();

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

  const nodeBinary = resolveNodeBinary();
  const tsNodeBin = path.join(PROJECT_ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');
  const distServer = path.join(PROJECT_ROOT, 'dist', 'server.js');
  const entryArgs = fs.existsSync(distServer) && process.env.GOLD_DESKTOP_USE_DIST === 'true'
    ? [distServer]
    : [tsNodeBin, path.join(PROJECT_ROOT, 'src', 'server.ts')];

  backendProcess = spawn(nodeBinary, entryArgs, {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      JD_GOLD_POLL_INTERVAL_MS: process.env.JD_GOLD_POLL_INTERVAL_MS || '2000',
      COLLECT_INTERVAL_MS: process.env.COLLECT_INTERVAL_MS || '5000',
      RECYCLE_COLLECT_INTERVAL_MS: process.env.RECYCLE_COLLECT_INTERVAL_MS || '60000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout.on('data', (chunk) => {
    console.log(`[backend] ${chunk.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (chunk) => {
    console.error(`[backend] ${chunk.toString().trim()}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`[backend] exited with code ${code}`);
    backendProcess = null;
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
    title: '金价浮窗',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--api-base=${API_BASE}`],
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('move', keepWindowVisible);
  mainWindow.on('resize', keepWindowVisible);
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
    title: '金价浮窗设置',
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

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  await ensureBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
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

ipcMain.handle('window:set-always-on-top', (_event, enabled) => {
  mainWindow?.setAlwaysOnTop(Boolean(enabled), 'floating');
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
