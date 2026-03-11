// ================================================================
//  NEXRAD VIEWER v13.7
//  Single-site WSR-88D + TDWR radar via Iowa State IEM tile service
//
//  Products:
//    N0Q — Base Reflectivity (0.5° tilt)   — precipitation intensity
//    N0U — Base Velocity                   — wind movement / rotation
//    N0C — Correlation Coefficient (CC)    — tornado debris signature
//    N0X — Differential Reflectivity (ZDR) — rain/hail discrimination
//    EET — Echo Tops                       — storm height in kft
//    DAA — Digital Precip Accumulation     — total rainfall
//
//  IEM tile URL:
//    https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/{PRODUCT}_{STATION}/{z}/{x}/{y}.png
//
//  Usage:
//    NexradViewer.init(map, apiBase)
//    NexradViewer.setStation('KBMX')
//    NexradViewer.setProduct('N0Q')
//    NexradViewer.setOpacity(0.75)
//    NexradViewer.setVisible(true/false)
//    NexradViewer.loadNearest(lat, lng)
//    NexradViewer.destroy()
//
//  Callbacks:
//    NexradViewer.onStationChange = (station) => {}
//    NexradViewer.onProductChange = (product) => {}
//    NexradViewer.onStationsLoaded = (stations) => {}
//    NexradViewer.onError = (msg) => {}
// ================================================================

'use strict';

window.NexradViewer = (function () {

  // ── Constants ─────────────────────────────────────────────────
  const PRODUCTS = [
    { id: 'N0Q', label: 'REF',  name: 'Reflectivity',           desc: 'Precipitation intensity',                  color: '#06b6d4' },
    { id: 'N0U', label: 'VEL',  name: 'Velocity',               desc: 'Wind movement / storm rotation',            color: '#a855f7' },
    { id: 'N0C', label: 'CC',   name: 'Correlation Coefficient', desc: 'Tornado debris detection (TDS)',            color: '#f59e0b' },
    { id: 'N0X', label: 'ZDR',  name: 'Diff. Reflectivity',     desc: 'Rain vs hail discrimination',               color: '#22c55e' },
    { id: 'EET', label: 'TOPS', name: 'Echo Tops',              desc: 'Storm top height (kft)',                    color: '#f97316' },
    { id: 'DAA', label: 'ACCUM',name: 'Precip Accum.',          desc: 'Total rainfall accumulation',               color: '#3b82f6' },
  ];

  const LAYER_SOURCE = 'nexrad-src';
  const LAYER_ID     = 'nexrad-layer';

  // Legend images from IEM
  const LEGEND_URL = {
    N0Q:  'https://mesonet.agron.iastate.edu/GIS/legends/N0Q.png',
    N0U:  'https://mesonet.agron.iastate.edu/GIS/legends/N0U.png',
    N0C:  'https://mesonet.agron.iastate.edu/GIS/legends/N0C.png',
    N0X:  'https://mesonet.agron.iastate.edu/GIS/legends/N0X.png',
    EET:  'https://mesonet.agron.iastate.edu/GIS/legends/EET.png',
    DAA:  'https://mesonet.agron.iastate.edu/GIS/legends/DAA.png',
  };

  // ── State ─────────────────────────────────────────────────────
  let _map       = null;
  let _apiBase   = '';
  let _station   = null;   // e.g. 'KBMX'
  let _product   = 'N0Q';
  let _opacity   = 0.75;
  let _visible   = true;
  let _stations  = [];     // loaded station list
  let _ready     = false;

  // ── Public callbacks ──────────────────────────────────────────
  let onStationChange  = null;
  let onProductChange  = null;
  let onStationsLoaded = null;
  let onError          = null;

  // ── Internal helpers ──────────────────────────────────────────
  function tileUrl(station, product) {
    // Route through our own backend proxy so no CORS issues
    return `${_apiBase}/api/nexrad/tile/${station}/${product}/{z}/{x}/{y}`;
  }

  function removeLayer() {
    if (!_map) return;
    try { if (_map.getLayer(LAYER_ID)) _map.removeLayer(LAYER_ID); } catch (e) {}
    try { if (_map.getSource(LAYER_SOURCE)) _map.removeSource(LAYER_SOURCE); } catch (e) {}
  }

  function addLayer() {
    if (!_map || !_station || !_visible) return;
    removeLayer();
    try {
      _map.addSource(LAYER_SOURCE, {
        type: 'raster',
        tiles: [tileUrl(_station, _product)],
        tileSize: 256,
        minzoom: 3,
        maxzoom: 12,
        // IEM NEXRAD tiles use standard Web Mercator (EPSG:3857)
        scheme: 'xyz'
      });
      _map.addLayer({
        id:     LAYER_ID,
        type:   'raster',
        source: LAYER_SOURCE,
        paint:  {
          'raster-opacity':     _opacity,
          'raster-resampling':  'linear',
          'raster-fade-duration': 200
        }
      });
    } catch (e) {
      console.warn('[NexradViewer] addLayer error:', e);
      if (onError) onError('Failed to add NEXRAD layer: ' + e.message);
    }
  }

  // Wait for style to load before adding layers
  function whenReady(fn) {
    if (!_map) return;
    if (_map.isStyleLoaded()) { fn(); }
    else { _map.once('style.load', fn); }
  }

  // ── Public API ────────────────────────────────────────────────
  const API = {

    get products() { return PRODUCTS; },
    get currentStation() { return _station; },
    get currentProduct() { return _product; },
    get stations() { return _stations; },

    // Callbacks
    set onStationChange(fn)  { onStationChange  = fn; },
    set onProductChange(fn)  { onProductChange  = fn; },
    set onStationsLoaded(fn) { onStationsLoaded = fn; },
    set onError(fn)          { onError          = fn; },

    init(map, apiBase) {
      _map     = map;
      _apiBase = (apiBase || '').replace(/\/$/, '');
      _ready   = true;

      // Re-add layer after style changes (e.g. theme switch)
      _map.on('style.load', () => {
        if (_station && _visible) addLayer();
      });
    },

    // Load the nearest stations to a lat/lng and auto-select closest
    async loadNearest(lat, lng) {
      try {
        const r = await fetch(`${_apiBase}/api/nexrad/nearest?lat=${lat}&lng=${lng}&n=15`);
        if (!r.ok) throw new Error('nearest: ' + r.status);
        const d = await r.json();
        _stations = d.stations || [];
        if (onStationsLoaded) onStationsLoaded(_stations);
        // Auto-select closest WSR-88D first, then TDWR
        const best = _stations.find(s => s.type === 'WSR-88D') || _stations[0];
        if (best) API.setStation(best.id);
        return _stations;
      } catch (e) {
        console.warn('[NexradViewer] loadNearest failed:', e);
        if (onError) onError('Could not load nearby stations');
        return [];
      }
    },

    // Load full station list (for station search)
    async loadAllStations() {
      try {
        const r = await fetch(`${_apiBase}/api/nexrad/stations`);
        if (!r.ok) throw new Error('stations: ' + r.status);
        const d = await r.json();
        _stations = d.stations || [];
        if (onStationsLoaded) onStationsLoaded(_stations);
        return _stations;
      } catch (e) {
        console.warn('[NexradViewer] loadAllStations failed:', e);
        return [];
      }
    },

    setStation(stationId) {
      if (!stationId || !/^[A-Z][A-Z0-9]{3}$/.test(stationId)) return;
      _station = stationId.toUpperCase();
      whenReady(() => { if (_visible) addLayer(); });
      if (onStationChange) onStationChange(_station);
    },

    setProduct(productId) {
      if (!PRODUCTS.find(p => p.id === productId)) return;
      _product = productId;
      // Update the tile source URL in-place — remove and re-add
      whenReady(() => { if (_station && _visible) addLayer(); });
      if (onProductChange) onProductChange(_product);
    },

    setOpacity(val) {
      _opacity = Math.max(0, Math.min(1, val));
      if (_map && _map.getLayer(LAYER_ID)) {
        _map.setPaintProperty(LAYER_ID, 'raster-opacity', _opacity);
      }
    },

    setVisible(v) {
      _visible = !!v;
      if (_visible) {
        whenReady(() => { if (_station) addLayer(); });
      } else {
        removeLayer();
      }
    },

    // Return legend URL for current product
    getLegendUrl(productId) {
      return LEGEND_URL[productId || _product] || null;
    },

    // Get station info by id from loaded list
    getStation(id) {
      return _stations.find(s => s.id === id) || null;
    },

    destroy() {
      removeLayer();
      _map     = null;
      _station = null;
      _ready   = false;
    }
  };

  return API;
})();
