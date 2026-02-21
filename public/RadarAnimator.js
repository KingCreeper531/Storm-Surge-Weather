(function(global){
  function smoothstep(k){ return k*k*(3-2*k); }

  function normalizePath(path){
    return String(path||'').trim().replace(/^https?:\/\/[^/]+\//,'').replace(/^\/+/, '');
  }

  function buildFrameUrls(apiKey, framePaths, opts){
    var options = opts || {};
    var base = (options.apiBase || global.location.origin || '').replace(/\/$/, '');
    var color = options.color || '6';
    var paths = (framePaths && framePaths.length ? framePaths : []).map(normalizePath);
    return paths.map(function(p){
      var qp = encodeURIComponent(p + '/256/');
      var url = base + '/api/radar/tile?path=' + qp + '{z}/{x}/{y}/' + color + '/1_1.png';
      if(apiKey) url += '&k=' + encodeURIComponent(apiKey);
      return url;
    });
  }

  function RadarAnimator(map, options){
    this.map = map;
    this.opts = options || {};
    this.layerPrefix = this.opts.layerPrefix || 'radar-frame';
    this.frameUrls = (this.opts.frameUrls || []).slice();
    this.opacity = typeof this.opts.opacity === 'number' ? this.opts.opacity : 0.75;
    this.fps = Math.max(2, Math.min(16, this.opts.fps || 6));
    this.crossfadeMs = Math.max(80, this.opts.crossfadeMs || 300);
    this.current = 0;
    this.target = 0;
    this.playing = false;
    this._raf = null;
    this._lastStep = 0;
    this._xStart = 0;
    this._xFrom = 0;
    this._xTo = 0;
    this._state = 'hold';
    this._styleLoadBound = null;
  }

  RadarAnimator.prototype._layerId = function(i){ return this.layerPrefix + '-' + i; };

  RadarAnimator.prototype._applyStaticOpacities = function(activeIndex){
    var i, id;
    for(i=0;i<this.frameUrls.length;i++){
      id = this._layerId(i);
      if(this.map.getLayer(id)){
        this.map.setPaintProperty(id, 'raster-opacity', i===activeIndex ? this.opacity : 0);
      }
    }
  };

  RadarAnimator.prototype._crossfade = function(fromIndex, toIndex, t){
    var k = smoothstep(Math.max(0, Math.min(1, t)));
    var fromId = this._layerId(fromIndex);
    var toId = this._layerId(toIndex);
    if(this.map.getLayer(fromId)) this.map.setPaintProperty(fromId, 'raster-opacity', (1-k)*this.opacity);
    if(this.map.getLayer(toId)) this.map.setPaintProperty(toId, 'raster-opacity', k*this.opacity);
  };

  RadarAnimator.prototype.init = function(){
    var self = this;
    if(!self.map || !self.map.isStyleLoaded() || !self.frameUrls.length) return Promise.resolve(false);

    self.destroy();

    self.frameUrls.forEach(function(url, i){
      var id = self._layerId(i);
      if(!self.map.getSource(id)){
        self.map.addSource(id, { type:'raster', tiles:[url], tileSize:256 });
      }
      if(!self.map.getLayer(id)){
        self.map.addLayer({
          id:id, type:'raster', source:id,
          paint:{
            'raster-opacity': i===0 ? self.opacity : 0,
            'raster-opacity-transition': { duration: 0, delay: 0 },
            'raster-resampling':'linear'
          }
        });
      }
    });

    // Light preload (async image warms browser cache, doesn't block UI thread).
    setTimeout(function(){
      self.frameUrls.forEach(function(url){ var im = new Image(); im.decoding='async'; im.src=url.replace('{z}','4').replace('{x}','3').replace('{y}','6'); });
    }, 0);

    self.current = 0;
    self.target = 0;
    self._state = 'hold';
    self._applyStaticOpacities(0);

    self._styleLoadBound = function(){
      if(!self.frameUrls.length) return;
      self.init().then(function(){ self.goto(self.current); if(self.playing) self.play(); });
    };
    self.map.on('style.load', self._styleLoadBound);
    return Promise.resolve(true);
  };

  RadarAnimator.prototype._tick = function(ts){
    if(!this.playing) return;
    if(!this._lastStep) this._lastStep = ts;

    var frameDuration = 1000 / this.fps;

    if(this._state === 'hold' && (ts - this._lastStep) >= frameDuration){
      this._xFrom = this.current;
      this._xTo = (this.current + 1) % this.frameUrls.length;
      this._xStart = ts;
      this._state = 'crossfade';
    }

    if(this._state === 'crossfade'){
      var t = (ts - this._xStart) / this.crossfadeMs;
      if(t >= 1){
        this.current = this._xTo;
        this._applyStaticOpacities(this.current);
        this._lastStep = ts;
        this._state = 'hold';
      } else {
        this._crossfade(this._xFrom, this._xTo, t);
      }
    }

    this._raf = requestAnimationFrame(this._tick.bind(this));
  };

  RadarAnimator.prototype.play = function(){
    if(this.playing || !this.frameUrls.length) return;
    this.playing = true;
    this._lastStep = 0;
    this._raf = requestAnimationFrame(this._tick.bind(this));
  };

  RadarAnimator.prototype.pause = function(){
    this.playing = false;
    if(this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  };

  RadarAnimator.prototype.goto = function(frameIndex){
    var i = Math.max(0, Math.min(this.frameUrls.length-1, frameIndex|0));
    this.current = i;
    this.target = i;
    this._state = 'hold';
    this._applyStaticOpacities(i);
  };

  RadarAnimator.prototype.setFPS = function(fps){
    this.fps = Math.max(2, Math.min(16, Number(fps) || 6));
  };

  RadarAnimator.prototype.setOpacity = function(opacity){
    this.opacity = Math.max(0, Math.min(1, Number(opacity) || 0));
    this._applyStaticOpacities(this.current);
  };

  RadarAnimator.prototype.destroy = function(){
    this.pause();
    if(this.map && this._styleLoadBound){ this.map.off('style.load', this._styleLoadBound); }
    this._styleLoadBound = null;
    if(!this.map) return;
    for(var i=0;i<this.frameUrls.length;i++){
      var id = this._layerId(i);
      try{ if(this.map.getLayer(id)) this.map.removeLayer(id); }catch(_e){}
      try{ if(this.map.getSource(id)) this.map.removeSource(id); }catch(_e2){}
    }
  };

  global.RadarAnimator = RadarAnimator;
  global.buildFrameUrls = buildFrameUrls;
})(window);
