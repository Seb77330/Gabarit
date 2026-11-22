import { arrange, faceAt, insidePoint, sagArc, sagOf, splitAll } from "../src/regions.js";
import { cornerFillet, roundCorners, outline, polyArea } from "../src/geo.js";
import { FURNITURE, STORES, findFurniture, isOpenKind, fitCheck, bestOrient, placeAt, magnet, packFit, gridCells } from "../src/furniture.js";
import { IDENT, MOVES, POSES, omul, odet, oapply, osame, oread, axisAngle, orientedBox } from "../src/orient.js";
let fails = 0; const ok = (c, m, x) => { console.log((c ? "ok : " : "ÉCHEC : ") + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); if (!c) fails++; };
const near = (a, b, t = 1e-3) => Math.abs(a - b) < t;
const areas = (ar) => ar.faces.map((f) => +f.area.toFixed(4)).sort((a, b) => a - b);
const rect = (cx, cy, w, h, r = 0, a = 0) => ({ type: "rect", cx, cy, w, h, r, a });
const path = (...pts) => ({ type: "path", pts });
const circle = (cx, cy, d) => ({ type: "circle", cx, cy, d });
let ar;
ar = arrange([rect(0, 0, 40, 20)]); ok(ar.faces.length === 1 && near(ar.faces[0].area, 800) && ar.faces[0].whole === 0, "rectangle seul : une zone de 800 mm², forme entière", areas(ar));
ar = arrange([rect(0, 0, 40, 20), path([0, -10], [0, 10])]); ok(ar.faces.length === 2 && areas(ar).every((a) => near(a, 400)) && ar.faces.every((f) => f.whole < 0), "rectangle coupé par un trait : deux zones de 400", areas(ar));
ar = arrange([rect(0, 0, 40, 20), path([0, -15], [0, 15])]); ok(ar.faces.length === 2 && areas(ar).every((a) => near(a, 400)), "trait qui dépasse des deux côtés : deux zones", areas(ar));
ar = arrange([rect(0, 0, 40, 20), path([0, -10], [0, 5])]); ok(ar.faces.length === 1 && near(ar.faces[0].area, 800) && ar.ends.length === 1, "trait qui s'arrête dans le rectangle : une zone, un bout libre", [areas(ar), ar.ends]);
ar = arrange([path([0, 0], [30, 0]), path([30, 0], [30, 20]), path([30, 20], [0, 20]), path([0, 20], [0, 0])]); ok(ar.faces.length === 1 && near(ar.faces[0].area, 600) && ar.ends.length === 0, "quatre traits séparés : une zone de 600", areas(ar));
ar = arrange([path([0, 0], [30, 0], [30, 20], [0, 20]), path([0, 20], [0, 0])]); ok(ar.faces.length === 1 && near(ar.faces[0].area, 600), "ligne en 3 côtés + un trait : une zone", areas(ar));
ar = arrange([path([0, 0], [30, 0], [30, 20], [0, 20]), path([0, 19.9], [0, 0])]); ok(ar.faces.length === 0 && ar.ends.length === 2, "contour pas fermé (0,1 mm d'écart) : aucune zone, deux bouts libres", [areas(ar), ar.ends.length]);
ar = arrange([circle(0, 0, 20)]); ok(ar.faces.length === 1 && near(ar.faces[0].area, Math.PI * 100) && ar.faces[0].whole === 0, "cercle seul", areas(ar));
ar = arrange([circle(0, 0, 20), path([-15, 0], [15, 0])]); ok(ar.faces.length === 2 && areas(ar).every((a) => near(a, Math.PI * 50)), "cercle coupé par un diamètre : deux demi-disques", areas(ar));
ar = arrange([circle(0, 0, 20), path([-15, 5], [15, 5])]);
{ const seg = 100 * Math.acos(0.5) - 5 * Math.sqrt(75); ok(ar.faces.length === 2 && near(areas(ar)[0], seg, 1e-4) && near(areas(ar)[1], Math.PI * 100 - seg, 1e-4), "cercle coupé par une corde : aires exactes", areas(ar)); }
ar = arrange([circle(0, 0, 20), circle(10, 0, 20)]);
{ const lens = 2 * (100 * Math.acos(0.5) - 5 * Math.sqrt(75)); ok(ar.faces.length === 3 && near(areas(ar)[0], lens, 1e-4), "deux cercles qui se croisent : trois zones, lentille exacte", areas(ar)); }
ar = arrange([rect(0, 0, 40, 20), circle(0, 0, 10)]); ok(ar.faces.length === 2 && near(areas(ar)[0], Math.PI * 25) && near(areas(ar)[1], 800 - Math.PI * 25) && ar.faces.find((f) => f.holes.length)?.holeWhole[0] === 1, "cercle dans un rectangle : la zone autour a un trou", areas(ar));
ar = arrange([rect(0, 0, 40, 20), circle(0, 0, 10), path([-20, 0], [-5, 0])]); ok(ar.faces.length === 2 && near(areas(ar)[1], 800 - Math.PI * 25), "trait qui relie le bord au cercle : il ne ferme rien", areas(ar));
ar = arrange([rect(0, 0, 40, 20), rect(20, 0, 40, 20)]); ok(ar.faces.length === 3 && areas(ar).join() === "400,400,400", "deux rectangles qui se chevauchent : trois zones", areas(ar));
ar = arrange([rect(0, 0, 40, 20), rect(40, 0, 40, 20), path([0, 10], [0, -10])]); ok(ar.faces.length === 3 && areas(ar).join() === "400,400,800", "deux rectangles côte à côte (bord commun) + un trait", areas(ar));
ar = arrange([rect(0, 0, 40, 20), path([-20, -10], [20, -10])]); ok(ar.faces.length === 1 && near(ar.faces[0].area, 800), "trait posé sur un bord : toujours une zone", areas(ar));
ar = arrange([rect(0, 0, 40, 20, 4), path([0, -10], [0, 10])]); ok(ar.faces.length === 2 && near(areas(ar)[0], (800 - (16 - Math.PI * 4) * 4) / 2, 1e-4), "rectangle arrondi coupé en deux", areas(ar));
ar = arrange([rect(0, 0, 40, 20, 0, 30), path([0, -30], [0, 30])]); ok(ar.faces.length === 2 && near(areas(ar)[0] + areas(ar)[1], 800, 1e-4), "rectangle incliné coupé", areas(ar));
ar = arrange([path([0, 0], [10, 0]), path([10, 0], [10, 10]), path([10, 10], [0, 10]), path([0, 10], [0, 0]), path([5, 0], [5, 10]), path([0, 5], [10, 5])]); ok(ar.faces.length === 4 && areas(ar).every((a) => near(a, 25)), "grille 2 × 2 en traits : quatre zones de 25", areas(ar));
ar = arrange([{ type: "poly", pts: [[0, 0, -5], [20, 0]] , r: 0 }]); ok(ar.faces.length === 1, "contour à 2 points avec un côté courbe", areas(ar));
{ const a = sagArc([0, 0], [20, 0], -5); ok(near(sagOf(a), -5) && near(a.c[1], a.r - 5), "arc par sa flèche : flèche et centre cohérents", [sagOf(a), a.c, a.r]); }
ar = arrange([rect(0, 0, 40, 20), path([-20, 10, 6], [20, 10])]); ok(ar.faces.length === 2, "arc posé sur un côté (bombé vers l'extérieur) : deux zones", areas(ar));
ar = arrange([circle(0, 0, 20), path([10, -15], [10, 15])]); ok(ar.faces.length === 1 && near(ar.faces[0].area, Math.PI * 100), "trait tangent à un cercle : une seule zone", areas(ar));
ar = arrange([{ type: "ellipse", cx: 0, cy: 0, rx: 20, ry: 10, a: 0 }, path([0, -15], [0, 15])]); ok(ar.faces.length === 2 && near(areas(ar)[0], Math.PI * 100, 0.5), "ellipse coupée (approchée)", areas(ar));
ar = arrange([{ type: "ellipse", cx: 0, cy: 0, rx: 20, ry: 10, a: 0 }, path([30, 0], [40, 0], [40, 10], [30, 10], [30, 0])]); ok(ar.faces.length === 2 && ar.faces.some((f) => f.whole === 0), "ellipse non coupée : gardée exacte", ar.faces.map((f) => f.whole));
ar = arrange([rect(0, 0, 40, 20), path([0, -10], [0, 10])]); { const f = faceAt(ar.faces, [-5, 2]); const p = insidePoint(f); ok(f && p && faceAt(ar.faces, p) === f && p[0] < 0, "zone sous un point et point intérieur", p); }
{ const f = cornerFillet([0, 0], [10, 0], [0, 10], 2); ok(f && near(f.t1[0], 2) && near(f.t2[1], 2) && near(Math.abs(f.s), 2 * (1 - Math.SQRT1_2)), "arrondi d'un coin droit : tangences à 2 mm", f); }
ar = arrange([{ type: "poly", pts: [[0, 0], [20, 0], [20, 10], [0, 10]], r: 2 }, path([10, 0], [10, 10])]); ok(ar.faces.length === 2 && near(areas(ar)[0], (200 - (16 - Math.PI * 4)) / 2, 1e-4), "contour libre aux coins arrondis, coupé", areas(ar));
{ const P = roundCorners([[0, 0], [20, 0, 0, 3], [20, 10], [0, 10]], true); ok(P.length === 5 && near(P[1][0], 17) && near(P[2][1], 3) && near(Math.abs(P[1][2]), 3 * (1 - Math.SQRT1_2)), "un seul coin arrondi : 5 points, tangences à 3 mm", P); }
{ const a = Math.abs(polyArea(outline({ type: "poly", pts: [[0, 0], [20, 0, 0, 3], [20, 10], [0, 10]], r: 0 }))); ok(near(a, 200 - (9 - Math.PI * 9 / 4), 0.02), "aperçu du contour avec son coin arrondi", a); }
ar = arrange([{ type: "poly", pts: [[0, 0], [20, 0, 0, 3], [20, 10, 0, 3], [0, 10]], r: 0 }]); ok(ar.faces.length === 1 && near(ar.faces[0].area, 200 - 2 * (9 - Math.PI * 9 / 4), 1e-4), "deux coins arrondis : aire exacte", areas(ar));
{ const P = roundCorners([[0, 0], [20, 0, 0, 6], [20, 10, 0, 6], [0, 10]], true); ok(P.length === 4, "deux arrondis de 6 mm sur un côté de 10 : laissés vifs", P.length); }
{ const P = roundCorners([[0, 0], [20, 0, 0, 5], [20, 10, 0, 5], [0, 10]], true); ok(P.length === 5, "deux arrondis de 5 mm sur un côté de 10 : ils se rejoignent (5 points)", P); }
ar = arrange([{ type: "path", pts: [[0, 0], [20, 0, 0, 4], [20, 10]] }, { type: "path", pts: [[20, 10], [0, 10], [0, 0]] }]); ok(ar.faces.length === 1 && near(ar.faces[0].area, 200 - (16 - Math.PI * 4), 1e-4), "chemin avec coin arrondi + chemin : une zone", areas(ar));
// performance
{ const ents = []; for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) ents.push(circle(i * 7, j * 7, 10)); const t = Date.now(); ar = arrange(ents); ok(Date.now() - t < 3000, `144 cercles qui se croisent : ${ar.faces.length} zones en ${Date.now() - t} ms`); }
// ---------- essai dans un meuble, sens de pose ----------
{
  const bb = [[-10, 0, 5], [50, 30, 205]]; // 60 × 30 × 200, pas centrée
  ok(orientedBox(bb, IDENT).size.join() === "60,30,200", "sens : debout, la pièce garde ses dimensions");
  ok(orientedBox(bb, MOVES.gauche).size.join() === "30,60,200", "sens : un quart de tour échange largeur et profondeur");
  ok(orientedBox(bb, MOVES.avant).size.join() === "60,200,30", "sens : couchée vers l'avant, la hauteur part en profondeur");
  ok(orientedBox(bb, MOVES.cote).size.join() === "200,30,60", "sens : couchée sur le côté, la hauteur part en largeur");
  ok(oapply(MOVES.gauche, [1, 0, 0]).join() === "0,1,0" && oapply(MOVES.cote, [0, 0, 1]).join() === "1,0,0" && oapply(MOVES.avant, [0, 0, 1]).join() === "0,-1,0", "sens : à gauche X part vers le fond, sur le côté le haut part à droite, vers l'avant le haut part devant");
  let m = IDENT; for (let i = 0; i < 4; i++) m = omul(MOVES.gauche, m); ok(osame(m, IDENT), "sens : quatre quarts de tour reviennent au départ");
  ok(osame(omul(MOVES.gauche, MOVES.gauche), MOVES.demi) && osame(omul(MOVES.miroir, MOVES.miroir), IDENT) && odet(MOVES.miroir) === -1 && odet(MOVES.cote) === 1, "sens : deux quarts font un demi-tour, deux miroirs s'annulent");
  // l'axe et l'angle donnés au noyau refont bien la matrice (formule de Rodrigues), pour les 24 rotations
  const all = []; const seen = new Set(); const todo = [IDENT];
  while (todo.length) { const x = todo.pop(); const k = x.join(); if (seen.has(k)) continue; seen.add(k); all.push(x); for (const g of [MOVES.gauche, MOVES.cote, MOVES.avant]) todo.push(omul(g, x)); }
  const rod = ({ axis: [x, y, z], deg }, v) => { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), d = (x * v[0] + y * v[1] + z * v[2]) * (1 - c); const cr = [y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0]]; return [v[0] * c + cr[0] * s + x * d, v[1] * c + cr[1] * s + y * d, v[2] * c + cr[2] * s + z * d]; };
  ok(all.length === 24 && all.every((r) => { const a = rod(axisAngle(r), [1, 2, 3]), b = oapply(r, [1, 2, 3]); return a.every((c, i) => near(c, b[i], 1e-9)); }), "sens : les 24 rotations passent au noyau sans erreur", all.length);
  ok(osame(oread([0, 2, 0, 1, 0, 0, 0, 0, 1]), IDENT) && osame(oread("x"), IDENT) && osame(oread(MOVES.cote), MOVES.cote), "sens : une orientation abîmée dans un fichier redevient « droite »");
  ok(POSES.length === 6 && new Set(POSES.map((p) => orientedBox([[0, 0, 0], [1, 2, 3]], p).size.join())).size === 6, "sens : les 6 poses donnent 6 encombrements différents");
  const kallax = findFurniture("kallax").size;
  let r = fitCheck([60, 30, 200], kallax);
  ok(r.fits && near(r.rest[0], 275) && near(r.rest[1], 360) && near(r.rest[2], 135) && r.count.join() === "5,13,1" && r.total === 65, "meuble : 60 × 30 × 200 rentre dans une case Kallax, 65 exemplaires", r);
  ok(near(r.grow(0), 1.675) && near(r.grow(1), 1.67) && near(r.grow(0, [2]), 335 / 60) && r.grow(0, [0, 1, 2]) === Infinity, "meuble : elle peut grandir jusqu'à 167 %, ou plus si la hauteur est déjà remplie", [r.grow(0), r.grow(1)]);
  r = fitCheck([60, 30, 400], kallax); ok(!r.fits && near(r.rest[2], -65) && r.total === 0, "meuble : 400 mm de haut ne rentre pas, il manque 65 mm");
  r = fitCheck([335, 390, 335], kallax); ok(r.fits && r.total === 1, "meuble : une pièce exactement à la taille de la case rentre");
  r = fitCheck([600, 300, 5000], [1200, 600, 1000], true); ok(r.fits && r.count.join() === "2,2,1" && near(r.grow(0), 2), "meuble : sur un plateau, la hauteur ne compte pas", r);
  let b = bestOrient([[0, 0, 0], [60, 30, 380]], kallax);
  ok(b.fits && !b.same && orientedBox([[0, 0, 0], [60, 30, 380]], b.m).size[1] === 380, "meuble : trop haute debout, le bon sens la couche dans la profondeur", b);
  b = bestOrient([[0, 0, 0], [500, 500, 500]], kallax); ok(!b.fits, "meuble : un cube de 500 ne rentre dans aucun sens");
  b = bestOrient([[0, 0, 0], [60, 30, 100]], kallax); ok(b.fits && b.m !== IDENT, "meuble : le bon sens est celui où on en range le plus");
  // placer et aimant
  ok(placeAt(0, 335, 60) === 0 && placeAt(100, 335, 60) === 275 && near(placeAt(50, 335, 60), 137.5) && near(placeAt(25, 400, 100), 50) && placeAt(5, 400, 100) === 0, "placer : 0 % à gauche, 100 % à droite, 50 % au centre, jamais à travers la paroi");
  ok(placeAt(50, 100, 160) === -30 && placeAt(50, 100, 160, true) === -60, "placer : trop grande, elle est centrée (ou poussée au fond)");
  ok(magnet(4, 335, 60, 10).join() === "0,0" && magnet(270, 335, 60, 10).join() === "275,100" && magnet(140, 335, 60, 10).join() === "137.5,50" && magnet(80, 335, 60, 10).join() === "80," , "aimant : colle à gauche, à droite et au centre, sinon laisse libre", magnet(80, 335, 60, 10));
  // en ranger plusieurs, Gridfinity
  let pk = packFit([100, 100, 50], [335, 390, 335], 3); ok(pk.k >= 1 && near(pk.k, Math.min(335 / 200, 390 / 200)) && pk.a * pk.b >= 3, "ranger : 3 pièces de 100 tiennent, et peuvent grandir", pk);
  pk = packFit([200, 100, 50], [335, 390, 335], 3, 1); ok(near(pk.k, 389 / 300) && pk.a === 1 && pk.b === 3, "ranger : 3 pièces larges se mettent l'une derrière l'autre, 1 mm de jeu compris", pk);
  pk = packFit([300, 300, 50], [335, 390, 335], 4); ok(pk.k < 1 && near(pk.k, Math.min(335 / 600, 390 / 600)), "ranger : 4 grandes pièces doivent être réduites", pk);
  pk = packFit([100, 100, 5000], [1200, 600, 1000], 2, 0, true); ok(near(pk.k, 6), "ranger : sur un plateau la hauteur ne limite pas", pk);
  ok(gridCells([338, 520, 70]).join() === "8,12" && gridCells([41, 100, 10]).join() === "0,2" && gridCells([84, 84, 10]).join() === "2,2", "Gridfinity : 8 × 12 cases dans un tiroir Maximera de 40 cm");
  ok(findFurniture("maximera60bas").size.join() === "538,520,70" && findFurniture("maximera80p37").size.join() === "738,290,70", "meuble : tiroirs Metod de 60 et de 80 cm");
  const items = FURNITURE.flatMap((g) => g.items);
  ok(items.every((it) => it.size.length === 3 && it.size.every((v) => v > 10 && v < 3000)) && new Set(items.map((it) => it.key)).size === items.length, "meuble : chaque modèle a 3 dimensions plausibles et une clé unique");
  const ikea = STORES.find((x) => x.key === "ikea");
  ok(ikea.types.length === 6 && ikea.types.reduce((n, t) => n + t.items.length, 0) >= 50 && ikea.types.find((t) => t.key === "bureaux").items.every((it) => it.kind === "top" && isOpenKind(it.kind)), "meuble : IKEA a 6 types, au moins 50 modèles, et des bureaux sans limite de hauteur");
}
console.log(fails ? `ÉCHECS ${fails}` : "TOUT OK");
