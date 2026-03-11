// ================================================================
//  STORM SURGE WEATHER — NEXRAD Single-Site Radar Engine v13.7
//
//  Provides live WSR-88D / TDWR single-site radar tiles via Iowa
//  State IEM, sourced through the /api/nexrad/* proxy in server.js.
//
//  Products:
//    N0Q — Base Reflectivity (dBZ)  ← default
//    N0U — Base Velocity (m/s)
//    N0C — Correlation Coefficient  ← tornado debris
//    N0X — Differential Reflectivity
//    EET — Echo Tops
//    DAA — Digital Accumulation Array (QPE)
//
//  Public API  (window.NexradRadar)
//    init(map, apiBase)
//    show(stationId, product)
//    hide()
//    setProduct(product)
//    setOpacity(0–1)
//    loadNearestStation(lat, lng)
//    getActiveStation()
//    getProducts()
//    destroy()
//    onStationChange   callback(station)  — fired after show()
//    onProductChange   callback(product)
// ================================================================
(function () {
  'use strict';

  // ── Product metadata ─────────────────────────────────────────
  const PRODUCTS = {
    N0Q: { label: 'Reflectivity',         unit: 'dBZ',  desc: 'Base reflectivity — precipitation intensity', colorHint: '#06b6d4' },
    N0U: { label: 'Velocity',             unit: 'm/s',  desc: 'Base velocity — wind movement relative to radar', colorHint: '#a855f7' },
    N0C: { label: 'Corr. Coefficient',    unit: 'CC',   desc: 'Correlation coefficient — identifies tornado debris', colorHint: '#f59e0b' },
    N0X: { label: 'Diff. Reflectivity',   unit: 'dB',   desc: 'Differential reflectivity — drop shape/size', colorHint: '#22c55e' },
    EET: { label: 'Echo Tops',            unit: 'kft',  desc: 'Echo tops — storm height estimation', colorHint: '#f97316' },
    DAA: { label: 'Precip Accumulation',  unit: 'in',   desc: 'Digital accumulation — rainfall totals', colorHint: '#3b82f6' }
  };

  // ── Layer IDs ─────────────────────────────────────────────────
  const SRC_ID   = 'nexrad-tiles-src';
  const RING_SRC = 'nexrad-rings-src';
  const RING_LYR = 'nexrad-rings';
  const LABEL_SRC= 'nexrad-label-src';
  const LABEL_LYR= 'nexrad-label';

  // ── State ─────────────────────────────────────────────────────
  let _map         = null;
  let _apiBase     = '';
  let _station     = null;
  let _product     = 'N0Q';
  let _opacity     = 0.85;
  let _visible     = false;
  let _refreshTimer= null;
  const REFRESH_MS = 5 * 60 * 1000;

  // ── Helpers ──────────────────────────────────────────────────
  function nexradTileUrl() {
    const stamp = Math.floor(Date.now() / (5 * 60 * 1000));
    return `${_apiBase}/api/nexrad/tile/${_station.id}/${_product}/{z}/{x}/{y}?_t=${stamp}`;
  }

  function removeMapLayers() {
    if (!_map) return;
    const tileLayerId = 'nexrad-tiles-lyr';
    try { if (_map.getLayer(tileLayerId))  _map.removeLayer(tileLayerId); } catch (e) {}
    try { if (_map.getSource(SRC_ID))      _map.removeSource(SRC_ID);     } catch (e) {}
    try { if (_map.getLayer(RING_LYR))     _map.removeLayer(RING_LYR);    } catch (e) {}
    try { if (_map.getSource(RING_SRC))    _map.removeSource(RING_SRC);   } catch (e) {}
    try { if (_map.getLayer(LABEL_LYR))    _map.removeLayer(LABEL_LYR);   } catch (e) {}
    try { if (_map.getSource(LABEL_SRC))   _map.removeSource(LABEL_SRC);  } catch (e) {}
  }

  function addMapLayers() {
    if (!_map || !_station) return;
    const tileLayerId = 'nexrad-tiles-lyr';

    _map.addSource(SRC_ID, {
      type: 'raster',
      tiles: [nexradTileUrl()],
      tileSize: 256,
      minzoom: 2,
      maxzoom: 12
    });
    _map.addLayer({
      id:     tileLayerId,
      type:   'raster',
      source: SRC_ID,
      paint:  { 'raster-opacity': _opacity, 'raster-fade-duration': 300 }
    });

    // Range rings: 50, 100, 150, 230 km
    const ringFeatures = [50, 100, 150, 230].map(km => circleGeoJSON(_station.lat, _station.lng, km));
    _map.addSource(RING_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: ringFeatures } });
    _map.addLayer({
      id: RING_LYR, type: 'line', source: RING_SRC,
      paint: { 'line-color': 'rgba(255,255,255,0.18)', 'line-width': 1, 'line-dasharray': [4, 4] }
    });

    // Station label
    _map.addSource(LABEL_SRC, {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [_station.lng, _station.lat] },
        properties: { label: `${_station.id} — ${_product}` }
      }
    });
    _map.addLayer({
      id: LABEL_LYR, type: 'symbol', source: LABEL_SRC,
      layout: {
        'text-field':   ['get', 'label'],
        'text-font':    ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size':    11,
        'text-anchor':  'top',
        'text-offset':  [0, 0.5]
      },
      paint: {
        'text-color':       '#ffffff',
        'text-halo-color':  'rgba(0,0,0,0.8)',
        'text-halo-width':  2
      }
    });
  }

  function circleGeoJSON(lat, lng, radiusKm, steps = 64) {
    const R = 6371;
    const coords = [];
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const dLat  = (radiusKm / R) * (180 / Math.PI);
      const dLng  = (radiusKm / R) * (180 / Math.PI) / Math.cos(lat * Math.PI / 180);
      coords.push([lng + dLng * Math.cos(angle), lat + dLat * Math.sin(angle)]);
    }
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { radiusKm } };
  }

  function refreshTiles() {
    if (!_visible || !_map || !_station) return;
    try {
      const src = _map.getSource(SRC_ID);
      if (src) src.setTiles([nexradTileUrl()]);
    } catch (e) {}
  }

  function startRefreshTimer() {
    if (_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(refreshTiles, REFRESH_MS);
  }
  function stopRefreshTimer() {
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  }

  // ── Public API ───────────────────────────────────────────────
  const NexradRadar = {
    onStationChange: null,
    onProductChange: null,

    init(map, apiBase) {
      _map     = map;
      _apiBase = (apiBase || '').replace(/\/$/, '');
    },

    show(stationId, product, stationMeta) {
      if (!_map) return;
      if (product && PRODUCTS[product]) _product = product;
      if (stationMeta) {
        _station = { ...stationMeta, id: stationId };
      } else if (!_station || _station.id !== stationId) {
        _station = { id: stationId, name: stationId, lat: 0, lng: 0, type: 'WSR-88D' };
      }
      removeMapLayers();
      _visible = true;
      addMapLayers();
      startRefreshTimer();
      if (typeof this.onStationChange === 'function') this.onStationChange(_station);
    },

    hide() {
      _visible = false;
      stopRefreshTimer();
      removeMapLayers();
    },

    setProduct(product) {
      if (!PRODUCTS[product]) return;
      _product = product;
      if (_visible && _station) { removeMapLayers(); addMapLayers(); }
      if (typeof this.onProductChange === 'function') this.onProductChange(product);
    },

    setOpacity(val) {
      _opacity = Math.max(0, Math.min(1, val));
      if (!_map || !_visible) return;
      try { _map.setPaintProperty('nexrad-tiles-lyr', 'raster-opacity', _opacity); } catch (e) {}
    },

    async loadNearestStation(lat, lng) {
      if (!_apiBase) return null;
      try {
        const r = await fetch(`${_apiBase}/api/nexrad/nearest?lat=${lat}&lng=${lng}&n=1`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        const st = d.stations?.[0];
        if (!st) return null;
        this.show(st.id, _product, { id: st.id, name: st.name, lat: st.lat, lng: st.lng, type: st.type, distKm: st.distKm });
        return st;
      } catch (e) {
        console.warn('[NexradRadar] loadNearestStation failed:', e.message);
        return null;
      }
    },

    getActiveStation() { return _station ? { ..._station } : null; },
    isVisible()        { return _visible; },
    getProducts()      { return { ...PRODUCTS }; },
    getActiveProduct() { return _product; },
    refresh()          { refreshTiles(); },

    destroy() {
      stopRefreshTimer();
      removeMapLayers();
      _map = null; _station = null; _visible = false;
    }
  };

  window.NexradRadar = NexradRadar;
})();
