/*!
 * viewer.js — 「走進風景」STEP INTO THE PHOTO 全螢幕沉浸式檢視器
 * 冰島任務 · Iceland road trip
 *
 * Classic script（非 module），定義 window.Viewer。依賴（皆為選用）：
 *   window.TRIP     data/itinerary.js（必要：景點資料）
 *   window.FX       js/fx.js（照片上的動態特效疊加）
 *   window.Ambient  js/ambient.js（環境音：setScene / sfx / isOn）
 *
 *   Viewer.open(spotId[, { from: imgEl }]) → Promise<boolean>
 *       從卡片圖片（[data-spot-id="<id>"] img）以 FLIP 共享元素轉場放大到全螢幕。
 *       全螢幕時照片變成偽 3D 場景：WebGL 平面 + 程序化深度圖（垂直漸層 + 亮度 + 中央偏置 + 天空偵測），
 *       片段著色器做視差光線步進（滑鼠 / 陀螺儀，iOS 會在點擊時請求權限），閒置時自動緩慢漂移鏡頭，
 *       疊加 FX.mount 特效、暗角與底片顆粒。WebGL 不可用時退回 CSS 視差。
 *   Viewer.close()        → Promise   反向 FLIP 回到卡片（卡片不在畫面上時改為淡出）
 *   Viewer.next() / Viewer.prev() / Viewer.go(spotId)   全行程跨日切換（交叉溶解 + whoosh）
 *   Viewer.autoBind(selector = '[data-spot-id]'[, { hint, keyboard, label }]) → { unbind(), refresh() }
 *       讓每個符合元素裡的圖片可點擊（cursor: zoom-in），滑過時顯示玻璃提示「點擊走進風景」。
 *   Viewer.isOpen() / Viewer.current() / Viewer.mode / Viewer.stats
 *   Viewer.configure({ imgBase, imgExt, worldBase, webgl, gyroOnOpen, parallax, overscan, zIndex, data })
 *   Viewer.debugDepth(bool)   顯示程序化深度圖（QA 用）
 *
 * 事件（window）：'viewer:open' / 'viewer:change' / 'viewer:close'，detail = { id, spot, day, index, total }
 *
 * 鍵盤：Esc 關閉 · ← → 切換 · I 顯示/隱藏資訊 · Tab 在對話框內循環
 * 手勢：左右滑動切換 · 點一下照片（觸控）隱藏/顯示資訊 · 觸控板水平滑動切換
 */
(function (global) {
  'use strict';

  var doc = global.document;
  if (!doc || (global.Viewer && global.Viewer.__viewer)) return;

  /* ------------------------------------------------------------------ *
   * Config & helpers
   * ------------------------------------------------------------------ */
  const CFG = {
    imgBase: 'assets/img/',
    imgExt: '.jpg',
    worldBase: 'worlds/',
    zIndex: 9000,
    webgl: true,
    gyroOnOpen: true,       // 觸控裝置：在開啟的那一下點擊中請求陀螺儀權限（iOS）
    fxIntensity: 1.1,
    overscan: 1.06,         // 額外放大，避免視差露出邊緣
    parallax: 0.034,        // 視差幅度（短邊比例）
    focus: 0.42,            // 焦平面深度（0 遠 · 1 近）
    maxPixels: 2.4e6,       // WebGL 畫布像素上限（照片本身 1600px，再高也沒有細節）
    data: null              // 預設讀 window.TRIP
  };

  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Noto Sans TC","PingFang TC","Microsoft JhengHei","Helvetica Neue",sans-serif';
  const GRAD = 'linear-gradient(90deg,#7fe3ff 0%,#6bffb8 50%,#b38cff 100%)';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const now = () => (global.performance && global.performance.now ? global.performance.now() : Date.now());
  const ESCM = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESCM[c]);
  const cssEsc = (s) => (global.CSS && global.CSS.escape ? global.CSS.escape(String(s)) : String(s).replace(/["\\\]\[]/g, '\\$&'));
  const warn = (...a) => { if (global.console) global.console.warn('[Viewer]', ...a); };
  function mm(q) { try { return !!(global.matchMedia && global.matchMedia(q).matches); } catch (e) { return false; } }
  const REDUCED = () => mm('(prefers-reduced-motion: reduce)');
  const COARSE = () => mm('(pointer: coarse)');

  // CSS-equivalent cubic-bezier for JS tweens
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {
        const e = sx(t) - x;
        if (Math.abs(e) < 1e-5) break;
        const d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      return sy(clamp(t, 0, 1));
    };
  }
  const E_OUT = bezier(0.2, 0.8, 0.2, 1);
  const E_IO = bezier(0.65, 0, 0.35, 1);
  const E_SOFT = bezier(0.33, 0, 0.2, 1);

  /* ------------------------------------------------------------------ *
   * Tiny tween engine (driven by the viewer's RAF)
   * ------------------------------------------------------------------ */
  const TW = [];
  function tween(obj, key, to, dur, ease, delay) {
    for (let i = TW.length - 1; i >= 0; i--) {
      if (TW[i].obj === obj && TW[i].key === key) { const t = TW[i]; TW.splice(i, 1); t.res(false); }
    }
    return new Promise((res) => {
      if (!(dur > 0) || !S.raf) { obj[key] = to; res(true); return; }
      TW.push({ obj, key, from: obj[key], to, dur, ease: ease || E_OUT, t0: now() + (delay || 0), res });
    });
  }
  function stepTweens(t) {
    for (let i = TW.length - 1; i >= 0; i--) {
      const w = TW[i];
      const p = (t - w.t0) / w.dur;
      if (p < 0) continue;
      w.obj[w.key] = w.from + (w.to - w.from) * w.ease(clamp(p, 0, 1));
      if (p >= 1) { TW.splice(i, 1); w.res(true); }
    }
  }
  function flushTweens() {
    const all = TW.splice(0, TW.length);
    all.forEach((w) => { w.obj[w.key] = w.to; w.res(false); });
  }

  /* ------------------------------------------------------------------ *
   * Data
   * ------------------------------------------------------------------ */
  const dayNum = (d, di) => { const n = parseInt(String((d && d.id) || '').replace(/\D/g, ''), 10); return isNaN(n) ? di : n; };
  function buildList() {
    const T = CFG.data || global.TRIP || {};
    const days = Array.isArray(T.days) ? T.days : [];
    const list = [];
    days.forEach((d, di) => {
      const spots = (d && Array.isArray(d.spots)) ? d.spots : [];
      spots.forEach((s, si) => {
        if (s && s.id) list.push({ spot: s, day: d, dayIndex: di, dayNo: dayNum(d, di), idx: si, count: spots.length, g: list.length });
      });
    });
    return list;
  }
  function imgUrl(spot) {
    const pic = spot.img || spot.id;
    if (/[\/.]/.test(pic)) return pic;           // explicit path
    return CFG.imgBase + pic + CFG.imgExt;
  }
  const accentOf = (e) => (e && e.day && e.day.accent) || '#7fe3ff';
  const detailOf = (e) => (e ? { id: e.spot.id, spot: e.spot, day: e.day, index: e.g, total: S.list.length } : null);
  function emit(name, e) {
    try { global.dispatchEvent(new global.CustomEvent(name, { detail: detailOf(e) })); } catch (err) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ *
   * Ambient sound bridge (optional module)
   * ------------------------------------------------------------------ */
  const amb = () => global.Ambient || null;
  function ambScene(type) {
    const A = amb();
    if (A && typeof A.setScene === 'function') { try { A.setScene(type); } catch (e) { /* ignore */ } }
  }
  function ambSfx(name) {
    const A = amb();
    if (!A || typeof A.sfx !== 'function') return;
    try { if (typeof A.isOn === 'function' && !A.isOn()) return; A.sfx(name); } catch (e) { /* ignore */ }
  }
  function ambGetScene() {
    const A = amb();
    if (!A) return undefined;
    try {
      if (typeof A.getScene === 'function') return A.getScene();
      if ('scene' in A) return A.scene;
      if ('currentScene' in A) return A.currentScene;
    } catch (e) { /* ignore */ }
    return undefined;
  }

  /* ------------------------------------------------------------------ *
   * Image loading + procedural depth maps
   * ------------------------------------------------------------------ */
  const IMG = new Map();
  function loadImage(url) {
    if (IMG.has(url)) return IMG.get(url);
    const p = new Promise((res, rej) => {
      const im = new Image();
      im.decoding = 'async';
      let done = false;
      const ok = () => { if (done) return; done = true; res(im); };
      const ko = () => { if (done) return; done = true; IMG.delete(url); rej(new Error('image failed: ' + url)); };
      im.onload = () => {
        if (im.decode) im.decode().then(ok, ok); else ok();
      };
      im.onerror = ko;
      im.src = url;
      if (im.complete && im.naturalWidth) im.onload();
    });
    IMG.set(url, p);
    if (IMG.size > 24) IMG.delete(IMG.keys().next().value);
    return p;
  }

  const DEPTH = new Map();
  function getDepth(url, img) {
    if (!img) return buildDepth(null);
    let d = DEPTH.get(url);
    if (!d) {
      d = buildDepth(img);
      DEPTH.set(url, d);
      if (DEPTH.size > 16) DEPTH.delete(DEPTH.keys().next().value);
    }
    return d;
  }

  /*
   * Fake depth ("Facebook 3D photo" style, no ML): combine
   *   · vertical gradient (bottom = near, top = far)
   *   · inverse luminance (dark foreground rock / grass reads nearer)
   *   · centre bias (subjects tend to sit mid-frame)
   *   · saturation (vivid moss & grass nearer than hazy distance)
   *   · sky detection (bright, low-sat or blue pixels in the upper frame → far)
   * then dilate (so foreground edges cover the background → fewer halos) and blur.
   */
  function buildDepth(img) {
    const iw = (img && img.naturalWidth) || 16, ih = (img && img.naturalHeight) || 9;
    const M = 224;
    const w = iw >= ih ? M : Math.max(8, Math.round(M * iw / ih));
    const h = iw >= ih ? Math.max(8, Math.round(M * ih / iw)) : M;
    let px = null;
    if (img) {
      try {
        const c = doc.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, w, h);
        px = g.getImageData(0, 0, w, h).data;
      } catch (e) { px = null; }   // tainted (file://) → procedural only
    }
    const f = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const fy = y / (h - 1);
      const vert = Math.pow(fy, 1.15);
      const skyZone = 1 - smooth(0.16, 0.62, fy);
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const fx = x / (w - 1);
        let L = 0.5, sat = 0, blue = 0;
        if (px) {
          const r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
          L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          sat = mx > 0.001 ? (mx - mn) / mx : 0;
          blue = clamp((b - r) * 2.2 + (b - g) * 0.8, 0, 1);
        }
        const dx = (fx - 0.5) * 1.1, dy = fy - 0.58;
        const centre = 1 - clamp(Math.sqrt(dx * dx + dy * dy) * 1.7, 0, 1);
        const skyLike = skyZone * smooth(0.42, 0.8, L) * clamp(1 - sat * 1.4 + blue * 0.8, 0, 1);
        let d = 0.56 * vert + 0.16 * (1 - L) + 0.16 * centre + 0.12 * sat;
        d *= 1 - 0.8 * skyLike;
        f[i] = d;
      }
    }
    dilate(f, w, h);
    const r = Math.max(2, Math.round(w / 70));
    for (let k = 0; k < 3; k++) boxBlur(f, w, h, r);
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < f.length; i++) { if (f[i] < mn) mn = f[i]; if (f[i] > mx) mx = f[i]; }
    const span = mx - mn > 1e-4 ? mx - mn : 1;
    const out = new Uint8Array(w * h);
    for (let i = 0; i < f.length; i++) {
      const v = smooth(0.04, 0.98, (f[i] - mn) / span);
      out[i] = Math.round(v * 255);
    }
    return { data: out, w, h };
  }
  function dilate(f, w, h) {
    const src = f.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let m = src[y * w + x];
        for (let j = -1; j <= 1; j++) {
          const yy = y + j; if (yy < 0 || yy >= h) continue;
          for (let i = -1; i <= 1; i++) {
            const xx = x + i; if (xx < 0 || xx >= w) continue;
            const v = src[yy * w + xx]; if (v > m) m = v;
          }
        }
        f[y * w + x] = m;
      }
    }
  }
  function boxBlur(f, w, h, r) {
    const tmp = new Float32Array(f.length), n = r * 2 + 1;
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += f[y * w + clamp(i, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / n;
        acc += f[y * w + clamp(x + r + 1, 0, w - 1)] - f[y * w + clamp(x - r, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += tmp[clamp(i, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        f[y * w + x] = acc / n;
        acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * WebGL renderer — one context, two texture slots (cross-dissolve),
   * ray-marched depth parallax in the fragment shader.
   * ------------------------------------------------------------------ */
  const VS = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  const FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 vUv;',
    'uniform sampler2D uTex0;',
    'uniform sampler2D uDep0;',
    'uniform sampler2D uTex1;',
    'uniform sampler2D uDep1;',
    'uniform vec4 uCov0;',
    'uniform vec4 uCov1;',
    'uniform vec2 uOff0;',
    'uniform vec2 uOff1;',
    'uniform float uDol0;',
    'uniform float uDol1;',
    'uniform float uMix;',
    'uniform float uFocus;',
    'uniform float uDebug;',
    'uniform float uTime;',
    'uniform float uGrain;',
    // screen uv → texture uv (object-fit: cover + overscan zoom)
    'vec2 cov(vec2 p, vec4 c) { return (p - 0.5) * c.xy + 0.5 + c.zw; }',
    // Find the front-most surface along the view ray: source(h) = A - B*h, h = height (1 near → 0 far).
    'vec2 march(sampler2D dep, vec4 c, vec2 uv, vec2 off, float dol) {',
    '  vec2 A = uv + off * uFocus;',
    '  vec2 B = off + (uv - 0.5) * dol;',
    '  float hi = 1.0;',
    '  float lo = 0.0;',
    '  for (int i = 0; i <= 18; i++) {',
    '    float h = 1.0 - float(i) / 18.0;',
    '    float d = texture2D(dep, cov(A - B * h, c)).r;',
    '    if (d >= h) { lo = h; break; }',
    '    hi = h;',
    '  }',
    '  for (int j = 0; j < 5; j++) {',
    '    float m = 0.5 * (lo + hi);',
    '    float d = texture2D(dep, cov(A - B * m, c)).r;',
    '    if (d >= m) { lo = m; } else { hi = m; }',
    '  }',
    '  return cov(A - B * lo, c);',
    '}',
    'float hash(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    'void main() {',
    '  vec3 col = vec3(0.0);',
    '  if (uMix < 0.999) {',
    '    vec2 t0 = march(uDep0, uCov0, vUv, uOff0, uDol0);',
    '    col = uDebug > 0.5 ? vec3(texture2D(uDep0, t0).r) : texture2D(uTex0, t0).rgb;',
    '  }',
    '  if (uMix > 0.001) {',
    '    vec2 t1 = march(uDep1, uCov1, vUv, uOff1, uDol1);',
    '    vec3 c1 = uDebug > 0.5 ? vec3(texture2D(uDep1, t1).r) : texture2D(uTex1, t1).rgb;',
    '    col = mix(col, c1, uMix);',
    '  }',
    '  col += (hash(gl_FragCoord.xy + floor(uTime * 24.0) * 17.0) - 0.5) * uGrain;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function createRenderer(canvas) {
    const attrs = {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance'
    };
    let gl = null;
    try { gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs); } catch (e) { gl = null; }
    if (!gl) return null;
    const loseExt = gl.getExtension('WEBGL_lose_context');
    const bail = () => { try { if (loseExt) loseExt.loseContext(); } catch (e) { /* ignore */ } return null; };

    function shader(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        warn('shader compile failed', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    }
    const vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return bail();
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      warn('program link failed', gl.getProgramInfoLog(prog));
      return bail();
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const U = {};
    ['uTex0', 'uDep0', 'uTex1', 'uDep1', 'uCov0', 'uCov1', 'uOff0', 'uOff1', 'uDol0', 'uDol1',
      'uMix', 'uFocus', 'uDebug', 'uTime', 'uGrain'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });

    // texture units: 0 tex0 · 1 dep0 · 2 tex1 · 3 dep1 (bound once, never rebound)
    const tex = [];
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (let i = 0; i < 4; i++) {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (i % 2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([128]));
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));
      tex.push(t);
    }
    gl.uniform1i(U.uTex0, 0); gl.uniform1i(U.uDep0, 1); gl.uniform1i(U.uTex1, 2); gl.uniform1i(U.uDep1, 3);
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;

    const R = {
      gl, canvas, lost: false, onlost: null,
      // throws on a tainted image (file://) → caller falls back to CSS mode
      setSlot(i, img, depth, fallbackRGB) {
        if (R.lost) return;
        gl.activeTexture(gl.TEXTURE0 + i * 2);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        if (img) {
          let src = img;
          const iw = img.naturalWidth, ih = img.naturalHeight;
          if (iw > maxTex || ih > maxTex) {
            const k = maxTex / Math.max(iw, ih), c = doc.createElement('canvas');
            c.width = Math.floor(iw * k); c.height = Math.floor(ih * k);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            src = c;
          }
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
        } else {
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(fallbackRGB || [10, 14, 20]));
        }
        gl.activeTexture(gl.TEXTURE0 + i * 2 + 1);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, depth.w, depth.h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, depth.data);
      },
      resize(w, h) {
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
      },
      draw(u) {
        if (R.lost) return;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform4f(U.uCov0, u.c0[0], u.c0[1], 0, 0);
        gl.uniform4f(U.uCov1, u.c1[0], u.c1[1], 0, 0);
        gl.uniform2f(U.uOff0, u.o0[0], u.o0[1]);
        gl.uniform2f(U.uOff1, u.o1[0], u.o1[1]);
        gl.uniform1f(U.uDol0, u.d0);
        gl.uniform1f(U.uDol1, u.d1);
        gl.uniform1f(U.uMix, u.mix);
        gl.uniform1f(U.uFocus, u.focus);
        gl.uniform1f(U.uDebug, u.debug ? 1 : 0);
        gl.uniform1f(U.uTime, u.time % 50);
        gl.uniform1f(U.uGrain, u.grain);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      dispose() {
        R.onlost = null;          // our own loseContext() below must not count as a failure
        R.lost = true;
        try {
          if (!gl.isContextLost()) {
            tex.forEach((t) => gl.deleteTexture(t));
            gl.deleteBuffer(buf);
            gl.deleteProgram(prog);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
          }
          if (loseExt) loseExt.loseContext();   // release the context right away
        } catch (e) { /* ignore */ }
        canvas.width = 1; canvas.height = 1;
      }
    };
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (R.lost) return;
      R.lost = true;
      if (R.onlost) R.onlost();
    });
    return R;
  }

  /* ------------------------------------------------------------------ *
   * Styles (injected once)
   * ------------------------------------------------------------------ */
  function grainURL() {
    try {
      const c = doc.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'), d = g.createImageData(128, 128);
      for (let i = 0; i < d.data.length; i += 4) { const v = (Math.random() * 255) | 0; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
      g.putImageData(d, 0, 0);
      return 'url(' + c.toDataURL('image/png') + ')';
    } catch (e) { return 'none'; }
  }

  function injectCSS() {
    if (doc.getElementById('viewer-js-style')) return;
    const st = doc.createElement('style');
    st.id = 'viewer-js-style';
    st.textContent = `
.vw{position:fixed;inset:0;z-index:${CFG.zIndex};color:#f5f5f7;font-family:${FONT};font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;touch-action:none;overscroll-behavior:contain;-webkit-tap-highlight-color:transparent;--vw-accent:#7fe3ff}
.vw[hidden]{display:none!important}
.vw *,.vw *::before,.vw *::after{box-sizing:border-box}
.vw.is-idle,.vw.is-idle *{cursor:none}
.vw__bg{position:absolute;inset:0;background:#000}
.vw__clip{position:absolute;inset:0;overflow:hidden}
.vw__stage{position:absolute;inset:0;transform-origin:0 0;background:#000;overflow:hidden}
.vw__gl{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
.vw__slides{position:absolute;inset:0}
.vw__slide{position:absolute;inset:0;overflow:hidden;transform-origin:50% 50%}
.vw__slide>img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;object-position:50% 50%;display:block;-webkit-user-select:none;user-select:none;-webkit-user-drag:none;pointer-events:none}
.vw.is-gl .vw__slide>img{opacity:0}
.vw__slide>.fx-canvas{transform-origin:50% 50%}
.vw__shade{position:absolute;inset:0;pointer-events:none;background:radial-gradient(130% 95% at 50% 42%,rgba(0,0,0,0) 52%,rgba(0,0,0,.62) 100%),linear-gradient(to top,rgba(0,0,0,.62) 0%,rgba(0,0,0,.18) 30%,rgba(0,0,0,0) 48%),linear-gradient(to bottom,rgba(0,0,0,.42) 0%,rgba(0,0,0,0) 20%)}
.vw__grain{position:absolute;inset:0;pointer-events:none;opacity:.075;mix-blend-mode:overlay;background-size:128px 128px;animation:vw-grain .9s steps(1) infinite}
.vw.is-gl .vw__grain{display:none}
@keyframes vw-grain{0%{background-position:0 0}17%{background-position:-37px 21px}33%{background-position:53px -14px}50%{background-position:-12px -48px}67%{background-position:29px 61px}83%{background-position:-58px 9px}}
.vw__ui{position:absolute;inset:0;pointer-events:none}
.vw__fade{opacity:0;transform:translate3d(0,10px,0);transition:opacity .55s ${EASE},transform .7s ${EASE};pointer-events:none}
.vw.is-ui-in .vw__fade{opacity:1;transform:none;pointer-events:auto}
.vw.is-ui-in.is-ui-hidden .vw__fade:not(.vw__keep){opacity:0;transform:translate3d(0,12px,0);pointer-events:none}
.vw-glass{background:rgba(24,24,28,.42);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);border:1px solid rgba(255,255,255,.13);box-shadow:0 12px 40px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.08)}
.vw__top{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:max(18px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) 0 max(20px,env(safe-area-inset-left));pointer-events:none}
.vw__progress{display:inline-flex;align-items:center;gap:12px;height:40px;padding:0 16px;border-radius:999px;font-size:13px;font-weight:600;letter-spacing:.02em;font-variant-numeric:tabular-nums;white-space:nowrap}
.vw__progress b{font-weight:700;color:#fff}
.vw__progress span{color:rgba(255,255,255,.62)}
.vw__bar{position:relative;width:72px;height:3px;border-radius:3px;background:rgba(255,255,255,.18);overflow:hidden}
.vw__bar i{position:absolute;inset:0;transform-origin:0 50%;transform:scaleX(var(--p,0));background:${GRAD};border-radius:3px;transition:transform .9s ${EASE}}
.vw__tools{display:flex;gap:10px;align-items:center}
.vw__btn{appearance:none;-webkit-appearance:none;margin:0;font:inherit;color:#fff;height:44px;min-width:44px;padding:0 16px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;gap:8px;font-size:14px;font-weight:600;cursor:pointer;transition:background-color .3s,transform .45s ${EASE},opacity .55s ${EASE}}
.vw__btn:hover{background-color:rgba(255,255,255,.16)}
.vw__btn:active{transform:scale(.93)}
.vw__btn svg{flex:none}
.vw__close{width:44px;padding:0}
.vw__gyro[hidden]{display:none}
.vw__nav{appearance:none;-webkit-appearance:none;margin:0;font:inherit;color:#fff;position:absolute;top:50%;height:56px;min-width:56px;margin-top:-28px;padding:0;border-radius:999px;display:flex;align-items:center;cursor:pointer;transition:background-color .3s,opacity .55s ${EASE},transform .7s ${EASE}}
.vw__nav:hover{background-color:rgba(255,255,255,.16)}
.vw__nav:active .vw__nav-ico{transform:scale(.88)}
.vw__nav--prev{left:max(20px,env(safe-area-inset-left))}
.vw__nav--next{right:max(20px,env(safe-area-inset-right));flex-direction:row-reverse}
.vw__nav-ico{flex:none;width:54px;height:54px;display:grid;place-items:center;transition:transform .35s ${EASE}}
.vw__nav-lbl{display:block;max-width:0;overflow:hidden;white-space:nowrap;opacity:0;font-size:14px;font-weight:600;letter-spacing:.01em;transition:max-width .6s ${EASE},opacity .35s,padding .6s ${EASE}}
.vw__nav-lbl small{display:block;font-size:11px;font-weight:600;letter-spacing:.12em;color:rgba(255,255,255,.55);text-transform:uppercase;line-height:1.3}
.vw__nav--prev .vw__nav-lbl{text-align:left}
.vw__nav--next .vw__nav-lbl{text-align:right}
@media (hover:hover){.vw__nav:hover .vw__nav-lbl,.vw__nav:focus-visible .vw__nav-lbl{max-width:260px;opacity:1}.vw__nav--prev:hover .vw__nav-lbl,.vw__nav--prev:focus-visible .vw__nav-lbl{padding-right:22px}.vw__nav--next:hover .vw__nav-lbl,.vw__nav--next:focus-visible .vw__nav-lbl{padding-left:22px}}
.vw.is-ui-in .vw__nav[disabled]{opacity:0;pointer-events:none}
.vw__card{position:absolute;left:max(24px,env(safe-area-inset-left));bottom:max(24px,env(safe-area-inset-bottom));width:min(620px,calc(100vw - 48px));max-height:calc(100% - 132px);overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;scrollbar-width:none;border-radius:30px;padding:26px 30px 26px;--vw-x:0px}
.vw__card::-webkit-scrollbar{display:none}
.vw__eyebrow{display:flex;align-items:center;flex-wrap:wrap;gap:6px 9px;margin:0;font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.62)}
.vw__eyebrow b{color:#fff;font-weight:700}
.vw__dot{width:8px;height:8px;border-radius:50%;background:var(--vw-accent);box-shadow:0 0 14px var(--vw-accent);flex:none}
.vw__title{margin:12px 0 0;font-size:clamp(40px,5.4vw,84px);line-height:1.02;font-weight:700;letter-spacing:-.035em;color:#fff;text-wrap:balance;word-break:keep-all;overflow-wrap:anywhere}
.vw__en{margin:10px 0 0;font-size:clamp(15px,1.45vw,19px);font-weight:600;letter-spacing:-.005em;background:${GRAD};-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;display:inline-block}
.vw__meta{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0 0}
.vw__chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border-radius:999px;font-size:12px;font-weight:600;letter-spacing:.02em;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14);color:#fff;white-space:nowrap}
.vw__chip--time{font-variant-numeric:tabular-nums}
.vw__chip--must{background:linear-gradient(90deg,rgba(127,227,255,.22),rgba(107,255,184,.22),rgba(179,140,255,.22));border-color:rgba(127,227,255,.36)}
.vw__chip--food{background:rgba(255,176,102,.16);border-color:rgba(255,176,102,.34);color:#ffd9b0}
.vw__chip--alt{background:transparent;border-style:dashed;color:rgba(255,255,255,.66)}
.vw__chip--heritage{background:rgba(255,215,120,.14);border-color:rgba(255,215,120,.32);color:#ffe7ae}
.vw__desc{margin:14px 0 0;font-size:16px;line-height:1.7;color:rgba(255,255,255,.84);max-width:54ch}
.vw__note{margin:12px 0 0;display:flex;gap:8px;align-items:flex-start;font-size:13.5px;line-height:1.55;color:#ffd79a;background:rgba(255,197,107,.08);border:1px solid rgba(255,197,107,.2);padding:9px 12px;border-radius:14px}
.vw__note svg{flex:none;margin-top:2px}
.vw__actions{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0 0}
.vw__cta{display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 18px;border-radius:999px;font-size:14.5px;font-weight:600;text-decoration:none;color:#fff;white-space:nowrap;transition:transform .45s ${EASE},background-color .3s,box-shadow .45s ${EASE}}
.vw__cta:active{transform:scale(.96)}
.vw__cta--world{background:#f5f5f7;color:#000}
.vw__cta--world:hover{background:#fff;transform:translateY(-1px);box-shadow:0 10px 30px rgba(127,227,255,.25)}
.vw__cta--world .vw__arr{transition:transform .45s ${EASE}}
.vw__cta--world:hover .vw__arr{transform:translateX(3px)}
.vw__cta--map{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18)}
.vw__cta--map:hover{background:rgba(255,255,255,.18)}
.vw__keys{position:absolute;left:0;right:0;top:max(28px,calc(env(safe-area-inset-top) + 10px));display:flex;justify-content:center;gap:16px;align-items:center;pointer-events:none!important;font-size:12px;font-weight:500;color:rgba(255,255,255,.5);letter-spacing:.02em}
.vw__keys kbd{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 6px;margin-right:4px;border-radius:6px;font:600 11px/1 ${FONT};color:rgba(255,255,255,.82);background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14)}
.vw__touch{position:absolute;left:50%;top:max(76px,calc(env(safe-area-inset-top) + 64px));transform:translateX(-50%);display:none;padding:8px 14px;border-radius:999px;font-size:12.5px;font-weight:600;white-space:nowrap;pointer-events:none;opacity:0}
.vw.is-ui-in .vw__touch.is-show{animation:vw-touch 4.2s ${EASE} .4s both}
@keyframes vw-touch{0%{opacity:0;transform:translate(-50%,-6px)}12%,78%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-4px)}}
.vw__spin{position:absolute;left:50%;top:50%;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:2px solid rgba(255,255,255,.18);border-top-color:#fff;animation:vw-spin .8s linear infinite;opacity:0;transition:opacity .2s;pointer-events:none}
.vw.is-loading .vw__spin{opacity:1}
@keyframes vw-spin{to{transform:rotate(360deg)}}
.vw__sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.vw :focus{outline:none}
.vw :focus-visible{outline:2px solid #7fe3ff;outline-offset:3px}
@media (hover:none),(pointer:coarse){.vw__keys{display:none}.vw__touch{display:block}}
@media (max-width:980px){.vw__keys{display:none}}
@media (max-width:760px){
.vw__card{left:max(12px,env(safe-area-inset-left));right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));width:auto;max-height:min(56%,calc(100% - 150px));padding:20px 20px 20px;border-radius:24px}
.vw__title{font-size:clamp(30px,8.6vw,46px);margin-top:10px}
.vw__en{font-size:14.5px}
.vw__desc{font-size:15px;line-height:1.65;margin-top:10px}
.vw__meta{margin-top:12px}
.vw__actions{margin-top:16px;gap:8px}
.vw__cta{height:42px;padding:0 16px;font-size:14px}
.vw__top{padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) 0 max(12px,env(safe-area-inset-left))}
.vw__progress{height:36px;padding:0 13px;font-size:12px;gap:10px}
.vw__bar{width:44px}
.vw__nav{height:44px;min-width:44px;margin-top:-22px;top:38%}
.vw__nav-ico{width:42px;height:42px}
.vw__nav--prev{left:max(10px,env(safe-area-inset-left))}
.vw__nav--next{right:max(10px,env(safe-area-inset-right))}
.vw__keys{display:none}
}
@media (prefers-reduced-motion:reduce){.vw__fade,.vw__btn,.vw__nav,.vw__bar i{transition-duration:.01s!important}.vw__grain{animation:none}.vw__spin{animation-duration:2s}}
.vw-zoomable{cursor:zoom-in}
.vw-zoomable:focus-visible{outline:2px solid #7fe3ff;outline-offset:-4px}
.vw-hint{position:fixed;left:0;top:0;z-index:${CFG.zIndex - 1};pointer-events:none;will-change:transform}
.vw-hint>span{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 14px 0 11px;border-radius:999px;font:600 13px/1 ${FONT};letter-spacing:.03em;color:#fff;white-space:nowrap;background:rgba(28,28,32,.42);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);border:1px solid rgba(255,255,255,.2);box-shadow:0 10px 30px rgba(0,0,0,.35);opacity:0;transform:scale(.82);transform-origin:0 0;transition:opacity .25s ${EASE},transform .45s ${EASE}}
.vw-hint.is-on>span{opacity:1;transform:scale(1)}
.vw-hint i{width:7px;height:7px;border-radius:50%;background:${GRAD};box-shadow:0 0 10px rgba(127,227,255,.8)}
`;
    (doc.head || doc.documentElement).appendChild(st);
  }

  /* ------------------------------------------------------------------ *
   * Icons
   * ------------------------------------------------------------------ */
  const IC = {
    close: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" fill="none"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/></svg>',
    cube: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z M4 7.4l8 4.6 8-4.6 M12 12v9.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.1" fill="currentColor"/></svg>',
    tilt: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><rect x="8" y="3.5" width="8" height="17" rx="2.2" transform="rotate(-14 12 12)" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 8.5c-1.2 2.2-1.2 4.8 0 7M20.5 8.5c1.2 2.2 1.2 4.8 0 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>'
  };

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  const FX_DEPTH = { aurora: 0.08, sunset: 0.15, flight: 0.12, city: 0.45, waterfall: 0.5, geyser: 0.5, mist: 0.45,
    steam: 0.6, waves: 0.75, drift: 0.6, ice: 0.55, snow: 0.7, ripple: 0.65, drive: 0.7, wind: 0.6 };
  const newSlot = () => ({ entry: null, img: null, iw: 16, ih: 9, sx: 0, sy: 0, zoom: 1, dolly: 0, alpha: 1,
    slide: null, imgEl: null, fx: null, fxH: 0.5, tf: '' });

  const S = {
    el: null, isOpen: false, phase: 'idle', list: [], idx: -1,
    R: null, mode: 'css', glFailed: false, debug: false,
    slots: [newSlot(), newSlot()], cur: 0, mix: 0,
    W: 1, H: 1, needResize: false,
    cam: { x: 0, y: 0 }, input: { x: 0, y: 0 }, gyroIn: { x: 0, y: 0 },
    lastInput: 0, idleW: 0, dolly: 0, breath: 0, time: 0,
    raf: 0, last: 0, anims: [], navToken: 0, cardToken: 0, pending: null,
    drag: null, overUI: false, wheelAcc: 0, wheelT: 0, wheelLock: 0, cursorIdle: false,
    prevFocus: null, prevScene: undefined, lock: null, pausedFx: [],
    perf: { acc: 0, n: 0, frames: 0, scale: 1, fps: 60 },
    listeners: []
  };
  const G = { state: 'idle', on: false, base: null, last: 0 };

  /* ------------------------------------------------------------------ *
   * DOM
   * ------------------------------------------------------------------ */
  function ensureDOM() {
    if (S.el) return S.el;
    injectCSS();
    const root = doc.createElement('div');
    root.className = 'vw';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'vwTitle');
    root.setAttribute('aria-describedby', 'vwDesc');
    root.setAttribute('data-lenis-prevent', '');
    root.innerHTML =
      '<div class="vw__bg"></div>' +
      '<div class="vw__clip"><div class="vw__stage">' +
        '<div class="vw__slides"></div>' +
        '<div class="vw__shade"></div>' +
        '<div class="vw__grain"></div>' +
      '</div></div>' +
      '<div class="vw__spin" aria-hidden="true"></div>' +
      '<div class="vw__ui">' +
        '<div class="vw__top">' +
          '<div class="vw__progress vw-glass vw__fade" aria-hidden="true"><b class="vw__ptxt"></b><span class="vw__bar"><i></i></span></div>' +
          '<div class="vw__tools">' +
            '<button class="vw__btn vw-glass vw__gyro vw__fade" type="button" hidden>' + IC.tilt + '<span>體感視角</span></button>' +
            '<button class="vw__btn vw-glass vw__close vw__fade vw__keep" type="button" aria-label="關閉（Esc）" title="關閉（Esc）">' + IC.close + '</button>' +
          '</div>' +
        '</div>' +
        '<button class="vw__nav vw__nav--prev vw-glass vw__fade" type="button" aria-label="上一個景點"><span class="vw__nav-ico">' + IC.prev + '</span><span class="vw__nav-lbl" aria-hidden="true"></span></button>' +
        '<button class="vw__nav vw__nav--next vw-glass vw__fade" type="button" aria-label="下一個景點"><span class="vw__nav-ico">' + IC.next + '</span><span class="vw__nav-lbl" aria-hidden="true"></span></button>' +
        '<section class="vw__card vw-glass vw__fade" aria-live="off"></section>' +
        '<div class="vw__keys vw__fade" aria-hidden="true"><span><kbd>←</kbd><kbd>→</kbd>切換景點</span><span><kbd>Esc</kbd>關閉</span><span class="vw__kdepth">移動滑鼠，感受景深</span></div>' +
        '<div class="vw__touch vw-glass" aria-hidden="true"></div>' +
        '<p class="vw__sr" aria-live="polite"></p>' +
      '</div>';
    (doc.body || doc.documentElement).appendChild(root);
    const $ = (s) => root.querySelector(s);
    S.el = {
      root, bg: $('.vw__bg'), clip: $('.vw__clip'), stage: $('.vw__stage'), slides: $('.vw__slides'),
      shade: $('.vw__shade'), grain: $('.vw__grain'), spin: $('.vw__spin'), ui: $('.vw__ui'),
      ptxt: $('.vw__ptxt'), bar: $('.vw__bar'), gyro: $('.vw__gyro'), close: $('.vw__close'),
      prev: $('.vw__nav--prev'), next: $('.vw__nav--next'), card: $('.vw__card'), keys: $('.vw__keys'),
      touch: $('.vw__touch'), sr: $('.vw__sr')
    };
    S.el.grain.style.backgroundImage = grainURL();
    S.el.close.addEventListener('click', () => close());
    S.el.prev.addEventListener('click', () => step(-1));
    S.el.next.addEventListener('click', () => step(1));
    S.el.gyro.addEventListener('click', () => requestGyro());
    S.el.card.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('.vw__cta--world');
      if (a) ambSfx('chime');
    });
    return S.el;
  }

  const TAGCLS = { '必去': 'vw__chip--must', '美食': 'vw__chip--food', '備案': 'vw__chip--alt', '世界遺產': 'vw__chip--heritage' };
  function cardHTML(e) {
    const s = e.spot, d = e.day;
    const week = d.weekday ? '星期' + esc(d.weekday) : '';
    const chips = [];
    if (s.time) chips.push('<span class="vw__chip vw__chip--time">' + esc(s.time) + '</span>');
    (Array.isArray(s.tags) ? s.tags : []).forEach((t) => chips.push('<span class="vw__chip ' + (TAGCLS[t] || '') + '">' + esc(t) + '</span>'));
    const acts = [];
    if (s.world) {
      acts.push('<a class="vw__cta vw__cta--world" href="' + esc(CFG.worldBase + encodeURIComponent(s.world) + '.html') + '">' +
        IC.cube + '<span>進入 3D 虛擬空間</span><span class="vw__arr" aria-hidden="true">→</span></a>');
    }
    if (s.map) {
      acts.push('<a class="vw__cta vw__cta--map" href="' + esc(s.map) + '" target="_blank" rel="noopener">' + IC.pin + '<span>在 Google Maps 開啟</span></a>');
    }
    return '' +
      '<p class="vw__eyebrow"><i class="vw__dot" aria-hidden="true"></i><b>Day ' + esc(e.dayNo) + '</b><span>' + esc(d.date || '') + (week ? ' ' + week : '') + '</span>' +
        (d.title ? '<span aria-hidden="true">·</span><span>' + esc(d.title) + '</span>' : '') + '</p>' +
      '<h2 class="vw__title" id="vwTitle">' + esc(s.title) + '</h2>' +
      (s.en ? '<p class="vw__en" lang="en">' + esc(s.en) + '</p>' : '') +
      (chips.length ? '<div class="vw__meta">' + chips.join('') + '</div>' : '') +
      (s.desc ? '<p class="vw__desc" id="vwDesc">' + esc(s.desc) + '</p>' : '<p class="vw__sr" id="vwDesc">' + esc(s.title) + '</p>') +
      (s.note ? '<p class="vw__note">' + IC.warn + '<span>' + esc(s.note) + '</span></p>' : '') +
      (acts.length ? '<div class="vw__actions">' + acts.join('') + '</div>' : '');
  }

  function reveal(nodes, delay, dx, dy) {
    if (REDUCED()) return;
    nodes.forEach((n, i) => {
      if (!n.animate) return;
      try {
        n.animate([
          { opacity: 0, transform: 'translate3d(' + dx + 'px,' + dy + 'px,0)' },
          { opacity: 1, transform: 'translate3d(0,0,0)' }
        ], { duration: 760, delay: delay + i * 55, easing: EASE, fill: 'backwards' });
      } catch (e) { /* ignore */ }
    });
  }

  function setCard(entry, dir, animate) {
    const card = S.el.card;
    const token = ++S.cardToken;
    card.style.setProperty('--vw-accent', accentOf(entry));
    const inner = doc.createElement('div');
    inner.className = 'vw__card-inner';
    inner.innerHTML = cardHTML(entry);
    const olds = Array.from(card.querySelectorAll('.vw__card-inner'));
    if (!animate || !olds.length || REDUCED() || !card.animate) {
      olds.forEach((o) => o.remove());
      card.appendChild(inner);
      card.scrollTop = 0;
      return;
    }
    const h0 = card.offsetHeight;
    olds.forEach((o) => o.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id')));
    const old = olds[olds.length - 1];
    const out = old.animate([
      { opacity: 1, transform: 'translate3d(0,0,0)' },
      { opacity: 0, transform: 'translate3d(' + (-dir * 18) + 'px,0,0)' }
    ], { duration: 190, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    const swap = () => {
      if (token !== S.cardToken || !S.isOpen) return;
      card.querySelectorAll('.vw__card-inner').forEach((o) => o.remove());
      card.appendChild(inner);
      card.scrollTop = 0;
      const h1 = card.offsetHeight;
      if (Math.abs(h1 - h0) > 1) {
        try { card.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 560, easing: EASE }); } catch (e) { /* ignore */ }
      }
      reveal(Array.from(inner.children), 0, dir * 26, 0);
    };
    out.finished.then(swap, swap);
  }

  function updateChrome(entry) {
    const el = S.el, n = S.list.length;
    el.root.style.setProperty('--vw-accent', accentOf(entry));
    el.ptxt.textContent = 'Day ' + entry.dayNo + ' · ' + (entry.idx + 1) + ' / ' + entry.count;
    el.bar.style.setProperty('--p', String(n ? (entry.g + 1) / n : 0));
    el.bar.setAttribute('title', '全程 ' + (entry.g + 1) + ' / ' + n);
    const p = S.list[entry.g - 1], q = S.list[entry.g + 1];
    setNav(el.prev, p, '上一站');
    setNav(el.next, q, '下一站');
  }
  function setNav(btn, e, word) {
    btn.disabled = !e;
    const lbl = btn.querySelector('.vw__nav-lbl');
    if (e) {
      lbl.innerHTML = '<small>' + word + ' · Day ' + esc(e.dayNo) + '</small>' + esc(e.spot.title);
      btn.setAttribute('aria-label', word + '：' + e.spot.title);
    } else {
      lbl.textContent = '';
      btn.setAttribute('aria-label', word === '上一站' ? '已是第一站' : '已是最後一站');
    }
  }
  function announce(entry) {
    if (!S.el) return;
    S.el.sr.textContent = entry.spot.title + '，Day ' + entry.dayNo + ' 第 ' + (entry.idx + 1) + ' / ' + entry.count + ' 站';
  }
  function updateTouchHint() {
    if (!S.el) return;
    const t = S.el.touch;
    t.textContent = G.on ? '傾斜手機，感受景深 · 左右滑動切換' : '左右滑動切換 · 點一下隱藏資訊';
  }
  function updateGyroBtn() {
    if (!S.el) return;
    const show = COARSE() && gyroSupported() && gyroNeedsPermission() && (G.state === 'idle');
    S.el.gyro.hidden = !show;
    updateTouchHint();
  }

  /* ------------------------------------------------------------------ *
   * Source element (shared-element FLIP)
   * ------------------------------------------------------------------ */
  function visibleRect(el) {
    const r = el.getBoundingClientRect();
    let L = r.left, T = r.top, Rr = r.right, B = r.bottom;
    let radius = 0;
    try { radius = parseFloat(global.getComputedStyle(el).borderTopLeftRadius) || 0; } catch (e) { /* ignore */ }
    let p = el.parentElement, found = false;
    while (p && p !== doc.body && p !== doc.documentElement) {
      let cs = null;
      try { cs = global.getComputedStyle(p); } catch (e) { cs = null; }
      if (cs && (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || (cs.clipPath && cs.clipPath !== 'none'))) {
        const pr = p.getBoundingClientRect();
        L = Math.max(L, pr.left); T = Math.max(T, pr.top); Rr = Math.min(Rr, pr.right); B = Math.min(B, pr.bottom);
        if (!found) { found = true; radius = Math.max(radius, parseFloat(cs.borderTopLeftRadius) || 0); }
      }
      p = p.parentElement;
    }
    const vw = global.innerWidth, vh = global.innerHeight;
    L = Math.max(L, 0); T = Math.max(T, 0); Rr = Math.min(Rr, vw); B = Math.min(B, vh);
    return { rect: r, clip: { left: L, top: T, right: Rr, bottom: B, width: Math.max(0, Rr - L), height: Math.max(0, B - T) }, radius };
  }
  function describeSource(img) {
    if (!img || !img.getBoundingClientRect) return null;
    const v = visibleRect(img);
    if (v.rect.width < 2 || v.rect.height < 2 || v.clip.width < 2 || v.clip.height < 2) return null;
    let fit = 'cover', px = 0.5, py = 0.5;
    try {
      const cs = global.getComputedStyle(img);
      fit = cs.objectFit || 'cover';
      const parts = String(cs.objectPosition || '50% 50%').split(/\s+/);
      const pp = (s) => (/%$/.test(s) ? parseFloat(s) / 100 : s === 'left' || s === 'top' ? 0 : s === 'right' || s === 'bottom' ? 1 : 0.5);
      px = pp(parts[0] || '50%'); py = pp(parts[1] || '50%');
    } catch (e) { /* ignore */ }
    v.img = img; v.fit = fit; v.px = px; v.py = py;
    v.area = v.clip.width * v.clip.height;
    v.ratio = v.area / Math.max(1, v.rect.width * v.rect.height);
    return v;
  }
  function findSource(id, requireVisible) {
    let best = null;
    let nodes = [];
    try { nodes = doc.querySelectorAll('[data-spot-id="' + cssEsc(id) + '"]'); } catch (e) { nodes = []; }
    Array.prototype.forEach.call(nodes, (el) => {
      if (S.el && S.el.root.contains(el)) return;
      const img = el.tagName === 'IMG' ? el : el.querySelector('img');
      const d = describeSource(img);
      if (!d) return;
      if (requireVisible && d.ratio < 0.25) return;
      if (!best || d.area > best.area) best = d;
    });
    return best;
  }
  function flipFrom(src, iw, ih) {
    const W = S.W, H = S.H, r = src.rect;
    const s0 = src.fit === 'contain' ? Math.min(r.width / iw, r.height / ih) :
      src.fit === 'fill' ? Math.max(r.width / iw, r.height / ih) : Math.max(r.width / iw, r.height / ih);
    const dw = iw * s0, dh = ih * s0;
    const cx = r.left + (r.width - dw) * src.px + dw / 2;
    const cy = r.top + (r.height - dh) * src.py + dh / 2;
    const s1 = Math.max(W / iw, H / ih) * CFG.overscan;
    const k = s0 / s1;
    const tx = cx - k * W / 2, ty = cy - k * H / 2;
    const c = src.clip;
    return {
      transform: 'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0) scale(' + k.toFixed(5) + ')',
      clip: 'inset(' + c.top.toFixed(1) + 'px ' + (W - c.right).toFixed(1) + 'px ' + (H - c.bottom).toFixed(1) + 'px ' + c.left.toFixed(1) + 'px round ' + src.radius.toFixed(1) + 'px)'
    };
  }
  const CLIP_FULL = 'inset(0px 0px 0px 0px round 0px)';
  const TF_ID = 'translate3d(0px,0px,0) scale(1)';

  function anim(el, frames, opts) {
    if (!el || !el.animate) return null;
    try {
      const a = el.animate(frames, Object.assign({ fill: 'both' }, opts));
      S.anims.push(a);
      return a;
    } catch (e) { return null; }
  }
  const done = (a) => (a && a.finished ? a.finished.then(() => true, () => false) : Promise.resolve(true));
  function cancelAnims() {
    S.anims.splice(0, S.anims.length).forEach((a) => { try { a.cancel(); } catch (e) { /* ignore */ } });
  }

  /* ------------------------------------------------------------------ *
   * Slots (one per texture unit pair / slide element)
   * ------------------------------------------------------------------ */
  function hexRGB(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
    if (!m) return [10, 14, 20];
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) * 0.18, ((n >> 8) & 255) * 0.18, (n & 255) * 0.18].map((v) => v | 0);
  }
  function destroySlot(sl) {
    if (sl.fx) { try { sl.fx.destroy(); } catch (e) { /* ignore */ } }
    if (sl.slide && sl.slide.parentNode) sl.slide.parentNode.removeChild(sl.slide);
    Object.assign(sl, newSlot());
  }
  function prepareSlot(i, entry, img) {
    const sl = S.slots[i];
    destroySlot(sl);
    const url = imgUrl(entry.spot);
    const slide = doc.createElement('div');
    slide.className = 'vw__slide';
    const im = doc.createElement('img');
    im.alt = '';
    im.decoding = 'async';
    im.draggable = false;
    if (img) im.src = img.src || url; else im.style.visibility = 'hidden';
    slide.appendChild(im);
    S.el.slides.appendChild(slide);
    sl.entry = entry; sl.img = img; sl.slide = slide; sl.imgEl = im;
    sl.iw = img ? img.naturalWidth || 16 : 16; sl.ih = img ? img.naturalHeight || 9 : 9;
    sl.fxH = FX_DEPTH[entry.spot.fx] == null ? 0.5 : FX_DEPTH[entry.spot.fx];
    if (S.mode === 'webgl' && S.R) {
      try {
        S.R.setSlot(i, img, getDepth(url, img), hexRGB(accentOf(entry)));
      } catch (e) {
        warn('WebGL texture upload failed (file:// or cross-origin?) → CSS parallax.', e && e.message);
        toCSSMode();
      }
    }
    if (img && global.FX && typeof global.FX.mount === 'function' && entry.spot.fx) {
      try {
        sl.fx = global.FX.mount(slide, entry.spot.fx, {
          accent: accentOf(entry), intensity: CFG.fxIntensity, id: entry.spot.img || entry.spot.id
        });
      } catch (e) { sl.fx = null; }
    }
    return sl;
  }
  function fadeFx(sl, ms) {
    const c = sl && sl.fx && sl.fx.canvas;
    if (!c) return;
    c.style.transition = 'opacity ' + ms + 'ms ' + EASE;
    c.style.opacity = '0';
  }
  function toCSSMode() {
    if (S.R) {
      const R = S.R; S.R = null;
      try { R.dispose(); } catch (e) { /* ignore */ }
      if (R.canvas.parentNode) R.canvas.parentNode.removeChild(R.canvas);
    }
    S.glFailed = true;
    S.mode = 'css';
    if (S.el) S.el.root.classList.remove('is-gl');
    S.slots.forEach((sl) => { if (sl.fx && sl.fx.canvas) sl.fx.canvas.style.transform = ''; sl.tf = ''; });
  }

  /* ------------------------------------------------------------------ *
   * Frame
   * ------------------------------------------------------------------ */
  function measure() {
    const r = S.el.root;
    S.W = r.clientWidth || global.innerWidth || 1;
    S.H = r.clientHeight || global.innerHeight || 1;
    sizeCanvas();
  }
  function sizeCanvas() {
    if (!S.R) return;
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    let k = dpr * S.perf.scale;
    if (S.W * S.H * k * k > CFG.maxPixels) k = Math.sqrt(CFG.maxPixels / (S.W * S.H));
    S.R.resize(Math.max(1, Math.round(S.W * k)), Math.max(1, Math.round(S.H * k)));
  }
  function coverScale(iw, ih, W, H, zoom) {
    const as = W / H, ai = iw / ih;
    let sx = 1, sy = 1;
    if (ai > as) sx = as / ai; else sy = ai / as;
    return [sx / zoom, sy / zoom];
  }
  const parallaxAmt = () => CFG.parallax * (REDUCED() ? 0.45 : 1) * (COARSE() ? 1.15 : 1);

  function updateCamera(dt, t) {
    const reduced = REDUCED();
    const closing = S.phase === 'closing';
    const gyroLive = G.on && t - G.last < 600;
    const idleFor = t - S.lastInput;
    const wantIdle = !closing && !reduced && !gyroLive && !S.drag && idleFor > 2600;
    S.idleW += ((wantIdle ? 1 : 0) - S.idleW) * (1 - Math.exp(-dt * 0.9));
    const T = S.time;
    const driftX = Math.sin(T * 0.23) * 0.62 + Math.sin(T * 0.11 + 2.0) * 0.22;
    const driftY = Math.sin(T * 0.17 + 1.1) * 0.34;
    let tx, ty;
    if (closing) { tx = 0; ty = 0; }
    else if (gyroLive && !S.drag) { tx = S.gyroIn.x; ty = S.gyroIn.y; }
    else { tx = lerp(S.input.x, driftX, S.idleW); ty = lerp(S.input.y, driftY, S.idleW); }
    const k = 1 - Math.exp(-dt * (closing ? 9 : S.drag ? 10 : gyroLive ? 6 : 3.2));
    S.cam.x += (tx - S.cam.x) * k;
    S.cam.y += (ty - S.cam.y) * k;
    S.breath = closing || reduced ? S.breath * (1 - k) : S.idleW * 0.018 * Math.sin(T * 0.35);
    // hide cursor when idle (desktop)
    const ci = !closing && !S.overUI && idleFor > 3000 && !COARSE();
    if (ci !== S.cursorIdle) { S.cursorIdle = ci; S.el.root.classList.toggle('is-idle', ci); }
  }

  const U = { c0: [1, 1], c1: [1, 1], o0: [0, 0], o1: [0, 0], d0: 0, d1: 0, mix: 0, focus: 0.42, debug: false, time: 0, grain: 0.04 };
  function render() {
    const W = S.W, H = S.H, mind = Math.min(W, H), A = parallaxAmt(), Z = CFG.overscan, F = CFG.focus;
    for (let i = 0; i < 2; i++) {
      const sl = S.slots[i];
      if (!sl.entry) continue;
      const kx = (-S.cam.x + sl.sx) * A * mind;   // px, content shift at (h - focus) = 1
      const ky = (-S.cam.y + sl.sy) * A * mind;
      const dol = S.dolly + S.breath + sl.dolly;
      const cs = coverScale(sl.iw, sl.ih, W, H, Z * sl.zoom);
      if (i === 0) { U.c0 = cs; U.o0[0] = kx / W; U.o0[1] = ky / H; U.d0 = dol; }
      else { U.c1 = cs; U.o1[0] = kx / W; U.o1[1] = ky / H; U.d1 = dol; }
      let tf;
      if (S.mode === 'webgl') {
        // keep the FX overlay roughly glued to its depth layer
        if (!sl.fx || !sl.fx.canvas) continue;
        const h = sl.fxH;
        const sc = Z * sl.zoom / Math.max(0.2, 1 - dol * h);
        tf = 'translate3d(' + (kx * (h - F)).toFixed(2) + 'px,' + (ky * (h - F)).toFixed(2) + 'px,0) scale(' + sc.toFixed(4) + ')';
        if (tf !== sl.tf) { sl.tf = tf; sl.fx.canvas.style.transform = tf; }
      } else if (sl.slide) {
        const sc = Z * sl.zoom * (1 + dol * 0.5);
        tf = 'translate3d(' + (kx * 0.55).toFixed(2) + 'px,' + (ky * 0.55).toFixed(2) + 'px,0) scale(' + sc.toFixed(4) + ')';
        if (tf !== sl.tf) { sl.tf = tf; sl.slide.style.transform = tf; }
        const op = sl.alpha >= 0.999 ? '' : sl.alpha.toFixed(3);
        if (sl.slide.style.opacity !== op) sl.slide.style.opacity = op;
      }
    }
    if (S.mode === 'webgl' && S.R) {
      if (!S.slots[1].entry) U.c1 = U.c0;
      U.mix = S.mix; U.focus = F; U.debug = S.debug; U.time = S.time; U.grain = REDUCED() ? 0.025 : 0.042;
      S.R.draw(U);
    }
  }

  function loop(ts) {
    S.raf = 0;
    if (!S.isOpen) return;
    const t = now();
    let dt = S.last ? (t - S.last) / 1000 : 1 / 60;
    S.last = t;
    if (!(dt > 0)) dt = 1 / 120; else if (dt > 0.05) dt = 0.05;
    S.time += dt;
    if (S.needResize) { S.needResize = false; measure(); }
    stepTweens(t);
    updateCamera(dt, t);
    try { render(); } catch (e) { warn('render failed', e); if (S.mode === 'webgl') toCSSMode(); }
    perf(dt);
    S.raf = global.requestAnimationFrame(loop);
  }
  function perf(dt) {
    const P = S.perf;
    P.frames++;
    if (P.frames < 40) return;      // ignore warm-up (texture uploads, FLIP)
    P.acc += dt; P.n++;
    if (P.n >= 45) {
      const avg = P.acc / P.n;
      P.fps = Math.round(1 / avg);
      if (S.mode === 'webgl' && avg > 1 / 42 && P.scale > 0.5 && S.phase === 'open') {
        P.scale = Math.max(0.5, P.scale * 0.85);
        sizeCanvas();
      }
      P.acc = 0; P.n = 0;
    }
  }
  function startLoop() {
    if (S.raf) return;
    S.last = 0;
    S.raf = global.requestAnimationFrame(loop);
  }
  function stopLoop() {
    if (S.raf) global.cancelAnimationFrame(S.raf);
    S.raf = 0;
  }

  /* ------------------------------------------------------------------ *
   * Scroll lock · focus trap · background FX pause
   * ------------------------------------------------------------------ */
  function lockScroll() {
    const de = doc.documentElement, b = doc.body;
    if (!b || S.lock) return;
    S.lock = { ho: de.style.overflow, bo: b.style.overflow, bp: b.style.paddingRight, x: global.scrollX, y: global.scrollY, lenis: false };
    const sbw = global.innerWidth - de.clientWidth;
    if (sbw > 0) {
      let pr = 0;
      try { pr = parseFloat(global.getComputedStyle(b).paddingRight) || 0; } catch (e) { /* ignore */ }
      b.style.paddingRight = (pr + sbw) + 'px';
    }
    de.style.overflow = 'hidden';
    b.style.overflow = 'hidden';
    de.classList.add('vw-lock');
    const L = global.lenis || global.__lenis;
    if (L && typeof L.stop === 'function') { try { L.stop(); S.lock.lenis = L; } catch (e) { /* ignore */ } }
  }
  function unlockScroll() {
    const L = S.lock;
    if (!L) return;
    const de = doc.documentElement, b = doc.body;
    de.style.overflow = L.ho; b.style.overflow = L.bo; b.style.paddingRight = L.bp;
    de.classList.remove('vw-lock');
    if (global.scrollY !== L.y || global.scrollX !== L.x) { try { global.scrollTo(L.x, L.y); } catch (e) { /* ignore */ } }
    if (L.lenis) { try { L.lenis.start(); } catch (e) { /* ignore */ } }
    S.lock = null;
  }
  function pauseBgFx() {
    S.pausedFx = [];
    doc.querySelectorAll('.fx-canvas').forEach((c) => {
      const host = c.parentElement, I = host && host.__fxInst;
      if (!I || I.dead || !I.enabled || !I.api || (S.el && S.el.root.contains(host))) return;
      try { I.api.setActive(false); S.pausedFx.push(I.api); } catch (e) { /* ignore */ }
    });
  }
  function resumeBgFx() {
    S.pausedFx.splice(0, S.pausedFx.length).forEach((api) => { try { api.setActive(true); } catch (e) { /* ignore */ } });
  }
  function focusables() {
    return Array.prototype.filter.call(
      S.el.root.querySelectorAll('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'),
      (n) => !n.hidden && n.offsetParent !== null && getComputedStyle(n).visibility !== 'hidden'
    );
  }
  function focusEl(n) { try { n.focus({ preventScroll: true }); } catch (e) { try { n.focus(); } catch (e2) { /* ignore */ } } }

  /* ------------------------------------------------------------------ *
   * Gyro (DeviceOrientation; iOS needs permission from a tap)
   * ------------------------------------------------------------------ */
  const gyroSupported = () => 'DeviceOrientationEvent' in global;
  const gyroNeedsPermission = () => { const D = global.DeviceOrientationEvent; return !!(D && typeof D.requestPermission === 'function'); };
  // MUST be called synchronously inside a user gesture on iOS
  function requestGyro() {
    if (!gyroSupported() || G.state === 'granted' || G.state === 'denied' || G.state === 'pending') {
      if (G.state === 'granted' && S.isOpen && !G.on) startGyro();
      return;
    }
    if (gyroNeedsPermission()) {
      G.state = 'pending';
      let p;
      try { p = global.DeviceOrientationEvent.requestPermission(); } catch (e) { G.state = 'idle'; updateGyroBtn(); return; }
      Promise.resolve(p).then((r) => {
        G.state = r === 'granted' ? 'granted' : 'denied';
        if (G.state === 'granted' && S.isOpen) startGyro();
        updateGyroBtn();
      }, () => { G.state = 'idle'; updateGyroBtn(); });
    } else {
      G.state = 'granted';
      if (S.isOpen) startGyro();
    }
    updateGyroBtn();
  }
  function onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    let ang = 0;
    try { ang = (global.screen && global.screen.orientation && typeof global.screen.orientation.angle === 'number') ? global.screen.orientation.angle : (global.orientation || 0); } catch (err) { ang = 0; }
    const b = e.beta, g = e.gamma;
    let x, y;
    if (ang === 90) { x = b; y = -g; } else if (ang === -90 || ang === 270) { x = -b; y = g; } else if (ang === 180) { x = -g; y = -b; } else { x = g; y = b; }
    if (!G.base) G.base = { x, y };
    G.base.x += (x - G.base.x) * 0.006;   // slowly re-centre so any holding angle works
    G.base.y += (y - G.base.y) * 0.006;
    S.gyroIn.x = clamp((x - G.base.x) / 16, -1.2, 1.2);
    S.gyroIn.y = clamp((y - G.base.y) / 16, -1.2, 1.2);
    G.last = now();
  }
  function startGyro() {
    if (G.on) return;
    G.on = true; G.base = null;
    global.addEventListener('deviceorientation', onOrient);
    updateTouchHint();
  }
  function stopGyro() {
    if (!G.on) return;
    G.on = false;
    global.removeEventListener('deviceorientation', onOrient);
  }

  /* ------------------------------------------------------------------ *
   * Runtime listeners (only while open)
   * ------------------------------------------------------------------ */
  function on(target, type, fn, opts) { target.addEventListener(type, fn, opts); S.listeners.push([target, type, fn, opts]); }
  function bindRuntime() {
    const root = S.el.root;
    on(global, 'keydown', onKey, true);
    on(global, 'resize', () => { S.needResize = true; });
    on(root, 'pointermove', onPointerMove, { passive: true });
    on(root, 'pointerdown', onPointerDown);
    on(root, 'pointerup', onPointerUp);
    on(root, 'pointercancel', onPointerCancel);
    on(root, 'pointerleave', (e) => { if (e.pointerType === 'mouse') S.lastInput = now() - 2000; });
    on(root, 'wheel', onWheel, { passive: false });
    on(root, 'touchmove', (e) => {
      if (!(e.target.closest && e.target.closest('.vw__card'))) e.preventDefault();
      e.stopPropagation();
    }, { passive: false });
    on(root, 'touchstart', (e) => e.stopPropagation(), { passive: true });
    on(root, 'dragstart', (e) => e.preventDefault());
    on(doc, 'visibilitychange', () => { S.last = 0; });
  }
  function unbindRuntime() {
    S.listeners.splice(0, S.listeners.length).forEach(([t, ty, fn, o]) => t.removeEventListener(ty, fn, o));
  }
  function onKey(e) {
    if (!S.isOpen) return;
    const k = e.key;
    if (k === 'Escape' || k === 'Esc') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (S.phase === 'closing') return;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const t = e.target;
      if (t && t.closest && (t.closest('input,textarea,select,[contenteditable]'))) return;
      e.preventDefault(); e.stopPropagation();
      step(k === 'ArrowRight' ? 1 : -1);
      return;
    }
    if ((k === 'i' || k === 'I') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.stopPropagation(); toggleUI(); return; }
    if (k === 'Tab') {
      const f = focusables();
      if (!f.length) { e.preventDefault(); return; }
      const a = doc.activeElement, i = f.indexOf(a);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); focusEl(f[f.length - 1]); }
      else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); focusEl(f[0]); }
      e.stopPropagation();
      return;
    }
    if (k === ' ' || k === 'PageDown' || k === 'PageUp' || k === 'Home' || k === 'End' || k === 'ArrowUp' || k === 'ArrowDown') {
      const t = e.target;
      const inCard = t && t.closest && t.closest('.vw__card');
      if (k === ' ' && t && t.closest && t.closest('button,a')) return;
      if (!inCard) e.preventDefault();
      e.stopPropagation();
    }
  }
  function toggleUI(force) {
    const r = S.el.root;
    const hide = typeof force === 'boolean' ? force : !r.classList.contains('is-ui-hidden');
    r.classList.toggle('is-ui-hidden', hide);
  }
  const UI_SEL = '.vw__card,.vw__top,.vw__nav,.vw__keys,a,button';
  function onPointerMove(e) {
    if (S.drag && e.pointerId === S.drag.id) {
      const dx = e.clientX - S.drag.x0, dy = e.clientY - S.drag.y0;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) S.drag.moved = true;
      if (S.drag.type !== 'mouse') {
        S.input.x = clamp(-dx / S.W * 2.4, -1.4, 1.4);
        S.input.y = clamp(-dy / S.H * 2.4, -1.1, 1.1);
      }
      S.lastInput = now();
      return;
    }
    if (e.pointerType === 'mouse') {
      S.overUI = !!(e.target.closest && e.target.closest(UI_SEL));
      S.input.x = clamp((e.clientX / S.W) * 2 - 1, -1, 1);
      S.input.y = clamp((e.clientY / S.H) * 2 - 1, -1, 1);
      S.lastInput = now();
    }
  }
  function onPointerDown(e) {
    if (!e.isPrimary || S.phase === 'closing') return;
    if (e.target.closest && e.target.closest(UI_SEL)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    S.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: now(), moved: false, type: e.pointerType };
    try { S.el.root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function onPointerUp(e) {
    const d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    S.drag = null;
    try { S.el.root.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0, dt = now() - d.t0;
    if (d.type !== 'mouse') { S.input.x = 0; S.input.y = 0; }
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.25 && dt < 1000) { step(dx < 0 ? 1 : -1); return; }
    if (!d.moved && dt < 450 && d.type !== 'mouse') {
      requestGyro();
      toggleUI();
    }
  }
  function onPointerCancel(e) {
    if (S.drag && e.pointerId === S.drag.id) { S.drag = null; S.input.x = 0; S.input.y = 0; }
  }
  function onWheel(e) {
    e.stopPropagation();               // keep Lenis / page scroll out of it
    const card = e.target.closest && e.target.closest('.vw__card');
    if (card && card.scrollHeight > card.clientHeight + 2 && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) return;
    e.preventDefault();
    const t = now();
    if (t - S.wheelT > 220) S.wheelAcc = 0;
    S.wheelT = t;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2) {
      S.wheelAcc += e.deltaX;
      if (t > S.wheelLock && Math.abs(S.wheelAcc) > 70) {
        step(S.wheelAcc > 0 ? 1 : -1);
        S.wheelAcc = 0;
        S.wheelLock = t + 900;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Open / navigate / close
   * ------------------------------------------------------------------ */
  function resetMotion() {
    S.cam.x = 0; S.cam.y = 0; S.input.x = 0; S.input.y = 0; S.gyroIn.x = 0; S.gyroIn.y = 0;
    S.idleW = 0; S.dolly = 0; S.breath = 0; S.time = Math.random() * 40;
    S.lastInput = now() - 1400;        // drift kicks in ~1s after opening
    S.perf = { acc: 0, n: 0, frames: 0, scale: 1, fps: 60 };
    S.pending = null;
  }

  async function open(id, opts) {
    opts = opts || {};
    // iOS: request motion permission while we're still inside the click's call stack
    if (CFG.gyroOnOpen && COARSE()) requestGyro();
    if (S.phase === 'opening' || S.phase === 'closing') return false;
    S.list = buildList();
    const gi = S.list.findIndex((e) => e.spot.id === id);
    if (gi < 0) { warn('unknown spot id:', id); return false; }
    if (S.isOpen) { go(id); return true; }

    ensureDOM();
    const el = S.el, root = el.root;
    S.isOpen = true; S.phase = 'opening'; S.idx = gi;
    const entry = S.list[gi];
    const token = ++S.navToken;
    S.prevFocus = doc.activeElement;
    S.prevScene = ambGetScene();
    lockScroll();
    pauseBgFx();
    resetMotion();

    root.hidden = false;
    root.classList.remove('is-ui-in', 'is-ui-hidden', 'is-closing', 'is-idle');
    root.classList.add('is-opening');
    el.bg.style.opacity = '0';
    el.stage.style.visibility = 'hidden';
    el.touch.classList.remove('is-show');

    // renderer
    S.mode = 'css';
    if (CFG.webgl && !S.glFailed) {
      const cv = doc.createElement('canvas');
      cv.className = 'vw__gl';
      cv.setAttribute('aria-hidden', 'true');
      el.stage.insertBefore(cv, el.slides);
      const R = createRenderer(cv);
      if (R) {
        S.R = R; S.mode = 'webgl';
        R.onlost = () => { warn('WebGL context lost → CSS parallax'); toCSSMode(); };
      } else {
        cv.parentNode.removeChild(cv);
        S.glFailed = true;
      }
    }
    root.classList.toggle('is-gl', S.mode === 'webgl');
    measure();
    bindRuntime();
    if (COARSE() && gyroSupported() && !gyroNeedsPermission() && G.state === 'idle') requestGyro();
    else if (G.state === 'granted') startGyro();
    updateGyroBtn();

    setCard(entry, 0, false);
    updateChrome(entry);
    announce(entry);
    ambScene(entry.spot.fx);
    ambSfx('whoosh');
    emit('viewer:open', entry);
    focusEl(el.close);

    // source rect is captured *before* awaiting the image so it matches what the user clicked
    let src = opts.from ? describeSource(opts.from) : null;
    if (!src) src = findSource(id, false);
    if (src) {
      el.spin.style.left = (src.clip.left + src.clip.width / 2) + 'px';
      el.spin.style.top = (src.clip.top + src.clip.height / 2) + 'px';
    } else { el.spin.style.left = ''; el.spin.style.top = ''; }
    const lt = setTimeout(() => root.classList.add('is-loading'), 160);
    let img = null;
    try { img = await loadImage(imgUrl(entry.spot)); } catch (e) { img = null; warn(e.message); }
    clearTimeout(lt);
    root.classList.remove('is-loading');
    if (!S.isOpen || S.phase !== 'opening' || token !== S.navToken) return false;

    S.cur = 0; S.mix = 0;
    prepareSlot(0, entry, img);
    startLoop();
    try { render(); } catch (e) { /* first frame best-effort */ }
    el.stage.style.visibility = '';
    el.bg.style.opacity = '';

    const reduced = REDUCED();
    const sl = S.slots[0];
    let main;
    anim(el.bg, [{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 220 : 650, easing: 'ease' });
    if (src && !reduced && img) {
      const f = flipFrom(src, sl.iw, sl.ih);
      anim(el.clip, [{ clipPath: f.clip }, { clipPath: CLIP_FULL }], { duration: 1050, easing: EASE });
      main = anim(el.stage, [{ transform: f.transform }, { transform: TF_ID }], { duration: 1050, easing: EASE });
      anim(el.shade, [{ opacity: 0 }, { opacity: 1 }], { duration: 760, delay: 240, easing: 'ease' });
      // "step into" — depth dolly push while the photo grows
      tween(S, 'dolly', 0.16, 750, E_OUT).then((ok) => { if (ok && S.isOpen && S.phase !== 'closing') tween(S, 'dolly', 0, 1700, E_IO); });
    } else {
      const s0 = reduced ? 1 : 1.06;
      main = anim(el.stage, [
        { opacity: 0, transform: 'translate3d(' + (-(s0 - 1) * S.W / 2) + 'px,' + (-(s0 - 1) * S.H / 2) + 'px,0) scale(' + s0 + ')' },
        { opacity: 1, transform: TF_ID }
      ], { duration: reduced ? 240 : 800, easing: EASE });
      if (!reduced) tween(S, 'dolly', 0.1, 700, E_OUT).then((ok) => { if (ok && S.isOpen && S.phase !== 'closing') tween(S, 'dolly', 0, 1500, E_IO); });
    }
    const uiDelay = reduced ? 0 : (src ? 520 : 300);
    setTimeout(() => {
      if (!S.isOpen || S.phase === 'closing') return;
      root.classList.add('is-ui-in');
      if (COARSE()) { el.touch.classList.add('is-show'); updateTouchHint(); }
      const inner = el.card.querySelector('.vw__card-inner');
      if (inner) reveal(Array.from(inner.children), 80, 0, 18);
    }, uiDelay);

    await done(main);
    if (!S.isOpen || S.phase !== 'opening') return false;
    cancelAnims();                     // CSS defaults == final state
    root.classList.remove('is-opening');
    S.phase = 'open';
    preloadNeighbors();
    if (S.pending) { const p = S.pending; S.pending = null; goIndex(p.t, p.dir); }
    return true;
  }

  function step(delta) {
    if (!S.isOpen || S.phase === 'closing') return;
    const base = S.pending ? S.pending.t : S.idx;
    const t = base + delta;
    if (t < 0 || t >= S.list.length) { bump(delta); return; }
    goIndex(t, delta > 0 ? 1 : -1);
  }
  function bump(dir) {
    if (S.phase !== 'open' || REDUCED()) return;
    const sl = S.slots[S.cur];
    tween(sl, 'sx', -dir * 0.6, 140, E_SOFT).then((ok) => { if (ok) tween(sl, 'sx', 0, 520, E_OUT); });
  }
  function go(id) {
    if (!S.isOpen) return open(id);
    const t = S.list.findIndex((e) => e.spot.id === id);
    if (t < 0 || t === S.idx) return Promise.resolve(false);
    return goIndex(t, t > S.idx ? 1 : -1);
  }
  async function goIndex(t, dir) {
    if (!S.isOpen || S.phase === 'closing') return false;
    if (S.phase === 'opening' || S.phase === 'nav') { S.pending = { t, dir }; return false; }
    if (t === S.idx) return false;
    S.phase = 'nav';
    const token = ++S.navToken;
    S.idx = t;
    const entry = S.list[t];
    const el = S.el;
    ambSfx('whoosh');
    ambScene(entry.spot.fx);
    setCard(entry, dir, true);
    updateChrome(entry);
    announce(entry);
    emit('viewer:change', entry);

    const lt = setTimeout(() => el.root.classList.add('is-loading'), 220);
    let img = null;
    try { img = await loadImage(imgUrl(entry.spot)); } catch (e) { img = null; warn(e.message); }
    clearTimeout(lt);
    el.root.classList.remove('is-loading');
    if (!S.isOpen || token !== S.navToken || S.phase !== 'nav') return false;

    const ni = 1 - S.cur, oi = S.cur;
    const inS = prepareSlot(ni, entry, img), outS = S.slots[oi];
    const reduced = REDUCED();
    if (!reduced) {
      inS.sx = 2.2 * dir; inS.zoom = 1.1; inS.dolly = 0.1;
      tween(inS, 'sx', 0, 1400, E_OUT);
      tween(inS, 'zoom', 1, 1500, E_OUT);
      tween(inS, 'dolly', 0, 1500, E_OUT);
      tween(outS, 'sx', -1.6 * dir, 1000, E_IO);
      tween(outS, 'zoom', 1.05, 1000, E_IO);
      tween(outS, 'dolly', -0.05, 1000, E_IO);
    }
    fadeFx(outS, reduced ? 200 : 520);
    let ok;
    if (S.mode === 'webgl') ok = await tween(S, 'mix', ni === 1 ? 1 : 0, reduced ? 260 : 950, E_IO);
    else { inS.alpha = 0; ok = await tween(inS, 'alpha', 1, reduced ? 260 : 900, E_IO); }
    if (!S.isOpen || token !== S.navToken) return false;
    void ok;
    if (S.mode !== 'webgl') S.mix = ni;
    destroySlot(outS);
    S.cur = ni;
    S.phase = 'open';
    preloadNeighbors();
    if (S.pending) {
      const p = S.pending; S.pending = null;
      if (p.t !== S.idx) goIndex(p.t, p.dir);
    }
    return true;
  }

  function preloadNeighbors() {
    [S.idx - 1, S.idx + 1].forEach((i) => {
      const e = S.list[i];
      if (!e) return;
      const url = imgUrl(e.spot);
      loadImage(url).then((img) => {
        // warm the depth cache during idle time so the dissolve starts instantly
        const run = () => { try { if (S.mode === 'webgl') getDepth(url, img); } catch (err) { /* ignore */ } };
        if (global.requestIdleCallback) global.requestIdleCallback(run, { timeout: 800 }); else setTimeout(run, 60);
      }, () => {});
    });
  }

  async function close() {
    if (!S.isOpen || S.phase === 'closing') return;
    const el = S.el, root = el.root;
    const wasOpening = S.phase === 'opening';
    S.phase = 'closing';
    S.navToken++;
    S.pending = null;
    S.cardToken++;
    root.classList.remove('is-ui-in', 'is-idle');
    root.classList.add('is-closing');
    const entry = S.list[S.idx];
    resumeBgFx();
    if (S.prevScene !== undefined) ambScene(S.prevScene);
    cancelAnims();
    if (!S.raf || wasOpening && !S.slots[S.cur].entry) { teardown(); return; }

    // the slot showing the current spot (if we're mid-dissolve and it has loaded, land on it)
    let ti = S.slots.findIndex((s) => s.entry && entry && s.entry.g === entry.g);
    if (ti < 0) ti = S.cur;
    const sl = S.slots[ti];
    const landEntry = sl.entry || entry;
    S.closeEntry = landEntry;
    S.slots.forEach((s, i) => {
      if (!s.entry) return;
      tween(s, 'sx', 0, 380, E_OUT); tween(s, 'zoom', 1, 380, E_OUT); tween(s, 'dolly', 0, 380, E_OUT);
      if (S.mode !== 'webgl') tween(s, 'alpha', i === ti ? 1 : 0, 300, E_OUT);
      fadeFx(s, 320);
    });
    tween(S, 'dolly', 0, 380, E_OUT);
    if (S.mode === 'webgl') tween(S, 'mix', ti === 1 ? 1 : 0, 300, E_OUT);
    S.breath = 0;

    const reduced = REDUCED();
    const src = landEntry ? findSource(landEntry.spot.id, true) : null;
    let main;
    if (src && !reduced && sl.img) {
      const f = flipFrom(src, sl.iw, sl.ih);
      const ez = 'cubic-bezier(.45,0,.12,1)';
      anim(el.clip, [{ clipPath: CLIP_FULL }, { clipPath: f.clip }], { duration: 760, easing: ez });
      main = anim(el.stage, [{ transform: TF_ID }, { transform: f.transform }], { duration: 760, easing: ez });
      anim(el.shade, [{ opacity: 1 }, { opacity: 0 }], { duration: 500, easing: 'ease' });
      anim(el.bg, [{ opacity: 1 }, { opacity: 0 }], { duration: 640, delay: 120, easing: 'ease' });
    } else {
      const s1 = reduced ? 1 : 0.96;
      main = anim(el.stage, [
        { opacity: 1, transform: TF_ID },
        { opacity: 0, transform: 'translate3d(' + ((1 - s1) * S.W / 2) + 'px,' + ((1 - s1) * S.H / 2) + 'px,0) scale(' + s1 + ')' }
      ], { duration: reduced ? 200 : 460, easing: 'cubic-bezier(.4,0,.2,1)' });
      anim(el.bg, [{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 200 : 460, easing: 'ease' });
    }
    await done(main);
    // let the bg finish if it's still going
    await Promise.all(S.anims.map(done));
    teardown();
  }

  function teardown() {
    const el = S.el;
    const entry = S.closeEntry || S.list[S.idx];
    S.closeEntry = null;
    stopLoop();
    flushTweens();
    unbindRuntime();
    stopGyro();
    S.slots.forEach(destroySlot);
    S.mix = 0; S.cur = 0;
    if (S.R) {
      const R = S.R; S.R = null;
      R.dispose();
      if (R.canvas.parentNode) R.canvas.parentNode.removeChild(R.canvas);
    }
    el.root.hidden = true;
    cancelAnims();
    el.root.classList.remove('is-opening', 'is-closing', 'is-ui-in', 'is-ui-hidden', 'is-loading', 'is-gl', 'is-idle');
    el.card.innerHTML = '';
    el.card.removeAttribute('style');
    el.stage.style.visibility = '';
    el.bg.style.opacity = '';
    S.cursorIdle = false;
    S.drag = null;
    resumeBgFx();
    unlockScroll();
    S.isOpen = false;
    S.phase = 'idle';
    const pf = S.prevFocus;
    S.prevFocus = null;
    if (pf && pf.focus && doc.contains(pf) && pf !== doc.body) focusEl(pf);
    emit('viewer:close', entry);
  }

  /* ------------------------------------------------------------------ *
   * autoBind — click-to-open on card images + floating hint chip
   * ------------------------------------------------------------------ */
  const BINDS = [];
  const HB = { el: null, on: false, x: -999, y: -999, tx: -999, ty: -999, raf: 0, last: null, pend: 0, mo: null, moT: 0, attached: false };
  function spotIdOf(el) {
    const own = el.getAttribute('data-spot-id');
    if (own) return own;
    const p = el.closest('[data-spot-id]');
    return p ? p.getAttribute('data-spot-id') : '';
  }
  const mediaOf = (el) => (el.tagName === 'IMG' ? el : el.querySelector('img'));
  function titleOf(id) {
    const T = CFG.data || global.TRIP;
    if (!T || !Array.isArray(T.days)) return '';
    for (const d of T.days) for (const s of (d.spots || [])) if (s.id === id) return s.title;
    return '';
  }
  function decorate() {
    if (!doc.body) return;
    BINDS.forEach((b) => {
      let nodes = [];
      try { nodes = doc.querySelectorAll(b.sel); } catch (e) { warn('bad selector', b.sel); return; }
      Array.prototype.forEach.call(nodes, (el) => {
        if (S.el && S.el.root.contains(el)) return;
        if (el.hasAttribute('data-viewer-ignore')) return;
        const img = mediaOf(el);
        const id = spotIdOf(el);
        if (!img || !id || img.__vwBound) return;
        img.__vwBound = true;
        img.classList.add('vw-zoomable');
        if (b.keyboard && !img.hasAttribute('tabindex')) {
          img.tabIndex = 0;
          img.setAttribute('role', 'button');
          img.setAttribute('aria-haspopup', 'dialog');
          const t = titleOf(id) || img.alt || '';
          img.setAttribute('aria-label', '走進風景' + (t ? '：' + t : ''));
        }
      });
    });
  }
  function hitTest(target, x, y, keyboard) {
    if (!target || !target.closest) return null;
    if (S.el && S.el.root.contains(target)) return null;
    for (const b of BINDS) {
      let el = null;
      try { el = target.closest(b.sel); } catch (e) { el = null; }
      if (!el || el.hasAttribute('data-viewer-ignore')) continue;
      const img = mediaOf(el), id = spotIdOf(el);
      if (!img || !id) continue;
      if (target === img) return { id, img, el, bind: b };
      const inter = target.closest('a,button,input,select,textarea,label,summary,[contenteditable],[data-viewer-ignore]');
      if (inter && inter !== el && el.contains(inter)) return null;
      if (keyboard) continue;
      const v = visibleRect(img).clip;
      if (x >= v.left && x <= v.right && y >= v.top && y <= v.bottom) return { id, img, el, bind: b };
    }
    return null;
  }
  function onDocClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (S.isOpen) return;
    const hit = hitTest(e.target, e.clientX, e.clientY, e.detail === 0 && !e.clientX && !e.clientY);
    if (!hit) return;
    e.preventDefault();
    hideHint(true);
    open(hit.id, { from: hit.img });
  }
  function onDocKey(e) {
    if (S.isOpen || (e.key !== 'Enter' && e.key !== ' ')) return;
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('vw-zoomable')) return;
    const hit = hitTest(t, 0, 0, true);
    if (!hit) return;
    e.preventDefault();
    open(hit.id, { from: hit.img });
  }
  function ensureHint() {
    if (HB.el) return HB.el;
    const h = doc.createElement('div');
    h.className = 'vw-hint';
    h.setAttribute('aria-hidden', 'true');
    h.innerHTML = '<span><i></i><b style="font-weight:600"></b></span>';
    (doc.body || doc.documentElement).appendChild(h);
    HB.el = h;
    return h;
  }
  function showHint(label, x, y) {
    const h = ensureHint();
    const b = h.querySelector('b');
    if (b.textContent !== label) b.textContent = label;
    HB.tx = x + 16; HB.ty = y + 18;
    if (!HB.on) { HB.on = true; HB.x = HB.tx; HB.y = HB.ty; h.classList.add('is-on'); }
    if (!HB.raf) HB.raf = global.requestAnimationFrame(hintLoop);
  }
  function hideHint(now_) {
    if (!HB.el || !HB.on) return;
    HB.on = false;
    HB.el.classList.remove('is-on');
    if (now_) { HB.el.style.transform = 'translate3d(-999px,-999px,0)'; }
  }
  function hintLoop() {
    HB.raf = 0;
    if (!HB.el) return;
    HB.x += (HB.tx - HB.x) * 0.28;
    HB.y += (HB.ty - HB.y) * 0.28;
    // keep inside the viewport
    const w = HB.el.firstChild.offsetWidth || 140;
    const x = Math.min(HB.x, global.innerWidth - w - 8), y = Math.min(HB.y, global.innerHeight - 42);
    HB.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
    if (HB.on || Math.abs(HB.tx - HB.x) > 0.3) HB.raf = global.requestAnimationFrame(hintLoop);
  }
  function onDocPointerMove(e) {
    if (e.pointerType !== 'mouse') return;
    HB.last = e;
    if (HB.pend) return;
    HB.pend = global.requestAnimationFrame(() => {
      HB.pend = 0;
      const ev = HB.last;
      if (!ev || S.isOpen) { hideHint(); return; }
      const hit = hitTest(ev.target, ev.clientX, ev.clientY, false);
      if (hit && hit.bind.hint) showHint(hit.bind.label, ev.clientX, ev.clientY);
      else hideHint();
    });
  }
  function attachDocListeners() {
    if (HB.attached) return;
    HB.attached = true;
    doc.addEventListener('click', onDocClick);
    doc.addEventListener('keydown', onDocKey);
    doc.addEventListener('pointermove', onDocPointerMove, { passive: true });
    doc.documentElement.addEventListener('mouseleave', () => hideHint(), { passive: true });
    global.addEventListener('scroll', () => hideHint(), { passive: true, capture: true });
    global.addEventListener('blur', () => hideHint());
    const startMO = () => {
      decorate();
      if (!('MutationObserver' in global) || HB.mo) return;
      HB.mo = new global.MutationObserver(() => {
        if (HB.moT) return;
        HB.moT = setTimeout(() => { HB.moT = 0; decorate(); }, 120);
      });
      HB.mo.observe(doc.body, { childList: true, subtree: true });
    };
    if (doc.body) startMO(); else doc.addEventListener('DOMContentLoaded', startMO, { once: true });
  }
  function detachDocListeners() {
    if (!HB.attached) return;
    HB.attached = false;
    doc.removeEventListener('click', onDocClick);
    doc.removeEventListener('keydown', onDocKey);
    doc.removeEventListener('pointermove', onDocPointerMove);
    if (HB.mo) { HB.mo.disconnect(); HB.mo = null; }
    hideHint(true);
  }
  function autoBind(selector, options) {
    injectCSS();
    options = options || {};
    const b = {
      sel: selector || '[data-spot-id]',
      hint: options.hint !== false,
      keyboard: options.keyboard !== false,
      label: options.label || '點擊走進風景'
    };
    BINDS.push(b);
    attachDocListeners();
    if (doc.body) decorate();
    return {
      refresh: decorate,
      unbind() {
        const i = BINDS.indexOf(b);
        if (i >= 0) BINDS.splice(i, 1);
        if (!BINDS.length) detachDocListeners();
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */
  global.Viewer = {
    __viewer: 1,
    version: '1.0.0',
    open,
    close,
    next() { step(1); },
    prev() { step(-1); },
    go,
    autoBind,
    isOpen: () => S.isOpen,
    current: () => (S.isOpen && S.list[S.idx] ? S.list[S.idx].spot.id : null),
    configure(o) { if (o && typeof o === 'object') Object.keys(o).forEach((k) => { if (k in CFG) CFG[k] = o[k]; }); return Object.assign({}, CFG); },
    debugDepth(onOff) { S.debug = onOff == null ? !S.debug : !!onOff; return S.debug; },
    requestMotion: requestGyro,
    get mode() { return S.isOpen ? S.mode : (CFG.webgl && !S.glFailed ? 'webgl' : 'css'); },
    get stats() {
      return { open: S.isOpen, phase: S.phase, mode: S.mode, fps: S.perf.fps, renderScale: S.perf.scale,
        canvas: S.R ? [S.R.canvas.width, S.R.canvas.height] : null, gyro: G.state + (G.on ? ' (on)' : '') };
    }
  };
})(typeof window !== 'undefined' ? window : this);
