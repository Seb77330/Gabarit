import opencascade from "replicad-opencascadejs";
import * as R from "replicad";
import { build, meshShape, exportShape } from "./core.js";
let OC = null;

let ready = null;
async function init(msg) {
  const opts = {};
  if (msg.wasmBytes) {
    opts.instantiateWasm = (imports, cb) => { WebAssembly.instantiate(msg.wasmBytes, imports).then((r) => cb(r.instance)); return {}; };
  } else opts.locateFile = () => msg.wasmUrl;
  const oc = await opencascade(opts);
  OC = oc;
  R.setOC(oc);
}
self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") { ready = init(msg); await ready; self.postMessage({ type: "ready" }); return; }
    await ready;
    if (msg.type === "build") {
      const t = performance.now();
      const r = build(msg.doc, { stopAt: msg.stopAt });
      const mesh = meshShape(r.shape);
      const sketches = {};
      for (const [k, v] of Object.entries(r.sketches)) sketches[k] = v;
      const out = { type: "built", req: msg.req, errors: r.errors, info: r.info, mesh, ms: performance.now() - t, heap: OC?.wasmMemory?.buffer?.byteLength || 0 };
      const tr = mesh ? [mesh.vertices.buffer, mesh.normals.buffer, mesh.triangles.buffer, mesh.lines.buffer] : [];
      self.postMessage(out, tr);
    } else if (msg.type === "export") {
      const blob = exportShape(msg.kind, msg.opts);
      self.postMessage({ type: "exported", req: msg.req, blob });
    }
  } catch (e) {
    self.postMessage({ type: "error", req: msg.req, message: String(e?.message || e) });
  }
};
