/* Talago Arch: project schedules (editable gantt in the sketchbook style).
 * A schedule has tasks in three phases (design, permit, construction).
 * Each task starts when everything it follows has finished (+ lag),
 * or on its own start date if it follows nothing. Milestones have no duration.
 */
'use strict';

const SCH_PHASES = [
  { key: 'design', name: 'Design', hatch: 'hd' },
  { key: 'permit', name: 'Permit', hatch: 'hx' },
  { key: 'construction', name: 'Construction', hatch: 'hc' },
];
const SCH_TRADES = ['Architect', 'Owner', 'Engineer', 'Building department', 'General contractor', 'Sitework', 'Concrete', 'Framing',
  'Roofing', 'Plumbing', 'Mechanical (HVAC)', 'Electrical', 'MEP', 'Insulation', 'Drywall', 'Windows & doors', 'Siding', 'Finish carpentry',
  'Cabinets', 'Tile', 'Flooring', 'Painting', 'Landscaping', 'Inspector'];
const SCH_ZOOMS = { day: { name: 'Day', px: 18 }, week: { name: 'Week', px: 5 }, month: { name: 'Month', px: 1.6 } };
const SCH_DAY = 86400000;
const SCH_ROW = 40, SCH_HEAD = 46, SCH_BAR = 14;

/* ---------- dates (UTC day arithmetic, no DST surprises) ---------- */
function schToday() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function schUTC(str) { const [y, m, d] = String(str).split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1); }
function schDate(sch, i) { return new Date(schUTC(sch.start) + i * SCH_DAY); }
function schFmt(sch, i, year) { return schDate(sch, i).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }); }
function schISO(sch, i) { return schDate(sch, i).toISOString().slice(0, 10); }
function schIndexOf(sch, iso) { return Math.round((schUTC(iso) - schUTC(sch.start)) / SCH_DAY); }

/* ---------- defaults ---------- */
function schDefault(name) {
  const tasks = [];
  const add = (key, nm, phase, trade, dur, after = [], ms = false) => tasks.push({ id: uid() + key, key, name: nm, phase, trade, dur: ms ? 0 : dur, ms, after, lag: 0, offset: 0 });
  add('sd', 'Schematic Design (SD)', 'design', 'Architect', 30);
  add('sdm', 'SD approval', 'design', 'Owner', 0, ['sd'], true);
  add('dd', 'Design Development (DD)', 'design', 'Architect', 45, ['sdm']);
  add('ddm', 'DD approval', 'design', 'Owner', 0, ['dd'], true);
  add('cd', 'Construction Documents (CD)', 'design', 'Architect', 60, ['ddm']);
  add('cdm', 'CDs complete', 'design', 'Architect', 0, ['cd'], true);
  add('ps', 'Permit submitted', 'permit', 'Architect', 0, ['cdm'], true);
  add('pr', 'Plan review', 'permit', 'Building department', 45, ['ps']);
  add('pi', 'Building permit issued', 'permit', 'Building department', 0, ['pr'], true);
  add('mob', 'Mobilization & site prep', 'construction', 'General contractor', 10, ['pi']);
  add('fdn', 'Foundations', 'construction', 'Concrete', 21, ['mob']);
  add('frm', 'Framing', 'construction', 'Framing', 30, ['fdn']);
  add('rf', 'Roofing', 'construction', 'Roofing', 10, ['frm']);
  add('mep', 'MEP rough-in', 'construction', 'MEP', 21, ['frm']);
  add('dw', 'Insulation & drywall', 'construction', 'Drywall', 21, ['rf', 'mep']);
  add('fin', 'Finishes', 'construction', 'Finish carpentry', 30, ['dw']);
  add('punch', 'Final inspection & punch list', 'construction', 'Inspector', 7, ['fin']);
  add('sc', 'Substantial completion', 'construction', 'General contractor', 0, ['punch'], true);
  const byKey = Object.fromEntries(tasks.map(t => [t.key, t.id]));
  for (const t of tasks) { t.after = t.after.map(k => byKey[k]); delete t.key; }
  return { id: uid(), name, created: now(), updated: now(), start: schToday(), zoom: 'week', tasks };
}

/* ---------- scheduling ---------- */
/** Compute start/end day index for every task. Edges that would form a loop are ignored. */
function schCompute(sch) {
  const byId = new Map(sch.tasks.map(t => [t.id, t]));
  const res = new Map(), visiting = new Set();
  const calc = t => {
    if (res.has(t.id)) return res.get(t.id);
    if (visiting.has(t.id)) return null;
    visiting.add(t.id);
    let s = null;
    for (const pid of t.after || []) {
      const p = byId.get(pid); if (!p) continue;
      const r = calc(p); if (!r) continue;
      s = Math.max(s == null ? -Infinity : s, r.e);
    }
    s = s == null ? (t.offset || 0) : s + (t.lag || 0);
    const r = { s, e: s + (t.ms ? 0 : Math.max(1, t.dur || 1)) };
    visiting.delete(t.id); res.set(t.id, r);
    return r;
  };
  for (const t of sch.tasks) calc(t);
  return res;
}
/** All tasks reachable by following "after" edges forward (successors) or backward (predecessors). */
function schReach(sch, id, dir) {
  const out = new Set(), stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    const next = dir === 'pred' ? (sch.tasks.find(t => t.id === cur) || {}).after || [] : sch.tasks.filter(t => (t.after || []).includes(cur)).map(t => t.id);
    for (const n of next) if (!out.has(n)) { out.add(n); stack.push(n); }
  }
  return out;
}
/** Rows: phase headers, then tasks sorted by start (auto-oriented). */
function schRows(sch, cmp) {
  const rows = [];
  for (const ph of SCH_PHASES) {
    const ts = sch.tasks.filter(t => (t.phase || 'construction') === ph.key);
    if (!ts.length) continue;
    rows.push({ type: 'phase', phase: ph });
    ts.map((t, i) => ({ t, i })).sort((a, b) => (cmp.get(a.t.id).s - cmp.get(b.t.id).s) || (cmp.get(a.t.id).e - cmp.get(b.t.id).e) || (a.i - b.i))
      .forEach(({ t }) => rows.push({ type: 'task', t, phase: ph }));
  }
  return rows;
}

/* ---------- sketch-style SVG primitives ---------- */
function skRand(seed) { let t = (seed >>> 0) || 1; return () => { t = (t + 0x6D2B79F5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
const skN = v => Math.round(v * 10) / 10;
/** Tapered hand-drafted line (heavier at the ends, slight wiggle) as an SVG path. */
function skLine(x1, y1, x2, y2, wEnd, wMid, seed) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  if (L < 0.5) return '';
  const nx = -dy / L, ny = dx / L, rnd = skRand(seed);
  const amp = Math.min(Math.max(L * 0.004, 0.25), 1.2), bow = (rnd() * 2 - 1) * amp, ph = rnd() * 6.28;
  const k = Math.min(L * 0.18, 8 + wEnd * 2);
  const half = d => (wMid + (wEnd - wMid) * Math.exp(-d / Math.max(k, 0.01))) / 2;
  const off = t => Math.pow(Math.sin(Math.PI * t), 0.7) * (bow + amp * 0.5 * Math.sin(6.28 * 1.6 * t + ph));
  const N = Math.min(Math.max(Math.ceil(L / 6), 6), 60), A = [], B = [];
  for (let i = 0; i <= N; i++) {
    const t = 0.5 - 0.5 * Math.cos(Math.PI * i / N), o = off(t), h = half(Math.min(t, 1 - t) * L);
    A.push(`${skN(x1 + dx * t + nx * (o + h))},${skN(y1 + dy * t + ny * (o + h))}`);
    B.push(`${skN(x1 + dx * t + nx * (o - h))},${skN(y1 + dy * t + ny * (o - h))}`);
  }
  const r = wEnd / 2;
  return `<path d="M${A.join('L')}L${B.reverse().join('L')}Z"/><circle cx="${skN(x1)}" cy="${skN(y1)}" r="${r}"/><circle cx="${skN(x2)}" cy="${skN(y2)}" r="${r}"/>`;
}
function skRect(x, y, w, h, wEnd, wMid, seed) {
  return skLine(x, y, x + w, y, wEnd, wMid, seed) + skLine(x + w, y, x + w, y + h, wEnd, wMid, seed + 1) +
    skLine(x + w, y + h, x, y + h, wEnd, wMid, seed + 2) + skLine(x, y + h, x, y, wEnd, wMid, seed + 3);
}

/* ---------- schedule view ---------- */
const Schedule = {
  project: null, sch: null, cmp: null, rows: [], drag: null,

  init() {
    $('#sch-back').onclick = () => { this.save(); go(`#/p/${this.project.id}`); };
    $('#sch-add').onclick = () => this.edit(null);
    $('#sch-menu').onclick = () => this.menu();
    $('#sch-zoom').addEventListener('click', e => {
      const b = e.target.closest('[data-z]'); if (!b || b.dataset.z === this.sch.zoom) return;
      // Keep the date at the centre of the view centred across zoom levels.
      const sc = $('#sch-scroll'), nameW = $('#sch-names').offsetWidth, view = sc.clientWidth - nameW;
      const centre = this.d0 + (sc.scrollLeft + view / 2) / SCH_ZOOMS[this.sch.zoom].px;
      this.sch.zoom = b.dataset.z; this.save(); this.render(false);
      sc.scrollLeft = Math.max(0, (centre - this.d0) * SCH_ZOOMS[this.sch.zoom].px - view / 2);
    });
    const body = $('#sch-body');
    body.addEventListener('click', e => {
      if (this.justDragged) { this.justDragged = false; return; }
      const r = e.target.closest('[data-task]');
      if (r) this.edit(this.sch.tasks.find(t => t.id === r.dataset.task));
    });
    body.addEventListener('pointerdown', e => this.onDown(e));
    window.addEventListener('pointermove', e => this.onMove(e));
    window.addEventListener('pointerup', e => this.onUp(e));
    window.addEventListener('pointercancel', e => this.onUp(e));
  },

  open(project, sch) {
    this.project = project; this.sch = sch;
    sch.zoom = SCH_ZOOMS[sch.zoom] ? sch.zoom : 'week';
    $('#sch-title').textContent = sch.name;
    this.render(true);
  },
  save() {
    if (!this.sch) return;
    this.sch.updated = this.project.updated = now();
    Store.save();
  },

  /* ---------- drawing ---------- */
  render(scrollToStart) {
    const sch = this.sch, cmp = this.cmp = schCompute(sch), rows = this.rows = schRows(sch, cmp);
    const px = SCH_ZOOMS[sch.zoom].px;
    let s0 = 0, e0 = 30;
    for (const r of cmp.values()) { s0 = Math.min(s0, r.s); e0 = Math.max(e0, r.e); }
    const today = schIndexOf(sch, schToday());
    const d0 = Math.min(s0, today) - (sch.zoom === 'day' ? 3 : 14), d1 = Math.max(e0, today) + (sch.zoom === 'day' ? 10 : 45);
    this.d0 = d0;
    const X = d => (d - d0) * px;
    const W = Math.ceil(X(d1)), H = rows.length * SCH_ROW + 16;
    $$('#sch-zoom [data-z]').forEach(b => b.classList.toggle('on', b.dataset.z === sch.zoom));
    const finish = Math.max(...[...cmp.values()].map(r => r.e), 0);
    $('#sch-span').textContent = sch.tasks.length ? `${schFmt(sch, Math.min(...[...cmp.values()].map(r => r.s)), true)} → ${schFmt(sch, finish, true)}` : '';

    // --- header: months and weeks
    let head = '';
    const startDate = schDate(sch, d0);
    for (let d = d0; d <= d1; d++) {
      const dt = schDate(sch, d), x = X(d);
      if (dt.getUTCDate() === 1 || d === d0) {
        const lbl = dt.toLocaleDateString(undefined, { month: 'short', ...(dt.getUTCMonth() === 0 || d === d0 ? { year: 'numeric' } : {}), timeZone: 'UTC' });
        head += `<text x="${skN(x + 4)}" y="16" class="mo">${esc(lbl)}</text>` + (d !== d0 ? `<path class="mo-tick" d="M${skN(x)} 4V${SCH_HEAD}"/>` : '');
      }
      if (sch.zoom === 'day') {
        head += `<text text-anchor="middle" x="${skN(x + px / 2)}" y="36" class="dy${dt.getUTCDay() % 6 === 0 ? ' we' : ''}">${dt.getUTCDate()}</text>`;
      } else if (dt.getUTCDay() === 1 && sch.zoom === 'week') {
        head += `<text x="${skN(x + 2)}" y="36" class="dy">${dt.getUTCDate()}</text><path class="wk-tick" d="M${skN(x)} 26V${SCH_HEAD}"/>`;
      }
    }
    void startDate;
    $('#sch-head').innerHTML = `<svg width="${W}" height="${SCH_HEAD}" style="width:${W}px;height:${SCH_HEAD}px">${head}</svg>`;
    $('#sch-head').style.width = W + 'px';

    // --- name column
    const nameRows = rows.map(r => r.type === 'phase'
      ? `<div class="sch-ph">${esc(r.phase.name)}</div>`
      : (() => {
        const c = cmp.get(r.t.id);
        const when = r.t.ms ? `◆ ${schFmt(sch, c.s)}` : `${schFmt(sch, c.s)} → ${schFmt(sch, c.e)} · ${c.e - c.s}d`;
        return `<button type="button" class="sch-name" data-task="${r.t.id}"><span class="nm">${esc(r.t.name)}</span><span class="sub">${esc(r.t.trade || '')}${r.t.trade ? ' · ' : ''}${when}</span></button>`;
      })()).join('');
    $('#sch-names').innerHTML = nameRows;

    // --- timeline
    const rowY = new Map();
    rows.forEach((r, i) => { if (r.type === 'task') rowY.set(r.t.id, i * SCH_ROW + SCH_ROW / 2); });
    let g = `<defs>
      <pattern id="hd" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><path d="M0 0V7" class="hl"/></pattern>
      <pattern id="hx" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V5M0 0H5" class="hl"/></pattern>
      <pattern id="hc" width="4.5" height="4.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V4.5" class="hl"/></pattern>
      <marker id="arw" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1L7 4L0 7" class="arw"/></marker>
    </defs>`;
    // phase bands: a dot row at each phase header
    rows.forEach((r, i) => { if (r.type === 'phase') g += `<rect x="0" y="${i * SCH_ROW + SCH_ROW / 2 - 1}" width="${W}" height="2" fill="url(#phdots)" class="phrow"/>`; });
    g = g.replace('</defs>', `<pattern id="phdots" width="${Math.max(7 * px, 14)}" height="2" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1.4" class="phdot"/></pattern></defs>`);
    // today
    if (today >= d0 && today <= d1) g += `<path class="today" d="M${skN(X(today))} 0V${H}"/><text class="today-t" x="${skN(X(today) + 4)}" y="${H - 4}">today</text>`;
    // dependency arrows (finish → start)
    let arrows = '';
    for (const r of rows) {
      if (r.type !== 'task') continue;
      const t = r.t, c = cmp.get(t.id), y2 = rowY.get(t.id), x2 = X(c.s);
      for (const pid of t.after || []) {
        const pc = cmp.get(pid), y1 = rowY.get(pid); if (!pc || y1 == null) continue;
        const x1 = X(pc.e), xm = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 10));
        arrows += `<path class="dep" d="M${skN(x1 + 2)} ${skN(y1)}H${skN(xm)}V${skN(y2)}H${skN(x2 - (t.ms ? 8 : 2))}" marker-end="url(#arw)"/>`;
      }
    }
    g += arrows;
    // bars
    rows.forEach((r, i) => {
      if (r.type !== 'task') return;
      const t = r.t, c = cmp.get(t.id), y = i * SCH_ROW + SCH_ROW / 2, seed = (parseInt(t.id.slice(-6), 36) || i) >>> 0;
      if (t.ms) {
        const x = X(c.s), s = 8;
        g += `<g class="ms" data-task="${t.id}" data-drag="${t.id}"><path class="ms-fill" d="M${x} ${y - s}L${x + s} ${y}L${x} ${y + s}L${x - s} ${y}Z"/>${skLine(x, y - s, x + s, y, 2.4, 1.1, seed)}${skLine(x + s, y, x, y + s, 2.4, 1.1, seed + 1)}${skLine(x, y + s, x - s, y, 2.4, 1.1, seed + 2)}${skLine(x - s, y, x, y - s, 2.4, 1.1, seed + 3)}</g>`;
      } else {
        const x = X(c.s), w = Math.max(2, (c.e - c.s) * px), yb = y - SCH_BAR / 2;
        g += `<g class="bar" data-task="${t.id}" data-drag="${t.id}"><rect x="${skN(x)}" y="${skN(yb)}" width="${skN(w)}" height="${SCH_BAR}" class="bar-bg"/><rect x="${skN(x)}" y="${skN(yb)}" width="${skN(w)}" height="${SCH_BAR}" fill="url(#${r.phase.hatch})"/>${skRect(x, yb, w, SCH_BAR, 2.6, 1.0, seed)}
          <rect class="grip" data-resize="${t.id}" x="${skN(x + w - 6)}" y="${skN(yb - 6)}" width="16" height="${SCH_BAR + 12}"/></g>`;
      }
    });
    $('#sch-tl').innerHTML = `<svg width="${W}" height="${H}" style="width:${W}px;height:${H}px">${g}</svg>`;
    $('#sch-tl').style.width = W + 'px';
    $('#sch-tl').style.backgroundSize = `${Math.max(sch.zoom === 'day' ? px : 7 * px, 9)}px ${SCH_ROW / 2}px`;
    $('#sch-tl').style.backgroundPositionX = `${-((d0 % 7) + 7) % 7 * px}px`;
    if (scrollToStart) {
      const first = Math.min(...[...cmp.values()].map(r => r.s), 0);
      requestAnimationFrame(() => { $('#sch-scroll').scrollLeft = Math.max(0, X(first) - 20); });
    }
  },

  /* ---------- drag: right end = duration, body = slide (lag / start) ---------- */
  onDown(e) {
    const rz = e.target.closest('[data-resize]'), dg = e.target.closest('[data-drag]');
    if (!rz && !dg) return;
    const t = this.sch.tasks.find(x => x.id === (rz ? rz.dataset.resize : dg.dataset.drag));
    if (!t) return;
    this.drag = { t, mode: rz && !t.ms ? 'resize' : 'move', x0: e.clientX, dur0: t.dur, lag0: t.lag || 0, off0: t.offset || 0, moved: false, id: e.pointerId };
    if (this.drag.mode === 'resize') e.preventDefault();
  },
  onMove(e) {
    const d = this.drag; if (!d || e.pointerId !== d.id) return;
    const px = SCH_ZOOMS[this.sch.zoom].px, step = this.sch.zoom === 'day' ? 1 : this.sch.zoom === 'week' ? 1 : 7;
    const days = Math.round((e.clientX - d.x0) / px / step) * step;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 8) return;
    if (!d.moved) { d.moved = true; $('#sch-scroll').classList.add('dragging'); }
    e.preventDefault();
    if (d.mode === 'resize') d.t.dur = Math.max(1, d.dur0 + days);
    else if ((d.t.after || []).length) d.t.lag = Math.max(0, d.lag0 + days);
    else d.t.offset = d.off0 + days;
    this.render(false);
    const c = this.cmp.get(d.t.id);
    toast(d.mode === 'resize' ? `${d.t.name}: ${c.e - c.s} days` : `${d.t.name}: starts ${schFmt(this.sch, c.s)}${d.t.lag ? ` (+${d.t.lag}d lag)` : ''}`);
  },
  onUp(e) {
    const d = this.drag; if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    $('#sch-scroll').classList.remove('dragging');
    if (d.moved) { this.justDragged = true; setTimeout(() => { this.justDragged = false; }, 50); this.save(); }
  },

  /* ---------- task editor ---------- */
  async edit(task) {
    const sch = this.sch, isNew = !task;
    const cmp = this.cmp;
    if (isNew) {
      const cons = sch.tasks.filter(t => t.phase === 'construction');
      const last = cons.slice().sort((a, b) => cmp.get(b.id).e - cmp.get(a.id).e)[0];
      task = { id: uid(), name: '', phase: 'construction', trade: '', dur: 7, ms: false, after: last ? [last.id] : [], lag: 0, offset: 0 };
    }
    const others = sch.tasks.filter(t => t.id !== task.id);
    const succ = isNew ? new Set() : schReach(sch, task.id, 'succ'), pred = isNew ? new Set() : schReach(sch, task.id, 'pred');
    const precedes = new Set(others.filter(o => (o.after || []).includes(task.id)).map(o => o.id));
    const follows = new Set(task.after || []);
    const startISO = schISO(sch, isNew ? (task.after.length ? cmp.get(task.after[0]).e : 0) : (cmp.get(task.id) || { s: task.offset || 0 }).s);
    const list = (kind, chosen, banned) => others.map(o => {
      const dis = banned.has(o.id);
      return `<label class="chk${dis ? ' dis' : ''}"><input type="checkbox" data-${kind}="${o.id}" ${chosen.has(o.id) ? 'checked' : ''} ${dis ? 'disabled' : ''}><span>${o.ms ? '◆ ' : ''}${esc(o.name)}</span></label>`;
    }).join('');
    const res = await Modal.open(`<h2>${isNew ? 'New task' : 'Edit task'}</h2>
      <form class="sch-form">
        <label class="fld">Name<input type="text" name="name" maxlength="80" value="${esc(task.name)}" placeholder="e.g. Pool, Solar, Landscaping"></label>
        <label class="fld">Trade<input type="text" name="trade" maxlength="60" list="sch-trades" value="${esc(task.trade || '')}" placeholder="Who does it"></label>
        <datalist id="sch-trades">${SCH_TRADES.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
        <div class="label">Phase</div>
        <div class="opts" data-group="phase">${SCH_PHASES.map(p => `<button type="button" data-v="${p.key}" class="${task.phase === p.key ? 'on' : ''}">${p.name}</button>`).join('')}</div>
        <div class="label">Type</div>
        <div class="opts" data-group="ms"><button type="button" data-v="0" class="${task.ms ? '' : 'on'}">Task</button><button type="button" data-v="1" class="${task.ms ? 'on' : ''}">◆ Milestone</button></div>
        <div class="row2">
          <label class="fld dur-fld"${task.ms ? ' hidden' : ''}>Duration (days)<input type="number" name="dur" min="1" max="2000" value="${task.ms ? 7 : task.dur}"></label>
          <label class="fld">Lag after what it follows (days)<input type="number" name="lag" min="0" max="2000" value="${task.lag || 0}"></label>
        </div>
        <label class="fld">Start date <small>(used when it follows nothing)</small><input type="date" name="start" value="${startISO}"></label>
        <div class="label">Follows <small>starts after these finish</small></div>
        <div class="chks">${list('f', follows, succ)}</div>
        <div class="label">Precedes <small>these start after this finishes</small></div>
        <div class="chks">${list('p', precedes, pred)}</div>
        <div class="btns sch-btns">${isNew ? '' : '<button type="button" class="btn del" data-del>Delete</button>'}<span style="flex:1"></span><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">${isNew ? 'Add' : 'Save'}</button></div>
      </form>`, (c, done) => {
      const f = $('form', c);
      const state = { phase: task.phase, ms: task.ms };
      $$('[data-group]', c).forEach(gr => gr.addEventListener('click', e => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        $$('[data-v]', gr).forEach(x => x.classList.toggle('on', x === b));
        if (gr.dataset.group === 'phase') state.phase = b.dataset.v;
        else { state.ms = b.dataset.v === '1'; $('.dur-fld', c).hidden = state.ms; }
      }));
      // keep follows/precedes from contradicting each other
      $$('[data-f]', c).forEach(cb => cb.onchange = () => { const p = $(`[data-p="${cb.dataset.f}"]`, c); if (cb.checked && p) p.checked = false; });
      $$('[data-p]', c).forEach(cb => cb.onchange = () => { const q = $(`[data-f="${cb.dataset.p}"]`, c); if (cb.checked && q) q.checked = false; });
      $('[data-x]', c).onclick = () => done(null);
      const del = $('[data-del]', c); if (del) del.onclick = () => done('delete');
      f.onsubmit = e => {
        e.preventDefault();
        const name = f.name.value.trim();
        if (!name) { f.name.focus(); return; }
        done({
          name, trade: f.trade.value.trim(), phase: state.phase, ms: state.ms,
          dur: Math.max(1, Math.round(+f.dur.value || 1)), lag: Math.max(0, Math.round(+f.lag.value || 0)),
          start: f.start.value,
          follows: $$('[data-f]:checked', c).map(x => x.dataset.f), precedes: $$('[data-p]:checked', c).map(x => x.dataset.p),
        });
      };
      if (isNew) setTimeout(() => f.name.focus(), 50);
    });
    if (!res) return;
    if (res === 'delete') {
      if (!(await confirmBox(`Delete “${task.name}”?`, 'Tasks that followed it will keep their other links.'))) return;
      sch.tasks = sch.tasks.filter(t => t.id !== task.id);
      for (const t of sch.tasks) t.after = (t.after || []).filter(id => id !== task.id);
      this.save(); this.render(false); return;
    }
    Object.assign(task, { name: res.name, trade: res.trade, phase: res.phase, ms: res.ms, dur: res.ms ? 0 : res.dur, lag: res.lag, after: res.follows });
    if (res.ms && !task.dur) task.dur = 0;
    if (res.start) task.offset = schIndexOf(sch, res.start);
    if (isNew) sch.tasks.push(task);
    for (const o of sch.tasks) {
      if (o.id === task.id) continue;
      const has = (o.after || []).includes(task.id), want = res.precedes.includes(o.id);
      if (want && !has) o.after = [...(o.after || []), task.id];
      if (!want && has) o.after = o.after.filter(id => id !== task.id);
    }
    this.save(); this.render(false);
  },

  /* ---------- menu + export ---------- */
  async menu() {
    const sch = this.sch;
    const v = await actionSheet(sch.name, [
      { label: 'Project start date', value: 'start', hint: schFmt(sch, 0, true) },
      { label: 'Copy schedule as text for ChatGPT', value: 'copy', hint: 'Tasks, trades, dates and what follows what' },
      { label: 'Export CSV', value: 'csv', hint: 'Opens in Excel or Numbers' },
      { label: 'Rename schedule', value: 'rename' },
      { label: 'Reset to the default schedule', value: 'reset', danger: true },
    ]);
    if (v === 'start') {
      const iso = await Modal.open(`<h2>Project start date</h2><p>Tasks that follow nothing start relative to this date; everything else follows along.</p>
        <form><input type="date" class="date-in" value="${sch.start}"><div class="btns" style="margin-top:16px"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Set</button></div></form>`,
        (c, done) => { $('[data-x]', c).onclick = () => done(null); $('form', c).onsubmit = e => { e.preventDefault(); done($('input', c).value || null); }; });
      if (iso) { sch.start = iso; this.save(); this.render(true); }
    } else if (v === 'copy') copyOrShow(schText(this.project, sch), 'Copied. Paste it into ChatGPT.');
    else if (v === 'csv') {
      const blob = new Blob(['﻿' + schCSV(sch)], { type: 'text/csv' });
      const name = `${fileSafe(this.project.name)} - ${fileSafe(sch.name)}.csv`;
      const file = new File([blob], name, { type: 'text/csv' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
      downloadBlob(blob, name);
    } else if (v === 'rename') {
      const n = await promptText('Rename schedule', sch.name);
      if (n) { sch.name = n; $('#sch-title').textContent = n; this.save(); }
    } else if (v === 'reset') {
      if (await confirmBox('Reset this schedule?', 'All tasks are replaced with the default design, permit and construction schedule.', 'Reset')) {
        const d = schDefault(sch.name); sch.tasks = d.tasks; this.save(); this.render(true);
      }
    }
  },
};

function schText(project, sch) {
  const cmp = schCompute(sch), rows = schRows(sch, cmp), byId = new Map(sch.tasks.map(t => [t.id, t]));
  const vals = [...cmp.values()];
  const out = ['Talago Arch schedule', `Project: ${project.name}`, `Schedule: ${sch.name}`];
  if (vals.length) out.push(`Start: ${schFmt(sch, Math.min(...vals.map(r => r.s)), true)} · Finish: ${schFmt(sch, Math.max(...vals.map(r => r.e)), true)}`);
  out.push('Durations are calendar days. ◆ = milestone. Each task starts when everything it follows has finished.');
  let n = 0;
  for (const r of rows) {
    if (r.type === 'phase') { out.push('', r.phase.name.toUpperCase()); continue; }
    const t = r.t, c = cmp.get(t.id);
    const when = t.ms ? `◆ ${schFmt(sch, c.s, true)}` : `${schFmt(sch, c.s, true)} → ${schFmt(sch, c.e, true)} (${c.e - c.s} days)`;
    const f = (t.after || []).map(id => byId.get(id)).filter(Boolean).map(x => x.name);
    out.push(`${++n}. ${t.name}${t.trade ? ` [${t.trade}]` : ''}: ${when}${f.length ? `; follows ${f.join(', ')}` : ''}${t.lag ? ` (+${t.lag} days lag)` : ''}`);
  }
  return out.join('\n');
}
function schCSV(sch) {
  const cmp = schCompute(sch), rows = schRows(sch, cmp), byId = new Map(sch.tasks.map(t => [t.id, t]));
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const out = [['Phase', 'Task', 'Trade', 'Type', 'Start', 'End', 'Duration (days)', 'Follows', 'Lag (days)'].map(q).join(',')];
  for (const r of rows) {
    if (r.type !== 'task') continue;
    const t = r.t, c = cmp.get(t.id);
    out.push([r.phase.name, t.name, t.trade || '', t.ms ? 'Milestone' : 'Task', schISO(sch, c.s), schISO(sch, c.e), c.e - c.s,
      (t.after || []).map(id => (byId.get(id) || {}).name).filter(Boolean).join('; '), t.lag || 0].map(q).join(','));
  }
  return out.join('\r\n');
}
/** Tiny gantt for project-page cards. */
function schThumb(sch) {
  const cmp = schCompute(sch), rows = schRows(sch, cmp).filter(r => r.type === 'task');
  const vals = [...cmp.values()]; if (!vals.length) return '';
  const s = Math.min(...vals.map(r => r.s)), e = Math.max(...vals.map(r => r.e), s + 1);
  const W = 200, H = 150, rh = Math.min(8, (H - 12) / rows.length), sx = (W - 16) / (e - s);
  const ph = { design: 'hd', permit: 'hx', construction: 'hc' };
  return `<svg viewBox="0 0 ${W} ${H}" class="thumb sch-thumb"><defs>
    <pattern id="thd" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><path d="M0 0V4" class="hl"/></pattern>
    <pattern id="thx" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V3M0 0H3" class="hl"/></pattern>
    <pattern id="thc" width="2.6" height="2.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V2.6" class="hl"/></pattern></defs>
    ${rows.map((r, i) => { const c = cmp.get(r.t.id), x = 8 + (c.s - s) * sx, y = 6 + i * rh;
      return r.t.ms ? `<path d="M${x} ${y}l${rh / 2} ${rh / 2}l${-rh / 2} ${rh / 2}l${-rh / 2} ${-rh / 2}z" class="tms"/>`
        : `<rect x="${x}" y="${y + 1}" width="${Math.max(1.5, (c.e - c.s) * sx)}" height="${Math.max(2, rh - 2)}" fill="url(#t${ph[r.t.phase] || 'hc'})" class="tbar"/>`; }).join('')}</svg>`;
}

Schedule.init();
