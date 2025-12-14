// ========================================
//  STORM SURGE WEATHER - ULTIMATE EDITION
//  Version 5.0 - Tomorrow.io API + 3D Radar
// ========================================

// ================================
//  API KEYS & CONFIG
// ================================
const MAPBOX_KEY = "pk.eyJ1Ijoic3Rvcm0tc3VyZ2UiLCJhIjoiY21pcDM0emdxMDhwYzNmcHc2aTlqeTN5OSJ9.QYtnuhdixR4SGxLQldE9PA";
const TOMORROW_API_KEY = "SxfCeG33LbiKBLlR5iEegtxw5aXnZEOr";
const FEEDBACK_EMAIL = "stormsurgee025@gmail.com";

// State management
let state = {
    currentLat: 39.8283,
    currentLng: -98.5795,
    currentRadarLayer: 'precipitation',
    radarMode: '2d',
    isAnimating: false,
    animationInterval: null,
    currentTimeIndex: 0,
    radarTimes: [],
    animationSpeed: 500,
    radarFrames: [],
    radarOpacity: 0.7,
    
    // Map style
    mapStyle: 'dark', // 'dark' or 'satellite'
    
    // Warning filters
    warningCountryFilter: 'all',
    
    // Feature toggles
    showPolygons: true,
    show3DRadar: false,
    
    // Warnings
    activeWarnings: [],
    selectedWarning: null,
    
    // 3D Scene
    scene3D: null,
    camera3D: null,
    renderer3D: null,
    controls3D: null,
    radarMesh3D: null,
    
    // Click marker
    clickMarkerTimeout: null,
    
    // Tomorrow.io data
    tomorrowData: null
};

const weatherText = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    56: "Light freezing drizzle", 57: "Dense freezing drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    66: "Light freezing rain", 67: "Heavy freezing rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
    85: "Slight snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail"
};

const warningColors = {
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
    'Gale Warning': '#DDA0DD',
    'Storm Warning': '#9400D3',
    'Hurricane Warning': '#DC143C',
    'Hurricane Watch': '#FF1493',
    'Tropical Storm Warning': '#B22222',
    'Tropical Storm Watch': '#FF6347',
    'Dense Fog Advisory': '#708090',
    'Special Weather Statement': '#FFE4B5',
    'Heat Advisory': '#FF7F50',
    'Excessive Heat Warning': '#C71585',
    'Extreme Heat Warning': '#8B0000',
    'Fire Weather Watch': '#FFD700',
    'Red Flag Warning': '#FF1493',
    'Dust Storm Warning': '#CD853F',
    'Tsunami Warning': '#00008B',
    'Avalanche Warning': '#4169E1'
};

mapboxgl.accessToken = MAPBOX_KEY;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [state.currentLng, state.currentLat],
    zoom: 4,
    minZoom: 2,
    maxZoom: 12
});

// ================================
//  3D RADAR SETUP (THREE.JS)
// ================================
function init3DRadar() {
    const container = document.getElementById('radar3DContainer');
    
    if (!container || state.scene3D) return;
    
    container.classList.remove('hidden');
    
    // Create scene
    state.scene3D = new THREE.Scene();
    state.scene3D.background = new THREE.Color(0x0a0a0f);
    
    // Create camera
    state.camera3D = new THREE.PerspectiveCamera(
        60,
        container.clientWidth / container.clientHeight,
        0.1,
        2000
    );
    state.camera3D.position.set(150, 100, 150);
    state.camera3D.lookAt(0, 0, 0);
    
    // Create renderer
    state.renderer3D = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    state.renderer3D.setSize(container.clientWidth, container.clientHeight);
    state.renderer3D.setPixelRatio(window.devicePixelRatio);
    container.appendChild(state.renderer3D.domElement);
    
    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    state.scene3D.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    state.scene3D.add(directionalLight);
    
    const pointLight = new THREE.PointLight(0x4ade80, 1, 300);
    pointLight.position.set(0, 50, 0);
    state.scene3D.add(pointLight);
    
    // Add grid
    const gridHelper = new THREE.GridHelper(300, 30, 0x4ade80, 0x1a1a1f);
    state.scene3D.add(gridHelper);
    
    // Add axes
    const axesHelper = new THREE.AxesHelper(80);
    state.scene3D.add(axesHelper);
    
    // Create 3D radar volume
    create3DRadarVolume();
    
    console.log('✅ 3D Radar initialized');
    
    // Start animation
    animate3D();
}

function create3DRadarVolume() {
    if (!state.scene3D) return;
    
    // Remove existing radar
    if (state.radarMesh3D) {
        state.scene3D.remove(state.radarMesh3D);
    }
    
    // Create multiple layers for 3D effect
    const layers = 15;
    const group = new THREE.Group();
    
    for (let i = 0; i < layers; i++) {
        const height = i * 5;
        const size = 120 - (i * 2);
        const opacity = 0.6 - (i * 0.03);
        
        const geometry = new THREE.BoxGeometry(size, 3, size);
        const material = new THREE.MeshPhongMaterial({
            color: getRadarColorForHeight(height),
            transparent: true,
            opacity: opacity,
            wireframe: false
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = height;
        group.add(mesh);
    }
    
    state.radarMesh3D = group;
    state.scene3D.add(group);
    
    // Add particles
    createRadarParticles();
}

function getRadarColorForHeight(height) {
    if (height < 15) return 0x4ade80; // Green - light rain
    if (height < 30) return 0xfbbf24; // Yellow - moderate
    if (height < 45) return 0xf97316; // Orange - heavy
    if (height < 60) return 0xef4444; // Red - severe
    return 0xdc2626; // Dark red - extreme
}

function createRadarParticles() {
    if (!state.scene3D) return;
    
    const particleCount = 3000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
        const i3 = i * 3;
        
        // Position
        positions[i3] = (Math.random() - 0.5) * 150;
        positions[i3 + 1] = Math.random() * 80;
        positions[i3 + 2] = (Math.random() - 0.5) * 150;
        
        // Color based on height
        const height = positions[i3 + 1];
        if (height < 20) {
            colors[i3] = 0.29; colors[i3 + 1] = 0.87; colors[i3 + 2] = 0.5; // Green
        } else if (height < 40) {
            colors[i3] = 0.98; colors[i3 + 1] = 0.75; colors[i3 + 2] = 0.14; // Yellow
        } else if (height < 60) {
            colors[i3] = 0.98; colors[i3 + 1] = 0.45; colors[i3 + 2] = 0.09; // Orange
        } else {
            colors[i3] = 0.94; colors[i3 + 1] = 0.27; colors[i3 + 2] = 0.27; // Red
        }
        
        sizes[i] = Math.random() * 3 + 1;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const material = new THREE.PointsMaterial({
        size: 2,
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        sizeAttenuation: true
    });
    
    const particles = new THREE.Points(geometry, material);
    particles.name = 'radarParticles';
    state.scene3D.add(particles);
}

function animate3D() {
    if (!state.renderer3D || !state.scene3D || !state.camera3D) return;
    
    requestAnimationFrame(animate3D);
    
    // Rotate radar volume
    if (state.radarMesh3D) {
        state.radarMesh3D.rotation.y += 0.005;
    }
    
    // Animate particles
    const particles = state.scene3D.getObjectByName('radarParticles');
    if (particles) {
        particles.rotation.y += 0.002;
        const positions = particles.geometry.attributes.position.array;
        for (let i = 1; i < positions.length; i += 3) {
            positions[i] -= 0.3; // Fall down
            if (positions[i] < 0) positions[i] = 80; // Reset to top
        }
        particles.geometry.attributes.position.needsUpdate = true;
    }
    
    // Rotate camera around scene
    const time = Date.now() * 0.0001;
    state.camera3D.position.x = Math.cos(time) * 150;
    state.camera3D.position.z = Math.sin(time) * 150;
    state.camera3D.lookAt(0, 20, 0);
    
    state.renderer3D.render(state.scene3D, state.camera3D);
}

function toggle3DRadar() {
    state.show3DRadar = !state.show3DRadar;
    const container = document.getElementById('radar3DContainer');
    const toggle = document.getElementById('radar3DToggle');
    
    if (state.show3DRadar) {
        if (!state.scene3D) {
            init3DRadar();
        } else {
            container.classList.remove('hidden');
        }
        toggle.checked = true;
        showToast('3D Radar Enabled', 'success');
    } else {
        container.classList.add('hidden');
        toggle.checked = false;
        showToast('3D Radar Disabled', 'info');
    }
}

// ================================
//  RADAR FUNCTIONS - RAINVIEWER
// ================================
async function loadRadarFrames() {
    try {
        console.log('🔄 Loading radar frames...');
        const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await response.json();
        
        if (data && data.radar && data.radar.past) {
            state.radarFrames = data.radar.past;
            state.radarTimes = state.radarFrames.map(frame => new Date(frame.time * 1000));
            state.currentTimeIndex = state.radarFrames.length - 1;
            console.log(`✅ Loaded ${state.radarFrames.length} frames`);
            await displayRadarFrame(state.currentTimeIndex);
            updateTimeDisplay();
            return true;
        }
        throw new Error('No radar data');
    } catch (error) {
        console.error('❌ Error loading radar:', error);
        showToast('Unable to load radar data', 'error');
        return false;
    }
}

async function displayRadarFrame(frameIndex) {
    try {
        if (!state.radarFrames[frameIndex]) return;
        const frame = state.radarFrames[frameIndex];
        const tileURL = `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/6/1_1.png`;
        
        if (map.getLayer('radar-layer')) map.removeLayer('radar-layer');
        if (map.getSource('radar-source')) map.removeSource('radar-source');
        
        map.addSource('radar-source', {
            type: 'raster',
            tiles: [tileURL],
            tileSize: 256,
            maxzoom: 12
        });
        
        map.addLayer({
            id: 'radar-layer',
            type: 'raster',
            source: 'radar-source',
            paint: {
                'raster-opacity': state.radarOpacity,
                'raster-fade-duration': 0
            }
        });
        
        if (map.getLayer('warning-fills')) {
            map.moveLayer('radar-layer', 'warning-fills');
        }
    } catch (error) {
        console.error('Error displaying radar frame:', error);
    }
}

function updateTimeDisplay() {
    const timeIndex = state.currentTimeIndex;
    const slider = document.getElementById('timeSlider');
    if (slider) {
        slider.value = timeIndex;
        slider.max = state.radarFrames.length - 1;
    }
    
    if (timeIndex === state.radarFrames.length - 1) {
        document.getElementById('currentTime').textContent = 'Now';
        document.getElementById('timeMode').textContent = 'LIVE';
        document.getElementById('timeMode').style.background = 'rgba(74, 222, 128, 0.2)';
        document.getElementById('timeMode').style.color = '#4ade80';
    } else {
        const time = state.radarTimes[timeIndex];
        const timeStr = time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const minutesAgo = Math.round((Date.now() - time.getTime()) / 60000);
        document.getElementById('currentTime').textContent = timeStr;
        document.getElementById('timeMode').textContent = `${minutesAgo}m ago`;
        document.getElementById('timeMode').style.background = 'rgba(251, 146, 60, 0.2)';
        document.getElementById('timeMode').style.color = '#fb923c';
    }
}

function startAnimation() {
    if (state.animationInterval) clearInterval(state.animationInterval);
    state.animationInterval = setInterval(() => {
        state.currentTimeIndex = (state.currentTimeIndex + 1) % state.radarFrames.length;
        displayRadarFrame(state.currentTimeIndex);
        updateTimeDisplay();
    }, state.animationSpeed);
    state.isAnimating = true;
    document.getElementById('playPauseBtn').textContent = '⏸️';
}

function stopAnimation() {
    if (state.animationInterval) {
        clearInterval(state.animationInterval);
        state.animationInterval = null;
    }
    state.isAnimating = false;
    document.getElementById('playPauseBtn').textContent = '▶️';
}

// ================================
//  WEATHER ALERTS - NWS API
// ================================
async function loadWeatherAlerts() {
    try {
        console.log('🔄 Loading alerts...');
        
        let urls = [];
        
        if (state.warningCountryFilter === 'all') {
            urls = [
                'https://api.weather.gov/alerts/active?status=actual&message_type=alert',
                'https://api.weather.gov/alerts/active?area=CA&status=actual&message_type=alert'
            ];
        } else if (state.warningCountryFilter === 'us') {
            urls = ['https://api.weather.gov/alerts/active?area=US&status=actual&message_type=alert'];
        } else if (state.warningCountryFilter === 'canada') {
            urls = ['https://api.weather.gov/alerts/active?area=CA&status=actual&message_type=alert'];
        } else if (state.warningCountryFilter === 'mexico') {
            urls = ['https://api.weather.gov/alerts/active?area=MX&status=actual&message_type=alert'];
        } else if (state.warningCountryFilter === 'caribbean') {
            urls = ['https://api.weather.gov/alerts/active?area=PR&status=actual&message_type=alert'];
        }
        
        let allWarnings = [];
        
        for (const url of urls) {
            try {
                const response = await fetch(url, {
                    headers: { 'User-Agent': '(StormSurgeWeather, contact@stormsurge.app)' }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.features) {
                        allWarnings = allWarnings.concat(data.features);
                    }
                }
            } catch (err) {
                console.warn('Error fetching from:', url, err);
            }
        }
        
        state.activeWarnings = allWarnings.filter(f => f.properties && f.properties.event);
        console.log(`✅ Loaded ${state.activeWarnings.length} warnings`);
        updateWarningsList();
        displayWarningPolygons();
        updateAlertBadge();
    } catch (error) {
        console.error('❌ Error loading alerts:', error);
        state.activeWarnings = [];
        updateWarningsList();
        updateAlertBadge();
    }
}

function updateWarningsList() {
    const content = document.getElementById('warningsContent');
    const count = document.getElementById('alertCount');
    count.textContent = state.activeWarnings.length;
    
    if (state.activeWarnings.length === 0) {
        content.innerHTML = '<div style="text-align: center; color: #4ade80; padding: 30px;"><div style="font-size: 48px;">✓</div><div style="font-weight: 600; margin-top: 10px;">No Active Alerts</div><div style="font-size: 12px; color: #999; margin-top: 5px;">All clear</div></div>';
        return;
    }
    
    content.innerHTML = state.activeWarnings.map(w => {
        const props = w.properties;
        const color = warningColors[props.event] || '#999';
        const expires = formatTimeRemaining(props.expires);
        const severity = props.severity || 'Unknown';
        return `
            <div class="warning-item" style="border-left-color: ${color};" onclick="showWarningDetail('${props.id}')">
                <div class="warning-header-row">
                    <div class="warning-type">${props.event}</div>
                    <div class="warning-severity-badge ${severity.toLowerCase()}">${severity}</div>
                </div>
                <div class="warning-area">${props.areaDesc ? props.areaDesc.split(';')[0] : 'N/A'}</div>
                <div class="warning-expires">⏱️ ${expires}</div>
            </div>
        `;
    }).join('');
}

function displayWarningPolygons() {
    if (map.getLayer('warning-fills')) map.removeLayer('warning-fills');
    if (map.getLayer('warning-lines')) map.removeLayer('warning-lines');
    if (map.getSource('warnings-source')) map.removeSource('warnings-source');
    
    if (!state.showPolygons) {
        console.log('⚠️ Warning polygons disabled');
        return;
    }
    
    const validWarnings = state.activeWarnings.filter(w => w.geometry);
    if (validWarnings.length === 0) {
        console.log('No warning polygons to display');
        return;
    }
    
    console.log(`📍 Displaying ${validWarnings.length} warning polygons`);
    
    const geojson = {
        type: 'FeatureCollection',
        features: validWarnings.map(w => ({
            type: 'Feature',
            geometry: w.geometry,
            properties: { id: w.properties.id, event: w.properties.event }
        }))
    };
    
    map.addSource('warnings-source', { type: 'geojson', data: geojson });
    
    // Create color expression for all warning types
    const colorExpression = ['match', ['get', 'event']];
    Object.keys(warningColors).forEach(type => {
        colorExpression.push(type, warningColors[type]);
    });
    colorExpression.push('#999999'); // Default color
    
    map.addLayer({
        id: 'warning-fills',
        type: 'fill',
        source: 'warnings-source',
        paint: {
            'fill-color': colorExpression,
            'fill-opacity': 0.35
        }
    });
    
    map.addLayer({
        id: 'warning-lines',
        type: 'line',
        source: 'warnings-source',
        paint: {
            'line-color': colorExpression,
            'line-width': 2.5,
            'line-opacity': 0.9
        }
    });
    
    map.on('click', 'warning-fills', (e) => {
        if (e.features.length > 0) showWarningDetail(e.features[0].properties.id);
    });
    
    map.on('mouseenter', 'warning-fills', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'warning-fills', () => { map.getCanvas().style.cursor = ''; });
    
    console.log('✅ Color-coded warning polygons displayed');
}

function showWarningDetail(warningId) {
    const warning = state.activeWarnings.find(w => w.properties.id === warningId);
    if (!warning) return;
    
    const props = warning.properties;
    const color = warningColors[props.event] || '#999';
    state.selectedWarning = warning;
    
    const modal = document.getElementById('warningModal');
    const header = document.getElementById('warningModalHeader');
    header.style.background = color;
    
    document.getElementById('warningModalTitle').textContent = props.event;
    document.getElementById('warningIssued').textContent = new Date(props.onset || props.sent).toLocaleString();
    document.getElementById('warningExpires').textContent = new Date(props.expires).toLocaleString();
    document.getElementById('warningSeverity').textContent = props.severity || 'N/A';
    document.getElementById('warningUrgency').textContent = props.urgency || 'N/A';
    document.getElementById('warningSource').textContent = props.senderName || 'NWS';
    document.getElementById('warningDescription').textContent = props.description || props.headline || 'No description';
    document.getElementById('warningAreas').textContent = props.areaDesc || 'N/A';
    
    modal.classList.remove('hidden');
}

function updateAlertBadge() {
    const badge = document.getElementById('alertBadge');
    const count = state.activeWarnings.length;
    if (count > 0) {
        badge.textContent = count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function formatTimeRemaining(expiresISO) {
    const diff = new Date(expiresISO) - new Date();
    if (diff < 0) return 'Expired';
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    if (hours > 24) return `${Math.floor(hours / 24)}d`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// ================================
//  TOMORROW.IO WEATHER API
// ================================
async function getTomorrowWeatherData(lat, lng) {
    try {
        const url = `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lng}&apikey=${TOMORROW_API_KEY}&units=imperial`;
        
        console.log('🔄 Fetching Tomorrow.io data...');
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Tomorrow.io API error: ${response.status}`);
        }
        
        const data = await response.json();
        state.tomorrowData = data;
        console.log('✅ Tomorrow.io data loaded');
        return data;
    } catch (error) {
        console.error('❌ Error fetching Tomorrow.io data:', error);
        showToast('Using backup weather API', 'info');
        return await getWeatherDataBackup(lat, lng);
    }
}

async function getWeatherDataBackup(lat, lng) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover,pressure_msl,visibility&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=7`;
        const response = await fetch(url);
        return await response.json();
    } catch (error) {
        console.error('Backup API error:', error);
        return null;
    }
}

async function updateWeatherPanel(lat, lng) {
    const data = await getTomorrowWeatherData(lat, lng);
    
    if (!data) {
        showToast('Unable to load weather data', 'error');
        return;
    }
    
    // Check if we got Tomorrow.io data or backup
    if (data.timelines) {
        displayTomorrowData(data, lat, lng);
    } else {
        displayBackupData(data, lat, lng);
    }
}

async function displayTomorrowData(data, lat, lng) {
    const current = data.timelines.minutely[0].values;
    const hourly = data.timelines.hourly;
    const daily = data.timelines.daily;
    
    const locationName = await reverseGeocode(lat, lng);
    document.getElementById('panelLocationAddress').textContent = locationName;
    document.getElementById('panelLocationCoords').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    
    const localWarnings = await fetchWeatherAlertsForLocation(lat, lng);
    const warningsSection = document.getElementById('panelWarningsSection');
    const warningsList = document.getElementById('panelWarningsList');
    
    if (localWarnings.length > 0) {
        warningsSection.classList.remove('hidden');
        warningsList.innerHTML = localWarnings.map(w => 
            `<div class="panel-warning-item" onclick="showWarningDetail('${w.properties.id}')">${w.properties.event}</div>`
        ).join('');
    } else {
        warningsSection.classList.add('hidden');
    }
    
    document.getElementById('panelCurrentTemp').textContent = `${Math.round(current.temperature)}°F`;
    document.getElementById('panelFeelsLike').textContent = `Feels like ${Math.round(current.temperatureApparent)}°F`;
    document.getElementById('panelConditions').textContent = getConditionsFromCode(current.weatherCode);
    document.getElementById('panelWeatherIcon').textContent = getWeatherIconFromCode(current.weatherCode);
    
    const precipType = getPrecipType(current.precipitationType);
    const precipTypeElement = document.getElementById('panelPrecipType');
    if (precipType) {
        precipTypeElement.textContent = `${precipType.icon} ${precipType.type}`;
        precipTypeElement.style.color = precipType.color;
    } else {
        precipTypeElement.textContent = '';
    }
    
    const dewPoint = calculateDewPoint(current.temperature, current.humidity);
    
    document.getElementById('panelHumidity').textContent = `${Math.round(current.humidity)}%`;
    document.getElementById('panelWindSpeed').textContent = `${Math.round(current.windSpeed)} mph`;
    document.getElementById('panelWindDirection').textContent = getWindDirection(current.windDirection);
    document.getElementById('panelPressure').textContent = `${Math.round(current.pressureSeaLevel)} mb`;
    document.getElementById('panelVisibility').textContent = `${Math.round(current.visibility)} mi`;
    document.getElementById('panelDewPoint').textContent = `${Math.round(dewPoint)}°F`;
    document.getElementById('panelCloudCover').textContent = `${Math.round(current.cloudCover)}%`;
    document.getElementById('panelPrecipitation').textContent = current.precipitationIntensity ? `${current.precipitationIntensity.toFixed(2)} in` : '0 in';
    
    const hourlyContainer = document.getElementById('panelHourlyData');
    hourlyContainer.innerHTML = '';
    for (let i = 0; i < 24 && i < hourly.length; i++) {
        const hour = hourly[i];
        const time = new Date(hour.time);
        const timeStr = time.getHours().toString().padStart(2, '0') + ':00';
        const icon = getWeatherIconFromCode(hour.values.weatherCode);
        const hourlyItem = document.createElement('div');
        hourlyItem.className = 'hourly-item-detailed';
        hourlyItem.innerHTML = `
            <div class="hourly-time-detailed">${timeStr}</div>
            <div class="hourly-icon-detailed">${icon}</div>
            <div class="hourly-temp-detailed">${Math.round(hour.values.temperature)}°F</div>
            <div class="hourly-wind-detailed">💨 ${Math.round(hour.values.windSpeed)} mph</div>
        `;
        hourlyContainer.appendChild(hourlyItem);
    }
    
    const dailyContainer = document.getElementById('panelDailyData');
    dailyContainer.innerHTML = '';
    for (let i = 0; i < 7 && i < daily.length; i++) {
        const day = daily[i];
        const date = new Date(day.time);
        const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const icon = getWeatherIconFromCode(day.values.weatherCode);
        const precipProb = day.values.precipitationProbabilityAvg || 0;
        const dailyItem = document.createElement('div');
        dailyItem.className = 'daily-item-detailed';
        dailyItem.innerHTML = `
            <div class="daily-date-detailed">${dateStr}</div>
            <div class="daily-icon-detailed">${icon}</div>
            <div class="daily-temps-detailed">
                <span class="temp-high">${Math.round(day.values.temperatureMax)}°</span>
                <span class="temp-low">${Math.round(day.values.temperatureMin)}°</span>
            </div>
            <div class="daily-precip-detailed">💧 ${Math.round(precipProb)}%</div>
        `;
        dailyContainer.appendChild(dailyItem);
    }
    
    document.getElementById('weatherPanel').classList.remove('hidden');
    console.log('✅ Weather panel updated with Tomorrow.io data');
}

async function displayBackupData(data, lat, lng) {
    const current = data.current;
    const hourly = data.hourly;
    const daily = data.daily;
    
    const locationName = await reverseGeocode(lat, lng);
    document.getElementById('panelLocationAddress').textContent = locationName;
    document.getElementById('panelLocationCoords').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    
    const localWarnings = await fetchWeatherAlertsForLocation(lat, lng);
    const warningsSection = document.getElementById('panelWarningsSection');
    const warningsList = document.getElementById('panelWarningsList');
    
    if (localWarnings.length > 0) {
        warningsSection.classList.remove('hidden');
        warningsList.innerHTML = localWarnings.map(w => 
            `<div class="panel-warning-item" onclick="showWarningDetail('${w.properties.id}')">${w.properties.event}</div>`
        ).join('');
    } else {
        warningsSection.classList.add('hidden');
    }
    
    document.getElementById('panelCurrentTemp').textContent = `${Math.round(current.temperature_2m)}°F`;
    document.getElementById('panelFeelsLike').textContent = `Feels like ${Math.round(current.apparent_temperature)}°F`;
    document.getElementById('panelConditions').textContent = weatherText[current.weather_code] || 'Unknown';
    document.getElementById('panelWeatherIcon').textContent = getWeatherIcon(current.weather_code);
    
    const precipType = classifyPrecipitationType(current.temperature_2m, current.weather_code);
    const precipTypeElement = document.getElementById('panelPrecipType');
    if (precipType) {
        precipTypeElement.textContent = `${precipType.icon} ${precipType.type}`;
        precipTypeElement.style.color = precipType.color;
    } else {
        precipTypeElement.textContent = '';
    }
    
    const dewPoint = calculateDewPoint(current.temperature_2m, current.relative_humidity_2m);
    
    document.getElementById('panelHumidity').textContent = `${current.relative_humidity_2m}%`;
    document.getElementById('panelWindSpeed').textContent = `${Math.round(current.wind_speed_10m)} mph`;
    document.getElementById('panelWindDirection').textContent = getWindDirection(current.wind_direction_10m);
    document.getElementById('panelPressure').textContent = `${Math.round(current.pressure_msl)} mb`;
    document.getElementById('panelVisibility').textContent = current.visibility ? `${Math.round(current.visibility / 1609)} mi` : '10+ mi';
    document.getElementById('panelDewPoint').textContent = `${Math.round(dewPoint)}°F`;
    document.getElementById('panelCloudCover').textContent = `${current.cloud_cover}%`;
    document.getElementById('panelPrecipitation').textContent = current.precipitation ? `${current.precipitation.toFixed(2)} in` : '0 in';
    
    const hourlyContainer = document.getElementById('panelHourlyData');
    hourlyContainer.innerHTML = '';
    for (let i = 0; i < 24; i++) {
        if (hourly.time[i]) {
            const time = new Date(hourly.time[i]);
            const timeStr = time.getHours().toString().padStart(2, '0') + ':00';
            const icon = getWeatherIcon(hourly.weather_code[i]);
            const hourlyItem = document.createElement('div');
            hourlyItem.className = 'hourly-item-detailed';
            hourlyItem.innerHTML = `
                <div class="hourly-time-detailed">${timeStr}</div>
                <div class="hourly-icon-detailed">${icon}</div>
                <div class="hourly-temp-detailed">${Math.round(hourly.temperature_2m[i])}°F</div>
                <div class="hourly-wind-detailed">💨 ${Math.round(hourly.wind_speed_10m[i])} mph</div>
            `;
            hourlyContainer.appendChild(hourlyItem);
        }
    }
    
    const dailyContainer = document.getElementById('panelDailyData');
    dailyContainer.innerHTML = '';
    for (let i = 0; i < 7; i++) {
        if (daily.time[i]) {
            const date = new Date(daily.time[i]);
            const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            const icon = getWeatherIcon(daily.weather_code[i]);
            const precipProb = daily.precipitation_probability_max[i] || 0;
            const dailyItem = document.createElement('div');
            dailyItem.className = 'daily-item-detailed';
            dailyItem.innerHTML = `
                <div class="daily-date-detailed">${dateStr}</div>
                <div class="daily-icon-detailed">${icon}</div>
                <div class="daily-temps-detailed">
                    <span class="temp-high">${Math.round(daily.temperature_2m_max[i])}°</span>
                    <span class="temp-low">${Math.round(daily.temperature_2m_min[i])}°</span>
                </div>
                <div class="daily-precip-detailed">💧 ${precipProb}%</div>
            `;
            dailyContainer.appendChild(dailyItem);
        }
    }
    
    document.getElementById('weatherPanel').classList.remove('hidden');
    console.log('✅ Weather panel updated with backup data');
}

function getConditionsFromCode(code) {
    const conditions = {
        0: 'Unknown',
        1000: 'Clear',
        1100: 'Mostly Clear',
        1101: 'Partly Cloudy',
        1102: 'Mostly Cloudy',
        1001: 'Cloudy',
        2000: 'Fog',
        2100: 'Light Fog',
        4000: 'Drizzle',
        4001: 'Rain',
        4200: 'Light Rain',
        4201: 'Heavy Rain',
        5000: 'Snow',
        5001: 'Flurries',
        5100: 'Light Snow',
        5101: 'Heavy Snow',
        6000: 'Freezing Drizzle',
        6001: 'Freezing Rain',
        6200: 'Light Freezing Rain',
        6201: 'Heavy Freezing Rain',
        7000: 'Ice Pellets',
        7101: 'Heavy Ice Pellets',
        7102: 'Light Ice Pellets',
        8000: 'Thunderstorm'
    };
    return conditions[code] || 'Unknown';
}

function getWeatherIconFromCode(code) {
    if (code === 1000) return '☀️';
    if (code === 1100) return '🌤️';
    if (code === 1101) return '⛅';
    if (code === 1102 || code === 1001) return '☁️';
    if (code === 2000 || code === 2100) return '🌫️';
    if (code >= 4000 && code <= 4201) return '🌧️';
    if (code >= 5000 && code <= 5101) return '🌨️';
    if (code >= 6000 && code <= 6201) return '🧊';
    if (code >= 7000 && code <= 7102) return '🧊';
    if (code === 8000) return '⛈️';
    return '🌡️';
}

function getPrecipType(type) {
    if (type === 1) return { type: 'Rain', icon: '🌧️', color: '#4ade80' };
    if (type === 2) return { type: 'Snow', icon: '❄️', color: '#4169E1' };
    if (type === 3) return { type: 'Freezing Rain', icon: '🧊', color: '#E6E6FA' };
    if (type === 4) return { type: 'Ice Pellets', icon: '🧊', color: '#B0C4DE' };
    return null;
}

function getWeatherIcon(code) {
    if (code === 0) return '☀️';
    if (code === 1) return '🌤️';
    if (code === 2) return '⛅';
    if (code === 3) return '☁️';
    if (code === 45 || code === 48) return '🌫️';
    if (code >= 51 && code <= 57) return '🌦️';
    if (code >= 61 && code <= 67) return '🌧️';
    if (code >= 71 && code <= 77) return '🌨️';
    if (code >= 80 && code <= 82) return '🌧️';
    if (code >= 85 && code <= 86) return '🌨️';
    if (code >= 95 && code <= 99) return '⛈️';
    return '🌡️';
}

async function fetchWeatherAlertsForLocation(lat, lng) {
    try {
        const response = await fetch(`https://api.weather.gov/alerts/active?point=${lat},${lng}`, {
            headers: { 'User-Agent': '(StormSurgeWeather, contact@stormsurge.app)' }
        });
        const data = await response.json();
        return data.features || [];
    } catch (error) {
        return [];
    }
}

function classifyPrecipitationType(temp, weatherCode) {
    if (weatherCode >= 71 && weatherCode <= 77) return { type: 'Snow', icon: '❄️', color: '#4169E1' };
    if (weatherCode >= 85 && weatherCode <= 86) return { type: 'Snow', icon: '🌨️', color: '#4169E1' };
    if (weatherCode === 56 || weatherCode === 57 || weatherCode === 66 || weatherCode === 67) return { type: 'Ice', icon: '🧊', color: '#E6E6FA' };
    if ((weatherCode >= 61 && weatherCode <= 65) || (weatherCode >= 80 && weatherCode <= 82)) {
        if (temp <= 32) return { type: 'Freezing Rain', icon: '🧊', color: '#B0C4DE' };
        return { type: 'Rain', icon: '🌧️', color: '#4ade80' };
    }
    if (weatherCode >= 51 && weatherCode <= 55) return { type: 'Drizzle', icon: '💧', color: '#90EE90' };
    if (weatherCode >= 95 && weatherCode <= 99) return { type: 'Thunderstorm', icon: '⛈️', color: '#ff0000' };
    return null;
}

function getWindDirection(degrees) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(degrees / 22.5) % 16];
}

function calculateDewPoint(tempF, humidity) {
    const tempC = (tempF - 32) * 5/9;
    const alpha = ((17.27 * tempC) / (237.7 + tempC)) + Math.log(humidity / 100);
    const dewPointC = (237.7 * alpha) / (17.27 - alpha);
    return (dewPointC * 9/5) + 32;
}

async function reverseGeocode(lat, lng) {
    try {
        const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_KEY}`);
        const data = await response.json();
        if (data.features && data.features.length > 0) return data.features[0].place_name;
        return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
    } catch (error) {
        return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
    }
}

function showClickMarker(lat, lng) {
    const marker = document.getElementById('clickMarker');
    const point = map.project([lng, lat]);
    marker.style.left = `${point.x}px`;
    marker.style.top = `${point.y}px`;
    marker.classList.remove('hidden');
    if (state.clickMarkerTimeout) clearTimeout(state.clickMarkerTimeout);
    state.clickMarkerTimeout = setTimeout(() => marker.classList.add('hidden'), 3000);
}

async function searchLocation(query) {
    try {
        const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_KEY}&limit=5`);
        const data = await response.json();
        return data.features.map(f => ({ name: f.place_name, lng: f.center[0], lat: f.center[1] }));
    } catch (error) {
        return [];
    }
}

function displaySearchResults(results) {
    const container = document.getElementById('searchResults');
    if (results.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">No results found</div>';
        return;
    }
    container.innerHTML = results.map(r => `
        <div class="search-result-item" onclick="selectLocation(${r.lat}, ${r.lng}, '${r.name.replace(/'/g, "\\'")}')">
            📍 ${r.name}
        </div>
    `).join('');
}

function selectLocation(lat, lng, name) {
    map.flyTo({ center: [lng, lat], zoom: 10, duration: 1500 });
    state.currentLat = lat;
    state.currentLng = lng;
    document.getElementById('currentLocation').textContent = name.split(',')[0];
    updateWeatherPanel(lat, lng);
    showClickMarker(lat, lng);
    closeSearch();
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function closeSettings() { document.getElementById('settingsModal').classList.add('hidden'); }
function closeSearch() { document.getElementById('searchModal').classList.add('hidden'); }
function closeWarningModal() { document.getElementById('warningModal').classList.add('hidden'); }

map.on('load', () => {
    console.log('🗺️ Map loaded');
    loadRadarFrames().then(() => setTimeout(() => startAnimation(), 1000));
    loadWeatherAlerts();
    setInterval(() => {
        console.log('🔄 Auto-refresh radar');
        loadRadarFrames();
    }, 5 * 60 * 1000);
    setInterval(() => {
        console.log('🔄 Auto-refresh alerts');
        loadWeatherAlerts();
    }, 2 * 60 * 1000);
});

map.on('click', (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['warning-fills'] });
    if (features.length > 0) return;
    state.currentLat = e.lngLat.lat;
    state.currentLng = e.lngLat.lng;
    showClickMarker(state.currentLat, state.currentLng);
    updateWeatherPanel(state.currentLat, state.currentLng);
});

map.on('move', () => {
    const marker = document.getElementById('clickMarker');
    if (!marker.classList.contains('hidden')) {
        const point = map.project([state.currentLng, state.currentLat]);
        marker.style.left = `${point.x}px`;
        marker.style.top = `${point.y}px`;
    }
});

document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('settingsModal').classList.remove('hidden');
});

document.getElementById('searchBtn').addEventListener('click', () => {
    document.getElementById('searchModal').classList.remove('hidden');
    document.getElementById('searchInput').focus();
});

document.getElementById('playPauseBtn').addEventListener('click', () => {
    if (state.isAnimating) stopAnimation();
    else startAnimation();
});

document.getElementById('timeSlider').addEventListener('input', (e) => {
    stopAnimation();
    const timeIndex = parseInt(e.target.value);
    state.currentTimeIndex = timeIndex;
    displayRadarFrame(timeIndex);
    updateTimeDisplay();
});

document.getElementById('alertsBtn').addEventListener('click', () => {
    document.getElementById('warningsList').classList.toggle('hidden');
});

document.getElementById('closeWeatherPanel').addEventListener('click', () => {
    document.getElementById('weatherPanel').classList.add('hidden');
});

document.getElementById('closeWarnings').addEventListener('click', () => {
    document.getElementById('warningsList').classList.add('hidden');
});

document.getElementById('searchInput').addEventListener('keyup', async (e) => {
    if (e.key === 'Enter') {
        const query = e.target.value.trim();
        if (query) {
            const results = await searchLocation(query);
            displaySearchResults(results);
        }
    }
});

document.getElementById('radarOpacity').addEventListener('input', (e) => {
    const opacity = e.target.value / 100;
    state.radarOpacity = opacity;
    document.getElementById('opacityDisplay').textContent = `${e.target.value}%`;
    
    if (map.getLayer('radar-layer')) {
        map.setPaintProperty('radar-layer', 'raster-opacity', opacity);
    }
});

document.getElementById('satelliteToggle').addEventListener('change', (e) => {
    const checked = e.target.checked;
    state.mapStyle = checked ? 'satellite' : 'dark';
    
    const newStyle = checked 
        ? 'mapbox://styles/mapbox/satellite-streets-v12' 
        : 'mapbox://styles/mapbox/dark-v11';
    
    map.setStyle(newStyle);
    
    map.once('style.load', () => {
        console.log('✅ Map style changed to:', state.mapStyle);
        displayRadarFrame(state.currentTimeIndex);
        if (state.showPolygons) displayWarningPolygons();
    });
    
    showToast(checked ? 'Satellite view enabled' : 'Dark view enabled', 'info');
});

document.getElementById('polygonsToggle').addEventListener('change', (e) => {
    state.showPolygons = e.target.checked;
    
    if (state.showPolygons) {
        displayWarningPolygons();
    } else {
        if (map.getLayer('warning-fills')) map.removeLayer('warning-fills');
        if (map.getLayer('warning-lines')) map.removeLayer('warning-lines');
        if (map.getSource('warnings-source')) map.removeSource('warnings-source');
    }
});

document.getElementById('radar3DToggle').addEventListener('change', (e) => {
    toggle3DRadar();
});

document.getElementById('animationSpeed').addEventListener('change', (e) => {
    state.animationSpeed = parseInt(e.target.value);
    if (state.isAnimating) {
        stopAnimation();
        startAnimation();
    }
});

document.getElementById('warningCountryFilter').addEventListener('change', (e) => {
    state.warningCountryFilter = e.target.value;
    showToast(`Loading ${e.target.options[e.target.selectedIndex].text}...`, 'info');
    loadWeatherAlerts();
});

document.getElementById('shareWarningBtn').addEventListener('click', () => {
    if (state.selectedWarning) {
        const props = state.selectedWarning.properties;
        const text = `${props.event}: ${props.headline || props.description}`;
        
        if (navigator.share) {
            navigator.share({
                title: 'Weather Alert',
                text: text,
                url: window.location.href
            }).catch(err => console.log('Share error:', err));
        } else {
            navigator.clipboard.writeText(text).then(() => {
                showToast('Alert copied to clipboard', 'success');
            });
        }
    }
});

document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });
});

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    switch(e.key.toLowerCase()) {
        case ' ':
            e.preventDefault();
            if (state.isAnimating) stopAnimation();
            else startAnimation();
            break;
        case 'arrowleft':
            e.preventDefault();
            stopAnimation();
            state.currentTimeIndex = Math.max(0, state.currentTimeIndex - 1);
            displayRadarFrame(state.currentTimeIndex);
            updateTimeDisplay();
            break;
        case 'arrowright':
            e.preventDefault();
            stopAnimation();
            state.currentTimeIndex = Math.min(state.radarFrames.length - 1, state.currentTimeIndex + 1);
            displayRadarFrame(state.currentTimeIndex);
            updateTimeDisplay();
            break;
        case 'w':
            document.getElementById('warningsList').classList.toggle('hidden');
            break;
        case 's':
            document.getElementById('settingsModal').classList.remove('hidden');
            break;
        case '3':
            toggle3DRadar();
            break;
        case 'escape':
            document.querySelectorAll('.modal:not(.hidden)').forEach(modal => {
                modal.classList.add('hidden');
            });
            document.getElementById('warningsList').classList.add('hidden');
            document.getElementById('weatherPanel').classList.add('hidden');
            break;
    }
});

window.addEventListener('resize', () => {
    map.resize();
    if (state.renderer3D && state.camera3D) {
        const container = document.getElementById('radar3DContainer');
        state.camera3D.aspect = container.clientWidth / container.clientHeight;
        state.camera3D.updateProjectionMatrix();
        state.renderer3D.setSize(container.clientWidth, container.clientHeight);
    }
});

let touchStartY = 0;
document.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    const touchY = e.touches[0].clientY;
    const touchDiff = touchY - touchStartY;
    
    if (touchDiff > 0 && window.scrollY === 0) {
        e.preventDefault();
    }
}, { passive: false });

window.showWarningDetail = showWarningDetail;
window.selectLocation = selectLocation;
window.closeSettings = closeSettings;
window.closeSearch = closeSearch;
window.closeWarningModal = closeWarningModal;

function init() {
    console.log('⚡ Storm Surge Weather v5.0 ULTIMATE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Tomorrow.io Weather API');
    console.log('✅ RainViewer Radar');
    console.log('✅ NWS Weather Alerts');
    console.log('✅ 3D Radar Visualization');
    console.log('✅ Color-Coded Warning Polygons');
    console.log('✅ Multi-Country Support');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${state.currentLng},${state.currentLat}.json?access_token=${MAPBOX_KEY}`)
        .then(res => res.json())
        .then(data => {
            if (data.features && data.features.length > 0) {
                const placeName = data.features[0].text || data.features[0].place_name.split(',')[0];
                document.getElementById('currentLocation').textContent = placeName;
            }
        })
        .catch(err => console.error('Location error:', err));
    
    console.log('✅ Dashboard initialized successfully');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ========================================
//  JAVASCRIPT ENDS HERE
// ========================================