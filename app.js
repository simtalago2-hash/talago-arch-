/* Talago Arch: personal drafting sketchbook
 * Plain JS, no build step. Data is stored on-device (localStorage).
 * Sketch coordinates are stored in grid units (1 unit = 1 dot spacing).
 */
'use strict';

/* ================================================================ utils */
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => Date.now();

const GRID_OPTIONS = []; // 1' to 20' in 1/2' increments
for (let v = 1; v <= 20; v += 0.5) GRID_OPTIONS.push(v);

const PEN_WEIGHTS = [
  { name: 'Fine', end: 2.8, mid: 0.9 },
  { name: 'Med', end: 4.2, mid: 1.35 },
  { name: 'Bold', end: 6.0, mid: 2.0 },
];
const BASE_Z = 24;            // CSS px per grid unit at 100% zoom (≈ Moleskine 5 mm dot pitch)
const SNAP_PX = 16;           // endpoint snap radius in screen px
const INK = '#1f1c19';
const RED = '#a3222a';
const PAPER = '#f6f1e5';
const DOT = '#c4bbab';

function fmtFeet(ft) {
  let inches = Math.round(Math.abs(ft) * 12);
  const f = Math.floor(inches / 12), i = inches % 12;
  return `${f}'-${i}"`;
}
function fmtGrid(v) {
  const whole = Math.floor(v), half = v % 1 !== 0;
  return half ? `${whole}½'` : `${whole}'`;
}
function fmtDate(t) {
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fileSafe(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'sketch'; }

/* ================================================================ storage */
const STORE_KEY = 'talago-arch-v1';
const Store = {
  data: null,
  defaults() {
    return { projects: [], last: null, settings: { ortho: false, snap: true, dims: false, pen: 1 } };
  },
  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { d = null; }
    const def = this.defaults();
    if (!d || !Array.isArray(d.projects)) d = def;
    d.settings = Object.assign({}, def.settings, d.settings || {});
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
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 12000 : 2600);
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
      $('form', c).onsubmit = e => { e.preventDefault(); const v = inp.value.trim(); done(v || null); };
    });
}
function confirmBox(title, msg, okLabel = 'Delete') {
  return Modal.open(`<h2>${esc(title)}</h2><p>${esc(msg)}</p>
    <div class="btns"><button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn danger" data-ok>${esc(okLabel)}</button></div>`,
    (c, done) => { $('[data-x]', c).onclick = () => done(false); $('[data-ok]', c).onclick = () => done(true); });
}
function actionSheet(title, actions) {
  return Modal.open(`<h2>${esc(title)}</h2><div class="sheet-list">${actions.map((a, i) =>
    `<button type="button" data-i="${i}" class="${a.danger ? 'danger' : ''}">${esc(a.label)}${a.hint ? `<small>${esc(a.hint)}</small>` : ''}</button>`).join('')}</div>`,
    (c, done) => c.querySelectorAll('[data-i]').forEach(b => b.onclick = () => done(actions[+b.dataset.i].value)));
}
function gridPicker(current) {
  return Modal.open(`<h2>Grid spacing</h2>
    <p>Each dot-to-dot space represents this distance. Drawings are not rescaled; it just sets what the grid means so you can dimension.</p>
    <div class="grid-opts">${GRID_OPTIONS.map(v => `<button type="button" data-v="${v}" class="${v === current ? 'on' : ''}">${fmtGrid(v)}</button>`).join('')}</div>
    <div class="btns"><button type="button" class="btn" data-x>Cancel</button></div>`,
    (c, done) => {
      $('[data-x]', c).onclick = () => done(null);
      c.querySelectorAll('[data-v]').forEach(b => b.onclick = () => done(+b.dataset.v));
      const on = $('.on', c); on && on.scrollIntoView({ block: 'center' });
    });
}

/* ================================================================ drawing primitives */
// Weight scales gently with zoom so lines stay crisp but feel physical.
function weightScale(z) { return Math.sqrt(z / BASE_Z); }

/** Straight line, heavier at both ends (architect's "hit" at start & finish). */
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
  for (let i = 0; i <= N; i++) { const u = i / N; ts.push(0.5 - 0.5 * Math.cos(Math.PI * u)); } // denser near ends
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i], h = half(Math.min(t, 1 - t) * L);
    const x = ax + dx * t + nx * h, y = ay + dy * t + ny * h;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  for (let i = ts.length - 1; i >= 0; i--) {
    const t = ts[i], h = half(Math.min(t, 1 - t) * L);
    ctx.lineTo(ax + dx * t - nx * h, ay + dy * t - ny * h);
  }
  ctx.closePath();
  ctx.fill();
  ctx.beginPath(); ctx.arc(ax, ay, wEnd / 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(bx, by, wEnd / 2, 0, Math.PI * 2); ctx.fill();
}

function drawDots(ctx, view, W, H) {
  const { ox, oy, z } = view;
  let step = 1;
  while (step * z < 11) step *= 2;
  const r = clamp(z * 0.05, 0.75, 1.5);
  const x0 = Math.floor(-ox / z / step) * step, x1 = Math.ceil((W - ox) / z / step) * step;
  const y0 = Math.floor(-oy / z / step) * step, y1 = Math.ceil((H - oy) / z / step) * step;
  ctx.fillStyle = DOT;
  ctx.beginPath();
  for (let gy = y0; gy <= y1; gy += step) {
    const sy = oy + gy * z;
    for (let gx = x0; gx <= x1; gx += step) {
      const sx = ox + gx * z;
      ctx.moveTo(sx + r, sy);
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

function drawDim(ctx, ax, ay, bx, by, label, color, offset = 11) {
  const ang = Math.atan2(by - ay, bx - ax);
  let a = ang;
  if (a > Math.PI / 2 || a <= -Math.PI / 2) a += Math.PI;   // keep text upright
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const nx = Math.sin(a), ny = -Math.cos(a);               // "above" the line in text space
  ctx.save();
  ctx.translate(mx + nx * offset, my + ny * offset);
  ctx.rotate(a);
  ctx.font = `14px 'Architects Daughter', cursive`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(246,241,229,.85)';
  ctx.fillRect(-w / 2 - 4, -9, w + 8, 18);
  ctx.fillStyle = color;
  ctx.fillText(label, 0, 1);
  ctx.restore();
}

/** Render a full scene. view = {ox, oy, z}. Lines in grid units. */
function drawScene(ctx, W, H, lines, view, opts = {}) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  drawDots(ctx, view, W, H);
  const ws = weightScale(view.z) * (opts.weightMul || 1);
  const { ox, oy, z } = view;
  for (const l of lines) {
    const pw = PEN_WEIGHTS[l.w] || PEN_WEIGHTS[1];
    drawTaper(ctx, ox + l.a.x * z, oy + l.a.y * z, ox + l.b.x * z, oy + l.b.y * z, pw.end * ws, pw.mid * ws, l === opts.highlight ? RED : INK);
  }
  if (opts.dims && opts.gridFt) {
    for (const l of lines) {
      const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
      if (len * z < 26) continue;
      drawDim(ctx, ox + l.a.x * z, oy + l.a.y * z, ox + l.b.x * z, oy + l.b.y * z, fmtFeet(len * opts.gridFt), '#6d655b');
    }
  }
}

function linesBounds(lines) {
  if (!lines.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of lines) for (const p of [l.a, l.b]) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}
function fitView(lines, W, H, pad = 2, maxZ = 60) {
  const b = linesBounds(lines);
  if (!b) return { ox: W / 2 % BASE_Z, oy: H / 2 % BASE_Z, z: BASE_Z };
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
  mode: 'draw',                 // 'draw' | 'erase'
  pointers: new Map(),
  drawing: null,                // {id, a, b, snapA, snapB}
  gesture: null,
  panning: null,
  lockUntilAllUp: false,
  sawPen: false,
  undoStack: [], redoStack: [],
  needsRender: false,
  hover: null,
  spaceDown: false,

  init() {
    this.ctx = this.canvas.getContext('2d');
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this.onDown(e));
    c.addEventListener('pointermove', e => this.onMove(e));
    c.addEventListener('pointerup', e => this.onUp(e));
    c.addEventListener('pointercancel', e => this.onUp(e, true));
    c.addEventListener('lostpointercapture', e => { if (this.pointers.has(e.pointerId)) this.onUp(e, true); });
    c.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('gesturestart', e => e.preventDefault());
    $('#toolbar').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (b) this.action(b.dataset.act);
    });
    $('#sk-back').onclick = () => { this.flush(); go(`#/p/${this.project.id}`); };
    $('#sk-share').onclick = () => this.share();
    $('#sk-menu').onclick = () => this.menu();
    document.addEventListener('keydown', e => this.onKey(e));
    document.addEventListener('keyup', e => { if (e.code === 'Space') this.spaceDown = false; });
  },

  open(project, sketch) {
    this.flush();
    this.project = project; this.sketch = sketch;
    this.undoStack = []; this.redoStack = [];
    this.drawing = null; this.gesture = null; this.pointers.clear();
    this.mode = 'draw';
    $('#sk-proj').textContent = project.name;
    $('#sk-title').textContent = sketch.name;
    this.resize(true);
    if (sketch.view && sketch.view.z) this.view = { ...sketch.view };
    else this.view = fitView(sketch.lines, this.W, this.H);
    if (!sketch.lines.length && !sketch.view) this.view = { ox: (this.W % BASE_Z) / 2, oy: (this.H % BASE_Z) / 2, z: BASE_Z };
    this.syncToolbar();
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

  /* ---------- coordinates ---------- */
  toWorld(sx, sy) { return { x: (sx - this.view.ox) / this.view.z, y: (sy - this.view.oy) / this.view.z }; },
  toScreen(p) { return { x: this.view.ox + p.x * this.view.z, y: this.view.oy + p.y * this.view.z }; },
  local(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },

  nearestEndpoint(p, exclude) {
    let best = null, bd = SNAP_PX / this.view.z;
    for (const l of this.sketch.lines) for (const q of [l.a, l.b]) {
      if (q === exclude) continue;
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
    const uu = ux * ux + uy * uy;
    const ulen = Math.sqrt(uu), z = this.view.z;
    const raw = (dx * ux + dy * uy) / uu;    // end = a + s·u
    let s = raw, snapped = false, aligned = false, best = SNAP_PX;
    // Stop the line where it lines up with a nearby existing endpoint (extension tracking).
    for (const l of this.sketch.lines) for (const q of [l.a, l.b]) {
      const sq = ((q.x - a.x) * ux + (q.y - a.y) * uy) / uu;
      if (Math.abs(sq) < 1e-6) continue;
      const along = Math.abs(sq - raw) * ulen * z;                        // px along the ray
      const perp = Math.hypot(q.x - (a.x + sq * ux), q.y - (a.y + sq * uy)) * z; // px off the ray
      if (along < best && perp < 60) { best = along; s = sq; aligned = true; snapped = perp < 0.5; }
    }
    if (!aligned && Store.settings.snap) s = Math.round(raw);
    return { p: { x: a.x + s * ux, y: a.y + s * uy }, snapped };
  },

  /* ---------- pointer handling ---------- */
  onDown(e) {
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { }
    if (e.pointerType === 'pen') this.sawPen = true;
    const pos = this.local(e);
    this.pointers.set(e.pointerId, { ...pos, type: e.pointerType });

    // Mouse pan: middle button, right button, or space + drag
    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || this.spaceDown)) {
      this.panning = { id: e.pointerId, x: pos.x, y: pos.y, ox: this.view.ox, oy: this.view.oy };
      return;
    }
    // Two fingers: pinch-zoom / pan. Cancels any line in progress.
    if (this.pointers.size >= 2) {
      this.drawing = null; this.panning = null;
      this.startGesture();
      return;
    }
    if (this.lockUntilAllUp) return;
    // With a stylus present, a single finger pans (palm-friendly).
    if (e.pointerType === 'touch' && this.sawPen) {
      this.panning = { id: e.pointerId, x: pos.x, y: pos.y, ox: this.view.ox, oy: this.view.oy };
      return;
    }
    const w = this.toWorld(pos.x, pos.y);
    if (this.mode === 'erase') {
      this.erasing = { id: e.pointerId, removed: [], before: this.snapshot() };
      this.eraseAt(pos);
      return;
    }
    const s = this.snapPoint(w);
    this.drawing = { id: e.pointerId, a: s.p, b: s.p, snapA: s.snapped, snapB: false, t: now() };
    this.render();
  },

  onMove(e) {
    const pos = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { ...this.pointers.get(e.pointerId), ...pos });
    if (this.gesture) { this.updateGesture(); return; }
    if (this.panning && this.panning.id === e.pointerId) {
      this.view.ox = this.panning.ox + pos.x - this.panning.x;
      this.view.oy = this.panning.oy + pos.y - this.panning.y;
      this.render(); return;
    }
    if (this.erasing && this.erasing.id === e.pointerId) { this.eraseAt(pos); return; }
    if (this.drawing && this.drawing.id === e.pointerId) {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const last = events.length ? this.local(events[events.length - 1]) : pos;
      const c = this.constrain(this.drawing.a, this.toWorld(last.x, last.y));
      this.drawing.b = c.p; this.drawing.snapB = c.snapped;
      this.render(); return;
    }
    if (e.pointerType === 'mouse' && this.mode === 'erase') { this.hover = this.hitLine(pos); this.render(); }
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
    if (this.drawing && this.drawing.id === e.pointerId) {
      const d = this.drawing; this.drawing = null;
      const len = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
      if (!cancelled && len * this.view.z > 4) {
        const before = this.snapshot();
        this.sketch.lines.push({ a: { ...d.a }, b: { ...d.b }, w: Store.settings.pen });
        this.commit(before);
      }
      this.render();
    }
  },

  startGesture() {
    const [p1, p2] = [...this.pointers.values()];
    this.gesture = {
      d0: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1,
      m0: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      v0: { ...this.view },
    };
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
  onWheel(e) {
    e.preventDefault();
    const pos = this.local(e);
    if (e.ctrlKey || e.metaKey || e.deltaMode !== 0 || Math.abs(e.deltaY) > 40 && e.deltaX === 0) {
      const z = clamp(this.view.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), 4, 160);
      const w = this.toWorld(pos.x, pos.y);
      this.view = { z, ox: pos.x - w.x * z, oy: pos.y - w.y * z };
    } else {
      this.view.ox -= e.deltaX; this.view.oy -= e.deltaY;
    }
    this.render();
    clearTimeout(this._wheelT); this._wheelT = setTimeout(() => this.saveView(), 300);
  },

  /* ---------- erase ---------- */
  hitLine(pos) {
    const tol = 12;
    let best = null, bd = tol;
    for (const l of this.sketch.lines) {
      const a = this.toScreen(l.a), b = this.toScreen(l.b);
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 ? clamp(((pos.x - a.x) * dx + (pos.y - a.y) * dy) / L2, 0, 1) : 0;
      const d = Math.hypot(pos.x - (a.x + dx * t), pos.y - (a.y + dy * t));
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  },
  eraseAt(pos) {
    const l = this.hitLine(pos);
    if (!l) return;
    this.sketch.lines.splice(this.sketch.lines.indexOf(l), 1);
    this.erasing.removed.push(l);
    this.render();
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
  touch() {
    this.sketch.updated = this.project.updated = now();
    this.syncToolbar();
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => Store.save(), 250);
  },
  saveView() {
    if (!this.sketch) return;
    this.sketch.view = { ...this.view };
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => Store.save(), 400);
  },
  flush() {
    if (!this.sketch) return;
    clearTimeout(this._saveT);
    this.sketch.view = { ...this.view };
    Store.save();
  },

  /* ---------- toolbar ---------- */
  action(act) {
    const s = Store.settings;
    switch (act) {
      case 'ortho': s.ortho = !s.ortho; toast(s.ortho ? 'Ortho on: 0°, 45°, 90° only' : 'Ortho off'); break;
      case 'snap': s.snap = !s.snap; toast(s.snap ? 'Snapping to grid dots' : 'Free placement (endpoints still snap)'); break;
      case 'dims': s.dims = !s.dims; break;
      case 'erase': this.mode = this.mode === 'erase' ? 'draw' : 'erase'; this.hover = null; break;
      case 'pen': s.pen = (s.pen + 1) % PEN_WEIGHTS.length; break;
      case 'grid': this.pickGrid(); return;
      case 'undo': this.undo(); return;
      case 'redo': this.redo(); return;
    }
    Store.save();
    this.syncToolbar();
    this.render();
  },
  async pickGrid() {
    const v = await gridPicker(this.sketch.gridFt);
    if (v == null) return;
    this.sketch.gridFt = v;
    this.touch(); this.syncToolbar(); this.render();
    toast(`Grid set to ${fmtFeet(v)} per dot`);
  },
  syncToolbar() {
    const s = Store.settings, tb = $('#toolbar');
    const set = (a, on) => tb.querySelector(`[data-act="${a}"]`).classList.toggle('on', on);
    set('ortho', s.ortho); set('snap', s.snap); set('dims', s.dims); set('erase', this.mode === 'erase');
    tb.querySelector('[data-act="undo"]').disabled = !this.undoStack.length;
    tb.querySelector('[data-act="redo"]').disabled = !this.redoStack.length;
    const pw = PEN_WEIGHTS[s.pen];
    $('#pen-label').textContent = pw.name;
    const pi = $('#pen-ico'); pi.style.strokeWidth = [1.2, 2.2, 3.4][s.pen];
    if (this.sketch) {
      $('#grid-label').textContent = fmtGrid(this.sketch.gridFt);
      $('#scale-chip').textContent = `grid · ${fmtFeet(this.sketch.gridFt)}`;
    }
  },

  onKey(e) {
    if (currentView !== 'sketch' || !Modal.el.hidden) return;
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); this.redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { this.spaceDown = true; e.preventDefault(); return; }
    const map = { o: 'ortho', g: 'snap', d: 'dims', e: 'erase', w: 'pen' };
    if (map[k]) { e.preventDefault(); this.action(map[k]); }
    else if (k === 'f') { this.fit(); }
    else if (k === 'escape') { if (this.drawing) { this.drawing = null; this.render(); } else $('#sk-back').click(); }
  },

  fit() {
    this.view = fitView(this.sketch.lines, this.W, this.H, 3, 48);
    this.saveView(); this.render();
  },

  async menu() {
    const v = await actionSheet(this.sketch.name, [
      { label: 'Fit drawing to screen', value: 'fit', hint: 'Shortcut: F' },
      { label: 'Copy sketch as text for ChatGPT', value: 'copy', hint: 'Lines with coordinates and lengths in feet' },
      { label: 'Download PNG', value: 'png' },
      { label: 'Rename sketch', value: 'rename' },
      { label: 'Clear all lines', value: 'clear', danger: true },
    ]);
    if (v === 'fit') this.fit();
    else if (v === 'copy') this.copyText();
    else if (v === 'png') this.downloadPng();
    else if (v === 'rename') {
      const n = await promptText('Rename sketch', this.sketch.name);
      if (n) { this.sketch.name = n; $('#sk-title').textContent = n; this.touch(); }
    } else if (v === 'clear') {
      if (!this.sketch.lines.length) return;
      if (await confirmBox('Clear sketch?', 'All lines will be removed. You can undo this.', 'Clear')) {
        const before = this.snapshot(); this.sketch.lines = []; this.commit(before); this.render();
      }
    }
  },

  /* ---------- export / share ---------- */
  async renderPng() {
    try { await document.fonts.ready; } catch (_) { }
    return exportPng(this.project, this.sketch);
  },
  async downloadPng() {
    const blob = await this.renderPng();
    downloadBlob(blob, `${fileSafe(this.project.name)} - ${fileSafe(this.sketch.name)}.png`);
  },
  async copyText() {
    const txt = sketchText(this.project, this.sketch);
    try { await navigator.clipboard.writeText(txt); toast('Copied. Paste it into ChatGPT.'); }
    catch (_) {
      await Modal.open(`<h2>Sketch as text</h2><p>Select and copy:</p><textarea style="width:100%;height:240px;font:14px monospace">${esc(txt)}</textarea>
        <div class="btns"><button type="button" class="btn primary" data-x>Done</button></div>`, (c, done) => { $('[data-x]', c).onclick = () => done(); });
    }
  },
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
    const ctx = this.ctx, { W, H, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, W, H, this.sketch.lines, this.view, { dims: Store.settings.dims, gridFt: this.sketch.gridFt, highlight: this.hover });
    const d = this.drawing;
    if (d) {
      const a = this.toScreen(d.a), b = this.toScreen(d.b);
      const pw = PEN_WEIGHTS[Store.settings.pen], ws = weightScale(this.view.z);
      ctx.globalAlpha = 0.85;
      drawTaper(ctx, a.x, a.y, b.x, b.y, pw.end * ws, pw.mid * ws, INK);
      ctx.globalAlpha = 1;
      const ring = (p, on) => { if (!on) return; ctx.strokeStyle = RED; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.stroke(); };
      ring(a, d.snapA); ring(b, d.snapB);
      const len = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
      if (len > 0) {
        let ang = Math.round(-Math.atan2(d.b.y - d.a.y, d.b.x - d.a.x) * 180 / Math.PI);
        if (ang < 0) ang += 360;
        drawDim(ctx, a.x, a.y, b.x, b.y, `${fmtFeet(len * this.sketch.gridFt)}  ${ang}°`, RED, 16);
      }
    }
  },
};

/* ================================================================ export helpers */
function exportPng(project, sketch) {
  const lines = sketch.lines;
  const z = 40;
  const b = linesBounds(lines) || { x0: 0, y0: 0, x1: 16, y1: 12 };
  const pad = 2.5;
  let wU = b.x1 - b.x0 + pad * 2, hU = b.y1 - b.y0 + pad * 2 + 1.5;
  let scale = Math.min(1, 4096 / (wU * z), 4096 / (hU * z));
  const zz = z * scale;
  const W = Math.max(480, Math.round(wU * zz)), H = Math.max(360, Math.round(hU * zz));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const view = { z: zz, ox: W / 2 - cx * zz, oy: (H - 1.5 * zz) / 2 - cy * zz };
  drawScene(ctx, W, H, lines, view, { dims: Store.settings.dims, gridFt: sketch.gridFt, weightMul: 1.15 });
  ctx.fillStyle = '#6d655b';
  ctx.font = `italic 20px 'Cormorant Garamond', serif`;
  ctx.textBaseline = 'bottom';
  ctx.fillText(`Talago Arch · ${project.name} · ${sketch.name} · grid ${fmtFeet(sketch.gridFt)}`, 16, H - 12);
  return new Promise(res => c.toBlob(res, 'image/png'));
}

function sketchText(project, sketch) {
  const g = sketch.gridFt, n = v => +(v * g).toFixed(2);
  const out = [
    'Talago Arch sketch',
    `Project: ${project.name}`,
    `Sketch: ${sketch.name}`,
    `Grid spacing: ${fmtFeet(g)} between dots`,
    `Coordinates in feet, origin top-left, x to the right, y downward.`,
    `Lines (${sketch.lines.length}):`,
  ];
  sketch.lines.forEach((l, i) => {
    const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) * g;
    let ang = Math.round(-Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) * 180 / Math.PI); if (ang < 0) ang += 360;
    out.push(`${i + 1}. (${n(l.a.x)}, ${n(l.a.y)}) to (${n(l.b.x)}, ${n(l.b.y)}), length ${fmtFeet(len)}, angle ${ang}°`);
  });
  return out.join('\n');
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
  document.querySelector('meta[name=theme-color]').content = '#f6f1e5';
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

function renderToc() {
  const list = $('#project-list');
  const ps = Store.data.projects;
  if (!ps.length) {
    list.innerHTML = `<li><span class="empty">No projects yet. Add your first one below.</span></li>`;
    return;
  }
  list.innerHTML = ps.map((p, i) => `<li>
      <button type="button" class="entry" data-open="${p.id}">
        <span class="num">${String(i + 1).padStart(2, '0')}</span>
        <span class="name">${esc(p.name)}</span>
        <span class="leader"></span>
        <span class="count">${p.sketches.length} ${p.sketches.length === 1 ? 'sketch' : 'sketches'}</span>
      </button>
      <button type="button" class="more" data-more="${p.id}" aria-label="Options for ${esc(p.name)}">⋯</button>
    </li>`).join('');
}
$('#project-list').addEventListener('click', async e => {
  const o = e.target.closest('[data-open]');
  if (o) return go(`#/p/${o.dataset.open}`);
  const m = e.target.closest('[data-more]');
  if (m) projectMenu(Store.project(m.dataset.more));
});
$('#add-project').onclick = async () => {
  const name = await promptText('New project', '', 'Create');
  if (!name) return;
  const p = { id: uid(), name, created: now(), updated: now(), sketches: [] };
  Store.data.projects.push(p); Store.save();
  go(`#/p/${p.id}`);
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
    if (await confirmBox(`Delete “${p.name}”?`, `This removes the project and its ${p.sketches.length} sketch(es) from this device. This can't be undone.`)) {
      Store.data.projects.splice(Store.data.projects.indexOf(p), 1); Store.save();
      if (currentView !== 'toc') return go('#/');
    }
  }
  if (currentView === 'toc') renderToc(); else if (currentView === 'project') renderProject(p);
}

function renderProject(p) {
  const idx = Store.data.projects.indexOf(p);
  $('#proj-kicker').textContent = `Project ${String(idx + 1).padStart(2, '0')}`;
  $('#proj-title').textContent = p.name;
  const grid = $('#sketch-grid');
  grid.innerHTML = `<button type="button" class="card new" data-new><span class="thumb"><b>+</b>New sketch</span></button>` +
    p.sketches.map(s => `<div class="card">
        <button type="button" data-open="${s.id}" style="text-align:left"><canvas class="thumb" data-thumb="${s.id}"></canvas></button>
        <div class="meta"><span class="nm">${esc(s.name)}</span><span class="dt">${fmtDate(s.updated)}</span></div>
        <button type="button" class="more" data-more="${s.id}" aria-label="Options for ${esc(s.name)}">⋯</button>
      </div>`).join('');
  requestAnimationFrame(() => grid.querySelectorAll('[data-thumb]').forEach(c => renderThumb(c, Store.sketch(p, c.dataset.thumb))));
  grid.onclick = async e => {
    if (e.target.closest('[data-new]')) {
      const name = await promptText('New sketch', `Sketch ${p.sketches.length + 1}`, 'Create');
      if (!name) return;
      const last = p.sketches[p.sketches.length - 1];
      const s = { id: uid(), name, created: now(), updated: now(), gridFt: last ? last.gridFt : 1, lines: [] };
      p.sketches.push(s); p.updated = now(); Store.save();
      return go(`#/p/${p.id}/s/${s.id}`);
    }
    const o = e.target.closest('[data-open]');
    if (o) return go(`#/p/${p.id}/s/${o.dataset.open}`);
    const m = e.target.closest('[data-more]');
    if (m) sketchMenu(p, Store.sketch(p, m.dataset.more));
  };
}
$('#proj-back').onclick = () => go('#/');
$('#proj-menu').onclick = () => { const m = location.hash.match(/^#\/p\/([^/]+)/); m && projectMenu(Store.project(m[1])); };

async function sketchMenu(p, s) {
  const v = await actionSheet(s.name, [
    { label: 'Rename', value: 'rename' },
    { label: 'Duplicate', value: 'dup' },
    { label: 'Download PNG', value: 'png' },
    { label: 'Delete sketch', value: 'delete', danger: true },
  ]);
  if (v === 'rename') { const n = await promptText('Rename sketch', s.name); if (n) { s.name = n; s.updated = now(); } }
  else if (v === 'dup') {
    const c = JSON.parse(JSON.stringify(s)); c.id = uid(); c.name = s.name + ' copy'; c.created = c.updated = now();
    p.sketches.splice(p.sketches.indexOf(s) + 1, 0, c);
  } else if (v === 'png') {
    try { await document.fonts.ready; } catch (_) { }
    downloadBlob(await exportPng(p, s), `${fileSafe(p.name)} - ${fileSafe(s.name)}.png`);
  } else if (v === 'delete') {
    if (await confirmBox(`Delete “${s.name}”?`, "This can't be undone.")) p.sketches.splice(p.sketches.indexOf(s), 1);
  }
  Store.save(); renderProject(p);
}

/* ---------- backup / restore ---------- */
$('#export-btn').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'talago-arch', version: 1, exported: new Date().toISOString(), projects: Store.data.projects }, null, 1)], { type: 'application/json' });
  downloadBlob(blob, `talago-arch-backup-${new Date().toISOString().slice(0, 10)}.json`);
};
$('#import-input').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
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

/* ---------- full screen ---------- */
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone;
function enterFullscreen() {
  if (isStandalone() || document.fullscreenElement) return;
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (fn && navigator.userActivation && navigator.userActivation.isActive) {
    try { const r = fn.call(el, { navigationUI: 'hide' }); r && r.catch && r.catch(() => { }); } catch (_) { }
  }
}

/* ================================================================ cover */
function runCover() {
  const cover = $('#cover');
  let opened = false;
  const open = () => {
    if (opened) return; opened = true;
    cover.classList.add('opening');
    setTimeout(() => cover.classList.add('flipping'), 380);
    setTimeout(() => cover.classList.add('done'), 380 + 1150);
    setTimeout(() => cover.remove(), 380 + 1150 + 300);
  };
  cover.addEventListener('click', () => { enterFullscreen(); open(); });
  setTimeout(open, 1500);
}

/* ================================================================ install + updates */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredInstall = e; $('#install-btn').hidden = false;
});
$('#install-btn').onclick = async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  try { await deferredInstall.userChoice; } catch (_) { }
  deferredInstall = null; $('#install-btn').hidden = true;
};
if (!isStandalone() && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
  const tip = $('#install-tip');
  tip.textContent = 'Install on iPhone: tap Share, then “Add to Home Screen”.';
  tip.hidden = false;
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
      const prompt = w => toast('A new version of Talago Arch is ready.', { label: 'Update', run: () => w.postMessage('SKIP_WAITING') });
      if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w);
        });
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
    const l = Store.data.last;
    if (l && Store.project(l.p)) {
      const p = Store.project(l.p);
      history.replaceState(null, '', l.s && Store.sketch(p, l.s) ? `#/p/${l.p}/s/${l.s}` : `#/p/${l.p}`);
    } else history.replaceState(null, '', '#/');
  }
  route();
  runCover();
})();
