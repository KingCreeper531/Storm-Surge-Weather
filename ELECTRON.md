# Storm Surge Weather — Desktop App (Electron)

This guide packages Storm Surge Weather as a native desktop app (.exe / .dmg / .AppImage).

---

## Prerequisites

- Node.js 18+ installed
- Your repo cloned locally
- `MAPBOX_TOKEN` environment variable set (see bottom of this doc)

---

## Step 1 — Install Electron dependencies

```bash
npm install --save-dev electron electron-builder
```

---

## Step 2 — Add scripts to package.json

Open `package.json` and add/update the `scripts` and `build` sections:

```json
{
  "scripts": {
    "start": "node server.js",
    "electron": "electron electron-main.js",
    "dist": "electron-builder"
  },
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
}
```

---

## Step 3 — Test it locally first

```bash
npm run electron
```

This opens the app in a native window without building an installer. Make sure it loads correctly before packaging.

---

## Step 4 — Build the installer

```bash
npm run dist
```

Output goes to the `dist/` folder:
- **Windows** → `dist/Storm Surge Weather Setup x.x.x.exe`
- **macOS** → `dist/Storm Surge Weather-x.x.x.dmg`
- **Linux** → `dist/Storm Surge Weather-x.x.x.AppImage`

---

## Mapbox Token

The app reads `MAPBOX_TOKEN` from the environment. For the packaged desktop app, you have two options:

### Option A — Set environment variable before running
```bash
# Windows (PowerShell)
$env:MAPBOX_TOKEN="pk.your_token_here"
npm run electron

# macOS/Linux
MAPBOX_TOKEN=pk.your_token_here npm run electron
```

### Option B — Hardcode it in a token file (easier for distribution)

Create `public/token.js`:
```js
window.MAPBOX_TOKEN = 'pk.your_token_here';
```

Then in `public/index.html`, add before other scripts:
```html
<script src="/token.js"></script>
```

And update `server.js` to serve it, or just rely on the static file middleware already in place.

---

## Notes

- The Electron app runs the full Express server internally — no separate server needed
- All API calls go through `localhost:3001` just like the web version
- The window is 1400×900 minimum, resizable
- Menu bar is hidden for a clean app feel
