const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');

const CURRENT_VERSION = '13.3.0';
const GITHUB_REPO     = 'KingCreeper531/Storm-Surge-Weather';

// ── Single instance lock (like Spotify — only one copy runs) ─────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let win  = null;
let tray = null;

// ── Settings stored on disk ──────────────────────────────────────
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (e) {}
  return { startMinimized: false, minimizeToTray: true, autoLaunch: false };
}

function saveSettings(data) {
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2)); } catch (e) {}
}

let settings = loadSettings();

// ── Auto-launch (start with Windows) ────────────────────────────
function applyAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: ['--hidden']
  });
}

// ── Inline Express server ────────────────────────────────────────
process.env.PORT = process.env.PORT || '3001';
require('./server.js');

// ── Update check ────────────────────────────────────────────────
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
            latest, current: CURRENT_VERSION,
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

ipcMain.handle('check-update',   async () => await checkForUpdate());
ipcMain.on('open-release', (_, url) => {
  if (url && url.startsWith('https://github.com')) shell.openExternal(url);
});

// Settings IPC
ipcMain.handle('get-settings', () => settings);
ipcMain.handle('save-settings', (_, data) => {
  Object.assign(settings, data);
  saveSettings(settings);
  applyAutoLaunch(settings.autoLaunch);
  return settings;
});

// ── Window ───────────────────────────────────────────────────────
function createWindow() {
  if (win) { win.show(); win.focus(); return; }

  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Storm Surge Weather',
    backgroundColor: '#0a0e1a',
    show: false, // show after ready-to-show for smooth load
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.js')
    }
  });

  win.loadURL('http://localhost:3001');

  win.once('ready-to-show', () => {
    if (!settings.startMinimized) win.show();
  });

  // Minimize to tray instead of closing (like Spotify)
  win.on('close', (e) => {
    if (settings.minimizeToTray) {
      e.preventDefault();
      win.hide();
      if (tray) tray.setToolTip('Storm Surge Weather — running in tray');
    }
  });

  win.on('closed', () => { win = null; });
}

// ── Tray icon ────────────────────────────────────────────────────
function createTray() {
  // Generate a simple SVG tray icon
  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="15" fill="#0a0e1a" stroke="#06b6d4" stroke-width="1.5"/>
    <text x="16" y="22" text-anchor="middle" font-size="18" font-family="sans-serif">⛈</text>
  </svg>`;

  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABmJLR0QA/wD/AP+gvaeTAAAAxUlEQVRYhe2WMQ6DMAxFX6ou3bkAd+IIXIBD9AxcpQeoVCFUJbSJFKW2Y4c4wQMSEv9n2U/+jh0hCCGEEKIHAB4ArgDeAA5JHoCLpC2AmaTJgb2kXQJ7S9pJ2CWwt6SdhF0Ce0vaRdglsLekXYRdAntL2kXYJbC3pF2EXQJ7S9pF2CWwt6RdhF0Ce0vaRdglsLekXYRdAntL2kXYJbC3pF2EXQJ7S9pF2CWwt6RdhF0Ce0vaRdglsLekXYRdAntL2kXYJbC3pF2EXQJ7S9pF2CWwt6RdhF0Ce0vaRdglsLekXYRdAntL2kXYJbC3pF2EXQJ7S9pF2CWwt6RdhF0Ce0vaRdglsLekXYRdAntL2kXYJbC3pF2EXQJ7S9pF2CWwt6SdAAAAAElFTkSuQmCC'
  );

  tray = new Tray(icon);
  tray.setToolTip('Storm Surge Weather');

  const menu = Menu.buildFromTemplate([
    { label: '⛈ Storm Surge Weather', enabled: false },
    { type: 'separator' },
    { label: '🌐 Open',  click: () => { createWindow(); if (win) { win.show(); win.focus(); } } },
    { label: '↻ Refresh', click: () => { if (win) win.webContents.reload(); } },
    { type: 'separator' },
    { label: '🚀 Start with Windows', type: 'checkbox', checked: settings.autoLaunch,
      click: (item) => { settings.autoLaunch = item.checked; saveSettings(settings); applyAutoLaunch(item.checked); } },
    { label: '📌 Minimize to tray on close', type: 'checkbox', checked: settings.minimizeToTray,
      click: (item) => { settings.minimizeToTray = item.checked; saveSettings(settings); } },
    { type: 'separator' },
    { label: '✕ Quit', click: () => { win?.destroy(); app.quit(); } }
  ]);

  tray.setContextMenu(menu);

  // Single click tray icon = show/hide window
  tray.on('click', () => {
    if (!win) { createWindow(); return; }
    win.isVisible() ? win.hide() : (win.show(), win.focus());
  });
}

// ── Boot ─────────────────────────────────────────────────────────
app.whenReady().then(() => {
  applyAutoLaunch(settings.autoLaunch);

  // Give server 1s to bind, then create tray + window
  setTimeout(() => {
    createTray();
    const startHidden = process.argv.includes('--hidden') || settings.startMinimized;
    if (!startHidden) createWindow();
  }, 1000);
});

// Second instance → focus existing window
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  else createWindow();
});

// macOS: reopen window from dock
app.on('activate', () => { if (!win) createWindow(); });

// Don't quit when all windows closed (tray keeps it alive)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !settings.minimizeToTray) app.quit();
});
