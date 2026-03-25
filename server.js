// ================================================================
//  STORM SURGE WEATHER — Backend Server v13.9
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

const PORT           = process.env.PORT || 3001;
const APP_VERSION    = '13.9.0';
const GITHUB_REPO    = 'KingCreeper531/Storm-Surge-Weather';
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY || '';
const MAPBOX_TOKEN   = process.env.MAPBOX_TOKEN ||
  'pk.eyJ1Ijoic3Rvcm0tc3VyZ2UiLCJhIjoiY21tb3lsZXg3MDlyeTJwcHoxYjZ4emNudiJ9.de5YAbfQMvSzpVNH8QxmGw';

app.use(cors({ origin: '*', methods: ['GET','POST'] }));
app.use(express.json({ limit: '2mb' }));
app.use('/api/', rateLimit({ windowMs: 60000, max: 180 }));

async function apiFetch(url, ttl, key) {
  if (key) { const h = cache.get(key); if (h) return h; }
  const r = await fetch(url, { headers: { 'User-Agent': 'StormSurgeWeather/13.9' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (key && ttl) cache.set(key, d, ttl);
  return d;
}

function fetchBin(url) {
  return new Promise((res, rej) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers:{'User-Agent':'StormSurgeWeather/13.9'} }, (r) => {
      if ([301,302,307,308].includes(r.statusCode) && r.headers.location)
        return fetchBin(r.headers.location).then(res).catch(rej);
      if (r.statusCode !== 200) return rej(new Error('HTTP '+r.statusCode));
      const c = []; r.on('data',d=>c.push(d)); r.on('end',()=>res({buf:Buffer.concat(c),type:r.headers['content-type']||'image/png'})); r.on('error',rej);
    });
    req.on('error',rej); req.setTimeout(8000,()=>{req.destroy();rej(new Error('timeout'));});
  });
}

// ── CONFIG ──────────────────────────────────────────────────────
app.get('/api/config', (req,res) => res.json({ mapboxToken: MAPBOX_TOKEN, version: APP_VERSION }));
app.get('/api/health', (req,res) => res.json({ status:'ok', version:APP_VERSION, uptime:Math.round(process.uptime())+'s' }));

// ── UPDATE CHECK ──────────────────────────────────────────────────
app.get('/api/app-version', async (req,res) => {
  try {
    const k = 'gh_release', c = cache.get(k); if (c) return res.json(c);
    const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,{headers:{'User-Agent':'StormSurgeWeather/13.9'}});
    if (!r.ok) throw new Error('GH');
    const rel = await r.json();
    const latest = (rel.tag_name||'').replace(/^v/,'');
    const asset  = (rel.assets||[]).find(a=>a.name.endsWith('.exe')||a.name.toLowerCase().includes('setup'));
    const result = {current:APP_VERSION,latest:latest||APP_VERSION,hasUpdate:!!(latest&&latest!==APP_VERSION),releaseUrl:rel.html_url||`https://github.com/${GITHUB_REPO}/releases`,releaseName:rel.name||`v${latest}`,assetUrl:asset?.browser_download_url||null,assetSize:asset?.size||0};
    cache.set(k,result,3600); res.json(result);
  } catch(e) { res.json({current:APP_VERSION,latest:APP_VERSION,hasUpdate:false}); }
});

// ── WEATHER ──────────────────────────────────────────────────────
app.get('/api/weather', async (req,res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat)||!Number.isFinite(lng)) return res.status(400).json({error:'lat/lng required'});
  const k = `wx_${lat.toFixed(2)}_${lng.toFixed(2)}`;
  const hit = cache.get(k); if (hit) return res.json({...hit,_cached:true});
  try {
    const url = 'https://api.open-meteo.com/v1/forecast'
      +`?latitude=${lat}&longitude=${lng}`
      +'&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,rain,snowfall,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,cloud_cover,visibility,uv_index,is_day'
      +'&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,visibility,cloud_cover,cape,lifted_index,surface_pressure'
      +'&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,daylight_duration,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max'
      +'&forecast_days=14&temperature_unit=celsius&wind_speed_unit=ms&precipitation_unit=mm&timezone=auto';
    const d = await apiFetch(url, 600, null);
    cache.set(k, d, 600);
    res.json(d);
  } catch(e) { res.status(502).json({error:'Weather unavailable',detail:e.message}); }
});

// ── AIR QUALITY ──────────────────────────────────────────────────
app.get('/api/airquality', async (req,res) => {
  const lat=Number(req.query.lat), lng=Number(req.query.lng);
  if (!Number.isFinite(lat)||!Number.isFinite(lng)) return res.status(400).json({error:'lat/lng required'});
  try {
    const url='https://air-quality-api.open-meteo.com/v1/air-quality'
      +`?latitude=${lat}&longitude=${lng}`
      +'&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi'
      +'&hourly=pm2_5,pm10,us_aqi&forecast_days=3&timezone=auto';
    res.json(await apiFetch(url,1800,`aqi_${lat.toFixed(2)}_${lng.toFixed(2)}`));
  } catch(e) { res.status(502).json({error:'AQI unavailable'}); }
});

// ── MARINE ────────────────────────────────────────────────────────
app.get('/api/marine', async (req,res) => {
  const lat=Number(req.query.lat), lng=Number(req.query.lng);
  if (!Number.isFinite(lat)||!Number.isFinite(lng)) return res.status(400).json({error:'lat/lng required'});
  try {
    const url='https://marine-api.open-meteo.com/v1/marine'
      +`?latitude=${lat}&longitude=${lng}`
      +'&current=wave_height,wave_direction,wave_period,wind_wave_height,swell_wave_height,swell_wave_direction,swell_wave_period,ocean_current_velocity,ocean_current_direction'
      +'&hourly=wave_height,wave_direction,wave_period&forecast_days=3&timezone=auto';
    res.json(await apiFetch(url,3600,`marine_${lat.toFixed(2)}_${lng.toFixed(2)}`));
  } catch(e) { res.status(404).json({error:'Marine unavailable'}); }
});

// ── SEVERE ANALYSIS ──────────────────────────────────────────────
app.get('/api/severe-analysis', async (req,res) => {
  const lat=Number(req.query.lat), lng=Number(req.query.lng);
  if (!Number.isFinite(lat)||!Number.isFinite(lng)) return res.status(400).json({error:'lat/lng required'});
  try {
    const url='https://api.open-meteo.com/v1/forecast'
      +`?latitude=${lat}&longitude=${lng}`
      +'&hourly=temperature_2m,dew_point_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability,precipitation,cape,lifted_index,cloud_cover,visibility,relative_humidity_2m'
      +'&forecast_days=3&temperature_unit=celsius&wind_speed_unit=ms&precipitation_unit=mm&timezone=auto';
    const d = await apiFetch(url,900,`severe_${lat.toFixed(2)}_${lng.toFixed(2)}`);
    const hours = d.hourly.time.map((t,i)=>({time:t,tempC:d.hourly.temperature_2m[i],dewC:d.hourly.dew_point_2m[i],windMs:d.hourly.wind_speed_10m[i],gustMs:d.hourly.wind_gusts_10m[i],precipProb:d.hourly.precipitation_probability[i],precip:d.hourly.precipitation[i],cape:d.hourly.cape?.[i]||0,li:d.hourly.lifted_index?.[i]||0,cloud:d.hourly.cloud_cover[i],vis:d.hourly.visibility[i],rh:d.hourly.relative_humidity_2m[i]}));
    const analyzed = hours.map(h=>({...h,tags:analyzeSevere(h)}));
    const maxCape = Math.max(...hours.map(h=>h.cape||0));
    const maxGust = Math.max(...hours.map(h=>(h.gustMs||0)*2.237));
    const allTags = [...new Set(analyzed.flatMap(h=>h.tags.map(t=>t.tag)))];
    res.json({lat,lng,maxCape:Math.round(maxCape),maxGustMph:Math.round(maxGust),summary:allTags,peakHours:analyzed.filter(h=>h.tags.length).sort((a,b)=>b.cape-a.cape).slice(0,6),hourly:analyzed.slice(0,48)});
  } catch(e) { res.status(502).json({error:'Analysis unavailable',detail:e.message}); }
});
function analyzeSevere(h){
  const tags=[],gustMph=(h.gustMs||0)*2.237;
  if(h.cape>=2000)tags.push({tag:'significant instability',level:'high',icon:'⛈'});
  else if(h.cape>=1000)tags.push({tag:'moderate instability',level:'moderate',icon:'🌩'});
  else if(h.cape>=500)tags.push({tag:'marginal instability',level:'low',icon:'🌤'});
  if(h.li<=-6)tags.push({tag:'extremely unstable',level:'high',icon:'⚠️'});
  else if(h.li<=-3)tags.push({tag:'unstable atmosphere',level:'moderate',icon:'🌩'});
  if(gustMph>=60)tags.push({tag:'damaging winds',level:'high',icon:'💨'});
  else if(gustMph>=40)tags.push({tag:'strong gusts',level:'moderate',icon:'💨'});
  if(h.precipProb>=70&&h.precip>=10)tags.push({tag:'heavy rain/flood risk',level:'high',icon:'🌊'});
  if((h.vis||0)<1000)tags.push({tag:'dense fog',level:'moderate',icon:'🌫'});
  return tags;
}

// ── AI CHAT ──────────────────────────────────────────────────────
app.post('/api/ai-chat', async (req,res) => {
  if(!ANTHROPIC_KEY) return res.status(503).json({error:'ANTHROPIC_API_KEY not set in .env'});
  const {message,context} = req.body;
  if(!message||typeof message!=='string'||message.length>1000) return res.status(400).json({error:'Invalid message'});
  const sys = `You are Storm Surge AI, an expert meteorologist. Current context: Location ${context?.location||'unknown'} (${context?.lat},${context?.lng}). Temp: ${context?.weather?.current?.temperature_2m}°C, Feels: ${context?.weather?.current?.apparent_temperature}°C, Wind: ${context?.weather?.current?.wind_speed_10m}m/s, Humidity: ${context?.weather?.current?.relative_humidity_2m}%. Active alerts: ${context?.alerts?.length||0}. Be concise, use emoji, max 150 words.`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:400,system:sys,messages:[{role:'user',content:message}]})});
    if(!r.ok) return res.status(502).json({error:'AI failed'});
    const d = await r.json();
    res.json({reply:d.content?.[0]?.text||'No response.'});
  } catch(e) { res.status(502).json({error:'AI unavailable'}); }
});

// ── RADAR ────────────────────────────────────────────────────────
app.get('/api/radar/frames', async (req,res) => {
  try {
    const d = await apiFetch('https://api.rainviewer.com/public/weather-maps.json',60,'rv_frames');
    const past = d?.radar?.past?.slice(-12)||[];
    if(!past.length) throw new Error('No frames');
    res.json({past,nowcast:d?.radar?.nowcast?.slice(0,3)||[],source:'rainviewer'});
  } catch(e) { res.status(502).json({error:'Radar unavailable'}); }
});

app.get('/api/radar/tile', async (req,res) => {
  const p = String(req.query.path||'');
  if(!p||p.includes('..')) return res.status(400).end();
  try {
    const r = await fetch(`https://tilecache.rainviewer.com/${p.replace(/^\/+/,'')}`);
    if(!r.ok) throw new Error(r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type',r.headers.get('content-type')||'image/png').set('Cache-Control','public,max-age=120').send(buf);
  } catch(e) {
    res.set('Content-Type','image/png').send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n1QAAAAASUVORK5CYII=','base64'));
  }
});

// ── NEXRAD ────────────────────────────────────────────────────────
const NEXRAD_PRODS = new Set(['N0Q','N0U','N0C','N0X','EET','DAA','N0H','NTP']);
const STA_RE = /^[A-Z][A-Z0-9]{3}$/;

// Hardcoded fallback — all 160 NEXRAD WSR-88D sites (always available)
const NEXRAD_FALLBACK = [
  {id:'ABR',name:'Aberdeen SD',lat:45.456,lng:-98.413},{id:'ABX',name:'Albuquerque NM',lat:35.150,lng:-106.824},
  {id:'ACG',name:'Sitka AK',lat:56.854,lng:-135.529},{id:'AEC',name:'Nome AK',lat:64.511,lng:-165.295},
  {id:'AHG',name:'Kodiak AK',lat:57.783,lng:-152.388},{id:'AIH',name:'Middleton Island AK',lat:59.462,lng:-146.303},
  {id:'AKC',name:'King Salmon AK',lat:58.679,lng:-156.629},{id:'AKQ',name:'Wakefield VA',lat:36.984,lng:-77.008},
  {id:'ALE',name:'Nome AK',lat:64.731,lng:-165.080},{id:'ALY',name:'Albany NY',lat:42.747,lng:-73.838},
  {id:'AMX',name:'Miami FL',lat:25.611,lng:-80.413},{id:'APD',name:'Fairbanks AK',lat:64.808,lng:-147.501},
  {id:'APX',name:'Gaylord MI',lat:44.907,lng:-84.720},{id:'ARG',name:'Arecibo PR',lat:18.556,lng:-66.078},
  {id:'ARX',name:'La Crosse WI',lat:43.823,lng:-91.191},{id:'ATX',name:'Seattle WA',lat:48.195,lng:-122.496},
  {id:'BBX',name:'Beale AFB CA',lat:39.496,lng:-121.632},{id:'BGM',name:'Binghamton NY',lat:42.200,lng:-75.985},
  {id:'BHX',name:'Eureka CA',lat:40.499,lng:-124.292},{id:'BIS',name:'Bismarck ND',lat:46.771,lng:-100.760},
  {id:'BLX',name:'Billings MT',lat:45.854,lng:-108.607},{id:'BMX',name:'Birmingham AL',lat:33.172,lng:-86.770},
  {id:'BOX',name:'Boston MA',lat:41.956,lng:-71.137},{id:'BRO',name:'Brownsville TX',lat:25.916,lng:-97.419},
  {id:'BUF',name:'Buffalo NY',lat:42.489,lng:-78.737},{id:'BYX',name:'Key West FL',lat:24.598,lng:-81.703},
  {id:'CAE',name:'Columbia SC',lat:33.949,lng:-81.119},{id:'CBW',name:'Caribou ME',lat:46.039,lng:-67.806},
  {id:'CBX',name:'Boise ID',lat:43.491,lng:-116.236},{id:'CCX',name:'State College PA',lat:40.923,lng:-78.004},
  {id:'CLE',name:'Cleveland OH',lat:41.413,lng:-81.860},{id:'CLX',name:'Charleston SC',lat:32.656,lng:-81.042},
  {id:'CRP',name:'Corpus Christi TX',lat:27.784,lng:-97.511},{id:'CXX',name:'Burlington VT',lat:44.511,lng:-73.166},
  {id:'CYS',name:'Cheyenne WY',lat:41.152,lng:-104.806},{id:'DAX',name:'Sacramento CA',lat:38.501,lng:-121.678},
  {id:'DDC',name:'Dodge City KS',lat:37.761,lng:-99.969},{id:'DFX',name:'Laughlin TX',lat:29.273,lng:-100.280},
  {id:'DGX',name:'Jackson MS',lat:32.280,lng:-89.984},{id:'DIX',name:'Philadelphia PA',lat:39.947,lng:-74.411},
  {id:'DLH',name:'Duluth MN',lat:46.837,lng:-92.210},{id:'DMX',name:'Des Moines IA',lat:41.731,lng:-93.723},
  {id:'DOX',name:'Dover DE',lat:38.826,lng:-75.440},{id:'DTX',name:'Detroit MI',lat:42.700,lng:-83.472},
  {id:'DVN',name:'Davenport IA',lat:41.612,lng:-90.581},{id:'DYX',name:'Dyess TX',lat:32.538,lng:-99.254},
  {id:'EAX',name:'Kansas City MO',lat:38.810,lng:-94.264},{id:'EMX',name:'Tucson AZ',lat:31.894,lng:-110.630},
  {id:'ENX',name:'Albany NY',lat:42.587,lng:-74.064},{id:'EOX',name:'Ft Rucker AL',lat:31.460,lng:-85.460},
  {id:'EPZ',name:'El Paso TX',lat:31.873,lng:-106.698},{id:'ESX',name:'Las Vegas NV',lat:35.701,lng:-114.892},
  {id:'EVX',name:'Eglin AFB FL',lat:30.565,lng:-85.922},{id:'EWX',name:'Austin TX',lat:29.704,lng:-98.029},
  {id:'EYX',name:'Edwards AFB CA',lat:35.098,lng:-117.561},{id:'FCX',name:'Blacksburg VA',lat:37.024,lng:-80.274},
  {id:'FDR',name:'Frederick OK',lat:34.362,lng:-98.976},{id:'FDX',name:'Cannon AFB NM',lat:34.635,lng:-103.630},
  {id:'FFC',name:'Atlanta GA',lat:33.364,lng:-84.566},{id:'FSD',name:'Sioux Falls SD',lat:43.588,lng:-96.729},
  {id:'FSX',name:'Flagstaff AZ',lat:34.574,lng:-111.198},{id:'FTG',name:'Denver CO',lat:39.787,lng:-104.546},
  {id:'FWS',name:'Dallas TX',lat:32.573,lng:-97.303},{id:'GGW',name:'Glasgow MT',lat:48.206,lng:-106.625},
  {id:'GJX',name:'Grand Junction CO',lat:39.062,lng:-108.214},{id:'GLD',name:'Goodland KS',lat:39.367,lng:-101.700},
  {id:'GRB',name:'Green Bay WI',lat:44.498,lng:-88.111},{id:'GRK',name:'Ft Hood TX',lat:30.722,lng:-97.383},
  {id:'GRR',name:'Grand Rapids MI',lat:42.894,lng:-85.545},{id:'GSP',name:'Greenville SC',lat:34.883,lng:-82.220},
  {id:'GUA',name:'Andersen AFB GU',lat:13.455,lng:144.811},{id:'GWX',name:'Columbus MS',lat:33.897,lng:-88.329},
  {id:'GYX',name:'Portland ME',lat:43.891,lng:-70.256},{id:'HDX',name:'White Sands NM',lat:33.077,lng:-106.122},
  {id:'HGX',name:'Houston TX',lat:29.472,lng:-95.079},{id:'HKI',name:'Kauai HI',lat:21.894,lng:-159.552},
  {id:'HKM',name:'Kohala HI',lat:20.126,lng:-155.779},{id:'HMO',name:'Molokai HI',lat:21.133,lng:-157.180},
  {id:'HNX',name:'San Joaquin Valley CA',lat:36.314,lng:-119.632},{id:'HPX',name:'Ft Campbell KY',lat:36.737,lng:-87.285},
  {id:'HTX',name:'Huntsville AL',lat:34.931,lng:-86.084},{id:'HWA',name:'South Shore HI',lat:19.095,lng:-155.569},
  {id:'ICT',name:'Wichita KS',lat:37.655,lng:-97.443},{id:'ICX',name:'Cedar City UT',lat:37.591,lng:-112.862},
  {id:'ILN',name:'Wilmington OH',lat:39.420,lng:-83.822},{id:'ILX',name:'Lincoln IL',lat:40.151,lng:-89.337},
  {id:'IND',name:'Indianapolis IN',lat:39.707,lng:-86.280},{id:'INX',name:'Tulsa OK',lat:36.175,lng:-95.564},
  {id:'IWA',name:'Phoenix AZ',lat:33.289,lng:-111.670},{id:'IWX',name:'Fort Wayne IN',lat:41.359,lng:-85.700},
  {id:'JAX',name:'Jacksonville FL',lat:30.485,lng:-81.702},{id:'JGX',name:'Robins AFB GA',lat:32.675,lng:-83.351},
  {id:'JKL',name:'Jackson KY',lat:37.591,lng:-83.313},{id:'JUA',name:'San Juan PR',lat:18.116,lng:-66.079},
  {id:'LBB',name:'Lubbock TX',lat:33.654,lng:-101.814},{id:'LCH',name:'Lake Charles LA',lat:30.125,lng:-93.216},
  {id:'LGX',name:'Langley Hill WA',lat:47.117,lng:-124.107},{id:'LIX',name:'New Orleans LA',lat:30.337,lng:-89.825},
  {id:'LNX',name:'North Platte NE',lat:41.958,lng:-100.576},{id:'LOT',name:'Chicago IL',lat:41.604,lng:-88.085},
  {id:'LRX',name:'Elko NV',lat:40.740,lng:-116.803},{id:'LSX',name:'St Louis MO',lat:38.699,lng:-90.683},
  {id:'LTX',name:'Wilmington NC',lat:33.989,lng:-78.430},{id:'LVX',name:'Louisville KY',lat:37.975,lng:-85.944},
  {id:'LWX',name:'Baltimore MD',lat:38.975,lng:-77.478},{id:'LZK',name:'Little Rock AR',lat:34.837,lng:-92.262},
  {id:'MAF',name:'Midland TX',lat:31.943,lng:-102.189},{id:'MAX',name:'Medford OR',lat:42.081,lng:-122.717},
  {id:'MBX',name:'Minot ND',lat:48.393,lng:-100.865},{id:'MDX',name:'Bismarck ND',lat:46.778,lng:-100.864},
  {id:'MHX',name:'Morehead City NC',lat:34.776,lng:-76.876},{id:'MKX',name:'Milwaukee WI',lat:42.968,lng:-88.551},
  {id:'MLB',name:'Melbourne FL',lat:28.113,lng:-80.654},{id:'MOB',name:'Mobile AL',lat:30.679,lng:-88.240},
  {id:'MPX',name:'Minneapolis MN',lat:44.849,lng:-93.565},{id:'MQT',name:'Marquette MI',lat:46.531,lng:-87.548},
  {id:'MRX',name:'Knoxville TN',lat:36.168,lng:-83.402},{id:'MSX',name:'Missoula MT',lat:47.041,lng:-113.986},
  {id:'MTX',name:'Salt Lake City UT',lat:41.263,lng:-112.448},{id:'MUX',name:'San Francisco CA',lat:37.155,lng:-121.898},
  {id:'MVX',name:'Grand Forks ND',lat:47.528,lng:-97.325},{id:'MXX',name:'Maxwell AFB AL',lat:32.537,lng:-85.789},
  {id:'NKX',name:'San Diego CA',lat:32.919,lng:-117.042},{id:'NQA',name:'Memphis TN',lat:35.345,lng:-89.873},
  {id:'OAX',name:'Omaha NE',lat:41.320,lng:-96.367},{id:'ODN',name:'San Juan PR',lat:18.106,lng:-65.993},
  {id:'OHX',name:'Nashville TN',lat:36.247,lng:-86.563},{id:'OKX',name:'New York NY',lat:40.866,lng:-72.864},
  {id:'OTX',name:'Spokane WA',lat:47.681,lng:-117.627},{id:'PAH',name:'Paducah KY',lat:37.068,lng:-88.772},
  {id:'PBZ',name:'Pittsburgh PA',lat:40.532,lng:-80.218},{id:'PDT',name:'Pendleton OR',lat:45.691,lng:-118.853},
  {id:'POE',name:'Ft Polk LA',lat:31.157,lng:-92.976},{id:'PUX',name:'Pueblo CO',lat:38.460,lng:-104.182},
  {id:'RAX',name:'Raleigh NC',lat:35.666,lng:-78.490},{id:'RGX',name:'Reno NV',lat:39.754,lng:-119.462},
  {id:'RIW',name:'Riverton WY',lat:43.066,lng:-108.477},{id:'RLX',name:'Charleston WV',lat:38.311,lng:-81.723},
  {id:'RTX',name:'Portland OR',lat:45.715,lng:-122.965},{id:'SFX',name:'Pocatello ID',lat:43.106,lng:-112.686},
  {id:'SGF',name:'Springfield MO',lat:37.235,lng:-93.400},{id:'SHV',name:'Shreveport LA',lat:32.451,lng:-93.841},
  {id:'SJT',name:'San Angelo TX',lat:31.371,lng:-100.492},{id:'SOX',name:'Santa Ana CA',lat:33.818,lng:-117.636},
  {id:'SRX',name:'Ft Smith AR',lat:35.291,lng:-94.362},{id:'TBW',name:'Tampa FL',lat:27.705,lng:-82.402},
  {id:'TFX',name:'Great Falls MT',lat:47.460,lng:-111.386},{id:'TLH',name:'Tallahassee FL',lat:30.398,lng:-84.329},
  {id:'TLX',name:'Oklahoma City OK',lat:35.333,lng:-97.278},{id:'TWX',name:'Topeka KS',lat:38.997,lng:-96.233},
  {id:'TYX',name:'Montague NY',lat:43.756,lng:-75.680},{id:'UDX',name:'Rapid City SD',lat:44.125,lng:-103.023},
  {id:'UEX',name:'Grand Island NE',lat:40.321,lng:-98.442},{id:'VAX',name:'Valdosta GA',lat:30.890,lng:-83.002},
  {id:'VBX',name:'Vandenberg AFB CA',lat:34.839,lng:-120.397},{id:'VNX',name:'Vance AFB OK',lat:36.741,lng:-98.128},
  {id:'VTX',name:'Los Angeles CA',lat:34.412,lng:-119.179},{id:'VWX',name:'Evansville IN',lat:38.260,lng:-87.724},
  {id:'YUX',name:'Yuma AZ',lat:32.495,lng:-114.656},
];

app.get('/api/nexrad/nearest', async (req,res) => {
  const lat=Number(req.query.lat), lng=Number(req.query.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)) return res.status(400).json({error:'lat/lng required'});

  function hav(a,b,c,d){const R=6371,dL=(c-a)*Math.PI/180,dN=(d-b)*Math.PI/180,x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dN/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}

  // Try live API first; fallback to hardcoded list
  let stations = null;
  let sd = cache.get('nexrad_stations');
  if (sd) {
    stations = sd.stations;
  } else {
    try {
      const r=await fetch('https://api.weather.gov/radar/stations',{
        headers:{'User-Agent':'(StormSurgeWeather/13.9)','Accept':'application/geo+json'},
        signal: AbortSignal.timeout(5000)
      });
      if (r.ok) {
        const d=await r.json();
        stations=(d.features||[]).map(f=>({
          id:f.properties.stationIdentifier,
          name:f.properties.name,
          lat:f.geometry?.coordinates?.[1]||0,
          lng:f.geometry?.coordinates?.[0]||0
        })).filter(s=>s.id&&STA_RE.test(s.id));
        if (stations.length) cache.set('nexrad_stations',{stations},86400);
      }
    } catch(e) {
      console.warn('NWS radar stations API failed, using hardcoded fallback:', e.message);
    }
  }

  // Always fallback to hardcoded if API failed or returned nothing
  if (!stations || !stations.length) {
    stations = NEXRAD_FALLBACK;
  }

  const withDist=stations.map(s=>({...s,distKm:Math.round(hav(lat,lng,s.lat,s.lng))})).sort((a,b)=>a.distKm-b.distKm).slice(0,10);
  res.json({stations:withDist, source: sd ? 'cache' : stations === NEXRAD_FALLBACK ? 'fallback' : 'live'});
});

app.get('/api/nexrad/tile/:station/:product/:z/:x/:y', async (req,res) => {
  const {station,product}=req.params;
  const z=Number(req.params.z),x=Number(req.params.x),y=Number(req.params.y);
  if(!STA_RE.test(station)||!NEXRAD_PRODS.has(product)) return res.status(400).end();
  const empty=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n1QAAAAASUVORK5CYII=','base64');
  try {
    const {buf,type}=await fetchBin(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${product}_${station}/${z}/${x}/${y}.png`);
    res.set('Content-Type',type).set('Cache-Control','public,max-age=60').send(buf);
  } catch(e){res.set('Content-Type','image/png').send(empty);}
});

// ── SPOTTER REPORTS ──────────────────────────────────────────────
app.get('/api/spotter-reports', async (req,res) => {
  const lat=Number(req.query.lat)||0, lng=Number(req.query.lng)||0, dist=Number(req.query.dist)||300;
  const k=`spotter_${lat.toFixed(1)}_${lng.toFixed(1)}`;
  const cached=cache.get(k); if(cached) return res.json({...cached,_cached:true});
  const reports=[];
  try {
    const now=Math.floor(Date.now()/1000), from=now-3*3600;
    const mr=await fetch(`https://mping.nssl.noaa.gov/mping/api/v2/reports/?format=json&time__gte=${from}&limit=200`,{headers:{'User-Agent':'StormSurgeWeather/13.9','Accept':'application/json'}});
    if(mr.ok){
      const md=await mr.json();
      const cm={1:{t:'Rain',i:'🌧'},2:{t:'Freezing Rain',i:'🌨'},3:{t:'Snow',i:'❄️'},4:{t:'Sleet',i:'🧊'},5:{t:'Hail',i:'🌨'},6:{t:'Tornado',i:'🌪'},7:{t:'Thunderstorm',i:'⛈'},8:{t:'Fog',i:'🌫'},9:{t:'High Wind',i:'💨'},11:{t:'Lightning',i:'⚡'},13:{t:'Flash Flood',i:'🌊'}};
      (md.results||[]).forEach(r=>{const c=cm[r.category_id]||{t:'Report',i:'📍'};reports.push({id:`m-${r.id}`,source:'mPing',type:c.t,icon:c.i,lat:r.geom?.coordinates?.[1]||0,lng:r.geom?.coordinates?.[0]||0,description:r.description||'',city:r.city||'',state:r.state||'',ts:r.ob_time||new Date().toISOString(),verified:false});});
    }
  } catch(e){}
  function hav(a,b,c,d){const R=6371,dL=(c-a)*Math.PI/180,dN=(d-b)*Math.PI/180,x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dN/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
  const nearby=lat&&lng?reports.filter(r=>r.lat&&r.lng&&hav(lat,lng,r.lat,r.lng)<=dist):reports;
  nearby.forEach(r=>{if(lat&&lng)r.distKm=Math.round(hav(lat,lng,r.lat,r.lng));});
  nearby.sort((a,b)=>(a.distKm||999)-(b.distKm||999));
  const result={reports:nearby.slice(0,150),total:nearby.length};
  cache.set(k,result,300);
  res.json(result);
});

// ── STORM REPORTS ──────────────────────────────────────────────
app.get('/api/storm-reports', async (req,res) => {
  try {
    const r=await fetch('https://www.spc.noaa.gov/climo/reports/today_filtered_torn.csv',{headers:{'User-Agent':'StormSurgeWeather/13.9'}});
    if(!r.ok) throw new Error('SPC '+r.status);
    const text=await r.text();
    const items=text.trim().split('\n').slice(1).slice(0,50).map((line,i)=>{const p=line.split(',');return{id:'sr-'+i,type:'tornado',lat:parseFloat(p[5])||0,lng:parseFloat(p[6])||0,magnitude:p[3]||'EF?',text:p[7]||'Tornado report'};}).filter(r=>r.lat!==0);
    res.json({items,source:'spc'});
  } catch(e){res.json({items:[],source:'unavailable'});}
});

// ================================================================
//  NWS SOCIAL FEED — server-side Nitter RSS proxy (bypasses CORS)
// ================================================================
const NITTER_INSTANCES = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.nl',
  'https://nitter.net',
];

app.get('/api/nws-feed', async (req, res) => {
  const handle = String(req.query.handle || '').replace(/[^a-zA-Z0-9_]/g, '');
  if (!handle) return res.status(400).json({ error: 'handle required' });

  const cacheKey = `nws_feed_${handle}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ ...cached, _cached: true });

  for (const instance of NITTER_INSTANCES) {
    try {
      const url = `${instance}/${handle}/rss`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'StormSurgeWeather/13.9', 'Accept': 'application/rss+xml, text/xml, */*' },
        signal: AbortSignal.timeout(7000)
      });
      if (!r.ok) continue;
      const xml = await r.text();
      if (!xml.includes('<item>') && !xml.includes('<item ')) continue;

      // Parse RSS items
      const items = [];
      const itemRe = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = itemRe.exec(xml)) !== null && items.length < 12) {
        const block = m[1];
        const get = (tag) => {
          const t = new RegExp(`<${tag}(?:[^>]*)>(?:<\\!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,'i').exec(block);
          return t ? t[1].trim() : '';
        };
        const text = get('description')
          .replace(/<[^>]*>/g, ' ')
          .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&nbsp;/g,' ')
          .replace(/\s+/g,' ').trim();
        const link = get('link') || `https://x.com/${handle}`;
        const pubDate = get('pubDate');
        if (text.length > 5) {
          items.push({ text, link, ts: pubDate || new Date().toISOString() });
        }
      }

      if (items.length) {
        const result = { posts: items, handle, source: instance };
        cache.set(cacheKey, result, 300); // cache 5 min
        return res.json(result);
      }
    } catch(e) {
      console.warn(`Nitter ${instance} failed:`, e.message);
    }
  }

  // All Nitter instances failed — return empty with helpful message
  res.json({ posts: [], handle, source: 'unavailable', error: 'All Nitter instances unavailable' });
});

// ================================================================
//  METAR single station — used by pro panel aviation tab
// ================================================================
app.get('/api/metar/station', async (req, res) => {
  const station = String(req.query.station || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if (!station) return res.status(400).json({ error: 'station required' });
  const cacheKey = `metar_${station}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);
  try {
    const url = `https://aviationweather.gov/api/data/metar?ids=${station}&format=json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'StormSurgeWeather/14.0' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const result = { metars: data, station };
    cache.set(cacheKey, result, 600);
    res.json(result);
  } catch(e) {
    res.status(502).json({ error: 'METAR unavailable', detail: e.message });
  }
});

// ================================================================
//  PYTHON RADAR MICROSERVICE PROXY
//  Routes /api/radar/nearest, /api/radar/level2/*, /api/metar/*,
//  /api/skewt*, /api/gdd, /api/pollen, /api/tide, /api/ensemble,
//  /api/alerts/custom to Python service on port 3002
// ================================================================
const RADAR_SERVICE_URL = process.env.RADAR_SERVICE_URL || 'http://127.0.0.1:3002';

const PROXY_ROUTES = [
  '/api/radar/nearest',
  '/api/radar/level2',
  '/api/metar',
  '/api/taf',
  '/api/radar/skewtdata',
  '/api/gdd',
  '/api/pollen',
  '/api/tide',
  '/api/ensemble',
  '/api/alerts/custom',
  '/api/lightning',
];

// Generic proxy handler
async function proxyToPython(req, res) {
  const url = `${RADAR_SERVICE_URL}${req.originalUrl}`;
  try {
    const opts = {
      method: req.method,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'StormSurgeNode/14.0' },
      signal: AbortSignal.timeout(30000),
    };
    if (req.method === 'POST' && req.body) {
      opts.body = JSON.stringify(req.body);
    }
    const r = await fetch(url, opts);
    const ct = r.headers.get('content-type') || 'application/json';
    res.status(r.status).set('Content-Type', ct);
    if (ct.includes('image/')) {
      const buf = Buffer.from(await r.arrayBuffer());
      res.send(buf);
    } else {
      res.send(await r.text());
    }
  } catch(e) {
    console.warn(`Python proxy error for ${url}:`, e.message);
    res.status(503).json({ error: 'Radar service unavailable. Run: python3 radar_service.py', detail: e.message });
  }
}

PROXY_ROUTES.forEach(route => {
  app.all(`${route}*`, proxyToPython);
});

// ── STATIC ────────────────────────────────────────────────────────
const fp = path.join(__dirname,'public');
app.use(express.static(fp));
app.get('*',(req,res)=>res.sendFile(path.join(fp,'index.html')));

app.listen(PORT,()=>console.log(`⛈  Storm Surge v${APP_VERSION} on :${PORT}`));
