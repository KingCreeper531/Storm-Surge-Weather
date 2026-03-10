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

  server.on('error', err => console.error('Server error:', err));

  // Wait for server to start before opening window
  setTimeout(() => {
    win = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      title: 'Storm Surge Weather',
      icon: path.join(__dirname, 'public', 'favicon.ico'),
      backgroundColor: '#0a0f1a',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    win.loadURL('http://localhost:3001');

    win.webContents.on('did-fail-load', () => {
      // Retry once if server isn't ready yet
      setTimeout(() => win.loadURL('http://localhost:3001'), 1000);
    });

    win.on('closed', () => {
      if (server) server.kill();
      win = null;
    });

    // Remove default menu bar
    win.setMenuBarVisibility(false);
  }, 1500);
});

app.on('window-all-closed', () => {
  if (server) server.kill();
  app.quit();
});

app.on('before-quit', () => {
  if (server) server.kill();
});
