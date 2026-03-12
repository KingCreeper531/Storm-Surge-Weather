// Storm Surge Weather — Mapbox token loader
// Token is fetched from the server at runtime so it can be set via .env
// without being hardcoded in the repo.

// Fallback: hardcoded token used only if the server fetch fails
const MAPBOX_TOKEN_FALLBACK = 'pk.eyJ1Ijoic3Rvcm0tc3VyZ2UiLCJhIjoiY21scmM2Y3N3MDEzYjNmczViemZueTZuMSJ9.yHlnNztU7CgMaXUNuCzCrg';

let MAPBOX_TOKEN = MAPBOX_TOKEN_FALLBACK;

// Fetch from server — this runs before app.js because of script order.
// We use a synchronous-style pattern: store a promise that app.js can await.
window._tokenReady = (async function loadToken() {
  try {
    const r = await fetch('/api/config');
    if (!r.ok) throw new Error('config ' + r.status);
    const d = await r.json();
    if (d.mapboxToken && d.mapboxToken.length > 20) {
      MAPBOX_TOKEN = d.mapboxToken;
    }
  } catch (e) {
    console.warn('[token.js] Could not fetch server config, using fallback token:', e.message);
  }
  return MAPBOX_TOKEN;
})();
