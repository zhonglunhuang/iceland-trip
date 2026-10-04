/*!
 * fx.js — 圖片模擬的小動圖（讓靜態照片「活起來」的 Canvas 2D 疊加特效）
 * 冰島任務 · Iceland road trip
 *
 * Classic script（非 module），定義 window.FX：
 *
 *   const inst = FX.mount(containerEl, type, { accent: '#7fd6e8' })
 *     containerEl：position:relative 的容器，裡面已經有一張 object-fit:cover 的 <img>
 *     type       ：waterfall | geyser | aurora | steam | waves | drift | ice | snow |
 *                  mist | ripple | city | sunset | drive | flight | wind
 *                  （未知類型自動退回 'mist'）
 *     options    ：accent    主題色（低調地混進特效顏色）
 *                  intensity 強度倍率，預設 1（0 ~ 1.6）
 *                  id        景點 id（預設取 <img> 檔名，用來查 FX.hints 的構圖提示）
 *                  hint      直接給構圖提示（座標皆為「原圖」比例 0~1，自動換算 object-fit:cover 裁切）
 *   inst.setActive(bool)   手動暫停 / 恢復（離開畫面時 FX 本身也會自動暫停）
 *   inst.destroy()
 *
 *   FX.types               → 所有類型陣列
 *   FX.kenBurns(imgEl)     → 緩慢推拉鏡頭（CSS class 'fx-kenburns'），回傳 { destroy() }
 *   FX.hints               → 每個景點的構圖提示表（瀑布位置、間歇泉噴口…），可自行增修
 *   FX.pauseAll() / FX.resumeAll()   全域暫停（例如打開 3D 世界時）
 *   FX.stats               → { ms, active } 每幀所有卡片合計耗時（毫秒，平滑值）與執行中數量
 *
 * 設計原則：低透明度、柔和、不卡通；共用單一 requestAnimationFrame；
 * 離開畫面（IntersectionObserver）就停；ResizeObserver 自動重排；devicePixelRatio 上限 2；
 * 柔焦類特效以半解析度繪製；尊重 prefers-reduced-motion（只畫一張靜態畫面）。
 */
(function (global) {
  'use strict';

  var doc = global.document;
  if (!doc || (global.FX && global.FX.__fx)) return;

  /* ------------------------------------------------------------------ *
   * Constants & tiny math helpers
   * ------------------------------------------------------------------ */
  const TYPES = ['waterfall', 'geyser', 'aurora', 'steam', 'waves', 'drift', 'ice', 'snow',
    'mist', 'ripple', 'city', 'sunset', 'drive', 'flight', 'wind'];
  const TAU = Math.PI * 2;
  const MAX_PX = 2.2e6;            // hard cap on canvas backing-store pixels per card
  const WHITE = [255, 255, 255];
  const ICE = [127, 227, 255];     // #7fe3ff
  const GREEN = [107, 255, 184];   // #6bffb8
  const VIOLET = [179, 140, 255];  // #b38cff
  const WARM = [255, 196, 128];

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const bell = (p) => (p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p));
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; // ~[-1,1], centred
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const lerp = (a, b, t) => a + (b - a) * t;

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function parseColor(c) {
    if (Array.isArray(c) && c.length >= 3) return [c[0], c[1], c[2]];
    if (typeof c !== 'string') return ICE.slice();
    c = c.trim();
    let m = /^#([0-9a-f]{3})$/i.exec(c);
    if (m) { const h = m[1]; return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]; }
    m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
    if (m) return [+m[1], +m[2], +m[3]];
    return ICE.slice();
  }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgba = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';

  /* ------------------------------------------------------------------ *
   * CSS (injected once; no stylesheet dependency)
   * ------------------------------------------------------------------ */
  const CSS = [
    '.fx-canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none;',
    'mix-blend-mode:screen;opacity:0;transition:opacity 1.4s cubic-bezier(.2,.8,.2,1);transform-origin:50% 50%;}',
    '.fx-canvas.fx-on{opacity:1}',
    '.fx-canvas[data-blend="normal"]{mix-blend-mode:normal}',
    '@keyframes fx-kb-0{0%{transform:scale(1.06) translate3d(-1.2%,.8%,0)}100%{transform:scale(1.15) translate3d(1.5%,-1.1%,0)}}',
    '@keyframes fx-kb-1{0%{transform:scale(1.14) translate3d(1.4%,1%,0)}100%{transform:scale(1.05) translate3d(-1.3%,-.6%,0)}}',
    '@keyframes fx-kb-2{0%{transform:scale(1.07) translate3d(1.2%,-1%,0)}100%{transform:scale(1.16) translate3d(-1.4%,1.2%,0)}}',
    '@keyframes fx-kb-3{0%{transform:scale(1.15) translate3d(-1.5%,-1.2%,0)}100%{transform:scale(1.06) translate3d(1%,1%,0)}}',
    '.fx-kenburns{animation:fx-kb-0 26s cubic-bezier(.45,.05,.55,.95) infinite alternate;transform-origin:50% 50%;backface-visibility:hidden}',
    '.fx-kenburns.fx-kb-v1{animation-name:fx-kb-1}',
    '.fx-kenburns.fx-kb-v2{animation-name:fx-kb-2}',
    '.fx-kenburns.fx-kb-v3{animation-name:fx-kb-3}',
    '.fx-kenburns.fx-kb-paused{animation-play-state:paused}',
    '@media (prefers-reduced-motion:reduce){.fx-kenburns{animation:none!important}.fx-canvas{transition:none}}'
  ].join('\n');

  function injectCSS() {
    if (doc.getElementById('fx-js-style')) return;
    const st = doc.createElement('style');
    st.id = 'fx-js-style';
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  /* ------------------------------------------------------------------ *
   * Shared pre-rendered sprites (built once, tinted & cached by colour)
   * ------------------------------------------------------------------ */
  const SPR = new Map();
  function mkCanvas(w, h) { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; }
  function spr(key, w, h, fn) {
    let s = SPR.get(key);
    if (!s) { s = mkCanvas(w, h); fn(s.getContext('2d'), w, h); SPR.set(key, s); }
    return s;
  }
  const ck = (c) => (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0);
  function radial(g, x, y, r, stops, c) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    for (let i = 0; i < stops.length; i += 2) gr.addColorStop(stops[i], rgba(c, stops[i + 1]));
    return gr;
  }
  // soft round dot (particles, droplets, lights)
  const sDot = (c) => spr('dot' + ck(c), 64, 64, (g) => {
    g.fillStyle = radial(g, 32, 32, 32, [0, 1, .18, .85, .42, .28, .7, .06, 1, 0], c); g.fillRect(0, 0, 64, 64);
  });
  // very soft glow (sheens, light pools)
  const sGlow = (c) => spr('glow' + ck(c), 128, 128, (g) => {
    g.fillStyle = radial(g, 64, 64, 64, [0, 1, .25, .55, .55, .18, .8, .04, 1, 0], c); g.fillRect(0, 0, 128, 128);
  });
  // 4-point star glint
  const sStar = (c) => spr('star' + ck(c), 64, 64, (g) => {
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = radial(g, 32, 32, 10, [0, 1, .35, .55, 1, 0], c); g.fillRect(0, 0, 64, 64);
    let lg = g.createLinearGradient(0, 0, 64, 0);
    lg.addColorStop(0, rgba(c, 0)); lg.addColorStop(.5, rgba(c, .95)); lg.addColorStop(1, rgba(c, 0));
    g.fillStyle = lg; g.fillRect(0, 31.2, 64, 1.6);
    lg = g.createLinearGradient(0, 0, 0, 64);
    lg.addColorStop(0, rgba(c, 0)); lg.addColorStop(.5, rgba(c, .95)); lg.addColorStop(1, rgba(c, 0));
    g.fillStyle = lg; g.fillRect(31.2, 0, 1.6, 64);
  });
  // horizontal elongated glint (water sparkle)
  const sHGlint = (c) => spr('hg' + ck(c), 64, 16, (g) => {
    g.setTransform(1, 0, 0, .25, 0, 0);
    g.fillStyle = radial(g, 32, 32, 32, [0, 1, .3, .5, .7, .08, 1, 0], c); g.fillRect(0, 0, 64, 64);
  });
  // organic cloud / fog puff, 3 variants
  const sCloud = (c, v) => spr('cl' + (v | 0) + ck(c), 256, 256, (g) => {
    const rnd = mulberry(977 * ((v | 0) + 1) + 13);
    for (let i = 0; i < 20; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * 64;
      const x = 128 + Math.cos(a) * d * 1.3, y = 128 + Math.sin(a) * d * .7, r = 30 + rnd() * 46;
      g.fillStyle = radial(g, x, y, r, [0, .2, .55, .08, 1, 0], c); g.fillRect(0, 0, 256, 256);
    }
    g.globalCompositeOperation = 'destination-in';
    const m = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(.55, 'rgba(0,0,0,.8)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m; g.fillRect(0, 0, 256, 256);
  });
  // soft vertical water streak: transparent tail (top) → bright head (bottom), feathered sides
  const sVStreak = (c) => spr('vs' + ck(c), 16, 128, (g) => {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    lg.addColorStop(0, rgba(c, 0)); lg.addColorStop(.5, rgba(c, .45)); lg.addColorStop(.88, rgba(c, 1)); lg.addColorStop(1, rgba(c, 0));
    g.fillStyle = lg; g.fillRect(0, 0, 16, 128);
    g.globalCompositeOperation = 'destination-in';
    const hg = g.createLinearGradient(0, 0, 16, 0);
    hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(.5, 'rgba(0,0,0,1)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hg; g.fillRect(0, 0, 16, 128);
  });
  // bokeh disc with a slightly brighter rim
  const sBokeh = (c) => spr('bk' + ck(c), 96, 96, (g) => {
    g.fillStyle = radial(g, 48, 48, 46, [0, .32, .7, .4, .86, .75, .93, .3, 1, 0], c); g.fillRect(0, 0, 96, 96);
  });
  // aurora curtain strip (top transparent → violet → green → bright lower edge)
  const sStrip = (c1, c2) => spr('st' + ck(c1) + '|' + ck(c2), 4, 256, (g) => {
    const lg = g.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0, rgba(c2, 0));
    lg.addColorStop(.28, rgba(c2, .13));
    lg.addColorStop(.55, rgba(mix(c2, c1, .5), .32));
    lg.addColorStop(.8, rgba(c1, .72));
    lg.addColorStop(.9, rgba(mix(c1, WHITE, .35), 1));
    lg.addColorStop(.95, rgba(c1, .4));
    lg.addColorStop(1, rgba(c1, 0));
    g.fillStyle = lg; g.fillRect(0, 0, 4, 256);
  });
  // big warm light leak
  const sLeak = (c1, c2) => spr('lk' + ck(c1) + '|' + ck(c2), 256, 256, (g) => {
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, rgba(mix(c1, WHITE, .3), .95)); gr.addColorStop(.18, rgba(c1, .55));
    gr.addColorStop(.45, rgba(c2, .2)); gr.addColorStop(.75, rgba(c2, .05)); gr.addColorStop(1, rgba(c2, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  });

  /* ------------------------------------------------------------------ *
   * Per-photo composition hints (image-fraction coordinates 0..1 of the ORIGINAL photo;
   * automatically mapped through object-fit:cover). Edit freely.
   *   falls: waterfall curtains [{x: centre, w: width, y0: lip, y1: base}]
   *   src:   geyser vent {x, y, h: jet height, r: pool radius (fraction of width)}
   *   area:  region for waves / ripple / steam / drift / city {x0,y0,x1,y1}
   *   vp:    vanishing point for drive {x,y};  road:false hides road dashes
   *   sun:   light source for sunset {x,y};  lane: road centre-line offset (fraction of width)
   *   ar/fp: aspect ratio + 4x4 luminance fingerprint of the photo the hint was calibrated on —
   *          if the photo is swapped for a different one, the hint is ignored automatically.
   * ------------------------------------------------------------------ */
  const HINTS = {
    bruarfoss: { ar: 1.476, fp: '8998344424634784', falls: [{ x: .44, w: .40, y0: .30, y1: .97 }] },
    gullfoss: { ar: 1.501, fp: '778934977aa55554', falls: [{ x: .585, w: .13, y0: .42, y1: .9 }, { x: .47, w: .18, y0: .38, y1: .5 }] },
    seljalandsfoss: { ar: 1.608, fp: '2acc776778767777', falls: [{ x: .49, w: .06, y0: .33, y1: .57 }, { x: .3, w: .022, y0: .05, y1: .36 }] },
    gljufrabui: { ar: 1.508, fp: '9a88566577776776', falls: [{ x: .325, w: .05, y0: .14, y1: .48 }] },
    skogafoss: { ar: 1.871, fp: 'deda989646754675', falls: [{ x: .745, w: .16, xb: .72, wb: .12, y0: .4, y1: .89 }] },
    svartifoss: { ar: 1.391, fp: '38cb647377767886', falls: [{ x: .627, w: .045, y0: .31, y1: .74 }] },
    dettifoss: { ar: 1.5, fp: '9887a9987ba79987', falls: [{ x: .6, w: .72, y0: .28, y1: .82 }] },
    godafoss: { ar: 1.498, fp: '8ccc39cd17ac3455', falls: [{ x: .32, w: .2, y0: .31, y1: .65 }, { x: .8, w: .34, y0: .42, y1: .63 }] },
    hraunfossar: { ar: 1.509, fp: 'abde666657868983', falls: [{ x: .44, w: .17, y0: .5, y1: .62 }, { x: .67, w: .2, y0: .5, y1: .6 }, { x: .12, w: .14, y0: .7, y1: .79 }] },
    gufufoss: { ar: 1.333, fp: 'adec447568757655', falls: [{ x: .5, w: .1, y0: .23, y1: .5 }], vp: { x: .5, y: .45 }, road: false },
    geysir: { ar: 1.498, fp: 'edcc78aa99987888', src: { x: .51, y: .555, h: .5, r: .085 } },
    'blue-lagoon': { ar: 1.498, fp: 'cccca966aba9eeed', area: { x0: 0, y0: .55, x1: 1, y1: 1 } },
    'sky-lagoon': { ar: 1.5, fp: 'ea89a533a86999a9', area: { x0: 0, y0: .6, x1: 1, y1: 1 } },
    hverir: { ar: 1.5, fp: 'dbaaabba8abc789b', area: { x0: 0, y0: .5, x1: 1, y1: .82 } },
    grjotagja: { ar: 1.501, fp: '1145248755782359', area: { x0: 0, y0: .62, x1: 1, y1: 1 } },
    'hotel-aldan': { ar: 2.481, fp: 'ade9377423543334', area: { x0: .4, y0: .5, x1: 1, y1: 1 } },
    'diamond-beach': { ar: 1.501, fp: '8975555211000000', area: { x0: 0, y0: .04, x1: 1, y1: .42 } },
    hvitserkur: { ar: 1.498, fp: 'cbddb77c85697766', area: { x0: 0, y0: .5, x1: 1, y1: .8 } },
    'ytri-tunga': { ar: 1.504, fp: 'ddedbccc668899aa', area: { x0: 0, y0: .34, x1: 1, y1: .6 } },
    reynisfjara: { ar: 1.833, fp: 'ceee9a9977877765', area: { x0: .3, y0: .26, x1: 1, y1: .48 } },
    londrangar: { ar: 2.003, fp: 'cccc9aaa99a9aab8', area: { x0: 0, y0: .3, x1: 1, y1: .44 } },
    kerid: { ar: 1.598, fp: 'dbadb988b9777897', area: { x0: .35, y0: .25, x1: .73, y1: .5 } },
    viti: { ar: 1.333, fp: 'abb8455544543333', area: { x0: .42, y0: .52, x1: .8, y1: .78 } },
    studlagil: { ar: 1.461, fp: '8a84546544544454', area: { x0: .3, y0: .3, x1: .6, y1: 1 } },
    giethoorn: { ar: 2.0, fp: '87666655969964cd', area: { x0: 0, y0: .62, x1: 1, y1: 1 } },
    jokulsarlon: { ar: 1.5, fp: 'cccceedbba896665', area: { x0: 0, y0: .5, x1: 1, y1: 1 } },
    fjallsarlon: { ar: 1.498, fp: '99877643aa988998', area: { x0: 0, y0: .45, x1: 1, y1: 1 } },
    hallgrimskirkja: { ar: 1.498, fp: 'eddcaa9a77776756', area: { x0: 0, y0: .52, x1: 1, y1: 1 } },
    akureyri: { ar: 2.0, fp: 'cccc8a8777988973', area: { x0: 0, y0: .5, x1: 1, y1: 1 } },
    kolaportid: { ar: 1.581, fp: '9aaa8a8b65446532', area: { x0: 0, y0: .4, x1: 1, y1: .75 } },
    keflavik: { ar: 1.786, fp: 'caab9a9a77778568', vp: { x: .42, y: .585 }, lane: -.32 },
  };

  /* ------------------------------------------------------------------ *
   * Effects. Each: { res, blend, prewarm, setup(I), update(I,dt,t), draw(I,ctx,t) }
   * All coordinates in CSS pixels of the container. I.w/I.h = size, I.sc = size scale,
   * I.acc = accent rgb, I.amp = intensity, I.X(u)/I.Y(v) map original-photo fractions.
   * ------------------------------------------------------------------ */
  const FXS = {};

  /* ---------- waterfall ---------- */
  function wfStreak(s, init) {
    const r = Math.random() * 2 - 1;
    s.u = Math.sign(r) * Math.pow(Math.abs(r), 1.15) * .96;
    s.v = init ? Math.random() * 1.05 : -rand(0, .25);
    s.sp = rand(.3, .55);
    s.a = rand(.25, 1);
    s.th = Math.random() < .22;
    s.ph = rand(0, TAU);
    return s;
  }
  function wfPuff(I, b, p, init) {
    p.x = b.cx + gauss() * b.bw * .75;
    p.y = b.y1 - rand(0, .12) * b.bh;
    p.vx = gauss() * Math.max(b.bw, 30) * .22;
    p.vy = -rand(.02, .06) * I.h;
    p.s0 = clamp(b.bw * rand(.6, 1.1), 26 * I.sc, I.w * .5);
    p.life = rand(3, 6);
    p.age = init ? rand(0, p.life) : 0;
    p.a = rand(.09, .17);
    p.v = (Math.random() * 3) | 0;
    return p;
  }
  function wfDrop(I, b, d, init) {
    d.x = b.cx + gauss() * b.bw * .45;
    d.y = b.y1 - rand(0, .04) * b.bh;
    d.vx = gauss() * Math.max(b.bw, 20) * .9;
    d.vy = -rand(.12, .32) * I.h;
    d.life = rand(.5, 1.1);
    d.age = init ? rand(0, d.life) : 0;
    d.s = rand(.8, 1.7) * I.sc;
    return d;
  }
  FXS.waterfall = {
    res: 1,
    setup(I) {
      const falls = (I.hint.falls && I.hint.falls.length) ? I.hint.falls : [{ x: .5, w: .2, y0: .12, y1: .86 }];
      I.s.col = mix(WHITE, I.acc, .12);
      I.s.vs = sVStreak(I.s.col);
      I.s.dot = sDot(mix(WHITE, I.acc, .2));
      I.s.glow = sGlow(I.s.col);
      I.s.clouds = [0, 1, 2].map((v) => sCloud(mix(WHITE, I.acc, .08), v));
      I.s.bands = falls.map((f) => {
        const cx = I.X(f.x), bw = Math.max(4, f.w * I.mw), y0 = I.Y(f.y0), y1 = I.Y(f.y1);
        const cxb = f.xb == null ? cx : I.X(f.xb), bwb = f.wb == null ? bw : Math.max(4, f.wb * I.mw);
        const bh = Math.max(12, y1 - y0);
        const n = Math.round(clamp((bw + bwb) * .5 * bh / 240, 12, 150));
        const b = { cx, bw, cxb, bwb, y0, y1: y0 + bh, bh, streaks: [], puffs: [], drops: [], sheen: [],
          sw: clamp(bw / 22, 2, 7) * clamp(I.sc, .8, 1.4) };
        b.cx = cxb; b.bw = bwb; // mist & spray live at the base
        b.cxt = cx; b.bwt = bw;
        for (let i = 0; i < n; i++) b.streaks.push(wfStreak({}, true));
        const np = Math.round(clamp(bw / 16, 4, 14));
        for (let i = 0; i < np; i++) b.puffs.push(wfPuff(I, b, {}, true));
        const nd = Math.round(clamp(bw / 7, 5, 26));
        for (let i = 0; i < nd; i++) b.drops.push(wfDrop(I, b, {}, true));
        for (let i = 0; i < 3; i++) b.sheen.push({ u: rand(-.6, .6), v: Math.random(), sp: rand(.25, .4) });
        return b;
      });
    },
    update(I, dt) {
      const H = I.h;
      for (const b of I.s.bands) {
        for (const s of b.streaks) {
          s.v += s.sp * H * (1 + Math.max(0, s.v) * 1.1) * dt / b.bh;
          if (s.v > 1.08) wfStreak(s, false);
        }
        for (const p of b.puffs) {
          p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= (1 - .4 * dt);
          if (p.age > p.life) wfPuff(I, b, p, false);
        }
        for (const d of b.drops) {
          d.age += dt; d.vy += H * .9 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
          if (d.age > d.life) wfDrop(I, b, d, false);
        }
        for (const s of b.sheen) { s.v += s.sp * dt * (H / b.bh) * .5; if (s.v > 1.3) { s.v = -.3; s.u = rand(-.6, .6); } }
      }
    },
    draw(I, c, t) {
      const S = I.s, A = I.amp, H = I.h;
      for (const b of S.bands) {
        // 1) falling water: soft tapered streaks (additive), following the curtain's taper
        c.globalCompositeOperation = 'lighter';
        for (const s of b.streaks) {
          const f = s.a * smooth(0, .1, s.v) * (1 - smooth(.8, 1.03, s.v));
          if (f < .03) continue;
          const v = clamp(s.v, 0, 1);
          const x = lerp(b.cxt, b.cxb, v) + s.u * lerp(b.bwt, b.bwb, v) * .5 + Math.sin(t * 2.1 + s.ph) * .3;
          const y = b.y0 + s.v * b.bh;
          const L = Math.min(b.bh * .55, s.sp * H * (1 + s.v * 1.1) * .26);
          const top = Math.max(b.y0 - 2, y - L), w = b.sw * (s.th ? 1.9 : 1);
          c.globalAlpha = f * (s.th ? .2 : .3) * A;
          c.drawImage(S.vs, x - w / 2, top, w, y - top);
        }
        // 2) broad sheen pulses travelling down the curtain
        for (const s of b.sheen) {
          const v = clamp(s.v, 0, 1), bwv = lerp(b.bwt, b.bwb, v);
          const w = Math.max(10, bwv * .55), h = b.bh * .38;
          c.globalAlpha = .07 * A * bell(clamp((s.v + .3) / 1.6, 0, 1));
          c.drawImage(S.glow, lerp(b.cxt, b.cxb, v) + s.u * bwv * .4 - w / 2, b.y0 + s.v * b.bh - h / 2, w, h);
        }
        // 3) spray droplets bouncing off the plunge pool
        for (const d of b.drops) {
          const p = d.age / d.life, a = .45 * A * (1 - p) * smooth(0, .08, p);
          if (a < .02) continue;
          c.globalAlpha = a;
          c.drawImage(S.dot, d.x - d.s * 2, d.y - d.s * 2, d.s * 4, d.s * 4);
        }
        c.globalCompositeOperation = 'source-over';
        // 4) rising mist at the base
        for (const p of b.puffs) {
          const q = p.age / p.life, a = p.a * A * smooth(0, .2, q) * (1 - smooth(.5, 1, q));
          if (a < .005) continue;
          const s = p.s0 * (1 + q * 1.3);
          c.globalAlpha = a;
          c.drawImage(S.clouds[p.v], p.x - s / 2, p.y - s * .45, s, s * .75);
        }
      }
    }
  };

  /* ---------- geyser (Strokkur-like ~6.4 s cycle) ---------- */
  function gyPuff(S, p, x, y, s0, vx, vy, life, a) {
    p.alive = true; p.x = x; p.y = y; p.s0 = s0; p.vx = vx; p.vy = vy; p.life = life; p.age = 0; p.a = a; p.v = (Math.random() * 3) | 0;
  }
  function gyNextPuff(S) { S.pi = (S.pi + 1) % S.puffs.length; return S.puffs[S.pi]; }
  FXS.geyser = {
    res: 1,
    blend: 'normal',   // the jet must read as opaque white water even against a bright sky
    prewarm: 0,
    setup(I) {
      const S = I.s, src = I.hint.src || { x: .5, y: .64, h: .5, r: .07 };
      S.sx = I.X(src.x); S.sy = I.Y(src.y);
      S.pr = Math.max(8, (src.r || .07) * I.mw);
      S.jh = Math.max(30, Math.min((src.h || .5) * I.mh, S.sy * .92));
      S.rise = .95; S.g = 2 * S.jh / (S.rise * S.rise); S.v0 = S.g * S.rise;
      const cap = Math.round(clamp(I.w * I.h / 800, 110, 340));
      S.P = []; for (let i = 0; i < cap; i++) S.P.push({ alive: false });
      S.segs = [0, 1, 2, 3].map(() => new Float32Array(cap * 4)); S.cnt = new Int32Array(4);
      S.pk = 0;
      S.puffs = []; for (let i = 0; i < 34; i++) S.puffs.push({ alive: false });
      S.pi = 0;
      S.T = 6.4; S.B = 3.0; S.ph = rand(0, S.T); S.acc = 0; S.idle = 0; S.flash = 0;
      S.sz = clamp(I.h / 380, .6, 1.8);
      S.wind = I.w * .03;
      S.col = mix(WHITE, I.acc, .1);
      S.dot = sDot(S.col);
      S.vap = sGlow(mix(WHITE, I.acc, .05));
      S.glow = sGlow(mix(WHITE, I.acc, .35));
      S.clouds = [0, 1, 2].map((v) => sCloud(mix(WHITE, I.acc, .06), v));
      S.domeHi = rgba(WHITE, 1);
      // jump into the middle of a cycle so the first view is never empty
      for (let k = 0; k < 75; k++) FXS.geyser.update(I, 1 / 30);
    },
    update(I, dt) {
      const S = I.s, prev = S.ph;
      S.ph += dt; if (S.ph >= S.T) S.ph -= S.T;
      const ph = S.ph;
      if (prev < S.B && ph >= S.B) S.flash = 1;
      S.flash = Math.max(0, S.flash - dt * 2.5);
      // eruption: emit jet particles for 0.75 s, strongest at the start
      if (ph >= S.B && ph < S.B + .75) {
        const e = 1.7 - (ph - S.B) / .75 * 1.4;
        S.acc += S.P.length * .85 / .75 * e * dt;
        while (S.acc >= 1) {
          S.acc -= 1;
          S.pk = (S.pk + 1) % S.P.length;
          const p = S.P[S.pk], vap = Math.random() < .42;
          p.alive = true; p.age = 0; p.k = vap ? 1 : 0; p.apex = false;
          p.x = S.sx + gauss() * S.pr * .16; p.y = S.sy - 1;
          p.vy = -S.v0 * (.42 + .58 * Math.sqrt(Math.random())) * (vap ? .92 : 1);
          p.vx = gauss() * S.v0 * (vap ? .09 : .12);
          p.life = vap ? rand(1.6, 2.6) : rand(1.5, 2.3);
          p.s = vap ? S.pr * rand(.2, .42) : rand(1.3, 3) * S.sz;
          p.a = vap ? rand(.18, .32) : rand(.45, .9);
        }
      } else S.acc = 0;
      // idle vapour from the pool
      S.idle += dt;
      if (S.idle > .32) {
        S.idle = 0;
        gyPuff(S, gyNextPuff(S), S.sx + gauss() * S.pr * .8, S.sy - S.pr * .1, S.pr * rand(.9, 1.6),
          S.wind * .5, -rand(.04, .08) * I.h, rand(3, 5), rand(.09, .16));
      }
      for (const p of S.P) {
        if (!p.alive) continue;
        p.age += dt;
        if (p.k) { p.vy += S.g * .55 * dt; p.vy *= (1 - 1.1 * dt); p.vx += S.wind * dt; p.s += S.pr * .7 * dt; }
        else { p.vy += S.g * dt; p.vx *= (1 - .3 * dt); }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (!p.apex && p.vy > 0) {
          p.apex = true;
          if (p.k && Math.random() < .3) {
            gyPuff(S, gyNextPuff(S), p.x, p.y, S.pr * rand(1.5, 2.8), S.wind * rand(.6, 1.2), -rand(.01, .03) * I.h, rand(3.5, 5.5), rand(.16, .26));
          }
        }
        if (p.age > p.life || (p.vy > 0 && p.y > S.sy + S.pr * .12)) p.alive = false;
      }
      for (const p of S.puffs) {
        if (!p.alive) continue;
        p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.age > p.life) p.alive = false;
      }
    },
    draw(I, c, t) {
      const S = I.s, A = I.amp, ph = S.ph, sx = S.sx, sy = S.sy, pr = S.pr;
      // pool surface rings — quicken before an eruption
      const surge = smooth(1.2, S.B, ph) * (ph < S.B ? 1 : 0);
      c.strokeStyle = S.domeHi; c.lineWidth = Math.max(.6, .8 * S.sz);
      for (let k = 0; k < 2; k++) {
        const q = ((t * (.7 + surge * 1.6)) + k * .5) % 1;
        c.globalAlpha = (.1 + .1 * surge) * (1 - q) * A;
        c.beginPath(); c.ellipse(sx, sy, pr * (.25 + q * .9), pr * (.25 + q * .9) * .26, 0, 0, TAU); c.stroke();
      }
      // vapour puffs (behind the jet)
      for (const p of S.puffs) {
        if (!p.alive) continue;
        const q = p.age / p.life, a = p.a * A * smooth(0, .15, q) * (1 - smooth(.45, 1, q));
        if (a < .004) continue;
        const s = p.s0 * (1 + q * 1.5);
        c.globalAlpha = a; c.drawImage(S.clouds[p.v], p.x - s / 2, p.y - s * .5, s, s * .8);
      }
      // the turquoise bubble dome swelling just before the burst
      if (ph > S.B - .9 && ph < S.B + .16) {
        const q = ph < S.B ? smooth(S.B - .9, S.B, ph) : 1 - smooth(S.B, S.B + .16, ph);
        const r = pr * (.32 + .52 * q) * (1 + .03 * Math.sin(t * 40)), hh = r * 1.05 * q;
        if (hh > .5) {
          const gr = c.createRadialGradient(sx, sy - hh * .65, 0, sx, sy - hh * .4, r * 1.15);
          gr.addColorStop(0, rgba(WHITE, .6 * q)); gr.addColorStop(.45, rgba(mix(WHITE, I.acc, .45), .32 * q)); gr.addColorStop(1, rgba(I.acc, 0));
          c.globalAlpha = A > 1 ? 1 : A; c.fillStyle = gr;
          c.beginPath(); c.ellipse(sx, sy, r, hh, 0, Math.PI, TAU); c.closePath(); c.fill();
          c.globalAlpha = .35 * q * A; c.lineWidth = Math.max(.6, .9 * S.sz);
          c.beginPath(); c.ellipse(sx, sy, r * .92, hh * .92, 0, Math.PI * 1.15, Math.PI * 1.75); c.stroke();
        }
      }
      // jet core: a soft white column that shoots up ballistically, then collapses
      const tau = ph - S.B;
      if (tau > 0 && tau < 1.9) {
        const tt = Math.min(tau, S.rise), rise = S.v0 * tt - .5 * S.g * tt * tt;
        const fall = tau > S.rise ? .5 * S.g * (tau - S.rise) * (tau - S.rise) * .55 : 0;
        const top = sy - Math.max(0, rise - fall), h = sy - top;
        const ca = smooth(0, .06, tau) * (1 - smooth(.7, 1.9, tau)) * A;
        if (h > 2 && ca > .01) {
          let w = pr * (.75 + .55 * Math.min(1, tau));
          c.globalAlpha = Math.min(1, .55 * ca); c.drawImage(S.vap, sx - w / 2, top - w * .35, w, h + w * .45);
          w *= .4;
          c.globalAlpha = Math.min(1, .6 * ca); c.drawImage(S.vap, sx - w / 2, top - w * .2, w, h + w * .3);
        }
      }
      // jet: vapour body then bright droplets
      for (const p of S.P) {
        if (!p.alive || !p.k) continue;
        const q = p.age / p.life, a = p.a * A * smooth(0, .06, q) * (1 - smooth(.5, 1, q));
        if (a < .004) continue;
        c.globalAlpha = a > 1 ? 1 : a; c.drawImage(S.vap, p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
      }
      c.globalCompositeOperation = 'lighter';
      // droplets as short motion-blurred streaks, batched into 4 alpha buckets
      S.cnt.fill(0);
      for (const p of S.P) {
        if (!p.alive || p.k) continue;
        const q = p.age / p.life, a = p.a * (1 - smooth(.55, 1, q)) * (p.apex ? .55 : 1);
        if (a < .04) continue;
        const bi = Math.min(3, (a * 4) | 0), k = S.cnt[bi] * 4, arr = S.segs[bi];
        arr[k] = p.x; arr[k + 1] = p.y; arr[k + 2] = p.x - p.vx * .04; arr[k + 3] = p.y - p.vy * .04;
        S.cnt[bi]++;
      }
      c.strokeStyle = rgba(S.col, 1); c.lineCap = 'round'; c.lineWidth = 1.2 * S.sz;
      for (let bi = 0; bi < 4; bi++) {
        const n = S.cnt[bi]; if (!n) continue;
        const arr = S.segs[bi];
        c.globalAlpha = Math.min(1, (bi + .5) / 4 * A);
        c.beginPath();
        for (let k = 0; k < n * 4; k += 4) { c.moveTo(arr[k], arr[k + 1]); c.lineTo(arr[k + 2], arr[k + 3]); }
        c.stroke();
      }
      if (S.flash > 0) {
        const s = pr * 4.2;
        c.globalAlpha = .28 * S.flash * A; c.drawImage(S.glow, sx - s / 2, sy - s * .62, s, s);
      }
      c.globalCompositeOperation = 'source-over';
    }
  };

  /* ---------- aurora (shared with city) ---------- */
  function auroraSetup(I, n, gain, yTop, yBot) {
    const W = I.w, H = I.h, rs = [];
    const stripG = sStrip(mix(GREEN, I.acc, .18), VIOLET);
    const stripV = sStrip(mix(VIOLET, I.acc, .12), mix(VIOLET, [255, 120, 200], .4));
    const sgn = () => (Math.random() < .5 ? -1 : 1);
    for (let i = 0; i < n; i++) {
      const violet = n > 2 && i === n - 1;
      rs.push({
        by: H * rand(yTop, yBot), amp: H * rand(.03, .07), hh: H * rand(.17, .3) * (violet ? 1.2 : 1),
        k1: rand(1, 2.2) * TAU / W, k2: rand(2.5, 4.5) * TAU / W, k3: rand(1.5, 3) * TAU / W,
        k4: rand(16, 28) * TAU / W, k5: rand(5, 10) * TAU / W,
        s1: rand(.12, .25) * sgn(), s2: rand(.2, .4), s3: rand(.15, .3), s4: rand(.5, 1.2) * sgn(), s5: rand(.3, .6),
        p1: rand(0, TAU), p2: rand(0, TAU), p3: rand(0, TAU), p4: rand(0, TAU), p5: rand(0, TAU),
        a: rand(.2, .3) * gain * (violet ? .65 : 1),
        ec: rand(.3, .7), es: rand(.03, .07), ew: rand(.45, .8),
        strip: violet ? stripV : stripG
      });
    }
    return rs;
  }
  function auroraDraw(I, c, t, rs) {
    const W = I.w, n = clamp(Math.round(W / 4), 50, 140), step = W / n, A = I.amp;
    const pulse = .78 + .22 * Math.sin(t * .27);
    c.globalCompositeOperation = 'lighter';
    for (const r of rs) {
      const ec = W * (r.ec + .25 * Math.sin(t * r.es + r.p5)), ew = W * r.ew;
      for (let i = -1; i <= n + 1; i++) {
        const x = i * step, dx = (x - ec) / ew, e = Math.exp(-dx * dx);
        if (e < .03) continue;
        const y = r.by + r.amp * (Math.sin(x * r.k1 + t * r.s1 + r.p1) * .65 + Math.sin(x * r.k2 - t * r.s2 + r.p2) * .35);
        const hh = r.hh * (.72 + .28 * Math.sin(x * r.k3 + t * r.s3 + r.p3));
        const ray = .45 + .55 * (.5 + .5 * Math.sin(x * r.k4 + t * r.s4 + r.p4)) * (.6 + .4 * Math.sin(x * r.k5 - t * r.s5));
        let a = r.a * e * ray * pulse * A;
        if (a < .004) continue;
        c.globalAlpha = a > 1 ? 1 : a;
        c.drawImage(r.strip, x - step, y - hh, step * 2.2, hh * 1.1);
      }
    }
    c.globalCompositeOperation = 'source-over';
  }
  function starsSetup(I, n, yMax) {
    const st = [];
    for (let i = 0; i < n; i++) st.push({ x: rand(0, I.w), y: rand(0, I.h * yMax), s: rand(.7, 1.6) * clamp(I.sc, .8, 1.3), sp: rand(.6, 2), ph: rand(0, TAU), a: rand(.25, .7) });
    return st;
  }
  function starsDraw(I, c, t, st, dot) {
    for (const s of st) {
      const a = s.a * (.35 + .65 * Math.pow(.5 + .5 * Math.sin(t * s.sp + s.ph), 3)) * I.amp;
      c.globalAlpha = a > 1 ? 1 : a;
      c.drawImage(dot, s.x - s.s * 1.5, s.y - s.s * 1.5, s.s * 3, s.s * 3);
    }
  }
  FXS.aurora = {
    res: .5,
    setup(I) {
      I.s.rs = auroraSetup(I, 3, 1, .2, .42);
      I.s.st = starsSetup(I, Math.round(clamp(I.w * I.h / 9000, 8, 26)), .45);
      I.s.dot = sDot([235, 245, 255]);
    },
    draw(I, c, t) {
      starsDraw(I, c, t, I.s.st, I.s.dot);
      auroraDraw(I, c, t, I.s.rs);
    }
  };

  /* ---------- steam (low haze over the water + tall rising wisps) ---------- */
  function stPuff(I, S, p, init) {
    const R = S.r;
    p.x = rand(R.x0 - R.w * .05, R.x1 + R.w * .05);
    p.y = rand(R.y0 + R.h * .2, R.y1);
    p.vy = -rand(.03, .07) * I.h;
    p.vx = rand(-.004, .016) * I.w;
    p.s0 = rand(.11, .21) * Math.min(I.w, I.h * 1.5);
    p.life = rand(5, 9);
    p.age = init ? rand(0, p.life) : 0;
    p.a = rand(.18, .3);
    p.ph = rand(0, TAU);
    p.v = (Math.random() * 3) | 0;
    if (init) p.y += p.vy * p.age * .6;
    return p;
  }
  FXS.steam = {
    res: .5,
    setup(I) {
      const S = I.s, R = S.r = I.rect(I.hint.area, { x0: 0, y0: .55, x1: 1, y1: 1 });
      S.clouds = [0, 1, 2].map((v) => sCloud(mix(WHITE, I.acc, .08), v));
      S.p = [];
      const n = Math.round(clamp(I.w * I.h / 9000, 8, 28));
      for (let i = 0; i < n; i++) S.p.push(stPuff(I, S, {}, true));
      S.hz = [];
      for (let i = 0; i < 4; i++) S.hz.push({ x: rand(0, I.w), y: R.y0 + R.h * rand(.05, .6), w: I.w * rand(.7, 1.15), h: Math.max(R.h * rand(.18, .32), I.h * .08), vx: I.w * rand(.008, .02), a: rand(.1, .17), ph: rand(0, TAU), v: i % 3 });
    },
    update(I, dt) {
      const S = I.s;
      for (const p of S.p) {
        p.age += dt;
        p.x += (p.vx + Math.sin(p.age * .7 + p.ph) * .012 * I.w) * dt;
        p.y += p.vy * dt; p.vy *= (1 - .04 * dt);
        if (p.age > p.life) stPuff(I, S, p, false);
      }
      for (const h of S.hz) { h.x += h.vx * dt; if (h.x - h.w / 2 > I.w) h.x = -h.w / 2; }
    },
    draw(I, c, t) {
      const S = I.s, A = I.amp;
      for (const h of S.hz) {
        const a = h.a * (.75 + .25 * Math.sin(t * .3 + h.ph)) * A;
        c.globalAlpha = a > 1 ? 1 : a;
        c.drawImage(S.clouds[h.v], h.x - h.w / 2, h.y - h.h / 2, h.w, h.h);
      }
      for (const p of S.p) {
        const q = p.age / p.life, a = p.a * A * smooth(0, .22, q) * (1 - smooth(.5, 1, q));
        if (a < .004) continue;
        const s = p.s0 * (.8 + q * 1.1), w = s * (.7 + q * .5), h = s * (1.5 + q * 1.1);
        c.globalAlpha = a > 1 ? 1 : a;
        c.drawImage(S.clouds[p.v], p.x - w / 2, p.y - h * .7, w, h);
      }
    }
  };

  /* ---------- waves (broken foam lines washing in + sun glitter) ---------- */
  function wvReset(I, S, w, z) {
    const RW = S.r.w;
    w.z = z; w.dur = rand(5.5, 7.5);
    w.k0 = rand(.6, 1.4) * TAU / RW; w.k1 = rand(2.5, 4.5) * TAU / RW; w.k2 = rand(8, 13) * TAU / RW;
    w.n1 = rand(1.5, 3) * TAU / RW; w.n2 = rand(4, 7) * TAU / RW;
    w.p0 = rand(0, TAU); w.p1 = rand(0, TAU); w.p2 = rand(0, TAU); w.p3 = rand(0, TAU); w.p4 = rand(0, TAU);
    w.seed = rand(0, 1000); w.a = rand(.75, 1); w.tilt = rand(-.05, .05);
    return w;
  }
  function wvY(w, R, Y, bend, amp, x, t) {
    return Y + bend * Math.sin(x * w.k0 + w.p0) + w.tilt * (x - (R.x0 + R.x1) / 2)
      + amp * (Math.sin(x * w.k1 + w.p1 + t * .6) * .6 + Math.sin(x * w.k2 + w.p2 - t * .9) * .4);
  }
  function wvFoam(w, R, x, t) {
    const n = .55 + .3 * Math.sin(x * w.n1 + w.p3 + t * .12) + .25 * Math.sin(x * w.n2 + w.p4 - t * .2);
    const el = R.x0 > 1 ? smooth(R.x0, R.x0 + R.w * .15, x) : 1;
    const er = R.x1 < R.W - 1 ? 1 - smooth(R.x1 - R.w * .15, R.x1, x) : 1;
    return clamp((n - .2) / .8, 0, 1) * el * er;
  }
  FXS.waves = {
    res: 1,
    setup(I) {
      const S = I.s;
      S.r = I.rect(I.hint.area, { x0: 0, y0: .64, x1: 1, y1: 1.02 });
      S.r.W = I.w;
      S.waves = [];
      for (let i = 0; i < 3; i++) S.waves.push(wvReset(I, S, {}, i / 3 + rand(0, .1)));
      S.col = mix(WHITE, I.acc, .1);
      S.dot = sDot(S.col);
      S.star = sStar(mix(WHITE, I.acc, .25));
      S.hg = sHGlint(mix(WHITE, I.acc, .2));
      S.gl = [];
      const n = Math.round(clamp(S.r.w * S.r.h / 1800, 10, 44));
      for (let i = 0; i < n; i++) S.gl.push({ x: rand(S.r.x0, S.r.x1), y: S.r.y0 + Math.pow(Math.random(), 1.4) * S.r.h * .75, sp: rand(1.2, 3), ph: rand(0, TAU), s: rand(4, 10) * clamp(I.sc, .7, 1.5), star: Math.random() < .18 });
      S.sc = clamp(S.r.h / 120, .6, 2.4);
    },
    update(I, dt) {
      for (const w of I.s.waves) { w.z += dt / w.dur; if (w.z > 1) wvReset(I, I.s, w, 0); }
    },
    draw(I, c, t) {
      const S = I.s, R = S.r, A = I.amp, step = Math.max(5, R.w / 70), chunk = step * 3;
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.strokeStyle = rgba(S.col, 1);
      for (const w of S.waves) {
        const z = w.z, e = 1 - Math.pow(1 - z, 2.2);
        const Y = R.y0 + R.h * e;
        const amp = (1.2 + 4 * z) * S.sc, bend = R.h * .05 * (.4 + z);
        const fade = smooth(0, .18, z) * (1 - smooth(.7, 1, z)) * w.a * A;
        if (fade < .01) continue;
        const gw = (3 + 10 * z) * S.sc, cw = (.7 + 1.6 * z) * S.sc;
        // foam line drawn in chunks so it breaks up naturally (glow + crisp core)
        for (let x0 = R.x0; x0 < R.x1; x0 += chunk) {
          const x1 = Math.min(R.x1, x0 + chunk), d = wvFoam(w, R, (x0 + x1) / 2, t);
          if (d < .05) continue;
          c.beginPath();
          for (let x = x0; x <= x1 + .01; x += step) {
            const y = wvY(w, R, Y, bend, amp, x, t);
            if (x === x0) c.moveTo(x, y); else c.lineTo(x, y);
          }
          c.globalAlpha = .08 * fade * d; c.lineWidth = gw; c.stroke();
          c.globalAlpha = .36 * fade * d; c.lineWidth = cw; c.stroke();
        }
        // lace: little foam bubbles trailing behind the line
        const m = Math.round(R.w / 9);
        for (let j = 0; j < m; j++) {
          const h1 = Math.sin(j * 12.9898 + w.seed) * 43758.5453, r1 = h1 - Math.floor(h1);
          const h2 = Math.sin(j * 78.233 + w.seed) * 12345.678, r2 = h2 - Math.floor(h2);
          const x = R.x0 + (j + r1) * (R.w / m), d = wvFoam(w, R, x, t);
          if (d < .1) continue;
          const y = wvY(w, R, Y, bend, amp, x, t) - r2 * (2 + 12 * z) * S.sc;
          const s = (.7 + r2 * 1.3) * S.sc;
          c.globalAlpha = .32 * fade * d;
          c.drawImage(S.dot, x - s, y - s, s * 2, s * 2);
        }
      }
      // sun glitter on the sea
      c.globalCompositeOperation = 'lighter';
      for (const g of S.gl) {
        const a = Math.pow(Math.max(0, Math.sin(t * g.sp + g.ph)), 8) * .7 * A;
        if (a < .02) continue;
        c.globalAlpha = a > 1 ? 1 : a;
        if (g.star) c.drawImage(S.star, g.x - g.s * .7, g.y - g.s * .7, g.s * 1.4, g.s * 1.4);
        else c.drawImage(S.hg, g.x - g.s, g.y - g.s * .22, g.s * 2, g.s * .44);
      }
      c.globalCompositeOperation = 'source-over';
    }
  };

  /* ---------- drift (glacier lagoon: drifting shimmer + glints) ---------- */
  FXS.drift = {
    res: 1,
    setup(I) {
      const S = I.s, R = S.r = I.rect(I.hint.area, { x0: 0, y0: .45, x1: 1, y1: 1 });
      S.glow = sGlow(mix([200, 240, 255], I.acc, .25));
      S.hg = sHGlint(mix(WHITE, I.acc, .2));
      S.star = sStar(mix(WHITE, I.acc, .3));
      S.cloud = sCloud(mix(WHITE, I.acc, .1), 1);
      S.bands = [];
      for (let i = 0; i < 7; i++) S.bands.push({ x: rand(-.3, 1.1) * I.w, y: rand(R.y0, R.y1), w: rand(.25, .6) * I.w, h: rand(.015, .04) * I.h, vx: rand(5, 16) * I.sc, a: rand(.1, .18), ph: rand(0, TAU) });
      S.gl = [];
      const n = Math.round(clamp(I.w * R.h / 1500, 16, 70));
      for (let i = 0; i < n; i++) S.gl.push({ x: rand(0, I.w), y: R.y0 + Math.pow(Math.random(), 1.3) * R.h, vx: rand(2, 8) * I.sc, sp: rand(.8, 2.2), ph: rand(0, TAU), s: rand(4, 10) * I.sc, star: Math.random() < .2 });
      S.fog = [];
      for (let i = 0; i < 3; i++) S.fog.push({ x: rand(0, I.w), y: R.y0 + rand(-.05, .08) * I.h, w: rand(.6, 1) * I.w, vx: rand(3, 8) * I.sc, a: rand(.05, .09) });
    },
    update(I, dt) {
      const S = I.s, W = I.w;
      for (const b of S.bands) { b.x += b.vx * dt; if (b.x - b.w / 2 > W) { b.x = -b.w / 2; b.y = rand(S.r.y0, S.r.y1); } }
      for (const g of S.gl) { g.x += g.vx * dt; if (g.x > W + 10) g.x = -10; }
      for (const f of S.fog) { f.x += f.vx * dt; if (f.x - f.w / 2 > W) f.x = -f.w / 2; }
    },
    draw(I, c, t) {
      const S = I.s, A = I.amp;
      for (const f of S.fog) { c.globalAlpha = f.a * A; c.drawImage(S.cloud, f.x - f.w / 2, f.y - f.w * .09, f.w, f.w * .18); }
      c.globalCompositeOperation = 'lighter';
      for (const b of S.bands) {
        const y = b.y + Math.sin(t * .4 + b.ph) * 3 * I.sc;
        c.globalAlpha = b.a * A * (.7 + .3 * Math.sin(t * .6 + b.ph));
        c.drawImage(S.glow, b.x - b.w / 2, y - b.h / 2, b.w, b.h);
      }
      for (const g of S.gl) {
        const a = Math.pow(Math.max(0, Math.sin(t * g.sp + g.ph)), 6) * .7 * A;
        if (a < .02) continue;
        c.globalAlpha = a > 1 ? 1 : a;
        if (g.star) c.drawImage(S.star, g.x - g.s, g.y - g.s, g.s * 2, g.s * 2);
        else c.drawImage(S.hg, g.x - g.s, g.y - g.s * .25, g.s * 2, g.s * .5);
      }
      c.globalCompositeOperation = 'source-over';
    }
  };

  /* ---------- ice (ice cave: glints, caustic glow, drips) ---------- */
  function icDrip(I, d) {
    d.x = rand(.08, .92) * I.w; d.y0 = rand(.03, .32) * I.h; d.y = d.y0;
    d.state = 0; d.t = -rand(.3, 2.6); d.vy = 0; d.s = rand(1.4, 2.4) * clamp(I.sc, .8, 1.5);
    return d;
  }
  FXS.ice = {
    res: 1,
    setup(I) {
      const S = I.s, cold = mix([190, 235, 255], I.acc, .3);
      S.star = sStar(mix(WHITE, cold, .5)); S.dot = sDot(mix(WHITE, cold, .4)); S.glow = sGlow(cold);
      S.sp = [];
      const n = Math.round(clamp(I.w * I.h / 4000, 18, 80));
      for (let i = 0; i < n; i++) S.sp.push({ x: rand(0, I.w), y: rand(0, I.h), sp: rand(.5, 1.6), ph: rand(0, TAU), s: rand(4, 12) * I.sc, big: Math.random() < .18 });
      S.bl = [];
      for (let i = 0; i < 3; i++) S.bl.push({ x: rand(.15, .85) * I.w, y: rand(.1, .7) * I.h, r: rand(.25, .45) * Math.max(I.w, I.h), ph: rand(0, TAU), sp: rand(.15, .3) });
      S.dr = [];
      for (let i = 0; i < 3; i++) S.dr.push(icDrip(I, {}));
    },
    update(I, dt) {
      for (const d of I.s.dr) {
        d.t += dt;
        if (d.state === 0) { if (d.t > 1.4) { d.state = 1; d.vy = 0; } }
        else { d.vy += I.h * 1.6 * dt; d.y += d.vy * dt; if (d.y > I.h + 10) icDrip(I, d); }
      }
    },
    draw(I, c, t) {
      const S = I.s, A = I.amp;
      c.globalCompositeOperation = 'lighter';
      for (const b of S.bl) {
        c.globalAlpha = (.07 + .05 * Math.sin(t * b.sp + b.ph)) * A;
        const x = b.x + Math.sin(t * b.sp * .7 + b.ph) * b.r * .15, y = b.y + Math.cos(t * b.sp * .6 + b.ph) * b.r * .1;
        c.drawImage(S.glow, x - b.r / 2, y - b.r / 2, b.r, b.r);
      }
      for (const s of S.sp) {
        const a = Math.pow(Math.max(0, Math.sin(t * s.sp + s.ph)), s.big ? 14 : 8) * (s.big ? .95 : .6) * A;
        if (a < .02) continue;
        const sz = s.s * (s.big ? 1.6 : 1);
        c.globalAlpha = a > 1 ? 1 : a;
        c.drawImage(S.star, s.x - sz, s.y - sz, sz * 2, sz * 2);
      }
      for (const d of S.dr) {
        if (d.t < 0) continue;
        if (d.state === 0) {
          const g = smooth(0, 1.4, d.t), s = d.s * (.4 + .6 * g);
          c.globalAlpha = .55 * g * A;
          c.drawImage(S.dot, d.x - s * 1.5, d.y0 - s * .5, s * 3, s * 3 * (1 + g * .5));
        } else {
          const L = Math.min(40 * I.sc, d.vy * .05);
          c.globalAlpha = .18 * A;
          c.drawImage(S.dot, d.x - d.s * .6, d.y - L, d.s * 1.2, L);
          c.globalAlpha = .6 * A;
          c.drawImage(S.dot, d.x - d.s * 1.5, d.y - d.s * 1.5, d.s * 3, d.s * 3.4);
        }
      }
      c.globalCompositeOperation = 'source-over';
    }
  };

  /* ---------- snow (3 parallax layers) ---------- */
  const SNOW_L = [
    { f: .5, s: [.7, 1.2], v: [.045, .07], a: [.35, .55], sw: 4 },
    { f: .35, s: [1.3, 2.1], v: [.09, .13], a: [.5, .7], sw: 8 },
    { f: .15, s: [2.6, 4.2], v: [.17, .25], a: [.35, .5], sw: 14 }
  ];
  FXS.snow = {
    res: 1,
    setup(I) {
      const S = I.s, n = Math.round(clamp(I.w * I.h / 1600, 50, 260));
      S.dot = sDot(mix(WHITE, I.acc, .08));
      S.f = [];
      SNOW_L.forEach((L, li) => {
        const m = Math.round(n * L.f);
        for (let i = 0; i < m; i++) {
          S.f.push({ l: li, x: rand(0, I.w), y: rand(-10, I.h), s: rand(L.s[0], L.s[1]) * clamp(I.sc, .8, 1.6), vy: rand(L.v[0], L.v[1]) * I.h,
            a: rand(L.a[0], L.a[1]), ph: rand(0, TAU), fr: rand(.4, 1.1), sw: L.sw * rand(.6, 1.2) * I.sc });
        }
      });
    },
    update(I, dt, t) {
      const W = I.w, H = I.h, gust = (Math.sin(t * .23) * .6 + Math.sin(t * .071 + 1) * .4) * .035 * W;
      for (const f of I.s.f) {
        f.y += f.vy * dt; f.x += gust * (.4 + f.l * .45) * dt;
        if (f.y > H + 8) { f.y = -8; f.x = rand(0, W); }
        if (f.x > W + 16) f.x -= W + 32; else if (f.x < -16) f.x += W + 32;
      }
    },
    draw(I, c, t) {
      const S = I.s, A = I.amp;
      for (const f of S.f) {
        const x = f.x + Math.sin(t * f.fr + f.ph) * f.sw, s = f.s * (f.l === 2 ? 2.4 : 1.8);
        c.globalAlpha = f.a * A > 1 ? 1 : f.a * A;
        c.drawImage(S.dot, x - s, f.y - s, s * 2, s * 2);
      }
    }
  };

  /* ---------- mist (slow fog bands) ---------- */
  FXS.mist = {
    res: .5,
    setup(I) {
      const S = I.s;
      S.clouds = [0, 1, 2].map((v) => sCloud(mix(WHITE, I.acc, .1), v));
      S.b = [];
      const dir = Math.random() < .5 ? 1 : -1;
      for (let i = 0; i < 8; i++) {
        const d = Math.random();
        S.b.push({ x: rand(0, I.w), y: I.h * (.28 + Math.pow(Math.random(), .7) * .72), w: I.w * rand(.7, 1.3), h: I.h * rand(.24, .46),
          vx: dir * I.w * (.006 + d * .016), a: rand(.1, .2), ph: rand(0, TAU), v: i % 3 });
      }
    },
    update(I, dt) {
      const W = I.w;
      for (const b of I.s.b) {
        b.x += b.vx * dt;
        if (b.vx > 0 && b.x - b.w / 2 > W) b.x = -b.w / 2;
        else if (b.vx < 0 && b.x + b.w / 2 < 0) b.x = W + b.w / 2;
      }
    },
    draw(I, c, t) {
      const S = I.s, A = I.amp;
      for (const b of S.b) {
        const a = b.a * (.72 + .28 * Math.sin(t * .22 + b.ph)) * A;
        const y = b.y + Math.sin(t * .15 + b.ph) * b.h * .08;
        c.globalAlpha = a > 1 ? 1 : a;
        c.drawImage(S.clouds[b.v], b.x - b.w / 2, y - b.h / 2, b.w, b.h);
      }
    }
  };

  /* ---------- ripple (water surface shimmer) ---------- */
  FXS.ripple = {
    res: 1,
    setup(I) {
      const S = I.s, R = S.r = I.rect(I.hint.area, { x0: 0, y0: .55, x1: 1, y1: 1 });
      S.hg = sHGlint(mix(WHITE, I.acc, .25));
      S.glow = sGlow(mix(WHITE, I.acc, .4));
      S.g = [];
      const n = Math.round(clamp(R.w * R.h / 650, 24, 170));
      for (let i = 0; i < n; i++) {
        const v = Math.pow(Math.random(), 1.6);
        S.g.push({ x: rand(R.x0, R.x1), y: R.y0 + v * R.h, k: .45 + v * 1.1, sp: rand(1.2, 3), ph: rand(0, TAU), len: rand(8, 20) * clamp(I.sc, .7, 1.6) });
      }
      S.bands = [{ v: rand(0, 1), sp: .05 }, { v: rand(0, 1), sp: -.035 }];
    },
    update(I, dt) { for (const b of I.s.bands) { b.v += b.sp * dt; if (b.v > 1.2) b.v = -.2; if (b.v < -.2) b.v = 1.2; } },
    draw(I, c, t) {
      const S = I.s, R = S.r, A = I.amp;
      c.globalCompositeOperation = 'lighter';
      for (const b of S.bands) {
        const h = R.h * .35;
        c.globalAlpha = .05 * A;
        c.drawImage(S.glow, R.x0 - R.w * .1, R.y0 + b.v * R.h - h / 2, R.w * 1.2, h);
      }
      for (const g of S.g) {
        const a = Math.pow(Math.max(0, Math.sin(t * g.sp + g.ph)), 5) * .55 * A;
        if (a < .02) continue;
        const w = g.len * g.k, x = g.x + Math.sin(t * .7 + g.ph) * 3 * g.k;
        c.globalAlpha = a > 1 ? 1 : a;
        c.drawImage(S.hg, x - w / 2, g.y - w * .11, w, w * .22);
      }
      c.globalCompositeOperation = 'source-over';
    }
  };

  /* ---------- city (warm twinkling lights, bokeh, faint aurora) ---------- */
  FXS.city = {
    res: 1,
    setup(I) {
      const S = I.s, R = S.r = I.rect(I.hint.area, { x0: 0, y0: .45, x1: 1, y1: .95 });
      const warm = [[255, 210, 154], [255, 180, 107], [255, 241, 208], mix(WARM, I.acc, .5)];
      S.dots = warm.map(sDot);
      S.bk = [sBokeh(mix(WARM, WHITE, .2)), sBokeh(mix(WARM, I.acc, .6))];
      S.L = [];
      const n = Math.round(clamp(R.w * R.h / 2600, 18, 80));
      for (let i = 0; i < n; i++) S.L.push({ x: rand(R.x0, R.x1), y: R.y0 + Math.pow(Math.random(), .8) * R.h, c: (Math.random() * 4) | 0, s: rand(1.6, 3.4) * clamp(I.sc, .8, 1.5), a: rand(.25, .6), sp: rand(.4, 1.6), ph: rand(0, TAU), fl: Math.random() < .12 });
      S.B = [];
      for (let i = 0; i < 6; i++) S.B.push({ x: rand(0, I.w), y: rand(.35, 1) * I.h, r: rand(.035, .09) * I.w, vx: rand(-4, 4) * I.sc, vy: -rand(1, 4) * I.sc, a: rand(.04, .09), k: i % 2, ph: rand(0, TAU) });
      S.rs = auroraSetup(I, 2, .3, .1, .24);
    },
    update(I, dt) {
      for (const b of I.s.B) {
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y < -b.r) { b.y = I.h + b.r; b.x = rand(0, I.w); }
        if (b.x < -b.r) b.x = I.w + b.r; else if (b.x > I.w + b.r) b.x = -b.r;
      }
    },
    draw(I, c, t) {
      const S = I.s, A = I.amp;
      auroraDraw(I, c, t, S.rs);
      c.globalCompositeOperation = 'lighter';
      for (const l of S.L) {
        let a = l.a * (.65 + .35 * Math.sin(t * l.sp + l.ph));
        if (l.fl) a *= .6 + .4 * (Math.sin(t * 17 + l.ph) > .2 ? 1 : 0);
        a *= A;
        const s = l.s * 3;
        c.globalAlpha = a > 1 ? 1 : a;
        c.drawImage(S.dots[l.c], l.x - s, l.y - s, s * 2, s * 2);
      }
      for (const b of S.B) {
        c.globalAlpha = b.a * (.7 + .3 * Math.sin(t * .5 + b.ph)) * A;
        c.drawImage(S.bk[b.k], b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      }
      c.globalCompositeOperation = 'source-over';
    }
  };

  /* ---------- sunset (light leak, lens flare, floating dust) ---------- */
  FXS.sunset = {
    res: .5,
    blend: 'normal',   // warm light must tint bright skies too (screen would vanish on white)
    setup(I) {
      const S = I.s, sun = I.hint.sun || { x: .84, y: .16 };
      S.sx = clamp(I.X(sun.x), 0, I.w); S.sy = clamp(I.Y(sun.y), 0, I.h);
      S.leak = sLeak([255, 186, 110], mix([255, 96, 120], I.acc, .25));
      S.leak2 = sLeak(mix([255, 120, 190], I.acc, .3), VIOLET);
      S.ghostC = [sBokeh(mix(WARM, WHITE, .2)), sBokeh(mix(I.acc, WHITE, .2)), sBokeh(mix(VIOLET, WHITE, .2))];
      S.glow = sGlow([255, 225, 180]);
      S.dot = sDot([255, 236, 210]);
      S.gh = [];
      [.42, .7, 1.18, 1.45, 1.8].forEach((k, i) => S.gh.push({ k, r: rand(.025, .09) * I.w, c: i % 3, a: rand(.07, .13) }));
      S.d = [];
      const n = Math.round(clamp(I.w * I.h / 5200, 14, 50));
      for (let i = 0; i < n; i++) S.d.push({ x: rand(0, I.w), y: rand(0, I.h), vx: rand(-3, 3), vy: rand(-4, 1), s: rand(.8, 2.2) * clamp(I.sc, .8, 1.5), sp: rand(.5, 1.6), ph: rand(0, TAU) });
    },
    update(I, dt) {
      const sc = I.sc;
      for (const d of I.s.d) {
        d.vx += gauss() * 18 * dt * sc; d.vy += (gauss() * 18 - 2) * dt * sc;
        d.vx *= (1 - .9 * dt); d.vy *= (1 - .9 * dt);
        d.x += d.vx * dt; d.y += d.vy * dt;
        if (d.x < -5) d.x = I.w + 5; else if (d.x > I.w + 5) d.x = -5;
        if (d.y < -5) d.y = I.h + 5; else if (d.y > I.h + 5) d.y = -5;
      }
    },
    draw(I, c, t) {
      const S = I.s, A = I.amp, W = I.w, H = I.h, M = Math.max(W, H);
      const sx = S.sx + Math.sin(t * .11) * W * .025, sy = S.sy + Math.cos(t * .09) * H * .02;
      c.globalCompositeOperation = 'lighter';
      let s = M * 1.7;
      c.globalAlpha = Math.min(1, (.34 + .12 * Math.sin(t * .42)) * A);
      c.drawImage(S.leak, sx - s / 2, sy - s / 2, s, s);
      s = M * 1.2;
      c.globalAlpha = Math.min(1, (.1 + .07 * Math.sin(t * .31 + 2)) * A);
      c.drawImage(S.leak2, W - sx - s / 2, H - sy * .4 - s / 2, s, s);
      s = M * .3;
      c.globalAlpha = Math.min(1, (.3 + .1 * Math.sin(t * 1.3)) * A);
      c.drawImage(S.glow, sx - s / 2, sy - s / 2, s, s);
      // ghosts along the sun→centre axis
      const cx = W / 2, cy = H / 2;
      for (const g of S.gh) {
        const x = sx + (cx - sx) * g.k * 2, y = sy + (cy - sy) * g.k * 2;
        c.globalAlpha = g.a * (.7 + .3 * Math.sin(t * .5 + g.k * 3)) * A;
        c.drawImage(S.ghostC[g.c], x - g.r, y - g.r, g.r * 2, g.r * 2);
      }
      // dust motes, brighter near the light
      for (const d of S.d) {
        const dist = Math.hypot(d.x - sx, d.y - sy) / M, near = 1 - clamp(dist * 1.1, 0, .8);
        const a = (.12 + .5 * Math.pow(.5 + .5 * Math.sin(t * d.sp + d.ph), 3)) * near * A;
        c.globalAlpha = a > 1 ? 1 : a;
        c.drawImage(S.dot, d.x - d.s * 1.5, d.y - d.s * 1.5, d.s * 3, d.s * 3);
      }
      c.globalCompositeOperation = 'source-over';
    }
  };

  /* ---------- drive (speed lines, road dashes, passing light) ---------- */
  function drLine(l, init) {
    l.ang = rand(0, TAU); l.r = init ? rand(0, 1) : rand(.02, .12); l.sp = rand(.18, .38); l.len = rand(.06, .16); l.a = rand(.35, 1);
    return l;
  }
  FXS.drive = {
    res: 1,
    setup(I) {
      const S = I.s, vp = I.hint.vp || { x: .5, y: .56 };
      S.vx = clamp(I.X(vp.x), I.w * .1, I.w * .9); S.vy = clamp(I.Y(vp.y), I.h * .25, I.h * .8);
      S.R = Math.hypot(I.w, I.h) * .75;
      S.col = mix(WHITE, I.acc, .15);
      S.L = [];
      const n = Math.round(clamp(I.w * I.h / 6000, 18, 46));
      for (let i = 0; i < n; i++) S.L.push(drLine({}, true));
      S.segs = [new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4)];
      S.cnt = new Int32Array(4);
      S.road = I.hint.road !== false;
      S.D = []; for (let i = 0; i < 9; i++) S.D.push(1 + i * 4.5);
      S.sw = { next: rand(1.5, 4), t: -1 };
      S.T = 0;
    },
    update(I, dt) {
      const S = I.s;
      S.T += dt;
      for (const l of S.L) { l.r += l.sp * (.12 + l.r * 1.7) * dt; if (l.r > 1.05) drLine(l, false); }
      for (let i = 0; i < S.D.length; i++) { S.D[i] -= 13 * dt; if (S.D[i] < .7) S.D[i] += 4.5 * S.D.length; }
      if (S.sw.t < 0 && S.T > S.sw.next) { S.sw.t = 0; }
      if (S.sw.t >= 0) { S.sw.t += dt; if (S.sw.t > 1.6) { S.sw.t = -1; S.sw.next = S.T + rand(3.5, 7); } }
    },
    draw(I, c) {
      const S = I.s, A = I.amp, W = I.w, H = I.h;
      c.strokeStyle = rgba(S.col, 1); c.lineCap = 'butt';
      // road centre dashes in perspective
      if (S.road) {
        const lane = W * (I.hint.lane == null ? -.16 : I.hint.lane), bot = H * 1.15 - S.vy;
        for (const d of S.D) {
          const s0 = 1 / d, s1 = 1 / (d + 1.6);
          const a = .2 * smooth(.02, .1, s0) * (1 - smooth(.7, 1, s0) * .5) * A;
          if (a < .01) continue;
          c.globalAlpha = a; c.lineWidth = Math.max(.5, 4.5 * s0 * I.sc);
          c.beginPath(); c.moveTo(S.vx + lane * s0, S.vy + bot * s0); c.lineTo(S.vx + lane * s1, S.vy + bot * s1); c.stroke();
        }
      }
      // radial speed lines
      S.cnt.fill(0);
      for (const l of S.L) {
        const f = l.a * smooth(.12, .35, l.r) * (1 - smooth(.85, 1.05, l.r));
        if (f < .05) continue;
        const bi = (f > .5 ? 1 : 0) + (l.r > .6 ? 2 : 0), k = S.cnt[bi] * 4, arr = S.segs[bi];
        const cs = Math.cos(l.ang), sn = Math.sin(l.ang), r2 = Math.max(0, l.r - l.len * (.4 + l.r));
        arr[k] = S.vx + cs * l.r * S.R; arr[k + 1] = S.vy + sn * l.r * S.R;
        arr[k + 2] = S.vx + cs * r2 * S.R; arr[k + 3] = S.vy + sn * r2 * S.R;
        S.cnt[bi]++;
      }
      for (let bi = 0; bi < 4; bi++) {
        const n = S.cnt[bi]; if (!n) continue;
        const arr = S.segs[bi];
        c.globalAlpha = ((bi & 1) ? .26 : .13) * A; c.lineWidth = ((bi & 2) ? 1.6 : .8) * clamp(I.sc, .8, 1.6);
        c.beginPath();
        for (let k = 0; k < n * 4; k += 4) { c.moveTo(arr[k], arr[k + 1]); c.lineTo(arr[k + 2], arr[k + 3]); }
        c.stroke();
      }
      // passing light sweeping across the windscreen
      if (S.sw.t >= 0) {
        const p = S.sw.t / 1.6, x = -W * .35 + p * W * 1.7, bw = W * .22;
        const gr = c.createLinearGradient(x - bw, H * .1, x + bw, -H * .05);
        gr.addColorStop(0, rgba(WARM, 0)); gr.addColorStop(.5, rgba(mix(WARM, WHITE, .5), .16 * bell(p))); gr.addColorStop(1, rgba(WARM, 0));
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = A > 1 ? 1 : A; c.fillStyle = gr; c.fillRect(0, 0, W, H);
        c.globalCompositeOperation = 'source-over';
      }
    }
  };

  /* ---------- flight (clouds streaming past, plane + contrail) ---------- */
  function flCloud(I, cl, init) {
    const d = Math.random();
    cl.d = d; cl.s = (.25 + d * .65) * I.w; cl.sp = (.03 + d * .16) * I.w;
    cl.a = .07 + d * .13; cl.v = (Math.random() * 3) | 0;
    cl.y = d > .68 ? (Math.random() < .55 ? rand(-.18, .06) : rand(.88, 1.08)) * I.h : rand(.04, .55) * I.h;
    cl.x = init ? rand(-.2, 1.2) * I.w : I.w + cl.s / 2 + rand(0, I.w * .3);
    return cl;
  }
  function flPass(I, S) {
    S.dir = Math.random() < .7 ? 1 : -1;
    S.ya = rand(.12, .32) * I.h; S.yb = S.ya - rand(.04, .14) * I.h; S.tn = 0;
  }
  FXS.flight = {
    res: 1,
    blend: 'normal',
    setup(I) {
      const S = I.s;
      S.clouds = [0, 1, 2].map((v) => sCloud(mix(WHITE, I.acc, .06), v));
      S.C = []; for (let i = 0; i < 7; i++) S.C.push(flCloud(I, {}, true));
      S.C.sort((a, b) => a.d - b.d);
      S.size = clamp(I.w * .05, 12, 44);
      S.dur = 10; S.per = 14; S.pt = rand(1, 5);
      S.N = 220; S.tx1 = new Float32Array(S.N); S.ty1 = new Float32Array(S.N); S.tx2 = new Float32Array(S.N); S.ty2 = new Float32Array(S.N); S.tt = new Float32Array(S.N);
      S.head = 0; S.len = 0; S.rec = 0; S.T = 0;
      S.trailCol = rgba(mix(WHITE, I.acc, .08), 1);
      S.planeCol = 'rgba(16,20,28,0.62)';
      flPass(I, S);
    },
    update(I, dt) {
      const S = I.s;
      S.T += dt;
      for (const cl of S.C) { cl.x -= cl.sp * dt; if (cl.x + cl.s / 2 < 0) flCloud(I, cl, false); }
      const prev = S.pt % S.per;
      S.pt += dt;
      const ph = S.pt % S.per;
      if (ph < prev) { flPass(I, S); S.len = 0; }
      S.on = ph < S.dur;
      if (S.on) {
        const p = ph / S.dur, W = I.w;
        const x = S.dir > 0 ? lerp(-.08 * W, 1.08 * W, p) : lerp(1.08 * W, -.08 * W, p);
        const y = lerp(S.ya, S.yb, p) - Math.sin(p * Math.PI) * I.h * .02;
        const x2 = S.dir > 0 ? lerp(-.08 * W, 1.08 * W, p + .01) : lerp(1.08 * W, -.08 * W, p + .01);
        const y2 = lerp(S.ya, S.yb, p + .01) - Math.sin((p + .01) * Math.PI) * I.h * .02;
        S.px = x; S.py = y; S.ang = Math.atan2(y2 - y, x2 - x);
        S.rec += dt;
        if (S.rec > .045) {
          S.rec = 0;
          const cs = Math.cos(S.ang), sn = Math.sin(S.ang), sz = S.size;
          const bx = x - cs * sz * .35, by = y - sn * sz * .35, ox = -sn * sz * .2, oy = cs * sz * .2;
          const i = S.head;
          S.tx1[i] = bx + ox; S.ty1[i] = by + oy; S.tx2[i] = bx - ox; S.ty2[i] = by - oy; S.tt[i] = S.T;
          S.head = (S.head + 1) % S.N; S.len = Math.min(S.N, S.len + 1);
        }
      }
    },
    draw(I, c, t) {
      const S = I.s, A = I.amp, sc = clamp(I.sc, .8, 1.6);
      // far clouds first
      for (const cl of S.C) {
        if (cl.d > .68) continue;
        c.globalAlpha = cl.a * A; c.drawImage(S.clouds[cl.v], cl.x - cl.s / 2, cl.y - cl.s * .3, cl.s, cl.s * .6);
      }
      // contrail: aged polylines (two engines), batched into 6 age buckets
      if (S.len > 1) {
        c.strokeStyle = S.trailCol; c.lineCap = 'butt'; c.lineJoin = 'round';
        const LIFE = 7, NB = 8, start = (S.head - S.len + S.N) % S.N;
        for (let bkt = 0; bkt < NB; bkt++) {
          const aMin = bkt / NB * LIFE, aMax = (bkt + 1) / NB * LIFE, am = (aMin + aMax) / 2;
          const alpha = .4 * Math.pow(1 - am / LIFE, 1.6) * A;
          if (alpha < .01) continue;
          const lw = (.7 + am * .8) * sc;
          for (let e = 0; e < 2; e++) {
            const X = e ? S.tx2 : S.tx1, Y = e ? S.ty2 : S.ty1;
            c.beginPath(); let open = false;
            for (let j = 0; j < S.len; j++) {
              const i = (start + j) % S.N, age = S.T - S.tt[i];
              if (age >= aMin - .05 && age <= aMax + .05) { if (!open) { c.moveTo(X[i], Y[i]); open = true; } else c.lineTo(X[i], Y[i]); }
              else if (open) break;
            }
            if (!open) continue;
            c.globalAlpha = alpha * .3; c.lineWidth = lw * 3.2; c.stroke();
            c.globalAlpha = alpha; c.lineWidth = lw; c.stroke();
          }
        }
      }
      // plane planform silhouette (seen from below)
      if (S.on) {
        c.save(); c.translate(S.px, S.py); c.rotate(S.ang); c.scale(S.size, S.size);
        c.globalAlpha = A > 1 ? 1 : A; c.fillStyle = S.planeCol;
        c.beginPath();
        c.moveTo(.55, 0); c.quadraticCurveTo(.52, -.05, .4, -.055); c.lineTo(.12, -.055);
        c.lineTo(-.18, -.5); c.lineTo(-.28, -.5); c.lineTo(-.14, -.055);
        c.lineTo(-.4, -.055); c.lineTo(-.52, -.2); c.lineTo(-.58, -.2); c.lineTo(-.53, -.03); c.lineTo(-.58, 0);
        c.lineTo(-.53, .03); c.lineTo(-.58, .2); c.lineTo(-.52, .2); c.lineTo(-.4, .055);
        c.lineTo(-.14, .055); c.lineTo(-.28, .5); c.lineTo(-.18, .5); c.lineTo(.12, .055);
        c.lineTo(.4, .055); c.quadraticCurveTo(.52, .05, .55, 0); c.closePath(); c.fill();
        // blinking navigation light
        if ((t % 1.3) < .12) { c.fillStyle = 'rgba(255,90,90,0.9)'; c.beginPath(); c.arc(-.22, .5, .035, 0, TAU); c.fill(); }
        c.restore();
      }
      // near clouds streaming past in front
      for (const cl of S.C) {
        if (cl.d <= .68) continue;
        c.globalAlpha = cl.a * A; c.drawImage(S.clouds[cl.v], cl.x - cl.s / 2, cl.y - cl.s * .3, cl.s, cl.s * .6);
      }
    }
  };

  /* ---------- wind (diagonal gust streaks, seeds, light rolling over grass) ---------- */
  function wdStreak(I, s, init) {
    s.x = init ? rand(-.1, 1) * I.w : rand(-.25, .75) * I.w;
    s.y = rand(-.05, 1.05) * I.h; s.len = rand(18, 60) * I.sc; s.sp = rand(.3, .65) * I.w;
    s.a = rand(.3, 1); s.life = rand(.9, 2.2); s.age = init ? rand(0, s.life) : 0; s.th = Math.random() < .25;
    return s;
  }
  FXS.wind = {
    res: 1,
    setup(I) {
      const S = I.s;
      S.ang = .2; S.dx = Math.cos(S.ang); S.dy = Math.sin(S.ang);
      S.col = mix(WHITE, I.acc, .1);
      S.dot = sDot(mix([245, 240, 220], I.acc, .1));
      S.glow = sGlow(mix([235, 255, 210], I.acc, .25));
      const n = Math.round(clamp(I.w * I.h / 2600, 22, 90));
      S.st = []; for (let i = 0; i < n; i++) S.st.push(wdStreak(I, {}, true));
      S.segs = [new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4)];
      S.cnt = new Int32Array(6);
      S.sp = []; for (let i = 0; i < Math.round(n / 3); i++) S.sp.push({ x: rand(0, I.w), y: rand(0, I.h), s: rand(.7, 1.6) * clamp(I.sc, .8, 1.5), k: rand(.6, 1.3), ph: rand(0, TAU) });
      S.gb = []; for (let i = 0; i < 2; i++) S.gb.push({ x: rand(-.5, 1) * I.w, y: rand(.58, .95) * I.h, w: rand(.3, .5) * I.w, h: rand(.15, .25) * I.h });
      S.g = 1;
    },
    update(I, dt, t) {
      const S = I.s, W = I.w, H = I.h;
      S.g = .55 + .45 * (.5 + .5 * Math.sin(t * .5)) * (.75 + .25 * Math.sin(t * 1.9 + 1.3));
      for (const s of S.st) {
        s.age += dt; s.x += S.dx * s.sp * S.g * dt; s.y += S.dy * s.sp * S.g * dt;
        if (s.age > s.life || s.x > W + s.len) wdStreak(I, s, false);
      }
      for (const p of S.sp) {
        p.x += S.dx * W * .32 * p.k * S.g * dt; p.y += (S.dy * W * .32 * p.k * S.g + Math.sin(t * 3 + p.ph) * 20 * I.sc) * dt;
        if (p.x > W + 5) { p.x = -5; p.y = rand(0, H); }
        if (p.y > H + 5) p.y = -5; else if (p.y < -5) p.y = H + 5;
      }
      for (const b of S.gb) { b.x += W * .22 * S.g * dt; if (b.x - b.w / 2 > W) { b.x = -b.w / 2 - rand(0, W * .6); b.y = rand(.58, .95) * H; } }
    },
    draw(I, c, t) {
      const S = I.s, A = I.amp;
      c.globalCompositeOperation = 'lighter';
      for (const b of S.gb) { c.globalAlpha = .07 * A; c.drawImage(S.glow, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h); }
      c.globalCompositeOperation = 'source-over';
      S.cnt.fill(0);
      for (const s of S.st) {
        const f = s.a * bell(s.age / s.life);
        if (f < .05) continue;
        const bi = Math.min(2, (f * 3) | 0) + (s.th ? 3 : 0), k = S.cnt[bi] * 4, arr = S.segs[bi];
        const L = s.len * (.6 + .4 * S.g);
        arr[k] = s.x; arr[k + 1] = s.y; arr[k + 2] = s.x - S.dx * L; arr[k + 3] = s.y - S.dy * L;
        S.cnt[bi]++;
      }
      c.strokeStyle = rgba(S.col, 1); c.lineCap = 'round';
      for (let bi = 0; bi < 6; bi++) {
        const n = S.cnt[bi]; if (!n) continue;
        const arr = S.segs[bi];
        c.globalAlpha = (((bi % 3) + .5) / 3) * (bi >= 3 ? .2 : .3) * A;
        c.lineWidth = (bi >= 3 ? 1.5 : .75) * clamp(I.sc, .8, 1.5);
        c.beginPath();
        for (let k = 0; k < n * 4; k += 4) { c.moveTo(arr[k], arr[k + 1]); c.lineTo(arr[k + 2], arr[k + 3]); }
        c.stroke();
      }
      for (const p of S.sp) {
        c.globalAlpha = .45 * A > 1 ? 1 : .45 * A;
        c.drawImage(S.dot, p.x - p.s * 1.5, p.y - p.s * 1.5, p.s * 3, p.s * 3);
      }
    }
  };

  /* ------------------------------------------------------------------ *
   * Instance management: one shared RAF, IntersectionObserver, ResizeObserver
   * ------------------------------------------------------------------ */
  const live = new Set();
  let raf = 0, last = 0, globalOn = true;
  const stats = { ms: 0, active: 0, mounted: 0 };
  let reduceMotion = false;
  try {
    const mq = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq) {
      reduceMotion = !!mq.matches;
      const onMq = (e) => { reduceMotion = !!e.matches; live.forEach((I) => { I.dirty = true; sync(I); }); };
      if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
    }
  } catch (e) { /* ignore */ }

  const now = () => (global.performance && global.performance.now ? global.performance.now() : Date.now());
  const rAF = (fn) => (global.requestAnimationFrame ? global.requestAnimationFrame(fn) : global.setTimeout(() => fn(now()), 16));

  let io = null, ro = null;
  function getIO() {
    if (io === null) {
      io = ('IntersectionObserver' in global)
        ? new global.IntersectionObserver((entries) => {
          for (const e of entries) {
            const I = e.target.__fxInst;
            if (I && !I.dead) { I.visible = e.isIntersecting; sync(I); }
          }
        }, { rootMargin: '120px 120px 120px 120px' })
        : false;
    }
    return io;
  }
  function getRO() {
    if (ro === null) {
      ro = ('ResizeObserver' in global)
        ? new global.ResizeObserver((entries) => {
          for (const e of entries) { const I = e.target.__fxInst; if (I && !I.dead) onResize(I); }
        })
        : false;
      if (!ro) global.addEventListener('resize', () => live.forEach(onResize));
    }
    return ro;
  }
  // devicePixelRatio changes (zoom, moving between monitors)
  global.addEventListener && global.addEventListener('resize', () => {
    const d = Math.min(global.devicePixelRatio || 1, 2);
    live.forEach((I) => { if (I.dpr !== d) onResize(I); });
  });

  function onResize(I) {
    const w = I.el.clientWidth, h = I.el.clientHeight, d = Math.min(global.devicePixelRatio || 1, 2);
    if (w !== I.w || h !== I.h || d !== I.dpr || !I.w) { I.dirty = true; if (!I.running) sync(I); }
  }

  function measure(I) {
    const w = I.el.clientWidth, h = I.el.clientHeight;
    I.w = w; I.h = h;
    if (!w || !h) return false;
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    I.dpr = dpr;
    let k = dpr * (I.fx.res || 1);
    if (w * h * k * k > MAX_PX) k = Math.sqrt(MAX_PX / (w * h));
    const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    if (I.canvas.width !== cw) I.canvas.width = cw;
    if (I.canvas.height !== ch) I.canvas.height = ch;
    I.cw = cw; I.ch = ch; I.kx = cw / w; I.ky = ch / h;
    I.sc = clamp(Math.min(w, h * 1.6) / 420, .55, 2.2);
    mapImage(I);
    return true;
  }

  function parsePos(v, free) {
    if (v === 'left' || v === 'top') return 0;
    if (v === 'right' || v === 'bottom') return free;
    if (v === 'center') return free * .5;
    if (/%$/.test(v)) return parseFloat(v) / 100 * free;
    if (/px$/.test(v)) return parseFloat(v);
    return free * .5;
  }
  function mapImage(I) {
    const img = I.img, w = I.w, h = I.h;
    I.ox = 0; I.oy = 0; I.mw = w; I.mh = h;
    const iw = img && img.naturalWidth, ih = img && img.naturalHeight;
    if (!iw || !ih) return;
    let fit = 'cover', pos = '50% 50%';
    try { const cs = global.getComputedStyle(img); fit = cs.objectFit || 'cover'; pos = cs.objectPosition || pos; } catch (e) { /* ignore */ }
    if (fit === 'fill') return;
    let s = Math.max(w / iw, h / ih);
    if (fit === 'contain') s = Math.min(w / iw, h / ih);
    else if (fit === 'none') s = 1;
    else if (fit === 'scale-down') s = Math.min(1, w / iw, h / ih);
    const dw = iw * s, dh = ih * s, parts = String(pos).trim().split(/\s+/);
    let px = parts[0] || '50%', py = parts[1] || '50%';
    if (px === 'top' || px === 'bottom') { const tmp = px; px = py === 'top' || py === 'bottom' ? '50%' : py; py = tmp; }
    I.ox = parsePos(px, w - dw); I.oy = parsePos(py, h - dh); I.mw = dw; I.mh = dh;
  }

  function Inst(el, type, opts) {
    this.el = el; this.type = type; this.fx = FXS[type]; this.opts = opts;
    this.acc = parseColor(opts.accent || '#7fe3ff');
    this.amp = clamp(opts.intensity == null ? 1 : +opts.intensity || 0, 0, 1.6);
    this.img = el.querySelector('img');
    this.id = opts.id || imgId(this.img);
    this.hint = {};
    this.enabled = true; this.visible = !getIO(); this.running = false; this.dead = false; this.dirty = true;
    this.shown = false; this.t = 0; this.s = {}; this.w = 0; this.h = 0;
  }
  Inst.prototype.X = function (u) { return this.ox + u * this.mw; };
  Inst.prototype.Y = function (v) { return this.oy + v * this.mh; };
  // map an image-fraction rect to container px, clamped & with a minimum height
  Inst.prototype.rect = function (a, def) {
    a = a || def;
    let x0 = clamp(this.X(a.x0 == null ? 0 : a.x0), 0, this.w), x1 = clamp(this.X(a.x1 == null ? 1 : a.x1), 0, this.w);
    let y0 = clamp(this.Y(a.y0 == null ? 0 : a.y0), 0, this.h), y1 = clamp(this.Y(a.y1 == null ? 1 : a.y1), 0, this.h * 1.05);
    if (x1 - x0 < this.w * .15) { const m = (x0 + x1) / 2; x0 = Math.max(0, m - this.w * .075); x1 = Math.min(this.w, m + this.w * .075); }
    if (y1 - y0 < this.h * .1) { const m = (y0 + y1) / 2; y0 = Math.max(0, m - this.h * .05); y1 = Math.min(this.h, m + this.h * .05); }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  };

  function imgId(img) {
    if (!img) return '';
    const src = img.getAttribute('src') || img.getAttribute('data-src') || img.currentSrc || '';
    const m = /([^\/?#]+?)(?:\.(?:jpe?g|png|webp|avif|gif))?(?:[?#].*)?$/i.exec(src);
    return m ? decodeURIComponent(m[1]) : '';
  }

  // 4x4 luminance fingerprint (hex) of a loaded photo; null when unreadable (e.g. file:// taint)
  const FPC = new Map();
  function imgFingerprint(img) {
    const key = img.currentSrc || img.src || '';
    if (key && FPC.has(key)) return FPC.get(key);
    let out = null;
    try {
      const c = mkCanvas(64, 64), g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data;
      out = '';
      for (let by = 0; by < 4; by++) {
        for (let bx = 0; bx < 4; bx++) {
          let sum = 0;
          for (let y = by * 16; y < by * 16 + 16; y++) {
            for (let x = bx * 16; x < bx * 16 + 16; x++) { const i = (y * 64 + x) * 4; sum += .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]; }
          }
          out += Math.min(15, (sum / 256 / 16) | 0).toString(16);
        }
      }
    } catch (e) { out = null; }
    if (key) FPC.set(key, out);
    return out;
  }
  // a composition hint only applies to the exact photo it was calibrated on
  function hintFor(I) {
    if (I.opts.hint) return I.opts.hint;
    const h = I.id && HINTS[I.id], img = I.img;
    if (!h || !img || !img.naturalWidth) return {};
    if (h.ar && Math.abs(img.naturalWidth / img.naturalHeight - h.ar) > .012) return {};
    if (h.fp) {
      const fp = imgFingerprint(img);
      if (fp && fp.length === h.fp.length) {
        let sum = 0, mx = 0;
        for (let i = 0; i < fp.length; i++) { const d = Math.abs(parseInt(fp[i], 16) - parseInt(h.fp[i], 16)); sum += d; if (d > mx) mx = d; }
        if (sum / fp.length > 1.6 || mx > 5) return {};
      }
    }
    return h;
  }

  function prepare(I) {
    if (!measure(I)) return false;
    I.hint = hintFor(I);
    I.s = {}; I.t = rand(0, 60);
    I.fx.setup(I);
    if (I.fx.update) {
      const pw = I.fx.prewarm == null ? 1.5 : I.fx.prewarm;
      for (let k = 0, n = Math.round(pw * 30); k < n; k++) { I.t += 1 / 30; I.fx.update(I, 1 / 30, I.t); }
    }
    I.dirty = false;
    return true;
  }

  function render(I) {
    const c = I.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, I.cw, I.ch);
    c.setTransform(I.kx, 0, 0, I.ky, 0, 0);
    I.fx.draw(I, c, I.t);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    if (!I.shown) { I.shown = true; I.canvas.classList.add('fx-on'); }
  }

  function frame(I, dt) {
    if (I.dirty && !prepare(I)) return;
    if (!I.w) return;
    I.t += dt;
    if (I.fx.update) I.fx.update(I, dt, I.t);
    render(I);
  }

  function fail(I, err) {
    I.running = false; I.enabled = false;
    if (global.console) global.console.warn('[FX] effect "' + I.type + '" stopped:', err);
  }

  function loop(ts) {
    raf = 0;
    let dt = last ? (ts - last) / 1000 : 1 / 60;
    last = ts;
    if (!(dt > 0)) dt = 1 / 120; else if (dt > .05) dt = .05;
    const t0 = now();
    let n = 0;
    live.forEach((I) => { if (I.running) { n++; try { frame(I, dt); } catch (err) { fail(I, err); } } });
    stats.ms = stats.ms * .92 + (now() - t0) * .08;
    stats.active = n;
    if (n) raf = rAF(loop); else last = 0;
  }
  function kick() { if (!raf) { last = 0; raf = rAF(loop); } }

  function sync(I) {
    if (I.dead) return;
    const want = I.enabled && I.visible && globalOn;
    if (reduceMotion) {
      I.running = false;
      if (want && (I.dirty || !I.shown)) { try { if (!I.dirty || prepare(I)) render(I); } catch (err) { fail(I, err); } }
      return;
    }
    if (want !== I.running) { I.running = want; if (want) kick(); }
  }

  /* ------------------------------------------------------------------ *
   * Ken Burns helper
   * ------------------------------------------------------------------ */
  let kbIO = null;
  function kbObserver() {
    if (kbIO === null) {
      kbIO = ('IntersectionObserver' in global)
        ? new global.IntersectionObserver((entries) => {
          for (const e of entries) {
            const on = e.isIntersecting, host = e.target;
            host.querySelectorAll('.fx-kenburns').forEach((n) => n.classList.toggle('fx-kb-paused', !on));
          }
        }, { rootMargin: '80px' })
        : false;
    }
    return kbIO;
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function kbApplyTo(node, variant, delay) {
    node.classList.add('fx-kenburns');
    if (variant) node.classList.add('fx-kb-v' + variant);
    node.style.animationDelay = delay;
  }
  // keep an fx canvas in lock-step with its photo's Ken Burns drift so overlays stay aligned
  function kbSync(img, canvas) {
    if (!img || !canvas || !img.classList.contains('fx-kenburns')) return;
    const v = ['1', '2', '3'].find((k) => img.classList.contains('fx-kb-v' + k));
    kbApplyTo(canvas, v ? +v : 0, img.style.animationDelay || '0s');
    try {
      const a = img.getAnimations && img.getAnimations()[0], b = canvas.getAnimations && canvas.getAnimations()[0];
      if (a && b && a.currentTime != null) b.currentTime = a.currentTime;
    } catch (e) { /* ignore */ }
  }
  function kenBurns(img) {
    if (!img || !img.classList) return { destroy() {} };
    injectCSS();
    const src = img.getAttribute('src') || '';
    const variant = hashStr(src) % 4;
    const delay = '-' + (hashStr(src + '#') % 26000) / 1000 + 's';
    kbApplyTo(img, variant, delay);
    const host = img.parentElement;
    if (host) {
      try { if (global.getComputedStyle(host).overflow === 'visible') host.style.overflow = 'hidden'; } catch (e) { /* ignore */ }
      const cv = host.querySelector(':scope > .fx-canvas');
      if (cv) kbSync(img, cv);
      const o = kbObserver(); if (o) o.observe(host);
    }
    return {
      destroy() {
        [img, host && host.querySelector(':scope > .fx-canvas')].forEach((n) => {
          if (!n) return;
          n.classList.remove('fx-kenburns', 'fx-kb-v1', 'fx-kb-v2', 'fx-kb-v3', 'fx-kb-paused');
          n.style.animationDelay = '';
        });
        if (host && kbIO) kbIO.unobserve(host);
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */
  function mount(el, type, opts) {
    const noop = { destroy() {}, setActive() {}, type: 'mist', canvas: null };
    if (!el || !el.appendChild) return noop;
    injectCSS();
    opts = opts || {};
    type = String(type || '').toLowerCase().trim();
    if (!FXS[type]) type = 'mist';
    if (el.__fxInst) el.__fxInst.api.destroy();

    try { if (global.getComputedStyle(el).position === 'static') el.style.position = 'relative'; } catch (e) { /* ignore */ }

    const I = new Inst(el, type, opts);
    const cv = doc.createElement('canvas');
    cv.className = 'fx-canvas';
    cv.setAttribute('aria-hidden', 'true');
    cv.setAttribute('data-fx', type);
    if (I.fx.blend === 'normal') cv.setAttribute('data-blend', 'normal');
    I.canvas = cv;
    I.ctx = cv.getContext('2d');
    if (!I.ctx) return noop;
    // sit directly above the photo (below captions / scrims that follow it)
    if (I.img && I.img.parentNode === el) el.insertBefore(cv, I.img.nextSibling); else el.appendChild(cv);
    kbSync(I.img, cv);

    if (I.img && !(I.img.complete && I.img.naturalWidth)) {
      I.onImg = () => { I.dirty = true; if (!I.running) sync(I); };
      I.img.addEventListener('load', I.onImg);
    }

    el.__fxInst = I;
    live.add(I);
    stats.mounted = live.size;
    const o = getIO(); if (o) o.observe(el);
    const r = getRO(); if (r) r.observe(el);

    const api = {
      type: type,
      canvas: cv,
      setActive(on) { if (I.dead) return; I.enabled = !!on; sync(I); },
      destroy() {
        if (I.dead) return;
        I.dead = true; I.running = false;
        live.delete(I); stats.mounted = live.size;
        if (io) io.unobserve(el);
        if (ro) ro.unobserve(el);
        if (I.onImg && I.img) I.img.removeEventListener('load', I.onImg);
        if (cv.parentNode) cv.parentNode.removeChild(cv);
        if (el.__fxInst === I) el.__fxInst = null;
        I.s = {};
      }
    };
    I.api = api;
    sync(I);
    return api;
  }

  global.FX = {
    __fx: 1,
    version: '1.0.0',
    types: TYPES.slice(),
    hints: HINTS,
    fingerprint: (img) => (img && img.naturalWidth ? imgFingerprint(img) : null),
    stats: stats,
    mount: mount,
    kenBurns: kenBurns,
    pauseAll() { globalOn = false; live.forEach(sync); },
    resumeAll() { globalOn = true; live.forEach(sync); },
    destroyAll() { Array.from(live).forEach((I) => I.api.destroy()); }
  };
})(typeof window !== 'undefined' ? window : this);
