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
const SERVER_PORT = process.env.PORT || '3001';
process.env.PORT  = SERVER_PORT;
require('./server.js');

// ── Python Radar Microservice ─────────────────────────────────────
let radarServiceProc = null;
function startRadarService() {
  const pythonCmds = ['python3', 'python', 'py'];
  const scriptPath = path.join(__dirname, 'radar_service.py');
  if (!fs.existsSync(scriptPath)) {
    console.warn('radar_service.py not found — advanced radar features unavailable');
    return;
  }
  for (const cmd of pythonCmds) {
    try {
      radarServiceProc = spawn(cmd, [scriptPath], {
        env: { ...process.env, RADAR_PORT: '3002' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      radarServiceProc.stdout.on('data', d => console.log('[radar_service]', d.toString().trim()));
      radarServiceProc.stderr.on('data', d => console.warn('[radar_service]', d.toString().trim()));
      radarServiceProc.on('close', code => { console.log(`[radar_service] exited (${code})`); radarServiceProc = null; });
      console.log(`[radar_service] started with ${cmd}`);
      return;
    } catch(e) {
      console.warn(`[radar_service] ${cmd} failed: ${e.message}`);
    }
  }
}
startRadarService();
app.on('will-quit', () => { if (radarServiceProc) radarServiceProc.kill(); });

// Poll until the Express server is actually accepting connections,
// then resolve — prevents loadURL racing the server startup.
function waitForServer(port, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start    = Date.now();
    const interval = 150;
    function attempt() {
      const req = http.get(`http://localhost:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(500, () => { req.destroy(); retry(); });
      function retry() {
        if (Date.now() - start > timeout) return reject(new Error('Server did not start in time'));
        setTimeout(attempt, interval);
      }
    }
    attempt();
  });
}

// ── Updater state ─────────────────────────────────────────────────
let _readyInstallerPath = null;
let _downloading        = false;

function sendToRenderer(event, data) {
  if (win && !win.isDestroyed())
    win.webContents.send('updater-event', { event, ...(data || {}) });
}

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

function downloadSilently(assetUrl, assetName, assetSize) {
  if (_downloading) return;
  _downloading = true;

  const outPath = path.join(app.getPath('temp'), assetName || 'StormSurgeSetup.exe');

  if (fs.existsSync(outPath)) {
    _readyInstallerPath = outPath;
    _downloading = false;
    sendToRenderer('ready');
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
      if (total > 0)
        sendToRenderer('downloading', { percent: Math.round(downloaded / total * 100) });
    });
    res.on('end', () => {
      file.end(() => {
        _readyInstallerPath = outPath;
        _downloading = false;
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
  win.loadURL(`http://localhost:${SERVER_PORT}`);
  win.once('ready-to-show', () => {
    if (!settings.startMinimized) win.show();
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
app.whenReady().then(async () => {
  applyAutoLaunch(settings.autoLaunch);

  createTray();

  // Wait for Express to be ready before opening the window
  try {
    await waitForServer(SERVER_PORT);
  } catch (e) {
    console.error('Server failed to start:', e.message);
  }

  if (!process.argv.includes('--hidden') && !settings.startMinimized) {
    createWindow();
  }

  // Auto-check for updates 8s after launch
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
    if (_readyInstallerPath) return;
    const info = await checkForUpdate();
    if (info.hasUpdate && info.assetUrl) {
      sendToRenderer('available', { version: info.latest });
      downloadSilently(info.assetUrl, info.assetName, info.assetSize);
    }
  }, 2 * 60 * 60 * 1000);
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } else createWindow();
});
app.on('activate', () => { if (!win) createWindow(); });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !settings.minimizeToTray) app.quit();
});
