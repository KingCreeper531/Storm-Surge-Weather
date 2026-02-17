// ================================================================
//  STORM SURGE WEATHER v8.0 — FIXED & ENHANCED
//  - Single radar canvas (no duplicates)
//  - Clickable alert cards with full detail modal
//  - Working settings modal with persistence
//  - Working sidebar navigation
//  - UV index, sunrise/sunset
//  - 7-day forecast tab
//  - Geolocation
//  - Map style toggle
// ================================================================

const state = {
  map: null,
  radarCtx: null,
  radarCanvas: null,
  lat: 40.7128,
  lng: -74.006,
  locationName: 'New York',
  radarFrames: [],
  currentFrame: 11,
  isPlaying: false,
  playInterval: null,
  alerts: [],
  weatherData: null,
  forecastMode: 'hourly',
  mapStyle: 'dark',
  settings: {
    tempUnit: 'C',
    windUnit: 'ms',
    radarOpacity: 0.75,
    animSpeed: 600,
    autoPlay: false,
    showAlertZones: true,
    alertSound: false
  }
};

// ================================================================
//  BOOT
// ================================================================
(function boot() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

async function init() {
  console.log('⛈ Storm Surge v8.0 booting...');
  loadSettings();
  initMap();
  initUI();
  updateDate();
  setInterval(updateDate, 60000);
}

// ================================================================
//  MAP
// ================================================================
function initMap() {
  mapboxgl.accessToken = API_CONFIG.MAPBOX;
  state.map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [state.lng, state.lat],
    zoom: 6,
    minZoom: 2,
    maxZoom: 13,
    attributionControl: false
  });

  // Single canvas — referenced once, never re-queried
  state.radarCanvas = document.getElementById('radarCanvas');
  state.radarCtx = state.radarCanvas.getContext('2d');

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  state.map.on('load', () => {
    console.log('🗺 Map ready');
    loadRadarFrames();
    loadWeatherData();
    loadAlerts();
  });

  // Redraw radar on map move
  state.map.on('moveend', () => {
    if (state.radarFrames.length > 0) drawRadarFrame(state.currentFrame);
  });

  state.map.on('click', (e) => {
    state.lat = e.lngLat.lat;
    state.lng = e.lngLat.lng;
    reverseGeocode(state.lat, state.lng);
    loadWeatherData();
    showToast('📍 Loading weather for selected location...');
  });
}

function resizeCanvas() {
  const parent = state.radarCanvas.parentElement;
  const rect = parent.getBoundingClientRect();
  state.radarCanvas.width = rect.width;
  state.radarCanvas.height = rect.height;
  if (state.radarFrames.length > 0) drawRadarFrame(state.currentFrame);
}

function toggleMapStyle() {
  const styles = {
    dark: 'mapbox://styles/mapbox/dark-v11',
    satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
    light: 'mapbox://styles/mapbox/light-v11'
  };
  const order = ['dark', 'satellite', 'light'];
  const next = order[(order.indexOf(state.mapStyle) + 1) % order.length];
  state.mapStyle = next;
  state.map.setStyle(styles[next]);
  state.map.once('style.load', () => {
    // Re-add alert layers after style change
    if (state.alerts.length) displayAlertsOnMap();
  });
  showToast(`🗺 Map: ${next}`);
}

// ================================================================
//  RADAR
// ================================================================
async function loadRadarFrames() {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await res.json();
    if (data?.radar?.past) {
      state.radarFrames = data.radar.past.slice(-12);
      state.currentFrame = 11;
      buildTimeSlots();
      drawRadarFrame(state.currentFrame);
      console.log(`✅ ${state.radarFrames.length} radar frames loaded`);
      if (state.settings.autoPlay) startPlay();
    }
  } catch (e) {
    console.error('Radar load failed', e);
    showToast('⚠ Could not load radar data');
  }
}

function drawRadarFrame(idx) {
  if (!state.radarFrames[idx]) return;

  const ctx = state.radarCtx;
  const canvas = state.radarCanvas;
  const frame = state.radarFrames[idx];

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = state.settings.radarOpacity;

  const bounds = state.map.getBounds();
  const zoom = Math.max(2, Math.min(12, Math.floor(state.map.getZoom())));
  const tiles = getTilesForBounds(bounds, zoom);

  let loaded = 0;
  tiles.forEach(tile => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `https://tilecache.rainviewer.com${frame.path}/256/${tile.z}/${tile.x}/${tile.y}/6/1_1.png`;
    img.onload = () => {
      const nw = state.map.project([tile.bounds.west, tile.bounds.north]);
      const se = state.map.project([tile.bounds.east, tile.bounds.south]);
      const w = se.x - nw.x;
      const h = se.y - nw.y;
      if (w > 0 && h > 0) ctx.drawImage(img, nw.x, nw.y, w, h);
      loaded++;
      // Update timestamp in time slot display
    };
  });
}

function getTilesForBounds(bounds, zoom) {
  const tiles = [];
  const nw = bounds.getNorthWest();
  const se = bounds.getSouthEast();
  const minT = lngLatToTile(nw.lng, nw.lat, zoom);
  const maxT = lngLatToTile(se.lng, se.lat, zoom);
  const maxIdx = Math.pow(2, zoom) - 1;
  for (let x = Math.max(0, minT.x); x <= Math.min(maxIdx, maxT.x); x++) {
    for (let y = Math.max(0, minT.y); y <= Math.min(maxIdx, maxT.y); y++) {
      tiles.push({ x, y, z: zoom, bounds: getTileBounds(x, y, zoom) });
    }
  }
  return tiles;
}

function lngLatToTile(lng, lat, z) {
  const n = Math.pow(2, z);
  const x = Math.floor((lng + 180) / 360 * n);
  const latR = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n);
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

function getTileBounds(x, y, z) {
  const n = Math.pow(2, z);
  return {
    west: x / n * 360 - 180,
    east: (x + 1) / n * 360 - 180,
    north: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI,
    south: Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI
  };
}

function buildTimeSlots() {
  const container = document.getElementById('timeSlots');
  container.innerHTML = '';
  const now = Date.now();
  state.radarFrames.forEach((frame, i) => {
    const t = new Date(frame.time * 1000);
    const hh = t.getHours().toString().padStart(2, '0');
    const mm = t.getMinutes().toString().padStart(2, '0');
    const slot = document.createElement('button');
    slot.className = `time-slot${i === state.currentFrame ? ' active' : ''}`;
    slot.textContent = `${hh}:${mm}`;
    slot.addEventListener('click', () => selectFrame(i));
    container.appendChild(slot);
  });
}

function selectFrame(idx) {
  state.currentFrame = idx;
  document.querySelectorAll('.time-slot').forEach((s, i) => s.classList.toggle('active', i === idx));
  drawRadarFrame(idx);
}

function startPlay() {
  if (state.isPlaying) return;
  state.isPlaying = true;
  document.getElementById('playBtn').textContent = '⏸';
  document.getElementById('playBtn').classList.add('playing');
  state.playInterval = setInterval(() => {
    const next = (state.currentFrame + 1) % state.radarFrames.length;
    selectFrame(next);
  }, state.settings.animSpeed);
}

function stopPlay() {
  state.isPlaying = false;
  clearInterval(state.playInterval);
  document.getElementById('playBtn').textContent = '▶';
  document.getElementById('playBtn').classList.remove('playing');
}

function togglePlay() {
  state.isPlaying ? stopPlay() : startPlay();
}

// ================================================================
//  WEATHER DATA
// ================================================================
async function loadWeatherData() {
  try {
    showLoader(true);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${state.lat}&longitude=${state.lng}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,` +
      `wind_speed_10m,wind_direction_10m,surface_pressure,cloud_cover,uv_index` +
      `&hourly=temperature_2m,relative_humidity_2m,weather_code,precipitation_probability` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_probability_max` +
      `&timezone=auto&forecast_days=8`;
    const res = await fetch(url);
    const data = await res.json();
    state.weatherData = data;
    renderCurrentWeather(data);
    renderForecast(state.forecastMode, data);
    showLoader(false);
  } catch (e) {
    console.error('Weather load failed', e);
    showToast('⚠ Could not load weather');
    showLoader(false);
  }
}

function renderCurrentWeather(data) {
  const c = data.current;
  const daily = data.daily;

  const temp = convertTemp(c.temperature_2m);
  const feels = convertTemp(c.apparent_temperature);
  const wind = convertWind(c.wind_speed_10m);

  document.getElementById('currentTempLarge').textContent = `${temp}°${state.settings.tempUnit}`;
  document.getElementById('currentWeatherIcon').textContent = getWeatherIcon(c.weather_code);
  document.getElementById('feelsLike').textContent = `${feels}°${state.settings.tempUnit}`;
  document.getElementById('humidity').textContent = `${c.relative_humidity_2m}%`;
  document.getElementById('windSpeed').textContent = `${wind} ${state.settings.windUnit === 'ms' ? 'm/s' : state.settings.windUnit === 'kmh' ? 'km/h' : 'mph'}`;
  document.getElementById('windDirection').textContent = `${c.wind_direction_10m}° ${windDirLabel(c.wind_direction_10m)}`;
  document.getElementById('precipitation').textContent = `${(c.precipitation || 0).toFixed(1)} mm`;
  document.getElementById('pressure').textContent = `${Math.round(c.surface_pressure)} hPa`;
  document.getElementById('clouds').textContent = `${c.cloud_cover}%`;
  document.getElementById('uvIndex').textContent = `${c.uv_index ?? '--'} ${uvLabel(c.uv_index)}`;
  document.getElementById('wCardLocation').textContent = state.locationName;

  // Sunrise/sunset for today (index 0)
  if (daily?.sunrise?.[0]) {
    const sr = new Date(daily.sunrise[0]);
    const ss = new Date(daily.sunset[0]);
    document.getElementById('sunrise').textContent = `${sr.getHours().toString().padStart(2,'0')}:${sr.getMinutes().toString().padStart(2,'0')}`;
    document.getElementById('sunset').textContent = `${ss.getHours().toString().padStart(2,'0')}:${ss.getMinutes().toString().padStart(2,'0')}`;
  }
}

function renderForecast(mode, data) {
  if (!data) return;
  const container = document.getElementById('forecastScroll');
  container.innerHTML = '';

  if (mode === 'hourly') {
    const hours = Math.min(24, data.hourly.temperature_2m.length);
    for (let i = 0; i < hours; i++) {
      const t = new Date(data.hourly.time[i]);
      const isNow = i === new Date().getHours();
      const div = document.createElement('div');
      div.className = `forecast-item${isNow ? ' now' : ''}`;
      const temp = convertTemp(data.hourly.temperature_2m[i]);
      div.innerHTML = `
        <span class="fi-time">${t.getHours().toString().padStart(2,'0')}:00</span>
        <span class="fi-icon">${getWeatherIcon(data.hourly.weather_code[i])}</span>
        <span class="fi-temp">${temp}°</span>
        <span class="fi-hum">💧${data.hourly.relative_humidity_2m[i]}%</span>
      `;
      container.appendChild(div);
    }
  } else {
    // 7-day
    const days = data.daily.time.slice(0, 7);
    days.forEach((dateStr, i) => {
      const d = new Date(dateStr);
      const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const div = document.createElement('div');
      div.className = `forecast-item${i === 0 ? ' now' : ''}`;
      const hi = convertTemp(data.daily.temperature_2m_max[i]);
      const lo = convertTemp(data.daily.temperature_2m_min[i]);
      div.innerHTML = `
        <span class="fi-time">${i === 0 ? 'Today' : dayNames[d.getDay()]}</span>
        <span class="fi-icon">${getWeatherIcon(data.daily.weather_code[i])}</span>
        <span class="fi-temp">${hi}°/${lo}°</span>
        <span class="fi-hum">🌧${data.daily.precipitation_probability_max[i]}%</span>
      `;
      container.appendChild(div);
    });
  }
}

// ================================================================
//  ALERTS
// ================================================================
async function loadAlerts() {
  try {
    const res = await fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert', {
      headers: { 'User-Agent': '(StormSurgeWeather/8.0)', 'Accept': 'application/geo+json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    state.alerts = (data.features || []).filter(f => {
      if (!f.properties?.event) return false;
      const exp = new Date(f.properties.expires);
      return exp > new Date();
    });

    renderAlerts();
    if (state.settings.showAlertZones) displayAlertsOnMap();
    updateAlertCounts();
    console.log(`✅ ${state.alerts.length} active alerts`);
  } catch (e) {
    console.error('Alerts load failed', e);
    state.alerts = [];
    renderAlerts();
    updateAlertCounts();
  }
}

function updateAlertCounts() {
  const n = state.alerts.length;
  document.getElementById('sidebarAlertCount').textContent = n;
  document.getElementById('alertTabCount').textContent = n;
}

function getAlertSeverity(event) {
  const ev = (event || '').toLowerCase();
  if (ev.includes('tornado') || ev.includes('extreme') || ev.includes('hurricane') || ev.includes('typhoon')) return 'emergency';
  if (ev.includes('warning')) return 'warning-badge';
  if (ev.includes('watch')) return 'watch-badge';
  if (ev.includes('advisory')) return 'advisory-badge';
  return 'default-badge';
}

function getAlertIcon(event) {
  const ev = (event || '').toLowerCase();
  if (ev.includes('tornado')) return '🌪';
  if (ev.includes('hurricane') || ev.includes('typhoon')) return '🌀';
  if (ev.includes('thunder') || ev.includes('lightning')) return '⛈';
  if (ev.includes('snow') || ev.includes('blizzard') || ev.includes('winter')) return '❄️';
  if (ev.includes('flood')) return '🌊';
  if (ev.includes('wind')) return '💨';
  if (ev.includes('fog')) return '🌫';
  if (ev.includes('fire')) return '🔥';
  if (ev.includes('heat')) return '🌡';
  return '⚠️';
}

function getAlertCardClass(event) {
  const sev = getAlertSeverity(event);
  if (sev === 'emergency' || sev === 'warning-badge') return 'warning';
  if (sev === 'watch-badge') return 'watch';
  if (sev === 'advisory-badge') return 'advisory';
  return '';
}

function renderAlerts() {
  const list = document.getElementById('alertsList');
  if (!state.alerts.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">✓</div><div class="empty-text">No active alerts in your area.</div></div>`;
    return;
  }

  list.innerHTML = state.alerts.map((alert, idx) => {
    const p = alert.properties;
    const area = p.areaDesc ? p.areaDesc.split(';')[0].trim() : 'Unknown area';
    const exp = p.expires ? new Date(p.expires) : null;
    const expStr = exp ? `Expires ${exp.toLocaleDateString('en-US', {month:'short',day:'numeric'})} ${exp.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}` : '';
    const sev = getAlertSeverity(p.event);
    const cardClass = getAlertCardClass(p.event);
    const icon = getAlertIcon(p.event);

    return `
      <div class="alert-card ${cardClass}" data-idx="${idx}" role="button" tabindex="0">
        <span class="alert-arrow">›</span>
        <div class="alert-type-badge ${sev}">${icon} ${p.event}</div>
        <div class="alert-title">${p.headline || p.event}</div>
        <div class="alert-area">📍 ${area}</div>
        ${expStr ? `<div class="alert-expires">${expStr}</div>` : ''}
      </div>
    `;
  }).join('');

  // Bind click handlers
  list.querySelectorAll('.alert-card').forEach(card => {
    const open = () => openAlertModal(parseInt(card.dataset.idx));
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(); });
  });
}

function openAlertModal(idx) {
  const alert = state.alerts[idx];
  if (!alert) return;
  const p = alert.properties;

  const onset = p.onset ? new Date(p.onset) : (p.sent ? new Date(p.sent) : null);
  const expires = p.expires ? new Date(p.expires) : null;
  const icon = getAlertIcon(p.event);
  const sev = getAlertSeverity(p.event);

  document.getElementById('modalTitle').textContent = `${icon} ${p.event}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="alert-detail-header">
      <div class="alert-detail-icon">${icon}</div>
      <div class="alert-detail-title">${p.headline || p.event}</div>
    </div>
    <div class="alert-detail-meta">
      ${onset ? `<span class="detail-chip">📅 ${onset.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span>` : ''}
      ${expires ? `<span class="detail-chip">⏱ Expires ${expires.toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>` : ''}
      ${p.severity ? `<span class="detail-chip">⚡ ${p.severity}</span>` : ''}
      ${p.certainty ? `<span class="detail-chip">🎯 ${p.certainty}</span>` : ''}
      ${p.urgency ? `<span class="detail-chip">⏰ ${p.urgency}</span>` : ''}
    </div>
    ${p.areaDesc ? `<div class="detail-chip" style="margin-bottom:12px;display:inline-block">📍 ${p.areaDesc.split(';').slice(0,3).join(', ')}</div>` : ''}
    <div class="alert-detail-body">${p.description || p.headline || 'No additional details available.'}</div>
    ${p.instruction ? `<div style="margin-top:12px"><div class="settings-title" style="margin-bottom:6px">INSTRUCTIONS</div><div class="alert-detail-body">${p.instruction}</div></div>` : ''}
  `;

  document.getElementById('alertModal').classList.add('open');
}

function displayAlertsOnMap() {
  if (!state.map.isStyleLoaded()) return;
  try {
    if (state.map.getLayer('alert-fill')) state.map.removeLayer('alert-fill');
    if (state.map.getLayer('alert-line')) state.map.removeLayer('alert-line');
    if (state.map.getSource('alerts')) state.map.removeSource('alerts');
  } catch(e) {}

  const valid = state.alerts.filter(a => a.geometry);
  if (!valid.length) return;

  state.map.addSource('alerts', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: valid.map(a => ({
        type: 'Feature',
        geometry: a.geometry,
        properties: { event: a.properties.event }
      }))
    }
  });

  state.map.addLayer({
    id: 'alert-fill',
    type: 'fill',
    source: 'alerts',
    paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.2 }
  });

  state.map.addLayer({
    id: 'alert-line',
    type: 'line',
    source: 'alerts',
    paint: { 'line-color': '#ef4444', 'line-width': 1.5 }
  });
}

// ================================================================
//  GEOCODING
// ================================================================
async function searchLocation(query) {
  if (!query.trim()) return;
  showLoader(true);
  try {
    const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${API_CONFIG.MAPBOX}&limit=5`);
    const data = await res.json();
    if (data.features?.length) {
      showSearchDropdown(data.features);
    } else {
      showToast('📍 Location not found');
    }
  } catch (e) {
    showToast('⚠ Search failed');
  }
  showLoader(false);
}

function showSearchDropdown(features) {
  const dd = document.getElementById('searchDropdown');
  dd.style.display = 'block';
  dd.innerHTML = features.map((f, i) =>
    `<div class="search-result-item" data-idx="${i}">📍 ${f.place_name}</div>`
  ).join('');

  dd.querySelectorAll('.search-result-item').forEach((item, i) => {
    item.addEventListener('click', () => {
      const f = features[i];
      const [lng, lat] = f.center;
      state.lat = lat;
      state.lng = lng;
      state.locationName = f.text || f.place_name.split(',')[0];
      document.getElementById('dashboardLocation').textContent = state.locationName;
      document.getElementById('wCardLocation').textContent = state.locationName;
      document.getElementById('mapSearch').value = '';
      dd.style.display = 'none';
      state.map.flyTo({ center: [lng, lat], zoom: 9, duration: 1500 });
      loadWeatherData();
      showToast(`📍 ${f.place_name}`);
    });
  });
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${API_CONFIG.MAPBOX}&limit=1`);
    const data = await res.json();
    if (data.features?.length) {
      state.locationName = data.features[0].text || data.features[0].place_name.split(',')[0];
      document.getElementById('dashboardLocation').textContent = state.locationName;
      document.getElementById('wCardLocation').textContent = state.locationName;
    }
  } catch (e) {}
}

function getMyLocation() {
  if (!navigator.geolocation) { showToast('⚠ Geolocation not supported'); return; }
  showToast('📍 Getting your location...');
  navigator.geolocation.getCurrentPosition(pos => {
    state.lat = pos.coords.latitude;
    state.lng = pos.coords.longitude;
    state.map.flyTo({ center: [state.lng, state.lat], zoom: 10, duration: 1500 });
    reverseGeocode(state.lat, state.lng);
    loadWeatherData();
  }, () => {
    showToast('⚠ Could not get location. Please allow location access.');
  });
}

// ================================================================
//  LEGEND
// ================================================================
function updateLegend() {
  const title = document.getElementById('legendTitle');
  const bar = document.getElementById('legendBar');
  const cfg = {
    precipitation: { label: 'mm/h', gradient: 'linear-gradient(to top,#646464 0%,#04e9e7 15%,#019ff4 30%,#02fd02 45%,#fdf802 60%,#fd9500 75%,#fd0000 90%,#bc0000 100%)' },
    temperature: { label: '°C', gradient: 'linear-gradient(to top,#313695,#4575b4,#abd9e9,#ffffbf,#fdae61,#f46d43,#a50026)' },
    wind: { label: 'm/s', gradient: 'linear-gradient(to top,#3288bd,#66c2a5,#abdda4,#ffffbf,#fdae61,#f46d43,#d53e4f)' },
    clouds: { label: '%', gradient: 'linear-gradient(to top,#111,#555,#999,#ccc,#fff)' },
    pressure: { label: 'hPa', gradient: 'linear-gradient(to top,#0000ff,#00ffff,#00ff00,#ffff00,#ff0000)' }
  };
  const active = document.querySelector('.layer-btn.active')?.dataset.layer || 'precipitation';
  const c = cfg[active] || cfg.precipitation;
  title.textContent = c.label;
  bar.style.background = c.gradient;
}

// ================================================================
//  UI SETUP
// ================================================================
function initUI() {
  // Hamburger
  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
  document.getElementById('sidebarClose').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
  });

  // Map controls
  document.getElementById('zoomIn').addEventListener('click', () => state.map.zoomIn());
  document.getElementById('zoomOut').addEventListener('click', () => state.map.zoomOut());
  document.getElementById('mapStyleToggle').addEventListener('click', toggleMapStyle);
  document.getElementById('locateMe').addEventListener('click', getMyLocation);

  // Play button
  document.getElementById('playBtn').addEventListener('click', togglePlay);

  // Time nav arrows
  document.getElementById('timePrev').addEventListener('click', () => {
    if (state.currentFrame > 0) selectFrame(state.currentFrame - 1);
  });
  document.getElementById('timeNext').addEventListener('click', () => {
    if (state.currentFrame < state.radarFrames.length - 1) selectFrame(state.currentFrame + 1);
  });

  // Layer tabs
  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateLegend();
      showToast(`Layer: ${btn.textContent.trim()}`);
    });
  });

  // Forecast tabs
  document.querySelectorAll('.ftab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.forecastMode = tab.dataset.ft;
      renderForecast(state.forecastMode, state.weatherData);
    });
  });

  // Panel tabs
  document.querySelectorAll('.ptab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  // Search
  const searchInput = document.getElementById('mapSearch');
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const v = searchInput.value.trim();
    if (v.length < 3) {
      document.getElementById('searchDropdown').style.display = 'none';
      return;
    }
    searchTimeout = setTimeout(() => searchLocation(v), 400);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('searchDropdown').style.display = 'none';
      searchInput.value = '';
    }
  });
  document.addEventListener('click', (e) => {
    if (!document.querySelector('.search-bar').contains(e.target)) {
      document.getElementById('searchDropdown').style.display = 'none';
    }
  });

  // Sidebar navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const page = item.dataset.page;
      if (page === 'settings') openSettingsModal();
      if (page === 'alerts') scrollToAlerts();
    });
  });

  // Alert modal close
  document.getElementById('modalClose').addEventListener('click', () => {
    document.getElementById('alertModal').classList.remove('open');
  });
  document.getElementById('alertModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('alertModal')) {
      document.getElementById('alertModal').classList.remove('open');
    }
  });

  // Settings modal close
  document.getElementById('settingsClose').addEventListener('click', closeSettingsModal);
  document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('settingsModal')) closeSettingsModal();
  });

  // Settings: temp unit
  document.querySelectorAll('#tempUnit .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tempUnit .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.settings.tempUnit = btn.dataset.val;
      saveSettings();
      if (state.weatherData) renderCurrentWeather(state.weatherData);
      if (state.weatherData) renderForecast(state.forecastMode, state.weatherData);
    });
  });

  // Settings: wind unit
  document.querySelectorAll('#windUnit .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#windUnit .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.settings.windUnit = btn.dataset.val;
      saveSettings();
      if (state.weatherData) renderCurrentWeather(state.weatherData);
    });
  });

  // Settings: radar opacity
  const opSlider = document.getElementById('radarOpacity');
  const opVal = document.getElementById('opacityVal');
  opSlider.addEventListener('input', () => {
    state.settings.radarOpacity = parseInt(opSlider.value) / 100;
    opVal.textContent = `${opSlider.value}%`;
    saveSettings();
    drawRadarFrame(state.currentFrame);
  });

  // Settings: animation speed
  document.querySelectorAll('#animSpeed .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#animSpeed .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.settings.animSpeed = parseInt(btn.dataset.val);
      saveSettings();
      if (state.isPlaying) { stopPlay(); startPlay(); }
    });
  });

  // Settings: toggles
  document.getElementById('autoPlay').addEventListener('change', (e) => {
    state.settings.autoPlay = e.target.checked;
    saveSettings();
  });
  document.getElementById('showAlertZones').addEventListener('change', (e) => {
    state.settings.showAlertZones = e.target.checked;
    saveSettings();
    if (e.target.checked) displayAlertsOnMap();
    else removeAlertLayers();
  });
  document.getElementById('alertSound').addEventListener('change', (e) => {
    state.settings.alertSound = e.target.checked;
    saveSettings();
  });

  // Apply saved settings to UI
  applySavedSettings();
  updateLegend();
}

function scrollToAlerts() {
  // Right panel is already showing alerts; on mobile, scroll panel into view
  document.getElementById('alertsList').scrollIntoView?.({ behavior: 'smooth' });
  showToast('Viewing weather alerts');
}

function openSettingsModal() {
  document.getElementById('settingsModal').classList.add('open');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.remove('open');
  // Reset nav active
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelector('.nav-item[data-page="home"]').classList.add('active');
}

function applySavedSettings() {
  const s = state.settings;
  // Temp unit
  document.querySelectorAll('#tempUnit .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val === s.tempUnit));
  // Wind unit
  document.querySelectorAll('#windUnit .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val === s.windUnit));
  // Radar opacity
  const opSlider = document.getElementById('radarOpacity');
  opSlider.value = Math.round(s.radarOpacity * 100);
  document.getElementById('opacityVal').textContent = `${opSlider.value}%`;
  // Toggles
  document.getElementById('autoPlay').checked = s.autoPlay;
  document.getElementById('showAlertZones').checked = s.showAlertZones;
  document.getElementById('alertSound').checked = s.alertSound;
  // Anim speed
  document.querySelectorAll('#animSpeed .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val === String(s.animSpeed)));
}

function removeAlertLayers() {
  try {
    if (state.map.getLayer('alert-fill')) state.map.removeLayer('alert-fill');
    if (state.map.getLayer('alert-line')) state.map.removeLayer('alert-line');
    if (state.map.getSource('alerts')) state.map.removeSource('alerts');
  } catch(e) {}
}

// ================================================================
//  SETTINGS PERSISTENCE
// ================================================================
function saveSettings() {
  try { localStorage.setItem('ss_settings', JSON.stringify(state.settings)); } catch(e) {}
}

function loadSettings() {
  try {
    const saved = localStorage.getItem('ss_settings');
    if (saved) Object.assign(state.settings, JSON.parse(saved));
  } catch(e) {}
}

// ================================================================
//  UTILITIES
// ================================================================
function convertTemp(c) {
  if (state.settings.tempUnit === 'F') return Math.round(c * 9/5 + 32);
  return Math.round(c);
}

function convertWind(ms) {
  if (state.settings.windUnit === 'kmh') return (ms * 3.6).toFixed(1);
  if (state.settings.windUnit === 'mph') return (ms * 2.237).toFixed(1);
  return ms.toFixed(1);
}

function windDirLabel(deg) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function uvLabel(uv) {
  if (uv == null) return '';
  if (uv <= 2) return '(Low)';
  if (uv <= 5) return '(Moderate)';
  if (uv <= 7) return '(High)';
  if (uv <= 10) return '(V.High)';
  return '(Extreme)';
}

function getWeatherIcon(code) {
  const map = {
    0:'☀️', 1:'🌤', 2:'⛅', 3:'☁️',
    45:'🌫', 48:'🌫',
    51:'🌦', 53:'🌦', 55:'🌧',
    56:'🌨', 57:'🌨',
    61:'🌧', 63:'🌧', 65:'🌧',
    71:'🌨', 73:'🌨', 75:'❄️',
    77:'🌨',
    80:'🌦', 81:'🌦', 82:'🌧',
    85:'🌨', 86:'❄️',
    95:'⛈', 96:'⛈', 99:'⛈'
  };
  return map[code] || '🌡';
}

function updateDate() {
  const now = new Date();
  document.getElementById('currentDate').textContent = now.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function showLoader(show) {
  document.getElementById('loader').classList.toggle('show', show);
}

console.log('⛈ Storm Surge v8.0 ready');