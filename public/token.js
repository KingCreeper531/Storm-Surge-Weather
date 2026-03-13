// Token is injected at runtime from /api/config (set MAPBOX_TOKEN in .env)
// Falls back to the built-in public token for browser dev use only.
// app.js waits for window._tokenReady before calling initMap().
window._tokenReady = fetch('/api/config')
  .then(r => r.json())
  .then(d => { window.MAPBOX_TOKEN = d.mapboxToken; })
  .catch(() => {
    // fallback — public token, works in browser but NOT in Electron without URL allowlist
    window.MAPBOX_TOKEN = 'pk.eyJ1Ijoic3Rvcm0tc3VyZ2UiLCJhIjoiY21scmM2Y3N3MDEzYjNmczViemZueTZuMSJ9.yHlnNztU7CgMaXUNuCzCrg';
  });
