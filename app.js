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

const GRID_OPTIONS = []; // 1' to 20' in 1/2' increments
for (let v = 1; v <= 20; v += 0.5) GRID_OPTIONS.push(v);

const PEN_WEIGHTS = [
  { name: 'Fine', end: 2.8, mid: 0.9, free: 1.1 },
  { name: 'Medium', end: 4.2, mid: 1.35, free: 1.7 },
  { name: 'Bold', end: 6.0, mid: 2.0, free: 2.6 },
];
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

function fmtFeet(ft) {
  const inches = Math.round(Math.abs(ft) * 12);
  return `${Math.floor(inches / 12)}'-${inches % 12}"`;
}
function fmtGrid(v) { return v % 1 ? `${Math.floor(v)}½'` : `${v}'`; }
function fmtDate(t) { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function fileSafe(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'sketch'; }
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

/* ================================================================ storage */
const STORE_KEY = 'talago-arch-v1';
const Store = {
  data: null,
  defaults() {
    return { projects: [], last: null, settings: { ortho: false, snap: true, dims: false, pen: 1, color: 0, tool: 'line' } };
  },
  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { d = null; }
    const def = this.defaults();
    if (!d || !Array.isArray(d.projects)) d = def;
    d.settings = Object.assign({}, def.settings, d.settings || {});
    if (d.settings.tool === 'erase') d.settings.tool = 'line';
    this.data = d;
  },
  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); return true; }
    catch (e) { toast('Could not save. Storage is full or blocked.'); return false; }
  },
  project(id) { return this.data.projects.find(p => p.id === id); },
  sketch(p, id) { return p ? p.sketches.find(s => s.id === id) : null; },
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
      a.check !== undefined ? `<span class="check ${a.check ? 'on' : ''}">${a.check ? 'On' : 'Off'}</span>` : ''}</button>`).join('')}</div>`,
    (c, done) => $$('[data-i]', c).forEach(b => b.onclick = () => done(actions[+b.dataset.i].value)));
}
function gridPicker(current) {
  return Modal.open(`<h2>Grid spacing</h2>
    <p>What one dot-to-dot space represents. The drawing isn't rescaled; this just lets you dimension from grid to grid.</p>
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
    <div class="label">Weight</div>
    <div class="opts weights">${PEN_WEIGHTS.map((w, i) => `<button type="button" data-w="${i}" class="${i === s.pen ? 'on' : ''}"><i style="height:${[1.5, 2.5, 4][i]}px"></i>${w.name}</button>`).join('')}</div>
    <div class="btns" style="margin-top:20px"><button type="button" class="btn primary" data-x>Done</button></div>`,
    (c, done) => {
      $('[data-x]', c).onclick = () => done(true);
      $$('[data-c]', c).forEach(b => b.onclick = () => { s.color = +b.dataset.c; $$('[data-c]', c).forEach(x => x.classList.toggle('on', x === b)); });
      $$('[data-w]', c).forEach(b => b.onclick = () => { s.pen = +b.dataset.w; $$('[data-w]', c).forEach(x => x.classList.toggle('on', x === b)); });
    });
}

/* ================================================================ drawing primitives */
function weightScale(z) { return Math.sqrt(z / BASE_Z); }

/** Straight line, heavier at both ends (the architect's "hit" at start and finish). */
function drawTaper(ctx, ax, ay, bx, by, wEnd, wMid, color) {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  ctx.fillStyle = color;
  ctx.beginPath();
  if (L < 0.5) { ctx.arc(ax, ay, wEnd / 2, 0, Math.PI * 2); ctx.fill(); return; }
  const nx = -dy / L, ny = dx / L;
  const k = Math.min(L * 0.16, 9 + wEnd * 3);           // length of the heavy end zone
  const half = d => (wMid + (wEnd - wMid) * Math.exp(-d / Math.max(k, 0.001))) / 2;
  const N = clamp(Math.ceil(L / 3), 10, 160);
  const ts = [];
  for (let i = 0; i <= N; i++) ts.push(0.5 - 0.5 * Math.cos(Math.PI * i / N)); // denser near the ends
  ts.forEach((t, i) => {
    const h = half(Math.min(t, 1 - t) * L), x = ax + dx * t + nx * h, y = ay + dy * t + ny * h;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  for (let i = ts.length - 1; i >= 0; i--) {
    const t = ts[i], h = half(Math.min(t, 1 - t) * L);
    ctx.lineTo(ax + dx * t - nx * h, ay + dy * t - ny * h);
  }
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(ax, ay, wEnd / 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(bx, by, wEnd / 2, 0, Math.PI * 2); ctx.fill();
}

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

function drawDots(ctx, view, W, H) {
  const { ox, oy, z } = view;
  let step = 1;
  while (step * z < 11) step *= 2;
  const r = clamp(z * 0.06, 0.8, 1.6);
  const x0 = Math.floor(-ox / z / step) * step, x1 = Math.ceil((W - ox) / z / step) * step;
  const y0 = Math.floor(-oy / z / step) * step, y1 = Math.ceil((H - oy) / z / step) * step;
  ctx.fillStyle = DOT;
  ctx.beginPath();
  for (let gy = y0; gy <= y1; gy += step) {
    const sy = oy + gy * z;
    for (let gx = x0; gx <= x1; gx += step) { const sx = ox + gx * z; ctx.moveTo(sx + r, sy); ctx.arc(sx, sy, r, 0, Math.PI * 2); }
  }
  ctx.fill();
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

/** Render a full scene. view = {ox, oy, z}. Elements in grid units. */
function drawScene(ctx, W, H, els, view, opts = {}) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  drawDots(ctx, view, W, H);
  const ws = weightScale(view.z) * (opts.weightMul || 1);
  const { ox, oy, z } = view;
  const S = p => ({ x: ox + p.x * z, y: oy + p.y * z });
  for (const el of els) {
    const pw = PEN_WEIGHTS[el.w] || PEN_WEIGHTS[1];
    const color = el === opts.highlight ? RED : inkOf(el);
    if (isFree(el)) {
      ctx.globalAlpha = el === opts.highlight ? 0.6 : 0.92;
      drawFree(ctx, el.pts.map(S), pw.free * ws, color);
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = el === opts.highlight ? 0.6 : 1;
      drawTaper(ctx, ox + el.a.x * z, oy + el.a.y * z, ox + el.b.x * z, oy + el.b.y * z, pw.end * ws, pw.mid * ws, color);
      ctx.globalAlpha = 1;
    }
  }
  if (opts.dims && opts.gridFt) {
    for (const el of els) {
      if (isFree(el)) continue;
      const len = Math.hypot(el.b.x - el.a.x, el.b.y - el.a.y);
      if (len * z < 28) continue;
      drawDim(ctx, ox + el.a.x * z, oy + el.a.y * z, ox + el.b.x * z, oy + el.b.y * z, fmtFeet(len * opts.gridFt), MUTED);
    }
  }
}

function elPoints(el) { return isFree(el) ? el.pts : [el.a, el.b]; }
function bounds(els) {
  if (!els.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of els) for (const p of elPoints(el)) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}
function fitView(els, W, H, pad = 2, maxZ = 60) {
  const b = bounds(els);
  if (!b) return { ox: (W % BASE_Z) / 2, oy: (H % BASE_Z) / 2, z: BASE_Z };
  const bw = Math.max(b.x1 - b.x0, 1) + pad * 2, bh = Math.max(b.y1 - b.y0, 1) + pad * 2;
  const z = Math.min(W / bw, H / bh, maxZ);
  return { z, ox: W / 2 - ((b.x0 + b.x1) / 2) * z, oy: H / 2 - ((b.y0 + b.y1) / 2) * z };
}

/* ================================================================ editor */
const Editor = {
  canvas: $('#canvas'),
  ctx: null,
  W: 0, H: 0, dpr: 1,
  project: null, sketch: null,
  view: { ox: 0, oy: 0, z: BASE_Z },
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
    this.project = project; this.sketch = sketch;
    this.undoStack = []; this.redoStack = [];
    this.drawing = this.stroke = this.erasing = this.gesture = this.panning = null;
    this.pointers.clear();
    $('#sk-title').textContent = sketch.name;
    this.resize(true);
    this.view = sketch.view && sketch.view.z ? { ...sketch.view } : fitView(sketch.lines, this.W, this.H);
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

  /* ---------- coordinates + snapping ---------- */
  toWorld(sx, sy) { return { x: (sx - this.view.ox) / this.view.z, y: (sy - this.view.oy) / this.view.z }; },
  toScreen(p) { return { x: this.view.ox + p.x * this.view.z, y: this.view.oy + p.y * this.view.z }; },
  local(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },

  endpoints() {
    const out = [];
    for (const el of this.sketch.lines) if (!isFree(el)) out.push(el.a, el.b);
    return out;
  },
  nearestEndpoint(p) {
    let best = null, bd = SNAP_PX / this.view.z;
    for (const q of this.endpoints()) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  },
  snapPoint(p) {
    const ep = this.nearestEndpoint(p);
    if (ep) return { p: { x: ep.x, y: ep.y }, snapped: true };
    if (Store.settings.snap) return { p: { x: Math.round(p.x), y: Math.round(p.y) }, snapped: false };
    return { p, snapped: false };
  },
  /** End point for a line starting at a, given the raw pointer position p. */
  constrain(a, p) {
    if (!Store.settings.ortho) return this.snapPoint(p);
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
    if (!aligned && Store.settings.snap) s = Math.round(raw);
    return { p: { x: a.x + s * ux, y: a.y + s * uy }, snapped };
  },

  /* ---------- pointer handling ---------- */
  startPan(id, pos) { this.panning = { id, x: pos.x, y: pos.y, ox: this.view.ox, oy: this.view.oy }; },

  onDown(e) {
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { }
    if (e.pointerType === 'pen') this.sawPen = true;
    const pos = this.local(e);
    this.pointers.set(e.pointerId, { ...pos, type: e.pointerType });

    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || this.spaceDown)) return this.startPan(e.pointerId, pos);
    // Two fingers: pinch-zoom / pan. Cancels anything in progress.
    if (this.pointers.size >= 2) {
      this.drawing = null; this.stroke = null; this.panning = null;
      if (this.erasing) { this.cancelErase(); }
      this.startGesture();
      this.render();
      return;
    }
    if (this.lockUntilAllUp) return;
    if (this.tool === 'hand' || (e.pointerType === 'touch' && this.sawPen)) return this.startPan(e.pointerId, pos);

    const w = this.toWorld(pos.x, pos.y);
    const s = Store.settings;
    if (this.tool === 'erase') {
      this.erasing = { id: e.pointerId, removed: [], before: this.snapshot() };
      this.eraseAt(pos);
    } else if (this.tool === 'pencil') {
      this.stroke = { id: e.pointerId, el: { t: 'f', pts: [w], w: s.pen, c: s.color } };
    } else {
      const sp = this.snapPoint(w);
      this.drawing = { id: e.pointerId, a: sp.p, b: sp.p, snapA: sp.snapped, snapB: false };
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
    if (this.stroke && this.stroke.id === e.pointerId) {
      const pts = this.stroke.el.pts, minD = 1.5 / this.view.z;
      for (const ce of (coalesced.length ? coalesced : [e])) {
        const lp = this.local(ce), w = this.toWorld(lp.x, lp.y), last = pts[pts.length - 1];
        if (Math.hypot(w.x - last.x, w.y - last.y) > minD) pts.push(w);
      }
      return this.render();
    }
    if (this.drawing && this.drawing.id === e.pointerId) {
      const last = coalesced.length ? this.local(coalesced[coalesced.length - 1]) : pos;
      const c = this.constrain(this.drawing.a, this.toWorld(last.x, last.y));
      this.drawing.b = c.p; this.drawing.snapB = c.snapped;
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
    if (this.stroke && this.stroke.id === e.pointerId) {
      const st = this.stroke; this.stroke = null;
      if (!cancelled) {
        const before = this.snapshot();
        st.el.pts = st.el.pts.map(p => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3) }));
        this.sketch.lines.push(st.el);
        this.commit(before);
      }
      this.render(); return;
    }
    if (this.drawing && this.drawing.id === e.pointerId) {
      const d = this.drawing; this.drawing = null;
      const len = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
      if (!cancelled && len * this.view.z > 4) {
        const before = this.snapshot();
        this.sketch.lines.push({ a: { ...d.a }, b: { ...d.b }, w: Store.settings.pen, c: Store.settings.color });
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
    const w = this.toWorld(sx, sy);
    this.view = { z, ox: sx - w.x * z, oy: sy - w.y * z };
    this.render();
  },
  onWheel(e) {
    e.preventDefault();
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
      const pts = elPoints(el).map(p => this.toScreen(p));
      for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
        const d = segDist(pts[i], pts[i + 1] || pts[i]);
        if (d < bd) { bd = d; best = el; }
      }
    }
    return best;
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
  saveView() {
    if (!this.sketch) return;
    this.sketch.view = { ...this.view };
    this.syncZoom();
    clearTimeout(this._viewT);
    this._viewT = setTimeout(() => Store.save(), 500);
  },
  flush() {
    if (!this.sketch) return;
    clearTimeout(this._saveT); clearTimeout(this._viewT);
    this.sketch.view = { ...this.view };
    this.setStatus(Store.save() ? 'saved' : 'error');
  },

  /* ---------- toolbar ---------- */
  setTool(t) {
    Store.settings.tool = t; this.hover = null;
    Store.save(); this.syncUI(); this.render();
  },
  async action(act) {
    const s = Store.settings, cx = this.W / 2, cy = this.H / 2;
    switch (act) {
      case 'ortho': s.ortho = !s.ortho; toast(s.ortho ? 'Ortho on: horizontal, vertical and 45° only' : 'Ortho off'); break;
      case 'snap': s.snap = !s.snap; break;
      case 'dims': s.dims = !s.dims; break;
      case 'pen': await penPicker(); if (this.tool === 'erase' || this.tool === 'hand') s.tool = 'line'; break;
      case 'grid': return this.pickGrid();
      case 'undo': return this.undo();
      case 'redo': return this.redo();
      case 'clear': return this.clear();
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
    toast(`Grid set to ${fmtFeet(v)} per dot`);
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
    const tools = { l: 'line', p: 'pencil', e: 'erase', h: 'hand' };
    const acts = { o: 'ortho', g: 'snap', d: 'dims', f: 'fit', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out' };
    if (tools[k]) { e.preventDefault(); this.setTool(tools[k]); }
    else if (acts[k]) { e.preventDefault(); this.action(acts[k]); }
    else if (k === 'escape') { if (this.drawing || this.stroke) { this.drawing = this.stroke = null; this.render(); } else $('#sk-back').click(); }
  },

  fit() {
    this.view = fitView(this.sketch.lines, this.W, this.H, 3, 48);
    this.saveView(); this.render();
  },

  async menu() {
    const s = Store.settings;
    const v = await actionSheet(this.sketch.name, [
      { label: 'Snap to grid', value: 'snap', check: s.snap, hint: 'Line ends land on grid dots (G)' },
      { label: 'Show dimensions', value: 'dims', check: s.dims, hint: 'Length of every line in feet (D)' },
      { label: 'Fit drawing to screen', value: 'fit' },
      { label: 'Copy sketch as text for ChatGPT', value: 'copy', hint: 'Line coordinates and lengths in feet' },
      { label: 'Download PNG', value: 'png' },
      { label: 'Rename sketch', value: 'rename' },
    ]);
    if (v === 'snap' || v === 'dims' || v === 'fit') this.action(v);
    else if (v === 'copy') this.copyText();
    else if (v === 'png') this.downloadPng();
    else if (v === 'rename') {
      const n = await promptText('Rename sketch', this.sketch.name);
      if (n) { this.sketch.name = n; $('#sk-title').textContent = n; this.touch(); }
    }
  },

  /* ---------- export / share ---------- */
  async renderPng() {
    try { await document.fonts.ready; } catch (_) { }
    return exportPng(this.project, this.sketch);
  },
  async downloadPng() {
    downloadBlob(await this.renderPng(), `${fileSafe(this.project.name)} - ${fileSafe(this.sketch.name)}.png`);
  },
  async copyText() { await copyOrShow(sketchText(this.project, this.sketch), 'Copied. Paste it into ChatGPT.'); },
  async share() {
    this.flush();
    const blob = await this.renderPng();
    const name = `${fileSafe(this.project.name)} - ${fileSafe(this.sketch.name)}.png`;
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
    if (this.needsRender) return;
    this.needsRender = true;
    requestAnimationFrame(() => { this.needsRender = false; this.paint(); });
  },
  paint() {
    if (!this.sketch || currentView !== 'sketch') return;
    const ctx = this.ctx, { W, H, dpr } = this, s = Store.settings;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, W, H, this.sketch.lines, this.view, { dims: s.dims, gridFt: this.sketch.gridFt, highlight: this.hover });
    this.syncZoom();
    const pw = PEN_WEIGHTS[s.pen], ws = weightScale(this.view.z), ink = INKS[s.color].hex;
    if (this.stroke) {
      ctx.globalAlpha = 0.92;
      drawFree(ctx, this.stroke.el.pts.map(p => this.toScreen(p)), pw.free * ws, ink);
      ctx.globalAlpha = 1;
    }
    const d = this.drawing;
    if (d) {
      const a = this.toScreen(d.a), b = this.toScreen(d.b);
      ctx.globalAlpha = 0.85;
      drawTaper(ctx, a.x, a.y, b.x, b.y, pw.end * ws, pw.mid * ws, ink);
      ctx.globalAlpha = 1;
      const ring = (p, on) => { if (!on) return; ctx.strokeStyle = RED; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.stroke(); };
      ring(a, d.snapA); ring(b, d.snapB);
      const len = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
      if (len > 0) {
        let ang = Math.round(-Math.atan2(d.b.y - d.a.y, d.b.x - d.a.x) * 180 / Math.PI);
        if (ang < 0) ang += 360;
        drawDim(ctx, a.x, a.y, b.x, b.y, `${fmtFeet(len * this.sketch.gridFt)}   ${ang}°`, RED, 17);
      }
    }
  },
};

/* ================================================================ export helpers */
function exportPng(project, sketch) {
  const els = sketch.lines, z = 40, pad = 2.5;
  const b = bounds(els) || { x0: 0, y0: 0, x1: 16, y1: 12 };
  const wU = b.x1 - b.x0 + pad * 2, hU = b.y1 - b.y0 + pad * 2 + 1.5;
  const zz = z * Math.min(1, 4096 / (wU * z), 4096 / (hU * z));
  const W = Math.max(480, Math.round(wU * zz)), H = Math.max(360, Math.round(hU * zz));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const view = { z: zz, ox: W / 2 - (b.x0 + b.x1) / 2 * zz, oy: (H - 1.5 * zz) / 2 - (b.y0 + b.y1) / 2 * zz };
  drawScene(ctx, W, H, els, view, { dims: Store.settings.dims, gridFt: sketch.gridFt, weightMul: 1.15 });
  ctx.fillStyle = RED; ctx.fillRect(16, H - 40, 26, 26);
  ctx.fillStyle = '#fef9ee'; ctx.font = `15px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Ta', 29, H - 26.5);
  ctx.textAlign = 'left'; ctx.fillStyle = MUTED; ctx.font = `14px ${SANS}`;
  ctx.fillText(`${project.name}  ·  ${sketch.name}  ·  grid ${fmtFeet(sketch.gridFt)}`, 52, H - 26.5);
  return new Promise(res => c.toBlob(res, 'image/png'));
}

function sketchText(project, sketch) {
  const g = sketch.gridFt, n = v => +(v * g).toFixed(2);
  const lines = sketch.lines.filter(el => !isFree(el)), free = sketch.lines.filter(isFree);
  const out = [
    'Talago Arch sketch',
    `Project: ${project.name}`,
    `Sketch: ${sketch.name}`,
    `Grid spacing: ${fmtFeet(g)} between dots`,
    'Coordinates in feet, origin top-left, x to the right, y downward.',
    `Straight lines (${lines.length}):`,
  ];
  lines.forEach((l, i) => {
    const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) * g;
    let ang = Math.round(-Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) * 180 / Math.PI); if (ang < 0) ang += 360;
    out.push(`${i + 1}. (${n(l.a.x)}, ${n(l.a.y)}) to (${n(l.b.x)}, ${n(l.b.y)}), length ${fmtFeet(len)}, angle ${ang}°${l.c ? `, ${INKS[l.c].name.toLowerCase()}` : ''}`);
  });
  if (free.length) {
    out.push(`Freehand pencil strokes (${free.length}):`);
    free.forEach((f, i) => {
      const b = bounds([f]);
      out.push(`${i + 1}. within x ${n(b.x0)} to ${n(b.x1)}, y ${n(b.y0)} to ${n(b.y1)}`);
    });
  }
  return out.join('\n');
}

function notebookText() {
  const ps = Store.data.projects;
  const out = ['Talago Arch notebook', `${plural(ps.length, 'project', 'projects')}`, ''];
  ps.forEach((p, i) => {
    out.push(`${pad2(i + 1)}. ${p.name} (${plural(p.sketches.length, 'sketch', 'sketches')})`);
    p.sketches.forEach(s => out.push(`    - ${s.name}: ${plural(s.lines.length, 'element', 'elements')}, grid ${fmtFeet(s.gridFt)}, updated ${fmtDate(s.updated)}`));
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
const views = { toc: $('#view-toc'), project: $('#view-project'), sketch: $('#view-sketch') };
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function show(name) {
  for (const k in views) views[k].hidden = k !== name;
  currentView = name;
  document.querySelector('meta[name=theme-color]').content = PAPER;
}

function route() {
  const m = location.hash.match(/^#\/p\/([^/]+)(?:\/s\/([^/]+))?/);
  if (currentView === 'sketch') Editor.flush();
  if (m) {
    const p = Store.project(m[1]);
    if (!p) return go('#/');
    if (m[2]) {
      const s = Store.sketch(p, m[2]);
      if (!s) return go(`#/p/${p.id}`);
      Store.data.last = { p: p.id, s: s.id }; Store.save();
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
function renderToc() {
  const ps = Store.data.projects;
  $('#toc-count').textContent = plural(ps.length, 'project', 'projects');
  const list = $('#project-list');
  if (!ps.length) {
    list.innerHTML = `<li class="empty">No projects yet. Tap <b>Add project</b> to start your first one.</li>`;
    return;
  }
  list.innerHTML = ps.map(p => `<li>
      <button type="button" class="row" data-open="${p.id}">
        <span class="folder"><svg><use href="#i-folder"/></svg></span>
        <span class="row-text"><span class="row-name">${esc(p.name)}</span><span class="row-sub">Updated ${fmtDate(p.updated)}</span></span>
        <span class="leader"></span>
        <span class="row-count">${pad2(p.sketches.length)}</span>
        <svg class="chev"><use href="#i-chev"/></svg>
      </button></li>`).join('');
}
$('#project-list').addEventListener('click', e => {
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

$('#add-project').onclick = async () => {
  const name = await promptText('New project', '', 'Create');
  if (!name) return;
  const p = { id: uid(), name, created: now(), updated: now(), sketches: [] };
  Store.data.projects.push(p); Store.save();
  go(`#/p/${p.id}`);
};
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
    if (await confirmBox(`Delete “${p.name}”?`, `This removes the project and its ${plural(p.sketches.length, 'sketch', 'sketches')} from this device. This can't be undone.`)) {
      Store.data.projects.splice(Store.data.projects.indexOf(p), 1); Store.save();
      if (currentView !== 'toc') return go('#/');
    }
  }
  if (currentView === 'toc') renderToc(); else if (currentView === 'project') renderProject(p);
}

/* ---------- project ---------- */
let currentProject = null;
function renderProject(p) {
  currentProject = p;
  $('#proj-kicker').textContent = `Project ${pad2(Store.data.projects.indexOf(p) + 1)}`;
  $('#proj-title').textContent = p.name;
  $('#proj-lede').textContent = `${plural(p.sketches.length, 'sketch', 'sketches')} · Updated ${fmtDate(p.updated)}`;
  const grid = $('#sketch-grid');
  grid.innerHTML = p.sketches.length ? p.sketches.map(s => `<div class="card">
      <button type="button" class="open" data-open="${s.id}"><canvas class="thumb" data-thumb="${s.id}"></canvas></button>
      <div class="meta"><span class="nm">${esc(s.name)}</span><span class="dt">Updated ${fmtDate(s.updated)} · Grid ${fmtGrid(s.gridFt)}</span></div>
      <button type="button" class="more" data-more="${s.id}" aria-label="Options for ${esc(s.name)}"><svg><use href="#i-more"/></svg></button>
    </div>`).join('') : `<div class="empty">No sketches yet. Tap <b>New sketch</b> to open a fresh page.</div>`;
  requestAnimationFrame(() => $$('[data-thumb]', grid).forEach(c => renderThumb(c, Store.sketch(p, c.dataset.thumb))));
}
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
  } else if (v === 'copy') copyOrShow(sketchText(p, s), 'Copied. Paste it into ChatGPT.');
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
(function boot() {
  // Resume where you left off: the cover flips open onto your last page.
  if (!location.hash || location.hash === '#') {
    const l = Store.data.last, p = l && Store.project(l.p);
    if (p) history.replaceState(null, '', l.s && Store.sketch(p, l.s) ? `#/p/${l.p}/s/${l.s}` : `#/p/${l.p}`);
    else history.replaceState(null, '', '#/');
  }
  route();
  bindCover($('#cover'), true);
})();
