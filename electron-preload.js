const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronUpdater', {
  checkUpdate:  ()    => ipcRenderer.invoke('check-update'),
  openRelease:  (url) => ipcRenderer.send('open-release', url)
});

contextBridge.exposeInMainWorld('electronSettings', {
  getSettings:  ()     => ipcRenderer.invoke('get-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data)
});
