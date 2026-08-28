const { contextBridge, ipcRenderer } = require('electron');

const apiArg = process.argv.find((arg) => arg.startsWith('--api-base='));
const apiBase = apiArg ? apiArg.replace('--api-base=', '') : 'http://localhost:3001';

contextBridge.exposeInMainWorld('goldDesktop', {
  apiBase,
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('window:set-always-on-top', enabled),
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
});
