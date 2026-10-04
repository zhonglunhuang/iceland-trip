/*!
 * ambient.js — procedural Iceland soundscape for 冰島任務 · Fire & Ice
 * ---------------------------------------------------------------------------
 * Everything is synthesised live with the Web Audio API: noise buffers,
 * filters, slow random "control" signals and a convolution reverb whose
 * impulse response is generated from noise. No audio files, no licences —
 * just this script (~17 KB gzipped).
 *
 *   Ambient.init({ button: true })   floating glass toggle (bottom-right)
 *   Ambient.setScene('waterfall')    crossfade to a scene (see TYPES)
 *   Ambient.autoBind('[data-fx]')    let the section nearest the viewport
 *                                    centre pick the scene (data-ambient wins)
 *   Ambient.play() / pause() / isOn()
 *   Ambient.sfx('whoosh' | 'chime' | 'splash' | 'crack' | 'geyser')
 *   Ambient.mountWorld('drift')      one-liner for the 3D world pages
 *
 * Audio only starts after a user gesture (autoplay policy). The on/off choice
 * is remembered in localStorage, but a gesture is still needed to resume.
 * Fires window events:  'ambient:change' {on, playing, scene}
 *                       'ambient:geyser' (when a geyser-scene eruption peaks)
 */
(function (root) {
  'use strict';
  if (!root || root.Ambient) return;

  var doc = root.document;
  var AC = root.AudioContext || root.webkitAudioContext || null;
  var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext || null;

  var VOLUME = 0.35;       // master volume
  var FADE = 2.2;          // scene crossfade (s)
  var LOOKAHEAD = 0.6;     // event scheduler horizon (s)
  var TICK_MS = 150;       // scheduler interval
  var KEY = 'iceland-trip:ambient';

  var TYPES = ['hero', 'waterfall', 'geyser', 'aurora', 'steam', 'waves', 'drift', 'ice',
    'snow', 'mist', 'ripple', 'city', 'sunset', 'drive', 'flight', 'wind'];

  var ALIAS = {
    intro: 'hero', 'default': 'hero', top: 'hero',
    lagoon: 'drift', jokulsarlon: 'drift', glacier: 'ice', cave: 'ice', 'ice-cave': 'ice',
    ocean: 'waves', sea: 'waves', beach: 'waves', surf: 'waves', reynisfjara: 'waves',
    river: 'ripple', lake: 'ripple', stream: 'ripple', water: 'ripple',
    hotspring: 'steam', 'hot-spring': 'steam', 'blue-lagoon': 'steam', geothermal: 'steam',
    night: 'aurora', stars: 'aurora', kirkjufell: 'aurora',
    car: 'drive', road: 'drive', plane: 'flight', airport: 'flight',
    fog: 'mist', canyon: 'mist', storm: 'wind', field: 'wind', town: 'city', dusk: 'sunset',
    none: 'none', off: 'none', silent: 'none', silence: 'none'
  };

  // Per-scene bus gain, calibrated with Ambient._render() + A-weighting so every
  // scene lands around -30 dB(A) after the 0.35 master (waterfall / waves a
  // touch louder, flight / mist / aurora softer). Re-measure if you edit a recipe.
  var LEVEL = {
    hero: 5.89, waterfall: 1.32, geyser: 3.95, aurora: 6.73, steam: 5.2, waves: 3.54,
    drift: 8.94, ice: 18.2, snow: 10.13, mist: 5.04, ripple: 2.42, city: 7.84,
    sunset: 4.58, drive: 7.98, flight: 3.18, wind: 8.78
  };

  /* ------------------------------------------------------------------ utils */
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function irnd(a, b) { return Math.floor(rnd(a, b + 1)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function norm(type) {
    type = String(type == null ? '' : type).toLowerCase().trim().split(/[\s,|]+/)[0];
    if (ALIAS[type]) type = ALIAS[type];
    return type === 'none' || TYPES.indexOf(type) >= 0 ? type : null;
  }
  function emit(name, detail) {
    try { root.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) { /* old browser */ }
  }
  function stopSafe(s, t) { try { s.stop(t || 0); } catch (e) { /* already stopped */ } }
  function disc(n) { try { n.disconnect(); } catch (e) { /* already gone */ } }

  // Smoothly move an AudioParam from wherever it is now to `to`.
  function glide(param, to, dur, t) {
    try {
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
      else { var v = param.value; param.cancelScheduledValues(t); param.setValueAtTime(v, t); }
      param.linearRampToValueAtTime(to, t + dur);
    } catch (e) {
      try { param.value = to; } catch (e2) { /* ignore */ }
    }
  }

  /* ---------------------------------------------------------------- buffers */
  // 6 s stereo noise, RMS-normalised to 0.25 and crossfaded tail→head so the
  // loop point is seamless (matters for brown noise).
  function noiseBuffer(ctx, kind) {
    var sr = ctx.sampleRate, n = Math.floor(sr * 6), F = Math.floor(sr * 0.3);
    var buf = ctx.createBuffer(2, n, sr);
    for (var ch = 0; ch < 2; ch++) {
      var raw = new Float32Array(n + F), i, w, mean = 0;
      if (kind === 'pink') {
        var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (i = 0; i < n + F; i++) {
          w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
          b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
          raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
        }
      } else if (kind === 'brown') {
        var last = 0;
        for (i = 0; i < n + F; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; raw[i] = last; }
      } else {
        for (i = 0; i < n + F; i++) raw[i] = Math.random() * 2 - 1;
      }
      for (i = 0; i < n + F; i++) mean += raw[i];
      mean /= (n + F);
      var d = buf.getChannelData(ch), sum = 0;
      for (i = 0; i < n; i++) d[i] = raw[i] - mean;
      for (i = 0; i < F; i++) {
        var a = (i / F) * Math.PI / 2;
        d[i] = (raw[i] - mean) * Math.sin(a) + (raw[n + i] - mean) * Math.cos(a);
      }
      for (i = 0; i < n; i++) sum += d[i] * d[i];
      var k = 0.25 / Math.sqrt(sum / n || 1);
      for (i = 0; i < n; i++) d[i] *= k;
    }
    return buf;
  }

  // Slow random control signal in [-1, 1]: 64 cosine-interpolated knots over
  // 16 s (4 knots/s at playbackRate 1). 'gust' is skewed: mostly calm with
  // occasional peaks. Stored at a tiny sample rate — it is only a modulator.
  function ctlBuffer(ctx, kind) {
    var sr = 3000, buf;
    try { buf = ctx.createBuffer(1, sr * 16, sr); } catch (e) { sr = 22050; buf = ctx.createBuffer(1, sr * 16, sr); }
    var d = buf.getChannelData(0), K = 64, knots = [], i;
    for (i = 0; i < K; i++) {
      var u = Math.random();
      knots.push(kind === 'gust' ? Math.pow(u, 2.2) * 2 - 1 : u * 2 - 1);
    }
    var per = d.length / K;
    for (i = 0; i < d.length; i++) {
      var x = i / per, k = Math.floor(x), f = x - k, a = knots[k % K], b = knots[(k + 1) % K];
      d[i] = a + (b - a) * (1 - Math.cos(f * Math.PI)) / 2;
    }
    return buf;
  }

  // Stereo reverb impulse: decaying noise that darkens over time (≈ a big,
  // soft outdoor space / ice hall).
  function irBuffer(ctx, secs) {
    var sr = ctx.sampleRate, n = Math.floor(sr * secs), pre = Math.floor(sr * 0.015);
    var buf = ctx.createBuffer(2, n, sr), att = sr * 0.006;
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), y = 0;
      for (var i = pre; i < n; i++) {
        var p = (i - pre) / (n - pre), c = 0.82 - 0.74 * p;
        y += c * ((Math.random() * 2 - 1) - y);
        d[i] = y * Math.pow(1 - p, 3) * Math.min(1, (i - pre) / att);
      }
    }
    return buf;
  }

  function getBuf(G, key) {
    var b = G.bufs[key];
    if (!b) b = G.bufs[key] = (key === 'smooth' || key === 'gust') ? ctlBuffer(G.ctx, key) : noiseBuffer(G.ctx, key);
    return b;
  }

  /* ------------------------------------------------------------ master graph */
  //  scene buses ─┐
  //  sfx ─────────┼─► mix ─► highpass 32Hz ─► high-shelf −4dB ─► compressor ─► master ─► out
  //  reverb send ─► convolver ─► return ─┘
  function makeGraph(ctx) {
    var G = { ctx: ctx, bufs: {} };
    G.mix = ctx.createGain();
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 32; hp.Q.value = 0.7;
    var shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 6500; shelf.gain.value = -4;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 12; comp.ratio.value = 2.5;
    comp.attack.value = 0.01; comp.release.value = 0.35;
    G.master = ctx.createGain(); G.master.gain.value = 0;
    G.mix.connect(hp); hp.connect(shelf); shelf.connect(comp); comp.connect(G.master); G.master.connect(ctx.destination);

    G.verbIn = ctx.createGain();
    var conv = ctx.createConvolver(); conv.buffer = irBuffer(ctx, 3.2);
    var ret = ctx.createGain(); ret.gain.value = 0.9;
    G.verbIn.connect(conv); conv.connect(ret); ret.connect(G.mix);

    G.sfxIn = ctx.createGain();
    var sfxWet = ctx.createGain(); sfxWet.gain.value = 0.3;
    G.sfxIn.connect(G.mix); G.sfxIn.connect(sfxWet); sfxWet.connect(G.verbIn);
    return G;
  }

  /* ---------------------------------------------------- node factory mixin */
  var Maker = {
    noise: function (kind, rate) {
      var s = this.ctx.createBufferSource();
      s.buffer = getBuf(this.G, kind); s.loop = true;
      if (rate) s.playbackRate.value = rate;
      return this._src(s, Math.random() * s.buffer.duration);
    },
    ctl: function (speed, kind) {   // random modulator; speed 1 = 4 knots/s
      var s = this.ctx.createBufferSource();
      s.buffer = getBuf(this.G, kind || 'smooth'); s.loop = true; s.playbackRate.value = speed;
      return this._src(s, Math.random() * s.buffer.duration);
    },
    osc: function (type, f, det) {
      var o = this.ctx.createOscillator(); o.type = type || 'sine';
      if (f != null) o.frequency.value = f;
      if (det) o.detune.value = det;
      return this._src(o, 0);
    },
    filter: function (type, f, q) {
      var n = this.ctx.createBiquadFilter(); n.type = type; n.frequency.value = f;
      if (q != null) n.Q.value = q;
      return this._reg(n);
    },
    gain: function (v) { var n = this.ctx.createGain(); n.gain.value = v == null ? 1 : v; return this._reg(n); },
    pan: function (p) {
      if (!this.ctx.createStereoPanner) return this.gain(1);
      var n = this.ctx.createStereoPanner(); n.pan.value = p || 0; return this._reg(n);
    },
    chain: function () {
      for (var i = 1; i < arguments.length; i++) arguments[i - 1].connect(arguments[i]);
      return arguments[arguments.length - 1];
    },
    // ctl source → gain(depth) → one or more AudioParams
    drive: function (src, depth) {
      var g = this.gain(depth); src.connect(g);
      for (var i = 2; i < arguments.length; i++) g.connect(arguments[i]);
      return g;
    },
    _reg: function (n) { this.nodes.push(n); return n; }
  };
  function mixin(proto) { for (var k in Maker) if (Maker.hasOwnProperty(k)) proto[k] = Maker[k]; }

  /* ------------------------------------------------- Shot (one-shot voice) */
  function Shot(host, t, dur) {
    this.host = host; this.G = host.G; this.ctx = host.ctx;
    this.t = t; this.end = t + dur; this.nodes = []; this.srcs = [];
  }
  mixin(Shot.prototype);
  Shot.prototype._src = function (s, off) { s._off = off; this.srcs.push(s); return this._reg(s); };
  Shot.prototype.play = function () {
    var self = this, host = this.host;
    if (!this.srcs.length) { this.dispose(); return; }
    this.srcs.forEach(function (s) {
      try { s.start(self.t, s._off || 0); s.stop(self.end); } catch (e) { /* ignore */ }
    });
    this.srcs[this.srcs.length - 1].onended = function () { self.dispose(); };
    host.live.add(this);
  };
  Shot.prototype.dispose = function () {
    this.nodes.forEach(disc); this.nodes = []; this.srcs = [];
    this.host.live.delete(this);
  };
  Shot.prototype.kill = function () { this.srcs.forEach(function (s) { stopSafe(s); }); this.dispose(); };
  function hostShot(t, dur) { return new Shot(this, t, dur); }

  /* --------------------------------------------------------------- Scene */
  function Scene(G, type, t0, opt) {
    var c = G.ctx;
    this.G = G; this.ctx = c; this.type = type; this.t0 = t0;
    this.nodes = []; this.srcs = []; this.events = []; this.layers = []; this.live = new Set();
    this.solo = opt && opt.solo != null ? opt.solo : null;
    this.offline = !!(opt && opt.offline);
    this.level = LEVEL[type] || 1; this.wetLevel = 0.3;
    this.bus = c.createGain(); this.bus.gain.value = 0; this.bus.connect(G.mix);
    this.wet = c.createGain(); this.wet.gain.value = 0; this.wet.connect(G.verbIn);
  }
  mixin(Scene.prototype);
  Scene.prototype.shot = hostShot;
  Scene.prototype._src = function (s, off) {
    try { s.start(this.t0, off); } catch (e) { s.start(this.t0); }
    this.srcs.push(s); return this._reg(s);
  };
  // Route a layer to the scene: dry amount (1 = direct) and reverb send
  // (true = scene default wet level, number = extra gain).
  Scene.prototype.out = function (node, dry, wet) {
    var idx = this.layers.length; this.layers.push(node);
    if (this.solo != null && this.solo !== idx) return node;
    if (dry == null) dry = 1;
    if (dry === 1) node.connect(this.bus);
    else if (dry > 0) this.chain(node, this.gain(dry), this.bus);
    if (wet === true || wet === 1) node.connect(this.wet);
    else if (wet > 0) this.chain(node, this.gain(wet), this.wet);
    return node;
  };
  // Recurring event: fn(t) called for audio times t, every min..max seconds.
  Scene.prototype.every = function (min, max, fn, first) {
    this.events.push({ next: this.t0 + (first == null ? rnd(min, max) : first), min: min, max: max, fn: fn });
  };
  Scene.prototype.tick = function (now, horizon) {
    var cap = this.offline ? 1e5 : 200;
    for (var i = 0; i < this.events.length; i++) {
      var e = this.events[i], n = 0;
      if (e.next < now) e.next = now + rnd(0.02, 0.12);          // skip what we missed
      while (e.next < horizon && n++ < cap) {
        try { e.fn.call(this, e.next); } catch (err) { /* keep ticking */ }
        e.next += rnd(e.min, e.max);
      }
    }
  };
  Scene.prototype.kill = function () {
    if (this.dead) return;
    this.dead = true; this.events = [];
    this.srcs.forEach(function (s) { stopSafe(s); });
    this.live.forEach(function (sh) { sh.kill(); });
    this.nodes.forEach(disc); disc(this.bus); disc(this.wet);
    this.nodes = []; this.srcs = [];
  };

  /* ------------------------------------------------------ shared layers */
  // Wind: noise → filter; one random control drives loudness and pitch together
  // (a gust gets louder AND brighter, like the real thing).
  function windLayer(s, o) {
    var n = o.src || s.noise(o.kind || 'pink');
    var f = s.filter(o.type || 'bandpass', o.freq, o.q == null ? 0.8 : o.q);
    var g = s.gain(o.level * 0.55);
    s.chain(n, f, g);
    var c = o.ctl || s.ctl(o.speed || 0.1, o.ctlKind || 'gust');
    s.drive(c, o.level * 0.45, g.gain);
    if (o.sweep) s.drive(c, o.sweep, f.detune);
    s.out(g, o.dry == null ? 1 : o.dry, o.wet);
    return { src: n, filter: f, gain: g, ctl: c };
  }

  // Pad: detuned oscillator pairs → lowpass → slowly breathing gain.
  function padLayer(s, o) {
    var lp = s.filter('lowpass', o.lp || 2000, 0.4), g = s.gain(o.level), det = o.detune || 5;
    o.notes.forEach(function (f, i) {
      s.osc(o.wave || 'sine', f, -det - i).connect(lp);
      if (!o.single) s.osc(o.wave2 || o.wave || 'sine', f, det + i * 0.7).connect(lp);
    });
    lp.connect(g);
    if (o.swell) s.drive(s.ctl(o.swellSpeed || 0.03, 'smooth'), o.level * o.swell, g.gain);
    s.out(g, o.dry == null ? 0.4 : o.dry, o.wet == null ? true : o.wet);
    return g;
  }

  /* ----------------------------------------------- one-shot sound events */
  // Each takes (host, t, dest, amp): host = scene or the sfx host.

  function bubble(h, t, f, dur, amp, dest) {
    var sh = h.shot(t, dur + 0.03), o = sh.osc('sine', null), g = sh.gain(0);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * rnd(1.5, 2.6), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sh.chain(o, g, dest); sh.play();
  }

  function drip(h, t, dest, amp) {
    var f = rnd(900, 1900), sh = h.shot(t, 0.14), o = sh.osc('sine', null), g = sh.gain(0);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * rnd(1.7, 2.4), t + 0.035);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    sh.chain(o, g, dest); sh.play();
  }

  // Golden-plover-like plaintive whistle.
  function whistleBird(h, t, dest, amp) {
    var d = rnd(0.34, 0.55), f = rnd(2300, 2800), sh = h.shot(t, d + 0.05);
    var o = sh.osc('sine', null), g = sh.gain(0);
    o.frequency.setValueAtTime(f * 0.9, t);
    o.frequency.linearRampToValueAtTime(f * 1.1, t + d * 0.35);
    o.frequency.linearRampToValueAtTime(f * 0.94, t + d);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + d * 0.2);
    g.gain.setValueAtTime(amp, t + d * 0.6);
    g.gain.linearRampToValueAtTime(0, t + d);
    sh.chain(o, g, dest); sh.play();
  }

  // Small songbird trill: a row of FM chirps.
  function trill(h, t, dest, amp) {
    var n = irnd(3, 7), step = rnd(0.07, 0.11), base = rnd(3000, 4200), sh = h.shot(t, n * step + 0.08);
    var o = sh.osc('sine', base), m = sh.osc('sine', rnd(28, 45)), mg = sh.gain(base * 0.05), g = sh.gain(0);
    m.connect(mg); mg.connect(o.frequency); sh.chain(o, g, dest);
    for (var i = 0; i < n; i++) {
      var ti = t + i * step;
      o.frequency.setValueAtTime(base * rnd(0.95, 1.05), ti);
      o.frequency.exponentialRampToValueAtTime(base * rnd(1.15, 1.3), ti + step * 0.7);
      g.gain.setValueAtTime(0, ti);
      g.gain.linearRampToValueAtTime(amp * rnd(0.6, 1), ti + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0005, ti + step * 0.8);
    }
    sh.play();
  }

  // Distant gull: nasal FM "kee-ow" calls.
  function gull(h, t, dest, amp) {
    var calls = irnd(2, 4), gap = rnd(0.32, 0.45), sh = h.shot(t, calls * gap + 0.45);
    var c = sh.osc('sawtooth', null), m = sh.osc('sine', rnd(70, 110)), mg = sh.gain(rnd(30, 70));
    var bp = sh.filter('bandpass', 1500, 1.6), lp = sh.filter('lowpass', 3600, 0.5), g = sh.gain(0);
    m.connect(mg); mg.connect(c.frequency); sh.chain(c, bp, lp, g, dest);
    var base = rnd(620, 820);
    for (var i = 0; i < calls; i++) {
      var ti = t + i * gap, len = rnd(0.22, 0.3) * (i === calls - 1 ? 1.3 : 1), a = amp * rnd(0.7, 1);
      c.frequency.setValueAtTime(base * 0.85, ti);
      c.frequency.linearRampToValueAtTime(base * 1.35, ti + 0.05);
      c.frequency.exponentialRampToValueAtTime(base * 0.95, ti + len);
      g.gain.setValueAtTime(0, ti);
      g.gain.linearRampToValueAtTime(a, ti + 0.03);
      g.gain.setValueAtTime(a, ti + len * 0.6);
      g.gain.linearRampToValueAtTime(0, ti + len);
    }
    sh.play();
  }

  // Faint auroral crackle: a cluster of tiny clicks gated out of white noise.
  function crackle(h, t, dest, amp) {
    var dur = rnd(0.3, 1.1), k = irnd(4, 14), sh = h.shot(t, dur + 0.05);
    var n = sh.noise('white'), g = sh.gain(0), times = [];
    for (var i = 0; i < k; i++) times.push(rnd(0, dur));
    times.sort(function (a, b) { return a - b; });
    times.forEach(function (dt) {
      g.gain.setValueAtTime(amp * rnd(0.25, 1), t + dt);
      g.gain.setTargetAtTime(0, t + dt + 0.0008, rnd(0.0008, 0.003));
    });
    sh.chain(n, g, dest); sh.play();
  }

  // Ice / glass tinkle: two inharmonic partials, quick decay.
  function tinkle(h, t, dest, amp) {
    var f = rnd(2000, 4200), d = rnd(0.12, 0.35), sh = h.shot(t, d + 0.03);
    var o1 = sh.osc('sine', f), o2 = sh.osc('sine', f * 2.32), g2 = sh.gain(0.35), g = sh.gain(0);
    o1.connect(g); sh.chain(o2, g2, g); g.connect(dest);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    sh.play();
  }

  // Ice creak: a slow, wandering click train ringing two resonances.
  function creak(h, t, dest, amp) {
    var d = rnd(0.7, 1.9), sh = h.shot(t, d + 0.15), o = sh.osc('sawtooth', null);
    var N = 24, cv = new Float32Array(N), f = rnd(14, 32);
    for (var i = 0; i < N; i++) { f = clamp(f + rnd(-5, 5), 7, 48); cv[i] = f; }
    try { o.frequency.setValueCurveAtTime(cv, t, d); } catch (e) {
      o.frequency.setValueAtTime(cv[0], t); o.frequency.linearRampToValueAtTime(cv[N - 1], t + d);
    }
    var b1 = sh.filter('bandpass', rnd(260, 520), rnd(5, 9)), b2 = sh.filter('bandpass', rnd(900, 1500), rnd(4, 7));
    var g2 = sh.gain(0.5), g = sh.gain(0);
    o.connect(b1); o.connect(b2); b1.connect(g); sh.chain(b2, g2, g); g.connect(dest);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + d * 0.25);
    g.gain.linearRampToValueAtTime(amp * rnd(0.5, 0.9), t + d * 0.7);
    g.gain.linearRampToValueAtTime(0, t + d);
    sh.play();
  }

  // Deep glacier crack: sharp snaps + low boom + rumble tail.
  function iceCrack(h, t, dest, amp) {
    var sh = h.shot(t, 3.2);
    var n = sh.noise('white'), hp = sh.filter('highpass', 700, 0.6), lp = sh.filter('lowpass', 5200, 0.5), g = sh.gain(0);
    var times = [0], x = 0, k = irnd(2, 6), i;
    for (i = 0; i < k; i++) { x += rnd(0.025, 0.22); times.push(x); }
    times.forEach(function (dt, j) {
      g.gain.setValueAtTime(amp * (j ? rnd(0.25, 0.8) : 1.6), t + dt);
      g.gain.setTargetAtTime(0.0001, t + dt + 0.002, j ? rnd(0.008, 0.03) : 0.035);
    });
    sh.chain(n, hp, lp, g, dest);
    var o = sh.osc('sine', null), og = sh.gain(0);
    o.frequency.setValueAtTime(rnd(75, 95), t);
    o.frequency.exponentialRampToValueAtTime(rnd(30, 38), t + 1.6);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(amp * 0.6, t + 0.015);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    sh.chain(o, og, dest);
    var b = sh.noise('brown'), bl = sh.filter('lowpass', 260, 0.7), bg = sh.gain(0);
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(amp * 0.5, t + 0.05);
    bg.gain.setTargetAtTime(0, t + 0.1, 0.7);
    sh.chain(b, bl, bg, dest);
    sh.play();
  }

  // Strokkur-style eruption: dome swell + "whoomp", jet hiss, falling water.
  function geyserBurst(h, t, dest, amp) {
    var sh = h.shot(t, 7.2);
    var r = sh.noise('brown'), rl = sh.filter('lowpass', 90, 0.8), rg = sh.gain(0);
    rl.frequency.setValueAtTime(90, t);
    rl.frequency.linearRampToValueAtTime(260, t + 1.2);
    rl.frequency.setTargetAtTime(110, t + 1.4, 0.8);
    rg.gain.setValueAtTime(0, t);
    rg.gain.linearRampToValueAtTime(amp * 1.1, t + 1.1);
    rg.gain.setTargetAtTime(0, t + 1.3, 0.6);
    sh.chain(r, rl, rg, dest);

    var o = sh.osc('sine', null), og = sh.gain(0);
    o.frequency.setValueAtTime(48, t);
    o.frequency.setValueAtTime(48, t + 0.9);
    o.frequency.exponentialRampToValueAtTime(90, t + 1.12);
    o.frequency.exponentialRampToValueAtTime(40, t + 1.8);
    og.gain.setValueAtTime(0, t + 0.9);
    og.gain.linearRampToValueAtTime(amp * 0.8, t + 1.0);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
    sh.chain(o, og, dest);

    var j = sh.noise('white'), jb = sh.filter('bandpass', 600, 0.6), jg = sh.gain(0);
    jb.frequency.setValueAtTime(600, t + 1.1);
    jb.frequency.exponentialRampToValueAtTime(2400, t + 1.6);
    jb.frequency.exponentialRampToValueAtTime(900, t + 4.2);
    jg.gain.setValueAtTime(0, t + 1.1);
    jg.gain.linearRampToValueAtTime(amp * 0.9, t + 1.22);
    jg.gain.setTargetAtTime(0, t + 1.5, 0.9);
    sh.chain(j, jb, jg, dest);

    var f = sh.noise('pink'), fb = sh.filter('bandpass', 2200, 0.5), fg = sh.gain(0);
    fg.gain.setValueAtTime(0, t + 2.2);
    fg.gain.linearRampToValueAtTime(amp * 0.5, t + 3.0);
    fg.gain.setTargetAtTime(0, t + 3.4, 1.0);
    sh.chain(f, fb, fg, dest);
    sh.play();
  }

  // Far-off church bell (Hallgrímskirkja vibes).
  function bell(h, t, dest, amp) {
    var f = rnd(230, 262), sh = h.shot(t, 6.2);
    [[0.5, 1, 6], [1, 0.8, 4.2], [1.2, 0.5, 3.2], [1.5, 0.32, 2.6], [2, 0.3, 2], [2.74, 0.14, 1.2]].forEach(function (p) {
      var o = sh.osc('sine', f * p[0]), g = sh.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp * p[1], t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p[2]);
      sh.chain(o, g, dest);
    });
    sh.play();
  }

  // Oncoming car passing on the left (Iceland drives on the right).
  function passCar(h, t, dest, amp) {
    var d = rnd(2.4, 3.6), sh = h.shot(t, d + 0.1);
    var n = sh.noise('pink'), bp = sh.filter('bandpass', 380, 0.9), pn = sh.pan(-0.2), g = sh.gain(0);
    if (pn.pan) { pn.pan.setValueAtTime(-0.15, t); pn.pan.linearRampToValueAtTime(-0.8, t + d); }
    bp.frequency.setValueAtTime(380, t);
    bp.frequency.exponentialRampToValueAtTime(1300, t + d * 0.48);
    bp.frequency.exponentialRampToValueAtTime(420, t + d);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + d * 0.5);
    g.gain.linearRampToValueAtTime(0, t + d);
    sh.chain(n, bp, g, pn, dest); sh.play();
  }

  /* ---------------------------------------------------------- recipes */
  var RECIPES = {
    // Deep wind + very soft high shimmer (aurora over the hero).
    hero: function (s) {
      s.wetLevel = 0.5;
      windLayer(s, { kind: 'brown', type: 'lowpass', freq: 320, q: 0.5, level: 0.7, speed: 0.07, sweep: 500, wet: true });
      windLayer(s, { kind: 'pink', freq: 750, q: 0.6, level: 0.38, speed: 0.1, sweep: 900, wet: true });
      padLayer(s, { notes: [493.88, 739.99, 1108.73], level: 0.007, lp: 3000, detune: 6, swell: 0.6, swellSpeed: 0.04, dry: 0.5, wet: true });
    },

    // Broadband roar 300 Hz–2 kHz with flutter, spray, body, distant birds.
    waterfall: function (s) {
      s.wetLevel = 0.35;
      var n = s.noise('pink'), hp = s.filter('highpass', 280, 0.6), lp = s.filter('lowpass', 2100, 0.5), g = s.gain(0.9);
      s.chain(n, hp, lp, g);
      var c = s.ctl(1.4, 'smooth'); s.drive(c, 0.12, g.gain); s.drive(c, 220, lp.detune);
      s.drive(s.ctl(0.06, 'smooth'), 0.18, g.gain);
      s.out(g, 1, true);
      var w = s.noise('white'), bp = s.filter('bandpass', 3400, 0.7), g2 = s.gain(0.3);
      s.chain(w, bp, g2); s.drive(s.ctl(3.5, 'smooth'), 0.12, g2.gain); s.out(g2, 1, true);
      var b = s.noise('brown'), bl = s.filter('lowpass', 170, 0.7), g3 = s.gain(0.5);
      s.chain(b, bl, g3); s.out(g3);
      var bird = s.gain(1), bp2 = s.pan(0); s.chain(bird, bp2); s.out(bp2, 0.5, true);
      s.every(4, 11, function (t) {
        if (bp2.pan) bp2.pan.setValueAtTime(rnd(-0.7, 0.7), t);
        if (Math.random() < 0.55) whistleBird(s, t, bird, rnd(0.05, 0.08));
        else trill(s, t, bird, rnd(0.04, 0.07));
      }, 2.5);
    },

    // Gurgling hot water + an eruption every 7 s (dispatches 'ambient:geyser').
    geyser: function (s) {
      s.wetLevel = 0.3;
      var b = s.noise('brown'), bb = s.filter('bandpass', 160, 0.9), bg = s.gain(0.3);
      s.chain(b, bb, bg); s.drive(s.ctl(0.5, 'smooth'), 0.15, bg.gain); s.out(bg);
      var w = s.noise('white'), wh = s.filter('highpass', 3500, 0.5), wg = s.gain(0.06);
      s.chain(w, wh, wg); s.drive(s.ctl(0.3, 'smooth'), 0.03, wg.gain); s.out(wg, 1, true);
      var bub = s.filter('lowpass', 1100, 0.5), bubg = s.gain(1); s.chain(bub, bubg); s.out(bubg, 1, 0.5);
      s.every(0.06, 0.24, function (t) { bubble(s, t, rnd(120, 420), rnd(0.05, 0.13), rnd(0.06, 0.18), bub); });
      var fx = s.gain(1); s.out(fx, 1, true);
      s.every(7, 7, function (t) {
        geyserBurst(s, t, fx, 0.8);
        if (!s.offline) {
          var ms = (t + 1.15 - s.ctx.currentTime) * 1000;
          setTimeout(function () { if (!s.dead) emit('ambient:geyser', {}); }, Math.max(0, ms));
        }
      }, 2.5);
    },

    // Silent-night wind, ethereal pad, faint crackle.
    aurora: function (s) {
      s.wetLevel = 0.6;
      windLayer(s, { kind: 'pink', type: 'lowpass', freq: 420, q: 0.4, level: 0.45, speed: 0.05, sweep: 500, wet: true });
      padLayer(s, { notes: [293.66, 440, 659.25], level: 0.016, lp: 2600, detune: 7, swell: 0.7, swellSpeed: 0.03, dry: 0.35, wet: true });
      var sh = s.gain(0.006);
      s.osc('sine', 1318.51, 3).connect(sh); s.osc('sine', 1760, -4).connect(sh);
      s.drive(s.ctl(0.3, 'smooth'), 0.006, sh.gain); s.out(sh, 0, true);
      var cb = s.filter('highpass', 2200, 0.5); s.out(cb, 1, 0.6);
      s.every(5, 13, function (t) { crackle(s, t, cb, rnd(0.08, 0.18)); }, 3);
    },

    // Geothermal pool: hiss, warm water, bubbling.
    steam: function (s) {
      s.wetLevel = 0.3;
      var w = s.noise('white'), hp = s.filter('highpass', 2600, 0.5), g = s.gain(0.1);
      s.chain(w, hp, g);
      var c = s.ctl(0.35, 'smooth'); s.drive(c, 0.05, g.gain); s.drive(c, 300, hp.detune);
      s.out(g, 1, true);
      var b = s.noise('brown'), bl = s.filter('lowpass', 420, 0.6), bg = s.gain(0.22);
      s.chain(b, bl, bg); s.drive(s.ctl(0.25, 'smooth'), 0.1, bg.gain); s.out(bg);
      var p = s.noise('pink'), pb = s.filter('bandpass', 650, 1.1), pg = s.gain(0.19);
      s.chain(p, pb, pg); s.drive(s.ctl(0.9, 'gust'), 0.16, pg.gain); s.out(pg, 1, true);
      var bub = s.filter('lowpass', 2400, 0.5), bubg = s.gain(1); s.chain(bub, bubg); s.out(bubg, 1, 0.5);
      s.every(0.12, 0.55, function (t) { bubble(s, t, rnd(260, 900), rnd(0.025, 0.07), rnd(0.04, 0.12), bub); });
      s.every(2.5, 6, function (t) {
        for (var k = irnd(3, 7), i = 0; i < k; i++) bubble(s, t + i * rnd(0.05, 0.12), rnd(160, 360), rnd(0.06, 0.12), rnd(0.1, 0.2), bub);
      });
    },

    // Atlantic surf on black pebbles: swell sets, backwash hiss, gulls.
    waves: function (s) {
      s.wetLevel = 0.3;
      var b = s.noise('brown'), bl = s.filter('lowpass', 240, 0.5), bg = s.gain(0.35);
      s.chain(b, bl, bg); s.drive(s.ctl(0.06, 'smooth'), 0.15, bg.gain); s.out(bg);
      var V = [-0.35, 0.35].map(function (p) {
        var n = s.noise('pink'), lp = s.filter('lowpass', 350, 0.7), g = s.gain(0.02), pn = s.pan(p);
        s.chain(n, lp, g, pn); s.out(pn, 1, true);
        return { lp: lp, g: g };
      });
      var w = s.noise('white'), fb = s.filter('bandpass', 2600, 0.6), fg = s.gain(0.006);
      s.chain(w, fb, fg); s.out(fg, 1, true);
      var idx = 0;
      s.every(6, 9, function (t) {
        var v = V[idx++ % 2], rise = rnd(1.8, 2.8), pk = rnd(0.55, 1), crash = t + rise;
        v.g.gain.setTargetAtTime(pk * 0.55, t, rise / 2.2);
        v.lp.frequency.setTargetAtTime(rnd(900, 1500), t, rise / 2);
        v.g.gain.setTargetAtTime(pk, crash, 0.12);
        v.lp.frequency.setTargetAtTime(rnd(2400, 3600), crash, 0.15);
        v.g.gain.setTargetAtTime(0.02, crash + 0.5, rnd(1.1, 1.7));
        v.lp.frequency.setTargetAtTime(320, crash + 0.6, 1.4);
        fg.gain.setTargetAtTime(pk * rnd(0.25, 0.4), crash + 0.5, 0.4);
        fb.frequency.setTargetAtTime(rnd(2800, 3600), crash + 0.5, 0.3);
        fg.gain.setTargetAtTime(0.006, crash + 1.6, rnd(1, 1.6));
        fb.frequency.setTargetAtTime(1800, crash + 1.6, 1.5);
      }, 0.4);
      var gb = s.gain(1), gp = s.pan(0); s.chain(gb, gp); s.out(gp, 0.5, true);
      s.every(9, 22, function (t) {
        if (gp.pan) gp.pan.setValueAtTime(rnd(-0.8, 0.8), t);
        gull(s, t, gb, rnd(0.1, 0.18));
      }, 4);
    },

    drift: function (s) { icescape(s, false); },
    ice: function (s) { icescape(s, true); },

    // Highland snow: muffled wind only (plus the faintest sizzle on gusts).
    snow: function (s) {
      s.wetLevel = 0.25;
      var w = windLayer(s, { kind: 'pink', type: 'lowpass', freq: 480, q: 0.5, level: 0.6, speed: 0.06, sweep: 450, wet: true });
      var b = s.noise('brown'), bl = s.filter('lowpass', 200, 0.5), bg = s.gain(0.12);
      s.chain(b, bl, bg); s.out(bg);
      var h = s.noise('white'), hh = s.filter('highpass', 5500, 0.5), hg = s.gain(0.02);
      s.chain(h, hh, hg); s.drive(w.ctl, 0.02, hg.gain); s.out(hg, 1, true);
    },

    // Fog in a canyon: soft wind + a distant low drone.
    mist: function (s) {
      s.wetLevel = 0.55;
      windLayer(s, { kind: 'pink', freq: 460, q: 0.6, level: 0.3, speed: 0.05, ctlKind: 'smooth', sweep: 500, wet: true });
      var lp = s.filter('lowpass', 320, 0.5), g = s.gain(0.022);
      [55, 82.41, 110, 164.81].forEach(function (f, i) { s.osc(i === 2 ? 'triangle' : 'sine', f, rnd(-4, 4)).connect(lp); });
      lp.connect(g); s.drive(s.ctl(0.025, 'smooth'), 0.01, g.gain); s.out(g, 0.6, true);
    },

    // Stream babble: resonant filters jittered by fast random control + plinks.
    ripple: function (s) {
      s.wetLevel = 0.25;
      var w = s.noise('white');
      var rb = s.filter('bandpass', 1100, 0.5), rg = s.gain(0.09); s.chain(w, rb, rg); s.out(rg, 1, true);
      [[650, 7, 6.5, 1.5, 'gust'], [1500, 8, 8.5, 0.9, 'smooth']].forEach(function (v) {
        var bp = s.filter('bandpass', v[0], v[1]), g = s.gain(v[3]);
        s.chain(w, bp, g);
        s.drive(s.ctl(v[2], 'smooth'), 1100, bp.detune);
        s.drive(s.ctl(v[2] * 0.8, v[4]), v[3], g.gain);
        s.out(g, 1, true);
      });
      var b = s.noise('brown'), bl = s.filter('lowpass', 380, 0.5), bg = s.gain(0.2); s.chain(b, bl, bg); s.out(bg);
      var pb = s.gain(1); s.out(pb, 0.7, true);
      s.every(0.1, 0.45, function (t) { bubble(s, t, rnd(500, 1500), rnd(0.02, 0.05), rnd(0.016, 0.05), pb); });
    },

    // Reykjavík evening: distant murmur, low traffic, warm pad, far bell.
    city: function (s) {
      s.wetLevel = 0.45;
      var p = s.noise('pink'), mb = s.filter('lowpass', 1900, 0.5), mg = s.gain(0.85);
      mb.connect(mg); s.out(mg, 1, true);
      [[480, 1.4, 4.2], [1250, 1.8, 5.1]].forEach(function (v) {
        var bp = s.filter('bandpass', v[0], v[1]), g = s.gain(0.12);
        s.chain(p, bp, g, mb); s.drive(s.ctl(v[2], 'smooth'), 0.1, g.gain);
      });
      windLayer(s, { kind: 'brown', type: 'lowpass', freq: 170, q: 0.5, level: 0.22, speed: 0.08, ctlKind: 'smooth', wet: false });
      padLayer(s, { notes: [130.81, 196, 329.63], level: 0.02, wave: 'triangle', lp: 700, detune: 4, single: true, dry: 0.7, wet: true });
      var bb = s.gain(1); s.out(bb, 0.25, true);
      s.every(30, 65, function (t) { bell(s, t, bb, rnd(0.07, 0.11)); }, 10);
    },

    // Golden hour: warm Dmaj9 pad + soft wind.
    sunset: function (s) {
      s.wetLevel = 0.5;
      windLayer(s, { kind: 'pink', freq: 600, q: 0.6, level: 0.22, speed: 0.06, ctlKind: 'smooth', sweep: 500, wet: true });
      padLayer(s, { notes: [146.83, 220, 329.63, 369.99], level: 0.025, wave: 'triangle', wave2: 'sine', lp: 1200, detune: 5, swell: 0.5, swellSpeed: 0.035, dry: 0.6, wet: true });
    },

    // Ring Road, inside the car: engine hum, tyre rumble, road noise, passing cars.
    drive: function (s) {
      s.wetLevel = 0.08;
      var lp = s.filter('lowpass', 210, 1.2), eg = s.gain(0.03);
      var o1 = s.osc('sawtooth', 66), o2 = s.osc('triangle', 133);
      o1.connect(lp); o2.connect(lp); lp.connect(eg);
      s.drive(s.ctl(0.12, 'smooth'), 35, o1.detune, o2.detune);
      s.out(eg);
      windLayer(s, { kind: 'brown', type: 'lowpass', freq: 150, q: 0.6, level: 0.22, speed: 0.6, ctlKind: 'smooth', wet: false });
      windLayer(s, { kind: 'pink', freq: 700, q: 0.45, level: 0.26, speed: 0.12, ctlKind: 'smooth', wet: false });
      var pb = s.gain(1); s.out(pb);
      s.every(9, 22, function (t) { passCar(s, t, pb, rnd(0.09, 0.16)); }, 5);
    },

    // Cabin hum: lowpassed brown noise, air-con hiss, faint engine drone.
    flight: function (s) {
      s.wetLevel = 0.05;
      var b = s.noise('brown'), bl = s.filter('lowpass', 400, 0.6), bg = s.gain(0.45);
      s.chain(b, bl, bg); s.drive(s.ctl(0.05, 'smooth'), 0.05, bg.gain); s.out(bg);
      var p = s.noise('pink'), ph = s.filter('highpass', 180, 0.5), pl = s.filter('lowpass', 1400, 0.5), pg = s.gain(0.19);
      s.chain(p, ph, pl, pg); s.out(pg);
      var og = s.gain(0.017);
      s.osc('sine', 96).connect(og); s.osc('sine', 96.7).connect(og); s.osc('triangle', 192.4).connect(og);
      s.out(og);
    },

    // Open plains: gusts, a whistle on the gust peaks, grass rustle.
    wind: function (s) {
      s.wetLevel = 0.3;
      var w = windLayer(s, { kind: 'pink', freq: 400, q: 0.7, level: 0.55, speed: 0.09, sweep: 700, wet: true });
      var wb = s.filter('bandpass', 1150, 9), wg = s.gain(0.2);
      s.chain(w.src, wb, wg); s.drive(w.ctl, 0.2, wg.gain); s.drive(w.ctl, 400, wb.detune); s.out(wg, 1, true);
      var r = s.noise('white'), rb = s.filter('bandpass', 4200, 0.5), rg = s.gain(0.06);
      s.chain(r, rb, rg); s.drive(w.ctl, 0.06, rg.gain); s.out(rg);
      var b = s.noise('brown'), bl = s.filter('lowpass', 160, 0.5), bg = s.gain(0.15);
      s.chain(b, bl, bg); s.drive(w.ctl, 0.1, bg.gain); s.out(bg);
    }
  };

  // Glacier lagoon (drift) / blue ice cave (ice).
  function icescape(s, cave) {
    s.wetLevel = cave ? 0.65 : 0.4;
    windLayer(s, { kind: 'pink', type: 'lowpass', freq: cave ? 380 : 520, q: 0.4, level: cave ? 0.14 : 0.3, speed: 0.05, sweep: 400, wet: true });
    if (!cave) {
      var p = s.noise('pink'), bp = s.filter('bandpass', 520, 0.8), g = s.gain(0.04);
      s.chain(p, bp, g); s.out(g, 1, true);
      s.every(0.6, 1.9, function (t) {
        g.gain.setTargetAtTime(rnd(0.14, 0.36), t, 0.05);
        g.gain.setTargetAtTime(0.04, t + rnd(0.12, 0.25), rnd(0.25, 0.45));
        bp.detune.setTargetAtTime(rnd(-400, 300), t, 0.1);
      });
    } else {
      windLayer(s, { kind: 'pink', freq: 880, q: 9, level: 0.35, speed: 0.08, sweep: 300, dry: 0.6, wet: true });
      var db = s.gain(1); s.out(db, 0.4, true);
      s.every(0.9, 3.2, function (t) { drip(s, t, db, rnd(0.03, 0.08)); });
    }
    var tb = s.gain(1), tp = s.pan(0); s.chain(tb, tp); s.out(tp, 0.6, true);
    s.every(cave ? 1 : 1.6, cave ? 3.5 : 5, function (t) {
      if (tp.pan) tp.pan.setValueAtTime(rnd(-0.7, 0.7), t);
      for (var k = irnd(1, 4), i = 0; i < k; i++) tinkle(s, t + i * rnd(0.06, 0.2), tb, rnd(0.012, 0.035));
    });
    var cb = s.gain(1); s.out(cb, 0.7, true);
    s.every(cave ? 6 : 9, cave ? 15 : 22, function (t) {
      if (Math.random() < (cave ? 0.3 : 0.4)) iceCrack(s, t, cb, rnd(0.08, 0.18));
      else creak(s, t, cb, rnd(0.05, 0.1));
    }, cave ? 4 : 6);
  }

  function build(G, type, t0, opt) {
    var s = new Scene(G, type, t0, opt);
    RECIPES[type](s);
    return s;
  }

  /* -------------------------------------------------------------- SFX */
  var SFX = {
    whoosh: function (h, t, dest) {
      var d = 1.1, sh = h.shot(t, d + 0.1), n = sh.noise('pink'), bp = sh.filter('bandpass', 260, 1.1), pn = sh.pan(0), g = sh.gain(0);
      bp.frequency.setValueAtTime(260, t);
      bp.frequency.exponentialRampToValueAtTime(2400, t + d * 0.45);
      bp.frequency.exponentialRampToValueAtTime(500, t + d);
      if (pn.pan) { pn.pan.setValueAtTime(-0.6, t); pn.pan.linearRampToValueAtTime(0.6, t + d); }
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1.4, t + d * 0.42);
      g.gain.linearRampToValueAtTime(0, t + d);
      sh.chain(n, bp, g, pn, dest); sh.play();
    },
    chime: function (h, t, dest) {
      var f = [1318.51, 1567.98, 1760][irnd(0, 2)], sh = h.shot(t, 1.2);
      var o1 = sh.osc('sine', f), o2 = sh.osc('sine', f * 1.5), g1 = sh.gain(0), g2 = sh.gain(0);
      g1.gain.setValueAtTime(0, t); g1.gain.linearRampToValueAtTime(0.18, t + 0.004); g1.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.055, t + 0.004); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      sh.chain(o1, g1, dest); sh.chain(o2, g2, dest); sh.play();
    },
    splash: function (h, t, dest) {
      var sh = h.shot(t, 1.2), n = sh.noise('white'), lp = sh.filter('lowpass', 7000, 0.6), g = sh.gain(0);
      lp.frequency.setValueAtTime(7000, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.6);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.4, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      sh.chain(n, lp, g, dest);
      var o = sh.osc('sine', null), og = sh.gain(0);
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
      og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(1.2, t + 0.006); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      sh.chain(o, og, dest); sh.play();
      for (var i = irnd(4, 7); i > 0; i--) bubble(h, t + rnd(0.08, 0.7), rnd(380, 1300), rnd(0.03, 0.08), rnd(0.1, 0.2), dest);
    },
    crack: function (h, t, dest) { iceCrack(h, t, dest, 1.4); },
    geyser: function (h, t, dest) { geyserBurst(h, t, dest, 1.4); },
    // extras (handy for world pages)
    creak: function (h, t, dest) { creak(h, t, dest, 2); },
    bird: function (h, t, dest) { whistleBird(h, t, dest, 0.085); },
    gull: function (h, t, dest) { gull(h, t, dest, 0.25); },
    bell: function (h, t, dest) { bell(h, t, dest, 0.3); },
    tinkle: function (h, t, dest) { tinkle(h, t, dest, 0.2); },
    drip: function (h, t, dest) { drip(h, t, dest, 0.3); },
    bubble: function (h, t, dest) { bubble(h, t, rnd(300, 900), 0.06, 0.5, dest); }
  };

  /* ------------------------------------------------------------ engine */
  var G = null, sfxHost = null, cur = null, dying = [], wanted = 'hero';
  var on = false, pref = null, ticker = 0, suspendT = 0, armed = false, worldMode = false;
  var vol = VOLUME, btn = null, inited = false, lastSig = '';

  function loadPref() { try { return root.localStorage.getItem(KEY); } catch (e) { return null; } }
  function savePref(v) { pref = v; try { root.localStorage.setItem(KEY, v); } catch (e) { /* private mode */ } }

  function ensure() {
    if (G) return G;
    if (!AC) return null;
    try {
      var c;
      try { c = new AC({ latencyHint: 'playback' }); } catch (e) { c = new AC(); }
      G = makeGraph(c);
      sfxHost = { G: G, ctx: c, live: new Set(), shot: hostShot };
      c.onstatechange = onState;
    } catch (e) {
      G = null; AC = null;
    }
    return G;
  }

  function playing() { return !!(on && G && G.ctx.state === 'running'); }

  function switchTo(type) {
    if (!G) return;
    if (cur && cur.type === type) return;
    if (!cur && type === 'none') return;
    var now = G.ctx.currentTime;
    if (cur) retire(cur, now);
    cur = null;
    if (type !== 'none') {
      for (var i = 0; i < dying.length; i++) {
        if (dying[i].type === type) {          // scrolled back: revive the fading copy
          cur = dying.splice(i, 1)[0]; clearTimeout(cur.timer); fadeIn(cur, now);
          break;
        }
      }
      if (!cur) {
        try { cur = build(G, type, now + 0.03); } catch (e) { cur = null; }
        if (cur) { fadeIn(cur, now); cur.tick(now, now + LOOKAHEAD); }
      }
    }
    render();
  }
  function fadeIn(s, now) {
    glide(s.bus.gain, s.level, FADE, now);
    glide(s.wet.gain, s.level * s.wetLevel, FADE, now);
  }
  function retire(s, now) {
    var d = FADE * 1.15;
    glide(s.bus.gain, 0, d, now); glide(s.wet.gain, 0, d, now);
    s.timer = setTimeout(function () {
      var i = dying.indexOf(s); if (i >= 0) dying.splice(i, 1);
      s.kill();
    }, (d + 0.4) * 1000);
    dying.push(s);
    while (dying.length > 2) {                 // fast scrolling: drop the oldest quickly
      var o = dying.shift(); clearTimeout(o.timer);
      glide(o.bus.gain, 0, 0.12, now); glide(o.wet.gain, 0, 0.12, now);
      setTimeout(o.kill.bind(o), 250);
    }
  }

  function tick() {
    if (!G || !cur || G.ctx.state !== 'running') return;
    var now = G.ctx.currentTime;
    cur.tick(now, now + LOOKAHEAD);
  }
  function startTicker() { if (!ticker) ticker = setInterval(tick, TICK_MS); }
  function stopTicker() { if (ticker) clearInterval(ticker); ticker = 0; }

  function unlockIOS(c) {   // play one silent sample inside the gesture
    try { var s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, c.sampleRate); s.connect(c.destination); s.start(0); } catch (e) { /* ignore */ }
  }

  function play(internal) {
    if (!AC) return false;
    on = true;
    if (internal !== true) savePref('1');
    var ua = root.navigator && root.navigator.userActivation;
    if (ua && !ua.isActive && !ua.hasBeenActive) { arm(); render(); return true; }   // wait for a gesture
    var g = ensure();
    if (!g) { on = false; render(); return false; }
    clearTimeout(suspendT);
    if (g.ctx.state !== 'running') {
      unlockIOS(g.ctx);
      try { var p = g.ctx.resume(); if (p && p.then) p.then(afterResume, function () { arm(); }); } catch (e) { /* ignore */ }
    }
    afterResume();
    return true;
  }
  function afterResume() {
    if (!G || !on) return;
    var c = G.ctx;
    if (c.state === 'running') {
      disarm();
      if (!doc || !doc.hidden) glide(G.master.gain, vol, 1.6, c.currentTime);
      switchTo(wanted);
      startTicker();
    } else {
      arm();
    }
    render();
  }

  function pause(internal) {
    on = false;
    if (internal !== true) savePref('0');
    disarm(); stopTicker();
    if (G) {
      var c = G.ctx;
      glide(G.master.gain, 0, 0.6, c.currentTime);
      clearTimeout(suspendT);
      suspendT = setTimeout(function () {
        if (!on && c.state === 'running') { try { c.suspend(); } catch (e) { /* ignore */ } }
      }, 700);
    }
    render();
    return true;
  }

  function onVisibility() {
    if (!G || !on) return;
    var c = G.ctx;
    if (doc.hidden) {
      glide(G.master.gain, 0, 0.25, c.currentTime);
      clearTimeout(suspendT);
      suspendT = setTimeout(function () {
        if (doc.hidden && c.state === 'running') { try { c.suspend(); } catch (e) { /* ignore */ } }
      }, 320);
    } else {
      clearTimeout(suspendT);
      try {
        var p = c.resume();
        if (p && p.then) p.then(afterResume, function () { arm(); });
        else afterResume();
      } catch (e) { arm(); }
    }
  }

  function onState() {
    render();
    if (G && on && doc && !doc.hidden && G.ctx.state !== 'running' && G.ctx.state !== 'closed') arm();
  }

  /* ---------------------------------------------- gesture (autoplay) gate */
  var GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'];
  function wantsAuto() { return on || pref === '1' || (worldMode && pref !== '0'); }
  function onGesture(e) {
    if (btn && e.target && btn.contains && btn.contains(e.target)) return;  // the pill handles itself
    if (e.type === 'keydown' && (e.key === 'Escape' || e.key === 'Tab' || e.metaKey || e.ctrlKey || e.altKey)) return;
    if (!wantsAuto()) { disarm(); return; }
    play(true);
  }
  function arm() {
    if (armed || !AC) return;
    armed = true;
    GESTURES.forEach(function (n) { root.addEventListener(n, onGesture, true); });
  }
  function disarm() {
    if (!armed) return;
    armed = false;
    GESTURES.forEach(function (n) { root.removeEventListener(n, onGesture, true); });
  }

  /* ------------------------------------------------------- glass pill */
  var CSS = [
    '.amb-pill{position:fixed;z-index:9999;display:inline-flex;align-items:center;gap:8px;height:40px;margin:0;padding:0 16px 0 14px;',
    'border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.12);',
    '-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);',
    'color:#fff;font:500 13px/1 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang TC","Noto Sans TC",system-ui,sans-serif;',
    'letter-spacing:.02em;white-space:nowrap;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.3);',
    'box-shadow:0 8px 30px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.14);-webkit-tap-highlight-color:transparent;',
    '-webkit-user-select:none;user-select:none;opacity:0;transform:translateY(8px) scale(.96);',
    'transition:opacity .6s ease,transform .5s cubic-bezier(.2,.8,.2,1),background .3s ease,border-color .3s ease}',
    '.amb-pill.is-ready{opacity:1;transform:none}',
    '.amb-pill:hover{background:rgba(255,255,255,.18);border-color:rgba(255,255,255,.26)}',
    '.amb-pill:active{transform:scale(.96)}',
    '.amb-pill:focus{outline:none}.amb-pill:focus-visible{outline:2px solid rgba(255,255,255,.85);outline-offset:3px}',
    '.amb-br{right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom))}',
    '.amb-bl{left:max(16px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom))}',
    '.amb-tr{right:max(16px,env(safe-area-inset-right));top:max(16px,env(safe-area-inset-top))}',
    '.amb-tl{left:max(16px,env(safe-area-inset-left));top:max(16px,env(safe-area-inset-top))}',
    '.amb-eq{display:inline-flex;align-items:flex-end;gap:2px;height:12px;width:0;margin-right:-8px;overflow:hidden;opacity:0;',
    'transition:width .35s ease,opacity .35s ease,margin .35s ease}',
    '.amb-pill.is-on .amb-eq{width:14px;margin-right:0;opacity:1}',
    '.amb-eq i{display:block;flex:0 0 2px;width:2px;height:100%;border-radius:1px;background:currentColor;transform-origin:50% 100%;transform:scaleY(.3)}',
    '.amb-pill.is-on .amb-eq i{animation:amb-eq 1.1s ease-in-out infinite}',
    '.amb-pill.is-on .amb-eq i:nth-child(2){animation-duration:.8s;animation-delay:-.35s}',
    '.amb-pill.is-on .amb-eq i:nth-child(3){animation-duration:1.3s;animation-delay:-.7s}',
    '.amb-pill.is-on .amb-eq i:nth-child(4){animation-duration:.95s;animation-delay:-.2s}',
    '@keyframes amb-eq{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(1)}}',
    '@media (prefers-reduced-motion:reduce){.amb-pill.is-on .amb-eq i{animation:none;transform:scaleY(.7)}',
    '.amb-pill.is-on .amb-eq i:nth-child(2n){transform:scaleY(.45)}}',
    '@supports not ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){.amb-pill{background:rgba(28,28,32,.82)}}',
    '@media print{.amb-pill{display:none}}'
  ].join('');

  var POS = { 'bottom-right': 'amb-br', 'bottom-left': 'amb-bl', 'top-right': 'amb-tr', 'top-left': 'amb-tl' };

  function whenReady(fn) {
    if (!doc) return;
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function makeButton(opts) {
    if (btn || !doc || !doc.body || !AC) return;
    if (!doc.getElementById('amb-style')) {
      var st = doc.createElement('style'); st.id = 'amb-style'; st.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(st);
    }
    btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'amb-pill ' + (POS[opts.position] || POS['bottom-right']);
    btn.innerHTML = '<span class="amb-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="amb-label"></span>';
    btn.addEventListener('click', function () {
      if (playing()) { pause(); return; }
      try { if (root.navigator && root.navigator.audioSession) root.navigator.audioSession.type = 'playback'; } catch (e) { /* iOS silent switch */ }
      play();
    });
    doc.body.appendChild(btn);
    lastSig = '';
    render();
    setTimeout(function () { if (btn) btn.classList.add('is-ready'); }, 60);
  }

  function render() {
    var p = playing(), sig = (p ? 1 : 0) + '|' + (on ? 1 : 0) + '|' + (cur ? cur.type : '');
    if (btn) {
      btn.classList.toggle('is-on', p);
      btn.setAttribute('aria-pressed', p ? 'true' : 'false');
      var label = p ? '🔊 音效開啟中' : '🔈 開啟沉浸音效';
      var el = btn.querySelector('.amb-label');
      if (el && el.textContent !== label) el.textContent = label;
      btn.setAttribute('aria-label', p ? '關閉沉浸音效' : '開啟沉浸音效');
      btn.title = p ? '點一下關閉音效' : '點一下開啟環境音效';
    }
    if (sig !== lastSig) {
      lastSig = sig;
      emit('ambient:change', { on: on, playing: p, scene: cur ? cur.type : null });
    }
  }

  /* ------------------------------------------------------------- binding */
  function autoBind(selector, opts) {
    opts = opts || {};
    if (!doc || !root.IntersectionObserver) return api;
    var sel = (selector || '[data-fx]') + ', [data-ambient]';
    var visible = new Set(), seen = new WeakSet(), timer = 0, firstAt = 0;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); });
      schedule();
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });

    function scan() {
      var list;
      try { list = doc.querySelectorAll(sel); } catch (e) { return; }
      for (var i = 0; i < list.length; i++) if (!seen.has(list[i])) { seen.add(list[i]); io.observe(list[i]); }
    }
    // debounce 400 ms, but never wait more than 1.2 s during a long scroll
    function schedule() {
      var now = Date.now();
      if (!firstAt) firstAt = now;
      clearTimeout(timer);
      timer = setTimeout(decide, Math.max(0, Math.min(400, firstAt + 1200 - now)));
    }
    function decide() {
      firstAt = 0; timer = 0;
      var vh = root.innerHeight || doc.documentElement.clientHeight || 800;
      var top = vh * 0.2, bot = vh * 0.8, band = bot - top, best = null, bestScore = 0.05;
      visible.forEach(function (el) {
        if (!el.isConnected) { visible.delete(el); return; }
        var r = el.getBoundingClientRect();
        if (!r.height) return;
        var ov = Math.min(r.bottom, bot) - Math.max(r.top, top);
        if (ov <= 0) return;
        var score = 0.6 * (ov / band) + 0.4 * (ov / Math.min(r.height, band));
        if (score >= bestScore) { bestScore = score; best = el; }
      });
      var type = null;
      if (best) type = norm(best.getAttribute('data-ambient')) || norm(best.getAttribute('data-fx'));
      if (!type && !best && (root.scrollY || root.pageYOffset || 0) < vh * 0.5) type = norm(opts.top || 'hero');
      if (type) setScene(type);
    }

    scan();
    whenReady(scan);
    if (root.MutationObserver) {
      var mt = 0;
      new MutationObserver(function () {
        if (!mt) mt = setTimeout(function () { mt = 0; scan(); }, 250);
      }).observe(doc.documentElement, { childList: true, subtree: true });
    }
    root.addEventListener('scroll', schedule, { passive: true });
    root.addEventListener('resize', schedule, { passive: true });
    schedule();
    return api;
  }

  /* --------------------------------------------------------- public API */
  function init(opts) {
    opts = opts || {};
    if (opts.volume != null) vol = clamp(+opts.volume || 0, 0, 1);
    if (opts.scene && norm(opts.scene)) wanted = norm(opts.scene);
    if (!inited) {
      inited = true;
      pref = loadPref();
      if (AC && wantsAuto()) arm();
    }
    if (AC && opts.button !== false && !btn) whenReady(function () { makeButton(opts); });
    return api;
  }

  function setScene(type) {
    var t = norm(type);
    if (!t) return false;
    wanted = t;
    if (G && on) switchTo(t);
    return true;
  }

  function sfx(name) {
    var f = SFX[name];
    if (!f || !G || !on || G.ctx.state !== 'running') return false;
    try { f(sfxHost, G.ctx.currentTime + 0.01, G.sfxIn); } catch (e) { return false; }
    return true;
  }

  function mountWorld(type, opts) {
    opts = opts || {};
    worldMode = true;
    wanted = norm(type) || 'wind';
    init({ button: opts.button !== false, position: opts.position || 'top-right', volume: opts.volume });
    if (pref === null) pref = loadPref();
    if (on && G) switchTo(wanted);
    else if (pref !== '0') arm();
    return api;
  }

  function setVolume(v) {
    vol = clamp(+v || 0, 0, 1);
    if (G && playing()) glide(G.master.gain, vol, 0.3, G.ctx.currentTime);
    return vol;
  }

  // QA helper: render a scene (or 'sfx:name') offline → Promise<AudioBuffer>.
  function renderOffline(type, secs, opt) {
    opt = opt || {};
    if (!OAC) return Promise.reject(new Error('OfflineAudioContext unsupported'));
    var sr = opt.sampleRate || 44100, oc = new OAC(2, Math.ceil(sr * secs), sr), g = makeGraph(oc), info = {};
    g.master.gain.value = opt.volume != null ? opt.volume : VOLUME;
    if (String(type).indexOf('sfx:') === 0) {
      var host = { G: g, ctx: oc, live: new Set(), shot: hostShot };
      SFX[type.slice(4)](host, 0.05, g.sfxIn);
    } else {
      var s = build(g, norm(type), 0, { solo: opt.solo, offline: true });
      s.bus.gain.value = s.level; s.wet.gain.value = s.level * s.wetLevel;
      s.tick(0, secs);
      info.layers = s.layers.length; info.nodes = s.nodes.length;
    }
    var p = oc.startRendering();
    if (!p || !p.then) p = new Promise(function (res) { oc.oncomplete = function (e) { res(e.renderedBuffer); }; });
    return p.then(function (buf) { buf.info = info; return buf; });
  }

  if (doc) doc.addEventListener('visibilitychange', onVisibility);

  var api = {
    version: '1.0.0',
    supported: !!AC,
    scenes: TYPES.slice(),
    sfxNames: Object.keys(SFX),
    init: init,
    setScene: setScene,
    autoBind: autoBind,
    play: function () { return play(false); },
    pause: function () { return pause(false); },
    toggle: function () { return playing() ? pause(false) : play(false); },
    isOn: function () { return on; },
    isPlaying: playing,
    scene: function () { return cur ? cur.type : wanted; },
    sfx: sfx,
    mountWorld: mountWorld,
    setVolume: setVolume,
    _render: renderOffline,
    _levels: LEVEL,
    _graph: function () { return G; },
    _debug: function () {
      return {
        supported: !!AC, state: G ? G.ctx.state : 'none', on: on, playing: playing(), pref: pref,
        scene: cur ? cur.type : null, wanted: wanted, nodes: cur ? cur.nodes.length : 0,
        transient: (cur ? cur.live.size : 0) + (sfxHost ? sfxHost.live.size : 0),
        dying: dying.length, armed: armed
      };
    }
  };
  root.Ambient = api;
})(typeof window !== 'undefined' ? window : this);
