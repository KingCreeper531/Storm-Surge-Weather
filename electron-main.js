const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const https = require('https');

const CURRENT_VERSION = '13.2.0';
const GITHUB_REPO     = 'KingCreeper531/Storm-Surge-Weather';

let win       = null;
let isQuitting = false;

// ── Run the Express server directly inside this process ──────────
// This avoids spawning a child process (which caused the infinite
// loop in packaged builds where process.execPath = Electron binary)
process.env.PORT = process.env.PORT || '3001';
require('./server.js');

// ── Update check ─────────────────────────────────────────────────
function checkForUpdate() {
  return new Promise((resolve) => {
    const req = https.get({
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/releases/latest`,
      headers: { 'User-Agent': 'StormSurgeWeather-Electron' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const latest = (json.tag_name || '').replace(/^v/, '');
          resolve({
            hasUpdate:   latest && latest !== CURRENT_VERSION,
            latest,
            current:     CURRENT_VERSION,
            releaseUrl:  json.html_url || '',
            releaseName: json.name || ''
          });
        } catch { resolve({ hasUpdate: false }); }
      });
    });
    req.on('error', () => resolve({ hasUpdate: false }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ hasUpdate: false }); });
  });
}

ipcMain.handle('check-update', async () => await checkForUpdate());
ipcMain.on('open-release', (_, url) => {
  if (url && url.startsWith('https://github.com')) shell.openExternal(url);
});

// ── Window ───────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Storm Surge Weather',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.js')
    }
  });

  win.loadURL('http://localhost:3001');
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  // Give the inline server 1s to bind to port, then open window
  setTimeout(createWindow, 1000);
});

// macOS: reopen window when clicking dock icon
app.on('activate', () => {
  if (win === null && !isQuitting) createWindow();
});

// Windows/Linux: quit app when window is closed
app.on('window-all-closed', () => {
  isQuitting = true;
  app.quit();
});
