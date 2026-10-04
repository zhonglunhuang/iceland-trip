/* =========================================================
   冰島任務 · Fire & Ice — main.js
   Renders everything after the hero from window.TRIP and drives
   the scroll story (GSAP + ScrollTrigger + Lenis, all optional).
   ========================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     Data & environment
     --------------------------------------------------------- */
  const TRIP = window.TRIP || {};
  const DAYS = Array.isArray(TRIP.days) ? TRIP.days : [];
  const WORLDS = Array.isArray(TRIP.worlds) ? TRIP.worlds : [];
  const ROUTE = Array.isArray(window.ROUTE) ? window.ROUTE : [];
  const OUTLINE = Array.isArray(window.ICELAND_OUTLINE) ? window.ICELAND_OUTLINE : [];
  const CREDITS = window.PHOTO_CREDITS || {};
  const FX = (window.FX && typeof window.FX.mount === 'function') ? window.FX : null;
  const gsap = window.gsap || null;
  const ST = window.ScrollTrigger || null;
  const HAS_GSAP = !!(gsap && ST);
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const html = document.documentElement;

  if (HAS_GSAP) {
    gsap.registerPlugin(ST);
    ST.config({ ignoreMobileResize: true });
  } else {
    html.classList.add('no-gsap');
  }
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  /* ---------------------------------------------------------
     Helpers
     --------------------------------------------------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const pad2 = (n) => String(n).padStart(2, '0');
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const imgSrc = (id) => 'assets/img/' + id + '.jpg';
  const dayNum = (d) => { const n = parseInt(String(d && d.id || '').replace(/\D/g, ''), 10); return isNaN(n) ? 0 : n; };
  const hasTag = (s, t) => Array.isArray(s.tags) && s.tags.indexOf(t) !== -1;
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const safe = (fn, label) => { try { return fn(); } catch (e) { console.warn('[iceland] ' + (label || '') , e); return null; } };

  const SPOT_BY_ID = {};
  DAYS.forEach((d) => (d.spots || []).forEach((s) => { SPOT_BY_ID[s.id] = s; }));

  const YEAR = ((String(TRIP.dates || '').match(/(\d{4})/) || [])[1] | 0) || new Date().getFullYear();
  const dayDate = (d) => {
    const m = String(d && d.date || '').match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    return m ? new Date(YEAR, +m[1] - 1, +m[2]) : null;
  };
  const sameDay = (a, b) => !!(a && b) && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const TODAY = new Date();
  const TODAY_DAY = DAYS.find((d) => sameDay(dayDate(d), TODAY)) || null;

  const ICON = {
    sunrise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v6"/><path d="m8.5 5.5 3.5-3.5 3.5 3.5"/><path d="m4.9 10.9 1.4 1.4"/><path d="m19.1 10.9-1.4 1.4"/><path d="M2 18h20"/><path d="M6 18a6 6 0 0 1 12 0"/><path d="M6 22h12"/></svg>',
    sunset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V2"/><path d="m8.5 4.5 3.5 3.5 3.5-3.5"/><path d="m4.9 10.9 1.4 1.4"/><path d="m19.1 10.9-1.4 1.4"/><path d="M2 18h20"/><path d="M6 18a6 6 0 0 1 12 0"/><path d="M6 22h12"/></svg>',
    bed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 20V6"/><path d="M2 16h20v4"/><path d="M22 16v-3a3 3 0 0 0-3-3h-8v6"/><circle cx="6.5" cy="12.5" r="2"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18.2A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    cube: '<svg class="cube" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5"/><path d="M12 12v10"/></svg>'
  };

  /* =========================================================
     RENDER
     ========================================================= */

  /* ---------- nav ---------- */
  function renderNav() {
    const nav = $('#navDays');
    if (!nav) return;
    nav.innerHTML = DAYS.map((d) => {
      const today = TODAY_DAY && TODAY_DAY.id === d.id ? ' is-today' : '';
      return '<a class="nav__day' + today + '" href="#day-' + esc(d.id) + '" data-nav="' + esc(d.id) + '" style="--accent:' + esc(d.accent || '#fff') + '" title="DAY ' + pad2(dayNum(d)) + ' · ' + esc(d.title) + '">' +
        '<span class="dot" aria-hidden="true"></span>' + esc(d.date) + '</a>';
    }).join('');
  }

  /* ---------- hero text ---------- */
  function renderHero() {
    const t = $('#heroTitle');
    if (t) {
      const title = TRIP.title || t.textContent.trim();
      t.setAttribute('aria-label', title);
      t.innerHTML = Array.from(title).map((c) => '<span class="ch" aria-hidden="true">' + esc(c) + '</span>').join('');
    }
    if (TRIP.dates && $('#heroDates')) $('#heroDates').textContent = TRIP.dates;
    if (TRIP.subtitle && $('#heroSub')) $('#heroSub').textContent = TRIP.subtitle;

    const st = $('#heroStatus');
    if (st && DAYS.length) {
      const first = dayDate(DAYS[0]);
      const last = dayDate(DAYS[DAYS.length - 1]);
      let text = '';
      if (TODAY_DAY) text = '任務進行中 · DAY ' + pad2(dayNum(TODAY_DAY)) + ' · ' + TODAY_DAY.title;
      else if (first && TODAY < first) text = '倒數 ' + Math.ceil((first - TODAY) / 864e5) + ' 天 · 任務即將開始';
      else if (last && TODAY > last) text = '任務完成 · 回憶收藏中';
      if (text) { st.innerHTML = '<span class="pulse" aria-hidden="true"></span>' + esc(text); st.hidden = false; }
    }
  }

  /* ---------- manifesto (split into characters) ---------- */
  function renderManifesto() {
    const el = $('#manifestoText');
    if (!el) return;
    const text = el.textContent.replace(/^\s+|\s+$/g, '');
    const grad = el.getAttribute('data-grad') || '';
    const chars = Array.from(text);
    const gi = grad ? text.indexOf(grad) : -1;
    const gStart = gi >= 0 ? Array.from(text.slice(0, gi)).length : -1;
    const gLen = Array.from(grad).length;
    el.setAttribute('aria-label', text.replace(/\s+/g, ''));
    el.innerHTML = chars.map((c, i) => {
      if (c === '\n') return '<br>';
      if (/\s/.test(c)) return ' ';
      const inG = gStart >= 0 && i >= gStart && i < gStart + gLen;
      let style = '';
      if (inG) {
        const k = i - gStart;
        style = ' style="background-size:' + (gLen * 100) + '% 100%;background-position:' + (gLen > 1 ? (k / (gLen - 1)) * 100 : 0) + '% 0"';
      }
      return '<span class="w' + (inG ? ' is-grad' : '') + '" aria-hidden="true"' + style + '>' + esc(c) + '</span>';
    }).join('');
  }

  /* ---------- stats ---------- */
  function renderStats() {
    const grid = $('#statsGrid');
    if (!grid) return;
    const stats = Array.isArray(TRIP.stats) ? TRIP.stats : [];
    if (!stats.length) { const s = $('#stats'); if (s) s.style.display = 'none'; return; }
    grid.style.gridTemplateColumns = stats.length < 4 && window.innerWidth > 720 ? 'repeat(' + stats.length + ', 1fr)' : '';
    grid.innerHTML = stats.map((s) =>
      '<div class="stat"><div class="stat__num"><b data-count="' + esc(s.value) + '">' + esc(s.value) + '</b>' +
      (s.unit ? '<span class="stat__unit">' + esc(s.unit) + '</span>' : '') + '</div>' +
      '<p class="stat__label">' + esc(s.label) + '</p></div>'
    ).join('');
  }

  /* ---------- route map ---------- */
  const ARCTIC = 66.5633;
  const RS = { days: [], cur: -1, svg: null, W: 1000, H: 700, kmEl: null, swap: null, card: null, head: null, sw: 1 };

  function haversine(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function renderRoute() {
    const section = $('#route');
    const mapEl = $('#routeMap');
    const cap = $('#routeCaption');
    const rdays = ROUTE.map((r) => {
      const d = DAYS.find((x) => x.id === r.day);
      const lines = (r.lines || []).filter((l) => Array.isArray(l) && l.length > 1);
      return d && lines.length ? { r: r, d: d, lines: lines } : null;
    }).filter(Boolean);
    if (!section || !mapEl || !cap || !rdays.length) { if (section) section.style.display = 'none'; return; }

    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    const eat = (p) => { if (!p) return; minLng = Math.min(minLng, p[0]); maxLng = Math.max(maxLng, p[0]); minLat = Math.min(minLat, p[1]); maxLat = Math.max(maxLat, p[1]); };
    OUTLINE.forEach((ring) => (ring || []).forEach(eat));
    rdays.forEach((x) => x.lines.forEach((l) => l.forEach(eat)));
    minLng -= 0.3; maxLng += 0.3; minLat -= 0.12; maxLat = Math.max(maxLat, ARCTIC) + 0.1;

    const K = Math.cos(65 * Math.PI / 180);
    const W = 1000, PAD = 24;
    const scale = (W - PAD * 2) / ((maxLng - minLng) * K);
    const H = Math.round((maxLat - minLat) * scale + PAD * 2);
    const X = (lng) => PAD + (lng - minLng) * K * scale;
    const Y = (lat) => PAD + (maxLat - lat) * scale;
    const P = (p) => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1);
    const linePath = (pts) => 'M' + pts.map(P).join('L');
    const inBounds = (s) => isNum(s.lat) && isNum(s.lng) && s.lat > minLat && s.lat < maxLat && s.lng > minLng && s.lng < maxLng;
    RS.W = W; RS.H = H;

    const outlineD = OUTLINE.map((ring) => (ring && ring.length > 2 ? linePath(ring) + 'Z' : '')).join('');

    let grat = '';
    for (let lat = Math.ceil(minLat); lat <= Math.floor(maxLat); lat++) {
      grat += '<path class="route-grat" d="M' + PAD + ',' + Y(lat).toFixed(1) + 'H' + (W - PAD) + '"/>' +
        '<text class="route-grat-label" x="' + (PAD + 2) + '" y="' + (Y(lat) - 6).toFixed(1) + '">' + lat + '°N</text>';
    }
    for (let lng = Math.ceil(minLng / 2) * 2; lng <= maxLng; lng += 2) {
      grat += '<path class="route-grat" d="M' + X(lng).toFixed(1) + ',' + PAD + 'V' + (H - PAD) + '"/>';
    }
    grat += '<path class="route-grat route-arctic" d="M' + PAD + ',' + Y(ARCTIC).toFixed(1) + 'H' + (W - PAD) + '"/>' +
      '<text class="route-grat-label route-arctic-label" x="' + (W - PAD - 2) + '" y="' + (Y(ARCTIC) - 7).toFixed(1) + '" text-anchor="end">北極圈 ARCTIC CIRCLE 66°33′N</text>';

    // 100 km scale bar
    const km100 = 100 * scale / 111.32;
    const sbY = H - PAD - 4;
    const scaleBar = '<g class="route-scale"><path class="route-grat" style="stroke-dasharray:none;stroke:rgba(255,255,255,.35)" d="M' + (PAD + 2) + ',' + sbY + 'h' + km100.toFixed(1) + 'M' + (PAD + 2) + ',' + (sbY - 4) + 'v8M' + (PAD + 2 + km100).toFixed(1) + ',' + (sbY - 4) + 'v8"/>' +
      '<text class="route-grat-label" x="' + (PAD + 2) + '" y="' + (sbY - 10) + '">100 KM</text></g>';

    const dayGroups = rdays.map((x, i) => {
      const accent = x.d.accent || '#7fe3ff';
      const glow = x.lines.map((l) => '<path class="route-line route-line-glow" d="' + linePath(l) + '" stroke="' + esc(accent) + '"/>').join('');
      const main = x.lines.map((l) => '<path class="route-line route-line-main" d="' + linePath(l) + '" stroke="' + esc(accent) + '"/>').join('');
      const pts = (x.d.spots || []).filter(inBounds).map((s) => {
        const must = hasTag(s, '必去');
        return '<g class="route-pt" transform="translate(' + X(s.lng).toFixed(1) + ' ' + Y(s.lat).toFixed(1) + ')">' +
          '<circle r="4" fill="' + esc(accent) + '" stroke="#000" stroke-width="1.5"/>' +
          (must ? '<text x="9" y="4">' + esc(s.title) + '</text>' : '') + '</g>';
      }).join('');
      return '<g class="route-day" data-i="' + i + '">' + glow + main + pts + '</g>';
    }).join('');

    mapEl.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="冰島環島路線圖：每天的行車路線依序畫出">' +
      '<defs>' +
      '<linearGradient id="landGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#152334"/><stop offset="1" stop-color="#0a1019"/></linearGradient>' +
      '<filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>' +
      '<pattern id="mapDots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="rgba(255,255,255,.07)"/></pattern>' +
      '</defs>' +
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#mapDots)"/>' +
      grat +
      (outlineD ? '<path class="route-land-glow" d="' + outlineD + '"/><path class="route-land" d="' + outlineD + '"/>' : '') +
      scaleBar +
      dayGroups +
      '<g class="route-head" transform="translate(-100 -100)">' +
      '<circle class="glow" r="14" filter="url(#softGlow)"/><circle class="ring" r="8" fill="none" stroke-width="1.5"/><circle class="core" r="4.5" fill="#fff"/></g>' +
      '</svg>';

    const svg = $('svg', mapEl);
    RS.svg = svg;
    RS.head = $('.route-head', svg);
    RS.days = rdays.map((x, i) => {
      const g = $('.route-day[data-i="' + i + '"]', svg);
      const mains = $$('.route-line-main', g);
      const glows = $$('.route-line-glow', g);
      const paths = mains.map((m, j) => {
        let len = 0;
        try { len = m.getTotalLength(); } catch (e) { len = 0; }
        const gl = glows[j];
        [m, gl].forEach((p) => { p.style.strokeDasharray = len + ' ' + (len + 2); p.style.strokeDashoffset = len; p.style.visibility = 'hidden'; });
        return { main: m, glow: gl, len: len };
      });
      let km = 0;
      x.lines.forEach((l) => { for (let k = 1; k < l.length; k++) km += haversine(l[k - 1], l[k]); });
      return { d: x.d, g: g, paths: paths, total: paths.reduce((a, p) => a + p.len, 0) || 1, km: km, drawn: -1, accent: x.d.accent || '#7fe3ff', tick: null };
    });

    // caption
    cap.innerHTML =
      '<p class="eyebrow route__eyebrow"><span class="eyebrow__line"></span>THE ROUTE</p>' +
      '<h2 class="route__headline">一號公路，<br>順時針繞一圈。</h2>' +
      '<div class="route__card"><div class="route__swap"></div>' +
      '<div class="route__km"><b id="routeKm">0</b><span>km · 地圖路線累計</span></div>' +
      '<div class="route__ticks">' + RS.days.map((D) => '<i style="--c:' + esc(D.accent) + '"><b></b></i>').join('') + '</div></div>';
    RS.swap = $('.route__swap', cap);
    RS.card = $('.route__card', cap);
    RS.kmEl = $('#routeKm', cap);
    $$('.route__ticks b', cap).forEach((b, i) => { RS.days[i].tick = b; });

    section.style.height = (RS.days.length * 55 + 100) + 'vh';
    sizeRoute();
    updateRoute(0);
  }

  function sizeRoute() {
    if (!RS.svg) return;
    const w = RS.svg.getBoundingClientRect().width || 800;
    const sw = RS.W / w;
    RS.sw = sw;
    RS.svg.style.setProperty('--sw', sw.toFixed(3));
    $$('.route-pt circle', RS.svg).forEach((c) => c.setAttribute('r', (3.6 * sw).toFixed(2)));
    $$('.route-pt text', RS.svg).forEach((t) => t.setAttribute('x', (8 * sw).toFixed(1)));
    if (RS.head) {
      const set = (sel, r) => { const c = $(sel, RS.head); if (c) c.setAttribute('r', (r * sw).toFixed(2)); };
      set('.glow', 13); set('.ring', 7); set('.core', 4.2);
    }
  }

  function captionHTML(D) {
    const d = D.d, n = pad2(dayNum(d));
    const stops = (d.spots || []).filter((s) => !hasTag(s, '備案')).slice(0, 6)
      .map((s) => '<span>' + esc(s.title) + '</span>').join('');
    return '<div class="route__pill">Day ' + n + ' · ' + esc(d.date) + ' · ' + esc(d.title) + '</div>' +
      '<div class="route__daynum"><small>DAY</small>' + n + '</div>' +
      '<p class="route__sub">' + esc(d.subtitle || '') + '</p>' +
      '<div class="route__stops">' + stops + '</div>';
  }

  function setDraw(D, draw) {
    let len = draw * D.total;
    D.paths.forEach((P) => {
      const seg = clamp(len, 0, P.len);
      const off = (P.len - seg).toFixed(2);
      const vis = seg > 0.01 ? 'visible' : 'hidden';
      P.main.style.strokeDashoffset = off; P.glow.style.strokeDashoffset = off;
      P.main.style.visibility = vis; P.glow.style.visibility = vis;
      len -= P.len;
    });
  }

  function headPoint(D) {
    let len = Math.max(0, D.drawn) * D.total;
    for (let i = 0; i < D.paths.length; i++) {
      const P = D.paths[i];
      if (len <= P.len || i === D.paths.length - 1) {
        try { return P.main.getPointAtLength(clamp(len, 0, P.len)); } catch (e) { return null; }
      }
      len -= P.len;
    }
    return null;
  }

  function updateRoute(p) {
    const n = RS.days.length;
    if (!n) return;
    const f = clamp(p / 0.95, 0, 1) * n;
    const cur = Math.min(n - 1, Math.floor(f));
    let km = 0;
    RS.days.forEach((D, i) => {
      const local = clamp(f - i, 0, 1);
      const draw = easeInOut(clamp(local / 0.8, 0, 1));
      if (Math.abs(draw - D.drawn) > 0.0005 || ((draw === 0 || draw === 1) && D.drawn !== draw)) {
        setDraw(D, draw);
        D.drawn = draw;
        if (D.tick) D.tick.style.transform = 'scaleX(' + draw.toFixed(4) + ')';
      }
      km += D.km * draw;
      D.g.classList.toggle('is-on', local > 0 || i === 0);
      D.g.classList.toggle('is-current', i === cur);
      D.g.classList.toggle('is-past', i < cur);
    });
    const D = RS.days[cur];
    const pt = headPoint(D);
    if (pt && RS.head) {
      RS.head.setAttribute('transform', 'translate(' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1) + ')');
      if (RS.headColor !== D.accent) {
        RS.headColor = D.accent;
        $$('.glow', RS.head).forEach((c) => c.setAttribute('fill', D.accent));
        $$('.ring', RS.head).forEach((c) => c.setAttribute('stroke', D.accent));
      }
    }
    if (RS.kmEl) RS.kmEl.textContent = Math.round(km).toLocaleString('en-US');
    if (cur !== RS.cur) {
      RS.cur = cur;
      if (RS.card) RS.card.style.setProperty('--accent', D.accent);
      if (RS.swap) {
        RS.swap.innerHTML = captionHTML(D);
        if (HAS_GSAP && !REDUCED) {
          gsap.fromTo(Array.from(RS.swap.children), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.05, ease: 'expo.out', overwrite: true });
        }
      }
    }
  }

  /* ---------- days ---------- */
  function tagClass(t) {
    if (t === '必去') return 'tag--must';
    if (t === '美食') return 'tag--food';
    if (t === '備案') return 'tag--alt';
    if (t === '世界遺產') return 'tag--heritage';
    return '';
  }
  function pickHero(d) {
    const spots = d.spots || [];
    return spots.find((s) => hasTag(s, '必去')) || spots[0] || null;
  }

  function spotHTML(s, i, total, d) {
    const tags = (s.tags || []).map((t) => '<span class="tag ' + tagClass(t) + '">' + esc(t) + '</span>').join('');
    const note = s.note ? '<p class="spot__note">' + ICON.warn + '<span>' + esc(s.note) + '</span></p>' : '';
    const map = s.map ? '<a class="map-link" href="' + esc(s.map) + '" target="_blank" rel="noopener">' + ICON.pin + '在 Google Maps 開啟' + ICON.arrow + '</a>' : '';
    const world = s.world ? '<a class="world-btn" href="worlds/' + esc(s.world) + '.html">' + ICON.cube + '<span>進入 3D 虛擬空間</span><span class="arr" aria-hidden="true">→</span></a>' : '';
    const pic = s.img || s.id;
    return '<article class="spot' + (i % 2 ? ' is-even' : '') + '" id="spot-' + esc(s.id) + '">' +
      '<div class="spot__node" aria-hidden="true"><span class="spot__node-dot"></span><time>' + esc(s.time || '') + '</time></div>' +
      '<div class="spot__media">' +
        '<div class="spot__parallax" data-fx="' + esc(s.fx || 'mist') + '" data-id="' + esc(pic) + '" data-accent="' + esc(d.accent || '#7fe3ff') + '">' +
          '<img src="' + imgSrc(esc(pic)) + '" alt="' + esc(s.title) + (s.en ? ' · ' + esc(s.en) : '') + '" loading="lazy" decoding="async" width="1600" height="1066">' +
        '</div>' +
        '<span class="spot__index">' + pad2(i + 1) + ' / ' + pad2(total) + '</span>' +
        (FX ? '<span class="spot__fxlabel" aria-hidden="true">LIVE</span>' : '') +
      '</div>' +
      '<div class="spot__body">' +
        '<div class="spot__meta">' + (s.time ? '<span class="time-pill">' + esc(s.time) + '</span>' : '') + tags + '</div>' +
        '<h3 class="spot__title">' + esc(s.title) + '</h3>' +
        (s.en ? '<p class="spot__en">' + esc(s.en) + '</p>' : '') +
        (s.desc ? '<p class="spot__desc">' + esc(s.desc) + '</p>' : '') +
        note +
        (map || world ? '<div class="spot__actions">' + world + map + '</div>' : '') +
      '</div>' +
    '</article>';
  }

  function dayHTML(d) {
    const n = pad2(dayNum(d));
    const spots = d.spots || [];
    const hero = pickHero(d);
    const heroPic = hero ? (hero.img || hero.id) : 'aurora';
    const accent = esc(d.accent || '#7fe3ff');
    const chips = [];
    if (d.sun && d.sun.rise) chips.push('<span class="chip">' + ICON.sunrise + '日出 <b>' + esc(d.sun.rise) + '</b></span>');
    if (d.sun && d.sun.set) chips.push('<span class="chip">' + ICON.sunset + '日落 <b>' + esc(d.sun.set) + '</b></span>');
    if (d.stay && d.stay.name) {
      chips.push(d.stay.map
        ? '<a class="chip" href="' + esc(d.stay.map) + '" target="_blank" rel="noopener">' + ICON.bed + '住宿 <b>' + esc(d.stay.name) + '</b></a>'
        : '<span class="chip">' + ICON.bed + '住宿 <b>' + esc(d.stay.name) + '</b></span>');
    }
    const isToday = TODAY_DAY && TODAY_DAY.id === d.id;
    const week = d.weekday ? ' · 星期' + esc(d.weekday) : '';

    return '<section class="day" id="day-' + esc(d.id) + '" data-day="' + esc(d.id) + '" data-nav-key="' + esc(d.id) + '" style="--accent:' + accent + '" aria-label="DAY ' + n + ' ' + esc(d.title) + '">' +
      '<header class="day-opener">' +
        '<div class="day-opener__media"><img src="' + imgSrc(esc(heroPic)) + '" alt="' + esc(hero ? hero.title : d.title) + '" loading="lazy" decoding="async"></div>' +
        '<div class="day-opener__shade"></div>' +
        '<div class="day-opener__content">' +
          '<p class="day-opener__kicker">' + esc(d.date) + week + (isToday ? '<span class="today-badge">今天</span>' : '') + '</p>' +
          '<h2 class="day-opener__num"><span class="lbl">DAY</span><span class="n">' + n + '</span></h2>' +
          '<h3 class="day-opener__title">' + esc(d.title) + '</h3>' +
          (d.subtitle ? '<p class="day-opener__sub">' + esc(d.subtitle) + '</p>' : '') +
          (chips.length ? '<div class="day-opener__chips">' + chips.join('') + '</div>' : '') +
        '</div>' +
      '</header>' +
      (spots.length ?
      '<div class="day-body' + (spots.length >= 7 ? ' is-long' : '') + '" data-count="' + spots.length + '">' +
        '<div class="timeline" aria-hidden="true"><div class="timeline__fill"></div></div>' +
        '<div class="spots">' +
          '<div class="h-intro" aria-hidden="true">' +
            '<p class="h-intro__eyebrow">DAY ' + n + ' · ' + esc(d.date) + ' · ' + spots.length + ' 個停靠點</p>' +
            '<p class="h-intro__title">' + esc(d.title) + '</p>' +
            '<p class="h-intro__hint"><i></i>繼續往下滑，畫面會往右走</p>' +
          '</div>' +
          spots.map((s, i) => spotHTML(s, i, spots.length, d)).join('') +
        '</div>' +
        '<div class="h-ui" aria-hidden="true"><span class="h-ui__count">01 / ' + pad2(spots.length) + '</span><div class="h-ui__bar"><i></i></div><span>DAY ' + n + '</span></div>' +
      '</div>' : '') +
    '</section>';
  }

  function renderDays() {
    const wrap = $('#days');
    if (!wrap) return;
    wrap.innerHTML = DAYS.map(dayHTML).join('');
  }

  /* ---------- worlds ---------- */
  function renderWorlds() {
    const grid = $('#worldsGrid');
    if (!grid) return;
    if (!WORLDS.length) { const s = $('#worlds'); if (s) s.style.display = 'none'; const c = $('.nav__cta'); if (c) c.style.display = 'none'; return; }
    grid.innerHTML = WORLDS.map((w) =>
      '<a class="world-card" href="worlds/' + esc(w.id) + '.html" aria-label="進入 3D 虛擬空間：' + esc(w.title) + '">' +
        '<img class="world-card__img" src="' + imgSrc(esc(w.img || w.id)) + '" alt="" loading="lazy" decoding="async">' +
        '<span class="world-card__badge">' + ICON.cube + '3D 虛擬空間</span>' +
        '<p class="world-card__en">' + esc(w.en || '') + '</p>' +
        '<h3 class="world-card__title">' + esc(w.title) + '</h3>' +
        (w.desc ? '<p class="world-card__desc">' + esc(w.desc) + '</p>' : '') +
        '<span class="world-card__go">進入 <span aria-hidden="true">→</span></span>' +
      '</a>'
    ).join('');
  }

  /* ---------- finale & credits ---------- */
  function renderFinale() {
    const a = $('#myMapLink');
    if (a) {
      if (TRIP.myMap) a.href = TRIP.myMap;
      else a.style.display = 'none';
    }
    const d = $('#finaleDates');
    if (d && TRIP.dates) d.textContent = TRIP.dates + ' · ICELAND';
  }

  function cleanArtist(a) {
    let s = String(a || '').split('\n')[0].replace(/\s+/g, ' ').trim();
    const m = s.match(/taken by ([^.]+?)(?:\.|$)/i);
    if (m) s = m[1].trim();
    if (!s || /^NOTE:/i.test(s)) s = '見原始頁面';
    if (s.length > 48) s = s.slice(0, 46) + '…';
    return s;
  }
  function cleanTitle(t) {
    let s = String(t || '').replace(/^File:/i, '').replace(/\.(jpe?g|png|webp|tiff?)$/i, '').replace(/_/g, ' ').trim();
    if (s.length > 42) s = s.slice(0, 40) + '…';
    return s;
  }
  const EXTRA_LABEL = { 'iceland-highland': '冰島高地', puffin: '海鸚', 'icelandic-horse': '冰島馬', 'svarta-kaffid': 'Svarta Kaffið 麵包湯', 'plane-wreck': 'DC-3 飛機殘骸', 'ring-road': '一號公路', aurora: '維克教堂與極光' };

  function renderCredits() {
    const list = $('#creditsList');
    if (!list) return;
    const ids = Object.keys(CREDITS);
    if (!ids.length) { list.innerHTML = '<li>Wikimedia Commons</li>'; return; }
    list.innerHTML = ids.map((id) => {
      const c = CREDITS[id] || {};
      const label = EXTRA_LABEL[id] || (SPOT_BY_ID[id] && SPOT_BY_ID[id].title) || cleanTitle(c.title) || id;
      const artist = esc(cleanArtist(c.artist));
      const link = c.page ? '<a href="' + esc(c.page) + '" target="_blank" rel="noopener" title="' + esc(cleanTitle(c.title)) + '">' + artist + '</a>' : artist;
      return '<li><b>' + esc(label) + '</b> — ' + link + (c.license ? ' · ' + esc(c.license) : '') + '</li>';
    }).join('');
  }

  /* =========================================================
     HERO VISUALS
     ========================================================= */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function ridge(c) {
    const rnd = mulberry32(c.seed);
    const N = 256;
    const h = new Array(N + 1).fill(0);
    h[0] = rnd(); h[N] = rnd();
    let step = N, amp = 1;
    while (step > 1) {
      const half = step >> 1;
      for (let i = half; i < N; i += step) h[i] = (h[i - half] + h[i + half]) / 2 + (rnd() - 0.5) * amp;
      amp *= c.rough; step = half;
    }
    let mn = Infinity, mx = -Infinity;
    h.forEach((v) => { mn = Math.min(mn, v); mx = Math.max(mx, v); });
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const x = i / N * 1600;
      let y = c.base - ((h[i] - mn) / (mx - mn || 1)) * c.amp;
      (c.peaks || []).forEach((pk) => {
        const dx = (x - pk.x) / pk.w;
        if (pk.cone) y -= pk.h * Math.pow(Math.max(0, 1 - Math.abs(dx + (dx > 0 ? 0 : 0.04 * dx))), 1.75);
        else y -= pk.h * Math.exp(-dx * dx * 2.2);
      });
      pts.push(x.toFixed(1) + ',' + Math.max(4, y).toFixed(1));
    }
    return { line: 'M' + pts.join('L'), area: 'M0,600L' + pts.join('L') + 'L1600,600Z' };
  }

  function buildMountains() {
    const cfg = {
      far: { seed: 11, base: 380, amp: 200, rough: 0.56, rim: 'rgba(210,235,255,.28)', peaks: [{ x: 360, w: 170, h: 60 }, { x: 1320, w: 140, h: 40 }],
        stops: [[0, '#b8d4f0', 0.85], [0.16, '#58789f', 0.95], [0.5, '#1b2c47', 1], [1, '#0a1323', 1]] },
      mid: { seed: 29, base: 450, amp: 140, rough: 0.5, rim: 'rgba(127,227,255,.42)', peaks: [{ x: 990, w: 240, h: 290, cone: true }],
        stops: [[0, '#2c4364', 1], [0.35, '#14213a', 1], [1, '#060b15', 1]] },
      near: { seed: 73, base: 540, amp: 120, rough: 0.6, rim: 'rgba(107,255,184,.22)', peaks: [{ x: 200, w: 180, h: 40 }],
        stops: [[0, '#0c121c', 1], [1, '#000000', 1]] }
    };
    Object.keys(cfg).forEach((k) => {
      const svg = $('.hero__mtn--' + k + ' .mtn-svg');
      if (!svg) return;
      const c = cfg[k];
      const r = ridge(c);
      const stops = c.stops.map((s) => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '" stop-opacity="' + s[2] + '"/>').join('');
      svg.innerHTML = '<defs><linearGradient id="mg-' + k + '" x1="0" y1="0" x2="0" y2="1">' + stops + '</linearGradient></defs>' +
        '<path d="' + r.area + '" fill="url(#mg-' + k + ')"/>' +
        '<path d="' + r.line + '" fill="none" stroke="' + c.rim + '" stroke-width="1.4" vector-effect="non-scaling-stroke"/>';
    });
  }

  /* ---------- starfield (canvas 2D) ---------- */
  function Starfield(canvas) {
    const ctx = canvas && canvas.getContext('2d');
    if (!ctx) return null;
    let w = 0, h = 0, stars = [], shoot = null, nextShoot = 2.5;
    const COLORS = ['#ffffff', '#d6ebff', '#fff1d6'];
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(760, Math.round(w * h / 1700));
      const rnd = mulberry32(1234);
      stars = [];
      for (let i = 0; i < count; i++) {
        const y = Math.pow(rnd(), 1.35) * h * 0.9;
        stars.push({ x: rnd() * w, y: y, r: Math.pow(rnd(), 3) * 1.45 + 0.3, a: rnd() * 0.55 + 0.35, s: rnd() * 2.2 + 0.4, p: rnd() * 6.283, c: rnd() > 0.82 ? (rnd() > 0.5 ? 1 : 2) : 0 });
      }
      stars.sort((a, b) => a.c - b.c);
    }
    function draw(t, dt) {
      if (!w) return;
      ctx.clearRect(0, 0, w, h);
      let c = -1;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        if (s.c !== c) { c = s.c; ctx.fillStyle = COLORS[c]; }
        const tw = 0.62 + 0.38 * Math.sin(t * s.s + s.p);
        ctx.globalAlpha = s.a * tw * (1 - (s.y / h) * 0.55);
        if (s.r < 0.95) ctx.fillRect(s.x, s.y, s.r * 1.7, s.r * 1.7);
        else {
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
          if (s.r > 1.45) { ctx.globalAlpha *= 0.18; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 3.2, 0, 6.283); ctx.fill(); }
        }
      }
      // shooting star
      nextShoot -= dt;
      if (!shoot && nextShoot <= 0) {
        shoot = { x: w * (0.35 + Math.random() * 0.6), y: h * (0.04 + Math.random() * 0.25), vx: -(420 + Math.random() * 260), vy: 150 + Math.random() * 110, life: 0, max: 0.9 + Math.random() * 0.4 };
        nextShoot = 5 + Math.random() * 7;
      }
      if (shoot) {
        shoot.life += dt;
        shoot.x += shoot.vx * dt; shoot.y += shoot.vy * dt;
        const k = shoot.life / shoot.max;
        const a = Math.sin(Math.min(1, k) * Math.PI);
        const len = 0.22;
        const gx = shoot.x - shoot.vx * len, gy = shoot.y - shoot.vy * len;
        const g = ctx.createLinearGradient(shoot.x, shoot.y, gx, gy);
        g.addColorStop(0, 'rgba(255,255,255,' + (0.9 * a).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(127,227,255,0)');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = g; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(gx, gy); ctx.stroke();
        if (k >= 1) shoot = null;
      }
      ctx.globalAlpha = 1;
    }
    resize();
    return { resize: resize, draw: draw };
  }

  /* ---------- snow (canvas 2D) ---------- */
  function Snow(canvas) {
    const ctx = canvas && canvas.getContext('2d');
    if (!ctx) return null;
    let w = 0, h = 0, flakes = [];
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 32;
    const sg = sprite.getContext('2d');
    const grd = sg.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    sg.fillStyle = grd; sg.fillRect(0, 0, 32, 32);
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(clamp(w / 9, 50, 170));
      flakes = [];
      for (let i = 0; i < count; i++) flakes.push(make(true));
    }
    function make(anyY) {
      const z = Math.random();
      return { x: Math.random() * w, y: anyY ? Math.random() * h : -10, z: z, r: lerp(0.7, 3.4, z * z), vy: lerp(16, 64, z), sw: lerp(6, 26, z), ph: Math.random() * 6.283, fr: 0.4 + Math.random() * 0.8, a: lerp(0.25, 0.85, z) };
    }
    function draw(t, dt, wind) {
      if (!w) return;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i];
        f.y += f.vy * dt;
        f.x += (wind * 30 * f.z + 6) * dt;
        const x = f.x + Math.sin(t * f.fr + f.ph) * f.sw;
        if (f.y > h + 10) { flakes[i] = make(false); continue; }
        if (f.x > w + 30) f.x -= w + 60; else if (f.x < -30) f.x += w + 60;
        const s = f.r * 4;
        ctx.globalAlpha = f.a;
        ctx.drawImage(sprite, x - s / 2, f.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    }
    resize();
    return { resize: resize, draw: draw };
  }

  /* ---------- aurora (WebGL fragment shader) ---------- */
  const AURORA_VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';
  const AURORA_FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform vec2 uRes;',
    'uniform float uTime;',
    'uniform vec2 uMouse;',
    'uniform float uAmp;',
    'float hash(vec2 p){p=fract(p*vec2(234.34,435.345));p+=dot(p,p+34.23);return fract(p.x*p.y);}',
    'float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);vec2 u=f*f*(3.0-2.0*f);',
    '  float a=hash(i);float b=hash(i+vec2(1.0,0.0));float c=hash(i+vec2(0.0,1.0));float d=hash(i+vec2(1.0,1.0));',
    '  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}',
    'float fbm(vec2 p){float v=0.0;float a=0.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.02+vec2(3.1,1.7);a*=0.5;}return v;}',
    'float curtain(vec2 uv,float t,float seed,float y0,float amp){',
    '  float x=uv.x;',
    '  float n=fbm(vec2(x*0.75+seed*7.3+t*0.035,seed*1.7+t*0.02));',
    '  float c=y0+(n-0.5)*amp+0.045*sin(x*2.1+t*0.22+seed*5.0);',
    '  float d=uv.y-c;',
    '  float r1=noise(vec2(x*34.0+seed*11.0-t*0.35,t*0.25+seed));',
    '  float r2=noise(vec2(x*85.0+seed*3.0+t*0.6,seed*2.0));',
    '  float rays=r1*0.65+r2*0.35;',
    '  float lower=smoothstep(-0.012,0.018,d);',
    '  float upper=exp(-max(d,0.0)*mix(10.0,2.6,rays*rays));',
    '  float rim=exp(-abs(d)*55.0)*0.55;',
    '  float body=lower*upper*(0.25+1.15*rays)+rim*(0.5+rays);',
    '  float patchy=smoothstep(0.28,0.72,fbm(vec2(x*0.55-t*0.025+seed*2.3,seed*4.1)));',
    '  return body*patchy;}',
    'void main(){',
    '  vec2 uv=gl_FragCoord.xy/uRes.y;',
    '  uv+=uMouse*vec2(0.03,0.015);',
    '  float t=uTime;',
    '  float a1=curtain(uv,t,1.0,0.58,0.42);',
    '  float a2=curtain(uv+vec2(0.37,0.0),t*1.15,2.6,0.72,0.34);',
    '  float a3=curtain(uv-vec2(0.21,0.0),t*0.85,4.2,0.48,0.30);',
    '  vec3 green=vec3(0.32,1.0,0.66);',
    '  vec3 cyan=vec3(0.38,0.86,1.0);',
    '  vec3 violet=vec3(0.70,0.50,1.0);',
    '  vec3 col=a1*mix(green,violet,smoothstep(0.62,1.0,uv.y));',
    '  col+=a2*mix(cyan,violet,smoothstep(0.7,1.05,uv.y))*0.75;',
    '  col+=a3*mix(green,cyan,0.4)*0.6;',
    '  col*=uAmp;',
    '  col=vec3(1.0)-exp(-col*1.35);',
    '  float alpha=clamp(max(col.r,max(col.g,col.b)),0.0,1.0);',
    '  gl_FragColor=vec4(col,alpha);',
    '}'
  ].join('\n');

  function AuroraGL(canvas, opts) {
    opts = opts || {};
    if (!canvas) return null;
    let gl = null;
    try {
      const o = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
      gl = canvas.getContext('webgl', o) || canvas.getContext('experimental-webgl', o);
    } catch (e) { gl = null; }
    if (!gl) return null;
    function sh(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[aurora] shader', gl.getShaderInfoLog(s)); return null; }
      return s;
    }
    const vs = sh(gl.VERTEX_SHADER, AURORA_VS), fs = sh(gl.FRAGMENT_SHADER, AURORA_FS);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('[aurora] link', gl.getProgramInfoLog(prog)); return null; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uMouse = gl.getUniformLocation(prog, 'uMouse');
    const uAmp = gl.getUniformLocation(prog, 'uAmp');
    gl.uniform1f(uAmp, opts.amp || 1);
    gl.clearColor(0, 0, 0, 0);
    let lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; }, false);
    function resize() {
      const small = window.innerWidth < 720;
      const sc = opts.scale || (small ? 0.4 : 0.5);
      const w = Math.max(2, Math.round(canvas.clientWidth * sc));
      const h = Math.max(2, Math.round(canvas.clientHeight * sc));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    }
    function render(t, mx, my) {
      if (lost) return;
      gl.uniform1f(uTime, t + (opts.offset || 0));
      gl.uniform2f(uMouse, mx || 0, my || 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    resize();
    return { resize: resize, render: render };
  }

  /* ---------- hero loop ---------- */
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  const heroFX = { stars: null, snow: null, aurora: null, running: false, raf: 0, last: 0, t: 8, setters: [] };

  function initHeroVisuals() {
    buildMountains();
    heroFX.stars = safe(() => Starfield($('#heroStars')), 'stars');
    heroFX.snow = safe(() => Snow($('#heroSnow')), 'snow');
    heroFX.aurora = safe(() => AuroraGL($('#heroAurora')), 'aurora');
    if (!heroFX.aurora) { html.classList.add('no-webgl'); const c = $('#heroAurora'); if (c) c.style.display = 'none'; }

    // mouse parallax targets
    const layers = [
      { el: $('.hero__mtn--far .mtn-svg'), dx: 10, dy: 4 },
      { el: $('.hero__mtn--mid .mtn-svg'), dx: 22, dy: 7 },
      { el: $('.hero__mtn--near .mtn-svg'), dx: 40, dy: 10 },
      { el: $('#heroStars'), dx: 6, dy: 3 },
      { el: $('#heroTitle'), dx: -10, dy: -5 }
    ].filter((l) => l.el);
    heroFX.setters = layers.map((l) => {
      if (HAS_GSAP) {
        const sx = gsap.quickSetter(l.el, 'x', 'px'), sy = gsap.quickSetter(l.el, 'y', 'px');
        return (mx, my) => { sx(-mx * l.dx); sy(-my * l.dy); };
      }
      return (mx, my) => { l.el.style.transform = 'translate3d(' + (-mx * l.dx).toFixed(2) + 'px,' + (-my * l.dy).toFixed(2) + 'px,0)'; };
    });

    if (FINE_POINTER && !REDUCED) {
      window.addEventListener('pointermove', (e) => {
        mouse.tx = e.clientX / window.innerWidth * 2 - 1;
        mouse.ty = e.clientY / window.innerHeight * 2 - 1;
      }, { passive: true });
    }

    if (REDUCED) { heroFrameOnce(); return; }

    const hero = $('#hero');
    if ('IntersectionObserver' in window && hero) {
      new IntersectionObserver((en) => { en.forEach((e) => (e.isIntersecting ? startHero() : stopHero())); }, { rootMargin: '0px' }).observe(hero);
    } else startHero();
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopHero(); else if (heroInView()) startHero(); });
  }
  function heroInView() { const h = $('#hero'); if (!h) return false; const r = h.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; }
  function heroFrameOnce() {
    if (heroFX.stars) heroFX.stars.draw(12, 0);
    if (heroFX.aurora) heroFX.aurora.render(14, 0, 0);
  }
  function startHero() {
    if (heroFX.running || document.hidden) return;
    heroFX.running = true; heroFX.last = performance.now();
    const loop = (now) => {
      if (!heroFX.running) return;
      heroFX.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - heroFX.last) / 1000);
      heroFX.last = now; heroFX.t += dt;
      mouse.x = lerp(mouse.x, mouse.tx, 0.05); mouse.y = lerp(mouse.y, mouse.ty, 0.05);
      for (let i = 0; i < heroFX.setters.length; i++) heroFX.setters[i](mouse.x, mouse.y);
      if (heroFX.stars) heroFX.stars.draw(heroFX.t, dt);
      if (heroFX.aurora) heroFX.aurora.render(heroFX.t, mouse.x, -mouse.y);
      if (heroFX.snow) heroFX.snow.draw(heroFX.t, dt, mouse.x);
    };
    heroFX.raf = requestAnimationFrame(loop);
  }
  function stopHero() { heroFX.running = false; cancelAnimationFrame(heroFX.raf); }

  /* ---------- finale aurora ---------- */
  function initFinaleAurora() {
    const c = $('#finaleAurora');
    const sec = $('#finale');
    if (!c || !sec) return;
    const a = safe(() => AuroraGL(c, { amp: 1.15, offset: 40 }), 'finale aurora');
    if (!a) { c.style.display = 'none'; html.classList.add('no-webgl'); return; }
    if (REDUCED) { a.render(20, 0, 0); return; }
    let running = false, raf = 0, t = 0, last = 0;
    const loop = (now) => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      t += Math.min(0.05, (now - last) / 1000); last = now;
      a.render(t, mouse.x, -mouse.y);
    };
    const start = () => { if (running || document.hidden) return; running = true; last = performance.now(); raf = requestAnimationFrame(loop); };
    const stop = () => { running = false; cancelAnimationFrame(raf); };
    if ('IntersectionObserver' in window) new IntersectionObserver((en) => en.forEach((e) => (e.isIntersecting ? start() : stop()))).observe(sec);
    else start();
    window.addEventListener('resize', debounce(() => a.resize(), 150));
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    // render one frame immediately so it is never blank
    a.render(0, 0, 0);
  }

  function debounce(fn, ms) { let id = 0; return function () { clearTimeout(id); id = setTimeout(fn, ms); }; }

  /* =========================================================
     FX overlays (lazy mount / destroy around the viewport)
     ========================================================= */
  function setupFX() {
    const hosts = $$('.spot__parallax');
    hosts.forEach((host) => {
      const img = $('img', host);
      if (!img) return;
      if (FX && typeof FX.kenBurns === 'function') safe(() => FX.kenBurns(img), 'kenBurns');
      else img.classList.add('kb');
    });
    $$('.day-opener__media img').forEach((img) => {
      if (FX && typeof FX.kenBurns === 'function') safe(() => FX.kenBurns(img), 'kenBurns');
      else img.classList.add('kb');
    });
    if (!FX) return;
    const live = new Map();
    const mount = (host) => {
      if (live.has(host)) return;
      const inst = safe(() => FX.mount(host, host.getAttribute('data-fx') || 'mist', { accent: host.getAttribute('data-accent') || '#7fe3ff', id: host.getAttribute('data-id') || undefined }), 'FX.mount');
      if (inst) live.set(host, inst);
    };
    const unmount = (host) => {
      const inst = live.get(host);
      if (!inst) return;
      safe(() => inst.destroy(), 'FX.destroy');
      live.delete(host);
    };
    if (!('IntersectionObserver' in window)) { hosts.forEach(mount); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? mount(e.target) : unmount(e.target)));
    }, { rootMargin: '90% 60% 90% 60%' });
    hosts.forEach((h) => io.observe(h));
  }

  /* =========================================================
     NAV, PROGRESS, ANCHORS
     ========================================================= */
  let lenis = null;

  function scrollToTarget(target, immediate) {
    if (target === 0 || target === '#top') {
      if (lenis) lenis.scrollTo(0, { duration: 2.0, immediate: !!immediate });
      else window.scrollTo({ top: 0, behavior: REDUCED || immediate ? 'auto' : 'smooth' });
      return;
    }
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    if (lenis) {
      const dist = Math.abs(el.getBoundingClientRect().top);
      lenis.scrollTo(el, { duration: clamp(dist / 2600, 1.0, 2.4), immediate: !!immediate });
    } else el.scrollIntoView({ behavior: REDUCED || immediate ? 'auto' : 'smooth' });
  }

  function setupNav() {
    const nav = $('#nav');
    const navDays = $('#navDays');
    const bar = $('#scrollProgress');
    let lastY = window.scrollY, ticking = false;

    const onScroll = () => {
      ticking = false;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (bar) bar.style.transform = 'scaleX(' + (max > 0 ? clamp(y / max, 0, 1) : 0).toFixed(4) + ')';
      if (nav) {
        nav.classList.toggle('is-scrolled', y > 40);
        const dy = y - lastY;
        if (Math.abs(dy) > 6) {
          nav.classList.toggle('is-hidden', dy > 0 && y > window.innerHeight * 0.9);
          lastY = y;
        }
      }
    };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
    onScroll();

    // reveal nav when the pointer approaches the top edge
    if (FINE_POINTER && nav) window.addEventListener('pointermove', (e) => { if (e.clientY < 70) nav.classList.remove('is-hidden'); }, { passive: true });

    // anchors
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (a.hasAttribute('data-top') || href === '#top') { e.preventDefault(); scrollToTarget(0); return; }
      if (!href || href.length < 2) return;
      const el = document.getElementById(href.slice(1));
      if (!el) return;
      e.preventDefault();
      scrollToTarget(el);
      if (history.replaceState) history.replaceState(null, '', href);
    });

    // active section highlighting
    let active = '';
    const setActive = (key) => {
      if (key === active) return;
      active = key;
      $$('[data-nav]', nav).forEach((a) => a.classList.toggle('is-active', a.getAttribute('data-nav') === key));
      const pill = navDays && navDays.querySelector('[data-nav="' + key + '"]');
      if (pill && navDays.scrollWidth > navDays.clientWidth) {
        const left = pill.offsetLeft - navDays.clientWidth / 2 + pill.offsetWidth / 2;
        navDays.scrollTo({ left: left, behavior: REDUCED ? 'auto' : 'smooth' });
      }
    };
    if (!('IntersectionObserver' in window)) return;
    const keyed = $$('[data-nav-key]');
    ['#hero', '#manifesto', '#stats', '#band', '#route', '#finale'].forEach((s) => { const el = $(s); if (el) { el.setAttribute('data-nav-key', ''); keyed.push(el); } });
    const w = $('#worlds'); if (w) { w.setAttribute('data-nav-key', 'worlds'); keyed.push(w); }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.getAttribute('data-nav-key') || ''); });
    }, { rootMargin: '-49% 0px -50% 0px', threshold: 0 });
    keyed.forEach((el) => io.observe(el));
  }

  /* =========================================================
     WORLD CARD TILT
     ========================================================= */
  function setupTilt() {
    if (!FINE_POINTER || REDUCED) return;
    $$('.world-card').forEach((card) => {
      let raf = 0;
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          card.classList.add('is-tilting');
          card.style.setProperty('--ry', ((px - 0.5) * 10).toFixed(2) + 'deg');
          card.style.setProperty('--rx', (-(py - 0.5) * 8).toFixed(2) + 'deg');
          card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
          card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
        });
      });
      card.addEventListener('pointerleave', () => {
        cancelAnimationFrame(raf);
        card.classList.remove('is-tilting');
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* =========================================================
     SCROLL STORY (GSAP)
     ========================================================= */
  let introTl = null;

  function buildIntro() {
    if (!HAS_GSAP || REDUCED) return;
    const chars = $$('#heroTitle .ch');
    introTl = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' } });
    introTl
      .from(['.hero__photo', '#heroAurora', '#heroStars'], { opacity: 0, duration: 3, stagger: 0.25, ease: 'power2.out' }, 0)
      .from('.hero__mtn--far .mtn-svg', { yPercent: 16, duration: 2.4 }, 0.05)
      .from('.hero__mtn--mid .mtn-svg', { yPercent: 26, duration: 2.4 }, 0.15)
      .from('.hero__mtn--near .mtn-svg', { yPercent: 42, duration: 2.4 }, 0.25)
      .from('#heroSnow', { opacity: 0, duration: 2.5, ease: 'power1.out' }, 0.6)
      .from(['#heroStatus', '.hero__eyebrow'], { opacity: 0, y: 18, duration: 1.4, stagger: 0.1 }, 0.55)
      .fromTo(chars, { opacity: 0, filter: 'blur(28px)', yPercent: 22, scale: 1.08 },
        { opacity: 1, filter: 'blur(0px)', yPercent: 0, scale: 1, duration: 2.1, stagger: 0.14, clearProps: 'filter' }, 0.6)
      .from(['#heroDates', '#heroSub', '.hero__ctas'], { opacity: 0, y: 26, duration: 1.4, stagger: 0.1 }, 1.25)
      .from(['.scroll-cue span', '.scroll-cue i'], { opacity: 0, y: 10, duration: 1.2, stagger: 0.1 }, 1.8);
  }

  function setupScroll() {
    if (!HAS_GSAP) {
      // no GSAP: keep route drawing scroll-linked with a plain listener
      const sec = $('#route');
      if (sec && RS.days.length) {
        const tick = () => {
          const r = sec.getBoundingClientRect();
          const total = r.height - window.innerHeight;
          updateRoute(total > 0 ? clamp(-r.top / total, 0, 1) : 0);
        };
        window.addEventListener('scroll', tick, { passive: true });
        tick();
      }
      return;
    }

    const mm = gsap.matchMedia();
    mm.add({
      all: 'all',
      desktop: '(min-width: 1024px) and (min-height: 600px)',
      reduce: '(prefers-reduced-motion: reduce)'
    }, (ctx) => {
      const c = ctx.conditions;
      const motion = !c.reduce;
      const radius = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--radius')) || 28;

      /* ---- hero fly-through ---- */
      if (motion) {
        const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom bottom', scrub: 0.6 } });
        tl.to('.scroll-cue', { opacity: 0, duration: 0.08 }, 0)
          .to('#heroContent', { scale: 1.5, opacity: 0, yPercent: -4, duration: 0.5, ease: 'power1.in' }, 0)
          .to('#heroSpace', { scale: 1.22, yPercent: 3, duration: 1 }, 0)
          .to('.hero__mtn--far', { scale: 1.32, yPercent: 5, duration: 1 }, 0)
          .to('.hero__mtn--mid', { scale: 2.0, yPercent: 10, duration: 1 }, 0)
          .to('.hero__mtn--near', { scale: 3.7, yPercent: 26, duration: 1 }, 0)
          .to('#heroSnow', { scale: 1.5, duration: 1 }, 0)
          .to('.hero__fade', { opacity: 1, duration: 0.28 }, 0.72);
      }

      /* ---- manifesto ---- */
      const words = $$('#manifestoText .w');
      if (motion && words.length) {
        gsap.fromTo(words, { opacity: 0.14 }, {
          opacity: 1, ease: 'none', stagger: 0.35, duration: 1,
          scrollTrigger: { trigger: '#manifesto', start: 'top 30%', end: 'bottom 85%', scrub: 0.5 }
        });
        gsap.fromTo('.manifesto__orb', { rotate: -30, scale: 0.8, opacity: 0.4 }, {
          rotate: 60, scale: 1.25, opacity: 1, ease: 'none',
          scrollTrigger: { trigger: '#manifesto', start: 'top bottom', end: 'bottom top', scrub: true }
        });
        gsap.from('.manifesto__eyebrow', { opacity: 0, y: 20, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '#manifesto', start: 'top 60%' } });
      }

      /* ---- stats ---- */
      $$('.stat').forEach((el, i) => {
        const b = $('b[data-count]', el);
        const raw = b ? b.getAttribute('data-count') : '';
        const num = parseFloat(String(raw).replace(/,/g, ''));
        const decimals = (String(raw).split('.')[1] || '').length;
        const comma = /,/.test(raw) || num >= 10000;
        const fmt = (v) => (comma ? Number(v.toFixed(decimals)).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : v.toFixed(decimals));
        if (motion) gsap.from(el, { opacity: 0, y: 50, duration: 1.4, ease: 'expo.out', delay: i * 0.08, scrollTrigger: { trigger: '#statsGrid', start: 'top 85%' } });
        if (b && isFinite(num) && motion) {
          const o = { v: 0 };
          b.textContent = fmt(0);
          gsap.to(o, {
            v: num, duration: 2.2, ease: 'power3.out', delay: i * 0.08,
            onUpdate: () => { b.textContent = fmt(o.v); },
            onComplete: () => { b.textContent = raw; },
            scrollTrigger: { trigger: '#statsGrid', start: 'top 85%' }
          });
        }
      });
      if (motion) gsap.from('#stats .eyebrow', { opacity: 0, y: 16, duration: 1, scrollTrigger: { trigger: '#stats', start: 'top 80%' } });

      /* ---- road band: rounded frame expands to full-bleed ---- */
      if (motion && $('#band')) {
        const from = c.desktop ? 'inset(14% 10% 14% 10% round 36px)' : 'inset(18% 5% 18% 5% round 24px)';
        gsap.fromTo('#bandFrame', { clipPath: from }, { clipPath: 'inset(0% 0% 0% 0% round 0px)', ease: 'none', scrollTrigger: { trigger: '#band', start: 'top top', end: 'bottom bottom', scrub: true } });
        gsap.fromTo('#bandFrame img', { scale: 1.25 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '#band', start: 'top bottom', end: 'bottom bottom', scrub: true } });
        gsap.from('.band__copy', { yPercent: 40, opacity: 0, ease: 'none', scrollTrigger: { trigger: '#band', start: 'top 70%', end: 'top top', scrub: true } });
      }

      /* ---- route map ---- */
      if (RS.days.length) {
        ST.create({ trigger: '#route', start: 'top top', end: 'bottom bottom', onUpdate: (s) => updateRoute(s.progress), onRefresh: (s) => updateRoute(s.progress) });
        if (motion) {
          gsap.from('#routeMap svg', { opacity: 0, scale: 0.9, ease: 'none', scrollTrigger: { trigger: '#route', start: 'top 85%', end: 'top top', scrub: true } });
          gsap.from('#routeCaption > *', { opacity: 0, y: 30, stagger: 0.08, ease: 'none', scrollTrigger: { trigger: '#route', start: 'top 70%', end: 'top top', scrub: true } });
        }
      }

      /* ---- days ---- */
      $$('.day').forEach((day) => {
        const opener = $('.day-opener', day);
        if (opener && motion) {
          gsap.fromTo($('.day-opener__media', opener), { yPercent: -9, scale: 1.12 }, { yPercent: 9, scale: 1, ease: 'none', scrollTrigger: { trigger: opener, start: 'top bottom', end: 'bottom top', scrub: true } });
          const parts = $$('.day-opener__kicker, .day-opener__num, .day-opener__title, .day-opener__sub, .day-opener__chips', opener);
          gsap.from(parts, { opacity: 0, y: 70, duration: 1.5, stagger: 0.09, ease: 'expo.out', scrollTrigger: { trigger: opener, start: 'top 55%', toggleActions: 'play none none reverse' } });
          gsap.to($('.day-opener__content', opener), { opacity: 0, y: -90, ease: 'none', scrollTrigger: { trigger: opener, start: 'bottom 75%', end: 'bottom 15%', scrub: true } });
        }

        const body = $('.day-body', day);
        if (!body) return;
        const spots = $$('.spot', body);
        const horizontal = motion && c.desktop && body.classList.contains('is-long');

        if (horizontal) {
          body.classList.add('is-h');
          const track = $('.spots', body);
          const dist = () => Math.max(0, track.scrollWidth - window.innerWidth);
          const barFill = $('.h-ui__bar i', body);
          const count = $('.h-ui__count', body);
          const n = spots.length;
          let lastIdx = -1;
          const tween = gsap.to(track, {
            x: () => -dist(), ease: 'none',
            scrollTrigger: {
              trigger: body, start: 'top top', end: () => '+=' + dist(), pin: true, scrub: 0.8, anticipatePin: 1, invalidateOnRefresh: true,
              onUpdate: (s) => {
                if (barFill) barFill.style.transform = 'scaleX(' + s.progress.toFixed(4) + ')';
                const idx = Math.min(n - 1, Math.floor(s.progress * n));
                if (idx !== lastIdx && count) { lastIdx = idx; count.textContent = pad2(idx + 1) + ' / ' + pad2(n); }
              }
            }
          });
          // pre-load the strip's images before it arrives
          const eager = () => $$('img', body).forEach((im) => { im.loading = 'eager'; });
          ST.create({ trigger: body, start: 'top bottom+=600', once: true, onEnter: eager });
          spots.forEach((spot) => {
            const par = $('.spot__parallax', spot);
            if (par) gsap.fromTo(par, { xPercent: -5, scale: 1.14 }, { xPercent: 5, scale: 1.14, ease: 'none', scrollTrigger: { trigger: spot, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true } });
            gsap.from($$('.spot__body > *', spot), { opacity: 0, x: 70, duration: 1.1, stagger: 0.06, ease: 'expo.out', scrollTrigger: { trigger: spot, containerAnimation: tween, start: 'left 88%', toggleActions: 'play none none reverse' } });
          });
          gsap.from($$('.h-intro > *', body), { opacity: 0, y: 40, duration: 1.3, stagger: 0.1, ease: 'expo.out', scrollTrigger: { trigger: body, start: 'top 60%' } });
          return;
        }

        const fill = $('.timeline__fill', body);
        const spotsWrap = $('.spots', body);
        if (fill) {
          if (motion) gsap.fromTo(fill, { scaleY: 0 }, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: spotsWrap, start: 'top 60%', end: 'bottom 60%', scrub: true } });
          else gsap.set(fill, { scaleY: 1 });
        }
        spots.forEach((spot) => {
          ST.create({ trigger: spot, start: 'top 60%', onEnter: () => spot.classList.add('is-on'), onLeaveBack: () => spot.classList.remove('is-on') });
          if (!motion) return;
          const media = $('.spot__media', spot);
          const par = $('.spot__parallax', spot);
          const r = media ? (parseFloat(getComputedStyle(media).borderTopLeftRadius) || radius()) : radius();
          if (media) {
            gsap.fromTo(media,
              { clipPath: 'inset(9% 7% 9% 7% round ' + r + 'px)' },
              { clipPath: 'inset(0% 0% 0% 0% round ' + r + 'px)', ease: 'none', scrollTrigger: { trigger: spot, start: 'top 98%', end: 'top 40%', scrub: true } });
          }
          if (par) gsap.fromTo(par, { yPercent: -6, scale: 1.16 }, { yPercent: 6, scale: 1.02, ease: 'none', scrollTrigger: { trigger: spot, start: 'top bottom', end: 'bottom top', scrub: true } });
          gsap.from($$('.spot__body > *', spot), { opacity: 0, y: 46, duration: 1.3, stagger: 0.08, ease: 'expo.out', scrollTrigger: { trigger: spot, start: 'top 72%' } });
        });
      });

      /* ---- worlds ---- */
      if (motion) {
        gsap.from('#worlds .section-head > *', { opacity: 0, y: 40, duration: 1.3, stagger: 0.1, ease: 'expo.out', scrollTrigger: { trigger: '#worlds', start: 'top 70%' } });
        gsap.from('.world-card', { opacity: 0, y: 90, duration: 1.5, stagger: 0.1, ease: 'expo.out', clearProps: 'transform,opacity', scrollTrigger: { trigger: '#worldsGrid', start: 'top 82%' } });
      }

      /* ---- finale ---- */
      if (motion) {
        const ft = gsap.timeline({ scrollTrigger: { trigger: '#finale', start: 'top 55%' }, defaults: { ease: 'expo.out' } });
        ft.from('#finale .eyebrow', { opacity: 0, y: 20, duration: 1.2 })
          .from('.finale__title', { opacity: 0, scale: 0.9, filter: 'blur(24px)', duration: 2, clearProps: 'filter' }, 0.1)
          .from('.finale__sub', { opacity: 0, y: 26, duration: 1.4 }, 0.5)
          .from('.finale__actions', { opacity: 0, y: 26, duration: 1.4 }, 0.65);
        gsap.fromTo('.finale__bg img', { scale: 1.2 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '#finale', start: 'top bottom', end: 'bottom bottom', scrub: true } });
      }

      return () => {
        $$('.day-body.is-h').forEach((b) => b.classList.remove('is-h'));
      };
    });
  }

  /* =========================================================
     PRELOADER
     ========================================================= */
  function runPreloader(onDone) {
    const pre = $('#preloader');
    const bar = $('#preloaderBar');
    const pct = $('#preloaderPct');
    if (!pre) { onDone(); return; }
    if (bar) bar.style.transition = 'none';
    const start = performance.now();
    const MIN = REDUCED ? 250 : 1500, MAX = 5000;
    const srcs = ['assets/img/aurora.jpg'];
    const firstDay = DAYS[0] && pickHero(DAYS[0]);
    if (firstDay) srcs.push(imgSrc(firstDay.img || firstDay.id));
    const jobs = srcs.map((src) => new Promise((res) => { const im = new Image(); im.onload = im.onerror = () => res(); im.src = src; }));
    if (document.fonts && document.fonts.ready) jobs.push(Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3500))]).catch(() => {}));
    let done = 0;
    jobs.forEach((j) => j.then(() => { done++; }));
    let shown = 0, finished = false;
    const frame = (now) => {
      if (finished) return;
      const el = now - start;
      const target = el > MAX ? 1 : Math.min(jobs.length ? done / jobs.length : 1, el / MIN);
      shown += (target - shown) * 0.1;
      if (target >= 1 && shown > 0.985) shown = 1;
      if (bar) bar.style.transform = 'scaleX(' + shown.toFixed(4) + ')';
      if (pct) pct.textContent = Math.round(shown * 100) + '%';
      if (shown >= 1) { finished = true; setTimeout(onDone, 120); return; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function exitPreloader() {
    const pre = $('#preloader');
    html.classList.remove('is-loading');
    if (lenis) lenis.start();
    if (HAS_GSAP) ST.refresh();
    if (!pre) { if (introTl) introTl.play(); return; }
    if (HAS_GSAP && !REDUCED) {
      const letters = $$('.preloader__word span', pre);
      letters.forEach((s) => { s.style.animation = 'none'; s.style.opacity = '1'; s.style.transform = 'none'; });
      pre.style.animation = 'none';
      const tl = gsap.timeline({ onComplete: () => pre.remove() });
      tl.to(letters, { yPercent: -120, opacity: 0, duration: 0.7, stagger: 0.04, ease: 'power3.in' })
        .to(['.preloader__line', '.preloader__meta'], { opacity: 0, duration: 0.4 }, 0)
        .to(pre, { clipPath: 'inset(0% 0% 100% 0%)', duration: 1.15, ease: 'expo.inOut' }, 0.45)
        .add(() => { if (introTl) introTl.play(); }, 0.75);
    } else {
      pre.style.transition = 'opacity .6s ease';
      pre.style.opacity = '0';
      setTimeout(() => pre.remove(), 650);
      if (introTl) introTl.play();
    }
    // deep link (#day-d4 etc.)
    if (location.hash && location.hash.length > 1) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) setTimeout(() => scrollToTarget(el, true), 60);
    }
  }

  /* =========================================================
     BOOT
     ========================================================= */
  function boot() {
    window.scrollTo(0, 0);

    safe(renderNav, 'nav');
    safe(renderHero, 'hero');
    safe(renderManifesto, 'manifesto');
    safe(renderStats, 'stats');
    safe(renderRoute, 'route');
    safe(renderDays, 'days');
    safe(renderWorlds, 'worlds');
    safe(renderFinale, 'finale');
    safe(renderCredits, 'credits');

    // broken images: keep the dark placeholder instead of a broken icon
    document.addEventListener('error', (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG') t.classList.add('is-broken');
    }, true);

    safe(initHeroVisuals, 'hero visuals');
    safe(initFinaleAurora, 'finale aurora');
    safe(setupFX, 'fx');
    safe(setupTilt, 'tilt');

    // smooth scrolling
    if (window.Lenis && !REDUCED) {
      safe(() => {
        lenis = new window.Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true, touchMultiplier: 1.5 });
        if (HAS_GSAP) {
          lenis.on('scroll', ST.update);
          gsap.ticker.add((time) => { lenis.raf(time * 1000); });
          gsap.ticker.lagSmoothing(0);
        } else {
          const raf = (time) => { lenis.raf(time); requestAnimationFrame(raf); };
          requestAnimationFrame(raf);
        }
        lenis.stop();
      }, 'lenis');
    }

    safe(setupNav, 'nav behaviour');
    safe(buildIntro, 'intro');
    safe(setupScroll, 'scroll');

    const onResize = debounce(() => {
      if (heroFX.stars) heroFX.stars.resize();
      if (heroFX.snow) heroFX.snow.resize();
      if (heroFX.aurora) heroFX.aurora.resize();
      if (REDUCED) heroFrameOnce();
      sizeRoute();
    }, 150);
    window.addEventListener('resize', onResize);

    if (HAS_GSAP) {
      window.addEventListener('load', () => ST.refresh());
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { sizeRoute(); ST.refresh(); }).catch(() => {});
    }

    runPreloader(exitPreloader);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
