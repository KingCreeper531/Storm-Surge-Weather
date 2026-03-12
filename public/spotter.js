// ================================================================
//  SPOTTER NETWORK OVERLAY  v13.8
//  mPing + SPC/NWS Local Storm Reports on the map
// ================================================================

window.SpotterNetwork = (() => {
  'use strict';

  let _map = null;
  let _api = '';
  let _visible = false;
  let _reports = [];
  let _refreshTimer = null;
  let _markers = [];   // mapboxgl.Marker instances
  let _popup = null;

  const REFRESH_MS = 5 * 60 * 1000; // 5 min

  // Icon colours by type
  const TYPE_COLORS = {
    'Tornado':       '#ef4444',
    'Funnel Cloud':  '#f97316',
    'Hail':          '#06b6d4',
    'Wind':          '#a855f7',
    'High Wind':     '#a855f7',
    'Rain':          '#3b82f6',
    'Flash Flood':   '#1d4ed8',
    'Thunderstorm':  '#eab308',
    'Lightning':     '#facc15',
    'Snow':          '#e0f2fe',
    'Blizzard':      '#bfdbfe',
    'Ice Pellets/Sleet': '#67e8f9',
    'Freezing Rain': '#a5f3fc',
    'Fog':           '#94a3b8',
    'Dense Fog':     '#64748b',
    'Dust Storm':    '#d97706',
  };

  function init(map, apiBase) {
    _map = map;
    _api = apiBase;
  }

  function colorFor(type) {
    return TYPE_COLORS[type] || '#94a3b8';
  }

  function show(lat, lng) {
    _visible = true;
    loadReports(lat, lng);
    clearInterval(_refreshTimer);
    _refreshTimer = setInterval(() => loadReports(lat, lng), REFRESH_MS);
  }

  function hide() {
    _visible = false;
    clearInterval(_refreshTimer);
    clearMarkers();
  }

  function toggle(lat, lng) {
    _visible ? hide() : show(lat, lng);
    return _visible;
  }

  function isVisible() { return _visible; }
  function getReports() { return _reports; }

  function clearMarkers() {
    _markers.forEach(m => m.remove());
    _markers = [];
    if (_popup) { _popup.remove(); _popup = null; }
  }

  async function loadReports(lat, lng) {
    if (!_map) return;
    try {
      const url = `${_api}/api/spotter-reports?lat=${lat}&lng=${lng}&dist=500`;
      const r = await fetch(url);
      const d = await r.json();
      _reports = d.reports || [];
      renderMarkers();
      // Notify any listeners
      if (window.SpotterNetwork.onUpdate) window.SpotterNetwork.onUpdate(_reports);
    } catch (e) {
      console.warn('Spotter fetch failed:', e.message);
    }
  }

  function renderMarkers() {
    if (!_map || !_visible) return;
    clearMarkers();
    _reports.forEach(report => {
      if (!report.lat || !report.lng) return;
      const color = colorFor(report.type);
      const el = document.createElement('div');
      el.style.cssText = [
        `width:${report.verified ? '18' : '14'}px`,
        `height:${report.verified ? '18' : '14'}px`,
        `background:${color}`,
        'border-radius:50%',
        `border:${report.verified ? '2.5px solid #fff' : '1.5px solid rgba(255,255,255,0.5)'}`,
        'cursor:pointer',
        'transition:transform 0.15s',
        `box-shadow:0 0 ${report.verified ? '8' : '4'}px ${color}88`
      ].join(';');
      el.title = `${report.icon || '📍'} ${report.type} — ${report.city || ''}, ${report.state || ''}`;
      el.onmouseenter = () => { el.style.transform = 'scale(1.4)'; };
      el.onmouseleave = () => { el.style.transform = 'scale(1)'; };
      el.onclick = (e) => {
        e.stopPropagation();
        showPopup(report);
      };
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([report.lng, report.lat])
        .addTo(_map);
      _markers.push(marker);
    });
  }

  function showPopup(report) {
    if (_popup) _popup.remove();
    const time = report.ts ? new Date(report.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    const color = colorFor(report.type);
    const html = `
      <div style="font-family:'Outfit',sans-serif;min-width:200px;max-width:280px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:1.4rem">${report.icon || '📍'}</span>
          <div>
            <div style="font-weight:700;font-size:.9rem;color:${color}">${report.type}</div>
            <div style="font-size:.72rem;color:#94a3b8">${report.source} · ${time}</div>
          </div>
        </div>
        ${report.city || report.state ? `<div style="font-size:.78rem;color:#94a3b8;margin-bottom:6px">📍 ${[report.city,report.state].filter(Boolean).join(', ')}</div>` : ''}
        ${report.magnitude ? `<div style="font-size:.78rem;background:rgba(255,255,255,.07);padding:3px 8px;border-radius:6px;display:inline-block;margin-bottom:6px">${report.type === 'Hail' ? '🧭 Size: ' : '💨 '}${report.magnitude}</div>` : ''}
        ${report.description ? `<div style="font-size:.8rem;color:#e2e8f0;line-height:1.45">${report.description}</div>` : ''}
        ${report.comments ? `<div style="font-size:.75rem;color:#94a3b8;margin-top:5px;font-style:italic">${report.comments}</div>` : ''}
        ${report.distKm ? `<div style="font-size:.7rem;color:#64748b;margin-top:6px">${report.distKm} km from your location</div>` : ''}
        ${report.verified ? '<div style="font-size:.7rem;color:#22c55e;margin-top:4px">✓ NWS Verified Report</div>' : '<div style="font-size:.7rem;color:#94a3b8;margin-top:4px">Community Report (mPing)</div>'}
      </div>
    `;
    _popup = new mapboxgl.Popup({ closeButton: true, maxWidth: '300px', className: 'spotter-popup' })
      .setLngLat([report.lng, report.lat])
      .setHTML(html)
      .addTo(_map);
  }

  function refresh(lat, lng) {
    if (_visible) loadReports(lat, lng);
  }

  function getSummary() {
    if (!_reports.length) return 'No spotter reports in range.';
    const counts = {};
    _reports.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
    return Object.entries(counts).map(([t,n]) => `${n}x ${t}`).join(', ');
  }

  return { init, show, hide, toggle, isVisible, refresh, loadReports, getReports, getSummary };
})();
