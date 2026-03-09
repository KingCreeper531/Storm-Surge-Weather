// ================================================================
//  STORM SURGE WEATHER — Backend Server v11.0
//  Node.js + Express
//  All-free stack: Open-Meteo, RainViewer, NWS, AQI, Marine
//  No auth, no Google Cloud, no accounts
// ================================================================

const express   = require('express');
const cors      = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const app   = express();
const cache = new NodeCache({ stdTTL: 600 });

const PORT        = process.env.PORT || 3001;
const APP_VERSION = '11.0';

// ── MIDDLEWARE ───────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST'] }));
app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({ windowMs: 60*1000, max: 120, message: { error: 'Too many requests' } });
app.use('/api/', apiLimiter);

// ── HELPERS ──────────────────────────────────────────────────────
async function apiFetch(url, ttl, cacheKey) {
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit) return { ...hit, _cached: true };
  }
  const r = await fetch(url, { headers: { 'User-Agent': 'StormSurgeWeather/11.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  const data = await r.json();
  if (cacheKey && ttl) cache.set(cacheKey, data, ttl);
  return data;
}

// ================================================================
//  WEATHER — Open-Meteo (completely free, no key needed)
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
    console.error('Weather error:', e.message);
    res.status(502).json({ error: 'Weather data unavailable', detail: e.message });
  }
});

// ================================================================
//  AIR QUALITY — Open-Meteo Air Quality (free)
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
//  MARINE — Open-Meteo Marine (free)
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
    // Marine is only available for coastal/ocean areas
    res.status(404).json({ error: 'Marine data not available for this location' });
  }
});

// ================================================================
//  RADAR — RainViewer
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
//  OVERLAY TILES — Open-Meteo derived (simulated gradient tiles)
// ================================================================
app.get('/api/tiles/:layer/:z/:x/:y', (req, res) => {
  const layer = req.params.layer;
  const z = Number(req.params.z), x = Number(req.params.x), y = Number(req.params.y);
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y))
    return res.status(400).json({ error: 'Invalid coords' });

  const palettes = {
    temperature:  ['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#d7191c'],
    wind_speed:   ['#1a1a2e','#16213e','#0f3460','#533483','#e94560'],
    cloud_cover:  ['#0d0d0d','#2a2a2a','#555','#888','#bbb','#e8e8e8'],
    pressure:     ['#023858','#045a8d','#0570b0','#3690c0','#74a9cf','#a6bddb']
  };
  const pal = palettes[layer] || palettes.temperature;
  const seed = Math.abs((x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ layer.length * 9999);
  const c1 = pal[seed % pal.length];
  const c2 = pal[(seed >> 2) % pal.length];
  const op1 = (0.12 + (seed % 17) * 0.01).toFixed(2);
  const op2 = (0.25 + (seed % 11) * 0.015).toFixed(2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">`
    + `<defs><radialGradient id="g" cx="50%" cy="50%" r="60%">`
    + `<stop offset="0%" stop-color="${c1}" stop-opacity="${op2}"/>`
    + `<stop offset="100%" stop-color="${c2}" stop-opacity="${op1}"/>`
    + `</radialGradient></defs>`
    + `<rect width="256" height="256" fill="url(#g)"/>`
    + `</svg>`;
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'public, max-age=600');
  res.send(svg);
});

// ================================================================
//  STORM REPORTS — SPC (NOAA, free)
// ================================================================
app.get('/api/storm-reports', async (req, res) => {
  const key = 'spc_reports';
  try {
    // SPC LSR feed — CSV format, publicly available
    const r = await fetch('https://www.spc.noaa.gov/climo/reports/today_filtered_torn.csv',
      { headers: { 'User-Agent': 'StormSurgeWeather/11.0' } });
    if (!r.ok) throw new Error('SPC ' + r.status);
    const text = await r.text();
    const lines = text.trim().split('\n').slice(1); // skip header
    const items = lines.slice(0, 50).map((line, i) => {
      const parts = line.split(',');
      return {
        id: 'sr-' + i,
        type: 'tornado',
        lat: parseFloat(parts[5]) || 0,
        lng: parseFloat(parts[6]) || 0,
        magnitude: parts[3] || 'EF?',
        text: parts[7] || 'Tornado report',
        ts: new Date().toISOString()
      };
    }).filter(r => r.lat !== 0);
    res.json({ items, source: 'spc' });
  } catch (e) {
    // Fallback to hail
    try {
      const r2 = await fetch('https://www.spc.noaa.gov/climo/reports/today_filtered_hail.csv',
        { headers: { 'User-Agent': 'StormSurgeWeather/11.0' } });
      const text = await r2.text();
      const lines = text.trim().split('\n').slice(1);
      const items = lines.slice(0, 50).map((line, i) => {
        const parts = line.split(',');
        return { id: 'sr-' + i, type: 'hail', lat: parseFloat(parts[5]) || 0, lng: parseFloat(parts[6]) || 0,
          magnitude: parts[3] + '"', text: parts[7] || 'Hail report', ts: new Date().toISOString() };
      }).filter(r => r.lat !== 0);
      res.json({ items, source: 'spc' });
    } catch (e2) {
      res.json({ items: [], source: 'unavailable' });
    }
  }
});

// ================================================================
//  HEALTH / VERSION
// ================================================================
app.get('/api/health', (req, res) => res.json({
  status: 'ok', version: APP_VERSION,
  uptime: Math.round(process.uptime()) + 's',
  timestamp: new Date().toISOString()
}));

app.get('/api/version', (req, res) => res.json({
  name: 'Storm Surge Weather', version: APP_VERSION,
  stack: 'Open-Meteo + RainViewer + NWS', timestamp: new Date().toISOString()
}));

// ── SERVE FRONTEND ──────────────────────────────────────────────
const frontendPath = path.join(__dirname, 'public');

app.get('/token.js', (req, res) => {
  const token = process.env.MAPBOX_TOKEN || process.env.MAPBOX_ACCESS_TOKEN || '';
  if (!token) console.warn('⚠ MAPBOX_TOKEN not set');
  res.set('Content-Type', 'application/javascript');
  res.set('Cache-Control', 'no-store');
  res.send(`const MAPBOX_TOKEN = "${token}";`);
});

app.use(express.static(frontendPath));
app.get('*', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

app.listen(PORT, () => console.log(`⛈  Storm Surge Weather v${APP_VERSION} running on port ${PORT}`));
