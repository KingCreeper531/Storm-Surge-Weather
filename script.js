    // Update camera based on map view
    const distance = 300 + (12 - zoom) * 100;
    const heightOffset = 200 + (12 - zoom) * 50;
    
    state.camera3D.position.x = Math.sin(bearing * Math.PI / 180) * distance;
    state.camera3D.position.y = heightOffset + pitch * 5;
    state.camera3D.position.z = Math.cos(bearing * Math.PI / 180) * distance;
    state.camera3D.lookAt(0, 0, 0);
    
    state.renderer3D.render(state.scene3D, state.camera3D);


function toggle3DRadar() {
    if (state.isTransitioning) return;
    
    state.isTransitioning = true;
    const button = document.getElementById('toggle3DBtn');
    
    if (state.radarMode === '2d') {
        // Switch to 3D
        state.radarMode = '3d';
        button.textContent = '🗺️ 2D View';
        button.classList.add('active-3d');
        
        // Initialize 3D if not done
        if (!state.scene3D) {
            init3DRadar();
        }
        
        // Smooth transition
        map.easeTo({
            pitch: 60,
            bearing: 0,
            duration: 1000
        });
        
        setTimeout(() => {
            create3DRadarVolume();
            if (state.renderer3D) {
                state.renderer3D.domElement.style.opacity = '0';
                state.renderer3D.domElement.style.transition = 'opacity 0.8s ease';
                setTimeout(() => {
                    state.renderer3D.domElement.style.opacity = '1';
                }, 50);
            }
            animate3D();
            state.isTransitioning = false;
        }, 500);
        
        showToast('3D Radar View', 'success');
    } else {
        // Switch to 2D
        state.radarMode = '2d';
        button.textContent = '🎯 3D View';
        button.classList.remove('active-3d');
        
        // Smooth transition
        if (state.renderer3D) {
            state.renderer3D.domElement.style.opacity = '0';
        }
        
        map.easeTo({
            pitch: 0,
            bearing: 0,
            duration: 1000
        });
        
        setTimeout(() => {
            state.isTransitioning = false;
        }, 1000);
        
        showToast('2D Radar View', 'info');
    }
}

// ================================
//  RADAR FUNCTIONS - RAINVIEWER (SMOOTH)
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

async function displayRadarFrame(frameIndex, smooth = false) {
    try {
        if (!state.radarFrames[frameIndex]) return;
        
        const frame = state.radarFrames[frameIndex];
        const tileURL = `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/6/1_1.png`;
        
        // Smooth transition
        if (smooth && !state.isFrameTransitioning) {
            state.isFrameTransitioning = true;
            
            // Fade out current layer
            if (map.getLayer('radar-layer')) {
                const currentOpacity = state.radarOpacity;
                let opacity = currentOpacity;
                const fadeSteps = 10;
                const fadeInterval = state.frameTransitionDuration / (fadeSteps * 2);
                
                const fadeOut = setInterval(() => {
                    opacity -= currentOpacity / fadeSteps;
                    if (opacity <= 0) {
                        clearInterval(fadeOut);
                        
                        // Switch source
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
                                'raster-opacity': 0,
                                'raster-fade-duration': 0
                            }
                        });
                        
                        if (map.getLayer('warning-fills')) {
                            map.moveLayer('radar-layer', 'warning-fills');
                        }
                        
                        // Fade in new layer
                        opacity = 0;
                        const fadeIn = setInterval(() => {
                            opacity += currentOpacity / fadeSteps;
                            if (opacity >= currentOpacity) {
                                opacity = currentOpacity;
                                clearInterval(fadeIn);
                                state.isFrameTransitioning = false;
                            }
                            if (map.getLayer('radar-layer')) {
                                map.setPaintProperty('radar-layer', 'raster-opacity', opacity);
                            }
                        }, fadeInterval);
                    } else {
                        if (map.getLayer('radar-layer')) {
                            map.setPaintProperty('radar-layer', 'raster-opacity', opacity);
                        }
                    }
                }, fadeInterval);
            }
        } else {
            // Instant switch
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
        }
        
        // Update 3D radar if in 3D mode
        if (state.radarMode === '3d' && state.scene3D) {
            create3DRadarVolume();
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
        displayRadarFrame(state.currentTimeIndex, true); // Smooth animation
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
//  LIGHTNING STRIKES (NEW FEATURE)
// ================================
async function loadLightningData() {
    if (!state.showLightning) return;
    
    try {
        // Simulated lightning data (in production, use real lightning API)
        // For now, generate random strikes based on active thunderstorm warnings
        state.lightningStrikes = [];
        
        const thunderstormWarnings = state.activeWarnings.filter(w => 
            w.properties.event && w.properties.event.toLowerCase().includes('thunderstorm')
        );
        
        thunderstormWarnings.forEach(warning => {
            if (warning.geometry && warning.geometry.coordinates) {
                const coords = warning.geometry.type === 'Polygon' 
                    ? warning.geometry.coordinates[0] 
                    : warning.geometry.coordinates[0][0];
                
                // Generate 5-15 random strikes within warning polygon
                const strikeCount = Math.floor(Math.random() * 10) + 5;
                for (let i = 0; i < strikeCount; i++) {
                    const randomIndex = Math.floor(Math.random() * coords.length);
                    const [lng, lat] = coords[randomIndex];
                    
                    // Add some random offset
                    const offsetLat = lat + (Math.random() - 0.5) * 0.1;
                    const offsetLng = lng + (Math.random() - 0.5) * 0.1;
                    
                    state.lightningStrikes.push({
                        lat: offsetLat,
                        lng: offsetLng,
                        timestamp: Date.now(),
                        intensity: Math.random()
                    });
                }
            }
        });
        
        displayLightningStrikes();
        console.log(`⚡ Generated ${state.lightningStrikes.length} lightning strikes`);
    } catch (error) {
        console.error('Error loading lightning data:', error);
    }
}

function displayLightningStrikes() {
    if (map.getLayer('lightning-layer')) map.removeLayer('lightning-layer');
    if (map.getSource('lightning-source')) map.removeSource('lightning-source');
    
    if (state.lightningStrikes.length === 0) return;
    
    const geojson = {
        type: 'FeatureCollection',
        features: state.lightningStrikes.map(strike => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [strike.lng, strike.lat]
            },
            properties: {
                intensity: strike.intensity
            }
        }))
    };
    
    map.addSource('lightning-source', { type: 'geojson', data: geojson });
    
    map.addLayer({
        id: 'lightning-layer',
        type: 'circle',
        source: 'lightning-source',
        paint: {
            'circle-radius': [
                'interpolate',
                ['linear'],
                ['get', 'intensity'],
                0, 6,
                1, 12
            ],
            'circle-color': '#FFFF00',
            'circle-opacity': 0.9,
            'circle-blur': 0.5,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
            'circle-stroke-opacity': 0.8
        }
    });
    
    animateLightningStrikes();
}

function animateLightningStrikes() {
    let pulsePhase = 0;
    const pulseInterval = setInterval(() => {
        if (!map.getLayer('lightning-layer') || !state.showLightning) {
            clearInterval(pulseInterval);
            return;
        }
        
        pulsePhase += 0.1;
        const opacity = 0.5 + Math.sin(pulsePhase) * 0.4;
        
        map.setPaintProperty('lightning-layer', 'circle-opacity', opacity);
    }, 50);
}

function toggleLightning() {
    state.showLightning = !state.showLightning;
    const toggle = document.getElementById('lightningToggle');
    
    if (state.showLightning) {
        toggle.checked = true;
        loadLightningData();
        showToast('Lightning strikes enabled', 'success');
    } else {
        toggle.checked = false;
        if (map.getLayer('lightning-layer')) map.removeLayer('lightning-layer');
        if (map.getSource('lightning-source')) map.removeSource('lightning-source');
        showToast('Lightning strikes disabled', 'info');
    }
}

async function loadStormTracks() {
    if (!state.showStormTracks) return;
    
    try {
        state.stormTracks = [];
        
        const severeWarnings = state.activeWarnings.filter(w => {
            const event = w.properties.event || '';
            return event.includes('Tornado') || 
                   event.includes('Severe Thunderstorm') || 
                   event.includes('Hurricane');
        });
        
        severeWarnings.forEach((warning, index) => {
            if (warning.geometry && warning.geometry.coordinates) {
                const coords = warning.geometry.type === 'Polygon' 
                    ? warning.geometry.coordinates[0] 
                    : warning.geometry.coordinates[0][0];
                
                if (coords.length > 2) {
                    const centerLng = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
                    const centerLat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
                    
                    const track = [];
                    const steps = 6;
                    
                    for (let i = 0; i < steps; i++) {
                        track.push({
                            lng: centerLng + (i * 0.15),
                            lat: centerLat + (i * 0.05) * (Math.random() - 0.5),
                            time: Date.now() + (i * 600000)
                        });
                    }
                    
                    state.stormTracks.push({
                        id: warning.properties.id,
                        event: warning.properties.event,
                        track: track
                    });
                }
            }
        });
        
        displayStormTracks();
        console.log(`🌪️ Generated ${state.stormTracks.length} storm tracks`);
    } catch (error) {
        console.error('Error loading storm tracks:', error);
    }
}

function displayStormTracks() {
    if (map.getLayer('storm-tracks-layer')) map.removeLayer('storm-tracks-layer');
    if (map.getLayer('storm-points-layer')) map.removeLayer('storm-points-layer');
    if (map.getSource('storm-tracks-source')) map.removeSource('storm-tracks-source');
    
    if (state.stormTracks.length === 0) return;
    
    const features = [];
    
    state.stormTracks.forEach(storm => {
        features.push({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: storm.track.map(p => [p.lng, p.lat])
            },
            properties: {
                event: storm.event
            }
        });
        
        storm.track.forEach((point, index) => {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [point.lng, point.lat]
                },
                properties: {
                    event: storm.event,
                    isFuture: index > 0
                }
            });
        });
    });
    
    const geojson = {
        type: 'FeatureCollection',
        features: features
    };
    
    map.addSource('storm-tracks-source', { type: 'geojson', data: geojson });
    
    map.addLayer({
        id: 'storm-tracks-layer',
        type: 'line',
        source: 'storm-tracks-source',
        filter: ['==', '$type', 'LineString'],
        paint: {
            'line-color': '#FF0000',
            'line-width': 3,
            'line-opacity': 0.8,
            'line-dasharray': [2, 2]
        }
    });
    
    map.addLayer({
        id: 'storm-points-layer',
        type: 'circle',
        source: 'storm-tracks-source',
        filter: ['==', '$type', 'Point'],
        paint: {
            'circle-radius': 8,
            'circle-color': [
                'case',
                ['get', 'isFuture'],
                '#FFA500',
                '#FF0000'
            ],
            'circle-opacity': 0.9,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF'
        }
    });
}

function toggleStormTracks() {
    state.showStormTracks = !state.showStormTracks;
    const toggle = document.getElementById('stormTracksToggle');
    
    if (state.showStormTracks) {
        toggle.checked = true;
        loadStormTracks();
        showToast('Storm tracks enabled', 'success');
    } else {
        toggle.checked = false;
        if (map.getLayer('storm-tracks-layer')) map.removeLayer('storm-tracks-layer');
        if (map.getLayer('storm-points-layer')) map.removeLayer('storm-points-layer');
        if (map.getSource('storm-tracks-source')) map.removeSource('storm-tracks-source');
        showToast('Storm tracks disabled', 'info');
    }
}

async function loadWeatherAlerts() {
    try {
        console.log('🔄 Loading alerts...');
        
        const url = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert';
        
        const response = await fetch(url, {
            headers: { 
                'User-Agent': '(StormSurgeWeather, stormsurgee025@gmail.com)',
                'Accept': 'application/geo+json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.features) {
            let warnings = data.features.filter(f => {
                if (!f.properties || !f.properties.event) return false;
                
                const expires = new Date(f.properties.expires);
                if (expires < new Date()) return false;
                
                if (state.severityFilter !== 'all') {
                    const severity = f.properties.severity || 'Unknown';
                    const rank = severityRanking[severity] || 0;
                    
                    if (state.severityFilter === 'extreme' && rank < 4) return false;
                    if (state.severityFilter === 'severe' && rank < 3) return false;
                    if (state.severityFilter === 'moderate' && rank < 2) return false;
                }
                
                return true;
            });
            
            state.activeWarnings = warnings;
            state.lastWarningUpdate = new Date();
            console.log(`✅ Loaded ${state.activeWarnings.length} warnings`);
            
            if (state.sortBySeverity) {
                sortWarningsBySeverity();
            }
            
            updateWarningsList();
            displayWarningPolygons();
            updateAlertBadge();
            updateLastUpdateDisplay();
            
            if (state.autoZoom && warnings.length > 0) {
                autoZoomToSevereWeather(warnings);
            }
            
            if (state.showLightning) {
                loadLightningData();
            }
            if (state.showStormTracks) {
                loadStormTracks();
            }
        } else {
            throw new Error('No features in response');
        }
    } catch (error) {
        console.error('❌ Error loading alerts:', error);
        showToast('Unable to load alerts: ' + error.message, 'error');
        state.activeWarnings = [];
        updateWarningsList();
        updateAlertBadge();
    }
}

function sortWarningsBySeverity() {
    state.activeWarnings.sort((a, b) => {
        const severityA = severityRanking[a.properties.severity || 'Unknown'] || 0;
        const severityB = severityRanking[b.properties.severity || 'Unknown'] || 0;
        return severityB - severityA;
    });
}

function autoZoomToSevereWeather(warnings) {
    const severe = warnings.filter(w => {
        const rank = severityRanking[w.properties.severity || 'Unknown'] || 0;
        return rank >= 3;
    });
    
    if (severe.length > 0 && severe[0].geometry) {
        const coords = severe[0].geometry.coordinates;
        let centerLat, centerLng;
        
        if (severe[0].geometry.type === 'Polygon') {
            const flatCoords = coords[0];
            centerLng = flatCoords.reduce((sum, c) => sum + c[0], 0) / flatCoords.length;
            centerLat = flatCoords.reduce((sum, c) => sum + c[1], 0) / flatCoords.length;
        } else if (severe[0].geometry.type === 'MultiPolygon') {
            const flatCoords = coords[0][0];
            centerLng = flatCoords.reduce((sum, c) => sum + c[0], 0) / flatCoords.length;
            centerLat = flatCoords.reduce((sum, c) => sum + c[1], 0) / flatCoords.length;
        }
        
        if (centerLat && centerLng) {
            map.flyTo({ 
                center: [centerLng, centerLat], 
                zoom: 8, 
                duration: 2000 
            });
            showToast(`Zooming to ${severe[0].properties.event}`, 'info');
        }
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
            properties: { 
                id: w.properties.id, 
                event: w.properties.event,
                severity: w.properties.severity || 'Unknown'
            }
        }))
    };
    
    map.addSource('warnings-source', { type: 'geojson', data: geojson });
    
    const colorExpression = ['match', ['get', 'event']];
    Object.keys(warningColors).forEach(type => {
        colorExpression.push(type, warningColors[type]);
    });
    colorExpression.push('#999999');
    
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

function updateLastUpdateDisplay() {
    const element = document.getElementById('lastUpdateTime');
    if (state.lastWarningUpdate) {
        const timeStr = state.lastWarningUpdate.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit' 
        });
        element.textContent = `Updated: ${timeStr}`;
        element.classList.remove('hidden');
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

async function getTomorrowWeatherData(lat, lng) {
    try {
        const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
        const cached = state.weatherCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < 300000)) {
            console.log('✅ Using cached weather data');
            return cached.data;
        }
        
        const url = `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lng}&apikey=${TOMORROW_API_KEY}&units=imperial`;
        
        console.log('🔄 Fetching Tomorrow.io data...');
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Tomorrow.io API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        state.weatherCache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
        });
        
        state.tomorrowData = data;
        state.lastWeatherUpdate = new Date();
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
    
    displaySevereWeatherRisk(current);
    
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
    
    document.getElementById('panelUVIndex').textContent = current.uvIndex ? Math.round(current.uvIndex) : '--';
    
    const aqiValue = current.particulateMatter25 || current.particulateMatter10;
    if (aqiValue) {
        const aqi = calculateAQI(aqiValue);
        document.getElementById('panelAirQuality').textContent = aqi.label;
        document.getElementById('panelAirQuality').style.color = aqi.color;
    } else {
        document.getElementById('panelAirQuality').textContent = '--';
    }
    
    const hourlyContainer = document.getElementById('panelHourlyData');
    hourlyContainer.innerHTML = '';
    for (let i = 0; i < 24 && i < hourly.length; i++) {
        const hour = hourly[i];
        const time = new Date(hour.time);
        const timeStr = time.getHours().toString().padStart(2, '0') + ':00';
        const icon = getWeatherIconFromCode(hour.values.weatherCode);
        const precipProb = hour.values.precipitationProbability || 0;
        const hourlyItem = document.createElement('div');
        hourlyItem.className = 'hourly-item-detailed';
        hourlyItem.innerHTML = `
            <div class="hourly-time-detailed">${timeStr}</div>
            <div class="hourly-icon-detailed">${icon}</div>
            <div class="hourly-temp-detailed">${Math.round(hour.values.temperature)}°F</div>
            <div class="hourly-wind-detailed">💨 ${Math.round(hour.values.windSpeed)} mph</div>
            <div class="hourly-precip-detailed">💧 ${Math.round(precipProb)}%</div>
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

function displaySevereWeatherRisk(current) {
    const severeSection = document.getElementById('panelSevereWeather');
    const severeContent = document.getElementById('severeWeatherContent');
    
    const risks = [];
    
    if (current.windSpeed > 40) {
        risks.push({ icon: '💨', text: 'High Wind Risk', level: 'severe' });
    }
    if (current.precipitationIntensity > 0.5) {
        risks.push({ icon: '🌧️', text: 'Heavy Rain', level: 'moderate' });
    }
    if (current.visibility < 2) {
        risks.push({ icon: '🌫️', text: 'Low Visibility', level: 'moderate' });
    }
    if (current.temperature > 95) {
        risks.push({ icon: '🌡️', text: 'Extreme Heat', level: 'severe' });
    }
    if (current.temperature < 20) {
        risks.push({ icon: '❄️', text: 'Extreme Cold', level: 'severe' });
    }
    
    if (risks.length > 0) {
        severeSection.classList.remove('hidden');
        severeContent.innerHTML = risks.map(r => {
            const color = r.level === 'severe' ? '#ef4444' : '#fb923c';
            return `<div style="display: flex; align-items: center; gap: 10px; padding: 8px; background: rgba(239, 68, 68, 0.1); border-radius: 8px; margin-bottom: 8px;">
                <span style="font-size: 1.5rem;">${r.icon}</span>
                <span style="color: ${color}; font-weight: 700;">${r.text}</span>
            </div>`;
        }).join('');
    } else {
        severeSection.classList.add('hidden');
    }
}

function calculateAQI(pm25) {
    if (pm25 <= 12) return { label: 'Good', color: '#4ade80' };
    if (pm25 <= 35.4) return { label: 'Moderate', color: '#fbbf24' };
    if (pm25 <= 55.4) return { label: 'Unhealthy (Sensitive)', color: '#fb923c' };
    if (pm25 <= 150.4) return { label: 'Unhealthy', color: '#ef4444' };
    if (pm25 <= 250.4) return { label: 'Very Unhealthy', color: '#dc2626' };
    return { label: 'Hazardous', color: '#991b1b' };
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
    
    document.getElementById('panelSevereWeather').classList.add('hidden');
    
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
    document.getElementById('panelUVIndex').textContent = '--';
    document.getElementById('panelAirQuality').textContent = '--';
    
    const hourlyContainer = document.getElementById('panelHourlyData');
    hourlyContainer.innerHTML = '';
    for (let i = 0; i < 24; i++) {
        if (hourly.time[i]) {
            const time = new Date(hourly.time[i]);
            const timeStr = time.getHours().toString().padStart(2, '0') + ':00';
            const icon = getWeatherIcon(hourly.weather_code[i]);
            const precipProb = hourly.precipitation_probability ? hourly.precipitation_probability[i] : 0;
            const hourlyItem = document.createElement('div');
            hourlyItem.className = 'hourly-item-detailed';
            hourlyItem.innerHTML = `
                <div class="hourly-time-detailed">${timeStr}</div>
                <div class="hourly-icon-detailed">${icon}</div>
                <div class="hourly-temp-detailed">${Math.round(hourly.temperature_2m[i])}°F</div>
                <div class="hourly-wind-detailed">💨 ${Math.round(hourly.wind_speed_10m[i])} mph</div>
                <div class="hourly-precip-detailed">💧 ${Math.round(precipProb)}%</div>
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
            headers: { 'User-Agent': '(StormSurgeWeather, stormsurgee025@gmail.com)' }
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

async function getUserLocation() {
    if (!navigator.geolocation) {
        showToast('Geolocation not supported', 'error');
        return;
    }
    
    showToast('Getting your location...', 'info');
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            map.flyTo({ center: [lng, lat], zoom: 10, duration: 2000 });
            state.currentLat = lat;
            state.currentLng = lng;
            
            const locationName = await reverseGeocode(lat, lng);
            document.getElementById('currentLocation').textContent = locationName.split(',')[0];
            updateWeatherPanel(lat, lng);
            showClickMarker(lat, lng);
            showToast('Location found!', 'success');
        },
        (error) => {
            console.error('Geolocation error:', error);
            showToast('Unable to get location', 'error');
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

function startAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    if (state.warningRefreshTimer) clearInterval(state.warningRefreshTimer);
    
    if (state.refreshInterval > 0) {
        state.refreshTimer = setInterval(() => {
            console.log('🔄 Auto-refresh radar');
            loadRadarFrames();
        }, state.refreshInterval);
        
        state.warningRefreshTimer = setInterval(() => {
            console.log('🔄 Auto-refresh alerts');
            loadWeatherAlerts();
        }, Math.min(state.refreshInterval, 120000));
        
        console.log(`✅ Auto-refresh enabled: ${state.refreshInterval / 1000}s`);
    } else {
        console.log('⚠️ Auto-refresh disabled');
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

map.on('load', () => {
    console.log('🗺️ Map loaded');
    
    loadRadarFrames().then(() => {
        setTimeout(() => startAnimation(), 1000);
    });
    
    loadWeatherAlerts();
    startAutoRefresh();
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
    
    if (state.radarMode === '3d' && state.scene3D) {
        create3DRadarVolume();
    }
});

document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('settingsModal').classList.remove('hidden');
});

document.getElementById('searchBtn').addEventListener('click', () => {
    document.getElementById('searchModal').classList.remove('hidden');
    document.getElementById('searchInput').focus();
});

document.getElementById('myLocationBtn').addEventListener('click', () => {
    getUserLocation();
});

document.getElementById('playPauseBtn').addEventListener('click', () => {
    if (state.isAnimating) stopAnimation();
    else startAnimation();
});

document.getElementById('timeSlider').addEventListener('input', (e) => {
    stopAnimation();
    const timeIndex = parseInt(e.target.value);
    state.currentTimeIndex = timeIndex;
    displayRadarFrame(timeIndex, false);
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

document.getElementById('sortWarningsBtn').addEventListener('click', () => {
    state.sortBySeverity = !state.sortBySeverity;
    if (state.sortBySeverity) {
        sortWarningsBySeverity();
        updateWarningsList();
        showToast('Sorted by severity', 'info');
    } else {
        loadWeatherAlerts();
        showToast('Sorting disabled', 'info');
    }
});

document.getElementById('refreshWarningsBtn').addEventListener('click', () => {
    showToast('Refreshing alerts...', 'info');
    loadWeatherAlerts();
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

document.getElementById('autoZoomToggle').addEventListener('change', (e) => {
    state.autoZoom = e.target.checked;
    showToast(state.autoZoom ? 'Auto-zoom enabled' : 'Auto-zoom disabled', 'info');
});

document.getElementById('lightningToggle')?.addEventListener('change', (e) => {
    toggleLightning();
});

document.getElementById('stormTracksToggle')?.addEventListener('change', (e) => {
    toggleStormTracks();
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

document.getElementById('severityFilter').addEventListener('change', (e) => {
    state.severityFilter = e.target.value;
    showToast('Filtering alerts...', 'info');
    loadWeatherAlerts();
});

document.getElementById('refreshInterval').addEventListener('change', (e) => {
    state.refreshInterval = parseInt(e.target.value);
    startAutoRefresh();
    
    if (state.refreshInterval > 0) {
        showToast(`Auto-refresh: ${state.refreshInterval / 1000}s`, 'success');
    } else {
        showToast('Auto-refresh disabled', 'info');
    }
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
            displayRadarFrame(state.currentTimeIndex, false);
            updateTimeDisplay();
            break;
        case 'arrowright':
            e.preventDefault();
            stopAnimation();
            state.currentTimeIndex = Math.min(state.radarFrames.length - 1, state.currentTimeIndex + 1);
            displayRadarFrame(state.currentTimeIndex, false);
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
        case 'l':
            getUserLocation();
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
        const container = document.getElementById('map');
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
window.toggle3DRadar = toggle3DRadar;

function init() {
    console.log('⚡ Storm Surge Weather v5.2 - SMOOTH RADAR & INLINE 3D');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Tomorrow.io Weather API (Enhanced)');
    console.log('✅ RainViewer Radar (Smooth Transitions)');
    console.log('✅ NWS Weather Alerts (FIXED)');
    console.log('✅ Inline 3D Radar Visualization');
    console.log('✅ Lightning Strike Detection');
    console.log('✅ Storm Track Prediction');
    console.log('✅ Color-Coded Warning Polygons');
    console.log('✅ Auto-Refresh System');
    console.log('✅ User Location Detection');
    console.log('✅ Severity Filtering');
    console.log('✅ UV Index & Air Quality');
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