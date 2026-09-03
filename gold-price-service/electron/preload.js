const { contextBridge, ipcRenderer } = require('electron');

const apiArg = process.argv.find((arg) => arg.startsWith('--api-base='));
const apiBase = apiArg ? apiArg.replace('--api-base=', '') : 'http://localhost:3001';

contextBridge.exposeInMainWorld('goldDesktop', {
  apiBase,
  setCollapsed: (collapsed) => ipcRenderer.invoke('window:set-collapsed', collapsed),
  setCollapsedSize: (sizeName) => ipcRenderer.invoke('window:set-collapsed-size', sizeName),
  beginWindowDrag: (pointerX, pointerY) => ipcRenderer.send('window:drag-start', { pointerX, pointerY }),
  moveWindowDrag: (pointerX, pointerY) => ipcRenderer.send('window:drag-move', { pointerX, pointerY }),
  endWindowDrag: () => ipcRenderer.send('window:drag-end'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  openAnalysis: () => ipcRenderer.invoke('analysis:open'),
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
  setStartup: (enabled) => ipcRenderer.invoke('settings:set-startup', enabled),
  getStartup: () => ipcRenderer.invoke('settings:get-startup'),
  applyAppearance: (settings) => ipcRenderer.invoke('settings:apply-appearance', settings),
  exportData: (payload) => ipcRenderer.invoke('data:export', payload),
  importData: () => ipcRenderer.invoke('data:import'),
  onWindowToggleCollapsed: (callback) => ipcRenderer.on('window:toggle-collapsed', callback),
  onAppearanceChanged: (callback) => ipcRenderer.on('appearance:changed', (_event, settings) => callback(settings)),
  fetchJdPost: () => ipcRenderer.invoke('gold:fetch-jd-post'),
  exportImage: (dataUrl, defaultName) => ipcRenderer.invoke('image:export', { dataUrl, defaultName }),
});
