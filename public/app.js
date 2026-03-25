// ================================================================
//  STORM SURGE WEATHER v13.9 — Main App
// ================================================================

const S = {
  map: null, canvas: null, drawCanvas: null, drawCtx: null,
  drawing: false, drawMode: false, drawStrokes: [], drawColor: '#f59e0b', drawSize: 3,
  lat: 40.7128, lng: -74.006, locName: 'New York',
  frames: [], nowcastFrames: [], frame: 0, playing: false, showingNowcast: false,
  alerts: [], weather: null, aqi: null, spotterReports: [],
  stormReports: [], rightTab: 'alerts', alertFilter: 'all', alertQuery: '',
  fcMode: 'hourly', mapStyle: 'dark', favorites: [],
  cfg: {
    tempUnit:'C', windUnit:'ms', distUnit:'km', timeFormat:'12',
    opacity:.75, speed:600, autoPlay:false, nowcast:true,
    alertZones:true, crosshair:true, clickNWS:true, animBg:true,
    radarColor:'6', cardPos:'tl', ai:true,
    theme:'dark',
  }
};

const API = (window.SS_API_URL || window.location.origin || '').replace(/\/$/, '');

const MAP_STYLES = {
  dark:'mapbox://styles/mapbox/navigation-night-v1',
  satellite:'mapbox://styles/mapbox/satellite-streets-v12',
  outdoors:'mapbox://styles/mapbox/outdoors-v12',
  light:'mapbox://styles/mapbox/navigation-day-v1',
  streets:'mapbox://styles/mapbox/streets-v12',
};
const STYLE_ORDER = ['dark','satellite','outdoors','light','streets'];

// ── BOOT ────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  loadCfg(); loadFavs();
  applyTheme(S.cfg.theme);
  initUI();
  initDrawMode();
  updateDate();
  setInterval(updateDate, 30000);
  setInterval(() => { loadWeather(); loadAlerts(); }, 600000);
  setInterval(() => { if (window.SpotterNetwork?.isVisible()) SpotterNetwork.refresh(S.lat, S.lng); }, 300000);
  if (window.NWSsocial) NWSsocial.init();
  try { await window._tokenReady; } catch(e) {}
  initMap();
});

// ── UTILS ────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const st = (id, v) => { const e = $(id); if (e) e.textContent = v; };
const p2 = n => String(n).padStart(2, '0');

function fmtT(d, sh) {
  if (S.cfg.timeFormat === '24') return p2(d.getHours()) + ':' + p2(d.getMinutes());
  const h = d.getHours() % 12 || 12, ap = d.getHours() >= 12 ? 'PM' : 'AM';
  return sh ? h + ap : h + ':' + p2(d.getMinutes()) + ' ' + ap;
}
function fmtDT(d) { return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' ' + fmtT(d); }
function cvtT(c) { if (!Number.isFinite(c)) return '--'; return S.cfg.tempUnit==='F' ? Math.round(c*9/5+32) : Math.round(c); }
function cvtW(ms) {
  if (!Number.isFinite(ms)) return '--';
  if (S.cfg.windUnit==='kmh') return (ms*3.6).toFixed(1);
  if (S.cfg.windUnit==='mph') return (ms*2.237).toFixed(1);
  if (S.cfg.windUnit==='kts') return (ms*1.944).toFixed(1);
  return ms.toFixed(1);
}
function wu() { return {ms:'m/s',kmh:'km/h',mph:'mph',kts:'kts'}[S.cfg.windUnit]||'m/s'; }
function cvtD(km) { if (!Number.isFinite(km)) return '--'; return S.cfg.distUnit==='mi' ? (km*.621).toFixed(1)+' mi' : km.toFixed(1)+' km'; }
function wDir(d) { if (!Number.isFinite(d)) return '--'; return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(d/22.5)%16]; }
function uvLbl(u) { if (!Number.isFinite(u)) return ''; if(u<=2)return'Low';if(u<=5)return'Moderate';if(u<=7)return'High';if(u<=10)return'Very High';return'Extreme'; }
function uvClr(u) { if(!Number.isFinite(u))return'var(--t3)';if(u<=2)return'#22c55e';if(u<=5)return'#f59e0b';if(u<=7)return'#f97316';if(u<=10)return'#ef4444';return'#a855f7'; }
function wIcon(c) {
  const m={0:'☀️',1:'🌤',2:'⛅',3:'☁️',45:'🌫',48:'🌫',51:'🌦',53:'🌦',55:'🌧',56:'🌨',57:'🌨',61:'🌧',63:'🌧',65:'🌧',71:'🌨',73:'🌨',75:'❄️',77:'🌨',80:'🌦',81:'🌦',82:'🌧',85:'🌨',86:'❄️',95:'⛈',96:'⛈',99:'⛈'};
  return m[c]||'🌡';
}
function wDesc(c) {
  const m={0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Icy fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Rain showers',81:'Heavy showers',82:'Violent showers',85:'Snow showers',86:'Heavy snow showers',95:'Thunderstorm',96:'T-storm w/ hail',99:'T-storm w/ heavy hail'};
  return m[c]||'Unknown';
}
function moonPhase(date) {
  const diff = (date - new Date('2000-01-06T18:14:00Z')) / 86400000;
  const phase = ((diff % 29.53) + 29.53) % 29.53;
  const idx = Math.round(phase / 29.53 * 8) % 8;
  return ['🌑 New Moon','🌒 Waxing Crescent','🌓 First Quarter','🌔 Waxing Gibbous','🌕 Full Moon','🌖 Waning Gibbous','🌗 Last Quarter','🌘 Waning Crescent'][idx];
}
function heatIndex(t, rh) {
  const f = t*9/5+32; if(f<80||rh<40)return null;
  const hi=-42.379+2.049*f+10.143*rh-.2247*f*rh-.00683*f*f-.0548*rh*rh+.00122*f*f*rh+.000853*f*rh*rh-.00000199*f*f*rh*rh;
  return (hi-32)*5/9;
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function updateDate() {
  const n=new Date();
  st('datePill', n.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}));
  st('locDate', fmtT(n));
  st('wcTime', fmtT(n));
}
let _tt; function toast(msg, dur=3000) { const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(_tt);_tt=setTimeout(()=>t.classList.remove('show'),dur); }
function loader(v) { $('loader').classList.toggle('show',v); }

// ── THEME ────────────────────────────────────────────────────────
function applyTheme(t) {
  S.cfg.theme=t;
  document.documentElement.setAttribute('data-theme',t);
  st('themeIco', t==='dark'?'🌙':'☀️');
  st('themeLbl', t==='dark'?'Dark Mode':'Light Mode');
}
function updateBg(code, isDay) {
  const el=$('bgAnim'); if(!el)return;
  if(!S.cfg.animBg){el.style.opacity='0';return;}
  el.style.opacity='1';
  el.className='bg-anim' + (code>=95?' storm':code>=61?' rain':'');
}

// ── MAP ─────────────────────────────────────────────────────────
function initMap() {
  S.canvas = $('radarCanvas');
  window.addEventListener('resize', resizeCanvas);

  if (!window.MAPBOX_TOKEN) {
    showMapErr('Mapbox token missing — set MAPBOX_TOKEN in .env');
    loadWeather(); loadAlerts(); return;
  }

  try {
    mapboxgl.accessToken = window.MAPBOX_TOKEN;
    S.map = new mapboxgl.Map({
      container: 'map',
      style: MAP_STYLES[S.cfg.theme==='light'?'light':'dark'],
      center: [S.lng, S.lat], zoom: 6,
      minZoom:2, maxZoom:14,
      attributionControl:false, logoPosition:'bottom-left',
      failIfMajorPerformanceCaveat:false, renderWorldCopies:false, antialias:true
    });

    S.map.on('load', () => {
      S.map.resize(); resizeCanvas();

      if (window.RadarAnimator) {
        RadarAnimator.init(S.map, S.canvas, {
          apiBase:API, opacity:S.cfg.opacity||.75, color:S.cfg.radarColor||'6',
          speed:S.cfg.speed||600, smooth:true, nowcast:S.cfg.nowcast
        });
        RadarAnimator.onFrameChange = idx => {
          S.frame=idx; S.frames=RadarAnimator._frames;
          updateSlots(idx);
          const tr=$('tRange'); if(tr)tr.value=idx;
          $('nowcastBadge').style.display=(S.cfg.nowcast&&idx>=S.frames.length)?'block':'none';
        };
        RadarAnimator.onPlayStateChange = p => {
          S.playing=p;
          $('playBtn').textContent=p?'⏸':'▶';
          $('playBtn').classList.toggle('playing',p);
        };
      }

      if (window.NexradRadar) NexradRadar.init(S.map, API);
      if (window.NexradPanel) { NexradPanel.init(API); NexradPanel.preloadNearby(S.lat,S.lng); }
      if (window.SpotterNetwork) {
        SpotterNetwork.init(S.map, API);
        SpotterNetwork.onUpdate = r => { S.spotterReports=r; };
      }
      if (window.SeverePanel) SeverePanel.init(API);
      if (window.AIPanel) {
        AIPanel.init(API, ()=>({lat:S.lat,lng:S.lng,location:S.locName,weather:S.weather,alerts:S.alerts,spotterReports:S.spotterReports.slice(0,20)}));
      }

      loadRadar(); loadWeather(); loadAlerts();
    });

    S.map.on('error', e => console.warn('Mapbox non-fatal:', e?.error?.message||e));
    S.map.on('click', e => { if (!S.drawMode) handleClick(e); });

  } catch(e) {
    showMapErr('Map init failed: '+e.message);
    loadWeather(); loadAlerts();
  }
}

function showMapErr(msg) {
  $('map').innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;color:#f59e0b;text-align:center;padding:24px"><div style="font-size:3rem">⛈</div><div style="font-size:.85rem;font-weight:600">${msg}</div></div>`;
}

function cycleStyle() {
  if(!S.map)return;
  const i=STYLE_ORDER.indexOf(S.mapStyle);
  S.mapStyle=STYLE_ORDER[(i+1)%STYLE_ORDER.length];
  S.map.setStyle(MAP_STYLES[S.mapStyle]);
  S.map.once('style.load',()=>{
    if(S.cfg.alertZones&&S.alerts.length)putAlertsOnMap();
    if(window.RadarAnimator)RadarAnimator.refresh();
    if(window.NexradRadar?.isVisible()){const st=NexradRadar._station,pr=NexradRadar._product;if(st){NexradRadar.hide();NexradRadar.show(st.id,pr,st);}}
    toast('🗺 '+S.mapStyle.charAt(0).toUpperCase()+S.mapStyle.slice(1));
  });
}

function resizeCanvas() {
  const mz=$('mapzone');
  const w=mz?mz.clientWidth:window.innerWidth, h=mz?mz.clientHeight:window.innerHeight;
  [S.canvas, S.drawCanvas].forEach(c=>{if(!c)return;c.width=w;c.height=h;});
  if(window.RadarAnimator)RadarAnimator.resize();
}

// ── DRAW ────────────────────────────────────────────────────────
function initDrawMode() {
  S.drawCanvas=$('drawCanvas'); S.drawCtx=S.drawCanvas.getContext('2d');
  const mp=e=>{const r=S.drawCanvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
  const tp=e=>{const r=S.drawCanvas.getBoundingClientRect();return{x:e.touches[0].clientX-r.left,y:e.touches[0].clientY-r.top};};
  const sty=()=>{S.drawCtx.strokeStyle=S.drawColor;S.drawCtx.lineWidth=S.drawSize;S.drawCtx.lineCap='round';S.drawCtx.lineJoin='round';};
  S.drawCanvas.addEventListener('mousedown',e=>{if(!S.drawMode)return;S.drawing=true;const p=mp(e);S.drawCtx.beginPath();S.drawCtx.moveTo(p.x,p.y);S.drawStrokes.push({color:S.drawColor,size:S.drawSize,pts:[p]});});
  S.drawCanvas.addEventListener('mousemove',e=>{if(!S.drawMode||!S.drawing)return;const p=mp(e);sty();S.drawCtx.lineTo(p.x,p.y);S.drawCtx.stroke();S.drawStrokes[S.drawStrokes.length-1].pts.push(p);});
  ['mouseup','mouseleave'].forEach(ev=>S.drawCanvas.addEventListener(ev,()=>S.drawing=false));
  S.drawCanvas.addEventListener('touchstart',e=>{if(!S.drawMode)return;e.preventDefault();S.drawing=true;const p=tp(e);S.drawCtx.beginPath();S.drawCtx.moveTo(p.x,p.y);S.drawStrokes.push({color:S.drawColor,size:S.drawSize,pts:[p]});},{passive:false});
  S.drawCanvas.addEventListener('touchmove',e=>{if(!S.drawMode||!S.drawing)return;e.preventDefault();const p=tp(e);sty();S.drawCtx.lineTo(p.x,p.y);S.drawCtx.stroke();S.drawStrokes[S.drawStrokes.length-1].pts.push(p);},{passive:false});
  S.drawCanvas.addEventListener('touchend',()=>S.drawing=false);
}
function enterDraw(){S.drawMode=true;S.drawCanvas.style.pointerEvents='all';S.drawCanvas.style.cursor='crosshair';$('drawToolbar').classList.add('show');$('drawBtn').classList.add('active');if(S.map)S.map.dragPan.disable();toast('✏ Draw mode');}
function exitDraw(){S.drawMode=false;S.drawing=false;S.drawCanvas.style.pointerEvents='none';S.drawCanvas.style.cursor='';$('drawToolbar').classList.remove('show');$('drawBtn').classList.remove('active');if(S.map)S.map.dragPan.enable();}
function undoDraw(){if(!S.drawStrokes.length)return;S.drawStrokes.pop();S.drawCtx.clearRect(0,0,S.drawCanvas.width,S.drawCanvas.height);S.drawStrokes.forEach(s=>{if(s.pts.length<2)return;S.drawCtx.beginPath();S.drawCtx.moveTo(s.pts[0].x,s.pts[0].y);S.drawCtx.strokeStyle=s.color;S.drawCtx.lineWidth=s.size;S.drawCtx.lineCap='round';S.drawCtx.lineJoin='round';s.pts.forEach((p,i)=>{if(i>0)S.drawCtx.lineTo(p.x,p.y);});S.drawCtx.stroke();});}
function clearDraw(){S.drawStrokes=[];S.drawCtx.clearRect(0,0,S.drawCanvas.width,S.drawCanvas.height);}

// ── MAP CLICK ────────────────────────────────────────────────────
function handleClick(e) {
  const {lat,lng}=e.lngLat;
  if(S.map.getSource?.('alerts-src')){
    const hits=S.map.queryRenderedFeatures(e.point,{layers:['alert-fill']});
    if(hits.length){const idx=S.alerts.findIndex(a=>a.properties.event===hits[0].properties.event);if(idx>=0){openAlertModal(idx);return;}}
  }
  S.lat=lat; S.lng=lng;
  reverseGeo(lat,lng);
  if(S.cfg.clickNWS){toast('📡 Fetching NWS…');fetchNWS(lat,lng);}
  else loadWeather();
}

async function fetchNWS(lat,lng){
  try{
    const r=await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`,{headers:{'User-Agent':'(StormSurgeWeather/13.9)','Accept':'application/geo+json'}});
    if(!r.ok)throw new Error();
    const pt=await r.json();
    if(!pt.properties?.forecast)throw new Error('Outside NWS coverage');
    const [fc,hr]=await Promise.allSettled([fetch(pt.properties.forecast,{headers:{'User-Agent':'(StormSurgeWeather/13.9)'}}),fetch(pt.properties.forecastHourly,{headers:{'User-Agent':'(StormSurgeWeather/13.9)'}})]]);
    openNWSModal(pt.properties, fc.status==='fulfilled'&&fc.value.ok?await fc.value.json():null, hr.status==='fulfilled'&&hr.value.ok?await hr.value.json():null);
  }catch(e){toast('⚠ NWS: US only');loadWeather();}
}

function openNWSModal(p,fc,hr){
  const city=p.relativeLocation?.properties?.city||S.locName;
  const state=p.relativeLocation?.properties?.state||'';
  const hP=hr?.properties?.periods?.slice(0,12)||[];
  const n=hP[0];
  st('mTitle','📡 NWS — '+city+(state?', '+state:''));
  $('mBody').innerHTML=
    '<div class="nws-header"><div><span class="nws-badge">'+esc(p.cwa||'NWS')+'</span></div>'+(n?'<div class="nws-now"><div class="nws-now-temp">'+esc(n.temperature+'°'+n.temperatureUnit)+'</div><div class="nws-now-desc">'+esc(n.shortForecast)+'</div></div>':'')+'</div>'+
    (hP.length?'<div class="nws-stitle">Hourly</div><div class="nws-hourly">'+hP.map(p=>'<div class="nws-hr"><div class="nws-hr-t">'+fmtT(new Date(p.startTime),true)+'</div><div class="nws-hr-i">'+(p.isDaytime?'☀️':'🌙')+'</div><div class="nws-hr-v">'+p.temperature+'°</div><div class="nws-hr-r">'+(p.probabilityOfPrecipitation?.value??0)+'%</div></div>').join('')+'</div>':'')+
    (fc?.properties?.periods?.length?'<div class="nws-stitle">Extended</div><div class="nws-periods">'+fc.properties.periods.slice(0,8).map(p=>'<div class="nws-period '+(p.isDaytime?'day':'night')+'"><div class="nws-pd-name">'+esc(p.name)+'</div><div class="nws-pd-temp">'+p.temperature+'°'+(p.probabilityOfPrecipitation?.value!=null?'<span class="nws-pd-rain">💧'+p.probabilityOfPrecipitation.value+'%</span>':'')+'</div><div class="nws-pd-short">'+esc(p.shortForecast)+'</div></div>').join('')+'</div>':'');
  openModal('alertModal');
}

// ── RADAR ────────────────────────────────────────────────────────
async function loadRadar(){
  try{
    const r=await fetch(`${API}/api/radar/frames`);
    if(!r.ok)throw new Error();
    const d=await r.json();
    S.frames=d.past||[];
    S.nowcastFrames=S.cfg.nowcast?(d.nowcast||[]):[];
    if(!S.frames.length)throw new Error('No frames');
    S.frame=S.frames.length-1;
    buildSlots(); resizeCanvas();
    if(window.RadarAnimator){RadarAnimator.setFrames(S.frames,S.nowcastFrames);RadarAnimator.goTo(S.frame);if(S.cfg.autoPlay)RadarAnimator.play();}
  }catch(e){console.warn('Radar:',e.message);toast('⚠ Radar unavailable');}
}
function allF(){return S.showingNowcast?[...S.frames,...S.nowcastFrames]:S.frames;}
function buildSlots(){
  const frames=allF(); const c=$('tSlots');if(!c)return;
  c.innerHTML='';
  frames.forEach((f,i)=>{
    const d=new Date(f.time*1000),btn=document.createElement('button');
    btn.className='tslot'+(i===S.frame?' active':'')+(i>=S.frames.length?' nowcast':'');
    btn.textContent=i>=S.frames.length?'+'+(i-S.frames.length+1)*10+'m':fmtT(d,true);
    btn.title=i>=S.frames.length?'Nowcast +'+((i-S.frames.length+1)*10)+'min':d.toLocaleTimeString();
    btn.onclick=()=>goFrame(i);
    c.appendChild(btn);
  });
}
function updateSlots(idx){document.querySelectorAll('.tslot').forEach((s,j)=>s.classList.toggle('active',j===idx));}
function goFrame(i){S.frame=Math.max(0,Math.min(allF().length-1,i));updateSlots(i);if(window.RadarAnimator)RadarAnimator.goTo(i);}
function togglePlay(){if(window.RadarAnimator)RadarAnimator.togglePlay();}
function toggleNowcast(){
  if(!S.nowcastFrames.length){toast('⚠ Nowcast unavailable');return;}
  S.showingNowcast=!S.showingNowcast;
  if(window.RadarAnimator)RadarAnimator.setFrames(S.frames,S.showingNowcast?S.nowcastFrames:[]);
  buildSlots();toast(S.showingNowcast?'🟢 Nowcast ON':'Nowcast OFF');
}

// ── WEATHER ─────────────────────────────────────────────────────
async function loadWeather(){
  loader(true);
  try{
    const r=await fetch(`${API}/api/weather?lat=${S.lat}&lng=${S.lng}`);
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();
    S.weather=d;
    renderWeather(d);
    renderForecast(d);
    updateBg(d.current?.weather_code,d.current?.is_day);
    loadAQI();
    refreshWidgets(d);
    if(window.NexradPanel)NexradPanel.updateLocation(S.lat,S.lng);
    if(window.SpotterNetwork?.isVisible())SpotterNetwork.refresh(S.lat,S.lng);
  }catch(e){console.error('Weather failed:',e);toast('⚠ Weather unavailable: '+e.message);}
  loader(false);
}

function refreshWidgets(d){
  if(!window.SSWidgets)return;
  const wp=$('widgets-panel');if(!wp?.classList.contains('open'))return;
  const c=d.current||{};
  requestAnimationFrame(()=>{
    SSWidgets.drawWindRose('windRoseCanvas',d.hourly?.wind_direction_10m,d.hourly?.wind_speed_10m);
    SSWidgets.drawFeelsGauge('feelsGaugeCanvas',cvtT(c.temperature_2m),cvtT(c.apparent_temperature),S.cfg.tempUnit);
    if(d.daily)SSWidgets.drawPrecipCalendar('precipCalendar',d.daily.time,d.daily.precipitation_sum,d.daily.precipitation_probability_max);
    SSWidgets.drawHumidityBar('humidityBar',cvtT(c.temperature_2m),cvtT(c.dew_point_2m),c.relative_humidity_2m,S.cfg.tempUnit);
    SSWidgets.drawPressureTrend('pressureTrendCanvas',d.hourly?.surface_pressure);
    SSWidgets.renderSolunar('solunarTable',S.lat,S.lng);
  });
}

function renderWeather(d){
  const c=d.current||{},w=wu(),daily=d.daily||{};
  st('wcLoc',S.locName); st('locName',S.locName); st('sideLocName',S.locName);
  st('sideLocCoords', S.lat.toFixed(2)+'°'+(S.lat>=0?'N':'S')+' '+Math.abs(S.lng).toFixed(2)+'°'+(S.lng<0?'W':'E'));
  st('snapTemp',cvtT(c.temperature_2m)+'°');
  st('snapIcon',wIcon(c.weather_code));
  st('snapDesc',wDesc(c.weather_code));
  st('wcTemp',cvtT(c.temperature_2m)+'°'+S.cfg.tempUnit);
  st('wcFeels','Feels like '+cvtT(c.apparent_temperature)+'°');
  st('wcDesc',wDesc(c.weather_code));
  st('wcIcon',wIcon(c.weather_code));
  if(daily.temperature_2m_max?.[0]!=null){
    st('wcHi','H: '+cvtT(daily.temperature_2m_max[0])+'°');
    st('wcLo','L: '+cvtT(daily.temperature_2m_min[0])+'°');
    st('snapHi','H:'+cvtT(daily.temperature_2m_max[0])+'°');
    st('snapLo','L:'+cvtT(daily.temperature_2m_min[0])+'°');
  }
  st('wcHum',(c.relative_humidity_2m??'--')+'%');
  st('wcDew',cvtT(c.dew_point_2m)+'°'+S.cfg.tempUnit);
  st('wcWind',cvtW(c.wind_speed_10m)+' '+w+' '+wDir(c.wind_direction_10m));
  st('wcGust',cvtW(c.wind_gusts_10m)+' '+w);
  st('wcRain',(c.precipitation??0).toFixed(1)+' mm');
  st('wcVis',cvtD((c.visibility??0)/1000));
  st('wcPres',Math.round(c.surface_pressure??0)+' hPa');
  st('wcCloud',(c.cloud_cover??'--')+'%');
  const hi=heatIndex(c.temperature_2m,c.relative_humidity_2m);
  const hiEl=$('wcHeatIdx');
  if(hiEl){hiEl.textContent=(hi!=null?cvtT(hi):cvtT(c.apparent_temperature))+'°'+S.cfg.tempUnit;hiEl.previousElementSibling.textContent=hi!=null?'🌡 Heat Idx':'🌡 Feels Like';}
  const uv=c.uv_index;
  st('wcUV',(uv!=null?uv:'--')+' '+uvLbl(uv));
  const uvEl=$('wcUV');if(uvEl)uvEl.style.color=uvClr(uv);
  const dot=$('uvDot');if(dot&&uv!=null)dot.style.left=Math.min(98,uv/11*100)+'%';
  if(daily.sunrise?.[0]){
    const sr=new Date(daily.sunrise[0]),ss=new Date(daily.sunset[0]),now=new Date();
    st('wcSunrise',fmtT(sr,true));
    st('wcSunset',fmtT(ss,true));
    st('wcDaylight',Math.round((daily.daylight_duration?.[0]||0)/3600)+'h');
    updateSunArc(sr,ss,now);
  }
  st('wcMoon',moonPhase(new Date()));
  // Update card position class
  const wc=$('wcard'); if(wc){wc.className='wcard '+(S.cfg.cardPos||'tl');}
}

function updateSunArc(sr,ss,now){
  const track=157,total=ss-sr,elapsed=now-sr;
  const pct=Math.max(0,Math.min(1,elapsed/total));
  const prog=$('sunArcProg'),dot=$('sunDot');if(!prog||!dot)return;
  prog.setAttribute('stroke-dasharray',(pct*track)+' '+track);
  const a=Math.PI-pct*Math.PI;
  dot.setAttribute('cx',(60+50*Math.cos(a)).toFixed(1));
  dot.setAttribute('cy',(50-50*Math.sin(a)).toFixed(1));
}

function renderForecast(d){
  const c=$('fcScroll');if(!c)return;
  c.innerHTML='';
  if(S.fcMode==='hourly'){
    for(let i=0;i<Math.min(24,d.hourly.temperature_2m.length);i++){
      const t=new Date(d.hourly.time[i]),pr=d.hourly.precipitation_probability?.[i]??0,cape=d.hourly.cape?.[i]||0;
      const div=document.createElement('div');
      div.className='fc-item'+(i===0?' now':'');
      div.innerHTML='<div class="fc-t">'+(i===0?'NOW':fmtT(t,true))+'</div><div class="fc-i">'+wIcon(d.hourly.weather_code[i])+'</div><div class="fc-v">'+cvtT(d.hourly.temperature_2m[i])+'°</div><div class="fc-rain">'+pr+'%</div>'+(cape>=500?'<div style="font-size:.58rem;color:#f97316">⚡'+cape+'</div>':'')+'<div class="fc-bar"><div class="fc-fill" style="width:'+Math.round(pr)+'%"></div></div>';
      c.appendChild(div);
    }
  } else if(S.fcMode==='daily'){
    const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    (d.daily.time||[]).slice(0,14).forEach((ds,i)=>{
      const day=new Date(ds),hi=cvtT(d.daily.temperature_2m_max[i]),lo=cvtT(d.daily.temperature_2m_min[i]);
      const rain=d.daily.precipitation_probability_max?.[i]??0,wind=cvtW(d.daily.wind_speed_10m_max?.[i]??0),prec=(d.daily.precipitation_sum?.[i]??0).toFixed(1);
      const div=document.createElement('div');
      div.className='fc-item fc-day'+(i===0?' now':'');
      div.innerHTML='<div class="fc-t">'+(i===0?'TODAY':days[day.getDay()])+'</div><div class="fc-i">'+wIcon(d.daily.weather_code[i])+'</div><div class="fc-v">'+hi+'°<span class="fc-lo">/'+lo+'°</span></div><div class="fc-rain">'+rain+'%</div><div class="fc-bar"><div class="fc-fill" style="width:'+Math.round(rain)+'%"></div></div>';
      c.appendChild(div);
    });
  } else if(S.fcMode==='precip') renderChart(d,c,'precip');
  else if(S.fcMode==='wind')   renderChart(d,c,'wind');
  else if(S.fcMode==='feels')  renderChart(d,c,'feels');
}

function renderChart(d,container,type){
  const canvas=document.createElement('canvas');
  canvas.style.cssText='width:100%;height:90px;display:block';
  container.appendChild(canvas);
  requestAnimationFrame(()=>{
    const w=canvas.parentElement?.clientWidth||400;
    canvas.width=w;canvas.height=90;
    const ctx=canvas.getContext('2d');
    if(type==='precip'){
      const vals=d.hourly.precipitation_probability.slice(0,24),bw=w/vals.length;
      ctx.fillStyle='rgba(6,182,212,.07)';ctx.fillRect(0,0,w,90);
      vals.forEach((v,i)=>{const h=(v/100)*70;ctx.fillStyle=`rgba(6,182,212,${.2+v/100*.7})`;ctx.fillRect(i*bw+1,85-h,bw-2,h);if(i%4===0){ctx.fillStyle='rgba(255,255,255,.4)';ctx.font='8px monospace';ctx.fillText(fmtT(new Date(d.hourly.time[i]),true),i*bw+1,88);}});
      ctx.fillStyle='rgba(255,255,255,.6)';ctx.font='bold 9px Inter,sans-serif';ctx.fillText('Precipitation Probability — 24h',4,12);
    } else if(type==='wind'){
      const vals=d.hourly.wind_speed_10m.slice(0,24),gusts=d.hourly.wind_gusts_10m.slice(0,24),mx=Math.max(...gusts,1);
      ctx.fillStyle='rgba(168,85,247,.06)';ctx.fillRect(0,0,w,90);
      ctx.beginPath();gusts.forEach((v,i)=>{const x=i/(vals.length-1)*w,y=85-(v/mx)*75;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});ctx.lineTo(w,90);ctx.lineTo(0,90);ctx.closePath();ctx.fillStyle='rgba(168,85,247,.15)';ctx.fill();
      ctx.beginPath();vals.forEach((v,i)=>{const x=i/(vals.length-1)*w,y=85-(v/mx)*75;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});ctx.strokeStyle='#a855f7';ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,.6)';ctx.font='bold 9px Inter,sans-serif';ctx.fillText('Wind '+wu()+' (24h) — solid=speed, fill=gusts',4,12);
    } else {
      const temps=d.hourly.temperature_2m.slice(0,24).map(cvtT),feels=d.hourly.apparent_temperature.slice(0,24).map(cvtT);
      const all=[...temps,...feels].filter(v=>v!=='--');
      const mn=Math.min(...all)-2,mx=Math.max(...all)+2;
      const sy=v=>85-((v-mn)/(mx-mn))*75;
      ctx.fillStyle='rgba(245,158,11,.06)';ctx.fillRect(0,0,w,90);
      const drawL=(arr,col,lw)=>{ctx.beginPath();arr.forEach((v,i)=>{const x=i/(arr.length-1)*w;i===0?ctx.moveTo(x,sy(v)):ctx.lineTo(x,sy(v));});ctx.strokeStyle=col;ctx.lineWidth=lw;ctx.stroke();};
      drawL(temps,'rgba(245,158,11,.5)',1.5);drawL(feels,'#f97316',2);
      ctx.fillStyle='rgba(255,255,255,.6)';ctx.font='bold 9px Inter,sans-serif';ctx.fillText('Temp (amber) vs Feels Like (orange) — 24h',4,12);
    }
  });
}

// ── AQI ─────────────────────────────────────────────────────────
async function loadAQI(){
  try{
    const r=await fetch(`${API}/api/airquality?lat=${S.lat}&lng=${S.lng}`);
    if(!r.ok)throw new Error();
    S.aqi=await r.json();
    const aqi=S.aqi.current?.us_aqi;
    if(aqi!=null){const el=$('wcAQI');if(el){el.textContent=aqi+' — '+aqiLbl(aqi);el.style.color=aqiClr(aqi);}}
  }catch(e){const el=$('wcAQI');if(el)el.textContent='N/A';}
}
function aqiLbl(a){if(a<=50)return'Good';if(a<=100)return'Moderate';if(a<=150)return'Unhealthy (Sensitive)';if(a<=200)return'Unhealthy';if(a<=300)return'Very Unhealthy';return'Hazardous';}
function aqiClr(a){if(a<=50)return'#22c55e';if(a<=100)return'#f59e0b';if(a<=150)return'#f97316';if(a<=200)return'#ef4444';if(a<=300)return'#a855f7';return'#7f1d1d';}
async function openAQI(){
  openModal('aqiModal');
  if(!S.aqi){$('aqiBody').innerHTML='<div class="empty-s"><div class="es-ico">💨</div><div class="es-txt">Loading…</div></div>';await loadAQI();}
  if(!S.aqi){$('aqiBody').innerHTML='<div class="empty-s"><div class="es-ico">⚠</div><div class="es-txt">AQI unavailable</div></div>';return;}
  const c=S.aqi.current||{},aqi=c.us_aqi,pct=Math.min(100,(aqi||0)/500*100);
  const hAQI=S.aqi.hourly?.us_aqi?.slice(0,24)||[];
  $('aqiBody').innerHTML=
    '<div class="aqi-hero"><div class="aqi-value" style="color:'+aqiClr(aqi)+'">'+(aqi??'--')+'</div><div class="aqi-label">'+aqiLbl(aqi)+'</div><div class="aqi-bar"><div class="aqi-bar-fill" style="width:'+pct+'%;background:'+aqiClr(aqi)+'"></div></div></div>'+
    '<div class="aqi-grid">'+aqiStat('PM2.5',c.pm2_5,'μg/m³')+aqiStat('PM10',c.pm10,'μg/m³')+aqiStat('NO₂',c.nitrogen_dioxide,'μg/m³')+aqiStat('O₃',c.ozone,'μg/m³')+aqiStat('SO₂',c.sulphur_dioxide,'μg/m³')+aqiStat('CO',c.carbon_monoxide?(c.carbon_monoxide/1000).toFixed(2):null,'mg/m³')+'</div>'+
    (hAQI.length?'<div class="aqi-24h-title">24h Trend</div><canvas id="aqiChart" style="width:100%;height:70px;display:block"></canvas>':'')+
    '<div class="aqi-guide"><div class="aqi-guide-title">US AQI Scale</div>'+['Good|0-50|#22c55e','Moderate|51-100|#f59e0b','Unhealthy (Sensitive)|101-150|#f97316','Unhealthy|151-200|#ef4444','Very Unhealthy|201-300|#a855f7','Hazardous|301+|#7f1d1d'].map(s=>{const[l,r,col]=s.split('|');return`<div class="aqi-scale-row"><span class="aqi-dot" style="background:${col}"></span><span>${l}</span><span style="color:var(--t3);font-size:.68rem">${r}</span></div>`;}).join('')+'</div>';
  if(hAQI.length)requestAnimationFrame(()=>{const can=$('aqiChart');if(!can)return;const w=can.parentElement.clientWidth;can.width=w;can.height=70;const ctx=can.getContext('2d');const mx=Math.max(...hAQI,1),bw=w/hAQI.length;hAQI.forEach((v,i)=>{const h=(v/mx)*60;ctx.fillStyle=aqiClr(v);ctx.globalAlpha=.75;ctx.fillRect(i*bw+1,65-h,bw-2,h);});});
}
function aqiStat(l,v,u){const val=v!=null?parseFloat(v).toFixed(1):'--';return`<div class="aqi-stat"><div class="aqi-stat-l">${esc(l)}</div><div class="aqi-stat-v">${val} <span style="font-size:.65rem;color:var(--t3)">${u}</span></div></div>`;}

// ── MARINE ───────────────────────────────────────────────────────
async function openMarine(){
  openModal('marineModal');
  const body=$('marineBody');
  body.innerHTML='<div class="empty-s"><div class="es-ico">🌊</div><div class="es-txt">Loading…</div></div>';
  try{
    const r=await fetch(`${API}/api/marine?lat=${S.lat}&lng=${S.lng}`);
    if(!r.ok)throw new Error();
    const d=await r.json();
    const c=d.current||{};
    body.innerHTML='<div class="marine-hero">'+
      mStat('🌊 Wave Height',c.wave_height!=null?c.wave_height.toFixed(1)+' m':'--')+
      mStat('⏱ Wave Period',c.wave_period!=null?c.wave_period.toFixed(1)+' s':'--')+
      mStat('🧭 Wave Dir',c.wave_direction!=null?wDir(c.wave_direction)+'('+Math.round(c.wave_direction)+'°)':'--')+
      mStat('🌊 Swell Height',c.swell_wave_height!=null?c.swell_wave_height.toFixed(1)+' m':'--')+
      mStat('⏱ Swell Period',c.swell_wave_period!=null?c.swell_wave_period.toFixed(1)+' s':'--')+
      mStat('🧭 Swell Dir',c.swell_wave_direction!=null?wDir(c.swell_wave_direction):'--')+
      '</div><div class="marine-note">📡 Open-Meteo Marine API — coastal/ocean areas only</div>';
  }catch(e){body.innerHTML='<div class="empty-s"><div class="es-ico">🌊</div><div class="es-txt">Marine data unavailable for this inland location</div></div>';}
}
function mStat(l,v){return`<div class="marine-stat"><div class="marine-stat-l">${l}</div><div class="marine-stat-v">${v}</div></div>`;}

// ── ALERTS ───────────────────────────────────────────────────────
async function loadAlerts(){
  try{
    const r=await fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert',{headers:{'User-Agent':'(StormSurgeWeather/13.9)','Accept':'application/geo+json'}});
    if(!r.ok)throw new Error();
    const d=await r.json();
    S.alerts=(d.features||[]).filter(f=>f.properties?.event&&new Date(f.properties.expires)>new Date());
    renderAlerts(); updateBadge();
    if(S.cfg.alertZones&&S.map)putAlertsOnMap();
  }catch(e){S.alerts=[];renderAlerts();updateBadge();}
}
function updateBadge(){const n=S.alerts.length;st('alertBadge',n);st('navBadge',n);$('navBadge').classList.toggle('show',n>0);}
function alertSev(ev){const e=(ev||'').toLowerCase();if(e.includes('tornado')||e.includes('hurricane')||e.includes('extreme'))return'emergency';if(e.includes('warning'))return'warning';if(e.includes('watch'))return'watch';if(e.includes('advisory'))return'advisory';return'default';}
function alertIco(ev){const e=(ev||'').toLowerCase();if(e.includes('tornado'))return'🌪';if(e.includes('hurricane'))return'🌀';if(e.includes('thunder'))return'⛈';if(e.includes('snow')||e.includes('blizzard')||e.includes('winter'))return'❄️';if(e.includes('flood'))return'🌊';if(e.includes('wind'))return'💨';if(e.includes('fog'))return'🌫';if(e.includes('fire')||e.includes('heat'))return'🔥';if(e.includes('ice')||e.includes('frost'))return'🧊';return'⚠️';}

function renderAlerts(){
  if(S.rightTab!=='alerts')return;
  const body=$('alertsBody'),q=(S.alertQuery||'').toLowerCase();
  const filtered=S.alerts.filter((a,i)=>{a._idx=i;const ok=S.alertFilter==='all'||alertSev(a.properties.event)===S.alertFilter;if(!ok)return false;if(!q)return true;const p=a.properties||{};return[p.event,p.headline,p.areaDesc,p.description].join(' ').toLowerCase().includes(q);});
  const bar='<div class="alert-filters">'+
    ['all','emergency','warning','watch','advisory'].map(f=>'<button class="af-btn'+(S.alertFilter===f?' active':'')+'" data-f="'+f+'">'+{all:'All',emergency:'🌪 Emerg',warning:'⚠ Warn',watch:'👁 Watch',advisory:'ℹ Advis'}[f]+(f==='all'?' <span>('+S.alerts.length+')</span>':'')+'</button>').join('')+
    '<button class="af-refresh" id="alRefresh" title="Refresh">↻</button></div>'+
    '<div class="alert-search"><input id="alSearch" type="text" placeholder="Search…" value="'+esc(S.alertQuery||'')+'"><button id="alSearchBtn">Go</button></div>';
  if(!filtered.length){body.innerHTML=bar+'<div class="empty-s"><div class="es-ico">✓</div><div class="es-txt">No active alerts</div></div>';bindAlertUI();return;}
  body.innerHTML=bar+filtered.map(a=>{
    const p=a.properties,sev=alertSev(p.event),ico=alertIco(p.event);
    const area=p.areaDesc?p.areaDesc.split(';')[0].trim():'Unknown',exp=p.expires?new Date(p.expires):null;
    return'<div class="acard sev-'+sev+'" data-i="'+a._idx+'" tabindex="0">'+
      '<div class="ac-row"><span class="ac-ico">'+ico+'</span><div><div class="ac-event">'+esc(p.event)+'</div><div class="ac-area">📍 '+esc(area)+'</div></div><span class="ac-arr">›</span></div>'+
      '<div class="ac-headline">'+esc(p.headline||'')+'</div>'+(exp?'<div class="ac-exp">Expires '+fmtDT(exp)+'</div>':'')+'</div>';
  }).join('');
  document.querySelectorAll('.acard').forEach(card=>{
    const fn=()=>openAlertModal(+card.dataset.i);
    card.addEventListener('click',fn);
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')fn();});
  });
  bindAlertUI();
}
function bindAlertUI(){
  document.querySelectorAll('.af-btn').forEach(b=>b.addEventListener('click',()=>{S.alertFilter=b.dataset.f;renderAlerts();}));
  const rb=$('alRefresh');if(rb)rb.addEventListener('click',()=>{toast('Refreshing…');loadAlerts();});
  const sb=$('alSearchBtn'),si=$('alSearch');
  const run=()=>{S.alertQuery=si?si.value.trim():'';renderAlerts();};
  if(sb)sb.addEventListener('click',run);
  if(si)si.addEventListener('keydown',e=>{if(e.key==='Enter')run();});
}
function fmtAlertTxt(txt){
  if(!txt?.trim())return'<p style="color:var(--t3)">No details.</p>';
  const paras=[];let cur=[];
  txt.trim().split('\n').forEach(l=>{if(!l.trim()){if(cur.length){paras.push(cur.join('\n'));cur=[];}}else cur.push(l);});
  if(cur.length)paras.push(cur.join('\n'));
  return paras.map(p=>{const t=p.trim();if(!t)return'';const alpha=t.replace(/[^A-Za-z]/g,'');if(alpha.length>1&&alpha===alpha.toUpperCase()&&t.length<80)return'<div class="ad-para-head">'+esc(t)+'</div>';return'<p>'+esc(t).replace(/\n/g,'<br>')+'</p>';}).join('');
}
function openAlertModal(idx){
  const alert=S.alerts[idx];if(!alert)return;
  const p=alert.properties,ico=alertIco(p.event);
  const onset=p.onset?new Date(p.onset):p.sent?new Date(p.sent):null;
  const exp=p.expires?new Date(p.expires):null;
  st('mTitle',ico+' '+p.event);
  $('mBody').innerHTML=
    '<div class="ad-hdr"><div class="ad-ico">'+ico+'</div><div class="ad-title">'+esc(p.headline||p.event)+'</div></div>'+
    '<div class="ad-chips">'+(onset?'<span class="ad-chip">📅 '+onset.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})+'</span>':'')+(exp?'<span class="ad-chip">⏱ '+fmtDT(exp)+'</span>':'')+(p.severity?'<span class="ad-chip">⚡ '+esc(p.severity)+'</span>':'')+(p.certainty?'<span class="ad-chip">🎯 '+esc(p.certainty)+'</span>':'')+'</div>'+
    (p.areaDesc?'<div class="ad-area-row">📍 '+esc(p.areaDesc.split(';').map(s=>s.trim()).filter(Boolean).slice(0,6).join(' · '))+'</div>':'')+
    '<div class="ad-section"><div class="ad-sub-title">Description</div><div class="ad-text">'+fmtAlertTxt(p.description)+'</div></div>'+
    (p.instruction?'<div class="ad-section"><div class="ad-sub-title">⚠ Instructions</div><div class="ad-text ad-instruction">'+fmtAlertTxt(p.instruction)+'</div></div>':'')+
    (p.senderName?'<div class="ad-sender">'+esc(p.senderName)+'</div>':'');
  openModal('alertModal');
}
function putAlertsOnMap(){
  if(!S.map||!S.map.isStyleLoaded())return;
  rmL(['alert-fill','alert-line'],['alerts-src']);
  const valid=S.alerts.filter(a=>a.geometry);
  if(!valid.length)return;
  try{
    S.map.addSource('alerts-src',{type:'geojson',data:{type:'FeatureCollection',features:valid.map(a=>({type:'Feature',geometry:a.geometry,properties:{event:a.properties.event,sev:alertSev(a.properties.event)}}))}});
    S.map.addLayer({id:'alert-fill',type:'fill',source:'alerts-src',paint:{'fill-color':['match',['get','sev'],'emergency','#ff3333','warning','#ef4444','watch','#06b6d4','#f59e0b'],'fill-opacity':.12}});
    S.map.addLayer({id:'alert-line',type:'line',source:'alerts-src',paint:{'line-color':['match',['get','sev'],'emergency','#ff3333','warning','#ef4444','watch','#06b6d4','#f59e0b'],'line-width':1.5}});
    S.map.on('mouseenter','alert-fill',()=>S.map.getCanvas().style.cursor='pointer');
    S.map.on('mouseleave','alert-fill',()=>S.map.getCanvas().style.cursor='');
  }catch(e){}
}
function rmL(layers,sources){
  if(!S.map)return;
  try{layers.forEach(l=>{if(S.map.getLayer(l))S.map.removeLayer(l);});}catch(e){}
  try{sources.forEach(s=>{if(S.map.getSource(s))S.map.removeSource(s);});}catch(e){}
}

// ── STORM REPORTS ─────────────────────────────────────────────────
function renderStormReports(){
  if(S.rightTab!=='severe')return;
  const body=$('alertsBody'),sc=S.spotterReports.length,spc=S.stormReports.length;
  if(!sc&&!spc){body.innerHTML='<div class="empty-s"><div class="es-ico">⛈</div><div class="es-txt">Loading…</div></div>';loadStormReports();return;}
  let html='';
  if(sc){html+='<div class="sr-head">🌐 Spotter Network ('+sc+')</div>'+S.spotterReports.slice(0,20).map(r=>'<div class="sr-row"><span class="sr-type" style="color:'+(r.verified?'#22c55e':'#94a3b8')+'">'+(r.icon||'📍')+' '+esc(r.type)+'</span>'+(r.magnitude?'<span class="sr-mag">'+esc(r.magnitude)+'</span>':'')+'<span class="sr-text">'+esc([r.city,r.state].filter(Boolean).join(', ')||r.description||'')+'</span>'+(r.distKm?'<span style="font-size:.65rem;color:var(--t3);margin-left:auto">'+r.distKm+'km</span>':'')+'</div>').join('');}
  if(spc){html+='<div class="sr-head" style="margin-top:8px">⛈ SPC Reports</div>'+S.stormReports.slice(0,20).map(r=>'<div class="sr-row"><span class="sr-type">'+(r.type==='tornado'?'🌪':r.type==='hail'?'🧊':'💨')+' '+r.type.toUpperCase()+'</span><span class="sr-mag">'+esc(r.magnitude||'?')+'</span><span class="sr-text">'+esc(r.text||'')+'</span></div>').join('');}
  html+='<div class="sr-src">mPing (NSSL) + NOAA SPC</div>';
  body.innerHTML=html;
}
async function loadStormReports(){
  try{
    const r=await fetch(`${API}/api/storm-reports`);
    S.stormReports=(await r.json()).items||[];
    if(S.rightTab==='severe')renderStormReports();
    putReportsOnMap();
  }catch(e){S.stormReports=[];if(S.rightTab==='severe')$('alertsBody').innerHTML='<div class="empty-s"><div class="es-ico">⛈</div><div class="es-txt">Reports unavailable</div></div>';}
}
function putReportsOnMap(){
  if(!S.map||!S.map.isStyleLoaded())return;
  rmL(['reports-circle'],['reports-src']);
  if(!S.stormReports.length)return;
  try{
    S.map.addSource('reports-src',{type:'geojson',data:{type:'FeatureCollection',features:S.stormReports.filter(r=>r.lat&&r.lng).map(r=>({type:'Feature',geometry:{type:'Point',coordinates:[r.lng,r.lat]},properties:{type:r.type,mag:r.magnitude}}))}});
    S.map.addLayer({id:'reports-circle',type:'circle',source:'reports-src',paint:{'circle-radius':6,'circle-color':['match',['get','type'],'tornado','#ef4444','hail','#06b6d4','#f59e0b'],'circle-stroke-width':1.5,'circle-stroke-color':'#fff','circle-opacity':.9}});
  }catch(e){}
}

// ── RADAR INFO ────────────────────────────────────────────────────
function renderRadarInfo(){
  const frames=window.RadarAnimator?RadarAnimator._allFrames?.()||allF():allF();
  const newest=frames.length?new Date(frames[frames.length-1].time*1000):null;
  $('alertsBody').innerHTML='<div style="padding:4px 0">'+
    '<div class="ri-title">Radar</div>'+
    riS('Source','RainViewer')+riS('Frames',S.frames.length+'/12')+riS('Nowcast',S.nowcastFrames.length+' frames')+riS('Latest',newest?fmtT(newest,true):'N/A')+riS('Color',{'1':'Classic','2':'Universal','4':'Rainbow','6':'NOAA','7':'Dark Sky'}[S.cfg.radarColor]||'NOAA')+riS('Opacity',Math.round((S.cfg.opacity||.75)*100)+'%')+
    '<div class="ri-title">NEXRAD</div>'+
    riS('Station',window.NexradRadar?.isVisible()?(NexradRadar._station?.id||'—'):'Off')+riS('Product',window.NexradRadar?.isVisible()?(NexradRadar._product||'—'):'—')+
    '<div class="ri-title">Spotter</div>'+
    riS('Reports',S.spotterReports.length+' nearby')+riS('Status',window.SpotterNetwork?.isVisible()?'Active':'Off')+
    '<div class="ri-actions"><button class="ri-btn" onclick="if(window.RadarAnimator)RadarAnimator.refresh();toast(\'↻ Refreshed\')">↻ Refresh</button><button class="ri-btn" onclick="toggleNowcast()">Nowcast</button><button class="ri-btn" onclick="if(window.NexradPanel)NexradPanel.toggle()">NEXRAD</button></div></div>';
}
const riS=(l,v)=>`<div class="ri-stat"><span>${esc(String(l))}</span><span>${esc(String(v))}</span></div>`;

// ── SEARCH ────────────────────────────────────────────────────────
async function doSearch(q){
  if(!q||q.length<2){hideDrop();return;}
  try{
    const d=await(await fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/'+encodeURIComponent(q)+'.json?access_token='+window.MAPBOX_TOKEN+'&limit=6&types=place,locality,neighborhood,postcode,address')).json();
    showDrop(d.features||[]);
  }catch(e){hideDrop();}
}
function showDrop(features){
  const dd=$('searchDrop');if(!features.length){hideDrop();return;}
  dd.classList.add('open');
  dd.innerHTML=features.map((f,i)=>{
    const main=f.text||f.place_name.split(',')[0],sub=f.place_name.split(',').slice(1,3).join(',').trim();
    return'<div class="s-item" data-i="'+i+'"><strong>'+esc(main)+'</strong>'+(sub?'<span>'+esc(sub)+'</span>':'')+'</div>';
  }).join('');
  dd.querySelectorAll('.s-item').forEach(item=>{
    item.addEventListener('click',()=>{
      const f=features[+item.dataset.i];
      S.lat=f.center[1];S.lng=f.center[0];S.locName=f.text||f.place_name.split(',')[0];
      hideDrop();$('searchInput').value='';
      if(S.map)S.map.flyTo({center:[S.lng,S.lat],zoom:9,duration:1400});
      loadWeather();loadAlerts();
      toast('📍 '+f.place_name.split(',').slice(0,2).join(','));
    });
  });
}
function hideDrop(){const dd=$('searchDrop');dd.classList.remove('open');}
async function reverseGeo(lat,lng){
  try{
    const d=await(await fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/'+lng+','+lat+'.json?access_token='+window.MAPBOX_TOKEN+'&limit=1')).json();
    if(d.features?.length){S.locName=d.features[0].text||d.features[0].place_name.split(',')[0];st('locName',S.locName);st('wcLoc',S.locName);st('sideLocName',S.locName);}
  }catch(e){}
}
function geolocate(){
  if(!navigator.geolocation){toast('⚠ Geolocation not supported');return;}
  toast('📍 Locating…');
  navigator.geolocation.getCurrentPosition(
    pos=>{S.lat=pos.coords.latitude;S.lng=pos.coords.longitude;if(S.map)S.map.flyTo({center:[S.lng,S.lat],zoom:10,duration:1200});reverseGeo(S.lat,S.lng);loadWeather();},
    ()=>toast('⚠ Location denied')
  );
}

// ── FAVORITES ────────────────────────────────────────────────────
function loadFavs(){try{const s=localStorage.getItem('ss13_favs');if(s)S.favorites=JSON.parse(s);}catch(e){}renderFavs();}
function saveFavs(){try{localStorage.setItem('ss13_favs',JSON.stringify(S.favorites));}catch(e){}}
function addFav(){if(S.favorites.some(f=>f.name===S.locName)){toast('★ Already saved');return;}S.favorites.push({name:S.locName,lat:S.lat,lng:S.lng});saveFavs();renderFavs();toast('★ Saved '+S.locName);}
function delFav(name){S.favorites=S.favorites.filter(f=>f.name!==name);saveFavs();renderFavs();}
function goFav(fav){S.lat=fav.lat;S.lng=fav.lng;S.locName=fav.name;st('locName',fav.name);if(S.map)S.map.flyTo({center:[fav.lng,fav.lat],zoom:9,duration:1200});loadWeather();loadAlerts();toast('📍 '+fav.name);}
function renderFavs(){
  const el=$('favList');if(!el)return;
  if(!S.favorites.length){el.innerHTML='<div class="fav-empty">No saved locations</div>';return;}
  el.innerHTML=S.favorites.map(f=>'<div class="fav-item"><button class="fav-loc" data-n="'+esc(f.name)+'">'+esc(f.name)+'</button><button class="fav-del" data-n="'+esc(f.name)+'">×</button></div>').join('');
  el.querySelectorAll('.fav-loc').forEach(b=>b.addEventListener('click',()=>{const f=S.favorites.find(x=>x.name===b.dataset.n);if(f)goFav(f);}));
  el.querySelectorAll('.fav-del').forEach(b=>b.addEventListener('click',()=>delFav(b.dataset.n)));
}

// ── SHARE CARD ────────────────────────────────────────────────────
function openShare(){
  openModal('shareModal');
  const canvas=$('shareCanvas');canvas.width=640;canvas.height=320;
  const ctx=canvas.getContext('2d'),d=S.weather?.current||{},code=d.weather_code||0;
  const g=code>=95?['#1a0033','#2d0052']:code>=61?['#0c1445','#1e3a5f']:code<=1?['#0f2957','#1a4a7a']:['#0b0e1a','#131827'];
  const grad=ctx.createLinearGradient(0,0,640,320);grad.addColorStop(0,g[0]);grad.addColorStop(1,g[1]);
  ctx.fillStyle=grad;ctx.fillRect(0,0,640,320);
  ctx.fillStyle='rgba(255,255,255,.08)';ctx.fillRect(0,0,640,48);
  ctx.fillStyle='rgba(255,255,255,.9)';ctx.font='bold 13px Inter,sans-serif';ctx.fillText('⛈ STORM SURGE WEATHER',22,32);
  ctx.fillStyle='rgba(255,255,255,.4)';ctx.font='11px "JetBrains Mono",monospace';ctx.fillText(new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}),22,47);
  ctx.font='900 80px Inter,sans-serif';ctx.fillStyle='#fff';ctx.fillText(cvtT(d.temperature_2m)+'°'+S.cfg.tempUnit,22,155);
  ctx.font='64px sans-serif';ctx.fillText(wIcon(d.weather_code),340,150);
  ctx.font='bold 20px Inter,sans-serif';ctx.fillStyle='rgba(255,255,255,.85)';ctx.fillText(S.locName,22,185);
  ctx.font='14px Inter,sans-serif';ctx.fillStyle='rgba(255,255,255,.65)';ctx.fillText(wDesc(d.weather_code)+'  ·  Feels like '+cvtT(d.apparent_temperature)+'°',22,208);
  ctx.font='12px "JetBrains Mono",monospace';ctx.fillStyle='rgba(255,255,255,.5)';
  ['💧 '+(d.relative_humidity_2m??'--')+'%','💨 '+cvtW(d.wind_speed_10m)+' '+wu(),'📊 '+Math.round(d.surface_pressure??0)+' hPa','☀ UV '+(d.uv_index??'--')].forEach((s,i)=>ctx.fillText(s,22+i*152,245));
  const daily=S.weather?.daily;
  if(daily?.temperature_2m_max?.[0]!=null){ctx.font='bold 13px "JetBrains Mono",monospace';ctx.fillStyle='#f97316';ctx.fillText('H: '+cvtT(daily.temperature_2m_max[0])+'°  ',22,275);ctx.fillStyle='#06b6d4';ctx.fillText('L: '+cvtT(daily.temperature_2m_min[0])+'°',90,275);}
}

// ── LEGEND ────────────────────────────────────────────────────────
function updateLegend(){
  const layer=document.querySelector('.lb.active')?.dataset.layer||'precipitation';
  const cfg={
    precipitation:{l:'mm/h',g:'linear-gradient(to top,#555,#04e9e7,#019ff4,#02fd02,#fdf802,#fd9500,#fd0000)'},
    temperature:{l:'°C',g:'linear-gradient(to top,#313695,#4575b4,#74add1,#abd9e9,#ffffbf,#fdae61,#f46d43,#a50026)'},
    wind:{l:'m/s',g:'linear-gradient(to top,#1a1a2e,#16213e,#0f3460,#533483,#e94560)'},
    clouds:{l:'%',g:'linear-gradient(to top,#111,#444,#888,#ccc)'},
    pressure:{l:'hPa',g:'linear-gradient(to top,#023858,#0570b0,#74a9cf,#d0d1e6)'},
  };
  const c=cfg[layer]||cfg.precipitation;
  st('legTitle',c.l);$('legBar').style.background=c.g;
}

// ── UI WIRING ─────────────────────────────────────────────────────
function initUI(){
  $('sidebarToggle').onclick=()=>{
    const s=$('sidebar');s.classList.toggle('collapsed');
    $('sidebarToggle').textContent=s.classList.contains('collapsed')?'›':'‹';
  };
  $('zoomIn').onclick=()=>S.map?.zoomIn();
  $('zoomOut').onclick=()=>S.map?.zoomOut();
  $('compassBtn').onclick=()=>{if(S.map){S.map.resetNorth();S.map.resetNorthPitch();}};
  $('styleBtn').onclick=cycleStyle;
  $('geoBtn').onclick=geolocate;
  $('refreshBtn').onclick=()=>{loadWeather();loadAlerts();if(S.map)loadRadar();toast('↻ Refreshing…');};
  $('playBtn').onclick=togglePlay;
  $('favAddBtn').onclick=addFav;
  $('shareBtn').onclick=openShare;
  $('rpanelToggle').onclick=()=>{$('rpanel').classList.toggle('hidden');toast('Panel toggled');};

  $('drawBtn').onclick=()=>S.drawMode?exitDraw():enterDraw();
  $('drawExit').onclick=exitDraw;
  $('drawUndo').onclick=undoDraw;
  $('drawClear').onclick=clearDraw;
  document.querySelectorAll('.dc').forEach(b=>b.onclick=()=>{document.querySelectorAll('.dc').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.drawColor=b.dataset.c;});
  document.querySelectorAll('.ds').forEach(b=>b.onclick=()=>{document.querySelectorAll('.ds').forEach(x=>x.classList.remove('active'));b.classList.add('active');S.drawSize=+b.dataset.s;});

  $('nexradBtn').onclick=()=>{if(window.NexradPanel)NexradPanel.toggle();$('nexradBtn').classList.toggle('active',window.NexradRadar?.isVisible());}
  $('spotterBtn').onclick=()=>{
    const active=SpotterNetwork?.toggle(S.lat,S.lng);
    $('spotterBtn').classList.toggle('active',active);
    toast(active?'🌐 Spotter ON':'Spotter OFF');
    if(active){switchRTab('severe');renderStormReports();}
  };
  $('severeBtn').onclick=()=>{
    if(window.SeverePanel){if(SeverePanel.isOpen()){SeverePanel.close();$('severeBtn').classList.remove('active');}else{SeverePanel.load(S.lat,S.lng);$('severeBtn').classList.add('active');}}
  };
  $('nwsSocialBtn').onclick=()=>{
    if(!window.NWSsocial)return;
    const open=NWSsocial.toggle(S.lat,S.lng);
    $('nwsSocialBtn').classList.toggle('active',open);
    toast(open?'🐦 NWS Feed ON':'NWS Feed OFF');
  };

  // Pro Tools panel
  const _ppBtn=$('proPanelBtn');
  if(_ppBtn) _ppBtn.onclick=()=>{
    if(!window.ProPanel)return;
    const open=ProPanel.toggle('radar');
    _ppBtn.classList.toggle('active',open);
    toast(open?'🔬 Pro Tools opened':'Pro Tools closed');
  };

  $('tPrev').onclick=()=>{if(S.frame>0)goFrame(S.frame-1);};
  $('tNext').onclick=()=>{if(S.frame<allF().length-1)goFrame(S.frame+1);};
  $('quickOpacity').addEventListener('input',e=>{
    S.cfg.opacity=+e.target.value/100;
    const so=$('sOpacity');if(so)so.value=e.target.value;
    const sv=$('sOpacityVal');if(sv)sv.textContent=e.target.value+'%';
    if(window.RadarAnimator)RadarAnimator.setOpacity(S.cfg.opacity);
    saveCfg();
  });

  $('themeBtn').onclick=()=>{
    const t=S.cfg.theme==='dark'?'light':'dark';
    applyTheme(t);saveCfg();
    if(S.map)S.map.setStyle(MAP_STYLES[t==='light'?'light':'dark']);
    toast(t==='dark'?'🌙 Dark':'☀️ Light');
  };

  document.querySelectorAll('.lb[data-layer]').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.lb[data-layer]').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');updateLegend();toast(b.textContent.trim());
  });

  document.querySelectorAll('.fct').forEach(t=>t.onclick=()=>{
    document.querySelectorAll('.fct').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');S.fcMode=t.dataset.ft;if(S.weather)renderForecast(S.weather);
  });

  document.querySelectorAll('.rp-tab').forEach(t=>t.onclick=()=>{
    document.querySelectorAll('.rp-tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');switchRTab(t.dataset.rt);
  });

  document.querySelectorAll('.sni').forEach(item=>item.onclick=e=>{
    e.preventDefault();
    document.querySelectorAll('.sni').forEach(x=>x.classList.remove('active'));
    item.classList.add('active');
    const p=item.dataset.p;
    if(p==='settings')openModal('settingsModal');
    else if(p==='aqi')openAQI();
    else if(p==='marine')openMarine();
    else if(p==='cameras')openModal('cameraModal');
    else if(p==='nwssocial'){if(window.NWSsocial)NWSsocial.toggle(S.lat,S.lng);}
    else if(p==='widgets'){$('widgets-panel').classList.toggle('open');if($('widgets-panel').classList.contains('open')&&S.weather)refreshWidgets(S.weather);}
    else if(p==='alerts'){switchRTab('alerts');}
  });

  // AI panel
  $('aiClose').onclick=()=>$('ai-panel').classList.remove('open');
  document.querySelectorAll('.ai-qbtn').forEach(b=>b.onclick=()=>sendAI(b.dataset.q));
  $('aiSend').onclick=()=>{const v=$('aiInput').value.trim();if(v){sendAI(v);$('aiInput').value='';}}
  $('aiInput').addEventListener('keydown',e=>{if(e.key==='Enter'){const v=$('aiInput').value.trim();if(v){sendAI(v);$('aiInput').value='';}}})

  // NWS social
  $('nwsSocialClose').onclick=()=>document.getElementById('nws-social-panel').classList.remove('open');

  // Search
  let st2;
  $('searchInput').addEventListener('input',e=>{
    clearTimeout(st2);
    const v=e.target.value.trim();
    if(v.length<2){hideDrop();return;}
    st2=setTimeout(()=>doSearch(v),300);
  });
  $('searchInput').addEventListener('keydown',e=>{
    if(e.key==='Escape'){hideDrop();e.target.value='';}
    if(e.key==='Enter')doSearch(e.target.value.trim());
  });
  document.addEventListener('click',e=>{if(!$('searchInput').contains(e.target)&&!$('searchDrop').contains(e.target))hideDrop();});

  // Modals
  $('mClose').onclick=()=>closeModal('alertModal');
  $('alertModal').onclick=e=>{if(e.target===$('alertModal'))closeModal('alertModal');};
  $('aqiClose').onclick=()=>closeModal('aqiModal');
  $('aqiModal').onclick=e=>{if(e.target===$('aqiModal'))closeModal('aqiModal');};
  $('marineClose').onclick=()=>closeModal('marineModal');
  $('marineModal').onclick=e=>{if(e.target===$('marineModal'))closeModal('marineModal');};
  $('camClose').onclick=()=>closeModal('cameraModal');
  $('cameraModal').onclick=e=>{if(e.target===$('cameraModal'))closeModal('cameraModal');};
  $('shareClose').onclick=()=>closeModal('shareModal');
  $('shareModal').onclick=e=>{if(e.target===$('shareModal'))closeModal('shareModal');};
  $('settClose').onclick=()=>closeModal('settingsModal');
  $('settingsModal').onclick=e=>{if(e.target===$('settingsModal'))closeModal('settingsModal');};

  $('shareDownload').onclick=()=>{
    const a=document.createElement('a');a.download='storm-surge-'+S.locName.toLowerCase().replace(/\s+/g,'-')+'.png';a.href=$('shareCanvas').toDataURL('image/png');a.click();toast('⬇ Downloaded');
  };
  $('shareCopy').onclick=()=>navigator.clipboard.writeText(window.location.href).then(()=>toast('📋 Copied')).catch(()=>toast('⚠ Copy failed'));
  $('camSearchBtn').onclick=()=>camSearch($('camSearch').value.trim());
  $('camSearch').addEventListener('keydown',e=>{if(e.key==='Enter')camSearch($('camSearch').value.trim());});

  // Settings seg binds
  segB('sTempUnit',v=>{S.cfg.tempUnit=v;saveCfg();if(S.weather){renderWeather(S.weather);renderForecast(S.weather);}});
  segB('sWindUnit',v=>{S.cfg.windUnit=v;saveCfg();if(S.weather)renderWeather(S.weather);});
  segB('sDistUnit',v=>{S.cfg.distUnit=v;saveCfg();if(S.weather)renderWeather(S.weather);});
  segB('sTimeFmt',v=>{S.cfg.timeFormat=v;saveCfg();if(S.weather){renderWeather(S.weather);renderForecast(S.weather);}buildSlots();});
  segB('sSpeed',v=>{S.cfg.speed=+v;saveCfg();if(window.RadarAnimator)RadarAnimator.setSpeed(+v);});
  segB('sRadarColor',v=>{S.cfg.radarColor=v;saveCfg();if(window.RadarAnimator)RadarAnimator.setColor(v);});
  segB('sCardPos',v=>{S.cfg.cardPos=v;saveCfg();if(S.weather)renderWeather(S.weather);});

  $('sOpacity').addEventListener('input',e=>{S.cfg.opacity=+e.target.value/100;$('sOpacityVal').textContent=e.target.value+'%';$('quickOpacity').value=e.target.value;if(window.RadarAnimator)RadarAnimator.setOpacity(S.cfg.opacity);saveCfg();});
  $('sNowcast').addEventListener('change',e=>{S.cfg.nowcast=e.target.checked;saveCfg();if(window.RadarAnimator)RadarAnimator.setNowcast(e.target.checked);buildSlots();});
  $('sAutoPlay').addEventListener('change',e=>{S.cfg.autoPlay=e.target.checked;saveCfg();});
  $('sAlertZones').addEventListener('change',e=>{S.cfg.alertZones=e.target.checked;saveCfg();if(e.target.checked)putAlertsOnMap();else rmL(['alert-fill','alert-line'],['alerts-src']);});
  $('sCrosshair').addEventListener('change',e=>{S.cfg.crosshair=e.target.checked;saveCfg();$('crosshair').style.display=e.target.checked?'':'none';});
  $('sClickNWS').addEventListener('change',e=>{S.cfg.clickNWS=e.target.checked;saveCfg();});
  $('sAnimBg').addEventListener('change',e=>{S.cfg.animBg=e.target.checked;saveCfg();if(!e.target.checked)$('bgAnim').style.opacity='0';else if(S.weather)updateBg(S.weather.current?.weather_code,S.weather.current?.is_day);});
  $('sAI').addEventListener('change',e=>{S.cfg.ai=e.target.checked;saveCfg();});

  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){['alertModal','settingsModal','aqiModal','marineModal','cameraModal','shareModal'].forEach(closeModal);if(window.NexradPanel)NexradPanel.close();if(window.ProPanel?.isOpen())ProPanel.close();if(window.NWSsocial?.isOpen())NWSsocial.close();$('ai-panel')?.classList.remove('open');}
    if(e.key===' '&&document.activeElement.tagName!=='INPUT'){e.preventDefault();togglePlay();}
    if(e.key==='ArrowLeft'){if(S.frame>0)goFrame(S.frame-1);}
    if(e.key==='ArrowRight'){if(S.frame<allF().length-1)goFrame(S.frame+1);}
  });

  applySettingsUI();
  updateLegend();
  loadStormReports();

  // Show AI tab button in layerbar
  const aiTabBtn=document.createElement('button');
  aiTabBtn.className='lb';aiTabBtn.id='aiBtn';aiTabBtn.textContent='⚡ AI';
  aiTabBtn.onclick=()=>{
    $('ai-panel').classList.toggle('open');
    aiTabBtn.classList.toggle('active',$('ai-panel').classList.contains('open'));
  };
  document.querySelector('.layerbar')?.appendChild(aiTabBtn);
}

function switchRTab(rt){
  S.rightTab=rt;
  document.querySelectorAll('.rp-tab').forEach(t=>t.classList.toggle('active',t.dataset.rt===rt));
  if(rt==='alerts')renderAlerts();
  else if(rt==='info')renderRadarInfo();
  else if(rt==='severe')renderStormReports();
}

function camSearch(q){
  const grid=$('camGrid');if(!q)return;
  grid.innerHTML='<div class="empty-s" style="gap:10px"><div class="es-ico">📷</div><div>Cameras for '+esc(q)+'</div><a class="modal-link" href="https://hazcams.com/search?query='+encodeURIComponent(q)+'" target="_blank" rel="noopener">🌐 Open Hazcams →</a></div>';
}

// ── AI PANEL ──────────────────────────────────────────────────────
async function sendAI(msg){
  if(!S.cfg.ai){toast('⚠ AI disabled in settings');return;}
  const feed=$('aiFeed');
  const addMsg=(txt,role)=>{
    const div=document.createElement('div');
    div.className='ai-msg '+role;
    div.innerHTML='<div class="ai-bubble">'+esc(txt)+'</div>';
    feed.appendChild(div);
    feed.scrollTop=feed.scrollHeight;
  };
  addMsg(msg,'user');
  const typing=document.createElement('div');
  typing.className='ai-msg bot';typing.innerHTML='<div class="ai-bubble" style="color:var(--t3)">…</div>';
  feed.appendChild(typing);feed.scrollTop=feed.scrollHeight;
  try{
    const r=await fetch(`${API}/api/ai-chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,context:{lat:S.lat,lng:S.lng,location:S.locName,weather:S.weather,alerts:S.alerts}})});
    const d=await r.json();
    typing.querySelector('.ai-bubble').textContent=d.reply||d.error||'No response.';
    typing.querySelector('.ai-bubble').style.color='';
  }catch(e){typing.querySelector('.ai-bubble').textContent='Error: '+e.message;}
}

// ── MODALS ────────────────────────────────────────────────────────
function openModal(id){$(id)?.classList.add('open');}
function closeModal(id){$(id)?.classList.remove('open');}
function segB(id,cb){document.querySelectorAll('#'+id+' .sb').forEach(b=>b.onclick=()=>{document.querySelectorAll('#'+id+' .sb').forEach(x=>x.classList.remove('active'));b.classList.add('active');cb(b.dataset.v);});}
function applySettingsUI(){
  const c=S.cfg;
  [['sTempUnit',c.tempUnit],['sWindUnit',c.windUnit],['sDistUnit',c.distUnit],['sTimeFmt',c.timeFormat],['sSpeed',String(c.speed||600)],['sRadarColor',String(c.radarColor||'6')],['sCardPos',c.cardPos||'tl']]
    .forEach(([id,val])=>document.querySelectorAll('#'+id+' .sb').forEach(b=>b.classList.toggle('active',b.dataset.v===val)));
  const so=$('sOpacity');if(so)so.value=Math.round((c.opacity||.75)*100);
  const sv=$('sOpacityVal');if(sv)sv.textContent=Math.round((c.opacity||.75)*100)+'%';
  $('quickOpacity').value=Math.round((c.opacity||.75)*100);
  const sn=$('sNowcast');if(sn)sn.checked=c.nowcast!==false;
  const sa=$('sAutoPlay');if(sa)sa.checked=!!c.autoPlay;
  const az=$('sAlertZones');if(az)az.checked=c.alertZones!==false;
  const sc=$('sCrosshair');if(sc)sc.checked=c.crosshair!==false;
  const cn=$('sClickNWS');if(cn)cn.checked=c.clickNWS!==false;
  const ab=$('sAnimBg');if(ab)ab.checked=c.animBg!==false;
  const ai=$('sAI');if(ai)ai.checked=c.ai!==false;
  if(c.crosshair===false&&$('crosshair'))$('crosshair').style.display='none';
}

// ── PERSIST ───────────────────────────────────────────────────────
function saveCfg(){try{localStorage.setItem('ss13_cfg',JSON.stringify(S.cfg));}catch(e){}}
function loadCfg(){
  try{
    // Migrate old key
    const old=localStorage.getItem('ss12_cfg')||localStorage.getItem('ss13_cfg');
    if(old)Object.assign(S.cfg,JSON.parse(old));
  }catch(e){}
}

console.log('%c⛈ Storm Surge v13.9','color:#06b6d4;font-weight:900;font-size:14px');
