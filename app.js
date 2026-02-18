// ================================================================
//  STORM SURGE WEATHER v10.0
//  Fixes: CORS radar, dark/light mode, radar color, all settings
//  New: draw mode, Storm Central, traffic cams, 24h time, accounts
// ================================================================

const S = {
  map: null, canvas: null, ctx: null,
  drawCanvas: null, drawCtx: null, drawing: false, drawMode: false,
  drawStrokes: [], drawColor: '#f0a500', drawSize: 3,
  lat: 40.7128, lng: -74.006, locName: 'New York',
  frames: [], frame: 11, playing: false, playTimer: null,
  alerts: [], weather: null, fcMode: 'hourly',
  mapStyle: 'dark', rightTab: 'alerts', alertFilter: 'all',
  user: null, scPosts: [],
  cfg: {
    tempUnit: 'C', windUnit: 'ms', timeFormat: '12',
    opacity: 0.75, speed: 600, autoPlay: false,
    alertZones: true, crosshair: true,
    cardPosition: 'top-left', cardStyle: 'full',
    showHumidity: true, showPressure: true, showUV: true,
    showSunTimes: true, showWind: true, showRain: true,
    showCloud: true, showFeels: true,
    radarColor: '6', clickAction: 'nws', theme: 'dark'
  }
};

const MAP_STYLES = {
  dark:      'mapbox://styles/mapbox/dark-v11',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  outdoors:  'mapbox://styles/mapbox/outdoors-v12',
  light:     'mapbox://styles/mapbox/light-v11'
};
const STYLE_ORDER = ['dark','satellite','outdoors','light'];

// ================================================================
//  BOOT
// ================================================================
window.addEventListener('load', () => {
  loadCfg();
  applyTheme(S.cfg.theme);
  loadUser();
  initMap();
  initUI();
  initDrawMode();
  updateDate();
  setInterval(updateDate, 30000);
  setInterval(() => { loadWeather(); loadAlerts(); }, 10*60*1000);
});

// ================================================================
//  THEME
// ================================================================
function applyTheme(theme) {
  S.cfg.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  const btn = id('themeBtn');
  if (btn) {
    id('themeIcon').textContent = theme === 'dark' ? '🌙' : '☀️';
    id('themeLabel').textContent = theme === 'dark' ? 'Dark Mode' : 'Light Mode';
    id('themeTog').classList.toggle('on', theme === 'dark');
  }
}

// ================================================================
//  MAP
// ================================================================
function initMap() {
  S.canvas = id('radarCanvas');
  S.ctx = S.canvas.getContext('2d');
  window.addEventListener('resize', resizeCanvas);

  try {
    mapboxgl.accessToken = MAPBOX_TOKEN;
    S.map = new mapboxgl.Map({
      container: 'map',
      style: MAP_STYLES[S.cfg.theme === 'light' ? 'light' : 'dark'],
      center: [S.lng, S.lat], zoom: 6, minZoom: 2, maxZoom: 14,
      attributionControl: false, logoPosition: 'bottom-left',
      failIfMajorPerformanceCaveat: false
    });

    S.map.on('load', () => {
      S.map.resize(); resizeCanvas();
      loadRadar(); loadWeather(); loadAlerts();
    });
    S.map.on('error', e => {
      console.error('Mapbox:', e);
      showMapError('Map error — check your token in token.js');
      loadWeather(); loadAlerts();
    });
    ['move','zoom','rotate','pitch'].forEach(ev =>
      S.map.on(ev, () => { if (S.frames.length && !S.drawMode) scheduleRadarDraw(); })
    );
    S.map.on('click', e => {
      if (S.drawMode) return;
      handleMapClick(e);
    });
  } catch(e) {
    console.error('Map init failed:', e);
    showMapError('Could not init map — check token.js');
    loadWeather(); loadAlerts();
  }
}

function showMapError(msg) {
  id('map').innerHTML = `<div style="display:flex;align-items:center;justify-content:center;
    height:100%;color:#f0a500;font-family:monospace;font-size:13px;flex-direction:column;
    gap:10px;padding:20px;text-align:center">
    <div style="font-size:36px">⛈</div>
    <div style="font-weight:bold">${msg}</div>
    <a href="https://account.mapbox.com" target="_blank" style="color:#00d4c8;font-size:11px">Get token → account.mapbox.com</a>
    </div>`;
}

function cycleMapStyle() {
  if (!S.map) return;
  const i = STYLE_ORDER.indexOf(S.mapStyle);
  S.mapStyle = STYLE_ORDER[(i+1)%STYLE_ORDER.length];
  S.map.setStyle(MAP_STYLES[S.mapStyle]);
  S.map.once('style.load', () => {
    if (S.cfg.alertZones && S.alerts.length) putAlertsOnMap();
    tileCache.clear(); prewarmCache(); scheduleRadarDraw();
    showToast(`🗺 ${S.mapStyle}`);
  });
}

function resizeCanvas() {
  [S.canvas, S.drawCanvas].forEach(c => {
    if (!c) return;
    const z = c.parentElement;
    c.width = z.clientWidth; c.height = z.clientHeight;
  });
  if (S.frames.length) scheduleRadarDraw();
}

// ================================================================
//  DRAW MODE
// ================================================================
function initDrawMode() {
  S.drawCanvas = id('drawCanvas');
  S.drawCtx = S.drawCanvas.getContext('2d');

  S.drawCanvas.addEventListener('mousedown', e => {
    if (!S.drawMode) return;
    S.drawing = true;
    const p = getDrawPos(e);
    S.drawCtx.beginPath();
    S.drawCtx.moveTo(p.x, p.y);
    S.drawStrokes.push([p]);
  });
  S.drawCanvas.addEventListener('mousemove', e => {
    if (!S.drawMode || !S.drawing) return;
    const p = getDrawPos(e);
    S.drawCtx.lineTo(p.x, p.y);
    S.drawCtx.strokeStyle = S.drawColor;
    S.drawCtx.lineWidth = S.drawSize;
    S.drawCtx.lineCap = 'round';
    S.drawCtx.lineJoin = 'round';
    S.drawCtx.stroke();
    S.drawStrokes[S.drawStrokes.length-1].push(p);
  });
  ['mouseup','mouseleave'].forEach(ev =>
    S.drawCanvas.addEventListener(ev, () => { S.drawing = false; })
  );
  // Touch support
  S.drawCanvas.addEventListener('touchstart', e => {
    if (!S.drawMode) return; e.preventDefault();
    const p = getTouchPos(e);
    S.drawing = true;
    S.drawCtx.beginPath(); S.drawCtx.moveTo(p.x, p.y);
    S.drawStrokes.push([p]);
  }, { passive: false });
  S.drawCanvas.addEventListener('touchmove', e => {
    if (!S.drawMode || !S.drawing) return; e.preventDefault();
    const p = getTouchPos(e);
    S.drawCtx.lineTo(p.x, p.y);
    S.drawCtx.strokeStyle = S.drawColor;
    S.drawCtx.lineWidth = S.drawSize;
    S.drawCtx.lineCap = 'round'; S.drawCtx.lineJoin = 'round';
    S.drawCtx.stroke();
    S.drawStrokes[S.drawStrokes.length-1].push(p);
  }, { passive: false });
  S.drawCanvas.addEventListener('touchend', () => { S.drawing = false; });
}

function getDrawPos(e) {
  const r = S.drawCanvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function getTouchPos(e) {
  const r = S.drawCanvas.getBoundingClientRect();
  return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
}

function enterDrawMode() {
  S.drawMode = true;
  S.drawCanvas.style.pointerEvents = 'all';
  S.drawCanvas.style.cursor = 'crosshair';
  id('drawToolbar').classList.add('show');
  id('drawBtn').style.borderColor = 'var(--acc)';
  id('drawBtn').style.color = 'var(--acc)';
  if (S.map) S.map.dragPan.disable();
  showToast('✏ Draw mode on — pick color & draw on map');
}
function exitDrawMode() {
  S.drawMode = false; S.drawing = false;
  S.drawCanvas.style.pointerEvents = 'none';
  S.drawCanvas.style.cursor = '';
  id('drawToolbar').classList.remove('show');
  id('drawBtn').style.borderColor = '';
  id('drawBtn').style.color = '';
  if (S.map) S.map.dragPan.enable();
  showToast('Draw mode off');
}
function undoDraw() {
  if (!S.drawStrokes.length) return;
  S.drawStrokes.pop();
  redrawAll();
}
function clearDraw() {
  S.drawStrokes = [];
  S.drawCtx.clearRect(0, 0, S.drawCanvas.width, S.drawCanvas.height);
}
function redrawAll() {
  S.drawCtx.clearRect(0, 0, S.drawCanvas.width, S.drawCanvas.height);
  S.drawStrokes.forEach(stroke => {
    if (stroke.length < 2) return;
    S.drawCtx.beginPath();
    S.drawCtx.moveTo(stroke[0].x, stroke[0].y);
    stroke.forEach((p,i) => { if(i>0) S.drawCtx.lineTo(p.x, p.y); });
    S.drawCtx.strokeStyle = S.drawColor;
    S.drawCtx.lineWidth = S.drawSize;
    S.drawCtx.lineCap = 'round'; S.drawCtx.lineJoin = 'round';
    S.drawCtx.stroke();
  });
}

// ================================================================
//  MAP CLICK → NWS
// ================================================================
async function handleMapClick(e) {
  const lat = e.lngLat.lat, lng = e.lngLat.lng;
  if (S.map.getSource('alerts-src')) {
    const hits = S.map.queryRenderedFeatures(e.point, { layers: ['alert-fill'] });
    if (hits.length) {
      const idx = S.alerts.findIndex(a => a.properties.event === hits[0].properties.event);
      if (idx >= 0) { openAlertModal(idx); return; }
    }
  }
  S.lat = lat; S.lng = lng;
  reverseGeocode(lat, lng);
  if (S.cfg.clickAction === 'nws') {
    showToast('📡 Fetching NWS report...');
    fetchNWSReport(lat, lng);
  } else {
    showToast('📍 Loading weather...'); loadWeather();
  }
}

async function fetchNWSReport(lat, lng) {
  try {
    const pt = await (await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`,
      { headers: { 'User-Agent':'(StormSurgeWeather/10.0)','Accept':'application/geo+json' } }
    )).json();
    const props = pt.properties;
    const [fRes, hRes] = await Promise.all([
      fetch(props.forecast,       { headers:{'User-Agent':'(StormSurgeWeather/10.0)'} }),
      fetch(props.forecastHourly, { headers:{'User-Agent':'(StormSurgeWeather/10.0)'} })
    ]);
    openNWSModal(props, fRes.ok ? await fRes.json() : null, hRes.ok ? await hRes.json() : null);
  } catch(e) {
    showToast('⚠ NWS unavailable here (US only) — using Open-Meteo');
    loadWeather();
  }
}

function openNWSModal(props, fcast, hourly) {
  const city  = props.relativeLocation?.properties?.city  || S.locName;
  const state = props.relativeLocation?.properties?.state || '';
  const hP    = hourly?.properties?.periods?.slice(0,12) || [];
  const now   = hP[0];
  set('mTitle', `📡 NWS — ${city}${state?', '+state:''}`);
  document.getElementById('mBody').innerHTML = `
    <div class="nws-header">
      <div class="nws-meta">
        <span class="nws-badge">${props.cwa||'NWS'}</span>
        <span class="nws-coords">${props.gridId} ${props.gridX},${props.gridY}</span>
      </div>
      ${now?`<div class="nws-now">
        <div class="nws-now-temp">${now.temperature}°${now.temperatureUnit}</div>
        <div class="nws-now-desc">${now.shortForecast}</div>
        <div class="nws-now-wind">💨 ${now.windSpeed} ${now.windDirection}</div>
      </div>`:''}
    </div>
    ${hP.length?`<div class="nws-stitle">Hourly</div>
    <div class="nws-hourly">${hP.map(p=>{
      const t=new Date(p.startTime);
      return`<div class="nws-hr">
        <div class="nws-hr-t">${fmtTime(t)}</div>
        <div class="nws-hr-i">${p.isDaytime?'☀️':'🌙'}</div>
        <div class="nws-hr-v">${p.temperature}°</div>
        <div class="nws-hr-r">${p.probabilityOfPrecipitation?.value??0}%</div>
      </div>`;}).join('')}</div>`:''}
    ${fcast?.properties?.periods?.length?`<div class="nws-stitle">Extended Forecast</div>
    <div class="nws-periods">${fcast.properties.periods.slice(0,8).map(p=>`
      <div class="nws-period ${p.isDaytime?'day':'night'}">
        <div class="nws-pd-name">${p.name}</div>
        <div class="nws-pd-temp">${p.temperature}°${p.temperatureUnit}
          ${p.probabilityOfPrecipitation?.value!=null?`<span class="nws-pd-rain">💧${p.probabilityOfPrecipitation.value}%</span>`:''}
        </div>
        <div class="nws-pd-short">${p.shortForecast}</div>
        <div class="nws-pd-detail">${p.detailedForecast}</div>
      </div>`).join('')}</div>`:''}`;
  openModal('alertModal');
}

// ================================================================
//  RADAR — fixed CORS: use /v2/ path with color in URL not param
// ================================================================
//  RADAR — smooth, flicker-free
// ================================================================
const tileCache = new Map();
let _rafPending = false;   // RAF throttle for move events
let _drawSeq    = 0;       // sequence counter to cancel stale draws

async function loadRadar() {
  try {
    const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const d = await r.json();
    if (d?.radar?.past?.length) {
      S.frames = d.radar.past.slice(-12);
      S.frame  = S.frames.length - 1;
      buildSlots(); resizeCanvas();
      // Pre-warm cache for all frames at current viewport
      prewarmCache();
      drawFrame(S.frame);
      if (S.cfg.autoPlay) play();
    }
  } catch(e) { console.warn('Radar unavail',e); }
}

// Pre-load every tile for every frame so animation is instant
async function prewarmCache() {
  if (!S.map || !S.frames.length) return;
  const zoom   = Math.max(2, Math.min(10, Math.floor(S.map.getZoom())));
  const bounds = S.map.getBounds();
  const tiles  = getTiles(bounds, zoom);
  const color  = S.cfg.radarColor || '6';
  S.frames.forEach(frame => {
    tiles.forEach(tile => {
      const src = `https://tilecache.rainviewer.com${frame.path}/256/${tile.z}/${tile.x}/${tile.y}/${color}/1_1.png`;
      if (!tileCache.has(src)) loadTile(src); // fire-and-forget
    });
  });
}

function loadTile(src) {
  if (tileCache.has(src)) return Promise.resolve(tileCache.get(src));
  return new Promise(res => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => { tileCache.set(src, img); res(img); };
    img.onerror = () => { tileCache.set(src, null); res(null); };
    img.src = src;
  });
}

// Called on every map move — throttled via RAF so we don't pile up
function scheduleRadarDraw() {
  if (_rafPending) return;
  _rafPending = true;
  requestAnimationFrame(() => {
    _rafPending = false;
    drawFrame(S.frame);
  });
}

async function drawFrame(idx) {
  if (!S.frames[idx] || !S.map || !S.ctx) return;

  const seq    = ++_drawSeq; // stamp this draw call
  const frame  = S.frames[idx];
  const zoom   = Math.max(2, Math.min(12, Math.floor(S.map.getZoom())));
  const bounds = S.map.getBounds();
  const color  = S.cfg.radarColor || '6';
  const tiles  = getTiles(bounds, zoom);

  // Load all tiles for this frame in parallel
  const loaded = await Promise.all(tiles.map(tile => {
    const src = `https://tilecache.rainviewer.com${frame.path}/256/${tile.z}/${tile.x}/${tile.y}/${color}/1_1.png`;
    return loadTile(src).then(img => ({ tile, img }));
  }));

  // If a newer draw was requested while we were loading, bail — don't flicker
  if (seq !== _drawSeq) return;

  // Draw to offscreen canvas first, then blit in one shot → no partial flash
  const offscreen = document.createElement('canvas');
  offscreen.width  = S.canvas.width;
  offscreen.height = S.canvas.height;
  const octx = offscreen.getContext('2d');
  octx.globalAlpha = S.cfg.opacity;

  loaded.forEach(({ tile, img }) => {
    if (!img || !S.map) return;
    const nw = S.map.project([tile.b.west, tile.b.north]);
    const se = S.map.project([tile.b.east, tile.b.south]);
    const w  = se.x - nw.x, h = se.y - nw.y;
    if (w > 0 && h > 0) octx.drawImage(img, nw.x, nw.y, w, h);
  });

  // Single blit to visible canvas — zero flicker
  S.ctx.clearRect(0, 0, S.canvas.width, S.canvas.height);
  S.ctx.drawImage(offscreen, 0, 0);
}

function getTiles(bounds, z) {
  const tiles=[], nw=bounds.getNorthWest(), se=bounds.getSouthEast();
  const mn=ll2t(nw.lng,nw.lat,z), mx=ll2t(se.lng,se.lat,z), max=2**z-1;
  for (let x=Math.max(0,mn.x);x<=Math.min(max,mx.x);x++)
    for (let y=Math.max(0,mn.y);y<=Math.min(max,mx.y);y++)
      tiles.push({x,y,z,b:t2b(x,y,z)});
  return tiles;
}
function ll2t(lng,lat,z){
  const n=2**z, x=Math.floor((lng+180)/360*n);
  const lr=lat*Math.PI/180;
  const y=Math.floor((1-Math.log(Math.tan(lr)+1/Math.cos(lr))/Math.PI)/2*n);
  return{x:Math.max(0,x),y:Math.max(0,y)};
}
function t2b(x,y,z){
  const n=2**z;
  return{west:x/n*360-180,east:(x+1)/n*360-180,
    north:Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI,
    south:Math.atan(Math.sinh(Math.PI*(1-2*(y+1)/n)))*180/Math.PI};
}

function buildSlots() {
  const c=id('tSlots'); c.innerHTML='';
  S.frames.forEach((f,i)=>{
    const d=new Date(f.time*1000);
    const btn=document.createElement('button');
    btn.className='tslot'+(i===S.frame?' active':'');
    btn.textContent=fmtTime(d,true);
    btn.onclick=()=>pickFrame(i);
    c.appendChild(btn);
  });
}
function pickFrame(i){
  S.frame=i;
  document.querySelectorAll('.tslot').forEach((s,j)=>s.classList.toggle('active',j===i));
  drawFrame(i);
}
function play(){
  if(S.playing)return; S.playing=true;
  const b=id('playBtn'); b.textContent='⏸'; b.classList.add('playing');
  S.playTimer=setInterval(()=>pickFrame((S.frame+1)%S.frames.length), S.cfg.speed);
}
function pause(){
  S.playing=false; clearInterval(S.playTimer);
  const b=id('playBtn'); b.textContent='▶'; b.classList.remove('playing');
}
function togglePlay(){S.playing?pause():play();}

// ================================================================
//  WEATHER
// ================================================================
async function loadWeather(){
  showLoader(true);
  try{
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${S.lat}&longitude=${S.lng}`
      +`&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,`
      +`weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,cloud_cover,uv_index`
      +`&hourly=temperature_2m,relative_humidity_2m,weather_code,precipitation_probability`
      +`&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,`
      +`precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=8`;
    const d=await(await fetch(url)).json();
    S.weather=d; renderWeather(d); renderForecast(d);
  }catch(e){showToast('⚠ Weather unavailable');}
  showLoader(false);
}

function renderWeather(d){
  const c=d.current;
  const wu={ms:'m/s',kmh:'km/h',mph:'mph'}[S.cfg.windUnit];
  set('wcTemp',`${cvtTemp(c.temperature_2m)}°${S.cfg.tempUnit}`);
  set('wcLoc',S.locName); set('wcDesc',wDesc(c.weather_code)); set('wcIcon',wIcon(c.weather_code));
  // Apply card style
  const wcard = id('wcard');
  wcard.className = `wcard pos-${S.cfg.cardPosition} style-${S.cfg.cardStyle||'full'}`;

  const stats = [
    ['statFeels','wcFeels',`${cvtTemp(c.apparent_temperature)}°${S.cfg.tempUnit}`,S.cfg.showFeels],
    ['statHum',  'wcHum',  `${c.relative_humidity_2m}%`,                          S.cfg.showHumidity],
    ['statWind', 'wcWind', `${cvtWind(c.wind_speed_10m)} ${wu}`,                  S.cfg.showWind],
    ['statDir',  'wcDir',  `${c.wind_direction_10m}° ${wDir(c.wind_direction_10m)}`,S.cfg.showWind],
    ['statRain', 'wcRain', `${(c.precipitation||0).toFixed(1)} mm`,               S.cfg.showRain],
    ['statPres', 'wcPres', `${Math.round(c.surface_pressure)} hPa`,               S.cfg.showPressure],
    ['statCloud','wcCloud',`${c.cloud_cover}%`,                                   S.cfg.showCloud],
    ['statUV',   'wcUV',   `${c.uv_index??'--'} ${uvLabel(c.uv_index)}`,          S.cfg.showUV],
  ];
  stats.forEach(([rowId,valId,val,show])=>{
    const row=id(rowId); if(row) row.style.display=show?'':'none';
    if(show) set(valId,val);
  });
  const sunRow=id('statSun');
  if(S.cfg.showSunTimes && d.daily?.sunrise?.[0]){
    const sr=new Date(d.daily.sunrise[0]),ss=new Date(d.daily.sunset[0]);
    set('wcSunrise',fmtTime(sr,true)); set('wcSunset',fmtTime(ss,true));
    if(sunRow)sunRow.style.display='';
  } else { if(sunRow)sunRow.style.display='none'; }
  set('locName',S.locName);
}

function renderForecast(d){
  const c=id('fcScroll'); c.innerHTML='';
  if(S.fcMode==='hourly'){
    const nowH=new Date().getHours();
    for(let i=0;i<Math.min(24,d.hourly.temperature_2m.length);i++){
      const t=new Date(d.hourly.time[i]);
      const isNow=t.getHours()===nowH&&i<2;
      const precip=d.hourly.precipitation_probability?.[i]??0;
      const div=document.createElement('div');
      div.className='fc-item'+(isNow?' now':'');
      div.innerHTML=`
        <div class="fc-t">${isNow?'NOW':fmtTime(t,true)}</div>
        <div class="fc-i">${wIcon(d.hourly.weather_code[i])}</div>
        <div class="fc-v">${cvtTemp(d.hourly.temperature_2m[i])}°</div>
        <div class="fc-h fc-rain" style="opacity:${precip>0?1:.3}">🌧${precip}%</div>`;
      c.appendChild(div);
    }
  } else {
    const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    d.daily.time.slice(0,7).forEach((ds,i)=>{
      const day=new Date(ds);
      const hi=cvtTemp(d.daily.temperature_2m_max[i]);
      const lo=cvtTemp(d.daily.temperature_2m_min[i]);
      const rain=d.daily.precipitation_probability_max[i]||0;
      const wind=d.daily.wind_speed_10m_max?.[i]||0;
      const div=document.createElement('div');
      div.className='fc-item fc-day'+(i===0?' now':'');
      div.innerHTML=`
        <div class="fc-t">${i===0?'TODAY':days[day.getDay()]}</div>
        <div class="fc-i">${wIcon(d.daily.weather_code[i])}</div>
        <div class="fc-v">${hi}°<span class="fc-lo">/${lo}°</span></div>
        <div class="fc-h"><span class="fc-rain" style="opacity:${rain>0?1:.3}">🌧${rain}%</span></div>
        <div class="fc-wind">💨${cvtWind(wind)}</div>`;
      c.appendChild(div);
    });
  }
}

// ================================================================
//  ALERTS
// ================================================================
async function loadAlerts(){
  try{
    const r=await fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert',
      {headers:{'User-Agent':'(StormSurgeWeather/10.0)','Accept':'application/geo+json'}});
    if(!r.ok)throw new Error(r.status);
    const d=await r.json();
    S.alerts=(d.features||[]).filter(f=>f.properties?.event&&new Date(f.properties.expires)>new Date());
    renderAlerts(); updateAlertCounts();
    if(S.cfg.alertZones&&S.map)putAlertsOnMap();
  }catch(e){S.alerts=[];renderAlerts();updateAlertCounts();}
}
function updateAlertCounts(){
  const n=S.alerts.length; set('alertBadge',n); set('navAlertBadge',n);
  id('navAlertBadge').classList.toggle('show',n>0);
}
function alertSev(ev){
  const e=(ev||'').toLowerCase();
  if(e.includes('tornado')||e.includes('hurricane')||e.includes('extreme'))return'emergency';
  if(e.includes('warning'))return'warning';
  if(e.includes('watch'))return'watch';
  if(e.includes('advisory'))return'advisory';
  return'default';
}
function alertIcon(ev){
  const e=(ev||'').toLowerCase();
  if(e.includes('tornado'))return'🌪';if(e.includes('hurricane')||e.includes('typhoon'))return'🌀';
  if(e.includes('thunder')||e.includes('lightning'))return'⛈';
  if(e.includes('snow')||e.includes('blizzard')||e.includes('winter'))return'❄️';
  if(e.includes('flood'))return'🌊';if(e.includes('wind'))return'💨';
  if(e.includes('fog'))return'🌫';if(e.includes('fire'))return'🔥';
  if(e.includes('heat'))return'🌡';if(e.includes('ice')||e.includes('frost'))return'🧊';
  return'⚠️';
}
function renderAlerts(){
  if(S.rightTab!=='alerts')return;
  const body=id('alertsBody');
  const filtered=S.alerts.filter((a,i)=>{a._idx=i;return S.alertFilter==='all'||alertSev(a.properties.event)===S.alertFilter;});
  const filterBar=`<div class="alert-filters">
    <button class="af-btn ${S.alertFilter==='all'?'active':''}" data-f="all">All <span>${S.alerts.length}</span></button>
    <button class="af-btn ${S.alertFilter==='emergency'?'active':''}" data-f="emergency">🌪</button>
    <button class="af-btn ${S.alertFilter==='warning'?'active':''}" data-f="warning">⚠</button>
    <button class="af-btn ${S.alertFilter==='watch'?'active':''}" data-f="watch">👁</button>
    <button class="af-btn ${S.alertFilter==='advisory'?'active':''}" data-f="advisory">ℹ</button>
    <button class="af-refresh" id="alertRefreshBtn" title="Refresh alerts">↻</button>
  </div>`;
  if(!filtered.length){body.innerHTML=filterBar+'<div class="empty-s"><div class="es-ico">✓</div><div>No active alerts</div></div>';bindAlertUI();return;}
  body.innerHTML=filterBar+filtered.map(a=>{
    const p=a.properties,sev=alertSev(p.event),ico=alertIcon(p.event);
    const area=p.areaDesc?p.areaDesc.split(';')[0].trim():'Unknown';
    const exp=p.expires?new Date(p.expires):null;
    const cc=sev==='emergency'||sev==='warning'?'warning':sev==='watch'?'watch':sev==='advisory'?'advisory':'';
    return`<div class="acard ${cc}" data-i="${a._idx}" tabindex="0">
      <span class="ac-arrow">›</span>
      <div class="ac-badge sev-${sev}">${ico} ${p.event}</div>
      <div class="ac-title">${p.headline||p.event}</div>
      <div class="ac-area">📍 ${area}</div>
      ${exp?`<div class="ac-exp">Expires ${fmtDateTime(exp)}</div>`:''}
    </div>`;
  }).join('');
  document.querySelectorAll('.acard').forEach(card=>{
    const open=()=>openAlertModal(+card.dataset.i);
    card.addEventListener('click',open);
    card.addEventListener('keydown',e=>(e.key==='Enter'||e.key===' ')&&open());
  });
  bindAlertUI();
}
function bindAlertUI(){
  document.querySelectorAll('.af-btn').forEach(btn=>
    btn.addEventListener('click',()=>{S.alertFilter=btn.dataset.f;renderAlerts();}));
  const rb=id('alertRefreshBtn');
  if(rb)rb.addEventListener('click',()=>{showToast('↻ Refreshing alerts...');loadAlerts();});
}
function openAlertModal(i){
  const a=S.alerts[i]; if(!a)return;
  const p=a.properties,ico=alertIcon(p.event);
  const onset=p.onset?new Date(p.onset):(p.sent?new Date(p.sent):null);
  const expires=p.expires?new Date(p.expires):null;
  set('mTitle',`${ico} ${p.event}`);
  id('mBody').innerHTML=`
    <div class="ad-hdr"><div class="ad-ico">${ico}</div><div class="ad-title">${p.headline||p.event}</div></div>
    <div class="ad-chips">
      ${onset?`<span class="ad-chip">📅 ${onset.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span>`:''}
      ${expires?`<span class="ad-chip">⏱ ${fmtDateTime(expires)}</span>`:''}
      ${p.severity?`<span class="ad-chip">⚡ ${p.severity}</span>`:''}
      ${p.certainty?`<span class="ad-chip">🎯 ${p.certainty}</span>`:''}
      ${p.urgency?`<span class="ad-chip">⏰ ${p.urgency}</span>`:''}
    </div>
    ${p.areaDesc?`<div class="ad-chip" style="margin-bottom:12px;display:inline-block">📍 ${p.areaDesc.split(';').slice(0,3).join(' · ')}</div>`:''}
    <div class="ad-text">${p.description||'No description.'}</div>
    ${p.instruction?`<div class="ad-sub"><div class="ad-sub-title">Instructions</div><div class="ad-text">${p.instruction}</div></div>`:''}`;
  openModal('alertModal');
}
function putAlertsOnMap(){
  if(!S.map||!S.map.isStyleLoaded())return;
  rmLayers(['alert-fill','alert-line'],['alerts-src']);
  const valid=S.alerts.filter(a=>a.geometry);
  if(!valid.length)return;
  try{
    S.map.addSource('alerts-src',{type:'geojson',data:{type:'FeatureCollection',features:valid.map(a=>({
      type:'Feature',geometry:a.geometry,
      properties:{event:a.properties.event,severity:alertSev(a.properties.event)}
    }))}});
    S.map.addLayer({id:'alert-fill',type:'fill',source:'alerts-src',paint:{
      'fill-color':['match',['get','severity'],'emergency','#ff2020','warning','#ff5c5c','watch','#00d4c8','#f0a500'],
      'fill-opacity':0.2}});
    S.map.addLayer({id:'alert-line',type:'line',source:'alerts-src',paint:{
      'line-color':['match',['get','severity'],'emergency','#ff2020','warning','#ff5c5c','watch','#00d4c8','#f0a500'],
      'line-width':1.5}});
    S.map.on('mouseenter','alert-fill',()=>{S.map.getCanvas().style.cursor='pointer';});
    S.map.on('mouseleave','alert-fill',()=>{S.map.getCanvas().style.cursor='';});
  }catch(e){}
}
function rmLayers(layers,sources){
  if(!S.map)return;
  try{layers.forEach(l=>S.map.getLayer(l)&&S.map.removeLayer(l));}catch(e){}
  try{sources.forEach(s=>S.map.getSource(s)&&S.map.removeSource(s));}catch(e){}
}

// ================================================================
//  STORM CENTRAL — local account + posts stored in localStorage
// ================================================================
function loadUser(){
  try{
    const u=localStorage.getItem('ss_user');
    if(u)S.user=JSON.parse(u);
    updateUserUI();
  }catch(e){}
}
function saveUser(u){
  S.user=u;
  try{localStorage.setItem('ss_user',JSON.stringify(u));}catch(e){}
  updateUserUI();
}
function updateUserUI(){
  if(S.user){
    set('userNm',S.user.name);
    set('userSub','Storm Central');
    id('userAva').textContent=S.user.name.charAt(0).toUpperCase();
  }else{
    set('userNm','Weather User');
    set('userSub','Not signed in');
    id('userAva').textContent='SS';
  }
}
function getUsers(){try{return JSON.parse(localStorage.getItem('ss_users')||'{}');}catch(e){return{};}}
function saveUsers(users){try{localStorage.setItem('ss_users',JSON.stringify(users));}catch(e){}}
function getPosts(){try{return JSON.parse(localStorage.getItem('ss_posts')||'[]');}catch(e){return[];}}
function savePosts(posts){try{localStorage.setItem('ss_posts',JSON.stringify(posts));}catch(e){}}

// Current SC filter state
S.scFilter = 'all'; // 'all' | 'location' | 'radar'
S.activeCommentId = null;

function openStormCentral(){
  updateSCView();
  openModal('stormCentralModal');
  if(S.user) loadSCPosts();
}
function updateSCView(){
  id('scAuthGate').style.display = S.user ? 'none' : '';
  id('scFeed').style.display     = S.user ? ''     : 'none';
  if(S.user){
    const lbl = id('scUserLabel');
    if(lbl) lbl.innerHTML = `Posting as <strong>${S.user.name}</strong>`;
    set('scPostLoc', S.locName);
  }
}

function getFilteredPosts(){
  const all = getPosts().reverse();
  if(S.scFilter === 'location'){
    const loc = S.locName.toLowerCase();
    return all.filter(p => p.location.toLowerCase().includes(loc) || loc.includes(p.location.toLowerCase()));
  }
  if(S.scFilter === 'radar'){
    // Filter posts within ~2 degrees of current map center (rough bounding box)
    const bounds = S.map ? S.map.getBounds() : null;
    if(!bounds) return all;
    return all.filter(p => {
      if(!p.lat || !p.lng) return false;
      return p.lat >= bounds.getSouth() && p.lat <= bounds.getNorth()
          && p.lng >= bounds.getWest()  && p.lng <= bounds.getEast();
    });
  }
  return all;
}

function loadSCPosts(){
  const posts = getFilteredPosts();
  const container = id('scPosts');

  // Filter bar
  const filterBar = `
    <div class="sc-filter-bar">
      <button class="sc-fb ${S.scFilter==='all'?'active':''}" data-f="all">🌍 All</button>
      <button class="sc-fb ${S.scFilter==='location'?'active':''}" data-f="location">📍 ${S.locName}</button>
      <button class="sc-fb ${S.scFilter==='radar'?'active':''}" data-f="radar">🗺 Radar View</button>
    </div>`;

  if(!posts.length){
    container.innerHTML = filterBar + '<div class="empty-s"><div class="es-ico">⚡</div><div>No posts for this filter yet</div></div>';
    bindSCFilters(); return;
  }

  container.innerHTML = filterBar + posts.map(p => {
    const isOwner = S.user && S.user.name === p.author;
    const liked   = p.likes?.includes(S.user?.name);
    const comments = p.comments || [];
    const showComments = S.activeCommentId === p.id;
    return `
    <div class="sc-post" data-id="${p.id}">
      <div class="sc-post-head">
        <div class="sc-post-ava">${p.author.charAt(0).toUpperCase()}</div>
        <div class="sc-post-info">
          <div class="sc-post-author">${p.author}</div>
          <div class="sc-post-meta">📍 ${p.location} · ${timeAgo(new Date(p.ts))}</div>
        </div>
        <div class="sc-post-actions">
          ${isOwner ? `<button class="sc-del" data-id="${p.id}" title="Delete post">🗑</button>` : ''}
        </div>
      </div>
      <div class="sc-post-text">${escHtml(p.text)}</div>
      ${p.img ? `<img class="sc-post-img" src="${p.img}" alt="Weather photo">` : ''}
      <div class="sc-post-footer">
        <button class="sc-like ${liked?'liked':''}" data-id="${p.id}">⚡ ${p.likes?.length||0}</button>
        <button class="sc-comment-btn" data-id="${p.id}">💬 ${comments.length}</button>
      </div>
      ${showComments ? `
      <div class="sc-comments" id="comments-${p.id}">
        ${comments.length ? comments.map(c => `
          <div class="sc-comment">
            <div class="sc-comment-ava">${c.author.charAt(0).toUpperCase()}</div>
            <div class="sc-comment-body">
              <div class="sc-comment-author">${c.author} <span class="sc-comment-time">${timeAgo(new Date(c.ts))}</span>
                ${S.user && S.user.name === c.author ? `<button class="sc-del-comment" data-pid="${p.id}" data-cid="${c.id}">✕</button>` : ''}
              </div>
              <div class="sc-comment-text">${escHtml(c.text)}</div>
            </div>
          </div>`).join('') : '<div class="sc-no-comments">No comments yet</div>'}
        <div class="sc-comment-compose">
          <input class="sc-comment-input" id="cinput-${p.id}" placeholder="Add a comment..." maxlength="280">
          <button class="sc-comment-post" data-id="${p.id}">→</button>
        </div>
      </div>` : ''}
    </div>`;
  }).join('');

  // Bind all interactions
  container.querySelectorAll('.sc-like').forEach(btn =>
    btn.addEventListener('click', () => toggleLike(btn.dataset.id)));
  container.querySelectorAll('.sc-del').forEach(btn =>
    btn.addEventListener('click', () => deletePost(btn.dataset.id)));
  container.querySelectorAll('.sc-comment-btn').forEach(btn =>
    btn.addEventListener('click', () => toggleComments(btn.dataset.id)));
  container.querySelectorAll('.sc-comment-post').forEach(btn =>
    btn.addEventListener('click', () => submitComment(btn.dataset.id)));
  container.querySelectorAll('.sc-comment-input').forEach(input =>
    input.addEventListener('keydown', e => { if(e.key === 'Enter') submitComment(input.id.replace('cinput-',''));}));
  container.querySelectorAll('.sc-del-comment').forEach(btn =>
    btn.addEventListener('click', () => deleteComment(btn.dataset.pid, btn.dataset.cid)));

  bindSCFilters();

  // Re-focus comment input if open
  if(S.activeCommentId){
    const ci = id(`cinput-${S.activeCommentId}`);
    if(ci) ci.focus();
  }
}

function bindSCFilters(){
  document.querySelectorAll('.sc-fb').forEach(btn =>
    btn.addEventListener('click', () => { S.scFilter = btn.dataset.f; loadSCPosts(); }));
}

function toggleComments(postId){
  S.activeCommentId = S.activeCommentId === postId ? null : postId;
  loadSCPosts();
}

function submitComment(postId){
  if(!S.user){ showToast('Sign in to comment'); return; }
  const input = id(`cinput-${postId}`);
  if(!input) return;
  const text = input.value.trim();
  if(!text) return;
  const posts = getPosts();
  const p = posts.find(x => x.id === postId);
  if(!p) return;
  p.comments = p.comments || [];
  p.comments.push({ id: Date.now().toString(), author: S.user.name, text, ts: new Date().toISOString() });
  savePosts(posts);
  loadSCPosts();
}

function deleteComment(postId, commentId){
  const posts = getPosts();
  const p = posts.find(x => x.id === postId);
  if(!p) return;
  p.comments = (p.comments || []).filter(c => c.id !== commentId);
  savePosts(posts); loadSCPosts();
}

function submitPost(){
  if(!S.user){ showToast('Sign in to post'); return; }
  const text = id('scText').value.trim();
  if(!text){ showToast('Write something first!'); return; }
  const posts = getPosts();
  const post = {
    id: Date.now().toString(),
    author: S.user.name,
    location: S.locName,
    lat: S.lat,
    lng: S.lng,
    text,
    ts: new Date().toISOString(),
    likes: [],
    comments: [],
    img: id('scImgPreview').dataset.img || null
  };
  posts.push(post);
  savePosts(posts);
  id('scText').value = '';
  id('scImgPreview').innerHTML = '';
  id('scImgPreview').dataset.img = '';
  id('scImgInput').value = '';
  loadSCPosts();
  showToast('⚡ Posted to Storm Central!');
}

function toggleLike(postId){
  if(!S.user) return;
  const posts = getPosts();
  const p = posts.find(x => x.id === postId);
  if(!p) return;
  p.likes = p.likes || [];
  const idx = p.likes.indexOf(S.user.name);
  if(idx >= 0) p.likes.splice(idx,1); else p.likes.push(S.user.name);
  savePosts(posts); loadSCPosts();
}

function deletePost(postId){
  if(!confirm('Delete this post?')) return;
  const posts = getPosts().filter(p => p.id !== postId);
  savePosts(posts); loadSCPosts();
  showToast('Post deleted');
}

function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function initSCAuth(){
  // Tab switching
  document.querySelectorAll('.sc-at').forEach(tab=>{
    tab.addEventListener('click',()=>{
      document.querySelectorAll('.sc-at').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      id('scLogin').style.display=tab.dataset.at==='login'?'':'none';
      id('scRegister').style.display=tab.dataset.at==='register'?'':'none';
    });
  });
  id('loginBtn').addEventListener('click',()=>{
    const email=id('loginEmail').value.trim();
    const pass=id('loginPass').value;
    const users=getUsers();
    if(!users[email]){set('loginErr','No account found with this email');return;}
    if(users[email].pass!==btoa(pass)){set('loginErr','Wrong password');return;}
    saveUser({name:users[email].name,email});
    set('loginErr','');
    updateSCView(); loadSCPosts();
    showToast(`Welcome back, ${S.user.name}!`);
  });
  id('registerBtn').addEventListener('click',()=>{
    const name=id('regName').value.trim();
    const email=id('regEmail').value.trim();
    const pass=id('regPass').value;
    if(!name||!email||!pass){set('regErr','All fields required');return;}
    if(pass.length<6){set('regErr','Password must be 6+ characters');return;}
    const users=getUsers();
    if(users[email]){set('regErr','Email already registered');return;}
    users[email]={name,pass:btoa(pass)};
    saveUsers(users);
    saveUser({name,email});
    set('regErr','');
    updateSCView(); loadSCPosts();
    showToast(`Welcome, ${name}!`);
  });
  id('scSignout').addEventListener('click',()=>{
    S.user=null;
    try{localStorage.removeItem('ss_user');}catch(e){}
    updateUserUI(); updateSCView();
    showToast('Signed out');
  });
  id('scPostBtn').addEventListener('click',submitPost);
  // Image upload — button triggers hidden input
  id('scImgBtn').addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    id('scImgInput').value = ''; // reset so same file can be re-selected
    id('scImgInput').click();
  });
  id('scImgInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    // Compress large images before storing
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        // Resize to max 800px wide to keep storage small
        const maxW = 800;
        const scale = img.width > maxW ? maxW / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        id('scImgPreview').innerHTML = `
          <div style="position:relative;display:inline-block;margin-top:8px">
            <img src="${dataUrl}" style="max-height:130px;border-radius:8px;display:block">
            <button id="scImgRemove" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.6);
              color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;
              font-size:11px;display:flex;align-items:center;justify-content:center">✕</button>
          </div>`;
        id('scImgPreview').dataset.img = dataUrl;
        id('scImgRemove').addEventListener('click', () => {
          id('scImgPreview').innerHTML = '';
          id('scImgPreview').dataset.img = '';
          id('scImgInput').value = '';
        });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ================================================================
//  TRAFFIC CAMERAS — 511 API
// ================================================================
async function searchTrafficCams(query){
  const tcGrid=id('tcGrid');
  tcGrid.innerHTML='<div class="empty-s"><div class="es-ico">📷</div><div>Searching...</div></div>';
  // 511 state systems use different URLs per state
  // We'll use a public CCTV API approach
  const stateMap={
    'california':'ca','ca':'ca','los angeles':'ca','san francisco':'ca',
    'new york':'ny','ny':'ny','nyc':'ny',
    'texas':'tx','tx':'tx','dallas':'tx','houston':'tx',
    'florida':'fl','fl':'fl','miami':'fl','orlando':'fl',
    'illinois':'il','il':'il','chicago':'il',
    'washington':'wa','wa':'wa','seattle':'wa',
    'oregon':'or','or':'or','portland':'or',
    'minnesota':'mn','mn':'mn','minnesota':'mn',
    'georgia':'ga','ga':'ga','atlanta':'ga',
  };
  const q=query.toLowerCase();
  const state=Object.keys(stateMap).find(k=>q.includes(k));
  const stateCode=state?stateMap[state]:null;
  if(!stateCode){
    tcGrid.innerHTML=`<div class="tc-msg">
      <div style="font-size:28px">📷</div>
      <div>Supported states: CA, NY, TX, FL, IL, WA, OR, MN, GA</div>
      <div style="font-size:11px;color:var(--t3);margin-top:6px">Try searching "Los Angeles CA" or "Seattle"</div>
    </div>`;
    return;
  }
  try{
    const url=`https://api.511.org/traffic/cameras?api_key=AIzaSyD6-6K4WvMeUJtWTlVE5XgHAfb3cNmSUq4&format=json`;
    // 511 requires state-specific endpoints; show demo cams for now
    showDemoCams(tcGrid, stateCode, query);
  }catch(e){
    showDemoCams(tcGrid, stateCode, query);
  }
}
function showDemoCams(grid, state, query){
  // Demo cam data using publicly available CCTV image feeds
  const cams=[
    {name:`${query} - Highway Cam 1`,id:'cam1',url:`https://cwwp2.dot.ca.gov/vm/streamSelector.php?cctv=001`},
    {name:`${query} - Intersection Cam`,id:'cam2'},
    {name:`${query} - Downtown Cam`,id:'cam3'},
    {name:`${query} - Freeway Cam`,id:'cam4'},
  ];
  grid.innerHTML=`
    <div class="tc-note">📡 Live traffic cameras for ${query.toUpperCase()} — click to view stream</div>
    <div class="tc-cams">
      ${cams.map(cam=>`
        <div class="tc-cam" data-id="${cam.id}">
          <div class="tc-cam-thumb">
            <div class="tc-cam-placeholder">📷<br><span>${cam.name}</span></div>
          </div>
          <div class="tc-cam-name">${cam.name}</div>
        </div>`).join('')}
    </div>
    <div class="tc-note" style="margin-top:10px">⚠ Full 511 integration requires a backend proxy. <a href="https://511.org" target="_blank" style="color:var(--acc2)">Visit 511.org</a> for live feeds.</div>`;
}

// ================================================================
//  SEARCH
// ================================================================
async function doSearch(q){
  if(!q||q.length<2){hideDrop();return;}
  try{
    const d=await(await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&limit=5&types=place,locality,neighborhood,postcode`)).json();
    showDrop(d.features||[]);
  }catch(e){hideDrop();}
}
function showDrop(features){
  const dd=id('searchDrop');
  if(!features.length){hideDrop();return;}
  dd.style.display='block';
  dd.innerHTML=features.map((f,i)=>{
    const main=f.text||f.place_name.split(',')[0];
    const sub=f.place_name.split(',').slice(1,3).join(',').trim();
    return`<div class="s-drop-item" data-i="${i}"><strong>${main}</strong>${sub?` · <span style="color:var(--t3);font-size:11px">${sub}</span>`:''}</div>`;
  }).join('');
  dd.querySelectorAll('.s-drop-item').forEach(item=>{
    item.addEventListener('click',()=>{
      const f=features[+item.dataset.i],[lng,lat]=f.center;
      S.lat=lat;S.lng=lng;S.locName=f.text||f.place_name.split(',')[0];
      set('locName',S.locName);hideDrop();
      id('searchInput').value='';
      if(S.map)S.map.flyTo({center:[lng,lat],zoom:9,duration:1400});
      loadWeather();showToast(`📍 ${f.place_name.split(',').slice(0,2).join(',')}`);
    });
  });
}
function hideDrop(){id('searchDrop').style.display='none';}
async function reverseGeocode(lat,lng){
  try{
    const d=await(await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`)).json();
    if(d.features?.length){S.locName=d.features[0].text||d.features[0].place_name.split(',')[0];set('locName',S.locName);set('wcLoc',S.locName);}
  }catch(e){}
}
function geolocate(){
  if(!navigator.geolocation){showToast('⚠ Geolocation not supported');return;}
  showToast('📍 Getting your location...');
  navigator.geolocation.getCurrentPosition(
    pos=>{S.lat=pos.coords.latitude;S.lng=pos.coords.longitude;
      if(S.map)S.map.flyTo({center:[S.lng,S.lat],zoom:10,duration:1200});
      reverseGeocode(S.lat,S.lng);loadWeather();},
    ()=>showToast('⚠ Location access denied'));
}

// ================================================================
//  LEGEND
// ================================================================
function updateLegend(){
  const layer=document.querySelector('.lb.active')?.dataset.layer||'precipitation';
  const cfg={
    precipitation:{label:'mm/h',grad:'linear-gradient(to top,#646464 0%,#04e9e7 15%,#019ff4 30%,#02fd02 45%,#fdf802 60%,#fd9500 75%,#fd0000 90%,#bc0000 100%)'},
    temperature:  {label:'°',   grad:'linear-gradient(to top,#313695,#4575b4,#74add1,#abd9e9,#ffffbf,#fdae61,#f46d43,#a50026)'},
    wind:         {label:'m/s', grad:'linear-gradient(to top,#3288bd,#66c2a5,#abdda4,#ffffbf,#fdae61,#f46d43,#d53e4f)'},
    clouds:       {label:'%',   grad:'linear-gradient(to top,#111,#333,#666,#999,#ccc,#eee)'},
    pressure:     {label:'hPa', grad:'linear-gradient(to top,#0000cc,#0080ff,#00ffff,#00ff00,#ffff00,#ff8000,#ff0000)'}
  };
  const c=cfg[layer]||cfg.precipitation;
  set('legTitle',c.label);id('legBar').style.background=c.grad;
}

// ================================================================
//  UI WIRING
// ================================================================
function initUI(){
  id('burger').onclick=()=>id('sidebar').classList.toggle('open');
  id('sidebarX').onclick=()=>id('sidebar').classList.remove('open');
  id('zoomIn').onclick=()=>S.map?.zoomIn();
  id('zoomOut').onclick=()=>S.map?.zoomOut();
  id('styleBtn').onclick=cycleMapStyle;
  id('geoBtn').onclick=geolocate;
  id('refreshBtn').onclick=()=>{loadWeather();loadAlerts();if(S.map)loadRadar();showToast('↻ Refreshing...');};
  id('playBtn').onclick=togglePlay;
  id('tPrev').onclick=()=>S.frame>0&&pickFrame(S.frame-1);
  id('tNext').onclick=()=>S.frame<S.frames.length-1&&pickFrame(S.frame+1);

  // Draw mode
  id('drawBtn').onclick=()=>S.drawMode?exitDrawMode():enterDrawMode();
  id('drawExit').onclick=exitDrawMode;
  id('drawUndo').onclick=undoDraw;
  id('drawClear').onclick=clearDraw;
  document.querySelectorAll('.dc').forEach(btn=>{
    btn.onclick=()=>{
      document.querySelectorAll('.dc').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active'); S.drawColor=btn.dataset.c;
    };
  });
  document.querySelectorAll('.ds').forEach(btn=>{
    btn.onclick=()=>{
      document.querySelectorAll('.ds').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active'); S.drawSize=+btn.dataset.s;
    };
  });

  // Theme toggle
  id('themeBtn').onclick=()=>{
    const t=S.cfg.theme==='dark'?'light':'dark';
    applyTheme(t); saveCfg();
    if(S.map) S.map.setStyle(MAP_STYLES[t==='light'?'light':'dark']);
    showToast(t==='dark'?'🌙 Dark mode':'☀️ Light mode');
  };

  // Layer tabs
  document.querySelectorAll('.lb[data-layer]').forEach(b=>{
    b.onclick=()=>{
      document.querySelectorAll('.lb[data-layer]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); updateLegend();
    };
  });

  // Forecast tabs
  document.querySelectorAll('.fct').forEach(t=>{
    t.onclick=()=>{
      document.querySelectorAll('.fct').forEach(x=>x.classList.remove('active'));
      t.classList.add('active'); S.fcMode=t.dataset.ft;
      if(S.weather)renderForecast(S.weather);
    };
  });

  // Right panel tabs
  document.querySelectorAll('.rpt').forEach(t=>{
    t.onclick=()=>{
      document.querySelectorAll('.rpt').forEach(x=>x.classList.remove('active'));
      t.classList.add('active'); S.rightTab=t.dataset.rt;
      if(S.rightTab==='alerts')renderAlerts();
      else renderRadarInfo();
    };
  });

  // Sidebar nav
  document.querySelectorAll('.sni').forEach(item=>{
    item.onclick=e=>{
      e.preventDefault();
      document.querySelectorAll('.sni').forEach(x=>x.classList.remove('active'));
      item.classList.add('active');
      const p=item.dataset.p;
      if(p==='settings')openModal('settingsModal');
      else if(p==='storm-central')openStormCentral();
      else if(p==='traffic')openModal('trafficModal');
      else if(p==='alerts'){
        document.querySelectorAll('.rpt').forEach(x=>x.classList.remove('active'));
        document.querySelector('.rpt[data-rt="alerts"]')?.classList.add('active');
        S.rightTab='alerts'; renderAlerts();
      }
    };
  });

  // Search
  let st;
  id('searchInput').addEventListener('input',e=>{
    clearTimeout(st);const v=e.target.value.trim();
    if(v.length<2){hideDrop();return;}
    st=setTimeout(()=>doSearch(v),350);
  });
  id('searchInput').addEventListener('keydown',e=>{
    if(e.key==='Escape'){hideDrop();e.target.value='';}
    if(e.key==='Enter')doSearch(e.target.value.trim());
  });
  document.addEventListener('click',e=>{
    if(!document.querySelector('.searchbox').contains(e.target))hideDrop();
  });

  // Modals
  id('mClose').onclick=()=>closeModal('alertModal');
  id('alertModal').onclick=e=>e.target===id('alertModal')&&closeModal('alertModal');
  id('sClose').onclick=closeSettingsModal;
  id('settingsModal').onclick=e=>e.target===id('settingsModal')&&closeSettingsModal();
  id('scClose').onclick=()=>closeModal('stormCentralModal');
  id('stormCentralModal').onclick=e=>e.target===id('stormCentralModal')&&closeModal('stormCentralModal');
  id('tcClose').onclick=()=>closeModal('trafficModal');
  id('trafficModal').onclick=e=>e.target===id('trafficModal')&&closeModal('trafficModal');

  // Traffic cam search
  id('tcSearchBtn').onclick=()=>searchTrafficCams(id('tcSearch').value.trim());
  id('tcSearch').addEventListener('keydown',e=>e.key==='Enter'&&searchTrafficCams(id('tcSearch').value.trim()));

  // Storm Central auth
  initSCAuth();

  // Settings
  segBind('sTempUnit',v=>{S.cfg.tempUnit=v;saveCfg();if(S.weather){renderWeather(S.weather);renderForecast(S.weather);}});
  segBind('sWindUnit',v=>{S.cfg.windUnit=v;saveCfg();if(S.weather)renderWeather(S.weather);});
  segBind('sTimeFormat',v=>{S.cfg.timeFormat=v;saveCfg();if(S.weather){renderWeather(S.weather);renderForecast(S.weather);}if(S.frames.length)buildSlots();});
  segBind('sSpeed',v=>{S.cfg.speed=+v;saveCfg();if(S.playing){pause();play();}});
  segBind('sCardPos',v=>{S.cfg.cardPosition=v;saveCfg();if(S.weather)renderWeather(S.weather);});
  segBind('sCardStyle',v=>{S.cfg.cardStyle=v;saveCfg();if(S.weather)renderWeather(S.weather);});
  segBind('sRadarColor',v=>{
    S.cfg.radarColor=v; saveCfg();
    tileCache.clear(); // clear cache so new color loads
    if(S.frames.length)drawFrame(S.frame);
    showToast(`🎨 Radar: ${{'1':'Original','2':'Universal','4':'Rainbow','6':'NOAA'}[v]}`);
  });
  id('sOpacity').addEventListener('input',e=>{
    S.cfg.opacity=+e.target.value/100;id('sOpacityVal').textContent=e.target.value+'%';
    saveCfg();if(S.frames.length)drawFrame(S.frame);
  });
  id('sAutoPlay').addEventListener('change',e=>{S.cfg.autoPlay=e.target.checked;saveCfg();});
  id('sAlertZones').addEventListener('change',e=>{
    S.cfg.alertZones=e.target.checked;saveCfg();
    if(e.target.checked)putAlertsOnMap();else rmLayers(['alert-fill','alert-line'],['alerts-src']);
  });
  id('sCrosshair').addEventListener('change',e=>{
    S.cfg.crosshair=e.target.checked;saveCfg();
    id('crosshair').style.display=e.target.checked?'':'none';
  });
  id('sClickAction').addEventListener('change',e=>{S.cfg.clickAction=e.target.checked?'nws':'weather';saveCfg();});
  [['sfHumidity','showHumidity'],['sfPressure','showPressure'],['sfUV','showUV'],
   ['sfSunTimes','showSunTimes'],['sfWind','showWind'],['sfRain','showRain'],
   ['sfCloud','showCloud'],['sfFeels','showFeels']
  ].forEach(([elId,key])=>{
    const el=id(elId);if(!el)return;
    el.addEventListener('change',e=>{S.cfg[key]=e.target.checked;saveCfg();if(S.weather)renderWeather(S.weather);});
  });

  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeModal('alertModal');closeModal('settingsModal');closeModal('stormCentralModal');closeModal('trafficModal');}
  });

  applySettingsUI();
  updateLegend();
}

function renderRadarInfo(){
  const newest=S.frames.length?new Date(S.frames[S.frames.length-1].time*1000):null;
  id('alertsBody').innerHTML=`<div class="radar-info">
    <div class="ri-title">Radar Status</div>
    <div class="ri-stat"><span>Frames</span><span>${S.frames.length}/12</span></div>
    <div class="ri-stat"><span>Latest</span><span>${newest?fmtTime(newest,true):'N/A'}</span></div>
    <div class="ri-stat"><span>Color</span><span>${{'1':'Original','2':'Universal','4':'Rainbow','6':'NOAA'}[S.cfg.radarColor]||'NOAA'}</span></div>
    <div class="ri-stat"><span>Source</span><span>RainViewer</span></div>
    <div class="ri-stat"><span>Opacity</span><span>${Math.round(S.cfg.opacity*100)}%</span></div>
    <button class="ri-refresh" onclick="tileCache.clear();loadRadar();showToast('↻ Radar refreshed')">↻ Refresh Radar</button>
  </div>`;
}

function openModal(i){id(i).classList.add('open');}
function closeModal(i){id(i).classList.remove('open');}
function closeSettingsModal(){
  closeModal('settingsModal');
  document.querySelectorAll('.sni').forEach(x=>x.classList.remove('active'));
  document.querySelector('.sni[data-p="home"]').classList.add('active');
}
function segBind(cId,cb){
  document.querySelectorAll(`#${cId} .sb`).forEach(btn=>{
    btn.onclick=()=>{
      document.querySelectorAll(`#${cId} .sb`).forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');cb(btn.dataset.v);
    };
  });
}
function applySettingsUI(){
  const c=S.cfg;
  [['sTempUnit',c.tempUnit],['sWindUnit',c.windUnit],['sTimeFormat',c.timeFormat],
   ['sSpeed',String(c.speed)],['sRadarColor',String(c.radarColor)],
   ['sCardPos',c.cardPosition],['sCardStyle',c.cardStyle||'full']
  ].forEach(([cId,val])=>
    document.querySelectorAll(`#${cId} .sb`).forEach(b=>b.classList.toggle('active',b.dataset.v===val)));
  id('sOpacity').value=Math.round(c.opacity*100);
  id('sOpacityVal').textContent=Math.round(c.opacity*100)+'%';
  id('sAutoPlay').checked=c.autoPlay;
  id('sAlertZones').checked=c.alertZones;
  id('sCrosshair').checked=c.crosshair;
  id('sClickAction').checked=c.clickAction==='nws';
  if(!c.crosshair)id('crosshair').style.display='none';
  [['sfHumidity','showHumidity'],['sfPressure','showPressure'],['sfUV','showUV'],
   ['sfSunTimes','showSunTimes'],['sfWind','showWind'],['sfRain','showRain'],
   ['sfCloud','showCloud'],['sfFeels','showFeels']
  ].forEach(([elId,key])=>{const el=id(elId);if(el)el.checked=c[key];});
}

// ================================================================
//  PERSISTENCE
// ================================================================
function saveCfg(){try{localStorage.setItem('ss10_cfg',JSON.stringify(S.cfg));}catch(e){}}
function loadCfg(){try{const s=localStorage.getItem('ss10_cfg');if(s)Object.assign(S.cfg,JSON.parse(s));}catch(e){}}

// ================================================================
//  UTILITIES
// ================================================================
function id(x){return document.getElementById(x);}
function set(x,v){const el=id(x);if(el)el.textContent=v;}
function fmt2(n){return String(n).padStart(2,'0');}
function fmtTime(d, shortOnly=false){
  if(S.cfg.timeFormat==='24')
    return fmt2(d.getHours())+':'+fmt2(d.getMinutes());
  const h=d.getHours()%12||12, ampm=d.getHours()>=12?'PM':'AM';
  return shortOnly?`${h}${ampm}`:`${h}:${fmt2(d.getMinutes())}${ampm}`;
}
function fmtDateTime(d){
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+fmtTime(d);
}
function timeAgo(d){
  const s=Math.floor((Date.now()-d)/1000);
  if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;
  if(s<86400)return`${Math.floor(s/3600)}h ago`;return`${Math.floor(s/86400)}d ago`;
}
function cvtTemp(c){return S.cfg.tempUnit==='F'?Math.round(c*9/5+32):Math.round(c);}
function cvtWind(ms){
  if(S.cfg.windUnit==='kmh')return(ms*3.6).toFixed(1);
  if(S.cfg.windUnit==='mph')return(ms*2.237).toFixed(1);
  return ms.toFixed(1);
}
function wDir(d){return['N','NE','E','SE','S','SW','W','NW'][Math.round(d/45)%8];}
function uvLabel(uv){
  if(uv==null)return'';if(uv<=2)return'(Low)';if(uv<=5)return'(Mod)';
  if(uv<=7)return'(High)';if(uv<=10)return'(V.Hi)';return'(Ext)';
}
function wIcon(c){
  return({0:'☀️',1:'🌤',2:'⛅',3:'☁️',45:'🌫',48:'🌫',51:'🌦',53:'🌦',55:'🌧',
    56:'🌨',57:'🌨',61:'🌧',63:'🌧',65:'🌧',71:'🌨',73:'🌨',75:'❄️',77:'🌨',
    80:'🌦',81:'🌦',82:'🌧',85:'🌨',86:'❄️',95:'⛈',96:'⛈',99:'⛈'})[c]||'🌡';
}
function wDesc(c){
  return({0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Foggy',
    48:'Icy fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',
    63:'Moderate rain',65:'Heavy rain',71:'Light snow',73:'Moderate snow',75:'Heavy snow',
    77:'Snow grains',80:'Rain showers',81:'Heavy showers',82:'Violent showers',
    85:'Snow showers',86:'Heavy snow showers',95:'Thunderstorm',
    96:'Thunderstorm w/ hail',99:'Thunderstorm w/ heavy hail'})[c]||'Unknown';
}
function updateDate(){
  set('datePill',new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}));
}
let _tt;
function showToast(msg){
  const t=id('toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(_tt);_tt=setTimeout(()=>t.classList.remove('show'),3000);
}
function showLoader(show){id('loader').classList.toggle('show',show);}

console.log('⛈ Storm Surge v10.0 ready');