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
    } else if (msg.type === "fix") {
      // plus grande valeur d'un réglage (rayon, épaisseur, angle) pour laquelle l'étape se calcule : recherche par moitiés
      const d = msg.doc; const idx = d.features.findIndex((f) => f.id === msg.id); const f = d.features[idx];
      const works = async (v) => { f[msg.key] = String(v); const r = await build(d, { stopAt: idx + 1 }); return !r.errors[msg.id]; };
      let hi = msg.value, best = null;
      for (let i = 0, v = hi / 2; i < 7 && best === null; i++, v /= 2) { if (await works(v)) best = v; else hi = v; }
      if (best !== null) {
        let lo = best; for (let i = 0; i < 5; i++) { const mid = (lo + hi) / 2; if (await works(mid)) lo = mid; else hi = mid; }
        // valeur ronde, juste en dessous
        const step = lo >= 10 ? 0.5 : lo >= 1 ? 0.1 : 0.01; const round = Math.floor(lo / step + 1e-9) * step;
        best = round > 0 && (await works(round)) ? Math.round(round * 1000) / 1000 : Math.round(lo * 1000) / 1000;
      }
      self.postMessage({ type: "fixed", req: msg.req, value: best });
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
