// Contrôles d'impression 3D, calculés sur le maillage de la pièce :
// parois trop fines, ponts trop longs, pièce qui dépasse du plateau.
// « g » est la direction du plateau (vecteur unitaire qui pointe vers le bas de l'impression).

// Grille régulière de triangles, pour lancer beaucoup de rayons sans tout parcourir.
class RayGrid {
  constructor(V, T) {
    this.V = V; this.T = T; const nt = T.length / 3;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < V.length; i += 3) for (let a = 0; a < 3; a++) { const x = V[i + a]; if (x < min[a]) min[a] = x; if (x > max[a]) max[a] = x; }
    for (let a = 0; a < 3; a++) { min[a] -= 1e-3; max[a] += 1e-3; }
    const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const res = Math.max(8, Math.min(56, Math.round(Math.cbrt(nt) * 1.6)));
    const s = Math.max(ext[0], ext[1], ext[2]) / res;
    const n = ext.map((e) => Math.max(1, Math.min(res, Math.ceil(e / s))));
    this.min = min; this.max = max; this.s = s; this.n = n;
    const cells = n[0] * n[1] * n[2]; const count = new Int32Array(cells + 1);
    const range = new Int32Array(nt * 6);
    for (let t = 0; t < nt; t++) {
      for (let a = 0; a < 3; a++) {
        const x0 = V[T[t * 3] * 3 + a], x1 = V[T[t * 3 + 1] * 3 + a], x2 = V[T[t * 3 + 2] * 3 + a];
        const lo = Math.min(x0, x1, x2), hi = Math.max(x0, x1, x2);
        range[t * 6 + a] = Math.max(0, Math.min(n[a] - 1, Math.floor((lo - min[a]) / s)));
        range[t * 6 + 3 + a] = Math.max(0, Math.min(n[a] - 1, Math.floor((hi - min[a]) / s)));
      }
      for (let k = range[t * 6 + 2]; k <= range[t * 6 + 5]; k++) for (let j = range[t * 6 + 1]; j <= range[t * 6 + 4]; j++) for (let i = range[t * 6]; i <= range[t * 6 + 3]; i++) count[i + n[0] * (j + n[1] * k) + 1]++;
    }
    for (let c = 0; c < cells; c++) count[c + 1] += count[c];
    const items = new Int32Array(count[cells]); const fill = count.slice(0, cells);
    for (let t = 0; t < nt; t++) for (let k = range[t * 6 + 2]; k <= range[t * 6 + 5]; k++) for (let j = range[t * 6 + 1]; j <= range[t * 6 + 4]; j++) for (let i = range[t * 6]; i <= range[t * 6 + 3]; i++) items[fill[i + n[0] * (j + n[1] * k)]++] = t;
    this.start = count; this.items = items; this.mark = new Int32Array(nt); this.stamp = 0;
  }
  // Distance du premier triangle touché par le rayon (o, d), ou null. « skip » : triangle à ignorer.
  cast(o, d, tmax, skip) {
    const { V, T, min, max, s, n } = this;
    let t0 = 0, t1 = tmax;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) { if (o[a] < min[a] || o[a] > max[a]) return null; continue; }
      let ta = (min[a] - o[a]) / d[a], tb = (max[a] - o[a]) / d[a]; if (ta > tb) { const x = ta; ta = tb; tb = x; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return null;
    }
    const ix = [0, 0, 0], step = [0, 0, 0], tNext = [Infinity, Infinity, Infinity], tDelta = [Infinity, Infinity, Infinity];
    for (let a = 0; a < 3; a++) {
      const p = o[a] + d[a] * t0;
      ix[a] = Math.max(0, Math.min(n[a] - 1, Math.floor((p - min[a]) / s)));
      if (d[a] > 1e-12) { step[a] = 1; tNext[a] = (min[a] + (ix[a] + 1) * s - o[a]) / d[a]; tDelta[a] = s / d[a]; }
      else if (d[a] < -1e-12) { step[a] = -1; tNext[a] = (min[a] + ix[a] * s - o[a]) / d[a]; tDelta[a] = -s / d[a]; }
    }
    let best = Infinity, bestTri = -1; const stamp = ++this.stamp;
    for (;;) {
      const c = ix[0] + n[0] * (ix[1] + n[1] * ix[2]);
      for (let k = this.start[c]; k < this.start[c + 1]; k++) {
        const t = this.items[k]; if (this.mark[t] === stamp || t === skip) continue; this.mark[t] = stamp;
        const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, cc = T[t * 3 + 2] * 3;
        const e1x = V[b] - V[a], e1y = V[b + 1] - V[a + 1], e1z = V[b + 2] - V[a + 2];
        const e2x = V[cc] - V[a], e2y = V[cc + 1] - V[a + 1], e2z = V[cc + 2] - V[a + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-14) continue;
        const inv = 1 / det; const sx = o[0] - V[a], sy = o[1] - V[a + 1], sz = o[2] - V[a + 2];
        const u = (sx * px + sy * py + sz * pz) * inv; if (u < -1e-9 || u > 1 + 1e-9) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < -1e-9 || u + v > 1 + 1e-9) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt > 1e-7 && tt < best) { best = tt; bestTri = t; }
      }
      const a = tNext[0] <= tNext[1] ? (tNext[0] <= tNext[2] ? 0 : 2) : (tNext[1] <= tNext[2] ? 1 : 2);
      if (best <= tNext[a] || tNext[a] > t1) break;
      ix[a] += step[a]; if (ix[a] < 0 || ix[a] >= n[a]) break; tNext[a] += tDelta[a];
    }
    return best < tmax ? { t: best, tri: bestTri } : null;
  }
}

// Classes de triangle renvoyées par le contrôle.
export const THIN = 1, BRIDGE = 2, LONG_BRIDGE = 3;

// Contrôle des parois et des ponts.
//   wall   : épaisseur minimale d'une paroi debout (2 passages de buse)
//   floor  : épaisseur minimale d'un fond ou d'un dessus (2 couches)
//   bridge : portée maximale d'un pont sans support
// Renvoie les classes par triangle et les chiffres à afficher.
export function checkPrint(mesh, g, { wall = 0.8, floor = 0.4, bridge = 30, small = 12 } = {}) {
  const V = mesh.vertices, T = mesh.triangles, nt = T.length / 3;
  const cls = new Uint8Array(nt);
  const out = { cls, thinArea: 0, thinMin: Infinity, support: 0, bed: 0, bridgeOk: 0, bridgeLong: 0, skipped: false };
  if (!nt || nt > 220000) { out.skipped = nt > 0; return out; }
  const grid = new RayGrid(V, T);
  let maxD = -Infinity; for (let i = 0; i < V.length; i += 3) maxD = Math.max(maxD, V[i] * g[0] + V[i + 1] * g[1] + V[i + 2] * g[2]);
  // deux directions horizontales (perpendiculaires à g)
  const ref = Math.abs(g[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let u = [g[1] * ref[2] - g[2] * ref[1], g[2] * ref[0] - g[0] * ref[2], g[0] * ref[1] - g[1] * ref[0]]; const ul = Math.hypot(...u); u = u.map((x) => x / ul);
  const w = [g[1] * u[2] - g[2] * u[1], g[2] * u[0] - g[0] * u[2], g[0] * u[1] - g[1] * u[0]];
  const dirs = []; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, c = Math.cos(a), s = Math.sin(a); dirs.push([u[0] * c + w[0] * s, u[1] * c + w[1] * s, u[2] * c + w[2] * s]); }
  const o = [0, 0, 0], d = [0, 0, 0];
  const W1 = [[1 / 3, 1 / 3, 1 / 3]], W4 = [[1 / 3, 1 / 3, 1 / 3], [0.7, 0.15, 0.15], [0.15, 0.7, 0.15], [0.15, 0.15, 0.7]];
  for (let t = 0; t < nt; t++) {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const e1 = [V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]], e2 = [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const a2 = Math.hypot(n[0], n[1], n[2]); if (a2 < 1e-10) continue; n = [n[0] / a2, n[1] / a2, n[2] / a2]; const area = a2 / 2;
    const cs = n[0] * g[0] + n[1] * g[1] + n[2] * g[2];
    // les grands triangles sont sondés en quatre points
    const pts = (area > 3 ? W4 : W1).map((k) => [V[a] * k[0] + V[b] * k[1] + V[c] * k[2], V[a + 1] * k[0] + V[b + 1] * k[1] + V[c + 1] * k[2], V[a + 2] * k[0] + V[b + 2] * k[1] + V[c + 2] * k[2]]);
    // épaisseur : rayon vers l'intérieur, jusqu'à la sortie de la matière
    const lim = Math.abs(cs) > 0.7 ? floor : wall; d[0] = -n[0]; d[1] = -n[1]; d[2] = -n[2];
    let th = Infinity;
    for (const q of pts) {
      o[0] = q[0] - n[0] * 2e-3; o[1] = q[1] - n[1] * 2e-3; o[2] = q[2] - n[2] * 2e-3;
      const hit = grid.cast(o, d, lim + 0.01, t); if (!hit) continue;
      const h = hit.tri, ha = T[h * 3] * 3, hb = T[h * 3 + 1] * 3, hc = T[h * 3 + 2] * 3;
      const f1 = [V[hb] - V[ha], V[hb + 1] - V[ha + 1], V[hb + 2] - V[ha + 2]], f2 = [V[hc] - V[ha], V[hc + 1] - V[ha + 1], V[hc + 2] - V[ha + 2]];
      const hn = [f1[1] * f2[2] - f1[2] * f2[1], f1[2] * f2[0] - f1[0] * f2[2], f1[0] * f2[1] - f1[1] * f2[0]];
      if (hn[0] * d[0] + hn[1] * d[1] + hn[2] * d[2] > 0) th = Math.min(th, hit.t + 2e-3);
    }
    if (th < lim - 0.01) { cls[t] = THIN; out.thinArea += area; if (th < out.thinMin) out.thinMin = th; }
    // surplombs et ponts
    const dn = Math.min(V[a] * g[0] + V[a + 1] * g[1] + V[a + 2] * g[2], V[b] * g[0] + V[b + 1] * g[1] + V[b + 2] * g[2], V[c] * g[0] + V[c + 1] * g[1] + V[c + 2] * g[2]);
    if (cs > 0.99 && dn > maxD - 0.02) { out.bed += area; continue; }
    if (cs <= 0.7071) continue;
    // juste sous la face, on cherche une paroi de chaque côté : si oui, c'est un pont
    const flat = cs > 0.985; const reach = flat ? Math.max(bridge * 4, 200) : small;
    let span = 0;
    for (const q of pts) {
      o[0] = q[0] + n[0] * 0.05; o[1] = q[1] + n[1] * 0.05; o[2] = q[2] + n[2] * 0.05;
      const dist = dirs.map((r) => grid.cast(o, r, reach, -1)?.t ?? Infinity);
      let one = Infinity; for (let k = 0; k < 4; k++) one = Math.min(one, dist[k] + dist[k + 4]);
      span = Math.max(span, one);
    }
    if (span <= (flat ? bridge : small)) { if (cls[t] !== THIN) cls[t] = BRIDGE; if (flat) out.bridgeOk = Math.max(out.bridgeOk, span); }
    else { out.support += area; if (flat && isFinite(span)) { if (cls[t] !== THIN) cls[t] = LONG_BRIDGE; out.bridgeLong = Math.max(out.bridgeLong, span); } }
  }
  if (!isFinite(out.thinMin)) out.thinMin = 0;
  return out;
}

// La pièce, posée selon g, tient-elle sur un plateau de taille [X, Y, Z] ?
// On essaie aussi de la tourner sur le plateau (par pas de 1°).
// « frame » : les deux axes horizontaux { u, w } dans lesquels exprimer le résultat (ceux de la vue).
export function fitPlate(V, g, plate, frame) {
  let u, w;
  if (frame) { u = frame.u; w = frame.w; } else {
    const ref = Math.abs(g[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    u = [g[1] * ref[2] - g[2] * ref[1], g[2] * ref[0] - g[0] * ref[2], g[0] * ref[1] - g[1] * ref[0]]; const ul = Math.hypot(...u); u = u.map((x) => x / ul);
    w = [g[1] * u[2] - g[2] * u[1], g[2] * u[0] - g[0] * u[2], g[0] * u[1] - g[1] * u[0]];
  }
  let lo = Infinity, hi = -Infinity; const pts = [];
  for (let i = 0; i < V.length; i += 3) {
    const z = -(V[i] * g[0] + V[i + 1] * g[1] + V[i + 2] * g[2]); if (z < lo) lo = z; if (z > hi) hi = z;
    pts.push([V[i] * u[0] + V[i + 1] * u[1] + V[i + 2] * u[2], V[i] * w[0] + V[i + 1] * w[1] + V[i + 2] * w[2]]);
  }
  // enveloppe convexe (chaîne monotone)
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const hull = [];
  for (const p of pts) { while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop(); hull.push(p); }
  const lower = hull.length + 1;
  for (let i = pts.length - 2; i >= 0; i--) { const p = pts[i]; while (hull.length >= lower && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop(); hull.push(p); }
  let best = null, first = null;
  for (let deg = 0; deg < 180; deg++) {
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of hull) { const x = p[0] * c + p[1] * s, y = -p[0] * s + p[1] * c; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const a = x1 - x0, b = y1 - y0;
    // marge la plus petite, dans le meilleur des deux sens du plateau
    const m1 = Math.min(plate[0] - a, plate[1] - b), m2 = Math.min(plate[0] - b, plate[1] - a);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const one = { margin: Math.max(m1, m2), swap: m2 > m1, turn: deg, long: Math.max(a, b), short: Math.min(a, b), center: [mx * c - my * s, mx * s + my * c] };
    if (deg === 0) first = one;
    if (!best || one.margin > best.margin + 1e-9) best = one;
  }
  const height = hi - lo; const use = first.margin >= -1e-6 ? first : best;
  return { height, tooHigh: height > plate[2] + 1e-6, fits: use.margin >= -1e-6, margin: use.margin, turn: use.turn, swap: use.swap, center: use.center, z: lo, long: first.long, short: first.short };
}
