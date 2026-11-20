import { solveSketch, writeBack } from "./src/constraints.js";
import { evalEntity } from "./src/geo.js";
const raws = [{ id: "p", type: "poly", r: 0, pts: [[0, 0], [41, 3], [39, 22], [-2, 19]] }, { id: "c", type: "circle", cx: 5, cy: 5, d: 6 }];
const cons = [
  { id: "1", type: "horizontal", refs: [{ e: "p", k: 0 }] },
  { id: "2", type: "vertical", refs: [{ e: "p", k: 1 }] },
  { id: "3", type: "parallel", refs: [{ e: "p", k: 0 }, { e: "p", k: 2 }] },
  { id: "4", type: "perpendicular", refs: [{ e: "p", k: 3 }, { e: "p", k: 0 }] },
  { id: "5", type: "length", refs: [{ e: "p", k: 0 }], value: "L" },
  { id: "6", type: "length", refs: [{ e: "p", k: 1 }], value: "20" },
  { id: "7", type: "coincident", refs: [{ e: "p", k: 0 }, { e: "origin" }] },
  { id: "8", type: "coincident", refs: [{ e: "c", k: "c" }, { e: "p", k: 2 }] },
];
const ents = raws.map((e) => evalEntity(e, {}));
const t = performance.now();
const r = solveSketch(ents, raws, cons, { L: "50" });
console.log(performance.now() - t, r, JSON.stringify(ents.map((o) => o.pts || [o.cx, o.cy, o.d])));
writeBack(ents, raws); console.log(JSON.stringify(raws));
// tangent
const raws2 = [{ id: "q", type: "poly", pts: [[0, 0], [30, 0, 0], [40, 10, 3], [0, 10]] }];
const e2 = raws2.map((e) => evalEntity(e, {}));
console.log(solveSketch(e2, raws2, [{ id: "t", type: "tangent", refs: [{ e: "q", k: 0 }, { e: "q", k: 1 }] }, { id: "t2", type: "tangent", refs: [{ e: "q", k: 1 }, { e: "q", k: 2 }] }], {}), JSON.stringify(e2[0].pts));
