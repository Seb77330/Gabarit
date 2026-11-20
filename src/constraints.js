// Solveur de contraintes d'esquisse (Gauss-Newton à pas de norme minimale).
// Il travaille sur les entités évaluées (nombres) ; seules les valeurs saisies comme
// simples nombres sont libres, les valeurs pilotées par une expression restent fixes.
import { evalExpr } from "./expr.js";

const isNum = (v) => typeof v === "number" || (typeof v === "string" && /^\s*-?\d*[.,]?\d+(e[+-]?\d+)?\s*$/i.test(v));

export const C_LABELS = {
  horizontal: "Horizontal", vertical: "Vertical", length: "Longueur", parallel: "Parallèles", perpendicular: "Perpendiculaires",
  equal: "Égaux", coincident: "Coïncidents", fix: "Fixe", onH: "Sur l’axe horizontal", onV: "Sur l’axe vertical",
  symV: "Symétriques (axe vertical)", symH: "Symétriques (axe horizontal)", hAlign: "Alignés horizontalement", vAlign: "Alignés verticalement",
  tangent: "Tangents", diameter: "Diamètre", distance: "Distance",
  midpoint: "Au milieu", onLine: "Sur le côté", onCircle: "Sur le cercle",
};
export const C_GLYPH = { midpoint: "◇", onLine: "∈", onCircle: "◯", horizontal: "H", vertical: "V", parallel: "∥", perpendicular: "⊥", equal: "=", coincident: "●", fix: "⚓", onH: "—", onV: "|", symV: "⇋", symH: "⇅", hAlign: "↔", vAlign: "↕", tangent: "◠", length: "↦", diameter: "⌀", distance: "↦" };

// Construit le modèle : variables libres + accès aux points, segments et cercles.
function buildModel(ents, raws) {
  const vars = []; // { ent, set(v) , v }
  const byId = new Map(ents.map((o) => [o.id, o]));
  const rawById = new Map(raws.map((e) => [e.id, e]));
  const slot = new Map(); // "id|key" -> index de variable
  const addVar = (o, key, get, set, raw) => {
    if (!isNum(raw)) return;
    slot.set(o.id + "|" + key, vars.length);
    vars.push({ get, set, id: o.id, key });
  };
  for (const o of ents) {
    const r = rawById.get(o.id); if (!r) continue;
    if (o.type === "poly" || o.type === "path" || o.type === "spline") {
      o.pts.forEach((p, i) => {
        addVar(o, i + ".x", () => p[0], (v) => (p[0] = v), r.pts?.[i]?.[0]);
        addVar(o, i + ".y", () => p[1], (v) => (p[1] = v), r.pts?.[i]?.[1]);
        if (p[2]) addVar(o, i + ".s", () => p[2], (v) => (p[2] = v), r.pts?.[i]?.[2]);
      });
    } else if (o.type === "circle" || o.type === "polygon" || o.type === "rect" || o.type === "point") {
      addVar(o, "cx", () => o.cx, (v) => (o.cx = v), r.cx);
      addVar(o, "cy", () => o.cy, (v) => (o.cy = v), r.cy);
      if (o.type === "circle" || o.type === "polygon") addVar(o, "d", () => o.d, (v) => (o.d = v), r.d);
    } else if (o.type === "slot") {
      for (const k of ["x1", "y1", "x2", "y2"]) addVar(o, k, () => o[k], (v) => (o[k] = v), r[k]);
    }
  }
  const pt = (ref) => {
    if (ref.e === "origin") return [0, 0];
    const o = byId.get(ref.e); if (!o) return null;
    if (o.type === "poly" || o.type === "path" || o.type === "spline") { const p = o.pts[ref.k]; return p ? [p[0], p[1]] : null; }
    if (o.type === "slot") return ref.k === 1 ? [o.x2, o.y2] : [o.x1, o.y1];
    return [o.cx, o.cy];
  };
  const seg = (ref) => {
    const o = byId.get(ref.e); if (!o || (o.type !== "poly" && o.type !== "path")) return null;
    const n = o.pts.length; const a = o.pts[ref.k], b = o.pts[(ref.k + 1) % n];
    if (!a || !b || (o.type === "path" && ref.k >= n - 1)) return null;
    return { a, b, s: a[2] || 0 };
  };
  const circ = (ref) => { const o = byId.get(ref.e); return o && (o.type === "circle" || o.type === "polygon") ? o : null; };
  return { vars, pt, seg, circ, slot };
}

// Direction tangente d'un segment (ligne ou arc) à son départ (end=false) ou à son arrivée.
function tangentDir(sg, end) {
  const dx = sg.b[0] - sg.a[0], dy = sg.b[1] - sg.a[1], L = Math.hypot(dx, dy) || 1e-12;
  const th = 2 * Math.atan2(2 * sg.s, L); // demi-angle de l'arc
  const ang = Math.atan2(dy, dx) + (end ? -th : th);
  return [Math.cos(ang), Math.sin(ang)];
}
const crossN = (u, v) => (u[0] * v[1] - u[1] * v[0]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1e-12);
const dotN = (u, v) => (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1e-12);

function residuals(model, cons, vals, pins) {
  const r = [];
  const { pt, seg, circ } = model;
  for (const c of cons) {
    const R = c.refs || [];
    try {
      switch (c.type) {
        case "horizontal": { const s = seg(R[0]); if (s) r.push(s.a[1] - s.b[1]); break; }
        case "vertical": { const s = seg(R[0]); if (s) r.push(s.a[0] - s.b[0]); break; }
        case "length": { const s = seg(R[0]); if (s) r.push(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) - vals[c.id]); break; }
        case "distance": { const p = pt(R[0]), q = pt(R[1]); if (p && q) r.push(Math.hypot(q[0] - p[0], q[1] - p[1]) - vals[c.id]); break; }
        case "parallel": case "perpendicular": {
          const s1 = seg(R[0]), s2 = seg(R[1]); if (!s1 || !s2) break;
          const d1 = [s1.b[0] - s1.a[0], s1.b[1] - s1.a[1]], d2 = [s2.b[0] - s2.a[0], s2.b[1] - s2.a[1]];
          r.push(c.type === "parallel" ? crossN(d1, d2) * 10 : dotN(d1, d2) * 10); break;
        }
        case "equal": {
          const s1 = seg(R[0]), s2 = seg(R[1]);
          if (s1 && s2) { r.push(Math.hypot(s1.b[0] - s1.a[0], s1.b[1] - s1.a[1]) - Math.hypot(s2.b[0] - s2.a[0], s2.b[1] - s2.a[1])); break; }
          const c1 = circ(R[0]), c2 = circ(R[1]); if (c1 && c2) r.push(c1.d - c2.d); break;
        }
        case "diameter": { const c1 = circ(R[0]); if (c1) r.push(c1.d - vals[c.id]); break; }
        case "coincident": { const p = pt(R[0]), q = pt(R[1]); if (p && q) r.push(p[0] - q[0], p[1] - q[1]); break; }
        case "fix": { const p = pt(R[0]); if (p && c.at) r.push(p[0] - c.at[0], p[1] - c.at[1]); break; }
        case "onH": { const p = pt(R[0]); if (p) r.push(p[1]); break; }
        case "onV": { const p = pt(R[0]); if (p) r.push(p[0]); break; }
        case "hAlign": { const p = pt(R[0]), q = pt(R[1]); if (p && q) r.push(p[1] - q[1]); break; }
        case "vAlign": { const p = pt(R[0]), q = pt(R[1]); if (p && q) r.push(p[0] - q[0]); break; }
        case "symV": { const p = pt(R[0]), q = pt(R[1]); if (p && q) r.push(p[0] + q[0], p[1] - q[1]); break; }
        case "symH": { const p = pt(R[0]), q = pt(R[1]); if (p && q) r.push(p[0] - q[0], p[1] + q[1]); break; }
        case "midpoint": { const p = pt(R[0]), s = seg(R[1]); if (p && s) r.push(p[0] - (s.a[0] + s.b[0]) / 2, p[1] - (s.a[1] + s.b[1]) / 2); break; }
        case "onLine": {
          const p = pt(R[0]), s = seg(R[1]); if (!p || !s) break;
          const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], L = Math.hypot(dx, dy) || 1e-12;
          r.push(((p[0] - s.a[0]) * dy - (p[1] - s.a[1]) * dx) / L); break;
        }
        case "onCircle": { const p = pt(R[0]), o = circ(R[1]); if (p && o) r.push(Math.hypot(p[0] - o.cx, p[1] - o.cy) - o.d / 2); break; }
        case "tangent": {
          const ci = circ(R[1]), sl = seg(R[0]);
          if (ci && sl) { // côté droit tangent à un cercle
            const dx = sl.b[0] - sl.a[0], dy = sl.b[1] - sl.a[1], L = Math.hypot(dx, dy) || 1e-12;
            r.push(Math.abs(((ci.cx - sl.a[0]) * dy - (ci.cy - sl.a[1]) * dx) / L) - ci.d / 2); break;
          }
          // deux segments consécutifs d'un même contour : tangents au point commun
          const s1 = seg(R[0]), s2 = seg(R[1]); if (!s1 || !s2) break;
          let t1, t2;
          if (s1.b === s2.a) { t1 = tangentDir(s1, true); t2 = tangentDir(s2, false); }
          else if (s2.b === s1.a) { t1 = tangentDir(s2, true); t2 = tangentDir(s1, false); }
          else break;
          r.push(crossN(t1, t2) * 10); break;
        }
        default: break;
      }
    } catch { /* contrainte ignorée */ }
  }
  for (const p of pins || []) { const q = pt(p.ref); if (q) r.push((q[0] - p.at[0]) * 0.3, (q[1] - p.at[1]) * 0.3); }
  return r;
}

// Résout A·y = b (A carrée symétrique) par élimination de Gauss avec pivot.
function solveLin(A, b) {
  const n = b.length; const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-14) continue;
    [M[c], M[p]] = [M[p], M[c]];
    for (let i = 0; i < n; i++) { if (i === c) continue; const f = M[i][c] / M[c][c]; if (!f) continue; for (let k = c; k <= n; k++) M[i][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-14 ? 0 : row[n] / row[i]));
}
function rank(J, tol = 1e-7) {
  const M = J.map((r) => [...r]); let rk = 0; const rows = M.length, cols = rows ? M[0].length : 0;
  for (let c = 0; c < cols && rk < rows; c++) {
    let p = rk; for (let i = rk + 1; i < rows; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < tol) continue;
    [M[rk], M[p]] = [M[p], M[rk]];
    for (let i = rk + 1; i < rows; i++) { const f = M[i][c] / M[rk][c]; for (let k = c; k < cols; k++) M[i][k] -= f * M[rk][k]; }
    rk++;
  }
  return rk;
}

// Applique les contraintes aux entités évaluées (modifiées sur place).
export function solveSketch(ents, raws, constraints, params, pins = []) {
  const cons = (constraints || []).filter((c) => c && c.type);
  if (!cons.length && !pins.length) return { ok: true, dof: null, residual: 0 };
  const vals = {};
  for (const c of cons) if (c.value !== undefined && c.value !== "") { try { vals[c.id] = evalExpr(c.value, params); } catch { vals[c.id] = NaN; } }
  const model = buildModel(ents, raws);
  const V = model.vars; const n = V.length;
  const res = () => residuals(model, cons, vals, pins);
  let r = res(); let norm = Math.hypot(...r);
  let iter = 0;
  for (; iter < 60 && norm > 1e-9 && n; iter++) {
    // jacobienne numérique
    const m = r.length; const J = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const x0 = V[j].get(); const hstep = 1e-6 * Math.max(1, Math.abs(x0));
      V[j].set(x0 + hstep); const r2 = res(); V[j].set(x0);
      for (let i = 0; i < m; i++) J[i][j] = (r2[i] - r[i]) / hstep;
    }
    const A = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, k) => { let s = 0; for (let j = 0; j < n; j++) s += J[i][j] * J[k][j]; return s + (i === k ? 1e-10 : 0); }));
    const y = solveLin(A, r);
    const dx = new Array(n).fill(0); for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += J[i][j] * y[i]; dx[j] = -s; }
    const x0 = V.map((v) => v.get());
    let t = 1, improved = false;
    for (let ls = 0; ls < 12; ls++) {
      V.forEach((v, j) => v.set(x0[j] + t * dx[j]));
      const r2 = res(); const n2 = Math.hypot(...r2);
      if (n2 < norm || n2 < 1e-9) { r = r2; norm = n2; improved = true; break; }
      t /= 2;
    }
    if (!improved) { V.forEach((v, j) => v.set(x0[j])); break; }
  }
  // degrés de liberté restants (sans les points tirés à la souris)
  let dof = null;
  if (!pins.length && n && n <= 400) {
    const r0 = residuals(model, cons, vals, []); const m = r0.length;
    if (!m) dof = n;
    else {
      const J = Array.from({ length: m }, () => new Array(n).fill(0));
      for (let j = 0; j < n; j++) { const x0 = V[j].get(); const hstep = 1e-6 * Math.max(1, Math.abs(x0)); V[j].set(x0 + hstep); const r2 = residuals(model, cons, vals, []); V[j].set(x0); for (let i = 0; i < m; i++) J[i][j] = (r2[i] - r0[i]) / hstep; }
      dof = n - rank(J);
    }
  }
  const consRes = Math.hypot(...residuals(model, cons, vals, []));
  return { ok: consRes < 1e-5, dof, residual: consRes, vars: n };
}

// Recopie les valeurs résolues dans les entités enregistrées (seulement les nombres libres).
export function writeBack(ents, raws) {
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const byId = new Map(ents.map((o) => [o.id, o]));
  for (const e of raws) {
    const o = byId.get(e.id); if (!o) continue;
    if (e.type === "poly" || e.type === "path" || e.type === "spline") {
      e.pts.forEach((p, i) => { const q = o.pts[i]; if (!q) return; if (isNum(p[0])) p[0] = r6(q[0]); if (isNum(p[1])) p[1] = r6(q[1]); if (p[2] !== undefined && p[2] !== "" && isNum(p[2])) p[2] = r6(q[2]); });
    } else {
      for (const k of ["cx", "cy", "d", "x1", "y1", "x2", "y2"]) if (k in e && isNum(e[k]) && typeof o[k] === "number") e[k] = r6(o[k]);
    }
  }
}

// Retire les contraintes qui visent des éléments disparus.
export function pruneConstraints(sk) {
  const ids = new Map((sk.entities || []).map((e) => [e.id, e]));
  const okRef = (r) => r.e === "origin" || (ids.has(r.e) && (typeof r.k !== "number" || (ids.get(r.e).pts && r.k < ids.get(r.e).pts.length)));
  sk.constraints = (sk.constraints || []).filter((c) => (c.refs || []).every(okRef));
}
