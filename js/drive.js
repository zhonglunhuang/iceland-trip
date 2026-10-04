/* =========================================================
   drive.js — "ON THE ROAD" interludes
   Scroll-driven, first-person Ring Road drives inserted between
   day chapters: evening of day N-1 → night (stars + aurora) →
   dawn of day N, with a glass HUD (odometer / clock / temp / next stop).

   API
     Drive.create(fromDay, toDay[, opts]) -> <section class="drive-interlude">
         fromDay / toDay: day object from TRIP.days or its id ('d1'…)
         opts.height        section height (CSS length, default '180vh')
         opts.reducedMotion force static mode (default: prefers-reduced-motion)
     Drive.mountAll([opts]) -> number of interludes inserted
         opts.daySelector   default '[data-day]'
         opts.attr          attribute holding the day id (default 'data-day')
         opts.root          element/document to search (default document)
         opts.routesOnly    only before days that have a ROUTE entry (default true;
                            skips the flight days d10/d11)
         opts.refresh       call ScrollTrigger.refresh() after inserting (default true)
     Drive.km(dayId)        -> approx. route km for that day (haversine), fallback 200
     Drive.direction(dayId) -> '東' | '北' | '西' | '南' (net bearing of the day's route)
     Drive.refresh()        -> re-measure every interlude (+ ScrollTrigger.refresh)
     Drive.destroyAll([removeElements])
     Drive.instances        -> live instances [{ el, from, to, destroy(), refresh() }]

   Runtime: progress is read from getBoundingClientRect() each tick (immune to
   other ScrollTrigger pins); the render loop runs on gsap.ticker when GSAP is
   present (stays in sync with Lenis / ScrollTrigger), otherwise on rAF; it only
   runs while an interlude intersects the viewport (IntersectionObserver, with a
   scroll-listener fallback). Canvas DPR is capped at 2 (plus a pixel budget).
   ========================================================= */
(function (root) {
  'use strict';

  const doc = root.document;
  if (!doc || (root.Drive && root.Drive.version)) return;

  const TAU = Math.PI * 2;
  const IDLE_SPEED = 7;         // m/s the car creeps at when you stop scrolling
  const SPEED_PER_SCREEN = 14;  // extra m/s per (viewport height / second) of scroll
  const PIXEL_BUDGET = 4.2e6;   // max backing-store pixels per canvas

  /* ---------------- small helpers ---------------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mod = (v, m) => ((v % m) + m) % m;
  const pad2 = (n) => { n = Math.floor(Math.abs(n)); return (n < 10 ? '0' : '') + n; };
  const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fmtTemp = (n) => { const r = Math.round(n); return (r < 0 ? '−' : '') + Math.abs(r); };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const scrollY = () => root.pageYOffset || (doc.documentElement && doc.documentElement.scrollTop) || 0;
  const now = () => (root.performance && root.performance.now ? root.performance.now() : Date.now()) / 1000;

  function hashStr(s) {
    let h = 2166136261;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- colour ---------------- */
  function hex(c) {
    let s = String(c || '').trim().replace('#', '');
    if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
    const n = parseInt(s, 16);
    if (s.length !== 6 || isNaN(n)) return [127, 227, 255];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgba = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a == null ? 1 : +a.toFixed(3)) + ')';
  const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

  /* ---------------- data access ---------------- */
  const tripDays = () => (root.TRIP && Array.isArray(root.TRIP.days) ? root.TRIP.days : []);
  const routes = () => (Array.isArray(root.ROUTE) ? root.ROUTE : null);
  const dayNum = (d) => { const n = parseInt(String((d && d.id) || '').replace(/\D/g, ''), 10); return isNaN(n) ? 0 : n; };

  function getDay(d) {
    if (d && typeof d === 'object') return d;
    const id = String(d == null ? '' : d);
    return tripDays().find((x) => x && x.id === id) || { id: id, title: id };
  }
  function idOf(d) { return d && typeof d === 'object' ? String(d.id || '') : String(d == null ? '' : d); }

  const validPt = (p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]);
  function routeLines(dayId) {
    const R = routes();
    if (!R) return [];
    const r = R.find((x) => x && x.day === dayId);
    if (!r || !Array.isArray(r.lines)) return [];
    return r.lines.filter((l) => Array.isArray(l) && l.length > 1);
  }
  function hasRoute(dayId) { return routeLines(idOf(dayId)).length > 0; }

  function haversine(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  const kmCache = Object.create(null);
  function km(dayId) {
    const id = idOf(dayId);
    if (kmCache[id] != null) return kmCache[id];
    let total = 0;
    routeLines(id).forEach((line) => {
      for (let i = 1; i < line.length; i++) if (validPt(line[i - 1]) && validPt(line[i])) total += haversine(line[i - 1], line[i]);
    });
    return (kmCache[id] = total > 1 ? Math.round(total) : 200);
  }

  function direction(dayId) {
    const lines = routeLines(idOf(dayId));
    if (!lines.length) return '東';
    const main = lines.reduce((a, b) => (b.length > a.length ? b : a));
    const a = main[0], b = main[main.length - 1];
    if (!validPt(a) || !validPt(b)) return '東';
    const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
    const dy = b[1] - a[1];
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? '東' : '西';
    return dy >= 0 ? '北' : '南';
  }

  function meanLat(day) {
    let sum = 0, n = 0;
    routeLines(day.id).forEach((l) => { for (let i = 0; i < l.length; i += 8) if (validPt(l[i])) { sum += l[i][1]; n++; } });
    if (!n) (day.spots || []).forEach((s) => { if (isFinite(s.lat)) { sum += +s.lat; n++; } });
    return n ? sum / n : 64.5;
  }

  function cumulativeBefore(day) {
    const list = tripDays();
    const idx = list.findIndex((d) => d && d.id === day.id);
    let total = 0;
    for (let i = 0; i < idx; i++) if (hasRoute(list[i].id)) total += km(list[i].id);
    return total;
  }

  const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : NaN; };
  function sunTime(day, key, fallback) {
    if (day.sun && isFinite(toMin(day.sun[key]))) return day.sun[key];
    const list = tripDays();
    const idx = Math.max(0, list.findIndex((d) => d && d.id === day.id));
    let best = null, bestD = 1e9;
    list.forEach((d, i) => {
      if (d && d.sun && isFinite(toMin(d.sun[key])) && Math.abs(i - idx) < bestD) { bestD = Math.abs(i - idx); best = d.sun[key]; }
    });
    return best || fallback;
  }

  const NIGHT_LINES = [
    '北方的夜，好安靜', '整條公路只剩我們', '極光在頭頂醒來', '車燈切開黑夜', '星星多到數不完',
    '暖氣開強，音樂大聲', '綠光在窗外跳舞', '只聽得見輪胎的聲音', '路標一根根往後飛', '再撐一下，天就亮了',
  ];

  function computeInfo(from, to) {
    const n = dayNum(to);
    const setStr = sunTime(from, 'set', '18:20');
    const riseStr = sunTime(to, 'rise', '07:50');
    const setMin = toMin(setStr), riseMin = toMin(riseStr);
    const lat = meanLat(to);
    const t0 = Math.round(clamp(4.3 - (lat - 64) * 1.6, -3, 9));
    const wk = (d) => (d.weekday ? ' 星期' + d.weekday : '');
    return {
      n: n,
      dir: direction(to.id),
      firstLeg: !hasRoute(from.id),
      setStr: setStr, riseStr: riseStr,
      setMin: setMin, span: (1440 - setMin) + riseMin,
      total: km(to.id),
      cumBefore: cumulativeBefore(to),
      lat: lat, t0: t0, t1: t0 - 5,
      fromDate: from.date ? from.date + wk(from) : (to.date || '') + wk(to),
      toDate: to.date ? to.date + wk(to) : '',
      night: NIGHT_LINES[n % NIGHT_LINES.length],
    };
  }

  /* ---------------- CSS (injected once) ---------------- */
  const CSS = `
.drive-interlude{--dv-g:linear-gradient(90deg,#7fe3ff,#6bffb8 52%,#b38cff);position:relative;display:block;height:180vh;margin:0;padding:0;background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Noto Sans TC","PingFang TC",sans-serif;-webkit-font-smoothing:antialiased;isolation:isolate}
.drive-interlude *{box-sizing:border-box}
.drive__stage{position:-webkit-sticky;position:sticky;top:0;width:100%;height:100vh;overflow:hidden;contain:layout paint style;background:#000}
@supports (height:100svh){.drive__stage{height:100svh}}
.drive__canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.drive__shade{position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,#000 0%,rgba(0,0,0,.55) 6%,rgba(0,0,0,0) 20%,rgba(0,0,0,0) 74%,rgba(0,0,0,.55) 90%,#000 100%),radial-gradient(120% 90% at 50% 46%,rgba(0,0,0,0) 55%,rgba(0,0,0,.45) 100%)}
.drive__caps{position:absolute;z-index:1;left:0;right:0;top:13vh;display:grid;place-items:center;padding:0 20px;text-align:center;pointer-events:none}
.drive__caps::before{content:"";position:absolute;left:50%;top:50%;width:min(1100px,110vw);height:150%;transform:translate(-50%,-50%);background:radial-gradient(closest-side,rgba(0,0,0,.34),rgba(0,0,0,0));z-index:-1}
.drive__cap{grid-area:1/1;max-width:min(1120px,94vw);opacity:0;visibility:hidden;will-change:opacity,transform}
.drive__kicker{margin:0 0 14px;font-size:12px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:rgba(255,255,255,.74);text-shadow:0 1px 10px rgba(0,0,0,.55)}
.drive__big{margin:0;font-size:clamp(36px,8.8vw,132px);font-weight:800;line-height:1;letter-spacing:-.04em;background:var(--dv-g);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;text-wrap:balance;filter:drop-shadow(0 4px 30px rgba(0,0,0,.35));padding:.04em .02em .08em}
.drive__sub{margin:18px auto 0;max-width:34em;font-size:clamp(14px,1.45vw,19px);font-weight:500;line-height:1.5;letter-spacing:.01em;color:rgba(255,255,255,.82);text-wrap:balance;text-shadow:0 1px 14px rgba(0,0,0,.65)}
.drive__hud{position:absolute;z-index:2;left:50%;bottom:calc(22px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);width:min(940px,calc(100% - 32px));padding:14px 20px 16px;border-radius:24px;background:rgba(18,20,28,.4);-webkit-backdrop-filter:blur(22px) saturate(170%);backdrop-filter:blur(22px) saturate(170%);border:1px solid rgba(255,255,255,.14);box-shadow:0 24px 70px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.12);font-variant-numeric:tabular-nums}
.drive__hudhead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;font-size:11px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.58);white-space:nowrap}
.drive__live{display:inline-flex;align-items:center;gap:9px;color:#fff}
.drive__live i{width:7px;height:7px;border-radius:50%;background:#6bffb8;animation:drive-pulse 1.8s ease-out infinite}
.drive__road{flex:1;overflow:hidden;text-overflow:ellipsis;letter-spacing:.16em}
.drive__spd{text-transform:none;letter-spacing:.12em}.drive__spd b{color:#fff;font-weight:700;letter-spacing:0}
.drive__grid{display:grid;grid-template-columns:1.1fr .9fr .75fr 1.9fr}
.drive__cell{min-width:0;padding:0 16px;border-left:1px solid rgba(255,255,255,.1)}
.drive__cell:first-child{padding-left:0;border-left:0}
.drive__lbl{display:block;margin-bottom:5px;font-size:11px;font-weight:600;letter-spacing:.14em;color:rgba(255,255,255,.55);white-space:nowrap}
.drive__val{display:flex;align-items:baseline;font-size:clamp(22px,2.5vw,32px);font-weight:700;line-height:1.1;letter-spacing:-.02em;white-space:nowrap}
.drive__next{display:block;font-size:clamp(17px,1.6vw,22px);overflow:hidden;text-overflow:ellipsis;background:var(--dv-g);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
.drive__subv{display:block;margin-top:4px;font-size:12px;font-weight:500;color:rgba(255,255,255,.58);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.drive__subv b{color:rgba(255,255,255,.85);font-weight:600}
.drive__odo{display:inline-flex;-webkit-mask-image:linear-gradient(180deg,transparent,#000 22%,#000 78%,transparent);mask-image:linear-gradient(180deg,transparent,#000 22%,#000 78%,transparent)}
.drive__dg{display:block;height:1.1em;overflow:hidden;transition:opacity .4s}
.drive__dg.is-lead{opacity:.28}
.drive__dg b{display:block;font-weight:inherit;will-change:transform}
.drive__dg i{display:block;width:.62em;height:1.1em;line-height:1.1em;font-style:normal;text-align:center}
.drive__unit{margin-left:5px;font-size:.46em;font-weight:600;letter-spacing:.02em;color:rgba(255,255,255,.6)}
.drive__bar{position:relative;height:2px;margin-top:14px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden}
.drive__bar i{position:absolute;inset:0;transform-origin:0 50%;transform:scaleX(0);background:var(--dv-g)}
.drive__sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:-1px;padding:0;border:0}
@keyframes drive-pulse{0%{box-shadow:0 0 0 0 rgba(107,255,184,.6)}70%,100%{box-shadow:0 0 0 9px rgba(107,255,184,0)}}
@media (max-width:640px){
.drive__caps{top:12vh;padding:0 16px}
.drive__kicker{font-size:11px;letter-spacing:.24em;margin-bottom:10px}
.drive__big{font-size:clamp(40px,12.4vw,72px);line-height:1.04}
.drive__sub{margin-top:12px}
.drive__hud{width:calc(100% - 32px);bottom:calc(16px + env(safe-area-inset-bottom,0px));padding:12px 14px 14px;border-radius:20px}
.drive__hudhead{margin-bottom:10px;letter-spacing:.18em}
.drive__road{display:none}
.drive__grid{grid-template-columns:repeat(3,minmax(0,1fr));row-gap:12px}
.drive__cell{padding:0 10px}
.drive__cell--next{grid-column:1/-1;padding:12px 0 0;border-left:0;border-top:1px solid rgba(255,255,255,.1)}
.drive__val{font-size:22px}
.drive__next{font-size:18px}
.drive__subv{font-size:11px}
}
.drive-interlude.is-static{height:auto}
.drive-interlude.is-static .drive__stage{position:relative;height:auto;min-height:100vh;background:var(--dv-static,#05060b)}
@supports (height:100svh){.drive-interlude.is-static .drive__stage{min-height:100svh}}
.drive-interlude.is-static .drive__canvas{display:none}
.drive-interlude.is-static .drive__caps{top:16vh}
.drive-interlude.is-static .drive__cap:first-child{opacity:1;visibility:visible}
.drive-interlude.is-static .drive__cap+.drive__cap{display:none}
.drive-interlude.is-static .drive__bar i{transform:none}
@media (max-height:500px) and (orientation:landscape){.drive__caps{top:6vh}.drive__big{font-size:clamp(28px,6.2vw,60px)}.drive__sub{display:none}.drive__hud{bottom:10px;padding:10px 14px 12px}.drive__hud .drive__subv,.drive__bar{display:none}.drive__hudhead{margin-bottom:6px}}
@media (prefers-reduced-motion:reduce){.drive__live i{animation:none}.drive__dg{transition:none}}
`;

  function injectCSS() {
    if (doc.getElementById('drive-css')) return;
    const st = doc.createElement('style');
    st.id = 'drive-css';
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  /* ---------------- procedural terrain ---------------- */
  const PN = 1024;
  function makeProfile(rand, kind) {
    const out = new Float32Array(PN);
    const terms = [];
    if (kind === 'ridge') [3, 5, 8, 13, 21].forEach((k) => terms.push({ k: k, a: (0.55 + rand() * 0.45) / Math.pow(k, 0.62), p: rand() * TAU }));
    else if (kind === 'jitter') [9, 17, 31, 53].forEach((k) => terms.push({ k: k, a: 1 / Math.sqrt(k), p: rand() * TAU }));
    else [1, 2, 3, 5, 8].forEach((k) => terms.push({ k: k + (kind === 'hills2' ? 1 : 0), a: (0.5 + rand() * 0.5) / Math.pow(k, 1.1), p: rand() * TAU }));
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < PN; i++) {
      const u = i / PN;
      let v = 0;
      for (const t of terms) {
        v += kind === 'ridge'
          ? t.a * Math.pow(1 - Math.abs(Math.sin(Math.PI * t.k * u + t.p)), 1.7)
          : t.a * Math.sin(TAU * t.k * u + t.p);
      }
      out[i] = v; if (v < lo) lo = v; if (v > hi) hi = v;
    }
    for (let i = 0; i < PN; i++) out[i] = (out[i] - lo) / (hi - lo || 1);
    return out;
  }
  function sample(prof, u) {
    const x = mod(u, 1) * PN, i = Math.floor(x), f = x - i;
    return prof[i % PN] * (1 - f) + prof[(i + 1) % PN] * f;
  }

  function makeAuroraTex(rand) {
    const c = doc.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    if (!g) return null;
    const grd = g.createLinearGradient(0, 128, 0, 0);
    grd.addColorStop(0, 'rgba(120,255,190,0)');
    grd.addColorStop(0.1, 'rgba(150,255,200,.9)');
    grd.addColorStop(0.18, 'rgba(107,255,184,.75)');
    grd.addColorStop(0.45, 'rgba(70,220,180,.32)');
    grd.addColorStop(0.75, 'rgba(110,160,255,.14)');
    grd.addColorStop(1, 'rgba(179,140,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 128);
    // vertical rays: knock out alpha in smooth-random columns
    g.globalCompositeOperation = 'destination-out';
    const f1 = 3 + Math.floor(rand() * 4), f2 = 9 + Math.floor(rand() * 6), f3 = 23 + Math.floor(rand() * 9);
    const p1 = rand() * TAU, p2 = rand() * TAU, p3 = rand() * TAU;
    for (let x = 0; x < 256; x++) {
      const u = x / 256;
      const v = 0.5 + 0.22 * Math.sin(TAU * f1 * u + p1) + 0.18 * Math.sin(TAU * f2 * u + p2) + 0.1 * Math.sin(TAU * f3 * u + p3);
      g.fillStyle = 'rgba(0,0,0,' + clamp(1 - v * 1.25 + rand() * 0.12, 0, 0.92).toFixed(3) + ')';
      g.fillRect(x, 0, 1, 128);
    }
    return c;
  }

  function buildPalette(accFrom, accTo) {
    const A = hex(accFrom), B = hex(accTo);
    const k = (t, top, mid, hor) => ({ t: t, top: top, mid: mid, hor: hor });
    return [
      k(0.00, hex('#1c2a54'), mix(hex('#c36a7e'), A, 0.25), mix(hex('#ffb070'), A, 0.28)),
      k(0.14, hex('#131b40'), mix(hex('#783e71'), A, 0.18), mix(hex('#ff7a4e'), A, 0.2)),
      k(0.28, hex('#080c22'), hex('#1c2350'), hex('#553a6b')),
      k(0.46, hex('#020309'), hex('#050b1a'), hex('#0b1d2a')),
      k(0.66, hex('#02040b'), hex('#071026'), hex('#112645')),
      k(0.84, hex('#0d1d44'), hex('#2b4c88'), hex('#86a2d0')),
      k(1.00, hex('#27457f'), mix(hex('#9a8cc8'), B, 0.18), mix(hex('#ffb4a2'), B, 0.22)),
    ];
  }
  function samplePalette(P, t, out) {
    let i = 0;
    while (i < P.length - 2 && t > P[i + 1].t) i++;
    const a = P[i], b = P[i + 1];
    let k = clamp((t - a.t) / (b.t - a.t), 0, 1);
    k = k * k * (3 - 2 * k);
    out.top = mix(a.top, b.top, k); out.mid = mix(a.mid, b.mid, k); out.hor = mix(a.hor, b.hor, k);
    return out;
  }

  /* ---------------- the Canvas2D road scene ---------------- */
  function createScene(canvas, opt) {
    let ctx = null;
    try { ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) return null;

    const rand = mulberry32(opt.seed >>> 0);
    const pal = buildPalette(opt.accFrom, opt.accTo);
    const sunCol = mix(hex('#ffc27a'), hex(opt.accFrom), 0.25);
    const dawnCol = mix(hex('#ffb3a6'), hex(opt.accTo), 0.2);
    const C = { top: [0, 0, 0], mid: [0, 0, 0], hor: [0, 0, 0] };
    const ridge = makeProfile(rand, 'ridge');
    const hillsA = makeProfile(rand, 'hills');
    const hillsB = makeProfile(rand, 'hills2');
    const snowJ = makeProfile(rand, 'jitter');
    const tex = makeAuroraTex(rand);
    const offs = [rand() * 4000, rand() * 4000, rand() * 4000];
    const cph = [rand() * TAU, rand() * TAU, rand() * TAU, rand() * TAU];
    const HALF_W = 1.75;                  // half road width (m)
    const TUFT_P = 90;                    // tuft pattern period (m)
    const tufts = [];
    for (let i = 0; i < 40; i++) {
      tufts.push({ X: (i % 2 ? 1 : -1) * (HALF_W + 1.4 + Math.pow(rand(), 1.5) * 15), z: rand() * TUFT_P, w: 0.3 + rand() * 1.1, h: 0.12 + rand() * 0.5, moss: rand() < 0.55 });
    }

    // gentle, bounded bends: curvature(s) and its integral heading(s)
    const A1 = 0.0011, L1 = 230, A2 = 0.00055, L2 = 95;
    const curvAt = (s) => A1 * Math.sin(s / L1 + cph[0]) + A2 * Math.sin(s / L2 + cph[1]);
    const headAt = (s) => -A1 * L1 * Math.cos(s / L1 + cph[0]) - A2 * L2 * Math.cos(s / L2 + cph[1]);
    const railOn = (w) => Math.sin(w / 170 + cph[2]) + 0.45 * Math.sin(w / 61 + cph[3]) > 0.1;

    let W = 0, H = 0, DPR = 1, hy0 = 0, f = 1, camH = 1, zNear = 1;
    let stars = null, ys = new Float32Array(8), xs = new Float32Array(8);
    const NZ = 48;
    const zs = new Float32Array(NZ), yz = new Float32Array(NZ), cz = new Float32Array(NZ), sz = new Float32Array(NZ);
    const STEP = 6;

    function resize() {
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) return false;
      let dpr = Math.min(2, root.devicePixelRatio || 1);
      if (cw * ch * dpr * dpr > PIXEL_BUDGET) dpr = Math.max(1, Math.sqrt(PIXEL_BUDGET / (cw * ch)));
      const bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      W = cw; H = ch; DPR = dpr;
      const aspect = W / H;
      hy0 = H * (aspect >= 1 ? 0.56 : 0.6);
      f = Math.max(W, H * 0.75) * 0.5 / Math.tan(36 * Math.PI / 180);
      const r = aspect >= 1 ? 0.42 : lerp(0.95, 0.42, clamp((aspect - 0.45) / 0.55, 0, 1));
      camH = r * HALF_W;
      zNear = camH * f / (H - hy0) * 0.9;
      const n = Math.ceil((W + STEP * 2) / STEP) + 2;
      ys = new Float32Array(n); xs = new Float32Array(n);
      // stars live on a strip 1.6× the width so heading changes can scroll them
      const count = clamp(Math.round(W * hy0 / 2300), 70, 380);
      stars = [];
      for (let i = 0; i < count; i++) {
        stars.push({ u: rand(), v: Math.pow(rand(), 1.35) * 0.96, s: rand() < 0.88 ? 0.6 + rand() * 0.7 : 1.3 + rand() * 0.8, tw: 0.8 + rand() * 2.6, ph: rand() * TAU });
      }
      return true;
    }

    function ridgeLayer(prof, off, period, baseY, hpx, fill, keep) {
      ctx.beginPath();
      ctx.moveTo(-STEP, baseY + 3);
      let j = 0;
      for (let x = -STEP; x <= W + STEP; x += STEP, j++) {
        const u = (x + off) / period;
        const y = baseY - sample(prof, u) * hpx;
        ctx.lineTo(x, y);
        if (keep) { xs[j] = x; ys[j] = y; }
      }
      ctx.lineTo(W + STEP, baseY + 3);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      return j;
    }

    function draw(t, s, time, speed) {
      if (!W) return;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      samplePalette(pal, t, C);

      const night = smooth(0.14, 0.34, t) * (1 - smooth(0.76, 0.93, t));
      const aur = smooth(0.28, 0.44, t) * (1 - smooth(0.66, 0.8, t));
      const dusk = 1 - smooth(0.02, 0.3, t);
      const dawn = smooth(0.72, 0.98, t);
      const L = 1 - 0.86 * night;                                       // ambient light
      const hl = smooth(0.08, 0.28, t) * (1 - smooth(0.86, 0.98, t));   // headlights
      const curv = curvAt(s + 40);
      const shift = headAt(s) * f;                                      // px the far world slides
      const bob = (Math.sin(time * 11.3) * 0.6 + Math.sin(time * 6.7 + 1) * 0.4) * Math.min(1, Math.abs(speed) / 40) * 1.3;
      const hy = hy0 + bob;
      const portrait = W < H;

      /* sky */
      let g = ctx.createLinearGradient(0, 0, 0, hy);
      g.addColorStop(0, rgba(C.top)); g.addColorStop(0.55, rgba(C.mid)); g.addColorStop(1, rgba(C.hor));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      ctx.globalCompositeOperation = 'lighter';
      /* sunset / sunrise glow + disc */
      const glow = (x, col, a, rr) => {
        const gg = ctx.createRadialGradient(x, hy, 0, x, hy, rr);
        gg.addColorStop(0, rgba(col, a)); gg.addColorStop(0.35, rgba(col, a * 0.35)); gg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = gg;
        ctx.fillRect(x - rr, hy - rr, rr * 2, rr * 2);
      };
      const R = Math.max(W, H) * 0.75;
      if (dusk > 0.01) glow(W * (portrait ? 0.7 : 0.74) - shift * 0.6, sunCol, 0.42 * dusk, R);
      if (dawn > 0.01) glow(W * (portrait ? 0.4 : 0.36) - shift * 0.6, dawnCol, 0.4 * dawn, R);
      const disc = (x, y, col, a) => {
        const r = Math.min(W, H) * 0.045;
        const gg = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
        gg.addColorStop(0, rgba([255, 244, 222], a)); gg.addColorStop(0.3, rgba([255, 236, 200], a * 0.95));
        gg.addColorStop(0.36, rgba(col, a * 0.35)); gg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = gg;
        ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
      };
      if (t < 0.24) disc(W * (portrait ? 0.7 : 0.74) - shift * 0.6, hy - H * 0.07 + smooth(0, 0.22, t) * H * 0.13, sunCol, 1 - smooth(0.12, 0.24, t));
      if (t > 0.86) disc(W * (portrait ? 0.4 : 0.36) - shift * 0.6, hy + H * 0.035 - smooth(0.88, 1, t) * H * 0.075, dawnCol, smooth(0.86, 0.95, t));

      /* stars */
      if (night > 0.01 && stars) {
        const Ps = W * 1.6;
        ctx.fillStyle = '#fff';
        for (let i = 0; i < stars.length; i++) {
          const st = stars[i];
          const x = mod(st.u * Ps - shift, Ps);
          if (x > W) continue;
          const a = night * (0.72 + 0.28 * Math.sin(time * st.tw + st.ph)) * (1 - smooth(0.62, 0.98, st.v));
          if (a < 0.02) continue;
          ctx.globalAlpha = a;
          ctx.fillRect(x, st.v * hy, st.s, st.s);
        }
        ctx.globalAlpha = 1;
      }

      /* aurora: sky glow + two moving curtains */
      if (aur > 0.01 && tex) {
        const gx = W * 0.5 - shift * 0.8;
        const gg = ctx.createRadialGradient(gx, hy * 0.5, 0, gx, hy * 0.5, Math.max(W, hy) * 0.7);
        gg.addColorStop(0, rgba([40, 255, 160], 0.13 * aur)); gg.addColorStop(1, 'rgba(40,255,160,0)');
        ctx.fillStyle = gg;
        ctx.fillRect(0, 0, W, hy + 4);
        const sw = 7;
        const ph0 = shift / W * 1.2;
        const ribbon = (base, amp, height, strength, seed) => {
          for (let x = -sw; x < W + sw; x += sw) {
            const u = x / W;
            const ph = u * 5.2 + time * 0.12 + ph0 + seed;
            const yb = base + Math.sin(ph) * amp + Math.sin(ph * 2.7 + time * 0.31 + seed) * amp * 0.35;
            const h = height * (0.55 + 0.45 * Math.sin(u * 9.1 - time * 0.23 + 1.3 + seed));
            const a = strength * aur * (0.25 + 0.75 * Math.max(0, Math.sin(u * 3.3 + time * 0.17 + 0.6 + seed)));
            if (a < 0.01) continue;
            ctx.globalAlpha = a;
            ctx.drawImage(tex, mod(x * 0.9 + time * 14 + seed * 50 + shift * 0.4, 254), 0, 2, 128, x, yb - h, sw + 0.8, h);
          }
        };
        ribbon(hy * 0.6, hy * 0.08, hy * 0.46, 0.9, 0);
        ribbon(hy * 0.4, hy * 0.06, hy * 0.32, 0.45, 2.4);
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';

      /* far snowy peaks */
      const mH = Math.min(H * 0.2, W * 0.24, hy * 0.36);
      const farC = mix(mix(C.hor, [26, 34, 58], 0.5), [6, 8, 14], (1 - L) * 0.72);
      const span = Math.max(W, 700);
      const nPts = ridgeLayer(ridge, offs[0] + shift, span * 2.4, hy + 1, mH, rgba(farC), true);
      // snow caps above the snowline
      const snowY = hy + 1 - mH * 0.5;
      const snowC = mix(mix([255, 255, 255], C.hor, 0.35), farC, (1 - L) * 0.62);
      ctx.beginPath();
      for (let j = 0; j < nPts; j++) ctx.lineTo(xs[j], ys[j]);
      for (let j = nPts - 1; j >= 0; j--) {
        const u = (xs[j] + offs[0] + shift) / (span * 2.4);
        const line = snowY + (sample(snowJ, u * 3) - 0.5) * mH * 0.22;
        ctx.lineTo(xs[j], Math.max(ys[j], line));
      }
      ctx.closePath();
      g = ctx.createLinearGradient(0, hy - mH, 0, snowY + mH * 0.12);
      g.addColorStop(0, rgba(snowC)); g.addColorStop(1, rgba(mix(snowC, farC, 0.45)));
      ctx.fillStyle = g;
      ctx.fill();
      // atmospheric haze on the horizon
      g = ctx.createLinearGradient(0, hy - mH * 0.7, 0, hy + 6);
      g.addColorStop(0, rgba(C.hor, 0)); g.addColorStop(1, rgba(C.hor, 0.4 * (0.4 + 0.6 * L)));
      ctx.fillStyle = g;
      ctx.fillRect(0, hy - mH * 0.7, W, mH * 0.7 + 6);

      /* rolling hills */
      const midC = mix(farC, [4, 5, 8], 0.5);
      const nearC = mix(farC, [2, 3, 4], 0.74);
      ridgeLayer(hillsA, offs[1] + shift * 1.06 + s * 0.08, span * 1.7, hy + 2, mH * 0.48, rgba(midC), false);
      ridgeLayer(hillsB, offs[2] + shift * 1.14 + s * 0.25, span * 1.2, hy + 3, mH * 0.24, rgba(nearC), false);

      /* ground */
      const groundFar = mix(nearC, C.hor, 0.1);
      g = ctx.createLinearGradient(0, hy, 0, H);
      g.addColorStop(0, rgba(groundFar)); g.addColorStop(1, rgba(mix([10, 10, 12], [2, 2, 3], 1 - L)));
      ctx.fillStyle = g;
      ctx.fillRect(0, hy + 2, W, H - hy);

      /* road samples (perspective) */
      const zFar = 420, lr = Math.log(zFar / zNear);
      for (let i = 0; i < NZ; i++) {
        const z = zNear * Math.exp(lr * i / (NZ - 1));
        zs[i] = z; yz[i] = hy + camH * f / z; cz[i] = W / 2 + curv * 0.5 * z * f; sz[i] = f / z;
      }
      const strip = (X0, X1, zMax, fill) => {
        let n = NZ - 1;
        while (n > 1 && zs[n] > zMax) n--;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) ctx.lineTo(cz[i] + X0 * sz[i], yz[i]);
        for (let i = n; i >= 0; i--) ctx.lineTo(cz[i] + X1 * sz[i], yz[i]);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      };
      const fogGrad = (col, aFar) => {
        const gg = ctx.createLinearGradient(0, hy, 0, hy + (H - hy) * 0.3);
        gg.addColorStop(0, rgba(col, aFar)); gg.addColorStop(1, rgba(col, 1));
        return gg;
      };
      // gravel shoulders
      const shoulderC = mix(mix([58, 54, 50], groundFar, 0.35), [6, 6, 7], (1 - L) * 0.85);
      strip(-HALF_W - 1.1, HALF_W + 1.1, zFar, fogGrad(shoulderC, 0.25));
      // asphalt
      const asph = mix([46, 49, 55], [11, 12, 15], 1 - L);
      g = ctx.createLinearGradient(0, hy, 0, H);
      g.addColorStop(0, rgba(mix(asph, C.hor, 0.55))); g.addColorStop(0.25, rgba(asph)); g.addColorStop(1, rgba(scale(asph, 0.8)));
      strip(-HALF_W, HALF_W, zFar, g);
      // edge lines + centre dashes
      const lineC = mix([236, 230, 214], [70, 72, 78], (1 - L) * 0.55);
      const lineFill = fogGrad(lineC, 0.12);
      strip(-HALF_W + 0.12, -HALF_W + 0.24, 300, lineFill);
      strip(HALF_W - 0.24, HALF_W - 0.12, 300, lineFill);
      {
        const P = 12, D = 3.2, w = 0.075;
        ctx.beginPath();
        for (let k = Math.ceil((s + zNear - D) / P); k * P - s < 200; k++) {
          const za = Math.max(k * P - s, zNear), zb = k * P - s + D;
          if (zb <= za) continue;
          const ya = hy + camH * f / za, yb = hy + camH * f / zb;
          const ca = W / 2 + curv * 0.5 * za * f, cb = W / 2 + curv * 0.5 * zb * f;
          const sa = f / za, sb = f / zb;
          ctx.moveTo(ca - w * sa, ya); ctx.lineTo(ca + w * sa, ya); ctx.lineTo(cb + w * sb, yb); ctx.lineTo(cb - w * sb, yb); ctx.closePath();
        }
        ctx.fillStyle = lineFill;
        ctx.fill();
      }

      /* lava rocks + moss tufts streaming past */
      const rockC = mix(mix([22, 21, 20], groundFar, 0.25), [2, 2, 3], (1 - L) * 0.8);
      const mossC = mix(mix([62, 74, 50], groundFar, 0.35), [3, 4, 3], (1 - L) * 0.85);
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        for (let i = 0; i < tufts.length; i++) {
          const tf = tufts[i];
          if (tf.moss !== (pass === 1)) continue;
          for (let rep = 0; rep < 3; rep++) {
            const z = mod(tf.z - s, TUFT_P) + rep * TUFT_P;
            if (z < zNear || z > 240) continue;
            const sc = f / z, x = W / 2 + curv * 0.5 * z * f + tf.X * sc, yg = hy + camH * f / z;
            const ww = tf.w * sc, hh = tf.h * sc;
            if (x + ww < 0 || x - ww > W || ww < 0.6) continue;
            ctx.moveTo(x - ww / 2, yg + 0.5);
            ctx.quadraticCurveTo(x - ww * 0.2, yg - hh * 1.6, x + ww * 0.12, yg - hh * 0.9);
            ctx.quadraticCurveTo(x + ww * 0.42, yg - hh * 0.6, x + ww / 2, yg + 0.5);
            ctx.closePath();
          }
        }
        ctx.fillStyle = fogGrad(pass ? mossC : rockC, 0);
        ctx.fill();
      }

      /* roadside marker posts (both sides) with reflectors */
      const postC = mix([208, 176, 70], [26, 22, 12], (1 - L) * 0.85);
      const postDark = mix([30, 31, 34], [6, 6, 8], 1 - L);
      const refl = [];
      const markers = (X, phase) => {
        const SP = 40;
        const bodies = [], tops = [];
        for (let k = Math.floor((s + 260 + phase) / SP); k * SP - phase - s > zNear; k--) {
          const z = k * SP - phase - s;
          if (z > 260) continue;
          const sc = f / z, x = W / 2 + curv * 0.5 * z * f + X * sc;
          const yg = hy + camH * f / z, ytop = hy + (camH - 1.0) * f / z;
          const pw = Math.max(1, 0.12 * sc);
          bodies.push(x - pw / 2, ytop, pw, yg - ytop);
          tops.push(x - pw / 2, ytop, pw, (yg - ytop) * 0.22);
          refl.push(x, ytop + (yg - ytop) * 0.3, Math.max(0.7, 0.045 * sc), z);
        }
        ctx.beginPath();
        for (let i = 0; i < bodies.length; i += 4) ctx.rect(bodies[i], bodies[i + 1], bodies[i + 2], bodies[i + 3]);
        ctx.fillStyle = rgba(postDark); ctx.fill();
        ctx.beginPath();
        for (let i = 0; i < tops.length; i += 4) ctx.rect(tops[i], tops[i + 1], tops[i + 2], tops[i + 3]);
        ctx.fillStyle = rgba(postC); ctx.fill();
      };
      markers(-(HALF_W + 1.3), 0);
      markers(HALF_W + 1.5, 20);

      /* guard rail (right side, comes and goes) */
      {
        const RS = 3.6, X = HALF_W + 0.85;
        const railC = mix(mix([150, 160, 172], C.hor, 0.35), [14, 15, 18], (1 - L) * 0.8);
        ctx.beginPath();
        const band = [];
        for (let k = Math.floor((s + 170) / RS); k * RS - s > zNear * 0.8; k--) {
          if (!railOn(k * RS)) continue;
          const za = Math.max(k * RS - s, zNear * 0.8), zb = k * RS - s + RS;
          const sa = f / za, sb = f / zb;
          const xa = W / 2 + curv * 0.5 * za * f + X * sa, xb = W / 2 + curv * 0.5 * zb * f + X * sb;
          const ga = hy + camH * f / za;
          const ta = hy + (camH - 0.78) * f / za, tb = hy + (camH - 0.78) * f / zb;
          const ba = hy + (camH - 0.5) * f / za, bb = hy + (camH - 0.5) * f / zb;
          const pw = Math.max(1, 0.1 * sa);
          ctx.rect(xa - pw / 2, ta, pw, ga - ta);
          band.push(xa, ta, xb, tb, xb, bb, xa, ba);
        }
        ctx.fillStyle = rgba(postDark);
        ctx.fill();
        ctx.beginPath();
        for (let i = 0; i < band.length; i += 8) {
          ctx.moveTo(band[i], band[i + 1]); ctx.lineTo(band[i + 2], band[i + 3]); ctx.lineTo(band[i + 4], band[i + 5]); ctx.lineTo(band[i + 6], band[i + 7]); ctx.closePath();
        }
        ctx.fillStyle = fogGrad(railC, 0.2);
        ctx.fill();
        // top edge catches the sky / headlights
        ctx.beginPath();
        for (let i = 0; i < band.length; i += 8) {
          const ha = (band[i + 7] - band[i + 1]) * 0.28, hb = (band[i + 5] - band[i + 3]) * 0.28;
          ctx.moveTo(band[i], band[i + 1]); ctx.lineTo(band[i + 2], band[i + 3]); ctx.lineTo(band[i + 2], band[i + 3] + hb); ctx.lineTo(band[i], band[i + 1] + ha); ctx.closePath();
        }
        ctx.fillStyle = fogGrad(mix(mix(railC, [255, 255, 255], 0.35), [255, 214, 160], hl * 0.5), 0.15);
        ctx.globalAlpha = 0.55 + 0.35 * hl;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      /* headlights: warm pool on the road + glowing reflectors */
      if (hl > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        const cy = hy + (H - hy) * 0.5, cx = W / 2 + curv * 0.5 * 18 * f;
        const rr = portrait ? W * 0.95 : W * 0.5;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, portrait ? 0.5 : 0.36);
        const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
        gg.addColorStop(0, rgba([255, 226, 176], 0.2 * hl)); gg.addColorStop(0.5, rgba([255, 214, 160], 0.07 * hl)); gg.addColorStop(1, 'rgba(255,214,160,0)');
        ctx.fillStyle = gg;
        ctx.fillRect(-rr, -rr, rr * 2, rr * 2);
        ctx.restore();
        ctx.fillStyle = 'rgb(255,186,92)';
        for (let i = 0; i < refl.length; i += 4) {
          const a = hl * (1 - refl[i + 3] / 260);
          if (a < 0.03) continue;
          const r = refl[i + 2];
          ctx.globalAlpha = a;
          ctx.fillRect(refl[i] - r * 0.5, refl[i + 1] - r, r, r * 2);
          ctx.globalAlpha = a * 0.18;
          ctx.beginPath();
          ctx.arc(refl[i], refl[i + 1], r * 2.6, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    return { resize: resize, draw: draw };
  }

  /* ---------------- shared loop (gsap.ticker or rAF) ---------------- */
  const active = [];
  let running = false, tickerOwner = null, rafId = 0;
  function loop(time) { for (let i = 0; i < active.length; i++) active[i].tick(time); }
  function gsapTick(time) { loop(time); }
  function rafTick(ts) { if (!running) return; loop(ts / 1000); rafId = root.requestAnimationFrame(rafTick); }
  function startLoop() {
    if (running) return;
    running = true;
    const g = root.gsap;
    if (g && g.ticker && typeof g.ticker.add === 'function') { tickerOwner = g; g.ticker.add(gsapTick); }
    else rafId = root.requestAnimationFrame(rafTick);
  }
  function stopLoop() {
    running = false;
    if (tickerOwner) { tickerOwner.ticker.remove(gsapTick); tickerOwner = null; }
    if (rafId) { root.cancelAnimationFrame(rafId); rafId = 0; }
  }
  function setActive(inst, on) {
    const i = active.indexOf(inst);
    if (on && i < 0) { active.push(inst); startLoop(); }
    else if (!on && i >= 0) { active.splice(i, 1); if (!active.length) stopLoop(); }
  }

  /* visibility: IntersectionObserver, else scroll/resize polling */
  let io = null;
  const ioTargets = new Map();
  const fallbackTargets = new Set();
  function onFallbackScroll() {
    const vh = root.innerHeight;
    fallbackTargets.forEach((inst) => { const r = inst.el.getBoundingClientRect(); inst.setVisible(r.bottom > 0 && r.top < vh); });
  }
  function observe(inst) {
    if ('IntersectionObserver' in root) {
      if (!io) io = new root.IntersectionObserver((entries) => {
        entries.forEach((e) => { const it = ioTargets.get(e.target); if (it) it.setVisible(e.isIntersecting); });
      }, { rootMargin: '0px', threshold: 0 });
      ioTargets.set(inst.el, inst);
      io.observe(inst.el);
    } else {
      if (!fallbackTargets.size) {
        root.addEventListener('scroll', onFallbackScroll, { passive: true });
        root.addEventListener('resize', onFallbackScroll);
      }
      fallbackTargets.add(inst);
      root.requestAnimationFrame(onFallbackScroll);
    }
  }
  function unobserve(inst) {
    if (io && ioTargets.has(inst.el)) { io.unobserve(inst.el); ioTargets.delete(inst.el); }
    if (fallbackTargets.delete(inst) && !fallbackTargets.size) {
      root.removeEventListener('scroll', onFallbackScroll);
      root.removeEventListener('resize', onFallbackScroll);
    }
  }

  let resizeBound = false;
  function bindResize() {
    if (resizeBound || 'ResizeObserver' in root) return;
    resizeBound = true;
    let to = 0;
    root.addEventListener('resize', () => { clearTimeout(to); to = setTimeout(() => instances.forEach((i) => i.refresh()), 120); });
  }

  function prefersReduced() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  /* ---------------- markup ---------------- */
  function digitsHTML(n) {
    let col = '';
    for (let d = 0; d <= 10; d++) col += '<i>' + (d % 10) + '</i>';
    let out = '';
    for (let i = 0; i < n; i++) out += '<span class="drive__dg"><b>' + col + '</b></span>';
    return out;
  }

  function template(from, to, info) {
    const verb = info.firstLeg ? '出發往' : '繼續往';
    const caps = [
      ['ON THE ROAD · DAY ' + pad2(info.n), '第 ' + info.n + ' 天 · ' + verb + info.dir, '日落 ' + info.setStr + ' 上路 · 全程約 ' + fmtInt(info.total) + ' 公里'],
      ['深夜 · 北緯 ' + info.lat.toFixed(1) + '°', info.night, '關掉車內燈，抬頭看天空'],
      ['DAY ' + pad2(info.n) + (info.toDate ? ' · ' + info.toDate : ''), '天亮了', '日出 ' + info.riseStr + ' · 下一站 ' + (to.title || '')],
    ];
    const sub = [to.date ? to.date + (to.weekday ? ' 星期' + to.weekday : '') : '', to.subtitle || ''].filter(Boolean).join(' · ');
    return '' +
      '<div class="drive__stage">' +
        '<canvas class="drive__canvas" aria-hidden="true"></canvas>' +
        '<div class="drive__shade" aria-hidden="true"></div>' +
        '<div class="drive__caps">' +
          caps.map((c, i) =>
            '<div class="drive__cap"' + (i ? ' aria-hidden="true"' : '') + '>' +
              '<p class="drive__kicker">' + esc(c[0]) + '</p>' +
              '<p class="drive__big">' + esc(c[1]) + '</p>' +
              '<p class="drive__sub">' + esc(c[2]) + '</p>' +
            '</div>').join('') +
        '</div>' +
        '<div class="drive__hud" aria-hidden="true">' +
          '<div class="drive__hudhead">' +
            '<span class="drive__live"><i></i>ON THE ROAD</span>' +
            '<span class="drive__road">Route 1 · 一號公路 · 往' + esc(info.dir) + '</span>' +
            '<span class="drive__spd">時速 <b data-dv="spd">0</b> km/h</span>' +
          '</div>' +
          '<div class="drive__grid">' +
            '<div class="drive__cell drive__cell--odo"><span class="drive__lbl">今日里程</span>' +
              '<span class="drive__val"><span class="drive__odo">' + digitsHTML(4) + '</span><span class="drive__unit">km</span></span>' +
              '<span class="drive__subv">累計 <b data-dv="cum">' + fmtInt(info.cumBefore) + '</b> km</span></div>' +
            '<div class="drive__cell"><span class="drive__lbl">時間</span>' +
              '<span class="drive__val" data-dv="clock">' + esc(info.setStr) + '</span>' +
              '<span class="drive__subv" data-dv="date">' + esc(info.fromDate) + '</span></div>' +
            '<div class="drive__cell"><span class="drive__lbl">氣溫</span>' +
              '<span class="drive__val" data-dv="temp">' + fmtTemp(info.t0) + '°C</span>' +
              '<span class="drive__subv">北緯 ' + info.lat.toFixed(1) + '°</span></div>' +
            '<div class="drive__cell drive__cell--next"><span class="drive__lbl">NEXT STOP</span>' +
              '<span class="drive__val drive__next">下一站 · ' + esc(to.title || '') + '</span>' +
              '<span class="drive__subv">' + esc(sub) + '</span></div>' +
          '</div>' +
          '<div class="drive__bar"><i data-dv="bar"></i></div>' +
        '</div>' +
        '<p class="drive__sr">' + esc('從 ' + (info.fromDate || '') + ' 日落 ' + info.setStr + ' 開車到 ' + (info.toDate || '') + ' 日出 ' + info.riseStr +
          '，往' + info.dir + '約 ' + info.total + ' 公里，下一站：' + (to.title || '')) + '</p>' +
      '</div>';
  }

  function staticBackground(from, to) {
    const a = mix(hex('#ff9a62'), hex(from.accent), 0.3), b = mix(hex('#ffb4a2'), hex(to.accent), 0.25);
    return 'linear-gradient(180deg,rgba(0,0,0,0) 70%,#000 100%),' +
      'linear-gradient(115deg,' + rgba(a) + ' 0%,#5a2f5e 18%,#121233 36%,#04060d 52%,#0d1d44 70%,#2f5592 86%,' + rgba(b) + ' 100%)';
  }

  /* ---------------- instances ---------------- */
  const instances = [];

  function create(fromDay, toDay, opts) {
    opts = opts || {};
    injectCSS();
    const from = getDay(fromDay), to = getDay(toDay);
    const info = computeInfo(from, to);

    const el = doc.createElement('section');
    el.className = 'drive-interlude';
    el.setAttribute('data-drive-from', from.id || '');
    el.setAttribute('data-drive-to', to.id || '');
    el.setAttribute('aria-label', 'ON THE ROAD · 第 ' + info.n + ' 天 · 往' + info.dir + ' ' + info.total + ' 公里');
    el.innerHTML = template(from, to, info);

    const $ = (sel) => el.querySelector(sel);
    const stage = $('.drive__stage');
    const canvas = $('.drive__canvas');
    const caps = Array.prototype.slice.call(el.querySelectorAll('.drive__cap'));
    const digits = Array.prototype.slice.call(el.querySelectorAll('.drive__dg'));
    const strips = digits.map((d) => d.firstChild);
    const ui = {
      spd: $('[data-dv="spd"]'), cum: $('[data-dv="cum"]'), clock: $('[data-dv="clock"]'),
      date: $('[data-dv="date"]'), temp: $('[data-dv="temp"]'), bar: $('[data-dv="bar"]'),
    };

    const inst = { el: el, from: from, to: to, info: info };
    const reduced = opts.reducedMotion != null ? !!opts.reducedMotion : prefersReduced();
    const hasCanvas = !!(canvas && canvas.getContext);

    function setOdo(raw) {
      // mechanical feel: digits sit still and only roll during the last 30% of each km
      const v = Math.floor(raw) + smooth(0.7, 1, raw - Math.floor(raw));
      const n = digits.length;
      for (let i = 0; i < n; i++) {
        const p = Math.pow(10, i);
        let pos;
        if (i === 0) pos = v % 10;
        else { const rem = v % p; pos = (Math.floor(v / p) % 10) + (rem > p - 1 ? rem - (p - 1) : 0); }
        strips[n - 1 - i].style.transform = 'translate3d(0,' + (-pos / 11 * 100).toFixed(3) + '%,0)';
        const lead = i > 0 && raw < p;
        if (digits[n - 1 - i].classList.contains('is-lead') !== lead) digits[n - 1 - i].classList.toggle('is-lead', lead);
      }
    }

    /* static: gradient + text, final values (reduced motion / no canvas) */
    function makeStatic() {
      el.classList.add('is-static');
      el.style.height = '';
      stage.style.setProperty('--dv-static', staticBackground(from, to));
      caps.forEach((c) => { c.style.opacity = ''; c.style.visibility = ''; c.style.transform = ''; });
      setOdo(info.total);
      ui.cum.textContent = fmtInt(info.cumBefore + info.total);
      ui.clock.textContent = info.riseStr;
      ui.date.textContent = '日落 ' + info.setStr + ' 出發';
      ui.temp.textContent = fmtTemp(info.t1) + '°C';
      ui.temp.nextElementSibling.textContent = '入夜 ' + fmtTemp(info.t0) + '° → 清晨 ' + fmtTemp(info.t1) + '°';
      ui.spd.textContent = '—';
      ui.bar.style.transform = '';
    }

    if (reduced || !hasCanvas) {
      makeStatic();
      inst.static = true;
      inst.refresh = function () {};
      inst.destroy = function (removeEl) {
        const i = instances.indexOf(inst);
        if (i >= 0) instances.splice(i, 1);
        if (removeEl && el.parentNode) el.parentNode.removeChild(el);
      };
      instances.push(inst);
      return el;
    }

    /* animated */
    if (opts.height) el.style.height = String(opts.height);
    const seed = hashStr((from.id || '') + '>' + (to.id || ''));
    let scene = null, stageH = 0, visible = false;
    const st = { t: 0, s: (seed % 997) * 3, speed: IDLE_SPEED, vel: 0, lastY: 0, lastTime: 0, time: 0 };
    const last = { odo: -1, cum: '', clock: '', date: '', temp: '', spd: '', bar: '', caps: [-1, -1, -1] };
    const WINDOWS = [[-1, -0.5, 0.25, 0.35], [0.35, 0.43, 0.6, 0.68], [0.68, 0.76, 9, 10]];

    function ensureScene() {
      if (scene) return scene;
      scene = createScene(canvas, { seed: seed, accFrom: from.accent || '#ff9a5a', accTo: to.accent || '#ffb4a2' });
      if (scene) { scene.resize(); stageH = stage.clientHeight; }
      return scene;
    }

    function targetT() {
      const r = el.getBoundingClientRect();
      const sh = stageH || root.innerHeight || 1;
      const lead = sh * 0.35;
      return clamp((lead - r.top) / Math.max(1, r.height - sh + lead * 2), 0, 1);
    }

    function updateCaps(t) {
      for (let i = 0; i < caps.length; i++) {
        const w = WINDOWS[i];
        const a = smooth(w[0], w[1], t), b = smooth(w[2], w[3], t);
        const o = a * (1 - b);
        const key = Math.round(o * 400) + Math.round(b * 400) * 1000;
        if (key === last.caps[i]) continue;
        last.caps[i] = key;
        const c = caps[i];
        c.style.opacity = o.toFixed(3);
        c.style.visibility = o < 0.004 ? 'hidden' : 'visible';
        c.style.transform = 'translate3d(0,' + ((1 - a) * 34 - b * 34).toFixed(1) + 'px,0) scale(' + (0.965 + 0.035 * a).toFixed(4) + ')';
      }
    }

    function put(key, node, text) { if (last[key] !== text) { last[key] = text; node.textContent = text; } }

    function updateHud(t, speed) {
      const v = info.total * t;
      if (Math.abs(v - last.odo) > 0.002) { last.odo = v; setOdo(v); }
      put('cum', ui.cum, fmtInt(info.cumBefore + v));
      const mins = info.setMin + info.span * t;
      const m = Math.floor(mins) % 1440;
      put('clock', ui.clock, pad2(m / 60) + ':' + pad2(m % 60));
      put('date', ui.date, mins >= 1440 ? info.toDate : info.fromDate);
      put('temp', ui.temp, fmtTemp(lerp(info.t0, info.t1, smooth(0, 0.92, t))) + '°C');
      put('spd', ui.spd, String(Math.round(Math.min(160, Math.abs(speed) * 3.6))));
      const bar = 'scaleX(' + t.toFixed(4) + ')';
      if (last.bar !== bar) { last.bar = bar; ui.bar.style.transform = bar; }
    }

    function render() {
      if (scene) scene.draw(st.t, st.s, st.time, st.speed);
      updateCaps(st.t);
      updateHud(st.t, st.speed);
    }

    inst.tick = function (time) {
      const dt = st.lastTime ? clamp(time - st.lastTime, 0, 0.1) : 1 / 60;
      st.lastTime = time;
      st.time += dt;
      const tt = targetT();
      st.t += (tt - st.t) * (1 - Math.exp(-dt * 9));
      if (Math.abs(tt - st.t) < 1e-4) st.t = tt;
      const y = scrollY();
      const vy = dt > 0 ? (y - st.lastY) / dt : 0;
      st.lastY = y;
      st.vel += (vy - st.vel) * (1 - Math.exp(-dt * 6));
      const vn = clamp(st.vel / (stageH || root.innerHeight || 1), -3.5, 3.5);
      st.speed += (IDLE_SPEED + vn * SPEED_PER_SCREEN - st.speed) * (1 - Math.exp(-dt * 2.2));
      st.s += st.speed * dt;
      render();
    };

    inst.setVisible = function (on) {
      if (on === visible) return;
      visible = on;
      if (on) {
        if (!ensureScene()) {        // canvas 2D unavailable → degrade to static
          inst.static = true;
          unobserve(inst);
          if (ro) ro.disconnect();
          makeStatic();
          return;
        }
        st.lastTime = 0;
        st.lastY = scrollY();
        st.vel = 0;
        st.t = targetT();          // jump straight to the right time of night
        setActive(inst, true);
      } else {
        setActive(inst, false);
      }
    };

    inst.refresh = function () {
      if (!scene) return;
      scene.resize();
      stageH = stage.clientHeight;
      render();
    };

    let ro = null;
    if ('ResizeObserver' in root) {
      ro = new root.ResizeObserver(() => { if (scene) inst.refresh(); });
      ro.observe(stage);
    } else bindResize();

    inst.destroy = function (removeEl) {
      setActive(inst, false);
      unobserve(inst);
      if (ro) ro.disconnect();
      const i = instances.indexOf(inst);
      if (i >= 0) instances.splice(i, 1);
      if (removeEl && el.parentNode) el.parentNode.removeChild(el);
    };

    // first paint of HUD/captions (so nothing flashes before the first tick)
    updateCaps(0);
    updateHud(0, IDLE_SPEED);
    observe(inst);
    instances.push(inst);
    return el;
  }

  /* ---------------- mounting ---------------- */
  let refreshQueued = false;
  function scheduleSTRefresh() {
    const ST = root.ScrollTrigger;
    if (!ST || typeof ST.refresh !== 'function' || refreshQueued) return;
    refreshQueued = true;
    root.requestAnimationFrame(() => { refreshQueued = false; try { ST.refresh(); } catch (e) { /* ignore */ } });
  }

  function mountAll(options) {
    const o = options || {};
    const attr = o.attr || 'data-day';
    const scope = o.root || doc;
    const filterRoutes = o.routesOnly !== false && !!routes();
    let nodes = [];
    try { nodes = Array.prototype.slice.call(scope.querySelectorAll(o.daySelector || '[' + attr + ']')); } catch (e) { return 0; }
    const chapters = [], seen = Object.create(null);
    nodes.forEach((n) => {
      const id = n.getAttribute(attr);
      if (!id || seen[id] || (n.classList && n.classList.contains('drive-interlude'))) return;
      seen[id] = 1;
      chapters.push({ el: n, id: id });
    });
    let count = 0;
    for (let i = 1; i < chapters.length; i++) {
      const ch = chapters[i], prev = chapters[i - 1];
      if (!ch.el.parentNode) continue;
      if (filterRoutes && !hasRoute(ch.id)) continue;
      const sib = ch.el.previousElementSibling;
      if (sib && sib.classList && sib.classList.contains('drive-interlude')) continue;
      ch.el.parentNode.insertBefore(create(prev.id, ch.id, o), ch.el);
      count++;
    }
    if (count && o.refresh !== false) scheduleSTRefresh();
    return count;
  }

  function refreshAll() {
    instances.forEach((i) => i.refresh());
    scheduleSTRefresh();
  }

  function destroyAll(removeEl) {
    instances.slice().forEach((i) => i.destroy(removeEl));
  }

  root.Drive = {
    version: '1.0.0',
    create: create,
    mountAll: mountAll,
    km: km,
    direction: direction,
    refresh: refreshAll,
    destroyAll: destroyAll,
    instances: instances,
  };
})(typeof window !== 'undefined' ? window : this);
