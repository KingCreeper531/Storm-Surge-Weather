const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const https = require('https');

const CURRENT_VERSION = '13.2.0';
const GITHUB_REPO     = 'KingCreeper531/Storm-Surge-Weather';

let win    = null;
let server = null;
let isQuitting = false;

function checkForUpdate() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/releases/latest`,
      headers: { 'User-Agent': 'StormSurgeWeather-Electron' }
    };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const latest = (json.tag_name || '').replace(/^v/, '');
          const hasUpdate = latest && latest !== CURRENT_VERSION;
          resolve({ hasUpdate, latest, current: CURRENT_VERSION, releaseUrl: json.html_url || '', releaseName: json.name || '' });
        } catch {
          resolve({ hasUpdate: false });
        }
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

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  // Spawn the Express server
  server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: '3001' },
    stdio: 'inherit'
  });

  // Wait for server to boot then open window
  setTimeout(createWindow, 1500);
});

// Only re-open on macOS when clicking dock icon with no windows
app.on('activate', () => {
  if (win === null && !isQuitting) createWindow();
});

// Windows/Linux: quit when all windows closed
app.on('window-all-closed', () => {
  isQuitting = true;
  if (server) {
    server.kill();
    server = null;
  }
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (server) {
    server.kill();
    server = null;
  }
});
