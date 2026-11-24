/* Talago Arch: DXF export for Rhino (and other CAD).
 * Writes an AutoCAD R2000 (AC1015) DXF with:
 *  - straight lines as LINE curves (true 3D, z = height)
 *  - pencil strokes as cubic NURBS SPLINE curves
 *  - hatches as HATCH entities with their pattern lines (diagonal / crosshatch / layered)
 *  - Ching line weights as layers with lineweights, line types as linetypes
 * Coordinates are grid units × grid spacing, in the unit chosen at export ($INSUNITS).
 * DXF is y-up, the app is y-down, so y is negated.
 */
'use strict';

const DXF_UNITS = {
  in: { name: 'Inches', code: 1, metric: 0 },
  ft: { name: 'Feet', code: 2, metric: 0 },
  mm: { name: 'Millimetres', code: 4, metric: 1 },
  cm: { name: 'Centimetres', code: 5, metric: 1 },
  m: { name: 'Metres', code: 6, metric: 1 },
  none: { name: 'Unitless', code: 0, metric: 0 },
};
const DXF_LAYERS = [   // index matches PEN_WEIGHTS: 0 layout, 1 secondary, 2 major
  { name: 'TA Layout', lw: 13, color: 8 },
  { name: 'TA Secondary', lw: 25, color: 7 },
  { name: 'TA Major', lw: 50, color: 7 },
];
const DXF_LAYER_PENCIL = { name: 'TA Pencil', lw: 18, color: 7 };
const DXF_LAYER_HATCH = { name: 'TA Hatch', lw: 9, color: 7 };
const DXF_LAYER_ANNOT = { name: 'TA Annotation', lw: 18, color: 7 };
const DXF_INK_ACI = [7, 1, 5, 8];   // ink, red, blue, graphite
// App dash patterns are in px at BASE_Z px per grid unit.
const DXF_LTYPES = { above: { name: 'TA_DASHED', desc: 'Dashed (above cut) __ __ __' }, below: { name: 'TA_HIDDEN', desc: 'Hidden (below cut) _ _ _ _' }, center: { name: 'TA_CENTER', desc: 'Center ____ _ ____ _' } };

function buildDXF(project, sketch, opts) {
  const unit = DXF_UNITS[opts.units] || DXF_UNITS.ft;
  const g = sketch.gridFt || 1;                 // grid spacing (unitless number)
  const flat = opts.mode === 'axo';             // flat axo drawing vs 3D model
  const proj = flat ? makeProj(axoParams(sketch)) : null;
  const key = flat ? axoKey(sketch) : null;
  const num = v => { const r = Math.round(v * 1e6) / 1e6; return (Object.is(r, -0) ? 0 : r).toString(); };
  // 3D model: (x, -y, z) × g.  Flat axo: projected page point (X, -Y, 0) × g.
  const P3 = p => {
    if (flat) { const q = proj.P(p); return [q.x * g, -q.y * g, 0]; }
    return [p.x * g, -p.y * g, (p.z || 0) * g];
  };
  const Ppage = p => [p.x * g, -p.y * g, 0];    // axo-hatch page coords

  const out = [];
  const T = (code, value) => { out.push(String(code), typeof value === 'number' ? num(value) : String(value)); };
  let hcount = 0x20;
  const H = () => (hcount++).toString(16).toUpperCase();

  // ---- reserve handles for tables and records
  const hVportTab = H(), hLtypeTab = H(), hLayerTab = H(), hStyleTab = H(), hViewTab = H(), hUcsTab = H(), hAppTab = H(), hDimTab = H(), hBrTab = H();
  const hVport = H(), hLtByBlock = H(), hLtByLayer = H(), hLtCont = H(), hStyle = H(), hApp = H(), hDim = H();
  const hBrModel = H(), hBrPaper = H(), hBlkModel = H(), hEndModel = H(), hBlkPaper = H(), hEndPaper = H();
  const hDictRoot = H(), hDictGroup = H();
  const usedTypes = new Set(sketch.lines.filter(isLine).map(typeOf).filter(t => t !== 'solid'));
  const ltypeHandles = {}; for (const t of usedTypes) ltypeHandles[t] = H();
  const layers = [{ name: '0', lw: -3, color: 7 }, ...DXF_LAYERS, DXF_LAYER_PENCIL, DXF_LAYER_HATCH, DXF_LAYER_ANNOT].map(l => ({ ...l, h: H() }));

  // ---- entities (built first so $HANDSEED is right)
  const ents = [];
  const E = (code, value) => { ents.push(String(code), typeof value === 'number' ? num(value) : String(value)); };
  const head = (type, layer, extra) => {
    E(0, type); E(5, H()); E(330, hBrModel); E(100, 'AcDbEntity'); E(8, layer);
    if (extra.ltype) E(6, extra.ltype);
    if (extra.color != null) E(62, extra.color);
    if (extra.lw != null) E(370, extra.lw);
  };
  const scaleDash = px => px / BASE_Z * g;

  // Hatches first so lines draw over them.
  for (const el of sketch.lines) {
    if (!isHatch(el)) continue;
    if (el.view && el.view !== key) continue;           // axo hatches only in their own axo drawing
    const pts = el.view ? el.pts.map(Ppage) : el.pts.map(p => P3({ x: p.x, y: p.y, z: 0 }));
    if (pts.length < 3) continue;
    const pat = HATCH_PATTERNS[el.pat] || HATCH_PATTERNS.d1, val = HATCH_VALUES[el.v] || HATCH_VALUES[1];
    // Spacing in drawing units; in a flat axo, plan hatches are foreshortened, so use the projected spacing.
    const sp = val.sp * g * (flat && !el.view ? gridUnitPx(1, proj) : 1);
    let angles = pat.angles.map(a => -a);                // y-down → y-up
    if (flat && !el.view) {                              // plan hatch seen in axo: project its directions
      angles = pat.angles.map(a => { const r = a * Math.PI / 180, q0 = proj.P({ x: 0, y: 0 }), q1 = proj.P({ x: Math.cos(r), y: Math.sin(r) }); return -Math.atan2(q1.y - q0.y, q1.x - q0.x) * 180 / Math.PI; });
    }
    const name = { d1: 'TA_DIAGONAL', d2: 'TA_DIAGONAL2', x: 'TA_CROSSHATCH', xx: 'TA_LAYERED' }[el.pat] || 'TA_HATCH';
    head('HATCH', DXF_LAYER_HATCH.name, { color: DXF_INK_ACI[el.c] || 7, lw: DXF_LAYER_HATCH.lw });
    E(100, 'AcDbHatch'); E(10, 0); E(20, 0); E(30, 0); E(210, 0); E(220, 0); E(230, 1);
    E(2, name); E(70, 0); E(71, 0); E(91, 1);
    E(92, 3); E(72, 0); E(73, 1); E(93, pts.length);     // one external polyline boundary
    for (const p of pts) { E(10, p[0]); E(20, p[1]); }
    E(97, 0);
    E(75, 0); E(76, 2); E(52, 0); E(41, 1); E(77, 0); E(78, angles.length);
    for (const a of angles) {
      const r = a * Math.PI / 180;
      E(53, a); E(43, 0); E(44, 0); E(45, -Math.sin(r) * sp); E(46, Math.cos(r) * sp); E(79, 0);
    }
    E(98, 0);
  }

  for (const el of sketch.lines) {
    if (isHatch(el) || isAnnot(el)) continue;
    const color = DXF_INK_ACI[el.c] || 7;
    if (isLine(el)) {
      const L = DXF_LAYERS[el.w] || DXF_LAYERS[1], t = typeOf(el);
      head('LINE', L.name, { color, ltype: t !== 'solid' ? DXF_LTYPES[t].name : null });
      const a = P3(el.a), b = P3(el.b);
      E(100, 'AcDbLine'); E(10, a[0]); E(20, a[1]); E(30, a[2]); E(11, b[0]); E(21, b[1]); E(31, b[2]);
    } else if (isFree(el)) {
      const cps = el.pts.map(P3);
      if (cps.length < 2) continue;
      head('SPLINE', DXF_LAYER_PENCIL.name, { color });
      const n = cps.length, deg = Math.min(3, n - 1);
      const knots = [];
      for (let i = 0; i <= deg; i++) knots.push(0);
      for (let i = 1; i < n - deg; i++) knots.push(i / (n - deg));
      for (let i = 0; i <= deg; i++) knots.push(1);
      const planar = cps.every(c => Math.abs(c[2] - cps[0][2]) < 1e-9);
      E(100, 'AcDbSpline');
      if (planar) { E(210, 0); E(220, 0); E(230, 1); }
      E(70, planar ? 8 : 0); E(71, deg); E(72, knots.length); E(73, n); E(74, 0);
      E(42, 1e-10); E(43, 1e-10);
      for (const k of knots) E(40, k);
      for (const c of cps) { E(10, c[0]); E(20, c[1]); E(30, c[2]); }
    }
  }

  // ---- annotations (dimensions + notes) as lines and text
  const ann = DXF_LAYER_ANNOT.name;
  const line2 = (p, q, color) => { head('LINE', ann, { color }); E(100, 'AcDbLine'); E(10, p[0]); E(20, p[1]); E(30, p[2] || 0); E(11, q[0]); E(21, q[1]); E(31, q[2] || 0); };
  const text = (p, h, str, rot, color, center) => {
    head('TEXT', ann, { color }); E(100, 'AcDbText');
    E(10, p[0]); E(20, p[1]); E(30, p[2] || 0); E(40, h); E(1, String(str).toUpperCase()); E(50, rot || 0); E(7, 'Standard');
    if (center) { E(72, 1); E(11, p[0]); E(21, p[1]); E(31, p[2] || 0); }
    E(100, 'AcDbText');
  };
  const visible = el => flat ? el.view === key : !el.view;
  for (const el of sketch.lines) {
    if (!isAnnot(el) || !visible(el)) continue;
    const color = DXF_INK_ACI[el.c] || 7;
    if (isDim(el)) {
      const A = P3(el.a), B = P3(el.b);
      let dx = B[0] - A[0], dy = B[1] - A[1];
      const L = Math.hypot(dx, dy); if (L < 1e-9) continue;
      dx /= L; dy /= L;
      const nx = -dy, ny = dx, off = (el.off == null ? 1.25 : el.off) * g, sg = Math.sign(off) || 1;   // left normal in y-up = the side shown on screen
      const A2 = [A[0] + nx * off, A[1] + ny * off, A[2]], B2 = [B[0] + nx * off, B[1] + ny * off, B[2]];
      const gap = 0.15 * g * sg, over = 0.2 * g * sg, ext = 0.2 * g;
      line2([A[0] + nx * gap, A[1] + ny * gap, A[2]], [A2[0] + nx * over, A2[1] + ny * over, A2[2]], color);
      line2([B[0] + nx * gap, B[1] + ny * gap, B[2]], [B2[0] + nx * over, B2[1] + ny * over, B2[2]], color);
      line2([A2[0] - dx * ext, A2[1] - dy * ext, A2[2]], [B2[0] + dx * ext, B2[1] + dy * ext, B2[2]], color);
      const tx = (dx + nx) / Math.SQRT2, ty = (dy + ny) / Math.SQRT2, tl = 0.25 * g;
      for (const Q of [A2, B2]) line2([Q[0] - tx * tl, Q[1] - ty * tl, Q[2]], [Q[0] + tx * tl, Q[1] + ty * tl, Q[2]], color);
      let rot = Math.atan2(dy, dx) * 180 / Math.PI; if (rot > 90 || rot <= -90) rot += 180;
      const th = 0.45 * g, mid = [(A2[0] + B2[0]) / 2 + nx * sg * th * 0.9, (A2[1] + B2[1]) / 2 + ny * sg * th * 0.9, A2[2]];
      text(mid, th, el.label || fmtLen(len3(el.a, el.b) * g), rot, color, true);
    } else {
      const toOut = p => el.view ? Ppage(p) : P3({ x: p.x, y: p.y, z: 0 });
      const P = toOut(el.at), h = (NOTE_SIZES[el.s] || NOTE_SIZES[1]).u * g, lh = h * 1.3;
      const lines = String(el.text || '').split('\n');
      lines.forEach((l, i) => text([P[0], P[1] - h - i * lh, 0], h, l, 0, color, false));
      if (el.lead) {
        const Tg = toOut(el.lead), w = Math.max(...lines.map(l => l.length)) * h * 0.62;
        const left = Tg[0] < P[0] + w / 2, ax = left ? P[0] - h * 0.35 : P[0] + w + h * 0.35, ay = P[1] - lh * 0.5, sx = left ? ax - h * 0.8 : ax + h * 0.8;
        line2([ax, ay, 0], [sx, ay, 0], color); line2([sx, ay, 0], Tg, color);
        const vx = Tg[0] - sx, vy = Tg[1] - ay, vl = Math.hypot(vx, vy) || 1, ux = vx / vl, uy = vy / vl, al = h * 0.7;
        line2(Tg, [Tg[0] - ux * al - uy * al * 0.32, Tg[1] - uy * al + ux * al * 0.32, 0], color);
        line2(Tg, [Tg[0] - ux * al + uy * al * 0.32, Tg[1] - uy * al - ux * al * 0.32, 0], color);
      }
    }
  }

  // ---- header
  T(0, 'SECTION'); T(2, 'HEADER');
  T(9, '$ACADVER'); T(1, 'AC1015');
  T(9, '$HANDSEED'); T(5, (hcount + 1).toString(16).toUpperCase());
  T(9, '$INSUNITS'); T(70, unit.code);
  T(9, '$MEASUREMENT'); T(70, unit.metric);
  T(9, '$LUNITS'); T(70, 2);
  T(9, '$LTSCALE'); T(40, 1);
  T(9, '$CELTSCALE'); T(40, 1);
  T(9, '$LWDISPLAY'); T(290, 1);
  T(0, 'ENDSEC');
  T(0, 'SECTION'); T(2, 'CLASSES'); T(0, 'ENDSEC');

  // ---- tables
  T(0, 'SECTION'); T(2, 'TABLES');
  const table = (name, h, count, body, extra) => {
    T(0, 'TABLE'); T(2, name); T(5, h); T(330, 0); T(100, 'AcDbSymbolTable'); T(70, count);
    if (extra) extra();
    body(); T(0, 'ENDTAB');
  };
  const rec = (type, h, owner, sub, handleCode = 5) => { T(0, type); T(handleCode, h); T(330, owner); T(100, 'AcDbSymbolTableRecord'); T(100, sub); };
  table('VPORT', hVportTab, 1, () => {
    const b = bounds(sketch.lines.filter(e => !e.view)) || { x0: 0, y0: 0, x1: 20, y1: 20 };
    rec('VPORT', hVport, hVportTab, 'AcDbViewportTableRecord');
    T(2, '*ACTIVE'); T(70, 0);
    T(10, 0); T(20, 0); T(11, 1); T(21, 1);
    T(12, (b.x0 + b.x1) / 2 * g); T(22, -(b.y0 + b.y1) / 2 * g);
    T(13, 0); T(23, 0); T(14, 1); T(24, 1); T(15, 1); T(25, 1); T(16, 0); T(26, 0); T(36, 1); T(17, 0); T(27, 0); T(37, 0);
    T(40, Math.max(b.y1 - b.y0, b.x1 - b.x0, 1) * g * 1.4); T(41, 1.5); T(42, 50); T(43, 0); T(44, 0); T(50, 0); T(51, 0);
    T(71, 0); T(72, 100); T(73, 1); T(74, 3); T(75, 0); T(76, 0); T(77, 0); T(78, 0);
  });
  table('LTYPE', hLtypeTab, 3 + usedTypes.size, () => {
    const lt = (h, name, desc, elems) => {
      rec('LTYPE', h, hLtypeTab, 'AcDbLinetypeTableRecord');
      T(2, name); T(70, 0); T(3, desc); T(72, 65); T(73, elems.length);
      T(40, elems.reduce((s, v) => s + Math.abs(v), 0));
      for (const v of elems) { T(49, v); T(74, 0); }
    };
    lt(hLtByBlock, 'ByBlock', '', []);
    lt(hLtByLayer, 'ByLayer', '', []);
    lt(hLtCont, 'Continuous', 'Solid line', []);
    for (const t of usedTypes) {
      const d = LINE_TYPES[t].dash.map((v, i) => (i % 2 ? -1 : 1) * scaleDash(v));
      lt(ltypeHandles[t], DXF_LTYPES[t].name, DXF_LTYPES[t].desc, d);
    }
  });
  table('LAYER', hLayerTab, layers.length, () => {
    for (const l of layers) {
      rec('LAYER', l.h, hLayerTab, 'AcDbLayerTableRecord');
      T(2, l.name); T(70, 0); T(62, l.color); T(6, 'Continuous'); T(370, l.lw);
    }
  });
  table('STYLE', hStyleTab, 1, () => {
    rec('STYLE', hStyle, hStyleTab, 'AcDbTextStyleTableRecord');
    T(2, 'Standard'); T(70, 0); T(40, 0); T(41, 1); T(50, 0); T(71, 0); T(42, 2.5); T(3, 'txt'); T(4, '');
  });
  table('VIEW', hViewTab, 0, () => { });
  table('UCS', hUcsTab, 0, () => { });
  table('APPID', hAppTab, 1, () => {
    rec('APPID', hApp, hAppTab, 'AcDbRegAppTableRecord');
    T(2, 'ACAD'); T(70, 0);
  });
  table('DIMSTYLE', hDimTab, 1, () => {
    rec('DIMSTYLE', hDim, hDimTab, 'AcDbDimStyleTableRecord', 105);
    T(2, 'Standard'); T(70, 0);
  }, () => { T(100, 'AcDbDimStyleTable'); T(71, 0); });
  table('BLOCK_RECORD', hBrTab, 2, () => {
    rec('BLOCK_RECORD', hBrModel, hBrTab, 'AcDbBlockTableRecord'); T(2, '*Model_Space');
    rec('BLOCK_RECORD', hBrPaper, hBrTab, 'AcDbBlockTableRecord'); T(2, '*Paper_Space');
  });
  T(0, 'ENDSEC');

  // ---- blocks
  T(0, 'SECTION'); T(2, 'BLOCKS');
  const block = (name, hb, he, br, paper) => {
    T(0, 'BLOCK'); T(5, hb); T(330, br); T(100, 'AcDbEntity'); if (paper) T(67, 1); T(8, '0'); T(100, 'AcDbBlockBegin');
    T(2, name); T(70, 0); T(10, 0); T(20, 0); T(30, 0); T(3, name); T(1, '');
    T(0, 'ENDBLK'); T(5, he); T(330, br); T(100, 'AcDbEntity'); if (paper) T(67, 1); T(8, '0'); T(100, 'AcDbBlockEnd');
  };
  block('*Model_Space', hBlkModel, hEndModel, hBrModel, false);
  block('*Paper_Space', hBlkPaper, hEndPaper, hBrPaper, true);
  T(0, 'ENDSEC');

  // ---- entities
  T(0, 'SECTION'); T(2, 'ENTITIES');
  out.push(...ents);
  T(0, 'ENDSEC');

  // ---- objects
  T(0, 'SECTION'); T(2, 'OBJECTS');
  T(0, 'DICTIONARY'); T(5, hDictRoot); T(330, 0); T(100, 'AcDbDictionary'); T(281, 1); T(3, 'ACAD_GROUP'); T(350, hDictGroup);
  T(0, 'DICTIONARY'); T(5, hDictGroup); T(330, hDictRoot); T(100, 'AcDbDictionary'); T(281, 1);
  T(0, 'ENDSEC');
  T(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

/** Export dialog: units + what to export, then share/download the .dxf. */
async function exportForRhino(project, sketch) {
  const s = Store.settings;
  const hasAxo = sketch.mode === 'axo' || sketch.lines.some(el => (isHatch(el) || isAnnot(el)) && el.view);
  let units = s.dxfUnits || 'ft', mode = (Editor.sketch === sketch && Editor.isAxo) ? 'axo' : 'model';
  const ok = await Modal.open(`<h2>Export for Rhino</h2>
    <p>Saves a DXF file. Lines become curves, pencil strokes become smooth curves, hatches stay hatches, and Ching's weights and line types become layers and linetypes.</p>
    <div class="label">1 grid unit =</div>
    <div class="opts" id="dxf-units">${Object.entries(DXF_UNITS).map(([k, u]) => `<button type="button" data-u="${k}" class="${k === units ? 'on' : ''}">${u.name}</button>`).join('')}</div>
    ${hasAxo ? `<div class="label">Export</div>
    <div class="sheet-list pick" id="dxf-mode">
      <button type="button" data-m="model" class="${mode === 'model' ? 'on' : ''}"><span>3D model<small>True geometry with heights; plan hatches on the ground</small></span></button>
      <button type="button" data-m="axo" class="${mode === 'axo' ? 'on' : ''}"><span>Axo drawing<small>Flat drawing of the axo as shown, with face hatching</small></span></button>
    </div>` : ''}
    <div class="btns" style="margin-top:20px"><button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" data-ok>Export</button></div>`,
    (c, done) => {
      $$('[data-u]', c).forEach(b => b.onclick = () => { units = b.dataset.u; $$('[data-u]', c).forEach(x => x.classList.toggle('on', x === b)); });
      $$('[data-m]', c).forEach(b => b.onclick = () => { mode = b.dataset.m; $$('[data-m]', c).forEach(x => x.classList.toggle('on', x === b)); });
      $('[data-x]', c).onclick = () => done(false);
      $('[data-ok]', c).onclick = () => done(true);
    });
  if (!ok) return;
  s.dxfUnits = units; Store.save();
  let text;
  try { text = buildDXF(project, sketch, { units, mode: hasAxo ? mode : 'model' }); }
  catch (e) { return toast('Could not create the DXF file.'); }
  const name = `${fileSafe(project.name)} - ${fileSafe(sketch.name)}${mode === 'axo' && hasAxo ? ' (axo)' : ''}.dxf`;
  const blob = new Blob([text], { type: 'application/dxf' });
  const file = new File([blob], name, { type: 'application/dxf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  downloadBlob(blob, name);
  toast('DXF saved. Open it in Rhino with File → Open or Import.');
}
