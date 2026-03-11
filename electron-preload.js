const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronUpdater', {
  // Renderer → Main
  checkUpdate:  ()      => ipcRenderer.invoke('check-update'),
  installNow:   ()      => ipcRenderer.invoke('install-now'),

  // Main → Renderer  (push events)
  onUpdaterEvent: (cb) => {
    ipcRenderer.on('updater-event', (_event, data) => cb(data));
  }
});

contextBridge.exposeInMainWorld('electronSettings', {
  get:  ()      => ipcRenderer.invoke('get-settings'),
  save: (data)  => ipcRenderer.invoke('save-settings', data)
});
