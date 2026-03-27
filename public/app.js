// ================================================================
//  STORM SURGE WEATHER v14.0 — Main App
//  No AI. Error logging. Clean boot.
// ================================================================

// ── ERROR LOGGER ─────────────────────────────────────────────────
const SS = {
  _errors: [],
  log(msg, detail='') {
    const entry = { ts: new Date().toLocaleTimeString(), msg, detail: String(detail) };
    this._errors.unshift(entry);
    if (this._errors.length > 100) this._errors.pop();
    const badge = document.getElementById('errBadge');
    if (badge) { badge.textContent = this._errors.length; badge.style.display = ''; }
    this._render();
    console.error('[SS]', msg, detail);
  },
  _render() {
    const el = document.getElementById('errorLogBody');
    if (!el) return;
    el.innerHTML = this._errors.map(e =>
      `<div class="el-entry"><span class="el-ts">${e.ts}</span><span class="el-msg">${_esc(e.msg)}</span>${e.detail?`<div class="el-detail">${_esc(e.detail)}</div>`:''}</div>`
    ).join('');
  },
  clearErrors() {
    this._errors = [];
    const badge = document.getElementById('errBadge');
    if (badge) badge.style.display = 'none';
    this._render();
  }
};

// ── STATE ─────────────────────────────────────────────────────────
const S = {
  map: null, canvas: null, drawCanvas: null, drawCtx: null,
  drawing: false, drawMode: false, drawStrokes: [], drawColor: '#f59e0b', drawSize: 3,
  lat: 40.7128, lng: -74.006, locName: 'New York',
  frames: [], nowcastFrames: [], frame: 0, playing: false, showingNowcast: false,
  alerts: [], weather: null, aqi: null, spotterReports: [], stormReports: [],
  rightTab: 'alerts', alertFilter: 'all', alertQuery: '',
  fcMode: 'hourly', mapStyle: 'dark', favorites: [],
  cfg: {
    tempUnit:'C', windUnit:'ms', distUnit:'km', timeFormat:'12',
    opacity:.75, speed:600, autoPlay:false, nowcast:true,
    alertZones:true, crosshair:true, clickNWS:true, animBg:true,
    radarColor:'6', cardPos:'tl', cardStyle:'full', theme:'dark',
  }
};

const API = (window.SS_API_URL || window.location.origin || '').replace(/\/$/, '');
const MAP_STYLES = {
  dark:      'mapbox://styles/mapbox/navigation-night-v1',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  outdoors:  'mapbox://styles/mapbox/outdoors-v12',
  light:     'mapbox://styles/mapbox/navigation-day-v1',
  streets:   'mapbox://styles/mapbox/streets-v12',
};
const STYLE_ORDER = ['dark','satellite','outdoors','light','streets'];

// ── BOOT ─────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  console.log('⛈ Storm Surge Weather v14.0 booting…');
  loadCfg();
  loadFavs();
  applyTheme(S.cfg.theme);
  initUI();
  initDrawMode();
  updateDate();
  setInterval(updateDate, 30000);
  setInterval(() => { loadWeather(); loadAlerts(); }, 600000);
  setInterval(() => { if (window.SpotterNetwork?.isVisible()) SpotterNetwork.refresh(S.lat, S.lng); }, 300000);
  if (window.NWSsocial) NWSsocial.init();
  if (window.ProPanel) ProPanel.init();

  try { await window._tokenReady; } catch(e) {
    SS.log('Token fetch failed — using default token', e.message);
  }

  console.log('Token:', window.MAPBOX_TOKEN ? window.MAPBOX_TOKEN.slice(0,20)+'…' : 'MISSING');
  initMap();
});

// ── UTILS ─────────────────────────────────────────────────────────
const $   = id => document.getElementById(id);
const st  = (id, v) => { const e=$(id); if(e) e.textContent=v; };
const p2  = n => String(n).padStart(2,'0');
const _esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function fmtT(d, sh) {
  if (S.cfg.timeFormat==='24') return p2(d.getHours())+':'+p2(d.getMinutes());
  const h=d.getHours()%12||12, ap=d.getHours()>=12?'PM':'AM';
  return sh ? h+ap : h+':'+p2(d.getMinutes())+' '+ap;
}
function fmtDT(d) { return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+fmtT(d); }
function cvtT(c) { if(!Number.isFinite(c))return'--'; return S.cfg.tempUnit==='F'?Math.round(c*9/5+32):Math.round(c); }
function cvtW(ms) {
  if(!Number.isFinite(ms))return'--';
  if(S.cfg.windUnit==='kmh')return(ms*3.6).toFixed(1);
  if(S.cfg.windUnit==='mph')return(ms*2.237).toFixed(1);
  if(S.cfg.windUnit==='kts')return(ms*1.944).toFixed(1);
  return ms.toFixed(1);
}
function wu() { return{ms:'m/s',kmh:'km/h',mph:'mph',kts:'kts'}[S.cfg.windUnit]||'m/s'; }
function cvtD(km) { if(!Number.isFinite(km))return'--'; return S.cfg.distUnit==='mi'?(km*.621).toFixed(1)+' mi':km.toFixed(1)+' km'; }
function wDir(d) { if(!Number.isFinite(d))return'--'; return['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(d/22.5)%16]; }
function uvLbl(u) { if(!Number.isFinite(u))return''; if(u<=2)return'Low';if(u<=5)return'Moderate';if(u<=7)return'High';if(u<=10)return'Very High';return'Extreme'; }
function uvClr(u) { if(!Number.isFinite(u))return'var(--t3)';if(u<=2)return'#22c55e';if(u<=5)return'#f59e0b';if(u<=7)return'#f97316';if(u<=10)return'#ef4444';return'#a855f7'; }
function wIcon(c) {
  const m={0:'☀️',1:'🌤',2:'⛅',3:'☁️',45:'🌫',48:'🌫',51:'🌦',53:'🌦',55:'🌧',56:'🌨',57:'🌨',61:'🌧',63:'🌧',65:'🌧',71:'🌨',73:'🌨',75:'❄️',77:'🌨',80:'🌦',81:'🌦',82:'🌧',85:'🌨',86:'❄️',95:'⛈',96:'⛈',99:'⛈'};
  return m[c]||'🌡';
}
function wDesc(c) {
  const m={0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Icy fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Rain showers',81:'Heavy showers',82:'Violent showers',85:'Snow showers',86:'Heavy snow showers',95:'Thunderstorm',96:'T-storm/hail',99:'T-storm/heavy hail'};
  return m[c]||'Unknown';
}
function moonPhase(date) {
  const diff=(date-new Date('2000-01-06T18:14:00Z'))/(1000*60*60*24);
  const phase=((diff%29.530588853)+29.530588853)%29.530588853;
  const icons=['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘'];
  const names=['New Moon','Waxing Crescent','First Quarter','Waxing Gibbous','Full Moon','Waning Gibbous','Last Quarter','Waning Crescent'];
  const idx=Math.round(phase/29.530588853*8)%8;
  return {icon:icons[idx],name:names[idx]};
}

function updateDate() {
  const now=new Date();
  st('datePill', now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}));
  st('wcTime', fmtT(now));
}

let _tt;
function toast(msg, dur=3000) {
  const t=$('toast'); if(!t)return;
  t.textContent=msg; t.classList.add('show');
  clearTimeout(_tt); _tt=setTimeout(()=>t.classList.remove('show'),dur);
}
function loader(v) { $('loader')?.classList.toggle('show',v); }

// ── THEME ─────────────────────────────────────────────────────────
function applyTheme(theme) {
  S.cfg.theme=theme;
  document.documentElement.setAttribute('data-theme',theme);
  const icon=$('themeIcon'),lbl=$('themeLabel'),tog=$('themeTog');
  if(icon) icon.textContent=theme==='dark'?'🌙':'☀️';
  if(lbl)  lbl.textContent =theme==='dark'?'Dark Mode':'Light Mode';
  if(tog)  tog.classList.toggle('on',theme==='dark');
}
function updateBg(code, isDay) {
  if(!S.cfg.animBg){$('bgAnim').className='';return;}
  const el=$('bgAnim'); el.className='';
  if(code>=95)      el.classList.add('bg-storm');
  else if(code>=61) el.classList.add('bg-rain');
  else if(code>=71) el.classList.add('bg-snow');
  else if(code>=51) el.classList.add('bg-rain');
  else if(code===3) el.classList.add('bg-cloudy');
  else if(!isDay)   el.classList.add('bg-night');
  else              el.classList.add('bg-clear');
}

// ── MAP ───────────────────────────────────────────────────────────
function initMap() {
  S.canvas = $('radarCanvas');
  window.addEventListener('resize', resizeCanvas);

  if (!window.MAPBOX_TOKEN) {
    SS.log('Mapbox token missing', 'Set MAPBOX_TOKEN in .env or check token.js');
    showMapErr('Mapbox token missing — check .env file');
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
      console.log('✓ Map loaded');
      S.map.resize(); resizeCanvas();

      if (window.RadarAnimator) {
        RadarAnimator.init(S.map, S.canvas, {
          apiBase:API, opacity:S.cfg.opacity||.75, color:S.cfg.radarColor||'6',
          speed:S.cfg.speed||600, smooth:true, nowcast:S.cfg.nowcast
        });
        RadarAnimator.onFrameChange = idx => {
          S.frame=idx; S.frames=RadarAnimator._frames;
          updateSlots(idx);
          const tr=$('tRange'); if(tr) tr.value=idx;
          const nb=$('nowcastBadge'); if(nb) nb.style.display=(S.cfg.nowcast&&idx>=S.frames.length)?'block':'none';
        };
        RadarAnimator.onPlayStateChange = p => {
          S.playing=p;
          const pb=$('playBtn'); if(pb){pb.textContent=p?'⏸':'▶';pb.classList.toggle('playing',p);}
        };
      } else {
        SS.log('RadarAnimator not loaded', 'radar.js may have an error');
      }

      if (window.NexradRadar) NexradRadar.init(S.map, API);
      else SS.log('NexradRadar not loaded');

      if (window.NexradPanel) { NexradPanel.init(API); NexradPanel.preloadNearby(S.lat,S.lng); }
      else SS.log('NexradPanel not loaded');

      if (window.SpotterNetwork) {
        SpotterNetwork.init(S.map, API);
        SpotterNetwork.onUpdate = r => { S.spotterReports=r; };
      } else SS.log('SpotterNetwork not loaded');

      if (window.SeverePanel) SeverePanel.init(API);
      else SS.log('SeverePanel not loaded');

      loadRadar();
      loadWeather();
      loadAlerts();
    });

    S.map.on('error', e => {
      const msg = e?.error?.message || String(e);
      SS.log('Mapbox error', msg);
      console.warn('Mapbox non-fatal:', msg);
    });

    S.map.on('click', e => { if (!S.drawMode) handleClick(e); });

  } catch(e) {
    SS.log('Map init failed', e.message);
    showMapErr('Map failed: '+e.message);
    loadWeather(); loadAlerts();
  }
}

function showMapErr(msg) {
  const el=$('map'); if(!el)return;
  el.innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;color:#f59e0b;text-align:center;padding:24px"><div style="font-size:3rem">⛈</div><div style="font-size:.9rem;font-weight:600">${_esc(msg)}</div><div style="font-size:.75rem;color:var(--t3)">Check the Error Log in the sidebar for details</div></div>`;
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
    if(window.SpotterNetwork?.isVisible())SpotterNetwork.renderMarkers?.();
    toast('🗺 '+S.mapStyle[0].toUpperCase()+S.mapStyle.slice(1));
  });
}

function resizeCanvas() {
  const mz=$('mapzone');
  const w=mz?mz.clientWidth:window.innerWidth, h=mz?mz.clientHeight:window.innerHeight;
  [S.canvas,S.drawCanvas].forEach(c=>{if(!c)return;c.width=w;c.height=h;});
  if(window.RadarAnimator)RadarAnimator.resize();
}

// ── DRAW MODE ─────────────────────────────────────────────────────
function initDrawMode() {
  S.drawCanvas=$('drawCanvas'); S.drawCtx=S.drawCanvas.getContext('2d');
  const mp=e=>{const r=S.drawCanvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
  const tp=e=>{const r=S.drawCanvas.getBoundingClientRect();return{x:e.touches[0].clientX-r.left,y:e.touches[0].clientY-r.top};};
  const sty=()=>{S.drawCtx.strokeStyle=S.drawColor;S.drawCtx.lineWidth=S.drawSize;S.drawCtx.lineCap='round';S.drawCtx.lineJoin='round';};
  S.drawCanvas.addEventListener('mousedown',e=>{if(!S.drawMode)return;S.drawing=true;const p=mp(e);S.drawCtx.beginPath();S.drawCtx.moveTo(p.x,p.y);S.drawStrokes.push({c:S.drawColor,s:S.drawSize,pts:[p]});});
  S.drawCanvas.addEventListener('mousemove',e=>{if(!S.drawMode||!S.drawing)return;const p=mp(e);sty();S.drawCtx.lineTo(p.x,p.y);S.drawCtx.stroke();S.drawStrokes[S.drawStrokes.length-1].pts.push(p);});
  ['mouseup','mouseleave'].forEach(ev=>S.drawCanvas.addEventListener(ev,()=>S.drawing=false));
  S.drawCanvas.addEventListener('touchstart',e=>{if(!S.drawMode)return;e.preventDefault();S.drawing=true;const p=tp(e);S.drawCtx.beginPath();S.drawCtx.moveTo(p.x,p.y);S.drawStrokes.push({c:S.drawColor,s:S.drawSize,pts:[p]});},{passive:false});
  S.drawCanvas.addEventListener('touchmove',e=>{if(!S.drawMode||!S.drawing)return;e.preventDefault();const p=tp(e);sty();S.drawCtx.lineTo(p.x,p.y);S.drawCtx.stroke();S.drawStrokes[S.drawStrokes.length-1].pts.push(p);},{passive:false});
  S.drawCanvas.addEventListener('touchend',()=>S.drawing=false);
}
function enterDraw(){S.drawMode=true;S.drawCanvas.style.pointerEvents='all';S.drawCanvas.style.cursor='crosshair';$('drawToolbar').classList.add('show');$('drawBtn').classList.add('active');if(S.map)S.map.dragPan.disable();toast('✏ Draw mode');}
function exitDraw() {S.drawMode=false;S.drawing=false;S.drawCanvas.style.pointerEvents='none';S.drawCanvas.style.cursor='';$('drawToolbar').classList.remove('show');$('drawBtn').classList.remove('active');if(S.map)S.map.dragPan.enable();}
function undoDraw(){if(!S.drawStrokes.length)return;S.drawStrokes.pop();S.drawCtx.clearRect(0,0,S.drawCanvas.width,S.drawCanvas.height);S.drawStrokes.forEach(stroke=>{if(stroke.pts.length<2)return;S.drawCtx.beginPath();S.drawCtx.moveTo(stroke.pts[0].x,stroke.pts[0].y);S.drawCtx.strokeStyle=stroke.c;S.drawCtx.lineWidth=stroke.s;S.drawCtx.lineCap='round';S.drawCtx.lineJoin='round';stroke.pts.forEach((p,i)=>{if(i>0)S.drawCtx.lineTo(p.x,p.y);});S.drawCtx.stroke();});}
function clearDraw(){S.drawStrokes=[];S.drawCtx.clearRect(0,0,S.drawCanvas.width,S.drawCanvas.height);}

// ── MAP CLICK ─────────────────────────────────────────────────────
function handleClick(e) {
  const{lat,lng}=e.lngLat;
  if(S.map?.getSource?.('alerts-src')){
    const hits=S.map.queryRenderedFeatures(e.point,{layers:['alert-fill']});
    if(hits.length){const idx=S.alerts.findIndex(a=>a.properties.event===hits[0].properties.event);if(idx>=0){openAlertModal(idx);return;}}
  }
  S.lat=lat;S.lng=lng;
  reverseGeo(lat,lng);
  if(S.cfg.clickNWS){toast('📡 Fetching NWS…');fetchNWS(lat,lng);}
  else loadWeather();
}

async function fetchNWS(lat,lng){
  try{
    const r=await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`,{headers:{'User-Agent':'(StormSurgeWeather/14.0)','Accept':'application/geo+json'}});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const pt=await r.json();
    if(!pt.properties?.forecast)throw new Error('Outside NWS coverage');
    const props=pt.properties;
    const[fR,hR]=await Promise.allSettled([fetch(props.forecast,{headers:{'User-Agent':'(StormSurgeWeather/14.0)'}}),fetch(props.forecastHourly,{headers:{'User-Agent':'(StormSurgeWeather/14.0)'}})]);
    const fcast=fR.status==='fulfilled'&&fR.value.ok?await fR.value.json():null;
    const hourly=hR.status==='fulfilled'&&hR.value.ok?await hR.value.json():null;
    openNWSModal(props,fcast,hourly);
  }catch(e){SS.log('NWS forecast failed',e.message);toast('⚠ NWS: US only');loadWeather();}
}

function openNWSModal(props,fcast,hourly){
  const city=props.relativeLocation?.properties?.city||S.locName;
  const state=props.relativeLocation?.properties?.state||'';
  const hP=hourly?.properties?.periods?.slice(0,12)||[];
  const now=hP[0];
  st('mTitle','📡 NWS — '+city+(state?', '+state:''));
  $('mBody').innerHTML=
    '<div class="nws-hdr"><span class="nws-badge">'+_esc(props.cwa||'NWS')+'</span></div>'+
    (now?'<div class="nws-now"><div class="nws-now-temp">'+now.temperature+'°'+now.temperatureUnit+'</div><div>'+_esc(now.shortForecast)+'</div><div>💨 '+_esc(now.windSpeed+' '+now.windDirection)+'</div></div>':'')+
    (hP.length?'<div class="nws-stitle">Hourly</div><div class="nws-hourly">'+hP.map(p=>'<div class="nws-hr"><div>'+fmtT(new Date(p.startTime),true)+'</div><div>'+(p.isDaytime?'☀️':'🌙')+'</div><div>'+p.temperature+'°</div><div>'+(p.probabilityOfPrecipitation?.value??0)+'%</div></div>').join('')+'</div>':'')+
    (fcast?.properties?.periods?.length?'<div class="nws-stitle">Extended</div><div class="nws-periods">'+fcast.properties.periods.slice(0,8).map(p=>'<div class="nws-period '+(p.isDaytime?'day':'night')+'"><div>'+_esc(p.name)+'</div><div>'+p.temperature+'°'+p.temperatureUnit+'</div><div>'+_esc(p.shortForecast)+'</div></div>').join('')+'</div>':'');
  openModal('alertModal');
}

// ── RADAR ─────────────────────────────────────────────────────────
async function loadRadar(){
  try{
    const r=await fetch(`${API}/api/radar/frames`);
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();
    S.frames=d.past||[]; S.nowcastFrames=S.cfg.nowcast?(d.nowcast||[]):[];
    if(!S.frames.length)throw new Error('No frames in response');
    S.frame=S.frames.length-1; S.showingNowcast=false;
    buildSlots(); resizeCanvas();
    if(window.RadarAnimator){
      RadarAnimator.setFrames(S.frames,S.nowcastFrames);
      RadarAnimator.goTo(S.frame);
      if(S.cfg.autoPlay)RadarAnimator.play();
    }
    console.log('✓ Radar loaded', S.frames.length, 'frames');
  }catch(e){SS.log('Radar load failed',e.message);toast('⚠ Radar unavailable');}
}

function allF(){return S.showingNowcast?[...S.frames,...S.nowcastFrames]:S.frames;}
function buildSlots(){
  const frames=allF(),c=$('tSlots');if(!c)return;
  c.innerHTML='';
  const tr=$('tRange');if(tr){tr.max=Math.max(0,frames.length-1);tr.value=S.frame;}
  frames.forEach((f,i)=>{
    const d=new Date(f.time*1000),btn=document.createElement('button');
    btn.className='tslot'+(i===S.frame?' active':'')+(i>=S.frames.length?' nowcast':'');
    btn.textContent=i>=S.frames.length?'+'+(i-S.frames.length+1)*10+'m':fmtT(d,true);
    btn.title=i>=S.frames.length?'Nowcast +'+(i-S.frames.length+1)*10+'min':d.toLocaleTimeString();
    btn.onclick=()=>goFrame(i);
    c.appendChild(btn);
  });
}
function updateSlots(idx){document.querySelectorAll('.tslot').forEach((s,j)=>s.classList.toggle('active',j===idx));}
function goFrame(i){S.frame=Math.max(0,Math.min(allF().length-1,i));updateSlots(i);const tr=$('tRange');if(tr)tr.value=i;if(window.RadarAnimator)RadarAnimator.goTo(i);}
function togglePlay(){if(window.RadarAnimator)RadarAnimator.togglePlay();}
function toggleNowcast(){if(!S.nowcastFrames.length){toast('⚠ Nowcast unavailable');return;}S.showingNowcast=!S.showingNowcast;if(window.RadarAnimator)RadarAnimator.setFrames(S.frames,S.showingNowcast?S.nowcastFrames:[]);buildSlots();toast(S.showingNowcast?'🟢 Nowcast ON':'Nowcast OFF');}

// ── WEATHER ───────────────────────────────────────────────────────
async function loadWeather(){
  loader(true);
  try{
    const r=await fetch(`${API}/api/weather?lat=${S.lat}&lng=${S.lng}`);
    if(!r.ok)throw new Error('HTTP '+r.status+' from /api/weather');
    const d=await r.json();
    if(d.error)throw new Error(d.error);
    S.weather=d;
    renderWeather(d); renderForecast(d);
    updateBg(d.current?.weather_code,d.current?.is_day);
    loadAQI();
    refreshWidgets(d);
    if(window.NexradPanel)NexradPanel.updateLocation(S.lat,S.lng);
    if(window.SpotterNetwork?.isVisible())SpotterNetwork.refresh(S.lat,S.lng);
    console.log('✓ Weather loaded for',S.locName);
  }catch(e){SS.log('Weather failed',e.message);toast('⚠ Weather: '+e.message);}
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
  const c=d.current||{},wu_=wu(),daily=d.daily||{};
  st('wcLoc',S.locName); st('locName',S.locName); st('tbLocName',S.locName);
  st('locCoords',S.lat.toFixed(2)+'°'+(S.lat>=0?'N':'S')+'  '+Math.abs(S.lng).toFixed(2)+'°'+(S.lng<0?'W':'E'));
  st('snapTemp',cvtT(c.temperature_2m)+'°');
  st('snapIcon',wIcon(c.weather_code));
  st('snapDesc',wDesc(c.weather_code));
  st('wcTemp',cvtT(c.temperature_2m)+'°'+S.cfg.tempUnit);
  st('wcFeels','Feels '+cvtT(c.apparent_temperature)+'°');
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
  st('wcWind',cvtW(c.wind_speed_10m)+' '+wu_+' '+wDir(c.wind_direction_10m));
  st('wcGust',cvtW(c.wind_gusts_10m)+' '+wu_);
  st('wcRain',(c.precipitation??0).toFixed(1)+' mm');
  st('wcVis',cvtD((c.visibility??0)/1000));
  st('wcPres',Math.round(c.surface_pressure??0)+' hPa');
  st('wcCloud',(c.cloud_cover??'--')+'%');
  st('wcHeat',cvtT(c.apparent_temperature)+'°'+S.cfg.tempUnit);
  const uv=c.uv_index;
  const uvEl=$('wcUV');if(uvEl){uvEl.textContent=(uv??'--')+' '+uvLbl(uv);uvEl.style.color=uvClr(uv);}
  const uvDot=$('wcUVDot');if(uvDot&&uv!=null)uvDot.style.left=Math.min(100,(uv/11)*100)+'%';
  if(daily.sunrise?.[0]){
    const sr=new Date(daily.sunrise[0]),ss=new Date(daily.sunset[0]),now=new Date();
    st('wcSunrise',fmtT(sr,true));st('wcSunset',fmtT(ss,true));
    st('wcDaylight',Math.round((daily.daylight_duration?.[0]||0)/3600)+'h');
    const track=157,total=ss-sr,elapsed=now-sr;
    const pct=Math.max(0,Math.min(1,elapsed/total));
    const prog=$('arcProg'),dot=$('arcDot');
    if(prog)prog.setAttribute('stroke-dasharray',(pct*track)+' '+track);
    if(dot){const a=Math.PI-pct*Math.PI;dot.setAttribute('cx',(60+50*Math.cos(a)).toFixed(1));dot.setAttribute('cy',(55-50*Math.sin(a)).toFixed(1));}
  }
  const moon=moonPhase(new Date());
  st('wcMoon',moon.icon+' '+moon.name);
  const wc=$('wcard');if(wc)wc.className='wcard pos-'+S.cfg.cardPos+' style-'+S.cfg.cardStyle;
}

function renderForecast(d){
  const c=$('fcScroll');if(!c)return; c.innerHTML='';
  if(S.fcMode==='hourly'){
    for(let i=0;i<Math.min(24,d.hourly.temperature_2m.length);i++){
      const t=new Date(d.hourly.time[i]),precip=d.hourly.precipitation_probability?.[i]??0,cape=d.hourly.cape?.[i]||0;
      const div=document.createElement('div'); div.className='fc-item'+(i===0?' now':'');
      div.innerHTML='<div class="fc-t">'+(i===0?'NOW':fmtT(t,true))+'</div><div class="fc-i">'+wIcon(d.hourly.weather_code[i])+'</div><div class="fc-v">'+cvtT(d.hourly.temperature_2m[i])+'°</div><div class="fc-h" style="opacity:'+(precip>5?1:.35)+'">🌧 '+precip+'%</div>'+(cape>=500?'<div style="font-size:.6rem;color:#f97316">⚡'+cape+'</div>':'')+'<div class="fc-pb"><div class="fc-pb-f" style="width:'+Math.round(precip)+'%"></div></div>';
      c.appendChild(div);
    }
  } else if(S.fcMode==='daily'){
    const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    (d.daily.time||[]).slice(0,10).forEach((ds,i)=>{
      const day=new Date(ds),hi=cvtT(d.daily.temperature_2m_max[i]),lo=cvtT(d.daily.temperature_2m_min[i]);
      const rain=d.daily.precipitation_probability_max?.[i]??0,wind=cvtW(d.daily.wind_speed_10m_max?.[i]??0),prec=(d.daily.precipitation_sum?.[i]??0).toFixed(1);
      const div=document.createElement('div'); div.className='fc-item fc-day'+(i===0?' now':'');
      div.innerHTML='<div class="fc-t">'+(i===0?'TODAY':days[day.getDay()])+'</div><div class="fc-i">'+wIcon(d.daily.weather_code[i])+'</div><div class="fc-v">'+hi+'°<span style="color:var(--t3)">/'+lo+'°</span></div><div class="fc-h">🌧 '+rain+'%  💧'+prec+'mm</div><div style="font-size:.68rem;color:var(--t3)">💨'+wind+' '+wu()+'</div>';
      c.appendChild(div);
    });
  } else if(S.fcMode==='precip') renderChart(d,c,'precip');
  else if(S.fcMode==='wind')  renderChart(d,c,'wind');
  else if(S.fcMode==='feels') renderChart(d,c,'feels');
}

function renderChart(d,container,type){
  const canvas=document.createElement('canvas');
  canvas.style.cssText='width:100%;height:100px;display:block';
  container.appendChild(canvas);
  requestAnimationFrame(()=>{
    const w=canvas.parentElement.clientWidth;canvas.width=w;canvas.height=100;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='rgba(255,255,255,.03)';ctx.fillRect(0,0,w,100);
    if(type==='precip'){
      const vals=d.hourly.precipitation_probability.slice(0,24),bW=w/vals.length;
      vals.forEach((v,i)=>{const h=(v/100)*78;ctx.fillStyle=`rgba(6,182,212,${.2+(v/100)*.7})`;ctx.fillRect(i*bW+1,100-h,bW-2,h);});
      ctx.fillStyle='rgba(255,255,255,.6)';ctx.font='bold 10px Inter';ctx.fillText('Precip probability 24h',6,14);
    }else if(type==='wind'){
      const vals=d.hourly.wind_speed_10m.slice(0,24),gusts=d.hourly.wind_gusts_10m.slice(0,24),maxV=Math.max(...gusts,1);
      const path=pts=>{ctx.beginPath();pts.forEach((v,i)=>{const x=(i/(pts.length-1))*w,y=90-(v/maxV)*78;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});};
      ctx.fillStyle='rgba(168,85,247,.15)';path(gusts);ctx.lineTo(w,100);ctx.lineTo(0,100);ctx.closePath();ctx.fill();
      ctx.strokeStyle='#a855f7';ctx.lineWidth=2;path(vals);ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,.6)';ctx.font='bold 10px Inter';ctx.fillText('Wind speed vs gusts 24h',6,14);
    }else{
      const temps=d.hourly.temperature_2m.slice(0,24).map(cvtT),feels=d.hourly.apparent_temperature.slice(0,24).map(cvtT);
      const allV=[...temps,...feels].filter(v=>v!=='--');
      const minV=Math.min(...allV)-2,maxV=Math.max(...allV)+2,sy=v=>90-((v-minV)/(maxV-minV))*78;
      const drawL=(arr,clr,lw)=>{ctx.beginPath();ctx.strokeStyle=clr;ctx.lineWidth=lw;arr.forEach((v,i)=>{const x=(i/(arr.length-1))*w,y=sy(v);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});ctx.stroke();};
      drawL(temps,'rgba(240,165,0,.6)',1.5);drawL(feels,'#f97316',2);
      ctx.fillStyle='rgba(255,255,255,.6)';ctx.font='bold 10px Inter';ctx.fillText('Temp vs Feels Like 24h',6,14);
    }
  });
}

// ── AQI ───────────────────────────────────────────────────────────
async function loadAQI(){
  try{
    const r=await fetch(`${API}/api/airquality?lat=${S.lat}&lng=${S.lng}`);
    if(!r.ok)throw new Error('HTTP '+r.status);
    S.aqi=await r.json();
    const aqi=S.aqi.current?.us_aqi;
    if(aqi!=null){
      const el=$('wcAQI');
      if(el){const lbl=aqi<=50?'Good':aqi<=100?'Moderate':aqi<=150?'Unhealthy*':aqi<=200?'Unhealthy':aqi<=300?'Very Unhealthy':'Hazardous';const clr=aqi<=50?'#22c55e':aqi<=100?'#f59e0b':aqi<=150?'#f97316':aqi<=200?'#ef4444':aqi<=300?'#a855f7':'#7f1d1d';el.textContent=aqi+' '+lbl;el.style.color=clr;}
    }
  }catch(e){SS.log('AQI failed',e.message);const el=$('wcAQI');if(el)el.textContent='N/A';}
}

async function openAQIPanel(){
  openModal('aqiModal');
  const body=$('aqiBody');body.innerHTML='<div class="empty-s"><div class="es-ico">💨</div><div>Loading…</div></div>';
  if(!S.aqi){await loadAQI();}
  if(!S.aqi){body.innerHTML='<div class="empty-s"><div class="es-ico">⚠</div><div>AQI unavailable</div></div>';return;}
  const c=S.aqi.current||{},aqi=c.us_aqi,pct=Math.min(100,((aqi||0)/500)*100);
  const aqiClr=v=>v<=50?'#22c55e':v<=100?'#f59e0b':v<=150?'#f97316':v<=200?'#ef4444':v<=300?'#a855f7':'#7f1d1d';
  const aqiLbl=v=>v<=50?'Good':v<=100?'Moderate':v<=150?'Sensitive':v<=200?'Unhealthy':v<=300?'Very Unhealthy':'Hazardous';
  const stat=(l,v,u)=>`<div class="aqi-stat"><div class="aqi-stat-l">${l}</div><div class="aqi-stat-v">${v!=null?parseFloat(v).toFixed(1):'--'} <span style="font-size:10px;color:var(--t3)">${u}</span></div></div>`;
  body.innerHTML=`<div class="aqi-hero"><div style="font-size:2.5rem;font-weight:800;color:${aqiClr(aqi)}">${aqi??'--'}</div><div style="color:${aqiClr(aqi)};font-weight:600">${aqiLbl(aqi)}</div><div style="background:rgba(255,255,255,.08);border-radius:4px;height:8px;overflow:hidden;margin-top:8px"><div style="width:${pct}%;height:100%;background:${aqiClr(aqi)};border-radius:4px"></div></div></div><div class="aqi-grid">${stat('PM2.5',c.pm2_5,'μg/m³')}${stat('PM10',c.pm10,'μg/m³')}${stat('NO₂',c.nitrogen_dioxide,'μg/m³')}${stat('O₃',c.ozone,'μg/m³')}${stat('SO₂',c.sulphur_dioxide,'μg/m³')}${stat('CO',c.carbon_monoxide?(c.carbon_monoxide/1000).toFixed(2):null,'mg/m³')}</div>`;
}

// ── MARINE ─────────────────────────────────────────────────────────
async function openMarinePanel(){
  openModal('marineModal');
  const body=$('marineBody');body.innerHTML='<div class="empty-s"><div class="es-ico">🌊</div><div>Loading…</div></div>';
  try{
    const r=await fetch(`${API}/api/marine?lat=${S.lat}&lng=${S.lng}`);
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();
    if(d.error)throw new Error(d.error);
    const c=d.current||{};
    const mst=(l,v)=>`<div class="marine-stat"><div style="font-size:.65rem;color:var(--t3);text-transform:uppercase;font-weight:600">${l}</div><div style="font-size:.85rem;font-weight:600;color:var(--t1)">${v}</div></div>`;
    body.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px">${mst('🌊 Wave Height',c.wave_height!=null?c.wave_height.toFixed(1)+' m':'N/A')}${mst('⏱ Wave Period',c.wave_period!=null?c.wave_period.toFixed(1)+' s':'N/A')}${mst('🧭 Wave Dir',c.wave_direction!=null?wDir(c.wave_direction):'N/A')}${mst('🌊 Swell Height',c.swell_wave_height!=null?c.swell_wave_height.toFixed(1)+' m':'N/A')}${mst('⏱ Swell Period',c.swell_wave_period!=null?c.swell_wave_period.toFixed(1)+' s':'N/A')}${mst('💨 Wind Wave',c.wind_wave_height!=null?c.wind_wave_height.toFixed(1)+' m':'N/A')}</div><div style="padding:8px;font-size:.72rem;color:var(--t3)">📡 Open-Meteo Marine API — coastal &amp; ocean areas only</div>`;
  }catch(e){SS.log('Marine failed',e.message);body.innerHTML='<div class="empty-s"><div class="es-ico">🌊</div><div>Marine data unavailable (inland location?)</div></div>';}
}

// ── ALERTS ─────────────────────────────────────────────────────────
async function loadAlerts(){
  try{
    const r=await fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert',{headers:{'User-Agent':'(StormSurgeWeather/14.0)','Accept':'application/geo+json'}});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();
    S.alerts=(d.features||[]).filter(f=>f.properties?.event&&new Date(f.properties.expires)>new Date());
    renderAlerts(); updateAlertCount();
    if(S.cfg.alertZones&&S.map)putAlertsOnMap();
    console.log('✓ Alerts loaded', S.alerts.length);
  }catch(e){SS.log('Alerts failed',e.message);S.alerts=[];renderAlerts();updateAlertCount();}
}

function updateAlertCount(){
  const n=S.alerts.length;
  st('alertBadge',n); st('navAlertBadge',n||'');
  const nb=$('navAlertBadge');if(nb)nb.style.display=n>0?'':'none';
}

function alertSev(ev){const e=(ev||'').toLowerCase();if(e.includes('tornado')||e.includes('hurricane')||e.includes('extreme'))return'emergency';if(e.includes('warning'))return'warning';if(e.includes('watch'))return'watch';if(e.includes('advisory'))return'advisory';return'default';}
function alertIcon(ev){const e=(ev||'').toLowerCase();if(e.includes('tornado'))return'🌪';if(e.includes('hurricane')||e.includes('typhoon'))return'🌀';if(e.includes('thunder'))return'⛈';if(e.includes('snow')||e.includes('blizzard')||e.includes('winter'))return'❄️';if(e.includes('flood'))return'🌊';if(e.includes('wind'))return'💨';if(e.includes('fog'))return'🌫';if(e.includes('fire')||e.includes('heat'))return'🔥';if(e.includes('ice')||e.includes('frost'))return'🧊';return'⚠️';}

function renderAlerts(){
  if(S.rightTab!=='alerts')return;
  const body=$('alertsBody');
  const q=(S.alertQuery||'').trim().toLowerCase();
  const filtered=S.alerts.filter((a,i)=>{
    a._idx=i;
    const sevOK=S.alertFilter==='all'||alertSev(a.properties.event)===S.alertFilter;
    if(!sevOK)return false;
    if(!q)return true;
    const p=a.properties||{};
    return[p.event,p.headline,p.areaDesc,p.description,p.senderName].join(' ').toLowerCase().includes(q);
  });
  const filterBar=`<div class="alert-filters"><button class="af-btn${S.alertFilter==='all'?' active':''}" data-f="all">All <span>${S.alerts.length}</span></button><button class="af-btn${S.alertFilter==='emergency'?' active':''}" data-f="emergency">🌪</button><button class="af-btn${S.alertFilter==='warning'?' active':''}" data-f="warning">⚠</button><button class="af-btn${S.alertFilter==='watch'?' active':''}" data-f="watch">👁</button><button class="af-btn${S.alertFilter==='advisory'?' active':''}" data-f="advisory">ℹ</button><button class="af-refresh" id="alRefresh">↻</button></div><div class="alert-search"><input id="alSearchInput" type="text" placeholder="Search…" value="${_esc(S.alertQuery||'')}"><button id="alSearchBtn">Go</button></div>`;
  if(!filtered.length){body.innerHTML=filterBar+'<div class="empty-s"><div class="es-ico">✓</div><div>No active alerts</div></div>';bindAlertUI();return;}
  body.innerHTML=filterBar+filtered.map(a=>{
    const p=a.properties,sev=alertSev(p.event),ico=alertIcon(p.event);
    const area=p.areaDesc?p.areaDesc.split(';')[0].trim():'Unknown';
    const exp=p.expires?new Date(p.expires):null;
    return`<div class="acard sev-${sev}" data-i="${a._idx}" tabindex="0" role="button"><div class="ac-header"><span>${ico}</span><div><div class="ac-event">${_esc(p.event)}</div><div class="ac-area">📍 ${_esc(area)}</div></div><span class="ac-arr">›</span></div><div class="ac-hl">${_esc(p.headline||'')}</div>${exp?`<div class="ac-exp">Expires ${fmtDT(exp)}</div>`:''}</div>`;
  }).join('');
  document.querySelectorAll('.acard').forEach(card=>{
    const open=()=>openAlertModal(+card.dataset.i);
    card.addEventListener('click',open);
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')open();});
  });
  bindAlertUI();
}

function bindAlertUI(){
  document.querySelectorAll('.af-btn').forEach(btn=>btn.addEventListener('click',()=>{S.alertFilter=btn.dataset.f;renderAlerts();}));
  const rb=$('alRefresh');if(rb)rb.addEventListener('click',()=>{toast('Refreshing…');loadAlerts();});
  const sb=$('alSearchBtn'),si=$('alSearchInput');
  const run=()=>{S.alertQuery=si?si.value.trim():'';renderAlerts();};
  if(sb)sb.addEventListener('click',run);
  if(si)si.addEventListener('keydown',e=>{if(e.key==='Enter')run();});
}

function fmtAlertText(text){
  if(!text?.trim())return'<p style="color:var(--t3)">No details.</p>';
  const paras=[];let cur=[];
  text.trim().split('\n').forEach(line=>{if(line.trim()===''){if(cur.length){paras.push(cur.join('\n'));cur=[];}}else cur.push(line);});
  if(cur.length)paras.push(cur.join('\n'));
  return paras.map(para=>{const t=para.trim();if(!t)return'';const alpha=t.replace(/[^A-Za-z]/g,'');if(alpha.length>1&&alpha===alpha.toUpperCase()&&t.length<80)return'<div class="ad-head">'+_esc(t)+'</div>';return'<p>'+_esc(t).replace(/\n/g,'<br>')+'</p>';}).join('');
}

function openAlertModal(idx){
  const alert=S.alerts[idx];if(!alert)return;
  const p=alert.properties,ico=alertIcon(p.event);
  const onset=p.onset?new Date(p.onset):p.sent?new Date(p.sent):null;
  const expires=p.expires?new Date(p.expires):null;
  st('mTitle',ico+' '+p.event);
  $('mBody').innerHTML=`<div class="ad-hdr"><div class="ad-ico">${ico}</div><div class="ad-title">${_esc(p.headline||p.event)}</div></div><div class="ad-chips">${onset?`<span class="ad-chip">📅 ${onset.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span>`:''} ${expires?`<span class="ad-chip">⏱ ${fmtDT(expires)}</span>`:''} ${p.severity?`<span class="ad-chip">⚡ ${_esc(p.severity)}</span>`:''} ${p.certainty?`<span class="ad-chip">🎯 ${_esc(p.certainty)}</span>`:''} ${p.urgency?`<span class="ad-chip">⏰ ${_esc(p.urgency)}</span>`:''}</div>${p.areaDesc?`<div class="ad-area">📍 ${_esc(p.areaDesc.split(';').map(s=>s.trim()).filter(Boolean).slice(0,6).join(' · '))}</div>`:''}<div class="ad-section"><div class="ad-sub">Description</div><div class="ad-text">${fmtAlertText(p.description)}</div></div>${p.instruction?`<div class="ad-section"><div class="ad-sub">⚠ Instructions</div><div class="ad-text ad-instr">${fmtAlertText(p.instruction)}</div></div>`:''} ${p.senderName?`<div class="ad-sender">Issued by: ${_esc(p.senderName)}</div>`:''}`;
  openModal('alertModal');
}

function putAlertsOnMap(){
  if(!S.map||!S.map.isStyleLoaded())return;
  rmLayers(['alert-fill','alert-line'],['alerts-src']);
  const valid=S.alerts.filter(a=>a.geometry);if(!valid.length)return;
  try{
    S.map.addSource('alerts-src',{type:'geojson',data:{type:'FeatureCollection',features:valid.map(a=>({type:'Feature',geometry:a.geometry,properties:{event:a.properties.event,severity:alertSev(a.properties.event)}}))}});
    S.map.addLayer({id:'alert-fill',type:'fill',source:'alerts-src',paint:{'fill-color':['match',['get','severity'],'emergency','#ff2020','warning','#ef4444','watch','#06b6d4','#f59e0b'],'fill-opacity':.16}});
    S.map.addLayer({id:'alert-line',type:'line',source:'alerts-src',paint:{'line-color':['match',['get','severity'],'emergency','#ff2020','warning','#ef4444','watch','#06b6d4','#f59e0b'],'line-width':1.5}});
    S.map.on('mouseenter','alert-fill',()=>S.map.getCanvas().style.cursor='pointer');
    S.map.on('mouseleave','alert-fill',()=>S.map.getCanvas().style.cursor='');
  }catch(e){SS.log('Alert map overlay failed',e.message);}
}

function rmLayers(layers,sources){
  if(!S.map)return;
  try{layers.forEach(l=>{if(S.map.getLayer(l))S.map.removeLayer(l);});}catch(e){}
  try{sources.forEach(s=>{if(S.map.getSource(s))S.map.removeSource(s);});}catch(e){}
}

// ── STORM REPORTS ─────────────────────────────────────────────────
function renderStormReports(){
  if(S.rightTab!=='severe')return;
  const body=$('alertsBody');
  if(!S.stormReports.length){body.innerHTML='<div class="empty-s"><div class="es-ico">⛈</div><div>Loading reports…</div></div>';loadStormReports();return;}
  body.innerHTML='<div class="sr-head">⛈ SPC Storm Reports</div>'+S.stormReports.slice(0,20).map(r=>'<div class="sr-row"><span class="sr-type sr-'+r.type+'">'+{tornado:'🌪',hail:'🧊',wind:'💨'}[r.type||'']||'⚠'+' '+r.type.toUpperCase()+'</span><span class="sr-mag">'+_esc(r.magnitude||'?')+'</span><span class="sr-text">'+_esc(r.text||'')+'</span></div>').join('')+'<div class="sr-src">Source: NOAA SPC</div>';
}

async function loadStormReports(){
  try{
    const r=await fetch(`${API}/api/storm-reports`);
    S.stormReports=(await r.json()).items||[];
    if(S.rightTab==='severe')renderStormReports();
    putReportsOnMap();
  }catch(e){SS.log('Storm reports failed',e.message);}
}

function putReportsOnMap(){
  if(!S.map||!S.map.isStyleLoaded())return;
  rmLayers(['reports-circle'],['reports-src']);
  if(!S.stormReports.length)return;
  try{
    S.map.addSource('reports-src',{type:'geojson',data:{type:'FeatureCollection',features:S.stormReports.filter(r=>r.lat&&r.lng).map(r=>({type:'Feature',geometry:{type:'Point',coordinates:[r.lng,r.lat]},properties:{type:r.type,mag:r.magnitude}}))}});
    S.map.addLayer({id:'reports-circle',type:'circle',source:'reports-src',paint:{'circle-radius':6,'circle-color':['match',['get','type'],'tornado','#ef4444','hail','#06b6d4','#f59e0b'],'circle-stroke-width':1.5,'circle-stroke-color':'#fff','circle-opacity':.9}});
  }catch(e){SS.log('Reports map overlay failed',e.message);}
}

// ── RADAR INFO ────────────────────────────────────────────────────
function renderRadarInfo(){
  const frames=window.RadarAnimator?RadarAnimator._allFrames?..()||allF():allF();
  const newest=frames.length?new Date(frames[frames.length-1].time*1000):null;
  const oldest=frames.length?new Date(frames[0].time*1000):null;
  const rs=(l,v)=>`<div class="ri-stat"><span>${_esc(l)}</span><span>${_esc(String(v))}</span></div>`;
  $('alertsBody').innerHTML='<div class="radar-info">'+
    '<div class="ri-title">Radar</div>'+
    rs('Source','RainViewer')+rs('Frames',S.frames.length+'/12')+rs('Nowcast',S.nowcastFrames.length+' frames')+
    rs('Latest',newest?fmtT(newest,true):'N/A')+rs('Oldest',oldest?fmtT(oldest,true):'N/A')+
    rs('Color',{'1':'Classic','2':'Universal','4':'Rainbow','6':'NOAA','7':'Dark Sky'}[S.cfg.radarColor]||'NOAA')+
    '<div class="ri-title" style="margin-top:12px">NEXRAD</div>'+
    rs('Station',window.NexradRadar?.isVisible()?(NexradRadar._station?.id||'—'):'Off')+
    rs('Product',window.NexradRadar?.isVisible()?(NexradRadar._product||'—'):'—')+
    '<div class="ri-title" style="margin-top:12px">Spotter</div>'+
    rs('Reports',S.spotterReports.length+' nearby')+
    rs('Status',window.SpotterNetwork?.isVisible()?'Active':'Off')+
    '<div style="display:flex;gap:6px;margin-top:10px">'+
    '<button class="ri-btn" onclick="if(window.RadarAnimator)RadarAnimator.refresh();toast(\'↻ Refreshed\')">↻ Refresh</button>'+
    '<button class="ri-btn" onclick="toggleNowcast()">Nowcast</button>'+
    '<button class="ri-btn" onclick="if(window.NexradPanel)NexradPanel.toggle()">NEXRAD</button>'+
    '</div></div>';
}

// ── SEARCH & GEOCODE ──────────────────────────────────────────────
async function doSearch(q){
  if(!q||q.length<2){hideDrop();return;}
  try{
    const d=await(await fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/'+encodeURIComponent(q)+'.json?access_token='+window.MAPBOX_TOKEN+'&limit=6&types=place,locality,neighborhood,postcode,address')).json();
    showDrop(d.features||[]);
  }catch(e){SS.log('Search failed',e.message);hideDrop();}
}
function showDrop(features){
  const dd=$('searchDrop');if(!features.length){hideDrop();return;}
  dd.classList.add('show');dd.style.display='block';
  dd.innerHTML=features.map((f,i)=>{
    const main=f.text||f.place_name.split(',')[0],sub=f.place_name.split(',').slice(1,3).join(',').trim();
    return`<div class="tb-drop-item" data-i="${i}"><strong>${_esc(main)}</strong>${sub?` <span>${_esc(sub)}</span>`:''}</div>`;
  }).join('');
  dd.querySelectorAll('.tb-drop-item').forEach(item=>{
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
function hideDrop(){const dd=$('searchDrop');dd.style.display='none';dd.classList.remove('show');}

async function reverseGeo(lat,lng){
  try{
    const d=await(await fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/'+lng+','+lat+'.json?access_token='+window.MAPBOX_TOKEN+'&limit=1')).json();
    if(d.features?.length){S.locName=d.features[0].text||d.features[0].place_name.split(',')[0];st('locName',S.locName);st('tbLocName',S.locName);st('wcLoc',S.locName);}
  }catch(e){SS.log('Reverse geocode failed',e.message);}
}

function geolocate(){
  if(!navigator.geolocation){toast('⚠ Geolocation not supported');return;}
  toast('📍 Locating…');
  navigator.geolocation.getCurrentPosition(
    pos=>{S.lat=pos.coords.latitude;S.lng=pos.coords.longitude;if(S.map)S.map.flyTo({center:[S.lng,S.lat],zoom:10,duration:1200});reverseGeo(S.lat,S.lng);loadWeather();},
    ()=>{SS.log('Geolocation denied');toast('⚠ Location denied');}
  );
}

// ── FAVORITES ─────────────────────────────────────────────────────
function loadFavs(){try{const s=localStorage.getItem('ss_favs');if(s)S.favorites=JSON.parse(s);}catch(e){}renderFavs();}
function saveFavs(){try{localStorage.setItem('ss_favs',JSON.stringify(S.favorites));}catch(e){}}
function addFav(){if(S.favorites.some(f=>f.name===S.locName)){toast('★ Already saved');return;}S.favorites.push({name:S.locName,lat:S.lat,lng:S.lng});saveFavs();renderFavs();toast('★ Saved '+S.locName);}
function rmFav(name){S.favorites=S.favorites.filter(f=>f.name!==name);saveFavs();renderFavs();}
function goFav(fav){S.lat=fav.lat;S.lng=fav.lng;S.locName=fav.name;st('locName',fav.name);st('tbLocName',fav.name);if(S.map)S.map.flyTo({center:[fav.lng,fav.lat],zoom:9,duration:1200});loadWeather();loadAlerts();toast('📍 '+fav.name);}
function renderFavs(){
  const el=$('favList');if(!el)return;
  if(!S.favorites.length){el.innerHTML='<div class="fav-empty">No saved locations</div>';return;}
  el.innerHTML=S.favorites.map(f=>`<div class="fav-item"><button class="fav-loc" data-n="${_esc(f.name)}">${_esc(f.name)}</button><button class="fav-del" data-n="${_esc(f.name)}">×</button></div>`).join('');
  el.querySelectorAll('.fav-loc').forEach(btn=>btn.addEventListener('click',()=>{const f=S.favorites.find(x=>x.name===btn.dataset.n);if(f)goFav(f);}));
  el.querySelectorAll('.fav-del').forEach(btn=>btn.addEventListener('click',()=>rmFav(btn.dataset.n)));
}

// ── SHARE CARD ────────────────────────────────────────────────────
function openShareCard(){
  openModal('shareModal');
  const canvas=$('shareCanvas');canvas.width=640;canvas.height=320;
  const ctx=canvas.getContext('2d'),d=S.weather?.current||{},code=d.weather_code||0;
  const isStorm=code>=95,isRain=code>=51,isSunny=code<=1;
  const g=isStorm?['#1a0033','#2d0052']:isRain?['#0c1445','#1e3a5f']:isSunny?['#0f2957','#1a4a7a']:['#111827','#1f2937'];
  const grad=ctx.createLinearGradient(0,0,640,320);grad.addColorStop(0,g[0]);grad.addColorStop(1,g[1]);
  ctx.fillStyle=grad;ctx.fillRect(0,0,640,320);
  ctx.fillStyle='rgba(255,255,255,.08)';ctx.fillRect(0,0,640,48);
  ctx.fillStyle='rgba(255,255,255,.9)';ctx.font='bold 13px Inter';ctx.fillText('⛈ STORM SURGE WEATHER v14.0',22,32);
  ctx.fillStyle='rgba(255,255,255,.35)';ctx.font='11px JetBrains Mono';ctx.fillText(new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}),22,47);
  ctx.font='900 80px Inter';ctx.fillStyle='#ffffff';ctx.fillText(cvtT(d.temperature_2m)+'°'+S.cfg.tempUnit,22,160);
  ctx.font='64px sans-serif';ctx.fillText(wIcon(d.weather_code),340,155);
  ctx.font='bold 20px Inter';ctx.fillStyle='rgba(255,255,255,.85)';ctx.fillText(S.locName,22,190);
  ctx.font='14px Inter';ctx.fillStyle='rgba(255,255,255,.7)';ctx.fillText(wDesc(d.weather_code)+'  ·  Feels '+cvtT(d.apparent_temperature)+'°',22,215);
  ctx.font='12px JetBrains Mono';ctx.fillStyle='rgba(255,255,255,.55)';
  ['💧 '+(d.relative_humidity_2m??'--')+'%','💨 '+cvtW(d.wind_speed_10m)+' '+wu(),'📊 '+Math.round(d.surface_pressure??0)+' hPa','☀ UV '+(d.uv_index??'--')].forEach((s,i)=>ctx.fillText(s,22+i*155,250));
  const daily=S.weather?.daily;
  if(daily?.temperature_2m_max?.[0]!=null){ctx.font='bold 13px JetBrains Mono';ctx.fillStyle='#f97316';ctx.fillText('H: '+cvtT(daily.temperature_2m_max[0])+'°  ',22,280);ctx.fillStyle='#06b6d4';ctx.fillText('L: '+cvtT(daily.temperature_2m_min[0])+'°',90,280);}
}

// ── LEGEND ────────────────────────────────────────────────────────
function updateLegend(){
  const layer=document.querySelector('.lb.active')?.dataset.layer||'precipitation';
  const cfg={precipitation:{label:'mm/h',grad:'linear-gradient(to top,#555 0%,#04e9e7 15%,#019ff4 30%,#02fd02 45%,#fdf802 60%,#fd9500 75%,#fd0000 90%,#bc0000 100%)'},temperature:{label:'°C',grad:'linear-gradient(to top,#313695,#4575b4,#abd9e9,#ffffbf,#fdae61,#a50026)'},wind:{label:'m/s',grad:'linear-gradient(to top,#1a1a2e,#533483,#e94560)'},clouds:{label:'%',grad:'linear-gradient(to top,#111,#666,#ccc)'},pressure:{label:'hPa',grad:'linear-gradient(to top,#023858,#74a9cf)'}};
  const c=cfg[layer]||cfg.precipitation;
  st('legTitle',c.label);const lb=$('legBar');if(lb)lb.style.background=c.grad;
}

// ── UI WIRING ─────────────────────────────────────────────────────
function initUI(){
  $('burger').onclick=()=>$('sidebar').classList.toggle('open');
  $('sidebarX').onclick=()=>$('sidebar').classList.remove('open');
  $('zoomIn').onclick=()=>S.map?.zoomIn();
  $('zoomOut').onclick=()=>S.map?.zoomOut();
  $('styleBtn').onclick=cycleStyle;
  $('geoBtn').onclick=geolocate;
  $('refreshBtn').onclick=()=>{loadWeather();loadAlerts();if(S.map)loadRadar();toast('↻ Refreshing…');};
  $('playBtn').onclick=togglePlay;
  $('favAddBtn').onclick=addFav;
  $('shareBtn').onclick=openShareCard;

  $('spotterBtn').onclick=()=>{
    const active=SpotterNetwork?.toggle(S.lat,S.lng);
    $('spotterBtn').classList.toggle('active',!!active);
    toast(active?'🌐 Spotter ON':'Spotter OFF');
    if(active){document.querySelectorAll('.rpt').forEach(x=>x.classList.remove('active'));document.querySelector('.rpt[data-rt="severe"]')?.classList.add('active');S.rightTab='severe';renderStormReports();}
  };

  $('severeBtn').onclick=()=>{
    if(window.SeverePanel){if(SeverePanel.isOpen()){SeverePanel.close();$('severeBtn').classList.remove('active');}else{SeverePanel.load(S.lat,S.lng);$('severeBtn').classList.add('active');}}
  };

  const nwsBtn=$('nwsSocialBtn');
  if(nwsBtn)nwsBtn.onclick=()=>{if(!window.NWSsocial)return;const open=NWSsocial.toggle(S.lat,S.lng);nwsBtn.classList.toggle('active',open);toast(open?'🐦 NWS Feed ON':'NWS Feed OFF');};

  const ppBtn=$('proPanelBtn');
  if(ppBtn)ppBtn.onclick=()=>{if(!window.ProPanel)return;const open=ProPanel.toggle('radar');ppBtn.classList.toggle('active',open);toast(open?'🔬 Pro Tools':'Pro Tools closed');};

  $('tRange').addEventListener('input',e=>goFrame(+e.target.value));
  $('quickOpacity').addEventListener('input',e=>{S.cfg.opacity=+e.target.value/100;const so=$('sOpacity');if(so)so.value=e.target.value;const sv=$('sOpacityVal');if(sv)sv.textContent=e.target.value+'%';if(window.RadarAnimator)RadarAnimator.setOpacity(S.cfg.opacity);saveCfg();});
  $('tPrev').onclick=()=>{if(S.frame>0)goFrame(S.frame-1);};
  $('tNext').onclick=()=>{if(S.frame<allF().length-1)goFrame(S.frame+1);};
  $('drawBtn').onclick=()=>S.drawMode?exitDraw():enterDraw();
  $('drawExit').onclick=exitDraw;
  $('drawUndo').onclick=undoDraw;
  $('drawClear').onclick=clearDraw;
  document.querySelectorAll('.dc').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.dc').forEach(b=>b.classList.remove('active'));btn.classList.add('active');S.drawColor=btn.dataset.c;});
  document.querySelectorAll('.ds').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.ds').forEach(b=>b.classList.remove('active'));btn.classList.add('active');S.drawSize=+btn.dataset.s;});

  $('themeBtn').onclick=()=>{const t=S.cfg.theme==='dark'?'light':'dark';applyTheme(t);saveCfg();if(S.map)S.map.setStyle(MAP_STYLES[t==='light'?'light':'dark']);toast(t==='dark'?'🌙 Dark':'☀️ Light');};

  document.querySelectorAll('.lb[data-layer]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.lb[data-layer]').forEach(x=>{x.classList.remove('active');});b.classList.add('active');updateLegend();toast(b.textContent.trim());});

  document.querySelectorAll('.fct').forEach(t=>t.onclick=()=>{document.querySelectorAll('.fct').forEach(x=>x.classList.remove('active'));t.classList.add('active');S.fcMode=t.dataset.ft;if(S.weather)renderForecast(S.weather);});

  document.querySelectorAll('.rpt').forEach(t=>t.onclick=()=>{document.querySelectorAll('.rpt').forEach(x=>x.classList.remove('active'));t.classList.add('active');S.rightTab=t.dataset.rt;if(S.rightTab==='alerts')renderAlerts();else if(S.rightTab==='info')renderRadarInfo();else if(S.rightTab==='severe')renderStormReports();});

  document.querySelectorAll('.sni').forEach(item=>item.onclick=e=>{
    e.preventDefault();
    document.querySelectorAll('.sni').forEach(x=>x.classList.remove('active'));item.classList.add('active');
    const p=item.dataset.p;
    if(p==='settings')openModal('settingsModal');
    else if(p==='aqi')openAQIPanel();
    else if(p==='marine')openMarinePanel();
    else if(p==='cameras')openModal('cameraModal');
    else if(p==='errorlog'){document.getElementById('errorLog').classList.toggle('open');$('sidebar').classList.remove('open');}
    else if(p==='nwssocial'){if(window.NWSsocial)NWSsocial.toggle(S.lat,S.lng);}
    else if(p==='widgets'){const wp=$('widgets-panel');wp?.classList.toggle('open');if(wp?.classList.contains('open')&&S.weather)refreshWidgets(S.weather);$('sidebar').classList.remove('open');}
    else if(p==='alerts'){document.querySelectorAll('.rpt').forEach(x=>x.classList.remove('active'));document.querySelector('.rpt[data-rt="alerts"]')?.classList.add('active');S.rightTab='alerts';renderAlerts();}
  });

  let st_;
  $('searchInput').addEventListener('input',e=>{clearTimeout(st_);const v=e.target.value.trim();if(v.length<2){hideDrop();return;}st_=setTimeout(()=>doSearch(v),300);});
  $('searchInput').addEventListener('keydown',e=>{if(e.key==='Escape'){hideDrop();e.target.value='';}if(e.key==='Enter')doSearch(e.target.value.trim());});
  document.addEventListener('click',e=>{if(!document.querySelector('.searchbox')?.contains(e.target))hideDrop();});

  $('mClose').onclick=()=>closeModal('alertModal');
  $('alertModal').onclick=e=>{if(e.target===$('alertModal'))closeModal('alertModal');};
  $('sClose').onclick=closeSettingsModal;
  $('settingsModal').onclick=e=>{if(e.target===$('settingsModal'))closeSettingsModal();};
  $('aqiClose').onclick=()=>closeModal('aqiModal');
  $('aqiModal').onclick=e=>{if(e.target===$('aqiModal'))closeModal('aqiModal');};
  $('marineClose').onclick=()=>closeModal('marineModal');
  $('marineModal').onclick=e=>{if(e.target===$('marineModal'))closeModal('marineModal');};
  $('camClose').onclick=()=>closeModal('cameraModal');
  $('cameraModal').onclick=e=>{if(e.target===$('cameraModal'))closeModal('cameraModal');};
  $('shareClose').onclick=()=>closeModal('shareModal');
  $('shareModal').onclick=e=>{if(e.target===$('shareModal'))closeModal('shareModal');};

  $('shareDL').onclick=()=>{const a=document.createElement('a');a.download='storm-surge-'+S.locName.toLowerCase().replace(/\s+/g,'-')+'.png';a.href=$('shareCanvas').toDataURL('image/png');a.click();toast('⬇ Downloaded');};
  $('shareCopy').onclick=()=>navigator.clipboard.writeText(window.location.href).then(()=>toast('📋 Copied')).catch(()=>toast('⚠ Copy failed'));

  $('camSearchBtn').onclick=()=>{const q=$('camSearch').value.trim();if(!q)return;$('camGrid').innerHTML='<div class="empty-s"><div class="es-ico">📷</div><div><a href="https://hazcams.com/search?query='+encodeURIComponent(q)+'" target="_blank" rel="noopener" style="color:#3b82f6">Open Hazcams → '+_esc(q)+'</a></div></div>';};
  $('camSearch').addEventListener('keydown',e=>{if(e.key==='Enter')$('camSearchBtn').click();});

  segBind('sTempUnit',  v=>{S.cfg.tempUnit=v;saveCfg();if(S.weather){renderWeather(S.weather);renderForecast(S.weather);}});
  segBind('sWindUnit',  v=>{S.cfg.windUnit=v;saveCfg();if(S.weather)renderWeather(S.weather);});
  segBind('sDistUnit',  v=>{S.cfg.distUnit=v;saveCfg();if(S.weather)renderWeather(S.weather);});
  segBind('sTimeFormat',v=>{S.cfg.timeFormat=v;saveCfg();if(S.weather){renderWeather(S.weather);renderForecast(S.weather);}if(S.frames.length)buildSlots();});
  segBind('sSpeed',     v=>{S.cfg.speed=+v;saveCfg();if(window.RadarAnimator)RadarAnimator.setSpeed(+v);});
  segBind('sRadarColor',v=>{S.cfg.radarColor=v;saveCfg();if(window.RadarAnimator)RadarAnimator.setColor(v);});
  segBind('sCardPos',   v=>{S.cfg.cardPos=v;saveCfg();if(S.weather)renderWeather(S.weather);});
  segBind('sCardStyle', v=>{S.cfg.cardStyle=v;saveCfg();if(S.weather)renderWeather(S.weather);});

  $('sOpacity').addEventListener('input',e=>{S.cfg.opacity=+e.target.value/100;st('sOpacityVal',e.target.value+'%');const qo=$('quickOpacity');if(qo)qo.value=e.target.value;if(window.RadarAnimator)RadarAnimator.setOpacity(S.cfg.opacity);saveCfg();});
  $('sNowcast').addEventListener('change',e=>{S.cfg.nowcast=e.target.checked;saveCfg();if(window.RadarAnimator)RadarAnimator.setNowcast(e.target.checked);if(S.frames.length)buildSlots();});
  $('sAutoPlay').addEventListener('change',e=>{S.cfg.autoPlay=e.target.checked;saveCfg();});
  $('sAlertZones').addEventListener('change',e=>{S.cfg.alertZones=e.target.checked;saveCfg();if(e.target.checked)putAlertsOnMap();else rmLayers(['alert-fill','alert-line'],['alerts-src']);});
  $('sCrosshair').addEventListener('change',e=>{S.cfg.crosshair=e.target.checked;saveCfg();const ch=$('crosshair');if(ch)ch.style.display=e.target.checked?'':'none';});
  $('sClickNWS').addEventListener('change',e=>{S.cfg.clickNWS=e.target.checked;saveCfg();});
  $('sAnimBg').addEventListener('change',e=>{S.cfg.animBg=e.target.checked;saveCfg();if(!e.target.checked)$('bgAnim').className='';else if(S.weather)updateBg(S.weather.current?.weather_code,S.weather.current?.is_day);});

  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      ['alertModal','settingsModal','aqiModal','marineModal','cameraModal','shareModal'].forEach(closeModal);
      if(window.NexradPanel)NexradPanel.close();
      if(window.ProPanel?.isOpen())ProPanel.close();
      if(window.NWSsocial?.isOpen())NWSsocial.close();
      $('widgets-panel')?.classList.remove('open');
    }
    if(e.key===' '&&document.activeElement.tagName!=='INPUT'){e.preventDefault();togglePlay();}
    if(e.key==='ArrowLeft'&&S.frame>0)goFrame(S.frame-1);
    if(e.key==='ArrowRight'&&S.frame<allF().length-1)goFrame(S.frame+1);
  });

  applySettingsUI();
  updateLegend();
  loadStormReports();
}

function segBind(cId,cb){
  document.querySelectorAll('#'+cId+' .sb').forEach(btn=>btn.onclick=()=>{
    document.querySelectorAll('#'+cId+' .sb').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');cb(btn.dataset.v);
  });
}

function openModal(id){$(id)?.classList.add('open');}
function closeModal(id){$(id)?.classList.remove('open');}
function closeSettingsModal(){closeModal('settingsModal');document.querySelectorAll('.sni').forEach(x=>x.classList.remove('active'));document.querySelector('.sni[data-p="home"]')?.classList.add('active');}

function applySettingsUI(){
  const c=S.cfg;
  [['sTempUnit',c.tempUnit],['sWindUnit',c.windUnit],['sDistUnit',c.distUnit],['sTimeFormat',c.timeFormat],['sSpeed',String(c.speed)],['sRadarColor',String(c.radarColor)],['sCardPos',c.cardPos],['sCardStyle',c.cardStyle||'full']].forEach(([id,val])=>document.querySelectorAll('#'+id+' .sb').forEach(b=>b.classList.toggle('active',b.dataset.v===val)));
  const so=$('sOpacity');if(so)so.value=Math.round(c.opacity*100);
  const qo=$('quickOpacity');if(qo)qo.value=Math.round(c.opacity*100);
  st('sOpacityVal',Math.round(c.opacity*100)+'%');
  const sn=$('sNowcast');if(sn)sn.checked=c.nowcast;
  const sa=$('sAutoPlay');if(sa)sa.checked=c.autoPlay;
  const sal=$('sAlertZones');if(sal)sal.checked=c.alertZones;
  const sc=$('sCrosshair');if(sc)sc.checked=c.crosshair;
  const scn=$('sClickNWS');if(scn)scn.checked=c.clickNWS;
  const sab=$('sAnimBg');if(sab)sab.checked=c.animBg;
  if(!c.crosshair){const ch=$('crosshair');if(ch)ch.style.display='none';}
}

function saveCfg(){try{localStorage.setItem('ss14_cfg',JSON.stringify(S.cfg));}catch(e){}}
function loadCfg(){try{const s=localStorage.getItem('ss14_cfg')||localStorage.getItem('ss13_cfg')||localStorage.getItem('ss12_cfg');if(s)Object.assign(S.cfg,JSON.parse(s));}catch(e){}}

console.log('%c⛈ Storm Surge Weather v14.0%c No AI · Error Logging · Clean', 'color:#06b6d4;font-weight:900;font-size:14px','color:#7a8ea8;font-size:11px');
