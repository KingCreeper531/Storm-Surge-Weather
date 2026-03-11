const { contextBridge, ipcRenderer } = require('electron');

// Update system
contextBridge.exposeInMainWorld('electronUpdater', {
  checkUpdate:     ()    => ipcRenderer.invoke('check-update'),
  downloadUpdate:  ()    => ipcRenderer.invoke('download-update'),
  installUpdate:   ()    => ipcRenderer.invoke('install-update'),
  openRelease:     (url) => ipcRenderer.send('open-release', url),
  onUpdaterEvent:  (cb)  => ipcRenderer.on('updater-event', (_, data) => cb(data))
});

// App settings
contextBridge.exposeInMainWorld('electronSettings', {
  getSettings:  ()     => ipcRenderer.invoke('get-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data)
});
