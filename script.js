// ========================================
//  ENHANCED STORM SURGE WEATHER DASHBOARD
//  File: script.js
//  Version 3.0 - Fixed Radar & Real Data
// ========================================

// ================================
//  API KEYS & CONFIG
// ================================
const MAPBOX_KEY = "pk.eyJ1Ijoic3Rvcm0tc3VyZ2UiLCJhIjoiY21pcDM0emdxMDhwYzNmcHc2aTlqeTN5OSJ9.QYtnuhdixR4SGxLQldE9PA";
const FEEDBACK_EMAIL = "stormsurgee025@gmail.com";

// State management
let state = {
    currentLat: 39.8283,
    currentLng: -98.5795,
    currentRadarProduct: 'radar',
    isAnimating: false,
    animationInterval: null,
    currentTimeIndex: 0,
    radarTimes: [],
    animationSpeed: 500,
    radarFrames: [],
    
    // Feature toggles
    showPolygons: true,
    showSatellite: false,
    
    // Warnings
    activeWarnings: [],
    
    // Selected warning for detail view
    selectedWarning: null,
    
    // Click marker
    clickMarkerTimeout: null
};

// Weather code translations
const weatherText = {
    0: "Clear sky",
    1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
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

// Warning type colors
const warningColors = {
    'Tornado Warning': '#FF0000',
    'Severe Thunderstorm Warning': '#FFA500',
    'Flash Flood Warning': '#8B0000',
    'Flood Warning': '#00FF00',
    'Flood Advisory': '#00FF7F',
    'Winter Storm Warning': '#FF1493',
    'Winter Weather Advisory': '#7B68EE',
    'High Wind Warning': '#DAA520',
    'Wind Advisory': '#D2B48C',
    'Gale Warning': '#DDA0DD',
    'Dense Fog Advisory': '#708090',
    'Special Weather Statement': '#FFE4B5',
    'Heat Advisory': '#FF7F50',
    'Excessive Heat Warning': '#C71585',
    'Fire Weather Watch': '#FFD700',
    'Red Flag Warning': '#FF1493'
};

// ================================
//  MAPBOX INITIALIZATION
// ================================
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
//  RADAR FUNCTIONS - RAINVIEWER API
// ================================
async function loadRadarFrames() {
    try {
        console.log('🔄 Loading radar frames from RainViewer...');
        
        // Get available radar timestamps from RainViewer
        const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await response.json();
        
        if (data && data.radar && data.radar.past) {
            state.radarFrames = data.radar.past;
            state.radarTimes = state.radarFrames.map(frame => new Date(frame.time * 1000));
            state.currentTimeIndex = state.radarFrames.length - 1; // Start at most recent
            
            console.log(`✅ Loaded ${state.radarFrames.length} radar frames`);
            
            // Load the most recent frame
            await displayRadarFrame(state.currentTimeIndex);
            updateTimeDisplay();
            
            return true;
        } else {
            throw new Error('No radar data available');
        }
    } catch (error) {
        console.error('❌ Error loading radar frames:', error);
        showToast('Unable to load radar data', 'error');
        return false;
    }
}

async function displayRadarFrame(frameIndex) {
    try {
        if (!state.radarFrames[frameIndex]) {
            console.error('Frame not available:', frameIndex);
            return;
        }
        
        const frame = state.radarFrames[frameIndex];
        const tileURL = `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/6/1_1.png`;
        
        // Remove existing radar layer
        if (map.getLayer('radar-layer')) {
            map.removeLayer('radar-layer');
        }
        if (map.getSource('radar-source')) {
            map.removeSource('radar-source');
        }
        
        // Add new radar layer
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
                'raster-opacity': parseFloat(document.getElementById('radarOpacity')?.value || 70) / 100,
                'raster-fade-duration': 0
            }
        });
        
        // Move radar layer below warning polygons if they exist
        if (map.getLayer('warning-fills')) {
            map.moveLayer('radar-layer', 'warning-fills');
        }
        
    } catch (error) {
        console.error('Error displaying radar frame:', error);
    }
}

function updateTimeDisplay() {
    const timeIndex = state.currentTimeIndex;
    document.getElementById('timeSlider').value = timeIndex;
    document.getElementById('timeSlider').max = state.radarFrames.length - 1;
    
    if (timeIndex === state.radarFrames.length - 1) {
        document.getElementById('currentTime').textContent = 'Now';
        document.getElementById('timeMode').textContent = 'LIVE';
        document.getElementById('timeMode').style.background = 'rgba(0, 255, 136, 0.2)';
        document.getElementById('timeMode').style.color = '#00ff88';
    } else {
        const time = state.radarTimes[timeIndex];
        const timeStr = time.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit' 
        });
        const minutesAgo = Math.round((Date.now() - time.getTime()) / 60000);
        
        document.getElementById('currentTime').textContent = timeStr;
        document.getElementById('timeMode').textContent = `${minutesAgo}m ago`;
        document.getElementById('timeMode').style.background = 'rgba(255, 170, 0, 0.2)';
        document.getElementById('timeMode').style.color = '#ffaa00';
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
    console.log('▶️ Animation started');
}

function stopAnimation() {
    if (state.animationInterval) {
        clearInterval(state.animationInterval);
        state.animationInterval = null;
    }
    
    state.isAnimating = false;
    document.getElementById('playPauseBtn').textContent = '▶️';
    console.log('⏸️ Animation stopped');
}

// ================================
//  WEATHER ALERTS/WARNINGS - NWS API
// ================================
async function loadWeatherAlerts() {
    try {
        console.log('🔄 Loading real weather alerts from NWS...');
        
        const response = await fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert', {
            headers: {
                'User-Agent': '(StormSurgeWeather, contact@stormsurge.app)'
            }
        });
        
        if (!response.ok) {
            throw new Error(`NWS API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.features) {
            state.activeWarnings = data.features.filter(feature => {
                return feature.properties && feature.properties.event;
            });
            
            console.log(`✅ Loaded ${state.activeWarnings.length} active warnings from NWS`);
            updateWarningsList();
            displayWarningPolygons();
            updateAlertBadge();
        }
    } catch (error) {
        console.error('❌ Error loading weather alerts:', error);
        showToast('Unable to load weather alerts', 'error');
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
        content.innerHTML = '<div style="text-align: center; color: #4ade80; padding: 20px; font-size: 14px;"><div style="font-size: 32px; margin-bottom: 10px;">✓</div>No Active Alerts<div style="font-size: 12px; color: #999; margin-top: 8px;">All clear in monitored areas</div></div>';
        return;
    }
    
    content.innerHTML = state.activeWarnings.map(warning => {
        const props = warning.properties;
        const color = warningColors[props.event] || '#999';
        const expiresIn = formatTimeRemaining(props.expires);
        const severity = props.severity || 'Unknown';
        const urgency = props.urgency || 'Unknown';
        
        return `
            <div class="warning-item" style="border-left-color: ${color};" onclick="showWarningDetail('${props.id}')">
                <div class="warning-header-row">
                    <div class="warning-type">${props.event}</div>
                    <div class="warning-severity-badge ${severity.toLowerCase()}">${severity}</div>
                </div>
                <div class="warning-area">${props.areaDesc ? props.areaDesc.split(';')[0] : 'Area N/A'}</div>
                <div class="warning-expires">⏱️ Expires in ${expiresIn} • ${urgency} urgency</div>
            </div>
        `;
    }).join('');
}

function displayWarningPolygons() {
    if (!state.showPolygons) {
        console.log('Warning polygons disabled');
        return;
    }
    
    // Remove existing layers
    if (map.getLayer('warning-fills')) map.removeLayer('warning-fills');
    if (map.getLayer('warning-lines')) map.removeLayer('warning-lines');
    if (map.getSource('warnings-source')) map.removeSource('warnings-source');
    
    const validWarnings = state.activeWarnings.filter(w => w.geometry);
    
    if (validWarnings.length === 0) {
        console.log('No warning polygons to display');
        return;
    }
    
    console.log(`Displaying ${validWarnings.length} warning polygons`);
    
    const geojson = {
        type: 'FeatureCollection',
        features: validWarnings.map(w => ({
            type: 'Feature',
            geometry: w.geometry,
            properties: {
                id: w.properties.id,
                event: w.properties.event,
                severity: w.properties.severity
            }
        }))
    };
    
    map.addSource('warnings-source', {
        type: 'geojson',
        data: geojson
    });
    
    map.addLayer({
        id: 'warning-fills',
        type: 'fill',
        source: 'warnings-source',
        paint: {
            'fill-color': [
                'match',
                ['get', 'event'],
                'Tornado Warning', '#FF0000',
                'Severe Thunderstorm Warning', '#FFA500',
                'Flash Flood Warning', '#8B0000',
                'Flood Warning', '#00FF00',
                'Winter Storm Warning', '#FF1493',
                'High Wind Warning', '#DAA520',
                'Gale Warning', '#DDA0DD',
                'Dense Fog Advisory', '#708090',
                'Special Weather Statement', '#FFE4B5',
                '#00FF00'
            ],
            'fill-opacity': 0.25
        }
    });
    
    map.addLayer({
        id: 'warning-lines',
        type: 'line',
        source: 'warnings-source',
        paint: {
            'line-color': [
                'match',
                ['get', 'event'],
                'Tornado Warning', '#FF0000',
                'Severe Thunderstorm Warning', '#FFA500',
                'Flash Flood Warning', '#8B0000',
                'Flood Warning', '#00FF00',
                'Winter Storm Warning', '#FF1493',
                'High Wind Warning', '#DAA520',
                'Gale Warning', '#DDA0DD',
                'Dense Fog Advisory', '#708090',
                'Special Weather Statement', '#FFE4B5',
                '#00FF00'
            ],
            'line-width': 2,
            'line-opacity': 0.9
        }
    });
    
    // Click handler
    map.on('click', 'warning-fills', (e) => {
        if (e.features.length > 0) {
            const warningId = e.features[0].properties.id;
            console.log('Warning polygon clicked:', warningId);
            showWarningDetail(warningId);
        }
    });
    
    map.on('mouseenter', 'warning-fills', () => {
        map.getCanvas().style.cursor = 'pointer';
    });
    
    map.on('mouseleave', 'warning-fills', () => {
        map.getCanvas().style.cursor = '';
    });
    
    console.log('✅ Warning polygons displayed');
}

function showWarningDetail(warningId) {
    const warning = state.activeWarnings.find(w => w.properties.id === warningId);
    if (!warning) {
        console.error('Warning not found:', warningId);
        return;
    }
    
    const props = warning.properties;
    const color = warningColors[props.event] || '#999';
    
    state.selectedWarning = warning;
    
    const modal = document.getElementById('warningModal');
    const header = document.getElementById('warningModalHeader');
    
    header.style.background = color;
    header.style.color = '#fff';
    
    document.getElementById('warningModalTitle').textContent = props.event;
    document.getElementById('warningIssued').textContent = new Date(props.onset || props.sent).toLocaleString();
    document.getElementById('warningExpires').textContent = new Date(props.expires).toLocaleString();
    document.getElementById('warningSeverity').textContent = props.severity || 'N/A';
    document.getElementById('warningUrgency').textContent = props.urgency || 'N/A';
    document.getElementById('warningSource').textContent = props.senderName || 'NWS';
    document.getElementById('warningDescription').textContent = props.description || props.headline || 'No description available';
    document.getElementById('warningAreas').textContent = props.areaDesc || 'Area information not available';
    
    modal.classList.remove('hidden');
    console.log('Warning detail modal opened');
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
    const now = new Date();
    const expires = new Date(expiresISO);
    const diff = expires - now;
    
    if (diff < 0) return 'Expired';
    
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// ================================
//  WEATHER DATA - OPEN-METEO API
// ================================
async function getWeatherData(lat, lng) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover,pressure_msl,visibility&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=7`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        return data;
    } catch (error) {
        console.error('Error fetching weather data:', error);
        return null;
    }
}

async function updateWeatherPanel(lat, lng) {
    const data = await getWeatherData(lat, lng);
    
    if (!data) {
        showToast('Unable to load weather data', 'error');
        return;
    }
    
    console.log('✅ Weather data loaded for:', lat, lng);
    
    const current = data.current;
    const hourly = data.hourly;
    const daily = data.daily;
    
    // Get location name
    const locationName = await reverseGeocode(lat, lng);
    document.getElementById('panelLocationAddress').textContent = locationName;
    document.getElementById('panelLocationCoords').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    
    // Check for local warnings
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
    
    // Update current weather
    document.getElementById('panelCurrentTemp').textContent = `${Math.round(current.temperature_2m)}°F`;
    document.getElementById('panelFeelsLike').textContent = `Feels like ${Math.round(current.apparent_temperature)}°F`;
    document.getElementById('panelConditions').textContent = weatherText[current.weather_code] || 'Unknown';
    
    // Weather icon
    const weatherIcon = getWeatherIcon(current.weather_code);
    document.getElementById('panelWeatherIcon').textContent = weatherIcon;
    
    // Precipitation type
    const precipType = classifyPrecipitationType(current.temperature_2m, current.weather_code);
    const precipTypeElement = document.getElementById('panelPrecipType');
    if (precipType) {
        precipTypeElement.textContent = `${precipType.icon} ${precipType.type}`;
        precipTypeElement.style.color = precipType.color;
    } else {
        precipTypeElement.textContent = '';
    }
    
    // Calculate dew point
    const dewPoint = calculateDewPoint(current.temperature_2m, current.relative_humidity_2m);
    
    // Update details
    document.getElementById('panelHumidity').textContent = `${current.relative_humidity_2m}%`;
    document.getElementById('panelWindSpeed').textContent = `${Math.round(current.wind_speed_10m)} mph`;
    document.getElementById('panelWindDirection').textContent = getWindDirection(current.wind_direction_10m);
    document.getElementById('panelPressure').textContent = `${Math.round(current.pressure_msl)} mb`;
    document.getElementById('panelVisibility').textContent = current.visibility ? `${Math.round(current.visibility / 1609)} mi` : '10+ mi';
    document.getElementById('panelDewPoint').textContent = `${Math.round(dewPoint)}°F`;
    document.getElementById('panelCloudCover').textContent = `${current.cloud_cover}%`;
    document.getElementById('panelPrecipitation').textContent = current.precipitation ? `${current.precipitation.toFixed(2)} in` : '0 in';
    
    // Update hourly forecast (next 24 hours)
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

    // Update daily forecast
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
    
    // Show the panel
    document.getElementById('weatherPanel').classList.remove('hidden');
    console.log('✅ Weather panel updated');
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
            headers: {
                'User-Agent': '(StormSurgeWeather, contact@stormsurge.app)'
            }
        });
        const data = await response.json();
        return data.features || [];
    } catch (error) {
        console.error('Error fetching local alerts:', error);
        return [];
    }
}

function classifyPrecipitationType(temp, weatherCode) {
    if (weatherCode >= 71 && weatherCode <= 77) {
        return { type: 'Snow', icon: '❄️', color: '#4169E1' };
    } else if (weatherCode >= 85 && weatherCode <= 86) {
        return { type: 'Snow Showers', icon: '🌨️', color: '#4169E1' };
    } else if (weatherCode === 56 || weatherCode === 57 || weatherCode === 66 || weatherCode === 67) {
        return { type: 'Freezing Rain', icon: '🧊', color: '#E6E6FA' };
    } else if ((weatherCode >= 61 && weatherCode <= 65) || (weatherCode >= 80 && weatherCode <= 82)) {
        if (temp <= 32) {
            return { type: 'Freezing Rain', icon: '🧊', color: '#B0C4DE' };
        }
        return { type: 'Rain', icon: '🌧️', color: '#4ade80' };
    } else if (weatherCode >= 51 && weatherCode <= 55) {
        return { type: 'Drizzle', icon: '💧', color: '#90EE90' };
    } else if (weatherCode >= 95 && weatherCode <= 99) {
        return { type: 'Thunderstorm', icon: '⛈️', color: '#ff0000' };
    }
    return null;
}

function getWindDirection(degrees) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return directions[Math.round(degrees / 22.5) % 16];
}

function calculateDewPoint(tempF, humidity) {
    const tempC = (tempF - 32) * 5/9;
    const a = 17.27;
    const b = 237.7;
    const alpha = ((a * tempC) / (b + tempC)) + Math.log(humidity / 100);
    const dewPointC = (b * alpha) / (a - alpha);
    return (dewPointC * 9/5) + 32;
}

async function reverseGeocode(lat, lng) {
    try {
        const response = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_KEY}`
        );
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            return data.features[0].place_name;
        }
        return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
    } catch (error) {
        console.error('Reverse geocoding error:', error);
        return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
    }
}

// ================================
//  CLICK MARKER
// ================================
function showClickMarker(lat, lng) {
    const marker = document.getElementById('clickMarker');
    const point = map.project([lng, lat]);
    
    marker.style.left = `${point.x}px`;
    marker.style.top = `${point.y}px`;
    marker.classList.remove('hidden');
    
    if (state.clickMarkerTimeout) {
        clearTimeout(state.clickMarkerTimeout);
    }
    
    state.clickMarkerTimeout = setTimeout(() => {
        marker.classList.add('hidden');
    }, 3000);
}

// ================================
//  LOCATION SEARCH
// ================================
async function searchLocation(query) {
    try {
        const response = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_KEY}&limit=5`
        );
        const data = await response.json();
        
        return data.features.map(feature => ({
            name: feature.place_name,
            lng: feature.center[0],
            lat: feature.center[1]
        }));
    } catch (error) {
        console.error('Search error:', error);
        return [];
    }
}

function displaySearchResults(results) {
    const container = document.getElementById('searchResults');
    
    if (results.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">No results found</div>';
        return;
    }
    
    container.innerHTML = results.map(result => `
        <div class="search-result-item" onclick="selectLocation(${result.lat}, ${result.lng}, '${result.name.replace(/'/g, "\\'")}')">
            📍 ${result.name}
        </div>
    `).join('');
}

function selectLocation(lat, lng, name) {
    map.flyTo({
        center: [lng, lat],
        zoom: 10,
        duration: 1500
    });
    
    state.currentLat = lat;
    state.currentLng = lng;
    
    document.getElementById('currentLocation').textContent = name.split(',')[0];
    updateWeatherPanel(lat, lng);
    showClickMarker(lat, lng);
    closeSearch();
    
    console.log('Location selected:', name);
}

// ================================
//  UI HELPERS
// ================================
function showLoading(show) {
    const loader = document.getElementById('loadingIndicator');
    if (show) {
        loader.classList.remove('hidden');
    } else {
        loader.classList.add('hidden');
    }
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

function closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
}

function closeSearch() {
    document.getElementById('searchModal').classList.add('hidden');
}

function closeWarningModal() {
    document.getElementById('warningModal').classList.add('hidden');
}

// ================================
//  EVENT LISTENERS
// ================================

// Map events
map.on('load', () => {
    console.log('🗺️ Map loaded successfully');
    
    // Load radar frames first
    loadRadarFrames().then(() => {
        // Start animation after a short delay
        setTimeout(() => {
            startAnimation();
        }, 1000);
    });
    
    // Load weather alerts
    loadWeatherAlerts();
    
    // Auto-refresh radar every 5 minutes
    setInterval(() => {
        console.log('🔄 Auto-refreshing radar data...');
        loadRadarFrames();
    }, 5 * 60 * 1000);
    
    // Refresh warnings every 2 minutes
    setInterval(() => {
        console.log('🔄 Auto-refreshing weather alerts...');
        loadWeatherAlerts();
    }, 2 * 60 * 1000);
});

map.on('click', (e) => {
    // Don't trigger if clicking on a warning polygon
    const features = map.queryRenderedFeatures(e.point, {
        layers: ['warning-fills']
    });
    
    if (features.length > 0) {
        return;
    }
    
    state.currentLat = e.lngLat.lat;
    state.currentLng = e.lngLat.lng;
    
    console.log('Map clicked:', e.lngLat.lat, e.lngLat.lng);
    
    showClickMarker(state.currentLat, state.currentLng);
    updateWeatherPanel(state.currentLat, state.currentLng);
});

// Update marker position on map move
map.on('move', () => {
    const marker = document.getElementById('clickMarker');
    if (!marker.classList.contains('hidden')) {
        const point = map.project([state.currentLng, state.currentLat]);
        marker.style.left = `${point.x}px`;
        marker.style.top = `${point.y}px`;
    }
});

// Top bar buttons
document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('settingsModal').classList.remove('hidden');
});

document.getElementById('searchBtn').addEventListener('click', () => {
    document.getElementById('searchModal').classList.remove('hidden');
    document.getElementById('searchInput').focus();
});

// Playback controls
document.getElementById('playPauseBtn').addEventListener('click', () => {
    if (state.isAnimating) {
        stopAnimation();
    } else {
        startAnimation();
    }
});

document.getElementById('timeSlider').addEventListener('input', (e) => {
    stopAnimation();
    const timeIndex = parseInt(e.target.value);
    state.currentTimeIndex = timeIndex;
    displayRadarFrame(timeIndex);
    updateTimeDisplay();
});

document.getElementById('alertsBtn').addEventListener('click', () => {
    const panel = document.getElementById('warningsList');
    panel.classList.toggle('hidden');
});

// Weather panel close
document.getElementById('closeWeatherPanel').addEventListener('click', () => {
    document.getElementById('weatherPanel').classList.add('hidden');
});

// Warnings panel close
document.getElementById('closeWarnings').addEventListener('click', () => {
    document.getElementById('warningsList').classList.add('hidden');
});

// Search functionality
document.getElementById('searchInput').addEventListener('keyup', async (e) => {
    if (e.key === 'Enter') {
        const query = e.target.value.trim();
        if (query) {
            const results = await searchLocation(query);
            displaySearchResults(results);
        }
    }
});

// Settings - Radar opacity
document.getElementById('radarOpacity').addEventListener('input', (e) => {
    const opacity = e.target.value / 100;
    document.getElementById('opacityDisplay').textContent = `${e.target.value}%`;
    
    if (map.getLayer('radar-layer')) {
        map.setPaintProperty('radar-layer', 'raster-opacity', opacity);
    }
});

// Settings - Satellite toggle
document.getElementById('satelliteToggle').addEventListener('change', (e) => {
    state.showSatellite = e.target.checked;
    
    if (state.showSatellite) {
        map.setStyle('mapbox://styles/mapbox/satellite-streets-v12');
    } else {
        map.setStyle('mapbox://styles/mapbox/dark-v11');
    }
    
    // Reload radar and polygons after style change
    map.once('styledata', () => {
        displayRadarFrame(state.currentTimeIndex);
        if (state.showPolygons) {
            displayWarningPolygons();
        }
    });
});

// Settings - Polygons toggle
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

// Settings - Animation speed
document.getElementById('animationSpeed').addEventListener('change', (e) => {
    state.animationSpeed = parseInt(e.target.value);
    console.log('Animation speed changed to:', state.animationSpeed, 'ms');
    
    // Restart animation with new speed if currently animating
    if (state.isAnimating) {
        stopAnimation();
        startAnimation();
    }
});

// Warning detail modal - Share button
document.getElementById('shareWarningBtn').addEventListener('click', () => {
    if (state.selectedWarning) {
        const props = state.selectedWarning.properties;
        const text = `${props.event}: ${props.headline || props.description}`;
        
        if (navigator.share) {
            navigator.share({
                title: 'Weather Alert',
                text: text,
                url: window.location.href
            }).catch(err => console.log('Error sharing:', err));
        } else {
            navigator.clipboard.writeText(text).then(() => {
                showToast('Alert copied to clipboard', 'success');
            });
        }
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

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Don't trigger if typing in input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    switch(e.key.toLowerCase()) {
        case ' ':
            e.preventDefault();
            if (state.isAnimating) {
                stopAnimation();
            } else {
                startAnimation();
            }
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
        case 'escape':
            document.querySelectorAll('.modal:not(.hidden)').forEach(modal => {
                modal.classList.add('hidden');
            });
            document.getElementById('warningsList').classList.add('hidden');
            document.getElementById('weatherPanel').classList.add('hidden');
            break;
    }
});

// Window resize handler
window.addEventListener('resize', () => {
    map.resize();
});

// Prevent pull-to-refresh on mobile
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

// ================================
//  GLOBAL FUNCTIONS (for onclick handlers)
// ================================
window.showWarningDetail = showWarningDetail;
window.selectLocation = selectLocation;
window.closeSettings = closeSettings;
window.closeSearch = closeSearch;
window.closeWarningModal = closeWarningModal;

// ================================
//  INITIALIZATION
// ================================
function init() {
    console.log('⚡ Storm Surge Weather Dashboard v3.0');
    console.log('📡 Initializing with real data sources...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ RainViewer Radar API');
    console.log('✅ NWS Weather Alerts API');
    console.log('✅ Open-Meteo Weather Data');
    console.log('✅ Mapbox Geocoding & Maps');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Update location display
    fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${state.currentLng},${state.currentLat}.json?access_token=${MAPBOX_KEY}`)
        .then(res => res.json())
        .then(data => {
            if (data.features && data.features.length > 0) {
                const placeName = data.features[0].text || data.features[0].place_name.split(',')[0];
                document.getElementById('currentLocation').textContent = placeName;
            }
        })
        .catch(err => console.error('Error getting location name:', err));
    
    console.log('✅ Dashboard initialized successfully');
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ========================================
//  JAVASCRIPT ENDS HERE
// ========================================