const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BACKEND_PORT = Number(process.env.GOLD_DESKTOP_PORT || 3001);
const API_BASE = `http://localhost:${BACKEND_PORT}`;

let mainWindow = null;
let backendProcess = null;

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
    width: 390,
    height: 570,
    minWidth: 340,
    minHeight: 480,
    frame: false,
    transparent: true,
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

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
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
