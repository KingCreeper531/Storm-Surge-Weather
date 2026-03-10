const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let win;
let server;

app.whenReady().then(() => {
  // Spawn the Express server
  server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: '3001' },
    stdio: 'inherit'
  });

  // Wait for server to boot, then open window
  setTimeout(() => {
    win = new BrowserWindow({
      width: 1400,
      height: 900,
      title: 'Storm Surge Weather',
      icon: path.join(__dirname, 'public', 'favicon.ico'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    win.loadURL('http://localhost:3001');

    win.on('closed', () => {
      if (server) server.kill();
      win = null;
    });
  }, 1500);
});

app.on('window-all-closed', () => {
  if (server) server.kill();
  app.quit();
});

app.on('activate', () => {
  if (!win) app.emit('ready');
});
