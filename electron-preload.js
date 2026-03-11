const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronUpdater', {
  checkUpdate:     ()      => ipcRenderer.invoke('check-update'),
  downloadUpdate:  (opts)  => ipcRenderer.invoke('download-update', opts),
  installUpdate:   (opts)  => ipcRenderer.invoke('install-update', opts),
  openRelease:     (url)   => ipcRenderer.send('open-release', url),
  onUpdaterEvent:  (cb)    => ipcRenderer.on('updater-event', (_, data) => cb(data))
});

contextBridge.exposeInMainWorld('electronSettings', {
  getSettings:  ()     => ipcRenderer.invoke('get-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data)
});
