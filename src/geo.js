// Géométrie partagée : plans, entités d'esquisse évaluées, contours discrétisés.
import { evalExpr } from "./expr.js";

export const STD_PLANES = {
  dessus: { label: "Plan de dessus", origin: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] },
  face: { label: "Plan de face", origin: [0, 0, 0], x: [1, 0, 0], n: [0, -1, 0] },
  droite: { label: "Plan de droite", origin: [0, 0, 0], x: [0, 1, 0], n: [1, 0, 0] },
};
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const norm = (a) => { const l = Math.hypot(...a) || 1; return scale(a, 1 / l); };

// Plan résolu {origin, x, y, n} à partir de la définition stockée.
export function resolvePlane(def, vars, refs = {}) {
  let base;
  if (def?.kind === "ref") {
    base = refs[def.ref];
    if (!base) throw new Error("Le plan de référence choisi n’existe plus (ou il est placé après)");
  } else if (!def || def.kind !== "face") base = STD_PLANES[def?.name || "dessus"];
  else base = def;
  const n = norm(base.n), x = norm(base.x), y = cross(n, x);
  let off = 0;
  if (def && def.offset !== undefined && def.offset !== "") off = evalExpr(def.offset, vars);
  return { origin: addv(base.origin, scale(n, off)), x, y, n };
}
// Plans de référence de la pièce (fonctions « plane »), calculés dans l'ordre.
export function refPlanes(features, vars, upTo = Infinity) {
  const refs = {};
  for (let i = 0; i < features.length && i < upTo; i++) {
    const f = features[i];
    if (f.type !== "plane" || f.suppressed) continue;
    try {
      const b0 = resolvePlane(f.base, vars, refs);
      const off = f.offset !== undefined && f.offset !== "" ? evalExpr(f.offset, vars) : 0;
      const b = { ...b0, origin: addv(b0.origin, scale(b0.n, off)) };
      const a = (f.angle ? evalExpr(f.angle, vars) : 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
      let { x, y, n } = b;
      if (a) {
        if (f.rot === "y") { const n2 = addv(scale(n, c), scale(x, sn)); x = addv(scale(n, -sn), scale(x, c)); n = n2; }
        else { const n2 = addv(scale(y, -sn), scale(n, c)); y = addv(scale(y, c), scale(n, sn)); n = n2; }
      }
      refs[f.id] = { origin: b.origin, x: norm(x), n: norm(n), name: f.name };
    } catch { /* plan invalide : signalé par le noyau */ }
  }
  return refs;
}
export const toWorld = (pl, u, v, w = 0) => addv(addv(addv(pl.origin, scale(pl.x, u)), scale(pl.y, v)), scale(pl.n, w));

export const ENT_FIELDS = {
  rect: ["cx", "cy", "w", "h", "r", "a"],
  circle: ["cx", "cy", "d"],
  polygon: ["cx", "cy", "d", "n", "a"],
  slot: ["x1", "y1", "x2", "y2", "w"],
  poly: ["r"],
  path: [],
  point: ["cx", "cy"],
};

// Évalue une entité : remplace les expressions par des nombres.
export function evalEntity(e, vars) {
  const o = { id: e.id, type: e.type, construction: !!e.construction };
  for (const f of ENT_FIELDS[e.type] || []) {
    const raw = e[f];
    o[f] = raw === undefined || raw === "" ? 0 : evalExpr(raw, vars);
  }
  if (e.type === "poly" || e.type === "path") o.pts = (e.pts || []).map((p) => [evalExpr(p[0], vars), evalExpr(p[1], vars), p[2] === undefined || p[2] === "" ? 0 : evalExpr(p[2], vars)]);
  return o;
}

export function checkEntity(o) {
  const pos = (v, what) => { if (!(v > 0)) throw new Error(`${what} doit être plus grand que 0`); };
  if (o.type === "rect") { pos(o.w, "La largeur"); pos(o.h, "La hauteur"); if (o.r < 0 || o.r * 2 >= Math.min(o.w, o.h)) { if (o.r) throw new Error("Le rayon d’angle est trop grand"); } }
  if (o.type === "circle") pos(o.d, "Le diamètre");
  if (o.type === "polygon") { pos(o.d, "Le diamètre"); if (o.n < 3 || o.n > 64) throw new Error("Il faut entre 3 et 64 côtés"); }
  if (o.type === "slot") { pos(o.w, "La largeur"); if (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 1e-6) throw new Error("La rainure a une longueur nulle"); }
  if (o.type === "poly" && o.pts.length < 2) throw new Error("Un contour libre demande au moins 2 points");
  if (o.type === "poly" && o.pts.length === 2 && !o.pts.some((p) => p[2])) throw new Error("Avec 2 points, courbe au moins un côté");
  if (o.type === "path" && o.pts.length < 2) throw new Error("Un chemin demande au moins 2 points");
}

const rot = (p, a, c) => { const r = a * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r); return [c[0] + p[0] * cs - p[1] * sn, c[1] + p[0] * sn + p[1] * cs]; };
function arcPts(cx, cy, r, a0, a1, n) { const out = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return out; }

// Contour fermé discrétisé (pour l'aperçu, la sélection et l'imbrication).
export function outline(o) {
  if (o.type === "circle") return arcPts(o.cx, o.cy, o.d / 2, 0, Math.PI * 2, 64).slice(0, -1);
  if (o.type === "rect") {
    const hw = o.w / 2, hh = o.h / 2, r = Math.max(0, Math.min(o.r || 0, hw, hh));
    let pts;
    if (r > 0) {
      pts = [...arcPts(hw - r, hh - r, r, 0, Math.PI / 2, 8), ...arcPts(-hw + r, hh - r, r, Math.PI / 2, Math.PI, 8),
        ...arcPts(-hw + r, -hh + r, r, Math.PI, 1.5 * Math.PI, 8), ...arcPts(hw - r, -hh + r, r, 1.5 * Math.PI, 2 * Math.PI, 8)];
    } else pts = [[hw, hh], [-hw, hh], [-hw, -hh], [hw, -hh]];
    return pts.map((p) => rot(p, o.a || 0, [o.cx, o.cy]));
  }
  if (o.type === "polygon") {
    const out = []; const R = o.d / 2;
    for (let i = 0; i < o.n; i++) { const a = (o.a || 0) * Math.PI / 180 + i * 2 * Math.PI / o.n; out.push([o.cx + R * Math.cos(a), o.cy + R * Math.sin(a)]); }
    return out;
  }
  if (o.type === "slot") {
    const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1), r = o.w / 2;
    return [...arcPts(o.x2, o.y2, r, ang - Math.PI / 2, ang + Math.PI / 2, 16), ...arcPts(o.x1, o.y1, r, ang + Math.PI / 2, ang + 1.5 * Math.PI, 16)];
  }
  if (o.type === "poly") return segPts(o.pts, true);
  if (o.type === "path") return segPts(o.pts, false);
  return [];
}
// Arc défini par sa flèche s (distance du milieu de la corde au milieu de l'arc, positif = à gauche).
export function arcThrough(a, b, s, steps = 16) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  const m = [mx - dy / L * s, my + dx / L * s];
  const h = L / 2, R = (h * h + s * s) / (2 * Math.abs(s));
  const sign = s > 0 ? 1 : -1;
  const c = [mx - dy / L * sign * (Math.abs(s) - R) * 1, my + dx / L * sign * (Math.abs(s) - R)];
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]), am = Math.atan2(m[1] - c[1], m[0] - c[0]);
  let a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  // sens qui passe par m
  const norm2 = (x) => { while (x < 0) x += 2 * Math.PI; while (x >= 2 * Math.PI) x -= 2 * Math.PI; return x; };
  const ccw = norm2(am - a0) < norm2(a1 - a0);
  let sweep = ccw ? norm2(a1 - a0) : -norm2(a0 - a1);
  const out = [];
  for (let i = 1; i < steps; i++) { const t = a0 + sweep * i / steps; out.push([c[0] + R * Math.cos(t), c[1] + R * Math.sin(t)]); }
  return out;
}
export function segPts(pts, closed) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]; out.push([a[0], a[1]]);
    if (!closed && i === n - 1) break;
    const b = pts[(i + 1) % n];
    if (a[2]) out.push(...arcThrough(a, b, a[2]));
  }
  return out;
}
export function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
export function inPoly(pt, p) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > pt[1]) !== (p[j][1] > pt[1]) && pt[0] < (p[j][0] - p[i][0]) * (pt[1] - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}
// Ordre et rôle (ajout ou trou) de chaque contour fermé de l'esquisse.
export function nestProfiles(list) {
  const items = list.filter((o) => o.type !== "point" && o.type !== "path" && !o.construction).map((o) => {
    const pts = outline(o); return { o, pts, area: Math.abs(polyArea(pts)) };
  }).sort((a, b) => b.area - a.area);
  for (let i = 0; i < items.length; i++) {
    const it = items[i]; const sample = it.pts[0];
    let depth = 0;
    for (let j = 0; j < i; j++) if (inPoly(sample, items[j].pts)) depth++;
    it.hole = depth % 2 === 1;
  }
  return items;
}
