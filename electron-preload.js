// Exposes safe IPC methods to the renderer (web page)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronUpdater', {
  checkUpdate:  ()    => ipcRenderer.invoke('check-update'),
  openRelease:  (url) => ipcRenderer.send('open-release', url)
});
