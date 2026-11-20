import opencascade from "replicad-opencascadejs";
import * as R from "replicad";
const oc = await opencascade({ locateFile: () => new URL("./node_modules/replicad-opencascadejs/dist/replicad_single.wasm", import.meta.url).pathname });
R.setOC(oc);
const d = R.draw([0,0]).sagittaArcTo([10,0],5).lineTo([10,-5]).lineTo([0,-5]).close();
const s = d.sketchOnPlane("XY").extrude(1);
console.log(R.measureVolume(s), s.boundingBox.bounds);
