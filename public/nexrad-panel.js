// ================================================================
//  STORM SURGE WEATHER — NEXRAD Panel UI v13.7
//  Depends on: window.NexradRadar (nexrad.js)
// ================================================================
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  let _stationCache = [];
  let _nearbyCache  = [];
  let _apiBase = '';
  let _lastLat = null, _lastLng = null;

  const PRODUCTS = {
    N0Q: { label: 'Reflectivity',       emoji: '🌧', unit: 'dBZ' },
    N0U: { label: 'Velocity',           emoji: '💨', unit: 'm/s' },
    N0C: { label: 'Corr. Coefficient',  emoji: '🌪', unit: 'CC'  },
    N0X: { label: 'Diff. Reflectivity', emoji: '📡', unit: 'dB'  },
    EET: { label: 'Echo Tops',          emoji: '⬆',  unit: 'kft' },
    DAA: { label: 'Precip Accum.',      emoji: '💧', unit: 'in'  }
  };

  const state = { open: false, product: 'N0Q', stationId: null, opacity: 0.85 };

  const LEGENDS = {
    N0Q: { label: 'Reflectivity (dBZ)',          gradient: 'linear-gradient(to right,#555 0%,#04e9e7 15%,#019ff4 30%,#02fd02 45%,#fdf802 60%,#fd9500 75%,#fd0000 90%,#bc0000 100%)', scale: ['-30','0','20','40','60','75+'] },
    N0U: { label: 'Radial Velocity (m/s)',        gradient: 'linear-gradient(to right,#0000ff 0%,#00aaff 25%,#888 50%,#ff5500 75%,#ff0000 100%)',                                    scale: ['-64','-32','0','+32','+64'] },
    N0C: { label: 'Correlation Coefficient',      gradient: 'linear-gradient(to right,#222 0%,#663399 30%,#00aaff 60%,#00ff00 80%,#fff 100%)',                                      scale: ['0','0.2','0.5','0.8','1.0'] },
    N0X: { label: 'Differential Reflectivity (dB)', gradient: 'linear-gradient(to right,#0000aa 0%,#00aaff 35%,#00ff00 60%,#ffff00 80%,#ff0000 100%)',                             scale: ['-8','-4','0','+4','+8'] },
    EET: { label: 'Echo Tops (kft)',              gradient: 'linear-gradient(to right,#000033 0%,#003388 25%,#00aaff 50%,#ffff00 75%,#ff0000 100%)',                                scale: ['0','10','30','50','70+'] },
    DAA: { label: 'Precip Accumulation (in)',     gradient: 'linear-gradient(to right,#fff 0%,#aaddff 20%,#0066ff 50%,#005500 75%,#ffff00 100%)',                                  scale: ['0','0.1','0.5','1','2+'] }
  };

  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'nexradPanel';
    panel.className = 'nexrad-panel';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-label','NEXRAD Single-Site Radar');
    panel.innerHTML = `
      <div class="np-header">
        <span class="np-title">📡 NEXRAD Radar</span>
        <button class="np-close" id="npClose" aria-label="Close">✕</button>
      </div>
      <div class="np-section">
        <div class="np-label">STATION</div>
        <div class="np-station-row">
          <div class="np-station-info">
            <span class="np-sta-id" id="npStaId">—</span>
            <span class="np-sta-name" id="npStaName">No station selected</span>
            <span class="np-sta-type" id="npStaType"></span>
            <span class="np-sta-dist" id="npStaDist"></span>
          </div>
          <button class="np-btn np-btn-sm" id="npNearestBtn">📍 Nearest</button>
        </div>
        <div class="np-search-row">
          <input class="np-input" id="npStaSearch" type="text" placeholder="Search station ID or name…" autocomplete="off" spellcheck="false">
        </div>
        <div class="np-sta-list" id="npStaList"></div>
      </div>
      <div class="np-section">
        <div class="np-label">PRODUCT</div>
        <div class="np-products" id="npProducts">
          ${Object.entries(PRODUCTS).map(([k,p])=>`
            <button class="np-prod-btn${k==='N0Q'?' active':''}" data-product="${k}" title="${p.label} (${p.unit})">
              <span class="np-prod-emoji">${p.emoji}</span>
              <span class="np-prod-label">${p.label}</span>
              <span class="np-prod-unit">${p.unit}</span>
            </button>`).join('')}
        </div>
      </div>
      <div class="np-section">
        <div class="np-label">OPACITY</div>
        <div class="np-opacity-row">
          <input type="range" class="np-slider" id="npOpacity" min="20" max="100" value="85">
          <span class="np-opacity-val" id="npOpacityVal">85%</span>
        </div>
      </div>
      <div class="np-section">
        <div class="np-actions">
          <button class="np-btn np-btn-primary" id="npToggleBtn">▶ Show Radar</button>
          <button class="np-btn" id="npRefreshBtn">↻ Refresh</button>
          <button class="np-btn np-btn-danger" id="npHideBtn">✕ Hide</button>
        </div>
      </div>
      <div class="np-section np-legend">
        <div class="np-label">LEGEND — <span id="npLegendProduct">Reflectivity (dBZ)</span></div>
        <div class="np-legend-bar" id="npLegendBar"></div>
        <div class="np-legend-scale" id="npLegScale"></div>
      </div>
      <div class="np-footer">Data: Iowa State IEM · NWS WSR-88D / TDWR<br>Refreshes every ~5 min with radar scan</div>
    `;
    document.body.appendChild(panel);
  }

  function updateLegend(product) {
    const cfg   = LEGENDS[product] || LEGENDS.N0Q;
    const bar   = $('npLegendBar');
    const scale = $('npLegScale');
    const lbl   = $('npLegendProduct');
    if (lbl)   lbl.textContent      = cfg.label;
    if (bar)   bar.style.background = cfg.gradient;
    if (scale) scale.innerHTML      = cfg.scale.map(v=>`<span>${v}</span>`).join('');
  }

  function renderStationList(stations) {
    const list = $('npStaList');
    if (!list) return;
    if (!stations.length) { list.innerHTML = '<div class="np-sta-empty">No stations found</div>'; return; }
    list.innerHTML = stations.slice(0,20).map(s=>`
      <div class="np-sta-item${state.stationId===s.id?' active':''}" data-id="${escHtml(s.id)}"
           data-lat="${s.lat}" data-lng="${s.lng}" data-name="${escHtml(s.name)}" data-type="${escHtml(s.type||'WSR-88D')}"
           role="button" tabindex="0">
        <span class="np-si-id">${escHtml(s.id)}</span>
        <span class="np-si-name">${escHtml(s.name)}</span>
        <span class="np-si-type ${(s.type||'').includes('TDWR')?'tdwr':'wsr'}">${escHtml(s.type||'WSR-88D')}</span>
        ${s.distKm!=null?`<span class="np-si-dist">${s.distKm} km</span>`:''}
      </div>`).join('');
    list.querySelectorAll('.np-sta-item').forEach(item => {
      const go = () => selectStation(item.dataset.id, {
        id: item.dataset.id, name: item.dataset.name,
        lat: parseFloat(item.dataset.lat), lng: parseFloat(item.dataset.lng), type: item.dataset.type
      });
      item.addEventListener('click', go);
      item.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') go(); });
    });
  }

  function selectStation(id, meta) {
    state.stationId = id;
    const idEl=$('npStaId'), nameEl=$('npStaName'), typeEl=$('npStaType');
    if (idEl)   idEl.textContent   = id;
    if (nameEl) nameEl.textContent = meta.name || id;
    if (typeEl) typeEl.textContent = meta.type || 'WSR-88D';
    document.querySelectorAll('.np-sta-item').forEach(el => el.classList.toggle('active', el.dataset.id===id));
    if (window.NexradRadar?.isVisible()) {
      NexradRadar.show(id, state.product, meta);
      updateToggleBtn(true);
    }
  }

  function updateToggleBtn(visible) {
    const btn = $('npToggleBtn');
    if (!btn) return;
    btn.textContent = visible ? '⏹ Hide Radar' : '▶ Show Radar';
    btn.classList.toggle('np-btn-active', visible);
  }

  let _searchTimer = null;
  async function handleSearch(q) {
    q = (q||'').trim().toUpperCase();
    if (!q) { renderStationList(_nearbyCache); return; }
    const filtered = _stationCache.filter(s => s.id.includes(q) || s.name.toUpperCase().includes(q));
    renderStationList(filtered);
    if (!_stationCache.length) {
      const list = $('npStaList');
      if (list) list.innerHTML = '<div class="np-sta-empty">Loading stations…</div>';
      await fetchAllStations();
      renderStationList(_stationCache.filter(s => s.id.includes(q) || s.name.toUpperCase().includes(q)));
    }
  }

  async function fetchAllStations() {
    if (_stationCache.length) return;
    try {
      const r = await fetch(`${_apiBase}/api/nexrad/stations`);
      if (!r.ok) throw new Error('HTTP '+r.status);
      _stationCache = (await r.json()).stations || [];
    } catch (e) { console.warn('[NexradPanel] fetchAllStations:', e.message); }
  }

  async function loadNearby(lat, lng) {
    _lastLat = lat; _lastLng = lng;
    try {
      const r = await fetch(`${_apiBase}/api/nexrad/nearest?lat=${lat}&lng=${lng}&n=8`);
      if (!r.ok) throw new Error('HTTP '+r.status);
      _nearbyCache = (await r.json()).stations || [];
      renderStationList(_nearbyCache);
      const distEl = $('npStaDist');
      if (distEl && _nearbyCache.length) distEl.textContent = _nearbyCache[0].distKm + ' km away';
    } catch (e) { console.warn('[NexradPanel] loadNearby:', e.message); }
  }

  function bindEvents() {
    $('npClose')?.addEventListener('click', closePanel);

    $('npNearestBtn')?.addEventListener('click', async () => {
      if (_lastLat==null) return;
      const btn = $('npNearestBtn');
      btn.textContent='⏳ Finding…'; btn.disabled=true;
      const st = await NexradRadar.loadNearestStation(_lastLat, _lastLng);
      btn.textContent='📍 Nearest'; btn.disabled=false;
      if (st) { selectStation(st.id, st); updateToggleBtn(true); loadNearby(_lastLat, _lastLng); }
    });

    $('npStaSearch')?.addEventListener('input', e => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => handleSearch(e.target.value), 200);
    });

    $('npProducts')?.addEventListener('click', e => {
      const btn = e.target.closest('.np-prod-btn'); if (!btn) return;
      const product = btn.dataset.product;
      state.product = product;
      document.querySelectorAll('.np-prod-btn').forEach(b => b.classList.toggle('active', b.dataset.product===product));
      updateLegend(product);
      if (window.NexradRadar) NexradRadar.setProduct(product);
    });

    $('npOpacity')?.addEventListener('input', e => {
      const pct = +e.target.value;
      state.opacity = pct/100;
      const val = $('npOpacityVal'); if (val) val.textContent = pct+'%';
      if (window.NexradRadar) NexradRadar.setOpacity(state.opacity);
    });

    $('npToggleBtn')?.addEventListener('click', () => {
      if (!window.NexradRadar) return;
      if (NexradRadar.isVisible()) { NexradRadar.hide(); updateToggleBtn(false); }
      else {
        if (!state.stationId) return;
        const meta = _nearbyCache.find(s=>s.id===state.stationId) || _stationCache.find(s=>s.id===state.stationId) || { id: state.stationId, name: state.stationId, lat:0, lng:0 };
        NexradRadar.show(state.stationId, state.product, meta);
        updateToggleBtn(true);
      }
    });

    $('npRefreshBtn')?.addEventListener('click', () => { if (window.NexradRadar) NexradRadar.refresh(); });
    $('npHideBtn')?.addEventListener('click',    () => { if (window.NexradRadar) NexradRadar.hide(); updateToggleBtn(false); });
  }

  function openPanel()  { const p=$('nexradPanel'); if(p) p.classList.add('open');    state.open=true;  }
  function closePanel() { const p=$('nexradPanel'); if(p) p.classList.remove('open'); state.open=false; }
  function togglePanel(){ state.open ? closePanel() : openPanel(); }

  window.NexradPanel = {
    init(apiBase) {
      _apiBase = (apiBase||'').replace(/\/$/,'');
      buildPanel();
      bindEvents();
      updateLegend('N0Q');
      if (window.NexradRadar) {
        NexradRadar.onStationChange = st => {
          state.stationId = st.id;
          const idEl=$('npStaId'), nameEl=$('npStaName'), typeEl=$('npStaType'), distEl=$('npStaDist');
          if(idEl)   idEl.textContent   = st.id;
          if(nameEl) nameEl.textContent = st.name||st.id;
          if(typeEl) typeEl.textContent = st.type||'WSR-88D';
          if(distEl) distEl.textContent = st.distKm!=null ? st.distKm+' km away' : '';
          document.querySelectorAll('.np-sta-item').forEach(el=>el.classList.toggle('active',el.dataset.id===st.id));
          updateToggleBtn(true);
        };
        NexradRadar.onProductChange = product => {
          state.product = product;
          document.querySelectorAll('.np-prod-btn').forEach(b=>b.classList.toggle('active',b.dataset.product===product));
          updateLegend(product);
        };
      }
    },
    open: openPanel, close: closePanel, toggle: togglePanel,
    isOpen: () => state.open,
    updateLocation(lat,lng) { _lastLat=lat; _lastLng=lng; if(state.open) loadNearby(lat,lng); },
    preloadNearby(lat,lng)  { _lastLat=lat; _lastLng=lng; loadNearby(lat,lng); }
  };
})();
