// Reconstruction du modèle à partir de l'historique (exécuté dans un Worker).
import * as R from "replicad";
import { evalExpr, varsMap } from "./expr.js";
import { resolvePlane, evalEntity, checkEntity, nestProfiles, toWorld, cross, dot, norm } from "./geo.js";

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
    let pen = R.draw(o.pts[0]);
    for (let i = 1; i < o.pts.length; i++) pen = pen.lineTo(o.pts[i]);
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

export function build(doc, opts = {}) {
  const vars = varsMap(doc.params);
  const errors = {}, sketches = {}, info = {};
  let shape = null;
  const stopAt = opts.stopAt ?? doc.features.length;
  for (let idx = 0; idx < doc.features.length && idx < stopAt; idx++) {
    const f = doc.features[idx];
    if (f.suppressed) continue;
    try {
      if (f.type === "sketch") {
        const pl = resolvePlane(f.plane, vars);
        const ents = (f.entities || []).map((e) => { const o = evalEntity(e, vars); checkEntity(o); return o; });
        sketches[f.id] = { pl, ents };
        continue;
      }
      if (f.type === "extrude" || f.type === "revolve") {
        const sk = sketches[f.sketch];
        if (!sk) throw new Error("Choisis une esquisse valide (placée avant cette fonction)");
        const drawing = sketchDrawing(sk.ents);
        let solid;
        if (f.type === "extrude") {
          let dist = f.through && f.mode === "cut" ? sizeOf(shape) * 3 : evalExpr(f.dist, vars);
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
        if (f.mode === "cut") { if (!shape) throw new Error("Il n’y a pas encore de matière à enlever"); shape = shape.cut(solid); }
        else shape = shape ? shape.fuse(solid) : solid;
      } else if (f.type === "hole") {
        if (!shape) throw new Error("Il n’y a pas encore de pièce à percer");
        const pl = resolvePlane(f.plane, vars);
        shape = shape.cut(holeTool(f, vars, pl)(sizeOf(shape)));
      } else if (f.type === "fillet" || f.type === "chamfer") {
        if (!shape) throw new Error("Il n’y a pas encore de pièce");
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
        if (!shape) throw new Error("Il n’y a pas encore de pièce");
        const t = evalExpr(f.t, vars); if (!(t > 0)) throw new Error("L’épaisseur doit être plus grande que 0");
        if (!f.faces?.length) throw new Error("Clique sur la ou les faces à ouvrir");
        const { found, test } = nearestFilter(shape.faces, f.faces, Math.max(0.05, sizeOf(shape) * 0.002), shape);
        if (!found) throw new Error("Les faces choisies n’existent plus : choisis-les à nouveau");
        shape = shape.shell(t, (ff) => ff.when(({ element }) => test(element)));
      } else if (f.type === "mirror") {
        if (!shape) throw new Error("Il n’y a pas encore de pièce");
        const pl = resolvePlane(f.plane, vars);
        shape = shape.fuse(shape.clone().mirror(pl.n, pl.origin));
      } else if (f.type === "pattern") {
        if (!shape) throw new Error("Il n’y a pas encore de pièce");
        const n = Math.round(evalExpr(f.count, vars));
        if (!(n >= 2 && n <= 200)) throw new Error("Le nombre de copies doit être entre 2 et 200");
        const base = shape; let acc = base;
        if (f.kind === "circ") {
          const ax = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[f.axis || "z"];
          const tot = evalExpr(f.angle ?? 360, vars);
          const step = tot >= 360 ? 360 / n : tot / (n - 1);
          for (let i = 1; i < n; i++) acc = acc.fuse(base.clone().rotate(step * i, [0, 0, 0], ax));
        } else {
          const ax = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[f.axis || "x"];
          const s = evalExpr(f.step, vars);
          for (let i = 1; i < n; i++) acc = acc.fuse(base.clone().translate(ax.map((c) => c * s * i)));
        }
        shape = acc;
      }
    } catch (e) {
      if (globalThis.GABARIT_DEBUG) console.error(f.id, e); errors[f.id] = humanError(e);
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
      }
    } catch { /* face ignorée */ }
  }
  const bb = shape.boundingBox.bounds;
  let volume = 0, area = 0;
  try { volume = R.measureVolume(shape); } catch {}
  try { area = R.measureArea(shape); } catch {}
  return {
    vertices: new Float32Array(m.vertices), normals: new Float32Array(m.normals), triangles: new Uint32Array(m.triangles),
    faceGroups: m.faceGroups, lines: new Float32Array(e.lines), edgeGroups: e.edgeGroups, faces, bb, volume, area,
  };
}

export function exportShape(kind, opts = {}) {
  if (!lastShape) throw new Error("Rien à exporter : la pièce est vide");
  if (kind === "step") return lastShape.blobSTEP();
  const size = sizeOf(lastShape);
  return lastShape.blobSTL({ tolerance: opts.fine ? size / 5000 : size / 1500, angularTolerance: opts.fine ? 0.05 : 0.15, binary: true });
}
