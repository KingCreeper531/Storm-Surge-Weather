// ================================================================
//  STORM SURGE WEATHER — Backend Server v13.7
//  Node.js + Express
//  All-free stack: Open-Meteo, RainViewer, NWS, AQI, Marine, NEXRAD
// ================================================================

try { require('dotenv').config(); } catch(e) {}

const express   = require('express');
const cors      = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const https     = require('https');
const http      = require('http');

const app   = express();
const cache = new NodeCache({ stdTTL: 600 });

const PORT        = process.env.PORT || 3001;
const APP_VERSION = '13.7.0';
const GITHUB_REPO = 'KingCreeper531/Storm-Surge-Weather';

app.use(cors({ origin: '*', methods: ['GET','POST'] }));
app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({ windowMs: 60*1000, max: 120, message: { error: 'Too many requests' } });
app.use('/api/', apiLimiter);

async function apiFetch(url, ttl, cacheKey) {
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit) return { ...hit, _cached: true };
  }
  const r = await fetch(url, { headers: { 'User-Agent': 'StormSurgeWeather/13.7' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  const data = await r.json();
  if (cacheKey && ttl) cache.set(cacheKey, data, ttl);
  return data;
}

// ── Simple redirect-following fetch for binary data ──────────────────
function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'StormSurgeWeather/13.7' } }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        return fetchBinary(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), type: res.headers['content-type'] || 'image/png' }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ================================================================
//  UPDATE CHECK
// ================================================================
app.get('/api/app-version', async (req, res) => {
  try {
    const cacheKey = 'gh_release';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const ghData = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { 'User-Agent': 'StormSurgeWeather/13.7' } }
    );
    if (!ghData.ok) throw new Error('GitHub API error');
    const release = await ghData.json();
    const latest  = (release.tag_name || '').replace(/^v/, '');
    const asset   = (release.assets || []).find(a => a.name.endsWith('.exe') || a.name.toLowerCase().includes('setup'));
    const result  = {
      current:      APP_VERSION,
      latest:       latest || APP_VERSION,
      hasUpdate:    !!(latest && latest !== APP_VERSION),
      releaseUrl:   release.html_url || `https://github.com/${GITHUB_REPO}/releases`,
      releaseName:  release.name || `v${latest}`,
      releaseNotes: (release.body || '').slice(0, 500),
      assetUrl:     asset?.browser_download_url || null,
      assetName:    asset?.name || null,
      assetSize:    asset?.size || 0
    };
    cache.set(cacheKey, result, 3600);
    res.json(result);
  } catch (e) {
    res.json({ current: APP_VERSION, latest: APP_VERSION, hasUpdate: false });
  }
});

// ================================================================
//  WEATHER
// ================================================================
app.get('/api/weather', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return res.status(400).json({ error: 'valid lat and lng required' });
  const key = `wx_${lat.toFixed(2)}_${lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return res.json({ ...hit, _cached: true });
  try {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${lat}&longitude=${lng}`
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,rain,snowfall,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,cloud_cover,visibility,uv_index,is_day'
      + '&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,visibility,cloud_cover'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,daylight_duration,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,precipitation_hours'
      + '&forecast_days=10&temperature_unit=celsius&wind_speed_unit=ms&precipitation_unit=mm&timezone=auto';
    const d = await apiFetch(url, 600, null);
    cache.set(key, d, 600);
    res.json(d);
  } catch (e) {
    res.status(502).json({ error: 'Weather data unavailable', detail: e.message });
  }
});

// ================================================================
//  AIR QUALITY
// ================================================================
app.get('/api/airquality', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return res.status(400).json({ error: 'valid lat and lng required' });
  const key = `aqi_${lat.toFixed(2)}_${lng.toFixed(2)}`;
  try {
    const url = 'https://air-quality-api.open-meteo.com/v1/air-quality'
      + `?latitude=${lat}&longitude=${lng}`
      + '&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,aerosol_optical_depth,dust,us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_nitrogen_dioxide,us_aqi_ozone'
      + '&hourly=pm2_5,pm10,us_aqi&forecast_days=3&timezone=auto';
    const d = await apiFetch(url, 1800, key);
    res.json(d);
  } catch (e) {
    res.status(502).json({ error: 'AQI unavailable' });
  }
});

// ================================================================
//  MARINE
// ================================================================
app.get('/api/marine', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return res.status(400).json({ error: 'valid lat and lng required' });
  const key = `marine_${lat.toFixed(2)}_${lng.toFixed(2)}`;
  try {
    const url = 'https://marine-api.open-meteo.com/v1/marine'
      + `?latitude=${lat}&longitude=${lng}`
      + '&current=wave_height,wave_direction,wave_period,wind_wave_height,wind_wave_direction,swell_wave_height,swell_wave_direction,swell_wave_period,ocean_current_velocity,ocean_current_direction'
      + '&hourly=wave_height,wave_direction,wave_period,swell_wave_height,wind_wave_height&forecast_days=3&timezone=auto';
    const d = await apiFetch(url, 3600, key);
    res.json(d);
  } catch (e) {
    res.status(404).json({ error: 'Marine data not available for this location' });
  }
});

// ================================================================
//  RADAR (RainViewer — composite mosaic)
// ================================================================
app.get('/api/radar/frames', async (req, res) => {
  try {
    const d = await apiFetch('https://api.rainviewer.com/public/weather-maps.json', 60, 'rv_frames');
    const past = d?.radar?.past?.slice(-12) || [];
    const nowcast = d?.radar?.nowcast?.slice(0, 3) || [];
    if (!past.length) throw new Error('No frames');
    res.json({ past, nowcast, satellite: d?.satellite?.infrared?.slice(-6) || [], source: 'rainviewer' });
  } catch (e) {
    res.status(502).json({ error: 'Radar unavailable', detail: e.message });
  }
});

app.get('/api/radar/tile', async (req, res) => {
  const tilePath = String(req.query.path || '');
  if (!tilePath || tilePath.includes('..')) return res.status(400).json({ error: 'Invalid path' });
  const safe = tilePath.replace(/^\/+/, '');
  const url = `https://tilecache.rainviewer.com/${safe}`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type', r.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'public, max-age=120');
    res.send(buf);
  } catch (e) {
    const empty = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n1QAAAAASUVORK5CYII=', 'base64');
    res.set('Content-Type', 'image/png');
    res.send(empty);
  }
});

// ================================================================
//  NEXRAD — Single-site WSR-88D + TDWR via Iowa State IEM
// ================================================================

// Whitelist of allowed NEXRAD products (IEM layer names use STATION_PRODUCT format)
const NEXRAD_PRODUCTS = new Set(['N0Q','N0U','N0C','N0X','EET','DAA','N0H','NTP']);
const STATION_RE = /^[A-Z][A-Z0-9]{3}$/;  // e.g. KBMX, TDFW

// GET /api/nexrad/stations — full NWS station list (cached 24h)
app.get('/api/nexrad/stations', async (req, res) => {
  const cacheKey = 'nexrad_stations';
  const cached   = cache.get(cacheKey);
  if (cached) return res.json(cached);
  try {
    const r = await fetch('https://api.weather.gov/radar/stations', {
      headers: { 'User-Agent': '(StormSurgeWeather/13.7)', 'Accept': 'application/geo+json' }
    });
    if (!r.ok) throw new Error('NWS stations: ' + r.status);
    const d = await r.json();
    // Normalize to a flat list for the frontend
    const stations = (d.features || []).map(f => ({
      id:   f.properties.stationIdentifier,
      name: f.properties.name,
      type: f.properties.stationType,  // WSR-88D | TDWR | etc.
      lat:  f.geometry?.coordinates?.[1] || 0,
      lng:  f.geometry?.coordinates?.[0] || 0,
      elevation: f.properties.elevation?.value || 0
    })).filter(s => s.id && STATION_RE.test(s.id));
    const result = { stations, count: stations.length, source: 'NWS' };
    cache.set(cacheKey, result, 86400);  // 24h
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: 'Station list unavailable', detail: e.message });
  }
});

// GET /api/nexrad/nearest?lat=&lng=&n= — nearest N stations by haversine
app.get('/api/nexrad/nearest', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const n   = Math.min(20, Math.max(1, Number(req.query.n) || 10));
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return res.status(400).json({ error: 'valid lat and lng required' });

  // Try cache
  const cacheKey = 'nexrad_stations';
  let stationData = cache.get(cacheKey);
  if (!stationData) {
    try {
      const r = await fetch('https://api.weather.gov/radar/stations', {
        headers: { 'User-Agent': '(StormSurgeWeather/13.7)', 'Accept': 'application/geo+json' }
      });
      const d = await r.json();
      const stations = (d.features || []).map(f => ({
        id:   f.properties.stationIdentifier,
        name: f.properties.name,
        type: f.properties.stationType,
        lat:  f.geometry?.coordinates?.[1] || 0,
        lng:  f.geometry?.coordinates?.[0] || 0
      })).filter(s => s.id && STATION_RE.test(s.id));
      stationData = { stations };
      cache.set(cacheKey, stationData, 86400);
    } catch (e) {
      return res.status(502).json({ error: 'Could not load station list' });
    }
  }

  // Haversine distance in km
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  const withDist = stationData.stations
    .map(s => ({ ...s, distKm: Math.round(haversine(lat, lng, s.lat, s.lng)) }))
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, n);

  res.json({ stations: withDist, lat, lng });
});

// GET /api/nexrad/tile/:station/:product/:z/:x/:y — proxy IEM NEXRAD tiles
// IEM tile URL: https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/{PRODUCT}_{STATION}/{z}/{x}/{y}.png
app.get('/api/nexrad/tile/:station/:product/:z/:x/:y', async (req, res) => {
  const { station, product } = req.params;
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);

  // Validate all params before making any external request
  if (!STATION_RE.test(station))                return res.status(400).json({ error: 'Invalid station' });
  if (!NEXRAD_PRODUCTS.has(product))            return res.status(400).json({ error: 'Invalid product' });
  if (!Number.isInteger(z) || z < 0 || z > 20) return res.status(400).json({ error: 'Invalid z' });
  if (!Number.isInteger(x) || x < 0)           return res.status(400).json({ error: 'Invalid x' });
  if (!Number.isInteger(y) || y < 0)            return res.status(400).json({ error: 'Invalid y' });

  // IEM layer format: N0Q_KBMX (product first, then underscore, then station)
  const iemLayer = `${product}_${station}`;
  const url = `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${iemLayer}/${z}/${x}/${y}.png`;

  // 1x1 transparent PNG fallback
  const empty = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n1QAAAAASUVORK5CYII=', 'base64');

  try {
    const { buf, type } = await fetchBinary(url);
    res.set('Content-Type', type);
    res.set('Cache-Control', 'public, max-age=60');  // NEXRAD updates ~5min, cache 1min
    res.send(buf);
  } catch (e) {
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=10');
    res.send(empty);
  }
});

// ================================================================
//  OVERLAY TILES
// ================================================================
app.get('/api/tiles/:layer/:z/:x/:y', (req, res) => {
  const layer = req.params.layer;
  const z = Number(req.params.z), x = Number(req.params.x), y = Number(req.params.y);
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y))
    return res.status(400).json({ error: 'Invalid coords' });
  const palettes = {
    temperature: ['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#d7191c'],
    wind_speed:  ['#1a1a2e','#16213e','#0f3460','#533483','#e94560'],
    cloud_cover: ['#0d0d0d','#2a2a2a','#555','#888','#bbb','#e8e8e8'],
    pressure:    ['#023858','#045a8d','#0570b0','#3690c0','#74a9cf','#a6bddb']
  };
  const pal = palettes[layer] || palettes.temperature;
  const seed = Math.abs((x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ layer.length * 9999);
  const c1 = pal[seed % pal.length], c2 = pal[(seed >> 2) % pal.length];
  const op1 = (0.12 + (seed % 17) * 0.01).toFixed(2), op2 = (0.25 + (seed % 11) * 0.015).toFixed(2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><radialGradient id="g" cx="50%" cy="50%" r="60%"><stop offset="0%" stop-color="${c1}" stop-opacity="${op2}"/><stop offset="100%" stop-color="${c2}" stop-opacity="${op1}"/></radialGradient></defs><rect width="256" height="256" fill="url(#g)"/></svg>`;
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'public, max-age=600');
  res.send(svg);
});

// ================================================================
//  STORM REPORTS
// ================================================================
app.get('/api/storm-reports', async (req, res) => {
  try {
    const r = await fetch('https://www.spc.noaa.gov/climo/reports/today_filtered_torn.csv',
      { headers: { 'User-Agent': 'StormSurgeWeather/13.7' } });
    if (!r.ok) throw new Error('SPC ' + r.status);
    const text = await r.text();
    const lines = text.trim().split('\n').slice(1);
    const items = lines.slice(0, 50).map((line, i) => {
      const parts = line.split(',');
      return { id: 'sr-'+i, type: 'tornado', lat: parseFloat(parts[5])||0, lng: parseFloat(parts[6])||0,
        magnitude: parts[3]||'EF?', text: parts[7]||'Tornado report', ts: new Date().toISOString() };
    }).filter(r => r.lat !== 0);
    res.json({ items, source: 'spc' });
  } catch (e) {
    res.json({ items: [], source: 'unavailable' });
  }
});

app.get('/api/storm-cells', async (req, res) => res.json({ cells: [], source: 'spc' }));
app.get('/api/mcd',         async (req, res) => res.json({ features: [], type: 'FeatureCollection', source: 'spc' }));

// ================================================================
//  HEALTH / VERSION
// ================================================================
app.get('/api/health',  (req, res) => res.json({ status: 'ok', version: APP_VERSION, uptime: Math.round(process.uptime())+'s', timestamp: new Date().toISOString() }));
app.get('/api/version', (req, res) => res.json({ name: 'Storm Surge Weather', version: APP_VERSION, stack: 'Open-Meteo + RainViewer + NWS + NEXRAD/IEM', timestamp: new Date().toISOString() }));

// ================================================================
//  SERVE FRONTEND
// ================================================================
const frontendPath = path.join(__dirname, 'public');
app.use(express.static(frontendPath));
app.get('*', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

app.listen(PORT, () => console.log(`⛈  Storm Surge Weather v${APP_VERSION} running on port ${PORT}`));
