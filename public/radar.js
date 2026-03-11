// ================================================================
//  STORM SURGE — radar.js  (Animator Module  v13.6)
//  Handles all radar tile fetching, caching, crossfade animation
//  and correct tile math at every zoom level (z2–z12).
//
//  Public API (attached to window.RadarAnimator):
//    RadarAnimator.init(map, canvas, cfg)  — call once after map load
//    RadarAnimator.setFrames(past, nowcast)
//    RadarAnimator.goTo(index)
//    RadarAnimator.play() / pause() / togglePlay()
//    RadarAnimator.setOpacity(0–1)
//    RadarAnimator.setColor(colorId)
//    RadarAnimator.setSpeed(ms)
//    RadarAnimator.setSmooth(bool)
//    RadarAnimator.refresh()            — clear cache + redraw
//    RadarAnimator.destroy()
//    RadarAnimator.currentFrame         — index getter
//    RadarAnimator.frameCount           — total frames
//    RadarAnimator.isPlaying            — bool
//    RadarAnimator.onFrameChange        — callback(index, frame)
//    RadarAnimator.onPlayStateChange    — callback(playing)
// ================================================================

(function (global) {
  'use strict';

  // ── Tile math ────────────────────────────────────────────────────
  function ll2tile(lng, lat, z) {
    const n   = 1 << z;
    const cLat = Math.max(-85.0511, Math.min(85.0511, lat));
    const rad  = cLat * Math.PI / 180;
    const x    = Math.floor(((lng + 180) / 360) * n);
    const y    = Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n);
    // Wrap x — valid range [0, n-1]
    const xw   = ((x % n) + n) % n;
    return { x: xw, y: Math.max(0, Math.min(n - 1, y)) };
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

  // Build a list of {x,y,z} tiles covering the given map bounds,
  // correctly handling antimeridian wrap.
  function tilesForBounds(bounds, z) {
    const n    = 1 << z;
    const pad  = Math.max(1, Math.floor(n * 0.02)); // 2% padding

    const mn   = ll2tile(bounds.getWest(),  bounds.getNorth(), z);
    const mx   = ll2tile(bounds.getEast(),  bounds.getSouth(), z);

    const y0   = Math.max(0, mn.y - pad);
    const y1   = Math.min(n - 1, mx.y + pad);

    const tiles = [];
    let xRanges;

    if (mn.x <= mx.x) {
      // Normal case
      xRanges = [[Math.max(0, mn.x - pad), Math.min(n - 1, mx.x + pad)]];
    } else {
      // Antimeridian wrap: view crosses 180° — two ranges
      xRanges = [
        [0,          Math.min(n - 1, mx.x + pad)],
        [Math.max(0, mn.x - pad), n - 1]
      ];
    }

    for (const [x0, x1] of xRanges) {
      for (let tx = x0; tx <= x1; tx++) {
        for (let ty = y0; ty <= y1; ty++) {
          tiles.push({ x: tx, y: ty, z, b: tile2bounds(tx, ty, z) });
        }
      }
    }
    return tiles;
  }

  // Choose zoom level for radar tiles — RainViewer serves z2–z8 tiles;
  // going higher wastes requests, going below z2 has no tiles.
  function radarZoom(mapZoom) {
    if (mapZoom <= 3)  return 2;
    if (mapZoom <= 4)  return 3;
    if (mapZoom <= 5)  return 4;
    if (mapZoom <= 6)  return 5;
    if (mapZoom <= 8)  return 6;
    if (mapZoom <= 10) return 7;
    return 8;
  }

  // ── Tile URL & cache ─────────────────────────────────────────────
  const _cache      = new Map();   // url → HTMLImageElement
  const _inflight   = new Map();   // url → Promise<img|null>
  const _MAX_CACHE  = 1200;        // evict oldest when over limit

  function radarTileUrl(apiBase, framePath, z, x, y, color) {
    const clean = String(framePath || '').replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '');
    return `${apiBase}/api/radar/tile?path=${encodeURIComponent(
      clean + '/256/' + z + '/' + x + '/' + y + '/' + color + '/1_1.png'
    )}`;
  }

  function fetchTile(url) {
    if (_cache.has(url))   return Promise.resolve(_cache.get(url));
    if (_inflight.has(url)) return _inflight.get(url);
    const p = new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => {
        if (_cache.size >= _MAX_CACHE) {
          // Evict oldest 200 entries
          const keys = Array.from(_cache.keys()).slice(0, 200);
          keys.forEach(k => _cache.delete(k));
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

  // ── Crossfade canvas pair ─────────────────────────────────────────
  // We keep two offscreen buffers (A and B) and crossfade between them
  // using a lightweight rAF loop. This is the core of the animator.

  function makeOffscreen(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // ── Main class ───────────────────────────────────────────────────
  function RadarAnimator() {
    this._map        = null;
    this._canvas     = null;   // visible output canvas
    this._ctx        = null;
    this._apiBase    = '';

    // Two offscreen buffers for crossfade
    this._bufA       = null;
    this._bufB       = null;
    this._ctxA       = null;
    this._ctxB       = null;
    this._fadeAlpha  = 1;      // 0 = show A, 1 = show B
    this._fadeTarget = 1;
    this._fadeRaf    = null;

    this._frames        = [];  // past radar frames
    this._nowcastFrames = [];  // nowcast frames
    this._frame         = 0;
    this._playing       = false;
    this._playTimer     = null;

    this._cfg = {
      opacity:  0.75,
      color:    '6',
      speed:    600,
      smooth:   true,
      nowcast:  true
    };

    this._drawSeq    = 0;
    this._mapMoveRAF = null;

    // Public callbacks
    this.onFrameChange     = null;  // (index, frame) => void
    this.onPlayStateChange = null;  // (playing) => void
    this.onError           = null;  // (msg) => void
  }

  RadarAnimator.prototype.init = function (map, canvas, cfg) {
    this._map    = map;
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');
    this._apiBase = (cfg && cfg.apiBase) || (window.SS_API_URL || window.location.origin || '').replace(/\/$/, '');

    if (cfg) {
      if (cfg.opacity  != null) this._cfg.opacity  = cfg.opacity;
      if (cfg.color    != null) this._cfg.color    = cfg.color;
      if (cfg.speed    != null) this._cfg.speed    = cfg.speed;
      if (cfg.smooth   != null) this._cfg.smooth   = cfg.smooth;
      if (cfg.nowcast  != null) this._cfg.nowcast  = cfg.nowcast;
    }

    this._ensureBuffers();

    const self = this;
    // Redraw on every map movement (panning, rotating, pitching)
    map.on('move',   function () { self._drawFromCache(); });
    map.on('rotate', function () { self._drawFromCache(); });
    map.on('pitch',  function () { self._drawFromCache(); });
    // After zoom/move ends, invalidate and reload tiles for new zoom level
    map.on('moveend', function () { self._onViewChanged(); });
    map.on('zoomend', function () { self._onViewChanged(); });
  };

  RadarAnimator.prototype._ensureBuffers = function () {
    const w = this._canvas.width  || 1;
    const h = this._canvas.height || 1;
    if (!this._bufA || this._bufA.width !== w || this._bufA.height !== h) {
      this._bufA = makeOffscreen(w, h);  this._ctxA = this._bufA.getContext('2d');
      this._bufB = makeOffscreen(w, h);  this._ctxB = this._bufB.getContext('2d');
    }
  };

  // Called whenever canvas is resized
  RadarAnimator.prototype.resize = function () {
    this._ensureBuffers();
    if (this._allFrames().length) this._drawFrame(this._frame, false);
  };

  RadarAnimator.prototype._allFrames = function () {
    if (this._cfg.nowcast)
      return this._frames.concat(this._nowcastFrames);
    return this._frames;
  };

  // ── Public API ───────────────────────────────────────────────────

  RadarAnimator.prototype.setFrames = function (past, nowcast) {
    this._frames        = past    || [];
    this._nowcastFrames = nowcast || [];
    const all = this._allFrames();
    if (!all.length) return;
    this._frame = Math.min(this._frame, all.length - 1);
    // Prewarm all frames for current viewport
    this._prewarm();
    this._drawFrame(this._frame, false);
  };

  RadarAnimator.prototype.goTo = function (idx) {
    const all = this._allFrames();
    if (!all.length) return;
    const prev  = this._frame;
    this._frame = Math.max(0, Math.min(all.length - 1, idx));
    if (this.onFrameChange) this.onFrameChange(this._frame, all[this._frame]);
    const crossfade = this._cfg.smooth && prev !== this._frame;
    this._drawFrame(this._frame, crossfade);
  };

  RadarAnimator.prototype.play = function () {
    if (this._playing) return;
    this._playing = true;
    if (this.onPlayStateChange) this.onPlayStateChange(true);
    const self = this;
    const step = function () {
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

  RadarAnimator.prototype.setOpacity = function (v) { this._cfg.opacity = v; this._drawFromCache(); };
  RadarAnimator.prototype.setColor   = function (v) { this._cfg.color   = v; _cache.clear(); this._drawFrame(this._frame, false); this._prewarm(); };
  RadarAnimator.prototype.setSpeed   = function (v) { this._cfg.speed   = v; if (this._playing) { this.pause(); this.play(); } };
  RadarAnimator.prototype.setSmooth  = function (v) { this._cfg.smooth  = v; };
  RadarAnimator.prototype.setNowcast = function (v) { this._cfg.nowcast = v; };

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
    this._canvas = null;
  };

  Object.defineProperty(RadarAnimator.prototype, 'currentFrame', { get: function () { return this._frame; } });
  Object.defineProperty(RadarAnimator.prototype, 'frameCount',   { get: function () { return this._allFrames().length; } });
  Object.defineProperty(RadarAnimator.prototype, 'isPlaying',    { get: function () { return this._playing; } });

  // ── Drawing engine ───────────────────────────────────────────────

  // Draw from tile cache only (used during pan/zoom drag — no async)
  RadarAnimator.prototype._drawFromCache = function () {
    if (!this._map || !this._ctx) return;
    const all = this._allFrames();
    if (!all.length) return;
    const frame  = all[this._frame];
    const map    = this._map;
    const canvas = this._canvas;
    const ctx    = this._ctx;
    const z      = radarZoom(map.getZoom());
    const color  = this._cfg.color;
    const tiles  = tilesForBounds(map.getBounds(), z);
    const proj   = map.project.bind(map);

    this._ensureBuffers();
    const bufCtx = this._ctxB;
    bufCtx.clearRect(0, 0, this._bufB.width, this._bufB.height);
    bufCtx.imageSmoothingEnabled = this._cfg.smooth;
    bufCtx.globalAlpha = 1;

    tiles.forEach(function (t) {
      const url = radarTileUrl(
        '', // empty — cache keys were built with apiBase, but during pan we
            // re-derive below
        frame.path, t.z, t.x, t.y, color
      );
      // We need to look up with the actual apiBase
      const img = _cache.get(
        radarTileUrl(
          (window.SS_API_URL || window.location.origin || '').replace(/\/$/, ''),
          frame.path, t.z, t.x, t.y, color
        )
      );
      if (!img) return;
      const nw = proj([t.b.west, t.b.north]);
      const se = proj([t.b.east, t.b.south]);
      const pw = se.x - nw.x, ph = se.y - nw.y;
      if (pw > 0 && ph > 0) bufCtx.drawImage(img, nw.x, nw.y, pw, ph);
    });

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.globalAlpha = this._cfg.opacity;
    ctx.drawImage(this._bufB, 0, 0);
    ctx.restore();
  };

  // Full async draw with optional crossfade to previous frame
  RadarAnimator.prototype._drawFrame = function (idx, crossfade) {
    const self   = this;
    const all    = this._allFrames();
    if (!all.length || !this._map) return;

    const frame  = all[idx];
    const map    = this._map;
    const canvas = this._canvas;
    const z      = radarZoom(map.getZoom());
    const color  = this._cfg.color;
    const apiBase = this._apiBase;
    const seq    = ++this._drawSeq;

    this._ensureBuffers();
    const tiles = tilesForBounds(map.getBounds(), z);
    if (!tiles.length) return;

    const proj  = map.project.bind(map);
    const w     = canvas.width, h = canvas.height;

    // Fetch all tiles for this frame
    Promise.all(
      tiles.map(function (t) {
        const url = radarTileUrl(apiBase, frame.path, t.z, t.x, t.y, color);
        return fetchTile(url).then(function (img) { return { t: t, img: img }; });
      })
    ).then(function (results) {
      if (seq !== self._drawSeq || !self._map) return;

      // If crossfading, copy current visible output to bufA first
      if (crossfade) {
        self._ctxA.clearRect(0, 0, w, h);
        self._ctxA.drawImage(canvas, 0, 0);
      }

      // Render new frame into bufB
      self._ensureBuffers();
      const bCtx = self._ctxB;
      bCtx.clearRect(0, 0, self._bufB.width, self._bufB.height);
      bCtx.imageSmoothingEnabled = self._cfg.smooth;
      bCtx.globalAlpha = 1;

      results.forEach(function (r) {
        if (!r.img) return;
        const nw = proj([r.t.b.west, r.t.b.north]);
        const se = proj([r.t.b.east, r.t.b.south]);
        const pw = se.x - nw.x, ph = se.y - nw.y;
        if (pw > 0 && ph > 0) bCtx.drawImage(r.img, nw.x, nw.y, pw, ph);
      });

      if (crossfade) {
        self._startCrossfade();
      } else {
        const ctx = self._ctx;
        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.globalAlpha = self._cfg.opacity;
        ctx.drawImage(self._bufB, 0, 0);
        ctx.restore();
      }
    });
  };

  // CSS-style crossfade: fade bufA (previous) out, bufB (new) in
  RadarAnimator.prototype._startCrossfade = function () {
    const self = this;
    cancelAnimationFrame(this._fadeRaf);
    let alpha    = 0; // 0 = fully A, 1 = fully B
    const STEPS  = 8;
    const STEP   = 1 / STEPS;

    const tick = function () {
      alpha = Math.min(1, alpha + STEP);
      const ctx = self._ctx;
      const w   = self._canvas.width, h = self._canvas.height;
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

  // ── Prewarm: load tiles for all frames at current zoom ────────────
  RadarAnimator.prototype._prewarm = function () {
    if (!this._map || !this._frames.length) return;
    const z      = radarZoom(this._map.getZoom());
    const color  = this._cfg.color;
    const apiBase = this._apiBase;
    const bounds = this._map.getBounds();
    const tiles  = tilesForBounds(bounds, z);
    const all    = this._allFrames();

    // Prioritise: current ±2 frames first, rest after
    const order  = [];
    const cur    = this._frame;
    for (let d = 0; d <= all.length; d++) {
      if (cur + d < all.length) order.push(cur + d);
      if (d > 0 && cur - d >= 0) order.push(cur - d);
    }

    order.forEach(function (fi) {
      const frame = all[fi];
      tiles.forEach(function (t) {
        fetchTile(radarTileUrl(apiBase, frame.path, t.z, t.x, t.y, color));
      });
    });
  };

  RadarAnimator.prototype._onViewChanged = function () {
    const self = this;
    cancelAnimationFrame(this._mapMoveRAF);
    this._mapMoveRAF = requestAnimationFrame(function () {
      if (!self._map) return;
      self._prewarm();
      self._drawFrame(self._frame, false);
    });
  };

  // ── Export ───────────────────────────────────────────────────────
  global.RadarAnimator = new RadarAnimator();

  // Also expose helpers for app.js backwards compat
  global._radarTileZoom    = radarZoom;
  global._radarTilesForBounds = tilesForBounds;

})(window);
