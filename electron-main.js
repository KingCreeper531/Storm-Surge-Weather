const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs   = require('fs');

const CURRENT_VERSION = app.getVersion();
const GITHUB_REPO     = 'KingCreeper531/Storm-Surge-Weather';

// ── Single instance lock ──────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let win  = null;
let tray = null;

// ── Settings stored on disk ───────────────────────────────────────
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH))
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (e) {}
  return { startMinimized: false, minimizeToTray: true, autoLaunch: false };
}
function saveSettings(data) {
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2)); } catch (e) {}
}

let settings = loadSettings();

function applyAutoLaunch(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ['--hidden'] });
}

// ── Inline Express server ─────────────────────────────────────────
process.env.PORT = process.env.PORT || '3001';
require('./server.js');

// ── Auto-updater setup ────────────────────────────────────────────
autoUpdater.autoDownload    = false;  // we ask user first
autoUpdater.autoInstallOnAppQuit = true;

// Send update events to renderer
function sendUpdateStatus(event, data) {
  if (win && !win.isDestroyed())
    win.webContents.send('updater-event', { event, ...data });
}

autoUpdater.on('checking-for-update',  ()      => sendUpdateStatus('checking'));
autoUpdater.on('update-not-available', ()      => sendUpdateStatus('up-to-date', { version: CURRENT_VERSION }));
autoUpdater.on('error',                (err)   => sendUpdateStatus('error',      { message: err.message }));
autoUpdater.on('update-available',     (info)  => sendUpdateStatus('available',  { version: info.version, releaseNotes: info.releaseNotes || '' }));
autoUpdater.on('download-progress',    (prog)  => sendUpdateStatus('progress',   { percent: Math.round(prog.percent), speed: prog.bytesPerSecond, transferred: prog.transferred, total: prog.total }));
autoUpdater.on('update-downloaded',    (info)  => {
  sendUpdateStatus('downloaded', { version: info.version });
  // Show tray notification
  if (tray) tray.setToolTip(`Storm Surge — v${info.version} ready to install`);
});

// IPC handlers for renderer
ipcMain.handle('check-update',    async () => { autoUpdater.checkForUpdates(); return { current: CURRENT_VERSION }; });
ipcMain.handle('download-update', async () => { autoUpdater.downloadUpdate(); });
ipcMain.handle('install-update',  async () => { autoUpdater.quitAndInstall(false, true); });
ipcMain.handle('get-settings',    ()      => settings);
ipcMain.handle('save-settings',   (_, d)  => { Object.assign(settings, d); saveSettings(settings); applyAutoLaunch(settings.autoLaunch); return settings; });
ipcMain.on('open-release', (_, url) => { if (url?.startsWith('https://github.com')) shell.openExternal(url); });

// ── Window ────────────────────────────────────────────────────────
function createWindow() {
  if (win) { win.show(); win.focus(); return; }

  win = new BrowserWindow({
    width: 1400, height: 900,
    minWidth: 900, minHeight: 600,
    title: 'Storm Surge Weather',
    backgroundColor: '#0a0e1a',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.js')
    }
  });

  win.loadURL('http://localhost:3001');
  win.once('ready-to-show', () => { if (!settings.startMinimized) win.show(); });

  win.on('close', (e) => {
    if (settings.minimizeToTray) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
}

// ── Tray ──────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABmJLR0QA/wD/AP+gvaeTAAAAxUlEQVRYhe2WMQ6DMAxFX6ou3bkAd+IIXIBD9AxcpQeoVCFUJbSJFKW2Y4c4wQMSEv9n2U/+jh0hCCGEEKIHAB4ArgDeAA5JHoCLpC2AmaTJgb2kXQJ7S9pJ2CWwt6SdhF0Ce0vaRdglsLekXYRdAntL2kXYJbC3pF2EXQJ7S9pF2CWwt6RdhF0Ce0vaRdglsLekXYRdAntL2kXYJbC3pF2EXQJ7S9pF2CWwt6RdhF0Ce0vaRdglsLekXYRdAntL2kXYJbC3pF2EXQJ7S9pF2CWwt6SdAAAAAElFTkSuQmCC'
  );

  tray = new Tray(icon);
  tray.setToolTip('Storm Surge Weather');

  const buildMenu = () => Menu.buildFromTemplate([
    { label: '⛈ Storm Surge Weather', enabled: false },
    { type: 'separator' },
    { label: '🌐 Open',    click: () => { createWindow(); win?.show(); win?.focus(); } },
    { label: '↻ Refresh', click: () => { win?.webContents.reload(); } },
    { type: 'separator' },
    { label: '🚀 Start with Windows', type: 'checkbox', checked: settings.autoLaunch,
      click: (i) => { settings.autoLaunch = i.checked; saveSettings(settings); applyAutoLaunch(i.checked); tray.setContextMenu(buildMenu()); } },
    { label: '📌 Minimize to tray on close', type: 'checkbox', checked: settings.minimizeToTray,
      click: (i) => { settings.minimizeToTray = i.checked; saveSettings(settings); tray.setContextMenu(buildMenu()); } },
    { type: 'separator' },
    { label: '✕ Quit', click: () => { win?.destroy(); app.quit(); } }
  ]);

  tray.setContextMenu(buildMenu());
  tray.on('click', () => {
    if (!win) { createWindow(); return; }
    win.isVisible() ? win.hide() : (win.show(), win.focus());
  });
}

// ── Boot ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  applyAutoLaunch(settings.autoLaunch);

  setTimeout(() => {
    createTray();
    const startHidden = process.argv.includes('--hidden') || settings.startMinimized;
    if (!startHidden) createWindow();

    // Check for updates 10s after launch (quietly)
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10000);
    // Re-check every 2 hours
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 2 * 60 * 60 * 1000);
  }, 1000);
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  else createWindow();
});

app.on('activate', () => { if (!win) createWindow(); });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !settings.minimizeToTray) app.quit();
});
