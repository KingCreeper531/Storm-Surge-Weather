// ================================================================
//  SEVERE ANALYSIS PANEL  v13.8
//  Shows CAPE, LI, gusts, risk tags for next 48h
// ================================================================

window.SeverePanel = (() => {
  'use strict';

  let _api = '';
  let _open = false;
  let _panel = null;
  let _data = null;

  function init(apiBase) {
    _api = apiBase;
    buildPanel();
  }

  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = `
      .severe-panel {
        position: fixed;
        top: 60px;
        right: var(--rw, 340px);
        width: 300px;
        max-height: calc(100vh - 80px);
        background: var(--bg1,#0f1117);
        border: 1px solid rgba(239,68,68,0.3);
        border-radius: 14px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        z-index: 900;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transform: translateX(calc(100% + 20px));
        transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
        font-family: 'Outfit', sans-serif;
      }
      .severe-panel.open {
        transform: translateX(0);
      }
      .sev-head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px 8px;
        border-bottom: 1px solid rgba(255,255,255,0.07);
        flex-shrink: 0;
      }
      .sev-head-title {
        font-size: .82rem;
        font-weight: 700;
        letter-spacing: .06em;
        color: #ef4444;
        text-transform: uppercase;
        flex: 1;
      }
      .sev-close {
        background: none;
        border: none;
        color: var(--t3,#9ca3af);
        cursor: pointer;
        font-size: 1rem;
        padding: 2px 6px;
      }
      .sev-close:hover { color: #fff; }
      .sev-body {
        flex: 1;
        overflow-y: auto;
        padding: 10px 14px;
      }
      .sev-body::-webkit-scrollbar { width: 4px; }
      .sev-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      .sev-stat-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 12px;
      }
      .sev-stat {
        background: rgba(255,255,255,0.05);
        border-radius: 10px;
        padding: 8px 10px;
        border: 1px solid rgba(255,255,255,0.08);
      }
      .sev-stat-label {
        font-size: .68rem;
        color: var(--t3,#9ca3af);
        text-transform: uppercase;
        letter-spacing: .06em;
        margin-bottom: 3px;
      }
      .sev-stat-val {
        font-size: 1.1rem;
        font-weight: 700;
        color: var(--t1,#f1f5f9);
      }
      .sev-section-title {
        font-size: .72rem;
        font-weight: 700;
        letter-spacing: .08em;
        color: var(--t3,#9ca3af);
        text-transform: uppercase;
        margin: 10px 0 6px;
      }
      .sev-tag {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 8px;
        margin-bottom: 5px;
        font-size: .8rem;
      }
      .sev-tag.high    { background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.25); color: #fca5a5; }
      .sev-tag.moderate{ background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.2); color: #fcd34d; }
      .sev-tag.low     { background: rgba(34,197,94,0.1);  border: 1px solid rgba(34,197,94,0.18); color: #86efac; }
      .sev-peak-row {
        background: rgba(255,255,255,0.04);
        border-radius: 8px;
        padding: 7px 10px;
        margin-bottom: 5px;
        border-left: 3px solid #ef4444;
        font-size: .78rem;
      }
      .sev-peak-time {
        font-size: .7rem;
        color: var(--t3,#9ca3af);
        margin-bottom: 3px;
      }
      .sev-peak-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
      }
      .sev-peak-tag {
        font-size: .68rem;
        padding: 2px 7px;
        border-radius: 10px;
        background: rgba(239,68,68,0.2);
        color: #fca5a5;
      }
      .sev-loading {
        text-align: center;
        padding: 20px;
        color: var(--t3,#9ca3af);
        font-size: .8rem;
      }
      .sev-refresh-btn {
        margin: 8px 0 0;
        width: 100%;
        padding: 7px;
        background: rgba(239,68,68,0.1);
        border: 1px solid rgba(239,68,68,0.2);
        color: #fca5a5;
        border-radius: 8px;
        font-size: .78rem;
        font-family: 'Outfit', sans-serif;
        cursor: pointer;
        transition: background 0.15s;
      }
      .sev-refresh-btn:hover { background: rgba(239,68,68,0.2); }
      @media (max-width: 768px) {
        .severe-panel {
          right: 0;
          width: 100%;
          max-width: 100%;
          border-radius: 14px 14px 0 0;
          top: auto;
          bottom: 50px;
          max-height: 60vh;
          transform: translateY(100%);
        }
        .severe-panel.open { transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);

    _panel = document.createElement('div');
    _panel.className = 'severe-panel';
    _panel.innerHTML = `
      <div class="sev-head">
        <div class="sev-head-title">⚡ Severe Analysis</div>
        <button class="sev-close" id="sevClose">✕</button>
      </div>
      <div class="sev-body" id="sevBody">
        <div class="sev-loading">Loading analysis…</div>
      </div>
    `;
    document.body.appendChild(_panel);
    document.getElementById('sevClose').onclick = close;
  }

  function open() {
    _open = true;
    _panel.classList.add('open');
  }

  function close() {
    _open = false;
    _panel.classList.remove('open');
  }

  function toggle() { _open ? close() : open(); }
  function isOpen() { return _open; }

  async function load(lat, lng) {
    const body = document.getElementById('sevBody');
    if (!body) return;
    body.innerHTML = '<div class="sev-loading">⚡ Analyzing forecast data…</div>';
    if (!_open) open();
    try {
      const r = await fetch(`${_api}/api/severe-analysis?lat=${lat}&lng=${lng}`);
      const d = await r.json();
      _data = d;
      render(d, lat, lng);
    } catch (e) {
      body.innerHTML = '<div class="sev-loading">⚠️ Analysis unavailable</div>';
    }
  }

  function capeColor(cape) {
    if (cape >= 2000) return '#ef4444';
    if (cape >= 1000) return '#f97316';
    if (cape >= 500)  return '#f59e0b';
    return '#22c55e';
  }

  function render(d, lat, lng) {
    const body = document.getElementById('sevBody');
    if (!body) return;

    // Overall tag dedupe
    const allTags = [];
    if (d.peakHours) {
      d.peakHours.forEach(h => h.tags?.forEach(t => {
        if (!allTags.find(x => x.tag === t.tag)) allTags.push(t);
      }));
    }

    let html = `
      <div class="sev-stat-grid">
        <div class="sev-stat">
          <div class="sev-stat-label">Max CAPE (48h)</div>
          <div class="sev-stat-val" style="color:${capeColor(d.maxCape)}">${d.maxCape || 0} <span style="font-size:.7rem;font-weight:400">J/kg</span></div>
        </div>
        <div class="sev-stat">
          <div class="sev-stat-label">Max Gust</div>
          <div class="sev-stat-val">${d.maxGustMph || 0} <span style="font-size:.7rem;font-weight:400">mph</span></div>
        </div>
      </div>
    `;

    if (allTags.length > 0) {
      html += '<div class="sev-section-title">Risk Tags</div>';
      allTags.forEach(t => {
        html += `<div class="sev-tag ${t.level || 'low'}"><span>${t.icon || '⚠️'}</span> ${t.tag}</div>`;
      });
    } else {
      html += '<div class="sev-tag low">✅ No significant severe risk in forecast</div>';
    }

    if (d.peakHours?.length > 0) {
      html += '<div class="sev-section-title">Peak Risk Hours</div>';
      d.peakHours.slice(0, 4).forEach(h => {
        const dt = new Date(h.time);
        const timeStr = dt.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) + ' ' +
          dt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
        html += `
          <div class="sev-peak-row">
            <div class="sev-peak-time">${timeStr}</div>
            <div>CAPE <strong style="color:${capeColor(h.cape)}">${Math.round(h.cape||0)}</strong> J/kg · Gust <strong>${Math.round((h.gustMs||0)*2.237)}</strong> mph</div>
            <div class="sev-peak-tags">
              ${(h.tags||[]).map(t=>`<span class="sev-peak-tag">${t.icon||''} ${t.tag}</span>`).join('')}
            </div>
          </div>
        `;
      });
    }

    html += `<button class="sev-refresh-btn" onclick="if(window.SeverePanel)SeverePanel.load(${lat},${lng})">↻ Refresh Analysis</button>`;
    body.innerHTML = html;
  }

  function getData() { return _data; }

  return { init, open, close, toggle, isOpen, load, getData };
})();
