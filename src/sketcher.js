// Éditeur d'esquisse 2D (SVG) : tracé, accroche à la grille, cotes, déplacement.
import { evalEntity, outline, segPts, ENT_FIELDS, hasPts, isOpen, inPoly, cornerFillet } from "./geo.js";
import { arrange, splitAll, prims, paramOn, primPt, primNear, insidePoint, TOL } from "./regions.js";
import { varsMap } from "./expr.js";
import { solveSketch, C_GLYPH } from "./constraints.js";

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const fmt = (v) => { const r = Math.round(v * 1000) / 1000; return String(r).replace(".", ","); };
const num = (v) => Math.round(v * 1000) / 1000;
// Ellipse tracée du centre a vers le coin b de son rectangle englobant.
function ellipseOf(a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let rx = num(Math.abs(b[0] - a[0])), ry = num(Math.abs(b[1] - a[1]));
  if (!rx) rx = num(L / 2) || 1; if (!ry) ry = num(rx / 2) || 1;
  return { type: "ellipse", cx: a[0], cy: a[1], rx, ry, a: 0 };
}
// Outils qui posent des points un à un (ligne, contour, courbe, chemin).
const drafting = (t) => hasPts(t) || t === "line";
// Outils à plusieurs clics (sans glisser) : nombre de clics.
export const MULTI = { circle3: 3, rect3: 3 };
// Cercle passant par trois points (null si alignés).
export function circle3(p, q, r) {
  const ax = p[0], ay = p[1], bx = q[0], by = q[1], cx = r[0], cy = r[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d, uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return [ux, uy, Math.hypot(ax - ux, ay - uy)];
}
// Entité construite à partir des clics du tracé (aperçu et création utilisent la même règle).
export function entOf(type, a, b, c, step = 1, round = (v) => v) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (type === "rect") return { type, cx: round((a[0] + b[0]) / 2), cy: round((a[1] + b[1]) / 2), w: round(Math.abs(b[0] - a[0])), h: round(Math.abs(b[1] - a[1])), r: 0, a: 0 };
  if (type === "rectc") return { type: "rect", cx: a[0], cy: a[1], w: round(Math.abs(b[0] - a[0]) * 2), h: round(Math.abs(b[1] - a[1]) * 2), r: 0, a: 0 };
  if (type === "rect3") {
    if (!c || L < 1e-9) return null;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, hh = (c[0] - a[0]) * -uy + (c[1] - a[1]) * ux;
    return { type: "rect", cx: round(a[0] + ux * L / 2 - uy * hh / 2), cy: round(a[1] + uy * L / 2 + ux * hh / 2), w: round(L), h: round(Math.abs(hh)), r: 0, a: round(Math.atan2(uy, ux) * 180 / Math.PI) };
  }
  if (type === "circle") return { type, cx: a[0], cy: a[1], d: round(L * 2) };
  if (type === "circle3") { if (!c) return null; const k = circle3(a, b, c); return k ? { type: "circle", cx: round(k[0]), cy: round(k[1]), d: round(k[2] * 2) } : null; }
  if (type === "polygon") return { type, cx: a[0], cy: a[1], d: round(L * 2), n: 6, a: round(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI) };
  if (type === "slot") return { type, x1: a[0], y1: a[1], x2: b[0], y2: b[1], w: round(Math.max(step, Math.round(L / 3))) };
  if (type === "ellipse") return ellipseOf(a, b);
  return null;
}
let uid = 0; export const newId = (p = "e") => p + Date.now().toString(36) + (uid++).toString(36);

export class Sketcher {
  constructor(svg, api) {
    this.svg = svg; this.api = api; // api: { getSketch, getDoc, update(mutator), select(id), refs }
    this.tool = "select"; this.zoom = 3; this.pan = [0, 0]; this.snapStep = 1; this.sel = null;
    this.draft = null; this.hover = null; this.drag = null; this.refs = { lines: [], pts: [] }; this.subs = [];
    svg.addEventListener("pointerdown", (e) => this.down(e));
    svg.addEventListener("pointermove", (e) => this.move(e));
    svg.addEventListener("pointerup", (e) => this.up(e));
    svg.addEventListener("dblclick", (e) => {
      e.preventDefault();
      if (drafting(this.draft?.type)) { this.finishPoly(); return; }
      const g = this.dimAt(e); if (g && (this.sel || g.getAttribute("data-cid"))) this.editDim(g);
    });
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = this.toW(e); const f = Math.exp(-e.deltaY * 0.0015);
      this.zoom = Math.max(0.05, Math.min(3000, this.zoom * f));
      const q = this.toW(e); this.pan[0] += p[0] - q[0]; this.pan[1] += p[1] - q[1];
      this.render();
    }, { passive: false });
    svg.addEventListener("contextmenu", (e) => e.preventDefault());
    new ResizeObserver(() => this.render()).observe(svg);
  }
  get W() { return this.svg.clientWidth || 800; }
  get H() { return this.svg.clientHeight || 600; }
  toS(p) { return [(p[0] - this.pan[0]) * this.zoom + this.W / 2, this.H / 2 - (p[1] - this.pan[1]) * this.zoom]; }
  toW(e) { const r = this.svg.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; return [(x - this.W / 2) / this.zoom + this.pan[0], (this.H / 2 - y) / this.zoom + this.pan[1]]; }
  vars() { return varsMap(this.api.getDoc().params); }
  evaluated() {
    const sk = this.api.getSketch(); const params = this.api.getDoc().params;
    const key = JSON.stringify([sk.entities, sk.constraints, params]);
    if (key === this._evKey) return this._ev;
    const v = this.vars(); const out = [];
    for (const e of sk.entities || []) { try { out.push(evalEntity(e, v)); } catch { /* entité invalide */ } }
    let state = null;
    try { state = solveSketch(out, sk.entities || [], sk.constraints, v); } catch { state = null; }
    this._evKey = key; this._ev = out; this.solveState = state;
    return out;
  }
  // Élément le plus proche du clic : point, côté, cercle ou forme entière.
  pickSub(e) {
    const p = this.toW(e); const tol = 8 / this.zoom;
    let best = null, bd = tol;
    const consider = (ref, d) => { if (d < bd) { bd = d; best = ref; } };
    const dSeg = (pts) => { let m = Infinity; for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1]; const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); m = Math.min(m, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])); } return m; };
    // un point à moins de 4 px du clic passe toujours avant le trait qui y arrive
    const dp = (x, y, w = 0.6) => { const d = Math.hypot(x - p[0], y - p[1]); return d * this.zoom < 4 ? d * w - 4 / this.zoom : d * w; };
    consider({ e: "origin", kind: "pt" }, dp(0, 0, 0.7));
    for (const o of this.evaluated()) {
      if (o.type === "poly" || o.type === "path") {
        o.pts.forEach((q, i) => consider({ e: o.id, k: i, kind: "pt" }, dp(q[0], q[1])));
        const n = o.pts.length;
        for (let i = 0; i < (o.type === "path" ? n - 1 : n); i++) { const a = o.pts[i], b = o.pts[(i + 1) % n]; consider({ e: o.id, k: i, kind: "seg" }, dSeg(segPts([a, b], false).concat([[b[0], b[1]]]))); }
      } else if (o.type === "spline") {
        o.pts.forEach((q, i) => consider({ e: o.id, k: i, kind: "pt" }, dp(q[0], q[1])));
        const ol = outline(o); consider({ e: o.id, kind: "ent" }, dSeg(o.closed ? ol.concat([ol[0]]) : ol));
      } else if (o.type === "slot") {
        consider({ e: o.id, k: 0, kind: "pt" }, dp(o.x1, o.y1));
        consider({ e: o.id, k: 1, kind: "pt" }, dp(o.x2, o.y2));
        const ol = outline(o); consider({ e: o.id, kind: "ent" }, dSeg(ol.concat([ol[0]])));
      } else {
        consider({ e: o.id, k: "c", kind: "pt" }, dp(o.cx, o.cy));
        if (o.type !== "point") { const ol = outline(o); consider({ e: o.id, kind: o.type === "circle" || o.type === "polygon" ? "circ" : "ent" }, dSeg(ol.concat([ol[0]]))); }
      }
    }
    return best;
  }
  sameRef(a, b) { return a.e === b.e && a.k === b.k && a.kind === b.kind; }
  fitView() {
    const ev = this.evaluated(); let pts = ev.flatMap((o) => o.type === "point" ? [[o.cx, o.cy]] : outline(o));
    pts = pts.concat(this.refs.pts);
    if (!pts.length) { this.zoom = Math.min(this.W, this.H) / 120; this.pan = [0, 0]; this.render(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    x0 = Math.min(x0, 0); y0 = Math.min(y0, 0); x1 = Math.max(x1, 0); y1 = Math.max(y1, 0);
    this.pan = [(x0 + x1) / 2, (y0 + y1) / 2];
    this.zoom = Math.max(0.05, Math.min(this.W / ((x1 - x0) * 1.4 + 10), this.H / ((y1 - y0) * 1.4 + 10)));
    this.render();
  }
  keyPoints() {
    const pts = [[0, 0]];
    for (const o of this.evaluated()) {
      if (o.type === "circle" || o.type === "polygon" || o.type === "rect" || o.type === "point" || o.type === "ellipse") pts.push([o.cx, o.cy]);
      if (o.type === "slot") pts.push([o.x1, o.y1], [o.x2, o.y2]);
      if (hasPts(o.type)) pts.push(...o.pts.map((p) => [p[0], p[1]]));
      if (o.type === "rect" && !o.r) pts.push(...outline(o));
      if (o.type === "polygon") pts.push(...outline(o));
    }
    return pts.concat(this.refs.pts);
  }
  snap(e, from) {
    const p = this.toW(e);
    if (e.shiftKey) return { p: [num(p[0]), num(p[1])] };
    const tol = 8 / this.zoom;
    let best = null, bd = tol;
    for (const k of this.keyPoints()) { const d = Math.hypot(k[0] - p[0], k[1] - p[1]); if (d < bd) { bd = d; best = k; } }
    if (best) return { p: [num(best[0]), num(best[1])], key: true };
    const s = this.snapStep;
    let q = [Math.round(p[0] / s) * s, Math.round(p[1] / s) * s];
    if (from) { // alignement horizontal / vertical
      if (Math.abs(q[1] - from[1]) * this.zoom < 6) q[1] = from[1];
      if (Math.abs(q[0] - from[0]) * this.zoom < 6) q[0] = from[0];
    }
    const c = this.curveSnap(p, q, 7 / this.zoom);
    if (c) return { p: [num(c[0]), num(c[1])], key: true, on: true };
    return { p: [num(q[0]), num(q[1])] };
  }
  // Accroche sur un trait déjà dessiné : le point visé se pose dessus (de préférence là où le trait croise la grille),
  // pour qu'un trait qui doit toucher un autre le touche vraiment et ferme une zone.
  curveSnap(p, q, tol) {
    if (this.tool === "select" && this.drag?.kind !== "vertex") return null;
    const skip = this.drag?.kind === "vertex" ? this.drag.id : null;
    const ev = this.evaluated();
    if (this._pKey !== this._evKey) {
      this._p = [];
      for (const o of ev) { if (o.type === "point" || o.type === "text") continue; try { for (const pr of prims(o)) { pr.id = o.id; this._p.push(pr); } } catch { /* entité invalide */ } }
      this._pKey = this._evKey;
    }
    let best = null, bd = tol;
    for (const pr of this._p) {
      if (pr.id === skip) continue;
      const [d, u] = primNear(pr, p); if (d > tol) continue;
      const cands = [];
      if (paramOn(pr, q, 1e-9) !== null) cands.push(q);
      if (pr.t === "L") {
        const dx = pr.b[0] - pr.a[0], dy = pr.b[1] - pr.a[1];
        if (Math.abs(dx) > 1e-12) { const t = (q[0] - pr.a[0]) / dx; if (t >= 0 && t <= 1) cands.push([q[0], pr.a[1] + t * dy]); }
        if (Math.abs(dy) > 1e-12) { const t = (q[1] - pr.a[1]) / dy; if (t >= 0 && t <= 1) cands.push([pr.a[0] + t * dx, q[1]]); }
      } else {
        const hx = pr.r * pr.r - (q[0] - pr.c[0]) ** 2, hy = pr.r * pr.r - (q[1] - pr.c[1]) ** 2;
        for (const sg of [1, -1]) { if (hx >= 0) { const c = [q[0], pr.c[1] + sg * Math.sqrt(hx)]; if (paramOn(pr, c, 1e-7) !== null) cands.push(c); } if (hy >= 0) { const c = [pr.c[0] + sg * Math.sqrt(hy), q[1]]; if (paramOn(pr, c, 1e-7) !== null) cands.push(c); } }
      }
      for (const c of cands) { const dd = Math.hypot(c[0] - p[0], c[1] - p[1]); if (dd < bd) { bd = dd; best = c; } }
      const near = primPt(pr, u), dn = Math.hypot(near[0] - p[0], near[1] - p[1]) + tol * 0.35; // à défaut : le point du trait le plus proche
      if (dn < bd) { bd = dn; best = near; }
    }
    return best;
  }
  setTool(t) { this.tool = t; this.draft = null; this.hoverTrim = null; this.hoverCorner = null; if (t !== "select") this.subs = []; this.render(); this.api.onTool?.(t); }
  hitEntity(e) {
    const p = this.toW(e); const tol = 6 / this.zoom; let best = null, bd = tol;
    for (const o of this.evaluated()) {
      if (o.type === "point") { const d = Math.hypot(o.cx - p[0], o.cy - p[1]); if (d < bd) { bd = d; best = o.id; } continue; }
      const pts = outline(o);
      for (let i = 0; i < pts.length - (isOpen(o) ? 1 : 0); i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
        if (d < bd) { bd = d; best = o.id; }
      }
    }
    return best;
  }
  // Poignée au milieu d'un côté : on la tire pour courber le côté en arc.
  midHandles(o) {
    const n = o.pts.length, out = [];
    for (let i = 0; i < (o.type === "path" ? n - 1 : n); i++) {
      const a = o.pts[i], b = o.pts[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, sg = a[2] || 0;
      out.push({ i, p: [(a[0] + b[0]) / 2 - dy / L * sg, (a[1] + b[1]) / 2 + dx / L * sg], a, b });
    }
    return out;
  }
  hitMid(e) {
    if (!this.sel) return -1;
    const o = this.evaluated().find((x) => x.id === this.sel); if (!o || (o.type !== "poly" && o.type !== "path")) return -1;
    const p = this.toW(e); const tol = 7 / this.zoom;
    const hit = this.midHandles(o).find((m) => Math.hypot(m.p[0] - p[0], m.p[1] - p[1]) < tol);
    return hit ? hit.i : -1;
  }
  hitVertex(e) {
    if (!this.sel) return -1;
    const ent = this.api.getSketch().entities.find((x) => x.id === this.sel);
    if (!ent || (ent.type !== "poly" && ent.type !== "path")) return -1;
    const o = this.evaluated().find((x) => x.id === this.sel); if (!o) return -1;
    const p = this.toW(e); const tol = 7 / this.zoom;
    return o.pts.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < tol);
  }
  down(e) {
    if (e.button === 0 && !this.draft && this.dimAt(e) && (this.sel || this.dimAt(e).getAttribute("data-cid"))) return;
    this.svg.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) { this.drag = { kind: "pan", start: [e.clientX, e.clientY], pan: [...this.pan] }; return; }
    const t = this.tool;
    if (t === "select") {
      const mi = this.hitMid(e);
      const sub = this.pickSub(e);
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      if (add) { if (sub) { const i = this.subs.findIndex((x) => this.sameRef(x, sub)); if (i >= 0) this.subs.splice(i, 1); else this.subs.push(sub); } }
      else this.subs = sub ? [sub] : [];
      let id = sub && sub.e !== "origin" ? sub.e : (add ? this.sel : null);
      if (add && sub && !this.subs.some((x) => x.e === sub.e)) id = this.subs.find((x) => x.e !== "origin")?.e || null;
      this.sel = id; this.api.select(id);
      this.downAt = [e.clientX, e.clientY];
      if (sub && sub.e !== "origin" && !add) {
        const ent = this.api.getSketch().entities.find((x) => x.id === sub.e);
        if (sub.kind === "pt" && typeof sub.k === "number" && hasPts(ent.type)) this.drag = { kind: "vertex", i: sub.k, id: sub.e };
        else this.drag = { kind: "move", id: sub.e, start: this.snap(e).p, orig: JSON.parse(JSON.stringify(ent)), moved: false };
      } else if (!sub) this.drag = { kind: "pan", start: [e.clientX, e.clientY], pan: [...this.pan] };
      if (mi >= 0 && !add && sub?.kind === "seg") this.drag = { kind: "bend", i: mi, start: [e.clientX, e.clientY] };
      this.render(); return;
    }
    if (t === "convert") { const ed = this.edgeAt(e); if (ed) this.convertEdge(ed); this.hoverEdge = null; this.render(); return; }
    if (t === "trim") { const hit = this.trimPick(e); if (hit) this.applyTrim(hit); this.hoverTrim = null; this.render(); return; }
    if (t === "fillet") { const c = this.cornerPick(e); if (c) this.applyFillet(c); else this.api.say?.("Clique sur un coin entre deux traits droits. Si les traits se croisent ou dépassent, coupe d’abord ce qui dépasse avec Ajuster."); this.hoverCorner = null; this.render(); return; }
    const { p } = this.snap(e, this.draft?.pts?.at(-1) || this.draft?.a);
    if (this.draft?.click) { this.draft.b = p; this.makeFromDraft(); return; }
    if (MULTI[t]) {
      if (!this.draft) this.draft = { type: t, clicks: [] };
      const last = this.draft.clicks.at(-1); if (!last || last[0] !== p[0] || last[1] !== p[1]) this.draft.clicks.push(p);
      if (this.draft.clicks.length >= MULTI[t]) this.makeFromDraft(); else this.render();
      return;
    }
    if (drafting(t)) {
      if (!this.draft) this.draft = { type: t, pts: [p], cur: p };
      else {
        const f = this.draft.pts[0];
        if (t !== "path" && this.draft.pts.length >= 3 && Math.hypot(f[0] - p[0], f[1] - p[1]) * this.zoom < 9) { this.draft.closed = true; this.finishPoly(); return; }
        const last = this.draft.pts.at(-1); if (last[0] !== p[0] || last[1] !== p[1]) this.draft.pts.push(p);
      }
      this.render(); return;
    }
    if (t === "point") { this.commitNew({ type: "point", cx: p[0], cy: p[1] }); return; }
    if (t === "text") { this.commitNew({ type: "text", txt: "Texte", cx: p[0], cy: p[1], h: Math.max(1, this.snapStep * 5), a: 0 }); this.setTool("select"); return; }
    this.draft = { type: t, a: p, b: p, dragging: true };
    this.render();
  }
  move(e) {
    if (this.drag?.kind === "pan") {
      this.pan = [this.drag.pan[0] - (e.clientX - this.drag.start[0]) / this.zoom, this.drag.pan[1] + (e.clientY - this.drag.start[1]) / this.zoom];
      this.render(); return;
    }
    if (this.tool === "convert" && !this.drag) { this.hoverEdge = this.edgeAt(e); this.cursor = null; this.render(); return; }
    if (this.tool === "trim" && !this.drag) { this.hoverTrim = this.trimPick(e); this.cursor = null; this.render(); return; }
    if (this.tool === "fillet" && !this.drag) { this.hoverCorner = this.cornerPick(e); this.cursor = null; this.render(); return; }
    const sn = this.snap(e, this.draft?.pts?.at(-1) || this.draft?.a);
    this.cursor = sn;
    if (this.drag?.kind === "move") {
      const dx = num(sn.p[0] - this.drag.start[0]), dy = num(sn.p[1] - this.drag.start[1]);
      if (!dx && !dy && !this.drag.moved) return;
      this.drag.moved = true;
      const o = this.drag.orig; const id = this.drag.id;
      this.api.update((sk) => {
        const ent = sk.entities.find((x) => x.id === id); if (!ent) return;
        const sh = (k, d) => { const v = Number(String(o[k]).replace(",", ".")); if (isFinite(v)) ent[k] = num(v + d); };
        if ("cx" in o) { sh("cx", dx); sh("cy", dy); }
        if (o.type === "slot") { sh("x1", dx); sh("y1", dy); sh("x2", dx); sh("y2", dy); }
        if (hasPts(o.type)) ent.pts = o.pts.map((q) => { const x = Number(q[0]), y = Number(q[1]); const r = [...q]; if (isFinite(x)) r[0] = num(x + dx); if (isFinite(y)) r[1] = num(y + dy); if (r.length === 3 && !r[2]) r.length = 2; return r; });
      }, true);
      return;
    }
    if (this.drag?.kind === "bend" && Math.hypot(e.clientX - this.drag.start[0], e.clientY - this.drag.start[1]) < 4 && !this.drag.moved) return;
    if (this.drag?.kind === "bend") {
      this.drag.moved = true;
      const id = this.sel, i = this.drag.i; const o = this.evaluated().find((x) => x.id === id); if (!o) return;
      const a = o.pts[i], b = o.pts[(i + 1) % o.pts.length]; const p = this.toW(e);
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      let sg = ((p[0] - (a[0] + b[0]) / 2) * -dy + (p[1] - (a[1] + b[1]) / 2) * dx) / L;
      if (Math.abs(sg) * this.zoom < 5) sg = 0;
      sg = Math.max(-L / 2, Math.min(L / 2, e.shiftKey ? sg : Math.round(sg / (this.snapStep / 2)) * (this.snapStep / 2)));
      this.api.update((sk) => { const ent = sk.entities.find((x) => x.id === id); if (!ent) return; const q = [...ent.pts[i]]; q[2] = num(sg); if (!sg && q.length === 3) q.length = 2; ent.pts[i] = q; }, true);
      return;
    }
    if (this.drag?.kind === "vertex") {
      this.api.drag({ e: this.drag.id, k: this.drag.i }, sn.p);
      return;
    }
    if (this.draft) {
      if (drafting(this.draft.type)) this.draft.cur = sn.p; else if (this.draft.dragging || this.draft.click) this.draft.b = sn.p;
    }
    this.render();
  }
  up(e) {
    const d = this.drag; this.drag = null;
    const still = this.downAt && Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) < 5;
    if (e.button === 2 && d?.kind === "pan" && Math.hypot(e.clientX - d.start[0], e.clientY - d.start[1]) < 5) {
      // clic droit sans glisser : fin de l'outil (comme Échap), sinon les contraintes possibles
      if (this.draft && drafting(this.draft.type)) { this.finishPoly(); return; }
      if (this.draft || this.tool !== "select") { this.draft = null; this.setTool("select"); return; }
      this.api.onPick?.(e, true); return;
    }
    if (d && (d.kind === "move" || d.kind === "vertex" || d.kind === "bend")) this.api.update(() => {}, false);
    if (this.tool === "select" && e.button === 0) { this.api.onPick?.(e, !d || !d.moved ? still : false); this.downAt = null; }
    if (d && (d.kind === "move" || d.kind === "vertex" || d.kind === "bend")) return;
    if (!this.draft || drafting(this.draft.type) || !this.draft.dragging) return;
    const { a, b } = this.draft;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L * this.zoom < 4) { // simple clic : on attend un deuxième clic
      this.draft.dragging = false; this.draft.click = true; this.render();
      return;
    }
    this.makeFromDraft();
  }
  makeFromDraft() {
    const { type, a, b, clicks } = this.draft; this.draft = null;
    const ent = clicks ? entOf(type, clicks[0], clicks[1], clicks[2], this.snapStep, num) : entOf(type, a, b, null, this.snapStep, num);
    const L = clicks ? 1 : Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!ent || L < 1e-6 || (ent.type === "rect" && (!ent.w || !ent.h)) || (ent.type === "circle" && !ent.d)) { this.render(); return; }
    this.commitNew(ent);
  }
  finishPoly() {
    const pts = this.draft.pts, type = this.draft.type, closed = !!this.draft.closed; this.draft = null;
    if (type === "spline") { if (pts.length < (closed ? 3 : 2)) { this.render(); return; } this.commitNew({ type, pts, closed }); return; }
    if (type !== "line" && pts.length < (type === "path" ? 2 : 3)) { this.render(); return; }
    const open = type === "path" || (type === "line" && !closed);
    if (type === "line" && pts.length < 2) { this.render(); return; }
    if (type === "line" && closed && pts.length < 3) { this.render(); return; }
    const ent = open ? { type: "path", pts } : { type: "poly", pts, r: 0 };
    // contraintes automatiques : côtés tracés horizontaux ou verticaux
    const auto = [];
    const n = pts.length;
    for (let i = 0; i < (open ? n - 1 : n); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[0] - b[0]) > 1e-9) auto.push({ type: "horizontal", k: i });
      else if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) > 1e-9) auto.push({ type: "vertical", k: i });
    }
    this.commitNew(ent, auto);
  }
  commitNew(ent, auto = []) {
    ent.id = newId("e");
    this.api.update((sk) => {
      sk.entities = sk.entities || []; sk.entities.push(ent);
      if (auto.length) { sk.constraints = sk.constraints || []; for (const c of auto) sk.constraints.push({ id: newId("c"), type: c.type, refs: [{ e: ent.id, k: c.k }] }); }
    });
    this.sel = ent.id; this.api.select(ent.id); this.render();
  }
  editConstraintValue(g, cid) {
    const c = (this.api.getSketch().constraints || []).find((x) => x.id === cid); if (!c) return;
    const r = g.getBoundingClientRect(); const host = this.svg.parentElement.getBoundingClientRect();
    const inp = document.createElement("input"); inp.className = "dim-input"; inp.value = c.value;
    inp.style.left = (r.left - host.left + r.width / 2 - 45) + "px"; inp.style.top = (r.top - host.top + r.height / 2 - 15) + "px";
    this.svg.parentElement.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; const v = inp.value.trim(); inp.remove(); if (ok && v) this.api.update((sk) => { const c2 = (sk.constraints || []).find((x) => x.id === cid); if (c2) c2.value = v; }); };
    inp.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") finish(true); if (ev.key === "Escape") finish(false); });
    inp.addEventListener("blur", () => finish(true));
  }
  dimAt(e) { return document.elementFromPoint(e.clientX, e.clientY)?.closest?.("g.dim.edit") || null; }
  // Saisie directe d'une cote sur le dessin (double-clic sur la cote).
  editDim(g) {
    const cid = g.getAttribute("data-cid");
    if (cid) return this.editConstraintValue(g, cid);
    const key = g.getAttribute("data-key"); const id = this.sel;
    const ent = this.api.getSketch().entities.find((x) => x.id === id); if (!ent || !key) return;
    const r = g.getBoundingClientRect(); const host = this.svg.parentElement.getBoundingClientRect();
    const inp = document.createElement("input");
    inp.className = "dim-input"; inp.value = ent[key];
    inp.style.left = (r.left - host.left + r.width / 2 - 45) + "px"; inp.style.top = (r.top - host.top + r.height / 2 - 15) + "px";
    this.svg.parentElement.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true; const v = inp.value.trim(); inp.remove();
      if (ok && v) this.api.update((sk) => { const e2 = sk.entities.find((x) => x.id === id); if (e2) e2[key] = v; });
      this.api.select(id);
    };
    inp.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") finish(true); if (ev.key === "Escape") finish(false); });
    inp.addEventListener("blur", () => finish(true));
  }
  cancel() {
    // Échap pendant une ligne ou un contour : on garde ce qui est déjà tracé
    if (this.draft && drafting(this.draft.type) && this.draft.pts.length >= 2 && this.draft.type !== "spline") this.finishPoly();
    if (this.draft || this.tool !== "select") { this.draft = null; this.setTool("select"); return true; }
    return false;
  }
  deleteSel() {
    if (!this.sel) return; const id = this.sel; this.sel = null;
    this.subs = [];
    this.api.update((sk) => { sk.entities = sk.entities.filter((x) => x.id !== id); sk.constraints = (sk.constraints || []).filter((c) => (c.refs || []).every((r) => r.e !== id)); }); this.api.select(null);
  }
  render() {
    const svg = this.svg; while (svg.firstChild) svg.removeChild(svg.firstChild);
    const W = this.W, H = this.H;
    // grille
    // carreaux : on part du pas choisi et on grossit (1, 5, 10, 50…) tant qu'ils feraient moins de 8 pixels
    const lead = (x) => Math.round(x / Math.pow(10, Math.floor(Math.log10(x) + 1e-9)));
    let step = this.snapStep; while (step * this.zoom < 8) step = Number((step * (lead(step) === 5 ? 2 : 5)).toPrecision(6));
    const major = Number((step * (lead(step) === 5 ? 2 : 5)).toPrecision(6));
    const [u0, v1] = [(-W / 2) / this.zoom + this.pan[0], (H / 2) / this.zoom + this.pan[1]];
    const [u1, v0] = [(W / 2) / this.zoom + this.pan[0], (-H / 2) / this.zoom + this.pan[1]];
    const g = el("g", { class: "grid" }, svg);
    let pathMinor = "", pathMajor = "";
    for (let u = Math.ceil(u0 / step) * step; u <= u1; u += step) { const x = this.toS([u, 0])[0]; const isM = Math.abs(u / major - Math.round(u / major)) < 1e-6; (isM ? (pathMajor += `M${x} 0V${H}`) : (pathMinor += `M${x} 0V${H}`)); }
    for (let v = Math.ceil(v0 / step) * step; v <= v1; v += step) { const y = this.toS([0, v])[1]; const isM = Math.abs(v / major - Math.round(v / major)) < 1e-6; (isM ? (pathMajor += `M0 ${y}H${W}`) : (pathMinor += `M0 ${y}H${W}`)); }
    el("path", { d: pathMinor, class: "g-minor" }, g); el("path", { d: pathMajor, class: "g-major" }, g);
    const o = this.toS([0, 0]);
    el("line", { x1: 0, y1: o[1], x2: W, y2: o[1], class: "axis-u" }, g);
    el("line", { x1: o[0], y1: 0, x2: o[0], y2: H, class: "axis-v" }, g);
    el("circle", { cx: o[0], cy: o[1], r: 3.5, class: "origin" }, g);
    // références : arêtes de la pièce projetées
    if (this.refs.lines.length) {
      let d = ""; for (const [a, b] of this.refs.lines) { const p = this.toS(a), q = this.toS(b); d += `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`; }
      el("path", { d, class: "ref" }, svg);
    }
    if (this.refs.centers?.length) {
      let d = ""; for (const c of this.refs.centers) { const p = this.toS(c); d += `M${(p[0] - 5).toFixed(1)} ${p[1].toFixed(1)}h10M${p[0].toFixed(1)} ${(p[1] - 5).toFixed(1)}v10`; }
      el("path", { d, class: "ref-ctr" }, svg);
    }
    // entités
    const ev = this.evaluated();
    const zn = this.zones(ev);
    for (const f of zn.fills) {
      const d = [f.pts, ...f.holePts].map((L) => "M" + L.map((q) => { const r = this.toS(q); return r[0].toFixed(1) + " " + r[1].toFixed(1); }).join("L") + "Z").join("");
      el("path", { d, class: "zone", "fill-rule": "evenodd" }, svg);
    }
    for (const ent of ev) {
      const cls = "ent" + (ent.id === this.sel ? " sel" : "") + (ent.construction ? " constr" : "");
      if (ent.type === "point") { const p = this.toS([ent.cx, ent.cy]); el("circle", { cx: p[0], cy: p[1], r: 4, class: cls + " pt" }, svg); continue; }
      if (ent.type === "text") {
        const p = this.toS([ent.cx, ent.cy]);
        const t = el("text", { x: 0, y: 0, class: cls + " sktext", "font-size": (ent.h / 0.73) * this.zoom, transform: `translate(${p[0]} ${p[1]}) rotate(${-(ent.a || 0)})` }, svg); t.textContent = ent.txt;
        if (ent.id === this.sel) { const q = outline(ent).map((r) => this.toS(r)); el("path", { d: "M" + q.map((r) => r.join(" ")).join("L") + "Z", class: "tbox" }, svg); this.drawDims(ent); }
        continue;
      }
      const pts = outline(ent).map((p) => this.toS(p));
      el("path", { d: "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + (isOpen(ent) ? "" : "Z"), class: cls + (isOpen(ent) ? " open" : "") }, svg);
      if (ent.id === this.sel) this.drawDims(ent);
      if (ent.id === this.sel && hasPts(ent.type)) {
        if (ent.type !== "spline") for (const m of this.midHandles(ent)) { const p = this.toS(m.p); el("circle", { cx: p[0], cy: p[1], r: 4, class: "handle mid" }, svg); }
        for (const q of ent.pts) { const p = this.toS(q); el("rect", { x: p[0] - 4, y: p[1] - 4, width: 8, height: 8, class: "handle" }, svg); }
      }
    }
    for (const q of zn.ends) { const r = this.toS(q); el("circle", { cx: r[0], cy: r[1], r: 6.5, class: "free-end" }, svg); }
    this.drawSubs(ev);
    this.drawConstraints(ev);
    // brouillon
    const dr = this.draft;
    if (dr) {
      const c = this.cursor?.p;
      if (drafting(dr.type)) {
        const raw = [...dr.pts, dr.cur || c].filter(Boolean);
        const pts = (dr.type === "spline" && raw.length > 2 ? outline({ type: "spline", pts: raw, closed: false }) : raw).map((p) => this.toS(p));
        el("path", { d: "M" + pts.map((p) => p.join(" ")).join("L"), class: "draft" }, svg);
        const last = dr.pts.at(-1), cur = dr.cur || c;
        if (last && cur) this.label([(last[0] + cur[0]) / 2, (last[1] + cur[1]) / 2], fmt(Math.hypot(cur[0] - last[0], cur[1] - last[1])) + " mm");
      } else {
        let ent = null, L = 0;
        if (dr.clicks) {
          const q = [...dr.clicks, c].filter(Boolean); L = 1;
          if (q.length === 2) { const A = this.toS(q[0]), B = this.toS(q[1]); el("path", { d: `M${A.join(" ")}L${B.join(" ")}`, class: "draft" }, svg); this.label([(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2], fmt(Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1])) + " mm"); }
          if (q.length >= 3) ent = entOf(dr.type, q[0], q[1], q[2], this.snapStep);
          for (const k of dr.clicks) { const P = this.toS(k); el("circle", { cx: P[0], cy: P[1], r: 3.5, class: "snap key" }, svg); }
        } else {
          const a = dr.a, b = dr.b || a; L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          ent = entOf(dr.type, a, b, null, this.snapStep);
        }
        if (ent && L > 0) {
          const pts = outline(ent).map((p) => this.toS(p));
          el("path", { d: "M" + pts.map((p) => p.join(" ")).join("L") + "Z", class: "draft" }, svg);
          this.drawDims(ent);
        }
      }
    }
    if (this.cursor && this.tool !== "select") {
      const p = this.toS(this.cursor.p);
      el("circle", { cx: p[0], cy: p[1], r: this.cursor.key ? 6 : 3, class: this.cursor.key ? "snap key" : "snap" }, svg);
      const t = el("text", { x: p[0] + 10, y: p[1] - 10, class: "coord" }, svg); t.textContent = `${fmt(this.cursor.p[0])} ; ${fmt(this.cursor.p[1])}`;
    }
    if (this.tool === "trim" && this.hoverTrim) {
      const q = this.hoverTrim.show.map((r) => this.toS(r));
      el("path", { d: "M" + q.map((r) => r[0].toFixed(1) + " " + r[1].toFixed(1)).join("L"), class: "trim-hot" }, svg);
    }
    if (this.tool === "fillet" && this.hoverCorner) { const r = this.toS(this.hoverCorner.p); el("circle", { cx: r[0], cy: r[1], r: 9, class: "corner-hot" }, svg); }
    if (this.tool === "convert" && this.hoverEdge) {
      const q = this.hoverEdge.pts.map((r) => this.toS(r));
      el("path", { d: "M" + q.map((r) => r[0].toFixed(1) + " " + r[1].toFixed(1)).join("L"), class: "ref-hot" }, svg);
    }
    this.api.onView?.();
  }
  // Zones fermées par plusieurs traits (à colorer) et bouts de trait qui ne touchent rien (à signaler).
  zones(ev) {
    if (this._zKey === this._evKey && this._z) return this._z;
    const list = ev.filter((o) => !o.construction && o.type !== "point" && o.type !== "text");
    const z = { fills: [], ends: [] };
    let n = 0; for (const o of list) n += o.pts ? o.pts.length * (o.type === "spline" ? 12 : 1) : o.type === "ellipse" ? 96 : 4;
    if (n <= 2500 && list.some(isOpen)) {
      try {
        const ar = arrange(list); z.ends = ar.ends;
        // les formes fermées ont déjà leur fond : on colore seulement les zones qui n'y sont pas
        const closed = list.filter((o) => !isOpen(o)).map((o) => outline(o));
        if (ar.faces.length <= 300) for (const f of ar.faces) { const c = insidePoint(f); if (c && !closed.some((L) => inPoly(c, L))) z.fills.push(f); }
      } catch { /* dessin trop particulier : pas de couleur */ }
    }
    this._zKey = this._evKey; this._z = z; return z;
  }
  // ---- Outil Ajuster : retire le morceau de trait sous le pointeur, entre deux croisements ----
  trimPick(e) {
    const x = this.toW(e), tol = 9 / this.zoom;
    const ev = this.evaluated().filter((o) => o.type !== "point" && o.type !== "text");
    if (this._tKey !== this._evKey) { try { this._t = splitAll(ev); } catch { this._t = { P: [] }; } this._tKey = this._evKey; }
    let best = null, bd = tol;
    for (const pr of this._t.P) { const [d, u] = primNear(pr, x); if (d < bd) { bd = d; best = { pr, u }; } }
    if (!best) return null;
    const src = best.pr.src, o = ev[src], chain = this._t.P.filter((q) => q.src === src), n = chain.length, closed = !isOpen(o);
    const g0 = best.pr.k + best.u;
    let cuts = []; for (const q of chain) for (const c of q.cuts) cuts.push(q.k + c);
    if (closed) cuts = cuts.map((g) => (g >= n - 1e-7 ? g - n : g));
    cuts.sort((a, b) => a - b); cuts = cuts.filter((g, i) => i === 0 || g - cuts[i - 1] > 1e-7);
    let lo = 0, hi = n, whole = false;
    if (closed) {
      if (cuts.length < 2) whole = true;
      else { const below = cuts.filter((g) => g <= g0), above = cuts.filter((g) => g > g0); lo = below.length ? below.at(-1) : cuts.at(-1) - n; hi = above.length ? above[0] : cuts[0] + n; }
    } else {
      const below = cuts.filter((g) => g <= g0 && g > 1e-7), above = cuts.filter((g) => g > g0 && g < n - 1e-7);
      lo = below.length ? below.at(-1) : 0; hi = above.length ? above[0] : n; whole = lo === 0 && hi === n;
    }
    const hit = { id: o.id, chain, n, closed, lo, hi, whole, approx: !!chain[0]?.approx };
    hit.show = [];
    for (const { pr, ua, ub } of this.trimPieces(hit, whole ? 0 : lo, whole ? n : hi)) { const k = pr.t === "A" ? Math.max(2, Math.ceil(Math.abs(pr.sw * (ub - ua)) / 0.12)) : 1; for (let i = 0; i <= k; i++) hit.show.push(primPt(pr, ua + (ub - ua) * i / k)); }
    return hit;
  }
  trimPieces(hit, g1, g2) {
    const out = [];
    for (let i = Math.floor(g1 + 1e-9); i < g2 - 1e-9; i++) { const pr = hit.chain[((i % hit.n) + hit.n) % hit.n]; const ua = Math.max(0, g1 - i), ub = Math.min(1, g2 - i); if (ub - ua > 1e-9) out.push({ pr, ua, ub }); }
    return out;
  }
  applyTrim(hit) {
    const r9 = (v) => { const a = Math.round(v * 1000) / 1000; return Math.abs(a - v) < 1e-9 ? a : Math.round(v * 1e9) / 1e9; };
    const toPts = (list) => {
      const segs = [];
      for (const { pr, ua, ub } of list) {
        const a = ua === 0 ? pr.a : primPt(pr, ua), b = ub === 1 ? pr.b : primPt(pr, ub);
        if (pr.t !== "A") { segs.push({ a, b }); continue; }
        const sw = pr.sw * (ub - ua), l = segs.at(-1);
        // deux morceaux d'un même arc se recollent en un seul
        if (l && l.c && Math.hypot(l.c[0] - pr.c[0], l.c[1] - pr.c[1]) < 1e-7 && Math.abs(l.r - pr.r) < 1e-7 && Math.sign(l.sw) === Math.sign(sw) && Math.abs(l.sw + sw) < 2 * Math.PI - 0.05) { l.b = b; l.sw += sw; }
        else segs.push({ a, b, c: pr.c, r: pr.r, sw });
      }
      if (!segs.length) return null;
      const pts = segs.map((g) => { const q = [r9(g.a[0]), r9(g.a[1])]; if (g.c) q.push(r9(-Math.sign(g.sw) * g.r * (1 - Math.cos(Math.abs(g.sw) / 2)))); return q; });
      const last = segs.at(-1).b; pts.push([r9(last[0]), r9(last[1])]);
      return pts;
    };
    const raw = this.api.getSketch().entities.find((q) => q.id === hit.id); if (!raw) return;
    const mk = (pts) => { const ent = { id: newId("e"), type: "path", pts }; if (raw.construction) ent.construction = true; return ent; };
    const add = [];
    if (!hit.whole) {
      const ranges = hit.closed ? [[hit.hi, hit.lo + hit.n]] : [[0, hit.lo], [hit.hi, hit.n]];
      for (const [g1, g2] of ranges) if (g2 - g1 > 1e-9) { const pts = toPts(this.trimPieces(hit, g1, g2)); if (pts) add.push(mk(pts)); }
    }
    let had = false;
    this.api.update((sk) => {
      const i = sk.entities.findIndex((q) => q.id === hit.id); if (i < 0) return;
      sk.entities.splice(i, 1, ...add);
      const keep = (sk.constraints || []).filter((c) => (c.refs || []).every((r) => r.e !== hit.id));
      had = keep.length !== (sk.constraints || []).length; sk.constraints = keep;
    });
    this.sel = null; this.subs = []; this.api.select(null);
    if (hit.approx && add.length) this.api.say?.("Cette courbe est devenue une suite de petits segments. Ctrl+Z pour revenir en arrière.");
    else if (had) this.api.say?.("Ajusté. Les contraintes posées sur ce trait ont été retirées.");
  }
  // ---- Outil Congé : arrondit le coin cliqué (le rayon reste réglable sur le point) ----
  cornerPick(e) {
    const x = this.toW(e), tol = 12 / this.zoom; let best = null, bd = tol;
    const see = (c) => { const d = Math.hypot(c.p[0] - x[0], c.p[1] - x[1]); if (d < bd) { bd = d; best = c; } };
    for (const o of this.evaluated()) {
      if (o.type === "poly") o.pts.forEach((q, i) => see({ kind: "pt", id: o.id, i, p: [q[0], q[1]] }));
      else if (o.type === "path") o.pts.forEach((q, i) => see({ kind: i === 0 || i === o.pts.length - 1 ? "end" : "pt", id: o.id, i, p: [q[0], q[1]] }));
      else if (o.type === "rect" || o.type === "polygon") outline(o.type === "rect" ? { ...o, r: 0 } : o).forEach((q, i) => see({ kind: "shape", id: o.id, i, p: q }));
    }
    return best;
  }
  applyFillet(c) {
    const R = Math.max(0, Number(this.filletR ?? 2) || 0), say = (m) => this.api.say?.(m);
    const sk = this.api.getSketch(), ev = this.evaluated();
    const raw = sk.entities.find((q) => q.id === c.id), o = ev.find((q) => q.id === c.id); if (!raw || !o) return;
    const plain = (v) => typeof v === "number" || /^\s*-?\d*[.,]?\d+\s*$/.test(String(v));
    const r9 = (v) => { const a = Math.round(v * 1000) / 1000; return Math.abs(a - v) < 1e-9 ? a : Math.round(v * 1e9) / 1e9; };
    const dropCons = (s, ids) => { s.constraints = (s.constraints || []).filter((k) => (k.refs || []).every((r) => !ids.includes(r.e))); };
    // le coin tient-il ? P = points évalués du contour, i = le coin
    const fits = (P, i, closed) => {
      const n = P.length, a = P[(i - 1 + n) % n], p = P[i], b = P[(i + 1) % n];
      if (a[2] || p[2]) { say("Ce coin touche un côté courbe : le congé se pose entre deux traits droits."); return false; }
      if (!R) return true;
      const f = cornerFillet(p, a, b, R); if (!f) { say("Ces deux traits sont dans le prolongement l’un de l’autre : il n’y a pas de coin à arrondir."); return false; }
      const tOf = (j) => { if (!closed && (j <= 0 || j >= n - 1)) return 0; const q = P[j]; if (!(q[3] > 0)) return 0; const g = cornerFillet(q, P[(j - 1 + n) % n], P[(j + 1) % n], q[3]); return g ? g.t : 0; };
      const room = Math.min(f.l1 - tOf((i - 1 + n) % n), f.l2 - tOf((i + 1) % n));
      if (f.t > room + 1e-9) { say(`Rayon trop grand pour ce coin : ${fmt(Math.floor(R * room / f.t * 100 + 1e-6) / 100)} mm au maximum ici.`); return false; }
      return true;
    };
    const setR = (pt) => { const q = [pt[0], pt[1], pt[2] === undefined || pt[2] === null ? 0 : pt[2]]; if (R) q.push(R); else if (!q[2]) q.length = 2; return q; };
    if (c.kind === "pt") {
      if (!fits(o.pts, c.i, o.type === "poly")) return;
      this.api.update((s) => { const ent = s.entities.find((q) => q.id === c.id); if (ent) ent.pts[c.i] = setR(ent.pts[c.i]); });
    } else if (c.kind === "shape") {
      // rectangle ou polygone : il devient un contour à points, dont on arrondit un coin
      if (o.type === "rect" && o.r > 0) { say("Ce rectangle a déjà ses quatre coins arrondis (réglage « Rayon des angles »)."); return; }
      if (!["cx", "cy", "w", "h", "d", "a", "n"].every((k) => raw[k] === undefined || plain(raw[k]))) { say(o.type === "rect" ? "Ce rectangle est piloté par des formules : règle plutôt son « Rayon des angles » (les quatre coins)." : "Ce polygone est piloté par des formules : trace plutôt le contour avec l’outil Ligne."); return; }
      const P = outline(o).map((q) => [r9(q[0]), r9(q[1])]);
      if (!fits(P, c.i, true)) return;
      this.api.update((s) => {
        const ent = s.entities.find((q) => q.id === c.id); if (!ent) return;
        dropCons(s, [c.id]);
        for (const k of ["cx", "cy", "w", "h", "d", "a", "n"]) delete ent[k];
        ent.type = "poly"; ent.r = 0; ent.pts = P.map((q, i) => (i === c.i ? setR(q) : q));
        for (let i = 0; i < P.length; i++) { // côtés horizontaux et verticaux : ils le restent
          const a = P[i], b = P[(i + 1) % P.length];
          if (Math.abs(a[1] - b[1]) < 1e-9) s.constraints.push({ id: newId("c"), type: "horizontal", refs: [{ e: ent.id, k: i }] });
          else if (Math.abs(a[0] - b[0]) < 1e-9) s.constraints.push({ id: newId("c"), type: "vertical", refs: [{ e: ent.id, k: i }] });
        }
      });
    } else {
      // bout d'un trait : il faut un autre bout au même endroit (un autre trait, ou l'autre bout du même)
      const n = o.pts.length, same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < TOL * 10;
      // flèches : après retournement, chaque côté garde sa courbure (signe inversé), portée par son nouveau point de départ
      const rev = (P) => { const L = P.slice().reverse().map((q) => [q[0], q[1], 0, q[3] || 0]); for (let j = 0; j + 1 < P.length; j++) L[P.length - 2 - j][2] = -(P[j][2] || 0); return L; };
      const tidy = (P) => P.map((q) => { const r = [r9(q[0]), r9(q[1])]; if (q[2] || q[3] > 0) r.push(r9(q[2] || 0)); if (q[3] > 0) r.push(q[3]); return r; });
      const here = o.pts[c.i];
      if (n >= 3 && same(o.pts[0], o.pts[n - 1])) {
        // le trait revient à son départ : il devient un contour fermé
        const P = o.pts.slice(0, n - 1).map((q) => [...q]);
        if (!fits(P, 0, true)) return;
        this.api.update((s) => { const ent = s.entities.find((q) => q.id === c.id); if (!ent) return; dropCons(s, [c.id]); ent.type = "poly"; ent.r = 0; ent.pts = tidy(P).map((q, i) => (i === 0 ? setR(q) : q)); });
      } else {
        const other = ev.find((q) => q.id !== o.id && q.type === "path" && !!q.construction === !!o.construction && (same(q.pts[0], here) || same(q.pts.at(-1), here)));
        if (!other) { say("Ce bout de trait ne touche aucun autre trait : il n’y a pas de coin à arrondir ici."); return; }
        const A = c.i === 0 ? rev(o.pts) : o.pts.map((q) => [...q]);
        const B = same(other.pts[0], here) ? other.pts.map((q) => [...q]) : rev(other.pts);
        let P = A.concat(B.slice(1)); const at = A.length - 1; P[at] = [P[at][0], P[at][1], B[0][2] || 0];
        const closed = P.length >= 4 && same(P[0], P.at(-1)); if (closed) P = P.slice(0, -1);
        if (!fits(P, at, closed)) return;
        this.api.update((s) => {
          const ent = s.entities.find((q) => q.id === c.id); if (!ent) return;
          dropCons(s, [c.id, other.id]); s.entities = s.entities.filter((q) => q.id !== other.id);
          ent.type = closed ? "poly" : "path"; if (closed) ent.r = 0; ent.pts = tidy(P).map((q, i) => (i === at ? setR(q) : q));
        });
      }
    }
    this.sel = c.id; this.api.select(c.id);
  }
  // Arête de la pièce (projetée) la plus proche du pointeur.
  edgeAt(e) {
    const p = this.toW(e), tol = 8 / this.zoom; let best = null, bd = tol;
    for (const ed of this.refs.edges || []) {
      const P = ed.pts;
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1], abx = b[0] - a[0], aby = b[1] - a[1], l2 = abx * abx + aby * aby;
        const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2)) : 0;
        const d = Math.hypot(p[0] - a[0] - t * abx, p[1] - a[1] - t * aby);
        if (d < bd || (best && Math.abs(d - bd) < 1e-9 && ed.flat && !best.flat)) { bd = d; best = ed; }
      }
    }
    return best;
  }
  // Reprend une arête de la pièce comme entité d'esquisse (cercle, contour fermé ou chemin raccordé).
  convertEdge(ed) {
    const r6 = (v) => Math.round(v * 1e4) / 1e4;
    let P = ed.pts.map((q) => [r6(q[0]), r6(q[1])]);
    const span = Math.max(1e-6, ...P.map((q) => Math.hypot(q[0] - P[0][0], q[1] - P[0][1])));
    if (span < 1e-3) return false; // arête vue en bout : un simple point
    const eps = Math.max(1e-4, span * 1e-4);
    const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps;
    P = P.filter((q, i) => i === 0 || !same(q, P[i - 1]));
    const closedLoop = (Q) => Q.length >= 4 && same(Q[0], Q.at(-1));
    const asLoop = (Q) => {
      const ring = Q.slice(0, -1);
      const cx = ring.reduce((a, q) => a + q[0], 0) / ring.length, cy = ring.reduce((a, q) => a + q[1], 0) / ring.length;
      const rs = ring.map((q) => Math.hypot(q[0] - cx, q[1] - cy)), rm = rs.reduce((a, b) => a + b, 0) / rs.length;
      if (ring.length >= 8 && rm > 0 && rs.every((x) => Math.abs(x - rm) < rm * 0.01)) return { type: "circle", cx: r6(cx), cy: r6(cy), d: r6(2 * rm) };
      return { type: "poly", pts: ring, r: 0 };
    };
    if (closedLoop(P)) { this.commitNew(asLoop(P)); return true; }
    // raccorde aux chemins déjà repris qui touchent une extrémité
    const sk = this.api.getSketch();
    let merged = P, absorbed = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const ent of sk.entities || []) {
        if (ent.type !== "path" || !ent.fromPart || absorbed.includes(ent.id)) continue;
        const Q = ent.pts.map((q) => [Number(q[0]), Number(q[1])]);
        if (same(merged.at(-1), Q[0])) merged = merged.concat(Q.slice(1));
        else if (same(merged.at(-1), Q.at(-1))) merged = merged.concat(Q.slice(0, -1).reverse());
        else if (same(merged[0], Q.at(-1))) merged = Q.slice(0, -1).concat(merged);
        else if (same(merged[0], Q[0])) merged = Q.slice(1).reverse().concat(merged);
        else continue;
        absorbed.push(ent.id); changed = true;
      }
    }
    const ent = closedLoop(merged) ? asLoop(merged) : { type: "path", pts: merged, fromPart: true };
    if (absorbed.length) this.api.update((s2) => { s2.entities = s2.entities.filter((x) => !absorbed.includes(x.id)); s2.constraints = (s2.constraints || []).filter((c) => (c.refs || []).every((r) => !absorbed.includes(r.e))); });
    this.commitNew(ent);
    return true;
  }
  drawSubs(ev) {
    const byId = new Map(ev.map((o) => [o.id, o]));
    for (const r of this.subs) {
      if (r.e === "origin") { const p = this.toS([0, 0]); el("circle", { cx: p[0], cy: p[1], r: 6, class: "subpt" }, this.svg); continue; }
      const o = byId.get(r.e); if (!o) continue;
      if (r.kind === "pt") {
        let q; if (o.pts) q = o.pts[r.k]; else if (o.type === "slot") q = r.k ? [o.x2, o.y2] : [o.x1, o.y1]; else q = [o.cx, o.cy];
        if (q) { const p = this.toS(q); el("circle", { cx: p[0], cy: p[1], r: 5.5, class: "subpt" }, this.svg); }
      } else if (r.kind === "seg") {
        const n = o.pts.length; const a = o.pts[r.k], b = o.pts[(r.k + 1) % n]; if (!a || !b) continue;
        const pts = [[a[0], a[1]], ...segPts([a, b], false).slice(1), [b[0], b[1]]].map((q) => this.toS(q));
        el("path", { d: "M" + pts.map((q) => q.join(" ")).join("L"), class: "subseg" }, this.svg);
      } else {
        const pts = outline(o).map((q) => this.toS(q));
        el("path", { d: "M" + pts.map((q) => q.join(" ")).join("L") + "Z", class: "subseg" }, this.svg);
      }
    }
  }
  // Symboles des contraintes et cotes pilotantes.
  drawConstraints(ev) {
    const sk = this.api.getSketch(); const cons = sk.constraints || []; if (!cons.length) return;
    const byId = new Map(ev.map((o) => [o.id, o]));
    const segOf = (r) => { const o = byId.get(r.e); if (!o?.pts) return null; const n = o.pts.length; const a = o.pts[r.k], b = o.pts[(r.k + 1) % n]; return a && b ? [a, b] : null; };
    const ptOf = (r) => { if (r.e === "origin") return [0, 0]; const o = byId.get(r.e); if (!o) return null; if (o.pts) return o.pts[r.k]; if (o.type === "slot") return r.k ? [o.x2, o.y2] : [o.x1, o.y1]; return [o.cx, o.cy]; };
    const used = new Map();
    const badge = (wp, txt, c) => {
      let s = this.toS(wp); const key = Math.round(s[0] / 14) + ":" + Math.round(s[1] / 14); const k = used.get(key) || 0; used.set(key, k + 1);
      s = [s[0] + 12 + k * 15, s[1] - 12];
      const g = el("g", { class: "cbadge" + (c.id === this.selCons ? " on" : ""), "data-cid": c.id }, this.svg);
      el("rect", { x: s[0] - 6.5, y: s[1] - 6.5, width: 13, height: 13, rx: 3 }, g);
      const t = el("text", { x: s[0], y: s[1] + 0.5, "text-anchor": "middle", "dominant-baseline": "middle" }, g); t.textContent = txt;
    };
    for (const c of cons) {
      const R = c.refs || [];
      if (c.type === "length") { const sg = segOf(R[0]); if (sg) this.dimLine(sg[0], sg[1], 26, fmt(Math.hypot(sg[1][0] - sg[0][0], sg[1][1] - sg[0][1])), null, c.id); continue; }
      if (c.type === "distance") { const p = ptOf(R[0]), q = ptOf(R[1]); if (p && q) this.dimLine(p, q, 26, fmt(Math.hypot(q[0] - p[0], q[1] - p[1])), null, c.id); continue; }
      if (c.type === "diameter") { const o = byId.get(R[0].e); if (o) this.label([o.cx - o.d * 0.36, o.cy - o.d * 0.36], "⌀ " + fmt(o.d), null, c.id); continue; }
      for (const r of R) {
        let wp = null;
        if (r.kind === "seg" || (typeof r.k === "number" && byId.get(r.e)?.pts && ["horizontal", "vertical", "parallel", "perpendicular", "equal", "tangent"].includes(c.type))) { const sg = segOf(r); if (sg) wp = [(sg[0][0] + sg[1][0]) / 2, (sg[0][1] + sg[1][1]) / 2]; }
        else if (["equal"].includes(c.type)) { const o = byId.get(r.e); if (o) wp = [o.cx + (o.d || 0) / 2, o.cy]; }
        else wp = ptOf(r);
        if (wp) badge(wp, C_GLYPH[c.type] || "?", c);
        if (["horizontal", "vertical", "fix", "onH", "onV"].includes(c.type)) break;
      }
    }
  }
  label(p, text, key, cid) {
    const s = this.toS(p);
    const g = el("g", { class: "dim" + (key || cid ? " edit" : "") + (cid ? " drive" : ""), "data-key": key || "", "data-cid": cid || "" }, this.svg);
    const t = el("text", { x: s[0], y: s[1], "text-anchor": "middle", "dominant-baseline": "middle" }, g); t.textContent = text;
    const bb = t.getBBox?.(); if (bb) { const r = el("rect", { x: bb.x - 4, y: bb.y - 2, width: bb.width + 8, height: bb.height + 4, rx: 4 }); g.insertBefore(r, t); }
  }
  dimLine(a, b, off, text, key, cid) {
    // cote linéaire entre a et b, décalée perpendiculairement (en pixels)
    const A = this.toS(a), B = this.toS(b); const dx = B[0] - A[0], dy = B[1] - A[1]; const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L * off, ny = dx / L * off;
    const g = el("g", { class: "dimline" }, this.svg);
    el("path", { d: `M${A[0]} ${A[1]}L${A[0] + nx} ${A[1] + ny}M${B[0]} ${B[1]}L${B[0] + nx} ${B[1] + ny}M${A[0] + nx * 0.8} ${A[1] + ny * 0.8}L${B[0] + nx * 0.8} ${B[1] + ny * 0.8}` }, g);
    const m = [(A[0] + B[0]) / 2 + nx * 0.8, (A[1] + B[1]) / 2 + ny * 0.8];
    const gg = el("g", { class: "dim" + (key || cid ? " edit" : "") + (cid ? " drive" : ""), "data-key": key || "", "data-cid": cid || "" }, this.svg);
    const t = el("text", { x: m[0], y: m[1], "text-anchor": "middle", "dominant-baseline": "middle" }, gg); t.textContent = text;
    const bb = t.getBBox?.(); if (bb) { const r = el("rect", { x: bb.x - 4, y: bb.y - 2, width: bb.width + 8, height: bb.height + 4, rx: 4 }); gg.insertBefore(r, t); }
  }
  drawDims(o) {
    if (o.type === "rect") {
      const hw = o.w / 2, hh = o.h / 2; const r = (o.a || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      const P = (x, y) => [o.cx + x * c - y * s, o.cy + x * s + y * c];
      this.dimLine(P(-hw, hh), P(hw, hh), -22, fmt(o.w), "w");
      this.dimLine(P(hw, hh), P(hw, -hh), -22, fmt(o.h), "h");
    } else if (o.type === "text") {
      this.label([o.cx - 4 / this.zoom * 6, o.cy + o.h / 2], "h " + fmt(o.h), "h");
    } else if (o.type === "ellipse") {
      const r = (o.a || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
      this.dimLine([o.cx, o.cy], [o.cx + o.rx * c, o.cy + o.rx * sn], 0, "a " + fmt(o.rx), "rx");
      this.dimLine([o.cx, o.cy], [o.cx - o.ry * sn, o.cy + o.ry * c], 0, "b " + fmt(o.ry), "ry");
    } else if (o.type === "circle" || o.type === "polygon") {
      this.label([o.cx + o.d * 0.36, o.cy + o.d * 0.36], "⌀ " + fmt(o.d), "d");
    } else if (o.type === "slot") {
      this.dimLine([o.x1, o.y1], [o.x2, o.y2], 0, fmt(Math.hypot(o.x2 - o.x1, o.y2 - o.y1)));
      this.label([o.x2 + o.w * 0.7, o.y2 + o.w * 0.7], "l " + fmt(o.w), "w");
    } else if (o.type === "poly" || o.type === "path") {
      const n = o.pts.length;
      for (let i = 0; i < (o.type === "path" ? n - 1 : n); i++) {
        const a = o.pts[i], b = o.pts[(i + 1) % n]; if (a[2]) continue;
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; const off = 14 / this.zoom;
        this.label([(a[0] + b[0]) / 2 + dy / L * off, (a[1] + b[1]) / 2 - dx / L * off], fmt(L));
      }
    }
  }
}
export { ENT_FIELDS };
