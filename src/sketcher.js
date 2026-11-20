// Éditeur d'esquisse 2D (SVG) : tracé, accroche à la grille, cotes, déplacement.
import { evalEntity, outline, segPts, ENT_FIELDS, hasPts, isOpen } from "./geo.js";
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
      if (hasPts(this.draft?.type)) { this.finishPoly(); return; }
      const g = this.dimAt(e); if (g && (this.sel || g.getAttribute("data-cid"))) this.editDim(g);
    });
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = this.toW(e); const f = Math.exp(-e.deltaY * 0.0015);
      this.zoom = Math.max(0.05, Math.min(200, this.zoom * f));
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
    consider({ e: "origin", kind: "pt" }, Math.hypot(p[0], p[1]) * 0.7);
    for (const o of this.evaluated()) {
      if (o.type === "poly" || o.type === "path") {
        o.pts.forEach((q, i) => consider({ e: o.id, k: i, kind: "pt" }, Math.hypot(q[0] - p[0], q[1] - p[1]) * 0.6));
        const n = o.pts.length;
        for (let i = 0; i < (o.type === "path" ? n - 1 : n); i++) { const a = o.pts[i], b = o.pts[(i + 1) % n]; consider({ e: o.id, k: i, kind: "seg" }, dSeg(segPts([a, b], false).concat([[b[0], b[1]]]))); }
      } else if (o.type === "spline") {
        o.pts.forEach((q, i) => consider({ e: o.id, k: i, kind: "pt" }, Math.hypot(q[0] - p[0], q[1] - p[1]) * 0.6));
        const ol = outline(o); consider({ e: o.id, kind: "ent" }, dSeg(o.closed ? ol.concat([ol[0]]) : ol));
      } else if (o.type === "slot") {
        consider({ e: o.id, k: 0, kind: "pt" }, Math.hypot(o.x1 - p[0], o.y1 - p[1]) * 0.6);
        consider({ e: o.id, k: 1, kind: "pt" }, Math.hypot(o.x2 - p[0], o.y2 - p[1]) * 0.6);
        const ol = outline(o); consider({ e: o.id, kind: "ent" }, dSeg(ol.concat([ol[0]])));
      } else {
        consider({ e: o.id, k: "c", kind: "pt" }, Math.hypot(o.cx - p[0], o.cy - p[1]) * 0.6);
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
    return { p: [num(q[0]), num(q[1])] };
  }
  setTool(t) { this.tool = t; this.draft = null; this.render(); this.api.onTool?.(t); }
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
      if (e.shiftKey) { if (sub) { const i = this.subs.findIndex((x) => this.sameRef(x, sub)); if (i >= 0) this.subs.splice(i, 1); else this.subs.push(sub); } }
      else this.subs = sub ? [sub] : [];
      const id = sub && sub.e !== "origin" ? sub.e : (e.shiftKey ? this.sel : null);
      this.sel = id; this.api.select(id);
      if (sub && sub.e !== "origin" && !e.shiftKey) {
        const ent = this.api.getSketch().entities.find((x) => x.id === sub.e);
        if (sub.kind === "pt" && typeof sub.k === "number" && hasPts(ent.type)) this.drag = { kind: "vertex", i: sub.k, id: sub.e };
        else this.drag = { kind: "move", id: sub.e, start: this.snap(e).p, orig: JSON.parse(JSON.stringify(ent)), moved: false };
      } else if (!sub) this.drag = { kind: "pan", start: [e.clientX, e.clientY], pan: [...this.pan] };
      if (mi >= 0 && !e.shiftKey && sub?.kind === "seg") this.drag = { kind: "bend", i: mi, start: [e.clientX, e.clientY] };
      this.render(); return;
    }
    const { p } = this.snap(e, this.draft?.pts?.at(-1) || this.draft?.a);
    if (this.draft?.click) { this.draft.b = p; this.makeFromDraft(); return; }
    if (hasPts(t)) {
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
        if (hasPts(o.type)) ent.pts = o.pts.map((q) => { const x = Number(q[0]), y = Number(q[1]); const r = [isFinite(x) ? num(x + dx) : q[0], isFinite(y) ? num(y + dy) : q[1]]; if (q[2]) r.push(q[2]); return r; });
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
      this.api.update((sk) => { const ent = sk.entities.find((x) => x.id === id); if (!ent) return; const q = ent.pts[i]; ent.pts[i] = [q[0], q[1], num(sg)]; if (!sg) ent.pts[i] = [q[0], q[1]]; }, true);
      return;
    }
    if (this.drag?.kind === "vertex") {
      this.api.drag({ e: this.drag.id, k: this.drag.i }, sn.p);
      return;
    }
    if (this.draft) {
      if (hasPts(this.draft.type)) this.draft.cur = sn.p; else if (this.draft.dragging || this.draft.click) this.draft.b = sn.p;
    }
    this.render();
  }
  up(e) {
    const d = this.drag; this.drag = null;
    if (d && (d.kind === "move" || d.kind === "vertex" || d.kind === "bend")) { this.api.update(() => {}, false); return; }
    if (!this.draft || hasPts(this.draft.type) || !this.draft.dragging) return;
    const { a, b } = this.draft;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L * this.zoom < 4) { // simple clic : on attend un deuxième clic
      this.draft.dragging = false; this.draft.click = true; this.render();
      return;
    }
    this.makeFromDraft();
  }
  makeFromDraft() {
    const { type, a, b } = this.draft; this.draft = null;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) { this.render(); return; }
    let ent;
    if (type === "rect") ent = { type, cx: num((a[0] + b[0]) / 2), cy: num((a[1] + b[1]) / 2), w: num(Math.abs(b[0] - a[0])), h: num(Math.abs(b[1] - a[1])), r: 0, a: 0 };
    if (type === "rect" && (!ent.w || !ent.h)) { this.render(); return; }
    if (type === "circle") ent = { type, cx: a[0], cy: a[1], d: num(L * 2) };
    if (type === "polygon") ent = { type, cx: a[0], cy: a[1], d: num(L * 2), n: 6, a: num(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI) };
    if (type === "slot") ent = { type, x1: a[0], y1: a[1], x2: b[0], y2: b[1], w: num(Math.max(this.snapStep, Math.round(L / 3))) };
    if (type === "ellipse") ent = ellipseOf(a, b);
    this.commitNew(ent);
  }
  finishPoly() {
    const pts = this.draft.pts, type = this.draft.type, closed = !!this.draft.closed; this.draft = null;
    if (type === "spline") { if (pts.length < (closed ? 3 : 2)) { this.render(); return; } this.commitNew({ type, pts, closed }); return; }
    if (pts.length < (type === "path" ? 2 : 3)) { this.render(); return; }
    const ent = type === "path" ? { type, pts } : { type: "poly", pts, r: 0 };
    // contraintes automatiques : côtés tracés horizontaux ou verticaux
    const auto = [];
    const n = pts.length;
    for (let i = 0; i < (type === "path" ? n - 1 : n); i++) {
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
  cancel() { if (this.draft) { this.draft = null; this.render(); return true; } if (this.tool !== "select") { this.setTool("select"); return true; } return false; }
  deleteSel() {
    if (!this.sel) return; const id = this.sel; this.sel = null;
    this.subs = [];
    this.api.update((sk) => { sk.entities = sk.entities.filter((x) => x.id !== id); sk.constraints = (sk.constraints || []).filter((c) => (c.refs || []).every((r) => r.e !== id)); }); this.api.select(null);
  }
  render() {
    const svg = this.svg; while (svg.firstChild) svg.removeChild(svg.firstChild);
    const W = this.W, H = this.H;
    // grille
    let step = this.snapStep; while (step * this.zoom < 8) step *= step >= 1 ? (String(step)[0] === "1" ? 5 : 2) : 2;
    const major = step * (String(step)[0] === "5" ? 2 : 5) ;
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
    // entités
    const ev = this.evaluated();
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
    this.drawSubs(ev);
    this.drawConstraints(ev);
    // brouillon
    const dr = this.draft;
    if (dr) {
      const c = this.cursor?.p;
      if (hasPts(dr.type)) {
        const raw = [...dr.pts, dr.cur || c].filter(Boolean);
        const pts = (dr.type === "spline" && raw.length > 2 ? outline({ type: "spline", pts: raw, closed: false }) : raw).map((p) => this.toS(p));
        el("path", { d: "M" + pts.map((p) => p.join(" ")).join("L"), class: "draft" }, svg);
        const last = dr.pts.at(-1), cur = dr.cur || c;
        if (last && cur) this.label([(last[0] + cur[0]) / 2, (last[1] + cur[1]) / 2], fmt(Math.hypot(cur[0] - last[0], cur[1] - last[1])) + " mm");
      } else {
        const a = dr.a, b = dr.b || a; let ent = null; const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (dr.type === "rect") ent = { type: "rect", cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]), r: 0, a: 0 };
        if (dr.type === "circle") ent = { type: "circle", cx: a[0], cy: a[1], d: L * 2 };
        if (dr.type === "polygon") ent = { type: "polygon", cx: a[0], cy: a[1], d: L * 2, n: 6, a: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI };
        if (dr.type === "slot") ent = { type: "slot", x1: a[0], y1: a[1], x2: b[0], y2: b[1], w: Math.max(this.snapStep, Math.round(L / 3)) };
        if (dr.type === "ellipse") ent = ellipseOf(a, b);
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
