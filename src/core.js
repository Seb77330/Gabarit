// Reconstruction du modèle à partir de l'historique (exécuté dans un Worker).
import * as R from "replicad";
import { evalExpr, varsMap } from "./expr.js";
import { solveSketch } from "./constraints.js";
import { objText, threeMF } from "./meshfiles.js";
import { readStl, writeStl, stretchZone, stretchZones, zoneMap, bakeTris } from "./mesh3mf.js";
import { IDENT, MOVES, oread, osame, odet, omul, axisAngle } from "./orient.js";
import FONT from "./texte.ttf";
let fontReady = null;
const ensureFont = () => (fontReady ||= R.loadFont(FONT.buffer.slice(FONT.byteOffset, FONT.byteOffset + FONT.byteLength), "gabarit"));
import { resolvePlane, refPlanes, evalEntity, checkEntity, nestProfiles, inPoly, isOpen, toWorld, cross, dot, norm, bezierSegs, outline, roundCorners } from "./geo.js";
import { arrange, faceAt } from "./regions.js";

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
  } else if (o.type === "ellipse") {
    d = o.rx >= o.ry ? R.drawEllipse(o.rx, o.ry) : R.drawEllipse(o.ry, o.rx).rotate(90, [0, 0]);
    if (o.a) d = d.rotate(o.a, [0, 0]);
    d = d.translate(o.cx, o.cy);
  } else if (o.type === "spline") {
    d = wireDrawing(o);
  } else if (o.type === "text") {
    d = R.drawText(o.txt, { startX: 0, startY: 0, fontSize: o.h / 0.73, fontFamily: "gabarit" });
    if (o.a) d = d.rotate(o.a, [0, 0]);
    d = d.translate(o.cx, o.cy);
  } else if (o.type === "poly") {
    // coins arrondis un par un (rayon porté par le point) : le contour est repris avec ses arcs
    const own = o.pts.some((q) => q[3] > 0), P = own ? roundCorners(o.pts, true, o.r || 0) : o.pts;
    let pen = R.draw(P[0].slice(0, 2));
    const n = P.length;
    for (let i = 1; i <= n; i++) {
      const a = P[i - 1], b = P[i % n];
      if (i === n) { if (a[2]) pen = pen.sagittaArcTo(b.slice(0, 2), a[2]); break; }
      pen = a[2] ? pen.sagittaArcTo(b.slice(0, 2), a[2]) : pen.lineTo(b.slice(0, 2));
    }
    d = pen.close();
    if (o.r > 0 && !own) d = d.fillet(o.r);
  }
  return d;
}

// Dessin d'un contour à points (contour libre, chemin, courbe), ouvert ou fermé.
function wireDrawing(o) {
  const closed = o.type === "poly" || (o.type === "spline" && o.closed);
  const own = o.type !== "spline" && o.pts.some((q) => q[3] > 0);
  const pts = own ? roundCorners(o.pts, closed, o.type === "poly" ? o.r || 0 : 0) : o.pts, n = pts.length;
  let pen = R.draw(pts[0].slice(0, 2));
  if (o.type === "spline") {
    const segs = bezierSegs(pts, closed);
    segs.forEach(([, c1, c2, p1], i) => { pen = pen.cubicBezierCurveTo(i === segs.length - 1 && closed ? pts[0].slice(0, 2) : p1, c1, c2); });
    return closed ? pen.close() : pen.done();
  }
  for (let i = 1; i <= (closed ? n : n - 1); i++) {
    const a = pts[i - 1], b = pts[i % n];
    if (closed && i === n) { if (a[2]) pen = pen.sagittaArcTo(b.slice(0, 2), a[2]); break; }
    pen = a[2] ? pen.sagittaArcTo(b.slice(0, 2), a[2]) : pen.lineTo(b.slice(0, 2));
  }
  let d = closed ? pen.close() : pen.done();
  if (o.type === "poly" && o.r > 0 && !own) d = d.fillet(o.r);
  return d;
}

// ---------- Extrusion jusqu'à une face, nervure, filetage, hélice ----------
const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k] };
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function perpOf(n) { return unit(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])); }
function nearestFace(shape, ref) {
  const { found, test } = nearestFilter(shape.faces, [ref], Math.max(0.05, sizeOf(shape) * 0.002), shape);
  return found ? shape.faces.find(test) : null;
}
function extrudeToFace(drawing, pl, f, shape) {
  if (!shape) throw new Error("Il n’y a pas encore de pièce pour s’arrêter sur une face");
  if (!f.upTo) throw new Error("Clique sur la face où l’extrusion doit s’arrêter");
  const face = nearestFace(shape, f.upTo); if (!face) throw new Error("La face d’arrivée n’existe plus : choisis-la à nouveau");
  if (face.geomType !== "PLANE") throw new Error("Choisis une face plane comme face d’arrivée");
  const cv = face.center, c = [cv.x, cv.y, cv.z]; const nv = face.normalAt(cv); const fn = unit([nv.x, nv.y, nv.z]);
  const n = pl.n; const dd = dot(v3.sub(c, pl.origin), n); const cosA = dot(fn, n);
  if (Math.abs(dd) < 1e-6) throw new Error("La face d’arrivée est dans le plan de l’esquisse");
  if (Math.abs(cosA) > 0.99999) {
    const p2 = dd < 0 ? { ...pl, origin: toWorld(pl, 0, 0, dd) } : pl;
    return drawing.sketchOnPlane(rPlane(p2)).extrude(Math.abs(dd));
  }
  // face inclinée : extrusion longue coupée par le demi-espace de la face
  const L = sizeOf(shape) * 4;
  const p2 = dd < 0 ? { ...pl, origin: toWorld(pl, 0, 0, -L) } : pl;
  const long = drawing.sketchOnPlane(rPlane(p2)).extrude(L);
  const s = dot(v3.sub(pl.origin, c), fn) > 0 ? 1 : -1;
  const hp = new R.Plane(c, perpOf(fn), v3.mul(fn, s));
  const half = R.drawRectangle(L * 2, L * 2).sketchOnPlane(hp).extrude(L * 2);
  return long.intersect(half);
}
function ribSolid(sk, t, flip, shape) {
  if (!(t > 0)) throw new Error("L’épaisseur doit être plus grande que 0");
  const pe = sk.ents.find((e) => !e.construction && (e.type === "path" || (e.type === "spline" && !e.closed)));
  if (!pe) throw new Error("L’esquisse de la nervure doit contenir un trait ouvert (outil « Chemin » ou « Courbe »)");
  const line = outline(pe); const a = line[0], b = line[line.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1], Ld = Math.hypot(dx, dy) || 1;
  const L = sizeOf(shape) * 3;
  const [lo, hi] = shape.boundingBox.bounds; const box = R.makeBox(lo, hi);
  const pl = { ...sk.pl, origin: toWorld(sk.pl, 0, 0, -t / 2) };
  const side = (sg) => {
    const nx = -dy / Ld * sg, ny = dx / Ld * sg;
    const poly = [...line, [b[0] + nx * L, b[1] + ny * L], [a[0] + nx * L, a[1] + ny * L]];
    let pen = R.draw(poly[0]); for (let i = 1; i < poly.length; i++) pen = pen.lineTo(poly[i]);
    return pen.close().sketchOnPlane(rPlane(pl)).extrude(t).intersect(box);
  };
  // côté automatique : celui qui ajoute le moins de matière (l'espace fermé entre le trait et les parois)
  const cands = [side(1), side(-1)].map((sl) => { let v = Infinity; try { v = R.measureVolume(sl.cut(shape)); } catch { /* */ } return { sl, v: v > 1e-6 ? v : Infinity }; });
  cands.sort((x, y) => x.v - y.v);
  return (flip ? cands[1] : cands[0]).sl;
}
// Balayage d'un profil le long d'une hélice d'axe (c, d).
function helixSweep(c, d, r, pitch, H, profile) {
  d = unit(d);
  const helix = R.makeHelix(pitch, H, r, c, d);
  const sp = helix.startPoint; const start = [sp.x, sp.y, sp.z];
  const rad = v3.sub(start, c); const u = unit(v3.sub(rad, v3.mul(d, dot(rad, d))));
  const v = cross(d, u);
  const tan = unit(v3.add(v3.mul(v, 2 * Math.PI * r), v3.mul(d, pitch)));
  const wire = profile(u, v, d, start, tan);
  return R.genericSweep(wire, helix, { frenet: true });
}
function threadCut(f, vars, shape) {
  if (!f.face) throw new Error("Clique sur la face cylindrique à fileter");
  const face = nearestFace(shape, f.face); if (!face) throw new Error("La face choisie n’existe plus : choisis-la à nouveau");
  if (face.geomType !== "CYLINDRE") throw new Error("Choisis une face cylindrique (un axe ou un trou)");
  const oc = R.getOC(); const ad = new oc.BRepAdaptor_Surface(face.wrapped, true); const cy = ad.Cylinder(); const ax = cy.Axis();
  const l = ax.Location(), dd = ax.Direction(); let p0 = [l.X(), l.Y(), l.Z()]; let d = [dd.X(), dd.Y(), dd.Z()]; const r = cy.Radius(); ad.delete();
  const ts = []; for (const e of face.edges) for (const q of [e.startPoint, e.endPoint]) ts.push(dot(v3.sub([q.x, q.y, q.z], p0), d));
  let t0 = Math.min(...ts), t1 = Math.max(...ts);
  if (f.flip) { d = v3.mul(d, -1); [t0, t1] = [-t1, -t0]; }
  const pitch = evalExpr(f.pitch, vars); if (!(pitch > 0)) throw new Error("Le pas doit être plus grand que 0");
  const internal = f.kind === "int";
  const h = (internal ? 0.5413 : 0.6134) * pitch;
  if (h >= r * 0.9) throw new Error("Le pas est trop grand pour ce diamètre");
  let len = f.len === undefined || f.len === "" ? t1 - t0 : evalExpr(f.len, vars);
  if (!(len > 0)) throw new Error("La longueur doit être plus grande que 0");
  len = Math.min(len, t1 - t0);
  const e = h * 0.15, half = (h + e) * Math.tan(Math.PI / 6);
  const prof = (u, v, dz, start) => {
    const base = internal ? -e : e, tip = internal ? h : -h;
    const P = (radial, axial) => v3.add(v3.add(start, v3.mul(u, radial)), v3.mul(dz, axial));
    const pts = [P(base, -half), P(tip, 0), P(base, half)];
    return R.assembleWire([R.makeLine(pts[0], pts[1]), R.makeLine(pts[1], pts[2]), R.makeLine(pts[2], pts[0])]);
  };
  // Le noyau calcule mal les opérations avec une longue hélice : on creuse par tronçons de deux tours au plus.
  const turns = len / pitch; if (turns > 400) throw new Error("Trop de tours de filet (400 au maximum)");
  let vol = R.measureVolume(shape);
  const cutPiece = (z, hgt) => {
    const c = v3.add(p0, v3.mul(d, t0 + z));
    const next = shape.cut(helixSweep(c, d, r, pitch, hgt, prof));
    const v2 = R.measureVolume(next);
    if (!(v2 < vol - 1e-9)) return false;
    shape = next; vol = v2; return true;
  };
  for (let z = 0; z < len - 1e-9; z += 2 * pitch) {
    const hgt = Math.min(2 * pitch, len - z);
    if (!cutPiece(z, hgt)) {
      const h1 = Math.min(pitch, hgt);
      const ok = cutPiece(z, h1) && (hgt - h1 < 1e-9 || cutPiece(z + pitch, hgt - h1));
      if (!ok) throw new Error("Le filet n’a pas pu être creusé à cet endroit : essaie une autre longueur ou un autre pas");
    }
  }
  return shape;
}

// Contours fermés de l'esquisse (sans traits de construction).
function closedItems(ents) {
  return ents.filter((o) => o.type !== "point" && !isOpen(o) && !o.construction).map((o) => ({ o, pts: outline(o) }));
}
// Dès qu'un trait ouvert (ligne, chemin, courbe ouverte) est dans l'esquisse, les zones sont cherchées
// trait par trait : plusieurs traits peuvent fermer un contour, et un trait peut couper un contour en deux.
const hasOpen = (ents) => ents.some((o) => !o.construction && isOpen(o));
const zoneCache = new WeakMap();
function zonesOf(ents) {
  let z = zoneCache.get(ents);
  if (!z) { const list = ents.filter((o) => !o.construction && o.type !== "point" && o.type !== "text"); z = { list, ...arrange(list) }; zoneCache.set(ents, z); }
  return z;
}
function loopDrawing(loop) {
  let pen = R.draw(loop[0].a);
  for (const sg of loop) pen = sg.arc ? pen.threePointsArcTo(sg.b, sg.arc.mid) : pen.lineTo(sg.b);
  return pen.close();
}
function zoneDrawing(z, f) {
  let d = f.whole >= 0 ? entityDrawing(z.list[f.whole]) : loopDrawing(f.loop);
  f.holes.forEach((hl, i) => { d = d.cut(f.holeWhole[i] >= 0 ? entityDrawing(z.list[f.holeWhole[i]]) : loopDrawing(hl)); });
  return d;
}
const textItems = (ents) => ents.filter((o) => o.type === "text" && !o.construction).map((o) => ({ o, pts: outline(o) }));
// Zone qui contient le point p : intersection des contours qui le contiennent, moins les autres.
function regionAt(items, p, ents) {
  if (ents && hasOpen(ents)) {
    const z = zonesOf(ents), f = faceAt(z.faces, p); if (!f) return null;
    let acc = zoneDrawing(z, f);
    for (const it of textItems(ents)) { const d = entityDrawing(it.o); acc = inPoly(p, it.pts) ? acc.intersect(d) : acc.cut(d); if (!acc.innerShape) return null; }
    return acc;
  }
  let acc = null;
  for (const it of items) if (inPoly(p, it.pts)) { const d = entityDrawing(it.o); acc = acc ? acc.intersect(d) : d; if (!acc.innerShape) return null; }
  if (!acc) return null;
  for (const it of items) if (!inPoly(p, it.pts)) { acc = acc.cut(entityDrawing(it.o)); if (!acc.innerShape) return null; }
  return acc;
}
// Toutes les zones délimitées par les contours (pour les cliquer en 3D).
function allRegions(ents) {
  let regs = [], union = null, items = closedItems(ents);
  if (hasOpen(ents)) {
    const z = zonesOf(ents); regs = z.faces.map((f) => zoneDrawing(z, f));
    items = textItems(ents);
    if (items.length) for (const r of regs) union = union ? union.fuse(r) : r;
  }
  for (const it of items) {
    const D = entityDrawing(it.o); const next = [];
    for (const r of regs) {
      const a = r.intersect(D); if (a.innerShape) next.push(a);
      const b = r.cut(D); if (b.innerShape) next.push(b);
    }
    const rest = union ? D.cut(union) : D; if (rest.innerShape) next.push(rest);
    union = union ? union.fuse(D) : D; regs = next;
  }
  return regs;
}
function sketchDrawing(ents, regions) {
  if (regions?.length) {
    const items = closedItems(ents); let acc = null;
    for (const p of regions) { const r = regionAt(items, p.map(Number), ents); if (r) acc = acc ? acc.fuse(r) : r; }
    if (!acc) throw new Error("Aucune zone choisie : clique à l’intérieur d’un contour");
    return acc;
  }
  const items = nestProfiles(ents).map((it) => ({ pts: it.pts, area: it.area, hole: it.hole, draw: () => entityDrawing(it.o) }));
  if (hasOpen(ents)) {
    // les traits ouverts qui se rejoignent forment aussi des contours : on prend le tour de chaque groupe fermé
    const open = arrange(ents.filter((o) => !o.construction && isOpen(o)));
    for (const o of open.outers) items.push({ pts: o.pts, area: o.area, draw: () => loopDrawing(o.loop) });
    items.sort((x, y) => y.area - x.area);
    items.forEach((it, i) => { let depth = 0; for (let j = 0; j < i; j++) if (inPoly(it.pts[0], items[j].pts)) depth++; it.hole = depth % 2 === 1; });
    if (!items.length) throw new Error("L’esquisse ne contient aucun contour fermé : les traits ne se rejoignent pas tous. Dans l’esquisse, les bouts libres sont entourés en orange");
  }
  if (!items.length) throw new Error("L’esquisse ne contient aucun contour fermé");
  let acc = null;
  for (const it of items) {
    const d = it.draw();
    if (!acc) acc = d; else acc = it.hole ? acc.cut(d) : acc.fuse(d);
  }
  return acc;
}

// ---------- Formes prêtes (boîte, cylindre, sphère…) ----------
// Chaque forme est construite posée sur sa base (centre de la base à l'origine, axe vers +Z),
// puis orientée (rx, ry, rz autour de ce point) et déplacée en (x, y, z).
const XZ = { origin: [0, 0, 0], x: [1, 0, 0], n: [0, -1, 0] };
function readyShape(f, vars) {
  const val = (k, d) => (f[k] === undefined || f[k] === "" ? d : evalExpr(f[k], vars));
  const pos = (k, d, label) => { const x = val(k, d); if (!(x > 0)) throw new Error(`${label} : il faut une valeur plus grande que 0`); return x; };
  const up = (d, h) => d.sketchOnPlane("XY").extrude(h);
  const turn = (d) => d.sketchOnPlane(rPlane(XZ)).revolve([0, 0, 1], { origin: [0, 0, 0] });
  const poly = (pts) => { let pen = R.draw(pts[0]); for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]); return pen.close(); };
  let s;
  const k = f.kind || "box";
  if (k === "box") {
    const a = pos("a", 40, "Longueur"), b = pos("b", 30, "Largeur"), h = pos("h", 20, "Hauteur"), r = Math.min(val("r", 0), Math.min(a, b) / 2 - 0.01);
    s = up(r > 0 ? R.drawRoundedRectangle(a, b, r) : R.drawRectangle(a, b), h);
  } else if (k === "cyl") {
    s = up(R.drawCircle(pos("d", 30, "Diamètre") / 2), pos("h", 30, "Hauteur"));
  } else if (k === "tube") {
    const d = pos("d", 30, "Diamètre"), t = pos("t", 3, "Épaisseur de la paroi"), h = pos("h", 30, "Hauteur");
    if (t >= d / 2) throw new Error("La paroi est plus épaisse que le rayon du tube");
    s = up(R.drawCircle(d / 2).cut(R.drawCircle(d / 2 - t)), h);
  } else if (k === "prism") {
    const n = Math.round(val("n", 6)); if (!(n >= 3 && n <= 60)) throw new Error("Le nombre de côtés doit être entre 3 et 60");
    s = up(R.drawPolysides(pos("d", 30, "Diamètre") / 2, n).rotate(-90, [0, 0]), pos("h", 20, "Hauteur"));
  } else if (k === "sphere") {
    const r = pos("d", 30, "Diamètre") / 2;
    s = R.makeSphere(r).translate([0, 0, r]);
  } else if (k === "cone") {
    const r1 = pos("d", 30, "Diamètre du bas") / 2, r2 = Math.max(0, val("d2", 0)) / 2, h = pos("h", 30, "Hauteur");
    s = turn(poly(r2 > 0.001 ? [[0, 0], [r1, 0], [r2, h], [0, h]] : [[0, 0], [r1, 0], [0, h]]));
  } else if (k === "torus") {
    const d = pos("d", 40, "Diamètre"), t = pos("t", 10, "Grosseur");
    if (t >= d / 2) throw new Error("L’anneau est trop gros pour son diamètre : il n’y a plus de trou au milieu");
    s = turn(R.drawCircle(t / 2).translate(d / 2 - t / 2, t / 2));
  } else if (k === "wedge") {
    const a = pos("a", 40, "Longueur"), b = pos("b", 30, "Largeur"), h = pos("h", 20, "Hauteur");
    s = poly([[-a / 2, 0], [a / 2, 0], [-a / 2, h]]).sketchOnPlane(rPlane(XZ)).extrude(b).translate([0, b / 2, 0]);
  } else if (k === "star") {
    const n = Math.round(val("n", 5)); if (!(n >= 3 && n <= 40)) throw new Error("Le nombre de branches doit être entre 3 et 40");
    const R1 = pos("d", 40, "Diamètre") / 2, R2 = R1 * Math.min(0.95, Math.max(0.1, val("q", 45) / 100));
    const pts = []; for (let i = 0; i < 2 * n; i++) { const a = Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? R2 : R1; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
    s = up(poly(pts), pos("h", 5, "Épaisseur"));
  } else if (k === "heart") {
    const W = pos("a", 40, "Largeur"), c = W / (1 + Math.SQRT2);
    const d = R.draw([0, 0]).lineTo([c, c]).threePointsArcTo([0, 2 * c], [c, 2 * c]).threePointsArcTo([-c, c], [-c, 2 * c]).close();
    s = up(d.translate(0, -c * 1.1), pos("h", 5, "Épaisseur"));
  } else if (k === "gear") {
    const n = Math.round(val("n", 16)); if (!(n >= 6 && n <= 120)) throw new Error("Le nombre de dents doit être entre 6 et 120");
    const m = pos("m", 2, "Taille des dents"), h = pos("h", 6, "Épaisseur"), bore = Math.max(0, val("d", 5));
    const Rp = (m * n) / 2, Rt = Rp + m, Rr = Rp - 1.25 * m, hp = Math.PI / (2 * n);
    if (bore >= 2 * Rr - 1) throw new Error("Le trou du centre est trop grand pour cet engrenage");
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      for (const [r, da] of [[Rr, -hp * 1.45], [Rp, -hp], [Rt, -hp * 0.48], [Rt, hp * 0.48], [Rp, hp], [Rr, hp * 1.45]]) pts.push([r * Math.cos(a + da), r * Math.sin(a + da)]);
    }
    let d = poly(pts); if (bore > 0) d = d.cut(R.drawCircle(bore / 2));
    s = up(d, h);
  } else if (k === "text") {
    const txt = String(f.txt ?? "Gabarit").trim(); if (!txt) throw new Error("Écris un texte");
    let d = R.drawText(txt, { startX: 0, startY: 0, fontSize: pos("s", 12, "Taille des lettres") / 0.73, fontFamily: "gabarit" });
    const [lo, hi] = d.boundingBox.bounds;
    s = up(d.translate(-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2), pos("h", 3, "Épaisseur"));
  } else if (k === "gridbin" || k === "gridplate") {
    // Gridfinity : cases de 42 mm, hauteur par unités de 7 mm. Le pied d'un bac fait 4,75 mm (0,8 en biais,
    // 1,8 droit, 2,15 en biais) ; la grille a le même profil en creux, haut de 4,65 mm.
    const a = Math.round(val("a", 2)), b = Math.round(val("b", 2));
    if (!(a >= 1 && a <= 8 && b >= 1 && b <= 8)) throw new Error("Le nombre de cases doit être entre 1 et 8 dans chaque sens");
    const rr = (w, r, z) => R.drawRoundedRectangle(w, w, r).sketchOnPlane("XY", z);
    const plate = k === "gridplate";
    // un pied (ou un creux) : trois tranches empilées
    const z1 = plate ? 0.7 : 0.8, z2 = z1 + 1.8, z3 = plate ? 4.65 : 4.75;
    const w0 = plate ? 36.3 : 35.6, w1 = plate ? 37.7 : 37.2, w2 = plate ? 41.9 : 41.5, r0 = plate ? 1.15 : 0.8, r1 = plate ? 1.85 : 1.6, r2 = plate ? 3.95 : 3.75;
    const one = () => rr(w0, r0, 0).loftWith(rr(w1, r1, z1), { ruled: true }).fuse(rr(w1, r1, z1).extrude(z2 - z1)).fuse(rr(w1, r1, z2).loftWith(rr(w2, r2, z3), { ruled: true }));
    const cell = one(); const cells = [];
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) cells.push(cell.clone().translate([(i - (a - 1) / 2) * 42, (j - (b - 1) / 2) * 42, 0]));
    if (plate) {
      s = R.drawRoundedRectangle(a * 42, b * 42, 4).sketchOnPlane("XY").extrude(4.65);
      for (const c of cells) s = s.cut(c);
    } else {
      const u = Math.round(val("u", 6)); if (!(u >= 2 && u <= 30)) throw new Error("La hauteur doit être entre 2 et 30 unités de 7 mm");
      const t = Math.max(0.8, Math.min(5, val("t", 1.2))); const W = a * 42 - 0.5, D = b * 42 - 0.5, H = u * 7;
      s = R.drawRoundedRectangle(W, D, 3.75).sketchOnPlane("XY", 4.75).extrude(H - 4.75);
      s = s.cut(R.drawRoundedRectangle(W - 2 * t, D - 2 * t, Math.max(0.5, 3.75 - t)).sketchOnPlane("XY", 7).extrude(H - 7 + 1));
      for (const c of cells) s = s.fuse(c);
    }
  } else if (k === "bac") {
    // un bac de rangement ouvert dessus, avec des séparations si on en veut
    const a = pos("a", 100, "Largeur"), b = pos("b", 80, "Profondeur"), h = pos("h", 40, "Hauteur"), t = pos("t", 1.6, "Épaisseur des parois");
    const nx = Math.round(val("nx", 1)), ny = Math.round(val("ny", 1));
    if (!(nx >= 1 && nx <= 12 && ny >= 1 && ny <= 12)) throw new Error("Le nombre de compartiments doit être entre 1 et 12 dans chaque sens");
    if (!(t * 2 < Math.min(a, b) - 1 && t < h - 0.5)) throw new Error("Les parois sont trop épaisses pour ce bac");
    const r = Math.max(0, Math.min(val("r", 3), Math.min(a, b) / 2 - 0.01)), ri = Math.max(0, r - t);
    const rect = (w, d, rad) => (rad > 0.01 ? R.drawRoundedRectangle(w, d, rad) : R.drawRectangle(w, d));
    s = up(rect(a, b, r), h).cut(rect(a - 2 * t, b - 2 * t, ri).sketchOnPlane("XY", t).extrude(h));
    for (let i = 1; i < nx; i++) s = s.fuse(R.drawRectangle(t, b - t).translate(-a / 2 + (a * i) / nx, 0).sketchOnPlane("XY").extrude(h));
    for (let j = 1; j < ny; j++) s = s.fuse(R.drawRectangle(a - t, t).translate(0, -b / 2 + (b * j) / ny).sketchOnPlane("XY").extrude(h));
  } else throw new Error("Forme inconnue");
  const rot = [val("rx", 0), val("ry", 0), val("rz", 0)];
  if (rot[0]) s = s.rotate(rot[0], [0, 0, 0], [1, 0, 0]);
  if (rot[1]) s = s.rotate(rot[1], [0, 0, 0], [0, 1, 0]);
  if (rot[2]) s = s.rotate(rot[2], [0, 0, 0], [0, 0, 1]);
  const t = [val("x", 0), val("y", 0), val("z", 0)];
  if (t.some(Boolean)) s = s.translate(t);
  return s;
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
const stretchCache = new Map(); // parties allongées : le résultat est gardé tant que rien ne change avant
// Zones d'une étape « Partie allongée », en chiffres (les zones sans effet sont laissées de côté).
export function stretchList(f, vars) {
  const zs = [];
  for (const z of f.zones || []) {
    const k = { x: 0, y: 1, z: 2 }[z.axis] ?? 2; const a = evalExpr(z.a ?? 0, vars), b = evalExpr(z.b ?? 0, vars), add = evalExpr(z.add || 0, vars);
    if (!(b > a + 0.01)) throw new Error("Partie à allonger : les deux traits sont au même endroit");
    if (!(add > -(b - a) + 0.01)) throw new Error("Partie à allonger : on ne peut pas la raccourcir plus que sa taille");
    if (Math.abs(add) > 1e-9) zs.push({ k, a, b, add });
  }
  // deux parties qui se recouvrent ne doivent pas, ensemble, retourner la matière
  for (let k = 0; k < 3; k++) {
    const on = zs.filter((z) => z.k === k); if (on.length < 2) continue;
    const cuts = [...new Set(on.flatMap((z) => [z.a, z.b]))].sort((p, q) => p - q), f = zoneMap(on, k);
    for (let i = 0; i + 1 < cuts.length; i++) if (!(f(cuts[i + 1]) - f(cuts[i]) > 0.01)) throw new Error("Deux parties à allonger se recouvrent et raccourcissent trop au même endroit");
  }
  return zs;
}

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

// Étire un STL binaire (ou texte) selon X, Y, Z.
function stretchStl(u8, k) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = u8.length >= 84 ? dv.getUint32(80, true) : 0;
  if (u8.length === 84 + n * 50) {
    const out = new Uint8Array(u8); const o = new DataView(out.buffer);
    for (let i = 0; i < n; i++) for (let v = 0; v < 3; v++) for (let c = 0; c < 3; c++) { const at = 84 + i * 50 + 12 + v * 12 + c * 4; o.setFloat32(at, dv.getFloat32(at, true) * k[c], true); }
    return out;
  }
  const txt = new TextDecoder().decode(u8).replace(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g, (_, x, y, z) => `vertex ${+x * k[0]} ${+y * k[1]} ${+z * k[2]}`);
  return new TextEncoder().encode(txt);
}
// STL → solide : on recoud les triangles (l'import de replicad échoue avec ce noyau),
// on ferme chaque coque en solide puis on fusionne les faces coplanaires.
let stlN = 0;
async function stlSolid(blob) {
  const oc = R.getOC(); const name = `/imp${stlN++}.stl`;
  oc.FS.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
  const reader = new oc.StlAPI_Reader(); const raw = new oc.TopoDS_Shape();
  const ok = reader.Read(raw, name); try { oc.FS.unlink(name); } catch { /* déjà supprimé */ }
  reader.delete();
  if (!ok) throw new Error("Fichier STL illisible");
  const sew = new oc.BRepBuilderAPI_Sewing(1e-4, true, true, true, false); sew.Add(raw);
  const pr = new oc.Message_ProgressRange(); sew.Perform(pr); pr.delete();
  const sewed = sew.SewedShape(); sew.delete(); raw.delete();
  const solids = [];
  const ex = new oc.TopExp_Explorer(sewed, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) {
    const fx = new oc.ShapeFix_Solid(); const so = fx.SolidFromShell(oc.TopoDS.Shell(ex.Current())); fx.delete();
    const u = new oc.ShapeUpgrade_UnifySameDomain(so, true, true, false); u.Build(); solids.push(R.cast(u.Shape())); u.delete();
  }
  ex.delete();
  if (!solids.length) throw new Error("Aucune forme fermée dans ce fichier");
  let s = solids[0]; for (let i = 1; i < solids.length; i++) { try { s = s.fuse(solids[i]); } catch { /* pièce à part */ } }
  return s;
}
export async function build(doc, opts = {}) {
  if (doc.features.some((f) => (f.type === "sketch" && (f.entities || []).some((e) => e.type === "text")) || (f.type === "shape" && f.kind === "text"))) await ensureFont();
  const vars = varsMap(doc.params);
  const errors = {}, sketches = {}, info = {}, tools = {};
  let shape = null;
  const stopAt = opts.stopAt ?? doc.features.length;
  const refs = refPlanes(doc.features, vars, stopAt);
  const P = (def) => resolvePlane(def, vars, refs);
  const getSketch = (id, what = "une esquisse") => { const sk = sketches[id]; if (!sk) throw new Error(`Choisis ${what} valide (placée avant cette fonction)`); return sk; };
  // « probe » : un point de la pièce finie. On note, après chaque étape qui change la pièce, la distance de ce
  // point à sa surface : l'étape qui a fait la face est la première depuis laquelle cette distance n'a plus bougé.
  const probe = opts.probe ? R.makeVertex(opts.probe) : null; const probed = []; let probedShape = null;
  const probeNow = (id) => {
    if (!probe || shape === probedShape) return; probedShape = shape; let d = Infinity;
    if (shape) { let comp = null, faces = []; try { faces = shape.faces; comp = R.makeCompound(faces); d = R.measureDistanceBetween(probe, comp); } catch { d = Infinity; } finally { try { comp?.delete(); for (const x of faces) x.delete(); } catch { /* déjà libéré */ } } }
    probed.push({ id, d });
  };
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
        const drawing = sketchDrawing(sk.ents, f.regions);
        let solid;
        if (f.type === "extrude" && f.end === "face") {
          solid = extrudeToFace(drawing, sk.pl, f, shape);
        } else if (f.type === "extrude") {
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
        const pe = path.ents.find((e) => (e.type === "path" || e.type === "spline") && !e.construction) || path.ents.find((e) => e.type === "poly" && !e.construction) || null;
        if (!pe) throw new Error("L’esquisse du chemin doit contenir un chemin, une courbe ou un contour libre");
        const pd = sketchDrawing(prof.ents);
        let spine;
        if (pe.type === "spline" && !pe.closed) {
          // une seule courbe lisse (B-spline) : le balayage reste propre d'un bout à l'autre
          const pts3 = outline(pe).map((q) => toWorld(path.pl, q[0], q[1]));
          spine = new R.Sketch(R.assembleWire([R.makeBSplineApproximation(pts3, { tolerance: 1e-3, degMax: 5 })]));
        } else spine = wireDrawing(pe).sketchOnPlane(rPlane(path.pl));
        const solid = spine.sweepSketch((plane, origin) => pd.sketchOnPlane(plane, origin), { frenet: true, transitionMode: "round" });
        apply(solid, f.mode, f.id);
      } else if (f.type === "rib") {
        need();
        const sk = getSketch(f.sketch, "une esquisse avec un trait (chemin)");
        apply(ribSolid(sk, evalExpr(f.t, vars), !!f.flip, shape), "add", f.id);
      } else if (f.type === "thread") {
        need();
        shape = threadCut(f, vars, shape);
      } else if (f.type === "helix") {
        const pl = P(f.plane);
        const D = evalExpr(f.d, vars), pitch = evalExpr(f.pitch, vars), H = evalExpr(f.height, vars), w = evalExpr(f.wire, vars);
        if (!(D > 0 && pitch > 0 && H > 0 && w > 0)) throw new Error("Toutes les valeurs doivent être plus grandes que 0");
        if (w >= pitch) throw new Error("Le fil est plus épais que le pas : les spires se touchent");
        if (w >= D) throw new Error("Le fil est plus épais que le diamètre du ressort");
        if (H / pitch > 200) throw new Error("Trop de spires (200 au maximum)");
        const c = toWorld(pl, evalExpr(f.cx || "0", vars), evalExpr(f.cy || "0", vars));
        apply(helixSweep(c, pl.n, D / 2, pitch, H, (u, v, d, start, tan) => R.assembleWire([R.makeCircle(w / 2, start, tan)])), f.mode || "add", f.id);
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
      } else if (f.type === "shape") {
        apply(readyShape(f, vars), f.mode || "add", f.id);
      } else if (f.type === "import") {
        if (!f.data) throw new Error("Aucun fichier importé");
        // étirement dans une seule direction (X, Y ou Z) : appliqué au maillage avant conversion
        const sxyz = [f.sx, f.sy, f.sz].map((v) => (v === undefined || v === "" ? 1 : evalExpr(v, vars)));
        if (sxyz.some((v) => !(v > 0))) throw new Error("Les tailles doivent être plus grandes que 0");
        const stretch = sxyz.some((v) => Math.abs(v - 1) > 1e-9);
        if (stretch && f.format !== "stl") throw new Error("Pour un fichier STEP, la taille ne peut changer que de façon égale dans les 3 directions (Échelle)");
        const sc = f.scale ? evalExpr(f.scale, vars) : 1;
        const rot = [f.rx, f.ry, f.rz].map((v) => (v ? evalExpr(v, vars) : 0));
        // zone à allonger : le milieu s'étire, les bouts gardent leur taille (travail sur le maillage)
        let zone = null;
        if (f.zone && f.format === "stl") {
          const k = { x: 0, y: 1, z: 2 }[f.zone.axis] ?? 0;
          const za = evalExpr(f.zone.a ?? 0, vars), zb = evalExpr(f.zone.b ?? 0, vars), zadd = evalExpr(f.zone.add || 0, vars);
          if (!(za >= 0)) throw new Error("Zone à allonger : le début ne peut pas être avant le bord de la pièce");
          if (!(zb > za + 0.01)) throw new Error("Zone à allonger : la fin doit être plus loin que le début");
          if (!(zadd > -(zb - za) + 0.01)) throw new Error("Zone à allonger : impossible de raccourcir plus que la longueur de la zone");
          if (Math.abs(zadd) > 1e-9) zone = { k, a: za, b: zb, add: zadd };
        }
        const key = f.id + ":" + f.data.length + ":" + sxyz.join(",") + (zone ? ":z" + [zone.k, zone.a, zone.b, zone.add, sc, ...rot].join(",") : "");
        let imp = importCache.get(f.id);
        if (!imp || imp.key !== key) {
          let bytes = decodeB64(f.data);
          if (stretch) bytes = stretchStl(bytes, sxyz);
          if (zone) {
            const m = bakeTris(readStl(bytes), sc, rot);
            if (zone.a >= m.hi[zone.k] - m.lo[zone.k]) throw new Error("Zone à allonger : elle commence après la fin de la pièce");
            bytes = writeStl(stretchZone(m.tris, zone.k, m.lo[zone.k] + zone.a, m.lo[zone.k] + zone.b, zone.add));
          }
          const blob = new Blob([bytes]);
          const s = f.format === "stl" ? await stlSolid(blob) : await R.importSTEP(blob);
          if (!s) throw new Error("Fichier illisible");
          imp = { key, shape: s }; importCache.set(f.id, imp);
        }
        let s = imp.shape.clone();
        if (sc !== 1 && !zone) s = s.scale(sc, [0, 0, 0]);
        if (rot.some(Boolean) && !zone) {
          const [lo, hi] = s.boundingBox.bounds; const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
          if (rot[0]) s = s.rotate(rot[0], c, [1, 0, 0]);
          if (rot[1]) s = s.rotate(rot[1], c, [0, 1, 0]);
          if (rot[2]) s = s.rotate(rot[2], c, [0, 0, 1]);
          const lo2 = s.boundingBox.bounds[0]; if (Math.abs(lo2[2] - lo[2]) > 1e-9) s = s.translate([0, 0, lo[2] - lo2[2]]); // reste posé au même niveau
        }
        const t = [f.tx, f.ty, f.tz].map((v) => (v ? evalExpr(v, vars) : 0));
        if (t.some(Boolean)) s = s.translate(t);
        { const [blo, bhi] = s.boundingBox.bounds; info[f.id] = { bb: [[...blo], [...bhi]] }; }
        apply(s, f.mode || "add", f.id);
      } else if (f.type === "scale") {
        // toute la pièce grandit ou rétrécit, proportions gardées ; elle reste posée au même endroit
        need();
        const k = evalExpr(f.k === undefined || f.k === "" ? 100 : f.k, vars) / 100;
        if (!(k > 0.001)) throw new Error("La taille doit être plus grande que 0 %");
        const [lo, hi] = shape.boundingBox.bounds; info[f.id] = { bb: [[...lo], [...hi]] };
        if (Math.abs(k - 1) > 1e-9) shape = shape.scale(k, [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]]);
      } else if (f.type === "orient") {
        // toute la pièce est tournée par quarts de tour (et retournée dans un miroir au besoin) ; elle reste
        // posée au même endroit : même centre au sol, même niveau
        need();
        const m = oread(f.m);
        const [lo, hi] = shape.boundingBox.bounds; info[f.id] = { bb: [[...lo], [...hi]] };
        if (!osame(m, IDENT)) {
          const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]];
          let s = shape, r = m;
          if (odet(m) < 0) { s = s.mirror([1, 0, 0], c); r = omul(m, MOVES.miroir); }
          const { axis, deg } = axisAngle(r);
          if (deg) s = s.rotate(deg, c, axis);
          const [l2, h2] = s.boundingBox.bounds; const d = [c[0] - (l2[0] + h2[0]) / 2, c[1] - (l2[1] + h2[1]) / 2, lo[2] - l2[2]];
          if (d.some((v) => Math.abs(v) > 1e-9)) s = s.translate(d);
          shape = s;
        }
      } else if (f.type === "fit") {
        // la pièce est étirée, sens par sens, jusqu'à la taille demandée (pour remplir un meuble). Les trois sens
        // du même facteur : simple changement de taille. Sinon on étire le maillage et on refait un solide.
        need();
        const [lo, hi] = shape.boundingBox.bounds; info[f.id] = { bb: [[...lo], [...hi]] };
        const want = ["x", "y", "z"].map((a) => (f[a] === undefined || f[a] === null || f[a] === "" ? null : evalExpr(f[a], vars)));
        if (want.some((w) => w !== null && !(w > 0.01))) throw new Error("La taille à remplir doit être plus grande que 0");
        if (want.some((w) => w !== null)) {
          const before = doc.features.slice(0, idx).filter((g) => !g.suppressed);
          const key = JSON.stringify([doc.params, before, want], (kk, v) => (kk === "data" && typeof v === "string" ? v.length : v));
          let hit = stretchCache.get(f.id);
          if (!hit || hit.key !== key) {
            const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
            const stl = shape.blobSTL({ tolerance: size / 4000, angularTolerance: 0.08, binary: true });
            const tris = Array.from(readStl(new Uint8Array(await stl.arrayBuffer())));
            // la vraie boîte de la pièce, lue sur le maillage
            const a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity];
            for (let i = 0; i < tris.length; i++) { const c = i % 3; if (tris[i] < a[c]) a[c] = tris[i]; if (tris[i] > b[c]) b[c] = tris[i]; }
            const k = want.map((w, i) => (w === null || !(b[i] - a[i] > 1e-9) ? 1 : w / (b[i] - a[i])));
            let s2 = null;
            if (k.every((v) => Math.abs(v - 1) < 1e-9)) s2 = null;
            else if (Math.abs(k[0] - k[1]) < 1e-9 && Math.abs(k[1] - k[2]) < 1e-9) s2 = shape.clone().scale(k[0], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2]]);
            else {
              const o = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2]];
              for (let i = 0; i < tris.length; i++) { const c = i % 3; tris[i] = o[c] + (tris[i] - o[c]) * k[c]; }
              s2 = await stlSolid(new Blob([writeStl(tris)]));
              if (!s2) throw new Error("La pièce n’a pas pu être étirée");
            }
            hit = { key, shape: s2 }; stretchCache.set(f.id, hit);
          }
          if (hit.shape) shape = hit.shape.clone();
        }
      } else if (f.type === "stretch") {
        // parties allongées : on travaille sur le maillage de la pièce (les triangles sont coupés aux traits,
        // puis déplacés), et on refait un solide. Sans changement de taille, la pièce n'est pas touchée.
        need();
        const zs = stretchList(f, vars);
        { const [lo, hi] = shape.boundingBox.bounds; info[f.id] = { bb: [[...lo], [...hi]] }; }
        if (zs.length) {
          const before = doc.features.slice(0, idx).filter((g) => !g.suppressed);
          const key = JSON.stringify([doc.params, before, zs], (kk, v) => (kk === "data" && typeof v === "string" ? v.length : v));
          let hit = stretchCache.get(f.id);
          if (!hit || hit.key !== key) {
            const [lo, hi] = shape.boundingBox.bounds; const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
            const stl = shape.blobSTL({ tolerance: size / 4000, angularTolerance: 0.08, binary: true });
            const tris = stretchZones(readStl(new Uint8Array(await stl.arrayBuffer())), zs);
            const s2 = await stlSolid(new Blob([writeStl(tris)]));
            if (!s2) throw new Error("Cette partie n’a pas pu être allongée");
            hit = { key, shape: s2 }; stretchCache.set(f.id, hit);
          }
          shape = hit.shape.clone();
        }
      } else if (f.type === "slice") {
        // coupe à plat : on enlève tout ce qui dépasse d'un côté d'un plan perpendiculaire à X, Y ou Z
        need();
        const k = { x: 0, y: 1, z: 2 }[f.axis] ?? 2; const at = evalExpr(f.at ?? 0, vars);
        const [lo, hi] = shape.boundingBox.bounds; const m = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 0.1 + 1;
        const a = [lo[0] - m, lo[1] - m, lo[2] - m], b = [hi[0] + m, hi[1] + m, hi[2] + m];
        if (f.keep === "above") b[k] = at; else a[k] = at;
        info[f.id] = { bb: [[...lo], [...hi]] };
        if (at <= lo[k] + 1e-6 || at >= hi[k] - 1e-6) {
          const gone = f.keep === "above" ? at >= hi[k] - 1e-6 : at <= lo[k] + 1e-6;
          if (gone) throw new Error("La coupe enlèverait toute la pièce : rapproche le plan du milieu ou garde l’autre côté");
        } else shape = shape.cut(R.makeBox(a, b));
      }
    } catch (e) {
      if (globalThis.GABARIT_DEBUG) console.error(f.id, e);
      errors[f.id] = humanError(e);
    }
    probeNow(f.id);
  }
  let owner = null;
  if (probed.length) { const last = probed[probed.length - 1].d; if (isFinite(last)) for (let i = probed.length - 1; i >= 0 && Math.abs(probed[i].d - last) < 1e-5; i--) owner = probed[i].id; }
  lastShape = shape;
  let regions;
  if (opts.regionsOf && sketches[opts.regionsOf]) {
    const sk = sketches[opts.regionsOf]; regions = [];
    try {
      for (const d of allRegions(sk.ents)) {
        const so = d.sketchOnPlane(rPlane(sk.pl)); const list = so.sketches || [so];
        const tris = [];
        for (const one of list) {
          const m = one.face().mesh({ tolerance: 0.05, angularTolerance: 0.2 });
          for (const t of m.triangles) tris.push(m.vertices[t * 3], m.vertices[t * 3 + 1], m.vertices[t * 3 + 2]);
        }
        regions.push(new Float32Array(tris));
      }
    } catch (e) { if (globalThis.GABARIT_DEBUG) console.error(e); }
  }
  return { shape, errors, sketches, info, regions, owner };
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
  // Beaucoup de faces (maillage importé) : on lit les plans directement dans le maillage,
  // l'interrogation face par face du noyau serait beaucoup trop lente.
  const many = m.faceGroups.length > 1500;
  if (many) {
    const V = m.vertices, T = m.triangles;
    for (const g of m.faceGroups) {
      let n0 = null, flat = true, cx = 0, cy = 0, cz = 0, k = 0;
      for (let t = g.start; t < g.start + g.count; t += 3) {
        const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
        const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz); if (L < 1e-12) continue;
        nx /= L; ny /= L; nz /= L;
        if (!n0) n0 = [nx, ny, nz]; else if (nx * n0[0] + ny * n0[1] + nz * n0[2] < 0.99999) { flat = false; break; }
        cx += V[a] + V[b] + V[c]; cy += V[a + 1] + V[b + 1] + V[c + 1]; cz += V[a + 2] + V[b + 2] + V[c + 2]; k += 3;
      }
      if (flat && n0 && k) faces[g.faceId] = { plane: true, c: [cx / k, cy / k, cz / k], n: n0 };
    }
  }
  for (const fc of many ? [] : shape.faces) {
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

function fineMesh(shape) {
  const size = sizeOf(shape);
  const m = shape.mesh({ tolerance: size / 5000, angularTolerance: 0.05 });
  return { vertices: m.vertices, triangles: m.triangles };
}
// Tourne la pièce pour poser la direction g vers le bas, puis la pose sur z = 0.
function onBed(shape, g) {
  const t = [0, 0, -1]; const c = dot(g, t); let s = shape.clone();
  if (c < 0.999999) {
    let ax = cross(g, t); if (Math.hypot(...ax) < 1e-9) ax = [1, 0, 0];
    s = s.rotate(Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI, [0, 0, 0], unit(ax));
  }
  const [lo, hi] = s.boundingBox.bounds;
  return s.translate([-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]]);
}
export function exportShape(kind, opts = {}) {
  if (!lastShape) throw new Error("Rien à exporter : la pièce est vide");
  if (kind === "step") return lastShape.blobSTEP();
  if (opts.down) { const keep = lastShape; try { lastShape = onBed(keep, opts.down); return exportShape(kind, { ...opts, down: null }); } finally { lastShape = keep; } }
  if (kind === "obj") return objText(fineMesh(lastShape), opts.name || "piece");
  if (kind === "3mf") return threeMF([{ name: opts.name || "piece", ...fineMesh(lastShape) }]);
  const size = sizeOf(lastShape);
  return lastShape.blobSTL({ tolerance: opts.fine ? size / 5000 : size / 1500, angularTolerance: opts.fine ? 0.05 : 0.15, binary: true });
}

// Vues 2D pour la mise en plan (arêtes visibles et cachées).
// Cercles vus de face (trous et cylindres dont l'axe regarde la vue), en coordonnées de la vue.
function viewCircles(cam) {
  const dir = unit([cam.direction.x, cam.direction.y, cam.direction.z]), xA = unit([cam.xAxis.x, cam.xAxis.y, cam.xAxis.z]);
  const yA = cross(dir, xA); const out = [];
  const oc = R.getOC();
  for (const fc of lastShape.faces) {
    if (fc.geomType !== "CYLINDRE") continue;
    try {
      const ad = new oc.BRepAdaptor_Surface(fc.wrapped, true); const cy = ad.Cylinder(); const ax = cy.Axis();
      const l = ax.Location(), d = ax.Direction(); const p = [l.X(), l.Y(), l.Z()], dv = [d.X(), d.Y(), d.Z()], r = cy.Radius(); ad.delete();
      if (Math.abs(dot(dv, dir)) < 0.9999) continue;
      // seulement les cylindres complets (pas les congés, qui sont des morceaux de cylindre)
      const ts = []; for (const ed of fc.edges) for (const q of [ed.startPoint, ed.endPoint]) ts.push(dot(v3.sub([q.x, q.y, q.z], p), dv));
      const L = Math.max(...ts) - Math.min(...ts);
      if (!(L > 1e-6) || R.measureArea(fc) < 0.97 * 2 * Math.PI * r * L) continue;
      const e = fc.edges[0]; const q = e.startPoint; const qp = [q.x, q.y, q.z];
      const w = v3.sub(qp, p); const radial = v3.sub(w, v3.mul(dv, dot(w, dv)));
      const nv = fc.normalAt(q); const hole = dot([nv.x, nv.y, nv.z], radial) < 0;
      const u = dot(p, xA), v = dot(p, yA);
      if (!out.some((c) => Math.abs(c.u - u) < 1e-4 && Math.abs(c.v - v) < 1e-4 && Math.abs(c.r - r) < 1e-4)) out.push({ u, v, r, hole });
    } catch { /* face ignorée */ }
  }
  return out;
}
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
    out[n] = { visible: paths(visible), hidden: paths(hidden), bounds: bb.bounds, circles: n === "iso" ? [] : viewCircles(cams[n]) };
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
    shape = c.src.kind === "stl" ? await stlSolid(blob) : await R.importSTEP(blob);
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
  if (kind === "3mf") return threeMF(items.map((i) => ({ name: i.name, ...fineMesh(i.shape) })));
  if (kind === "obj") return objText(fineMesh(R.makeCompound(items.map((i) => i.shape))), "assemblage");
  const comp = R.makeCompound(items.map((i) => i.shape));
  return comp.blobSTL({ tolerance: 0.05, angularTolerance: 0.1, binary: true });
}
