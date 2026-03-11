const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const http   = require('http');
const { spawn } = require('child_process');

const CURRENT_VERSION = app.getVersion();
const GITHUB_OWNER    = 'KingCreeper531';
const GITHUB_REPO     = 'Storm-Surge-Weather';

// ── Single instance ──────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let win  = null;
let tray = null;

// ── Settings ─────────────────────────────────────────────────────
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { if (fs.existsSync(SETTINGS_PATH)) return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch {}
  return { startMinimized: false, minimizeToTray: true, autoLaunch: false };
}
function saveSettings(d) {
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(d, null, 2)); } catch {}
}
let settings = loadSettings();
function applyAutoLaunch(on) {
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: ['--hidden'] });
}

// ── Inline Express server ─────────────────────────────────────────
process.env.PORT = process.env.PORT || '3001';
require('./server.js');

// ── Updater state ─────────────────────────────────────────────────
let _readyInstallerPath = null;  // set when download is complete
let _downloading        = false;

function sendToRenderer(event, data) {
  if (win && !win.isDestroyed())
    win.webContents.send('updater-event', { event, ...(data || {}) });
}

// Follow redirects
function fetchFollow(url, cb) {
  const mod = url.startsWith('https') ? https : http;
  mod.get(url, { headers: { 'User-Agent': 'StormSurge-Updater' } }, (res) => {
    if ([301,302,303,307,308].includes(res.statusCode))
      return fetchFollow(res.headers.location, cb);
    cb(null, res);
  }).on('error', cb);
}

async function checkForUpdate() {
  return new Promise((resolve) => {
    https.get({
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      headers: { 'User-Agent': 'StormSurge-Updater', 'Accept': 'application/vnd.github.v3+json' }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const rel    = JSON.parse(body);
          const latest = (rel.tag_name || '').replace(/^v/, '');
          const asset  = (rel.assets || []).find(a =>
            a.name.endsWith('.exe') || a.name.toLowerCase().includes('setup')
          );
          resolve({
            hasUpdate:   !!latest && latest !== CURRENT_VERSION,
            current:     CURRENT_VERSION,
            latest:      latest || CURRENT_VERSION,
            releaseName: rel.name || '',
            releaseUrl:  rel.html_url || '',
            assetUrl:    asset?.browser_download_url || null,
            assetName:   asset?.name || null,
            assetSize:   asset?.size || 0
          });
        } catch { resolve({ hasUpdate: false, current: CURRENT_VERSION }); }
      });
    })
    .on('error', () => resolve({ hasUpdate: false, current: CURRENT_VERSION }))
    .setTimeout(10000, function () { this.destroy(); resolve({ hasUpdate: false, current: CURRENT_VERSION }); });
  });
}

// Silent background download — no UI feedback until complete
function downloadSilently(assetUrl, assetName, assetSize) {
  if (_downloading) return;
  _downloading = true;

  const outPath = path.join(app.getPath('temp'), assetName || 'StormSurgeSetup.exe');

  // If already downloaded (e.g. app restarted before install), reuse it
  if (fs.existsSync(outPath)) {
    _readyInstallerPath = outPath;
    _downloading = false;
    sendToRenderer('ready');   // show green button immediately
    updateTrayMenu();
    return;
  }

  const file = fs.createWriteStream(outPath);
  let downloaded = 0;

  fetchFollow(assetUrl, (err, res) => {
    if (err || res.statusCode !== 200) {
      _downloading = false;
      file.close();
      try { fs.unlinkSync(outPath); } catch {}
      return;
    }

    const total = assetSize || parseInt(res.headers['content-length'] || '0', 10);

    res.on('data', chunk => {
      downloaded += chunk.length;
      file.write(chunk);
      // Send silent progress (renderer can show a tiny indicator if wanted)
      if (total > 0)
        sendToRenderer('downloading', { percent: Math.round(downloaded / total * 100) });
    });

    res.on('end', () => {
      file.end(() => {
        _readyInstallerPath = outPath;
        _downloading = false;
        // THE moment — tell renderer to show the green button
        sendToRenderer('ready');
        updateTrayMenu();
      });
    });

    res.on('error', () => {
      _downloading = false;
      file.close();
      try { fs.unlinkSync(outPath); } catch {}
    });
  });
}

function launchAndQuit() {
  if (!_readyInstallerPath) return;
  const child = spawn(_readyInstallerPath, ['/S'], { detached: true, stdio: 'ignore' });
  child.unref();
  setTimeout(() => { win?.destroy(); app.quit(); }, 400);
}

function updateTrayMenu() {
  if (!tray) return;
  const hasUpdate = !!_readyInstallerPath;
  const menu = Menu.buildFromTemplate([
    { label: '⛈ Storm Surge Weather', enabled: false },
    { type: 'separator' },
    { label: '🌐 Open',    click: () => { createWindow(); win?.show(); win?.focus(); } },
    { label: '↻ Refresh', click: () => win?.webContents.reload() },
    ...(hasUpdate ? [
      { type: 'separator' },
      { label: '🟢 Update Ready — Restart to Install', click: launchAndQuit }
    ] : []),
    { type: 'separator' },
    { label: '🚀 Start with Windows', type: 'checkbox', checked: settings.autoLaunch,
      click: (i) => { settings.autoLaunch = i.checked; saveSettings(settings); applyAutoLaunch(i.checked); updateTrayMenu(); } },
    { label: '📌 Minimize to tray on close', type: 'checkbox', checked: settings.minimizeToTray,
      click: (i) => { settings.minimizeToTray = i.checked; saveSettings(settings); updateTrayMenu(); } },
    { type: 'separator' },
    { label: '✕ Quit', click: () => { win?.destroy(); app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  if (hasUpdate) tray.setToolTip('Storm Surge Weather — Update Ready!');
}

// ── IPC ───────────────────────────────────────────────────────────
ipcMain.handle('check-update', async () => {
  const info = await checkForUpdate();
  if (info.hasUpdate && info.assetUrl) {
    sendToRenderer('available', { version: info.latest, releaseName: info.releaseName });
    downloadSilently(info.assetUrl, info.assetName, info.assetSize);
  } else if (info.hasUpdate && !info.assetUrl) {
    sendToRenderer('no-asset', { version: info.latest });
  } else {
    sendToRenderer('up-to-date', { version: info.current });
  }
  return info;
});

// Renderer hits this when user clicks the green button
ipcMain.handle('install-now', () => launchAndQuit());

ipcMain.handle('get-settings',  ()     => settings);
ipcMain.handle('save-settings', (_, d) => {
  Object.assign(settings, d);
  saveSettings(settings);
  applyAutoLaunch(settings.autoLaunch);
  return settings;
});

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
  win.once('ready-to-show', () => {
    if (!settings.startMinimized) win.show();
    // If update was already downloaded before window opened, tell it immediately
    if (_readyInstallerPath) sendToRenderer('ready');
  });
  win.on('close', (e) => { if (settings.minimizeToTray) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
}

// ── Tray ──────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABmJLR0QA/wD/AP+gvaeTAAAAxUlEQVRYhe2WMQ6DMAxFX6ou3bkAd+IIXIBD9AxcpQeoVCFUJbSJFKW2Y4c4wQMSEv9n2U/+jh0hCCGEEKIHAB4ArgDeAA5JHoCLpC2AmaTJgb2kXQJ7S9pJ2CWwt6SdhF0Ce0vaRdglsLekXYRdAntL2kXYJbC3pF2EXQJ7S9pF2CWwt6RdhF0Ce0vaRdglsLekXYRdAntL2kXYJbC3pF2EXQJ7S9pF2CWwt6SdAAAAAElFTkSuQmCC'
  );
  tray = new Tray(icon);
  tray.setToolTip('Storm Surge Weather');
  updateTrayMenu();
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
    if (!process.argv.includes('--hidden') && !settings.startMinimized) createWindow();

    // Auto-check 8s after launch, silently download if available
    setTimeout(async () => {
      const info = await checkForUpdate();
      if (info.hasUpdate && info.assetUrl) {
        sendToRenderer('available', { version: info.latest, releaseName: info.releaseName });
        downloadSilently(info.assetUrl, info.assetName, info.assetSize);
      } else if (!info.hasUpdate) {
        sendToRenderer('up-to-date', { version: info.current });
      }
    }, 8000);

    // Re-check every 2 hours
    setInterval(async () => {
      if (_readyInstallerPath) return;  // already have one ready
      const info = await checkForUpdate();
      if (info.hasUpdate && info.assetUrl) {
        sendToRenderer('available', { version: info.latest });
        downloadSilently(info.assetUrl, info.assetName, info.assetSize);
      }
    }, 2 * 60 * 60 * 1000);
  }, 1000);
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } else createWindow();
});
app.on('activate', () => { if (!win) createWindow(); });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !settings.minimizeToTray) app.quit();
});
