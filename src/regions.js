// Zones d'une esquisse. Les traits (droites et arcs exacts) sont coupés là où ils se croisent
// ou se touchent, puis on cherche les zones fermées du dessin obtenu. Sert à extruder une zone
// fermée par plusieurs traits, à colorer les zones dans l'esquisse, et aux outils Ajuster et Congé.
import { outline, isOpen, inPoly, roundCorners } from "./geo.js";

// Deux points plus proches que ça (en mm) sont le même sommet. Un micron : l'esquisse arrondit ses points
// au millième de millimètre, un bout de trait accroché sur un cercle doit donc compter comme posé dessus.
export const TOL = 1e-3;
const TAU = Math.PI * 2;
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// ---- Primitives : droite { t: "L", a, b } ou arc { t: "A", c, r, a0, sw, a, b } (sw = angle parcouru, signé) ----
const line = (a, b) => ({ t: "L", a: [a[0], a[1]], b: [b[0], b[1]] });
export const primPt = (p, u) => {
  if (p.t === "L") return [p.a[0] + (p.b[0] - p.a[0]) * u, p.a[1] + (p.b[1] - p.a[1]) * u];
  const g = p.a0 + p.sw * u; return [p.c[0] + p.r * Math.cos(g), p.c[1] + p.r * Math.sin(g)];
};
function arc(c, r, a0, sw) { const p = { t: "A", c: [c[0], c[1]], r, a0, sw }; p.a = primPt(p, 0); p.b = primPt(p, 1); return p; }
// Arc de a vers b défini par sa flèche s (positive : bombé à gauche du trajet). Sans flèche : une droite.
export function sagArc(a, b, s) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (len < 1e-12 || !s) return line(a, b);
  const h = len / 2, R = (h * h + s * s) / (2 * Math.abs(s)), sg = s > 0 ? 1 : -1, k = s - sg * R;
  const c = [(a[0] + b[0]) / 2 - dy / len * k, (a[1] + b[1]) / 2 + dx / len * k];
  const th = 2 * Math.acos(Math.max(-1, Math.min(1, (R - Math.abs(s)) / R)));
  return { t: "A", c, r: R, a0: Math.atan2(a[1] - c[1], a[0] - c[0]), sw: -sg * th, a: [a[0], a[1]], b: [b[0], b[1]] };
}
// Flèche (signée) de l'arc p, pour l'écrire comme côté courbe d'un contour.
export const sagOf = (p) => (p.t === "L" ? 0 : -Math.sign(p.sw) * p.r * (1 - Math.cos(Math.abs(p.sw) / 2)));
const rotAt = (p, deg, c) => { const r = deg * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r); return [c[0] + p[0] * cs - p[1] * sn, c[1] + p[0] * sn + p[1] * cs]; };

// Primitives d'une entité évaluée, dans l'ordre du tracé. approx : la forme est remplacée par de petits segments.
export function prims(o) {
  const chain = (pts, closed) => { const out = []; for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if (dist(a, b) > 1e-9) out.push(line(a, b)); } return out; };
  if (o.type === "circle") { const c = [o.cx, o.cy], r = o.d / 2; return r > 0 ? [arc(c, r, 0, Math.PI), arc(c, r, Math.PI, Math.PI)] : []; }
  if (o.type === "rect") {
    const hw = o.w / 2, hh = o.h / 2, r = Math.max(0, Math.min(o.r || 0, hw, hh)), c = [o.cx, o.cy], T = (p) => rotAt(p, o.a || 0, c);
    if (!(hw > 0 && hh > 0)) return [];
    if (!(r > 0)) return chain([[hw, hh], [-hw, hh], [-hw, -hh], [hw, -hh]].map(T), true);
    const ar = (o.a || 0) * Math.PI / 180, cs = [[hw - r, hh - r, 0], [-hw + r, hh - r, Math.PI / 2], [-hw + r, -hh + r, Math.PI], [hw - r, -hh + r, 1.5 * Math.PI]];
    const out = [];
    for (let i = 0; i < 4; i++) {
      const [x, y, a0] = cs[i]; const q = arc(T([x, y]), r, a0 + ar, Math.PI / 2); out.push(q);
      const [x2, y2, a2] = cs[(i + 1) % 4]; const nx = T([x2 + r * Math.cos(a2), y2 + r * Math.sin(a2)]);
      if (dist(q.b, nx) > 1e-9) out.push(line(q.b, nx));
    }
    return out;
  }
  if (o.type === "polygon") return chain(outline(o), true);
  if (o.type === "slot") {
    const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1), r = o.w / 2; if (!(r > 0)) return [];
    const a1 = arc([o.x2, o.y2], r, ang - Math.PI / 2, Math.PI), a2 = arc([o.x1, o.y1], r, ang + Math.PI / 2, Math.PI);
    return [a1, line(a1.b, a2.a), a2, line(a2.b, a1.a)];
  }
  if (o.type === "poly" || o.type === "path") {
    const closed = o.type === "poly", P = roundCorners(o.pts, closed, closed ? o.r || 0 : 0);
    const out = [];
    for (let i = 0; i < P.length - (closed ? 0 : 1); i++) { const a = P[i], b = P[(i + 1) % P.length]; if (dist(a, b) > 1e-9) out.push(sagArc(a, b, a[2] || 0)); }
    return out;
  }
  if (o.type === "ellipse") { const pts = []; for (let i = 0; i < 96; i++) { const t = i / 96 * TAU; pts.push(rotAt([o.rx * Math.cos(t), o.ry * Math.sin(t)], o.a || 0, [o.cx, o.cy])); } const out = chain(pts, true); out.approx = true; return out; }
  if (o.type === "spline") { const out = chain(outline(o), !!o.closed); out.approx = true; return out; }
  return [];
}

// Paramètre (0 à 1) du point x sur la primitive, ou null s'il n'est pas dessus.
export function paramOn(p, x, tol = TOL) {
  if (p.t === "L") {
    const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], l2 = dx * dx + dy * dy; if (l2 < 1e-24) return null;
    const u = ((x[0] - p.a[0]) * dx + (x[1] - p.a[1]) * dy) / l2, len = Math.sqrt(l2);
    if (Math.hypot(p.a[0] + u * dx - x[0], p.a[1] + u * dy - x[1]) > tol) return null;
    if (u < -tol / len || u > 1 + tol / len) return null;
    return Math.max(0, Math.min(1, u));
  }
  if (Math.abs(dist(x, p.c) - p.r) > tol) return null;
  let g = Math.atan2(x[1] - p.c[1], x[0] - p.c[0]) - p.a0;
  g = p.sw > 0 ? ((g % TAU) + TAU) % TAU : -(((-g % TAU) + TAU) % TAU);
  const u = g / p.sw, tu = tol / (p.r * Math.abs(p.sw));
  if (u > 1 + tu) return u >= TAU / Math.abs(p.sw) - tu ? 0 : null;
  return Math.max(0, Math.min(1, u));
}
// Points où se coupent les deux primitives prolongées (droites et cercles entiers).
function crossPts(p, q) {
  if (p.t === "L" && q.t === "L") {
    const r = [p.b[0] - p.a[0], p.b[1] - p.a[1]], s = [q.b[0] - q.a[0], q.b[1] - q.a[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-10 * Math.hypot(...r) * Math.hypot(...s)) return []; // parallèles : les bouts communs sont traités à part
    const w = [q.a[0] - p.a[0], q.a[1] - p.a[1]], t = (w[0] * s[1] - w[1] * s[0]) / den;
    return [[p.a[0] + t * r[0], p.a[1] + t * r[1]]];
  }
  if (p.t === "L" || q.t === "L") {
    const l = p.t === "L" ? p : q, a = p.t === "L" ? q : p;
    const dx = l.b[0] - l.a[0], dy = l.b[1] - l.a[1], len = Math.hypot(dx, dy); if (len < 1e-12) return [];
    const ux = dx / len, uy = dy / len, fx = a.c[0] - l.a[0], fy = a.c[1] - l.a[1];
    const along = fx * ux + fy * uy, foot = [l.a[0] + along * ux, l.a[1] + along * uy], d = dist(foot, a.c);
    if (d > a.r + TOL) return [];
    if (d >= a.r - TOL) return [d > 1e-12 ? [a.c[0] + (foot[0] - a.c[0]) * a.r / d, a.c[1] + (foot[1] - a.c[1]) * a.r / d] : foot]; // tangente
    const h = Math.sqrt(a.r * a.r - d * d);
    return [[foot[0] + ux * h, foot[1] + uy * h], [foot[0] - ux * h, foot[1] - uy * h]];
  }
  const d = dist(p.c, q.c); if (d < 1e-12) return []; // même centre : arcs confondus ou séparés
  if (d > p.r + q.r + TOL || d < Math.abs(p.r - q.r) - TOL) return [];
  const ex = (q.c[0] - p.c[0]) / d, ey = (q.c[1] - p.c[1]) / d;
  if (d >= p.r + q.r - TOL) return [[p.c[0] + ex * p.r, p.c[1] + ey * p.r]];
  if (d <= Math.abs(p.r - q.r) + TOL) { const sg = p.r > q.r ? 1 : -1; return [[p.c[0] + ex * p.r * sg, p.c[1] + ey * p.r * sg]]; }
  const a = (d * d + p.r * p.r - q.r * q.r) / (2 * d), h = Math.sqrt(Math.max(0, p.r * p.r - a * a));
  return [[p.c[0] + ex * a - ey * h, p.c[1] + ey * a + ex * h], [p.c[0] + ex * a + ey * h, p.c[1] + ey * a - ex * h]];
}
function bbox(p) {
  if (p.t === "L") return [Math.min(p.a[0], p.b[0]) - TOL, Math.min(p.a[1], p.b[1]) - TOL, Math.max(p.a[0], p.b[0]) + TOL, Math.max(p.a[1], p.b[1]) + TOL];
  return [p.c[0] - p.r - TOL, p.c[1] - p.r - TOL, p.c[0] + p.r + TOL, p.c[1] + p.r + TOL];
}

// Coupe toutes les primitives des entités à leurs croisements. Rend les sommets V et les morceaux E.
export function splitAll(ents) {
  const P = [];
  ents.forEach((o, src) => { let list = []; try { list = prims(o); } catch { /* entité invalide */ } list.forEach((p, k) => { p.src = src; p.k = k; p.approx = !!list.approx; p.us = [0, 1]; p.cuts = []; p.bb = bbox(p); P.push(p); }); });
  // cuts : les vrais croisements (pas la simple jonction entre deux côtés d'une même forme), pour l'outil Ajuster
  const end = (u) => u === 0 || u === 1;
  const mark = (p, u, q, v) => { p.us.push(u); if (p.src !== q.src || !(end(u) && end(v))) p.cuts.push(u); };
  const order = P.slice().sort((a, b) => a.bb[0] - b.bb[0]);
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
    const p = order[i], q = order[j];
    if (q.bb[0] > p.bb[2]) break;
    if (p.bb[1] > q.bb[3] || q.bb[1] > p.bb[3]) continue;
    for (const x of crossPts(p, q)) { const u = paramOn(p, x), v = paramOn(q, x); if (u !== null && v !== null) { mark(p, u, q, v); mark(q, v, p, u); } }
    [q.a, q.b].forEach((x, k) => { const u = paramOn(p, x); if (u !== null) mark(p, u, q, k); });
    [p.a, p.b].forEach((x, k) => { const v = paramOn(q, x); if (v !== null) mark(q, v, p, k); });
  }
  // sommets partagés (grille de recherche)
  const V = [], cells = new Map(), cs = TOL * 4;
  const vid = (x) => {
    const gx = Math.round(x[0] / cs), gy = Math.round(x[1] / cs);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const l = cells.get((gx + dx) + ":" + (gy + dy)); if (l) for (const i of l) if (dist(V[i], x) <= TOL * 1.5) return i; }
    V.push([x[0], x[1]]); const key = gx + ":" + gy; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(V.length - 1); return V.length - 1;
  };
  const E = [], seen = new Map();
  for (const p of P) {
    const us = [...new Set(p.us)].sort((a, b) => a - b);
    for (let i = 0; i + 1 < us.length; i++) {
      const u0 = us[i], u1 = us[i + 1];
      const va = vid(u0 === 0 ? p.a : primPt(p, u0)), vb = vid(u1 === 1 ? p.b : primPt(p, u1)); if (va === vb) continue;
      const e = { va, vb, t: p.t, src: p.src, k: p.k, u0, u1, approx: p.approx, alive: true, mid: primPt(p, (u0 + u1) / 2) };
      if (p.t === "A") { e.c = p.c; e.r = p.r; e.a0 = p.a0 + p.sw * u0; e.sw = p.sw * (u1 - u0); }
      const key = Math.min(va, vb) + ":" + Math.max(va, vb); const same = seen.get(key) || [];
      const dup = same.find((x) => x.t === e.t && (e.t === "L" || dist(x.mid, e.mid) < TOL * 4));
      if (dup) { (dup.also = dup.also || []).push(e); continue; } // deux traits l'un sur l'autre : un seul compte
      same.push(e); seen.set(key, same); E.push(e);
    }
  }
  return { V, E, P };
}

// Zones fermées du dessin : { loop, holes, pts, holePts, area, whole, holeWhole }.
// outers : le tour extérieur de chaque groupe de traits reliés (pour l'emboîtement).
export function arrange(ents) {
  const { V, E, P } = splitAll(ents);
  const total = new Map(); for (const e of E) total.set(e.src, (total.get(e.src) || 0) + 1);
  const deg = new Array(V.length).fill(0); for (const e of E) { deg[e.va]++; deg[e.vb]++; }
  const ends = []; V.forEach((v, i) => { if (deg[i] === 1) { const e = E.find((x) => x.va === i || x.vb === i); if (!ents[e.src].construction) ends.push(v); } });
  const start = (h) => (h & 1 ? E[h >> 1].vb : E[h >> 1].va), end = (h) => (h & 1 ? E[h >> 1].va : E[h >> 1].vb);
  const leave = (h) => { // direction et courbure au départ de la demi-arête
    const e = E[h >> 1];
    if (e.t === "L") { const a = V[start(h)], b = V[end(h)]; return [Math.atan2(b[1] - a[1], b[0] - a[0]), 0]; }
    const sg = Math.sign(e.sw), fwd = !(h & 1), g = fwd ? e.a0 : e.a0 + e.sw, dir = fwd ? sg : -sg;
    let t = g + dir * Math.PI / 2; t = Math.atan2(Math.sin(t), Math.cos(t));
    return [t, dir / e.r];
  };
  let cycles = [], cyc = [];
  for (let guard = 0; guard < 50; guard++) {
    // les bouts libres ne ferment rien : on les retire de proche en proche
    const d = new Array(V.length).fill(0), at = V.map(() => []);
    E.forEach((e, i) => { if (e.alive) { d[e.va]++; d[e.vb]++; at[e.va].push(i); at[e.vb].push(i); } });
    const q = []; d.forEach((n, i) => { if (n === 1) q.push(i); });
    while (q.length) { const v = q.pop(); if (d[v] !== 1) continue; const i = at[v].find((x) => E[x].alive); if (i === undefined) continue; const e = E[i]; e.alive = false; d[e.va]--; d[e.vb]--; const o = e.va === v ? e.vb : e.va; if (d[o] === 1) q.push(o); }
    const out = V.map(() => []);
    E.forEach((e, i) => { if (e.alive) { out[e.va].push(2 * i); out[e.vb].push(2 * i + 1); } });
    const info = new Map();
    for (const l of out) { for (const h of l) info.set(h, leave(h)); l.sort((a, b) => { const A = info.get(a), B = info.get(b); let da = A[0] - B[0]; if (Math.abs(Math.abs(da) - TAU) < 1e-7) da = 0; return Math.abs(da) > 1e-7 ? da : A[1] - B[1]; }); }
    const pos = new Map(); out.forEach((l) => l.forEach((h, i) => pos.set(h, i)));
    const next = (h) => { const v = end(h), l = out[v]; return l[(pos.get(h ^ 1) - 1 + l.length) % l.length]; };
    cycles = []; cyc = new Map();
    for (let i = 0; i < E.length; i++) if (E[i].alive) for (const h0 of [2 * i, 2 * i + 1]) {
      if (cyc.has(h0)) continue;
      const c = []; let h = h0, n = 0;
      while (!cyc.has(h) && n++ < 4 * E.length + 8) { cyc.set(h, cycles.length); c.push(h); h = next(h); }
      cycles.push(c);
    }
    // un trait qui relie deux contours sans rien fermer (les deux côtés dans la même zone) est retiré aussi
    let bridges = 0; E.forEach((e, i) => { if (e.alive && cyc.get(2 * i) === cyc.get(2 * i + 1)) { e.alive = false; bridges++; } });
    if (!bridges) break;
  }
  const segs = (c) => c.map((h) => { const e = E[h >> 1]; const s = { a: V[start(h)], b: V[end(h)], e }; if (e.t === "A") { const sw = h & 1 ? -e.sw : e.sw; s.arc = { c: e.c, r: e.r, mid: e.mid, sw }; } return s; });
  const areaOf = (L) => { let a = 0; for (const s of L) { a += (s.a[0] * s.b[1] - s.b[0] * s.a[1]) / 2; if (s.arc) a += s.arc.r * s.arc.r / 2 * (s.arc.sw - Math.sin(s.arc.sw)); } return a; };
  const ptsOf = (L) => { const out = []; for (const s of L) { out.push(s.a); if (s.arc) { const n = Math.max(2, Math.ceil(Math.abs(s.arc.sw) / (Math.PI / 36))); const g0 = Math.atan2(s.a[1] - s.arc.c[1], s.a[0] - s.arc.c[0]); for (let i = 1; i < n; i++) { const g = g0 + s.arc.sw * i / n; out.push([s.arc.c[0] + s.arc.r * Math.cos(g), s.arc.c[1] + s.arc.r * Math.sin(g)]); } } } return out; };
  const wholeOf = (L) => { const src = L[0].e.src; if (isOpen(ents[src])) return -1; for (const s of L) if (s.e.src !== src || s.e.also) return -1; return L.length === total.get(src) ? src : -1; };
  // groupes de traits reliés
  const comp = V.map((_, i) => i); const find = (x) => { while (comp[x] !== x) x = comp[x] = comp[comp[x]]; return x; };
  for (const e of E) if (e.alive) comp[find(e.va)] = find(e.vb);
  const faces = [], outers = [];
  cycles.forEach((c) => {
    const L = segs(c), a = areaOf(L);
    if (a > 1e-9) faces.push({ loop: L, holes: [], pts: ptsOf(L), holePts: [], holeWhole: [], gross: a, area: a, whole: wholeOf(L), comp: find(start(c[0])) });
    else if (a < -1e-9) {
      const rev = c.slice().reverse().map((h) => h ^ 1), R = segs(rev);
      outers.push({ loop: R, pts: ptsOf(R), area: -a, whole: wholeOf(R), comp: find(start(c[0])) });
    }
  });
  // chaque groupe posé à l'intérieur d'une zone y fait un trou
  for (const o of outers) {
    let best = null;
    for (const f of faces) if (f.comp !== o.comp && f.gross > o.area && inPoly(o.pts[0], f.pts) && (!best || f.gross < best.gross)) best = f;
    if (best) { best.holes.push(o.loop); best.holePts.push(o.pts); best.holeWhole.push(o.whole); best.area -= o.area; }
  }
  return { V, E, P, faces, outers, ends };
}
// Zone qui contient le point p (ou null).
export function faceAt(faces, p) {
  for (const f of faces) if (inPoly(p, f.pts) && !f.holePts.some((h) => inPoly(p, h))) return f;
  return null;
}
// Point sûrement à l'intérieur d'une zone (pour mémoriser un choix de zone).
export function insidePoint(f) {
  const P = f.pts, n = P.length; let best = null, bd = -1;
  const test = (p) => { if (!inPoly(p, P) || f.holePts.some((h) => inPoly(p, h))) return; let d = Infinity; for (const L of [P, ...f.holePts]) for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); d = Math.min(d, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])); } if (d > bd) { bd = d; best = p; } };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) test([x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * j / 12]);
  if (!best) for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n], c = P[(i + 2) % n]; test([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]); }
  return best;
}
// Distance du point x à la primitive, et paramètre du point le plus proche.
export function primNear(p, x) {
  if (p.t === "L") {
    const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], u = Math.max(0, Math.min(1, ((x[0] - p.a[0]) * dx + (x[1] - p.a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return [Math.hypot(p.a[0] + u * dx - x[0], p.a[1] + u * dy - x[1]), u];
  }
  let g = Math.atan2(x[1] - p.c[1], x[0] - p.c[0]) - p.a0;
  g = p.sw > 0 ? ((g % TAU) + TAU) % TAU : -(((-g % TAU) + TAU) % TAU);
  const u = g / p.sw;
  if (u > 1) { const da = dist(x, p.a), db = dist(x, p.b); return da < db ? [da, 0] : [db, 1]; }
  return [Math.abs(dist(x, p.c) - p.r), u];
}
