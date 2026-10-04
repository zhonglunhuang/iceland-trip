/*!
 * cinema.js — 全站「電影感」沉浸層 · global cinematic film layer
 * -----------------------------------------------------------------------------
 * Generic: it does not need to know the page's DOM. It injects its own <style>
 * and fixed overlay layers, runs ONE requestAnimationFrame loop, pauses while
 * the tab is hidden and caps overlay canvases at DPR 1.5.
 *
 *   Cinema.init({ ...options })        // see DEFAULTS below; returns Cinema
 *   Cinema.toggle('particles', false)  // any feature name, force optional
 *   Cinema.enable(name) / Cinema.disable(name) / Cinema.isEnabled(name)
 *   Cinema.set({ grainOpacity: .12 })  // change options live
 *   Cinema.setAccent('#ff8a5c')        // force the atmosphere colour (null = auto)
 *   Cinema.setSound(true|false|null)   // force the breathing pulse (null = auto / window.Ambient)
 *   Cinema.hide() / Cinema.show()      // e.g. while a fullscreen 3D world is open
 *   Cinema.refresh()                   // rescan DOM (also automatic via MutationObserver)
 *   Cinema.destroy()
 *   Cinema.state                       // { reduced, fine, day, accent, velocity, features }
 *
 * Features (all individually toggleable through opts):
 *   grain       animated film grain (canvas noise, ~12fps, low-res, mix-blend overlay)
 *   vignette    soft edge vignette
 *   cursor      desktop custom cursor (dot + lagging aurora ring, labels from [data-cursor])
 *   atmosphere  fixed glow whose colour morphs to the accent of the [data-day] in view
 *   progress    thin aurora scroll-progress bar ('auto' = skip if page already has one)
 *   velocity    scroll-velocity skew / scale / motion blur on images
 *   magnetic    buttons drift slightly toward the cursor
 *   particles   very faint floating ice dust with scroll parallax
 *   breathe     slow breathing pulse of vignette + glow while window.Ambient is playing
 *               (listens to 'ambient:change'; 'ambient:geyser' adds a soft one-off swell)
 *
 * prefers-reduced-motion disables cursor / velocity / magnetic / particles and
 * freezes the grain on a single static frame.
 *
 * Markup hooks the page may use (all optional):
 *   data-day="d3"          section → atmosphere colour (TRIP.days[].accent, data-accent, or --accent)
 *   data-accent="#hex"     override accent for a section
 *   data-cursor="走進風景"  cursor grows + shows this label while hovering the element
 *   data-magnetic[="0.4"]  make any element magnetic (optional strength 0–1)
 *   data-no-cinema         exclude an image (or a whole subtree) from the velocity effect
 *   data-native-cursor     keep the native cursor inside this element (e.g. a map / canvas)
 *
 * Events: window 'cinema:day'  detail { id, el, color }  (when the day in view changes)
 */
(function (window, document) {
  'use strict';

  if (window.Cinema && window.Cinema.__cinema) return; // loaded twice → keep the first

  var VERSION = '1.0.0';
  var FEATURES = ['atmosphere', 'particles', 'vignette', 'grain', 'progress', 'cursor', 'velocity', 'magnetic', 'breathe'];
  var MOTION = { cursor: 1, velocity: 1, magnetic: 1, particles: 1 }; // off under reduced motion

  var DEFAULTS = {
    // 1 · grain + vignette
    grain: true,
    grainOpacity: 0.07,       // layer opacity (blend: overlay)
    grainFps: 12,
    grainScale: 2,            // CSS px per noise pixel (low res, scaled up)
    vignette: true,
    vignetteStrength: 0.36,   // alpha of the darkest corner

    // 2 · cursor
    cursor: true,
    cursorSelector: 'a[href], button, [role="button"], [data-cursor], label[for], summary, select, input[type="submit"], input[type="button"]',
    nativeCursorSelector: '[data-native-cursor]',

    // 3 · atmosphere + progress
    atmosphere: true,
    daySelector: '[data-day]',
    glowOpacity: 0.22,
    glowMode: 'over',         // 'over' (screen-blended over the page) | 'under' (z-index:-1 behind content)
    idleColor: '#7fe3ff',     // when no day section is in view
    progress: 'auto',         // true | false | 'auto' (skip if .scroll-progress / [data-scroll-progress] exists)
    progressHeight: 2,

    // 4 · scroll-velocity media
    velocity: true,
    mediaRoot: 'main',        // selector or element; falls back to <body>
    mediaSelector: 'img:not([data-no-cinema])',
    maxSkew: 1.2,             // deg
    maxScale: 0.035,          // +3.5% at full speed
    maxBlur: 1.2,             // px (hard-capped at 1.5)
    velocityRef: 3.2,         // px/ms that counts as "full speed"

    // 5 · magnetic
    magnetic: true,
    magneticSelector: '.btn, .pill, [data-magnetic], a.button',
    magneticStrength: 0.3,
    magneticMax: 14,          // px

    // 6 · particles
    particles: true,
    particleCount: 46,        // hard-capped at 79
    particleParallax: 0.22,

    // 7 · sound-reactive breathing
    breathe: true,
    breathePeriod: 6.5,       // seconds per breath
    soundActive: null,        // optional () => boolean; default inspects window.Ambient

    reducedMotion: 'auto',    // 'auto' | true | false
    zIndex: 2147483000        // base z-index for the overlay stack (uses +0…+6)
  };

  var AURORA = 'linear-gradient(90deg,#7fe3ff 0%,#6bffb8 48%,#b38cff 100%)';
  var TEXT_INPUTS = ['input:not([type])', 'input[type="text"]', 'input[type="search"]', 'input[type="email"]',
    'input[type="url"]', 'input[type="tel"]', 'input[type="password"]', 'input[type="number"]',
    'textarea', '[contenteditable=""]', '[contenteditable="true"]'];
  var TEXT_SEL = TEXT_INPUTS.join(',');
  var LAYER_ATTR = 'data-cinema-layer';
  var HAS_CANVAS = !!document.createElement('canvas').getContext;

  // ---------------------------------------------------------------- helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function damp(dt, ms) { return 1 - Math.exp(-dt / ms); }
  function assign(t) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i];
      if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k];
    }
    return t;
  }
  function safe(fn, ctx, tag) {
    try { return fn.call(ctx); } catch (e) { if (window.console) console.warn('[cinema] ' + (tag || '') + ' failed:', e); }
  }
  function mq(query) { try { return window.matchMedia ? window.matchMedia(query) : null; } catch (e) { return null; } }
  function onMQ(m, fn) {
    if (!m) return function () {};
    if (m.addEventListener) { m.addEventListener('change', fn); return function () { m.removeEventListener('change', fn); }; }
    if (m.addListener) { m.addListener(fn); return function () { m.removeListener(fn); }; }
    return function () {};
  }
  function make(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    e.setAttribute(LAYER_ATTR, '');
    e.setAttribute('aria-hidden', 'true');
    return e;
  }
  function detach(e) { if (e && e.parentNode) e.parentNode.removeChild(e); }
  function qsa(sel, root) { try { return (root || document).querySelectorAll(sel); } catch (e) { return []; } }
  function closest(node, sel) {
    if (!node || !sel) return null;
    if (node.nodeType !== 1) node = node.parentElement;
    if (!node || !node.closest) return null;
    try { return node.closest(sel); } catch (e) { return null; }
  }
  function isOurs(node) { return !!closest(node, '[' + LAYER_ATTR + ']'); }
  function hex(c) {
    return '#' + c.map(function (v) { var h = (clamp(Math.round(v), 0, 255)).toString(16); return h.length < 2 ? '0' + h : h; }).join('');
  }

  var cctx = null;
  function parseColor(str) {
    if (!str) return null;
    if (Array.isArray(str)) return [+str[0] || 0, +str[1] || 0, +str[2] || 0];
    str = String(str).trim();
    if (!str) return null;
    var m = /^#([0-9a-f]{3,8})$/i.exec(str);
    if (m) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (h.length < 6) return null;
      return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(str);
    if (m) return [+m[1], +m[2], +m[3]];
    try { // named colours, hsl(), … → let canvas normalise it
      if (!cctx) cctx = document.createElement('canvas').getContext('2d');
      cctx.fillStyle = '#000';
      cctx.fillStyle = str;
      var n = cctx.fillStyle;
      if (n === '#000000' && !/^(black|#000(000)?)$/i.test(str)) return null;
      if (n.charAt(0) === '#' || /^rgb/i.test(n)) return parseColor(n);
    } catch (e) { /* ignore */ }
    return null;
  }

  // ---------------------------------------------------------------- state
  var S = fresh();
  function fresh() {
    return {
      inited: false, booted: false, opts: null,
      reduced: false, fine: false, hidden: false, apiHidden: false,
      raf: 0, last: 0, t: 0,
      vw: 0, vh: 0, maxScroll: 1, sizeDirty: true, sizeCheck: 0,
      sy: 0, vel: 0,
      mouse: { x: -100, y: -100, seen: false, inside: false, type: 'mouse' },
      sndCheck: 0, sndOn: false, sndLvl: 0, soundOverride: null, amb: 0, breath: 0, kick: 0,
      forced: null, day: null, dayId: null, accent: [127, 227, 255],
      styleEl: null, unbind: [], ro: null, mo: null, scanT: 0, resizeT: 0, mqReduced: null, mqFine: null
    };
  }

  // ---------------------------------------------------------------- stylesheet
  function cssText(o) {
    var Z = o.zIndex | 0;
    var nat = o.nativeCursorSelector;
    var pre = 'html.cin-native-off:not(.cin-hidden) ';
    var rules = [
      '[' + LAYER_ATTR + ']{box-sizing:border-box;}',
      '.cin-layer{position:fixed;top:0;left:0;width:100%;height:100%;margin:0;padding:0;border:0;pointer-events:none;contain:strict;}',
      'html.cin-hidden [' + LAYER_ATTR + ']{visibility:hidden!important;}',

      // atmosphere glow
      '.cin-glow{z-index:' + Z + ';mix-blend-mode:screen;opacity:0;will-change:opacity;--cin-rgb:127,227,255;' +
        'background:' +
        'radial-gradient(58% 46% at 4% 0%,rgba(var(--cin-rgb),.55),rgba(var(--cin-rgb),0) 72%),' +
        'radial-gradient(52% 52% at 100% 100%,rgba(var(--cin-rgb),.42),rgba(var(--cin-rgb),0) 72%),' +
        'radial-gradient(70% 38% at 62% 108%,rgba(var(--cin-rgb),.24),rgba(var(--cin-rgb),0) 70%);}',
      '.cin-glow.cin-glow--under{z-index:-1;mix-blend-mode:normal;}',

      // particles / vignette / grain
      '.cin-particles{z-index:' + (Z + 1) + ';mix-blend-mode:screen;}',
      '.cin-vignette{z-index:' + (Z + 2) + ';opacity:.82;will-change:opacity;background:radial-gradient(130% 105% at 50% 46%,rgba(0,0,0,0) 52%,rgba(0,0,0,' +
        (o.vignetteStrength * 0.5).toFixed(3) + ') 80%,rgba(0,0,0,' + (+o.vignetteStrength).toFixed(3) + ') 100%);}',
      '.cin-grain{z-index:' + (Z + 3) + ';mix-blend-mode:overlay;opacity:' + (+o.grainOpacity).toFixed(3) + ';}',

      // progress
      '.cin-progress{position:fixed;top:0;left:0;width:100%;height:' + (o.progressHeight | 0 || 2) + 'px;z-index:' + (Z + 4) + ';pointer-events:none;' +
        'transform-origin:0 50%;transform:scaleX(0);will-change:transform;background:' + AURORA + ';--cin-rgb:127,227,255;' +
        'box-shadow:0 0 12px rgba(var(--cin-rgb),.75),0 0 2px rgba(255,255,255,.55);}',

      // cursor — hide the native one (but keep it for text inputs / native regions)
      'html.cin-native-off:not(.cin-hidden),' + pre + '*{cursor:none!important;}',
      TEXT_INPUTS.map(function (s) { return pre + s; }).join(',') + '{cursor:text!important;}',
      '.cin-cursor{position:fixed;top:0;left:0;width:0;height:0;z-index:' + (Z + 5) + ';pointer-events:none;opacity:0;' +
        'transition:opacity .35s ease;--cin-rgb:127,227,255;--cin-e:cubic-bezier(.2,.8,.2,1);}',
      '.cin-cursor.is-on{opacity:1;}',
      '.cin-cursor.is-on.is-native{opacity:0;}',
      '.cin-cursor__ring,.cin-cursor__dot{position:absolute;top:0;left:0;will-change:transform;}',
      '.cin-cursor__shape{position:absolute;left:0;top:0;width:34px;height:34px;transform:translate(-50%,-50%);border-radius:999px;' +
        'border:1px solid rgba(255,255,255,.5);display:flex;align-items:center;justify-content:center;' +
        'box-shadow:0 0 16px -3px rgba(var(--cin-rgb),.6),inset 0 0 10px -5px rgba(255,255,255,.45);' +
        'transition:width .5s var(--cin-e),height .5s var(--cin-e),background-color .35s ease,border-color .35s ease,scale .3s var(--cin-e);}',
      '.cin-cursor__shape::before{content:"";position:absolute;top:-7px;right:-7px;bottom:-7px;left:-7px;border-radius:inherit;z-index:-1;' +
        'background:conic-gradient(from 0deg,#7fe3ff,#6bffb8,#b38cff,#ff7eb6,#7fe3ff);filter:blur(9px);opacity:.22;' +
        'animation:cin-spin 7s linear infinite;transition:opacity .35s ease;}',
      '.cin-cursor.is-hover .cin-cursor__shape{width:58px;height:58px;border-color:rgba(255,255,255,.85);background-color:rgba(255,255,255,.06);}',
      '.cin-cursor.is-hover .cin-cursor__shape::before{opacity:.42;}',
      '.cin-cursor.has-label .cin-cursor__shape{width:var(--cin-lw,84px);height:var(--cin-lh,84px);background-color:rgba(8,10,14,.4);border-color:rgba(255,255,255,.72);}',
      '.cin-cursor.has-label .cin-cursor__shape::before{opacity:.62;}',
      '.cin-cursor.is-down .cin-cursor__shape{scale:.84;}',
      '.cin-cursor__label{position:relative;flex:none;font:600 12px/1.1 -apple-system,BlinkMacSystemFont,"SF Pro Text","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;' +
        'letter-spacing:.08em;color:#fff;white-space:nowrap;text-shadow:0 1px 8px rgba(0,0,0,.5);opacity:0;' +
        'transform:translateY(5px) scale(.92);transition:opacity .3s ease,transform .45s var(--cin-e);}',
      '.cin-cursor.has-label .cin-cursor__label{opacity:1;transform:none;transition-delay:.14s;}',
      '.cin-cursor__dot i{position:absolute;left:-3px;top:-3px;width:6px;height:6px;border-radius:50%;background:#fff;' +
        'box-shadow:0 0 8px 1px rgba(var(--cin-rgb),.95),0 0 20px 5px rgba(107,255,184,.28);transition:scale .3s var(--cin-e),opacity .3s ease;}',
      '.cin-cursor.is-hover .cin-cursor__dot i{scale:.5;}',
      '.cin-cursor.has-label .cin-cursor__dot i{scale:0;opacity:0;}',
      '@keyframes cin-spin{to{transform:rotate(360deg);}}'
    ];
    if (nat) {
      rules.push(pre + ':is(' + nat + '),' + pre + ':is(' + nat + ') *{cursor:auto!important;}');
      rules.push(pre + ':is(' + nat + ') :is(a[href],button,[role="button"],summary,label[for]){cursor:pointer!important;}');
      rules.push(pre + ':is(' + nat + ') :is(' + TEXT_SEL + '){cursor:text!important;}');
    }
    return rules.join('\n');
  }
  function restyle() {
    if (!S.booted) return;
    if (!S.styleEl) {
      S.styleEl = document.createElement('style');
      S.styleEl.id = 'cinema-style';
      S.styleEl.setAttribute(LAYER_ATTR, '');
      (document.head || document.documentElement).appendChild(S.styleEl);
    }
    S.styleEl.textContent = cssText(S.opts);
  }

  // ---------------------------------------------------------------- sound hook
  function soundOn() {
    if (S.soundOverride != null) return S.soundOverride;
    var o = S.opts;
    if (typeof o.soundActive === 'function') { try { return !!o.soundActive(); } catch (e) { return false; } }
    var A = window.Ambient;
    if (!A) return false;
    try {
      if (typeof A.isPlaying === 'function') return !!A.isPlaying(); // actually audible
      if (typeof A.isOn === 'function') return !!A.isOn();
      var keys = ['on', 'isOn', 'playing', 'isPlaying', 'enabled', 'active'];
      for (var i = 0; i < keys.length; i++) if (typeof A[keys[i]] === 'boolean') return A[keys[i]];
      if (typeof A.state === 'string') return /^(on|playing|running|active)$/i.test(A.state);
      if (typeof A.muted === 'boolean') return !A.muted;
    } catch (e) { /* ignore */ }
    return false;
  }
  function soundLevel() {
    var A = window.Ambient;
    if (A && typeof A.getLevel === 'function') {
      try { var l = +A.getLevel(); if (l >= 0) return Math.min(1, l); } catch (e) { /* ignore */ }
    }
    return 0;
  }

  // =========================================================================
  // modules — each: start(), stop(), optional read(dt), write(dt), resize(), scan()
  // =========================================================================

  // ---------------------------------------------------------------- 3 · atmosphere
  var Atmosphere = {
    el: null, io: null, seen: null, active: null, cur: null, intensity: 0, lastRGB: '', lastO: -1,
    start: function () {
      var o = S.opts;
      this.el = make('div', 'cin-layer cin-glow' + (o.glowMode === 'under' ? ' cin-glow--under' : ''));
      document.body.appendChild(this.el);
      this.cur = S.accent.slice();
      this.lastRGB = ''; this.lastO = -1;
      this.active = [];
      this.seen = new WeakSet();
      if (window.IntersectionObserver) {
        var self = this;
        this.io = new IntersectionObserver(function (entries) { self.onIO(entries); }, { rootMargin: '-49% 0px -50% 0px', threshold: 0 });
        this.scan();
      }
    },
    stop: function () {
      if (this.io) this.io.disconnect();
      this.io = null; this.active = []; this.seen = null;
      detach(this.el); this.el = null;
      S.day = null; S.dayId = null;
    },
    scan: function () {
      if (!this.io) return;
      var list = qsa(S.opts.daySelector);
      for (var i = 0; i < list.length; i++) {
        var d = list[i];
        if (this.seen.has(d)) continue;
        this.seen.add(d);
        if (!isOurs(d)) this.io.observe(d);
      }
      // forget detached sections
      this.active = this.active.filter(function (d) { return d.isConnected !== false; });
    },
    onIO: function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i], idx = this.active.indexOf(e.target);
        if (e.isIntersecting && idx < 0) this.active.push(e.target);
        else if (!e.isIntersecting && idx >= 0) this.active.splice(idx, 1);
      }
      // last one in document order wins (deepest / latest section)
      var pick = null;
      for (var j = 0; j < this.active.length; j++) {
        var a = this.active[j];
        if (!pick || (pick.compareDocumentPosition(a) & 4 /* FOLLOWING */)) pick = a;
      }
      if (pick !== S.day) setDay(pick);
    },
    write: function (dt) {
      var o = S.opts;
      var target = S.forced || (S.day ? S.accent : parseColor(o.idleColor) || [127, 227, 255]);
      var k = damp(dt, 520), c = this.cur;
      c[0] += (target[0] - c[0]) * k; c[1] += (target[1] - c[1]) * k; c[2] += (target[2] - c[2]) * k;
      var rgb = Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]);
      if (rgb !== this.lastRGB) {
        this.lastRGB = rgb;
        tint(rgb);
      }
      this.intensity += ((S.day || S.forced ? 1 : 0.6) - this.intensity) * damp(dt, 700);
      var op = clamp(o.glowOpacity * this.intensity * (1 + 0.55 * S.breath), 0, 1);
      if (Math.abs(op - this.lastO) > 0.002) { this.lastO = op; this.el.style.opacity = op.toFixed(3); }
    }
  };
  function tint(rgb) {
    var els = [Atmosphere.el, Progress.el, Cursor.root];
    for (var i = 0; i < els.length; i++) if (els[i]) els[i].style.setProperty('--cin-rgb', rgb);
  }
  function accentFor(el) {
    if (!el) return null;
    var c = parseColor(el.getAttribute('data-accent'));
    if (c) return c;
    var id = el.getAttribute('data-day') || el.id || '';
    var days = window.TRIP && window.TRIP.days;
    if (id && days && days.length) {
      for (var i = 0; i < days.length; i++) {
        var d = days[i];
        if (d && (d.id === id || (/^\d+$/.test(id) && d.id === 'd' + id) || 'day-' + d.id === id)) {
          c = parseColor(d.accent);
          if (c) return c;
        }
      }
    }
    try { c = parseColor(getComputedStyle(el).getPropertyValue('--accent')); } catch (e) { c = null; }
    return c;
  }
  function setDay(el) {
    S.day = el || null;
    S.dayId = el ? (el.getAttribute('data-day') || el.id || null) : null;
    if (el) S.accent = accentFor(el) || parseColor(S.opts.idleColor) || [127, 227, 255];
    try {
      window.dispatchEvent(new CustomEvent('cinema:day', { detail: { id: S.dayId, el: S.day, color: S.day ? hex(S.accent) : null } }));
    } catch (e) { /* old browsers */ }
  }

  // ---------------------------------------------------------------- 3b · progress
  var Progress = {
    el: null, last: -1,
    start: function () {
      this.el = make('div', 'cin-progress');
      if (Atmosphere.lastRGB) this.el.style.setProperty('--cin-rgb', Atmosphere.lastRGB);
      document.body.appendChild(this.el);
      this.last = -1;
    },
    stop: function () { detach(this.el); this.el = null; },
    write: function () {
      var p = clamp(S.sy / S.maxScroll, 0, 1);
      if (Math.abs(p - this.last) > 0.0004) { this.last = p; this.el.style.transform = 'scaleX(' + p.toFixed(4) + ')'; }
    }
  };
  function hasForeignProgress() {
    var list = qsa('.scroll-progress, [data-scroll-progress], #scrollProgress');
    for (var i = 0; i < list.length; i++) if (!isOurs(list[i])) return true;
    return false;
  }

  // ---------------------------------------------------------------- 1 · vignette
  var Vignette = {
    el: null, last: -1,
    start: function () { this.el = make('div', 'cin-layer cin-vignette'); document.body.appendChild(this.el); this.last = -1; },
    stop: function () { detach(this.el); this.el = null; },
    write: function () {
      var op = 0.82 + 0.18 * S.breath;
      if (Math.abs(op - this.last) > 0.003) { this.last = op; this.el.style.opacity = op.toFixed(3); }
    }
  };

  // ---------------------------------------------------------------- 1 · grain
  var Grain = {
    cv: null, ctx: null, tile: null, tctx: null, img: null, buf: null, acc: 0, w: 0, h: 0, drawn: false, T: 128,
    start: function () {
      this.cv = make('canvas', 'cin-layer cin-grain');
      this.ctx = this.cv.getContext('2d');
      this.tile = document.createElement('canvas');
      this.tile.width = this.tile.height = this.T;
      this.tctx = this.tile.getContext('2d');
      if (!this.ctx || !this.tctx) { detach(this.cv); this.cv = null; return; }
      this.img = this.tctx.createImageData(this.T, this.T);
      this.buf = new Uint32Array(this.img.data.buffer);
      this.w = this.h = 0;
      this.resize(true);
      document.body.appendChild(this.cv);
      this.draw();
    },
    stop: function () { detach(this.cv); this.cv = this.ctx = this.tile = this.tctx = this.img = this.buf = null; },
    resize: function (force) {
      if (!this.cv) return;
      var sc = Math.max(1, +S.opts.grainScale || 2);
      var w = Math.ceil(S.vw / sc), h = Math.ceil(S.vh / sc);
      if (!force && w === this.w && Math.abs(h - this.h) < 60) return; // ignore mobile URL-bar jiggle
      this.w = this.cv.width = Math.max(1, w);
      this.h = this.cv.height = Math.max(1, h);
      this.draw();
    },
    draw: function () {
      if (!this.ctx) return;
      var b = this.buf, n = b.length;
      for (var i = 0; i < n; i++) { var v = (Math.random() * 256) | 0; b[i] = 0xff000000 | (v << 16) | (v << 8) | v; }
      this.tctx.putImageData(this.img, 0, 0);
      var pat = this.ctx.createPattern(this.tile, 'repeat');
      var ox = (Math.random() * this.T) | 0, oy = (Math.random() * this.T) | 0;
      this.ctx.setTransform(1, 0, 0, 1, -ox, -oy);
      this.ctx.fillStyle = pat;
      this.ctx.fillRect(ox, oy, this.w, this.h);
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.drawn = true;
    },
    write: function (dt) {
      if (!this.ctx) return;
      if (S.reduced) { if (!this.drawn) this.draw(); return; } // static frame
      this.acc += dt;
      var step = 1000 / clamp(+S.opts.grainFps || 12, 1, 30);
      if (this.acc >= step) { this.acc %= step; this.draw(); }
    }
  };

  // ---------------------------------------------------------------- 6 · particles
  var Particles = {
    cv: null, ctx: null, sprite: null, list: [], w: 0, h: 0, dpr: 1,
    start: function () {
      this.cv = make('canvas', 'cin-layer cin-particles');
      this.ctx = this.cv.getContext('2d');
      if (!this.ctx) { this.cv = null; return; }
      this.sprite = this.makeSprite();
      this.list = [];
      this.w = this.h = 0;
      this.resize(true);
      document.body.appendChild(this.cv);
    },
    stop: function () { detach(this.cv); this.cv = this.ctx = this.sprite = null; this.list = []; },
    makeSprite: function () {
      var c = document.createElement('canvas'), s = 32;
      c.width = c.height = s;
      var g = c.getContext('2d'), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(240,250,255,1)');
      gr.addColorStop(0.3, 'rgba(220,242,255,.55)');
      gr.addColorStop(1, 'rgba(200,235,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
      return c;
    },
    resize: function (force) {
      if (!this.cv) return;
      var w = S.vw, h = S.vh;
      if (!force && w === this.w && Math.abs(h - this.h) < 100) return;
      this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
      this.w = w; this.h = h;
      this.cv.width = Math.max(1, Math.round(w * this.dpr));
      this.cv.height = Math.max(1, Math.round(h * this.dpr));
      var base = clamp(S.opts.particleCount | 0, 0, 79);
      var n = Math.round(base * clamp((w * h) / (1440 * 900), 0.45, 1));
      while (this.list.length > n) this.list.pop();
      while (this.list.length < n) this.list.push(this.spawn());
    },
    spawn: function () {
      var z = 0.25 + Math.random() * 0.75;
      return {
        x: Math.random() * this.w, y: Math.random() * this.h, z: z,
        r: 0.55 + Math.random() * 1.1,
        vx: (Math.random() - 0.5) * 7, vy: 3 + Math.random() * 9,
        ph: Math.random() * 6.283, tw: 0.35 + Math.random() * 1.1
      };
    },
    write: function (dt) {
      if (!this.ctx) return;
      var c = this.ctx, w = this.w, h = this.h, H = h + 40, t = S.t, s = dt / 1000;
      var par = +S.opts.particleParallax || 0, sy = S.sy;
      var streak = Math.min(2.4, Math.abs(S.vel) * 0.5);
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      for (var i = 0; i < this.list.length; i++) {
        var p = this.list[i];
        p.x += (p.vx + Math.sin(t * 0.55 + p.ph) * 6) * p.z * s;
        p.y += p.vy * p.z * s;
        if (p.x < -10) p.x += w + 20; else if (p.x > w + 10) p.x -= w + 20;
        var py = p.y - sy * p.z * par;
        py = ((py % H) + H) % H - 20;
        var a = (0.08 + 0.3 * p.z) * (0.65 + 0.35 * Math.sin(t * p.tw + p.ph));
        if (a <= 0.01) continue;
        var d = p.r * (0.7 + p.z) * 2.6, dh = d * (1 + streak * p.z);
        c.globalAlpha = a;
        c.drawImage(this.sprite, p.x - d / 2, py - dh / 2, d, dh);
      }
      c.globalAlpha = 1;
    }
  };

  // ---------------------------------------------------------------- 2 · cursor
  var Cursor = {
    root: null, ring: null, dot: null, shape: null, label: null,
    rx: 0, ry: 0, lastR: '', lastD: '', visible: false, hoverEl: null, text: '', native: false,
    start: function () {
      var r = this.root = make('div', 'cin-cursor');
      this.ring = make('div', 'cin-cursor__ring');
      this.shape = make('div', 'cin-cursor__shape');
      this.label = make('span', 'cin-cursor__label');
      this.dot = make('div', 'cin-cursor__dot');
      this.dot.appendChild(make('i'));
      this.shape.appendChild(this.label);
      this.ring.appendChild(this.shape);
      r.appendChild(this.ring);
      r.appendChild(this.dot);
      if (Atmosphere.lastRGB) r.style.setProperty('--cin-rgb', Atmosphere.lastRGB);
      document.body.appendChild(r);
      this.visible = false; this.hoverEl = null; this.text = ''; this.lastR = this.lastD = '';
      if (S.mouse.seen && S.mouse.inside && S.mouse.type !== 'touch') this.show();
    },
    stop: function () {
      document.documentElement.classList.remove('cin-native-off');
      detach(this.root);
      this.root = this.ring = this.dot = this.shape = this.label = null;
      this.visible = false; this.hoverEl = null;
    },
    show: function () {
      if (!this.root) return;
      if (!this.visible) { this.rx = S.mouse.x; this.ry = S.mouse.y; }
      this.visible = true;
      this.root.classList.add('is-on');
      document.documentElement.classList.add('cin-native-off');
    },
    hide: function (restoreNative) {
      if (!this.root) return;
      this.visible = false;
      this.root.classList.remove('is-on', 'is-down');
      if (restoreNative) document.documentElement.classList.remove('cin-native-off');
    },
    hover: function (t) {
      if (!this.root) return;
      var o = S.opts;
      var native = !!(closest(t, TEXT_SEL) || (o.nativeCursorSelector && closest(t, o.nativeCursorSelector)));
      if (native !== this.native) { this.native = native; this.root.classList.toggle('is-native', native); }
      var hit = closest(t, o.cursorSelector);
      if (hit && (hit.disabled || hit.getAttribute('aria-disabled') === 'true')) hit = null;
      var lab = closest(t, '[data-cursor]');
      var text = lab ? (lab.getAttribute('data-cursor') || '').trim() : '';
      if (text === 'true') text = '';
      var target = lab || hit;
      if (target === this.hoverEl && text === this.text) return;
      this.hoverEl = target; this.text = text;
      this.root.classList.toggle('is-hover', !!target);
      if (text) {
        this.label.textContent = text;
        var w = this.label.offsetWidth || text.length * 12;
        var lw = Math.max(76, Math.round(w + 30));
        var lh = lw > 120 ? 46 : lw;
        this.root.style.setProperty('--cin-lw', lw + 'px');
        this.root.style.setProperty('--cin-lh', lh + 'px');
        this.root.classList.add('has-label');
      } else {
        this.root.classList.remove('has-label');
      }
    },
    press: function (down) { if (this.root) this.root.classList.toggle('is-down', !!down); },
    write: function (dt) {
      if (!this.visible) return;
      var mx = S.mouse.x, my = S.mouse.y;
      var k = damp(dt, this.hoverEl ? 60 : 85);
      this.rx += (mx - this.rx) * k;
      this.ry += (my - this.ry) * k;
      if (Math.abs(mx - this.rx) < 0.05) this.rx = mx;
      if (Math.abs(my - this.ry) < 0.05) this.ry = my;
      var r = 'translate3d(' + this.rx.toFixed(2) + 'px,' + this.ry.toFixed(2) + 'px,0)';
      if (r !== this.lastR) { this.lastR = r; this.ring.style.transform = r; }
      var d = 'translate3d(' + mx + 'px,' + my + 'px,0)';
      if (d !== this.lastD) { this.lastD = d; this.dot.style.transform = d; }
    }
  };

  // ---------------------------------------------------------------- 5 · magnetic
  var Magnetic = {
    cur: null, items: null,
    start: function () { this.cur = null; this.items = new Map(); },
    stop: function () {
      if (this.items) this.items.forEach(function (it, el) { if (el.style.translate === it.last) el.style.translate = ''; });
      this.items = null; this.cur = null;
    },
    hover: function (t) {
      if (!this.items) return;
      var m = closest(t, S.opts.magneticSelector);
      if (m && isOurs(m)) m = null;
      if (m === this.cur) return;
      this.release();
      this.cur = m;
      if (m && !this.items.has(m)) {
        var s = parseFloat(m.getAttribute('data-magnetic'));
        this.items.set(m, { x: 0, y: 0, tx: 0, ty: 0, s: s > 0 && s <= 1 ? s : +S.opts.magneticStrength || 0.3, last: '' });
      }
    },
    release: function () {
      if (this.cur && this.items) { var it = this.items.get(this.cur); if (it) { it.tx = 0; it.ty = 0; } }
      this.cur = null;
    },
    read: function () {
      var el = this.cur;
      if (!el || !S.mouse.inside || S.mouse.type === 'touch') { if (el) this.release(); return; }
      var it = this.items.get(el);
      if (!it) return;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) { this.release(); return; }
      var cx = r.left + r.width / 2 - it.x, cy = r.top + r.height / 2 - it.y;
      var dx = S.mouse.x - cx, dy = S.mouse.y - cy;
      // cursor left the element (e.g. it scrolled away under a still mouse)
      if (Math.abs(dx) > r.width / 2 + 28 || Math.abs(dy) > r.height / 2 + 28) { this.release(); return; }
      var mx = Math.min(+S.opts.magneticMax || 14, Math.max(4, r.width * 0.2));
      var my = Math.min(+S.opts.magneticMax || 14, Math.max(3, r.height * 0.3));
      it.tx = clamp(dx * it.s, -mx, mx);
      it.ty = clamp(dy * it.s, -my, my);
    },
    write: function (dt) {
      var self = this;
      this.items.forEach(function (it, el) {
        if (el.style.translate && it.last && el.style.translate !== it.last) { self.items.delete(el); return; } // someone else owns it
        var active = el === self.cur;
        var k = damp(dt, active ? 90 : 170);
        it.x += (it.tx - it.x) * k;
        it.y += (it.ty - it.y) * k;
        if (!active && Math.abs(it.x) < 0.05 && Math.abs(it.y) < 0.05) {
          if (el.style.translate === it.last) el.style.translate = '';
          self.items.delete(el);
          return;
        }
        el.style.translate = it.x.toFixed(2) + 'px ' + it.y.toFixed(2) + 'px';
        it.last = el.style.translate;
      });
    }
  };

  // ---------------------------------------------------------------- 4 · velocity media
  var HAS_SCALE = !!(window.CSS && CSS.supports && CSS.supports('scale', '1'));
  var Velocity = {
    io: null, vis: null, st: null, seen: null, active: false, v: 0,
    start: function () {
      this.vis = new Set(); this.st = new WeakMap(); this.seen = new WeakSet(); this.active = false; this.v = 0;
      if (!window.IntersectionObserver) return;
      var self = this;
      this.io = new IntersectionObserver(function (entries) { self.onIO(entries); }, { rootMargin: '8% 0px 8% 0px', threshold: 0 });
      this.scan();
    },
    stop: function () {
      var self = this;
      if (this.vis) this.vis.forEach(function (el) { self.restore(el); });
      if (this.io) this.io.disconnect();
      this.io = null; this.vis = null; this.seen = null; this.active = false;
    },
    root: function () {
      var r = S.opts.mediaRoot;
      if (r && r.nodeType === 1) return r;
      return (typeof r === 'string' && r && document.querySelector(r)) || document.body;
    },
    scan: function () {
      if (!this.io) return;
      var list = qsa(S.opts.mediaSelector, this.root());
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (this.seen.has(el)) continue;
        this.seen.add(el);
        if (isOurs(el) || closest(el, '[data-no-cinema]')) continue;
        this.io.observe(el);
      }
      var self = this;
      this.vis.forEach(function (el) { if (el.isConnected === false) { self.vis.delete(el); self.io.unobserve(el); } });
    },
    onIO: function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i], el = e.target;
        if (e.isIntersecting && e.boundingClientRect.width >= 80 && e.boundingClientRect.height >= 50) {
          if (!this.st.has(el)) this.st.set(el, this.inspect(el));
          this.vis.add(el);
        } else if (this.vis.has(el)) {
          this.vis.delete(el);
          this.restore(el);
        }
      }
    },
    // decide which properties we may touch without fighting other code
    inspect: function (el) {
      var cs = getComputedStyle(el);
      var anim = !!(el.getAnimations && el.getAnimations().length) || (cs.animationName && cs.animationName !== 'none');
      return {
        t: !el.style.transform && !el._gsap && cs.transform === 'none' && !anim, // skew (needs exclusive transform)
        s: HAS_SCALE && !el.style.scale && (!cs.scale || cs.scale === 'none'),
        f: el.style.filter ? null : (cs.filter && cs.filter !== 'none' ? cs.filter : ''), // null = filter owned elsewhere
        lt: '', ls: '', lf: '', lfr: ''
      };
    },
    restore: function (el) {
      var st = this.st && this.st.get(el);
      if (!st) return;
      if (st.lt && el.style.transform === st.lt) el.style.transform = '';
      if (st.ls && el.style.scale === st.ls) el.style.scale = '';
      if (st.lf && el.style.filter === st.lf) el.style.filter = '';
      st.lt = st.ls = st.lf = st.lfr = '';
    },
    write: function (dt) {
      var o = S.opts;
      var target = clamp(S.vel / (+o.velocityRef || 3.2), -1, 1);
      this.v += (target - this.v) * damp(dt, Math.abs(target) > Math.abs(this.v) ? 90 : 240); // rise fast, settle slow
      var a = Math.abs(this.v);
      a = a * a * (3 - 2 * a); // smoothstep → gentle onset
      var self = this;
      if (a < 0.004) {
        if (this.active) { this.active = false; this.vis.forEach(function (el) { self.restore(el); }); }
        return;
      }
      if (!this.active) { // new burst → re-check ownership cheaply (no layout)
        this.active = true;
        this.vis.forEach(function (el) {
          var st = self.st.get(el);
          if (st && st.t && (el._gsap || (el.style.transform && el.style.transform !== st.lt))) st.t = false;
        });
      }
      var sign = this.v < 0 ? -1 : 1;
      var skew = (-sign * a * clamp(+o.maxSkew || 0, 0, 4)).toFixed(3);
      var sc = 1 + a * clamp(+o.maxScale || 0, 0, 0.12);
      var bl = a * clamp(+o.maxBlur || 0, 0, 1.5);
      var blur = bl >= 0.1 ? 'blur(' + bl.toFixed(2) + 'px)' : '';
      this.vis.forEach(function (el) {
        var st = self.st.get(el);
        if (!st) return;
        if (st.t) {
          if (el.style.transform && el.style.transform !== st.lt) st.t = false; // someone else took over
          else {
            el.style.transform = 'skewY(' + skew + 'deg)' + (!st.s ? ' scale(' + sc.toFixed(4) + ')' : '');
            st.lt = el.style.transform;
          }
        }
        if (st.s) {
          if (el.style.scale && el.style.scale !== st.ls) st.s = false;
          else { el.style.scale = sc.toFixed(4); st.ls = el.style.scale; }
        }
        if (st.f !== null) {
          if (el.style.filter && el.style.filter !== st.lf) st.f = null;
          else {
            var f = blur ? (st.f ? st.f + ' ' + blur : blur) : '';
            if (f !== st.lfr) { el.style.filter = f; st.lf = el.style.filter; st.lfr = f; }
          }
        }
      });
    }
  };

  // ---------------------------------------------------------------- 7 · breathe (no DOM)
  var Breathe = { start: function () {}, stop: function () {} };

  var MODS = {
    atmosphere: Atmosphere, particles: Particles, vignette: Vignette, grain: Grain, progress: Progress,
    cursor: Cursor, velocity: Velocity, magnetic: Magnetic, breathe: Breathe
  };
  FEATURES.forEach(function (n) { MODS[n].on = false; });

  // =========================================================================
  // loop
  // =========================================================================
  function frame(now) {
    S.raf = requestAnimationFrame(frame);
    var dt = S.last ? clamp(now - S.last, 1, 64) : 16.7;
    S.last = now;
    S.t += dt / 1000;

    // ---- READ phase (no style writes before this point) ----
    var sy = window.pageYOffset || document.documentElement.scrollTop || 0;
    var raw = (sy - S.sy) / dt;
    S.sy = sy;
    if (Math.abs(raw) > 25) raw = 0; // a jump/cut (anchor, scrollTo immediate) is not motion
    S.vel += (raw - S.vel) * damp(dt, 110);
    if (Math.abs(S.vel) < 0.0005) S.vel = 0;

    if (S.sizeDirty || now - S.sizeCheck > 1000) {
      S.sizeDirty = false; S.sizeCheck = now;
      var de = document.documentElement;
      S.maxScroll = Math.max(1, Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0) - (window.innerHeight || S.vh));
    }

    if (now - S.sndCheck > 300) {
      S.sndCheck = now;
      S.sndOn = Breathe.on && soundOn();
      S.sndLvl = S.sndOn ? soundLevel() : 0;
    }
    S.amb += ((S.sndOn ? 1 : 0) - S.amb) * damp(dt, 1400);
    if (S.amb < 0.001) S.amb = 0;
    var per = Math.max(1, +S.opts.breathePeriod || 6.5);
    var wave = 0.5 - 0.5 * Math.cos(((S.t % per) / per) * Math.PI * 2);
    S.kick *= 1 - damp(dt, 900); // one-off swell (e.g. 'ambient:geyser')
    if (S.kick < 0.001) S.kick = 0;
    S.breath = clamp(S.amb * (wave * 0.85 + S.sndLvl * 0.3) + S.kick * S.amb * 0.6, 0, 1);

    var i, m;
    for (i = 0; i < FEATURES.length; i++) {
      m = MODS[FEATURES[i]];
      if (m.on && m.read) { try { m.read(dt); } catch (e) { fail(FEATURES[i], e); } }
    }
    // ---- WRITE phase ----
    for (i = 0; i < FEATURES.length; i++) {
      m = MODS[FEATURES[i]];
      if (m.on && m.write) { try { m.write(dt); } catch (e) { fail(FEATURES[i], e); } }
    }
  }
  function fail(name, e) {
    var m = MODS[name];
    if (window.console) console.warn('[cinema] ' + name + ' crashed and was switched off:', e);
    m.on = false;
    safe(m.stop, m, name + '.stop');
    if (S.opts) S.opts[name] = false;
  }
  function anyOn() { for (var i = 0; i < FEATURES.length; i++) if (MODS[FEATURES[i]].on) return true; return false; }
  function ensureLoop() {
    var want = S.booted && !S.hidden && anyOn();
    if (want && !S.raf) { S.last = 0; S.sy = window.pageYOffset || 0; S.raf = requestAnimationFrame(frame); }
    else if (!want && S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
  }

  // =========================================================================
  // feature switching
  // =========================================================================
  function want(name) {
    var o = S.opts;
    if (!o || !o[name] || S.apiHidden) return false;
    if (S.reduced && MOTION[name]) return false;
    if (name === 'cursor' && !S.fine) return false;
    if (name === 'progress' && o.progress === 'auto' && hasForeignProgress()) return false;
    if ((name === 'grain' || name === 'particles') && !HAS_CANVAS) return false;
    return true;
  }
  function sync() {
    if (!S.booted) return;
    FEATURES.forEach(function (n) {
      var m = MODS[n], w = want(n);
      if (w && !m.on) { m.on = true; safe(m.start, m, n + '.start'); }
      else if (!w && m.on) { m.on = false; safe(m.stop, m, n + '.stop'); }
    });
    ensureLoop();
  }
  function resizeAll() {
    S.vw = window.innerWidth || document.documentElement.clientWidth || 0;
    S.vh = window.innerHeight || document.documentElement.clientHeight || 0;
    S.sizeDirty = true;
    if (Grain.on) Grain.resize();
    if (Particles.on) Particles.resize();
  }
  function scanAll() {
    if (Atmosphere.on) safe(Atmosphere.scan, Atmosphere, 'atmosphere.scan');
    if (Velocity.on) safe(Velocity.scan, Velocity, 'velocity.scan');
    S.sizeDirty = true;
  }
  function scheduleScan() {
    if (S.scanT) return;
    S.scanT = setTimeout(function () { S.scanT = 0; scanAll(); }, 350);
  }
  function computeReduced() {
    var r = S.opts.reducedMotion;
    if (r === true || r === false) return r;
    return !!(S.mqReduced && S.mqReduced.matches);
  }

  // =========================================================================
  // listeners
  // =========================================================================
  function listen(target, type, fn, opt) {
    target.addEventListener(type, fn, opt || false);
    S.unbind.push(function () { target.removeEventListener(type, fn, opt || false); });
  }
  function onMove(e) {
    var M = S.mouse;
    M.x = e.clientX; M.y = e.clientY; M.type = e.pointerType || 'mouse';
    if (M.type === 'touch') { M.inside = false; if (Cursor.on) Cursor.hide(true); return; }
    M.seen = true; M.inside = true;
    if (Cursor.on && !Cursor.visible && !S.apiHidden) { Cursor.show(); Cursor.hover(e.target); }
  }
  function onOver(e) {
    if (e.pointerType === 'touch') return;
    if (Cursor.on) Cursor.hover(e.target);
    if (Magnetic.on) Magnetic.hover(e.target);
  }
  function onOut(e) {
    if (e.relatedTarget) return; // still inside the document
    S.mouse.inside = false;      // left the window or entered an iframe
    if (Cursor.on) Cursor.hide(false);
    if (Magnetic.on) Magnetic.release();
  }
  function onDown(e) { if (e.pointerType !== 'touch' && Cursor.on) Cursor.press(true); }
  function onUp() { if (Cursor.on) Cursor.press(false); }
  function onResize() {
    S.vw = window.innerWidth; S.vh = window.innerHeight; S.sizeDirty = true;
    clearTimeout(S.resizeT);
    S.resizeT = setTimeout(resizeAll, 120);
  }
  function onVisibility() { S.hidden = !!document.hidden; ensureLoop(); }

  // =========================================================================
  // lifecycle
  // =========================================================================
  function clampOpts(o) {
    o.maxBlur = clamp(+o.maxBlur || 0, 0, 1.5);
    o.particleCount = clamp(o.particleCount | 0, 0, 79);
    if (['auto', true, false].indexOf(o.reducedMotion) < 0) o.reducedMotion = 'auto';
    return o;
  }

  function boot() {
    if (S.booted || !S.inited) return;
    S.booted = true;
    var de = document.documentElement;
    restyle();
    de.classList.add('cin-on');

    S.mqReduced = mq('(prefers-reduced-motion: reduce)');
    S.mqFine = mq('(hover: hover) and (pointer: fine)');
    S.reduced = computeReduced();
    S.fine = !!(S.mqFine && S.mqFine.matches);
    S.unbind.push(onMQ(S.mqReduced, function () { S.reduced = computeReduced(); sync(); }));
    S.unbind.push(onMQ(S.mqFine, function () { S.fine = !!(S.mqFine && S.mqFine.matches); sync(); }));

    var passive = { passive: true };
    listen(window, 'pointermove', onMove, passive);
    listen(document, 'pointerover', onOver, passive);
    listen(document, 'mouseout', onOut, passive);
    listen(window, 'pointerdown', onDown, passive);
    listen(window, 'pointerup', onUp, passive);
    listen(window, 'pointercancel', onUp, passive);
    listen(window, 'blur', function () { onUp(); }, false);
    listen(window, 'resize', onResize, passive);
    listen(window, 'load', function () { S.sizeDirty = true; scanAll(); }, false);
    listen(document, 'visibilitychange', onVisibility, false);
    listen(window, 'ambient:change', function () { S.sndCheck = 0; }, false);
    listen(window, 'ambient:geyser', function () { if (Breathe.on && S.sndOn) S.kick = 1; }, false);

    if (window.ResizeObserver && document.body) {
      S.ro = new ResizeObserver(function () { S.sizeDirty = true; });
      S.ro.observe(document.body);
    }
    if (window.MutationObserver && document.body) {
      S.mo = new MutationObserver(function (recs) {
        for (var i = 0; i < recs.length; i++) {
          var r = recs[i];
          if (isOurs(r.target)) continue;
          if (hasEl(r.addedNodes) || hasEl(r.removedNodes)) { scheduleScan(); return; }
        }
      });
      S.mo.observe(document.body, { childList: true, subtree: true });
    }

    S.vw = window.innerWidth || de.clientWidth || 0;
    S.vh = window.innerHeight || de.clientHeight || 0;
    S.sy = window.pageYOffset || 0;
    S.hidden = !!document.hidden;
    sync();
  }
  function hasEl(nodes) {
    for (var i = 0; i < nodes.length; i++) if (nodes[i].nodeType === 1 && !nodes[i].hasAttribute(LAYER_ATTR)) return true;
    return false;
  }

  function init(opts) {
    if (S.inited) { // re-init = live option update
      assign(S.opts, opts || {});
      clampOpts(S.opts);
      if (S.booted) { S.reduced = computeReduced(); restyle(); sync(); }
      return Cinema;
    }
    S.inited = true;
    S.opts = clampOpts(assign({}, DEFAULTS, opts || {}));
    if (document.body) boot();
    else document.addEventListener('DOMContentLoaded', boot, { once: true });
    return Cinema;
  }

  function destroy() {
    if (!S.inited) return Cinema;
    FEATURES.forEach(function (n) { var m = MODS[n]; if (m.on) { m.on = false; safe(m.stop, m, n + '.stop'); } });
    if (S.raf) cancelAnimationFrame(S.raf);
    S.unbind.forEach(function (f) { safe(f); });
    if (S.ro) S.ro.disconnect();
    if (S.mo) S.mo.disconnect();
    clearTimeout(S.scanT); clearTimeout(S.resizeT);
    detach(S.styleEl);
    document.documentElement.classList.remove('cin-on', 'cin-native-off', 'cin-hidden');
    S = fresh();
    return Cinema;
  }

  // =========================================================================
  // public API
  // =========================================================================
  var Cinema = {
    __cinema: true,
    version: VERSION,
    defaults: assign({}, DEFAULTS),
    features: FEATURES.slice(),
    init: init,
    destroy: destroy,
    refresh: function () { if (S.booted) { resizeAll(); scanAll(); sync(); } return Cinema; },
    set: function (o) { return init(o || {}); },
    toggle: function (name, force) {
      if (!S.opts || FEATURES.indexOf(name) < 0) return Cinema;
      S.opts[name] = force == null ? !S.opts[name] : !!force;
      sync();
      return Cinema;
    },
    enable: function (name) { return Cinema.toggle(name, true); },
    disable: function (name) { return Cinema.toggle(name, false); },
    isEnabled: function (name) { return !!(MODS[name] && MODS[name].on); },
    setAccent: function (c) { S.forced = c ? parseColor(c) : null; return Cinema; },
    setSound: function (on) { S.soundOverride = on == null ? null : !!on; S.sndCheck = 0; return Cinema; },
    hide: function () {
      S.apiHidden = true;
      document.documentElement.classList.add('cin-hidden');
      sync();
      return Cinema;
    },
    show: function () {
      S.apiHidden = false;
      document.documentElement.classList.remove('cin-hidden');
      sync();
      return Cinema;
    }
  };
  Object.defineProperty(Cinema, 'state', {
    enumerable: true,
    get: function () {
      var f = {};
      FEATURES.forEach(function (n) { f[n] = !!MODS[n].on; });
      return {
        inited: S.inited, running: !!S.raf, reduced: S.reduced, fine: S.fine, hidden: S.apiHidden,
        day: S.dayId, accent: S.day ? hex(S.accent) : null, forced: S.forced ? hex(S.forced) : null,
        velocity: +S.vel.toFixed(3), breath: +S.breath.toFixed(3), sound: S.sndOn, features: f,
        options: S.opts ? assign({}, S.opts) : null
      };
    }
  });

  window.Cinema = Cinema;
})(window, document);
