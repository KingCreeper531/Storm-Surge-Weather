// ================================================================
//  STORM SURGE — radar.js  (Animator Module  v13.6)
//  Handles all radar tile fetching, caching, crossfade animation
//  and correct tile math at every zoom level (z2–z8).
//
//  Public API (window.RadarAnimator singleton):
//    RadarAnimator.init(map, canvas, cfg)
//    RadarAnimator.setFrames(past, nowcast)
//    RadarAnimator.goTo(index)
//    RadarAnimator.play() / pause() / togglePlay()
//    RadarAnimator.setOpacity(0–1)
//    RadarAnimator.setColor(colorId)
//    RadarAnimator.setSpeed(ms)
//    RadarAnimator.setSmooth(bool)
//    RadarAnimator.setNowcast(bool)
//    RadarAnimator.refresh()
//    RadarAnimator.resize()
//    RadarAnimator.destroy()
//    RadarAnimator.currentFrame   (getter)
//    RadarAnimator.frameCount     (getter)
//    RadarAnimator.isPlaying      (getter)
//    RadarAnimator.onFrameChange      = (index, frame) => void
//    RadarAnimator.onPlayStateChange  = (playing) => void
// ================================================================

(function (global) {
  'use strict';

  // ── Tile math ──────────────────────────────────────────────────────
  function ll2tile(lng, lat, z) {
    const n    = 1 << z;
    const cLat = Math.max(-85.0511, Math.min(85.0511, lat));
    const rad  = cLat * Math.PI / 180;
    const rawX = Math.floor(((lng + 180) / 360) * n);
    const y    = Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n);
    // Properly wrap x into [0, n-1] even for negative raw values
    const x    = ((rawX % n) + n) % n;
    return { x, y: Math.max(0, Math.min(n - 1, y)) };
  }

  function tile2bounds(x, y, z) {
    const n = 1 << z;
    return {
      west:  (x / n) * 360 - 180,
      east:  ((x + 1) / n) * 360 - 180,
      north: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI,
      south: Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI
    };
  }

  // Build tile list for current viewport. Handles antimeridian wrap.
  function tilesForBounds(bounds, z) {
    const n   = 1 << z;
    const pad = Math.max(1, Math.floor(n * 0.02));

    const mn  = ll2tile(bounds.getWest(),  bounds.getNorth(), z);
    const mx  = ll2tile(bounds.getEast(),  bounds.getSouth(), z);

    const y0  = Math.max(0, mn.y - pad);
    const y1  = Math.min(n - 1, mx.y + pad);

    let xRanges;
    if (mn.x <= mx.x) {
      xRanges = [[Math.max(0, mn.x - pad), Math.min(n - 1, mx.x + pad)]];
    } else {
      // Antimeridian crossing — split into two ranges
      xRanges = [
        [0,              Math.min(n - 1, mx.x + pad)],
        [Math.max(0, mn.x - pad), n - 1]
      ];
    }

    const tiles = [];
    for (const [x0, x1] of xRanges) {
      for (let tx = x0; tx <= x1; tx++) {
        for (let ty = y0; ty <= y1; ty++) {
          tiles.push({ x: tx, y: ty, z, b: tile2bounds(tx, ty, z) });
        }
      }
    }
    return tiles;
  }

  // Map Mapbox zoom → RainViewer tile zoom (RainViewer serves z2–z8)
  function radarZoom(mapZoom) {
    if (mapZoom <= 3)  return 2;
    if (mapZoom <= 4)  return 3;
    if (mapZoom <= 5)  return 4;
    if (mapZoom <= 6)  return 5;
    if (mapZoom <= 8)  return 6;
    if (mapZoom <= 10) return 7;
    return 8;
  }

  // ── Tile cache ─────────────────────────────────────────────────────
  const _cache     = new Map();  // url → HTMLImageElement
  const _inflight  = new Map();  // url → Promise<img|null>
  const MAX_CACHE  = 1200;

  function buildUrl(apiBase, framePath, z, x, y, color) {
    const clean = String(framePath || '')
      .replace(/^https?:\/\/[^/]+\//, '')
      .replace(/^\/+/, '');
    return apiBase + '/api/radar/tile?path=' +
      encodeURIComponent(clean + '/256/' + z + '/' + x + '/' + y + '/' + color + '/1_1.png');
  }

  function fetchTile(url) {
    if (_cache.has(url))    return Promise.resolve(_cache.get(url));
    if (_inflight.has(url)) return _inflight.get(url);
    const p = new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (_cache.size >= MAX_CACHE) {
          Array.from(_cache.keys()).slice(0, 200).forEach(k => _cache.delete(k));
        }
        _cache.set(url, img);
        _inflight.delete(url);
        resolve(img);
      };
      img.onerror = () => { _inflight.delete(url); resolve(null); };
      img.src = url;
    });
    _inflight.set(url, p);
    return p;
  }

  // ── Offscreen buffer helpers ───────────────────────────────────────
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // ── RadarAnimator class ────────────────────────────────────────────
  function RadarAnimator() {
    this._map     = null;
    this._canvas  = null;
    this._ctx     = null;
    this._apiBase = '';

    // Dual offscreen buffers for crossfade
    this._bufA  = null;  this._ctxA = null;
    this._bufB  = null;  this._ctxB = null;
    this._fadeRaf    = null;
    this._mapMoveRAF = null;

    this._frames        = [];
    this._nowcastFrames = [];
    this._frame         = 0;
    this._playing       = false;
    this._playTimer     = null;
    this._drawSeq       = 0;

    this._cfg = { opacity: 0.75, color: '6', speed: 600, smooth: true, nowcast: true };

    this.onFrameChange     = null;
    this.onPlayStateChange = null;
  }

  // ── Init ───────────────────────────────────────────────────────────
  RadarAnimator.prototype.init = function (map, canvas, cfg) {
    this._map    = map;
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');
    this._apiBase = (cfg && cfg.apiBase)
      || (window.SS_API_URL || window.location.origin || '').replace(/\/$/, '');

    if (cfg) {
      ['opacity','color','speed','smooth','nowcast'].forEach(k => {
        if (cfg[k] != null) this._cfg[k] = cfg[k];
      });
    }

    this._syncBuffers();

    const self = this;
    // During drag/pitch/rotate — redraw from cache immediately (no fetch)
    map.on('move',   () => self._drawCached());
    map.on('rotate', () => self._drawCached());
    map.on('pitch',  () => self._drawCached());
    // After zoom/pan ends — fetch new tiles for new viewport
    map.on('moveend', () => self._onViewChange());
    map.on('zoomend', () => self._onViewChange());
  };

  RadarAnimator.prototype._syncBuffers = function () {
    const w = Math.max(1, this._canvas.width);
    const h = Math.max(1, this._canvas.height);
    if (!this._bufA || this._bufA.width !== w || this._bufA.height !== h) {
      this._bufA = makeCanvas(w, h);  this._ctxA = this._bufA.getContext('2d');
      this._bufB = makeCanvas(w, h);  this._ctxB = this._bufB.getContext('2d');
    }
  };

  RadarAnimator.prototype.resize = function () {
    this._syncBuffers();
    if (this._allFrames().length) this._drawFrame(this._frame, false);
  };

  RadarAnimator.prototype._allFrames = function () {
    return this._cfg.nowcast
      ? this._frames.concat(this._nowcastFrames)
      : this._frames.slice();
  };

  // ── Public API ─────────────────────────────────────────────────────
  RadarAnimator.prototype.setFrames = function (past, nowcast) {
    this._frames        = past    || [];
    this._nowcastFrames = nowcast || [];
    const all = this._allFrames();
    if (!all.length) return;
    this._frame = Math.min(this._frame, all.length - 1);
    this._prewarm();
    this._drawFrame(this._frame, false);
  };

  RadarAnimator.prototype.goTo = function (idx) {
    const all  = this._allFrames();
    if (!all.length) return;
    const prev = this._frame;
    this._frame = Math.max(0, Math.min(all.length - 1, idx));
    if (this.onFrameChange) this.onFrameChange(this._frame, all[this._frame]);
    this._drawFrame(this._frame, this._cfg.smooth && prev !== this._frame);
  };

  RadarAnimator.prototype.play = function () {
    if (this._playing) return;
    this._playing = true;
    if (this.onPlayStateChange) this.onPlayStateChange(true);
    const self = this;
    const step = () => {
      const all = self._allFrames();
      if (!all.length) return;
      self.goTo((self._frame + 1) % all.length);
      self._playTimer = setTimeout(step, Math.max(80, self._cfg.speed));
    };
    this._playTimer = setTimeout(step, Math.max(80, this._cfg.speed));
  };

  RadarAnimator.prototype.pause = function () {
    if (!this._playing) return;
    this._playing = false;
    clearTimeout(this._playTimer);
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  };

  RadarAnimator.prototype.togglePlay = function () {
    this._playing ? this.pause() : this.play();
  };

  RadarAnimator.prototype.setOpacity  = function (v) { this._cfg.opacity = v;  this._drawCached(); };
  RadarAnimator.prototype.setColor    = function (v) { this._cfg.color   = v;  _cache.clear(); this._drawFrame(this._frame, false); this._prewarm(); };
  RadarAnimator.prototype.setSpeed    = function (v) { this._cfg.speed   = v;  if (this._playing) { this.pause(); this.play(); } };
  RadarAnimator.prototype.setSmooth   = function (v) { this._cfg.smooth  = v; };
  RadarAnimator.prototype.setNowcast  = function (v) { this._cfg.nowcast = v; };

  RadarAnimator.prototype.refresh = function () {
    _cache.clear();
    this._prewarm();
    this._drawFrame(this._frame, false);
  };

  RadarAnimator.prototype.destroy = function () {
    this.pause();
    cancelAnimationFrame(this._fadeRaf);
    cancelAnimationFrame(this._mapMoveRAF);
    this._map = null;
  };

  Object.defineProperty(RadarAnimator.prototype, 'currentFrame', { get() { return this._frame; } });
  Object.defineProperty(RadarAnimator.prototype, 'frameCount',   { get() { return this._allFrames().length; } });
  Object.defineProperty(RadarAnimator.prototype, 'isPlaying',    { get() { return this._playing; } });

  // ── Drawing ────────────────────────────────────────────────────────

  // Synchronous draw from cache only — used while map is being dragged
  RadarAnimator.prototype._drawCached = function () {
    if (!this._map || !this._ctx) return;
    const all = this._allFrames();
    if (!all.length) return;

    const frame    = all[this._frame];
    const z        = radarZoom(this._map.getZoom());
    const color    = this._cfg.color;
    const apiBase  = this._apiBase;
    const tiles    = tilesForBounds(this._map.getBounds(), z);
    const proj     = this._map.project.bind(this._map);
    const canvas   = this._canvas;

    this._syncBuffers();
    const bCtx = this._ctxB;
    bCtx.clearRect(0, 0, this._bufB.width, this._bufB.height);
    bCtx.imageSmoothingEnabled = this._cfg.smooth;

    tiles.forEach(t => {
      // Use the same apiBase that was used when tiles were fetched
      const img = _cache.get(buildUrl(apiBase, frame.path, t.z, t.x, t.y, color));
      if (!img) return;
      const nw = proj([t.b.west, t.b.north]);
      const se = proj([t.b.east, t.b.south]);
      const pw = se.x - nw.x, ph = se.y - nw.y;
      if (pw > 0 && ph > 0) bCtx.drawImage(img, nw.x, nw.y, pw, ph);
    });

    const ctx = this._ctx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.globalAlpha = this._cfg.opacity;
    ctx.drawImage(this._bufB, 0, 0);
    ctx.restore();
  };

  // Async draw: fetch missing tiles then render, with optional crossfade
  RadarAnimator.prototype._drawFrame = function (idx, crossfade) {
    const self    = this;
    const all     = this._allFrames();
    if (!all.length || !this._map) return;

    const frame   = all[idx];
    const z       = radarZoom(this._map.getZoom());
    const color   = this._cfg.color;
    const apiBase = this._apiBase;
    const seq     = ++this._drawSeq;
    const canvas  = this._canvas;
    const proj    = this._map.project.bind(this._map);

    this._syncBuffers();
    const tiles = tilesForBounds(this._map.getBounds(), z);
    if (!tiles.length) return;

    Promise.all(
      tiles.map(t => fetchTile(buildUrl(apiBase, frame.path, t.z, t.x, t.y, color))
        .then(img => ({ t, img })))
    ).then(results => {
      if (seq !== self._drawSeq || !self._map) return;

      // Snapshot current output into bufA for crossfade
      if (crossfade) {
        self._ctxA.clearRect(0, 0, canvas.width, canvas.height);
        self._ctxA.drawImage(canvas, 0, 0);
      }

      // Render new frame into bufB
      self._syncBuffers();
      const bCtx = self._ctxB;
      bCtx.clearRect(0, 0, self._bufB.width, self._bufB.height);
      bCtx.imageSmoothingEnabled = self._cfg.smooth;

      results.forEach(({ t, img }) => {
        if (!img) return;
        const nw = proj([t.b.west, t.b.north]);
        const se = proj([t.b.east, t.b.south]);
        const pw = se.x - nw.x, ph = se.y - nw.y;
        if (pw > 0 && ph > 0) bCtx.drawImage(img, nw.x, nw.y, pw, ph);
      });

      if (crossfade) {
        self._crossfade();
      } else {
        const ctx = self._ctx;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.globalAlpha = self._cfg.opacity;
        ctx.drawImage(self._bufB, 0, 0);
        ctx.restore();
      }
    });
  };

  // 8-step rAF crossfade: bufA (old) fades out, bufB (new) fades in
  RadarAnimator.prototype._crossfade = function () {
    const self = this;
    cancelAnimationFrame(this._fadeRaf);
    let alpha = 0;
    const tick = () => {
      alpha = Math.min(1, alpha + 0.125);
      const ctx = self._ctx;
      const w = self._canvas.width, h = self._canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.globalAlpha = self._cfg.opacity * (1 - alpha);
      ctx.drawImage(self._bufA, 0, 0);
      ctx.globalAlpha = self._cfg.opacity * alpha;
      ctx.drawImage(self._bufB, 0, 0);
      ctx.restore();
      if (alpha < 1) self._fadeRaf = requestAnimationFrame(tick);
    };
    this._fadeRaf = requestAnimationFrame(tick);
  };

  // Pre-fetch tiles for all frames at current viewport zoom
  RadarAnimator.prototype._prewarm = function () {
    if (!this._map || !this._frames.length) return;
    const z       = radarZoom(this._map.getZoom());
    const color   = this._cfg.color;
    const apiBase = this._apiBase;
    const tiles   = tilesForBounds(this._map.getBounds(), z);
    const all     = this._allFrames();
    const cur     = this._frame;

    // Load current ±2 frames first, then the rest
    const order = [];
    for (let d = 0; d <= all.length; d++) {
      if (cur + d < all.length) order.push(cur + d);
      if (d > 0 && cur - d >= 0) order.push(cur - d);
    }
    order.forEach(fi => {
      tiles.forEach(t => fetchTile(buildUrl(apiBase, all[fi].path, t.z, t.x, t.y, color)));
    });
  };

  RadarAnimator.prototype._onViewChange = function () {
    cancelAnimationFrame(this._mapMoveRAF);
    this._mapMoveRAF = requestAnimationFrame(() => {
      if (!this._map) return;
      this._prewarm();
      this._drawFrame(this._frame, false);
    });
  };

  // ── Export singleton ───────────────────────────────────────────────
  global.RadarAnimator = new RadarAnimator();

})(window);
