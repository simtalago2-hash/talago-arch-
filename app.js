/* Talago Arch: personal drafting sketchbook
 * Plain JS, no build step. Data is stored on-device (localStorage).
 * Sketch coordinates are stored in grid units (1 unit = 1 dot spacing).
 */
'use strict';

/* ================================================================ utils */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => Date.now();
const pad2 = n => String(n).padStart(2, '0');

const GRID_OPTIONS = []; // 1 to 20 in 0.5 steps (unitless)
for (let v = 1; v <= 20; v += 0.5) GRID_OPTIONS.push(v);

// Line weights after Ching: index 0 = grid/layout, 1 = secondary, 2 = major/primary.
const PEN_WEIGHTS = [
  { name: 'Layout', full: 'Grid / layout', hint: 'Construction, layout, lines on planes, textures', lead: 'F/H · 2H · 4H', end: 1.5, mid: 0.65, free: 0.9, alpha: 0.55 },
  { name: 'Secondary', full: 'Secondary', hint: 'Elevations, corners, intersections of planes', lead: 'HB · F/H', end: 3.6, mid: 1.25, free: 1.6, alpha: 1 },
  { name: 'Major', full: 'Major / primary', hint: 'Cuts, profiles, slices through spaces', lead: 'HB · F/H', end: 6.0, mid: 2.2, free: 2.6, alpha: 1 },
];
// Line types after Ching. Dash patterns in px at 100% (on, off, on, off…), always starting and ending on a dash.
const LINE_TYPES = {
  solid: { name: 'Solid', hint: 'Cut, profile and elevation lines', dash: null },
  above: { name: 'Dashed: above cut', hint: 'Overhead elements, longer dashes', dash: [15, 5.5] },
  below: { name: 'Dashed: below cut', hint: 'Hidden elements, short tight dashes', dash: [7, 4.5] },
  center: { name: 'Centerline', hint: 'Long–short–long, long dashes about equal', dash: [30, 5, 5, 5] },
};
const typeOf = el => LINE_TYPES[el.k] ? el.k : 'solid';
const INKS = [
  { name: 'Ink', hex: '#2c2e29' },
  { name: 'Red', hex: '#af3129' },
  { name: 'Blue', hex: '#2f5b86' },
  { name: 'Graphite', hex: '#8b8d85' },
];
const BASE_Z = 20;            // CSS px per grid unit at 100% zoom
const SNAP_PX = 16;           // endpoint snap radius in screen px
const RED = '#af3129';
const PAPER = '#fcfcf8';
const DOT = '#b9bab5';
const MUTED = '#73756d';
const SANS = `'Helvetica Neue', Helvetica, Inter, Arial, sans-serif`;

const inkOf = el => (INKS[el.c] || INKS[0]).hex;
const isFree = el => el.t === 'f';
const isHatch = el => el.t === 'h';
const isLine = el => !el.t;

/** Unitless number: up to two decimals, no trailing zeros (3.5 could be inches or feet). */
function fmtLen(v) {
  const r = Math.round(Math.abs(v) * 100) / 100;
  return String(+r.toFixed(2));
}
const fmtGrid = v => fmtLen(v);
function fmtDate(t) { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function fileSafe(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'sketch'; }
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

/* ================================================================ storage */
const STORE_KEY = 'talago-arch-v1';
function normProject(p) { if (!Array.isArray(p.sketches)) p.sketches = []; if (!Array.isArray(p.schedules)) p.schedules = []; return p; }
const Store = {
  data: null,
  defaults() {
    return { projects: [], last: null, settings: { ortho: false, snap: true, dims: false, pen: 1, color: 0, tool: 'line', ltype: 'solid', hatch: 'x', hval: 1 } };
  },
  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { d = null; }
    const def = this.defaults();
    if (!d || !Array.isArray(d.projects)) d = def;
    d.settings = Object.assign({}, def.settings, d.settings || {});
    if (d.settings.tool === 'erase') d.settings.tool = 'line';
    d.projects.forEach(normProject);
    this.data = d;
  },
  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); return true; }
    catch (e) { toast('Could not save. Storage is full or blocked.'); return false; }
  },
  project(id) { return this.data.projects.find(p => p.id === id); },
  sketch(p, id) { return p ? p.sketches.find(s => s.id === id) : null; },
  schedule(p, id) { return p ? p.schedules.find(s => s.id === id) : null; },
  get settings() { return this.data.settings; },
};
Store.load();
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }

/* ================================================================ toast + modal */
let toastTimer = 0;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (action ? ` <button type="button">${esc(action.label)}</button>` : '');
  t.hidden = false;
  if (action) $('button', t).onclick = () => { t.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 12000 : 2400);
}

const Modal = {
  el: $('#modal'),
  card: $('#modal .modal-card'),
  resolve: null,
  open(html, onMount) {
    return new Promise(res => {
      if (this.resolve) this.resolve(null);
      this.resolve = res;
      this.card.innerHTML = html;
      this.el.hidden = false;
      onMount && onMount(this.card, v => this.close(v));
    });
  },
  close(v = null) {
    this.el.hidden = true;
    const r = this.resolve; this.resolve = null;
    r && r(v);
  },
};
Modal.el.addEventListener('pointerdown', e => { if (e.target === Modal.el) Modal.close(null); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !Modal.el.hidden) { e.stopPropagation(); Modal.close(null); } }, true);

function promptText(title, value = '', okLabel = 'Save') {
  return Modal.open(`<h2>${esc(title)}</h2>
    <form><input type="text" maxlength="80" autocomplete="off" value="${esc(value)}">
    <div class="btns"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">${esc(okLabel)}</button></div></form>`,
    (c, done) => {
      const inp = $('input', c);
      setTimeout(() => { inp.focus(); inp.select(); }, 30);
      $('[data-x]', c).onclick = () => done(null);
      $('form', c).onsubmit = e => { e.preventDefault(); done(inp.value.trim() || null); };
    });
}
function confirmBox(title, msg, okLabel = 'Delete') {
  return Modal.open(`<h2>${esc(title)}</h2><p>${esc(msg)}</p>
    <div class="btns"><button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn danger" data-ok>${esc(okLabel)}</button></div>`,
    (c, done) => { $('[data-x]', c).onclick = () => done(false); $('[data-ok]', c).onclick = () => done(true); });
}
/** actions: [{label, value, hint?, danger?, check?: boolean}] */
function actionSheet(title, actions) {
  return Modal.open(`<h2>${esc(title)}</h2><div class="sheet-list">${actions.map((a, i) =>
    `<button type="button" data-i="${i}" class="${a.danger ? 'danger' : ''}"><span>${esc(a.label)}${a.hint ? `<small>${esc(a.hint)}</small>` : ''}</span>${
      a.check !== undefined ? `<span class="check ${a.check ? 'on' : ''}">${a.check ? 'On' : 'Off'}</span>` : a.sel ? '<span class="check on">✓</span>' : ''}</button>`).join('')}</div>`,
    (c, done) => $$('[data-i]', c).forEach(b => b.onclick = () => done(actions[+b.dataset.i].value)));
}
function gridPicker(current) {
  return Modal.open(`<h2>Grid spacing</h2>
    <p>What one dot-to-dot space represents, in whatever unit you have in mind (inches, feet…). The drawing isn't rescaled; this just lets you dimension from grid to grid.</p>
    <div class="opts">${GRID_OPTIONS.map(v => `<button type="button" data-v="${v}" class="${v === current ? 'on' : ''}">${fmtGrid(v)}</button>`).join('')}</div>
    <div class="btns" style="margin-top:18px"><button type="button" class="btn" data-x>Cancel</button></div>`,
    (c, done) => {
      $('[data-x]', c).onclick = () => done(null);
      $$('[data-v]', c).forEach(b => b.onclick = () => done(+b.dataset.v));
      const on = $('.on', c); on && on.scrollIntoView({ block: 'center' });
    });
}
function penPicker() {
  const s = Store.settings;
  return Modal.open(`<h2>Pen</h2>
    <div class="label">Ink</div>
    <div class="colors">${INKS.map((k, i) => `<button type="button" data-c="${i}" class="${i === s.color ? 'on' : ''}" style="background:${k.hex}" aria-label="${k.name}"></button>`).join('')}</div>
    <div class="label">Line weight</div>
    <div class="sheet-list pick">${[2, 1, 0].map(i => { const w = PEN_WEIGHTS[i]; return `<button type="button" data-w="${i}" class="${i === s.pen ? 'on' : ''}"><span>${w.full}<small>${w.hint}</small></span><svg class="lt" viewBox="0 0 64 12"><path d="M3 6h58" style="stroke-width:${[1, 1.8, 3.2][i]};opacity:${w.alpha}"/></svg></button>`; }).join('')}</div>
    <div class="label">Line type</div>
    <div class="sheet-list pick">${Object.entries(LINE_TYPES).map(([k, t]) => `<button type="button" data-k="${k}" class="${k === s.ltype ? 'on' : ''}"><span>${t.name}<small>${t.hint}</small></span><svg class="lt" viewBox="0 0 64 12"><path d="M3 6h58" style="stroke-dasharray:${t.dash ? t.dash.map(v => v * 0.55).join(' ') : 'none'}"/></svg></button>`).join('')}</div>
    <div class="btns" style="margin-top:20px"><button type="button" class="btn primary" data-x>Done</button></div>`,
    (c, done) => {
      $('[data-x]', c).onclick = () => done(true);
      $$('[data-c]', c).forEach(b => b.onclick = () => { s.color = +b.dataset.c; $$('[data-c]', c).forEach(x => x.classList.toggle('on', x === b)); });
      $$('[data-w]', c).forEach(b => b.onclick = () => { s.pen = +b.dataset.w; $$('[data-w]', c).forEach(x => x.classList.toggle('on', x === b)); });
      $$('[data-k]', c).forEach(b => b.onclick = () => { s.ltype = b.dataset.k; $$('[data-k]', c).forEach(x => x.classList.toggle('on', x === b)); });
    });
}

/* ================================================================ projection */
// Points are 3D in grid units: x, y on the plan, z = height (0 on the plan).
// A projection maps them onto the page: rotate the plan by r°, scale page-y by k,
// and lift by z·h. Plan view is r=0, k=1, h=0.
const AXO_TYPES = {
  '45': { name: '45° / 45°', hint: 'Plan oblique: true plan shape and true heights', r: 45, k: 1, h: 1 },
  '30': { name: '30° / 60°', hint: 'Plan oblique, favouring one face', r: 30, k: 1, h: 1 },
  '60': { name: '60° / 30°', hint: 'Plan oblique, favouring the other face', r: 60, k: 1, h: 1 },
  'iso': { name: 'Isometric', hint: 'All three axes at 120°', r: 45, k: Math.tan(Math.PI / 6), h: Math.sqrt(2 / 3) },
};
const PLAN_PROJ = { r: 0, k: 1, h: 0 };
function axoParams(sk) {
  const a = sk.axo || {}, t = AXO_TYPES[a.type] || AXO_TYPES['45'];
  return { r: t.r + 90 * (a.q || 0), k: t.k, h: t.h };
}
function makeProj(pr) {
  const rad = pr.r * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  return {
    r: pr.r, k: pr.k, h: pr.h,
    flat: pr.h === 0 && pr.k === 1 && ((pr.r % 360) + 360) % 360 === 0,
    P(p) { const z = p.z || 0; return { x: p.x * c - p.y * s, y: (p.x * s + p.y * c) * pr.k - z * pr.h }; },
    /** Page point back to the horizontal plane at height z0. */
    inv(X, Y, z0 = 0) { const Yr = (Y + z0 * pr.h) / pr.k; return { x: X * c + Yr * s, y: -X * s + Yr * c, z: z0 }; },
  };
}
const PLAN = makeProj(PLAN_PROJ);
const r3 = v => Math.round(v * 1000) / 1000;
/** Compact stored point: z only when off the plan. */
function pt(p) { const o = { x: r3(p.x), y: r3(p.y) }; if (p.z) o.z = r3(p.z); return o; }
const len3 = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0));
const elevated = el => isHatch(el) ? false : isFree(el) ? el.pts.some(p => p.z) : !!(el.a.z || el.b.z);

/* ================================================================ drawing primitives */
function weightScale(z) { return Math.sqrt(z / BASE_Z); }

/** Small deterministic random generator, so each line keeps the same wiggle on every redraw. */
function seededRand(seed) {
  let t = (seed >>> 0) || 1;
  return () => { t = (t + 0x6D2B79F5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
/** Seed from a line's own coordinates. */
function lineSeed(a, b) {
  let h = 2166136261;
  for (const v of [a.x, a.y, a.z || 0, b.x, b.y, b.z || 0]) { h ^= Math.round(v * 1000); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Straight line, heavier at both ends (the architect's "hit" at start and finish).
 *  Every line gets a slight hand-drawn wiggle that fades out at both ends,
 *  so corners still meet exactly. */
function drawTaper(ctx, ax, ay, bx, by, wEnd, wMid, color, seed, dash) {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  ctx.fillStyle = color;
  ctx.beginPath();
  if (L < 0.5) { ctx.arc(ax, ay, wEnd / 2, 0, Math.PI * 2); ctx.fill(); return; }
  const nx = -dy / L, ny = dx / L;
  const k = Math.min(L * 0.16, 9 + wEnd * 3);           // length of the heavy end zone
  const half = d => (wMid + (wEnd - wMid) * Math.exp(-d / Math.max(k, 0.001))) / 2;
  // Hand wiggle: a gentle bow plus two soft waves, amplitude in screen px.
  let off = () => 0;
  if (seed != null && L > 12) {
    const rnd = seededRand(seed);
    const amp = clamp(L * 0.0045, 0.35, 1.9);
    const bow = (rnd() * 2 - 1) * amp * 0.9;
    const f1 = 1 + rnd() * 1.5, f2 = 2.5 + rnd() * 2.5, p1 = rnd() * 6.283, p2 = rnd() * 6.283;
    const a1 = amp * (0.55 + rnd() * 0.3), a2 = amp * (0.2 + rnd() * 0.2);
    off = t => {
      const env = Math.pow(Math.sin(Math.PI * t), 0.7);   // 0 at both ends
      return env * (bow + a1 * Math.sin(6.283 * f1 * t + p1) + a2 * Math.sin(6.283 * f2 * t + p2));
    };
  }
  if (dash && L > dash[0] * 1.6) return drawDashes(ctx, ax, ay, dx, dy, nx, ny, L, wEnd, wMid, off, dash);
  const N = clamp(Math.ceil(L / 3), 10, 200);
  const ts = [];
  for (let i = 0; i <= N; i++) ts.push(0.5 - 0.5 * Math.cos(Math.PI * i / N)); // denser near the ends
  ts.forEach((t, i) => {
    const o = off(t), h = half(Math.min(t, 1 - t) * L);
    const x = ax + dx * t + nx * (o + h), y = ay + dy * t + ny * (o + h);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  for (let i = ts.length - 1; i >= 0; i--) {
    const t = ts[i], o = off(t), h = half(Math.min(t, 1 - t) * L);
    ctx.lineTo(ax + dx * t + nx * (o - h), ay + dy * t + ny * (o - h));
  }
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(ax, ay, wEnd / 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(bx, by, wEnd / 2, 0, Math.PI * 2); ctx.fill();
}

/** Split a line of length L into dashes [t0, t1] that start and end on a full dash. */
function dashSegments(L, pat) {
  const cycle = pat.reduce((s, v) => s + v, 0), first = pat[0];
  const n = Math.max(1, Math.round((L - first) / cycle));
  const k = L / (n * cycle + first);                 // stretch the pattern to fit exactly
  const segs = [];
  let d = 0, i = 0;
  while (d < L - 1e-6) {
    const len = pat[i % pat.length] * k;
    if (i % 2 === 0) segs.push([d / L, Math.min(d + len, L) / L]);
    d += len; i++;
  }
  return segs;
}
/** Dashed / centerline rendering along the same wiggled path, each dash with a light hit at its ends. */
function drawDashes(ctx, ax, ay, dx, dy, nx, ny, L, wEnd, wMid, off, dash) {
  const base = wMid * 1.2, hit = Math.min(wEnd * 0.6, wMid * 1.6);
  for (let [t0, t1] of dashSegments(L, dash)) {
    // Pull each dash end in by its cap radius so the gaps stay open and crisp.
    const inset = (hit / 2) / L, mid = (t0 + t1) / 2;
    t0 = Math.min(t0 + inset, mid); t1 = Math.max(t1 - inset, mid);
    const len = (t1 - t0) * L, M = clamp(Math.ceil(len / 2), 3, 40);
    const hw = t => { const dd = Math.min(t - t0, t1 - t) * L; return (base + (hit - base) * Math.exp(-dd / 2.5)) / 2; };
    const P = (t, sgn) => { const o = off(t), h = hw(t) * sgn; return [ax + dx * t + nx * (o + h), ay + dy * t + ny * (o + h)]; };
    ctx.beginPath();
    for (let j = 0; j <= M; j++) { const [x, y] = P(t0 + (t1 - t0) * j / M, 1); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    for (let j = M; j >= 0; j--) { const [x, y] = P(t0 + (t1 - t0) * j / M, -1); ctx.lineTo(x, y); }
    ctx.closePath(); ctx.fill();
    for (const t of [t0, t1]) { const o = off(t); ctx.beginPath(); ctx.arc(ax + dx * t + nx * o, ay + dy * t + ny * o, hw(t), 0, Math.PI * 2); ctx.fill(); }
  }
}

/* ---------- hatching (after Ching: hatching, crosshatching, value by spacing) ---------- */
// Angles in degrees on the page/plan (y down): -45 = ⟋, 45 = ⟍.
const HATCH_PATTERNS = {
  'd1': { name: 'Diagonal hatching ⟋', hint: 'One set of parallel strokes: lighter values', angles: [-45] },
  'd2': { name: 'Diagonal hatching ⟍', hint: 'The other diagonal', angles: [45] },
  'x': { name: 'Crosshatching', hint: 'Two perpendicular sets: middle to dark values', angles: [-45, 45] },
  'xx': { name: 'Layered crosshatching', hint: 'Four sets: the darkest range, paper still shows', angles: [-45, 45, 0, 90] },
};
// Value is set by spacing (grid units). Even "dark" keeps the white of the paper.
const HATCH_VALUES = [
  { name: 'Light', sp: 0.42 },
  { name: 'Medium', sp: 0.27 },
  { name: 'Dark', sp: 0.17 },
];
const hatchCache = new WeakMap();
/** Scanline a polygon into freehand hatch strokes at one angle. Returns [[p0, p1], ...] in the polygon's own space. */
function hatchSegments(poly, angleDeg, sp, seed) {
  const r = angleDeg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const R = poly.map(p => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c }));
  let y0 = Infinity, y1 = -Infinity;
  for (const p of R) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  if (!isFinite(y0) || (y1 - y0) / sp > 4000) return [];
  const rnd = seededRand(seed), out = [];
  for (let y = Math.ceil(y0 / sp) * sp; y <= y1; y += sp) {
    const xs = [];
    for (let i = 0; i < R.length; i++) {
      const p = R[i], q = R[(i + 1) % R.length];
      if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) xs.push(p.x + (y - p.y) * (q.x - p.x) / (q.y - p.y));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      // Freehand ends: strokes stop a little short or run a touch long, never ruled-perfect.
      const xa = xs[i] + (rnd() - 0.55) * 0.6 * sp, xb = xs[i + 1] + (rnd() - 0.45) * 0.6 * sp;
      if (xb - xa < sp * 0.4) continue;
      const ya = y + (rnd() - 0.5) * 0.22 * sp, yb = y + (rnd() - 0.5) * 0.22 * sp;
      out.push([{ x: xa * c - ya * s, y: xa * s + ya * c }, { x: xb * c - yb * s, y: xb * s + yb * c }]);
    }
  }
  return out;
}
function cachedHatch(el, k) {
  let entry = hatchCache.get(el);
  if (!entry || entry.k !== k) {
    const pat = HATCH_PATTERNS[el.pat] || HATCH_PATTERNS.d1, v = HATCH_VALUES[el.v] || HATCH_VALUES[1];
    entry = { k, sets: pat.angles.map((ang, i) => hatchSegments(el.pts, ang, v.sp * k, (el.seed || 1) + i * 7919)) };
    hatchCache.set(el, entry);
  }
  return entry.sets;
}
/** Draw a hatch. S maps hatch-space points to screen; unitPx = screen px per hatch-space unit. */
/** Draw a hatch. S maps hatch-space points to screen; unitPx = screen px per hatch-space unit.
 *  Each stroke is a fine line that gains weight where the pen lands and lifts, like a drawn hatch.
 *  Drawn in three batched passes (fine body, then two end-hit passes) to stay fast. */
function drawHatch(ctx, el, S, unitPx, ws, color) {
  const v = HATCH_VALUES[el.v] || HATCH_VALUES[1];
  const k = Math.max(1, Math.ceil(2.4 / (v.sp * unitPx)));     // thin out when zoomed far out
  const w = clamp(0.62 * ws, 0.5, 1.5);
  const body = new Path2D(), hitA = new Path2D(), hitB = new Path2D();
  let n = 0;
  for (const segs of cachedHatch(el, k)) for (const [p0, p1] of segs) {
    const a = S(p0), b = S(p1);
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const bow = ((((n++) * 9301 + 49297) % 233280) / 233280 - 0.5) * Math.min(1.2, L * 0.02);
    body.moveTo(a.x, a.y);
    body.quadraticCurveTo((a.x + b.x) / 2 - uy * bow, (a.y + b.y) / 2 + ux * bow, b.x, b.y);
    // End hits: a short medium-weight run, and a shorter heavy tip, at both ends.
    const r1 = Math.min(6 * Math.max(ws, 0.8), L * 0.24), r2 = Math.min(2.6 * Math.max(ws, 0.8), L * 0.11);
    hitA.moveTo(a.x, a.y); hitA.lineTo(a.x + ux * r1, a.y + uy * r1);
    hitA.moveTo(b.x, b.y); hitA.lineTo(b.x - ux * r1, b.y - uy * r1);
    hitB.moveTo(a.x, a.y); hitB.lineTo(a.x + ux * r2, a.y + uy * r2);
    hitB.moveTo(b.x, b.y); hitB.lineTo(b.x - ux * r2, b.y - uy * r2);
  }
  ctx.strokeStyle = color; ctx.lineCap = 'round';
  ctx.lineWidth = w; ctx.stroke(body);
  ctx.lineWidth = w * 1.4; ctx.stroke(hitA);
  ctx.lineWidth = w * 1.95; ctx.stroke(hitB);
}
/** Ramer–Douglas–Peucker simplification of an open polyline (screen px). */
function simplifyPath(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let idx = -1, dmax = 0;
  const a = pts[0], b = pts[pts.length - 1], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = L < 1e-9 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / L;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [a, b];
  return simplifyPath(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplifyPath(pts.slice(idx), eps));
}
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
const axoKey = sk => `${(sk.axo && sk.axo.type) || '45'}:${(sk.axo && sk.axo.q) || 0}`;

/** Freehand pencil stroke, smoothed through midpoints. pts in screen px. */
function drawFree(ctx, pts, w, color) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (pts.length === 1) { ctx.fillStyle = color; ctx.arc(pts[0].x, pts[0].y, w / 2, 0, Math.PI * 2); ctx.fill(); return; }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const l = pts[pts.length - 1]; ctx.lineTo(l.x, l.y);
  ctx.stroke();
}

/** Dot grid on the plan (z = 0), drawn through the current projection. */
/** On-screen spacing (px) of one grid step under a projection. */
function gridUnitPx(z, proj = PLAN) {
  if (proj.flat) return z;
  const O = proj.P({ x: 0, y: 0 }), ex = proj.P({ x: 1, y: 0 }), ey = proj.P({ x: 0, y: 1 });
  return Math.min(Math.hypot(ex.x - O.x, ex.y - O.y), Math.hypot(ey.x - O.x, ey.y - O.y)) * z;
}
// Half-grid dots fade in once the main dots are this far apart on screen; snapping uses them from SUB_SNAP_PX.
const SUB_SHOW_PX = 40, SUB_FULL_PX = 64, SUB_SNAP_PX = 44;
/** Grid step used for snapping: 1, or 0.5 when the half-grid dots are showing. */
function snapStepFor(z, proj = PLAN) { return gridUnitPx(z, proj) >= SUB_SNAP_PX ? 0.5 : 1; }
const roundTo = (v, step) => Math.round(v / step) * step;

/** Dot grid on the plan (z = 0), drawn through the current projection,
 *  with lighter half-grid dots when zoomed in far enough. */
function drawDots(ctx, view, W, H, proj = PLAN) {
  const { ox, oy, z } = view;
  if (!(z > 0) || !isFinite(z) || !isFinite(ox) || !isFinite(oy)) return;   // never loop on a bad view
  const unit = gridUnitPx(z, proj);
  if (!(unit > 1e-6) || !isFinite(unit)) return;
  const r = clamp(z * 0.06, 0.8, 1.6);
  let step = 1;
  while (step * unit < 11) step *= 2;
  // Visible range of grid coordinates.
  let x0, x1, y0, y1;
  if (proj.flat) {
    x0 = -ox / z; x1 = (W - ox) / z; y0 = -oy / z; y1 = (H - oy) / z;
  } else {
    const cs = [[0, 0], [W, 0], [0, H], [W, H]].map(([sx, sy]) => proj.inv((sx - ox) / z, (sy - oy) / z, 0));
    x0 = Math.min(...cs.map(c => c.x)); x1 = Math.max(...cs.map(c => c.x));
    y0 = Math.min(...cs.map(c => c.y)); y1 = Math.max(...cs.map(c => c.y));
  }
  while (((x1 - x0) / step) * ((y1 - y0) / step) > 60000) step *= 2;
  const sub = step === 1 && unit >= SUB_SHOW_PX;
  const fine = sub ? 0.5 : step;
  x0 = Math.floor(x0 / fine) * fine; y0 = Math.floor(y0 / fine) * fine;
  const main = new Path2D(), half = new Path2D(), rh = r * 0.62;
  for (let gy = y0; gy <= y1 + 1e-9; gy += fine) for (let gx = x0; gx <= x1 + 1e-9; gx += fine) {
    const q = proj.flat ? { x: gx, y: gy } : proj.P({ x: gx, y: gy });
    const sx = ox + q.x * z, sy = oy + q.y * z;
    if (sx < -2 || sy < -2 || sx > W + 2 || sy > H + 2) continue;
    const onMain = Math.abs(gx % step) < 1e-9 && Math.abs(gy % step) < 1e-9;
    if (onMain) { main.moveTo(sx + r, sy); main.arc(sx, sy, r, 0, Math.PI * 2); }
    else { half.moveTo(sx + rh, sy); half.arc(sx, sy, rh, 0, Math.PI * 2); }
  }
  ctx.fillStyle = DOT;
  ctx.fill(main);
  if (sub) {
    ctx.globalAlpha = 0.35 + 0.65 * clamp((unit - SUB_SHOW_PX) / (SUB_FULL_PX - SUB_SHOW_PX), 0, 1);
    ctx.fillStyle = '#c9cac3';
    ctx.fill(half);
    ctx.globalAlpha = 1;
  }
}

function drawDim(ctx, ax, ay, bx, by, label, color, offset = 12) {
  let a = Math.atan2(by - ay, bx - ax);
  if (a > Math.PI / 2 || a <= -Math.PI / 2) a += Math.PI;   // keep text upright
  const nx = Math.sin(a), ny = -Math.cos(a);
  ctx.save();
  ctx.translate((ax + bx) / 2 + nx * offset, (ay + by) / 2 + ny * offset);
  ctx.rotate(a);
  ctx.font = `500 12.5px ${SANS}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(252,252,248,.9)';
  ctx.fillRect(-w / 2 - 4, -8.5, w + 8, 17);
  ctx.fillStyle = color;
  ctx.fillText(label, 0, 0.5);
  ctx.restore();
}

/** Render a full scene. view = {ox, oy, z}; opts.proj = projection (plan by default). */
function drawScene(ctx, W, H, els, view, opts = {}) {
  const proj = opts.proj || PLAN;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  drawDots(ctx, view, W, H, proj);
  const ws = weightScale(view.z) * (opts.weightMul || 1);
  const { ox, oy, z } = view;
  const S = p => { const q = proj.P(p); return { x: ox + q.x * z, y: oy + q.y * z }; };
  const Spage = p => ({ x: ox + p.x * z, y: oy + p.y * z });
  const unit = gridUnitPx(z, proj);
  for (const el of els) {
    if (!isHatch(el)) continue;
    if (el.view && el.view !== opts.axoKey) continue;        // axo hatches belong to their axo view
    ctx.globalAlpha = el === opts.highlight ? 0.5 : 0.85;
    drawHatch(ctx, el, el.view ? Spage : S, el.view ? z : unit, ws, el === opts.highlight ? RED : inkOf(el));
    ctx.globalAlpha = 1;
  }
  for (const el of els) {
    if (isHatch(el)) continue;
    const pw = PEN_WEIGHTS[el.w] || PEN_WEIGHTS[1];
    const hi = el === opts.highlight;
    const color = hi ? RED : inkOf(el);
    // In plan, anything drawn above the ground plane is shown lighter.
    const fade = (proj.flat && elevated(el) ? 0.35 : 1) * (pw.alpha || 1);
    if (isFree(el)) {
      ctx.globalAlpha = (hi ? 0.6 : 0.92) * fade;
      drawFree(ctx, el.pts.map(S), pw.free * ws, color);
    } else {
      ctx.globalAlpha = (hi ? 0.6 : 1) * fade;
      const a = S(el.a), b = S(el.b);
      const dash = LINE_TYPES[typeOf(el)].dash;
      drawTaper(ctx, a.x, a.y, b.x, b.y, pw.end * ws, pw.mid * ws, color, lineSeed(el.a, el.b), dash && dash.map(v => v * ws));
    }
    ctx.globalAlpha = 1;
  }
  if (opts.dims && opts.gridFt) {
    for (const el of els) {
      if (!isLine(el)) continue;
      const a = S(el.a), b = S(el.b);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 28) continue;
      drawDim(ctx, a.x, a.y, b.x, b.y, fmtLen(len3(el.a, el.b) * opts.gridFt), MUTED);
    }
  }
}

// Hatches drawn in axo live in that view's page space, so they don't count toward plan/3D bounds.
function elPoints(el) { return isHatch(el) ? (el.view ? [] : el.pts) : isFree(el) ? el.pts : [el.a, el.b]; }
/** Bounds of the drawing on the page under a projection. */
function bounds(els, proj = PLAN) {
  if (!els.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of els) for (const p of elPoints(el)) {
    const q = proj.P(p);
    x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
  }
  return { x0, y0, x1, y1 };
}
/** Fit the drawing in a W×H area. `chrome` = px reserved for toolbars (editor only). */
function fitView(els, W, H, pad = 2, maxZ = 60, proj = PLAN, chrome = 0) {
  const b = bounds(els, proj);
  if (!b) return proj.flat ? { ox: (W % BASE_Z) / 2, oy: (H % BASE_Z) / 2, z: BASE_Z } : { ox: W / 2, oy: H / 3, z: BASE_Z };
  const bw = Math.max(b.x1 - b.x0, 1) + pad * 2, bh = Math.max(b.y1 - b.y0, 1) + pad * 2;
  const usableH = Math.max(H - chrome, H * 0.5, 1);
  let z = Math.min(Math.max(W, 1) / bw, usableH / bh, maxZ);
  if (!(z > 0.05) || !isFinite(z)) z = 0.05;
  const shift = chrome ? -20 : 0;
  return { z, ox: W / 2 - ((b.x0 + b.x1) / 2) * z, oy: H / 2 + shift - ((b.y0 + b.y1) / 2) * z };
}

/* ================================================================ editor */
const AXES = [
  { d: [1, 0, 0], name: 'x' }, { d: [0, 1, 0], name: 'y' }, { d: [0, 0, 1], name: 'height' },
  { d: [1, 1, 0], name: '45°' }, { d: [1, -1, 0], name: '45°' },
];
const Editor = {
  canvas: $('#canvas'),
  ctx: null,
  W: 0, H: 0, dpr: 1,
  project: null, sketch: null,
  view: { ox: 0, oy: 0, z: BASE_Z },
  mode: 'plan',                 // 'plan' | 'axo'
  proj: PLAN,
  anim: null,
  pointers: new Map(),
  drawing: null,                // straight line in progress
  stroke: null,                 // freehand stroke in progress
  erasing: null,
  gesture: null,
  panning: null,
  lockUntilAllUp: false,
  sawPen: false,
  undoStack: [], redoStack: [],
  needsRender: false,
  hover: null,
  spaceDown: false,

  get tool() { return Store.settings.tool; },
  get isAxo() { return this.mode === 'axo'; },

  init() {
    this.ctx = this.canvas.getContext('2d');
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this.onDown(e));
    c.addEventListener('pointermove', e => this.onMove(e));
    c.addEventListener('pointerup', e => this.onUp(e));
    c.addEventListener('pointercancel', e => this.onUp(e, true));
    c.addEventListener('lostpointercapture', e => { if (this.pointers.has(e.pointerId)) this.onUp(e, true); });
    c.addEventListener('pointerleave', () => { if (this.hover) { this.hover = null; this.render(); } });
    c.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('gesturestart', e => e.preventDefault());
    const v = $('#view-sketch');
    v.addEventListener('click', e => {
      const m = e.target.closest('[data-mode]');
      if (m) return m.dataset.mode === 'axo' && this.isAxo ? this.axoMenu() : this.setMode(m.dataset.mode);
      const t = e.target.closest('[data-tool]');
      if (t) return this.setTool(t.dataset.tool);
      const a = e.target.closest('[data-act]');
      if (a) this.action(a.dataset.act);
    });
    $('#sk-back').onclick = () => { this.flush(); go(`#/p/${this.project.id}`); };
    $('#sk-share').onclick = () => this.share();
    $('#sk-menu').onclick = () => this.menu();
    document.addEventListener('keydown', e => this.onKey(e));
    document.addEventListener('keyup', e => { if (e.code === 'Space') this.spaceDown = false; });
    const fsOk = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    $('#fs-btn').hidden = !fsOk;
  },

  open(project, sketch) {
    this.flush();
    if (this.anim) { cancelAnimationFrame(this.anim); this.anim = null; }
    this.project = project; this.sketch = sketch;
    sketch.axo = sketch.axo || { type: '45', q: 0 };
    this.mode = sketch.mode === 'axo' ? 'axo' : 'plan';
    this.proj = this.isAxo ? makeProj(axoParams(sketch)) : PLAN;
    this.undoStack = []; this.redoStack = [];
    this.drawing = this.stroke = this.lasso = this.erasing = this.gesture = this.panning = null;
    this.pointers.clear();
    this.resize(true);
    const saved = this.isAxo ? sketch.axoView : sketch.view;
    this.view = saved && saved.z > 0 && isFinite(saved.ox) && isFinite(saved.oy) ? { ...saved } : fitView(sketch.lines, this.W, this.H, 2, 60, this.proj, 150);
    this.setStatus('saved');
    this.syncUI();
    this.render();
  },

  resize(force) {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (!force && r.width === this.W && r.height === this.H && dpr === this.dpr) return;
    if (r.width === 0) return;
    this.W = r.width; this.H = r.height; this.dpr = dpr;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.render();
  },

  /* ---------- plan / axo ---------- */
  setMode(mode) {
    if (mode === this.mode || this.anim) return;
    const s = Store.settings;
    if (mode === 'axo') {
      if (!s.ortho) s.ortho = true;
      toast('Axo view: lines follow the x, y and height axes');
    }
    this.transition(mode, mode === 'axo' ? axoParams(this.sketch) : PLAN_PROJ, true);
  },
  rotateAxo() {
    if (!this.isAxo || this.anim) return;
    this.sketch.axo.q = ((this.sketch.axo.q || 0) + 1) % 4;
    this.transition('axo', axoParams(this.sketch), true);
  },
  setAxoType(type) {
    if (!AXO_TYPES[type]) return;
    this.sketch.axo.type = type;
    if (this.isAxo) this.transition('axo', axoParams(this.sketch), true);
    else { this.setMode('axo'); }
  },
  /** Animate the drawing from the current projection into the target one. */
  transition(mode, target, refit) {
    this.saveView();
    this.drawing = this.stroke = null;
    const from = { r: this.proj.r, k: this.proj.k, h: this.proj.h };
    let tr = target.r;
    while (tr - from.r > 180) tr -= 360;
    while (from.r - tr > 180) tr += 360;
    const to = { r: tr, k: target.k, h: target.h };
    this.mode = mode; this.sketch.mode = mode;
    const toProj = makeProj(to);
    const saved = mode === 'axo' ? null : this.sketch.view;
    const toView = !refit || (saved && saved.z) ? (saved && saved.z ? { ...saved } : { ...this.view })
      : this.axoFit(toProj);
    const v0 = { ...this.view }, t0 = performance.now(), dur = 750;
    const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const L = (a, b, e) => a + (b - a) * e;
    this.syncUI();
    const step = t => {
      const e = ease(clamp((t - t0) / dur, 0, 1));
      this.proj = makeProj({ r: L(from.r, to.r, e), k: L(from.k, to.k, e), h: L(from.h, to.h, e) });
      this.view = { ox: L(v0.ox, toView.ox, e), oy: L(v0.oy, toView.oy, e), z: L(v0.z, toView.z, e) };
      this.paint();
      if (e < 1) { this.anim = requestAnimationFrame(step); return; }
      this.anim = null;
      this.proj = makeProj({ ...to, r: ((to.r % 360) + 360) % 360 });
      this.view = toView;
      this.saveView(); this.syncUI(); this.render();
      Store.save();
    };
    this.anim = requestAnimationFrame(step);
  },
  /** Fit for axo: modest zoom, drawing set low so there is headroom to raise walls. */
  axoFit(proj) {
    const has3d = this.sketch.lines.some(elevated);
    const v = fitView(this.sketch.lines, this.W, this.H, 3, has3d ? 48 : BASE_Z * 1.25, proj, has3d ? 150 : 260);
    if (!has3d) v.oy += Math.min(this.H * 0.14, 90);
    return v;
  },
  async hatchMenu() {
    const s = Store.settings;
    const pv = (angles, sp) => `<svg class="hp" viewBox="0 0 40 28">${angles.map(ang => {
      const out = [];
      for (let d = -40; d <= 40; d += sp) {
        const r = ang * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
        out.push(`<line x1="${20 + d * -sn - 30 * c}" y1="${14 + d * c - 30 * sn}" x2="${20 + d * -sn + 30 * c}" y2="${14 + d * c + 30 * sn}"/>`);
      }
      return out.join('');
    }).join('')}</svg>`;
    await Modal.open(`<h2>Hatching</h2>
      <p>Draw a loop around an area and it fills with hatching. Spacing sets the value.</p>
      <div class="label">Pattern</div>
      <div class="sheet-list pick">${Object.entries(HATCH_PATTERNS).map(([k, h]) => `<button type="button" data-hp="${k}" class="${k === s.hatch ? 'on' : ''}"><span>${h.name}<small>${h.hint}</small></span>${pv(h.angles, 5)}</button>`).join('')}</div>
      <div class="label">Value</div>
      <div class="opts">${HATCH_VALUES.map((v, i) => `<button type="button" data-hv="${i}" class="${i === s.hval ? 'on' : ''}">${v.name}</button>`).join('')}</div>
      <div class="btns" style="margin-top:20px"><button type="button" class="btn primary" data-x>Done</button></div>`,
      (c, done) => {
        $('[data-x]', c).onclick = () => done(true);
        $$('[data-hp]', c).forEach(b => b.onclick = () => { s.hatch = b.dataset.hp; $$('[data-hp]', c).forEach(x => x.classList.toggle('on', x === b)); });
        $$('[data-hv]', c).forEach(b => b.onclick = () => { s.hval = +b.dataset.hv; $$('[data-hv]', c).forEach(x => x.classList.toggle('on', x === b)); });
      });
    Store.save();
  },
  async axoMenu() {
    const cur = this.sketch.axo.type;
    const v = await actionSheet('Axonometric', [
      { label: 'Rotate view 90°', value: 'rot', hint: 'See it from the next corner (R)' },
      ...Object.entries(AXO_TYPES).map(([k, t]) => ({ label: t.name, value: 't:' + k, hint: t.hint, sel: k === cur })),
      { label: 'Back to plan', value: 'plan' },
    ]);
    if (v === 'rot') this.rotateAxo();
    else if (v === 'plan') this.setMode('plan');
    else if (v && v.startsWith('t:')) this.setAxoType(v.slice(2));
  },

  /* ---------- coordinates + snapping ---------- */
  toScreen(p) { const q = this.proj.P(p); return { x: this.view.ox + q.x * this.view.z, y: this.view.oy + q.y * this.view.z }; },
  /** Screen position to a point on the horizontal plane at height z0. */
  toPlane(sx, sy, z0 = 0) { return this.proj.inv((sx - this.view.ox) / this.view.z, (sy - this.view.oy) / this.view.z, z0); },
  local(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },

  /** Hatch space: plan coordinates in plan view, page coordinates in axo. */
  toHatch(sx, sy) {
    if (this.isAxo) return { x: (sx - this.view.ox) / this.view.z, y: (sy - this.view.oy) / this.view.z };
    const w = this.toPlane(sx, sy, 0); return { x: w.x, y: w.y };
  },
  hatchToScreen(el) {
    if (el.view) return p => ({ x: this.view.ox + p.x * this.view.z, y: this.view.oy + p.y * this.view.z });
    return p => this.toScreen(p);
  },
  /** Lasso point, snapped to a nearby corner so hatching fills right up to the lines. */
  lassoPoint(pos) {
    const ep = this.nearestEndpoint(pos);
    const s = ep ? this.toScreen(this.isAxo ? ep : { x: ep.x, y: ep.y }) : pos;
    return this.toHatch(s.x, s.y);
  },
  /** Snap one screen point for a hatch corner: existing corner first, then the (half-)grid on the plan. */
  hatchCorner(pos) {
    const ep = this.nearestEndpoint(pos);
    if (ep) { const s = this.toScreen(this.isAxo ? ep : { x: ep.x, y: ep.y }); return this.toHatch(s.x, s.y); }
    // In axo the dot grid lies on the ground, which says nothing about walls: only corners snap there.
    if (this.isAxo) return this.toHatch(pos.x, pos.y);
    const st = this.snapStep(), w = this.toPlane(pos.x, pos.y, 0);
    return { x: roundTo(w.x, st), y: roundTo(w.y, st) };
  },
  /** The hatch outline from a freehand loop. With Snap on, the loop is straightened between
   *  corners and the corners land on grid dots or existing line ends. */
  lassoPolygon(raw) {
    const toS = this.hatchToScreen({ view: this.isAxo });
    if (!Store.settings.snap) return raw.map(p => { const s = toS(p); return this.lassoPoint(s); });
    const scr = raw.map(toS);
    const eps = Math.max(7, 0.45 * gridUnitPx(this.view.z, this.proj) * this.snapStep());
    let poly = simplifyPath(scr, eps).map(s => this.hatchCorner(s));
    const same = (p, q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
    poly = poly.filter((p, i) => i === 0 || !same(p, poly[i - 1]));
    while (poly.length > 1 && same(poly[0], poly[poly.length - 1])) poly.pop();
    // Drop corners that sit on a straight run.
    let changed = true;
    while (changed && poly.length > 3) {
      changed = false;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[(i + poly.length - 1) % poly.length], q = poly[i], r = poly[(i + 1) % poly.length];
        const len = Math.hypot(r.x - p.x, r.y - p.y) || 1e-9;
        const off = Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / len;   // distance of q from line p–r
        if (off < 2 / this.view.z) { poly.splice(i, 1); changed = true; break; }
      }
    }
    return poly;
  },
  endpoints() {
    const out = [];
    for (const el of this.sketch.lines) if (isLine(el)) out.push(el.a, el.b);
    return out;
  },
  /** Nearest existing line end to a screen position (within the snap radius). */
  nearestEndpoint(pos) {
    let best = null, bd = SNAP_PX;
    for (const q of this.endpoints()) {
      const s = this.toScreen(q), d = Math.hypot(s.x - pos.x, s.y - pos.y);
      // in plan, prefer points on the ground when stacked
      if (d < bd - (this.isAxo || !q.z ? 0 : 0.01)) { bd = d; best = q; }
    }
    return best;
  },
  snapStep() { return snapStepFor(this.view.z, this.proj); },
  gridRound(p) { if (!Store.settings.snap) return p; const st = this.snapStep(); return { x: roundTo(p.x, st), y: roundTo(p.y, st), z: p.z }; },
  /** Where a line starts. In plan everything sits on the ground; in axo it can start on any corner. */
  snapStart(pos) {
    const ep = this.nearestEndpoint(pos);
    if (ep) return { p: { x: ep.x, y: ep.y, z: this.isAxo ? (ep.z || 0) : 0 }, snapped: true };
    return { p: this.gridRound(this.toPlane(pos.x, pos.y, 0)), snapped: false };
  },
  /** End point for a line starting at a, given the pointer's screen position. */
  constrain(a, pos) {
    if (this.isAxo) return this.constrainAxo(a, pos);
    if (!Store.settings.ortho) {
      const s = this.snapStart(pos);
      return s;
    }
    const p = this.toPlane(pos.x, pos.y, 0);
    const dx = p.x - a.x, dy = p.y - a.y;
    const th = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const ux = Math.round(Math.cos(th)), uy = Math.round(Math.sin(th));   // -1, 0 or 1
    const uu = ux * ux + uy * uy, ulen = Math.sqrt(uu), z = this.view.z;
    const raw = (dx * ux + dy * uy) / uu;    // end = a + s·u
    let s = raw, snapped = false, aligned = false, best = SNAP_PX;
    // Stop the line where it lines up with a nearby existing endpoint (extension tracking).
    for (const q of this.endpoints()) {
      const sq = ((q.x - a.x) * ux + (q.y - a.y) * uy) / uu;
      if (Math.abs(sq) < 1e-6) continue;
      const along = Math.abs(sq - raw) * ulen * z;
      const perp = Math.hypot(q.x - (a.x + sq * ux), q.y - (a.y + sq * uy)) * z;
      if (along < best && perp < 60) { best = along; s = sq; aligned = true; snapped = perp < 0.5; }
    }
    if (!aligned && Store.settings.snap) s = roundTo(raw, this.snapStep());
    return { p: { x: a.x + s * ux, y: a.y + s * uy, z: 0 }, snapped };
  },
  /** Axo drafting: lock to the nearest axo axis (x, y, height, or plan 45°) and measure along it. */
  constrainAxo(a, pos) {
    const s0 = Store.settings, az = a.z || 0;
    if (!s0.ortho) {
      const ep = this.nearestEndpoint(pos);
      if (ep) return { p: { x: ep.x, y: ep.y, z: ep.z || 0 }, snapped: true };
      return { p: this.gridRound(this.toPlane(pos.x, pos.y, az)), snapped: false };   // stays level with its start
    }
    const z = this.view.z, A = this.toScreen(a);
    const vx = pos.x - A.x, vy = pos.y - A.y, vl = Math.hypot(vx, vy) || 1;
    const O = this.proj.P({ x: 0, y: 0, z: 0 });
    let best = null;
    for (const ax of AXES) {
      const q = this.proj.P({ x: ax.d[0], y: ax.d[1], z: ax.d[2] });
      const dx = (q.x - O.x) * z, dy = (q.y - O.y) * z, dl = Math.hypot(dx, dy);
      if (dl < 1e-6) continue;
      const cos = Math.abs(vx * dx + vy * dy) / (dl * vl);
      if (!best || cos > best.cos + 1e-9) best = { ax, dx, dy, dl, cos };
    }
    const { ax, dx, dy, dl } = best, d = ax.d;
    const raw = (vx * dx + vy * dy) / (dl * dl);          // steps along d
    const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    let s = raw, aligned = false, snapped = false, bestA = SNAP_PX;
    for (const q of this.endpoints()) {
      const qz = q.z || 0;
      const sq = ((q.x - a.x) * d[0] + (q.y - a.y) * d[1] + (qz - az) * d[2]) / dd;
      if (Math.abs(sq) < 1e-6) continue;
      const e = { x: a.x + sq * d[0], y: a.y + sq * d[1], z: az + sq * d[2] };
      const Es = this.toScreen(e), Qs = this.toScreen(q);
      const along = Math.abs(sq - raw) * dl, perp = Math.hypot(Es.x - Qs.x, Es.y - Qs.y);
      if (along < bestA && perp < 60) { bestA = along; s = sq; aligned = true; snapped = Math.hypot(q.x - e.x, q.y - e.y, qz - e.z) < 1e-6; }
    }
    if (!aligned && s0.snap) s = roundTo(raw, this.snapStep());
    return { p: { x: a.x + s * d[0], y: a.y + s * d[1], z: az + s * d[2] }, snapped, axis: ax.name };
  },

  /* ---------- pointer handling ---------- */
  startPan(id, pos) { this.panning = { id, x: pos.x, y: pos.y, ox: this.view.ox, oy: this.view.oy }; },

  onDown(e) {
    e.preventDefault();
    if (this.anim) return;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { }
    if (e.pointerType === 'pen') this.sawPen = true;
    const pos = this.local(e);
    this.pointers.set(e.pointerId, { ...pos, type: e.pointerType });

    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || this.spaceDown)) return this.startPan(e.pointerId, pos);
    // Two fingers: pinch-zoom / pan. Cancels anything in progress.
    if (this.pointers.size >= 2) {
      this.drawing = null; this.stroke = null; this.lasso = null; this.panning = null;
      if (this.erasing) this.cancelErase();
      this.startGesture();
      this.render();
      return;
    }
    if (this.lockUntilAllUp) return;
    if (this.tool === 'hand' || (e.pointerType === 'touch' && this.sawPen)) return this.startPan(e.pointerId, pos);

    const s = Store.settings;
    if (this.tool === 'erase') {
      this.erasing = { id: e.pointerId, removed: [], before: this.snapshot() };
      this.eraseAt(pos);
    } else if (this.tool === 'hatch') {
      this.lasso = { id: e.pointerId, pts: [this.toHatch(pos.x, pos.y)] };
    } else if (this.tool === 'pencil') {
      // In axo, a pencil stroke started on a corner is drawn on the level of that corner.
      const ep = this.isAxo ? this.nearestEndpoint(pos) : null;
      const z0 = ep ? (ep.z || 0) : 0;
      this.stroke = { id: e.pointerId, z0, el: { t: 'f', pts: [this.toPlane(pos.x, pos.y, z0)], w: s.pen, c: s.color } };
    } else {
      const sp = this.snapStart(pos);
      this.drawing = { id: e.pointerId, a: sp.p, b: sp.p, snapA: sp.snapped, snapB: false, axis: null };
    }
    this.render();
  },

  onMove(e) {
    const pos = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { ...this.pointers.get(e.pointerId), ...pos });
    if (this.gesture) return this.updateGesture();
    if (this.panning && this.panning.id === e.pointerId) {
      this.view.ox = this.panning.ox + pos.x - this.panning.x;
      this.view.oy = this.panning.oy + pos.y - this.panning.y;
      return this.render();
    }
    if (this.erasing && this.erasing.id === e.pointerId) return this.eraseAt(pos);
    const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    if (this.lasso && this.lasso.id === e.pointerId) {
      const pts = this.lasso.pts, minD = 4 / this.view.z;
      for (const ce of (coalesced.length ? coalesced : [e])) {
        const lp = this.local(ce), w = this.toHatch(lp.x, lp.y), last = pts[pts.length - 1];
        if (Math.hypot(w.x - last.x, w.y - last.y) > minD) pts.push(w);
      }
      return this.render();
    }
    if (this.stroke && this.stroke.id === e.pointerId) {
      const pts = this.stroke.el.pts, minD = 1.5 / this.view.z;
      for (const ce of (coalesced.length ? coalesced : [e])) {
        const lp = this.local(ce), w = this.toPlane(lp.x, lp.y, this.stroke.z0), last = pts[pts.length - 1];
        if (Math.hypot(w.x - last.x, w.y - last.y) > minD) pts.push(w);
      }
      return this.render();
    }
    if (this.drawing && this.drawing.id === e.pointerId) {
      const last = coalesced.length ? this.local(coalesced[coalesced.length - 1]) : pos;
      const c = this.constrain(this.drawing.a, last);
      this.drawing.b = c.p; this.drawing.snapB = c.snapped; this.drawing.axis = c.axis || null;
      return this.render();
    }
    if (e.pointerType === 'mouse' && this.tool === 'erase') {
      const h = this.hitTest(pos);
      if (h !== this.hover) { this.hover = h; this.render(); }
    }
  },

  onUp(e, cancelled) {
    this.pointers.delete(e.pointerId);
    if (this.gesture) {
      if (this.pointers.size < 2) { this.gesture = null; this.lockUntilAllUp = this.pointers.size > 0; this.saveView(); }
      else this.startGesture();
      return;
    }
    if (this.pointers.size === 0) this.lockUntilAllUp = false;
    if (this.panning && this.panning.id === e.pointerId) { this.panning = null; this.saveView(); return; }
    if (this.erasing && this.erasing.id === e.pointerId) {
      if (this.erasing.removed.length) this.commit(this.erasing.before);
      this.erasing = null; this.render(); return;
    }
    if (this.lasso && this.lasso.id === e.pointerId) {
      const ls = this.lasso; this.lasso = null;
      const poly = ls.pts.length >= 3 ? this.lassoPolygon(ls.pts) : [];
      if (!cancelled && poly.length >= 3) {
        const sc = this.hatchToScreen({ view: this.isAxo })
        const scr = poly.map(sc);
        let area = 0;
        for (let i = 0; i < scr.length; i++) { const p = scr[i], q = scr[(i + 1) % scr.length]; area += p.x * q.y - q.x * p.y; }
        if (Math.abs(area) / 2 > 150) {
          const s = Store.settings, before = this.snapshot();
          const el = { t: 'h', pts: poly.map(p => ({ x: r3(p.x), y: r3(p.y) })), pat: s.hatch, v: s.hval, c: s.color, seed: Math.floor(Math.random() * 1e9) };
          if (this.isAxo) el.view = axoKey(this.sketch);
          this.sketch.lines.push(el);
          this.commit(before);
        } else toast('Draw a loop around the area to hatch');
      }
      this.render(); return;
    }
    if (this.stroke && this.stroke.id === e.pointerId) {
      const st = this.stroke; this.stroke = null;
      if (!cancelled) {
        const before = this.snapshot();
        st.el.pts = st.el.pts.map(pt);
        this.sketch.lines.push(st.el);
        this.commit(before);
      }
      this.render(); return;
    }
    if (this.drawing && this.drawing.id === e.pointerId) {
      const d = this.drawing; this.drawing = null;
      const A = this.toScreen(d.a), B = this.toScreen(d.b);
      if (!cancelled && Math.hypot(B.x - A.x, B.y - A.y) > 4 && len3(d.a, d.b) > 1e-6) {
        const before = this.snapshot();
        const ln = { a: pt(d.a), b: pt(d.b), w: Store.settings.pen, c: Store.settings.color };
        if (Store.settings.ltype && Store.settings.ltype !== 'solid') ln.k = Store.settings.ltype;
        this.sketch.lines.push(ln);
        this.commit(before);
      }
      this.render();
    }
  },

  startGesture() {
    const [p1, p2] = [...this.pointers.values()];
    this.gesture = { d0: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1, m0: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, v0: { ...this.view } };
  },
  updateGesture() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [p1, p2] = pts, g = this.gesture;
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const m = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const z = clamp(g.v0.z * d / g.d0, 4, 160);
    const wx = (g.m0.x - g.v0.ox) / g.v0.z, wy = (g.m0.y - g.v0.oy) / g.v0.z;
    this.view = { z, ox: m.x - wx * z, oy: m.y - wy * z };
    this.render();
  },
  zoomAt(z, sx, sy) {
    z = clamp(z, 4, 160);
    const X = (sx - this.view.ox) / this.view.z, Y = (sy - this.view.oy) / this.view.z;
    this.view = { z, ox: sx - X * z, oy: sy - Y * z };
    this.render();
  },
  onWheel(e) {
    e.preventDefault();
    if (this.anim) return;
    const pos = this.local(e);
    if (e.ctrlKey || e.metaKey || e.deltaMode !== 0 || (Math.abs(e.deltaY) > 40 && e.deltaX === 0)) {
      this.zoomAt(this.view.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), pos.x, pos.y);
    } else {
      this.view.ox -= e.deltaX; this.view.oy -= e.deltaY; this.render();
    }
    clearTimeout(this._wheelT); this._wheelT = setTimeout(() => this.saveView(), 300);
  },

  /* ---------- erase ---------- */
  hitTest(pos) {
    let best = null, bd = 12;
    const segDist = (a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 ? clamp(((pos.x - a.x) * dx + (pos.y - a.y) * dy) / L2, 0, 1) : 0;
      return Math.hypot(pos.x - (a.x + dx * t), pos.y - (a.y + dy * t));
    };
    for (const el of this.sketch.lines) {
      if (isHatch(el)) continue;
      const pts = elPoints(el).map(p => this.toScreen(p));
      for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
        const d = segDist(pts[i], pts[i + 1] || pts[i]);
        if (d < bd) { bd = d; best = el; }
      }
    }
    if (best) return best;
    // No line under the finger: a tap inside a hatched area erases that hatch (topmost first).
    const key = this.isAxo ? axoKey(this.sketch) : null;
    for (let i = this.sketch.lines.length - 1; i >= 0; i--) {
      const el = this.sketch.lines[i];
      if (!isHatch(el) || (el.view || null) !== key) continue;
      if (pointInPoly(pos, el.pts.map(this.hatchToScreen(el)))) return el;
    }
    return null;
  },
  eraseAt(pos) {
    const el = this.hitTest(pos);
    if (!el) return;
    this.sketch.lines.splice(this.sketch.lines.indexOf(el), 1);
    this.erasing.removed.push(el);
    this.render();
  },
  cancelErase() {
    this.sketch.lines = JSON.parse(this.erasing.before);
    this.erasing = null;
  },

  /* ---------- history + persistence ---------- */
  snapshot() { return JSON.stringify(this.sketch.lines); },
  commit(before) {
    this.undoStack.push(before);
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
    this.touch();
  },
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.sketch.lines = JSON.parse(this.undoStack.pop());
    this.touch(); this.render();
  },
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.sketch.lines = JSON.parse(this.redoStack.pop());
    this.touch(); this.render();
  },
  setStatus(st) { $('#save-status').textContent = st === 'saving' ? 'Saving…' : st === 'error' ? 'Not saved' : 'Saved to notebook'; },
  touch() {
    this.sketch.updated = this.project.updated = now();
    this.syncUI();
    this.setStatus('saving');
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.setStatus(Store.save() ? 'saved' : 'error'), 300);
  },
  storeView() {
    if (!this.sketch || this.anim) return;
    if (this.isAxo) this.sketch.axoView = { ...this.view }; else this.sketch.view = { ...this.view };
  },
  saveView() {
    if (!this.sketch) return;
    this.storeView();
    this.syncZoom();
    clearTimeout(this._viewT);
    this._viewT = setTimeout(() => Store.save(), 500);
  },
  flush() {
    if (!this.sketch) return;
    clearTimeout(this._saveT); clearTimeout(this._viewT);
    this.storeView();
    this.setStatus(Store.save() ? 'saved' : 'error');
  },

  /* ---------- toolbar ---------- */
  setTool(t) {
    if (t === 'hatch' && Store.settings.tool === 'hatch') return this.hatchMenu();
    if (t === 'hatch') toast('Draw a loop around an area to hatch it. Tap Hatch again for pattern and value.');
    Store.settings.tool = t; this.hover = null;
    Store.save(); this.syncUI(); this.render();
  },
  async action(act) {
    const s = Store.settings, cx = this.W / 2, cy = this.H / 2;
    switch (act) {
      case 'ortho':
        s.ortho = !s.ortho;
        toast(s.ortho ? (this.isAxo ? 'Lines follow the x, y and height axes' : 'Ortho on: horizontal, vertical and 45° only')
          : (this.isAxo ? 'Free lines stay level with their start point' : 'Ortho off'));
        break;
      case 'snap': s.snap = !s.snap; break;
      case 'dims': s.dims = !s.dims; break;
      case 'pen': await penPicker(); if (this.tool === 'erase' || this.tool === 'hand') s.tool = 'line'; break;
      case 'grid': return this.pickGrid();
      case 'undo': return this.undo();
      case 'redo': return this.redo();
      case 'clear': return this.clear();
      case 'axo-rotate': return this.rotateAxo();
      case 'axo-menu': return this.axoMenu();
      case 'zoom-in': this.zoomAt(this.view.z * 1.25, cx, cy); return this.saveView();
      case 'zoom-out': this.zoomAt(this.view.z / 1.25, cx, cy); return this.saveView();
      case 'fit': return this.fit();
      case 'fullscreen': return toggleFullscreen();
    }
    Store.save(); this.syncUI(); this.render();
  },
  async pickGrid() {
    const v = await gridPicker(this.sketch.gridFt);
    if (v == null) return;
    this.sketch.gridFt = v;
    this.touch(); this.render();
    toast(`Grid set to ${fmtLen(v)} per dot`);
  },
  async clear() {
    if (!this.sketch.lines.length) return;
    if (await confirmBox('Clear this sketch?', 'Everything on this page will be removed. You can undo this.', 'Clear')) {
      const before = this.snapshot(); this.sketch.lines = []; this.commit(before); this.render();
    }
  },
  syncZoom() { $('#zoom-val').textContent = Math.round(this.view.z / BASE_Z * 100) + '%'; },
  syncUI() {
    const s = Store.settings;
    $$('#toolbar [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === s.tool));
    $('#toolbar [data-act="ortho"]').classList.toggle('on', s.ortho);
    $('#view-sketch [data-act="undo"]').disabled = !this.undoStack.length;
    $('#view-sketch [data-act="redo"]').disabled = !this.redoStack.length;
    $$('#mode-seg [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === this.mode));
    $('#view-sketch').classList.toggle('axo', this.isAxo);
    $('#pen-swatch').style.background = INKS[s.color].hex;
    if (this.sketch) $('#grid-label').textContent = `Grid ${fmtGrid(this.sketch.gridFt)}`;
    this.syncZoom();
  },

  onKey(e) {
    if (currentView !== 'sketch' || !Modal.el.hidden) return;
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); return e.shiftKey ? this.redo() : this.undo(); }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); return this.redo(); }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { this.spaceDown = true; e.preventDefault(); return; }
    const tools = { l: 'line', p: 'pencil', t: 'hatch', e: 'erase', h: 'hand' };
    const acts = { o: 'ortho', g: 'snap', d: 'dims', f: 'fit', r: 'axo-rotate', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out' };
    if (tools[k]) { e.preventDefault(); this.setTool(tools[k]); }
    else if (k === 'a') { e.preventDefault(); this.setMode(this.isAxo ? 'plan' : 'axo'); }
    else if (acts[k]) { e.preventDefault(); this.action(acts[k]); }
    else if (k === 'escape') { if (this.drawing || this.stroke) { this.drawing = this.stroke = null; this.render(); } else $('#sk-back').click(); }
  },

  fit() {
    this.view = fitView(this.sketch.lines, this.W, this.H, 3, 48, this.proj, 150);
    this.saveView(); this.render();
  },

  async menu() {
    const s = Store.settings;
    const items = [
      { label: 'Snap to grid', value: 'snap', check: s.snap, hint: 'Line ends land on grid dots (G)' },
      { label: 'Show dimensions', value: 'dims', check: s.dims, hint: 'True length of every line, in grid units (D)' },
      { label: this.isAxo ? 'Axonometric options' : 'Axonometric view', value: 'axo', hint: this.isAxo ? 'Angle and rotation' : 'Rotate the drawing into axo (A)' },
      { label: 'Fit drawing to screen', value: 'fit' },
      { label: 'Copy sketch as text for ChatGPT', value: 'copy', hint: 'Line coordinates and lengths' },
      { label: 'Export for Rhino (DXF)', value: 'dxf', hint: 'Curves, hatches, layers; choose units' },
      { label: 'Download PNG', value: 'png', hint: this.isAxo ? 'Saves the axo view' : 'Saves the plan view' },
      { label: 'Rename sketch', value: 'rename' },
    ];
    const v = await actionSheet(this.sketch.name, items);
    if (v === 'snap' || v === 'dims' || v === 'fit') this.action(v);
    else if (v === 'axo') this.isAxo ? this.axoMenu() : this.setMode('axo');
    else if (v === 'copy') this.copyText();
    else if (v === 'dxf') { this.flush(); exportForRhino(this.project, this.sketch); }
    else if (v === 'png') this.downloadPng();
    else if (v === 'rename') {
      const n = await promptText('Rename sketch', this.sketch.name);
      if (n) { this.sketch.name = n; this.touch(); }
    }
  },

  /* ---------- export / share ---------- */
  async renderPng() {
    try { await document.fonts.ready; } catch (_) { }
    return exportPng(this.project, this.sketch, this.isAxo ? makeProj(axoParams(this.sketch)) : PLAN);
  },
  async downloadPng() {
    let blob; try { blob = await this.renderPng(); } catch (_) { return toast('Could not create the image. Try zooming the drawing smaller.'); }
    downloadBlob(blob, `${fileSafe(this.project.name)} - ${fileSafe(this.sketch.name)}${this.isAxo ? ' (axo)' : ''}.png`);
  },
  async copyText() { await copyOrShow(sketchText(this.project, this.sketch), 'Copied. Paste it into ChatGPT.'); },
  async share() {
    this.flush();
    let blob; try { blob = await this.renderPng(); } catch (_) { return toast('Could not create the image. Try Copy as text instead.'); }
    const name = `${fileSafe(this.project.name)} - ${fileSafe(this.sketch.name)}${this.isAxo ? ' (axo)' : ''}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    const text = sketchText(this.project, this.sketch);
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `${this.project.name}: ${this.sketch.name}`, text }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    downloadBlob(blob, name);
    try { await navigator.clipboard.writeText(text); toast('PNG downloaded and sketch text copied.'); } catch (_) { toast('PNG downloaded'); }
  },

  /* ---------- render ---------- */
  render() {
    if (this.needsRender || this.anim) return;
    this.needsRender = true;
    requestAnimationFrame(() => { this.needsRender = false; this.paint(); });
  },
  paint() {
    if (!this.sketch || currentView !== 'sketch') return;
    const ctx = this.ctx, { W, H, dpr } = this, s = Store.settings;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, W, H, this.sketch.lines, this.view, { dims: s.dims, gridFt: this.sketch.gridFt, highlight: this.hover, proj: this.proj, axoKey: this.isAxo && !this.anim ? axoKey(this.sketch) : null });
    this.syncZoom();
    const pw = PEN_WEIGHTS[s.pen], ws = weightScale(this.view.z), ink = INKS[s.color].hex;
    if (this.lasso && this.lasso.pts.length > 1) {
      const sc = this.hatchToScreen({ view: this.isAxo });
      const snapped = Store.settings.snap && this.lasso.pts.length >= 3;
      const pts = (snapped ? this.lassoPolygon(this.lasso.pts) : this.lasso.pts).map(sc);
      ctx.save();
      if (snapped) {   // faint trace of the finger, then the snapped outline
        ctx.strokeStyle = 'rgba(175,49,41,.25)'; ctx.lineWidth = 1;
        ctx.beginPath(); this.lasso.pts.map(sc).forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
      }
      ctx.strokeStyle = RED; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]);
      ctx.fillStyle = 'rgba(175,49,41,.06)';
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (snapped) { ctx.setLineDash([]); ctx.fillStyle = RED; for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill(); } }
      ctx.restore();
    }
    if (this.stroke) {
      ctx.globalAlpha = 0.92 * (pw.alpha || 1);
      drawFree(ctx, this.stroke.el.pts.map(p => this.toScreen(p)), pw.free * ws, ink);
      ctx.globalAlpha = 1;
    }
    const d = this.drawing;
    if (d) {
      const a = this.toScreen(d.a), b = this.toScreen(d.b);
      ctx.globalAlpha = 0.85 * (pw.alpha || 1);
      const dash = LINE_TYPES[s.ltype] && LINE_TYPES[s.ltype].dash;
      drawTaper(ctx, a.x, a.y, b.x, b.y, pw.end * ws, pw.mid * ws, ink, lineSeed(d.a, d.b), dash && dash.map(v => v * ws));
      ctx.globalAlpha = 1;
      const ring = (p, on) => { if (!on) return; ctx.strokeStyle = RED; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.stroke(); };
      ring(a, d.snapA); ring(b, d.snapB);
      const len = len3(d.a, d.b);
      if (len > 0) {
        let tag;
        if (this.isAxo) tag = d.axis || ((d.b.z || 0) !== (d.a.z || 0) ? 'sloped' : 'level');
        else {
          let ang = Math.round(-Math.atan2(d.b.y - d.a.y, d.b.x - d.a.x) * 180 / Math.PI);
          if (ang < 0) ang += 360;
          tag = `${ang}°`;
        }
        drawDim(ctx, a.x, a.y, b.x, b.y, `${fmtLen(len * this.sketch.gridFt)}   ${tag}`, RED, 17);
      }
    }
  },
};

/* ================================================================ export helpers */
function exportPng(project, sketch, proj = PLAN) {
  const els = sketch.lines, z = 40, pad = 2.5;
  const b = bounds(els, proj) || { x0: 0, y0: 0, x1: 16, y1: 12 };
  const wU = b.x1 - b.x0 + pad * 2, hU = b.y1 - b.y0 + pad * 2 + 1.5;
  // Stay well inside iPhone Safari's canvas memory limit (~16.7M pixels).
  const zz = z * Math.min(1, 2800 / (wU * z), 2800 / (hU * z));
  const W = Math.max(480, Math.round(wU * zz)), H = Math.max(360, Math.round(hU * zz));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const view = { z: zz, ox: W / 2 - (b.x0 + b.x1) / 2 * zz, oy: (H - 1.5 * zz) / 2 - (b.y0 + b.y1) / 2 * zz };
  drawScene(ctx, W, H, els, view, { dims: Store.settings.dims, gridFt: sketch.gridFt, weightMul: 1.15, proj, axoKey: proj.flat ? null : axoKey(sketch) });
  ctx.fillStyle = RED; ctx.fillRect(16, H - 40, 26, 26);
  ctx.fillStyle = '#fef9ee'; ctx.font = `15px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Ta', 29, H - 26.5);
  ctx.textAlign = 'left'; ctx.fillStyle = MUTED; ctx.font = `14px ${SANS}`;
  const viewName = proj.flat ? 'plan' : `axo ${(AXO_TYPES[sketch.axo && sketch.axo.type] || AXO_TYPES['45']).name}`;
  ctx.fillText(`${project.name}  ·  ${sketch.name}  ·  ${viewName}  ·  grid ${fmtLen(sketch.gridFt)}`, 52, H - 26.5);
  return new Promise((res, rej) => c.toBlob(bl => bl ? res(bl) : rej(new Error('PNG export failed')), 'image/png'));
}

function sketchText(project, sketch) {
  const g = sketch.gridFt, n = v => +((v || 0) * g).toFixed(2);
  const lines = sketch.lines.filter(isLine), free = sketch.lines.filter(isFree), hatches = sketch.lines.filter(isHatch);
  const has3d = sketch.lines.some(elevated);
  const P = p => has3d ? `(${n(p.x)}, ${n(p.y)}, ${n(p.z)})` : `(${n(p.x)}, ${n(p.y)})`;
  const out = [
    'Talago Arch sketch',
    `Project: ${project.name}`,
    `Sketch: ${sketch.name}`,
    `Grid spacing: ${fmtLen(g)} between dots`,
    'Units are unspecified (the drafter decides whether they mean inches, feet, metres…).',
    has3d ? 'Coordinates (x, y, z): x to the right and y downward on the plan, z = height above the plan.'
      : 'Coordinates: origin top-left, x to the right, y downward.',
    'Line weights and types follow Ching: major/primary = cuts and profiles, secondary = elevations and corners, grid/layout = construction; dashed above cut = overhead, dashed below cut = hidden.',
    `Straight lines (${lines.length}):`,
  ];
  lines.forEach((l, i) => {
    const len = len3(l.a, l.b) * g, dz = (l.b.z || 0) - (l.a.z || 0);
    let desc;
    if (Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) < 1e-6) desc = 'vertical';
    else {
      let ang = Math.round(-Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) * 180 / Math.PI); if (ang < 0) ang += 360;
      desc = `plan angle ${ang}°${dz ? ', sloped' : ''}`;
    }
    const wt = (PEN_WEIGHTS[l.w] || PEN_WEIGHTS[1]).full.toLowerCase(), ty = LINE_TYPES[typeOf(l)].name.toLowerCase();
    out.push(`${i + 1}. ${P(l.a)} to ${P(l.b)}, length ${fmtLen(len)}, ${desc}, ${wt}, ${ty}${l.c ? `, ${INKS[l.c].name.toLowerCase()}` : ''}`);
  });
  if (hatches.length) {
    out.push(`Hatched areas (${hatches.length}):`);
    hatches.forEach((h, i) => {
      const pat = (HATCH_PATTERNS[h.pat] || HATCH_PATTERNS.d1).name.replace(/ [⟋⟍]/, '').toLowerCase();
      const val = (HATCH_VALUES[h.v] || HATCH_VALUES[1]).name.toLowerCase();
      if (h.view) out.push(`${i + 1}. ${pat}, ${val} value, drawn on the axo view`);
      else { const b = bounds([h]); out.push(`${i + 1}. ${pat}, ${val} value, within x ${n(b.x0)} to ${n(b.x1)}, y ${n(b.y0)} to ${n(b.y1)}`); }
    });
  }
  if (free.length) {
    out.push(`Freehand pencil strokes (${free.length}):`);
    free.forEach((f, i) => {
      const b = bounds([f]), zz = f.pts[0].z;
      out.push(`${i + 1}. within x ${n(b.x0)} to ${n(b.x1)}, y ${n(b.y0)} to ${n(b.y1)}${zz ? `, at height ${n(zz)}` : ''}`);
    });
  }
  return out.join('\n');
}

function notebookText() {
  const ps = Store.data.projects;
  const out = ['Talago Arch notebook', `${plural(ps.length, 'project', 'projects')}`, ''];
  ps.forEach((p, i) => {
    out.push(`${pad2(i + 1)}. ${p.name} (${plural(p.sketches.length, 'sketch', 'sketches')})`);
    p.sketches.forEach(s => out.push(`    - ${s.name}: ${plural(s.lines.length, 'element', 'elements')}, grid ${fmtLen(s.gridFt)}, updated ${fmtDate(s.updated)}`));
    p.schedules.forEach(g => out.push(`    - Schedule “${g.name}”: ${plural(g.tasks.length, 'task', 'tasks')}`));
  });
  return out.join('\n');
}

async function copyOrShow(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch (_) {
    await Modal.open(`<h2>Copy this text</h2><textarea style="width:100%;height:240px;font:13px ui-monospace,monospace;border:1px solid var(--rule-2);border-radius:6px;padding:8px">${esc(text)}</textarea>
      <div class="btns" style="margin-top:12px"><button type="button" class="btn primary" data-x>Done</button></div>`, (c, done) => { $('[data-x]', c).onclick = () => done(); });
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function renderThumb(canvas, sketch) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  const W = r.width || 160, H = r.height || 120;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const view = sketch.lines.length ? fitView(sketch.lines, W, H, 1.5, 22) : { ox: 6, oy: 6, z: 11 };
  drawScene(ctx, W, H, sketch.lines, view, { weightMul: 0.8 });
}

/* ================================================================ views + routing */
let currentView = null;
const views = { toc: $('#view-toc'), project: $('#view-project'), sketch: $('#view-sketch'), schedule: $('#view-schedule') };
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function show(name) {
  for (const k in views) views[k].hidden = k !== name;
  currentView = name;
  document.querySelector('meta[name=theme-color]').content = PAPER;
}

function route() {
  const m = location.hash.match(/^#\/p\/([^/]+)(?:\/s\/([^/]+))?(?:\/g\/([^/]+))?/);
  if (currentView === 'sketch') Editor.flush();
  if (m) {
    const p = Store.project(m[1]);
    if (!p) return go('#/');
    if (m[3]) {
      const sch = Store.schedule(p, m[3]);
      if (!sch) return go(`#/p/${p.id}`);
      Store.data.last = { p: p.id, g: sch.id }; projectTab(p, 'schedules');
      show('schedule');
      Schedule.open(p, sch);
      return;
    }
    if (m[2]) {
      const s = Store.sketch(p, m[2]);
      if (!s) return go(`#/p/${p.id}`);
      Store.data.last = { p: p.id, s: s.id }; projectTab(p, 'sketches');
      show('sketch');
      Editor.open(p, s);
      enterFullscreen();
      return;
    }
    Store.data.last = { p: p.id }; Store.save();
    show('project'); renderProject(p);
    return;
  }
  Store.data.last = null; Store.save();
  show('toc'); renderToc();
}
window.addEventListener('hashchange', route);

/* ---------- table of contents ---------- */
function countsText(p) {
  normProject(p);
  const n = p.sketches.length, g = p.schedules.length;
  return `${pad2(n)} ${n === 1 ? 'sketch' : 'sketches'}${g ? ` · ${g} ${g === 1 ? 'schedule' : 'schedules'}` : ''}`;
}
function renderToc() {
  const ps = Store.data.projects;
  $('#toc-count').textContent = plural(ps.length, 'project', 'projects');
  const entries = ps.map((p, i) => {
    const names = p.sketches.map(s => esc(s.name)).join('  ·  ');
    return `<li><div class="dots"></div>
      <button type="button" class="entry" data-open="${p.id}">
        <span class="e-num">${i + 1}</span>
        <span class="e-body">
          <span class="e-name">${esc(p.name)}</span>
          <span class="e-meta">${countsText(p)} · Updated ${fmtDate(p.updated)}</span>
          ${names ? `<span class="e-sketches">${names}</span>` : ''}
        </span>
      </button></li>`;
  }).join('');
  $('#project-list').innerHTML = entries +
    `<li><div class="dots"></div>
      <button type="button" class="e-add" id="add-project"><span class="e-num">+</span><span class="e-name">Add project</span></button>
      ${ps.length ? '' : '<div class="empty-note">Your projects will be listed here, like days in a diary.</div>'}</li>
    <li class="grow"></li><li><div class="dots"></div></li>`;
}
$('#project-list').addEventListener('click', e => {
  if (e.target.closest('#add-project')) return addProject();
  const o = e.target.closest('[data-open]');
  if (o) go(`#/p/${o.dataset.open}`);
});
// Long-press / right-click a project row for options.
(() => {
  let t = 0;
  const list = $('#project-list');
  list.addEventListener('contextmenu', e => {
    const o = e.target.closest('[data-open]'); if (!o) return;
    e.preventDefault(); projectMenu(Store.project(o.dataset.open));
  });
  list.addEventListener('pointerdown', e => {
    const o = e.target.closest('[data-open]'); if (!o || e.pointerType === 'mouse') return;
    t = setTimeout(() => { t = -1; projectMenu(Store.project(o.dataset.open)); }, 550);
  });
  const cancel = () => { if (t > 0) clearTimeout(t); };
  list.addEventListener('pointerup', cancel); list.addEventListener('pointercancel', cancel); list.addEventListener('pointermove', cancel);
  list.addEventListener('click', e => { if (t === -1) { e.stopImmediatePropagation(); t = 0; } }, true);
})();

async function addProject() {
  const name = await promptText('New project', '', 'Create');
  if (!name) return;
  const p = { id: uid(), name, created: now(), updated: now(), sketches: [], schedules: [] };
  Store.data.projects.push(p); Store.save();
  go(`#/p/${p.id}`);
}
$('#toc-close').onclick = () => showCover();
$('#toc-ai').onclick = async () => {
  const acts = [
    { label: 'Copy notebook summary for ChatGPT', value: 'copy', hint: 'Projects and sketches as text' },
    { label: 'Back up notebook', value: 'backup', hint: 'Save everything as a file' },
    { label: 'Restore from backup', value: 'restore' },
  ];
  if (deferredInstall) acts.push({ label: 'Install app', value: 'install' });
  else if (!isStandalone()) acts.push({ label: 'Install on your phone', value: 'howto', hint: 'Add Talago Arch to your home screen' });
  const v = await actionSheet('Notebook', acts);
  if (v === 'copy') copyOrShow(notebookText(), 'Copied. Paste it into ChatGPT.');
  else if (v === 'backup') backup();
  else if (v === 'restore') restore();
  else if (v === 'install') install();
  else if (v === 'howto') {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    Modal.open(`<h2>Install Talago Arch</h2><p>${ios ? 'In Safari, tap the Share button, then <b>Add to Home Screen</b>.' : 'In your browser menu, choose <b>Install app</b> or <b>Add to Home screen</b>.'} It then opens full screen, works offline and updates itself.</p>
      <div class="btns"><button type="button" class="btn primary" data-x>Got it</button></div>`, (c, done) => { $('[data-x]', c).onclick = () => done(); });
  }
};

async function projectMenu(p) {
  if (!p) return;
  const v = await actionSheet(p.name, [
    { label: 'Rename project', value: 'rename' },
    { label: 'Move up in contents', value: 'up' },
    { label: 'Delete project', value: 'delete', danger: true },
  ]);
  if (v === 'rename') {
    const n = await promptText('Rename project', p.name);
    if (n) { p.name = n; p.updated = now(); Store.save(); }
  } else if (v === 'up') {
    const ps = Store.data.projects, i = ps.indexOf(p);
    if (i > 0) { ps.splice(i, 1); ps.splice(i - 1, 0, p); Store.save(); }
  } else if (v === 'delete') {
    if (await confirmBox(`Delete “${p.name}”?`, `This removes the project, its ${plural(p.sketches.length, 'sketch', 'sketches')} and ${plural(p.schedules.length, 'schedule', 'schedules')} from this device. This can't be undone.`)) {
      Store.data.projects.splice(Store.data.projects.indexOf(p), 1); if (Store.data.tabs) delete Store.data.tabs[p.id]; Store.save();
      if (currentView !== 'toc') return go('#/');
    }
  }
  if (currentView === 'toc') renderToc(); else if (currentView === 'project') renderProject(p);
}

/* ---------- project ---------- */
let currentProject = null;
/** Which section (sketches / schedules) a project page shows; remembered per project. */
function projectTab(p, set) {
  const tabs = Store.data.tabs || (Store.data.tabs = {});
  if (set) { tabs[p.id] = set; Store.save(); }
  return tabs[p.id] || (p.sketches.length || !p.schedules.length ? 'sketches' : 'schedules');
}
function showTab(p) {
  const tab = projectTab(p);
  $$('#proj-tabs [data-tab]').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $('#tab-sketches').hidden = tab !== 'sketches';
  $('#tab-schedules').hidden = tab !== 'schedules';
  $('#ct-sketches').textContent = pad2(p.sketches.length);
  $('#ct-schedules').textContent = pad2(p.schedules.length);
}
$('#proj-tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b || !currentProject) return;
  projectTab(currentProject, b.dataset.tab); showTab(currentProject);
  if (b.dataset.tab === 'sketches') requestAnimationFrame(() => $$('#sketch-grid [data-thumb]').forEach(c => renderThumb(c, Store.sketch(currentProject, c.dataset.thumb))));
});
function renderProject(p) {
  normProject(p);
  currentProject = p;
  showTab(p);
  $('#proj-num').textContent = Store.data.projects.indexOf(p) + 1;
  $('#proj-title').textContent = p.name;
  $('#proj-lede').textContent = `${countsText(p)} · Updated ${fmtDate(p.updated)}`;
  $('#proj-count').textContent = `Project ${Store.data.projects.indexOf(p) + 1}`;
  const grid = $('#sketch-grid');
  grid.innerHTML = p.sketches.length ? p.sketches.map(s => `<div class="card">
      <button type="button" class="open" data-open="${s.id}"><canvas class="thumb" data-thumb="${s.id}"></canvas></button>
      <div class="meta"><span class="nm">${esc(s.name)}</span><span class="dt">Updated ${fmtDate(s.updated)} · Grid ${fmtGrid(s.gridFt)}</span></div>
      <button type="button" class="more" data-more="${s.id}" aria-label="Options for ${esc(s.name)}"><svg><use href="#i-more"/></svg></button>
    </div>`).join('') : `<div class="empty-note" style="padding-left:0">No sketches yet. Tap New sketch to open a fresh page.</div>`;
  requestAnimationFrame(() => $$('[data-thumb]', grid).forEach(c => renderThumb(c, Store.sketch(p, c.dataset.thumb))));
  const sg = $('#schedule-grid');
  sg.innerHTML = p.schedules.length ? p.schedules.map(g => {
    const cmp = schCompute(g), vals = [...cmp.values()];
    const span = vals.length ? `${schFmt(g, Math.min(...vals.map(r => r.s)), true)} → ${schFmt(g, Math.max(...vals.map(r => r.e)), true)}` : 'No tasks';
    return `<div class="card">
      <button type="button" class="open" data-open-g="${g.id}">${schThumb(g)}</button>
      <div class="meta"><span class="nm">${esc(g.name)}</span><span class="dt">${span} · ${g.tasks.length} tasks</span></div>
      <button type="button" class="more" data-more-g="${g.id}" aria-label="Options for ${esc(g.name)}"><svg><use href="#i-more"/></svg></button>
    </div>`;
  }).join('') : `<div class="empty-note" style="padding-left:0">No schedules yet. Tap New schedule for a design, permit and construction gantt.</div>`;
}
$('#schedule-grid').addEventListener('click', async e => {
  const p = currentProject; if (!p) return;
  const o = e.target.closest('[data-open-g]');
  if (o) return go(`#/p/${p.id}/g/${o.dataset.openG}`);
  const m = e.target.closest('[data-more-g]');
  if (!m) return;
  const g = Store.schedule(p, m.dataset.moreG); if (!g) return;
  const v = await actionSheet(g.name, [
    { label: 'Rename', value: 'rename' }, { label: 'Duplicate', value: 'dup' },
    { label: 'Copy as text for ChatGPT', value: 'copy' }, { label: 'Delete schedule', value: 'delete', danger: true },
  ]);
  if (v === 'rename') { const n = await promptText('Rename schedule', g.name); if (n) { g.name = n; g.updated = now(); } }
  else if (v === 'dup') { const c = JSON.parse(JSON.stringify(g)); c.id = uid(); c.name = g.name + ' copy'; c.created = c.updated = now(); p.schedules.splice(p.schedules.indexOf(g) + 1, 0, c); }
  else if (v === 'copy') copyOrShow(schText(p, g), 'Copied. Paste it into ChatGPT.');
  else if (v === 'delete') { if (await confirmBox(`Delete “${g.name}”?`, "This can't be undone.")) { p.schedules.splice(p.schedules.indexOf(g), 1); p.updated = now(); } }
  Store.save(); renderProject(p);
});
$('#add-schedule').onclick = async () => {
  const p = currentProject; if (!p) return;
  const name = await promptText('New schedule', p.schedules.length ? `Schedule ${p.schedules.length + 1}` : 'Project schedule', 'Create');
  if (!name) return;
  const g = schDefault(name);
  p.schedules.push(g); p.updated = now(); Store.save();
  go(`#/p/${p.id}/g/${g.id}`);
};
$('#sketch-grid').addEventListener('click', e => {
  const p = currentProject; if (!p) return;
  const o = e.target.closest('[data-open]');
  if (o) return go(`#/p/${p.id}/s/${o.dataset.open}`);
  const m = e.target.closest('[data-more]');
  if (m) sketchMenu(p, Store.sketch(p, m.dataset.more));
});
$('#add-sketch').onclick = async () => {
  const p = currentProject; if (!p) return;
  const name = await promptText('New sketch', `Sketch ${p.sketches.length + 1}`, 'Create');
  if (!name) return;
  const last = p.sketches[p.sketches.length - 1];
  const s = { id: uid(), name, created: now(), updated: now(), gridFt: last ? last.gridFt : 1, lines: [] };
  p.sketches.push(s); p.updated = now(); Store.save();
  go(`#/p/${p.id}/s/${s.id}`);
};
$('#proj-back').onclick = () => go('#/');
$('#proj-menu').onclick = () => projectMenu(currentProject);

async function sketchMenu(p, s) {
  const v = await actionSheet(s.name, [
    { label: 'Rename', value: 'rename' },
    { label: 'Duplicate', value: 'dup' },
    { label: 'Export for Rhino (DXF)', value: 'dxf' },
    { label: 'Download PNG', value: 'png' },
    { label: 'Copy as text for ChatGPT', value: 'copy' },
    { label: 'Delete sketch', value: 'delete', danger: true },
  ]);
  if (v === 'rename') { const n = await promptText('Rename sketch', s.name); if (n) { s.name = n; s.updated = now(); } }
  else if (v === 'dup') {
    const c = JSON.parse(JSON.stringify(s)); c.id = uid(); c.name = s.name + ' copy'; c.created = c.updated = now();
    p.sketches.splice(p.sketches.indexOf(s) + 1, 0, c);
  } else if (v === 'png') {
    try { await document.fonts.ready; } catch (_) { }
    downloadBlob(await exportPng(p, s), `${fileSafe(p.name)} - ${fileSafe(s.name)}.png`);
  } else if (v === 'dxf') { await exportForRhino(p, s); return; }
  else if (v === 'copy') copyOrShow(sketchText(p, s), 'Copied. Paste it into ChatGPT.');
  else if (v === 'delete') {
    if (await confirmBox(`Delete “${s.name}”?`, "This can't be undone.")) { p.sketches.splice(p.sketches.indexOf(s), 1); p.updated = now(); }
  }
  Store.save(); renderProject(p);
}

/* ---------- backup / restore ---------- */
function backup() {
  const blob = new Blob([JSON.stringify({ app: 'talago-arch', version: 1, exported: new Date().toISOString(), projects: Store.data.projects }, null, 1)], { type: 'application/json' });
  downloadBlob(blob, `talago-arch-backup-${new Date().toISOString().slice(0, 10)}.json`);
}
function restore() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d || !Array.isArray(d.projects)) throw new Error('bad');
      let added = 0, replaced = 0;
      for (const p of d.projects) {
        if (!p || !p.id || !Array.isArray(p.sketches)) continue;
        normProject(p);
        const i = Store.data.projects.findIndex(x => x.id === p.id);
        if (i >= 0) { Store.data.projects[i] = p; replaced++; } else { Store.data.projects.push(p); added++; }
      }
      Store.save(); renderToc();
      toast(`Restored: ${added} added, ${replaced} updated`);
    } catch (_) { toast('That file is not a Talago Arch backup.'); }
  };
  inp.click();
}

/* ---------- full screen ---------- */
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone;
function enterFullscreen() {
  if (isStandalone() || document.fullscreenElement || document.webkitFullscreenElement) return;
  if (!(navigator.userActivation && navigator.userActivation.isActive)) return;
  const el = document.documentElement, fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (fn) { try { const r = fn.call(el, { navigationUI: 'hide' }); r && r.catch && r.catch(() => { }); } catch (_) { } }
}
function toggleFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    const el = document.documentElement, fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fn) { try { const r = fn.call(el, { navigationUI: 'hide' }); r && r.catch && r.catch(() => { }); } catch (_) { } }
  }
}

/* ================================================================ cover */
const coverTemplate = $('#cover').cloneNode(true);
function bindCover(cover, auto) {
  let opened = false;
  const open = () => {
    if (opened) return; opened = true;
    cover.classList.add('opening');
    setTimeout(() => cover.classList.add('flipping'), 380);
    setTimeout(() => cover.classList.add('done'), 380 + 1150);
    setTimeout(() => cover.remove(), 380 + 1150 + 300);
  };
  cover.addEventListener('click', () => { enterFullscreen(); open(); });
  if (auto) setTimeout(open, 1500);
}
function showCover() {
  const old = $('#cover'); if (old) old.remove();
  const c = coverTemplate.cloneNode(true);
  document.body.appendChild(c);
  bindCover(c, false);
}

/* ================================================================ install + updates */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
async function install() {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  try { await deferredInstall.userChoice; } catch (_) { }
  deferredInstall = null;
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
      const prompt = w => toast('A new version of Talago Arch is ready.', { label: 'Update', run: () => w.postMessage('SKIP_WAITING') });
      if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); });
      });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => { }); });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return; reloading = true;
        if (currentView === 'sketch') Editor.flush();
        location.reload();
      });
    } catch (_) { }
  });
}
window.addEventListener('pagehide', () => { if (currentView === 'sketch') Editor.flush(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && currentView === 'sketch') Editor.flush(); });

/* ================================================================ boot */
Editor.init();
// Boot once every script (dxf.js, schedule.js) has loaded.
document.addEventListener('DOMContentLoaded', function boot() {
  // Resume where you left off: the cover flips open onto your last page.
  if (!location.hash || location.hash === '#') {
    const l = Store.data.last, p = l && Store.project(l.p);
    if (p) history.replaceState(null, '', l.s && Store.sketch(p, l.s) ? `#/p/${l.p}/s/${l.s}` : l.g && Store.schedule(p, l.g) ? `#/p/${l.p}/g/${l.g}` : `#/p/${l.p}`);
    else history.replaceState(null, '', '#/');
  }
  route();
  bindCover($('#cover'), true);
});
