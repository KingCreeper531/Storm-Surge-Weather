// ================================================================
//  STORM SURGE WEATHER — Backend Server v13.8
//  Node.js + Express
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
const APP_VERSION = '13.8.0';
const GITHUB_REPO = 'KingCreeper531/Storm-Surge-Weather';
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY || '';
// Mapbox token — set MAPBOX_TOKEN in .env to override the built-in one.
// Use a token with NO URL restrictions (secret token) for Electron builds.
const MAPBOX_TOKEN_ENV = process.env.MAPBOX_TOKEN || 'pk.eyJ1Ijoic3Rvcm0tc3VyZ2UiLCJhIjoiY21scmM2Y3N3MDEzYjNmczViemZueTZuMSJ9.yHlnNztU7CgMaXUNuCzCrg';

app.use(cors({ origin: '*', methods: ['GET','POST'] }));
app.use(express.json({ limit: '2mb' }));

const apiLimiter = rateLimit({ windowMs: 60*1000, max: 120, message: { error: 'Too many requests' } });
app.use('/api/', apiLimiter);

async function apiFetch(url, ttl, cacheKey) {
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit) return { ...hit, _cached: true };
  }
  const r = await fetch(url, { headers: { 'User-Agent': 'StormSurgeWeather/13.8' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  const data = await r.json();
  if (cacheKey && ttl) cache.set(cacheKey, data, ttl);
  return data;
}

function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'StormSurgeWeather/13.8' } }, (res) => {
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
//  CONFIG — serves runtime config including Mapbox token to frontend
// ================================================================
app.get('/api/config', (req, res) => {
  res.json({
    mapboxToken: MAPBOX_TOKEN_ENV,
    version: APP_VERSION
  });
});

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
      { headers: { 'User-Agent': 'StormSurgeWeather/13.8' } }
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
      + '&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,visibility,cloud_cover,cape,lifted_index'
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
//  SEVERE ANALYSIS
// ================================================================
app.get('/api/severe-analysis', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return res.status(400).json({ error: 'valid lat and lng required' });
  try {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${lat}&longitude=${lng}`
      + '&hourly=temperature_2m,dew_point_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability,precipitation,cape,lifted_index,cloud_cover,visibility,relative_humidity_2m'
      + '&forecast_days=3&temperature_unit=celsius&wind_speed_unit=ms&precipitation_unit=mm&timezone=auto';
    const d = await apiFetch(url, 900, `severe_${lat.toFixed(2)}_${lng.toFixed(2)}`);
    const hours = d.hourly.time.map((t, i) => ({
      time: t,
      tempC: d.hourly.temperature_2m[i],
      dewC:  d.hourly.dew_point_2m[i],
      windMs: d.hourly.wind_speed_10m[i],
      gustMs: d.hourly.wind_gusts_10m[i],
      precipProb: d.hourly.precipitation_probability[i],
      precip: d.hourly.precipitation[i],
      cape:  d.hourly.cape?.[i] || 0,
      li:    d.hourly.lifted_index?.[i] || 0,
      cloud: d.hourly.cloud_cover[i],
      vis:   d.hourly.visibility[i],
      rh:    d.hourly.relative_humidity_2m[i]
    }));
    function analyzeSevereRisk(h) {
      const tags = [];
      const gustMph = (h.gustMs || 0) * 2.237;
      if (h.cape >= 2000) tags.push({ tag: 'significant instability', level: 'high', icon: '⛈' });
      else if (h.cape >= 1000) tags.push({ tag: 'moderate instability', level: 'moderate', icon: '🌩' });
      else if (h.cape >= 500)  tags.push({ tag: 'marginal instability', level: 'low', icon: '🌤' });
      if (h.li <= -6) tags.push({ tag: 'extremely unstable atmosphere', level: 'high', icon: '⚠️' });
      else if (h.li <= -3) tags.push({ tag: 'unstable atmosphere', level: 'moderate', icon: '🌩' });
      if (gustMph >= 60) tags.push({ tag: 'damaging wind potential', level: 'high', icon: '💨' });
      else if (gustMph >= 40) tags.push({ tag: 'strong wind gusts', level: 'moderate', icon: '💨' });
      if (h.precipProb >= 70 && h.precip >= 10) tags.push({ tag: 'heavy rain / flood concern', level: 'high', icon: '🌊' });
      else if (h.precipProb >= 60 && h.precip >= 5) tags.push({ tag: 'moderate rain', level: 'low', icon: '🌧' });
      if ((h.vis || 0) < 1000) tags.push({ tag: 'low visibility / dense fog', level: 'moderate', icon: '🌫' });
      if (h.cape >= 1000 && gustMph >= 35) tags.push({ tag: 'organized severe storms possible', level: 'high', icon: '⛈' });
      if (h.dewC >= 21 && h.tempC >= 30) tags.push({ tag: 'oppressive heat and humidity', level: 'moderate', icon: '🔥' });
      return tags;
    }
    const analyzed  = hours.map(h => ({ ...h, tags: analyzeSevereRisk(h) }));
    const peakHours = analyzed.filter(h => h.tags.length > 0).sort((a, b) => b.cape - a.cape || b.tags.length - a.tags.length).slice(0, 6);
    const maxCape   = Math.max(...hours.map(h => h.cape || 0));
    const maxGust   = Math.max(...hours.map(h => (h.gustMs || 0) * 2.237));
    const allTags   = [...new Set(analyzed.flatMap(h => h.tags.map(t => t.tag)))];
    res.json({ lat, lng, maxCape: Math.round(maxCape), maxGustMph: Math.round(maxGust), summary: allTags, peakHours: peakHours.slice(0, 6), hourly: analyzed.slice(0, 48) });
  } catch (e) {
    res.status(502).json({ error: 'Analysis unavailable', detail: e.message });
  }
});

// ================================================================
//  AI WEATHER ASSISTANT
// ================================================================
app.post('/api/ai-chat', async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(503).json({ error: 'AI assistant not configured. Add ANTHROPIC_API_KEY to .env' });
  const { message, context } = req.body;
  if (!message || typeof message !== 'string' || message.length > 1000) return res.status(400).json({ error: 'Invalid message' });
  const systemPrompt = `You are Storm Surge AI, an expert meteorological assistant embedded in the Storm Surge Weather app.

Current weather context:
${context?.weather ? `Location: ${context.location || 'Unknown'} (${context.lat?.toFixed(2)}, ${context.lng?.toFixed(2)})
Current temp: ${context.weather.current?.temperature_2m?.toFixed(1)}°C
Feels like: ${context.weather.current?.apparent_temperature?.toFixed(1)}°C
Wind: ${context.weather.current?.wind_speed_10m?.toFixed(1)} m/s from ${context.weather.current?.wind_direction_10m}°
Gusts: ${context.weather.current?.wind_gusts_10m?.toFixed(1)} m/s
Humidity: ${context.weather.current?.relative_humidity_2m}%
Pressure: ${context.weather.current?.surface_pressure?.toFixed(0)} hPa
Visibility: ${((context.weather.current?.visibility || 0)/1000).toFixed(1)} km
UV Index: ${context.weather.current?.uv_index}` : 'No current weather data available.'}
${context?.severe ? `
Severe analysis:
Max CAPE next 48h: ${context.severe.maxCape} J/kg
Max gusts: ${context.severe.maxGustMph} mph
Risk tags: ${context.severe.summary?.join(', ') || 'none'}` : ''}
${context?.alerts?.length ? `
Active NWS alerts (${context.alerts.length}):
${context.alerts.slice(0,3).map(a => `- ${a.properties?.event}: ${a.properties?.headline || ''}`).join('\n')}` : '\nNo active NWS alerts.'}
${context?.spotterReports?.length ? `
Recent spotter reports (${context.spotterReports.length}):
${context.spotterReports.slice(0,5).map(r => `- ${r.type}: ${r.description || r.comments || ''} at ${r.city || ''}, ${r.state || ''}`).join('\n')}` : ''}

Be concise, weather-accurate, and practical. Use emoji. Keep responses under 200 words unless detailed analysis is requested.`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 512, system: systemPrompt, messages: [{ role: 'user', content: message }] })
    });
    if (!r.ok) { const err = await r.json().catch(() => ({})); return res.status(502).json({ error: 'AI request failed', detail: err.error?.message || r.status }); }
    const data  = await r.json();
    const reply = data.content?.[0]?.text || 'No response generated.';
    res.json({ reply, model: data.model, tokens: data.usage });
  } catch (e) {
    res.status(502).json({ error: 'AI unavailable', detail: e.message });
  }
});

// ================================================================
//  SPOTTER NETWORK
// ================================================================
app.get('/api/spotter-reports', async (req, res) => {
  const lat  = Number(req.query.lat)  || 0;
  const lng  = Number(req.query.lng)  || 0;
  const dist = Number(req.query.dist) || 300;
  const key  = `spotter_${lat.toFixed(1)}_${lng.toFixed(1)}_${dist}`;
  const cached = cache.get(key);
  if (cached) return res.json({ ...cached, _cached: true });
  const reports = [];
  try {
    const now  = Math.floor(Date.now() / 1000);
    const from = now - 3 * 3600;
    const mUrl = `https://mping.nssl.noaa.gov/mping/api/v2/reports/?format=json&time__gte=${from}&limit=200`;
    const mr   = await fetch(mUrl, { headers: { 'User-Agent': 'StormSurgeWeather/13.8', 'Accept': 'application/json' } });
    if (mr.ok) {
      const md = await mr.json();
      const categoryMap = {
        1:{type:'Rain',icon:'🌧'},2:{type:'Freezing Rain',icon:'🌨'},3:{type:'Snow',icon:'❄️'},
        4:{type:'Ice Pellets/Sleet',icon:'🧊'},5:{type:'Hail',icon:'🧭'},6:{type:'Tornado',icon:'🌪'},
        7:{type:'Thunderstorm',icon:'⛈'},8:{type:'Fog',icon:'🌫'},9:{type:'High Wind',icon:'💨'},
        10:{type:'Blizzard',icon:'🌨'},11:{type:'Lightning',icon:'⚡'},12:{type:'Funnel Cloud',icon:'🌀'},
        13:{type:'Flash Flood',icon:'🌊'},14:{type:'Waterspout',icon:'🌀'},15:{type:'Dense Fog',icon:'🌫'},
        16:{type:'Drizzle',icon:'🌦'},17:{type:'Freezing Fog',icon:'🌫'},18:{type:'Dust Storm',icon:'💨'}
      };
      (md.results || []).forEach(rpt => {
        const cat = categoryMap[rpt.category_id] || { type: `Report #${rpt.category_id}`, icon: '📍' };
        reports.push({ id:`mping-${rpt.id}`, source:'mPing', type:cat.type, icon:cat.icon,
          lat:rpt.geom?.coordinates?.[1]||0, lng:rpt.geom?.coordinates?.[0]||0,
          description:rpt.description||'', comments:rpt.comments||'',
          city:rpt.city||'', state:rpt.state||'', ts:rpt.ob_time||new Date().toISOString(), verified:false });
      });
    }
  } catch(e) { console.warn('mPing fetch failed:', e.message); }
  try {
    const lsrTypes = [
      { url:'https://www.spc.noaa.gov/climo/reports/today_filtered_hail.csv', type:'Hail', icon:'🧭' },
      { url:'https://www.spc.noaa.gov/climo/reports/today_filtered_wind.csv', type:'Wind', icon:'💨' },
      { url:'https://www.spc.noaa.gov/climo/reports/today_filtered_torn.csv', type:'Tornado', icon:'🌪' }
    ];
    for (const src of lsrTypes) {
      const r = await fetch(src.url, { headers: { 'User-Agent': 'StormSurgeWeather/13.8' } });
      if (!r.ok) continue;
      const text  = await r.text();
      const lines = text.trim().split('\n').slice(1);
      lines.slice(0, 60).forEach((line, i) => {
        const p = line.split(',');
        const rlat = parseFloat(p[5])||0, rlng = parseFloat(p[6])||0;
        if (!rlat || !rlng) return;
        reports.push({ id:`spc-${src.type.toLowerCase()}-${i}`, source:'SPC/NWS', type:src.type, icon:src.icon,
          lat:rlat, lng:rlng, description:`${src.type} report — ${p[3]||'?'} magnitude`,
          comments:p[7]||'', city:(p[8]||'').trim(), state:(p[4]||'').trim(),
          ts:new Date().toISOString(), magnitude:p[3]||null, verified:true });
      });
    }
  } catch(e) { console.warn('SPC LSR fetch failed:', e.message); }
  function haversine(lat1, lng1, lat2, lng2) {
    const R=6371, dLat=(lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
    const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }
  const nearby = lat && lng ? reports.filter(r => r.lat && r.lng && haversine(lat,lng,r.lat,r.lng)<=dist) : reports;
  nearby.forEach(r => { if (lat && lng && r.lat && r.lng) r.distKm = Math.round(haversine(lat,lng,r.lat,r.lng)); });
  nearby.sort((a,b) => (a.distKm||999)-(b.distKm||999));
  const result = { reports: nearby.slice(0,150), total: nearby.length, source: 'mPing+SPC' };
  cache.set(key, result, 300);
  res.json(result);
});

// ================================================================
//  AIR QUALITY
// ================================================================
app.get('/api/airquality', async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat)||!Number.isFinite(lng)) return res.status(400).json({ error: 'valid lat and lng required' });
  try {
    const url = 'https://air-quality-api.open-meteo.com/v1/air-quality'
      + `?latitude=${lat}&longitude=${lng}`
      + '&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,aerosol_optical_depth,dust,us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_nitrogen_dioxide,us_aqi_ozone'
      + '&hourly=pm2_5,pm10,us_aqi&forecast_days=3&timezone=auto';
    res.json(await apiFetch(url, 1800, `aqi_${lat.toFixed(2)}_${lng.toFixed(2)}`));
  } catch(e) { res.status(502).json({ error: 'AQI unavailable' }); }
});

// ================================================================
//  MARINE
// ================================================================
app.get('/api/marine', async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat)||!Number.isFinite(lng)) return res.status(400).json({ error: 'valid lat and lng required' });
  try {
    const url = 'https://marine-api.open-meteo.com/v1/marine'
      + `?latitude=${lat}&longitude=${lng}`
      + '&current=wave_height,wave_direction,wave_period,wind_wave_height,wind_wave_direction,swell_wave_height,swell_wave_direction,swell_wave_period,ocean_current_velocity,ocean_current_direction'
      + '&hourly=wave_height,wave_direction,wave_period,swell_wave_height,wind_wave_height&forecast_days=3&timezone=auto';
    res.json(await apiFetch(url, 3600, `marine_${lat.toFixed(2)}_${lng.toFixed(2)}`));
  } catch(e) { res.status(404).json({ error: 'Marine data not available for this location' }); }
});

// ================================================================
//  RADAR
// ================================================================
app.get('/api/radar/frames', async (req, res) => {
  try {
    const d = await apiFetch('https://api.rainviewer.com/public/weather-maps.json', 60, 'rv_frames');
    const past = d?.radar?.past?.slice(-12) || [];
    const nowcast = d?.radar?.nowcast?.slice(0, 3) || [];
    if (!past.length) throw new Error('No frames');
    res.json({ past, nowcast, satellite: d?.satellite?.infrared?.slice(-6) || [], source: 'rainviewer' });
  } catch(e) { res.status(502).json({ error: 'Radar unavailable', detail: e.message }); }
});

app.get('/api/radar/tile', async (req, res) => {
  const tilePath = String(req.query.path || '');
  if (!tilePath || tilePath.includes('..')) return res.status(400).json({ error: 'Invalid path' });
  const url = `https://tilecache.rainviewer.com/${tilePath.replace(/^\/+/, '')}`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type', r.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'public, max-age=120');
    res.send(buf);
  } catch(e) {
    const empty = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n1QAAAAASUVORK5CYII=','base64');
    res.set('Content-Type','image/png'); res.send(empty);
  }
});

// ================================================================
//  NEXRAD
// ================================================================
const NEXRAD_PRODUCTS = new Set(['N0Q','N0U','N0C','N0X','EET','DAA','N0H','NTP']);
const STATION_RE = /^[A-Z][A-Z0-9]{3}$/;

app.get('/api/nexrad/stations', async (req, res) => {
  const cacheKey = 'nexrad_stations';
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);
  try {
    const r = await fetch('https://api.weather.gov/radar/stations', { headers: { 'User-Agent': '(StormSurgeWeather/13.8)', 'Accept': 'application/geo+json' } });
    if (!r.ok) throw new Error('NWS stations: ' + r.status);
    const d = await r.json();
    const stations = (d.features || []).map(f => ({
      id: f.properties.stationIdentifier, name: f.properties.name, type: f.properties.stationType,
      lat: f.geometry?.coordinates?.[1]||0, lng: f.geometry?.coordinates?.[0]||0, elevation: f.properties.elevation?.value||0
    })).filter(s => s.id && STATION_RE.test(s.id));
    const result = { stations, count: stations.length, source: 'NWS' };
    cache.set(cacheKey, result, 86400);
    res.json(result);
  } catch(e) { res.status(502).json({ error: 'Station list unavailable', detail: e.message }); }
});

app.get('/api/nexrad/nearest', async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  const n = Math.min(20, Math.max(1, Number(req.query.n) || 10));
  if (!Number.isFinite(lat)||!Number.isFinite(lng)) return res.status(400).json({ error: 'valid lat and lng required' });
  let stationData = cache.get('nexrad_stations');
  if (!stationData) {
    try {
      const r = await fetch('https://api.weather.gov/radar/stations', { headers: { 'User-Agent': '(StormSurgeWeather/13.8)', 'Accept': 'application/geo+json' } });
      const d = await r.json();
      const stations = (d.features || []).map(f => ({ id:f.properties.stationIdentifier, name:f.properties.name, type:f.properties.stationType, lat:f.geometry?.coordinates?.[1]||0, lng:f.geometry?.coordinates?.[0]||0 })).filter(s => s.id && STATION_RE.test(s.id));
      stationData = { stations };
      cache.set('nexrad_stations', stationData, 86400);
    } catch(e) { return res.status(502).json({ error: 'Could not load station list' }); }
  }
  function haversine(lat1,lng1,lat2,lng2) {
    const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
    const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }
  const withDist = stationData.stations.map(s => ({ ...s, distKm: Math.round(haversine(lat,lng,s.lat,s.lng)) })).sort((a,b) => a.distKm-b.distKm).slice(0,n);
  res.json({ stations: withDist, lat, lng });
});

app.get('/api/nexrad/tile/:station/:product/:z/:x/:y', async (req, res) => {
  const { station, product } = req.params;
  const z=Number(req.params.z), x=Number(req.params.x), y=Number(req.params.y);
  if (!STATION_RE.test(station)) return res.status(400).json({ error: 'Invalid station' });
  if (!NEXRAD_PRODUCTS.has(product)) return res.status(400).json({ error: 'Invalid product' });
  if (!Number.isInteger(z)||z<0||z>20) return res.status(400).json({ error: 'Invalid z' });
  if (!Number.isInteger(x)||x<0) return res.status(400).json({ error: 'Invalid x' });
  if (!Number.isInteger(y)||y<0) return res.status(400).json({ error: 'Invalid y' });
  const url = `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${product}_${station}/${z}/${x}/${y}.png`;
  const empty = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n1QAAAAASUVORK5CYII=','base64');
  try {
    const { buf, type } = await fetchBinary(url);
    res.set('Content-Type', type); res.set('Cache-Control', 'public, max-age=60'); res.send(buf);
  } catch(e) { res.set('Content-Type','image/png'); res.set('Cache-Control','public, max-age=10'); res.send(empty); }
});

// ================================================================
//  STORM REPORTS
// ================================================================
app.get('/api/storm-reports', async (req, res) => {
  try {
    const r = await fetch('https://www.spc.noaa.gov/climo/reports/today_filtered_torn.csv', { headers: { 'User-Agent': 'StormSurgeWeather/13.8' } });
    if (!r.ok) throw new Error('SPC ' + r.status);
    const text  = await r.text();
    const lines = text.trim().split('\n').slice(1);
    const items = lines.slice(0,50).map((line,i) => {
      const p = line.split(',');
      return { id:'sr-'+i, type:'tornado', lat:parseFloat(p[5])||0, lng:parseFloat(p[6])||0, magnitude:p[3]||'EF?', text:p[7]||'Tornado report', ts:new Date().toISOString() };
    }).filter(r => r.lat !== 0);
    res.json({ items, source: 'spc' });
  } catch(e) { res.json({ items: [], source: 'unavailable' }); }
});

app.get('/api/storm-cells', async (req, res) => res.json({ cells: [], source: 'spc' }));
app.get('/api/mcd',         async (req, res) => res.json({ features: [], type: 'FeatureCollection', source: 'spc' }));

// ================================================================
//  OVERLAY TILES
// ================================================================
app.get('/api/tiles/:layer/:z/:x/:y', (req, res) => {
  const layer=req.params.layer, z=Number(req.params.z), x=Number(req.params.x), y=Number(req.params.y);
  if (!Number.isFinite(z)||!Number.isFinite(x)||!Number.isFinite(y)) return res.status(400).json({ error: 'Invalid coords' });
  const palettes = {
    temperature:['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#d7191c'],
    wind_speed: ['#1a1a2e','#16213e','#0f3460','#533483','#e94560'],
    cloud_cover:['#0d0d0d','#2a2a2a','#555','#888','#bbb','#e8e8e8'],
    pressure:   ['#023858','#045a8d','#0570b0','#3690c0','#74a9cf','#a6bddb']
  };
  const pal  = palettes[layer] || palettes.temperature;
  const seed = Math.abs((x*73856093)^(y*19349663)^(z*83492791)^layer.length*9999);
  const c1=pal[seed%pal.length], c2=pal[(seed>>2)%pal.length];
  const op1=(0.12+(seed%17)*0.01).toFixed(2), op2=(0.25+(seed%11)*0.015).toFixed(2);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><radialGradient id="g" cx="50%" cy="50%" r="60%"><stop offset="0%" stop-color="${c1}" stop-opacity="${op2}"/><stop offset="100%" stop-color="${c2}" stop-opacity="${op1}"/></radialGradient></defs><rect width="256" height="256" fill="url(#g)"/></svg>`;
  res.set('Content-Type','image/svg+xml'); res.set('Cache-Control','public, max-age=600'); res.send(svg);
});

// ================================================================
//  HEALTH
// ================================================================
app.get('/api/health',  (req,res) => res.json({ status:'ok', version:APP_VERSION, uptime:Math.round(process.uptime())+'s', timestamp:new Date().toISOString() }));
app.get('/api/version', (req,res) => res.json({ name:'Storm Surge Weather', version:APP_VERSION, stack:'Open-Meteo + RainViewer + NWS + NEXRAD/IEM + Anthropic AI + mPing', timestamp:new Date().toISOString() }));

// ================================================================
//  SERVE FRONTEND
// ================================================================
const frontendPath = path.join(__dirname, 'public');
app.use(express.static(frontendPath));
app.get('*', (req,res) => res.sendFile(path.join(frontendPath,'index.html')));

app.listen(PORT, () => console.log(`⛈  Storm Surge Weather v${APP_VERSION} running on port ${PORT}`));
