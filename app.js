// ================================================================
//  STORM SURGE WEATHER v9.0
//  Fixed: map init timing, radar canvas, all modals wired
//  New: crosshair, radar info panel, better search, wind compass,
//       weather condition description, smooth animations
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
  cfg: {
    tempUnit: 'C',
    windUnit: 'ms',
    opacity: 0.75,
    speed: 600,
    autoPlay: false,
    alertZones: true,
    crosshair: true
  }
};

// Map styles
const MAP_STYLES = {
  dark: 'mapbox://styles/mapbox/dark-v11',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  outdoors: 'mapbox://styles/mapbox/outdoors-v12',
  light: 'mapbox://styles/mapbox/light-v11'
};
const STYLE_ORDER = ['dark', 'satellite', 'outdoors', 'light'];

// ================================================================
//  BOOT — wait for DOM + Mapbox both ready
// ================================================================
window.addEventListener('load', () => {
  loadCfg();
  initMap();
  initUI();
  updateDate();
  setInterval(updateDate, 60000);
  // Refresh data every 10 minutes
  setInterval(() => { loadWeather(); loadAlerts(); }, 10 * 60 * 1000);
});

// ================================================================
//  MAP INIT
// ================================================================
function initMap() {
  mapboxgl.accessToken = MAPBOX_TOKEN;

  S.map = new mapboxgl.Map({
    container: 'map',
    style: MAP_STYLES.dark,
    center: [S.lng, S.lat],
    zoom: 6,
    minZoom: 2,
    maxZoom: 14,
    attributionControl: false,
    logoPosition: 'bottom-left'
  });

  // Canvas setup — after DOM is ready
  S.canvas = document.getElementById('radarCanvas');
  S.ctx = S.canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  S.map.on('load', () => {
    S.map.resize(); // force correct size after DOM layout
    loadRadar();
    loadWeather();
    loadAlerts();
  });

  S.map.on('moveend', () => {
    if (S.frames.length) drawFrame(S.frame);
  });

  S.map.on('zoom', () => {
    if (S.frames.length) drawFrame(S.frame);
  });

  S.map.on('click', e => {
    S.lat = e.lngLat.lat;
    S.lng = e.lngLat.lng;
    reverseGeocode(S.lat, S.lng);
    loadWeather();
    showToast('📍 Fetching weather for this location...');
  });
}

function resizeCanvas() {
  if (!S.canvas) return;
  const z = S.canvas.parentElement;
  S.canvas.width = z.clientWidth;
  S.canvas.height = z.clientHeight;
  if (S.frames.length) drawFrame(S.frame);
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
//  RADAR
// ================================================================
async function loadRadar() {
  try {
    const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const d = await r.json();
    if (d?.radar?.past?.length) {
      S.frames = d.radar.past.slice(-12);
      S.frame = S.frames.length - 1;
      buildSlots();
      drawFrame(S.frame);
      updateRadarInfo(d);
      if (S.cfg.autoPlay) play();
    }
  } catch (e) {
    console.warn('Radar unavailable', e);
  }
}

function drawFrame(idx) {
  if (!S.frames[idx] || !S.map || !S.ctx) return;
  const frame = S.frames[idx];
  const ctx = S.ctx;
  const canvas = S.canvas;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = S.cfg.opacity;

  const bounds = S.map.getBounds();
  const zoom = Math.max(2, Math.min(12, Math.floor(S.map.getZoom())));
  const tiles = getTiles(bounds, zoom);

  tiles.forEach(tile => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `https://tilecache.rainviewer.com${frame.path}/256/${tile.z}/${tile.x}/${tile.y}/6/1_1.png`;
    img.onload = () => {
      if (!S.map) return;
      const nw = S.map.project([tile.b.west, tile.b.north]);
      const se = S.map.project([tile.b.east, tile.b.south]);
      const w = se.x - nw.x, h = se.y - nw.y;
      if (w > 0 && h > 0) ctx.drawImage(img, nw.x, nw.y, w, h);
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
  const n = 2 ** z;
  const x = Math.floor((lng + 180) / 360 * n);
  const lr = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n);
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

function t2b(x, y, z) {
  const n = 2 ** z;
  return {
    west: x / n * 360 - 180,
    east: (x + 1) / n * 360 - 180,
    north: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI,
    south: Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI
  };
}

function buildSlots() {
  const c = document.getElementById('tSlots');
  c.innerHTML = '';
  S.frames.forEach((f, i) => {
    const d = new Date(f.time * 1000);
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const btn = document.createElement('button');
    btn.className = 'tslot' + (i === S.frame ? ' active' : '');
    btn.textContent = `${hh}:${mm}`;
    btn.onclick = () => pickFrame(i);
    c.appendChild(btn);
  });
}

function pickFrame(i) {
  S.frame = i;
  document.querySelectorAll('.tslot').forEach((s, j) => s.classList.toggle('active', j === i));
  drawFrame(i);
}

function play() {
  if (S.playing) return;
  S.playing = true;
  const b = document.getElementById('playBtn');
  b.textContent = '⏸';
  b.classList.add('playing');
  S.playTimer = setInterval(() => pickFrame((S.frame + 1) % S.frames.length), S.cfg.speed);
}

function pause() {
  S.playing = false;
  clearInterval(S.playTimer);
  const b = document.getElementById('playBtn');
  b.textContent = '▶';
  b.classList.remove('playing');
}

function togglePlay() { S.playing ? pause() : play(); }

function updateRadarInfo(data) {
  const body = document.getElementById('alertsBody');
  // Only update if radar info tab is active
  if (S.rightTab !== 'info') return;
  const past = data.radar?.past || [];
  const newest = past.length ? new Date(past[past.length - 1].time * 1000) : null;
  body.innerHTML = `
    <div class="radar-info">
      <div class="ri-title">Radar Status</div>
      <div class="ri-stat"><span>Frames loaded</span><span>${S.frames.length} / 12</span></div>
      <div class="ri-stat"><span>Latest frame</span><span>${newest ? newest.toLocaleTimeString() : 'N/A'}</span></div>
      <div class="ri-stat"><span>Source</span><span>RainViewer</span></div>
      <div class="ri-stat"><span>Resolution</span><span>256px tiles</span></div>
      <div class="ri-stat"><span>Update interval</span><span>~10 min</span></div>
      <div class="ri-stat"><span>Coverage</span><span>Global</span></div>
    </div>`;
}

// ================================================================
//  WEATHER
// ================================================================
async function loadWeather() {
  showLoader(true);
  try {
    const url = [
      `https://api.open-meteo.com/v1/forecast`,
      `?latitude=${S.lat}&longitude=${S.lng}`,
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,`,
      `precipitation,weather_code,wind_speed_10m,wind_direction_10m,`,
      `surface_pressure,cloud_cover,uv_index`,
      `&hourly=temperature_2m,relative_humidity_2m,weather_code,precipitation_probability`,
      `&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,`,
      `precipitation_probability_max,wind_speed_10m_max`,
      `&timezone=auto&forecast_days=8`
    ].join('');
    const r = await fetch(url);
    const d = await r.json();
    S.weather = d;
    renderWeather(d);
    renderForecast(d);
  } catch (e) {
    console.warn('Weather fetch failed', e);
    showToast('⚠ Weather data unavailable');
  }
  showLoader(false);
}

function renderWeather(d) {
  const c = d.current;
  const daily = d.daily;
  const temp = cvtTemp(c.temperature_2m);
  const feels = cvtTemp(c.apparent_temperature);
  const wind = cvtWind(c.wind_speed_10m);
  const windUnit = S.cfg.windUnit === 'ms' ? 'm/s' : S.cfg.windUnit === 'kmh' ? 'km/h' : 'mph';

  set('wcTemp', `${temp}°${S.cfg.tempUnit}`);
  set('wcLoc', S.locName);
  set('wcDesc', wDesc(c.weather_code));
  set('wcIcon', wIcon(c.weather_code));
  set('wcFeels', `${feels}°${S.cfg.tempUnit}`);
  set('wcHum', `${c.relative_humidity_2m}%`);
  set('wcWind', `${wind} ${windUnit}`);
  set('wcDir', `${c.wind_direction_10m}° ${wDir(c.wind_direction_10m)}`);
  set('wcRain', `${(c.precipitation || 0).toFixed(1)} mm`);
  set('wcPres', `${Math.round(c.surface_pressure)} hPa`);
  set('wcCloud', `${c.cloud_cover}%`);
  set('wcUV', `${c.uv_index ?? '--'} ${uvLabel(c.uv_index)}`);

  // Sunrise/sunset
  if (daily?.sunrise?.[0]) {
    const sr = new Date(daily.sunrise[0]);
    const ss = new Date(daily.sunset[0]);
    set('wcSunrise', fmt2(sr.getHours()) + ':' + fmt2(sr.getMinutes()));
    set('wcSunset', fmt2(ss.getHours()) + ':' + fmt2(ss.getMinutes()));
  }

  // Update location displays
  set('locName', S.locName);
}

function renderForecast(d) {
  const c = document.getElementById('fcScroll');
  c.innerHTML = '';
  if (S.fcMode === 'hourly') {
    const hours = Math.min(24, d.hourly.temperature_2m.length);
    const now = new Date().getHours();
    for (let i = 0; i < hours; i++) {
      const t = new Date(d.hourly.time[i]);
      const isNow = t.getHours() === now && i < 2;
      const temp = cvtTemp(d.hourly.temperature_2m[i]);
      const div = document.createElement('div');
      div.className = 'fc-item' + (isNow ? ' now' : '');
      div.innerHTML = `
        <div class="fc-t">${isNow ? 'NOW' : fmt2(t.getHours()) + ':00'}</div>
        <div class="fc-i">${wIcon(d.hourly.weather_code[i])}</div>
        <div class="fc-v">${temp}°</div>
        <div class="fc-h">💧${d.hourly.relative_humidity_2m[i]}%</div>`;
      c.appendChild(div);
    }
  } else {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    d.daily.time.slice(0, 7).forEach((ds, i) => {
      const day = new Date(ds);
      const hi = cvtTemp(d.daily.temperature_2m_max[i]);
      const lo = cvtTemp(d.daily.temperature_2m_min[i]);
      const div = document.createElement('div');
      div.className = 'fc-item' + (i === 0 ? ' now' : '');
      div.innerHTML = `
        <div class="fc-t">${i === 0 ? 'TODAY' : days[day.getDay()]}</div>
        <div class="fc-i">${wIcon(d.daily.weather_code[i])}</div>
        <div class="fc-v">${hi}°/${lo}°</div>
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
    const r = await fetch(
      'https://api.weather.gov/alerts/active?status=actual&message_type=alert',
      { headers: { 'User-Agent': '(StormSurgeWeather/9.0)', 'Accept': 'application/geo+json' } }
    );
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    S.alerts = (d.features || []).filter(f => {
      if (!f.properties?.event) return false;
      return new Date(f.properties.expires) > new Date();
    });
    renderAlerts();
    updateAlertCounts();
    if (S.cfg.alertZones && S.map) putAlertsOnMap();
  } catch (e) {
    S.alerts = [];
    renderAlerts();
    updateAlertCounts();
  }
}

function updateAlertCounts() {
  const n = S.alerts.length;
  const badge = document.getElementById('alertBadge');
  const navBadge = document.getElementById('navAlertBadge');
  badge.textContent = n;
  navBadge.textContent = n;
  navBadge.classList.toggle('show', n > 0);
}

function alertSev(event) {
  const e = (event || '').toLowerCase();
  if (e.includes('tornado') || e.includes('hurricane') || e.includes('extreme')) return 'emergency';
  if (e.includes('warning')) return 'warning';
  if (e.includes('watch')) return 'watch';
  if (e.includes('advisory')) return 'advisory';
  return 'default';
}

function alertIcon(event) {
  const e = (event || '').toLowerCase();
  if (e.includes('tornado')) return '🌪';
  if (e.includes('hurricane') || e.includes('typhoon')) return '🌀';
  if (e.includes('thunder') || e.includes('lightning')) return '⛈';
  if (e.includes('snow') || e.includes('blizzard') || e.includes('winter')) return '❄️';
  if (e.includes('flood')) return '🌊';
  if (e.includes('wind')) return '💨';
  if (e.includes('fog')) return '🌫';
  if (e.includes('fire')) return '🔥';
  if (e.includes('heat')) return '🌡';
  if (e.includes('ice') || e.includes('frost')) return '🧊';
  return '⚠️';
}

function renderAlerts() {
  if (S.rightTab !== 'alerts') return;
  const body = document.getElementById('alertsBody');
  if (!S.alerts.length) {
    body.innerHTML = '<div class="empty-s"><div class="es-ico">✓</div><div>No active alerts</div></div>';
    return;
  }
  body.innerHTML = S.alerts.map((a, i) => {
    const p = a.properties;
    const sev = alertSev(p.event);
    const ico = alertIcon(p.event);
    const area = p.areaDesc ? p.areaDesc.split(';')[0].trim() : 'Unknown area';
    const exp = p.expires ? new Date(p.expires) : null;
    const cardClass = sev === 'emergency' || sev === 'warning' ? 'warning' :
                      sev === 'watch' ? 'watch' :
                      sev === 'advisory' ? 'advisory' : '';
    return `
      <div class="acard ${cardClass}" data-i="${i}" tabindex="0">
        <span class="ac-arrow">›</span>
        <div class="ac-badge sev-${sev}">${ico} ${p.event}</div>
        <div class="ac-title">${p.headline || p.event}</div>
        <div class="ac-area">📍 ${area}</div>
        ${exp ? `<div class="ac-exp">Expires ${exp.toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${exp.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</div>` : ''}
      </div>`;
  }).join('');

  document.querySelectorAll('.acard').forEach(card => {
    const open = () => openAlertModal(+card.dataset.i);
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && open());
  });
}

function openAlertModal(i) {
  const a = S.alerts[i];
  if (!a) return;
  const p = a.properties;
  const onset = p.onset ? new Date(p.onset) : (p.sent ? new Date(p.sent) : null);
  const expires = p.expires ? new Date(p.expires) : null;
  const ico = alertIcon(p.event);

  set('mTitle', `${ico} ${p.event}`);
  document.getElementById('mBody').innerHTML = `
    <div class="ad-hdr">
      <div class="ad-ico">${ico}</div>
      <div class="ad-title">${p.headline || p.event}</div>
    </div>
    <div class="ad-chips">
      ${onset ? `<span class="ad-chip">📅 ${onset.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span>` : ''}
      ${expires ? `<span class="ad-chip">⏱ Expires ${expires.toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>` : ''}
      ${p.severity ? `<span class="ad-chip">⚡ ${p.severity}</span>` : ''}
      ${p.certainty ? `<span class="ad-chip">🎯 ${p.certainty}</span>` : ''}
      ${p.urgency ? `<span class="ad-chip">⏰ ${p.urgency}</span>` : ''}
    </div>
    ${p.areaDesc ? `<div class="ad-chip" style="margin-bottom:12px;display:inline-block">📍 ${p.areaDesc.split(';').slice(0,3).join(' · ')}</div>` : ''}
    <div class="ad-text">${p.description || 'No description available.'}</div>
    ${p.instruction ? `<div class="ad-sub"><div class="ad-sub-title">Instructions</div><div class="ad-text">${p.instruction}</div></div>` : ''}
  `;
  openModal('alertModal');
}

function putAlertsOnMap() {
  if (!S.map || !S.map.isStyleLoaded()) return;
  rmLayers(['alert-fill', 'alert-line'], ['alerts-src']);
  const valid = S.alerts.filter(a => a.geometry);
  if (!valid.length) return;
  try {
    S.map.addSource('alerts-src', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: valid.map(a => ({ type: 'Feature', geometry: a.geometry, properties: { event: a.properties.event } })) }
    });
    S.map.addLayer({ id: 'alert-fill', type: 'fill', source: 'alerts-src', paint: { 'fill-color': '#ff5c5c', 'fill-opacity': 0.18 } });
    S.map.addLayer({ id: 'alert-line', type: 'line', source: 'alerts-src', paint: { 'line-color': '#ff5c5c', 'line-width': 1.5 } });
  } catch(e) {}
}

function rmLayers(layers, sources) {
  if (!S.map) return;
  try { layers.forEach(l => S.map.getLayer(l) && S.map.removeLayer(l)); } catch(e) {}
  try { sources.forEach(s => S.map.getSource(s) && S.map.removeSource(s)); } catch(e) {}
}

// ================================================================
//  SEARCH
// ================================================================
async function doSearch(q) {
  if (!q || q.length < 2) { hideDrop(); return; }
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&limit=5&types=place,locality,neighborhood,postcode`;
    const r = await fetch(url);
    const d = await r.json();
    showDrop(d.features || []);
  } catch (e) { hideDrop(); }
}

function showDrop(features) {
  const dd = document.getElementById('searchDrop');
  if (!features.length) { hideDrop(); return; }
  dd.style.display = 'block';
  dd.innerHTML = features.map((f, i) => {
    const main = f.text || f.place_name.split(',')[0];
    const sub = f.place_name.split(',').slice(1, 3).join(',').trim();
    return `<div class="s-drop-item" data-i="${i}"><strong>${main}</strong>${sub ? ` · <span style="color:var(--t3);font-size:11px">${sub}</span>` : ''}</div>`;
  }).join('');
  dd.querySelectorAll('.s-drop-item').forEach(item => {
    item.addEventListener('click', () => {
      const f = features[+item.dataset.i];
      const [lng, lat] = f.center;
      S.lat = lat; S.lng = lng;
      S.locName = f.text || f.place_name.split(',')[0];
      set('locName', S.locName);
      hideDrop();
      document.getElementById('searchInput').value = '';
      if (S.map) S.map.flyTo({ center: [lng, lat], zoom: 9, duration: 1400 });
      loadWeather();
      showToast(`📍 ${f.place_name.split(',').slice(0,2).join(',')}`);
    });
  });
}

function hideDrop() {
  document.getElementById('searchDrop').style.display = 'none';
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`);
    const d = await r.json();
    if (d.features?.length) {
      S.locName = d.features[0].text || d.features[0].place_name.split(',')[0];
      set('locName', S.locName);
      set('wcLoc', S.locName);
    }
  } catch (e) {}
}

function geolocate() {
  if (!navigator.geolocation) { showToast('⚠ Geolocation not supported'); return; }
  showToast('📍 Getting your location...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      S.lat = pos.coords.latitude;
      S.lng = pos.coords.longitude;
      if (S.map) S.map.flyTo({ center: [S.lng, S.lat], zoom: 10, duration: 1200 });
      reverseGeocode(S.lat, S.lng);
      loadWeather();
    },
    () => showToast('⚠ Location access denied')
  );
}

// ================================================================
//  LEGEND
// ================================================================
function updateLegend() {
  const layer = document.querySelector('.lb.active')?.dataset.layer || 'precipitation';
  const cfg = {
    precipitation: { label: 'mm/h', grad: 'linear-gradient(to top,#646464 0%,#04e9e7 15%,#019ff4 30%,#02fd02 45%,#fdf802 60%,#fd9500 75%,#fd0000 90%,#bc0000 100%)' },
    temperature:   { label: '°', grad: 'linear-gradient(to top,#313695,#4575b4,#74add1,#abd9e9,#ffffbf,#fdae61,#f46d43,#a50026)' },
    wind:          { label: 'm/s', grad: 'linear-gradient(to top,#3288bd,#66c2a5,#abdda4,#ffffbf,#fdae61,#f46d43,#d53e4f)' },
    clouds:        { label: '%', grad: 'linear-gradient(to top,#111,#333,#666,#999,#ccc,#eee)' },
    pressure:      { label: 'hPa', grad: 'linear-gradient(to top,#0000cc,#0080ff,#00ffff,#00ff00,#ffff00,#ff8000,#ff0000)' }
  };
  const c = cfg[layer] || cfg.precipitation;
  set('legTitle', c.label);
  document.getElementById('legBar').style.background = c.grad;
}

// ================================================================
//  UI WIRING
// ================================================================
function initUI() {
  // Burger
  id('burger').onclick = () => id('sidebar').classList.toggle('open');
  id('sidebarX').onclick = () => id('sidebar').classList.remove('open');

  // Map controls
  id('zoomIn').onclick = () => S.map?.zoomIn();
  id('zoomOut').onclick = () => S.map?.zoomOut();
  id('styleBtn').onclick = cycleMapStyle;
  id('geoBtn').onclick = geolocate;
  id('refreshBtn').onclick = () => { loadWeather(); loadAlerts(); if (S.map) loadRadar(); showToast('↻ Refreshing...'); };
  id('playBtn').onclick = togglePlay;

  // Time nav
  id('tPrev').onclick = () => S.frame > 0 && pickFrame(S.frame - 1);
  id('tNext').onclick = () => S.frame < S.frames.length - 1 && pickFrame(S.frame + 1);

  // Layer tabs
  document.querySelectorAll('.lb[data-layer]').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.lb[data-layer]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      updateLegend();
      showToast(`Layer: ${b.textContent.trim()}`);
    };
  });

  // Forecast tabs
  document.querySelectorAll('.fct').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.fct').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      S.fcMode = t.dataset.ft;
      if (S.weather) renderForecast(S.weather);
    };
  });

  // Right panel tabs
  document.querySelectorAll('.rpt').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.rpt').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      S.rightTab = t.dataset.rt;
      if (S.rightTab === 'alerts') renderAlerts();
      else if (S.rightTab === 'info') updateRadarInfo({ radar: { past: S.frames } });
    };
  });

  // Sidebar nav
  document.querySelectorAll('.sni').forEach(item => {
    item.onclick = e => {
      e.preventDefault();
      document.querySelectorAll('.sni').forEach(x => x.classList.remove('active'));
      item.classList.add('active');
      const p = item.dataset.p;
      if (p === 'settings') openModal('settingsModal');
      if (p === 'alerts') {
        // Highlight alerts panel
        document.querySelectorAll('.rpt').forEach(x => x.classList.remove('active'));
        document.querySelector('.rpt[data-rt="alerts"]')?.classList.add('active');
        S.rightTab = 'alerts';
        renderAlerts();
        showToast('Showing weather alerts');
      }
    };
  });

  // Search
  let st;
  id('searchInput').addEventListener('input', e => {
    clearTimeout(st);
    const v = e.target.value.trim();
    if (v.length < 2) { hideDrop(); return; }
    st = setTimeout(() => doSearch(v), 350);
  });
  id('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideDrop(); e.target.value = ''; }
    if (e.key === 'Enter') { doSearch(e.target.value.trim()); }
  });
  document.addEventListener('click', e => {
    if (!document.querySelector('.searchbox').contains(e.target)) hideDrop();
  });

  // Alert modal
  id('mClose').onclick = () => closeModal('alertModal');
  id('alertModal').onclick = e => e.target === id('alertModal') && closeModal('alertModal');

  // Settings modal
  id('sClose').onclick = () => closeSettingsModal();
  id('settingsModal').onclick = e => e.target === id('settingsModal') && closeSettingsModal();

  // Settings controls
  segBind('sTempUnit', v => {
    S.cfg.tempUnit = v; saveCfg();
    if (S.weather) { renderWeather(S.weather); renderForecast(S.weather); }
  });
  segBind('sWindUnit', v => {
    S.cfg.windUnit = v; saveCfg();
    if (S.weather) renderWeather(S.weather);
  });
  segBind('sSpeed', v => {
    S.cfg.speed = +v; saveCfg();
    if (S.playing) { pause(); play(); }
  });
  id('sOpacity').addEventListener('input', e => {
    S.cfg.opacity = +e.target.value / 100;
    id('sOpacityVal').textContent = e.target.value + '%';
    saveCfg();
    if (S.frames.length) drawFrame(S.frame);
  });
  id('sAutoPlay').addEventListener('change', e => { S.cfg.autoPlay = e.target.checked; saveCfg(); });
  id('sAlertZones').addEventListener('change', e => {
    S.cfg.alertZones = e.target.checked; saveCfg();
    if (e.target.checked) putAlertsOnMap();
    else rmLayers(['alert-fill', 'alert-line'], ['alerts-src']);
  });
  id('sCrosshair').addEventListener('change', e => {
    S.cfg.crosshair = e.target.checked; saveCfg();
    id('crosshair').style.display = e.target.checked ? '' : 'none';
  });

  // Dark mode toggle (cosmetic — already dark)
  id('darkToggle').addEventListener('change', e => {
    showToast(e.target.checked ? '🌙 Dark mode' : '☀ Light mode');
  });

  // Escape key closes any open modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal('alertModal');
      closeModal('settingsModal');
    }
  });

  // Apply saved settings to UI
  applySettingsUI();
  updateLegend();
  updateDate();
}

function openModal(id_) { id(id_).classList.add('open'); }
function closeModal(id_) { id(id_).classList.remove('open'); }
function closeSettingsModal() {
  closeModal('settingsModal');
  document.querySelectorAll('.sni').forEach(x => x.classList.remove('active'));
  document.querySelector('.sni[data-p="home"]').classList.add('active');
}

function segBind(containerId, cb) {
  document.querySelectorAll(`#${containerId} .sb`).forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(`#${containerId} .sb`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cb(btn.dataset.v);
    };
  });
}

function applySettingsUI() {
  const c = S.cfg;
  document.querySelectorAll('#sTempUnit .sb').forEach(b => b.classList.toggle('active', b.dataset.v === c.tempUnit));
  document.querySelectorAll('#sWindUnit .sb').forEach(b => b.classList.toggle('active', b.dataset.v === c.windUnit));
  document.querySelectorAll('#sSpeed .sb').forEach(b => b.classList.toggle('active', b.dataset.v === String(c.speed)));
  id('sOpacity').value = Math.round(c.opacity * 100);
  id('sOpacityVal').textContent = Math.round(c.opacity * 100) + '%';
  id('sAutoPlay').checked = c.autoPlay;
  id('sAlertZones').checked = c.alertZones;
  id('sCrosshair').checked = c.crosshair;
  if (!c.crosshair) id('crosshair').style.display = 'none';
}

// ================================================================
//  SETTINGS PERSISTENCE
// ================================================================
function saveCfg() { try { localStorage.setItem('ss9_cfg', JSON.stringify(S.cfg)); } catch(e) {} }
function loadCfg() { try { const s = localStorage.getItem('ss9_cfg'); if (s) Object.assign(S.cfg, JSON.parse(s)); } catch(e) {} }

// ================================================================
//  UTILITIES
// ================================================================
function id(x) { return document.getElementById(x); }
function set(x, v) { const el = id(x); if (el) el.textContent = v; }
function fmt2(n) { return String(n).padStart(2, '0'); }

function cvtTemp(c) {
  return S.cfg.tempUnit === 'F' ? Math.round(c * 9/5 + 32) : Math.round(c);
}
function cvtWind(ms) {
  if (S.cfg.windUnit === 'kmh') return (ms * 3.6).toFixed(1);
  if (S.cfg.windUnit === 'mph') return (ms * 2.237).toFixed(1);
  return ms.toFixed(1);
}
function wDir(deg) {
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round(deg / 45) % 8];
}
function uvLabel(uv) {
  if (uv == null) return '';
  if (uv <= 2) return '(Low)';
  if (uv <= 5) return '(Mod)';
  if (uv <= 7) return '(High)';
  if (uv <= 10) return '(V.Hi)';
  return '(Ext)';
}
function wIcon(code) {
  const m = {
    0:'☀️',1:'🌤',2:'⛅',3:'☁️',
    45:'🌫',48:'🌫',
    51:'🌦',53:'🌦',55:'🌧',
    56:'🌨',57:'🌨',
    61:'🌧',63:'🌧',65:'🌧',
    71:'🌨',73:'🌨',75:'❄️',77:'🌨',
    80:'🌦',81:'🌦',82:'🌧',
    85:'🌨',86:'❄️',
    95:'⛈',96:'⛈',99:'⛈'
  };
  return m[code] || '🌡';
}
function wDesc(code) {
  const m = {
    0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
    45:'Foggy',48:'Icy fog',
    51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',
    61:'Light rain',63:'Moderate rain',65:'Heavy rain',
    71:'Light snow',73:'Moderate snow',75:'Heavy snow',77:'Snow grains',
    80:'Rain showers',81:'Heavy showers',82:'Violent showers',
    85:'Snow showers',86:'Heavy snow showers',
    95:'Thunderstorm',96:'Thunderstorm w/ hail',99:'Thunderstorm w/ heavy hail'
  };
  return m[code] || 'Unknown';
}

function updateDate() {
  const now = new Date();
  set('datePill', now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
}

let _toastTimer;
function showToast(msg) {
  const t = id('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function showLoader(show) {
  id('loader').classList.toggle('show', show);
}

console.log('⛈ Storm Surge v9.0 ready');