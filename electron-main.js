const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, dialog } = require('electron');
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');
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

// ── Custom updater (no signing needed) ───────────────────────────
function sendUpdate(event, data) {
  if (win && !win.isDestroyed())
    win.webContents.send('updater-event', { event, ...(data || {}) });
}

// Follow redirects and return final response
function fetchFollow(url, cb) {
  const mod = url.startsWith('https') ? https : http;
  mod.get(url, { headers: { 'User-Agent': 'StormSurge-Updater' } }, (res) => {
    if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) {
      return fetchFollow(res.headers.location, cb);
    }
    cb(null, res);
  }).on('error', (e) => cb(e));
}

async function checkUpdate() {
  return new Promise((resolve) => {
    sendUpdate('checking');
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
          const hasUpdate = latest && latest !== CURRENT_VERSION;

          // Find Windows installer asset
          const asset = (rel.assets || []).find(a =>
            a.name.endsWith('.exe') ||
            a.name.endsWith('Setup.exe') ||
            a.name.toLowerCase().includes('setup')
          );

          resolve({
            hasUpdate,
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
    }).on('error', () => resolve({ hasUpdate: false, current: CURRENT_VERSION }))
      .setTimeout(10000, function() { this.destroy(); resolve({ hasUpdate: false, current: CURRENT_VERSION }); });
  });
}

let _downloadAbort = false;
async function downloadAndInstall(assetUrl, assetName, assetSize) {
  const tmpDir  = app.getPath('temp');
  const outPath = path.join(tmpDir, assetName || 'StormSurgeSetup.exe');
  _downloadAbort = false;

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath);
    let downloaded = 0;

    fetchFollow(assetUrl, (err, res) => {
      if (err) return reject(err);
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));

      const total = assetSize || parseInt(res.headers['content-length'] || '0', 10);

      res.on('data', (chunk) => {
        if (_downloadAbort) { res.destroy(); file.close(); reject(new Error('cancelled')); return; }
        downloaded += chunk.length;
        file.write(chunk);
        if (total > 0) {
          const percent = Math.round((downloaded / total) * 100);
          const speed   = chunk.length; // rough — per-chunk bytes
          sendUpdate('progress', { percent, downloaded, total, speed });
        }
      });

      res.on('end', () => {
        file.end(() => {
          sendUpdate('downloaded', { path: outPath });
          resolve(outPath);
        });
      });

      res.on('error', (e) => { file.close(); reject(e); });
    });
  });
}

function launchInstallerAndQuit(installerPath) {
  // /S = silent NSIS flag — installer runs, replaces the app, auto-restarts
  const child = spawn(installerPath, ['/S'], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  setTimeout(() => { win?.destroy(); app.quit(); }, 500);
}

// IPC
ipcMain.handle('check-update', async () => {
  const info = await checkUpdate();
  if (info.hasUpdate) {
    sendUpdate('available', { version: info.latest, releaseName: info.releaseName, assetUrl: info.assetUrl, assetName: info.assetName, assetSize: info.assetSize });
  } else {
    sendUpdate('up-to-date', { version: info.current });
  }
  return info;
});

ipcMain.handle('download-update', async (_, { assetUrl, assetName, assetSize }) => {
  try {
    const outPath = await downloadAndInstall(assetUrl, assetName, assetSize);
    sendUpdate('downloaded', { path: outPath, version: assetName });
    return { ok: true, path: outPath };
  } catch (e) {
    sendUpdate('error', { message: e.message });
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('install-update', async (_, { installerPath }) => {
  launchInstallerAndQuit(installerPath);
});

ipcMain.handle('get-settings',  ()     => settings);
ipcMain.handle('save-settings', (_, d) => {
  Object.assign(settings, d);
  saveSettings(settings);
  applyAutoLaunch(settings.autoLaunch);
  return settings;
});
ipcMain.on('open-release', (_, url) => {
  if (url?.startsWith('https://github.com')) shell.openExternal(url);
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
  win.once('ready-to-show', () => { if (!settings.startMinimized) win.show(); });
  win.on('close', (e) => { if (settings.minimizeToTray) { e.preventDefault(); win.hide(); } });
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
    if (!process.argv.includes('--hidden') && !settings.startMinimized) createWindow();
    // Auto-check 10s after launch, then every 2h
    setTimeout(async () => {
      const info = await checkUpdate();
      if (info.hasUpdate) sendUpdate('available', { version: info.latest, releaseName: info.releaseName, assetUrl: info.assetUrl, assetName: info.assetName, assetSize: info.assetSize });
      else sendUpdate('up-to-date', { version: info.current });
    }, 10000);
    setInterval(async () => {
      const info = await checkUpdate();
      if (info.hasUpdate) sendUpdate('available', { version: info.latest, releaseName: info.releaseName, assetUrl: info.assetUrl, assetName: info.assetName, assetSize: info.assetSize });
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
