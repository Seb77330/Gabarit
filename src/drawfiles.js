// Lecture d'un dessin 2D (SVG ou DXF) : il devient une liste de contours en millimètres, prêts pour une esquisse.
// Résultat : { loops: [{ pts: [[x, y, flèche?]…], closed }], circles: [{ cx, cy, d }], bb: [x0, y0, x1, y1], skipped }.
const MAX_POINTS = 2000;

// ---------- matrices 2D [a, b, c, d, e, f] : x' = a·x + c·y + e ; y' = b·x + d·y + f ----------
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const app = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
function parseTransform(str) {
  let m = [1, 0, 0, 1, 0, 0];
  for (const t of String(str || "").matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const v = t[2].trim().split(/[\s,]+/).map(Number); let n = null;
    if (t[1] === "matrix" && v.length >= 6) n = v.slice(0, 6);
    else if (t[1] === "translate") n = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
    else if (t[1] === "scale") n = [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0];
    else if (t[1] === "rotate") {
      const a = v[0] * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); n = [c, s, -s, c, 0, 0];
      if (v.length >= 3) n = mul(mul([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]]);
    } else if (t[1] === "skewX") n = [1, 0, Math.tan(v[0] * Math.PI / 180), 1, 0, 0];
    else if (t[1] === "skewY") n = [1, Math.tan(v[0] * Math.PI / 180), 0, 1, 0, 0];
    if (n && n.every(isFinite)) m = mul(m, n);
  }
  return m;
}

// ---------- courbes -> suites de points ----------
function cubicPts(p0, p1, p2, p3, tol, out) {
  const dd = Math.max(Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]), Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]));
  const n = Math.min(80, Math.max(1, Math.ceil(Math.sqrt(0.75 * dd / tol))));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
}
// arc d'ellipse du SVG (extrémités, rayons, rotation, deux drapeaux)
function svgArcPts(p0, rx, ry, phiDeg, large, sweep, p1, tol, out) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry || (p0[0] === p1[0] && p0[1] === p1[1])) { out.push(p1); return; }
  const phi = phiDeg * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = co * rx * y1 / ry, cy1 = -co * ry * x1 / rx;
  const cx = cp * cx1 - sp * cy1 + (p0[0] + p1[0]) / 2, cy = sp * cx1 + cp * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t0 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry); let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const r = Math.max(rx, ry); const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r))) || 0.3;
  const n = Math.min(120, Math.max(2, Math.ceil(Math.abs(dt) / step)));
  for (let i = 1; i < n; i++) { const t = t0 + dt * i / n; out.push([cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp]); }
  out.push(p1);
}
// attribut « d » d'un chemin SVG -> sous-chemins [{ pts, closed }]
function pathSubs(d, tol) {
  const subs = []; let cur = null; let i = 0; const n = d.length;
  let x = 0, y = 0, sx = 0, sy = 0, cmd = "", c2 = null, q1 = null;
  const ws = () => { while (i < n && (d.charCodeAt(i) <= 32 || d[i] === ",")) i++; };
  const num = () => { ws(); const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(d.slice(i, i + 48)); if (!m) { i = n; return NaN; } i += m[0].length; return Number(m[0]); };
  const flag = () => { ws(); const c = d[i]; i++; return c === "1" ? 1 : 0; };
  const start = (px, py) => { cur = { pts: [[px, py]], closed: false }; subs.push(cur); sx = px; sy = py; };
  const to = (px, py) => { if (!cur) start(x, y); cur.pts.push([px, py]); };
  while (i < n) {
    ws(); if (i >= n) break;
    if (/[a-zA-Z]/.test(d[i])) { cmd = d[i]; i++; } else if (cmd === "M") cmd = "L"; else if (cmd === "m") cmd = "l"; else if (!cmd || /[zZ]/.test(cmd)) break;
    const rel = cmd === cmd.toLowerCase(); const C = cmd.toUpperCase(); const ox = rel ? x : 0, oy = rel ? y : 0;
    let keepC = false, keepQ = false;
    if (C === "Z") { if (cur) cur.closed = true; x = sx; y = sy; cur = null; }
    else if (C === "M") { x = ox + num(); y = oy + num(); if (!isFinite(x + y)) break; start(x, y); }
    else if (C === "L") { x = ox + num(); y = oy + num(); if (!isFinite(x + y)) break; to(x, y); }
    else if (C === "H") { x = ox + num(); if (!isFinite(x)) break; to(x, y); }
    else if (C === "V") { y = oy + num(); if (!isFinite(y)) break; to(x, y); }
    else if (C === "C" || C === "S") {
      let a; if (C === "C") a = [ox + num(), oy + num()]; else a = c2 ? [2 * x - c2[0], 2 * y - c2[1]] : [x, y];
      const b = [ox + num(), oy + num()], e = [ox + num(), oy + num()]; if (!isFinite(e[0] + e[1] + b[0] + b[1] + a[0] + a[1])) break;
      if (!cur) start(x, y); cubicPts([x, y], a, b, e, tol, cur.pts); c2 = b; keepC = true; x = e[0]; y = e[1];
    } else if (C === "Q" || C === "T") {
      let a; if (C === "Q") a = [ox + num(), oy + num()]; else a = q1 ? [2 * x - q1[0], 2 * y - q1[1]] : [x, y];
      const e = [ox + num(), oy + num()]; if (!isFinite(e[0] + e[1] + a[0] + a[1])) break;
      if (!cur) start(x, y);
      cubicPts([x, y], [x + 2 / 3 * (a[0] - x), y + 2 / 3 * (a[1] - y)], [e[0] + 2 / 3 * (a[0] - e[0]), e[1] + 2 / 3 * (a[1] - e[1])], e, tol, cur.pts);
      q1 = a; keepQ = true; x = e[0]; y = e[1];
    } else if (C === "A") {
      const rx = num(), ry = num(), phi = num(), large = flag(), sweep = flag(), e = [ox + num(), oy + num()]; if (!isFinite(rx + ry + phi + e[0] + e[1])) break;
      if (!cur) start(x, y); svgArcPts([x, y], rx, ry, phi, large, sweep, e, tol, cur.pts); x = e[0]; y = e[1];
    } else break;
    if (!keepC) c2 = null; if (!keepQ) q1 = null;
  }
  return subs;
}

function parseSVG(text) {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.localName !== "svg" || doc.getElementsByTagName("parsererror").length) throw new Error("Ce fichier SVG est illisible");
  const len = (v) => { const m = /^\s*([+-]?[\d.]+(?:[eE][+-]?\d+)?)\s*(mm|cm|in|pt|pc|px)?\s*$/.exec(v || ""); return m ? Number(m[1]) * { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, "": 25.4 / 96 }[m[2] || ""] : null; };
  const vb = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  const wmm = len(svg.getAttribute("width")), hmm = len(svg.getAttribute("height"));
  let k = 25.4 / 96, ref = 100; // millimètres par unité du dessin ; taille de référence pour la finesse des courbes
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) { ref = Math.max(vb[2], vb[3]); if (wmm) k = wmm / vb[2]; else if (hmm) k = hmm / vb[3]; }
  else if (wmm && hmm) ref = Math.max(wmm, hmm) / k;
  const tol = ref / 4000;
  const out = { loops: [], circles: [], skipped: 0 };
  const SKIP = new Set(["defs", "clipPath", "mask", "symbol", "pattern", "marker", "metadata", "title", "desc", "style", "script", "filter", "linearGradient", "radialGradient", "text", "image", "foreignObject"]);
  const styleOf = (el, name) => { const s = el.getAttribute("style"); const m = s && new RegExp("(?:^|;)\\s*" + name + "\\s*:\\s*([^;]+)").exec(s); return (m ? m[1] : el.getAttribute(name) || "").trim(); };
  const numAttr = (el, name) => { const v = parseFloat(el.getAttribute(name)); return isFinite(v) ? v : 0; };
  const add = (m, pts, closed) => { if (pts.length >= 2) out.loops.push({ pts: pts.map((p) => { const q = app(m, p); return [q[0] * k, -q[1] * k]; }), closed }); };
  const walk = (el, m, filled, depth) => {
    if (depth > 40 || el.nodeType !== 1) return;
    const tag = el.localName; if (SKIP.has(tag)) { if (tag === "text" || tag === "image") out.skipped++; return; }
    if (styleOf(el, "display") === "none" || styleOf(el, "visibility") === "hidden") return;
    m = mul(m, parseTransform(el.getAttribute("transform")));
    const fill = styleOf(el, "fill"); if (fill) filled = fill !== "none";
    if (tag === "g" || tag === "svg" || tag === "a" || tag === "switch") { for (const c of el.children) walk(c, m, filled, depth + 1); return; }
    if (tag === "use") {
      const ref = (el.getAttribute("href") || el.getAttribute("xlink:href") || "").replace(/^#/, ""); const target = ref && doc.getElementById(ref);
      if (target) walk(target, mul(m, [1, 0, 0, 1, numAttr(el, "x"), numAttr(el, "y")]), filled, depth + 1); return;
    }
    if (tag === "path") { for (const s of pathSubs(el.getAttribute("d") || "", tol)) add(m, s.pts, s.closed || filled); return; }
    if (tag === "rect") {
      const x = numAttr(el, "x"), y = numAttr(el, "y"), w = numAttr(el, "width"), h = numAttr(el, "height"); if (!(w > 0 && h > 0)) return;
      let rx = el.hasAttribute("rx") ? numAttr(el, "rx") : el.hasAttribute("ry") ? numAttr(el, "ry") : 0, ry = el.hasAttribute("ry") ? numAttr(el, "ry") : rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (!(rx > 0 && ry > 0)) { add(m, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true); return; }
      const d = `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
      for (const s of pathSubs(d, tol)) add(m, s.pts, true); return;
    }
    if (tag === "circle" || tag === "ellipse") {
      const cx = numAttr(el, "cx"), cy = numAttr(el, "cy"), rx = tag === "circle" ? numAttr(el, "r") : numAttr(el, "rx"), ry = tag === "circle" ? rx : numAttr(el, "ry"); if (!(rx > 0 && ry > 0)) return;
      const sim = Math.abs(Math.hypot(m[0], m[1]) - Math.hypot(m[2], m[3])) < 1e-9 * (1 + Math.hypot(m[0], m[1])) && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-9; // même échelle partout
      if (tag === "circle" && sim) { const c = app(m, [cx, cy]); out.circles.push({ cx: c[0] * k, cy: -c[1] * k, d: 2 * rx * Math.hypot(m[0], m[1]) * k }); return; }
      const pts = []; for (let i = 0; i < 72; i++) { const t = i / 72 * 2 * Math.PI; pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
      add(m, pts, true); return;
    }
    if (tag === "line") { add(m, [[numAttr(el, "x1"), numAttr(el, "y1")], [numAttr(el, "x2"), numAttr(el, "y2")]], false); return; }
    if (tag === "polyline" || tag === "polygon") {
      const v = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number).filter(isFinite); const pts = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
      add(m, pts, tag === "polygon" || filled);
    }
  };
  walk(svg, [1, 0, 0, 1, 0, 0], true, 0);
  return out;
}

// ---------- DXF ----------
// flèche Gabarit (positive = bombé à gauche du sens de parcours) à partir du renflement DXF (positif = sens trigo)
const sagitta = (a, b, bulge) => -bulge * Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
function bspline(deg, knots, cps, n) {
  const pts = []; const m = cps.length; if (knots.length < m + deg + 1) return cps.map((p) => p.slice());
  const t0 = knots[deg], t1 = knots[m];
  for (let s = 0; s <= n; s++) {
    let t = t0 + (t1 - t0) * s / n; if (s === n) t = t1 - 1e-9 * (t1 - t0);
    let k = deg; while (k < m - 1 && t >= knots[k + 1]) k++;
    const d = []; for (let j = 0; j <= deg; j++) d.push(cps[j + k - deg].slice());
    for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
      const den = knots[j + 1 + k - r] - knots[j + k - deg]; const a = den ? (t - knots[j + k - deg]) / den : 0;
      d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
    }
    pts.push(d[deg]);
  }
  return pts;
}
function parseDXF(text) {
  const lines = text.split(/\r\n|\r|\n/); const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) { const c = parseInt(lines[i], 10); if (!isFinite(c)) throw new Error("Ce fichier DXF est illisible (seul le DXF texte est accepté)"); pairs.push([c, lines[i + 1].trim()]); }
  let k = 1;
  for (let i = 0; i + 1 < pairs.length; i++) if (pairs[i][0] === 9 && pairs[i][1] === "$INSUNITS") { k = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 }[Number(pairs[i + 1][1])] || 1; break; }
  let i = pairs.findIndex((p, j) => p[0] === 2 && p[1] === "ENTITIES" && pairs[j - 1]?.[1] === "SECTION"); i = i < 0 ? 0 : i + 1;
  const ents = []; let cur = null;
  for (; i < pairs.length; i++) { const [c, v] = pairs[i]; if (c === 0) { if (v === "ENDSEC" || v === "EOF") break; cur = { type: v.toUpperCase(), g: [] }; ents.push(cur); } else if (cur) cur.g.push([c, v]); }
  const out = { loops: [], circles: [], skipped: 0 }; const chains = [];
  const get = (e, c, d = 0) => { const p = e.g.find((x) => x[0] === c); return p ? Number(p[1]) : d; };
  const arc = (cx, cy, r, a0, a1) => { // sens trigo de a0 à a1 (radians), en morceaux de moins d'un tiers de tour
    let da = a1 - a0; while (da <= 1e-12) da += 2 * Math.PI;
    const n = Math.ceil(da / (2 * Math.PI / 3) - 1e-9); const pts = [];
    for (let j = 0; j <= n; j++) { const a = a0 + da * j / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), j < n ? -r * (1 - Math.cos(da / n / 2)) : 0]); }
    return pts;
  };
  let poly = null;
  const closePoly = () => {
    if (!poly) return; const v = poly.v; poly = null; if (v.pts.length < 2) return;
    const pts = v.pts.map((p, j) => { const q = v.pts[(j + 1) % v.pts.length]; return [p[0], p[1], p[2] && (v.closed || j < v.pts.length - 1) ? sagitta(p, q, p[2]) : 0]; });
    if (v.closed) out.loops.push({ pts, closed: true }); else chains.push(pts);
  };
  for (const e of ents) {
    if (get(e, 67) === 1) continue; // espace papier
    if (e.type === "VERTEX" && poly) { poly.v.pts.push([get(e, 10), get(e, 20), get(e, 42)]); continue; }
    if (e.type === "SEQEND") { closePoly(); continue; }
    closePoly();
    if (e.type === "LINE") chains.push([[get(e, 10), get(e, 20), 0], [get(e, 11), get(e, 21), 0]]);
    else if (e.type === "CIRCLE") { const r = get(e, 40); if (r > 0) out.circles.push({ cx: get(e, 10), cy: get(e, 20), d: 2 * r }); }
    else if (e.type === "ARC") { const r = get(e, 40); if (r > 0) chains.push(arc(get(e, 10), get(e, 20), r, get(e, 50) * Math.PI / 180, get(e, 51) * Math.PI / 180)); }
    else if (e.type === "LWPOLYLINE") {
      const v = { pts: [], closed: (get(e, 70) & 1) === 1 }; let p = null;
      for (const [c, val] of e.g) { if (c === 10) { p = [Number(val), 0, 0]; v.pts.push(p); } else if (c === 20 && p) p[1] = Number(val); else if (c === 42 && p) p[2] = Number(val); }
      poly = { v }; closePoly();
    } else if (e.type === "POLYLINE") poly = { v: { pts: [], closed: (get(e, 70) & 1) === 1 } };
    else if (e.type === "ELLIPSE") {
      const cx = get(e, 10), cy = get(e, 20), mx = get(e, 11), my = get(e, 21), ratio = get(e, 40, 1), a0 = get(e, 41, 0); let a1 = get(e, 42, 2 * Math.PI);
      const R = Math.hypot(mx, my); if (!(R > 0)) continue; while (a1 <= a0 + 1e-9) a1 += 2 * Math.PI;
      const full = Math.abs(a1 - a0 - 2 * Math.PI) < 1e-6; const n = Math.max(8, Math.ceil(72 * (a1 - a0) / (2 * Math.PI))); const pts = [];
      for (let j = 0; j < (full ? n : n + 1); j++) { const t = a0 + (a1 - a0) * j / n; const u = Math.cos(t), w = Math.sin(t) * ratio; pts.push([cx + u * mx - w * my, cy + u * my + w * mx, 0]); }
      if (full) out.loops.push({ pts, closed: true }); else chains.push(pts);
    } else if (e.type === "SPLINE") {
      const cps = [], fit = [], knots = []; let p = null, q = null;
      for (const [c, val] of e.g) {
        if (c === 10) { p = [Number(val), 0]; cps.push(p); } else if (c === 20 && p) p[1] = Number(val);
        else if (c === 11) { q = [Number(val), 0]; fit.push(q); } else if (c === 21 && q) q[1] = Number(val);
        else if (c === 40) knots.push(Number(val));
      }
      const deg = get(e, 71, 3); let pts = cps.length > deg ? bspline(deg, knots, cps, Math.min(400, Math.max(16, cps.length * 8))) : fit.length >= 2 ? fit : cps;
      pts = pts.map((x) => [x[0], x[1], 0]); if (pts.length >= 2) chains.push(pts);
    } else if (["INSERT", "TEXT", "MTEXT", "HATCH", "DIMENSION", "3DFACE", "SOLID"].includes(e.type)) out.skipped++;
  }
  closePoly();
  // bout à bout : les traits et les arcs qui se touchent forment un seul contour
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of chains) for (const p of c) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const eps = Math.max(1e-9, Math.hypot(x1 - x0, y1 - y0) * 1e-5); const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps;
  const rev = (c) => { const r = c.slice().reverse().map((p) => [p[0], p[1], 0]); for (let j = 0; j < r.length - 1; j++) r[j][2] = -(c[c.length - 2 - j][2] || 0); return r; };
  const open = chains.filter((c) => c.length >= 2 && !(c.length === 2 && same(c[0], c[1]) && !c[0][2]));
  while (open.length) {
    let c = open.pop(); let grown = true;
    while (grown && !same(c[0], c[c.length - 1])) {
      grown = false;
      for (let j = 0; j < open.length; j++) {
        const o = open[j]; let add = null, front = false;
        if (same(c[c.length - 1], o[0])) add = o; else if (same(c[c.length - 1], o[o.length - 1])) add = rev(o);
        else if (same(c[0], o[o.length - 1])) { add = o; front = true; } else if (same(c[0], o[0])) { add = rev(o); front = true; }
        if (!add) continue;
        c = front ? add.slice(0, -1).concat(c) : c.slice(0, -1).concat(add); open.splice(j, 1); grown = true; break;
      }
    }
    if (c.length > 2 && same(c[0], c[c.length - 1])) out.loops.push({ pts: c.slice(0, -1), closed: true });
    else out.loops.push({ pts: c, closed: false });
  }
  for (const l of out.loops) for (const p of l.pts) { p[0] *= k; p[1] *= k; if (p[2]) p[2] *= k; }
  for (const c of out.circles) { c.cx *= k; c.cy *= k; c.d *= k; }
  return out;
}

// ---------- nettoyage commun ----------
function simplify(pts, closed, tol) { // Douglas-Peucker ; les points d'un arc (flèche) ne sont jamais retirés
  const n = pts.length; if (n < (closed ? 5 : 3) || pts.some((p) => p[2])) return pts;
  const keep = new Uint8Array(n);
  const run = (a, b) => {
    const stack = [[a, b]];
    while (stack.length) {
      const [i, j] = stack.pop(); if (j - i < 2) continue;
      const A = pts[i], B = pts[j % n]; const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1e-12; let far = -1, fd = tol;
      for (let q = i + 1; q < j; q++) { const P = pts[q]; const d = L < 1e-9 ? Math.hypot(P[0] - A[0], P[1] - A[1]) : Math.abs((P[0] - A[0]) * dy - (P[1] - A[1]) * dx) / L; if (d > fd) { fd = d; far = q; } }
      if (far > 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
    }
  };
  if (closed) { // on coupe le contour en deux au point le plus loin du premier
    let far = 0, fd = -1; for (let q = 1; q < n; q++) { const d = Math.hypot(pts[q][0] - pts[0][0], pts[q][1] - pts[0][1]); if (d > fd) { fd = d; far = q; } }
    keep[0] = keep[far] = 1; run(0, far); run(far, n);
  } else { keep[0] = keep[n - 1] = 1; run(0, n - 1); }
  const out = pts.filter((_, q) => keep[q]);
  return out.length >= (closed ? 3 : 2) ? out : pts;
}
const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };

// Lit un fichier de dessin. « name » sert à reconnaître le format.
export function readDrawing(name, text) {
  const raw = /\.dxf$/i.test(name) ? parseDXF(text) : parseSVG(text);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const l of raw.loops) l.pts.forEach((p, i) => {
    grow(p[0], p[1]);
    if (p[2]) { const q = l.pts[(i + 1) % l.pts.length]; const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1; grow((p[0] + q[0]) / 2 - dy / L * p[2], (p[1] + q[1]) / 2 + dx / L * p[2]); } // sommet de l'arc
  });
  for (const c of raw.circles) { grow(c.cx - c.d / 2, c.cy - c.d / 2); grow(c.cx + c.d / 2, c.cy + c.d / 2); }
  if (!isFinite(x0)) throw new Error("Aucun trait trouvé dans ce dessin");
  const diag = Math.hypot(x1 - x0, y1 - y0) || 1; const near = diag * 1e-6;
  // points en double retirés, puis courbes allégées jusqu'à rester sous la limite de points
  let loops = raw.loops.map((l) => {
    const pts = []; for (const p of l.pts) { const q = pts[pts.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > near || q[2]) pts.push(p); }
    if (l.closed && pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= near && !pts[pts.length - 1][2]) pts.pop();
    return { pts, closed: l.closed };
  }).filter((l) => l.pts.length >= (l.closed ? (l.pts.some((p) => p[2]) ? 2 : 3) : 2));
  let tol = diag / 4000;
  for (let pass = 0; pass < 12; pass++) {
    const simp = loops.map((l) => ({ pts: simplify(l.pts, l.closed, tol), closed: l.closed }));
    if (simp.reduce((s, l) => s + l.pts.length, 0) <= MAX_POINTS || pass === 11) { loops = simp; break; }
    tol *= 1.6;
  }
  loops = loops.filter((l) => !l.closed || l.pts.some((p) => p[2]) || Math.abs(area(l.pts)) > diag * diag * 1e-9);
  return { loops, circles: raw.circles, bb: [x0, y0, x1, y1], skipped: raw.skipped, closed: loops.filter((l) => l.closed).length + raw.circles.length, open: loops.filter((l) => !l.closed).length };
}

// Entités d'esquisse (cotes en texte, comme partout dans Gabarit), mises à la largeur voulue et centrées sur l'origine.
export function drawingEntities(dr, width) {
  const [x0, y0, x1, y1] = dr.bb; const w = x1 - x0, h = y1 - y0;
  const f = width > 0 ? width / (w > 1e-9 ? w : h || 1) : 1; const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const r3 = (v) => String(Math.round(v * 1000) / 1000 || 0);
  const ents = [];
  for (const c of dr.circles) ents.push({ type: "circle", cx: r3((c.cx - cx) * f), cy: r3((c.cy - cy) * f), d: r3(c.d * f) });
  for (const l of dr.loops) {
    const pts = l.pts.map((p) => (p[2] ? [r3((p[0] - cx) * f), r3((p[1] - cy) * f), r3(p[2] * f)] : [r3((p[0] - cx) * f), r3((p[1] - cy) * f)]));
    ents.push(l.closed ? { type: "poly", r: "0", pts } : { type: "path", pts });
  }
  return ents;
}
