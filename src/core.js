// Reconstruction du modèle à partir de l'historique (exécuté dans un Worker).
import * as R from "replicad";
import { evalExpr, varsMap } from "./expr.js";
import { solveSketch } from "./constraints.js";
import { resolvePlane, refPlanes, evalEntity, checkEntity, nestProfiles, toWorld, cross, dot, norm } from "./geo.js";

let lastShape = null;

function rPlane(pl) { return new R.Plane(pl.origin, pl.x, pl.n); }

function entityDrawing(o) {
  let d;
  if (o.type === "circle") d = R.drawCircle(o.d / 2).translate(o.cx, o.cy);
  else if (o.type === "rect") {
    d = o.r > 0 ? R.drawRoundedRectangle(o.w, o.h, o.r) : R.drawRectangle(o.w, o.h);
    if (o.a) d = d.rotate(o.a, [0, 0]);
    d = d.translate(o.cx, o.cy);
  } else if (o.type === "polygon") {
    d = R.drawPolysides(o.d / 2, Math.round(o.n));
    // drawPolysides place le premier sommet en haut ; on l'aligne sur l'axe X puis on tourne.
    d = d.rotate((o.a || 0) - 90, [0, 0]).translate(o.cx, o.cy);
  } else if (o.type === "slot") {
    const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1), r = o.w / 2;
    const ux = (o.x2 - o.x1) / L, uy = (o.y2 - o.y1) / L, px = -uy * r, py = ux * r;
    d = R.draw([o.x1 + px, o.y1 + py]).lineTo([o.x2 + px, o.y2 + py])
      .threePointsArcTo([o.x2 - px, o.y2 - py], [o.x2 + ux * r, o.y2 + uy * r])
      .lineTo([o.x1 - px, o.y1 - py])
      .threePointsArcTo([o.x1 + px, o.y1 + py], [o.x1 - ux * r, o.y1 - uy * r]).close();
  } else if (o.type === "poly") {
    let pen = R.draw(o.pts[0].slice(0, 2));
    const n = o.pts.length;
    for (let i = 1; i <= n; i++) {
      const a = o.pts[i - 1], b = o.pts[i % n];
      if (i === n) { if (a[2]) pen = pen.sagittaArcTo(b.slice(0, 2), a[2]); break; }
      pen = a[2] ? pen.sagittaArcTo(b.slice(0, 2), a[2]) : pen.lineTo(b.slice(0, 2));
    }
    d = pen.close();
    if (o.r > 0) d = d.fillet(o.r);
  }
  return d;
}

function sketchDrawing(ents) {
  const items = nestProfiles(ents);
  if (!items.length) throw new Error("L’esquisse ne contient aucun contour fermé");
  let acc = null;
  for (const it of items) {
    const d = entityDrawing(it.o);
    if (!acc) acc = d; else acc = it.hole ? acc.cut(d) : acc.fuse(d);
  }
  return acc;
}

function sizeOf(shape) {
  if (!shape) return 100;
  const bb = shape.boundingBox; const [a, b] = bb.bounds;
  return Math.max(10, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
}

function holeTool(f, vars, pl) {
  const d = evalExpr(f.d, vars); if (!(d > 0)) throw new Error("Le diamètre doit être plus grand que 0");
  const kind = f.kind || "simple";
  const eps = 0.02;
  return (size) => {
    const depth = f.through ? size * 3 : evalExpr(f.depth, vars);
    if (!(depth > 0)) throw new Error("La profondeur doit être plus grande que 0");
    const r = d / 2;
    let pts;
    if (kind === "lame") {
      const D = evalExpr(f.d2, vars), h = evalExpr(f.depth2, vars);
      if (!(D > d)) throw new Error("Le diamètre du lamage doit dépasser celui du trou");
      if (!(h > 0) || h >= depth) throw new Error("La profondeur du lamage est incorrecte");
      pts = [[0, eps], [D / 2, eps], [D / 2, -h], [r, -h], [r, -depth], [0, -depth]];
    } else if (kind === "fraise") {
      const D = evalExpr(f.d2, vars), ang = evalExpr(f.angle ?? 90, vars);
      if (!(D > d)) throw new Error("Le diamètre de la fraisure doit dépasser celui du trou");
      const t = Math.tan(ang * Math.PI / 360), h = (D - d) / 2 / t;
      if (h >= depth) throw new Error("La fraisure est plus profonde que le trou");
      pts = [[0, eps], [D / 2 + eps * t, eps], [r, -h], [r, -depth], [0, -depth]];
    } else pts = [[0, eps], [r, eps], [r, -depth], [0, -depth]];
    let pen = R.draw(pts[0]); for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
    const base = pen.close().sketchOnPlane("XZ").revolve([0, 0, 1]);
    let tools = null;
    // orientation : axe Z -> normale du plan
    const z = [0, 0, 1], n = f.flip ? pl.n.map((c) => -c) : pl.n; const c = dot(z, n);
    for (const p of f.points || []) {
      const u = evalExpr(p[0], vars), v = evalExpr(p[1], vars);
      let t = base.clone();
      if (c < 0.999999) {
        const axis = c < -0.999999 ? [1, 0, 0] : norm(cross(z, n));
        t = t.rotate(Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI, [0, 0, 0], axis);
      }
      t = t.translate(toWorld(pl, u, v));
      tools = tools ? tools.fuse(t) : t;
    }
    if (!tools) throw new Error("Ajoute au moins une position de perçage");
    return tools;
  };
}

// Sélection robuste : pour chaque point cliqué, on garde l'élément (arête ou face) le plus proche.
function nearestFilter(items, points, tol, shape) {
  const [lo, hi] = shape.boundingBox.bounds;
  const dist = (it, v) => R.measureDistanceBetween(it, v);
  const targets = [];
  for (const p of points) {
    // 1) position exacte du clic ; 2) même position relative dans l'encombrement (si la pièce a changé de taille)
    const cands = [p.slice(0, 3)];
    if (p.length >= 6) cands.push([0, 1, 2].map((k) => lo[k] + p[3 + k] * (hi[k] - lo[k])));
    let found = null;
    for (const c of cands) {
      const v = R.makeVertex(c); let bd = Infinity;
      for (const it of items) bd = Math.min(bd, dist(it, v));
      if (bd < tol) { found = { v, bd }; break; }
    }
    if (found) targets.push(found);
  }
  const test = (it) => targets.some((t) => dist(it, t.v) <= t.bd + 1e-7);
  return { found: targets.length, test };
}

const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const importCache = new Map();

// Transformations d'une répétition (liste de fonctions qui déplacent une copie du solide).
function patternTransforms(f, vars) {
  const out = [];
  const n = Math.round(evalExpr(f.count, vars));
  if (!(n >= 2 && n <= 500)) throw new Error("Le nombre d’exemplaires doit être entre 2 et 500");
  if (f.kind === "circ") {
    const ax = AXES[f.axis || "z"]; const tot = evalExpr(f.angle ?? 360, vars);
    const step = tot >= 360 ? 360 / n : tot / (n - 1);
    for (let i = 1; i < n; i++) out.push((s) => s.rotate(step * i, [0, 0, 0], ax));
  } else {
    const ax = AXES[f.axis || "x"]; const st = evalExpr(f.step, vars);
    let n2 = 1, ax2 = null, st2 = 0;
    if (f.two) { n2 = Math.round(evalExpr(f.count2 ?? 2, vars)); ax2 = AXES[f.axis2 || "y"]; st2 = evalExpr(f.step2 ?? 10, vars); if (!(n2 >= 1 && n2 <= 500)) throw new Error("Le nombre d’exemplaires (2e direction) est incorrect"); if (n * n2 > 2000) throw new Error("Trop d’exemplaires (2000 au maximum)"); }
    for (let j = 0; j < n2; j++) for (let i = 0; i < n; i++) {
      if (!i && !j) continue;
      const v = [0, 1, 2].map((k) => ax[k] * st * i + (ax2 ? ax2[k] * st2 * j : 0));
      out.push((s) => s.translate(v));
    }
  }
  return out;
}

function decodeB64(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

export async function build(doc, opts = {}) {
  const vars = varsMap(doc.params);
  const errors = {}, sketches = {}, info = {}, tools = {};
  let shape = null;
  const stopAt = opts.stopAt ?? doc.features.length;
  const refs = refPlanes(doc.features, vars, stopAt);
  const P = (def) => resolvePlane(def, vars, refs);
  const getSketch = (id, what = "une esquisse") => { const sk = sketches[id]; if (!sk) throw new Error(`Choisis ${what} valide (placée avant cette fonction)`); return sk; };
  const apply = (solid, mode, id) => {
    if (id) tools[id] = { solid, mode };
    if (mode === "cut") { if (!shape) throw new Error("Il n’y a pas encore de matière à enlever"); shape = shape.cut(solid); }
    else shape = shape ? shape.fuse(solid) : solid;
  };
  const need = () => { if (!shape) throw new Error("Il n’y a pas encore de pièce"); };
  for (let idx = 0; idx < doc.features.length && idx < stopAt; idx++) {
    const f = doc.features[idx];
    if (f.suppressed) continue;
    try {
      if (f.type === "sketch") {
        const pl = P(f.plane);
        const ents = (f.entities || []).map((e) => evalEntity(e, vars));
        if (f.constraints?.length) { const sr = solveSketch(ents, f.entities, f.constraints, vars); if (!sr.ok) info[f.id] = { conflict: true }; }
        ents.forEach(checkEntity);
        sketches[f.id] = { pl, ents };
        continue;
      }
      if (f.type === "plane") { if (!refs[f.id]) { P(f.base); throw new Error("Plan impossible à calculer"); } continue; }
      if (f.type === "extrude" || f.type === "revolve") {
        const sk = getSketch(f.sketch);
        const drawing = sketchDrawing(sk.ents);
        let solid;
        if (f.type === "extrude") {
          const dist = f.through && f.mode === "cut" ? sizeOf(shape) * 3 : evalExpr(f.dist, vars);
          if (!(dist > 0)) throw new Error("La distance doit être plus grande que 0");
          let pl = { ...sk.pl };
          const dir = f.dir || "normal";
          if (dir === "sym") pl = { ...pl, origin: toWorld(pl, 0, 0, -dist / 2) };
          if (dir === "inverse") pl = { ...pl, origin: toWorld(pl, 0, 0, -dist) };
          solid = drawing.sketchOnPlane(rPlane(pl)).extrude(dist);
        } else {
          const ang = evalExpr(f.angle ?? 360, vars);
          if (!(ang > 0 && ang <= 360)) throw new Error("L’angle doit être entre 0 et 360°");
          const axis = f.axis === "x" ? sk.pl.x : sk.pl.y;
          solid = drawing.sketchOnPlane(rPlane(sk.pl)).revolve(axis, { origin: sk.pl.origin, angle: ang });
        }
        apply(solid, f.mode, f.id);
      } else if (f.type === "loft") {
        const ids = (f.sketches || []).filter(Boolean);
        if (ids.length < 2) throw new Error("Choisis au moins deux esquisses, dans l’ordre du lissage");
        const sks = ids.map((id) => { const sk = getSketch(id, "des esquisses"); const d = sketchDrawing(sk.ents); const s = d.sketchOnPlane(rPlane(sk.pl)); if (!s.loftWith) throw new Error("Chaque esquisse du lissage doit contenir un seul contour, sans trou"); return s; });
        const solid = sks[0].loftWith(sks.slice(1), { ruled: !!f.ruled });
        apply(solid, f.mode, f.id);
      } else if (f.type === "sweep") {
        const prof = getSketch(f.profile, "une esquisse de profil");
        const path = getSketch(f.path, "une esquisse de chemin");
        const pe = path.ents.find((e) => (e.type === "path" || e.type === "poly") && !e.construction) || null;
        if (!pe) throw new Error("L’esquisse du chemin doit contenir un chemin ou un contour libre");
        const pd = sketchDrawing(prof.ents);
        let pen = R.draw(pe.pts[0].slice(0, 2));
        const pts = pe.pts, n = pts.length, closed = pe.type === "poly";
        for (let i = 1; i <= (closed ? n : n - 1); i++) {
          const a = pts[i - 1], b = pts[i % n];
          pen = a[2] ? pen.sagittaArcTo(b.slice(0, 2), a[2]) : pen.lineTo(b.slice(0, 2));
        }
        let spineD = closed ? pen.close() : pen.done();
        const rr = pe.type === "path" ? 0 : pe.r; if (rr > 0) spineD = spineD.fillet(rr);
        const spine = spineD.sketchOnPlane(rPlane(path.pl));
        const solid = spine.sweepSketch((plane, origin) => pd.sketchOnPlane(plane, origin), { frenet: true, transitionMode: "round" });
        apply(solid, f.mode, f.id);
      } else if (f.type === "hole") {
        need();
        const tool = holeTool(f, vars, P(f.plane))(sizeOf(shape));
        apply(tool, "cut", f.id);
      } else if (f.type === "fillet" || f.type === "chamfer") {
        need();
        const r = evalExpr(f.r, vars); if (!(r > 0)) throw new Error("La valeur doit être plus grande que 0");
        if (!f.edges?.length) throw new Error("Clique sur au moins une arête de la pièce");
        const tol = Math.max(0.05, sizeOf(shape) * 0.002);
        const { found, test } = nearestFilter(shape.edges, f.edges, tol, shape);
        if (!found) throw new Error("Les arêtes choisies n’existent plus : choisis-les à nouveau");
        const cfg = (e) => (test(e) ? r : null);
        const out = f.type === "fillet" ? shape.fillet(cfg) : shape.chamfer(cfg);
        if (!out) throw new Error("Opération impossible");
        info[f.id] = { found, asked: f.edges.length };
        shape = out;
      } else if (f.type === "shell") {
        need();
        const t = evalExpr(f.t, vars); if (!(t > 0)) throw new Error("L’épaisseur doit être plus grande que 0");
        if (!f.faces?.length) throw new Error("Clique sur la ou les faces à ouvrir");
        const { found, test } = nearestFilter(shape.faces, f.faces, Math.max(0.05, sizeOf(shape) * 0.002), shape);
        if (!found) throw new Error("Les faces choisies n’existent plus : choisis-les à nouveau");
        info[f.id] = { found, asked: f.faces.length };
        shape = shape.shell(t, (ff) => ff.when(({ element }) => test(element)));
      } else if (f.type === "draft") {
        need();
        const a = evalExpr(f.angle, vars); if (!(Math.abs(a) > 0 && Math.abs(a) < 45)) throw new Error("L’angle doit être entre 0 et 45°");
        if (!f.faces?.length) throw new Error("Clique sur les faces à incliner");
        const { found, test } = nearestFilter(shape.faces, f.faces, Math.max(0.05, sizeOf(shape) * 0.002), shape);
        if (!found) throw new Error("Les faces choisies n’existent plus : choisis-les à nouveau");
        info[f.id] = { found, asked: f.faces.length };
        const out = shape.draft(a, (ff) => ff.when(({ element }) => test(element)), rPlane(P(f.plane)));
        if (!out) throw new Error("Dépouille impossible");
        shape = out;
      } else if (f.type === "mirror") {
        need();
        const pl = P(f.plane);
        if (f.target === "features") {
          const ids = (f.feats || []).filter((id) => tools[id]);
          if (!ids.length) throw new Error("Choisis les fonctions à copier en miroir");
          for (const id of ids) apply(tools[id].solid.clone().mirror(pl.n, pl.origin), tools[id].mode);
        } else shape = shape.fuse(shape.clone().mirror(pl.n, pl.origin));
      } else if (f.type === "pattern") {
        need();
        const trs = patternTransforms(f, vars);
        if (f.target === "features") {
          const ids = (f.feats || []).filter((id) => tools[id]);
          if (!ids.length) throw new Error("Choisis les fonctions à répéter");
          for (const id of ids) {
            const { solid, mode } = tools[id];
            let acc = null;
            for (const tr of trs) { const c = tr(solid.clone()); acc = acc ? acc.fuse(c) : c; }
            apply(acc, mode);
          }
        } else {
          const base = shape; let acc = base;
          for (const tr of trs) acc = acc.fuse(tr(base.clone()));
          shape = acc;
        }
      } else if (f.type === "import") {
        if (!f.data) throw new Error("Aucun fichier importé");
        const key = f.id + ":" + f.data.length;
        let imp = importCache.get(f.id);
        if (!imp || imp.key !== key) {
          const blob = new Blob([decodeB64(f.data)]);
          const s = f.format === "stl" ? await R.importSTL(blob) : await R.importSTEP(blob);
          if (!s) throw new Error("Fichier illisible");
          imp = { key, shape: s }; importCache.set(f.id, imp);
        }
        let s = imp.shape.clone();
        const sc = f.scale ? evalExpr(f.scale, vars) : 1;
        if (sc !== 1) s = s.scale(sc, [0, 0, 0]);
        const t = [f.tx, f.ty, f.tz].map((v) => (v ? evalExpr(v, vars) : 0));
        if (t.some(Boolean)) s = s.translate(t);
        apply(s, f.mode || "add", f.id);
      }
    } catch (e) {
      if (globalThis.GABARIT_DEBUG) console.error(f.id, e);
      errors[f.id] = humanError(e);
    }
  }
  lastShape = shape;
  return { shape, errors, sketches, info };
}

function humanError(e) {
  const m = (e && e.message) || String(e);
  if (/^[A-ZÀ-Ü]/.test(m) && /[a-zé]/.test(m) && !/is not|undefined|null|Cannot|failed|Error/i.test(m)) return m;
  return "Le noyau 3D n’a pas pu faire cette opération (valeur trop grande, forme qui se croise, ou arête trop courte)";
}

export function meshShape(shape) {
  if (!shape) return null;
  const size = sizeOf(shape);
  const tol = Math.max(0.01, size / 2000);
  const m = shape.mesh({ tolerance: tol, angularTolerance: 0.2 });
  const e = shape.meshEdges({ tolerance: tol, angularTolerance: 0.2 });
  // Infos de faces planes, pour esquisser ou percer sur une face.
  const faces = {};
  let i = 0;
  for (const fc of shape.faces) {
    i++;
    try {
      if (fc.geomType === "PLANE") {
        const c = fc.center; const n = fc.normalAt(c);
        faces[fc.hashCode] = { plane: true, c: [c.x, c.y, c.z], n: [n.x, n.y, n.z] };
      } else if (fc.geomType === "CYLINDRE") {
        const oc = R.getOC();
        const ad = new oc.BRepAdaptor_Surface(fc.wrapped, true); const cy = ad.Cylinder(); const ax = cy.Axis();
        const l = ax.Location(), d = ax.Direction();
        faces[fc.hashCode] = { cyl: true, p: [l.X(), l.Y(), l.Z()], d: [d.X(), d.Y(), d.Z()], r: cy.Radius() };
        ad.delete(); cy.delete?.(); ax.delete?.();
      }
    } catch { /* face ignorée */ }
  }
  const bb = shape.boundingBox.bounds;
  let volume = 0, area = 0;
  try { volume = R.measureVolume(shape); } catch {}
  try { area = R.measureArea(shape); } catch {}
  let cog = null;
  try { const vp = R.measureShapeVolumeProperties(shape); cog = vp.centerOfMass; vp.delete?.(); } catch {}
  return {
    vertices: new Float32Array(m.vertices), normals: new Float32Array(m.normals), triangles: new Uint32Array(m.triangles),
    faceGroups: m.faceGroups, lines: new Float32Array(e.lines), edgeGroups: e.edgeGroups, faces, bb, volume, area, cog,
  };
}

export function exportShape(kind, opts = {}) {
  if (!lastShape) throw new Error("Rien à exporter : la pièce est vide");
  if (kind === "step") return lastShape.blobSTEP();
  const size = sizeOf(lastShape);
  return lastShape.blobSTL({ tolerance: opts.fine ? size / 5000 : size / 1500, angularTolerance: opts.fine ? 0.05 : 0.15, binary: true });
}

// Vues 2D pour la mise en plan (arêtes visibles et cachées).
export function drawingViews(names = ["front", "top", "right", "iso"]) {
  if (!lastShape) throw new Error("Rien à mettre en plan : la pièce est vide");
  const cams = {
    front: new R.ProjectionCamera([0, 0, 0], [0, -1, 0], [1, 0, 0]),
    back: new R.ProjectionCamera([0, 0, 0], [0, 1, 0], [-1, 0, 0]),
    top: new R.ProjectionCamera([0, 0, 0], [0, 0, 1], [1, 0, 0]),
    bottom: new R.ProjectionCamera([0, 0, 0], [0, 0, -1], [1, 0, 0]),
    right: new R.ProjectionCamera([0, 0, 0], [1, 0, 0], [0, 1, 0]),
    left: new R.ProjectionCamera([0, 0, 0], [-1, 0, 0], [0, -1, 0]),
    iso: new R.ProjectionCamera([0, 0, 0], [1, -1, 1], [1, 1, 0]),
  };
  const out = {};
  for (const n of names) {
    const { visible, hidden } = R.drawProjection(lastShape, cams[n]);
    const bb = visible.boundingBox;
    const paths = (d) => { try { return [].concat(...[d.toSVGPaths()].flat(2)); } catch { return []; } };
    out[n] = { visible: paths(visible), hidden: paths(hidden), bounds: bb.bounds };
  }
  return out;
}

// ---------- Assemblages ----------
const asmCache = new Map();
async function componentShape(c) {
  const key = c.key;
  const hit = asmCache.get(c.id);
  if (hit && hit.key === key) return hit.shape;
  let shape = null;
  if (c.src.kind === "part") {
    const r = await build(c.src.doc);
    shape = r.shape;
    if (!shape) throw new Error("La pièce est vide");
  } else {
    const blob = new Blob([decodeB64(c.src.data)]);
    shape = c.src.kind === "stl" ? await R.importSTL(blob) : await R.importSTEP(blob);
  }
  asmCache.set(c.id, { key, shape });
  return shape;
}
function placed(shape, pos, rot) {
  let s = shape.clone();
  if (rot[0]) s = s.rotate(rot[0], [0, 0, 0], [1, 0, 0]);
  if (rot[1]) s = s.rotate(rot[1], [0, 0, 0], [0, 1, 0]);
  if (rot[2]) s = s.rotate(rot[2], [0, 0, 0], [0, 0, 1]);
  if (pos.some(Boolean)) s = s.translate(pos);
  return s;
}
export async function buildAssembly(comps) {
  const out = [];
  for (const id of [...asmCache.keys()]) if (!comps.some((c) => c.id === id)) asmCache.delete(id);
  for (const c of comps) {
    try { const shape = await componentShape(c); out.push({ id: c.id, mesh: meshShape(shape) }); }
    catch (e) { out.push({ id: c.id, error: humanError(e) }); }
  }
  return out;
}
export function assemblyInterferences(comps) {
  const items = comps.map((c) => { const h = asmCache.get(c.id); return h ? { c, s: placed(h.shape, c.pos, c.rot) } : null; }).filter(Boolean);
  const res = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const A = items[i], B = items[j];
    const [a0, a1] = A.s.boundingBox.bounds, [b0, b1] = B.s.boundingBox.bounds;
    if ([0, 1, 2].some((k) => a1[k] < b0[k] || b1[k] < a0[k])) continue;
    try { const v = R.measureVolume(A.s.intersect(B.s)); if (v > 1e-3) res.push({ a: A.c.id, b: B.c.id, volume: v }); } catch { /* ignoré */ }
  }
  return res;
}
export function exportAssembly(kind, comps) {
  const items = comps.map((c) => { const h = asmCache.get(c.id); return h ? { shape: placed(h.shape, c.pos, c.rot), name: c.name, color: c.color } : null; }).filter(Boolean);
  if (!items.length) throw new Error("L’assemblage est vide");
  if (kind === "step") return R.exportSTEP(items);
  const comp = R.makeCompound(items.map((i) => i.shape));
  return comp.blobSTL({ tolerance: 0.05, angularTolerance: 0.1, binary: true });
}
