// Fetches the Mapbox token from the server so the .env secret token is used.
// In Electron, window.location.origin = http://localhost:3001 which is NOT
// on the Mapbox public token allowlist — a secret token (no URL restrictions)
// set via MAPBOX_TOKEN in .env is required.
window.MAPBOX_TOKEN = '';
window._tokenReady = fetch('/api/config')
  .then(r => r.json())
  .then(d => {
    if (d && d.mapboxToken) {
      window.MAPBOX_TOKEN = d.mapboxToken;
    } else {
      throw new Error('no token in config');
    }
  })
  .catch(() => {
    // Hard fallback — public token only works in browser with URL allowlist set
    window.MAPBOX_TOKEN = 'pk.eyJ1Ijoic3Rvcm0tc3VyZ2UiLCJhIjoiY21scmM2Y3N3MDEzYjNmczViemZueTZuMSJ9.yHlnNztU7CgMaXUNuCzCrg';
  });
