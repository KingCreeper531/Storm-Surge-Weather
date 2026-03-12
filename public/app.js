// ================================================================
//  STORM SURGE WEATHER v13.8
//  + AI assistant (Claude) · Spotter Network (mPing+SPC)
//  + Severe analysis panel · NEXRAD single-site
// ================================================================

// ── STATE ─────────────────────────────────────────────────────────
const S = {
  map: null, canvas: null, ctx: null,
  drawCanvas: null, drawCtx: null, drawing: false, drawMode: false,
  drawStrokes: [], drawColor: '#f59e0b', drawSize: 3,
  lat: 40.7128, lng: -74.006, locName: 'New York',
  frames: [], nowcastFrames: [], frame: 0, playing: false,
  showingNowcast: false,
  alerts: [], weather: null, aqi: null, marine: null,
  stormReports: [], severeData: null, spotterReports: [],
  fcMode: 'hourly', mapStyle: 'dark', rightTab: 'alerts',
  alertFilter: 'all', alertQuery: '',
  favorites: [],
  cfg: {
    tempUnit: 'C', windUnit: 'ms', distUnit: 'km', timeFormat: '12',
    opacity: 0.75, speed: 600, autoPlay: false, smooth: true,
    nowcast: true, alertZones: true, crosshair: true,
    cardPosition: 'top-left', cardStyle: 'full',
    radarColor: '6', clickAction: 'nws',
    theme: 'dark', animBg: true, aiPanel: true,
    lightning: true, stormCells: true, mcd: true, audio: false
  }
};

const API = (window.SS_API_URL || window.location.origin || '').replace(/\/$/, '');

const MAP_STYLES = {
  dark:      'mapbox://styles/mapbox/navigation-night-v1',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  outdoors:  'mapbox://styles/mapbox/outdoors-v12',
  light:     'mapbox://styles/mapbox/navigation-day-v1',
  streets:   'mapbox://styles/mapbox/streets-v12'
};
const STYLE_ORDER = ['dark','satellite','outdoors','light','streets'];

// ── BOOT ─────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  loadCfg();
  loadFavorites();
  applyTheme(S.cfg.theme);
  initMap();
  initUI();
  initDrawMode();
  updateDate();
  setInterval(updateDate, 30000);
  setInterval(() => { loadWeather(); loadAlerts(); }, 600000);
  setInterval(() => { if (window.SpotterNetwork?.isVisible()) SpotterNetwork.refresh(S.lat, S.lng); }, 300000);
});

// ── UTILS ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
const pad2 = n => String(n).padStart(2, '0');

function fmtTime(d, short) {
  if (S.cfg.timeFormat === '24') return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  const h = d.getHours() % 12 || 12, ampm = d.getHours() >= 12 ? 'PM' : 'AM';
  return short ? h + ampm : h + ':' + pad2(d.getMinutes()) + ' ' + ampm;
}
function fmtDateTime(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + fmtTime(d);
}
function cvtTemp(c) {
  if (!Number.isFinite(c)) return '--';
  return S.cfg.tempUnit === 'F' ? Math.round(c * 9 / 5 + 32) : Math.round(c);
}
function cvtWind(ms) {
  if (!Number.isFinite(ms)) return '--';
  if (S.cfg.windUnit === 'kmh') return (ms * 3.6).toFixed(1);
  if (S.cfg.windUnit === 'mph') return (ms * 2.237).toFixed(1);
  if (S.cfg.windUnit === 'kts') return (ms * 1.944).toFixed(1);
  return ms.toFixed(1);
}
function windUnit() { return { ms: 'm/s', kmh: 'km/h', mph: 'mph', kts: 'kts' }[S.cfg.windUnit] || 'm/s'; }
function cvtDist(km) {
  if (!Number.isFinite(km)) return '--';
  if (S.cfg.distUnit === 'mi') return (km * 0.621371).toFixed(1) + ' mi';
  return km.toFixed(1) + ' km';
}
function wDir(d) {
  if (!Number.isFinite(d)) return '--';
  return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(d / 22.5) % 16];
}
function uvLabel(uv) {
  if (!Number.isFinite(uv)) return '';
  if (uv <= 2) return 'Low'; if (uv <= 5) return 'Moderate';
  if (uv <= 7) return 'High'; if (uv <= 10) return 'Very High';
  return 'Extreme';
}
function uvColor(uv) {
  if (!Number.isFinite(uv)) return 'var(--t3)';
  if (uv <= 2) return '#22c55e'; if (uv <= 5) return '#f59e0b';
  if (uv <= 7) return '#f97316'; if (uv <= 10) return '#ef4444';
  return '#a855f7';
}
function wIcon(c) {
  const m = { 0:'☀️',1:'🌤',2:'⛅',3:'☁️',45:'🌫',48:'🌫',51:'🌦',53:'🌦',55:'🌧',56:'🌨',57:'🌨',
    61:'🌧',63:'🌧',65:'🌧',71:'🌨',73:'🌨',75:'❄️',77:'🌨',80:'🌦',81:'🌦',82:'🌧',
    85:'🌨',86:'❄️',95:'⛈',96:'⛈',99:'⛈' };
  return m[c] || '🌡';
}
function wDesc(c) {
  const m = { 0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
    45:'Fog',48:'Icy fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',
    56:'Light freezing drizzle',57:'Freezing drizzle',61:'Light rain',63:'Rain',
    65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',
    80:'Rain showers',81:'Heavy showers',82:'Violent showers',85:'Snow showers',
    86:'Heavy snow showers',95:'Thunderstorm',96:'T-storm w/ hail',99:'T-storm w/ heavy hail' };
  return m[c] || 'Unknown';
}
function heatIndex(tempC, rh) {
  const t = tempC * 9/5 + 32;
  if (t < 80 || rh < 40) return null;
  const hi = -42.379 + 2.04901523*t + 10.14333127*rh - 0.22475541*t*rh
    - 0.00683783*t*t - 0.05481717*rh*rh + 0.00122874*t*t*rh
    + 0.00085282*t*rh*rh - 0.00000199*t*t*rh*rh;
  return (hi - 32) * 5/9;
}
function updateDate() {
  const now = new Date();
  setText('datePill', now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
  setText('wcTime', fmtTime(now));
}
let _toastTimer;
function showToast(msg, duration = 3000) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}
function showLoader(v) { $('loader').classList.toggle('show', v); }
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function moonPhase(date) {
  const known = new Date('2000-01-06T18:14:00Z');
  const diff  = (date - known) / (1000 * 60 * 60 * 24);
  const cycle = 29.530588853;
  const phase = ((diff % cycle) + cycle) % cycle;
  const icons = ['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘'];
  const names = ['New Moon','Waxing Crescent','First Quarter','Waxing Gibbous',
                 'Full Moon','Waning Gibbous','Last Quarter','Waning Crescent'];
  const idx   = Math.round(phase / cycle * 8) % 8;
  return { icon: icons[idx], name: names[idx], phase };
}

// ── THEME ────────────────────────────────────────────────────────
function applyTheme(theme) {
  S.cfg.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  const icon = $('themeIcon'), lbl = $('themeLabel'), tog = $('themeTog');
  if (icon) icon.textContent = theme === 'dark' ? '🌙' : '☀️';
  if (lbl)  lbl.textContent  = theme === 'dark' ? 'Dark Mode' : 'Light Mode';
  if (tog)  tog.classList.toggle('on', theme === 'dark');
}
function updateBgAnim(code, isDay) {
  if (!S.cfg.animBg) { $('bgAnim').classList.add('bg-off'); return; }
  $('bgAnim').classList.remove('bg-off');
  const el = $('bgAnim');
  el.className = 'bg-anim';
  if (code >= 95)      el.classList.add('bg-storm');
  else if (code >= 61) el.classList.add('bg-rain');
  else if (code >= 71) el.classList.add('bg-snow');
  else if (code >= 51) el.classList.add('bg-rain');
  else if (code === 3) el.classList.add('bg-cloudy');
  else if (!isDay)     el.classList.add('bg-night');
  else                 el.classList.add('bg-clear');
}

// ── MAP ──────────────────────────────────────────────────────────
function initMap() {
  S.canvas = $('radarCanvas');
  S.ctx    = S.canvas.getContext('2d');
  window.addEventListener('resize', resizeCanvas);

  try {
    mapboxgl.accessToken = MAPBOX_TOKEN;
    S.map = new mapboxgl.Map({
      container:  'map',
      style:      MAP_STYLES[S.cfg.theme === 'light' ? 'light' : 'dark'],
      center:     [S.lng, S.lat],
      zoom:       5,
      minZoom:    2,
      maxZoom:    14,
      attributionControl:            false,
      logoPosition:                  'bottom-left',
      failIfMajorPerformanceCaveat:  false,
      renderWorldCopies:             false,
      antialias:  true
    });

    S.map.on('load', () => {
      S.map.resize();
      resizeCanvas();

      // RadarAnimator
      if (window.RadarAnimator) {
        RadarAnimator.init(S.map, S.canvas, {
          apiBase: API, opacity: S.cfg.opacity, color: S.cfg.radarColor,
          speed: S.cfg.speed, smooth: S.cfg.smooth, nowcast: S.cfg.nowcast
        });
        RadarAnimator.onFrameChange = (idx) => {
          S.frame = idx; S.frames = RadarAnimator._frames;
          updateSlotHighlight(idx);
          const tr = $('tRange'); if (tr) tr.value = idx;
          $('nowcastBadge').style.display = (S.cfg.nowcast && idx >= S.frames.length) ? 'flex' : 'none';
        };
        RadarAnimator.onPlayStateChange = (playing) => {
          S.playing = playing;
          $('playBtn').textContent = playing ? '⏸' : '▶';
          $('playBtn').classList.toggle('playing', playing);
        };
      }

      // NEXRAD
      if (window.NexradRadar) NexradRadar.init(S.map, API);
      if (window.NexradPanel) { NexradPanel.init(API); NexradPanel.preloadNearby(S.lat, S.lng); }

      // Spotter Network
      if (window.SpotterNetwork) {
        SpotterNetwork.init(S.map, API);
        SpotterNetwork.onUpdate = (reports) => {
          S.spotterReports = reports;
          updateSpotterBadge(reports.length);
        };
      }

      // Severe panel
      if (window.SeverePanel) SeverePanel.init(API);

      // AI panel
      if (window.AIPanel) {
        AIPanel.init(API, () => ({
          lat: S.lat, lng: S.lng,
          location: S.locName,
          weather: S.weather,
          severe: S.severeData,
          alerts: S.alerts,
          spotterReports: S.spotterReports.slice(0, 20)
        }));
      }

      loadRadar();
      loadWeather();
      loadAlerts();
    });

    S.map.on('error', e => {
      console.error('Mapbox:', e);
      showMapError('Map error — check your MAPBOX_TOKEN');
      loadWeather(); loadAlerts();
    });

    S.map.on('click', e => { if (!S.drawMode) handleMapClick(e); });

  } catch (e) {
    console.error('Map init failed:', e);
    showMapError('Could not init map — set MAPBOX_TOKEN env var');
    loadWeather(); loadAlerts();
  }
}

function showMapError(msg) {
  $('map').innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#f59e0b;font-family:monospace;flex-direction:column;gap:12px;padding:24px;text-align:center"><div style="font-size:48px">⛈</div><div style="font-weight:700;font-size:14px">${msg}</div></div>`;
}

function cycleMapStyle() {
  if (!S.map) return;
  const i = STYLE_ORDER.indexOf(S.mapStyle);
  S.mapStyle = STYLE_ORDER[(i + 1) % STYLE_ORDER.length];
  S.map.setStyle(MAP_STYLES[S.mapStyle]);
  S.map.once('style.load', () => {
    if (S.cfg.alertZones && S.alerts.length) putAlertsOnMap();
    if (window.RadarAnimator) RadarAnimator.refresh();
    if (window.NexradRadar && NexradRadar.isVisible()) {
      const st = NexradRadar._station, pr = NexradRadar._product;
      if (st) { NexradRadar.hide(); NexradRadar.show(st.id, pr, st); }
    }
    if (window.SpotterNetwork?.isVisible()) SpotterNetwork.renderMarkers?.();
    showToast('🗺 ' + S.mapStyle[0].toUpperCase() + S.mapStyle.slice(1));
  });
}

function resizeCanvas() {
  const mz = $('mapzone');
  const w  = mz ? mz.clientWidth  : window.innerWidth;
  const h  = mz ? mz.clientHeight : window.innerHeight;
  [S.canvas, S.drawCanvas].forEach(c => { if (!c) return; c.width = w; c.height = h; });
  if (window.RadarAnimator) RadarAnimator.resize();
}

// ── SPOTTER BADGE ─────────────────────────────────────────────────
function updateSpotterBadge(count) {
  const btn = $('spotterBtn');
  if (!btn) return;
  const existing = btn.querySelector('.spotter-count');
  if (existing) existing.remove();
  if (count > 0) {
    const badge = document.createElement('span');
    badge.className = 'spotter-count';
    badge.style.cssText = 'margin-left:4px;background:rgba(34,197,94,.3);border-radius:10px;padding:1px 6px;font-size:.7rem';
    badge.textContent = count;
    btn.appendChild(badge);
  }
}

// ── DRAW MODE ─────────────────────────────────────────────────────
function initDrawMode() {
  S.drawCanvas = $('drawCanvas');
  S.drawCtx    = S.drawCanvas.getContext('2d');
  const mpos = e => { const r = S.drawCanvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const tpos = e => { const r = S.drawCanvas.getBoundingClientRect(); return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top }; };
  const applyStyle = () => { S.drawCtx.strokeStyle = S.drawColor; S.drawCtx.lineWidth = S.drawSize; S.drawCtx.lineCap = 'round'; S.drawCtx.lineJoin = 'round'; };
  S.drawCanvas.addEventListener('mousedown',  e => { if (!S.drawMode) return; S.drawing = true; const p = mpos(e); S.drawCtx.beginPath(); S.drawCtx.moveTo(p.x, p.y); S.drawStrokes.push({ color: S.drawColor, size: S.drawSize, pts: [p] }); });
  S.drawCanvas.addEventListener('mousemove',  e => { if (!S.drawMode || !S.drawing) return; const p = mpos(e); applyStyle(); S.drawCtx.lineTo(p.x, p.y); S.drawCtx.stroke(); S.drawStrokes[S.drawStrokes.length - 1].pts.push(p); });
  ['mouseup','mouseleave'].forEach(ev => S.drawCanvas.addEventListener(ev, () => S.drawing = false));
  S.drawCanvas.addEventListener('touchstart', e => { if (!S.drawMode) return; e.preventDefault(); S.drawing = true; const p = tpos(e); S.drawCtx.beginPath(); S.drawCtx.moveTo(p.x, p.y); S.drawStrokes.push({ color: S.drawColor, size: S.drawSize, pts: [p] }); }, { passive: false });
  S.drawCanvas.addEventListener('touchmove',  e => { if (!S.drawMode || !S.drawing) return; e.preventDefault(); const p = tpos(e); applyStyle(); S.drawCtx.lineTo(p.x, p.y); S.drawCtx.stroke(); S.drawStrokes[S.drawStrokes.length - 1].pts.push(p); }, { passive: false });
  S.drawCanvas.addEventListener('touchend', () => S.drawing = false);
}
function enterDrawMode() { S.drawMode = true; S.drawCanvas.style.pointerEvents = 'all'; S.drawCanvas.style.cursor = 'crosshair'; $('drawToolbar').classList.add('show'); $('drawBtn').classList.add('active'); if (S.map) S.map.dragPan.disable(); showToast('✏ Draw mode on'); }
function exitDrawMode()  { S.drawMode = false; S.drawing = false; S.drawCanvas.style.pointerEvents = 'none'; S.drawCanvas.style.cursor = ''; $('drawToolbar').classList.remove('show'); $('drawBtn').classList.remove('active'); if (S.map) S.map.dragPan.enable(); showToast('Draw mode off'); }
function undoDraw() {
  if (!S.drawStrokes.length) return;
  S.drawStrokes.pop();
  S.drawCtx.clearRect(0, 0, S.drawCanvas.width, S.drawCanvas.height);
  S.drawStrokes.forEach(stroke => {
    if (stroke.pts.length < 2) return;
    S.drawCtx.beginPath(); S.drawCtx.moveTo(stroke.pts[0].x, stroke.pts[0].y);
    S.drawCtx.strokeStyle = stroke.color; S.drawCtx.lineWidth = stroke.size;
    S.drawCtx.lineCap = 'round'; S.drawCtx.lineJoin = 'round';
    stroke.pts.forEach((p, i) => { if (i > 0) S.drawCtx.lineTo(p.x, p.y); });
    S.drawCtx.stroke();
  });
}
function clearDraw() { S.drawStrokes = []; S.drawCtx.clearRect(0, 0, S.drawCanvas.width, S.drawCanvas.height); }

// ── MAP CLICK ────────────────────────────────────────────────────
function handleMapClick(e) {
  const { lat, lng } = e.lngLat;
  if (S.map.getSource && S.map.getSource('alerts-src')) {
    const hits = S.map.queryRenderedFeatures(e.point, { layers: ['alert-fill'] });
    if (hits.length) {
      const idx = S.alerts.findIndex(a => a.properties.event === hits[0].properties.event);
      if (idx >= 0) { openAlertModal(idx); return; }
    }
  }
  S.lat = lat; S.lng = lng;
  reverseGeocode(lat, lng);
  if (S.cfg.clickAction === 'nws') { showToast('📡 Fetching NWS forecast…'); fetchNWSReport(lat, lng); }
  else loadWeather();
}

async function fetchNWSReport(lat, lng) {
  try {
    const ptRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`,
      { headers: { 'User-Agent': '(StormSurgeWeather/13.8)', 'Accept': 'application/geo+json' } });
    if (!ptRes.ok) throw new Error('NWS points: ' + ptRes.status);
    const pt = await ptRes.json();
    if (!pt.properties?.forecast) throw new Error('Location outside NWS coverage');
    const props = pt.properties;
    const [fcastRes, hourlyRes] = await Promise.allSettled([
      fetch(props.forecast,       { headers: { 'User-Agent': '(StormSurgeWeather/13.8)' } }),
      fetch(props.forecastHourly, { headers: { 'User-Agent': '(StormSurgeWeather/13.8)' } })
    ]);
    const fcast  = fcastRes.status  === 'fulfilled' && fcastRes.value.ok  ? await fcastRes.value.json()  : null;
    const hourly = hourlyRes.status === 'fulfilled' && hourlyRes.value.ok ? await hourlyRes.value.json() : null;
    openNWSModal(props, fcast, hourly);
  } catch (e) {
    console.warn('NWS error:', e.message);
    showToast('⚠ NWS only covers the continental US'); loadWeather();
  }
}

function openNWSModal(props, fcast, hourly) {
  const city  = props.relativeLocation?.properties?.city  || S.locName;
  const state = props.relativeLocation?.properties?.state || '';
  const hP    = hourly?.properties?.periods?.slice(0, 12) || [];
  const now   = hP[0];
  setText('mTitle', '📡 NWS — ' + city + (state ? ', ' + state : ''));
  $('mBody').innerHTML =
    '<div class="nws-header">' +
      '<div class="nws-meta"><span class="nws-badge">' + escHtml(props.cwa || 'NWS') + '</span>' +
        '<span class="nws-coords">' + escHtml(props.gridId + ' ' + props.gridX + ',' + props.gridY) + '</span></div>' +
      (now ? '<div class="nws-now"><div class="nws-now-temp">' + escHtml(now.temperature + '°' + now.temperatureUnit) + '</div>' +
        '<div class="nws-now-desc">' + escHtml(now.shortForecast) + '</div>' +
        '<div class="nws-now-wind">💨 ' + escHtml(now.windSpeed + ' ' + now.windDirection) + '</div></div>' : '') +
    '</div>' +
    (hP.length ? '<div class="nws-stitle">Hourly</div><div class="nws-hourly">' +
      hP.map(p => {
        const t = new Date(p.startTime);
        return '<div class="nws-hr"><div class="nws-hr-t">' + fmtTime(t, true) + '</div>' +
          '<div class="nws-hr-i">' + (p.isDaytime ? '☀️' : '🌙') + '</div>' +
          '<div class="nws-hr-v">' + p.temperature + '°</div>' +
          '<div class="nws-hr-r">' + (p.probabilityOfPrecipitation?.value ?? 0) + '%</div></div>';
      }).join('') + '</div>' : '') +
    (fcast?.properties?.periods?.length ? '<div class="nws-stitle">Extended Forecast</div><div class="nws-periods">' +
      fcast.properties.periods.slice(0, 8).map(p =>
        '<div class="nws-period ' + (p.isDaytime ? 'day' : 'night') + '"><div class="nws-pd-name">' + escHtml(p.name) + '</div>' +
          '<div class="nws-pd-temp">' + p.temperature + '°' + p.temperatureUnit +
            (p.probabilityOfPrecipitation?.value != null ? '<span class="nws-pd-rain">💧' + p.probabilityOfPrecipitation.value + '%</span>' : '') + '</div>' +
          '<div class="nws-pd-short">' + escHtml(p.shortForecast) + '</div>' +
          '<div class="nws-pd-detail">' + escHtml(p.detailedForecast) + '</div></div>'
      ).join('') + '</div>' : '');
  openModal('alertModal');
}

// ── RADAR ────────────────────────────────────────────────────────
async function loadRadar() {
  try {
    const r = await fetch(`${API}/api/radar/frames`);
    if (!r.ok) throw new Error('Radar ' + r.status);
    const d = await r.json();
    S.frames        = d.past    || [];
    S.nowcastFrames = S.cfg.nowcast ? (d.nowcast || []) : [];
    if (!S.frames.length) throw new Error('No frames');
    S.frame = S.frames.length - 1;
    S.showingNowcast = false;
    buildSlots();
    resizeCanvas();
    if (window.RadarAnimator) {
      RadarAnimator.setFrames(S.frames, S.nowcastFrames);
      RadarAnimator.goTo(S.frame);
      if (S.cfg.autoPlay) RadarAnimator.play();
    }
  } catch (e) {
    console.warn('Radar load failed:', e.message);
    showToast('⚠ Radar unavailable');
  }
}

function allFrames() { return S.showingNowcast ? [...S.frames, ...S.nowcastFrames] : S.frames; }

function buildSlots() {
  const frames = allFrames();
  const c  = $('tSlots'); if (!c) return;
  c.innerHTML = '';
  const tr = $('tRange');
  if (tr) { tr.max = Math.max(0, frames.length - 1); tr.value = S.frame; }
  frames.forEach((f, i) => {
    const d   = new Date(f.time * 1000);
    const btn = document.createElement('button');
    btn.className = 'tslot' + (i === S.frame ? ' active' : '') + (i >= S.frames.length ? ' nowcast' : '');
    btn.textContent = i >= S.frames.length ? '+' + ((i - S.frames.length + 1) * 10) + 'm' : fmtTime(d, true);
    btn.title = i >= S.frames.length ? 'Nowcast +' + ((i - S.frames.length + 1) * 10) + 'min' : d.toLocaleTimeString();
    btn.onclick = () => pickFrame(i);
    c.appendChild(btn);
  });
}

function updateSlotHighlight(idx) { document.querySelectorAll('.tslot').forEach((s, j) => s.classList.toggle('active', j === idx)); }
function pickFrame(i) { S.frame = Math.max(0, Math.min(allFrames().length - 1, i)); updateSlotHighlight(i); const tr = $('tRange'); if (tr) tr.value = i; if (window.RadarAnimator) RadarAnimator.goTo(i); }
function togglePlay() { if (window.RadarAnimator) RadarAnimator.togglePlay(); }
function toggleNowcast() {
  if (!S.nowcastFrames.length) { showToast('⚠ Nowcast not available'); return; }
  S.showingNowcast = !S.showingNowcast;
  if (window.RadarAnimator) RadarAnimator.setFrames(S.frames, S.showingNowcast ? S.nowcastFrames : []);
  buildSlots();
  showToast(S.showingNowcast ? '🟢 Nowcast ON (+30min)' : 'Nowcast OFF');
}

// ── WEATHER ──────────────────────────────────────────────────────
async function loadWeather() {
  showLoader(true);
  try {
    const r = await fetch(`${API}/api/weather?lat=${S.lat}&lng=${S.lng}`);
    if (!r.ok) throw new Error('Weather ' + r.status);
    const d = await r.json();
    S.weather = d;
    renderWeather(d);
    renderForecast(d);
    updateBgAnim(d.current?.weather_code, d.current?.is_day);
    loadAQI();
    if (window.NexradPanel) NexradPanel.updateLocation(S.lat, S.lng);
    if (window.SpotterNetwork?.isVisible()) SpotterNetwork.refresh(S.lat, S.lng);
  } catch (e) {
    console.warn('Weather failed:', e.message);
    showToast('⚠ Weather unavailable');
  }
  showLoader(false);
}

function renderWeather(d) {
  const c  = d.current || {};
  const wu = windUnit();
  setText('wcLoc',        S.locName);
  setText('locName',      S.locName);
  setText('sideLocName',  S.locName);
  setText('sideLocCoords', S.lat.toFixed(2) + '°' + (S.lat >= 0 ? 'N' : 'S') + '  ' + Math.abs(S.lng).toFixed(2) + '°' + (S.lng < 0 ? 'W' : 'E'));
  setText('snapTemp', cvtTemp(c.temperature_2m) + '°');
  setText('snapIcon', wIcon(c.weather_code));
  setText('snapDesc', wDesc(c.weather_code));
  setText('wcTemp',  cvtTemp(c.temperature_2m) + '°' + S.cfg.tempUnit);
  setText('wcFeels', 'Feels ' + cvtTemp(c.apparent_temperature) + '°');
  setText('wcDesc',  wDesc(c.weather_code));
  setText('wcIcon',  wIcon(c.weather_code));
  const daily = d.daily || {};
  if (daily.temperature_2m_max?.[0] != null) {
    setText('wcHi',   'H: ' + cvtTemp(daily.temperature_2m_max[0]) + '°');
    setText('wcLo',   'L: ' + cvtTemp(daily.temperature_2m_min[0]) + '°');
    setText('snapHi', 'H:' + cvtTemp(daily.temperature_2m_max[0]) + '°');
    setText('snapLo', 'L:' + cvtTemp(daily.temperature_2m_min[0]) + '°');
  }
  setText('wcHum',   (c.relative_humidity_2m ?? '--') + '%');
  setText('wcDew',   cvtTemp(c.dew_point_2m) + '°' + S.cfg.tempUnit);
  setText('wcWind',  cvtWind(c.wind_speed_10m) + ' ' + wu + ' ' + wDir(c.wind_direction_10m));
  setText('wcGust',  cvtWind(c.wind_gusts_10m) + ' ' + wu);
  setText('wcRain',  (c.precipitation ?? 0).toFixed(1) + ' mm');
  setText('wcVis',   cvtDist((c.visibility ?? 0) / 1000));
  setText('wcPres',  Math.round(c.surface_pressure ?? 0) + ' hPa');
  setText('wcCloud', (c.cloud_cover ?? '--') + '%');
  const hi = heatIndex(c.temperature_2m, c.relative_humidity_2m);
  const hiEl = $('wcHeatIdx');
  if (hiEl) {
    if (hi != null) {
      hiEl.textContent = cvtTemp(hi) + '°' + S.cfg.tempUnit;
      hiEl.style.color = hi > 40 ? '#ef4444' : hi > 32 ? '#f97316' : '';
      hiEl.previousElementSibling.textContent = '🌡 Heat Idx';
    } else {
      hiEl.textContent = cvtTemp(c.apparent_temperature) + '°' + S.cfg.tempUnit;
      hiEl.previousElementSibling.textContent = '🌡 Feels Like';
    }
  }
  const uv     = c.uv_index;
  const uvEl   = $('wcUV');
  const uvFill = $('wcUVFill');
  if (uvEl)   { uvEl.textContent = (uv != null ? uv : '--') + ' ' + uvLabel(uv); uvEl.style.color = uvColor(uv); }
  if (uvFill && uv != null) uvFill.style.left = Math.min(100, (uv / 11) * 100) + '%';
  if (daily.sunrise?.[0]) {
    const sr = new Date(daily.sunrise[0]), ss = new Date(daily.sunset[0]), now = new Date();
    setText('wcSunrise', fmtTime(sr, true));
    setText('wcSunset',  fmtTime(ss, true));
    setText('wcDaylight', Math.round((daily.daylight_duration?.[0] || 0) / 3600) + 'h');
    updateSunArc(sr, ss, now);
  }
  const moon = moonPhase(new Date());
  setText('wcMoon', moon.icon + ' ' + moon.name);
  $('wcard').className = 'wcard pos-' + S.cfg.cardPosition + ' style-' + (S.cfg.cardStyle || 'full');
}

function updateSunArc(sunrise, sunset, now) {
  const track = 157, total = sunset - sunrise, elapsed = now - sunrise;
  const pct = Math.max(0, Math.min(1, elapsed / total));
  const prog = $('sunArcProg'), dot = $('sunDot');
  if (!prog || !dot) return;
  prog.setAttribute('stroke-dasharray', (pct * track) + ' ' + track);
  const angle = Math.PI - pct * Math.PI;
  dot.setAttribute('cx', (60 + 50 * Math.cos(angle)).toFixed(1));
  dot.setAttribute('cy', (55 - 50 * Math.sin(angle)).toFixed(1));
}

function renderForecast(d) {
  const c = $('fcScroll'); if (!c) return;
  c.innerHTML = '';
  if (S.fcMode === 'hourly') {
    for (let i = 0; i < Math.min(24, d.hourly.temperature_2m.length); i++) {
      const t = new Date(d.hourly.time[i]);
      const precip = d.hourly.precipitation_probability?.[i] ?? 0;
      const cape   = d.hourly.cape?.[i] || 0;
      const div = document.createElement('div');
      div.className = 'fc-item' + (i === 0 ? ' now' : '');
      div.innerHTML =
        '<div class="fc-t">' + (i === 0 ? 'NOW' : fmtTime(t, true)) + '</div>' +
        '<div class="fc-i">' + wIcon(d.hourly.weather_code[i]) + '</div>' +
        '<div class="fc-v">' + cvtTemp(d.hourly.temperature_2m[i]) + '°</div>' +
        '<div class="fc-h" style="opacity:' + (precip > 5 ? 1 : 0.35) + '">🌧 ' + precip + '%</div>' +
        (cape >= 500 ? '<div style="font-size:.65rem;color:#f97316;margin-top:2px">⚡' + cape + '</div>' : '') +
        '<div class="fc-pbar-wrap"><div class="fc-pbar-fill" style="width:' + Math.round(precip) + '%"></div></div>';
      c.appendChild(div);
    }
  } else if (S.fcMode === 'daily') {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    (d.daily.time || []).slice(0, 10).forEach((ds, i) => {
      const day  = new Date(ds);
      const hi   = cvtTemp(d.daily.temperature_2m_max[i]);
      const lo   = cvtTemp(d.daily.temperature_2m_min[i]);
      const rain = d.daily.precipitation_probability_max?.[i] ?? 0;
      const wind = cvtWind(d.daily.wind_speed_10m_max?.[i] ?? 0);
      const prec = (d.daily.precipitation_sum?.[i] ?? 0).toFixed(1);
      const div  = document.createElement('div');
      div.className = 'fc-item fc-day' + (i === 0 ? ' now' : '');
      div.innerHTML =
        '<div class="fc-t">' + (i === 0 ? 'TODAY' : days[day.getDay()]) + '</div>' +
        '<div class="fc-i">' + wIcon(d.daily.weather_code[i]) + '</div>' +
        '<div class="fc-v">' + hi + '°<span class="fc-lo">/' + lo + '°</span></div>' +
        '<div class="fc-sub">🌧 ' + rain + '%  💧 ' + prec + 'mm</div>' +
        '<div class="fc-wind">💨 ' + wind + ' ' + windUnit() + '</div>';
      c.appendChild(div);
    });
  } else if (S.fcMode === 'precip') renderPrecipChart(d, c);
  else if (S.fcMode === 'wind')   renderWindChart(d, c);
  else if (S.fcMode === 'feels')  renderFeelsChart(d, c);
}

function renderPrecipChart(d, container) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100px;display:block';
  container.appendChild(canvas);
  requestAnimationFrame(() => {
    const w = canvas.parentElement.clientWidth;
    canvas.width = w; canvas.height = 100;
    const ctx2 = canvas.getContext('2d');
    const vals = d.hourly.precipitation_probability.slice(0, 24);
    const barW = w / vals.length;
    ctx2.fillStyle = 'rgba(6,182,212,0.08)'; ctx2.fillRect(0, 0, w, 100);
    vals.forEach((v, i) => {
      const h = (v / 100) * 78, intensity = Math.min(1, v / 100);
      ctx2.fillStyle = `rgba(6,182,212,${0.25 + intensity * 0.75})`;
      ctx2.fillRect(i * barW + 1, 100 - h, barW - 2, h);
      if (i % 4 === 0) { ctx2.fillStyle = 'rgba(255,255,255,0.45)'; ctx2.font = '9px JetBrains Mono, monospace'; ctx2.fillText(fmtTime(new Date(d.hourly.time[i]), true), i * barW + 1, 97); }
    });
    ctx2.strokeStyle = 'rgba(6,182,212,0.5)'; ctx2.lineWidth = 1; ctx2.setLineDash([4,4]);
    ctx2.beginPath(); ctx2.moveTo(0, 40); ctx2.lineTo(w, 40); ctx2.stroke();
    ctx2.fillStyle = 'rgba(255,255,255,0.7)'; ctx2.font = 'bold 10px Outfit, sans-serif';
    ctx2.fillText('Precipitation probability (24h)', 6, 14);
  });
}

function renderWindChart(d, container) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100px;display:block';
  container.appendChild(canvas);
  requestAnimationFrame(() => {
    const w = canvas.parentElement.clientWidth;
    canvas.width = w; canvas.height = 100;
    const ctx2  = canvas.getContext('2d');
    const vals  = d.hourly.wind_speed_10m.slice(0, 24);
    const gusts = d.hourly.wind_gusts_10m.slice(0, 24);
    const maxV  = Math.max(...gusts, 1);
    ctx2.fillStyle = 'rgba(168,85,247,0.07)'; ctx2.fillRect(0, 0, w, 100);
    const path = pts => { ctx2.beginPath(); pts.forEach((v, i) => { const x = (i / (pts.length - 1)) * w, y = 90 - (v / maxV) * 78; i === 0 ? ctx2.moveTo(x, y) : ctx2.lineTo(x, y); }); };
    ctx2.fillStyle = 'rgba(168,85,247,0.18)';
    path(gusts); ctx2.lineTo(w, 100); ctx2.lineTo(0, 100); ctx2.closePath(); ctx2.fill();
    ctx2.strokeStyle = 'rgba(168,85,247,0.6)'; ctx2.lineWidth = 1; ctx2.setLineDash([]);
    path(gusts); ctx2.stroke();
    ctx2.strokeStyle = '#a855f7'; ctx2.lineWidth = 2; path(vals); ctx2.stroke();
    ctx2.fillStyle = 'rgba(255,255,255,0.7)'; ctx2.font = 'bold 10px Outfit, sans-serif';
    ctx2.fillText('Wind ' + windUnit() + ' — line=speed, fill=gusts (24h)', 6, 14);
  });
}

function renderFeelsChart(d, container) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100px;display:block';
  container.appendChild(canvas);
  requestAnimationFrame(() => {
    const w = canvas.parentElement.clientWidth;
    canvas.width = w; canvas.height = 100;
    const ctx2 = canvas.getContext('2d');
    const temps = d.hourly.temperature_2m.slice(0, 24).map(cvtTemp);
    const feels = d.hourly.apparent_temperature.slice(0, 24).map(cvtTemp);
    const allVals = [...temps, ...feels].filter(v => v !== '--');
    const minV = Math.min(...allVals) - 2, maxV = Math.max(...allVals) + 2;
    const scaleY = v => 90 - ((v - minV) / (maxV - minV)) * 78;
    ctx2.fillStyle = 'rgba(240,165,0,0.06)'; ctx2.fillRect(0, 0, w, 100);
    const drawLine = (data, color, width) => { ctx2.beginPath(); ctx2.strokeStyle = color; ctx2.lineWidth = width; data.forEach((v, i) => { const x = (i / (data.length - 1)) * w, y = scaleY(v); i === 0 ? ctx2.moveTo(x, y) : ctx2.lineTo(x, y); }); ctx2.stroke(); };
    drawLine(temps, 'rgba(240,165,0,0.6)', 1.5);
    drawLine(feels, '#f97316', 2);
    ctx2.fillStyle = 'rgba(255,255,255,0.7)'; ctx2.font = 'bold 10px Outfit, sans-serif';
    ctx2.fillText('Temperature (amber) vs Feels Like (orange) — 24h', 6, 14);
  });
}

// ── AQI ──────────────────────────────────────────────────────────
async function loadAQI() {
  try {
    const r = await fetch(`${API}/api/airquality?lat=${S.lat}&lng=${S.lng}`);
    if (!r.ok) throw new Error('AQI ' + r.status);
    S.aqi = await r.json();
    const aqi = S.aqi.current?.us_aqi;
    if (aqi != null) { const el = $('wcAQI'); if (el) { el.textContent = aqi + ' — ' + aqiLabel(aqi); el.style.color = aqiColor(aqi); } }
  } catch (e) { const el = $('wcAQI'); if (el) el.textContent = 'N/A'; }
}
function aqiLabel(aqi) { if (aqi <= 50) return 'Good'; if (aqi <= 100) return 'Moderate'; if (aqi <= 150) return 'Unhealthy (Sensitive)'; if (aqi <= 200) return 'Unhealthy'; if (aqi <= 300) return 'Very Unhealthy'; return 'Hazardous'; }
function aqiColor(aqi) { if (aqi <= 50) return '#22c55e'; if (aqi <= 100) return '#f59e0b'; if (aqi <= 150) return '#f97316'; if (aqi <= 200) return '#ef4444'; if (aqi <= 300) return '#a855f7'; return '#7f1d1d'; }
async function openAQIPanel() {
  openModal('aqiModal');
  if (!S.aqi) { $('aqiBody').innerHTML = '<div class="empty-s"><div class="es-ico">💨</div><div>Loading…</div></div>'; await loadAQI(); }
  if (!S.aqi) { $('aqiBody').innerHTML = '<div class="empty-s"><div class="es-ico">⚠</div><div>AQI data unavailable</div></div>'; return; }
  const c = S.aqi.current || {};
  const aqi = c.us_aqi;
  const pct = Math.min(100, ((aqi || 0) / 500) * 100);
  const hourlyAQI = S.aqi.hourly?.us_aqi?.slice(0, 24) || [];
  $('aqiBody').innerHTML =
    '<div class="aqi-hero"><div class="aqi-value" style="color:' + aqiColor(aqi) + '">' + (aqi ?? '--') + '</div>' +
    '<div class="aqi-label">' + aqiLabel(aqi) + '</div>' +
    '<div class="aqi-bar"><div class="aqi-bar-fill" style="width:' + pct + '%;background:' + aqiColor(aqi) + '"></div></div></div>' +
    '<div class="aqi-grid">' + aqiStat('PM2.5',c.pm2_5,'μg/m³') + aqiStat('PM10',c.pm10,'μg/m³') +
    aqiStat('NO₂',c.nitrogen_dioxide,'μg/m³') + aqiStat('O₃',c.ozone,'μg/m³') +
    aqiStat('SO₂',c.sulphur_dioxide,'μg/m³') + aqiStat('CO',c.carbon_monoxide?(c.carbon_monoxide/1000).toFixed(2):null,'mg/m³') + '</div>' +
    (hourlyAQI.length ? '<div class="aqi-24h-title">24-Hour AQI Trend</div><canvas id="aqiChart" style="width:100%;height:80px;display:block"></canvas>' : '') +
    '<div class="aqi-guide"><div class="aqi-guide-title">US AQI Scale</div>' +
    ['Good|0-50|#22c55e','Moderate|51-100|#f59e0b','Unhealthy (Sensitive)|101-150|#f97316',
     'Unhealthy|151-200|#ef4444','Very Unhealthy|201-300|#a855f7','Hazardous|301+|#7f1d1d'
    ].map(s => { const [label,range,color] = s.split('|'); return `<div class="aqi-scale-row"><span class="aqi-dot" style="background:${color}"></span><span>${label}</span><span style="color:var(--t3);font-size:11px">${range}</span></div>`; }).join('') + '</div>';
  if (hourlyAQI.length) { requestAnimationFrame(() => { const canvas = $('aqiChart'); if (!canvas) return; const w = canvas.parentElement.clientWidth; canvas.width = w; canvas.height = 80; const ctx2 = canvas.getContext('2d'); const maxA = Math.max(...hourlyAQI, 1), barW = w / hourlyAQI.length; hourlyAQI.forEach((v, i) => { const h = (v / maxA) * 65; ctx2.fillStyle = aqiColor(v); ctx2.globalAlpha = 0.7; ctx2.fillRect(i * barW + 1, 75 - h, barW - 2, h); }); }); }
}
function aqiStat(label, val, unit) { const v = val != null ? parseFloat(val).toFixed(1) : '--'; return `<div class="aqi-stat"><div class="aqi-stat-l">${escHtml(label)}</div><div class="aqi-stat-v">${v} <span style="font-size:10px;color:var(--t3)">${unit}</span></div></div>`; }

// ── MARINE ───────────────────────────────────────────────────────
async function openMarinePanel() {
  openModal('marineModal');
  const body = $('marineBody');
  body.innerHTML = '<div class="empty-s"><div class="es-ico">🌊</div><div>Loading marine data…</div></div>';
  try {
    const r = await fetch(`${API}/api/marine?lat=${S.lat}&lng=${S.lng}`);
    if (!r.ok) throw new Error('Marine ' + r.status);
    S.marine = await r.json();
    const c = S.marine.current || {};
    body.innerHTML =
      '<div class="marine-hero"><div class="marine-main">' +
        marineStat('🌊 Wave Height', c.wave_height  != null ? c.wave_height.toFixed(1) + ' m' : '--') +
        marineStat('⏱ Wave Period', c.wave_period  != null ? c.wave_period.toFixed(1) + ' s' : '--') +
        marineStat('🧭 Wave Dir',   c.wave_direction != null ? wDir(c.wave_direction) + ' (' + Math.round(c.wave_direction) + '°)' : '--') +
      '</div><div class="marine-swell">' +
        marineStat('🌊 Swell Height', c.swell_wave_height  != null ? c.swell_wave_height.toFixed(1) + ' m' : '--') +
        marineStat('⏱ Swell Period', c.swell_wave_period  != null ? c.swell_wave_period.toFixed(1) + ' s' : '--') +
        marineStat('🧭 Swell Dir',   c.swell_wave_direction != null ? wDir(c.swell_wave_direction) : '--') +
        marineStat('🌲 Wind Wave',   c.wind_wave_height  != null ? c.wind_wave_height.toFixed(1) + ' m' : '--') +
        marineStat('💨 Current',     c.ocean_current_velocity != null ? c.ocean_current_velocity.toFixed(2) + ' m/s ' + wDir(c.ocean_current_direction || 0) : '--') +
      '</div></div>' +
      '<div class="marine-note">📡 Data from Open-Meteo Marine API — coastal &amp; ocean areas only</div>';
  } catch (e) {
    body.innerHTML = '<div class="empty-s"><div class="es-ico">🌊</div><div>Marine data not available for this inland location</div></div>';
  }
}
function marineStat(label, val) { return `<div class="marine-stat"><div class="marine-stat-l">${label}</div><div class="marine-stat-v">${val}</div></div>`; }

// ── ALERTS ───────────────────────────────────────────────────────
async function loadAlerts() {
  try {
    const r = await fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert',
      { headers: { 'User-Agent': '(StormSurgeWeather/13.8)', 'Accept': 'application/geo+json' } });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    S.alerts = (d.features || []).filter(f => f.properties?.event && new Date(f.properties.expires) > new Date());
    renderAlerts(); updateAlertCounts();
    if (S.cfg.alertZones && S.map) putAlertsOnMap();
  } catch (e) { S.alerts = []; renderAlerts(); updateAlertCounts(); }
}
function updateAlertCounts() { const n = S.alerts.length; setText('alertBadge', n); setText('navAlertBadge', n); $('navAlertBadge').classList.toggle('show', n > 0); }
function alertSev(ev) { const e = (ev || '').toLowerCase(); if (e.includes('tornado') || e.includes('hurricane') || e.includes('extreme')) return 'emergency'; if (e.includes('warning')) return 'warning'; if (e.includes('watch')) return 'watch'; if (e.includes('advisory')) return 'advisory'; return 'default'; }
function alertIcon(ev) { const e = (ev || '').toLowerCase(); if (e.includes('tornado')) return '🌪'; if (e.includes('hurricane') || e.includes('typhoon')) return '🌀'; if (e.includes('thunder') || e.includes('lightning')) return '⛈'; if (e.includes('snow') || e.includes('blizzard') || e.includes('winter')) return '❄️'; if (e.includes('flood')) return '🌊'; if (e.includes('wind')) return '💨'; if (e.includes('fog')) return '🌫'; if (e.includes('fire') || e.includes('heat')) return '🔥'; if (e.includes('ice') || e.includes('frost')) return '🧊'; return '⚠️'; }

function renderAlerts() {
  if (S.rightTab !== 'alerts') return;
  const body = $('alertsBody');
  const q    = (S.alertQuery || '').trim().toLowerCase();
  const filtered = S.alerts.filter((a, i) => {
    a._idx = i;
    const sevOK = S.alertFilter === 'all' || alertSev(a.properties.event) === S.alertFilter;
    if (!sevOK) return false;
    if (!q) return true;
    const p = a.properties || {};
    return [p.event, p.headline, p.areaDesc, p.description, p.senderName].join(' ').toLowerCase().includes(q);
  });
  const filterBar =
    '<div class="alert-filters">' +
    '<button class="af-btn' + (S.alertFilter==='all'?       ' active':'') + '" data-f="all">All <span>' + S.alerts.length + '</span></button>' +
    '<button class="af-btn' + (S.alertFilter==='emergency'? ' active':'') + '" data-f="emergency">🌪 Emerg</button>' +
    '<button class="af-btn' + (S.alertFilter==='warning'?   ' active':'') + '" data-f="warning">⚠ Warn</button>' +
    '<button class="af-btn' + (S.alertFilter==='watch'?     ' active':'') + '" data-f="watch">👁 Watch</button>' +
    '<button class="af-btn' + (S.alertFilter==='advisory'?  ' active':'') + '" data-f="advisory">ℹ Advis</button>' +
    '<button class="af-refresh" id="alertRefreshBtn" title="Refresh">↻</button></div>' +
    '<div class="alert-search"><input id="alertSearchInput" type="text" placeholder="Search events, areas…" value="' + escHtml(S.alertQuery || '') + '">' +
    '<button id="alertSearchBtn">Search</button></div>';
  if (!filtered.length) {
    body.innerHTML = filterBar + '<div class="empty-s"><div class="es-ico">✓</div><div>No active alerts</div></div>';
    bindAlertUI(); return;
  }
  body.innerHTML = filterBar + filtered.map(a => {
    const p = a.properties, sev = alertSev(p.event), ico = alertIcon(p.event);
    const area = p.areaDesc ? p.areaDesc.split(';')[0].trim() : 'Unknown';
    const exp  = p.expires ? new Date(p.expires) : null;
    return '<div class="acard sev-' + sev + '" data-i="' + a._idx + '" tabindex="0" role="button" aria-label="' + escHtml(p.event) + '">' +
      '<div class="ac-header"><span class="ac-ico">' + ico + '</span>' +
        '<div class="ac-info"><div class="ac-event">' + escHtml(p.event) + '</div><div class="ac-area">📍 ' + escHtml(area) + '</div></div>' +
        '<span class="ac-arr">›</span></div>' +
      '<div class="ac-headline">' + escHtml(p.headline || '') + '</div>' +
      (exp ? '<div class="ac-exp">Expires ' + fmtDateTime(exp) + '</div>' : '') + '</div>';
  }).join('');
  document.querySelectorAll('.acard').forEach(card => {
    const open = () => openAlertModal(+card.dataset.i);
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
  });
  bindAlertUI();
}
function bindAlertUI() {
  document.querySelectorAll('.af-btn').forEach(btn => btn.addEventListener('click', () => { S.alertFilter = btn.dataset.f; renderAlerts(); }));
  const rb = $('alertRefreshBtn'); if (rb) rb.addEventListener('click', () => { showToast('Refreshing…'); loadAlerts(); });
  const sb = $('alertSearchBtn'), si = $('alertSearchInput');
  const run = () => { S.alertQuery = si ? si.value.trim() : ''; renderAlerts(); };
  if (sb) sb.addEventListener('click', run);
  if (si) si.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
}
function fmtAlertText(text) {
  if (!text?.trim()) return '<p style="color:var(--t3)">No details available.</p>';
  const paras = []; let cur = [];
  text.trim().split('\n').forEach(line => { if (line.trim() === '') { if (cur.length) { paras.push(cur.join('\n')); cur = []; } } else cur.push(line); });
  if (cur.length) paras.push(cur.join('\n'));
  return paras.map(para => {
    const t = para.trim(); if (!t) return '';
    const alpha = t.replace(/[^A-Za-z]/g, '');
    if (alpha.length > 1 && alpha === alpha.toUpperCase() && t.length < 80) return '<div class="ad-para-head">' + escHtml(t) + '</div>';
    return '<p>' + escHtml(t).replace(/\n/g, '<br>') + '</p>';
  }).join('');
}
function openAlertModal(idx) {
  const alert = S.alerts[idx]; if (!alert) return;
  const p = alert.properties, ico = alertIcon(p.event);
  const onset = p.onset ? new Date(p.onset) : p.sent ? new Date(p.sent) : null;
  const expires = p.expires ? new Date(p.expires) : null;
  setText('mTitle', ico + ' ' + p.event);
  $('mBody').innerHTML =
    '<div class="ad-hdr"><div class="ad-ico">' + ico + '</div><div class="ad-title">' + escHtml(p.headline || p.event) + '</div></div>' +
    '<div class="ad-chips">' +
    (onset   ? '<span class="ad-chip">📅 ' + onset.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) + '</span>' : '') +
    (expires ? '<span class="ad-chip">⏱ ' + fmtDateTime(expires) + '</span>' : '') +
    (p.severity  ? '<span class="ad-chip">⚡ ' + escHtml(p.severity)  + '</span>' : '') +
    (p.certainty ? '<span class="ad-chip">🎯 ' + escHtml(p.certainty) + '</span>' : '') +
    (p.urgency   ? '<span class="ad-chip">⏰ ' + escHtml(p.urgency)   + '</span>' : '') + '</div>' +
    (p.areaDesc ? '<div class="ad-area-row">📍 ' + escHtml(p.areaDesc.split(';').map(s=>s.trim()).filter(Boolean).slice(0,6).join(' · ')) + '</div>' : '') +
    '<div class="ad-section"><div class="ad-sub-title">Description</div><div class="ad-text">' + fmtAlertText(p.description) + '</div></div>' +
    (p.instruction ? '<div class="ad-section"><div class="ad-sub-title">⚠ Instructions</div><div class="ad-text ad-instruction">' + fmtAlertText(p.instruction) + '</div></div>' : '') +
    (p.senderName ? '<div class="ad-sender">Issued by: ' + escHtml(p.senderName) + '</div>' : '');
  openModal('alertModal');
}
function putAlertsOnMap() {
  if (!S.map || !S.map.isStyleLoaded()) return;
  rmLayers(['alert-fill','alert-line'], ['alerts-src']);
  const valid = S.alerts.filter(a => a.geometry);
  if (!valid.length) return;
  try {
    S.map.addSource('alerts-src', { type: 'geojson', data: { type: 'FeatureCollection', features: valid.map(a => ({
      type: 'Feature', geometry: a.geometry,
      properties: { event: a.properties.event, severity: alertSev(a.properties.event) }
    })) } });
    S.map.addLayer({ id: 'alert-fill', type: 'fill', source: 'alerts-src', paint: {
      'fill-color': ['match',['get','severity'],'emergency','#ff2020','warning','#ef4444','watch','#06b6d4','#f59e0b'],
      'fill-opacity': 0.16 } });
    S.map.addLayer({ id: 'alert-line', type: 'line', source: 'alerts-src', paint: {
      'line-color': ['match',['get','severity'],'emergency','#ff2020','warning','#ef4444','watch','#06b6d4','#f59e0b'],
      'line-width': 1.5 } });
    S.map.on('mouseenter', 'alert-fill', () => S.map.getCanvas().style.cursor = 'pointer');
    S.map.on('mouseleave', 'alert-fill', () => S.map.getCanvas().style.cursor = '');
  } catch (e) {}
}
function rmLayers(layers, sources) {
  if (!S.map) return;
  try { layers.forEach(l => { if (S.map.getLayer(l)) S.map.removeLayer(l); }); } catch (e) {}
  try { sources.forEach(s => { if (S.map.getSource(s)) S.map.removeSource(s); }); } catch (e) {}
}

// ── STORM REPORTS ────────────────────────────────────────────────
function renderStormReports() {
  if (S.rightTab !== 'severe') return;
  const body = $('alertsBody');
  // Show spotter reports + SPC reports
  const spotterCount = S.spotterReports.length;
  const spcCount     = S.stormReports.length;
  if (!spotterCount && !spcCount) {
    body.innerHTML = '<div class="empty-s"><div class="es-ico">⛈</div><div>Loading spotter & storm reports…</div></div>';
    loadStormReports(); return;
  }
  let html = '';
  if (spotterCount) {
    html += '<div class="sr-head">🌐 Spotter Network (' + spotterCount + ' reports)</div>';
    html += S.spotterReports.slice(0, 20).map(r =>
      '<div class="sr-row">' +
      '<span class="sr-type" style="color:' + (r.verified ? '#22c55e' : '#94a3b8') + '">' + (r.icon || '📍') + ' ' + escHtml(r.type) + '</span>' +
      (r.magnitude ? '<span class="sr-mag">' + escHtml(r.magnitude) + '</span>' : '') +
      '<span class="sr-text">' + escHtml([r.city, r.state].filter(Boolean).join(', ') || r.description || '') + '</span>' +
      (r.distKm ? '<span style="font-size:.68rem;color:#64748b;margin-left:auto">' + r.distKm + 'km</span>' : '') +
      '</div>'
    ).join('');
  }
  if (spcCount) {
    html += '<div class="sr-head" style="margin-top:10px">⛈ SPC Storm Reports</div>';
    html += S.stormReports.slice(0, 20).map(r =>
      '<div class="sr-row"><span class="sr-type sr-' + r.type + '">' + (r.type==='tornado'?'🌪':r.type==='hail'?'🧊':'💨') + ' ' + r.type.toUpperCase() + '</span>' +
      '<span class="sr-mag">' + escHtml(r.magnitude || '?') + '</span>' +
      '<span class="sr-text">' + escHtml(r.text || '') + '</span></div>'
    ).join('');
  }
  html += '<div class="sr-src">Sources: mPing (NSSL) + NOAA SPC</div>';
  body.innerHTML = html;
}
async function loadStormReports() {
  try {
    const r = await fetch(`${API}/api/storm-reports`);
    S.stormReports = (await r.json()).items || [];
    if (S.rightTab === 'severe') renderStormReports();
    putReportsOnMap();
  } catch (e) {
    S.stormReports = [];
    if (S.rightTab === 'severe') $('alertsBody').innerHTML = '<div class="empty-s"><div class="es-ico">⛈</div><div>SPC reports unavailable</div></div>';
  }
}
function putReportsOnMap() {
  if (!S.map || !S.map.isStyleLoaded()) return;
  rmLayers(['reports-circle'], ['reports-src']);
  if (!S.stormReports.length) return;
  try {
    S.map.addSource('reports-src', { type: 'geojson', data: { type: 'FeatureCollection',
      features: S.stormReports.filter(r => r.lat && r.lng).map(r => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: { type: r.type, mag: r.magnitude }
      })) } });
    S.map.addLayer({ id: 'reports-circle', type: 'circle', source: 'reports-src', paint: {
      'circle-radius': 6,
      'circle-color': ['match',['get','type'],'tornado','#ef4444','hail','#06b6d4','#f59e0b'],
      'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff', 'circle-opacity': 0.9 } });
  } catch (e) {}
}

// ── RADAR INFO ───────────────────────────────────────────────────
function renderRadarInfo() {
  const frames  = window.RadarAnimator ? RadarAnimator._allFrames?.() || allFrames() : allFrames();
  const newest  = frames.length ? new Date(frames[frames.length-1].time*1000) : null;
  const oldest  = frames.length ? new Date(frames[0].time*1000) : null;
  $('alertsBody').innerHTML = '<div class="radar-info">' +
    '<div class="ri-title">Radar Status</div>' +
    riStat('Source',  'RainViewer') +
    riStat('Frames',  S.frames.length + '/12') +
    riStat('Nowcast', S.nowcastFrames.length + ' frames') +
    riStat('Latest',  newest ? fmtTime(newest, true) : 'N/A') +
    riStat('Oldest',  oldest ? fmtTime(oldest, true) : 'N/A') +
    riStat('Color',   {'1':'Classic','2':'Universal','4':'Rainbow','6':'NOAA','7':'Dark Sky'}[S.cfg.radarColor]||'NOAA') +
    riStat('Opacity', Math.round(S.cfg.opacity*100)+'%') +
    '<div class="ri-title" style="margin-top:16px">NEXRAD Status</div>' +
    riStat('Station', window.NexradRadar?.isVisible() ? (NexradRadar._station?.id || '—') : 'Off') +
    riStat('Product', window.NexradRadar?.isVisible() ? (NexradRadar._product || '—') : '—') +
    '<div class="ri-title" style="margin-top:16px">Spotter Network</div>' +
    riStat('Reports', S.spotterReports.length + ' nearby') +
    riStat('Status',  window.SpotterNetwork?.isVisible() ? 'Active' : 'Off') +
    '<div class="ri-actions">' +
      '<button class="ri-btn" onclick="if(window.RadarAnimator)RadarAnimator.refresh();showToast(\'↻ Radar refreshed\')">↻ Refresh</button>' +
      '<button class="ri-btn" onclick="toggleNowcast()">🟢 Nowcast</button>' +
      '<button class="ri-btn" onclick="if(window.NexradPanel)NexradPanel.toggle()">📡 NEXRAD</button>' +
    '</div></div>';
}
const riStat = (l, v) => `<div class="ri-stat"><span>${escHtml(String(l))}</span><span>${escHtml(String(v))}</span></div>`;

// ── SEARCH & GEOCODE ─────────────────────────────────────────────
async function doSearch(q) {
  if (!q || q.length < 2) { hideDrop(); return; }
  try {
    const d = await (await fetch(
      'https://api.mapbox.com/geocoding/v5/mapbox.places/' + encodeURIComponent(q) +
      '.json?access_token=' + MAPBOX_TOKEN + '&limit=6&types=place,locality,neighborhood,postcode,address'
    )).json();
    showDrop(d.features || []);
  } catch (e) { hideDrop(); }
}
function showDrop(features) {
  const dd = $('searchDrop');
  if (!features.length) { hideDrop(); return; }
  dd.classList.add('show'); dd.style.display = 'block';
  dd.innerHTML = features.map((f, i) => {
    const main = f.text || f.place_name.split(',')[0];
    const sub  = f.place_name.split(',').slice(1, 3).join(',').trim();
    return '<div class="s-drop-item" data-i="' + i + '" role="option"><strong>' + escHtml(main) + '</strong>' +
      (sub ? ' <span class="s-sub">' + escHtml(sub) + '</span>' : '') + '</div>';
  }).join('');
  dd.querySelectorAll('.s-drop-item').forEach(item => {
    item.addEventListener('click', () => {
      const f = features[+item.dataset.i];
      S.lat = f.center[1]; S.lng = f.center[0];
      S.locName = f.text || f.place_name.split(',')[0];
      hideDrop(); $('searchInput').value = '';
      if (S.map) S.map.flyTo({ center: [S.lng, S.lat], zoom: 9, duration: 1400 });
      loadWeather(); loadAlerts();
      showToast('📍 ' + f.place_name.split(',').slice(0,2).join(','));
    });
  });
}
function hideDrop() { const dd = $('searchDrop'); dd.style.display = 'none'; dd.classList.remove('show'); }
async function reverseGeocode(lat, lng) {
  try {
    const d = await (await fetch(
      'https://api.mapbox.com/geocoding/v5/mapbox.places/' + lng + ',' + lat +
      '.json?access_token=' + MAPBOX_TOKEN + '&limit=1'
    )).json();
    if (d.features?.length) {
      S.locName = d.features[0].text || d.features[0].place_name.split(',')[0];
      setText('locName', S.locName); setText('wcLoc', S.locName);
    }
  } catch (e) {}
}
function geolocate() {
  if (!navigator.geolocation) { showToast('⚠ Geolocation not supported'); return; }
  showToast('📍 Getting your location…');
  navigator.geolocation.getCurrentPosition(
    pos => {
      S.lat = pos.coords.latitude; S.lng = pos.coords.longitude;
      if (S.map) S.map.flyTo({ center: [S.lng, S.lat], zoom: 10, duration: 1200 });
      reverseGeocode(S.lat, S.lng); loadWeather();
    },
    () => showToast('⚠ Location access denied')
  );
}

// ── FAVORITES ────────────────────────────────────────────────────
function loadFavorites() { try { const s = localStorage.getItem('ss12_favs'); if (s) S.favorites = JSON.parse(s); } catch (e) {} renderFavorites(); }
function saveFavorites() { try { localStorage.setItem('ss12_favs', JSON.stringify(S.favorites)); } catch (e) {} }
function addFavorite() {
  if (S.favorites.some(f => f.name === S.locName)) { showToast('★ Already saved'); return; }
  S.favorites.push({ name: S.locName, lat: S.lat, lng: S.lng });
  saveFavorites(); renderFavorites(); showToast('★ Saved ' + S.locName);
}
function removeFavorite(name) { S.favorites = S.favorites.filter(f => f.name !== name); saveFavorites(); renderFavorites(); }
function goFavorite(fav) {
  S.lat = fav.lat; S.lng = fav.lng; S.locName = fav.name;
  setText('locName', fav.name);
  if (S.map) S.map.flyTo({ center: [fav.lng, fav.lat], zoom: 9, duration: 1200 });
  loadWeather(); loadAlerts(); showToast('📍 ' + fav.name);
}
function renderFavorites() {
  const el = $('favList'); if (!el) return;
  if (!S.favorites.length) { el.innerHTML = '<div class="fav-empty">No saved locations</div>'; return; }
  el.innerHTML = S.favorites.map(f =>
    '<div class="fav-item"><button class="fav-loc" data-name="' + escHtml(f.name) + '">' + escHtml(f.name) + '</button>' +
    '<button class="fav-del" data-name="' + escHtml(f.name) + '" aria-label="Remove">×</button></div>'
  ).join('');
  el.querySelectorAll('.fav-loc').forEach(btn => btn.addEventListener('click', () => { const fav = S.favorites.find(f => f.name === btn.dataset.name); if (fav) goFavorite(fav); }));
  el.querySelectorAll('.fav-del').forEach(btn => btn.addEventListener('click', () => removeFavorite(btn.dataset.name)));
}

// ── SHARE CARD ───────────────────────────────────────────────────
function openShareCard() {
  openModal('shareModal');
  const canvas = $('shareCanvas');
  canvas.width = 640; canvas.height = 320;
  const ctx2  = canvas.getContext('2d');
  const d     = S.weather?.current || {};
  const code  = d.weather_code || 0;
  const isStorm = code >= 95, isRain = code >= 51, isSunny = code <= 1;
  const g = isStorm ? ['#1a0033','#2d0052'] : isRain ? ['#0c1445','#1e3a5f'] : isSunny ? ['#0f2957','#1a4a7a'] : ['#111827','#1f2937'];
  const grad = ctx2.createLinearGradient(0, 0, 640, 320);
  grad.addColorStop(0, g[0]); grad.addColorStop(1, g[1]);
  ctx2.fillStyle = grad; ctx2.fillRect(0, 0, 640, 320);
  ctx2.fillStyle = 'rgba(255,255,255,.08)'; ctx2.fillRect(0, 0, 640, 48);
  ctx2.fillStyle = 'rgba(255,255,255,.9)'; ctx2.font = 'bold 13px Outfit, sans-serif'; ctx2.fillText('⛈ STORM SURGE WEATHER', 22, 32);
  ctx2.fillStyle = 'rgba(255,255,255,.35)'; ctx2.font = '11px JetBrains Mono, monospace';
  ctx2.fillText(new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}), 22, 47);
  ctx2.font = '900 80px Outfit, sans-serif'; ctx2.fillStyle = '#ffffff';
  ctx2.fillText(cvtTemp(d.temperature_2m) + '°' + S.cfg.tempUnit, 22, 160);
  ctx2.font = '64px sans-serif'; ctx2.fillText(wIcon(d.weather_code), 340, 155);
  ctx2.font = 'bold 20px Outfit, sans-serif'; ctx2.fillStyle = 'rgba(255,255,255,.85)';
  ctx2.fillText(S.locName, 22, 190);
  ctx2.font = '14px Outfit, sans-serif'; ctx2.fillStyle = 'rgba(255,255,255,.7)';
  ctx2.fillText(wDesc(d.weather_code) + '  ·  Feels like ' + cvtTemp(d.apparent_temperature) + '°', 22, 215);
  ctx2.font = '12px JetBrains Mono, monospace'; ctx2.fillStyle = 'rgba(255,255,255,.55)';
  const stats = ['💧 '+(d.relative_humidity_2m??'--')+'%','💨 '+cvtWind(d.wind_speed_10m)+' '+windUnit(),'📊 '+Math.round(d.surface_pressure??0)+' hPa','☀ UV '+(d.uv_index??'--')];
  stats.forEach((s, i) => ctx2.fillText(s, 22 + i * 155, 250));
  const daily = S.weather?.daily;
  if (daily?.temperature_2m_max?.[0] != null) {
    ctx2.font = 'bold 13px JetBrains Mono, monospace'; ctx2.fillStyle = '#f97316';
    ctx2.fillText('H: ' + cvtTemp(daily.temperature_2m_max[0]) + '°  ', 22, 280);
    ctx2.fillStyle = '#06b6d4';
    ctx2.fillText('L: ' + cvtTemp(daily.temperature_2m_min[0]) + '°', 90, 280);
  }
}

// ── LEGEND ───────────────────────────────────────────────────────
function updateLegend() {
  const layer = document.querySelector('.lb.active')?.dataset.layer || 'precipitation';
  const cfg = {
    precipitation: { label: 'mm/h', grad: 'linear-gradient(to top,#555 0%,#04e9e7 15%,#019ff4 30%,#02fd02 45%,#fdf802 60%,#fd9500 75%,#fd0000 90%,#bc0000 100%)' },
    temperature:   { label: '°C',   grad: 'linear-gradient(to top,#313695,#4575b4,#74add1,#abd9e9,#ffffbf,#fdae61,#f46d43,#a50026)' },
    wind:          { label: 'm/s',  grad: 'linear-gradient(to top,#1a1a2e,#16213e,#0f3460,#533483,#e94560)' },
    clouds:        { label: '%',    grad: 'linear-gradient(to top,#111,#333,#666,#999,#ccc)' },
    pressure:      { label: 'hPa',  grad: 'linear-gradient(to top,#023858,#0570b0,#74a9cf,#d0d1e6)' },
    satellite:     { label: 'IR',   grad: 'linear-gradient(to top,#000,#222,#444,#888,#ccc,#fff)' }
  };
  const c = cfg[layer] || cfg.precipitation;
  setText('legTitle', c.label);
  $('legBar').style.background = c.grad;
}

// ── UI WIRING ────────────────────────────────────────────────────
function initUI() {
  $('burger').onclick     = () => $('sidebar').classList.toggle('open');
  $('sidebarX').onclick   = () => $('sidebar').classList.remove('open');
  $('zoomIn').onclick     = () => S.map?.zoomIn();
  $('zoomOut').onclick    = () => S.map?.zoomOut();
  $('styleBtn').onclick   = cycleMapStyle;
  $('geoBtn').onclick     = geolocate;
  $('refreshBtn').onclick = () => { loadWeather(); loadAlerts(); if (S.map) loadRadar(); showToast('↻ Refreshing…'); };
  $('playBtn').onclick    = togglePlay;
  $('favAddBtn').onclick  = addFavorite;
  $('shareBtn').onclick   = openShareCard;

  // Spotter toggle
  $('spotterBtn').onclick = () => {
    const active = SpotterNetwork?.toggle(S.lat, S.lng);
    $('spotterBtn').classList.toggle('active', active);
    showToast(active ? '🌐 Spotter Network ON' : 'Spotter Network OFF');
    if (active) {
      document.querySelectorAll('.rpt').forEach(x => x.classList.remove('active'));
      document.querySelector('.rpt[data-rt="severe"]')?.classList.add('active');
      S.rightTab = 'severe'; renderStormReports();
    }
  };

  // Severe analysis toggle
  $('severeBtn').onclick = () => {
    if (window.SeverePanel) {
      if (SeverePanel.isOpen()) { SeverePanel.close(); $('severeBtn').classList.remove('active'); }
      else { SeverePanel.load(S.lat, S.lng); $('severeBtn').classList.add('active'); }
    }
  };

  $('tRange').addEventListener('input', e => pickFrame(+e.target.value));
  $('quickOpacity').addEventListener('input', e => {
    S.cfg.opacity = +e.target.value / 100;
    $('sOpacity').value = e.target.value;
    $('sOpacityVal').textContent = e.target.value + '%';
    if (window.RadarAnimator) RadarAnimator.setOpacity(S.cfg.opacity);
    saveCfg();
  });
  $('tPrev').onclick = () => { if (S.frame > 0) pickFrame(S.frame - 1); };
  $('tNext').onclick = () => { if (S.frame < allFrames().length - 1) pickFrame(S.frame + 1); };

  $('drawBtn').onclick   = () => S.drawMode ? exitDrawMode() : enterDrawMode();
  $('drawExit').onclick  = exitDrawMode;
  $('drawUndo').onclick  = undoDraw;
  $('drawClear').onclick = clearDraw;
  document.querySelectorAll('.dc').forEach(btn => btn.onclick = () => {
    document.querySelectorAll('.dc').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); S.drawColor = btn.dataset.c;
  });
  document.querySelectorAll('.ds').forEach(btn => btn.onclick = () => {
    document.querySelectorAll('.ds').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); S.drawSize = +btn.dataset.s;
  });

  $('themeBtn').onclick = () => {
    const t = S.cfg.theme === 'dark' ? 'light' : 'dark';
    applyTheme(t); saveCfg();
    if (S.map) S.map.setStyle(MAP_STYLES[t === 'light' ? 'light' : 'dark']);
    showToast(t === 'dark' ? '🌙 Dark mode' : '☀️ Light mode');
  };

  document.querySelectorAll('.lb[data-layer]').forEach(b => b.onclick = () => {
    document.querySelectorAll('.lb[data-layer]').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed','false'); });
    b.classList.add('active'); b.setAttribute('aria-pressed','true');
    updateLegend(); showToast(b.textContent.trim());
  });

  document.querySelectorAll('.fct').forEach(t => t.onclick = () => {
    document.querySelectorAll('.fct').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-selected','false'); });
    t.classList.add('active'); t.setAttribute('aria-selected','true');
    S.fcMode = t.dataset.ft;
    if (S.weather) renderForecast(S.weather);
  });

  document.querySelectorAll('.rpt').forEach(t => t.onclick = () => {
    document.querySelectorAll('.rpt').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-selected','false'); });
    t.classList.add('active'); t.setAttribute('aria-selected','true');
    S.rightTab = t.dataset.rt;
    if (S.rightTab === 'alerts')      renderAlerts();
    else if (S.rightTab === 'info')   renderRadarInfo();
    else if (S.rightTab === 'severe') renderStormReports();
  });

  document.querySelectorAll('.sni').forEach(item => item.onclick = e => {
    e.preventDefault();
    document.querySelectorAll('.sni').forEach(x => x.classList.remove('active'));
    item.classList.add('active');
    const p = item.dataset.p;
    if (p === 'settings')    openModal('settingsModal');
    else if (p === 'aqi')    openAQIPanel();
    else if (p === 'marine') openMarinePanel();
    else if (p === 'cameras') openModal('trafficModal');
    else if (p === 'alerts') {
      document.querySelectorAll('.rpt').forEach(x => x.classList.remove('active'));
      document.querySelector('.rpt[data-rt="alerts"]')?.classList.add('active');
      S.rightTab = 'alerts'; renderAlerts();
    }
  });

  let searchTimer;
  $('searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    const v = e.target.value.trim();
    if (v.length < 2) { hideDrop(); return; }
    searchTimer = setTimeout(() => doSearch(v), 300);
  });
  $('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideDrop(); e.target.value = ''; }
    if (e.key === 'Enter') doSearch(e.target.value.trim());
  });
  document.addEventListener('click', e => { if (!document.querySelector('.searchbox').contains(e.target)) hideDrop(); });

  $('mClose').onclick       = () => closeModal('alertModal');
  $('alertModal').onclick   = e => { if (e.target === $('alertModal')) closeModal('alertModal'); };
  $('sClose').onclick       = closeSettingsModal;
  $('settingsModal').onclick = e => { if (e.target === $('settingsModal')) closeSettingsModal(); };
  $('aqiClose').onclick     = () => closeModal('aqiModal');
  $('aqiModal').onclick     = e => { if (e.target === $('aqiModal')) closeModal('aqiModal'); };
  $('marineClose').onclick  = () => closeModal('marineModal');
  $('marineModal').onclick  = e => { if (e.target === $('marineModal')) closeModal('marineModal'); };
  $('tcClose').onclick      = () => closeModal('trafficModal');
  $('trafficModal').onclick = e => { if (e.target === $('trafficModal')) closeModal('trafficModal'); };
  $('shareClose').onclick   = () => closeModal('shareModal');
  $('shareModal').onclick   = e => { if (e.target === $('shareModal')) closeModal('shareModal'); };

  $('shareDownload').onclick = () => {
    const a = document.createElement('a');
    a.download = 'storm-surge-' + S.locName.toLowerCase().replace(/\s+/g,'-') + '.png';
    a.href = $('shareCanvas').toDataURL('image/png'); a.click();
    showToast('⬇ Downloaded');
  };
  $('shareCopy').onclick = () =>
    navigator.clipboard.writeText(window.location.href)
      .then(() => showToast('📋 Link copied'))
      .catch(() => showToast('⚠ Copy failed'));

  $('tcSearchBtn').onclick = () => searchTrafficCams($('tcSearch').value.trim());
  $('tcSearch').addEventListener('keydown', e => { if (e.key === 'Enter') searchTrafficCams($('tcSearch').value.trim()); });

  segBind('sTempUnit',   v => { S.cfg.tempUnit = v;   saveCfg(); if (S.weather) { renderWeather(S.weather); renderForecast(S.weather); } });
  segBind('sWindUnit',   v => { S.cfg.windUnit = v;   saveCfg(); if (S.weather) renderWeather(S.weather); });
  segBind('sDistUnit',   v => { S.cfg.distUnit = v;   saveCfg(); if (S.weather) renderWeather(S.weather); });
  segBind('sTimeFormat', v => { S.cfg.timeFormat = v; saveCfg(); if (S.weather) { renderWeather(S.weather); renderForecast(S.weather); } if (S.frames.length) buildSlots(); });
  segBind('sSpeed',      v => { S.cfg.speed = +v; saveCfg(); if (window.RadarAnimator) RadarAnimator.setSpeed(+v); });
  segBind('sCardPos',    v => { S.cfg.cardPosition = v; saveCfg(); if (S.weather) renderWeather(S.weather); });
  segBind('sCardStyle',  v => { S.cfg.cardStyle = v;   saveCfg(); if (S.weather) renderWeather(S.weather); });
  segBind('sRadarColor', v => { S.cfg.radarColor = v; saveCfg(); if (window.RadarAnimator) RadarAnimator.setColor(v); });

  $('sOpacity').addEventListener('input', e => {
    S.cfg.opacity = +e.target.value / 100;
    $('sOpacityVal').textContent = e.target.value + '%';
    $('quickOpacity').value = e.target.value;
    if (window.RadarAnimator) RadarAnimator.setOpacity(S.cfg.opacity);
    saveCfg();
  });
  $('sAutoPlay').addEventListener('change',   e => { S.cfg.autoPlay  = e.target.checked; saveCfg(); });
  $('sNowcast').addEventListener('change',    e => { S.cfg.nowcast   = e.target.checked; saveCfg(); if (window.RadarAnimator) RadarAnimator.setNowcast(e.target.checked); if (S.frames.length) buildSlots(); });
  $('sSmooth').addEventListener('change',     e => { S.cfg.smooth    = e.target.checked; saveCfg(); if (window.RadarAnimator) RadarAnimator.setSmooth(e.target.checked); });
  $('sAlertZones').addEventListener('change', e => {
    S.cfg.alertZones = e.target.checked; saveCfg();
    if (e.target.checked) putAlertsOnMap(); else rmLayers(['alert-fill','alert-line'], ['alerts-src']);
  });
  $('sCrosshair').addEventListener('change', e => { S.cfg.crosshair = e.target.checked; saveCfg(); $('crosshair').style.display = e.target.checked ? '' : 'none'; });
  $('sClickAction').addEventListener('change', e => { S.cfg.clickAction = e.target.checked ? 'nws' : 'weather'; saveCfg(); });
  $('sAnimBg').addEventListener('change', e => {
    S.cfg.animBg = e.target.checked; saveCfg();
    if (!e.target.checked) $('bgAnim').classList.add('bg-off');
    else if (S.weather) updateBgAnim(S.weather.current?.weather_code, S.weather.current?.is_day);
  });
  // AI panel toggle in settings
  const aiToggle = $('sAIPanel');
  if (aiToggle) aiToggle.addEventListener('change', e => { S.cfg.aiPanel = e.target.checked; saveCfg(); const tab = $('ai-panel-tab'); if (tab) tab.style.display = e.target.checked ? '' : 'none'; });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ['alertModal','settingsModal','aqiModal','marineModal','trafficModal','shareModal'].forEach(closeModal);
      if (window.NexradPanel) NexradPanel.close();
      if (window.AIPanel) AIPanel.close();
    }
    if (e.key === ' ' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); togglePlay(); }
    if (e.key === 'ArrowLeft')  { if (S.frame > 0) pickFrame(S.frame - 1); }
    if (e.key === 'ArrowRight') { if (S.frame < allFrames().length - 1) pickFrame(S.frame + 1); }
  });

  applySettingsUI();
  updateLegend();
  loadStormReports();
}

function searchTrafficCams(q) {
  const grid = $('tcGrid'); if (!q) return;
  const url  = 'https://hazcams.com/search?query=' + encodeURIComponent(q);
  grid.innerHTML =
    '<div class="empty-s" style="gap:14px"><div class="es-ico">📷</div>' +
    '<div>Cameras for <strong>' + escHtml(q) + '</strong></div>' +
    '<a class="modal-link" href="' + url + '" target="_blank" rel="noopener">🌐 Open Hazcams →</a></div>';
}

// ── MODALS / SETTINGS ────────────────────────────────────────────
function openModal(id)  { $(id)?.classList.add('open'); }
function closeModal(id) { $(id)?.classList.remove('open'); }
function closeSettingsModal() {
  closeModal('settingsModal');
  document.querySelectorAll('.sni').forEach(x => x.classList.remove('active'));
  document.querySelector('.sni[data-p="home"]')?.classList.add('active');
}
function segBind(cId, cb) {
  document.querySelectorAll('#' + cId + ' .sb').forEach(btn => btn.onclick = () => {
    document.querySelectorAll('#' + cId + ' .sb').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); cb(btn.dataset.v);
  });
}
function applySettingsUI() {
  const c = S.cfg;
  [['sTempUnit',c.tempUnit],['sWindUnit',c.windUnit],['sDistUnit',c.distUnit],
   ['sTimeFormat',c.timeFormat],['sSpeed',String(c.speed)],['sRadarColor',String(c.radarColor)],
   ['sCardPos',c.cardPosition],['sCardStyle',c.cardStyle||'full']
  ].forEach(([id,val]) => document.querySelectorAll('#'+id+' .sb').forEach(b => b.classList.toggle('active',b.dataset.v===val)));
  $('sOpacity').value = Math.round(c.opacity*100);
  $('quickOpacity').value = Math.round(c.opacity*100);
  $('sOpacityVal').textContent = Math.round(c.opacity*100)+'%';
  $('sAutoPlay').checked  = c.autoPlay;
  $('sNowcast').checked   = c.nowcast;
  $('sSmooth').checked    = c.smooth;
  $('sAlertZones').checked = c.alertZones;
  $('sCrosshair').checked  = c.crosshair;
  $('sClickAction').checked = c.clickAction === 'nws';
  $('sAnimBg').checked    = c.animBg;
  const aiToggle = $('sAIPanel'); if (aiToggle) aiToggle.checked = c.aiPanel !== false;
  if (!c.crosshair) $('crosshair').style.display = 'none';
  if (!c.animBg)    $('bgAnim').classList.add('bg-off');
}

// ── PERSISTENCE ──────────────────────────────────────────────────
function saveCfg() { try { localStorage.setItem('ss12_cfg', JSON.stringify(S.cfg)); } catch (e) {} }
function loadCfg() { try { const s = localStorage.getItem('ss12_cfg'); if (s) Object.assign(S.cfg, JSON.parse(s)); } catch (e) {} }

console.log('%c⛈ Storm Surge Weather v13.8%c AI · Spotter Network · NEXRAD · Severe Analysis', 'color:#06b6d4;font-weight:900;font-size:14px', 'color:#7a8ea8;font-size:11px');
