// ================================================================
//  STORM SURGE AI PANEL  v13.8
//  Collapsible chat panel — sits below the radar map
//  Sends weather context + asks Claude for analysis
// ================================================================

window.AIPanel = (() => {
  'use strict';

  let _api = '';
  let _open = false;
  let _messages = [];       // { role: 'user'|'assistant', text, ts }
  let _loading  = false;
  let _contextFn = null;   // callback → returns live weather context

  // ── DOM refs ─────────────────────────────────────────────────────
  let panel, messagesEl, inputEl, sendBtn, toggleBtn, clearBtn, statusEl;

  // ── Quick prompts ─────────────────────────────────────────────────
  const QUICK_PROMPTS = [
    'Is there a tornado risk in this area right now?',
    'What should I know about today's severe weather?',
    'Is it comfortable for outdoor activities this week?',
    'Summarize active weather alerts for my location',
    'What are the wind conditions like today?',
    'Any flooding concerns in the forecast?',
  ];

  function init(apiBase, contextCallback) {
    _api = apiBase;
    _contextFn = contextCallback;
    buildPanel();
  }

  function buildPanel() {
    // Inject styles
    if (!document.getElementById('ai-panel-styles')) {
      const style = document.createElement('style');
      style.id = 'ai-panel-styles';
      style.textContent = `
        #ai-panel-wrap {
          position: fixed;
          bottom: 0; left: 0; right: 0;
          z-index: 1100;
          pointer-events: none;
        }
        #ai-panel {
          pointer-events: all;
          background: var(--bg1, #0f1117);
          border-top: 1px solid rgba(6,182,212,0.25);
          box-shadow: 0 -4px 32px rgba(0,0,0,0.6);
          transition: transform 0.3s cubic-bezier(0.4,0,0.2,1), height 0.3s;
          display: flex;
          flex-direction: column;
          height: 0;
          overflow: hidden;
        }
        #ai-panel.open {
          height: 340px;
        }
        #ai-panel-tab {
          pointer-events: all;
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(135deg, #0e7490, #0284c7);
          color: #fff;
          border: none;
          border-radius: 12px 12px 0 0;
          padding: 6px 22px;
          font-size: .78rem;
          font-weight: 700;
          font-family: 'Outfit', sans-serif;
          cursor: pointer;
          letter-spacing: .05em;
          display: flex;
          align-items: center;
          gap: 7px;
          transition: background 0.2s, bottom 0.3s;
          white-space: nowrap;
          z-index: 1101;
          box-shadow: 0 -2px 16px rgba(6,182,212,0.3);
        }
        #ai-panel-tab.open {
          bottom: 340px;
        }
        #ai-panel-tab .ai-tab-dot {
          width: 7px; height: 7px;
          background: #4ade80;
          border-radius: 50%;
          animation: aipulse 2s infinite;
        }
        #ai-panel-tab .ai-tab-dot.loading {
          background: #f59e0b;
          animation: aipulse 0.5s infinite;
        }
        @keyframes aipulse {
          0%,100%{opacity:1;transform:scale(1)}
          50%{opacity:.5;transform:scale(1.3)}
        }
        .ai-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px 6px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          flex-shrink: 0;
        }
        .ai-header-title {
          font-size: .82rem;
          font-weight: 700;
          color: #06b6d4;
          letter-spacing: .06em;
          text-transform: uppercase;
          flex: 1;
        }
        .ai-header-status {
          font-size: .7rem;
          color: var(--t3, #9ca3af);
        }
        .ai-clear-btn {
          background: none;
          border: none;
          color: var(--t3, #9ca3af);
          cursor: pointer;
          font-size: .75rem;
          padding: 3px 8px;
          border-radius: 6px;
          transition: background 0.15s;
        }
        .ai-clear-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
        .ai-messages {
          flex: 1;
          overflow-y: auto;
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          scroll-behavior: smooth;
        }
        .ai-messages::-webkit-scrollbar { width: 4px; }
        .ai-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
        .ai-msg {
          max-width: 85%;
          padding: 8px 12px;
          border-radius: 12px;
          font-size: .82rem;
          line-height: 1.5;
          animation: aiMsgIn 0.2s ease;
        }
        @keyframes aiMsgIn {
          from{opacity:0;transform:translateY(6px)}
          to{opacity:1;transform:translateY(0)}
        }
        .ai-msg.user {
          align-self: flex-end;
          background: linear-gradient(135deg, #0e7490, #0284c7);
          color: #fff;
          border-bottom-right-radius: 4px;
        }
        .ai-msg.assistant {
          align-self: flex-start;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.1);
          color: var(--t1, #f1f5f9);
          border-bottom-left-radius: 4px;
        }
        .ai-msg.error {
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.25);
          color: #fca5a5;
          align-self: flex-start;
        }
        .ai-msg-time {
          font-size: .63rem;
          opacity: 0.5;
          margin-top: 3px;
        }
        .ai-thinking {
          display: flex;
          gap: 4px;
          align-items: center;
          padding: 10px 14px;
        }
        .ai-thinking span {
          width: 6px; height: 6px;
          background: #06b6d4;
          border-radius: 50%;
          animation: aibounce 1.2s infinite;
        }
        .ai-thinking span:nth-child(2){animation-delay:.15s}
        .ai-thinking span:nth-child(3){animation-delay:.3s}
        @keyframes aibounce{
          0%,80%,100%{transform:scale(0.7);opacity:.5}
          40%{transform:scale(1);opacity:1}
        }
        .ai-quick-prompts {
          display: flex;
          gap: 6px;
          padding: 0 14px 8px;
          overflow-x: auto;
          flex-shrink: 0;
        }
        .ai-quick-prompts::-webkit-scrollbar{display:none}
        .ai-qp-btn {
          background: rgba(6,182,212,0.1);
          border: 1px solid rgba(6,182,212,0.2);
          color: #67e8f9;
          border-radius: 16px;
          padding: 4px 10px;
          font-size: .72rem;
          font-family: 'Outfit', sans-serif;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s;
          flex-shrink: 0;
        }
        .ai-qp-btn:hover { background: rgba(6,182,212,0.2); }
        .ai-input-row {
          display: flex;
          gap: 8px;
          padding: 8px 14px 12px;
          border-top: 1px solid rgba(255,255,255,0.07);
          flex-shrink: 0;
        }
        .ai-input {
          flex: 1;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 10px;
          color: var(--t1, #f1f5f9);
          padding: 8px 12px;
          font-size: .82rem;
          font-family: 'Outfit', sans-serif;
          outline: none;
          transition: border-color 0.15s;
        }
        .ai-input:focus { border-color: rgba(6,182,212,0.5); }
        .ai-input::placeholder { color: var(--t3, #9ca3af); }
        .ai-send-btn {
          background: linear-gradient(135deg, #0e7490, #0284c7);
          border: none;
          border-radius: 10px;
          color: #fff;
          padding: 8px 16px;
          font-size: .8rem;
          font-weight: 700;
          font-family: 'Outfit', sans-serif;
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .ai-send-btn:disabled { opacity: 0.5; cursor: default; }
        .ai-send-btn:not(:disabled):hover { opacity: 0.85; }
        .ai-empty {
          text-align: center;
          padding: 20px;
          color: var(--t3, #9ca3af);
          font-size: .8rem;
        }
        .ai-empty .ai-empty-ico { font-size: 2rem; margin-bottom: 6px; }
        @media (max-width: 600px) {
          #ai-panel.open { height: 300px; }
          #ai-panel-tab.open { bottom: 300px; }
          .ai-msg { max-width: 95%; }
        }
      `;
      document.head.appendChild(style);
    }

    // Wrapper
    const wrap = document.createElement('div');
    wrap.id = 'ai-panel-wrap';

    // Tab button
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'ai-panel-tab';
    toggleBtn.innerHTML = '<span class="ai-tab-dot" id="aiDot"></span> ⚡ Storm Surge AI <span id="aiTabArrow">▲</span>';
    toggleBtn.onclick = toggle;
    wrap.appendChild(toggleBtn);

    // Panel
    panel = document.createElement('div');
    panel.id = 'ai-panel';
    panel.innerHTML = `
      <div class="ai-header">
        <div class="ai-header-title">🤖 Storm Surge AI Assistant</div>
        <div class="ai-header-status" id="aiStatus">Powered by Claude</div>
        <button class="ai-clear-btn" id="aiClearBtn">Clear</button>
      </div>
      <div class="ai-messages" id="aiMessages">
        <div class="ai-empty">
          <div class="ai-empty-ico">⚡</div>
          Ask about weather conditions, tornado risk, severe weather,<br>or whether it's safe to go outside!
        </div>
      </div>
      <div class="ai-quick-prompts" id="aiQuickPrompts"></div>
      <div class="ai-input-row">
        <input class="ai-input" id="aiInput" type="text" placeholder="Ask about weather, alerts, or severe analysis..." maxlength="500" autocomplete="off">
        <button class="ai-send-btn" id="aiSendBtn">Send</button>
      </div>
    `;
    wrap.appendChild(panel);
    document.body.appendChild(wrap);

    // Wire refs
    messagesEl = document.getElementById('aiMessages');
    inputEl    = document.getElementById('aiInput');
    sendBtn    = document.getElementById('aiSendBtn');
    statusEl   = document.getElementById('aiStatus');

    document.getElementById('aiClearBtn').onclick = clearChat;
    sendBtn.onclick = sendMessage;
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    // Quick prompts
    const qpEl = document.getElementById('aiQuickPrompts');
    QUICK_PROMPTS.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'ai-qp-btn';
      btn.textContent = p;
      btn.onclick = () => { inputEl.value = p; sendMessage(); };
      qpEl.appendChild(btn);
    });
  }

  function open() {
    _open = true;
    panel.classList.add('open');
    toggleBtn.classList.add('open');
    document.getElementById('aiTabArrow').textContent = '▼';
    setTimeout(() => inputEl?.focus(), 320);
  }

  function close() {
    _open = false;
    panel.classList.remove('open');
    toggleBtn.classList.remove('open');
    document.getElementById('aiTabArrow').textContent = '▲';
  }

  function toggle() { _open ? close() : open(); }
  function isOpen() { return _open; }

  function clearChat() {
    _messages = [];
    messagesEl.innerHTML = `<div class="ai-empty"><div class="ai-empty-ico">⚡</div>Ask about weather conditions, tornado risk, severe weather,<br>or whether it's safe to go outside!</div>`;
  }

  function appendMessage(role, text, error = false) {
    // Remove empty state
    messagesEl.querySelector('.ai-empty')?.remove();

    const div = document.createElement('div');
    div.className = 'ai-msg ' + (error ? 'error' : role);
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    // Convert markdown-lite: **bold**, *italic*, line breaks
    const html = text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
    div.innerHTML = html + `<div class="ai-msg-time">${timeStr}</div>`;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function showThinking() {
    const div = document.createElement('div');
    div.className = 'ai-thinking';
    div.id = 'aiThinking';
    div.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideThinking() {
    document.getElementById('aiThinking')?.remove();
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || _loading) return;
    inputEl.value = '';
    _loading = true;
    sendBtn.disabled = true;
    document.getElementById('aiDot').classList.add('loading');
    statusEl.textContent = 'Thinking...';

    appendMessage('user', text);
    showThinking();
    if (!_open) open();

    // Gather context
    const context = _contextFn ? await Promise.resolve(_contextFn()) : {};

    try {
      const r = await fetch(`${_api}/api/ai-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, context })
      });
      const data = await r.json();
      hideThinking();
      if (data.error) {
        appendMessage('assistant', '⚠️ ' + (data.detail || data.error), true);
        statusEl.textContent = 'Error';
      } else {
        appendMessage('assistant', data.reply);
        statusEl.textContent = `Powered by Claude · ${data.tokens?.output_tokens || 0} tokens`;
      }
    } catch (e) {
      hideThinking();
      appendMessage('assistant', '⚠️ Could not reach AI server. Check your connection.', true);
      statusEl.textContent = 'Offline';
    }

    _loading = false;
    sendBtn.disabled = false;
    document.getElementById('aiDot').classList.remove('loading');
  }

  return { init, open, close, toggle, isOpen, send: sendMessage };
})();
