# Storm Surge Weather — Desktop App (Electron)

This guide walks you through packaging Storm Surge Weather as a native desktop app (.exe / .dmg / .AppImage).

---

## Prerequisites

- Node.js 18+ installed
- Your repo cloned locally
- A valid `MAPBOX_TOKEN` environment variable set (see below)

---

## Step 1 — Install Electron dependencies

```bash
npm install --save-dev electron electron-builder
```

---

## Step 2 — Update package.json

Add the following to your `package.json`:

### Scripts section
```json
"scripts": {
  "start": "node server.js",
  "electron": "electron electron-main.js",
  "dist": "electron-builder"
}
```

### Build config (add at root level of package.json)
```json
"build": {
  "appId": "com.stormsurge.weather",
  "productName": "Storm Surge Weather",
  "files": [
    "public/**",
    "server.js",
    "electron-main.js",
    "node_modules/**"
  ],
  "win": {
    "target": "nsis",
    "icon": "public/favicon.ico"
  },
  "mac": {
    "target": "dmg"
  },
  "linux": {
    "target": "AppImage"
  }
}
```

---

## Step 3 — Set your Mapbox token

The app reads `MAPBOX_TOKEN` from the environment. Before running or building, set it:

**Windows (CMD):**
```cmd
set MAPBOX_TOKEN=your_token_here
```

**Windows (PowerShell):**
```powershell
$env:MAPBOX_TOKEN="your_token_here"
```

**Mac/Linux:**
```bash
export MAPBOX_TOKEN=your_token_here
```

> For a permanent packaged build, you can hardcode it in `server.js` as a fallback:
> `const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || 'your_token_here';`

---

## Step 4 — Test it locally first

```bash
npm run electron
```

This opens the app in a native window without building an installer. Make sure everything works before packaging.

---

## Step 5 — Build the installer

```bash
npm run dist
```

Output goes to the `dist/` folder:
- **Windows:** `dist/Storm Surge Weather Setup x.x.x.exe`
- **Mac:** `dist/Storm Surge Weather-x.x.x.dmg`
- **Linux:** `dist/Storm Surge Weather-x.x.x.AppImage`

---

## Notes

- The app spawns your Express server internally — no separate terminal needed
- Port `3001` is used by default (set `PORT` env var to change)
- To build for a different OS from your machine, see [electron-builder docs on cross-compilation](https://www.electron.build/multi-platform-build)
