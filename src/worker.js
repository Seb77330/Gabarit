import opencascade from "replicad-opencascadejs";
import * as R from "replicad";
import { build, meshShape, exportShape, drawingViews, buildAssembly, assemblyInterferences, exportAssembly } from "./core.js";
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
      const r = await build(msg.doc, { stopAt: msg.stopAt, regionsOf: msg.regionsOf });
      const mesh = meshShape(r.shape);
      const sketches = {};
      for (const [k, v] of Object.entries(r.sketches)) sketches[k] = v;
      const out = { type: "built", req: msg.req, preview: !!msg.preview, errors: r.errors, info: r.info, mesh, regions: r.regions, regionsOf: msg.regionsOf, ms: performance.now() - t, heap: OC?.wasmMemory?.buffer?.byteLength || 0 };
      const tr = mesh ? [mesh.vertices.buffer, mesh.normals.buffer, mesh.triangles.buffer, mesh.lines.buffer] : [];
      self.postMessage(out, tr);
    } else if (msg.type === "whose") {
      // quelle étape a fait la face qui passe par ce point ?
      const r = await build(msg.doc, { stopAt: msg.stopAt, probe: msg.point });
      self.postMessage({ type: "whose", req: msg.req, owner: r.owner });
    } else if (msg.type === "asm") {
      const t = performance.now();
      const parts = await buildAssembly(msg.comps);
      const tr = []; for (const p of parts) if (p.mesh) tr.push(p.mesh.vertices.buffer, p.mesh.normals.buffer, p.mesh.triangles.buffer, p.mesh.lines.buffer);
      self.postMessage({ type: "asmBuilt", req: msg.req, parts, ms: performance.now() - t, heap: OC?.wasmMemory?.buffer?.byteLength || 0 }, tr);
    } else if (msg.type === "asmInterf") {
      self.postMessage({ type: "asmInterf", req: msg.req, list: assemblyInterferences(msg.comps) });
    } else if (msg.type === "asmExport") {
      self.postMessage({ type: "exported", req: msg.req, blob: exportAssembly(msg.kind, msg.comps) });
    } else if (msg.type === "drawing") {
      self.postMessage({ type: "drawing", req: msg.req, views: drawingViews(msg.views) });
    } else if (msg.type === "export") {
      const blob = exportShape(msg.kind, msg.opts);
      self.postMessage({ type: "exported", req: msg.req, blob });
    }
  } catch (e) {
    self.postMessage({ type: "error", req: msg.req, message: String(e?.message || e) });
  }
};
