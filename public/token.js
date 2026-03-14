// Storm Surge token loader — fetches from /api/config then falls back
window.MAPBOX_TOKEN = 'pk.eyJ1Ijoic3Rvcm0tc3VyZ2UiLCJhIjoiY21tb3lsZXg3MDlyeTJwcHoxYjZ4emNudiJ9.de5YAbfQMvSzpVNH8QxmGw';
window._tokenReady = fetch('/api/config')
  .then(r => r.json())
  .then(d => { if (d && d.mapboxToken) window.MAPBOX_TOKEN = d.mapboxToken; })
  .catch(() => {});
