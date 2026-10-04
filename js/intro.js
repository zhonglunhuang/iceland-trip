/* =========================================================
   冰島任務 — cinematic opening sequence  (window.Intro)
   ---------------------------------------------------------
   Classic script, zero dependencies. Injects its own <style>
   and a fixed full-screen overlay (z-index 10000):

     Screen 1  black gate · breathing glass「開始旅程」button
     0.0s      airplane window → push through the glass
     1.0s      clouds rush toward camera (procedural noise
               sprites, motion smear, turbulence shake, white-outs)
               captions: 北緯 64 度 → 一座由冰與火組成的島 → 10 天 · 2,300 公里
     4.3s      clouds part → aurora.jpg push-in + aurora shimmer
     5.6s      giant title assembles (blur-in, gradient text)
     8.0s      letterbox bars slide away, overlay dissolves
     9.45s     onDone() · overlay removed · scroll restored

   API
     Intro.init({ onDone, onReveal, onStart, force, image, title,
                  subtitle, dates, captions })  -> true if shown
     Intro.play(opts)      force replay (opts.immediate: skip the gate;
                           only do that from a user gesture → audio)
     Intro.skip()          600ms fade out
     Intro.isActive()      overlay currently on screen?
     Intro.whenRevealed()  Promise — page beneath becomes visible
     Intro.whenDone()      Promise — overlay removed, scroll restored
     Intro.reset()         forget the "seen this session" flag
   Events on window: intro:open · intro:start · intro:reveal · intro:done
   URL: ?intro=1 forces the intro, ?intro=0 disables it.
   ========================================================= */
(function () {
  'use strict';

  var W = window, D = document;
  if (W.Intro && W.Intro.__ixo) return;

  var KEY = 'iceland-trip:intro-seen:v1';
  var FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Noto Sans TC", "PingFang TC", "Helvetica Neue", sans-serif';
  var EASE_CSS = 'cubic-bezier(.2,.8,.2,1)';
  var TAU = Math.PI * 2;

  /* ---------- timeline (seconds after「開始旅程」) ---------- */
  var TL = {
    fadeIn: [0.25, 1.15],
    push: [1.05, 2.05],          // through the window
    rush: [1.0, 2.35],           // speed ramp
    fog1: 2.15, fog2: 3.9,       // white-outs (captions swap behind them)
    caps: [[0.55, 2.05], [2.25, 3.85], [3.95, 5.55]],
    part: [4.3, 5.85],           // clouds part
    img: 4.15,
    title: 5.6,
    line: [6.75, 7.9], sub: [6.9, 7.9], dates: [7.05, 8.0],
    skipOut: [7.5, 8.0],
    bars: [7.95, 8.85],
    dissolve: 8.35,
    end: 9.45
  };
  var DISSOLVE_MS = 1100, SKIP_MS = 600;

  var DEFAULT_CAPS = [
    { kicker: '64°08′N · 21°56′W', text: '北緯 64 度' },
    { kicker: 'FIRE & ICE', text: '一座由冰與火組成的島' },
    { kicker: 'ROUTE 1 · RING ROAD', text: '10 天 · 2,300 公里' }
  ];

  /* ---------- math ---------- */
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function prog(t, a, b) { return clamp01((t - a) / (b - a)); }
  function smooth(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
  function sstep(e0, e1, x) { return smooth((x - e0) / (e1 - e0)); }
  function inCubic(x) { return x * x * x; }
  function inOut(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function outSine(x) { return Math.sin(x * Math.PI / 2); }
  function gauss(t, c, w) { var d = (t - c) / w; return Math.exp(-d * d); }
  function bezier(p1x, p1y, p2x, p2y) {
    var cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
    var cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
    function sx(t) { return ((ax * t + bx) * t + cx) * t; }
    function sy(t) { return ((ay * t + by) * t + cy) * t; }
    function dx(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x, i, e, d;
      for (i = 0; i < 8; i++) {
        e = sx(t) - x;
        if (Math.abs(e) < 1e-5) return sy(t);
        d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      var lo = 0, hi = 1; t = x;
      for (i = 0; i < 24; i++) {
        e = sx(t);
        if (Math.abs(e - x) < 1e-5) break;
        if (x > e) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return sy(t);
    };
  }
  var ease = bezier(0.2, 0.8, 0.2, 1);

  function makeRand(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  function valueNoise(rand) {
    var N = 256, g = new Float32Array(N * N), i;
    for (i = 0; i < N * N; i++) g[i] = rand();
    return function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      var x0 = xi & 255, y0 = yi & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
      var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      var a = g[y0 * N + x0], b = g[y0 * N + x1], c = g[y1 * N + x0], d = g[y1 * N + x1];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }

  /* ---------- small helpers ---------- */
  function mq(q) { try { return !!(W.matchMedia && W.matchMedia(q).matches); } catch (e) { return false; } }
  function now() { return (W.performance && performance.now) ? performance.now() : Date.now(); }
  function raf(fn) { return (W.requestAnimationFrame || function (f) { return setTimeout(function () { f(now()); }, 16); })(fn); }
  function caf(id) { (W.cancelAnimationFrame || clearTimeout)(id); }
  function canvas(w, h) { var c = D.createElement('canvas'); c.width = w; c.height = h; return c; }
  function chars(str) { return Array.from ? Array.from(str) : String(str).split(''); }
  function el(tag, cls, text) {
    var e = D.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function amb(method, arg) {
    var A = W.Ambient;
    if (!A || typeof A[method] !== 'function') return;
    try {
      var r = arguments.length > 1 ? A[method](arg) : A[method]();
      if (r && typeof r.catch === 'function') r.catch(function () {});
    } catch (e) { /* audio is optional */ }
  }
  function emit(name, detail) {
    try { W.dispatchEvent(new CustomEvent('intro:' + name, { detail: detail || {} })); } catch (e) {}
  }
  function call(fn, arg) {
    if (typeof fn !== 'function') return;
    try { fn(arg); } catch (e) { if (W.console) console.error('[Intro] callback error', e); }
  }
  function afterDomReady(fn) {
    var go = function () { setTimeout(fn, 0); };
    if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', go, { once: true });
    else go();
  }
  function seen() { try { return W.sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function markSeen() { try { W.sessionStorage.setItem(KEY, '1'); } catch (e) {} }
  function urlFlag() {
    try { var m = /[?&]intro=([^&#]*)/.exec(W.location.search); return m ? decodeURIComponent(m[1]) : null; }
    catch (e) { return null; }
  }
  function cssUrl(u) { return 'url("' + String(u).replace(/["\\\n]/g, '\\$&') + '")'; }
  function setS(e, prop, val) {
    var c = e.__ixo || (e.__ixo = {});
    if (c[prop] !== val) { c[prop] = val; e.style[prop] = val; }
  }
  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /* =========================================================
     STYLE
     ========================================================= */
  var CSS = [
    '@property --ixo-a{syntax:"<angle>";inherits:false;initial-value:0deg}',
    '.ixo{position:fixed;inset:0;z-index:10000;background:#000;color:#fff;font-family:' + FONT + ';overflow:hidden;touch-action:none;overscroll-behavior:contain;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;contain:strict;--bar:9vh;opacity:1}',
    '.ixo *,.ixo *::before,.ixo *::after{box-sizing:border-box}',
    '.ixo button{font-family:inherit;-webkit-appearance:none;appearance:none}',
    '.ixo button:focus{outline:none}',
    '.ixo button:focus-visible{outline:2px solid rgba(127,227,255,.85);outline-offset:4px}',
    '.ixo__stage{position:absolute;inset:0;transform-origin:50% 50%}',
    '.ixo__img{position:absolute;inset:-1%;background:#05070c center 60%/cover no-repeat;opacity:0;transform-origin:50% 58%}',
    '.ixo__shade{position:absolute;inset:0;opacity:0;background:radial-gradient(120% 95% at 50% 52%,rgba(0,0,0,.05) 0%,rgba(0,0,0,.4) 60%,rgba(0,0,0,.78) 100%)}',
    '.ixo__aurora{position:absolute;left:0;top:0;width:100%;height:100%;opacity:0;mix-blend-mode:screen;-webkit-mask-image:linear-gradient(180deg,#000 0%,#000 42%,transparent 86%);mask-image:linear-gradient(180deg,#000 0%,#000 42%,transparent 86%)}',
    '.ixo__clouds{position:absolute;left:0;top:0;width:100%;height:100%;display:block}',
    '.ixo__vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 90% 80% at 50% 50%,transparent 52%,rgba(0,0,0,.62) 100%)}',
    '.ixo__halo{position:absolute;left:50%;top:50%;width:min(1200px,150vw);height:min(620px,90vw);transform:translate(-50%,-50%);opacity:0;pointer-events:none;background:radial-gradient(closest-side,rgba(0,4,10,.55),rgba(0,4,10,.25) 55%,rgba(0,0,0,0)),radial-gradient(closest-side,rgba(107,255,184,.10),rgba(127,227,255,0) 70%)}',
    '.ixo__title{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none;padding:0 16px}',
    '.ixo__h{margin:0;font-weight:800;font-size:clamp(66px,19vw,232px);line-height:1.04;letter-spacing:-.035em;white-space:nowrap;position:relative}',
    '.ixo__ch{display:inline-block;opacity:0;transform-origin:50% 60%}',
    '.ixo__g{display:block;padding:.04em 0;color:transparent;-webkit-text-fill-color:transparent;background-image:linear-gradient(100deg,#7fe3ff 0%,#6bffb8 25%,#b38cff 50%,#6bffb8 75%,#7fe3ff 100%);background-repeat:repeat-x;-webkit-background-clip:text;background-clip:text}',
    '.ixo__line{width:min(340px,54vw);height:1px;margin-top:clamp(16px,2.4vw,30px);background:linear-gradient(90deg,transparent,#7fe3ff 22%,#6bffb8 50%,#b38cff 78%,transparent);transform:scaleX(0);opacity:.9}',
    '.ixo__sub{margin:clamp(14px,2vw,24px) 0 0;padding-left:.32em;font-size:clamp(12px,1.45vw,17px);font-weight:500;letter-spacing:.32em;color:rgba(255,255,255,.86);opacity:0}',
    '.ixo__dates{margin:10px 0 0;padding-left:.42em;font-size:clamp(10px,1.05vw,12px);font-weight:500;letter-spacing:.42em;color:rgba(255,255,255,.5);font-variant-numeric:tabular-nums;opacity:0}',
    '.ixo__caps{position:absolute;left:0;right:0;bottom:calc(var(--bar) + clamp(30px,9vh,104px));display:grid;place-items:center;pointer-events:none;padding:0 20px}',
    '.ixo__cap{grid-area:1/1;text-align:center;opacity:0;visibility:hidden}',
    '.ixo__kick{display:block;margin-bottom:12px;padding-left:.42em;font-size:clamp(10px,.95vw,12px);font-weight:500;letter-spacing:.42em;color:rgba(255,255,255,.58)}',
    '.ixo__txt{display:block;font-size:clamp(22px,3.1vw,44px);font-weight:600;line-height:1.2;letter-spacing:.06em;color:#fff;text-shadow:0 2px 28px rgba(0,0,0,.5)}',
    '.ixo__grain{position:absolute;inset:0;z-index:2;pointer-events:none;opacity:.34;background-size:180px 180px;animation:ixo-grain 1s steps(1,end) infinite}',
    '@keyframes ixo-grain{0%{background-position:0 0}12%{background-position:-61px 37px}25%{background-position:43px -77px}37%{background-position:-97px -23px}50%{background-position:71px 89px}62%{background-position:-29px 113px}75%{background-position:107px -41px}87%{background-position:-83px 67px}}',
    '.ixo__bar{position:absolute;left:0;right:0;height:var(--bar);background:#000;z-index:3}',
    '.ixo__bar--t{top:0}.ixo__bar--b{bottom:0}',
    '.ixo__prog{position:absolute;left:0;top:0;width:100%;height:1px;transform-origin:0 50%;transform:scaleX(0);opacity:.5;background:linear-gradient(90deg,rgba(127,227,255,0),rgba(127,227,255,.9) 30%,rgba(107,255,184,.9) 65%,rgba(179,140,255,.9))}',
    '.ixo__skip{position:absolute;z-index:6;right:max(14px,env(safe-area-inset-right));bottom:max(8px,calc(var(--bar) / 2 - 17px));height:34px;padding:0 14px;display:inline-flex;align-items:center;gap:9px;border:0;border-radius:999px;background:transparent;color:rgba(255,255,255,.62);font-size:13px;font-weight:500;letter-spacing:.16em;cursor:pointer;transition:color .3s,background-color .3s}',
    '.ixo__skip:hover{color:#fff;background:rgba(255,255,255,.09)}',
    '.ixo__skip kbd{font:500 10px/1 ' + FONT + ';letter-spacing:.06em;padding:4px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.22);color:rgba(255,255,255,.5)}',
    '@media (hover:none){.ixo__skip kbd{display:none}}',
    /* gate */
    '.ixo__gate{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;background:#000;transition:opacity .9s cubic-bezier(.4,0,.2,1) .15s}',
    '.ixo__gate::before{content:"";position:absolute;inset:-25%;pointer-events:none;background:radial-gradient(38% 30% at 32% 68%,rgba(107,255,184,.13),rgba(107,255,184,0) 70%),radial-gradient(34% 28% at 68% 34%,rgba(179,140,255,.12),rgba(179,140,255,0) 70%),radial-gradient(46% 36% at 50% 52%,rgba(127,227,255,.07),rgba(127,227,255,0) 70%);animation:ixo-drift 16s ease-in-out infinite alternate}',
    '@keyframes ixo-drift{from{transform:translate3d(-3%,2%,0) rotate(-5deg) scale(1)}to{transform:translate3d(3%,-2%,0) rotate(5deg) scale(1.1)}}',
    '.ixo__gin{position:relative;display:flex;flex-direction:column;align-items:center;padding:0 16px;transition:transform 1.1s ' + EASE_CSS + ',filter 1s ' + EASE_CSS + ',opacity .8s ' + EASE_CSS + '}',
    '.ixo__eyebrow{margin:0 0 34px;padding-left:.5em;font-size:11px;font-weight:500;letter-spacing:.5em;color:rgba(255,255,255,.5);opacity:0;animation:ixo-rise 1.4s ' + EASE_CSS + ' .2s forwards;text-align:center}',
    '.ixo__sw{position:relative;opacity:0;animation:ixo-rise 1.4s ' + EASE_CSS + ' .38s forwards}',
    '.ixo__glow{position:absolute;inset:-22px -30px;border-radius:999px;background:linear-gradient(100deg,#7fe3ff,#6bffb8 50%,#b38cff);filter:blur(30px);opacity:.3;transform:scale(.9);animation:ixo-breathe 3.4s ease-in-out infinite;pointer-events:none}',
    '@keyframes ixo-breathe{0%,100%{opacity:.22;transform:scale(.88)}50%{opacity:.62;transform:scale(1.06)}}',
    '.ixo__start{position:relative;display:inline-flex;align-items:center;gap:14px;height:64px;padding:0 34px 0 14px;border:0;border-radius:999px;cursor:pointer;color:#fff;font-size:17px;font-weight:600;letter-spacing:.14em;background:rgba(255,255,255,.07);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),inset 0 1px 0 rgba(255,255,255,.25),0 24px 60px -24px rgba(0,0,0,.9);transition:transform .6s ' + EASE_CSS + ',background-color .4s}',
    '.ixo__start:hover{transform:scale(1.04);background-color:rgba(255,255,255,.11)}',
    '.ixo__start:active{transform:scale(.97)}',
    '.ixo__ring{position:absolute;inset:0;border-radius:inherit;padding:1px;pointer-events:none;background:conic-gradient(from var(--ixo-a),rgba(255,255,255,0) 0deg,rgba(255,255,255,0) 200deg,#7fe3ff 260deg,#6bffb8 310deg,#b38cff 350deg,rgba(255,255,255,0) 360deg);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);animation:ixo-spin 4.5s linear infinite}',
    '@keyframes ixo-spin{to{--ixo-a:360deg}}',
    '.ixo__play{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;color:#03131a;background:linear-gradient(135deg,#7fe3ff,#6bffb8 55%,#b38cff);box-shadow:0 0 22px rgba(107,255,184,.45)}',
    '.ixo__play svg{width:15px;height:15px;margin-left:2px}',
    '.ixo__hint{display:flex;align-items:center;gap:8px;margin:28px 0 0;font-size:13px;letter-spacing:.08em;color:rgba(255,255,255,.55);opacity:0;animation:ixo-rise 1.4s ' + EASE_CSS + ' .56s forwards;text-align:center}',
    '.ixo__hint svg{width:16px;height:16px;flex:none;opacity:.8}',
    '@keyframes ixo-rise{from{opacity:0;transform:translate3d(0,14px,0);filter:blur(8px)}to{opacity:1;transform:none;filter:blur(0)}}',
    '.ixo__flash{position:absolute;left:50%;top:50%;width:240px;height:240px;margin:-120px 0 0 -120px;border-radius:50%;pointer-events:none;background:radial-gradient(closest-side,rgba(230,255,248,.85),rgba(127,227,255,.35) 45%,rgba(179,140,255,0));opacity:0;transform:scale(.2)}',
    '.ixo-go .ixo__flash{opacity:0;transform:scale(9);transition:transform 1.1s ' + EASE_CSS + ',opacity 1.1s cubic-bezier(.4,0,.2,1)}',
    '.ixo-go .ixo__flash.ixo-f0{opacity:.9;transform:scale(.2);transition:none}',
    '.ixo-go .ixo__gate{opacity:0;pointer-events:none}',
    '.ixo-go .ixo__gin{opacity:0;transform:scale(1.12);filter:blur(14px)}',
    '.ixo-go .ixo__gate::before{animation-play-state:paused}',
    /* exits */
    '.ixo.ixo-out{opacity:0;transition:opacity ' + DISSOLVE_MS + 'ms cubic-bezier(.45,0,.25,1)}',
    '.ixo.ixo-out .ixo__stage{transform:scale(1.07);filter:blur(14px);transition:transform ' + DISSOLVE_MS + 'ms ' + EASE_CSS + ',filter ' + DISSOLVE_MS + 'ms cubic-bezier(.45,0,.25,1)}',
    '.ixo.ixo-skip{opacity:0;transition:opacity ' + SKIP_MS + 'ms cubic-bezier(.4,0,.2,1)}',
    '.ixo.ixo-skip .ixo__stage,.ixo.ixo-skip .ixo__gin{transform:scale(1.04);filter:blur(8px);transition:transform ' + SKIP_MS + 'ms ' + EASE_CSS + ',filter ' + SKIP_MS + 'ms ' + EASE_CSS + '}',
    /* reduced-motion still card */
    '.ixo--still .ixo__img{opacity:1}',
    '.ixo--still .ixo__shade{opacity:.85}',
    '.ixo--still .ixo__halo,.ixo--still .ixo__ch,.ixo--still .ixo__sub,.ixo--still .ixo__dates{opacity:1}',
    '.ixo--still .ixo__line{transform:none}',
    '.ixo--still .ixo__clouds,.ixo--still .ixo__aurora,.ixo--still .ixo__caps,.ixo--still .ixo__grain,.ixo--still .ixo__bar,.ixo--still .ixo__gate,.ixo--still .ixo__skip{display:none}',
    '.ixo.ixo-fade{opacity:0;transition:opacity 1s ease}',
    '@media (prefers-reduced-motion:reduce){.ixo__gate::before,.ixo__glow,.ixo__ring,.ixo__grain{animation:none}}',
    '@media (max-width:520px){.ixo__start{height:58px;font-size:16px;padding:0 28px 0 11px;gap:12px}.ixo__play{width:36px;height:36px}.ixo__eyebrow{letter-spacing:.38em;font-size:10px;margin-bottom:28px}.ixo__hint{font-size:12px}}'
  ].join('\n');

  function injectStyle() {
    if (D.getElementById('ixo-style')) return;
    var s = el('style');
    s.id = 'ixo-style';
    s.textContent = CSS;
    (D.head || D.documentElement).appendChild(s);
  }

  /* =========================================================
     PROCEDURAL TEXTURES
     ========================================================= */
  // Volumetric-looking cloud puff: fbm-eroded lobes, self-shadowed from above.
  function makeCloud(size, seed) {
    var S = size;
    var rand = makeRand(seed * 9973 + 7), noise = valueNoise(rand);
    var ox = rand() * 120, oy = rand() * 120;
    var Dn = new Float32Array(S * S);
    var lobes = [], n = 3 + Math.floor(rand() * 3), i, j, k;
    for (k = 0; k < n; k++) {
      lobes.push({ x: (rand() - 0.5) * 0.72, y: (rand() - 0.5) * 0.34 - 0.06, r: 0.34 + rand() * 0.3 });
    }
    for (j = 0; j < S; j++) {
      var v = (j + 0.5) / S * 2 - 1;
      for (i = 0; i < S; i++) {
        var u = (i + 0.5) / S * 2 - 1;
        var sh = 0;
        for (k = 0; k < n; k++) {
          var L = lobes[k], ddx = u - L.x, ddy = (v - L.y) * 1.15;
          var q = 1 - Math.sqrt(ddx * ddx + ddy * ddy) / L.r;
          if (q > sh) sh = q;
        }
        var f = 0, amp = 0.5, fr = 2.6;
        for (k = 0; k < 5; k++) { f += amp * noise(u * fr + ox, v * fr + oy); amp *= 0.5; fr *= 2.03; }
        var d = sh * 1.3 + (f - 0.5) * 1.15;
        d -= sstep(0.2, 0.85, v) * 0.3;                         // flatter, thinner base
        var r = Math.sqrt(u * u + v * v);
        d *= 1 - sstep(0.78, 1.0, r);
        Dn[j * S + i] = d > 0 ? d : 0;
      }
    }
    var cv = canvas(S, S), c = cv.getContext('2d');
    var img = c.createImageData(S, S), px = img.data;
    var sc = S / 256, offs = [3 * sc, 8 * sc, 15 * sc, 26 * sc];
    var hiR = 186, hiG = 201, hiB = 224, loR = 24, loG = 33, loB = 52;
    for (j = 0; j < S; j++) {
      for (i = 0; i < S; i++) {
        var idx = j * S + i, dd = Dn[idx];
        var a = sstep(0.02, 0.55, dd);
        if (a <= 0) continue;
        var occ = 0;
        for (k = 0; k < 4; k++) {
          var jj = Math.round(j - offs[k]), ii = Math.round(i - offs[k] * 0.4);
          if (jj >= 0 && ii >= 0) occ += Dn[jj * S + ii];
        }
        occ *= 0.25;
        var b = Math.exp(-occ * 2.2);                           // light reaching this point
        b = 0.14 + 0.86 * b;
        var core = sstep(0.45, 1.3, dd);
        b *= 1 - core * 0.22;
        var rim = (1 - a) * b * 0.28;                           // silver lining
        var o = idx * 4;
        px[o] = Math.min(255, loR + (hiR - loR) * b + rim * 255);
        px[o + 1] = Math.min(255, loG + (hiG - loG) * b + rim * 255);
        px[o + 2] = Math.min(255, loB + (hiB - loB) * b + rim * 255);
        px[o + 3] = a * 255;
      }
    }
    c.putImageData(img, 0, 0);
    return cv;
  }
  function flipped(src) {
    var cv = canvas(src.width, src.height), c = cv.getContext('2d');
    c.translate(src.width, 0); c.scale(-1, 1); c.drawImage(src, 0, 0);
    return cv;
  }
  function glowTex(r, g, b) {
    var cv = canvas(128, 128), c = cv.getContext('2d');
    var gr = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',1)');
    gr.addColorStop(0.35, 'rgba(' + r + ',' + g + ',' + b + ',.45)');
    gr.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
    return cv;
  }
  function curtainTex(stops) {
    var cv = canvas(4, 128), c = cv.getContext('2d');
    var gr = c.createLinearGradient(0, 0, 0, 128);
    for (var i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    c.fillStyle = gr; c.fillRect(0, 0, 4, 128);
    return cv;
  }
  function grainURL() {
    try {
      var n = 180, cv = canvas(n, n), c = cv.getContext('2d');
      var img = c.createImageData(n, n), px = img.data, rand = makeRand(1234);
      for (var i = 0; i < n * n; i++) {
        var v = rand(), w = v > 0.5 ? 255 : 0, a = Math.abs(v - 0.5) * 2;
        px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = w;
        px[i * 4 + 3] = a * a * 70;
      }
      c.putImageData(img, 0, 0);
      return cv.toDataURL('image/png');
    } catch (e) { return ''; }
  }

  /* =========================================================
     STATE
     ========================================================= */
  var S = null;                 // active run
  var cfg = {};                 // last init options
  var revealQ = [], doneQ = [];

  function flush(q, v) { var a = q.splice(0); for (var i = 0; i < a.length; i++) a[i](v); }

  function tripData(o) {
    var t = W.TRIP || {};
    return {
      title: o.title || t.title || '冰島任務',
      subtitle: o.subtitle || t.subtitle || 'Fire & Ice',
      dates: o.dates != null ? o.dates : (t.dates || ''),
      image: o.image || 'assets/img/aurora.jpg',
      captions: (o.captions && o.captions.length) ? o.captions : DEFAULT_CAPS
    };
  }

  /* =========================================================
     DOM
     ========================================================= */
  var SVG_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11.3-7.2c.6-.4.6-1.4 0-1.8L8.6 3.9C7.9 3.5 7 4 7 4.8z" fill="currentColor"/></svg>';
  var SVG_PHONES = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.6"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.6"/></svg>';

  function build(st) {
    var data = st.data;
    var root = el('div', 'ixo');
    root.id = 'ixo-intro';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '開場動畫：' + data.title);
    root.setAttribute('data-lenis-prevent', '');

    var stage = el('div', 'ixo__stage');
    var img = el('div', 'ixo__img');
    img.style.backgroundImage = cssUrl(data.image);
    var shade = el('div', 'ixo__shade');
    var aur = el('canvas', 'ixo__aurora');
    var cv = el('canvas', 'ixo__clouds');
    aur.setAttribute('aria-hidden', 'true');
    cv.setAttribute('aria-hidden', 'true');
    var vig = el('div', 'ixo__vig');
    var halo = el('div', 'ixo__halo');

    var title = el('div', 'ixo__title');
    var h = el('h1', 'ixo__h');
    h.setAttribute('aria-label', data.title);
    var chs = [];
    chars(data.title).forEach(function (ch) {
      var o = el('span', 'ixo__ch'), g = el('span', 'ixo__g', ch === ' ' ? ' ' : ch);
      o.setAttribute('aria-hidden', 'true');
      o.appendChild(g); h.appendChild(o);
      chs.push({ el: o, g: g, ox: 0 });
    });
    var line = el('div', 'ixo__line');
    var sub = el('p', 'ixo__sub', data.subtitle);
    var dates = el('p', 'ixo__dates', data.dates);
    title.appendChild(h); title.appendChild(line); title.appendChild(sub);
    if (data.dates) title.appendChild(dates);

    var capsWrap = el('div', 'ixo__caps');
    capsWrap.setAttribute('aria-hidden', 'true');
    var caps = data.captions.slice(0, 3).map(function (cp) {
      var c = el('div', 'ixo__cap');
      if (cp.kicker) c.appendChild(el('span', 'ixo__kick', cp.kicker));
      var tx = el('span', 'ixo__txt', cp.text || '');
      c.appendChild(tx);
      capsWrap.appendChild(c);
      return { el: c, txt: tx, vis: false };
    });

    [img, shade, aur, cv, vig, halo, title, capsWrap].forEach(function (n) { stage.appendChild(n); });
    root.appendChild(stage);

    var grain = el('div', 'ixo__grain');
    var gu = grainURL();
    if (gu) grain.style.backgroundImage = 'url(' + gu + ')';
    root.appendChild(grain);

    var barT = el('div', 'ixo__bar ixo__bar--t'), barB = el('div', 'ixo__bar ixo__bar--b');
    var progEl = el('i', 'ixo__prog');
    barB.appendChild(progEl);
    root.appendChild(barT); root.appendChild(barB);

    // gate
    var gate = el('div', 'ixo__gate');
    var gin = el('div', 'ixo__gin');
    var eyebrow = el('p', 'ixo__eyebrow', 'ICELAND' + (data.dates ? ' · ' + data.dates : ''));
    var sw = el('div', 'ixo__sw');
    var glow = el('span', 'ixo__glow');
    var start = el('button', 'ixo__start');
    start.type = 'button';
    start.setAttribute('aria-label', '開始旅程（播放開場動畫）');
    start.innerHTML = '<span class="ixo__ring"></span><span class="ixo__play">' + SVG_PLAY + '</span><span class="ixo__lbl"></span>';
    start.querySelector('.ixo__lbl').textContent = '開始旅程';
    sw.appendChild(glow); sw.appendChild(start);
    var hint = el('p', 'ixo__hint');
    hint.innerHTML = SVG_PHONES + '<span></span>';
    hint.lastChild.textContent = '建議開啟聲音 · 戴上耳機';
    var flash = el('span', 'ixo__flash');
    gin.appendChild(eyebrow); gin.appendChild(sw); gin.appendChild(hint);
    gate.appendChild(flash); gate.appendChild(gin);
    root.appendChild(gate);

    var skipBtn = el('button', 'ixo__skip');
    skipBtn.type = 'button';
    skipBtn.setAttribute('aria-label', '略過開場動畫');
    skipBtn.innerHTML = '<span></span><kbd>Esc</kbd>';
    skipBtn.firstChild.textContent = '略過';
    root.appendChild(skipBtn);

    st.root = root; st.stage = stage; st.img = img; st.shade = shade; st.aur = aur; st.cv = cv;
    st.halo = halo; st.hEl = h; st.chs = chs; st.line = line; st.sub = sub; st.dates = dates;
    st.caps = caps; st.barT = barT; st.barB = barB; st.progEl = progEl;
    st.gate = gate; st.start = start; st.flash = flash; st.skipBtn = skipBtn;

    start.addEventListener('click', function () { begin(st); });
    skipBtn.addEventListener('click', function () { skip(); });

    D.body.appendChild(root);
  }

  /* ---------- scroll lock / input ---------- */
  var SCROLL_KEYS = { ' ': 1, Spacebar: 1, PageUp: 1, PageDown: 1, End: 1, Home: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };

  function lock(st) {
    var de = D.documentElement, b = D.body;
    var sbw = Math.max(0, W.innerWidth - de.clientWidth);
    st.saved = { ho: de.style.overflow, bo: b.style.overflow, bpr: b.style.paddingRight };
    de.style.overflow = 'hidden';
    b.style.overflow = 'hidden';
    if (sbw) b.style.paddingRight = sbw + 'px';
    de.classList.add('ixo-lock');
    try { if (W.lenis && typeof W.lenis.stop === 'function') { W.lenis.stop(); st.lenisStopped = true; } } catch (e) {}
  }
  function unlock(st) {
    var de = D.documentElement, b = D.body, s = st.saved || {};
    de.style.overflow = s.ho || '';
    b.style.overflow = s.bo || '';
    b.style.paddingRight = s.bpr || '';
    de.classList.remove('ixo-lock');
    try { if (st.lenisStopped && W.lenis && typeof W.lenis.start === 'function') W.lenis.start(); } catch (e) {}
  }

  function bind(st) {
    st.onKey = function (e) {
      if (S !== st) return;
      var k = e.key;
      if (k === 'Escape' || k === 'Esc') { e.preventDefault(); skip(); return; }
      var t = e.target, ours = t && st.root.contains(t) && t.tagName === 'BUTTON';
      if (k === 'Enter' && st.phase === 'gate' && !ours) { e.preventDefault(); begin(st); return; }
      if (k === 'Tab') {
        var btns = Array.prototype.filter.call(st.root.querySelectorAll('button'), function (b) {
          return b.offsetParent !== null && !b.disabled;
        });
        if (!btns.length) { e.preventDefault(); return; }
        var i = btns.indexOf(D.activeElement);
        e.preventDefault();
        btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus({ preventScroll: true });
        return;
      }
      if (SCROLL_KEYS[k] && !(ours && (k === ' ' || k === 'Spacebar'))) e.preventDefault();
    };
    st.onBlock = function (e) { if (e.cancelable) e.preventDefault(); };
    var rt;
    st.onResize = function () { clearTimeout(rt); rt = setTimeout(function () { if (S === st) resize(st); }, 90); };
    W.addEventListener('keydown', st.onKey, true);
    st.root.addEventListener('wheel', st.onBlock, { passive: false });
    st.root.addEventListener('touchmove', st.onBlock, { passive: false });
    W.addEventListener('resize', st.onResize);
  }
  function unbind(st) {
    W.removeEventListener('keydown', st.onKey, true);
    W.removeEventListener('resize', st.onResize);
    if (st.root) {
      st.root.removeEventListener('wheel', st.onBlock);
      st.root.removeEventListener('touchmove', st.onBlock);
    }
  }

  /* ---------- sizing ---------- */
  var MAXPX = 2.6e6;

  function resize(st) {
    var w = Math.max(1, W.innerWidth), h = Math.max(1, W.innerHeight);
    st.w = w; st.h = h; st.diag = Math.sqrt(w * w + h * h);
    st.F = 0.62 * Math.max(w, h);
    var bar = Math.round(h * (w > h ? 0.105 : 0.075));
    st.root.style.setProperty('--bar', bar + 'px');
    sizeClouds(st);
    // aurora canvas: deliberately low-res, CSS upscales (soft by nature)
    st.aw = w < 700 ? 240 : 380;
    st.ah = Math.max(80, Math.min(900, Math.round(st.aw * h / w)));
    st.aur.width = st.aw; st.aur.height = st.ah;
    st.actx = st.aur.getContext('2d');
    measureTitle(st);
  }
  function sizeClouds(st) {
    var dpr = Math.min(W.devicePixelRatio || 1, 2);
    var rs = dpr * (st.q || 1);
    if (st.w * st.h * rs * rs > MAXPX) rs = Math.sqrt(MAXPX / (st.w * st.h));
    st.rs = rs;
    st.cv.width = Math.max(1, Math.round(st.w * rs));
    st.cv.height = Math.max(1, Math.round(st.h * rs));
    st.ctx = st.cv.getContext('2d', { alpha: true });
    var pad = 60, c = st.ctx;
    var g = c.createLinearGradient(0, -pad, 0, st.h + pad);
    g.addColorStop(0, '#02050b');
    g.addColorStop(0.36, '#08121f');
    g.addColorStop(0.5, '#15243a');
    g.addColorStop(0.62, '#0d1828');
    g.addColorStop(1, '#050a12');
    st.sky = g;
  }
  function measureTitle(st) {
    if (!st.hEl || !st.chs) return;
    var tw = st.hEl.offsetWidth || 1;
    st.titleW = tw;
    st.fs = parseFloat(W.getComputedStyle(st.hEl).fontSize) || 120;
    for (var i = 0; i < st.chs.length; i++) {
      var c = st.chs[i];
      c.ox = c.el.offsetLeft;
      c.g.style.backgroundSize = (tw * 2) + 'px 100%';
      c.g.style.backgroundPosition = (-c.ox) + 'px 0';
    }
  }

  /* =========================================================
     FLOW
     ========================================================= */
  function open(o) {
    if (S) return false;
    injectStyle();
    var st = {
      o: o, data: tripData(o), alive: true, phase: 'gate', T: 0, q: 1,
      reduced: mq('(prefers-reduced-motion: reduce)'),
      lowPower: (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || Math.min(W.innerWidth, W.innerHeight) < 600,
      tex: [], cues: {}
    };
    S = st;
    if (!D.body) {
      D.addEventListener('DOMContentLoaded', function () { if (S === st) mount(st); }, { once: true });
    } else {
      mount(st);
    }
    return true;
  }

  function mount(st) {
    build(st);
    lock(st);
    bind(st);
    resize(st);
    if (D.fonts && D.fonts.ready) D.fonts.ready.then(function () { if (S === st) measureTitle(st); });
    // warm the photo so the reveal never pops in late
    try {
      var im = new Image();
      im.decoding = 'async';
      im.src = st.data.image;
      if (im.decode) im.decode().catch(function () {});
      st.preload = im;
    } catch (e) {}
    emit('open', { reduced: st.reduced });

    if (st.reduced) { runStill(st); return; }
    if (st.o.immediate) {
      // direct replay: no gate at all (call from a user gesture so audio may start)
      if (st.gate.parentNode) st.gate.parentNode.removeChild(st.gate);
      begin(st);
      return;
    }
    // generate cloud textures while the viewer reads the gate
    genTextures(st, false);
  }

  function genTextures(st, sync) {
    var n = st.lowPower ? 4 : 5, size = st.lowPower ? 192 : 256;
    st.nTex = n * 2;
    function one() {
      var i = st.tex.length / 2;
      var t = makeCloud(size, 17 + i * 41);
      st.tex.push(t, flipped(t));
    }
    if (sync) { while (st.tex.length < st.nTex) one(); return; }
    (function step() {
      if (S !== st || st.tex.length >= st.nTex) return;
      one();
      setTimeout(step, 30);
    })();
  }

  function setupScene(st) {
    genTextures(st, true);
    st.glowW = glowTex(205, 222, 255);
    st.glowG = glowTex(107, 255, 184);
    st.curtA = curtainTex([[0, 'rgba(179,140,255,0)'], [0.3, 'rgba(179,140,255,.32)'], [0.68, 'rgba(107,255,184,.7)'], [0.9, 'rgba(170,255,222,1)'], [1, 'rgba(107,255,184,0)']]);
    st.curtB = curtainTex([[0, 'rgba(127,227,255,0)'], [0.45, 'rgba(127,227,255,.3)'], [0.85, 'rgba(107,255,184,.8)'], [1, 'rgba(107,255,184,0)']]);
    st.ribbons = [
      { y: 0.40, a1: 0.05, f1: 0.8, s1: 0.32, a2: 0.022, f2: 2.2, s2: 0.55, len: 0.34, k: 41, ks: 2.3, alpha: 0.42, u0: -0.15, u1: 1.1, p: 0.3, tex: st.curtA },
      { y: 0.27, a1: 0.04, f1: 1.1, s1: 0.26, a2: 0.02, f2: 3.1, s2: 0.7, len: 0.26, k: 57, ks: 3.1, alpha: 0.24, u0: 0.1, u1: 1.25, p: 2.1, tex: st.curtB },
      { y: 0.52, a1: 0.035, f1: 0.6, s1: 0.4, a2: 0.018, f2: 2.7, s2: 0.45, len: 0.22, k: 33, ks: 1.8, alpha: 0.2, u0: -0.3, u1: 0.8, p: 4.4, tex: st.curtA }
    ];
    var N = st.lowPower ? 44 : 64, far = 30;
    st.zFar = far; st.zNear = 0.45;
    st.clouds = [];
    for (var i = 0; i < N; i++) {
      var c = {};
      spawn(st, c, 0);
      c.z = st.zNear + 0.6 + (far - st.zNear - 0.6) * (i + Math.random()) / N;
      st.clouds.push(c);
    }
  }
  function spawn(st, c, rushP) {
    c.tex = st.tex[Math.floor(Math.random() * st.tex.length)];
    c.z = st.zFar + Math.random() * 2;
    c.x = (Math.random() * 2 - 1) * 8.5;
    c.y = (Math.random() * 2 - 1) * (2.2 + rushP * 0.6) + 1.05 * (1 - rushP) + 0.15;
    c.size = 2.8 + Math.random() * 3.6;
    c.aspect = 1.35 + Math.random() * 0.7;
    c.am = 0.6 + Math.random() * 0.4;
    c.dead = false;
  }

  function begin(st) {
    if (S !== st || st.phase !== 'gate') return;
    st.phase = 'film';
    // audio must start inside the click → user gesture
    amb('play');
    amb('setScene', 'flight');
    amb('sfx', 'whoosh');
    var f = st.flash;
    st.root.classList.add('ixo-go');
    f.classList.add('ixo-f0');
    void f.offsetWidth;
    f.classList.remove('ixo-f0');
    setupScene(st);
    setTimeout(function () { if (st.gate && st.gate.parentNode) st.gate.parentNode.removeChild(st.gate); }, 1400);
    try { if (st.gate.contains(D.activeElement)) D.activeElement.blur(); } catch (e) {}
    emit('start');
    call(st.o.onStart);

    st.T = Math.max(0, +st.o.seek || 0);
    st.freeze = !!st.o.freeze;
    // cues already in the past (seek) are considered fired
    st.cues = { push: st.T > TL.push[0], part: st.T > TL.part[0] };
    st.last = now(); st.ema = 16.7; st.lastDown = 0;
    st.raf = raf(function (t) { frame(st, t); });
  }

  function frame(st, tnow) {
    if (S !== st || !st.alive) return;
    st.raf = raf(function (t) { frame(st, t); });
    var ft = tnow - st.last;
    st.last = tnow;
    var dt = Math.min(0.05, Math.max(0, ft / 1000));
    if (!st.freeze) st.T += dt;
    var T = st.T;

    // adaptive resolution for the cloud pass
    st.ema = st.ema * 0.92 + Math.min(ft, 100) * 0.08;
    if (T > 0.9 && T < TL.part[0] && st.ema > 25 && st.q > 0.55 && tnow - st.lastDown > 700) {
      st.q *= 0.8; st.lastDown = tnow; st.ema = 18; sizeClouds(st);
    }

    if (!st.cues.push && T >= TL.push[0]) { st.cues.push = true; amb('sfx', 'whoosh'); }
    if (!st.cues.part && T >= TL.part[0]) { st.cues.part = true; amb('setScene', 'hero'); amb('sfx', 'whoosh'); }

    if (st.phase === 'film' || st.phase === 'skip') {
      renderClouds(st, T, st.freeze ? 1 / 60 : dt);
      renderAurora(st, T);
      updateStage(st, T);
    }
    updateChrome(st, T);

    if (st.phase === 'film' && T >= TL.dissolve && !st.freeze) dissolve(st);
  }

  /* ---------- clouds (Canvas2D) ---------- */
  function renderClouds(st, T, dt) {
    if (T > TL.part[1] + 0.15) {
      if (!st.cloudsOff) { st.cloudsOff = true; st.cv.style.display = 'none'; }
      return;
    }
    var c = st.ctx, w = st.w, h = st.h, rs = st.rs, pad = 60;
    var partP = prog(T, TL.part[0], TL.part[1]);
    var rushP = prog(T, TL.rush[0], TL.rush[1]);
    var sp = (1.5 + 24 * inCubic(rushP)) * (1 - 0.86 * inOut(partP));
    var sn = sp / 25.5;
    var fog = 0.92 * gauss(T, TL.fog1, 0.2) + 0.8 * gauss(T, TL.fog2, 0.19);

    // camera shake: turbulence ∝ speed, kicks inside the white-outs
    var A = (0.35 + 5.5 * sn + 9 * fog) * (1 - partP);
    var sx = A * (Math.sin(T * 21.3) * 0.55 + Math.sin(T * 34.7 + 1.7) * 0.3 + Math.sin(T * 57.1 + 0.3) * 0.15);
    var sy = A * (Math.sin(T * 19.1 + 2.1) * 0.55 + Math.sin(T * 41.9 + 0.6) * 0.3 + Math.sin(T * 63.3 + 2.6) * 0.15);
    var rot = A * 0.0011 * Math.sin(T * 13.7 + 0.4);
    var cx = w / 2, cy = h / 2;
    var co = Math.cos(rot) * rs, si = Math.sin(rot) * rs;

    var parting = T >= TL.part[0];
    if (parting) { c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, st.cv.width, st.cv.height); }
    c.setTransform(co, si, -si, co, rs * (cx + sx) - (co * cx - si * cy), rs * (cy + sy) - (si * cx + co * cy));
    c.globalCompositeOperation = 'source-over';

    // sky (partial alpha while rushing = cheap radial motion smear)
    var keep = parting ? 0 : 0.5 * sn * (1 - fog);
    c.globalAlpha = parting ? 1 - smooth(partP * 1.15) : 1 - keep;
    c.fillStyle = st.sky;
    c.fillRect(-pad, -pad, w + pad * 2, h + pad * 2);
    var calm = 1 - rushP;
    if (calm > 0.01 || parting) {
      var ga = parting ? 0 : calm;
      if (ga > 0.01) {
        c.globalAlpha = 0.33 * ga;
        var ms = Math.min(w, h) * 0.55;
        c.drawImage(st.glowW, w * 0.78 - ms / 2, h * 0.17 - ms / 2, ms, ms);           // moon glow
        c.globalAlpha = 0.2 * ga;
        c.drawImage(st.glowG, cx - w * 0.8, h * 0.4 - h * 0.11, w * 1.6, h * 0.22);    // aurora on the horizon
      }
    }

    // advance + sort (far → near)
    var cl = st.clouds, i, k;
    for (i = 0; i < cl.length; i++) {
      var q = cl[i];
      if (q.dead) continue;
      q.z -= sp * dt;
      if (q.z < st.zNear) { if (parting) q.dead = true; else spawn(st, q, rushP); }
    }
    for (i = 1; i < cl.length; i++) {
      var it = cl[i];
      for (k = i - 1; k >= 0 && cl[k].z < it.z; k--) cl[k + 1] = cl[k];
      cl[k + 1] = it;
    }

    var F = st.F, far = st.zFar, spread = 1 + 2.9 * partP * partP, fade = 1 - 0.6 * partP;
    for (i = 0; i < cl.length; i++) {
      var o = cl[i];
      if (o.dead) continue;
      var a = o.am * sstep(far, far - 7, o.z) * sstep(st.zNear, 3.2, o.z) * fade;
      if (a < 0.012) continue;
      var s = F / o.z;
      var ph = o.size * s, pw = ph * o.aspect;
      var px = cx + o.x * s * spread, py = cy + o.y * s * spread;
      if (px + pw / 2 < -pad || px - pw / 2 > w + pad || py + ph / 2 < -pad || py - ph / 2 > h + pad) continue;
      c.globalAlpha = a > 1 ? 1 : a;
      c.drawImage(o.tex, px - pw / 2, py - ph / 2, pw, ph);
    }

    // white-outs: flying straight through a cloud bank (billows rush past the lens)
    if (fog > 0.01) {
      var bump = T < (TL.fog1 + TL.fog2) / 2 ? TL.fog1 : TL.fog2;
      var fp = clamp01((T - bump) / 0.8 + 0.5);
      c.globalAlpha = fog * 0.3;
      c.fillStyle = '#8a9bb2';
      c.fillRect(-pad, -pad, w + pad * 2, h + pad * 2);
      for (k = 0; k < 4; k++) {
        var zz = st.diag * (0.55 + 0.45 * k + (2.2 + k * 0.6) * fp);
        var an = k * 2.3 + (bump === TL.fog1 ? 0 : 1.1);
        var ofx = Math.cos(an) * w * (0.08 + 0.5 * fp), ofy = Math.sin(an) * h * (0.06 + 0.4 * fp);
        c.globalAlpha = Math.min(1, fog * (0.95 - k * 0.14));
        c.drawImage(st.tex[(k * 3 + 1) % st.tex.length], cx + ofx - zz * 0.7, cy + ofy - zz * 0.48, zz * 1.4, zz * 0.96);
      }
    }

    // aurora light leaking up from below just before the clouds part
    var leak = sstep(3.0, 4.6, T) * (1 - partP);
    if (leak > 0.01) {
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.22 * leak;
      c.drawImage(st.glowG, cx - w * 0.9, h * 0.62, w * 1.8, h * 0.7);
      c.globalCompositeOperation = 'source-over';
    }

    if (T < TL.push[1] + 0.05) drawWindow(st, c, T);

    // fade up from black
    var blk = 1 - smooth(prog(T, TL.fadeIn[0], TL.fadeIn[1]));
    if (blk > 0.002) {
      c.globalAlpha = blk;
      c.fillStyle = '#000';
      c.fillRect(-pad * 2, -pad * 2, w + pad * 4, h + pad * 4);
    }

    // clouds part: punch a soft, growing hole through to the photo
    if (partP > 0) {
      c.setTransform(rs, 0, 0, rs, 0, 0);
      c.globalCompositeOperation = 'destination-out';
      var hy = cy + h * 0.06;
      var R = (0.12 + 1.15 * inOut(partP)) * st.diag * 0.72;
      var hs = smooth(partP * 1.6);
      var g = c.createRadialGradient(cx, hy, 0, cx, hy, R);
      g.addColorStop(0, 'rgba(0,0,0,' + hs.toFixed(3) + ')');
      g.addColorStop(0.5, 'rgba(0,0,0,' + (hs * 0.8).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalAlpha = 1;
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'source-over';
    }
    c.globalAlpha = 1;
  }

  // the airplane window we start behind, then push through
  function drawWindow(st, c, T) {
    var w = st.w, h = st.h, cx = w / 2, cy = h / 2;
    var p = prog(T, TL.push[0], TL.push[1]);
    var s = 1 + 12 * inCubic(p) + 0.04 * Math.sin(T * 1.7);
    var wh = Math.min(h * 0.62, w * 0.86 / 0.72), ww = wh * 0.72;
    ww *= s; wh *= s;
    if (ww > w * 3 && wh > h * 3) return;
    var x0 = cx - ww / 2, y0 = cy - wh / 2, r = ww * 0.46, big = Math.max(w, h) * 3;

    var wall = c.createRadialGradient(cx, cy, ww * 0.45, cx, cy, ww * 1.7);
    wall.addColorStop(0, '#161a21');
    wall.addColorStop(0.4, '#0b0d11');
    wall.addColorStop(1, '#020203');
    c.globalAlpha = 1;
    c.beginPath();
    c.rect(cx - big, cy - big, big * 2, big * 2);
    roundRect(c, x0, y0, ww, wh, r);
    c.fillStyle = wall;
    c.fill('evenodd');

    // cabin trim + bezel highlights
    var i1 = 30 * s;
    c.beginPath(); roundRect(c, x0 - i1, y0 - i1, ww + i1 * 2, wh + i1 * 2, r + i1);
    c.lineWidth = 2 * s; c.strokeStyle = 'rgba(255,255,255,.05)'; c.stroke();
    var i2 = 9 * s;
    var bz = c.createLinearGradient(0, y0 - i2, 0, y0 + wh + i2);
    bz.addColorStop(0, 'rgba(255,255,255,.16)');
    bz.addColorStop(0.5, 'rgba(255,255,255,.04)');
    bz.addColorStop(1, 'rgba(255,255,255,.09)');
    c.beginPath(); roundRect(c, x0 - i2, y0 - i2, ww + i2 * 2, wh + i2 * 2, r + i2);
    c.lineWidth = 12 * s; c.strokeStyle = bz; c.stroke();
    c.beginPath(); roundRect(c, x0, y0, ww, wh, r);
    c.lineWidth = 7 * s; c.strokeStyle = 'rgba(0,0,0,.55)'; c.stroke();

    // glass reflection
    c.save();
    c.beginPath(); roundRect(c, x0, y0, ww, wh, r); c.clip();
    var rf = c.createLinearGradient(x0, y0, x0 + ww, y0 + wh);
    rf.addColorStop(0, 'rgba(255,255,255,.07)');
    rf.addColorStop(0.32, 'rgba(255,255,255,0)');
    rf.addColorStop(0.62, 'rgba(255,255,255,0)');
    rf.addColorStop(0.7, 'rgba(200,230,255,.05)');
    rf.addColorStop(0.78, 'rgba(255,255,255,0)');
    c.fillStyle = rf;
    c.fillRect(x0, y0, ww, wh);
    c.restore();
  }

  /* ---------- aurora shimmer (low-res canvas, screen-blended) ---------- */
  function renderAurora(st, T) {
    if (T < TL.part[0] - 0.1) return;
    var c = st.actx, w = st.aw, h = st.ah;
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, w, h);
    c.globalCompositeOperation = 'lighter';
    for (var r = 0; r < st.ribbons.length; r++) {
      var R = st.ribbons[r];
      for (var x = 0; x < w; x += 2) {
        var u = x / w;
        var env = Math.sin(Math.PI * clamp01((u - R.u0) / (R.u1 - R.u0)));
        if (env <= 0.01) continue;
        var y = h * R.y + Math.sin(u * R.f1 * TAU + T * R.s1 + R.p) * h * R.a1 + Math.sin(u * R.f2 * TAU - T * R.s2) * h * R.a2;
        var len = h * R.len * (0.62 + 0.38 * Math.sin(u * 9 + T * 1.1 + R.p));
        var fl = 0.5 + 0.5 * Math.sin(u * R.k + T * R.ks + R.p * 3);
        var fl2 = 0.5 + 0.5 * Math.sin(u * R.k * 2.7 - T * R.ks * 1.6);
        var a = R.alpha * env * (0.25 + 0.55 * fl * fl + 0.2 * fl2);
        if (a < 0.01) continue;
        c.globalAlpha = a;
        c.drawImage(R.tex, x, Math.round(y - len), 2, Math.round(len));
      }
    }
    c.globalCompositeOperation = 'source-over';
  }

  /* ---------- DOM layers inside the stage ---------- */
  function updateStage(st, T) {
    // captions — film subtitles in the lower third
    for (var i = 0; i < st.caps.length; i++) {
      var cp = st.caps[i], ab = TL.caps[i];
      var pin = ease(prog(T, ab[0], ab[0] + 0.85)), pout = smooth(prog(T, ab[1] - 0.5, ab[1]));
      var op = pin * (1 - pout);
      if (op <= 0.002) {
        if (cp.vis) { cp.vis = false; setS(cp.el, 'visibility', 'hidden'); setS(cp.el, 'opacity', '0'); }
        continue;
      }
      if (!cp.vis) { cp.vis = true; setS(cp.el, 'visibility', 'visible'); }
      var bl = (1 - pin) * 10 + pout * 8;
      setS(cp.el, 'opacity', op.toFixed(3));
      setS(cp.el, 'filter', bl > 0.05 ? 'blur(' + bl.toFixed(2) + 'px)' : 'none');
      setS(cp.el, 'transform', 'translate3d(0,' + ((1 - pin) * 16 - pout * 10).toFixed(2) + 'px,0)');
      setS(cp.txt, 'letterSpacing', (0.06 + (1 - pin) * 0.16).toFixed(3) + 'em');
    }

    // photo: revealed under the parting clouds, slow push-in 1.0 → 1.15
    var imgOn = T >= TL.img;
    setS(st.img, 'opacity', imgOn ? '1' : '0');
    if (imgOn) {
      var pz = outSine(prog(T, TL.img, TL.dissolve));
      setS(st.img, 'transform', 'scale(' + (1 + 0.15 * pz).toFixed(4) + ') translate3d(0,' + (-0.8 * pz).toFixed(3) + '%,0)');
    }
    var sh = imgOn ? 0.95 - 0.5 * smooth(prog(T, TL.part[0], TL.part[1] + 0.4)) + 0.18 * smooth(prog(T, TL.title - 0.2, TL.title + 1.2)) : 0;
    setS(st.shade, 'opacity', sh.toFixed(3));
    setS(st.aur, 'opacity', (0.78 * smooth(prog(T, TL.part[0] + 0.2, TL.part[1] + 0.4))).toFixed(3));
    if (!st.cloudsOff) setS(st.cv, 'opacity', (1 - smooth(prog(T, 5.25, TL.part[1]))).toFixed(3));

    // title: letters assemble from a blurred spread
    var n = st.chs.length, shift = Math.max(0, T - TL.title) * st.titleW * 0.11;
    setS(st.halo, 'opacity', smooth(prog(T, TL.title - 0.2, TL.title + 1.4)).toFixed(3));
    for (var k = 0; k < n; k++) {
      var ch = st.chs[k], t0 = TL.title + k * 0.12;
      var p = ease(prog(T, t0, t0 + 1.6)), qq = 1 - p;
      if (p <= 0) { setS(ch.el, 'opacity', '0'); continue; }
      var dx = (k - (n - 1) / 2) * st.fs * 0.34 * qq, dy = st.fs * 0.16 * qq, sc = 1 + 0.3 * qq;
      setS(ch.el, 'opacity', clamp01(p * 1.8).toFixed(3));
      setS(ch.el, 'transform', 'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px) scale(' + sc.toFixed(4) + ')');
      setS(ch.el, 'filter', qq > 0.003 ? 'blur(' + (qq * 26).toFixed(2) + 'px)' : 'none');
      setS(ch.g, 'backgroundPosition', (-(ch.ox + shift)).toFixed(1) + 'px 0');
    }
    var pl = ease(prog(T, TL.line[0], TL.line[1]));
    setS(st.line, 'transform', 'scaleX(' + pl.toFixed(4) + ')');
    var ps = ease(prog(T, TL.sub[0], TL.sub[1]));
    setS(st.sub, 'opacity', ps.toFixed(3));
    setS(st.sub, 'transform', 'translate3d(0,' + ((1 - ps) * 12).toFixed(2) + 'px,0)');
    var pd = ease(prog(T, TL.dates[0], TL.dates[1]));
    setS(st.dates, 'opacity', pd.toFixed(3));
    setS(st.dates, 'transform', 'translate3d(0,' + ((1 - pd) * 10).toFixed(2) + 'px,0)');
  }

  /* ---------- letterbox, progress, skip (outside the stage) ---------- */
  function updateChrome(st, T) {
    var bo = inOut(prog(T, TL.bars[0], TL.bars[1]));
    setS(st.barT, 'transform', 'translate3d(0,' + (-bo * 101).toFixed(2) + '%,0)');
    setS(st.barB, 'transform', 'translate3d(0,' + (bo * 101).toFixed(2) + '%,0)');
    setS(st.progEl, 'transform', 'scaleX(' + clamp01(T / TL.dissolve).toFixed(4) + ')');
    var so = 1 - smooth(prog(T, TL.skipOut[0], TL.skipOut[1]));
    setS(st.skipBtn, 'opacity', so.toFixed(3));
    setS(st.skipBtn, 'pointerEvents', so < 0.2 ? 'none' : '');
  }

  /* ---------- endings ---------- */
  function reveal(st, info) {
    if (st.revealed) return;
    st.revealed = true;
    emit('reveal', info);
    call(st.o.onReveal, info);
    flush(revealQ, info);
  }

  function dissolve(st) {
    if (st.phase !== 'film') return;
    st.phase = 'out';
    st.root.classList.add('ixo-out');
    reveal(st, { shown: true, skipped: false });
    st.endTimer = setTimeout(function () { finish(st, false); }, DISSOLVE_MS + 40);
  }

  function skip() {
    var st = S;
    if (!st || !st.alive) return;
    if (st.phase === 'out' || st.phase === 'skip' || st.phase === 'still') return;
    var fromGate = st.phase === 'gate';
    st.phase = 'skip';
    if (!fromGate) { amb('setScene', 'hero'); }
    st.root.classList.add('ixo-skip');
    reveal(st, { shown: true, skipped: true });
    st.endTimer = setTimeout(function () { finish(st, true); }, SKIP_MS + 30);
  }

  function runStill(st) {
    st.phase = 'still';
    st.root.classList.add('ixo--still');
    measureTitle(st);
    st.endTimer = setTimeout(function () {
      if (S !== st) return;
      st.root.classList.add('ixo-fade');
      reveal(st, { shown: true, skipped: false, reduced: true });
      st.endTimer = setTimeout(function () { finish(st, false); }, 1000);
    }, 500);
  }

  function finish(st, skipped) {
    if (!st.alive) return;
    st.alive = false;
    caf(st.raf);
    clearTimeout(st.endTimer);
    unbind(st);
    var focusInside = st.root && st.root.contains(D.activeElement);
    if (st.root && st.root.parentNode) st.root.parentNode.removeChild(st.root);
    unlock(st);
    if (focusInside && D.activeElement && D.activeElement.blur) { try { D.activeElement.blur(); } catch (e) {} }
    markSeen();
    st.tex = st.clouds = null;
    if (S === st) S = null;
    var info = { shown: true, skipped: !!skipped, reduced: !!st.reduced };
    reveal(st, info);
    emit('done', info);
    call(st.o.onDone, info);
    flush(doneQ, info);
  }

  /* =========================================================
     PUBLIC API
     ========================================================= */
  function assign(a, b) { for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k)) a[k] = b[k]; return a; }

  function init(opts) {
    opts = opts || {};
    cfg = opts;
    if (S) return true;
    var flag = urlFlag();
    var off = flag === '0' || flag === 'off' || flag === 'false';
    var on = flag === '1' || flag === 'on' || flag === 'true' || flag === '';
    var show = !!opts.force || on || (!off && !seen());
    if (off && !opts.force) show = false;
    if (!show) {
      var info = { shown: false, skipped: false };
      afterDomReady(function () {
        emit('reveal', info); emit('done', info);
        call(opts.onReveal, info); call(opts.onDone, info);
        flush(revealQ, info); flush(doneQ, info);
      });
      return false;
    }
    return open(assign({}, opts));
  }

  function play(opts) {
    if (S) return false;
    return open(assign(assign({}, cfg), opts || {}));
  }

  W.Intro = {
    __ixo: true,
    version: '1.0.0',
    init: init,
    play: play,
    skip: skip,
    isActive: function () { return !!S; },
    whenRevealed: function () {
      return new Promise(function (res) {
        if (!S || S.revealed) res({ shown: !!S }); else revealQ.push(res);
      });
    },
    whenDone: function () {
      return new Promise(function (res) {
        if (!S) res({ shown: false }); else doneQ.push(res);
      });
    },
    reset: function () { try { W.sessionStorage.removeItem(KEY); } catch (e) {} },
    timeline: TL
  };
})();
