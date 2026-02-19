// ================================================================
//  STORM SURGE WEATHER v10.3 — Full clean rewrite
//  Bugs fixed:
//    1. Alert text: fmtAlertText was nested inside openAlertModal,
//       causing variable shadowing — "p" inside the fn referred to
//       the loop variable "para", not alert.properties.
//       Now a top-level standalone function.
//    2. Radar drift: project() was called AFTER awaiting tile loads,
//       so the map had already moved. Now snapshot project() BEFORE
//       the await so tiles draw at their correct position.
//    3. submitComment declared twice — second overwrote first.
//    4. getPosts/savePosts called but never defined (removed dead code).
//    5. ll2t() NaN at poles — add proper lat clamp to ±85.0511°.
//    6. Checkboxes: now immediately toggle row visibility without
//       waiting for weather reload.
// ================================================================

// ── STATE ────────────────────────────────────────────────────────
const S = {
  map: null, canvas: null, ctx: null,
  drawCanvas: null, drawCtx: null, drawing: false, drawMode: false,
  drawStrokes: [], drawColor: '#f0a500', drawSize: 3,
  lat: 40.7128, lng: -74.006, locName: 'New York',
  frames: [], frame: 0, playing: false, playTimer: null,
  alerts: [], weather: null, fcMode: 'hourly',
  mapStyle: 'dark', rightTab: 'alerts', alertFilter: 'all', alertQuery: '',
  user: null, scFilter: 'all', activeCommentId: null,
  activeOverlay: null,
  scDraft: null,
  compareMode: false, interpMode: true,
  lightning: [], hurricaneTrack: [], stormReports: [], metars: [], modelCmp: null,
  cfg: {
    tempUnit: 'C', windUnit: 'ms', timeFormat: '12',
    opacity: 0.75, speed: 600, autoPlay: false,
    alertZones: true, crosshair: true,
    cardPosition: 'top-left', cardStyle: 'full',
    showHumidity: true, showPressure: true, showUV: true,
    showSunTimes: true, showWind: true, showRain: true,
    showCloud: true, showFeels: true,
    radarColor: '6', clickAction: 'nws', theme: 'dark'
  }
};

const API_URL = (window.SS_API_URL || window.location.origin || '').replace(/\/$/, '');


function radarTileUrl(framePath, z, x, y, color){
  var p = String(framePath || '').trim();
  // RainViewer can return path-like values (preferred) or full URLs in some mirrors.
  p = p.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '');
  return API_URL+'/api/radar/tile?path='+encodeURIComponent(p+'/256/'+z+'/'+x+'/'+y+'/'+color+'/1_1.png');
}

function apiHeaders(auth) {
  const h = { 'Content-Type': 'application/json' };
  const tok = localStorage.getItem('ss_token');
  if (auth && tok) h['Authorization'] = 'Bearer ' + tok;
  return h;
}

const MAP_STYLES = {
  dark:      'mapbox://styles/mapbox/dark-v11',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  outdoors:  'mapbox://styles/mapbox/outdoors-v12',
  light:     'mapbox://styles/mapbox/light-v11'
};
const STYLE_ORDER = ['dark', 'satellite', 'outdoors', 'light'];

// ── BOOT ─────────────────────────────────────────────────────────
window.addEventListener('load', function() {
  loadCfg();
  applyTheme(S.cfg.theme);
  loadUser();
  initMap();
  initUI();
  initDrawMode();
  updateDate();
  setInterval(updateDate, 30000);
  setInterval(function() { loadWeather(); loadAlerts(); }, 600000);
});

// ── UTILITIES (defined early, used everywhere) ────────────────────
function $(id)         { return document.getElementById(id); }
function setText(id,v) { var el=$(id); if(el) el.textContent=v; }
function pad2(n)       { return String(n).padStart(2,'0'); }
function fmtTime(d, shortOnly) {
  if (S.cfg.timeFormat === '24') return pad2(d.getHours())+':'+pad2(d.getMinutes());
  var h=d.getHours()%12||12, ampm=d.getHours()>=12?'PM':'AM';
  return shortOnly ? h+ampm : h+':'+pad2(d.getMinutes())+ampm;
}
function fmtDateTime(d) {
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+fmtTime(d);
}
function timeAgo(d) {
  var s=Math.floor((Date.now()-d)/1000);
  if(s<60)return s+'s ago'; if(s<3600)return Math.floor(s/60)+'m ago';
  if(s<86400)return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago';
}
function cvtTemp(c)  { return S.cfg.tempUnit==='F'?Math.round(c*9/5+32):Math.round(c); }
function cvtWind(ms) {
  if(S.cfg.windUnit==='kmh')return(ms*3.6).toFixed(1);
  if(S.cfg.windUnit==='mph')return(ms*2.237).toFixed(1);
  return ms.toFixed(1);
}
function wDir(d) { return['N','NE','E','SE','S','SW','W','NW'][Math.round(d/45)%8]; }
function uvLabel(uv) {
  if(uv==null)return''; if(uv<=2)return'(Low)'; if(uv<=5)return'(Mod)';
  if(uv<=7)return'(High)'; if(uv<=10)return'(V.Hi)'; return'(Ext)';
}
function wIcon(c) {
  return({0:'☀️',1:'🌤',2:'⛅',3:'☁️',45:'🌫',48:'🌫',51:'🌦',53:'🌦',
    55:'🌧',56:'🌨',57:'🌨',61:'🌧',63:'🌧',65:'🌧',71:'🌨',73:'🌨',
    75:'❄️',77:'🌨',80:'🌦',81:'🌦',82:'🌧',85:'🌨',86:'❄️',
    95:'⛈',96:'⛈',99:'⛈'})[c]||'🌡';
}
function wDesc(c) {
  return({0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
    45:'Foggy',48:'Icy fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',
    61:'Light rain',63:'Moderate rain',65:'Heavy rain',71:'Light snow',
    73:'Moderate snow',75:'Heavy snow',77:'Snow grains',80:'Rain showers',
    81:'Heavy showers',82:'Violent showers',85:'Snow showers',86:'Heavy snow showers',
    95:'Thunderstorm',96:'Thunderstorm w/ hail',99:'Thunderstorm w/ heavy hail'})[c]||'Unknown';
}
function updateDate() {
  setText('datePill',new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}));
}
var _toastTimer;
function showToast(msg) {
  var t=$('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(_toastTimer); _toastTimer=setTimeout(function(){t.classList.remove('show');},3000);
}
function showLoader(show) { $('loader').classList.toggle('show',show); }
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── THEME ─────────────────────────────────────────────────────────
function applyTheme(theme) {
  S.cfg.theme=theme;
  document.documentElement.setAttribute('data-theme',theme);
  var icon=$('themeIcon'),lbl=$('themeLabel'),tog=$('themeTog');
  if(icon) icon.textContent=theme==='dark'?'🌙':'☀️';
  if(lbl)  lbl.textContent =theme==='dark'?'Dark Mode':'Light Mode';
  if(tog)  tog.classList.toggle('on',theme==='dark');
}

// ── MAP ───────────────────────────────────────────────────────────
function initMap() {
  S.canvas=$('radarCanvas');
  S.ctx=S.canvas.getContext('2d');
  window.addEventListener('resize',resizeCanvas);
  try {
    mapboxgl.accessToken=MAPBOX_TOKEN;
    S.map=new mapboxgl.Map({
      container:'map',
      style:MAP_STYLES[S.cfg.theme==='light'?'light':'dark'],
      center:[S.lng,S.lat], zoom:6, minZoom:2, maxZoom:14,
      attributionControl:false, logoPosition:'bottom-left',
      failIfMajorPerformanceCaveat:false,
      renderWorldCopies:false
    });
    S.map.on('load',function(){
      S.map.resize(); resizeCanvas();
      loadRadar(); loadWeather(); loadAlerts(); loadAdvancedData();
    });
    S.map.on('error',function(e){
      console.error('Mapbox:',e);
      showMapError('Map error — check your Mapbox token');
      loadWeather(); loadAlerts();
    });
    // Keep radar visually attached during map movement by drawing from cached tiles immediately.
    ['move','rotate','pitch'].forEach(function(ev){
      S.map.on(ev,function(){
        if(!S.frames.length||S.drawMode) return;
        drawCachedFrame();
      });
    });
    // After movement ends: refresh tile cache for newly visible area.
    ['moveend','zoomend'].forEach(function(ev){
      S.map.on(ev,function(){
        if(!S.frames.length||S.drawMode) return;
        tileCache.clear(); prewarmCache(); scheduleRadarDraw();
      });
    });
    S.map.on('click',function(e){ if(!S.drawMode) handleMapClick(e); });
  } catch(e) {
    console.error('Map init failed:',e);
    showMapError('Could not init map — set MAPBOX_TOKEN (or MAPBOX_ACCESS_TOKEN)');
    loadWeather(); loadAlerts();
  }
}

function showMapError(msg) {
  $('map').innerHTML='<div style="display:flex;align-items:center;justify-content:center;'+
    'height:100%;color:#f0a500;font-family:monospace;font-size:13px;flex-direction:column;'+
    'gap:10px;padding:20px;text-align:center"><div style="font-size:36px">⛈</div>'+
    '<div style="font-weight:bold">'+msg+'</div>'+
    '<a href="https://account.mapbox.com" target="_blank" style="color:#00d4c8;font-size:11px">'+
    'Get token → account.mapbox.com</a></div>';
}

function cycleMapStyle() {
  if(!S.map) return;
  var i=STYLE_ORDER.indexOf(S.mapStyle);
  S.mapStyle=STYLE_ORDER[(i+1)%STYLE_ORDER.length];
  S.map.setStyle(MAP_STYLES[S.mapStyle]);
  S.map.once('style.load',function(){
    if(S.cfg.alertZones&&S.alerts.length) putAlertsOnMap();
    tileCache.clear(); loadRadar();
    showToast('🗺 '+S.mapStyle);
  });
}

function resizeCanvas() {
  [S.canvas,S.drawCanvas].forEach(function(c){
    if(!c) return;
    c.width=c.parentElement.clientWidth;
    c.height=c.parentElement.clientHeight;
  });
  if(S.frames.length) scheduleRadarDraw();
}

// ── DRAW MODE ─────────────────────────────────────────────────────
function initDrawMode() {
  S.drawCanvas=$('drawCanvas');
  S.drawCtx=S.drawCanvas.getContext('2d');
  function mpos(e){ var r=S.drawCanvas.getBoundingClientRect(); return{x:e.clientX-r.left,y:e.clientY-r.top}; }
  function tpos(e){ var r=S.drawCanvas.getBoundingClientRect(); return{x:e.touches[0].clientX-r.left,y:e.touches[0].clientY-r.top}; }
  function stroke(ctx,color,size){ ctx.strokeStyle=color; ctx.lineWidth=size; ctx.lineCap='round'; ctx.lineJoin='round'; }

  S.drawCanvas.addEventListener('mousedown',function(e){
    if(!S.drawMode) return; S.drawing=true;
    var p=mpos(e); S.drawCtx.beginPath(); S.drawCtx.moveTo(p.x,p.y); S.drawStrokes.push([p]);
  });
  S.drawCanvas.addEventListener('mousemove',function(e){
    if(!S.drawMode||!S.drawing) return;
    var p=mpos(e); S.drawCtx.lineTo(p.x,p.y);
    stroke(S.drawCtx,S.drawColor,S.drawSize); S.drawCtx.stroke();
    S.drawStrokes[S.drawStrokes.length-1].push(p);
  });
  ['mouseup','mouseleave'].forEach(function(ev){ S.drawCanvas.addEventListener(ev,function(){ S.drawing=false; }); });
  S.drawCanvas.addEventListener('touchstart',function(e){
    if(!S.drawMode) return; e.preventDefault(); S.drawing=true;
    var p=tpos(e); S.drawCtx.beginPath(); S.drawCtx.moveTo(p.x,p.y); S.drawStrokes.push([p]);
  },{passive:false});
  S.drawCanvas.addEventListener('touchmove',function(e){
    if(!S.drawMode||!S.drawing) return; e.preventDefault();
    var p=tpos(e); S.drawCtx.lineTo(p.x,p.y);
    stroke(S.drawCtx,S.drawColor,S.drawSize); S.drawCtx.stroke();
    S.drawStrokes[S.drawStrokes.length-1].push(p);
  },{passive:false});
  S.drawCanvas.addEventListener('touchend',function(){ S.drawing=false; });
}

function enterDrawMode(){
  S.drawMode=true; S.drawCanvas.style.pointerEvents='all'; S.drawCanvas.style.cursor='crosshair';
  $('drawToolbar').classList.add('show');
  $('drawBtn').style.borderColor='var(--acc)'; $('drawBtn').style.color='var(--acc)';
  if(S.map) S.map.dragPan.disable(); showToast('✏ Draw mode on');
}
function exitDrawMode(){
  S.drawMode=false; S.drawing=false; S.drawCanvas.style.pointerEvents='none'; S.drawCanvas.style.cursor='';
  $('drawToolbar').classList.remove('show');
  $('drawBtn').style.borderColor=''; $('drawBtn').style.color='';
  if(S.map) S.map.dragPan.enable(); showToast('Draw mode off');
}
function undoDraw(){
  if(!S.drawStrokes.length) return; S.drawStrokes.pop();
  S.drawCtx.clearRect(0,0,S.drawCanvas.width,S.drawCanvas.height);
  S.drawStrokes.forEach(function(stroke){
    if(stroke.length<2) return;
    S.drawCtx.beginPath(); S.drawCtx.moveTo(stroke[0].x,stroke[0].y);
    stroke.forEach(function(p,i){ if(i>0) S.drawCtx.lineTo(p.x,p.y); });
    S.drawCtx.strokeStyle=S.drawColor; S.drawCtx.lineWidth=S.drawSize;
    S.drawCtx.lineCap='round'; S.drawCtx.lineJoin='round'; S.drawCtx.stroke();
  });
}
function clearDraw(){
  S.drawStrokes=[]; S.drawCtx.clearRect(0,0,S.drawCanvas.width,S.drawCanvas.height);
}

// ── MAP CLICK ─────────────────────────────────────────────────────
function handleMapClick(e) {
  var lat=e.lngLat.lat, lng=e.lngLat.lng;
  if(S.map.getSource('alerts-src')){
    var hits=S.map.queryRenderedFeatures(e.point,{layers:['alert-fill']});
    if(hits.length){
      var idx=S.alerts.findIndex(function(a){ return a.properties.event===hits[0].properties.event; });
      if(idx>=0){ openAlertModal(idx); return; }
    }
  }
  S.lat=lat; S.lng=lng;
  reverseGeocode(lat,lng);
  if(S.cfg.clickAction==='nws'){ showToast('📡 Fetching NWS data...'); fetchNWSReport(lat,lng); }
  else { showToast('📍 Loading weather...'); loadWeather(); }
}

async function fetchNWSReport(lat,lng){
  try {
    var ptRes=await fetch(
      'https://api.weather.gov/points/'+lat.toFixed(4)+','+lng.toFixed(4),
      {headers:{'User-Agent':'(StormSurgeWeather/10.3)','Accept':'application/geo+json'}}
    );
    if(!ptRes.ok) throw new Error('NWS points: '+ptRes.status);
    var pt=await ptRes.json();
    if(!pt.properties?.forecast) throw new Error('Location not supported');
    var props=pt.properties;
    var results=await Promise.allSettled([
      fetch(props.forecast,      {headers:{'User-Agent':'(StormSurgeWeather/10.3)'}}),
      fetch(props.forecastHourly,{headers:{'User-Agent':'(StormSurgeWeather/10.3)'}})
    ]);
    var fcast =results[0].status==='fulfilled'&&results[0].value.ok ? await results[0].value.json() : null;
    var hourly=results[1].status==='fulfilled'&&results[1].value.ok ? await results[1].value.json() : null;
    openNWSModal(props,fcast,hourly);
  } catch(e) {
    console.warn('NWS error:',e.message);
    showToast('⚠ NWS only covers the US'); loadWeather();
  }
}

function openNWSModal(props,fcast,hourly){
  var city =props.relativeLocation?.properties?.city  ||S.locName;
  var state=props.relativeLocation?.properties?.state ||'';
  var hP   =hourly?.properties?.periods?.slice(0,12)||[];
  var now  =hP[0];
  setText('mTitle','📡 NWS — '+city+(state?', '+state:''));
  $('mBody').innerHTML=
    '<div class="nws-header">'+
      '<div class="nws-meta">'+
        '<span class="nws-badge">'+(props.cwa||'NWS')+'</span>'+
        '<span class="nws-coords">'+props.gridId+' '+props.gridX+','+props.gridY+'</span>'+
      '</div>'+
      (now?'<div class="nws-now">'+
        '<div class="nws-now-temp">'+now.temperature+'°'+now.temperatureUnit+'</div>'+
        '<div class="nws-now-desc">'+now.shortForecast+'</div>'+
        '<div class="nws-now-wind">💨 '+now.windSpeed+' '+now.windDirection+'</div>'+
      '</div>':'')+
    '</div>'+
    (hP.length?'<div class="nws-stitle">Hourly</div><div class="nws-hourly">'+
      hP.map(function(p){
        var t=new Date(p.startTime);
        return '<div class="nws-hr">'+
          '<div class="nws-hr-t">'+fmtTime(t)+'</div>'+
          '<div class="nws-hr-i">'+(p.isDaytime?'☀️':'🌙')+'</div>'+
          '<div class="nws-hr-v">'+p.temperature+'°</div>'+
          '<div class="nws-hr-r">'+(p.probabilityOfPrecipitation?.value??0)+'%</div>'+
        '</div>';
      }).join('')+'</div>':'')+
    (fcast?.properties?.periods?.length?'<div class="nws-stitle">Extended Forecast</div><div class="nws-periods">'+
      fcast.properties.periods.slice(0,8).map(function(p){
        return '<div class="nws-period '+(p.isDaytime?'day':'night')+'">'+
          '<div class="nws-pd-name">'+p.name+'</div>'+
          '<div class="nws-pd-temp">'+p.temperature+'°'+p.temperatureUnit+
            (p.probabilityOfPrecipitation?.value!=null?'<span class="nws-pd-rain">💧'+p.probabilityOfPrecipitation.value+'%</span>':'')+
          '</div>'+
          '<div class="nws-pd-short">'+p.shortForecast+'</div>'+
          '<div class="nws-pd-detail">'+p.detailedForecast+'</div>'+
        '</div>';
      }).join('')+'</div>':'');
  openModal('alertModal');
}

// ── RADAR ─────────────────────────────────────────────────────────
var tileCache=new Map(), _rafPending=false, _drawSeq=0, _tileInflight=new Map();
var _radarBuffer=document.createElement('canvas'), _radarBufCtx=_radarBuffer.getContext('2d');

function tileXRanges(mnX,mxX,maxX){
  var lo=Math.max(0,Math.min(maxX,mnX));
  var hi=Math.max(0,Math.min(maxX,mxX));
  if(lo<=hi) return [[lo,hi]];
  return [[0,hi],[lo,maxX]];
}

function preloadNextFrame(){
  if(!S.frames.length) return;
  var next=(S.frame+1)%S.frames.length;
  var frame=S.frames[next], z=Math.max(2,Math.min(8,Math.floor(S.map?.getZoom?.()||6))), color=S.cfg.radarColor||'6';
  var b=S.map?.getBounds?.(); if(!b) return;
  var mn=ll2t(b.getWest(),b.getNorth(),z), mx=ll2t(b.getEast(),b.getSouth(),z), max=(1<<z)-1;
  var y0=Math.max(0,mn.y), y1=Math.min(max,mx.y);
  tileXRanges(mn.x,mx.x,max).forEach(function(r){
    for(var x=r[0];x<=r[1];x++)
      for(var y=y0;y<=y1;y++)
        loadTile(radarTileUrl(frame.path,z,x,y,color));
  });
}

async function loadRadar(){
  try {
    var d;
    try{
      var r=await fetch(API_URL+'/api/radar/frames');
      if(!r.ok) throw new Error('Radar '+r.status);
      d=await r.json();
      if(!d?.frames?.length) throw new Error('No frames');
      S.frames=d.frames.slice(-12);
    }catch(err){
      var rr=await fetch('https://api.rainviewer.com/public/weather-maps.json');
      if(!rr.ok) throw new Error('RainViewer '+rr.status);
      var rd=await rr.json();
      if(!rd?.radar?.past?.length) throw new Error('No frames');
      S.frames=rd.radar.past.slice(-12);
    }
    S.frame=S.frames.length-1;
    buildSlots(); resizeCanvas(); prewarmCache(); drawFrame(S.frame);
    if(S.cfg.autoPlay) play();
  } catch(e){ console.warn('RainViewer unavailable:',e.message); }
}

function prewarmCache(){
  if(!S.map||!S.frames.length) return;
  var z=Math.max(2,Math.min(8,Math.floor(S.map.getZoom())));
  var color=S.cfg.radarColor||'6';
  var b=S.map.getBounds();
  var mn=ll2t(b.getWest(),b.getNorth(),z), mx=ll2t(b.getEast(),b.getSouth(),z);
  var max=(1<<z)-1;
  var y0=Math.max(0,mn.y), y1=Math.min(max,mx.y);
  var xr=tileXRanges(mn.x,mx.x,max);
  S.frames.forEach(function(frame){
    xr.forEach(function(r){
      for(var x=r[0];x<=r[1];x++)
        for(var y=y0;y<=y1;y++)
          loadTile(radarTileUrl(frame.path,z,x,y,color));
    });
  });
}

function loadTile(src){
  if(tileCache.has(src)) return Promise.resolve(tileCache.get(src));
  if(_tileInflight.has(src)) return _tileInflight.get(src);
  var p=new Promise(function(res){
    var img=new Image(); img.crossOrigin='anonymous';
    img.onload=function(){ tileCache.set(src,img); _tileInflight.delete(src); res(img); };
    img.onerror=function(){
      if(src.indexOf('/api/radar/tile?path=')!==-1){
        var qp=src.split('path=')[1]||'';
        var direct='https://tilecache.rainviewer.com/'+decodeURIComponent(qp);
        var img2=new Image(); img2.crossOrigin='anonymous';
        img2.onload=function(){ tileCache.set(src,img2); _tileInflight.delete(src); res(img2); };
        img2.onerror=function(){ _tileInflight.delete(src); res(null); };
        img2.src=direct;
        return;
      }
      _tileInflight.delete(src); res(null);
    };
    img.src=src;
  });
  _tileInflight.set(src,p);
  return p;
}

function drawCachedFrame(){
  if(!S.frames[S.frame]||!S.map||!S.ctx) return;
  var project=S.map.project.bind(S.map);
  S.ctx.clearRect(0,0,S.canvas.width,S.canvas.height);
  S.ctx.save();
  S.ctx.globalAlpha=S.cfg.opacity;
  drawFrameQuick(S.frame, project);
  S.ctx.restore();
  if(S.compareMode && S.frames.length>1){
    S.ctx.save(); S.ctx.globalAlpha=0.28;
    var prev=(S.frame-1+S.frames.length)%S.frames.length;
    drawFrameQuick(prev, project);
    S.ctx.restore();
  }
}

function scheduleRadarDraw(){
  if(_rafPending) return;
  _rafPending=true;
  requestAnimationFrame(function(){ _rafPending=false; drawFrame(S.frame); });
}

async function drawFrame(idx){
  if(!S.frames[idx]||!S.map||!S.ctx) return;
  var seq=++_drawSeq, frame=S.frames[idx], color=S.cfg.radarColor||'6';
  var z=Math.max(2,Math.min(12,Math.floor(S.map.getZoom())));
  var b=S.map.getBounds(), pad=0.8;
  var north=Math.min(85,b.getNorth()+pad), south=Math.max(-85,b.getSouth()-pad);
  var west=b.getWest()-pad, east=b.getEast()+pad;
  var mn=ll2t(west,north,z), mx=ll2t(east,south,z), maxT=(1<<z)-1;

  var tiles=[];
  var y0=Math.max(0,mn.y), y1=Math.min(maxT,mx.y);
  tileXRanges(mn.x,mx.x,maxT).forEach(function(r){
    for(var tx=r[0];tx<=r[1];tx++)
      for(var ty=y0;ty<=y1;ty++)
        tiles.push({x:tx,y:ty,z:z,b:t2b(tx,ty,z)});
  });
  if(!tiles.length) return;

  // ★ SNAPSHOT the project function BEFORE the async await.
  //   If the user pans while tiles are loading, project() would
  //   return wrong pixel positions. Closing over it here freezes
  //   the map state so tiles draw exactly where they should.
  var project=S.map.project.bind(S.map);

  var imgs=await Promise.all(tiles.map(function(t){
    var src=radarTileUrl(frame.path,t.z,t.x,t.y,color);
    return loadTile(src).then(function(img){ return{tile:t,img:img}; });
  }));

  if(seq!==_drawSeq) return; // stale — abort

  if(_radarBuffer.width!==S.canvas.width||_radarBuffer.height!==S.canvas.height){
    _radarBuffer.width=S.canvas.width; _radarBuffer.height=S.canvas.height;
  }
  _radarBufCtx.clearRect(0,0,_radarBuffer.width,_radarBuffer.height);
  _radarBufCtx.globalAlpha=S.cfg.opacity;
  _radarBufCtx.imageSmoothingEnabled=true;

  imgs.forEach(function(item){
    if(!item.img) return;
    var nw=project([item.tile.b.west,item.tile.b.north]);
    var se=project([item.tile.b.east,item.tile.b.south]);
    var pw=se.x-nw.x, ph=se.y-nw.y;
    if(pw>0&&ph>0) _radarBufCtx.drawImage(item.img,nw.x,nw.y,pw,ph);
  });

  S.ctx.clearRect(0,0,S.canvas.width,S.canvas.height);
  S.ctx.drawImage(_radarBuffer,0,0);
  if(S.compareMode && S.frames.length>1){
    S.ctx.save(); S.ctx.globalAlpha=0.28;
    var prev=(idx-1+S.frames.length)%S.frames.length;
    drawFrameQuick(prev, project);
    S.ctx.restore();
  }
  if(S.activeOverlay) drawOverlay(S.activeOverlay,project);
}


function drawFrameQuick(idx,project){
  var frame=S.frames[idx], color=S.cfg.radarColor||'6'; if(!frame||!S.map) return;
  var z=Math.max(2,Math.min(12,Math.floor(S.map.getZoom()))), b=S.map.getBounds();
  var mn=ll2t(b.getWest(),b.getNorth(),z), mx=ll2t(b.getEast(),b.getSouth(),z), maxT=(1<<z)-1;
  var y0=Math.max(0,mn.y), y1=Math.min(maxT,mx.y);
  tileXRanges(mn.x,mx.x,maxT).forEach(function(r){
  for(var tx=r[0];tx<=r[1];tx++) for(var ty=y0;ty<=y1;ty++){
    var tile=t2b(tx,ty,z);
    var src=radarTileUrl(frame.path,z,tx,ty,color);
    var img=tileCache.get(src); if(!img) continue;
    var nw=project([tile.west,tile.north]), se=project([tile.east,tile.south]);
    var w=se.x-nw.x, h=se.y-nw.y; if(w>0&&h>0) S.ctx.drawImage(img,nw.x,nw.y,w,h);
  }
  });
}

async function drawOverlay(layer,project){
  if(!S.map||!S.ctx) return;
  var z=Math.max(0,Math.min(8,Math.floor(S.map.getZoom())));
  var b=S.map.getBounds();
  var mn=ll2t(b.getWest(),b.getNorth(),z), mx=ll2t(b.getEast(),b.getSouth(),z);
  var max=(1<<z)-1, tiles=[];
  var y0=Math.max(0,mn.y), y1=Math.min(max,mx.y);
  tileXRanges(mn.x,mx.x,max).forEach(function(r){
    for(var x=r[0];x<=r[1];x++)
      for(var y=y0;y<=y1;y++)
        tiles.push({x:x,y:y,z:z,b:t2b(x,y,z)});
  });
  var imgs=await Promise.all(tiles.map(function(t){
    return loadTile(API_URL+'/api/tiles/'+layer+'/'+t.z+'/'+t.x+'/'+t.y)
      .then(function(img){ return{tile:t,img:img}; });
  }));
  var proj=project||S.map.project.bind(S.map);
  S.ctx.save(); S.ctx.globalAlpha=0.6;
  imgs.forEach(function(item){
    if(!item.img) return;
    var nw=proj([item.tile.b.west,item.tile.b.north]);
    var se=proj([item.tile.b.east,item.tile.b.south]);
    var w=se.x-nw.x, h=se.y-nw.y;
    if(w>0&&h>0) S.ctx.drawImage(item.img,nw.x,nw.y,w,h);
  });
  S.ctx.restore();
}

function setOverlay(layer){
  S.activeOverlay=S.activeOverlay===layer?null:layer;
  tileCache.clear(); scheduleRadarDraw();
  var labels={cloud_cover:'☁ Clouds',temperature:'🌡 Temp',wind_speed:'💨 Wind',pressure:'📊 Pressure'};
  showToast(S.activeOverlay?'Overlay: '+(labels[S.activeOverlay]||S.activeOverlay):'Overlay off');
}

// ★ FIXED: lat clamped to ±85.0511 to prevent NaN at poles
function ll2t(lng,lat,z){
  var cLat=Math.max(-85.0511,Math.min(85.0511,lat));
  var n=1<<z;
  var x=Math.floor((lng+180)/360*n);
  var rad=cLat*Math.PI/180;
  var y=Math.floor((1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2*n);
  return{x:Math.max(0,Math.min(n-1,x)), y:Math.max(0,Math.min(n-1,y))};
}
function t2b(x,y,z){
  var n=1<<z;
  return{west:x/n*360-180, east:(x+1)/n*360-180,
    north:Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI,
    south:Math.atan(Math.sinh(Math.PI*(1-2*(y+1)/n)))*180/Math.PI};
}

// Radar timeline controls
function buildSlots(){
  var c=$('tSlots'); c.innerHTML='';
  var tr=$('tRange'); if(tr){ tr.max=Math.max(0,S.frames.length-1); tr.value=S.frame; }
  S.frames.forEach(function(f,i){
    var d=new Date(f.time*1000), btn=document.createElement('button');
    btn.className='tslot'+(i===S.frame?' active':'');
    btn.textContent=fmtTime(d,true);
    btn.onclick=function(){ pickFrame(i); };
    c.appendChild(btn);
  });
}
function pickFrame(i){
  S.frame=Math.max(0,Math.min(S.frames.length-1,i));
  document.querySelectorAll('.tslot').forEach(function(s,j){ s.classList.toggle('active',j===S.frame); });
  var tr=$('tRange'); if(tr) tr.value=S.frame;
  drawFrame(S.frame);
}
function play(){
  if(S.playing) return; S.playing=true;
  var b=$('playBtn'); b.textContent='⏸'; b.classList.add('playing');
  S.playTimer=setInterval(function(){ pickFrame((S.frame+1)%S.frames.length); preloadNextFrame(); }, Math.max(120, S.cfg.speed - Math.min(200, S.frames.length*10)));
}
function pause(){
  S.playing=false; clearInterval(S.playTimer);
  var b=$('playBtn'); b.textContent='▶'; b.classList.remove('playing');
}
function togglePlay(){ S.playing?pause():play(); }

// ── WEATHER ───────────────────────────────────────────────────────
async function loadWeather(){
  showLoader(true);
  try {
    var r=await fetch(API_URL+'/api/weather?lat='+S.lat+'&lng='+S.lng);
    var d=await r.json();
    if(!r.ok) throw new Error(d.error||r.status);
    S.weather=d; renderWeather(d); renderForecast(d);
  } catch(e){
    console.warn('Weather load failed:',e.message);
    showToast('⚠ Weather service unavailable');
  }
  showLoader(false);
}
function renderWeather(d){
  var c=d.current;
  var wu={ms:'m/s',kmh:'km/h',mph:'mph'}[S.cfg.windUnit];
  setText('wcTemp',cvtTemp(c.temperature_2m)+'°'+S.cfg.tempUnit);
  setText('wcLoc',S.locName); setText('wcDesc',wDesc(c.weather_code)); setText('wcIcon',wIcon(c.weather_code));
  setText('locName',S.locName);
  $('wcard').className='wcard pos-'+S.cfg.cardPosition+' style-'+(S.cfg.cardStyle||'full');
  var stats=[
    ['statFeels','wcFeels',cvtTemp(c.apparent_temperature)+'°'+S.cfg.tempUnit, S.cfg.showFeels],
    ['statHum',  'wcHum',  c.relative_humidity_2m+'%',                          S.cfg.showHumidity],
    ['statWind', 'wcWind', cvtWind(c.wind_speed_10m)+' '+wu,                    S.cfg.showWind],
    ['statDir',  'wcDir',  c.wind_direction_10m+'° '+wDir(c.wind_direction_10m),S.cfg.showWind],
    ['statRain', 'wcRain', (c.precipitation||0).toFixed(1)+' mm',                S.cfg.showRain],
    ['statPres', 'wcPres', Math.round(c.surface_pressure)+' hPa',                S.cfg.showPressure],
    ['statCloud','wcCloud',c.cloud_cover+'%',                                    S.cfg.showCloud],
    ['statUV',   'wcUV',   (c.uv_index??'--')+' '+uvLabel(c.uv_index),          S.cfg.showUV],
  ];
  stats.forEach(function(s){
    var row=$(s[0]); if(row) row.style.display=s[3]?'':'none';
    if(s[3]) setText(s[1],s[2]);
  });
  var sunRow=$('statSun');
  if(S.cfg.showSunTimes&&d.daily?.sunrise?.[0]){
    var sr=new Date(d.daily.sunrise[0]),ss=new Date(d.daily.sunset[0]);
    setText('wcSunrise',fmtTime(sr,true)); setText('wcSunset',fmtTime(ss,true));
    if(sunRow) sunRow.style.display='';
  } else { if(sunRow) sunRow.style.display='none'; }
}

function renderForecast(d){
  var c=$('fcScroll');
  if(!c) return;
  c.innerHTML='';
  if(S.fcMode==='hourly'){
    var nowH=new Date().getHours();
    for(var i=0;i<Math.min(24,d.hourly.temperature_2m.length);i++){
      var t=new Date(d.hourly.time[i]), isNow=t.getHours()===nowH&&i<2;
      var precip=d.hourly.precipitation_probability?.[i]??0;
      var div=document.createElement('div');
      div.className='fc-item'+(isNow?' now':'');
      div.innerHTML='<div class="fc-t">'+(isNow?'NOW':fmtTime(t,true))+'</div>'+
        '<div class="fc-i">'+wIcon(d.hourly.weather_code[i])+'</div>'+
        '<div class="fc-v">'+cvtTemp(d.hourly.temperature_2m[i])+'°</div>'+
        '<div class="fc-h fc-rain" style="opacity:'+(precip>0?1:.3)+'">🌧'+precip+'%</div>';
      c.appendChild(div);
    }
  } else {
    var days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    d.daily.time.slice(0,7).forEach(function(ds,i){
      var day=new Date(ds), hi=cvtTemp(d.daily.temperature_2m_max[i]);
      var lo=cvtTemp(d.daily.temperature_2m_min[i]);
      var rain=d.daily.precipitation_probability_max[i]||0;
      var wind=d.daily.wind_speed_10m_max?.[i]||0;
      var div=document.createElement('div');
      div.className='fc-item fc-day'+(i===0?' now':'');
      div.innerHTML='<div class="fc-t">'+(i===0?'TODAY':days[day.getDay()])+'</div>'+
        '<div class="fc-i">'+wIcon(d.daily.weather_code[i])+'</div>'+
        '<div class="fc-v">'+hi+'°<span class="fc-lo">/'+lo+'°</span></div>'+
        '<div class="fc-h"><span class="fc-rain" style="opacity:'+(rain>0?1:.3)+'">🌧'+rain+'%</span></div>'+
        '<div class="fc-wind">💨'+cvtWind(wind)+'</div>';
      c.appendChild(div);
    });
  }
}

// ── ALERTS ────────────────────────────────────────────────────────
async function loadAlerts(){
  try {
    var r=await fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert',
      {headers:{'User-Agent':'(StormSurgeWeather/10.3)','Accept':'application/geo+json'}});
    if(!r.ok) throw new Error(r.status);
    var d=await r.json();
    S.alerts=(d.features||[]).filter(function(f){
      return f.properties?.event&&new Date(f.properties.expires)>new Date();
    });
    renderAlerts(); updateAlertCounts();
    if(S.cfg.alertZones&&S.map) putAlertsOnMap();
  } catch(e){ S.alerts=[]; renderAlerts(); updateAlertCounts(); }
}
function updateAlertCounts(){
  var n=S.alerts.length; setText('alertBadge',n); setText('navAlertBadge',n);
  $('navAlertBadge').classList.toggle('show',n>0);
}
function alertSev(ev){
  var e=(ev||'').toLowerCase();
  if(e.includes('tornado')||e.includes('hurricane')||e.includes('extreme')) return'emergency';
  if(e.includes('warning')) return'warning'; if(e.includes('watch')) return'watch';
  if(e.includes('advisory')) return'advisory'; return'default';
}
function alertIcon(ev){
  var e=(ev||'').toLowerCase();
  if(e.includes('tornado')) return'🌪'; if(e.includes('hurricane')||e.includes('typhoon')) return'🌀';
  if(e.includes('thunder')||e.includes('lightning')) return'⛈';
  if(e.includes('snow')||e.includes('blizzard')||e.includes('winter')) return'❄️';
  if(e.includes('flood')) return'🌊'; if(e.includes('wind')) return'💨';
  if(e.includes('fog')) return'🌫'; if(e.includes('fire')) return'🔥';
  if(e.includes('heat')) return'🌡'; if(e.includes('ice')||e.includes('frost')) return'🧊';
  return'⚠️';
}
function renderAlerts(){
  if(S.rightTab!=='alerts') return;
  var body=$('alertsBody');
  var q=(S.alertQuery||'').trim().toLowerCase();
  var filtered=S.alerts.filter(function(a,i){
    a._idx=i;
    var sevOK=S.alertFilter==='all'||alertSev(a.properties.event)===S.alertFilter;
    if(!sevOK) return false;
    if(!q) return true;
    var p=a.properties||{};
    var hay=[p.event,p.headline,p.areaDesc,p.description,p.senderName].join(' ').toLowerCase();
    return hay.includes(q);
  });
  var filterBar='<div class="alert-filters">'+
    '<button class="af-btn '+(S.alertFilter==='all'?'active':'')+'" data-f="all">All <span>'+S.alerts.length+'</span></button>'+
    '<button class="af-btn '+(S.alertFilter==='emergency'?'active':'')+'" data-f="emergency">🌪</button>'+
    '<button class="af-btn '+(S.alertFilter==='warning'?'active':'')+'" data-f="warning">⚠</button>'+
    '<button class="af-btn '+(S.alertFilter==='watch'?'active':'')+'" data-f="watch">👁</button>'+
    '<button class="af-btn '+(S.alertFilter==='advisory'?'active':'')+'" data-f="advisory">ℹ</button>'+
    '<button class="af-refresh" id="alertRefreshBtn" title="Refresh alerts">↻</button>'+
    '</div>'+
    '<div class="alert-search">'+
      '<input id="alertSearchInput" type="text" placeholder="Search alerts by event, area, or text" value="'+(S.alertQuery||'').replace(/"/g,'&quot;')+'">'+
      '<button id="alertSearchBtn">Search</button>'+
    '</div>';
  if(!filtered.length){
    body.innerHTML=filterBar+'<div class="empty-s"><div class="es-ico">✓</div><div>No active alerts</div></div>';
    bindAlertUI(); return;
  }
  body.innerHTML=filterBar+filtered.map(function(a){
    var p=a.properties, sev=alertSev(p.event), ico=alertIcon(p.event);
    var area=p.areaDesc?p.areaDesc.split(';')[0].trim():'Unknown';
    var exp=p.expires?new Date(p.expires):null;
    var cc=sev==='emergency'||sev==='warning'?'warning':sev==='watch'?'watch':sev==='advisory'?'advisory':'';
    return '<div class="acard '+cc+'" data-i="'+a._idx+'" tabindex="0">'+
      '<span class="ac-arrow">›</span>'+
      '<div class="ac-badge sev-'+sev+'">'+ico+' '+p.event+'</div>'+
      '<div class="ac-title">'+(p.headline||p.event)+'</div>'+
      '<div class="ac-area">📍 '+area+'</div>'+
      (exp?'<div class="ac-exp">Expires '+fmtDateTime(exp)+'</div>':'')+
    '</div>';
  }).join('');
  document.querySelectorAll('.acard').forEach(function(card){
    var open=function(){ openAlertModal(+card.dataset.i); };
    card.addEventListener('click',open);
    card.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' ') open(); });
  });
  bindAlertUI();
}
function bindAlertUI(){
  document.querySelectorAll('.af-btn').forEach(function(btn){
    btn.addEventListener('click',function(){ S.alertFilter=btn.dataset.f; renderAlerts(); });
  });
  var rb=$('alertRefreshBtn');
  if(rb) rb.addEventListener('click',function(){ showToast('↻ Refreshing alerts...'); loadAlerts(); });
  var sb=$('alertSearchBtn'), si=$('alertSearchInput');
  var runSearch=function(){ S.alertQuery=si?si.value.trim():''; renderAlerts(); };
  if(sb) sb.addEventListener('click',runSearch);
  if(si) si.addEventListener('keydown',function(e){ if(e.key==='Enter') runSearch(); });
}

// ★ FIXED: fmtAlertText is now a TOP-LEVEL function.
//   In the old code it was defined INSIDE openAlertModal, and the
//   parameter name "t" was fine, but the internal variable "p" for
//   each paragraph was the same name as the outer "p=alert.properties".
//   JavaScript function-scoped hoisting caused the outer p to leak in
//   unpredictably. Now it's clean and isolated.
function fmtAlertText(text){
  if(!text||!text.trim()) return '<p style="color:var(--t3)">No details available.</p>';
  var lines=text.trim().split('\n');
  var paras=[], cur=[];
  lines.forEach(function(line){
    if(line.trim()===''){
      if(cur.length){ paras.push(cur.join('\n')); cur=[]; }
    } else { cur.push(line); }
  });
  if(cur.length) paras.push(cur.join('\n'));
  return paras.map(function(para){
    var trimmed=para.trim();
    if(!trimmed) return '';
    // NWS uses ALL CAPS for section headers: WHAT, WHERE, WHEN, IMPACTS, etc.
    var alpha=trimmed.replace(/[^A-Za-z]/g,'');
    if(alpha.length>1&&alpha===alpha.toUpperCase()&&trimmed.length<100)
      return '<div class="ad-para-head">'+trimmed+'</div>';
    return '<p>'+trimmed.replace(/\n/g,'<br>')+'</p>';
  }).join('');
}

function openAlertModal(idx){
  var alert=S.alerts[idx]; if(!alert) return;
  var props=alert.properties;
  var ico=alertIcon(props.event);
  var onset  =props.onset  ?new Date(props.onset)  :(props.sent?new Date(props.sent):null);
  var expires=props.expires?new Date(props.expires):null;
  setText('mTitle',ico+' '+props.event);
  $('mBody').innerHTML=
    '<div class="ad-hdr">'+
      '<div class="ad-ico">'+ico+'</div>'+
      '<div class="ad-title">'+(props.headline||props.event)+'</div>'+
    '</div>'+
    '<div class="ad-chips">'+
      (onset  ?'<span class="ad-chip">📅 '+onset.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})+'</span>':'')+
      (expires?'<span class="ad-chip">⏱ '+fmtDateTime(expires)+'</span>':'')+
      (props.severity ?'<span class="ad-chip">⚡ '+props.severity+'</span>':'')+
      (props.certainty?'<span class="ad-chip">🎯 '+props.certainty+'</span>':'')+
      (props.urgency  ?'<span class="ad-chip">⏰ '+props.urgency+'</span>':'')+
    '</div>'+
    (props.areaDesc?'<div class="ad-area-row">📍 '+props.areaDesc.split(';').map(function(s){return s.trim();}).filter(Boolean).slice(0,5).join(' · ')+'</div>':'')+
    '<div class="ad-section">'+
      '<div class="ad-sub-title">Description</div>'+
      '<div class="ad-text">'+fmtAlertText(props.description)+'</div>'+
    '</div>'+
    (props.instruction?
      '<div class="ad-section">'+
        '<div class="ad-sub-title">⚠ Instructions</div>'+
        '<div class="ad-text ad-instruction">'+fmtAlertText(props.instruction)+'</div>'+
      '</div>':'')+
        (props.senderName?'<div class="ad-sender">Issued by: '+props.senderName+'</div>':'')+
    '<div class="ad-actions"><button class="ad-share-btn" id="alertShareBtn">⚡ Share to Storm Central</button></div>';
  var sb=$('alertShareBtn');
  if(sb) sb.addEventListener('click',function(){
    alertDiscoveryData(alert);
    closeModal('alertModal');
    openStormCentral();
    showToast('⚡ Alert added to Storm Central draft');
  });
  openModal('alertModal');
}

function putAlertsOnMap(){
  if(!S.map||!S.map.isStyleLoaded()) return;
  rmLayers(['alert-fill','alert-line'],['alerts-src']);
  var valid=S.alerts.filter(function(a){ return a.geometry; });
  if(!valid.length) return;
  try {
    S.map.addSource('alerts-src',{type:'geojson',data:{type:'FeatureCollection',features:valid.map(function(a){
      return{type:'Feature',geometry:a.geometry,properties:{event:a.properties.event,severity:alertSev(a.properties.event)}};
    })}});
    S.map.addLayer({id:'alert-fill',type:'fill',source:'alerts-src',paint:{
      'fill-color':['match',['get','severity'],'emergency','#ff2020','warning','#ff5c5c','watch','#00d4c8','#f0a500'],
      'fill-opacity':0.2}});
    S.map.addLayer({id:'alert-line',type:'line',source:'alerts-src',paint:{
      'line-color':['match',['get','severity'],'emergency','#ff2020','warning','#ff5c5c','watch','#00d4c8','#f0a500'],
      'line-width':1.5}});
    S.map.on('mouseenter','alert-fill',function(){ S.map.getCanvas().style.cursor='pointer'; });
    S.map.on('mouseleave','alert-fill',function(){ S.map.getCanvas().style.cursor=''; });
  } catch(e){}
}
function rmLayers(layers,sources){
  if(!S.map) return;
  try{ layers.forEach(function(l){ if(S.map.getLayer(l)) S.map.removeLayer(l); }); }catch(e){}
  try{ sources.forEach(function(s){ if(S.map.getSource(s)) S.map.removeSource(s); }); }catch(e){}
}

// ── STORM CENTRAL ─────────────────────────────────────────────────
function getMapFocus(){
  if(S.map){
    var c=S.map.getCenter();
    return { lat:c.lat, lng:c.lng, location:S.locName||'Map View' };
  }
  return { lat:S.lat, lng:S.lng, location:S.locName||'Current Location' };
}

function applySCDraft(){
  if(!S.scDraft||!S.user) return;
  var t=$('scText');
  if(t && !S.scDraft.applied){
    var base=t.value.trim();
    t.value=base?base+'\n\n'+S.scDraft.text:S.scDraft.text;
    S.scDraft.applied=true;
    t.focus();
  }
  if(S.scDraft.location){
    setText('scPostLoc',S.scDraft.location);
  }
}

function queueDiscoveryDraft(opts){
  var o=opts||{};
  var focus=getMapFocus();
  S.scDraft={
    text:o.text||'Weather discovery near '+(o.location||focus.location)+'.',
    location:o.location||focus.location,
    lat:Number.isFinite(o.lat)?o.lat:focus.lat,
    lng:Number.isFinite(o.lng)?o.lng:focus.lng,
    applied:false
  };
}

function alertDiscoveryData(alert){
  var p=alert?.properties||{};
  var area=(p.areaDesc||'').split(';').map(function(x){return x.trim();}).filter(Boolean)[0]||S.locName||'my area';
  var lat=null,lng=null;
  var coords=alert?.geometry?.coordinates;
  if(Array.isArray(coords)){
    var ring=Array.isArray(coords[0])&&Array.isArray(coords[0][0])?coords[0]:coords;
    var first=Array.isArray(ring[0])?ring[0]:null;
    if(first&&first.length>=2){ lng=+first[0]; lat=+first[1]; }
  }
  var text='⚠ '+(p.event||'Weather Alert')+' near '+area+'\n'
    +(p.headline||'')+'\n\n'
    +(p.description||'').split('\n').slice(0,3).join(' ').trim();
  queueDiscoveryDraft({ text:text.trim(), location:area, lat:lat, lng:lng });
}


function loadUser(){
  try{ var u=localStorage.getItem('ss_user'); if(u) S.user=JSON.parse(u); }catch(e){}
  updateUserUI();
}
function saveUser(u,token){
  S.user=u;
  try{ localStorage.setItem('ss_user',JSON.stringify(u)); if(token) localStorage.setItem('ss_token',token); }catch(e){}
  updateUserUI();
}
function clearUser(){
  S.user=null;
  try{ localStorage.removeItem('ss_user'); localStorage.removeItem('ss_token'); }catch(e){}
  updateUserUI();
}
function updateUserUI(){
  if(S.user){
    setText('userNm',S.user.name); setText('userSub','Storm Central');
    $('userAva').textContent=S.user.name.charAt(0).toUpperCase();
  } else {
    setText('userNm','Weather User'); setText('userSub','Not signed in');
    $('userAva').textContent='SS';
  }
}
function openStormCentral(){ updateSCView(); openModal('stormCentralModal'); if(S.user){ loadSCPosts(); applySCDraft(); } }
function updateSCView(){
  $('scAuthGate').style.display=S.user?'none':'';
  $('scFeed').style.display=S.user?'':'none';
  if(S.user){ var lbl=$('scUserLabel'); if(lbl) lbl.innerHTML='Posting as <strong>'+S.user.name+'</strong>'; setText('scPostLoc',S.scDraft?.location||S.locName); applySCDraft(); }
}

async function loadSCPosts(){
  var container=$('scPosts');
  container.innerHTML='<div class="sc-loading">Loading posts...</div>';
  var posts=[];
  try {
    var url=API_URL+'/api/posts', params=new URLSearchParams();
    if(S.scFilter==='location') params.set('location',S.locName);
    if(S.scFilter==='radar'&&S.map){
      var b=S.map.getBounds();
      params.set('north',b.getNorth()); params.set('south',b.getSouth());
      params.set('east',b.getEast());   params.set('west',b.getWest());
    }
    if([...params].length) url+='?'+params.toString();
    var r=await fetch(url); if(!r.ok) throw new Error(r.status);
    posts=await r.json();
  } catch(e){
    container.innerHTML='<div class="empty-s"><div class="es-ico">⚠</div><div>Could not load posts</div></div>';
    return;
  }
  var filterBar='<div class="sc-filter-bar">'+
    '<button class="sc-fb '+(S.scFilter==='all'?'active':'')+'" data-f="all">🌍 All</button>'+
    '<button class="sc-fb '+(S.scFilter==='location'?'active':'')+'" data-f="location">📍 '+S.locName+'</button>'+
    '<button class="sc-fb '+(S.scFilter==='radar'?'active':'')+'" data-f="radar">🗺 Radar View</button>'+
    '</div>';
  if(!posts.length){
    container.innerHTML=filterBar+'<div class="empty-s"><div class="es-ico">⚡</div><div>No posts yet</div></div>';
    bindSCFilters(); return;
  }
  container.innerHTML=filterBar+posts.map(function(p){
    var isOwner=S.user&&S.user.name===p.author;
    var liked=p.likes?.includes(S.user?.name);
    var comments=p.comments||[];
    var showCmts=S.activeCommentId===p.id;
    return '<div class="sc-post" data-id="'+p.id+'">'+
      '<div class="sc-post-head">'+
        '<div class="sc-post-ava">'+p.author.charAt(0).toUpperCase()+'</div>'+
        '<div class="sc-post-info">'+
          '<div class="sc-post-author">'+p.author+'</div>'+
          '<div class="sc-post-meta">📍 '+p.location+' · '+timeAgo(new Date(p.ts))+'</div>'+
        '</div>'+
        '<div class="sc-post-actions">'+(isOwner?'<button class="sc-del" data-id="'+p.id+'" title="Delete">🗑</button>':'')+
        '</div>'+
      '</div>'+
      '<div class="sc-post-text">'+escHtml(p.text)+'</div>'+
      (p.img?'<img class="sc-post-img" src="'+p.img+'" alt="Weather photo">':'')+
      '<div class="sc-post-footer">'+
        '<button class="sc-like '+(liked?'liked':'')+'" data-id="'+p.id+'">⚡ '+(p.likes?.length||0)+'</button>'+
        '<button class="sc-comment-btn" data-id="'+p.id+'">💬 '+comments.length+'</button>'+
      '</div>'+
      (showCmts?'<div class="sc-comments" id="comments-'+p.id+'">'+
        (comments.length?comments.map(function(c){
          return '<div class="sc-comment">'+
            '<div class="sc-comment-ava">'+c.author.charAt(0).toUpperCase()+'</div>'+
            '<div class="sc-comment-body">'+
              '<div class="sc-comment-author">'+c.author+' <span class="sc-comment-time">'+timeAgo(new Date(c.ts))+'</span>'+
                (S.user&&S.user.name===c.author?'<button class="sc-del-comment" data-pid="'+p.id+'" data-cid="'+c.id+'">✕</button>':'')+
              '</div>'+
              '<div class="sc-comment-text">'+escHtml(c.text)+'</div>'+
            '</div>'+
          '</div>';
        }).join(''):'<div class="sc-no-comments">No comments yet</div>')+
        '<div class="sc-comment-compose">'+
          '<input class="sc-comment-input" id="cinput-'+p.id+'" placeholder="Add a comment..." maxlength="280">'+
          '<button class="sc-comment-post" data-id="'+p.id+'">→</button>'+
        '</div>'+
      '</div>':'')
    +'</div>';
  }).join('');
  container.querySelectorAll('.sc-like')        .forEach(function(b){ b.addEventListener('click',function(){ toggleLike(b.dataset.id); }); });
  container.querySelectorAll('.sc-del')         .forEach(function(b){ b.addEventListener('click',function(){ deletePost(b.dataset.id); }); });
  container.querySelectorAll('.sc-comment-btn') .forEach(function(b){ b.addEventListener('click',function(){ toggleComments(b.dataset.id); }); });
  container.querySelectorAll('.sc-comment-post').forEach(function(b){ b.addEventListener('click',function(){ submitComment(b.dataset.id); }); });
  container.querySelectorAll('.sc-comment-input').forEach(function(inp){
    inp.addEventListener('keydown',function(e){ if(e.key==='Enter') submitComment(inp.id.replace('cinput-','')); });
  });
  container.querySelectorAll('.sc-del-comment').forEach(function(b){
    b.addEventListener('click',function(){ deleteComment(b.dataset.pid,b.dataset.cid); });
  });
  bindSCFilters();
  if(S.activeCommentId){ var ci=$('cinput-'+S.activeCommentId); if(ci) ci.focus(); }
}
function bindSCFilters(){
  document.querySelectorAll('.sc-fb').forEach(function(btn){
    btn.addEventListener('click',function(){ S.scFilter=btn.dataset.f; loadSCPosts(); });
  });
}
function toggleComments(postId){ S.activeCommentId=S.activeCommentId===postId?null:postId; loadSCPosts(); }

async function submitPost(){
  if(!S.user){ showToast('Sign in to post'); return; }
  var text=$('scText').value.trim(); if(!text){ showToast('Write something first!'); return; }
  var btn=$('scPostBtn'); btn.disabled=true; btn.textContent='Posting...';
  try {
    var postLoc=S.scDraft?.location||S.locName;
    var postLat=Number.isFinite(S.scDraft?.lat)?S.scDraft.lat:S.lat;
    var postLng=Number.isFinite(S.scDraft?.lng)?S.scDraft.lng:S.lng;
    var r=await fetch(API_URL+'/api/posts',{method:'POST',headers:apiHeaders(true),body:JSON.stringify({text:text,location:postLoc,lat:postLat,lng:postLng})});
    if(!r.ok){ var err=await r.json(); showToast('⚠ '+(err.error||'Post failed')); return; }
    var post=await r.json();
    var imgData=$('scImgPreview').dataset.img;
    if(imgData){
      try {
        var blob=await(await fetch(imgData)).blob();
        var form=new FormData(); form.append('image',blob,'photo.jpg');
        await fetch(API_URL+'/api/posts/'+post.id+'/image',{method:'POST',headers:{'Authorization':'Bearer '+localStorage.getItem('ss_token')},body:form});
      } catch(imgErr){ console.warn('Image upload failed:',imgErr); }
    }
    $('scText').value=''; $('scImgPreview').innerHTML=''; $('scImgPreview').dataset.img=''; $('scImgInput').value=''; S.scDraft=null; setText('scPostLoc',S.locName);
    loadSCPosts(); showToast('⚡ Posted to Storm Central!');
  } catch(e){ showToast('⚠ Could not post'); }
  finally { btn.disabled=false; btn.textContent='Post ⚡'; }
}
async function toggleLike(postId){
  if(!S.user) return;
  try{ await fetch(API_URL+'/api/posts/'+postId+'/like',{method:'PATCH',headers:apiHeaders(true)}); loadSCPosts(); }
  catch(e){ showToast('⚠ Could not like post'); }
}
async function deletePost(postId){
  if(!confirm('Delete this post?')) return;
  try{
    var r=await fetch(API_URL+'/api/posts/'+postId,{method:'DELETE',headers:apiHeaders(true)});
    if(!r.ok) throw new Error(); loadSCPosts(); showToast('Post deleted');
  } catch(e){ showToast('⚠ Could not delete post'); }
}
// ★ FIXED: Only ONE definition of submitComment (was declared twice before)
async function submitComment(postId){
  if(!S.user){ showToast('Sign in to comment'); return; }
  var input=$('cinput-'+postId); if(!input) return;
  var text=input.value.trim(); if(!text) return;
  try {
    var r=await fetch(API_URL+'/api/posts/'+postId+'/comments',{method:'POST',headers:apiHeaders(true),body:JSON.stringify({text:text})});
    if(!r.ok) throw new Error(); loadSCPosts();
  } catch(e){ showToast('⚠ Could not post comment'); }
}
async function deleteComment(postId,commentId){
  try{
    await fetch(API_URL+'/api/posts/'+postId+'/comments/'+commentId,{method:'DELETE',headers:apiHeaders(true)});
    loadSCPosts();
  } catch(e){ showToast('⚠ Could not delete comment'); }
}

// ── STORM CENTRAL AUTH ────────────────────────────────────────────
function initSCAuth(){
  document.querySelectorAll('.sc-at').forEach(function(tab){
    tab.addEventListener('click',function(){
      document.querySelectorAll('.sc-at').forEach(function(t){ t.classList.remove('active'); });
      tab.classList.add('active');
      $('scLogin').style.display   =tab.dataset.at==='login'   ?'':'none';
      $('scRegister').style.display=tab.dataset.at==='register'?'':'none';
      setText('loginErr',''); setText('regErr','');
    });
  });
  $('loginBtn').addEventListener('click',async function(){
    var email=$('loginEmail').value.trim(), pass=$('loginPass').value;
    if(!email||!pass){ setText('loginErr','Email and password required'); return; }
    var btn=$('loginBtn'); btn.disabled=true; btn.textContent='Signing in...';
    try {
      var r=await fetch(API_URL+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,password:pass})});
      var d=await r.json(); if(!r.ok){ setText('loginErr',d.error||'Login failed'); return; }
      saveUser(d.user,d.token); setText('loginErr',''); updateSCView(); loadSCPosts();
      showToast('Welcome back, '+d.user.name+'!');
    } catch(e){ setText('loginErr','Cannot connect to server'); }
    finally { btn.disabled=false; btn.textContent='Sign In'; }
  });
  var usernameTimer;
  $('regName').addEventListener('input',function(){
    clearTimeout(usernameTimer); var name=$('regName').value.trim();
    if(name.length<2){ setText('regErr',''); return; }
    usernameTimer=setTimeout(async function(){
      try{
        var r=await fetch(API_URL+'/api/auth/check-username?username='+encodeURIComponent(name));
        var d=await r.json(); setText('regErr',d.available?'✓ Username available':'⚠ '+d.reason);
        $('regErr').style.color=d.available?'var(--acc2)':'var(--danger)';
      }catch(e){}
    },400);
  });
  $('registerBtn').addEventListener('click',async function(){
    var name=$('regName').value.trim(), email=$('regEmail').value.trim(), pass=$('regPass').value;
    if(!name||!email||!pass){ setText('regErr','All fields required'); return; }
    var btn=$('registerBtn'); btn.disabled=true; btn.textContent='Creating account...';
    try {
      var r=await fetch(API_URL+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,email:email,password:pass})});
      var d=await r.json(); if(!r.ok){ setText('regErr',d.error||'Registration failed'); return; }
      saveUser(d.user,d.token); setText('regErr',''); updateSCView(); loadSCPosts();
      showToast('Welcome to Storm Central, '+d.user.name+'!');
    } catch(e){ setText('regErr','Cannot connect to server'); }
    finally { btn.disabled=false; btn.textContent='Create Account'; }
  });
  $('scSignout').addEventListener('click',function(){ clearUser(); updateSCView(); showToast('Signed out'); });
  $('scPostBtn').addEventListener('click',submitPost);
  $('scLocTag').addEventListener('click',function(){
    var f=getMapFocus();
    queueDiscoveryDraft({location:f.location,lat:f.lat,lng:f.lng,text:'Observed conditions near '+f.location+'.'});
    applySCDraft();
    showToast('📍 Discovery location autofilled from radar view');
  });
  $('scImgBtn').addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); $('scImgInput').value=''; $('scImgInput').click(); });
  $('scImgInput').addEventListener('change',function(e){
    var file=e.target.files[0]; if(!file) return;
    var reader=new FileReader();
    reader.onload=function(ev){
      var img=new Image();
      img.onload=function(){
        var maxW=800, scale=img.width>maxW?maxW/img.width:1;
        var canvas=document.createElement('canvas');
        canvas.width=Math.round(img.width*scale); canvas.height=Math.round(img.height*scale);
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        var dataUrl=canvas.toDataURL('image/jpeg',0.82);
        $('scImgPreview').innerHTML='<div style="position:relative;display:inline-block;margin-top:8px">'+
          '<img src="'+dataUrl+'" style="max-height:130px;border-radius:8px;display:block">'+
          '<button id="scImgRemove" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.6);'+
          'color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;'+
          'font-size:11px;display:flex;align-items:center;justify-content:center">✕</button></div>';
        $('scImgPreview').dataset.img=dataUrl;
        $('scImgRemove').addEventListener('click',function(){ $('scImgPreview').innerHTML=''; $('scImgPreview').dataset.img=''; $('scImgInput').value=''; });
      };
      img.src=ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── CAMERAS (Hazcams) ──────────────────────────────────────────────
function searchTrafficCams(query){
  var grid=$('tcGrid');
  var q=(query||'').trim();
  if(!q){
    grid.innerHTML='<div class="empty-s"><div class="es-ico">📷</div><div>Enter a city, state, or route</div></div>';
    return;
  }
  var url='https://hazcams.com/search?query='+encodeURIComponent(q);
  grid.innerHTML='<div class="tc-note">🌐 Powered by Hazcams</div>'+
    '<div class="empty-s" style="gap:12px">'+
    '<div class="es-ico">📷</div>'+
    '<div>Open live cameras for <strong>'+q+'</strong>.</div>'+
    '<a class="tc-ext-link" href="'+url+'" target="_blank" rel="noopener noreferrer">Open Hazcams Search →</a>'+
    '<a class="tc-ext-link" href="https://hazcams.com/" target="_blank" rel="noopener noreferrer">Open Hazcams Home →</a>'+
    '</div>';
}

// ── SEARCH ────────────────────────────────────────────────────────
async function doSearch(q){
  if(!q||q.length<2){ hideDrop(); return; }
  try {
    var d=await(await fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/'+encodeURIComponent(q)+'.json?access_token='+MAPBOX_TOKEN+'&limit=5&types=place,locality,neighborhood,postcode')).json();
    showDrop(d.features||[]);
  } catch(e){ hideDrop(); }
}
function showDrop(features){
  var dd=$('searchDrop');
  if(!features.length){ hideDrop(); return; }
  dd.style.display='block';
  dd.innerHTML=features.map(function(f,i){
    var main=f.text||f.place_name.split(',')[0];
    var sub=f.place_name.split(',').slice(1,3).join(',').trim();
    return '<div class="s-drop-item" data-i="'+i+'"><strong>'+main+'</strong>'+(sub?' · <span style="color:var(--t3);font-size:11px">'+sub+'</span>':'')+'</div>';
  }).join('');
  dd.querySelectorAll('.s-drop-item').forEach(function(item){
    item.addEventListener('click',function(){
      var f=features[+item.dataset.i], lng=f.center[0], lat=f.center[1];
      S.lat=lat; S.lng=lng; S.locName=f.text||f.place_name.split(',')[0];
      setText('locName',S.locName); hideDrop(); $('searchInput').value='';
      if(S.map) S.map.flyTo({center:[lng,lat],zoom:9,duration:1400});
      loadWeather(); showToast('📍 '+f.place_name.split(',').slice(0,2).join(','));
    });
  });
}
function hideDrop(){ $('searchDrop').style.display='none'; }
async function reverseGeocode(lat,lng){
  try {
    var d=await(await fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/'+lng+','+lat+'.json?access_token='+MAPBOX_TOKEN+'&limit=1')).json();
    if(d.features?.length){ S.locName=d.features[0].text||d.features[0].place_name.split(',')[0]; setText('locName',S.locName); setText('wcLoc',S.locName); }
  } catch(e){}
}
function geolocate(){
  if(!navigator.geolocation){ showToast('⚠ Geolocation not supported'); return; }
  showToast('📍 Getting your location...');
  navigator.geolocation.getCurrentPosition(
    function(pos){ S.lat=pos.coords.latitude; S.lng=pos.coords.longitude; if(S.map) S.map.flyTo({center:[S.lng,S.lat],zoom:10,duration:1200}); reverseGeocode(S.lat,S.lng); loadWeather(); },
    function(){ showToast('⚠ Location access denied'); }
  );
}

// ── LEGEND ────────────────────────────────────────────────────────
function updateLegend(){
  var layer=document.querySelector('.lb.active')?.dataset.layer||'precipitation';
  var cfg={
    precipitation:{label:'mm/h',grad:'linear-gradient(to top,#646464 0%,#04e9e7 15%,#019ff4 30%,#02fd02 45%,#fdf802 60%,#fd9500 75%,#fd0000 90%,#bc0000 100%)'},
    temperature:  {label:'°',   grad:'linear-gradient(to top,#313695,#4575b4,#74add1,#abd9e9,#ffffbf,#fdae61,#f46d43,#a50026)'},
    wind:         {label:'m/s', grad:'linear-gradient(to top,#3288bd,#66c2a5,#abdda4,#ffffbf,#fdae61,#f46d43,#d53e4f)'},
    clouds:       {label:'%',   grad:'linear-gradient(to top,#111,#333,#666,#999,#ccc,#eee)'},
    pressure:     {label:'hPa', grad:'linear-gradient(to top,#0000cc,#0080ff,#00ffff,#00ff00,#ffff00,#ff8000,#ff0000)'}
  };
  var c=cfg[layer]||cfg.precipitation;
  setText('legTitle',c.label); $('legBar').style.background=c.grad;
}

// ── UI WIRING ─────────────────────────────────────────────────────
function initUI(){
  $('burger').onclick  =function(){ $('sidebar').classList.toggle('open'); };
  $('sidebarX').onclick=function(){ $('sidebar').classList.remove('open'); };
  $('zoomIn').onclick  =function(){ S.map?.zoomIn(); };
  $('zoomOut').onclick =function(){ S.map?.zoomOut(); };
  $('styleBtn').onclick=cycleMapStyle;
  $('geoBtn').onclick  =geolocate;
  $('refreshBtn').onclick=function(){ loadWeather(); loadAlerts(); if(S.map) loadRadar(); showToast('↻ Refreshing...'); };
  $('playBtn').onclick =togglePlay;
  $('tRange').addEventListener('input',function(e){ pickFrame(+e.target.value); });
  $('quickOpacity').addEventListener('input',function(e){ S.cfg.opacity=+e.target.value/100; $('sOpacity').value=e.target.value; $('sOpacityVal').textContent=e.target.value+'%'; scheduleRadarDraw(); saveCfg(); });
  $('tPrev').onclick   =function(){ if(S.frame>0) pickFrame(S.frame-1); };
  $('tNext').onclick   =function(){ if(S.frame<S.frames.length-1) pickFrame(S.frame+1); };

  // Draw mode
  $('drawBtn').onclick  =function(){ S.drawMode?exitDrawMode():enterDrawMode(); };
  $('drawExit').onclick =exitDrawMode;
  $('drawUndo').onclick =undoDraw;
  $('drawClear').onclick=clearDraw;
  document.querySelectorAll('.dc').forEach(function(btn){
    btn.onclick=function(){ document.querySelectorAll('.dc').forEach(function(b){b.classList.remove('active');}); btn.classList.add('active'); S.drawColor=btn.dataset.c; };
  });
  document.querySelectorAll('.ds').forEach(function(btn){
    btn.onclick=function(){ document.querySelectorAll('.ds').forEach(function(b){b.classList.remove('active');}); btn.classList.add('active'); S.drawSize=+btn.dataset.s; };
  });

  // Theme
  $('themeBtn').onclick=function(){
    var t=S.cfg.theme==='dark'?'light':'dark';
    applyTheme(t); saveCfg();
    if(S.map) S.map.setStyle(MAP_STYLES[t==='light'?'light':'dark']);
    showToast(t==='dark'?'🌙 Dark mode':'☀️ Light mode');
  };

  // Layer bar
  document.querySelectorAll('.lb[data-layer]').forEach(function(b){
    b.onclick=function(){
      document.querySelectorAll('.lb[data-layer]').forEach(function(x){x.classList.remove('active');});
      b.classList.add('active');
      updateLegend();
      var mapLayer={
        precipitation:null,
        temperature:'temperature',
        wind:'wind_speed',
        clouds:'cloud_cover',
        pressure:'pressure'
      }[b.dataset.layer||'precipitation'];
      S.activeOverlay=mapLayer||null;
      scheduleRadarDraw();
      showToast(mapLayer?('Overlay: '+b.textContent.trim()):'Radar only');
    };
  });

  // overlay toggles (legacy controls)
  document.querySelectorAll('.lb-overlay[data-overlay]').forEach(function(b){
    b.onclick=function(){
      var wasActive=b.classList.contains('active');
      document.querySelectorAll('.lb-overlay').forEach(function(x){x.classList.remove('active');});
      if(!wasActive){ b.classList.add('active'); setOverlay(b.dataset.overlay); } else setOverlay(null);
    };
  });

  // Forecast tabs
  document.querySelectorAll('.fct').forEach(function(t){
    t.onclick=function(){ document.querySelectorAll('.fct').forEach(function(x){x.classList.remove('active');}); t.classList.add('active'); S.fcMode=t.dataset.ft; if(S.weather) renderForecast(S.weather); };
  });

  // Right panel tabs
  document.querySelectorAll('.rpt').forEach(function(t){
    t.onclick=function(){ document.querySelectorAll('.rpt').forEach(function(x){x.classList.remove('active');}); t.classList.add('active'); S.rightTab=t.dataset.rt; if(S.rightTab==='alerts') renderAlerts(); else renderRadarInfo(); };
  });

  // Sidebar nav
  document.querySelectorAll('.sni').forEach(function(item){
    item.onclick=function(e){
      e.preventDefault();
      document.querySelectorAll('.sni').forEach(function(x){x.classList.remove('active');});
      item.classList.add('active');
      var p=item.dataset.p;
      if(p==='settings') openModal('settingsModal');
      else if(p==='storm-central') openStormCentral();
      else if(p==='traffic') openModal('trafficModal');
      else if(p==='alerts'){ document.querySelectorAll('.rpt').forEach(function(x){x.classList.remove('active');}); document.querySelector('.rpt[data-rt="alerts"]')?.classList.add('active'); S.rightTab='alerts'; renderAlerts(); }
    };
  });

  // Search
  var searchTimer;
  $('searchInput').addEventListener('input',function(e){
    clearTimeout(searchTimer); var v=e.target.value.trim();
    if(v.length<2){hideDrop();return;} searchTimer=setTimeout(function(){doSearch(v);},350);
  });
  $('searchInput').addEventListener('keydown',function(e){
    if(e.key==='Escape'){hideDrop();e.target.value='';}
    if(e.key==='Enter') doSearch(e.target.value.trim());
  });
  document.addEventListener('click',function(e){ if(!document.querySelector('.searchbox').contains(e.target)) hideDrop(); });

  // Modals
  $('mClose').onclick =function(){closeModal('alertModal');};
  $('alertModal').onclick=function(e){if(e.target===$('alertModal'))closeModal('alertModal');};
  $('sClose').onclick =closeSettingsModal;
  $('settingsModal').onclick=function(e){if(e.target===$('settingsModal'))closeSettingsModal();};
  $('scClose').onclick=function(){closeModal('stormCentralModal');};
  $('stormCentralModal').onclick=function(e){if(e.target===$('stormCentralModal'))closeModal('stormCentralModal');};
  $('tcClose').onclick=function(){closeModal('trafficModal');};
  $('trafficModal').onclick=function(e){if(e.target===$('trafficModal'))closeModal('trafficModal');};

  // Traffic cams
  $('tcSearchBtn').onclick=function(){searchTrafficCams($('tcSearch').value.trim());};
  $('tcSearch').addEventListener('keydown',function(e){if(e.key==='Enter')searchTrafficCams($('tcSearch').value.trim());});

  initSCAuth();

  // Settings — segmented controls
  segBind('sTempUnit', function(v){S.cfg.tempUnit=v;saveCfg();if(S.weather){renderWeather(S.weather);renderForecast(S.weather);}});
  segBind('sWindUnit', function(v){S.cfg.windUnit=v;saveCfg();if(S.weather)renderWeather(S.weather);});
  segBind('sTimeFormat',function(v){S.cfg.timeFormat=v;saveCfg();if(S.weather){renderWeather(S.weather);renderForecast(S.weather);}if(S.frames.length)buildSlots();});
  segBind('sSpeed',    function(v){S.cfg.speed=+v;saveCfg();if(S.playing){pause();play();}});
  segBind('sCardPos',  function(v){S.cfg.cardPosition=v;saveCfg();if(S.weather)renderWeather(S.weather);});
  segBind('sCardStyle',function(v){S.cfg.cardStyle=v;saveCfg();if(S.weather)renderWeather(S.weather);});
  segBind('sRadarColor',function(v){
    S.cfg.radarColor=v; saveCfg(); tileCache.clear();
    if(S.frames.length) drawFrame(S.frame);
    showToast('🎨 Radar: '+({'1':'Original','2':'Universal','4':'Rainbow','6':'NOAA'}[v]||v));
  });
  $('sOpacity').addEventListener('input',function(e){
    S.cfg.opacity=+e.target.value/100; $('sOpacityVal').textContent=e.target.value+'%'; $('quickOpacity').value=e.target.value;
    saveCfg(); if(S.frames.length) drawFrame(S.frame);
  });
  $('sAutoPlay').addEventListener('change',function(e){S.cfg.autoPlay=e.target.checked;saveCfg();});
  $('sAlertZones').addEventListener('change',function(e){
    S.cfg.alertZones=e.target.checked; saveCfg();
    if(e.target.checked) putAlertsOnMap(); else rmLayers(['alert-fill','alert-line'],['alerts-src']);
  });
  $('sCrosshair').addEventListener('change',function(e){
    S.cfg.crosshair=e.target.checked; saveCfg(); $('crosshair').style.display=e.target.checked?'':'none';
  });
  $('sClickAction').addEventListener('change',function(e){S.cfg.clickAction=e.target.checked?'nws':'weather';saveCfg();});

  // ★ FIXED: Checkboxes immediately toggle row visibility.
  //   ROW_MAP defined OUTSIDE the forEach so no closures capture
  //   the wrong variable. Toggling a checkbox now instantly shows/hides
  //   the corresponding weather card row without waiting for weather reload.
  var ROW_MAP={
    showHumidity:'statHum', showPressure:'statPres', showUV:'statUV',
    showSunTimes:'statSun', showWind:'statWind',     showRain:'statRain',
    showCloud:'statCloud',  showFeels:'statFeels'
  };
  [['sfHumidity','showHumidity'],['sfPressure','showPressure'],['sfUV','showUV'],
   ['sfSunTimes','showSunTimes'],['sfWind','showWind'],        ['sfRain','showRain'],
   ['sfCloud','showCloud'],     ['sfFeels','showFeels']
  ].forEach(function(pair){
    var el=$(pair[0]), key=pair[1];
    if(!el) return;
    el.addEventListener('change',function(e){
      S.cfg[key]=e.target.checked; saveCfg();
      var row=$(ROW_MAP[key]); if(row) row.style.display=e.target.checked?'':'none';
      if(key==='showWind'){ var dr=$('statDir'); if(dr) dr.style.display=e.target.checked?'':'none'; }
      if(S.weather) renderWeather(S.weather);
    });
  });

  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){ closeModal('alertModal'); closeModal('settingsModal'); closeModal('stormCentralModal'); closeModal('trafficModal'); }
  });

  applySettingsUI();
  updateLegend();
}


async function loadAdvancedData(){
  try{
    var [l,h,sr,m,mc]=await Promise.all([
      fetch(API_URL+'/api/lightning').then(r=>r.json()),
      fetch(API_URL+'/api/hurricane-track').then(r=>r.json()),
      fetch(API_URL+'/api/storm-reports').then(r=>r.json()),
      fetch(API_URL+'/api/metar').then(r=>r.json()),
      fetch(API_URL+'/api/model-comparison?lat='+S.lat+'&lng='+S.lng).then(r=>r.json())
    ]);
    S.lightning=l.items||[]; S.hurricaneTrack=h.points||[]; S.stormReports=sr.items||[]; S.metars=m.items||[]; S.modelCmp=mc||null;
  }catch(e){ console.warn('Advanced data unavailable',e.message); }
}

// ── RADAR INFO PANEL ──────────────────────────────────────────────
function renderRadarInfo(){
  var newest=S.frames.length?new Date(S.frames[S.frames.length-1].time*1000):null;
  var oldest=S.frames.length?new Date(S.frames[0].time*1000):null;
  var overlayNames={};
  $('alertsBody').innerHTML='<div class="radar-info">'+
    '<div class="ri-title">Radar Status</div>'+
    '<div class="ri-stat"><span>Source</span><span>RainViewer</span></div>'+
    '<div class="ri-stat"><span>Overlay</span><span>'+(S.activeOverlay?(overlayNames[S.activeOverlay]||S.activeOverlay)+'':'None')+'</span></div>'+
    '<div class="ri-stat"><span>Frames</span><span>'+S.frames.length+'/12</span></div>'+
    '<div class="ri-stat"><span>Latest</span><span>'+(newest?fmtTime(newest,true):'N/A')+'</span></div>'+
    '<div class="ri-stat"><span>Oldest</span><span>'+(oldest?fmtTime(oldest,true):'N/A')+'</span></div>'+
    '<div class="ri-stat"><span>Color</span><span>'+({'1':'Original','2':'Universal','4':'Rainbow','6':'NOAA'}[S.cfg.radarColor]||'NOAA')+'</span></div>'+
    '<div class="ri-stat"><span>Opacity</span><span>'+Math.round(S.cfg.opacity*100)+'%</span></div>'+
    '<div class="ri-stat"><span>Compare Mode</span><span>'+(S.compareMode?'ON':'OFF')+'</span></div>'+
    '<div class="ri-stat"><span>Lightning</span><span>'+S.lightning.length+' live</span></div>'+
    '<div class="ri-stat"><span>Storm Reports</span><span>'+S.stormReports.length+' reports</span></div>'+
    '<div class="ri-stat"><span>METAR</span><span>'+S.metars.length+' stations</span></div>'+
    '<div class="ri-stat"><span>Model Δ</span><span>'+(S.modelCmp?((S.modelCmp.gfsTemp-S.modelCmp.ecmwfTemp).toFixed(1)+'°'):'N/A')+'</span></div>'+
    '<div class="ri-actions">'+
      '<button class="ri-refresh" onclick="tileCache.clear();loadRadar();showToast(\'↻ Radar refreshed\')">↻ Refresh Radar</button>'+
      '<button class="ri-refresh" onclick="S.compareMode=!S.compareMode;scheduleRadarDraw();renderRadarInfo();">⇄ Dual Compare</button>'+
      '<button class="ri-refresh" onclick="loadAdvancedData();renderRadarInfo();">⚡ Refresh Advanced</button>'+
    '</div>'+
  '</div>';
}

// ── MODALS & SETTINGS ─────────────────────────────────────────────
function openModal(id)  { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }
function closeSettingsModal(){
  closeModal('settingsModal');
  document.querySelectorAll('.sni').forEach(function(x){x.classList.remove('active');});
  document.querySelector('.sni[data-p="home"]').classList.add('active');
}
function segBind(cId,cb){
  document.querySelectorAll('#'+cId+' .sb').forEach(function(btn){
    btn.onclick=function(){
      document.querySelectorAll('#'+cId+' .sb').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active'); cb(btn.dataset.v);
    };
  });
}
function applySettingsUI(){
  var c=S.cfg;
  [['sTempUnit',c.tempUnit],['sWindUnit',c.windUnit],['sTimeFormat',c.timeFormat],
   ['sSpeed',String(c.speed)],['sRadarColor',String(c.radarColor)],
   ['sCardPos',c.cardPosition],['sCardStyle',c.cardStyle||'full']
  ].forEach(function(pair){
    document.querySelectorAll('#'+pair[0]+' .sb').forEach(function(b){ b.classList.toggle('active',b.dataset.v===pair[1]); });
  });
  $('sOpacity').value=Math.round(c.opacity*100);
  $('quickOpacity').value=Math.round(c.opacity*100);
  $('sOpacityVal').textContent=Math.round(c.opacity*100)+'%';
  $('sAutoPlay').checked=c.autoPlay; $('sAlertZones').checked=c.alertZones;
  $('sCrosshair').checked=c.crosshair; $('sClickAction').checked=c.clickAction==='nws';
  if(!c.crosshair) $('crosshair').style.display='none';
  [['sfHumidity','showHumidity'],['sfPressure','showPressure'],['sfUV','showUV'],
   ['sfSunTimes','showSunTimes'],['sfWind','showWind'],['sfRain','showRain'],
   ['sfCloud','showCloud'],['sfFeels','showFeels']
  ].forEach(function(pair){ var el=$(pair[0]); if(el) el.checked=c[pair[1]]; });
}

// ── PERSISTENCE ───────────────────────────────────────────────────
function saveCfg(){ try{localStorage.setItem('ss10_cfg',JSON.stringify(S.cfg));}catch(e){} }
function loadCfg(){ try{var s=localStorage.getItem('ss10_cfg');if(s)Object.assign(S.cfg,JSON.parse(s));}catch(e){} }

console.log('⛈ Storm Surge v10.3');
