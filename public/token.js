// Storm Surge — Token loader v14.1
// Token is set synchronously so map never waits
// The token below is a PUBLIC token — add yours to .env as MAPBOX_TOKEN for production

(function() {
  // Hardcoded public token - set in .env to override
  var FALLBACK = 'pk.eyJ1Ijoic3Rvcm0tc3VyZ2UiLCJhIjoiY21tb3lsZXg3MDlyeTJwcHoxYjZ4emNudiJ9.de5YAbfQMvSzpVNH8QxmGw';
  
  // Set synchronously immediately
  window.MAPBOX_TOKEN = FALLBACK;
  
  // Try to get a better token from the server config
  window._tokenReady = fetch('/api/config', { signal: AbortSignal.timeout(3000) })
    .then(function(r) { return r.json(); })
    .then(function(d) { 
      if (d && d.mapboxToken && d.mapboxToken.startsWith('pk.')) {
        window.MAPBOX_TOKEN = d.mapboxToken;
      }
    })
    .catch(function() {
      // Silently keep the fallback - already set above
    });
})();
