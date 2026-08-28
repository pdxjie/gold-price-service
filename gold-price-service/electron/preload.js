const { contextBridge, ipcRenderer } = require('electron');

const apiArg = process.argv.find((arg) => arg.startsWith('--api-base='));
const apiBase = apiArg ? apiArg.replace('--api-base=', '') : 'http://localhost:3001';

contextBridge.exposeInMainWorld('goldDesktop', {
  apiBase,
  setCollapsed: (collapsed) => ipcRenderer.invoke('window:set-collapsed', collapsed),
  beginWindowDrag: (pointerX, pointerY) => ipcRenderer.send('window:drag-start', { pointerX, pointerY }),
  moveWindowDrag: (pointerX, pointerY) => ipcRenderer.send('window:drag-move', { pointerX, pointerY }),
  endWindowDrag: () => ipcRenderer.send('window:drag-end'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
});
