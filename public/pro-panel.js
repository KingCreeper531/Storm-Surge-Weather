// ================================================================
//  STORM SURGE WEATHER — Pro Panel v14.0
//  Level II Radar · Skew-T · METAR/TAF · Ensemble · Custom Alerts
//  Pollen · Tides · GDD · Aviation Mode
// ================================================================
window.ProPanel = (() => {
  'use strict';

  const API = () => (window.SS_API_URL || window.location.origin || '').replace(/\/$/, '');
  const RADAR_API = () => API(); // routed through Node proxy

  let _panel = null, _open = false, _tab = 'radar';

  // ── PANEL BUILD ────────────────────────────────────────────────
  function _build() {
    const el = document.createElement('div');
    el.id = 'proPanel';
    el.innerHTML = `
      <div class="pp-header">
        <div class="pp-tabs">
          <button class="pp-tab active" data-t="radar">📡 Level II</button>
          <button class="pp-tab" data-t="skewt">📈 Skew-T</button>
          <button class="pp-tab" data-t="aviation">✈️ Aviation</button>
          <button class="pp-tab" data-t="ensemble">🔮 Ensemble</button>
          <button class="pp-tab" data-t="marine">🌊 Marine Pro</button>
          <button class="pp-tab" data-t="ag">🌾 Ag/Health</button>
          <button class="pp-tab" data-t="alerts">⚡ Custom Alerts</button>
        </div>
        <button id="ppClose" class="pp-close">✕</button>
      </div>
      <div id="ppBody" class="pp-body">
        <div class="pp-loading">Select a tab to load data</div>
      </div>
    `;
    document.body.appendChild(el);

    el.querySelectorAll('.pp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.pp-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _tab = btn.dataset.t;
        loadTab(_tab);
      });
    });
    document.getElementById('ppClose').addEventListener('click', () => ProPanel.close());
    return el;
  }

  function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── TAB LOADER ─────────────────────────────────────────────────
  function loadTab(tab) {
    const body = document.getElementById('ppBody');
    if (!body) return;
    const lat = window.S?.lat || 40.71;
    const lng = window.S?.lng || -74.01;

    const show = (html) => { body.innerHTML = html; };
    show(`<div class="pp-loading"><div class="pp-spinner"></div> Loading ${tab}…</div>`);

    switch(tab) {
      case 'radar':    loadRadarTab(body, lat, lng); break;
      case 'skewt':    loadSkewtTab(body, lat, lng); break;
      case 'aviation': loadAviationTab(body, lat, lng); break;
      case 'ensemble': loadEnsembleTab(body, lat, lng); break;
      case 'marine':   loadMarineProTab(body, lat, lng); break;
      case 'ag':       loadAgTab(body, lat, lng); break;
      case 'alerts':   loadCustomAlertsTab(body, lat, lng); break;
    }
  }

  // ── LEVEL II RADAR TAB ─────────────────────────────────────────
  async function loadRadarTab(body, lat, lng) {
    try {
      // Get nearest stations
      const r = await fetch(`${API()}/api/radar/nearest?lat=${lat}&lng=${lng}&n=8`);
      const data = await r.json();
      const stations = data.stations || [];

      body.innerHTML = `
        <div class="pp-section">
          <div class="pp-section-title">NEXRAD Level II — AWS Real-Time Data</div>
          <div class="pp-row">
            <div class="pp-col" style="flex:1">
              <label class="pp-label">Station</label>
              <select id="l2Station" class="pp-select">
                ${stations.map(s => `<option value="${_esc(s.id)}">${_esc(s.id)} — ${_esc(s.name)} (${s.distKm}km)</option>`).join('')}
              </select>
            </div>
            <div class="pp-col" style="flex:1">
              <label class="pp-label">Product</label>
              <select id="l2Product" class="pp-select">
                <option value="reflectivity">Reflectivity (dBZ)</option>
                <option value="velocity">Radial Velocity</option>
                <option value="zdr">Diff. Reflectivity (ZDR)</option>
                <option value="cc">Correlation Coefficient (CC)</option>
                <option value="sw">Spectrum Width</option>
              </select>
            </div>
            <div class="pp-col" style="flex:0">
              <label class="pp-label">&nbsp;</label>
              <button id="l2Load" class="pp-btn pp-btn-primary">Load Scan</button>
            </div>
          </div>
          <div id="l2Status" class="pp-info-box" style="display:none"></div>
          <div id="l2Image" class="pp-radar-canvas"></div>
          <div id="l2Meta" class="pp-meta-row"></div>
        </div>
        <div class="pp-section">
          <div class="pp-section-title">Dual-Polarization Guide</div>
          <div class="pp-dpol-grid">
            <div class="pp-dpol-item">
              <div class="pp-dpol-label">ZDR &gt; 2 dB</div>
              <div class="pp-dpol-desc">Large raindrops / heavy rain</div>
            </div>
            <div class="pp-dpol-item">
              <div class="pp-dpol-label">CC &lt; 0.9</div>
              <div class="pp-dpol-desc">Hail, tornado debris, mixed precip</div>
            </div>
            <div class="pp-dpol-item">
              <div class="pp-dpol-label">ZDR ≈ 0, high Z</div>
              <div class="pp-dpol-desc">Large hail (tumbling)</div>
            </div>
            <div class="pp-dpol-item">
              <div class="pp-dpol-label">Velocity couplet</div>
              <div class="pp-dpol-desc">Mesocyclone rotation / tornado</div>
            </div>
          </div>
        </div>
      `;

      document.getElementById('l2Load').addEventListener('click', async () => {
        const station = document.getElementById('l2Station').value;
        const product = document.getElementById('l2Product').value;
        const status  = document.getElementById('l2Status');
        const imgDiv  = document.getElementById('l2Image');
        const meta    = document.getElementById('l2Meta');

        status.style.display = 'block';
        status.className = 'pp-info-box pp-info-loading';
        status.textContent = `Fetching latest scan from AWS S3 for ${station}…`;
        imgDiv.innerHTML = '';

        try {
          const r = await fetch(`${API()}/api/radar/level2/render?station=${station}&product=${product}`);
          const d = await r.json();
          if (d.error) throw new Error(d.error);

          status.className = 'pp-info-box pp-info-success';
          status.textContent = `✓ Scan loaded — ${d.scan_time || 'latest'} · ${d.available_sweeps || '?'} sweeps · Fields: ${(d.available_fields||[]).join(', ')}`;

          imgDiv.innerHTML = `
            <div style="position:relative;text-align:center">
              <img src="data:image/png;base64,${d.image_b64}"
                   style="max-width:100%;border-radius:8px;border:1px solid rgba(255,255,255,.1)"
                   alt="NEXRAD Level II ${product}" />
              <div style="margin-top:6px;font-size:.72rem;color:var(--t3)">
                ${_esc(station)} · ${_esc(product)} · Range ~${Math.round(d.range_km||250)}km
              </div>
            </div>
          `;

          if (d.available_fields) {
            meta.innerHTML = d.available_fields.map(f =>
              `<span class="pp-field-badge ${f===product.replace('reflectivity','reflectivity')?'active':''}">${_esc(f)}</span>`
            ).join('');
          }
        } catch(e) {
          status.className = 'pp-info-box pp-info-error';
          status.textContent = `Error: ${e.message}. The Python radar service must be running (python3 radar_service.py).`;
        }
      });

    } catch(e) {
      body.innerHTML = `<div class="pp-error">Failed to load stations: ${_esc(e.message)}</div>`;
    }
  }

  // ── SKEW-T TAB ─────────────────────────────────────────────────
  async function loadSkewtTab(body, lat, lng) {
    body.innerHTML = `
      <div class="pp-section">
        <div class="pp-section-title">Skew-T Log-P Atmospheric Sounding</div>
        <div class="pp-row">
          <div class="pp-col" style="flex:1">
            <div class="pp-info-box">Loading nearest radiosonde station…</div>
          </div>
          <button id="skewtLoad" class="pp-btn pp-btn-primary">Load Sounding</button>
        </div>
        <canvas id="skewtCanvas" width="500" height="550"
                style="width:100%;border-radius:8px;background:#0b0f1a;margin-top:12px"></canvas>
        <div id="skewtMeta" style="margin-top:8px;font-size:.72rem;color:var(--t3)"></div>
      </div>
    `;

    async function fetchAndDraw() {
      const btn = document.getElementById('skewtLoad');
      if (btn) btn.disabled = true;
      const info = body.querySelector('.pp-info-box');
      if (info) info.textContent = 'Fetching sounding data from Univ. of Wyoming…';

      try {
        const r = await fetch(`${API()}/api/radar/skewtdata?lat=${lat}&lng=${lng}`);
        const d = await r.json();
        if (d.error) throw new Error(d.error);

        if (info) info.textContent = `✓ Station: ${d.station?.name || '?'} · ${d.date} · ${d.levels} pressure levels`;

        drawSkewtLP(
          document.getElementById('skewtCanvas'),
          d.pressure, d.temperature, d.dewpoint, d.wind_u, d.wind_v
        );

        const meta = document.getElementById('skewtMeta');
        if (meta) {
          const cape = calcCAPE(d.pressure, d.temperature, d.dewpoint);
          meta.innerHTML = `
            <div style="display:flex;gap:16px;flex-wrap:wrap">
              <span>📍 ${_esc(d.station?.name||'?')}</span>
              <span>📅 ${_esc(d.date)}</span>
              <span style="color:${cape>2000?'#ef4444':cape>500?'#f59e0b':'#22c55e'}">⚡ CAPE ~${cape} J/kg</span>
              <span>${d.levels} levels</span>
            </div>
          `;
        }
      } catch(e) {
        if (info) { info.className = 'pp-info-box pp-info-error'; info.textContent = `Error: ${e.message}`; }
      }
      if (btn) btn.disabled = false;
    }

    document.getElementById('skewtLoad')?.addEventListener('click', fetchAndDraw);
    fetchAndDraw();
  }

  function calcCAPE(pressures, temps, dews) {
    // Simplified CAPE estimate
    if (!pressures?.length) return 0;
    let cape = 0;
    for (let i = 1; i < pressures.length; i++) {
      const t_env = temps[i];
      const td = dews[i];
      if (t_env == null || td == null) continue;
      const t_parcel = temps[0] + (pressures[0] - pressures[i]) * 0.0098; // dry adiabatic
      if (t_parcel > t_env) {
        const dz = Math.abs(pressures[i-1] - pressures[i]) * 8.5; // ~8.5m/hPa
        cape += 9.81 * ((t_parcel - t_env) / (t_env + 273.15)) * dz;
      }
    }
    return Math.round(Math.max(0, cape));
  }

  function drawSkewtLP(canvas, pressures, temps, dews, wind_u, wind_v) {
    if (!canvas || !pressures?.length) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const PAD = { top: 20, right: 60, bottom: 30, left: 50 };
    const PW = W - PAD.left - PAD.right;
    const PH = H - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0f1a';
    ctx.fillRect(0, 0, W, H);

    // Pressure levels
    const P_LEVELS = [1000, 850, 700, 500, 400, 300, 200, 100];
    const logP = p => Math.log10(p);
    const pToY = p => PAD.top + PH * (logP(1050) - logP(p)) / (logP(1050) - logP(100));
    const tToX = (t, p) => {
      // Skew: shift temp by pressure
      const skew = (logP(1000) - logP(p)) * 60;
      return PAD.left + PW * (t + skew + 40) / 140;
    };

    // Draw isobars
    ctx.strokeStyle = 'rgba(255,255,255,.15)';
    ctx.lineWidth = 1;
    P_LEVELS.forEach(p => {
      const y = pToY(p);
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + PW, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText(p, 2, y + 4);
    });

    // Draw isotherms (skewed)
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    for (let t = -80; t <= 50; t += 10) {
      ctx.beginPath();
      P_LEVELS.forEach((p, i) => {
        const x = tToX(t, p), y = pToY(p);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Draw dry adiabats
    ctx.strokeStyle = 'rgba(200,150,50,.2)';
    for (let t0 = -30; t0 <= 50; t0 += 10) {
      ctx.beginPath();
      let first = true;
      for (let p = 1000; p >= 100; p -= 10) {
        const t_adiabat = t0 - 9.8 * (1000 - p) / 100;
        const x = tToX(t_adiabat, p), y = pToY(p);
        if (x < PAD.left || x > PAD.left + PW) continue;
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke();
    }

    // Draw temp profile
    if (temps?.length) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      pressures.forEach((p, i) => {
        if (temps[i] == null) return;
        const x = tToX(temps[i], p), y = pToY(p);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Draw dewpoint profile
    if (dews?.length) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      pressures.forEach((p, i) => {
        if (dews[i] == null) return;
        const x = tToX(dews[i], p), y = pToY(p);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Wind barbs on right side
    if (wind_u?.length && wind_v?.length) {
      const BARB_X = W - PAD.right + 10;
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.lineWidth = 1.5;
      const barb_levels = [1000, 925, 850, 700, 500, 400, 300, 200];
      barb_levels.forEach(p => {
        const i = pressures.findIndex(pr => Math.abs(pr - p) < 30);
        if (i < 0 || wind_u[i] == null) return;
        const spd = Math.sqrt(wind_u[i]**2 + wind_v[i]**2);
        const dir = Math.atan2(-wind_u[i], -wind_v[i]);
        const y = pToY(p);
        const len = 20;
        ctx.beginPath();
        ctx.moveTo(BARB_X, y);
        ctx.lineTo(BARB_X + Math.cos(dir) * len, y + Math.sin(dir) * len);
        ctx.stroke();
        // Speed text
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        ctx.font = '9px JetBrains Mono';
        ctx.fillText(Math.round(spd * 1.944) + 'kt', BARB_X + 22, y + 3);
      });
    }

    // Legend
    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = '#ef4444'; ctx.fillText('■ Temperature', PAD.left, H - 8);
    ctx.fillStyle = '#22c55e'; ctx.fillText('■ Dewpoint', PAD.left + 110, H - 8);
  }

  // ── AVIATION TAB ───────────────────────────────────────────────
  async function loadAviationTab(body, lat, lng) {
    body.innerHTML = `
      <div class="pp-section">
        <div class="pp-section-title">Aviation Weather — METAR / TAF</div>
        <div class="pp-row">
          <div class="pp-col" style="flex:1">
            <input id="icaoInput" class="pp-input" type="text" placeholder="ICAO code (e.g. KJFK) or leave blank for nearest" value="" />
          </div>
          <button id="metarLoad" class="pp-btn pp-btn-primary">Fetch</button>
        </div>
        <div id="metarBody" style="margin-top:12px"></div>
      </div>
      <div class="pp-section">
        <div class="pp-section-title">🕐 Zulu Time</div>
        <div id="zuluClock" style="font-family:'JetBrains Mono',monospace;font-size:1.4rem;color:var(--t1);letter-spacing:.08em"></div>
        <div style="font-size:.72rem;color:var(--t3);margin-top:4px">UTC — standard aviation time reference</div>
      </div>
    `;

    // Live Zulu clock
    const updateZulu = () => {
      const el = document.getElementById('zuluClock');
      if (!el) return;
      const now = new Date();
      const h = String(now.getUTCHours()).padStart(2,'0');
      const m = String(now.getUTCMinutes()).padStart(2,'0');
      const s = String(now.getUTCSeconds()).padStart(2,'0');
      el.textContent = `${h}${m}${s}Z`;
    };
    updateZulu();
    const zuluTimer = setInterval(() => { if (!document.getElementById('zuluClock')) { clearInterval(zuluTimer); return; } updateZulu(); }, 1000);

    async function loadMetar() {
      const icao = (document.getElementById('icaoInput')?.value || '').trim().toUpperCase();
      const metarBody = document.getElementById('metarBody');
      if (!metarBody) return;
      metarBody.innerHTML = '<div class="pp-loading"><div class="pp-spinner"></div></div>';

      try {
        let url;
        if (icao) {
          url = `${API()}/api/metar/station?station=${encodeURIComponent(icao)}`;
        } else {
          url = `${API()}/api/metar/nearest?lat=${lat}&lng=${lng}&radius=80`;
        }
        const r = await fetch(url);
        const d = await r.json();
        const metars = d.metars || (d.metar ? [d.metar] : []);

        if (!metars.length) {
          metarBody.innerHTML = '<div class="pp-info-box pp-info-error">No METAR data found</div>';
          return;
        }

        metarBody.innerHTML = metars.slice(0, 10).map(m => {
          const raw = m.rawOb || m.rawText || JSON.stringify(m);
          const name = m.name || m.stationId || '?';
          const temp = m.temp != null ? `${m.temp}°C` : '—';
          const vis  = m.visib ? `${m.visib}SM` : '—';
          const wind = m.wdir != null ? `${m.wdir}° @ ${m.wspd}kt` : '—';
          const sky  = (m.sky || []).map(l => `${l.cover}${l.base||''}`).join(' ') || '—';
          const cat  = m.flightCategory || '';
          const catColor = {VFR:'#22c55e',MVFR:'#06b6d4',IFR:'#ef4444',LIFR:'#a855f7'}[cat] || 'var(--t3)';
          return `
            <div class="pp-metar-card">
              <div class="pp-metar-header">
                <span class="pp-metar-id">${_esc(name)}</span>
                ${cat ? `<span class="pp-metar-cat" style="color:${catColor};background:${catColor}22">${_esc(cat)}</span>` : ''}
              </div>
              <div class="pp-metar-raw">${_esc(raw)}</div>
              <div class="pp-metar-grid">
                <span>🌡 ${_esc(temp)}</span>
                <span>👁 ${_esc(vis)}</span>
                <span>💨 ${_esc(wind)}</span>
                <span>☁️ ${_esc(sky)}</span>
              </div>
            </div>
          `;
        }).join('');
      } catch(e) {
        metarBody.innerHTML = `<div class="pp-info-box pp-info-error">Error: ${_esc(e.message)}</div>`;
      }
    }

    document.getElementById('metarLoad')?.addEventListener('click', loadMetar);
    loadMetar();
  }

  // ── ENSEMBLE TAB ───────────────────────────────────────────────
  async function loadEnsembleTab(body, lat, lng) {
    body.innerHTML = `<div class="pp-info-box">Loading GFS, ECMWF, ICON, GEM model data…</div>`;
    try {
      const r = await fetch(`${API()}/api/ensemble?lat=${lat}&lng=${lng}`);
      const models = await r.json();
      const modelKeys = Object.keys(models).filter(k => !k.startsWith('error'));

      if (!modelKeys.length) {
        body.innerHTML = '<div class="pp-info-box pp-info-error">No ensemble data available</div>';
        return;
      }

      // Build temperature comparison chart
      const hours = (models[modelKeys[0]]?.hourly?.time || []).slice(0, 72);
      const COLORS = { gfs: '#3b82f6', ecmwf: '#f59e0b', icon: '#22c55e', gem: '#a855f7' };

      body.innerHTML = `
        <div class="pp-section">
          <div class="pp-section-title">Model Ensemble Comparison — Temperature Spread</div>
          <div class="pp-model-legend">
            ${modelKeys.map(k => `<span class="pp-model-badge" style="border-color:${COLORS[k]||'#fff'}">${k.toUpperCase()}</span>`).join('')}
          </div>
          <canvas id="ensembleCanvas" style="width:100%;height:200px;margin-top:8px;border-radius:8px;background:#0b0f1a"></canvas>
        </div>
        <div class="pp-section">
          <div class="pp-section-title">Precipitation Spread</div>
          <canvas id="ensemblePrecip" style="width:100%;height:150px;border-radius:8px;background:#0b0f1a"></canvas>
        </div>
        <div class="pp-section">
          <div class="pp-section-title">Forecast Confidence</div>
          <div id="ensembleSpread" style="font-size:.8rem;color:var(--t2)"></div>
        </div>
      `;

      requestAnimationFrame(() => {
        drawEnsembleChart(
          document.getElementById('ensembleCanvas'),
          models, modelKeys, 'temperature_2m', hours, COLORS, '°C'
        );
        drawEnsembleChart(
          document.getElementById('ensemblePrecip'),
          models, modelKeys, 'precipitation', hours, COLORS, 'mm'
        );

        // Compute spread
        const spreadEl = document.getElementById('ensembleSpread');
        if (spreadEl) {
          const day3temps = modelKeys.map(k => {
            const t = models[k]?.hourly?.temperature_2m;
            return t ? t.slice(60, 72).filter(v => v != null) : [];
          }).filter(a => a.length > 0);
          
          if (day3temps.length > 1) {
            const means = day3temps.map(arr => arr.reduce((a,b)=>a+b,0)/arr.length);
            const spread = Math.max(...means) - Math.min(...means);
            const confidence = spread < 2 ? 'High' : spread < 5 ? 'Moderate' : 'Low';
            const confColor = spread < 2 ? '#22c55e' : spread < 5 ? '#f59e0b' : '#ef4444';
            spreadEl.innerHTML = `
              <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center">
                <span>72h temperature spread: <strong style="color:${confColor}">${spread.toFixed(1)}°C</strong></span>
                <span>Forecast confidence: <strong style="color:${confColor}">${confidence}</strong></span>
              </div>
              <div style="margin-top:4px;font-size:.72rem;color:var(--t3)">
                ${confidence === 'High' ? '✓ Models agree well — high confidence forecast' :
                  confidence === 'Moderate' ? '⚠ Some model disagreement — moderate confidence' :
                  '⚡ Large model spread — low confidence, monitor closely'}
              </div>
            `;
          }
        }
      });
    } catch(e) {
      body.innerHTML = `<div class="pp-info-box pp-info-error">Ensemble error: ${_esc(e.message)}</div>`;
    }
  }

  function drawEnsembleChart(canvas, models, keys, field, hours, colors, unit) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth; canvas.width = W; canvas.height = parseInt(canvas.style.height)||200;
    const H = canvas.height;
    const PAD = 30;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0f1a'; ctx.fillRect(0, 0, W, H);

    const allVals = keys.flatMap(k => (models[k]?.hourly?.[field]||[]).slice(0, hours.length).filter(v=>v!=null));
    if (!allVals.length) return;
    const minV = Math.min(...allVals), maxV = Math.max(...allVals);
    const range = maxV - minV || 1;

    const scX = (i) => PAD + (i / (hours.length - 1)) * (W - PAD * 2);
    const scY = (v) => H - PAD - ((v - minV) / range) * (H - PAD * 2);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    [0, 0.25, 0.5, 0.75, 1].forEach(f => {
      const y = H - PAD - f * (H - PAD * 2);
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
      const v = minV + f * range;
      ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = '9px JetBrains Mono';
      ctx.fillText(v.toFixed(1) + unit, 0, y + 3);
    });

    // Model lines
    keys.forEach(k => {
      const vals = (models[k]?.hourly?.[field]||[]).slice(0, hours.length);
      if (!vals.length) return;
      ctx.strokeStyle = colors[k] || '#fff'; ctx.lineWidth = 2;
      ctx.beginPath();
      vals.forEach((v, i) => {
        if (v == null) return;
        const x = scX(i), y = scY(v);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    // X labels every 24h
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = '9px JetBrains Mono';
    [0, 24, 48, 72].forEach(h => {
      if (h >= hours.length) return;
      const x = scX(h);
      const d = new Date(hours[h]);
      ctx.fillText(`+${h}h`, x - 10, H - 4);
    });
  }

  // ── MARINE PRO TAB ─────────────────────────────────────────────
  async function loadMarineProTab(body, lat, lng) {
    body.innerHTML = `<div class="pp-info-box">Loading marine & tide data…</div>`;
    try {
      const [marineR, tideR] = await Promise.allSettled([
        fetch(`${API()}/api/marine?lat=${lat}&lng=${lng}`),
        fetch(`${API()}/api/tide?lat=${lat}&lng=${lng}`),
      ]);

      const marine = marineR.status === 'fulfilled' && marineR.value.ok ? await marineR.value.json() : null;
      const tide   = tideR.status   === 'fulfilled' && tideR.value.ok   ? await tideR.value.json()   : null;
      const c = marine?.current || {};

      const mStat = (label, val) => `<div class="pp-stat"><div class="pp-stat-l">${label}</div><div class="pp-stat-v">${val}</div></div>`;
      
      body.innerHTML = `
        <div class="pp-section">
          <div class="pp-section-title">Wave & Ocean Conditions</div>
          <div class="pp-stats-grid">
            ${mStat('🌊 Wave Height', c.wave_height != null ? c.wave_height.toFixed(1)+' m' : 'N/A')}
            ${mStat('⏱ Wave Period', c.wave_period != null ? c.wave_period.toFixed(1)+' s' : 'N/A')}
            ${mStat('🧭 Wave Dir',   c.wave_direction != null ? c.wave_direction+'°' : 'N/A')}
            ${mStat('🌊 Swell Ht',   c.swell_wave_height != null ? c.swell_wave_height.toFixed(1)+' m' : 'N/A')}
            ${mStat('⏱ Swell Per',   c.swell_wave_period != null ? c.swell_wave_period.toFixed(1)+' s' : 'N/A')}
            ${mStat('💨 Wind Wave',   c.wind_wave_height != null ? c.wind_wave_height.toFixed(1)+' m' : 'N/A')}
          </div>
        </div>
        <div class="pp-section">
          <div class="pp-section-title">🌊 Tidal Predictions — NOAA CO-OPS</div>
          ${tide?.station ? `<div class="pp-info-box pp-info-success">Station: ${_esc(tide.station.name||tide.station.id||'?')}</div>` : '<div class="pp-info-box pp-info-error">Tide station not found (inland location?)</div>'}
          <div id="tideChart" style="margin-top:8px"></div>
        </div>
      `;

      if (tide?.predictions?.length) {
        const tideChart = document.getElementById('tideChart');
        tideChart.innerHTML = tide.predictions.slice(0, 8).map(p => {
          const isHigh = p.type === 'H';
          return `<div class="pp-tide-entry ${isHigh ? 'high' : 'low'}">
            <span class="pp-tide-icon">${isHigh ? '▲' : '▽'}</span>
            <span class="pp-tide-type">${isHigh ? 'HIGH' : 'LOW'}</span>
            <span class="pp-tide-time">${_esc(p.t)}</span>
            <span class="pp-tide-val">${_esc(p.v)} ft</span>
          </div>`;
        }).join('');
      }
    } catch(e) {
      body.innerHTML = `<div class="pp-info-box pp-info-error">Marine error: ${_esc(e.message)}</div>`;
    }
  }

  // ── AGRICULTURE & HEALTH TAB ───────────────────────────────────
  async function loadAgTab(body, lat, lng) {
    body.innerHTML = `<div class="pp-info-box">Loading ag & health data…</div>`;
    try {
      const [gddR, pollenR] = await Promise.allSettled([
        fetch(`${API()}/api/gdd?lat=${lat}&lng=${lng}&base=50`),
        fetch(`${API()}/api/pollen?lat=${lat}&lng=${lng}`),
      ]);

      const gdd    = gddR.status    === 'fulfilled' && gddR.value.ok    ? await gddR.value.json()    : null;
      const pollen = pollenR.status === 'fulfilled' && pollenR.value.ok ? await pollenR.value.json() : null;

      const todayGDD   = gdd?.gdd?.find(d => d.date === new Date().toISOString().slice(0,10));
      const cumGDD     = gdd?.gdd?.[gdd.gdd.length - 1]?.cumulative || 0;
      const h = pollen?.hourly;
      const latestIdx  = 0;

      body.innerHTML = `
        <div class="pp-section">
          <div class="pp-section-title">🌾 Growing Degree Days (Base 50°F)</div>
          <div class="pp-stats-grid">
            <div class="pp-stat"><div class="pp-stat-l">Today's GDD</div><div class="pp-stat-v">${todayGDD?.gdd ?? '—'}</div></div>
            <div class="pp-stat"><div class="pp-stat-l">Cumulative GDD</div><div class="pp-stat-v">${cumGDD}</div></div>
          </div>
          <div style="margin-top:8px;font-size:.75rem;color:var(--t3)">
            Corn: ${cumGDD > 2700 ? '🌽 Maturity reached' : cumGDD > 1300 ? '🌽 ~'+(Math.round((2700-cumGDD)/8))+' days to maturity' : '🌽 Early growth'} |
            Soybeans: ${cumGDD > 2000 ? '🫘 Mature' : '🫘 ~'+(Math.round((2000-cumGDD)/8))+' days to maturity'}
          </div>
          ${gdd?.gdd ? `<canvas id="gddCanvas" style="width:100%;height:100px;margin-top:8px;border-radius:6px;background:#0b0f1a"></canvas>` : ''}
        </div>
        <div class="pp-section">
          <div class="pp-section-title">🌿 Pollen Counts</div>
          <div class="pp-stats-grid">
            ${['alder_pollen','birch_pollen','grass_pollen','ragweed_pollen','mugwort_pollen','olive_pollen'].map(type => {
              const vals = h?.[type];
              const val = vals?.[latestIdx];
              const label = type.replace('_pollen','').replace('_',' ');
              const level = val == null ? '—' : val < 10 ? `<span style="color:#22c55e">${val} Low</span>` : val < 100 ? `<span style="color:#f59e0b">${val} Moderate</span>` : `<span style="color:#ef4444">${val} High</span>`;
              return `<div class="pp-stat"><div class="pp-stat-l">${label}</div><div class="pp-stat-v">${level}</div></div>`;
            }).join('')}
          </div>
        </div>
        <div class="pp-section">
          <div class="pp-section-title">💊 Health Triggers</div>
          <div id="healthTriggers" style="font-size:.82rem;color:var(--t2)">Loading health indicators…</div>
        </div>
      `;

      // Draw GDD sparkline
      if (gdd?.gdd) {
        requestAnimationFrame(() => {
          const c = document.getElementById('gddCanvas');
          if (!c) return;
          c.width = c.offsetWidth;
          const ctx = c.getContext('2d');
          const vals = gdd.gdd.map(d => d.gdd);
          const max = Math.max(...vals, 1);
          const W = c.width, H = c.height, pad = 20;
          ctx.clearRect(0,0,W,H);
          ctx.fillStyle='#0b0f1a'; ctx.fillRect(0,0,W,H);
          ctx.beginPath();
          vals.forEach((v,i)=>{ const x=pad+(i/(vals.length-1))*(W-pad*2), y=H-pad-(v/max)*(H-pad*2); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
          ctx.strokeStyle='#22c55e'; ctx.lineWidth=2; ctx.stroke();
          ctx.fillStyle='rgba(34,197,94,.1)'; ctx.lineTo(W-pad,H-pad); ctx.lineTo(pad,H-pad); ctx.closePath(); ctx.fill();
          ctx.fillStyle='rgba(255,255,255,.5)'; ctx.font='9px JetBrains Mono';
          ctx.fillText('30-day GDD history',pad,12);
        });
      }

      // Health triggers from weather
      fetch(`${API()}/api/weather?lat=${lat}&lng=${lng}`).then(r=>r.json()).then(wx => {
        const el = document.getElementById('healthTriggers');
        if (!el) return;
        const c = wx?.current || {};
        const triggers = [];
        if (c.surface_pressure != null && c.surface_pressure < 1005) triggers.push(`🤕 Low pressure (${Math.round(c.surface_pressure)} hPa) — migraine risk elevated`);
        if (c.relative_humidity_2m > 75) triggers.push(`💧 High humidity (${c.relative_humidity_2m}%) — respiratory discomfort`);
        if (c.uv_index > 7) triggers.push(`☀️ High UV index (${c.uv_index}) — sunburn in <15 min`);
        const pollenVals = h ? ['grass_pollen','ragweed_pollen','birch_pollen'].map(k => h[k]?.[0]||0) : [];
        const maxPollen = Math.max(...pollenVals, 0);
        if (maxPollen > 50) triggers.push(`🌿 High pollen count (${Math.round(maxPollen)}) — allergy risk`);
        el.innerHTML = triggers.length
          ? triggers.map(t => `<div style="padding:4px 0;border-bottom:1px solid var(--bdr)">${t}</div>`).join('')
          : '<span style="color:#22c55e">✓ No significant health triggers detected</span>';
      }).catch(()=>{});

    } catch(e) {
      body.innerHTML = `<div class="pp-info-box pp-info-error">Ag data error: ${_esc(e.message)}</div>`;
    }
  }

  // ── CUSTOM ALERTS TAB ──────────────────────────────────────────
  function loadCustomAlertsTab(body, lat, lng) {
    const saved = JSON.parse(localStorage.getItem('ss_custom_alerts') || '[]');

    const renderAlerts = (alerts) => `
      <div class="pp-section">
        <div class="pp-section-title">⚡ Custom Alert Logic</div>
        <div style="font-size:.75rem;color:var(--t3);margin-bottom:8px">
          Set compound triggers: e.g. "Alert when wind gusts > 40mph AND lightning within 10mi"
        </div>
        <div id="alertList">
          ${alerts.length ? alerts.map((a, i) => `
            <div class="pp-alert-rule">
              <span class="pp-alert-field">${_esc(a.field)}</span>
              <span class="pp-alert-op">${_esc(a.op)}</span>
              <span class="pp-alert-val">${_esc(a.value)}</span>
              <span class="pp-alert-label">${_esc(a.label||'')}</span>
              <button class="pp-alert-del" data-i="${i}">✕</button>
            </div>
          `).join('') : '<div style="color:var(--t3);font-size:.78rem">No alerts configured</div>'}
        </div>
        <div class="pp-alert-add-row">
          <select id="alertField" class="pp-select" style="flex:1.5">
            <option value="wind_gusts_10m">Wind Gusts (m/s)</option>
            <option value="wind_speed_10m">Wind Speed (m/s)</option>
            <option value="temperature_2m">Temperature (°C)</option>
            <option value="apparent_temperature">Feels Like (°C)</option>
            <option value="precipitation">Precipitation (mm)</option>
            <option value="relative_humidity_2m">Humidity (%)</option>
            <option value="surface_pressure">Pressure (hPa)</option>
            <option value="visibility">Visibility (m)</option>
          </select>
          <select id="alertOp" class="pp-select" style="flex:.6">
            <option value=">">></option>
            <option value=">=">>=</option>
            <option value="<"><</option>
            <option value="<="><=</option>
          </select>
          <input id="alertVal" class="pp-input" type="number" placeholder="Value" style="flex:.8" />
          <input id="alertLabel" class="pp-input" type="text" placeholder="Alert name" style="flex:1.5" />
          <button id="alertAdd" class="pp-btn pp-btn-primary">Add</button>
        </div>
        <button id="alertCheck" class="pp-btn pp-btn-primary" style="width:100%;margin-top:8px">
          🔍 Check All Conditions Now
        </button>
        <div id="alertResult" style="margin-top:8px"></div>
      </div>
    `;

    body.innerHTML = renderAlerts(saved);

    const rebind = () => {
      document.querySelectorAll('.pp-alert-del').forEach(btn => {
        btn.addEventListener('click', () => {
          const alerts = JSON.parse(localStorage.getItem('ss_custom_alerts') || '[]');
          alerts.splice(+btn.dataset.i, 1);
          localStorage.setItem('ss_custom_alerts', JSON.stringify(alerts));
          body.innerHTML = renderAlerts(alerts); rebind();
        });
      });

      document.getElementById('alertAdd')?.addEventListener('click', () => {
        const field = document.getElementById('alertField')?.value;
        const op    = document.getElementById('alertOp')?.value;
        const value = document.getElementById('alertVal')?.value;
        const label = document.getElementById('alertLabel')?.value || `${field} ${op} ${value}`;
        if (!field || !value) return;
        const alerts = JSON.parse(localStorage.getItem('ss_custom_alerts') || '[]');
        alerts.push({ field, op, value: parseFloat(value), label });
        localStorage.setItem('ss_custom_alerts', JSON.stringify(alerts));
        body.innerHTML = renderAlerts(alerts); rebind();
      });

      document.getElementById('alertCheck')?.addEventListener('click', async () => {
        const alerts = JSON.parse(localStorage.getItem('ss_custom_alerts') || '[]');
        const resultEl = document.getElementById('alertResult');
        if (!resultEl) return;
        resultEl.innerHTML = '<div class="pp-loading">Checking conditions…</div>';
        try {
          const conds = encodeURIComponent(JSON.stringify(alerts));
          const r = await fetch(`${API()}/api/alerts/custom?lat=${lat}&lng=${lng}&conditions=${conds}`);
          const d = await r.json();
          if (d.triggered?.length) {
            resultEl.innerHTML = `
              <div class="pp-info-box pp-info-error">
                ⚠ ${d.triggered.length} condition(s) triggered:
                ${d.triggered.map(t => `<div style="margin-top:4px">• ${_esc(t.label)}: current=${_esc(t.current)}</div>`).join('')}
              </div>`;
          } else {
            resultEl.innerHTML = `<div class="pp-info-box pp-info-success">✓ No conditions triggered (checked ${d.conditions_checked} rules)</div>`;
          }
        } catch(e) {
          resultEl.innerHTML = `<div class="pp-info-box pp-info-error">Error: ${_esc(e.message)}</div>`;
        }
      });
    };
    rebind();
  }

  // ── PUBLIC API ─────────────────────────────────────────────────
  return {
    init() { /* lazy build */ },

    open(tab) {
      if (!_panel) _panel = _build();
      _open = true;
      _panel.style.display = 'flex';
      if (tab) {
        _tab = tab;
        const btn = _panel.querySelector(`.pp-tab[data-t="${tab}"]`);
        if (btn) { _panel.querySelectorAll('.pp-tab').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
      }
      loadTab(_tab);
    },

    close() {
      _open = false;
      if (_panel) _panel.style.display = 'none';
    },

    toggle(tab) { _open ? this.close() : this.open(tab); return _open; },
    isOpen() { return _open; },
  };
})();
