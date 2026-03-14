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

app.get('/api/nexrad/nearest', async (req,res) => {
  const lat=Number(req.query.lat), lng=Number(req.query.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)) return res.status(400).json({error:'lat/lng required'});
  let sd = cache.get('nexrad_stations');
  if(!sd) {
    try {
      const r=await fetch('https://api.weather.gov/radar/stations',{headers:{'User-Agent':'(StormSurgeWeather/13.9)','Accept':'application/geo+json'}});
      const d=await r.json();
      const stations=(d.features||[]).map(f=>({id:f.properties.stationIdentifier,name:f.properties.name,lat:f.geometry?.coordinates?.[1]||0,lng:f.geometry?.coordinates?.[0]||0})).filter(s=>s.id&&STA_RE.test(s.id));
      sd={stations}; cache.set('nexrad_stations',sd,86400);
    } catch(e) { return res.status(502).json({error:'Stations unavailable'}); }
  }
  function hav(a,b,c,d){const R=6371,dL=(c-a)*Math.PI/180,dN=(d-b)*Math.PI/180,x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dN/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
  const withDist=sd.stations.map(s=>({...s,distKm:Math.round(hav(lat,lng,s.lat,s.lng))})).sort((a,b)=>a.distKm-b.distKm).slice(0,10);
  res.json({stations:withDist});
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

// ── STATIC ────────────────────────────────────────────────────────
const fp = path.join(__dirname,'public');
app.use(express.static(fp));
app.get('*',(req,res)=>res.sendFile(path.join(fp,'index.html')));

app.listen(PORT,()=>console.log(`⛈  Storm Surge v${APP_VERSION} on :${PORT}`));
