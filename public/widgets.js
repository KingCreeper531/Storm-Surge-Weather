// ================================================================
//  STORM SURGE WIDGETS v13.9
//  Wind Rose · Feels Gauge · Precip Calendar
//  Humidity Bar · Pressure Trend · Solunar Table
// ================================================================
window.SSWidgets = (() => {
  'use strict';
  const $=id=>document.getElementById(id);

  // Wind Rose
  function drawWindRose(canvasId, dirs, speeds){
    const c=$(canvasId); if(!c)return;
    const w=c.width=c.offsetWidth||200; c.height=w;
    const ctx=c.getContext('2d'), cx=w/2, cy=w/2, r=w*.36;
    const labels=['N','NE','E','SE','S','SW','W','NW'];
    ctx.clearRect(0,0,w,w);
    [.33,.66,1].forEach(f=>{ctx.beginPath();ctx.arc(cx,cy,r*f,0,Math.PI*2);ctx.strokeStyle='rgba(255,255,255,.08)';ctx.stroke();});
    labels.forEach((_,i)=>{const a=(i/8)*Math.PI*2-Math.PI/2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);ctx.strokeStyle='rgba(255,255,255,.06)';ctx.stroke();});
    if(dirs&&speeds&&dirs.length){
      const buckets=new Array(8).fill(0);
      dirs.forEach((d,i)=>{const b=Math.round(d/45)%8;buckets[b]=Math.max(buckets[b],speeds[i]||0);});
      const max=Math.max(...buckets,1);
      buckets.forEach((spd,i)=>{
        if(!spd)return;
        const a=(i/8)*Math.PI*2-Math.PI/2, len=(spd/max)*r, bw=.18;
        ctx.beginPath();
        ctx.moveTo(cx+Math.cos(a-bw)*4,cy+Math.sin(a-bw)*4);
        ctx.lineTo(cx+Math.cos(a-bw)*len,cy+Math.sin(a-bw)*len);
        ctx.arc(cx,cy,len,a-bw,a+bw);
        ctx.lineTo(cx+Math.cos(a+bw)*4,cy+Math.sin(a+bw)*4);
        ctx.closePath();
        const p=spd/max;
        ctx.fillStyle=`rgba(${Math.round(6+p*200)},${Math.round(182-p*80)},212,${.4+p*.55})`;
        ctx.fill();
      });
    }
    ctx.fillStyle='rgba(255,255,255,.5)';ctx.font=`${w*.07}px Outfit,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    labels.forEach((d,i)=>{const a=(i/8)*Math.PI*2-Math.PI/2;ctx.fillText(d,cx+Math.cos(a)*(r+14),cy+Math.sin(a)*(r+14));});
  }

  // Feels-like arc gauge
  function drawFeelsGauge(canvasId, actual, feels, unit){
    const c=$(canvasId); if(!c)return;
    const w=c.width=c.offsetWidth||160; c.height=Math.round(w*.62);
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,w,c.height);
    const cx=w/2, cy=c.height*.88, rad=w*.38;
    ctx.beginPath();ctx.arc(cx,cy,rad,Math.PI,0);ctx.strokeStyle='rgba(255,255,255,.1)';ctx.lineWidth=10;ctx.stroke();
    const diff=feels-actual, clamp=Math.max(-20,Math.min(20,diff)), pct=(clamp+20)/40;
    const color=diff<-5?'#06b6d4':diff>5?'#ef4444':'#22c55e';
    ctx.beginPath();ctx.arc(cx,cy,rad,Math.PI,Math.PI+pct*Math.PI);ctx.strokeStyle=color;ctx.lineWidth=10;ctx.lineCap='round';ctx.stroke();
    const na=Math.PI+pct*Math.PI;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(na)*(rad-16),cy+Math.sin(na)*(rad-16));ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.lineCap='round';ctx.stroke();
    ctx.fillStyle='#fff';ctx.font=`bold ${w*.13}px Outfit`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(`${feels}°${unit}`,cx,cy-rad*.48);
    ctx.font=`${w*.074}px Outfit`;ctx.fillStyle='rgba(255,255,255,.5)';
    ctx.fillText(`actual ${actual}°`,cx,cy-rad*.22);
    ctx.fillText(diff>0?`+${diff.toFixed(1)}° warmer`:`${diff.toFixed(1)}° cooler`,cx,cy+7);
  }

  // 14-day precip calendar
  function drawPrecipCalendar(containerId, times, precip, prob){
    const el=$(containerId); if(!el)return;
    const days=['S','M','T','W','T','F','S'];
    el.innerHTML='';
    const grid=document.createElement('div');
    grid.style.cssText='display:grid;grid-template-columns:repeat(7,1fr);gap:3px;padding:2px 0';
    times.slice(0,14).forEach((ds,i)=>{
      const d=new Date(ds), p=precip[i]||0, pr=prob[i]||0;
      const h=Math.min(30,(p/25)*30), alpha=.15+(pr/100)*.8;
      const cell=document.createElement('div');
      cell.style.cssText='text-align:center;font-size:.65rem;color:rgba(255,255,255,.6)';
      cell.innerHTML=`<div style="height:32px;display:flex;align-items:flex-end;justify-content:center"><div style="width:14px;height:${Math.max(2,h)}px;background:rgba(6,182,212,${alpha.toFixed(2)});border-radius:2px 2px 0 0" title="${p.toFixed(1)}mm · ${pr}%"></div></div><div style="margin-top:2px">${days[d.getDay()]}</div><div style="color:${pr>60?'#06b6d4':'rgba(255,255,255,.3)'}">${pr}%</div>`;
      grid.appendChild(cell);
    });
    el.appendChild(grid);
  }

  // Humidity / dew spread bar
  function drawHumidityBar(containerId, temp, dew, rh, unit){
    const el=$(containerId); if(!el)return;
    const spread=(temp-dew).toFixed(1);
    const comfort=rh<30?{l:'Dry',c:'#f59e0b'}:rh<60?{l:'Comfortable',c:'#22c55e'}:rh<80?{l:'Humid',c:'#f97316'}:{l:'Oppressive',c:'#ef4444'};
    el.innerHTML=`<div style="display:flex;justify-content:space-between;font-size:.72rem;margin-bottom:4px"><span style="color:var(--t3)">Humidity</span><span style="color:${comfort.c};font-weight:600">${comfort.l}</span></div><div style="background:rgba(255,255,255,.08);border-radius:4px;height:8px;overflow:hidden"><div style="width:${rh}%;height:100%;background:linear-gradient(to right,#06b6d4,${comfort.c});border-radius:4px"></div></div><div style="display:flex;justify-content:space-between;font-size:.7rem;margin-top:4px;color:var(--t3)"><span>💧 ${rh}% RH</span><span>🌫 Dew ${dew}°${unit}</span><span>Spread ${spread}°</span></div>`;
  }

  // Pressure trend sparkline
  function drawPressureTrend(canvasId, vals){
    const c=$(canvasId); if(!c)return;
    const w=c.width=c.offsetWidth||200; c.height=60;
    const ctx=c.getContext('2d'); ctx.clearRect(0,0,w,60);
    if(!vals||vals.length<2)return;
    const v=vals.slice(0,24), mn=Math.min(...v)-1, mx=Math.max(...v)+1;
    const sx=w/(v.length-1), trend=v[v.length-1]-v[0], color=trend>1?'#22c55e':trend<-1?'#ef4444':'#f59e0b';
    ctx.beginPath();
    v.forEach((p,i)=>{const x=i*sx,y=55-((p-mn)/(mx-mn))*50;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.55)';ctx.font='10px Outfit';ctx.textAlign='left';
    ctx.fillText(`${v[v.length-1].toFixed(0)} hPa  ${trend>0?'▲ Rising':trend<0?'▼ Falling':'► Steady'}`,4,57);
  }

  // Solunar table
  function renderSolunar(containerId, lat){
    const el=$(containerId); if(!el)return;
    const now=new Date(), D=((Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())/86400000)+2440587.5)-2451545;
    const moonLon=(218.316+13.176396*D)%360, sunLon=(280.460+0.9856474*D)%360;
    const angle=((moonLon-sunLon)%360+360)%360, phase=angle/360;
    const idx=Math.round(phase*8)%8;
    const icons=['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘'];
    const names=['New Moon','Waxing Crescent','First Quarter','Waxing Gibbous','Full Moon','Waning Gibbous','Last Quarter','Waning Crescent'];
    const rating=[0,4].includes(idx)?'★★★ Excellent':[2,6].includes(idx)?'★★☆ Good':'★☆☆ Fair';
    const mh=(now.getHours()+Math.round(moonLon/15))%24, fmt=h=>{const hh=h%12||12;return `${hh}:00 ${h<12?'AM':'PM'}`;};
    el.innerHTML=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="font-size:1.6rem">${icons[idx]}</span><div><div style="font-weight:700;font-size:.82rem">${names[idx]}</div><div style="font-size:.72rem;color:var(--t3)">${rating}</div></div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:.75rem"><div style="background:rgba(255,255,255,.05);border-radius:8px;padding:6px 10px"><div style="color:#f59e0b;font-weight:600">Major</div><div>${fmt(mh)}</div><div>${fmt((mh+12)%24)}</div></div><div style="background:rgba(255,255,255,.05);border-radius:8px;padding:6px 10px"><div style="color:var(--t3);font-weight:600">Minor</div><div>${fmt((mh+6)%24)}</div><div>${fmt((mh+18)%24)}</div></div></div><div style="font-size:.68rem;color:var(--t3);margin-top:6px">🎣 Fishing / wildlife activity windows</div>`;
  }

  return {drawWindRose,drawFeelsGauge,drawPrecipCalendar,drawHumidityBar,drawPressureTrend,renderSolunar};
})();
