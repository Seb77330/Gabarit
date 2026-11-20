import opencascade from "replicad-opencascadejs";
import * as R from "replicad";
import { build, meshShape, drawingViews } from "./src/core.js";
const oc = await opencascade({ locateFile: () => new URL("./node_modules/replicad-opencascadejs/dist/replicad_single.wasm", import.meta.url).pathname });
R.setOC(oc); globalThis.GABARIT_DEBUG = 1;
const doc = { params: [], features: [
  { id: "s1", type: "sketch", plane: { name: "dessus" }, entities: [{ id: "a", type: "poly", r: 0, pts: [[0,0,0],[40,0,8],[40,20,0],[0,20,-4]] }] },
  { id: "e1", type: "extrude", sketch: "s1", mode: "add", dist: 10 },
  { id: "pl", type: "plane", base: { kind: "std", name: "dessus" }, offset: 0, angle: 0 },
  { id: "p2", type: "plane", base: { kind: "ref", ref: "pl", offset: "30" }, rot: "x", angle: 20 },
  { id: "s2", type: "sketch", plane: { kind: "std", name: "dessus", offset: "10" }, entities: [{ id: "c", type: "circle", cx: 20, cy: 10, d: 14 }] },
  { id: "s3", type: "sketch", plane: { kind: "ref", ref: "p2" }, entities: [{ id: "r", type: "rect", cx: 20, cy: 10, w: 6, h: 6 }] },
  { id: "lf", type: "loft", sketches: ["s2", "s3"], mode: "add" },
  { id: "s4", type: "sketch", plane: { name: "face" }, entities: [{ id: "p", type: "path", pts: [[0, 0, 0], [0, -20, 0], [20, -20, 5], [40, -30, 0]] }] },
  { id: "s5", type: "sketch", plane: { name: "dessus" }, entities: [{ id: "c", type: "circle", cx: 0, cy: 0, d: 4 }] },
  { id: "sw", type: "sweep", profile: "s5", path: "s4", mode: "add" },
  { id: "s6", type: "sketch", plane: { name: "dessus", offset: 10 }, entities: [{ id: "c", type: "circle", cx: 5, cy: 5, d: 3 }] },
  { id: "c6", type: "extrude", sketch: "s6", mode: "cut", dist: 4, dir: "inverse" },
  { id: "pt", type: "pattern", target: "features", feats: ["c6"], kind: "lin", axis: "x", count: 3, step: 8, two: true, axis2: "y", count2: 2, step2: 8 },
  { id: "mi", type: "mirror", target: "features", feats: ["c6"], plane: { kind: "std", name: "droite", offset: "20" } },
  { id: "dr", type: "draft", angle: 3, faces: [[20, 0, 5]], plane: { name: "dessus" } },
]};
const r = await build(doc); console.log(r.errors); const m = meshShape(r.shape); console.log(m.volume.toFixed(1), m.cog, m.bb);
const v = drawingViews(["front", "iso"]); console.log(v.front.visible.length, v.front.hidden.length, v.front.bounds, v.front.visible[0]?.slice(0, 80));
