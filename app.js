// ================================================================
//  STORM SURGE WEATHER v9.1
//  - Fixed radar (redraws on every map move frame)
//  - Map click on alert zone → NWS report with hourly + extended
//  - Click anywhere in US → NWS point forecast
//  - Expanded settings: card position, visible fields, radar color
// ================================================================

const S = {
  map: null,
  canvas: null,
  ctx: null,
  lat: 40.7128,
  lng: -74.006,
  locName: 'New York',
  frames: [],
  frame: 11,
  playing: false,
  playTimer: null,
  alerts: [],
  weather: null,
  fcMode: 'hourly',
  mapStyle: 'dark',
  rightTab: 'alerts',
  alertFilter: 'all',
  cfg: {
    tempUnit: 'C',
    windUnit: 'ms',
    opacity: 0.75,
    speed: 600,
    autoPlay: false,
    alertZones: true,
    crosshair: true,
    cardPosition: 'top-left',
    showHumidity: true,
    showPressure: true,
    showUV: true,
    showSunTimes: true,
    showWind: true,
    showRain: true,
    showCloud: true,
    radarColor: '6',
    clickAction: 'nws'
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
  initMap();
  initUI();
  updateDate();
  setInterval(updateDate, 60000);
  setInterval(() => { loadWeather(); loadAlerts(); }, 10 * 60 * 1000);
});

// ================================================================
//  MAP
// ================================================================
function initMap() {
  S.canvas = document.getElementById('radarCanvas');
  S.ctx = S.canvas.getContext('2d');
  window.addEventListener('resize', resizeCanvas);

  try {
    mapboxgl.accessToken = MAPBOX_TOKEN;
    S.map = new mapboxgl.Map({
      container: 'map',
      style: MAP_STYLES.dark,
      center: [S.lng, S.lat],
      zoom: 6, minZoom: 2, maxZoom: 14,
      attributionControl: false,
      logoPosition: 'bottom-left',
      failIfMajorPerformanceCaveat: false
    });

    S.map.on('load', () => {
      S.map.resize();
      resizeCanvas();
      loadRadar();
      loadWeather();
      loadAlerts();
    });

    S.map.on('error', e => {
      console.error('Mapbox:', e);
      showMapError('Map error: ' + (e.error?.message || 'Check your token'));
      loadWeather(); loadAlerts();
    });

    // Radar locked to map — redraws every animation frame
    ['move','zoom','rotate','pitch'].forEach(ev =>
      S.map.on(ev, () => { if (S.frames.length) drawFrame(S.frame); })
    );

    S.map.on('click', handleMapClick);

  } catch(e) {
    console.error('Map init failed:', e);
    showMapError('Could not initialize map. Check your token.');
    loadWeather(); loadAlerts();
  }
}

function showMapError(msg) {
  document.getElementById('map').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100%;
      color:#f0a500;font-family:monospace;font-size:13px;flex-direction:column;gap:10px;
      background:#0d1117;padding:20px;text-align:center">
      <div style="font-size:36px">⛈</div>
      <div style="color:#e8eef5;font-weight:bold">${msg}</div>
      <div style="color:#4a5a6a;font-size:11px">
        Get a fresh token at <a href="https://account.mapbox.com" target="_blank"
        style="color:#00d4c8">account.mapbox.com</a><br>then update index.html
      </div>
    </div>`;
}

function cycleMapStyle() {
  if (!S.map) return;
  const i = STYLE_ORDER.indexOf(S.mapStyle);
  S.mapStyle = STYLE_ORDER[(i + 1) % STYLE_ORDER.length];
  S.map.setStyle(MAP_STYLES[S.mapStyle]);
  S.map.once('style.load', () => {
    if (S.cfg.alertZones && S.alerts.length) putAlertsOnMap();
    showToast(`🗺 Map: ${S.mapStyle}`);
  });
}

// ================================================================
//  MAP CLICK → NWS REPORT
// ================================================================
async function handleMapClick(e) {
  const lat = e.lngLat.lat;
  const lng = e.lngLat.lng;

  // If clicked inside an alert zone, show that alert
  if (S.map.getSource('alerts-src')) {
    const hits = S.map.queryRenderedFeatures(e.point, { layers: ['alert-fill'] });
    if (hits.length) {
      const ev = hits[0].properties.event;
      const idx = S.alerts.findIndex(a => a.properties.event === ev);
      if (idx >= 0) { openAlertModal(idx); return; }
    }
  }

  S.lat = lat; S.lng = lng;
  reverseGeocode(lat, lng);

  if (S.cfg.clickAction === 'nws') {
    showToast('📡 Fetching NWS report...');
    fetchNWSReport(lat, lng);
  } else {
    showToast('📍 Loading weather...');
    loadWeather();
  }
}

async function fetchNWSReport(lat, lng) {
  try {
    const ptRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`,
      { headers: { 'User-Agent': '(StormSurgeWeather/9.1)', 'Accept': 'application/geo+json' } }
    );
    if (!ptRes.ok) throw new Error('Not a US NWS point');
    const pt = await ptRes.json();
    const props = pt.properties;

    const [fRes, hRes] = await Promise.all([
      fetch(props.forecast,       { headers: { 'User-Agent': '(StormSurgeWeather/9.1)' } }),
      fetch(props.forecastHourly, { headers: { 'User-Agent': '(StormSurgeWeather/9.1)' } })
    ]);

    const fcast  = fRes.ok  ? await fRes.json()  : null;
    const hourly = hRes.ok  ? await hRes.json()  : null;

    openNWSModal(props, fcast, hourly);

  } catch(e) {
    console.warn('NWS fetch failed:', e);
    showToast('⚠ NWS unavailable here (US only) — loading Open-Meteo instead');
    loadWeather();
  }
}

function openNWSModal(props, fcast, hourly) {
  const city   = props.relativeLocation?.properties?.city  || S.locName;
  const state  = props.relativeLocation?.properties?.state || '';
  const office = props.cwa || 'NWS';
  const periods = fcast?.properties?.periods || [];
  const hPeriods = hourly?.properties?.periods?.slice(0, 12) || [];
  const now = hPeriods[0];

  set('mTitle', `📡 NWS — ${city}${state ? ', ' + state : ''}`);

  document.getElementById('mBody').innerHTML = `
    <div class="nws-header">
      <div class="nws-meta">
        <span class="nws-badge">${office}</span>
        <span class="nws-coords">${props.gridId} ${props.gridX},${props.gridY}</span>
      </div>
      ${now ? `
      <div class="nws-now">
        <div class="nws-now-temp">${now.temperature}°${now.temperatureUnit}</div>
        <div class="nws-now-desc">${now.shortForecast}</div>
        <div class="nws-now-wind">💨 ${now.windSpeed} ${now.windDirection}</div>
      </div>` : ''}
    </div>

    ${hPeriods.length ? `
    <div class="nws-stitle">Hourly</div>
    <div class="nws-hourly">
      ${hPeriods.map(p => {
        const t = new Date(p.startTime);
        const h = t.getHours(); const ampm = h >= 12 ? 'PM' : 'AM';
        return `<div class="nws-hr">
          <div class="nws-hr-t">${h%12||12}${ampm}</div>
          <div class="nws-hr-i">${p.isDaytime?'☀️':'🌙'}</div>
          <div class="nws-hr-v">${p.temperature}°</div>
          <div class="nws-hr-r">${p.probabilityOfPrecipitation?.value??0}%</div>
        </div>`;
      }).join('')}
    </div>` : ''}

    ${periods.length ? `
    <div class="nws-stitle">Extended Forecast</div>
    <div class="nws-periods">
      ${periods.slice(0, 8).map(p => `
      <div class="nws-period ${p.isDaytime?'day':'night'}">
        <div class="nws-pd-name">${p.name}</div>
        <div class="nws-pd-temp">${p.temperature}°${p.temperatureUnit}
          ${p.probabilityOfPrecipitation?.value!=null
            ? `<span class="nws-pd-rain">💧${p.probabilityOfPrecipitation.value}%</span>` : ''}
        </div>
        <div class="nws-pd-short">${p.shortForecast}</div>
        <div class="nws-pd-detail">${p.detailedForecast}</div>
      </div>`).join('')}
    </div>` : ''}
  `;
  openModal('alertModal');
}

// ================================================================
//  RADAR
// ================================================================
async function loadRadar() {
  try {
    const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const d = await r.json();
    if (d?.radar?.past?.length) {
      S.frames = d.radar.past.slice(-12);
      S.frame = S.frames.length - 1;
      buildSlots(); resizeCanvas(); drawFrame(S.frame);
      updateRadarInfo(d);
      if (S.cfg.autoPlay) play();
    }
  } catch(e) { console.warn('Radar unavailable', e); }
}

function resizeCanvas() {
  if (!S.canvas) return;
  const z = S.canvas.parentElement;
  S.canvas.width = z.clientWidth;
  S.canvas.height = z.clientHeight;
  if (S.frames.length) drawFrame(S.frame);
}

function drawFrame(idx) {
  if (!S.frames[idx] || !S.map || !S.ctx) return;
  const frame = S.frames[idx];
  const ctx = S.ctx;
  const canvas = S.canvas;
  const zoom = Math.max(2, Math.min(12, Math.floor(S.map.getZoom())));
  const bounds = S.map.getBounds();
  const color = S.cfg.radarColor || '6';

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  getTiles(bounds, zoom).forEach(tile => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `https://tilecache.rainviewer.com${frame.path}/256/${tile.z}/${tile.x}/${tile.y}/${color}/1_1.png`;
    img.onload = () => {
      if (!S.map) return;
      const nw = S.map.project([tile.b.west, tile.b.north]);
      const se = S.map.project([tile.b.east, tile.b.south]);
      const w = se.x - nw.x, h = se.y - nw.y;
      if (w > 0 && h > 0) {
        ctx.globalAlpha = S.cfg.opacity;
        ctx.drawImage(img, nw.x, nw.y, w, h);
      }
    };
  });
}

function getTiles(bounds, z) {
  const tiles = [];
  const nw = bounds.getNorthWest(), se = bounds.getSouthEast();
  const mn = ll2t(nw.lng, nw.lat, z), mx = ll2t(se.lng, se.lat, z);
  const max = Math.pow(2, z) - 1;
  for (let x = Math.max(0, mn.x); x <= Math.min(max, mx.x); x++)
    for (let y = Math.max(0, mn.y); y <= Math.min(max, mx.y); y++)
      tiles.push({ x, y, z, b: t2b(x, y, z) });
  return tiles;
}
function ll2t(lng, lat, z) {
  const n = 2**z, x = Math.floor((lng+180)/360*n);
  const lr = lat*Math.PI/180;
  const y = Math.floor((1-Math.log(Math.tan(lr)+1/Math.cos(lr))/Math.PI)/2*n);
  return { x: Math.max(0,x), y: Math.max(0,y) };
}
function t2b(x, y, z) {
  const n = 2**z;
  return { west:x/n*360-180, east:(x+1)/n*360-180,
    north:Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI,
    south:Math.atan(Math.sinh(Math.PI*(1-2*(y+1)/n)))*180/Math.PI };
}

function buildSlots() {
  const c = document.getElementById('tSlots');
  c.innerHTML = '';
  S.frames.forEach((f, i) => {
    const d = new Date(f.time * 1000);
    const btn = document.createElement('button');
    btn.className = 'tslot' + (i === S.frame ? ' active' : '');
    btn.textContent = fmt2(d.getHours()) + ':' + fmt2(d.getMinutes());
    btn.onclick = () => pickFrame(i);
    c.appendChild(btn);
  });
}
function pickFrame(i) {
  S.frame = i;
  document.querySelectorAll('.tslot').forEach((s,j) => s.classList.toggle('active', j===i));
  drawFrame(i);
}
function play() {
  if (S.playing) return; S.playing = true;
  const b = document.getElementById('playBtn');
  b.textContent='⏸'; b.classList.add('playing');
  S.playTimer = setInterval(() => pickFrame((S.frame+1)%S.frames.length), S.cfg.speed);
}
function pause() {
  S.playing=false; clearInterval(S.playTimer);
  const b = document.getElementById('playBtn');
  b.textContent='▶'; b.classList.remove('playing');
}
function togglePlay() { S.playing ? pause() : play(); }

function updateRadarInfo(data) {
  if (S.rightTab !== 'info') return;
  const past = data.radar?.past||[];
  const newest = past.length ? new Date(past[past.length-1].time*1000) : null;
  const colorNames = {'1':'Original','2':'Universal','3':'TITAN','4':'Rainbow','6':'NOAA'};
  document.getElementById('alertsBody').innerHTML = `
    <div class="radar-info">
      <div class="ri-title">Radar Status</div>
      <div class="ri-stat"><span>Frames</span><span>${S.frames.length}/12</span></div>
      <div class="ri-stat"><span>Latest frame</span><span>${newest?newest.toLocaleTimeString():'N/A'}</span></div>
      <div class="ri-stat"><span>Color scheme</span><span>${colorNames[S.cfg.radarColor]||'NOAA'}</span></div>
      <div class="ri-stat"><span>Source</span><span>RainViewer</span></div>
      <div class="ri-stat"><span>Interval</span><span>~10 min</span></div>
    </div>`;
}

// ================================================================
//  WEATHER
// ================================================================
async function loadWeather() {
  showLoader(true);
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${S.lat}&longitude=${S.lng}`
      + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,`
      + `weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,cloud_cover,uv_index`
      + `&hourly=temperature_2m,relative_humidity_2m,weather_code,precipitation_probability`
      + `&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,`
      + `precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=8`;
    const d = await (await fetch(url)).json();
    S.weather = d;
    renderWeather(d);
    renderForecast(d);
  } catch(e) {
    console.warn('Weather failed', e);
    showToast('⚠ Weather data unavailable');
  }
  showLoader(false);
}

function renderWeather(d) {
  const c = d.current;
  const windUnit = {ms:'m/s',kmh:'km/h',mph:'mph'}[S.cfg.windUnit];
  set('wcTemp',  `${cvtTemp(c.temperature_2m)}°${S.cfg.tempUnit}`);
  set('wcLoc',   S.locName);
  set('wcDesc',  wDesc(c.weather_code));
  set('wcIcon',  wIcon(c.weather_code));
  set('wcFeels', `${cvtTemp(c.apparent_temperature)}°${S.cfg.tempUnit}`);
  toggleStat('wcHum',   `${c.relative_humidity_2m}%`,                    S.cfg.showHumidity);
  toggleStat('wcWind',  `${cvtWind(c.wind_speed_10m)} ${windUnit}`,       S.cfg.showWind);
  toggleStat('wcDir',   `${c.wind_direction_10m}° ${wDir(c.wind_direction_10m)}`, S.cfg.showWind);
  toggleStat('wcRain',  `${(c.precipitation||0).toFixed(1)} mm`,          S.cfg.showRain);
  toggleStat('wcPres',  `${Math.round(c.surface_pressure)} hPa`,          S.cfg.showPressure);
  toggleStat('wcCloud', `${c.cloud_cover}%`,                              S.cfg.showCloud);
  toggleStat('wcUV',    `${c.uv_index??'--'} ${uvLabel(c.uv_index)}`,     S.cfg.showUV);
  const sunRow = document.querySelector('.wc-sun');
  if (S.cfg.showSunTimes && d.daily?.sunrise?.[0]) {
    const sr = new Date(d.daily.sunrise[0]), ss = new Date(d.daily.sunset[0]);
    set('wcSunrise', fmt2(sr.getHours())+':'+fmt2(sr.getMinutes()));
    set('wcSunset',  fmt2(ss.getHours())+':'+fmt2(ss.getMinutes()));
    if (sunRow) sunRow.style.display = '';
  } else { if (sunRow) sunRow.style.display='none'; }
  set('locName', S.locName);
  // Card position
  const wcard = document.getElementById('wcard');
  wcard.className = `wcard pos-${S.cfg.cardPosition}`;
}

function toggleStat(elId, val, show) {
  const el = document.getElementById(elId); if (!el) return;
  const row = el.closest('.wc-stat');
  if (row) row.style.display = show ? '' : 'none';
  if (show) el.textContent = val;
}

function renderForecast(d) {
  const c = document.getElementById('fcScroll');
  c.innerHTML = '';
  if (S.fcMode === 'hourly') {
    const hours = Math.min(24, d.hourly.temperature_2m.length);
    const nowH = new Date().getHours();
    for (let i = 0; i < hours; i++) {
      const t = new Date(d.hourly.time[i]);
      const isNow = t.getHours()===nowH && i<2;
      const div = document.createElement('div');
      div.className = 'fc-item'+(isNow?' now':'');
      div.innerHTML = `
        <div class="fc-t">${isNow?'NOW':fmt2(t.getHours())+':00'}</div>
        <div class="fc-i">${wIcon(d.hourly.weather_code[i])}</div>
        <div class="fc-v">${cvtTemp(d.hourly.temperature_2m[i])}°</div>
        <div class="fc-h">💧${d.hourly.relative_humidity_2m[i]}%</div>`;
      c.appendChild(div);
    }
  } else {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    d.daily.time.slice(0,7).forEach((ds,i) => {
      const day = new Date(ds);
      const div = document.createElement('div');
      div.className = 'fc-item'+(i===0?' now':'');
      div.innerHTML = `
        <div class="fc-t">${i===0?'TODAY':days[day.getDay()]}</div>
        <div class="fc-i">${wIcon(d.daily.weather_code[i])}</div>
        <div class="fc-v">${cvtTemp(d.daily.temperature_2m_max[i])}°/${cvtTemp(d.daily.temperature_2m_min[i])}°</div>
        <div class="fc-h">🌧${d.daily.precipitation_probability_max[i]}%</div>`;
      c.appendChild(div);
    });
  }
}

// ================================================================
//  ALERTS
// ================================================================
async function loadAlerts() {
  try {
    const r = await fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert',
      { headers: { 'User-Agent':'(StormSurgeWeather/9.1)', 'Accept':'application/geo+json' } });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    S.alerts = (d.features||[]).filter(f =>
      f.properties?.event && new Date(f.properties.expires) > new Date());
    renderAlerts(); updateAlertCounts();
    if (S.cfg.alertZones && S.map) putAlertsOnMap();
  } catch(e) { S.alerts=[]; renderAlerts(); updateAlertCounts(); }
}

function updateAlertCounts() {
  const n = S.alerts.length;
  set('alertBadge', n); set('navAlertBadge', n);
  document.getElementById('navAlertBadge').classList.toggle('show', n>0);
}

function alertSev(ev) {
  const e=(ev||'').toLowerCase();
  if (e.includes('tornado')||e.includes('hurricane')||e.includes('extreme')) return 'emergency';
  if (e.includes('warning')) return 'warning';
  if (e.includes('watch'))   return 'watch';
  if (e.includes('advisory'))return 'advisory';
  return 'default';
}
function alertIcon(ev) {
  const e=(ev||'').toLowerCase();
  if (e.includes('tornado'))  return '🌪';
  if (e.includes('hurricane')||e.includes('typhoon')) return '🌀';
  if (e.includes('thunder')||e.includes('lightning')) return '⛈';
  if (e.includes('snow')||e.includes('blizzard')||e.includes('winter')) return '❄️';
  if (e.includes('flood'))  return '🌊';
  if (e.includes('wind'))   return '💨';
  if (e.includes('fog'))    return '🌫';
  if (e.includes('fire'))   return '🔥';
  if (e.includes('heat'))   return '🌡';
  if (e.includes('ice')||e.includes('frost')) return '🧊';
  return '⚠️';
}

function renderAlerts() {
  if (S.rightTab !== 'alerts') return;
  const body = document.getElementById('alertsBody');
  const filtered = S.alerts.filter((a,i) => {
    a._idx=i;
    return S.alertFilter==='all' || alertSev(a.properties.event)===S.alertFilter;
  });
  const filterBar = `
    <div class="alert-filters">
      <button class="af-btn ${S.alertFilter==='all'?'active':''}" data-f="all">All <span>${S.alerts.length}</span></button>
      <button class="af-btn ${S.alertFilter==='emergency'?'active':''}" data-f="emergency">🌪 Extreme</button>
      <button class="af-btn ${S.alertFilter==='warning'?'active':''}" data-f="warning">⚠ Warning</button>
      <button class="af-btn ${S.alertFilter==='watch'?'active':''}" data-f="watch">👁 Watch</button>
      <button class="af-btn ${S.alertFilter==='advisory'?'active':''}" data-f="advisory">ℹ Advisory</button>
    </div>`;
  if (!filtered.length) {
    body.innerHTML = filterBar+'<div class="empty-s"><div class="es-ico">✓</div><div>No alerts match this filter</div></div>';
    bindFilterBtns(); return;
  }
  body.innerHTML = filterBar + filtered.map(a => {
    const p=a.properties, sev=alertSev(p.event), ico=alertIcon(p.event);
    const area=p.areaDesc?p.areaDesc.split(';')[0].trim():'Unknown area';
    const exp=p.expires?new Date(p.expires):null;
    const cc=sev==='emergency'||sev==='warning'?'warning':sev==='watch'?'watch':sev==='advisory'?'advisory':'';
    return `<div class="acard ${cc}" data-i="${a._idx}" tabindex="0">
      <span class="ac-arrow">›</span>
      <div class="ac-badge sev-${sev}">${ico} ${p.event}</div>
      <div class="ac-title">${p.headline||p.event}</div>
      <div class="ac-area">📍 ${area}</div>
      ${exp?`<div class="ac-exp">Expires ${exp.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${exp.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</div>`:''}
    </div>`;
  }).join('');
  document.querySelectorAll('.acard').forEach(card => {
    const open=()=>openAlertModal(+card.dataset.i);
    card.addEventListener('click', open);
    card.addEventListener('keydown', e=>(e.key==='Enter'||e.key===' ')&&open());
  });
  bindFilterBtns();
}

function bindFilterBtns() {
  document.querySelectorAll('.af-btn').forEach(btn =>
    btn.addEventListener('click', ()=>{ S.alertFilter=btn.dataset.f; renderAlerts(); }));
}

function openAlertModal(i) {
  const a=S.alerts[i]; if (!a) return;
  const p=a.properties, ico=alertIcon(p.event);
  const onset  = p.onset  ? new Date(p.onset)  : (p.sent?new Date(p.sent):null);
  const expires= p.expires? new Date(p.expires) : null;
  set('mTitle', `${ico} ${p.event}`);
  document.getElementById('mBody').innerHTML = `
    <div class="ad-hdr"><div class="ad-ico">${ico}</div><div class="ad-title">${p.headline||p.event}</div></div>
    <div class="ad-chips">
      ${onset  ?`<span class="ad-chip">📅 ${onset.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span>`:''}
      ${expires?`<span class="ad-chip">⏱ Expires ${expires.toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>`:''}
      ${p.severity ?`<span class="ad-chip">⚡ ${p.severity}</span>`:''}
      ${p.certainty?`<span class="ad-chip">🎯 ${p.certainty}</span>`:''}
      ${p.urgency  ?`<span class="ad-chip">⏰ ${p.urgency}</span>`:''}
    </div>
    ${p.areaDesc?`<div class="ad-chip" style="margin-bottom:12px;display:inline-block">📍 ${p.areaDesc.split(';').slice(0,3).join(' · ')}</div>`:''}
    <div class="ad-text">${p.description||'No description available.'}</div>
    ${p.instruction?`<div class="ad-sub"><div class="ad-sub-title">Instructions</div><div class="ad-text">${p.instruction}</div></div>`:''}`;
  openModal('alertModal');
}

function putAlertsOnMap() {
  if (!S.map||!S.map.isStyleLoaded()) return;
  rmLayers(['alert-fill','alert-line'],['alerts-src']);
  const valid=S.alerts.filter(a=>a.geometry);
  if (!valid.length) return;
  try {
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
  } catch(e) { console.warn(e); }
}

function rmLayers(layers,sources) {
  if (!S.map) return;
  try{layers.forEach(l=>S.map.getLayer(l)&&S.map.removeLayer(l));}catch(e){}
  try{sources.forEach(s=>S.map.getSource(s)&&S.map.removeSource(s));}catch(e){}
}

// ================================================================
//  SEARCH & GEO
// ================================================================
async function doSearch(q) {
  if (!q||q.length<2){hideDrop();return;}
  try {
    const d=await(await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&limit=5&types=place,locality,neighborhood,postcode`)).json();
    showDrop(d.features||[]);
  } catch(e){hideDrop();}
}
function showDrop(features) {
  const dd=document.getElementById('searchDrop');
  if (!features.length){hideDrop();return;}
  dd.style.display='block';
  dd.innerHTML=features.map((f,i)=>{
    const main=f.text||f.place_name.split(',')[0];
    const sub=f.place_name.split(',').slice(1,3).join(',').trim();
    return `<div class="s-drop-item" data-i="${i}"><strong>${main}</strong>${sub?` · <span style="color:var(--t3);font-size:11px">${sub}</span>`:''}</div>`;
  }).join('');
  dd.querySelectorAll('.s-drop-item').forEach(item=>{
    item.addEventListener('click',()=>{
      const f=features[+item.dataset.i],[lng,lat]=f.center;
      S.lat=lat;S.lng=lng;S.locName=f.text||f.place_name.split(',')[0];
      set('locName',S.locName);hideDrop();
      document.getElementById('searchInput').value='';
      if(S.map)S.map.flyTo({center:[lng,lat],zoom:9,duration:1400});
      loadWeather();showToast(`📍 ${f.place_name.split(',').slice(0,2).join(',')}`);
    });
  });
}
function hideDrop(){document.getElementById('searchDrop').style.display='none';}

async function reverseGeocode(lat,lng) {
  try {
    const d=await(await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`)).json();
    if(d.features?.length){
      S.locName=d.features[0].text||d.features[0].place_name.split(',')[0];
      set('locName',S.locName);set('wcLoc',S.locName);
    }
  } catch(e){}
}

function geolocate() {
  if(!navigator.geolocation){showToast('⚠ Geolocation not supported');return;}
  showToast('📍 Getting your location...');
  navigator.geolocation.getCurrentPosition(
    pos=>{
      S.lat=pos.coords.latitude;S.lng=pos.coords.longitude;
      if(S.map)S.map.flyTo({center:[S.lng,S.lat],zoom:10,duration:1200});
      reverseGeocode(S.lat,S.lng);loadWeather();
    },
    ()=>showToast('⚠ Location access denied')
  );
}

// ================================================================
//  LEGEND
// ================================================================
function updateLegend() {
  const layer=document.querySelector('.lb.active')?.dataset.layer||'precipitation';
  const cfg={
    precipitation:{label:'mm/h',grad:'linear-gradient(to top,#646464 0%,#04e9e7 15%,#019ff4 30%,#02fd02 45%,#fdf802 60%,#fd9500 75%,#fd0000 90%,#bc0000 100%)'},
    temperature:  {label:'°',   grad:'linear-gradient(to top,#313695,#4575b4,#74add1,#abd9e9,#ffffbf,#fdae61,#f46d43,#a50026)'},
    wind:         {label:'m/s', grad:'linear-gradient(to top,#3288bd,#66c2a5,#abdda4,#ffffbf,#fdae61,#f46d43,#d53e4f)'},
    clouds:       {label:'%',   grad:'linear-gradient(to top,#111,#333,#666,#999,#ccc,#eee)'},
    pressure:     {label:'hPa', grad:'linear-gradient(to top,#0000cc,#0080ff,#00ffff,#00ff00,#ffff00,#ff8000,#ff0000)'}
  };
  const c=cfg[layer]||cfg.precipitation;
  set('legTitle',c.label);
  document.getElementById('legBar').style.background=c.grad;
}

// ================================================================
//  UI WIRING
// ================================================================
function initUI() {
  id('burger').onclick   =()=>id('sidebar').classList.toggle('open');
  id('sidebarX').onclick =()=>id('sidebar').classList.remove('open');
  id('zoomIn').onclick   =()=>S.map?.zoomIn();
  id('zoomOut').onclick  =()=>S.map?.zoomOut();
  id('styleBtn').onclick =cycleMapStyle;
  id('geoBtn').onclick   =geolocate;
  id('refreshBtn').onclick=()=>{loadWeather();loadAlerts();if(S.map)loadRadar();showToast('↻ Refreshing...');};
  id('playBtn').onclick  =togglePlay;
  id('tPrev').onclick    =()=>S.frame>0&&pickFrame(S.frame-1);
  id('tNext').onclick    =()=>S.frame<S.frames.length-1&&pickFrame(S.frame+1);

  document.querySelectorAll('.lb[data-layer]').forEach(b=>{
    b.onclick=()=>{
      document.querySelectorAll('.lb[data-layer]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');updateLegend();
    };
  });
  document.querySelectorAll('.fct').forEach(t=>{
    t.onclick=()=>{
      document.querySelectorAll('.fct').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');S.fcMode=t.dataset.ft;
      if(S.weather)renderForecast(S.weather);
    };
  });
  document.querySelectorAll('.rpt').forEach(t=>{
    t.onclick=()=>{
      document.querySelectorAll('.rpt').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');S.rightTab=t.dataset.rt;
      if(S.rightTab==='alerts')renderAlerts();
      else if(S.rightTab==='info')updateRadarInfo({radar:{past:S.frames}});
    };
  });
  document.querySelectorAll('.sni').forEach(item=>{
    item.onclick=e=>{
      e.preventDefault();
      document.querySelectorAll('.sni').forEach(x=>x.classList.remove('active'));
      item.classList.add('active');
      const p=item.dataset.p;
      if(p==='settings')openModal('settingsModal');
      if(p==='alerts'){
        document.querySelectorAll('.rpt').forEach(x=>x.classList.remove('active'));
        document.querySelector('.rpt[data-rt="alerts"]')?.classList.add('active');
        S.rightTab='alerts';renderAlerts();
      }
    };
  });

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

  id('mClose').onclick    =()=>closeModal('alertModal');
  id('alertModal').onclick=e=>e.target===id('alertModal')&&closeModal('alertModal');
  id('sClose').onclick    =()=>closeSettingsModal();
  id('settingsModal').onclick=e=>e.target===id('settingsModal')&&closeSettingsModal();

  // Settings: units
  segBind('sTempUnit',v=>{S.cfg.tempUnit=v;saveCfg();if(S.weather){renderWeather(S.weather);renderForecast(S.weather);}});
  segBind('sWindUnit',v=>{S.cfg.windUnit=v;saveCfg();if(S.weather)renderWeather(S.weather);});
  segBind('sSpeed',   v=>{S.cfg.speed=+v;saveCfg();if(S.playing){pause();play();}});
  // Settings: radar
  id('sOpacity').addEventListener('input',e=>{
    S.cfg.opacity=+e.target.value/100;id('sOpacityVal').textContent=e.target.value+'%';
    saveCfg();if(S.frames.length)drawFrame(S.frame);
  });
  id('sAutoPlay').addEventListener('change',e=>{S.cfg.autoPlay=e.target.checked;saveCfg();});
  segBind('sRadarColor',v=>{
    S.cfg.radarColor=v;saveCfg();
    if(S.frames.length)drawFrame(S.frame);
    showToast(`🎨 Radar color: ${{'1':'Original','2':'Universal','3':'TITAN','4':'Rainbow','6':'NOAA'}[v]}`);
  });
  // Settings: map
  id('sAlertZones').addEventListener('change',e=>{
    S.cfg.alertZones=e.target.checked;saveCfg();
    if(e.target.checked)putAlertsOnMap();
    else rmLayers(['alert-fill','alert-line'],['alerts-src']);
  });
  id('sCrosshair').addEventListener('change',e=>{
    S.cfg.crosshair=e.target.checked;saveCfg();
    id('crosshair').style.display=e.target.checked?'':'none';
  });
  segBind('sCardPos',v=>{S.cfg.cardPosition=v;saveCfg();if(S.weather)renderWeather(S.weather);});
  id('sClickAction').addEventListener('change',e=>{S.cfg.clickAction=e.target.checked?'nws':'weather';saveCfg();});
  // Settings: card fields
  [['sfHumidity','showHumidity'],['sfPressure','showPressure'],['sfUV','showUV'],
   ['sfSunTimes','showSunTimes'],['sfWind','showWind'],['sfRain','showRain'],['sfCloud','showCloud']
  ].forEach(([elId,key])=>{
    const el=id(elId);if(!el)return;
    el.addEventListener('change',e=>{S.cfg[key]=e.target.checked;saveCfg();if(S.weather)renderWeather(S.weather);});
  });

  id('darkToggle').addEventListener('change',e=>showToast(e.target.checked?'🌙 Dark mode':'☀ Light mode'));
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeModal('alertModal');closeModal('settingsModal');}
  });

  applySettingsUI();
  updateLegend();
  updateDate();
}

function openModal(i) {id(i).classList.add('open');}
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
  document.querySelectorAll('#sTempUnit .sb').forEach(b=>b.classList.toggle('active',b.dataset.v===c.tempUnit));
  document.querySelectorAll('#sWindUnit .sb').forEach(b=>b.classList.toggle('active',b.dataset.v===c.windUnit));
  document.querySelectorAll('#sSpeed    .sb').forEach(b=>b.classList.toggle('active',b.dataset.v===String(c.speed)));
  document.querySelectorAll('#sRadarColor .sb').forEach(b=>b.classList.toggle('active',b.dataset.v===String(c.radarColor)));
  document.querySelectorAll('#sCardPos  .sb').forEach(b=>b.classList.toggle('active',b.dataset.v===c.cardPosition));
  id('sOpacity').value=Math.round(c.opacity*100);
  id('sOpacityVal').textContent=Math.round(c.opacity*100)+'%';
  id('sAutoPlay').checked=c.autoPlay;
  id('sAlertZones').checked=c.alertZones;
  id('sCrosshair').checked=c.crosshair;
  id('sClickAction').checked=c.clickAction==='nws';
  if(!c.crosshair)id('crosshair').style.display='none';
  [['sfHumidity','showHumidity'],['sfPressure','showPressure'],['sfUV','showUV'],
   ['sfSunTimes','showSunTimes'],['sfWind','showWind'],['sfRain','showRain'],['sfCloud','showCloud']
  ].forEach(([elId,key])=>{const el=id(elId);if(el)el.checked=c[key];});
}

// ================================================================
//  PERSISTENCE
// ================================================================
function saveCfg(){try{localStorage.setItem('ss9_cfg',JSON.stringify(S.cfg));}catch(e){}}
function loadCfg(){try{const s=localStorage.getItem('ss9_cfg');if(s)Object.assign(S.cfg,JSON.parse(s));}catch(e){}}

// ================================================================
//  UTILITIES
// ================================================================
function id(x){return document.getElementById(x);}
function set(x,v){const el=id(x);if(el)el.textContent=v;}
function fmt2(n){return String(n).padStart(2,'0');}
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
function updateDate(){set('datePill',new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}));}

let _tt;
function showToast(msg){
  const t=id('toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(_tt);_tt=setTimeout(()=>t.classList.remove('show'),3000);
}
function showLoader(show){id('loader').classList.toggle('show',show);}

console.log('⛈ Storm Surge v9.1 ready');