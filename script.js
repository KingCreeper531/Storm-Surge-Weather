// ========================================
//  STORM SURGE WEATHER - ENHANCED EDITION
//  Version 6.0 - Smooth Radar & Custom Alerts
// ========================================

// ================================
//  API KEYS & CONFIG
// ================================
const MAPBOX_KEY = "pk.eyJ1Ijoic3Rvcm0tc3VyZ2UiLCJhIjoiY21pcDM0emdxMDhwYzNmcHc2aTlqeTN5OSJ9.QYtnuhdixR4SGxLQldE9PA";
const TOMORROW_API_KEY = "SxfCeG33LbiKBLlR5iEegtxw5aXnZEOr";

// ================================
//  STATE MANAGEMENT
// ================================
let state = {
    map: null,
    radarCanvas: null,
    canvasCtx: null,
    
    // Radar
    radarFrames: [],
    preloadedImages: [],
    currentFrame: 11,
    isPlaying: false,
    playInterval: null,
    radarOpacity: 0.7,
    animationSpeed: 500,
    smoothInterpolation: true,
    radarSource: 'rainviewer',
    
    // Alerts
    alerts: [],
    alertFilters: new Set(),
    customColors: {},
    
    // Location
    currentLat: 39.8283,
    currentLng: -98.5795,
    
    // Settings
    useOpenMeteo: true,
    show3DRadar: false,
    
    // Cache
    weatherCache: new Map(),
    lastAlertUpdate: null
};

// ================================
//  DEFAULT ALERT COLORS
// ================================
const DEFAULT_COLORS = {
    'Tornado Warning': '#FF0000',
    'Tornado Watch': '#FF6B00',
    'Severe Thunderstorm Warning': '#FFA500',
    'Severe Thunderstorm Watch': '#FFCC00',
    'Flash Flood Warning': '#8B0000',
    'Flash Flood Watch': '#CD5C5C',
    'Flood Warning': '#00FF00',
    'Flood Watch': '#7FFF00',
    'Flood Advisory': '#00FF7F',
    'Winter Storm Warning': '#FF1493',
    'Winter Storm Watch': '#FF69B4',
    'Winter Weather Advisory': '#7B68EE',
    'Blizzard Warning': '#FF4500',
    'Ice Storm Warning': '#8B008B',
    'High Wind Warning': '#DAA520',
    'High Wind Watch': '#F4A460',
    'Wind Advisory': '#D2B48C',
    'Hurricane Warning': '#DC143C',
    'Hurricane Watch': '#FF1493',
    'Tropical Storm Warning': '#B22222',
    'Tropical Storm Watch': '#FF6347',
    'Excessive Heat Warning': '#C71585',
    'Heat Advisory': '#FF7F50',
    'Dense Fog Advisory': '#708090',
    'Special Weather Statement': '#FFE4B5'
};

// ================================
//  COLOR PRESETS
// ================================
const COLOR_PRESETS = [
    '#FF0000', '#FFA500', '#FFFF00', '#00FF00', 
    '#0000FF', '#FF1493', '#8B0000', '#DAA520', 
    '#4169E1', '#9400D3', '#DC143C', '#00CED1',
    '#FF69B4', '#32CD32', '#FF4500', '#1E90FF'
];

// ================================
//  INITIALIZATION
// ================================
function init() {
    console.log('🚀 Storm Surge Weather Enhanced v6.0');
    
    // Initialize Mapbox
    mapboxgl.accessToken = MAPBOX_KEY;
    state.map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [state.currentLng, state.currentLat],
        zoom: 4,
        minZoom: 2,
        maxZoom: 12
    });
    
    // Initialize radar canvas
    state.radarCanvas = document.getElementById('radarCanvas');
    state.canvasCtx = state.radarCanvas.getContext('2d', { alpha: true });
    
    // Resize canvas
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Map events
    state.map.on('load', onMapLoad);
    state.map.on('click', onMapClick);
    state.map.on('move', onMapMove);
    
    // Initialize UI
    initEventListeners();
    initAlertFilters();
    
    console.log('✅ Initialization complete');
}

function resizeCanvas() {
    state.radarCanvas.width = window.innerWidth;
    state.radarCanvas.height = window.innerHeight;
}

function onMapLoad() {
    console.log('🗺️ Map loaded');
    loadRadarFrames();
    loadAlerts();
    setInterval(() => loadAlerts(), 300000); // Refresh alerts every 5 minutes
}

function onMapClick(e) {
    state.currentLat = e.lngLat.lat;
    state.currentLng = e.lngLat.lng;
    loadWeatherForLocation(e.lngLat.lat, e.lngLat.lng);
}

function onMapMove() {
    // Redraw radar when map moves
    if (state.radarFrames.length > 0) {
        drawFrame(state.currentFrame);
    }
}

// ================================
//  RADAR FUNCTIONS
// ================================
async function loadRadarFrames() {
    try {
        showLoading(true);
        console.log(`🔄 Loading ${state.radarSource} radar...`);
        
        if (state.radarSource === 'rainviewer') {
            await loadRainViewerFrames();
        } else if (state.radarSource === 'nexrad') {
            await loadNEXRADFrames();
        } else if (state.radarSource === 'tomorrow') {
            await loadTomorrowRadarFrames();
        }
        
        state.currentFrame = state.radarFrames.length - 1;
        const slider = document.getElementById('timeSlider');
        slider.max = state.radarFrames.length - 1;
        slider.value = state.currentFrame;
        
        displayRadarFrame(state.currentFrame);
        showToast('Radar loaded successfully', 'success');
        showLoading(false);
        
    } catch (error) {
        console.error('❌ Error loading radar:', error);
        showToast('Error loading radar data', 'error');
        showLoading(false);
    }
}

async function loadRainViewerFrames() {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await res.json();
    state.radarFrames = data.radar.past.slice(-12);
    
    // Preload images for smooth transitions
    state.preloadedImages = [];
    const loadPromises = state.radarFrames.map((frame, index) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                state.preloadedImages[index] = img;
                resolve();
            };
            img.onerror = reject;
            // Store base path, we'll replace coordinates when drawing
            img.setAttribute('data-path', frame.path);
            img.src = `https://tilecache.rainviewer.com${frame.path}/256/0/0/0/6/1_1.png`; // Load a sample tile
        });
    });
    
    await Promise.all(loadPromises);
    console.log(`✅ Preloaded ${state.preloadedImages.length} radar frames`);
}

async function loadNEXRADFrames() {
    // NEXRAD WSR-88D Radar
    // In production, integrate with NWS radar API
    // For now, simulate with timestamps
    const frames = [];
    const now = Date.now();
    
    for (let i = 0; i < 12; i++) {
        frames.push({
            time: now - (11 - i) * 300000, // 5-minute intervals
            path: `/nexrad/${Date.now() - (11 - i) * 300000}`,
            source: 'nexrad'
        });
    }
    
    state.radarFrames = frames;
    
    // Note: Real NEXRAD integration would fetch from:
    // https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi
    // Or Iowa Environmental Mesonet tile service
    
    showToast('NEXRAD radar coming soon - using simulation', 'info');
}

async function loadTomorrowRadarFrames() {
    try {
        // Tomorrow.io weather layers
        const res = await fetch(
            `https://api.tomorrow.io/v4/weather/forecast?location=${state.currentLat},${state.currentLng}&apikey=${TOMORROW_API_KEY}&units=imperial`
        );
        
        if (!res.ok) throw new Error('Tomorrow.io API error');
        
        const data = await res.json();
        
        // Convert Tomorrow.io data to frame format
        const frames = [];
        const now = Date.now();
        
        for (let i = 0; i < 12; i++) {
            frames.push({
                time: now - (11 - i) * 300000,
                path: `/tomorrow/${now - (11 - i) * 300000}`,
                source: 'tomorrow',
                data: data.timelines.minutely[i]
            });
        }
        
        state.radarFrames = frames;
        console.log('✅ Tomorrow.io radar loaded');
        
    } catch (error) {
        console.error('Tomorrow.io radar error:', error);
        showToast('Tomorrow.io unavailable, switching to RainViewer', 'error');
        state.radarSource = 'rainviewer';
        await loadRainViewerFrames();
    }
}

function displayRadarFrame(index) {
    if (!state.radarFrames[index]) return;
    
    const frame = state.radarFrames[index];
    state.currentFrame = index;
    
    // Update time display
    const time = new Date(frame.time);
    const isNow = index === state.radarFrames.length - 1;
    document.getElementById('timeDisplay').textContent = isNow ? 'Now' : time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    
    // Draw frame
    if (state.smoothInterpolation && state.isPlaying && index < state.radarFrames.length - 1) {
        smoothTransition(index, index + 1);
    } else {
        drawFrame(index);
    }
}

function drawFrame(index) {
    if (!state.map || !state.canvasCtx || !state.radarFrames[index]) return;
    
    const ctx = state.canvasCtx;
    const canvas = state.radarCanvas;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = state.radarOpacity;
    
    if (state.radarSource === 'rainviewer' && state.preloadedImages[index]) {
        drawRainViewerTiles(index);
    } else if (state.radarSource === 'nexrad') {
        drawNEXRADTiles(index);
    } else if (state.radarSource === 'tomorrow') {
        drawTomorrowRadar(index);
    }
}

function drawRainViewerTiles(index) {
    const bounds = state.map.getBounds();
    const zoom = Math.floor(state.map.getZoom());
    const tiles = getTilesForBounds(bounds, zoom);
    const frame = state.radarFrames[index];
    
    tiles.forEach(tile => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const tileUrl = `https://tilecache.rainviewer.com${frame.path}/256/${tile.z}/${tile.x}/${tile.y}/6/1_1.png`;
        
        img.onload = () => {
            const nw = state.map.project([tile.bounds.west, tile.bounds.north]);
            const se = state.map.project([tile.bounds.east, tile.bounds.south]);
            const width = se.x - nw.x;
            const height = se.y - nw.y;
            
            state.canvasCtx.drawImage(img, nw.x, nw.y, width, height);
        };
        
        img.src = tileUrl;
    });
}

function drawNEXRADTiles(index) {
    // NEXRAD tile drawing
    // Would use Iowa Mesonet or NWS tile service
    const ctx = state.canvasCtx;
    ctx.fillStyle = 'rgba(74, 222, 128, 0.3)';
    ctx.fillRect(100, 100, 200, 200);
    ctx.font = '20px Inter';
    ctx.fillStyle = '#4ade80';
    ctx.fillText('NEXRAD Coming Soon', 120, 200);
}

function drawTomorrowRadar(index) {
    // Tomorrow.io radar visualization
    const frame = state.radarFrames[index];
    if (!frame.data) return;
    
    const ctx = state.canvasCtx;
    const center = state.map.project([state.currentLng, state.currentLat]);
    
    // Draw precipitation intensity as colored circle
    const intensity = frame.data.values.precipitationIntensity || 0;
    if (intensity > 0) {
        const radius = 50 + (intensity * 100);
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(74, 222, 128, ${Math.min(intensity, 0.8)})`;
        ctx.fill();
    }
}

function smoothTransition(fromIndex, toIndex) {
    let progress = 0;
    const steps = 10;
    const stepDuration = state.animationSpeed / steps;
    
    const animate = () => {
        progress += 1 / steps;
        
        if (progress >= 1) {
            drawFrame(toIndex);
            return;
        }
        
        // Clear and draw interpolated frame
        state.canvasCtx.clearRect(0, 0, state.radarCanvas.width, state.radarCanvas.height);
        
        // Draw from frame with decreasing opacity
        state.canvasCtx.globalAlpha = state.radarOpacity * (1 - progress);
        drawFrame(fromIndex);
        
        // Draw to frame with increasing opacity
        state.canvasCtx.globalAlpha = state.radarOpacity * progress;
        drawFrame(toIndex);
        
        setTimeout(animate, stepDuration);
    };
    
    animate();
}

function getTilesForBounds(bounds, zoom) {
    const tiles = [];
    const nw = bounds.getNorthWest();
    const se = bounds.getSouthEast();
    
    const minTile = lngLatToTile(nw.lng, nw.lat, zoom);
    const maxTile = lngLatToTile(se.lng, se.lat, zoom);
    
    for (let x = minTile.x; x <= maxTile.x; x++) {
        for (let y = minTile.y; y <= maxTile.y; y++) {
            const tileBounds = getTileBounds(x, y, zoom);
            tiles.push({ 
                x, 
                y, 
                z: zoom,
                bounds: tileBounds
            });
        }
    }
    
    return tiles;
}

function lngLatToTile(lng, lat, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y };
}

function getTileBounds(x, y, zoom) {
    const n = Math.pow(2, zoom);
    const west = x / n * 360 - 180;
    const east = (x + 1) / n * 360 - 180;
    const north = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    const south = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
    return { north, south, east, west };
}

// ================================
//  PLAYBACK CONTROLS
// ================================
function togglePlay() {
    state.isPlaying = !state.isPlaying;
    const btn = document.getElementById('playBtn');
    btn.textContent = state.isPlaying ? '⏸' : '▶';
    
    if (state.isPlaying) {
        state.playInterval = setInterval(() => {
            state.currentFrame = (state.currentFrame + 1) % state.radarFrames.length;
            document.getElementById('timeSlider').value = state.currentFrame;
            displayRadarFrame(state.currentFrame);
        }, state.animationSpeed);
    } else {
        clearInterval(state.playInterval);
    }
}

function onTimeSliderChange(value) {
    if (state.isPlaying) togglePlay();
    displayRadarFrame(parseInt(value));
}

// ================================
//  ALERTS FUNCTIONS
// ================================
async function loadAlerts() {
    try {
        console.log('🔄 Loading weather alerts...');
        
        const res = await fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert', {
            headers: { 
                'User-Agent': '(StormSurgeWeather, stormsurgee025@gmail.com)',
                'Accept': 'application/geo+json'
            }
        });
        
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        
        const data = await res.json();
        
        // Filter alerts based on user selections
        state.alerts = data.features.filter(f => {
            if (!f.properties || !f.properties.event) return false;
            
            const expires = new Date(f.properties.expires);
            if (expires < new Date()) return false;
            
            // Check if alert type is filtered out
            if (state.alertFilters.has(f.properties.event)) return false;
            
            return true;
        });
        
        state.lastAlertUpdate = new Date();
        
        displayAlerts();
        updateAlertPolygons();
        
        console.log(`✅ Loaded ${state.alerts.length} alerts`);
        
    } catch (error) {
        console.error('❌ Error loading alerts:', error);
        showToast('Error loading weather alerts', 'error');
        state.alerts = [];
        displayAlerts();
    }
}

function displayAlerts() {
    const content = document.getElementById('alertsContent');
    const badge = document.getElementById('alertBadge');
    const count = document.getElementById('alertCount');
    
    badge.textContent = state.alerts.length;
    count.textContent = state.alerts.length;
    
    if (state.alerts.length === 0) {
        content.innerHTML = `
            <div style="text-align: center; color: #4ade80; padding: 40px;">
                <div style="font-size: 60px;">✓</div>
                <div style="font-weight: 700; margin-top: 10px; font-size: 18px;">No Active Alerts</div>
                <div style="font-size: 12px; color: #999; margin-top: 5px;">All clear in monitored areas</div>
            </div>
        `;
        return;
    }
    
    content.innerHTML = state.alerts.map(alert => {
        const props = alert.properties;
        const color = state.customColors[props.event] || DEFAULT_COLORS[props.event] || '#999';
        const expires = new Date(props.expires);
        const timeLeft = getTimeRemaining(expires);
        
        return `
            <div class="alert-item" style="border-left-color: ${color};">
                <div class="alert-type">${props.event}</div>
                <div class="alert-area">${props.areaDesc ? props.areaDesc.split(';')[0] : 'Unknown area'}</div>
                <div class="alert-time">⏱️ Expires: ${timeLeft}</div>
            </div>
        `;
    }).join('');
}

function updateAlertPolygons() {
    // Remove existing layers
    if (state.map.getLayer('alert-fills')) state.map.removeLayer('alert-fills');
    if (state.map.getLayer('alert-lines')) state.map.removeLayer('alert-lines');
    if (state.map.getSource('alerts-source')) state.map.removeSource('alerts-source');
    
    const validAlerts = state.alerts.filter(a => a.geometry);
    if (validAlerts.length === 0) return;
    
    const geojson = {
        type: 'FeatureCollection',
        features: validAlerts.map(a => ({
            type: 'Feature',
            geometry: a.geometry,
            properties: {
                event: a.properties.event,
                color: state.customColors[a.properties.event] || DEFAULT_COLORS[a.properties.event] || '#999'
            }
        }))
    };
    
    state.map.addSource('alerts-source', { type: 'geojson', data: geojson });
    
    state.map.addLayer({
        id: 'alert-fills',
        type: 'fill',
        source: 'alerts-source',
        paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.35
        }
    });
    
    state.map.addLayer({
        id: 'alert-lines',
        type: 'line',
        source: 'alerts-source',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': 2.5,
            'line-opacity': 0.9
        }
    });
    
    console.log('✅ Alert polygons displayed');
}

function getTimeRemaining(expiresDate) {
    const diff = expiresDate - new Date();
    if (diff < 0) return 'Expired';
    
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    
    if (hours > 24) return `${Math.floor(hours / 24)}d`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// ================================
//  ALERT FILTERS
// ================================
function initAlertFilters() {
    const container = document.getElementById('alertFilters');
    const alertTypes = Object.keys(DEFAULT_COLORS);
    
    container.innerHTML = alertTypes.map(type => {
        const safeId = type.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
        return `
            <div class="alert-filter-item">
                <input type="checkbox" 
                       id="filter_${safeId}" 
                       checked 
                       onchange="toggleAlertFilter('${type.replace(/'/g, "\\'")}', this.checked)" />
                <div class="alert-color-box" 
                     style="background: ${state.customColors[type] || DEFAULT_COLORS[type]};" 
                     onclick="openColorPicker('${type.replace(/'/g, "\\'")}', event)"></div>
                <label class="alert-filter-label" for="filter_${safeId}">${type}</label>
            </div>
        `;
    }).join('');
}

function toggleAlertFilter(type, checked) {
    if (!checked) {
        state.alertFilters.add(type);
    } else {
        state.alertFilters.delete(type);
    }
    loadAlerts();
}

function openColorPicker(alertType, event) {
    event.stopPropagation();
    
    const popup = document.getElementById('colorPickerPopup');
    const picker = document.getElementById('colorPicker');
    const presets = document.getElementById('colorPresets');
    
    picker.value = state.customColors[alertType] || DEFAULT_COLORS[alertType];
    
    presets.innerHTML = COLOR_PRESETS.map(color => 
        `<div class="color-preset" 
              style="background: ${color};" 
              onclick="setAlertColor('${alertType.replace(/'/g, "\\'")}', '${color}')"></div>`
    ).join('');
    
    popup.style.display = 'block';
    popup.style.left = (event.pageX + 10) + 'px';
    popup.style.top = event.pageY + 'px';
    
    picker.onchange = () => setAlertColor(alertType, picker.value);
    
    // Close on click outside
    setTimeout(() => {
        const closeHandler = (e) => {
            if (!popup.contains(e.target)) {
                popup.style.display = 'none';
                document.removeEventListener('click', closeHandler);
            }
        };
        document.addEventListener('click', closeHandler);
    }, 100);
}

function setAlertColor(alertType, color) {
    state.customColors[alertType] = color;
    initAlertFilters();
    updateAlertPolygons();
    showToast(`Color updated for ${alertType}`, 'success');
}

// ================================
//  WEATHER DATA
// ================================
async function loadWeatherForLocation(lat, lng) {
    try {
        showLoading(true);
        console.log(`🔄 Loading weather for ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        
        // Check cache
        const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
        const cached = state.weatherCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < 300000)) {
            displayWeatherData(cached.data, lat, lng, 'tomorrow');
            showLoading(false);
            return;
        }
        
        // Try Tomorrow.io first
        try {
            const res = await fetch(
                `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lng}&apikey=${TOMORROW_API_KEY}&units=imperial`
            );
            
            if (res.ok) {
                const data = await res.json();
                state.weatherCache.set(cacheKey, { data, timestamp: Date.now() });
                displayWeatherData(data, lat, lng, 'tomorrow');
                showLoading(false);
                return;
            }
        } catch (error) {
            console.warn('Tomorrow.io unavailable, trying Open-Meteo');
        }
        
        // Fallback to Open-Meteo
        if (state.useOpenMeteo) {
            const meteoRes = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,cloud_cover&hourly=temperature_2m,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=7`
            );
            const meteoData = await meteoRes.json();
            state.weatherCache.set(cacheKey, { data: meteoData, timestamp: Date.now() });
            displayWeatherData(meteoData, lat, lng, 'openmeteo');
        }
        
        document.getElementById('weatherPanel').classList.remove('hidden');
        showLoading(false);
        
    } catch (error) {
        console.error('❌ Error loading weather:', error);
        showToast('Error loading weather data', 'error');
        showLoading(false);
    }
}

function displayWeatherData(data, lat, lng, source) {
    const content = document.getElementById('weatherContent');
    
    if (source === 'tomorrow') {
        const current = data.timelines.minutely[0].values;
        
        content.innerHTML = `
            <div style="margin-bottom: 15px;">
                <div style="font-size: 14px; color: #4ade80; font-weight: 700;">
                    📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}
                </div>
            </div>
            
            <div class="current-weather">
                <div class="weather-icon-large">${getWeatherIcon(current.weatherCode)}</div>
                <div>
                    <div class="temp-large">${Math.round(current.temperature)}°F</div>
                    <div style="color: #999; font-size: 14px;">Feels like ${Math.round(current.temperatureApparent)}°F</div>
                    <div style="color: #ccc; font-size: 16px; margin-top: 5px; font-weight: 600;">
                        ${getConditionsText(current.weatherCode)}
                    </div>
                </div>
            </div>
            
            <div class="weather-details-grid">
                <div class="detail-item">
                    <div class="detail-label">💧 Humidity</div>
                    <div class="detail-value">${Math.round(current.humidity)}%</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">💨 Wind</div>
                    <div class="detail-value">${Math.round(current.windSpeed)} mph</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">🎚️ Pressure</div>
                    <div class="detail-value">${Math.round(current.pressureSeaLevel)} mb</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">👁️ Visibility</div>
                    <div class="detail-value">${Math.round(current.visibility)} mi</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">☁️ Cloud Cover</div>
                    <div class="detail-value">${Math.round(current.cloudCover)}%</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">🌧️ Precipitation</div>
                    <div class="detail-value">${current.precipitationIntensity ? current.precipitationIntensity.toFixed(2) : '0'} in</div>
                </div>
            </div>
            
            <div style="margin-top: 15px; font-size: 11px; color: #666; text-align: center;">
                Data: Tomorrow.io
            </div>
        `;
        
    } else if (source === 'openmeteo') {
        const current = data.current;
        
        content.innerHTML = `
            <div style="margin-bottom: 15px;">
                <div style="font-size: 14px; color: #4ade80; font-weight: 700;">
                    📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}
                </div>
            </div>
            
            <div class="current-weather">
                <div class="weather-icon-large">${getWeatherIcon(current.weather_code)}</div>
                <div>
                    <div class="temp-large">${Math.round(current.temperature_2m)}°F</div>
                    <div style="color: #999; font-size: 14px;">Feels like ${Math.round(current.apparent_temperature)}°F</div>
                    <div style="color: #ccc; font-size: 16px; margin-top: 5px; font-weight: 600;">
                        ${getOpenMeteoConditions(current.weather_code)}
                    </div>
                </div>
            </div>
            
            <div class="weather-details-grid">
                <div class="detail-item">
                    <div class="detail-label">💧 Humidity</div>
                    <div class="detail-value">${Math.round(current.relative_humidity_2m)}%</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">💨 Wind</div>
                    <div class="detail-value">${Math.round(current.wind_speed_10m)} mph</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">🧭 Direction</div>
                    <div class="detail-value">${Math.round(current.wind_direction_10m)}°</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">🎚️ Pressure</div>
                    <div class="detail-value">${Math.round(current.pressure_msl)} mb</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">☁️ Cloud Cover</div>
                    <div class="detail-value">${Math.round(current.cloud_cover)}%</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">🌧️ Precipitation</div>
                    <div class="detail-value">${current.precipitation || 0} in</div>
                </div>
            </div>
            
            <div style="margin-top: 15px; font-size: 11px; color: #666; text-align: center;">
                Data: Open-Meteo
            </div>
        `;
    }
    
    reverseGeocode(lat, lng);
}

function getWeatherIcon(code) {
    const icons = {
        0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
        45: '🌫️', 48: '🌫️',
        51: '🌦️', 53: '🌦️', 55: '🌧️',
        56: '🌧️', 57: '🌧️',
        61: '🌧️', 63: '🌧️', 65: '🌧️',
        66: '🌧️', 67: '🌧️',
        71: '🌨️', 73: '🌨️', 75: '🌨️', 77: '🌨️',
        80: '🌦️', 81: '🌧️', 82: '🌧️',
        85: '🌨️', 86: '🌨️',
        95: '⛈️', 96: '⛈️', 99: '⛈️',
        // Tomorrow.io codes
        1000: '☀️', 1100: '🌤️', 1101: '⛅', 1102: '☁️', 1001: '☁️',
        2000: '🌫️', 2100: '🌫️',
        4000: '🌦️', 4001: '🌧️', 4200: '🌦️', 4201: '🌧️',
        5000: '🌨️', 5001: '🌨️', 5100: '🌨️', 5101: '🌨️',
        6000: '🧊', 6001: '🧊', 6200: '🧊', 6201: '🧊',
        7000: '🧊', 7101: '🧊', 7102: '🧊',
        8000: '⛈️'
    };
    return icons[code] || '🌡️';
}

function getConditionsText(code) {
    const conditions = {
        0: 'Unknown', 1000: 'Clear', 1100: 'Mostly Clear',
        1101: 'Partly Cloudy', 1102: 'Mostly Cloudy', 1001: 'Cloudy',
        2000: 'Fog', 2100: 'Light Fog',
        4000: 'Drizzle', 4001: 'Rain', 4200: 'Light Rain', 4201: 'Heavy Rain',
        5000: 'Snow', 5001: 'Flurries', 5100: 'Light Snow', 5101: 'Heavy Snow',
        6000: 'Freezing Drizzle', 6001: 'Freezing Rain',
        6200: 'Light Freezing Rain', 6201: 'Heavy Freezing Rain',
        7000: 'Ice Pellets', 7101: 'Heavy Ice Pellets', 7102: 'Light Ice Pellets',
        8000: 'Thunderstorm'
    };
    return conditions[code] || 'Unknown';
}

function getOpenMeteoConditions(code) {
    const conditions = {
        0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
        45: 'Fog', 48: 'Depositing rime fog',
        51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
        56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
        61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
        66: 'Light freezing rain', 67: 'Heavy freezing rain',
        71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
        80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
        85: 'Slight snow showers', 86: 'Heavy snow showers',
        95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail'
    };
    return conditions[code] || 'Unknown';
}

// ================================
//  GEOLOCATION
// ================================
function getMyLocation() {
    if (!navigator.geolocation) {
        showToast('Geolocation not supported', 'error');
        return;
    }
    
    showLoading(true);
    showToast('Getting your location...', 'info');
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            state.currentLat = lat;
            state.currentLng = lng;
            
            state.map.flyTo({ center: [lng, lat], zoom: 10, duration: 2000 });
            
            await loadWeatherForLocation(lat, lng);
            await reverseGeocode(lat, lng);
            
            showToast('Location found!', 'success');
            showLoading(false);
        },
        (error) => {
            console.error('Geolocation error:', error);
            showToast('Unable to get your location', 'error');
            showLoading(false);
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_KEY}`
        );
        const data = await res.json();
        
        if (data.features && data.features.length > 0) {
            const placeName = data.features[0].place_name.split(',')[0];
            document.getElementById('locationDisplay').textContent = placeName;
        }
    } catch (error) {
        console.error('Geocoding error:', error);
    }
}

// ================================
//  SETTINGS FUNCTIONS
// ================================
function updateOpacity(value) {
    state.radarOpacity = value / 100;
    document.getElementById('opacityValue').textContent = value + '%';
    state.radarCanvas.style.opacity = state.radarOpacity;
    drawFrame(state.currentFrame);
}

function updateSpeed(value) {
    state.animationSpeed = parseInt(value);
    if (state.isPlaying) {
        togglePlay();
        togglePlay();
    }
}

function toggleSmooth(checked) {
    state.smoothInterpolation = checked;
    showToast(checked ? 'Smooth transitions enabled' : 'Smooth transitions disabled', 'info');
}

function toggle3D(checked) {
    state.show3DRadar = checked;
    // 3D radar implementation would go here
    showToast(checked ? '3D radar enabled' : '3D radar disabled', 'info');
}

function setRadarSource(source) {
    state.radarSource = source;
    
    document.querySelectorAll('.radar-source-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(source + 'Btn').classList.add('active');
    
    loadRadarFrames();
    showToast(`Switched to ${source.toUpperCase()} radar`, 'success');
}

// ================================
//  UI FUNCTIONS
// ================================
function toggleSettings() {
    document.getElementById('settingsModal').classList.toggle('hidden');
}

function toggleAlerts() {
    document.getElementById('alertsPanel').classList.toggle('hidden');
}

function toggleWeatherPanel() {
    document.getElementById('weatherPanel').classList.toggle('hidden');
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast';
    
    if (type === 'error') {
        toast.style.borderColor = '#ef4444';
        toast.style.background = 'rgba(239, 68, 68, 0.12)';
    } else if (type === 'success') {
        toast.style.borderColor = '#4ade80';
        toast.style.background = 'rgba(74, 222, 128, 0.12)';
    } else {
        toast.style.borderColor = '#60a5fa';
        toast.style.background = 'rgba(96, 165, 250, 0.12)';
    }
    
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

function showLoading(show) {
    document.getElementById('loadingSpinner').classList.toggle('hidden', !show);
}

// ================================
//  EVENT LISTENERS
// ================================
function initEventListeners() {
    // Time slider
    document.getElementById('timeSlider').addEventListener('input', (e) => {
        onTimeSliderChange(e.target.value);
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ignore if typing in input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        switch(e.key.toLowerCase()) {
            case ' ':
                e.preventDefault();
                togglePlay();
                break;
            case 's':
                toggleSettings();
                break;
            case 'w':
                toggleAlerts();
                break;
            case 'l':
                getMyLocation();
                break;
            case 'escape':
                document.querySelectorAll('.modal:not(.hidden)').forEach(modal => {
                    modal.classList.add('hidden');
                });
                document.getElementById('alertsPanel').classList.add('hidden');
                document.getElementById('weatherPanel').classList.add('hidden');
                break;
            case 'arrowleft':
                e.preventDefault();
                if (state.isPlaying) togglePlay();
                state.currentFrame = Math.max(0, state.currentFrame - 1);
                document.getElementById('timeSlider').value = state.currentFrame;
                displayRadarFrame(state.currentFrame);
                break;
            case 'arrowright':
                e.preventDefault();
                if (state.isPlaying) togglePlay();
                state.currentFrame = Math.min(state.radarFrames.length - 1, state.currentFrame + 1);
                document.getElementById('timeSlider').value = state.currentFrame;
                displayRadarFrame(state.currentFrame);
                break;
        }
    });
    
    // Close modals on background click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    });
}

// ================================
//  START APPLICATION
// ================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

console.log('✅ Storm Surge Weather Enhanced v6.0 loaded');