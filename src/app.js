// Gabarit : application principale (interface, historique, échanges avec le noyau 3D).
import { Viewer } from "./viewer.js";
import { Sketcher, newId } from "./sketcher.js";
import { ICONS } from "./icons.js";
import { evalExpr, varsMap } from "./expr.js";
import { resolvePlane as resolvePlaneRaw, refPlanes, evalEntity, outline, toWorld, STD_PLANES, cross, dot, norm, scale } from "./geo.js";
import { exampleDoc } from "./example.js";
import { sheetSVG } from "./drawing.js";
import { solveSketch, writeBack, C_LABELS, C_GLYPH } from "./constraints.js";
import { createAssemblyUI } from "./assembly.js";
import { sketchDXF } from "./dxf.js";
import { createExtras } from "./extras.js";
import FONT from "./texte.ttf";
try { const ff = new FontFace("gabarit-texte", FONT); ff.load().then((f) => { document.fonts.add(f); sketcher?.render(); }).catch(() => {}); } catch { /* aperçu avec la police par défaut */ }

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v;
    else if (k === "class") e.className = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

// ---------- Typographie française ----------
const SHORT = "à|a|au|aux|le|la|les|un|une|des|de|du|et|ou|en|tu|te|ta|ton|tes|ce|ces|sa|son|ses|sur|par|pour|sans|avec|dans|il|on|ne|se|si|est|qui|que|ou|y|l’|d’|n’|s’|qu’";
const SHORT_RE = new RegExp(`(^|[\\s(« ])(${SHORT})\\s`, "gi");
export function fr(t) {
  return String(t)
    .replace(/\s+([:;!?»])/g, " $1")
    .replace(/«\s*/g, "« ")
    .replace(/(\d)\s(mm|cm³|cm²|cm|g|kg|°|%|s)(?![\wÀ-ÿ])/g, "$1 $2")
    .replace(SHORT_RE, (m, a, b) => a + b + " ")
    .replace(SHORT_RE, (m, a, b) => a + b + " ");
}
function typoTree(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentElement.tagName)) || n.parentElement?.closest("svg") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const list = []; while (w.nextNode()) list.push(w.currentNode);
  for (const n of list) { const v = fr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
  root.querySelectorAll?.("[title],[placeholder]").forEach((e) => {
    for (const a of ["title", "placeholder"]) { const v = e.getAttribute(a); if (v) { const f = fr(v); if (f !== v) e.setAttribute(a, f); } }
  });
}
new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) { if (n.nodeType === 1) typoTree(n); else if (n.nodeType === 3 && n.parentElement && !n.parentElement.closest("svg")) { const v = fr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } } })
  .observe(document.body, { childList: true, subtree: true });

// Plan résolu avec les plans de référence de la pièce.
const resolvePlane = (def, vars) => resolvePlaneRaw(def, vars, refPlanes(doc.features, vars));
const nf = (v, d = 2) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d }).format(v);
const round = (v, s = 0.01) => Math.round(v / s) * s;

// ---------- État ----------
const TYPES = {
  sketch: { label: "Esquisse", icon: "sketch" },
  extrude: { label: "Extrusion", icon: "extrude" },
  revolve: { label: "Révolution", icon: "revolve" },
  hole: { label: "Perçage", icon: "hole" },
  fillet: { label: "Congé", icon: "fillet" },
  chamfer: { label: "Chanfrein", icon: "chamfer" },
  shell: { label: "Coque", icon: "shell" },
  mirror: { label: "Symétrie", icon: "mirror" },
  pattern: { label: "Répétition", icon: "pattern" },
  plane: { label: "Plan", icon: "plane" },
  loft: { label: "Lissage", icon: "loft" },
  sweep: { label: "Balayage", icon: "sweep" },
  draft: { label: "Dépouille", icon: "draft" },
  import: { label: "Import", icon: "import" },
  rib: { label: "Nervure", icon: "rib" },
  thread: { label: "Filetage", icon: "thread" },
  helix: { label: "Ressort", icon: "helix" },
};
const MATERIALS = { pla: ["PLA", 1.24], petg: ["PETG", 1.27], abs: ["ABS", 1.04], resine: ["Résine", 1.15], alu: ["Aluminium", 2.7], acier: ["Acier", 7.85], inox: ["Inox", 8.0], laiton: ["Laiton", 8.5], bois: ["Bois (chêne)", 0.75] };
const STORE = "gabarit-doc-v1";

let doc = emptyDoc();
const st = {
  sel: null, editSketch: null, skSel: null, pick: null, afterSketch: null, stopAt: null,
  errors: {}, info: {}, mesh: null, building: false, lastMs: 0, firstFit: true,
};
function emptyDoc() { return { version: 1, name: "Pièce sans nom", material: "pla", params: [], features: [] }; }
function emptyAsm() { return { version: 1, kind: "assembly", name: "Assemblage sans nom", params: [], features: [], components: [], mates: [] }; }
const isAsm = () => doc.kind === "assembly";
// Bibliothèque de pièces (dans ce navigateur), pour les assemblages
const LIB = "gabarit-lib";
function library() { try { return JSON.parse(localStorage.getItem(LIB) || "{}"); } catch { return {}; } }
function addToLibrary(d) {
  if (!d || d.kind === "assembly" || !d.features?.length) return;
  const lib = library(); lib[d.name || "Pièce sans nom"] = { ...JSON.parse(JSON.stringify(d)), savedAt: Date.now() };
  try { localStorage.setItem(LIB, JSON.stringify(lib)); } catch { /* stockage plein */ }
}
const feat = (id) => doc.features.find((f) => f.id === id);
const featIndex = (id) => doc.features.findIndex((f) => f.id === id);
function nextName(type) {
  const base = TYPES[type].label; let n = 1;
  const names = new Set(doc.features.map((f) => f.name));
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

// ---------- Historique d'annulation ----------
let hist = [], hidx = -1;
function pushHistory() {
  const j = JSON.stringify(doc);
  if (hist[hidx] === j) return;
  hist = hist.slice(0, hidx + 1); hist.push(j); if (hist.length > 300) hist.shift(); hidx = hist.length - 1;
  save();
}
let libTimer;
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(doc)); } catch { /* stockage indisponible */ }
  if (!isAsm()) { clearTimeout(libTimer); libTimer = setTimeout(() => addToLibrary(doc), 800); }
}
function undo() { if (hidx > 0) { hidx--; restore(); } }
function redo() { if (hidx < hist.length - 1) { hidx++; restore(); } }
function restore() {
  doc = JSON.parse(hist[hidx]);
  if (isAsm()) { save(); asmUI.undoRefresh(); asmUI.render(); return; }
  if (st.sel && !feat(st.sel)) st.sel = null;
  if (st.editSketch && !feat(st.editSketch)) closeSketch(true);
  stopPick(); save(); renderAll(); requestBuild();
  if (st.editSketch) sketcher.render();
}
function mutate(fn, transient = false) {
  fn(doc);
  if (!transient) pushHistory(); else save();
  renderTree(); requestBuild();
  if (st.editSketch) sketcher.render();
}
function loadDoc(d, fit = true) {
  if (extras?.isPrintOpen()) extras.closePrint();
  const wasAsm = isAsm();
  doc = Object.assign(d.kind === "assembly" ? emptyAsm() : emptyDoc(), d);
  document.body.classList.toggle("asm", isAsm());
  $(".tree > h2").textContent = isAsm() ? "Assemblage" : "Historique";
  if (isAsm()) {
    closeSketch(true); stopPick(); viewer.setPick(null); banner(null); st.mesh = null; viewer.setCog(null); if (viewer.section) toggleSection();
    hist = []; hidx = -1; pushHistory();
    $("#docName").value = doc.name; layoutMode(); asmUI.enter(); return;
  }
  if (wasAsm) { renderTools(); viewer.setMesh(null); viewer.setPick(null); banner(null); if (viewer.section) toggleSection(); }
  st.sel = null; st.stopAt = null; st.errors = {}; closeSketch(true); stopPick();
  hist = []; hidx = -1; pushHistory();
  st.firstFit = fit; renderAll(); requestBuild();
}

// ---------- Noyau 3D (Worker) ----------
let worker, workerReady = false, buildReq = 0, buildTimer = null, pendingExport = new Map();
// Le moteur 3D ne démarre pas dans certains aperçus (visionneuses intégrées, navigateurs anciens) : on le dit clairement.
let engineFailed = false, readyTimer = null;
function engineFail(why) {
  if (workerReady || engineFailed) return;
  engineFailed = true; showBusy(false); renderStatus();
  if ($(".engine-fail")) return;
  document.body.append(h("div", { class: "engine-fail" }, h("b", {}, "Le moteur 3D n’a pas pu démarrer ici."), h("br"),
    "Les esquisses marchent, mais aucun volume ne peut être calculé. Ouvre Gabarit dans Chrome, Edge ou Firefox : télécharge le fichier Gabarit.html, puis double-clique dessus.",
    why ? h("div", { class: "muted", style: "font-size:12px;margin-top:6px" }, "Détail : " + why) : null));
}
function startWorker() {
  const src = window.GABARIT_WORKER_SRC;
  try { worker = src ? new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" }))) : new Worker("worker.js"); }
  catch (e) { engineFail(e.message); return; }
  if (typeof WebAssembly !== "object") { engineFail("WebAssembly indisponible"); return; }
  clearTimeout(readyTimer); readyTimer = setTimeout(() => engineFail("le chargement a pris plus de 90 secondes"), 90000);
  worker.onmessage = (ev) => onWorker(ev.data);
  worker.onerror = (e) => { engineFail(e.message || "erreur inconnue"); };
  showBusy(true, "Chargement du moteur 3D…");
  (async () => {
    if (window.GABARIT_WASM_GZ) {
      if (!wasmCache) {
        const bin = Uint8Array.from(atob(window.GABARIT_WASM_GZ), (c) => c.charCodeAt(0));
        const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
        wasmCache = await new Response(stream).arrayBuffer();
      }
      worker.postMessage({ type: "init", wasmBytes: wasmCache.slice(0) });
    } else worker.postMessage({ type: "init", wasmUrl: new URL("occt.wasm", location.href).href });
  })().catch((e) => engineFail(e.message));
}
let wasmCache = null, restarts = [];
function restartWorker() {
  restarts = restarts.filter((t) => Date.now() - t < 30000); restarts.push(Date.now());
  if (restarts.length > 3) { showBusy(false); toast("Le moteur 3D bloque sur cette pièce. Annule la dernière modification (Ctrl+Z)."); return; } try { worker.terminate(); } catch { /* déjà arrêté */ } workerReady = false; st.building = false; startWorker(); }
function onWorker(m) {
  if (m.type === "ready") { workerReady = true; clearTimeout(readyTimer); engineFailed = false; $(".engine-fail")?.remove(); showBusy(false); renderStatus(); if (isAsm()) asmUI.undoRefresh(); else requestBuild(0); return; }
  if (m.type === "built" && m.preview) { if (m.req === buildReq && st.pick) viewer.setGhost(m.mesh); return; }
  if (m.type === "built") {
    if (m.req !== buildReq) return;
    // pendant une sélection, la pièce affichée s'arrête avant l'étape : on calcule en plus l'aperçu du résultat
    const pf = st.pick?.featId ? feat(st.pick.featId) : null;
    if (pf && ["fillet", "chamfer", "shell", "draft"].includes(pf.type) && !pf.suppressed && (pf.edges || pf.faces || []).length) worker.postMessage({ type: "build", req: buildReq, preview: true, doc, stopAt: featIndex(pf.id) + 1 });
    else viewer.setGhost(null);
    st.building = false; showBusy(false);
    if (m.heap > 1.4e9) setTimeout(restartWorker, 50); // libère la mémoire du noyau
    st.errors = m.errors; st.info = m.info; st.mesh = m.mesh; st.lastMs = m.ms;
    viewer.setMesh(m.mesh); extras.refreshPrint();
    viewer.setCog(st.showCog && m.mesh?.cog ? m.mesh.cog : null);
    if (st.firstFit && m.mesh) { viewer.fit([1, -1.3, 0.9]); st.firstFit = false; }
    if (st.editSketch) updateSketchRefs();
    renderTree(); renderStatus(); renderOverlay(); refreshMarkers();
    if (!st.editSketch) renderProps();
    return;
  }
  if (m.type === "asmBuilt") { if (m.heap > 1.6e9) setTimeout(restartWorker, 50); asmUI.onBuilt(m); return; }
  if (m.type === "asmInterf") { const cb = pendingExport.get(m.req); pendingExport.delete(m.req); cb?.(m.list); return; }
  if (m.type === "drawing") { const cb = pendingExport.get(m.req); pendingExport.delete(m.req); cb?.(m.views); return; }
  if (m.type === "exported") { const cb = pendingExport.get(m.req); pendingExport.delete(m.req); cb?.(m.blob); return; }
  if (m.type === "error" && !workerReady) { engineFail(m.message); return; }
  if (m.type === "error" && /Aborted|RuntimeError|memory/i.test(m.message)) { restartWorker(); toast("Le moteur 3D a redémarré après une erreur. Vérifie la dernière valeur saisie."); return; }
  if (m.type === "error") { showBusy(false); st.building = false; const cb = pendingExport.get(m.req); if (cb) { pendingExport.delete(m.req); toast(m.message); } else toast("Erreur du noyau 3D : " + m.message); }
}
function currentStopAt() {
  if (st.pick?.featId) return featIndex(st.pick.featId);
  if (st.editSketch) return featIndex(st.editSketch);
  return st.stopAt ?? undefined;
}
function requestBuild(delay = 150) {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(() => {
    if (!workerReady) return;
    if (isAsm()) return;
    buildReq++; st.building = true;
    setTimeout(() => { if (st.building) showBusy(true); }, 250);
    worker.postMessage({ type: "build", req: buildReq, doc, stopAt: currentStopAt() });
  }, delay);
}
let exportReq = 1e6;
function doExport(kind) {
  if (isAsm()) {
    const list = asmUI.exportComps(); if (!list.length) { toast("Insère d’abord des pièces dans l’assemblage."); return; }
    const req = ++exportReq; showBusy(true, "Export en cours…");
    pendingExport.set(req, (blob) => { showBusy(false); download(blob, `${safeName()}.${kind}`); toast(kind === "step" ? "Assemblage STEP enregistré (une pièce par composant)." : `Assemblage ${kind.toUpperCase()} enregistré.`); });
    worker.postMessage({ type: "asmExport", req, kind, comps: list }); return;
  }
  if (!st.mesh) { toast("Rien à exporter pour l’instant : la pièce est vide."); return; }
  if (st.stopAt !== null || st.pick || st.editSketch) { toast("Termine l’édition en cours, puis remets la fin de la pièce tout en bas."); return; }
  const req = ++exportReq;
  showBusy(true, "Export en cours…");
  const msgs = { step: "Fichier STEP enregistré.", stl: "Fichier STL enregistré, prêt pour ton trancheur.", "3mf": "Fichier 3MF enregistré, prêt pour ton trancheur.", obj: "Fichier OBJ enregistré." };
  pendingExport.set(req, (blob) => { showBusy(false); download(blob, `${safeName()}.${kind}`); toast(msgs[kind]); });
  worker.postMessage({ type: "export", req, kind, opts: { fine: true, name: doc.name, down: kind !== "step" ? doc.printDown || null : null } });
}
const safeName = () => (doc.name || "piece").replace(/[\\/:*?"<>|]+/g, "-").trim() || "piece";
function download(blob, name) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// ---------- Interface : outils ----------
const TOOLBAR = [
  [["sketch", "Esquisse"], ["plane", "Plan"]],
  [["extrude", "Extrusion"], ["cut", "Enlèvement"], ["revolve", "Révolution"], ["loft", "Lissage"], ["sweep", "Balayage"], ["helix", "Ressort"]],
  [["hole", "Perçage"], ["thread", "Filetage"], ["fillet", "Congé"], ["chamfer", "Chanfrein"], ["shell", "Coque"], ["draft", "Dépouille"], ["rib", "Nervure"]],
  [["mirror", "Symétrie"], ["pattern", "Répétition"], ["import", "Importer"]],
  [["measure", "Mesurer"], ["section", "Coupe"], ["print", "Impression 3D"], ["drawing", "Mise en plan"]],
];
function renderTools() {
  const t = $("#tools"); t.innerHTML = "";
  for (const grp of TOOLBAR) {
    t.append(h("div", { class: "tgroup" }, grp.map(([k, label]) => h("button", { class: "tbtn", "data-tool": k, title: TOOL_TIPS[k], onclick: () => toolAction(k) }, h("span", { html: ICONS[k === "cut" ? "cut" : k] }), label))));
  }
}
const TOOL_TIPS = {
  sketch: "Dessiner un profil 2D sur un plan ou une face",
  extrude: "Donner de l’épaisseur à une esquisse",
  cut: "Creuser la pièce avec une esquisse",
  revolve: "Faire tourner une esquisse autour d’un axe (pièces de tour)",
  hole: "Percer des trous simples, lamés ou fraisés",
  fillet: "Arrondir des arêtes",
  chamfer: "Casser des arêtes en biais",
  shell: "Évider la pièce en gardant une paroi",
  mirror: "Copier la pièce en miroir par rapport à un plan",
  pattern: "Répéter la pièce ou des fonctions, en ligne, en grille ou en cercle",
  plane: "Créer un plan de référence décalé ou incliné",
  loft: "Relier plusieurs esquisses par une forme qui passe de l’une à l’autre",
  sweep: "Faire glisser un profil le long d’un chemin (tuyau, poignée, ressort plat…)",
  draft: "Incliner des faces pour le démoulage",
  import: "Importer une pièce STEP ou STL",
  helix: "Créer un ressort (fil enroulé en hélice)",
  thread: "Fileter un axe ou tarauder un trou (vrai filet en 3D)",
  rib: "Ajouter un renfort à partir d’un simple trait d’esquisse",
  measure: "Mesurer une distance entre deux points de la pièce",
  section: "Couper la vue pour voir l’intérieur",
  drawing: "Créer le plan 2D de la pièce, à imprimer ou en PDF",
  print: "Voir les surplombs à soutenir et poser la pièce à plat automatiquement",
};
// Coin de confirmation dans la vue : ✓ / ✕ toujours au même endroit.
function renderCorner() {
  let c = $("#corner");
  const on = !isAsm() && (st.editSketch || (st.sel && feat(st.sel) && feat(st.sel).type !== "sketch"));
  if (!on) { c?.remove(); return; }
  if (!c) { c = h("div", { id: "corner", class: "corner" }); $(".stage").append(c); }
  c.innerHTML = "";
  c.append(
    h("button", { class: "ok", title: st.editSketch ? "Sortir de l’esquisse (Entrée)" : "Valider (Entrée)", onclick: () => (st.editSketch ? closeSketch() : validateFeature()) }, "✓"),
    h("button", { class: "ko", title: st.editSketch ? "Annuler l’esquisse (oublier les changements)" : "Annuler les changements (Échap)", onclick: () => (st.editSketch ? cancelSketch() : cancelFeature()) }, "✕"));
}
let lastTool = null;
function toolAction(k) {
  if (!["measure", "section", "drawing", "print", "import"].includes(k)) lastTool = k;
  if (engineFailed && !["sketch", "plane", "measure", "section"].includes(k)) toast("Le moteur 3D n’a pas démarré dans cet aperçu : ouvre Gabarit.html dans Chrome, Edge ou Firefox pour créer des volumes.");
  if (st.editSketch) {
    if (["measure", "section"].includes(k)) { toast("Mesure et coupe : sors d’abord de l’esquisse."); return; }
    if (st.afterSketch && ["extrude", "cut", "revolve", "rib"].includes(k)) st.afterSketch = null; // l'outil cliqué l'emporte
    closeSketch();
  }
  if (k === "measure") { toggleMeasure(); return; }
  if (k === "section") { toggleSection(); return; }
  if (k === "drawing") { openDrawing(); return; }
  if (k === "print") { extras.printPanel(); return; }
  if (extras.isPrintOpen()) extras.closePrint();
  stopPick(); stopMeasure();
  if (k === "plane") { choosePlane((base) => { insertFeature({ id: newId("f"), type: "plane", name: nextName("plane"), base, offset: "10", rot: "x", angle: "0" }); }, "Le nouveau plan part de quel plan ?"); return; }
  if (k === "import") { importFile(); return; }
  if (k === "loft") {
    const sks = doc.features.slice(0, st.stopAt ?? doc.features.length).filter((f) => f.type === "sketch" && !f.suppressed);
    const used = new Set(doc.features.flatMap((f) => [f.sketch, f.profile, f.path, ...(f.sketches || [])]).filter(Boolean));
    const free = sks.filter((f) => !used.has(f.id)).slice(-2).map((f) => f.id);
    insertFeature({ id: newId("f"), type: "loft", name: nextName("loft"), sketches: free.length === 2 ? free : ["", ""], mode: "add", ruled: false });
    if (free.length < 2) toast("Dessine au moins deux esquisses sur des plans différents (utilise « Plan » pour en créer), puis choisis-les ici.");
    return;
  }
  if (k === "sweep") {
    const sks = doc.features.slice(0, st.stopAt ?? doc.features.length).filter((f) => f.type === "sketch" && !f.suppressed);
    const isPath = (e) => e.type === "path" || (e.type === "spline" && !e.closed);
    const path = [...sks].reverse().find((f) => (f.entities || []).some(isPath));
    const prof = [...sks].reverse().find((f) => f !== path && !(f.entities || []).some(isPath));
    insertFeature({ id: newId("f"), type: "sweep", name: nextName("sweep"), profile: prof?.id || "", path: path?.id || "", mode: "add" });
    if (!path || !prof) toast("Il faut deux esquisses : un profil (par exemple un cercle centré sur l’origine) et un chemin (outil « Chemin »).");
    return;
  }
  if (k === "sketch") { if (st.facePlane) { const pl = st.facePlane; clearFaceSel(); createSketch(pl); return; } choosePlane((plane) => createSketch(plane)); return; }
  if (k === "helix") { choosePlane((plane) => insertFeature({ id: newId("f"), type: "helix", name: nextName("helix"), plane, cx: "0", cy: "0", d: "20", pitch: "5", height: "40", wire: "2", mode: "add" }), "Le ressort part de quel plan ?"); return; }
  if (k === "rib") {
    const isPath = (e) => e.type === "path" || (e.type === "spline" && !e.closed);
    const used = new Set(doc.features.filter((f) => f.sketch).map((f) => f.sketch));
    const sk = [...doc.features.slice(0, st.stopAt ?? doc.features.length)].reverse().find((f) => f.type === "sketch" && !used.has(f.id) && (f.entities || []).some(isPath));
    const make = (id) => insertFeature({ id: newId("f"), type: "rib", name: nextName("rib"), sketch: id, t: "3", flip: false });
    if (!st.mesh) { toast("Crée d’abord un volume : la nervure vient le renforcer."); return; }
    if (sk) make(sk.id);
    else { toast("Dessine un trait avec l’outil « Chemin » entre deux parois, puis Entrée."); choosePlane((plane) => createSketch(plane, make, "Nervure")); }
    return;
  }
  if (k === "extrude" || k === "cut" || k === "revolve") {
    const type = k === "cut" ? "extrude" : k;
    const sk = candidateSketch();
    const make = (skId) => {
      const f = { id: newId("f"), type, name: k === "cut" ? nextNameRaw("Enlèvement") : nextName(type), sketch: skId, mode: k === "cut" ? "cut" : "add" };
      if (type === "extrude") Object.assign(f, { dist: k === "cut" ? "5" : "10", dir: k === "cut" ? "inverse" : "normal", through: false });
      else Object.assign(f, { axis: "y", angle: "360" });
      insertFeature(f);
    };
    if (sk) make(sk.id);
    else { toast("Dessine le profil, puis Entrée (ou le bouton vert)."); choosePlane((plane) => createSketch(plane, make, { extrude: "Extruder", cut: "Enlever la matière", revolve: "Faire tourner" }[k])); }
    return;
  }
  if (!st.mesh) { toast("Crée d’abord un volume (esquisse puis extrusion)."); return; }
  const pre = st.pre || { edges: [], faces: [] }; const prePlane = st.facePlane; clearFaceSel();
  if (k === "thread") {
    const f = { id: newId("f"), type: "thread", name: nextName("thread"), kind: "ext", pitch: "1.5", len: "", flip: false };
    insertFeature(f); startPick("cyl", f.id); return;
  }
  if (k === "hole") {
    (prePlane ? (cb) => cb(prePlane) : (cb, t) => choosePlane(cb, t))((plane) => {
      const f = { id: newId("f"), type: "hole", name: nextName("hole"), plane, kind: "simple", d: "5", d2: "9", depth2: "3", angle: "90", depth: "10", through: true, points: [] };
      insertFeature(f); startPick("points", f.id);
    }, "Sur quelle face veux-tu percer ?");
    return;
  }
  if (k === "fillet" || k === "chamfer") {
    const f = { id: newId("f"), type: k, name: nextName(k), r: k === "fillet" ? "2" : "1", edges: [...pre.edges] };
    insertFeature(f); startPick("edges", f.id); return;
  }
  if (k === "draft") { if (!st.mesh) return; const f = { id: newId("f"), type: "draft", name: nextName("draft"), angle: "3", faces: pre.faces.map((x) => x.p), plane: { kind: "std", name: "dessus", offset: "0" } }; insertFeature(f); startPick("faces", f.id); return; }
  if (k === "shell") { const f = { id: newId("f"), type: "shell", name: nextName("shell"), t: "2", faces: pre.faces.map((x) => x.p) }; insertFeature(f); startPick("faces", f.id); return; }
  if (k === "mirror") { insertFeature({ id: newId("f"), type: "mirror", name: nextName("mirror"), target: "part", feats: [], plane: { kind: "std", name: "droite", offset: "0" } }); return; }
  if (k === "pattern") { insertFeature({ id: newId("f"), type: "pattern", name: nextName("pattern"), target: "part", feats: [], kind: "lin", axis: "x", count: "3", step: "20", angle: "360", two: false, axis2: "y", count2: "2", step2: "20" }); return; }
}
function nextNameRaw(base) { let n = 1; const names = new Set(doc.features.map((f) => f.name)); while (names.has(`${base} ${n}`)) n++; return `${base} ${n}`; }
function insertFeature(f) {
  const snap = JSON.stringify(doc);
  mutate((d) => {
    if (st.stopAt !== null) { d.features.splice(st.stopAt, 0, f); st.stopAt++; }
    else d.features.push(f);
  });
  select(f.id); st.editStart = { id: f.id, snap, isNew: true };
}
function candidateSketch() {
  const s = feat(st.sel); if (s?.type === "sketch") return s;
  const used = new Set(doc.features.filter((f) => f.sketch).map((f) => f.sketch));
  const lim = st.stopAt ?? doc.features.length;
  for (let i = lim - 1; i >= 0; i--) { const f = doc.features[i]; if (f.type === "sketch" && !used.has(f.id) && !f.suppressed) return f; }
  return null;
}
function createSketch(plane, after, afterLabel) {
  const f = { id: newId("f"), type: "sketch", name: nextName("sketch"), plane, entities: [] };
  insertFeature(f); st.afterSketch = after || null; st.afterLabel = after ? afterLabel : null; openSketch(f.id, true);
}

// Choix du plan : plans de base ou face de la pièce.
function choosePlane(cb, title = "Sur quel plan veux-tu dessiner ?") {
  const dlg = $("#dlg"); dlg.innerHTML = "";
  const pick = (name) => { dlg.close(); cb({ kind: "std", name, offset: "0" }); };
  dlg.append(
    h("div", { class: "dh" }, title),
    h("div", { class: "planes" },
      h("button", { class: "btn", onclick: () => pick("dessus") }, h("b", {}, "Plan de dessus"), " (vu d’en haut, X et Y)"),
      h("button", { class: "btn", onclick: () => pick("face") }, h("b", {}, "Plan de face"), " (vu de devant, X et Z)"),
      h("button", { class: "btn", onclick: () => pick("droite") }, h("b", {}, "Plan de droite"), " (vu de droite, Y et Z)"),
      h("button", { class: "btn", disabled: !st.mesh, onclick: () => { dlg.close(); pickFacePlane(cb); } }, h("b", {}, "Une face de la pièce…"), st.mesh ? " (clique ensuite sur une face plane)" : " (aucune pièce pour l’instant)"),
    ),
    h("div", { class: "df" }, h("button", { class: "btn", onclick: () => dlg.close() }, "Annuler")),
  );
  dlg.showModal();
}
function planeFromFace(info) {
  const n = norm(info.n);
  const x = Math.abs(n[2]) < 0.99 ? norm(cross([0, 0, 1], n)) : [1, 0, 0];
  const origin = scale(n, dot(info.c, n));
  const r = (v) => v.map((c) => Math.round(c * 1e6) / 1e6);
  const axis = Math.abs(n[0]) > 0.999 ? "X" : Math.abs(n[1]) > 0.999 ? "Y" : Math.abs(n[2]) > 0.999 ? "Z" : null;
  const label = axis ? `Face (${axis} = ${nf(dot(info.c, n) * (n[{ X: 0, Y: 1, Z: 2 }[axis]] > 0 ? 1 : -1))})` : "Face inclinée";
  return { kind: "face", origin: r(origin), x: r(x), n: r(n), label, offset: "0" };
}
function pickFacePlane(cb) {
  banner("Clique sur une face plane de la pièce.", [["Annuler", () => { viewer.setPick(null); banner(null); }]]);
  viewer.setPick({ kind: "face", planarOnly: true, onPick: (hit) => {
    if (!hit.info?.plane) { toast("Cette face n’est pas plane. Choisis une face plate."); return; }
    viewer.setPick(null); banner(null); cb(planeFromFace(hit.info));
  } });
}

// ---------- Sélection en 3D (arêtes, faces, positions de perçage) ----------
function startPick(kind, featId) {
  st.pick = { kind, featId };
  const f = feat(featId);
  const texts = {
    edges: f?.type === "chamfer" ? "Clique sur les arêtes à chanfreiner. Reclique pour en retirer une." : "Clique sur les arêtes à arrondir. Reclique pour en retirer une.",
    faces: f?.type === "draft" ? "Clique sur les faces à incliner. Reclique pour en retirer une." : "Clique sur la ou les faces à ouvrir (elles seront retirées).",
    points: "Clique sur la face pour placer les trous. Tu peux corriger les cotes à droite.",
    cyl: "Clique sur la face cylindrique à fileter : un axe (vis) ou l’intérieur d’un trou (taraudage).",
    upto: "Clique sur la face plane où l’extrusion doit s’arrêter.",
  };
  banner(texts[kind]);
  viewer.setPick({ kind: kind === "edges" ? "edge" : "face", onPick: (hit) => onPick(hit) });
  requestBuild(0); renderProps(); refreshMarkers();
}
// Valider l'étape en cours (bouton, bandeau ou touche Entrée).
let validatedOnce = false;
// ✕ : revient à l'état d'avant l'édition (une étape toute neuve disparaît).
function cancelFeature() {
  const es = st.editStart; stopPick(false);
  if (es && es.snap !== JSON.stringify(doc)) { doc = JSON.parse(es.snap); pushHistory(); save(); requestBuild(0); }
  st.editStart = null; select(null); renderAll();
}
function validateFeature() {
  stopPick(); select(null);
  if (!validatedOnce) { validatedOnce = true; toast("C’est validé. Clique sur l’étape à gauche pour la modifier plus tard."); }
}
function stopPick(rebuild) {
  if (!st.pick) return;
  st.pick = null; viewer.setPick(null); viewer.setGhost(null); banner(null); refreshMarkers();
  if (rebuild !== false) { requestBuild(0); renderProps(); }
}
function onPick(hit) {
  const f = feat(st.pick.featId); if (!f) return;
  const tol = viewer.size / 120;
  if (st.pick.kind === "cyl" || st.pick.kind === "upto") {
    if (st.pick.kind === "cyl" && !hit.info?.cyl) { toast("Choisis une face cylindrique (un axe ou un trou)."); return; }
    if (st.pick.kind === "upto" && !hit.info?.plane) { toast("Choisis une face plane."); return; }
    const [lo, hi] = st.mesh.bb;
    const p = hit.point.map((c) => Math.round(c * 1000) / 1000);
    p.push(...[0, 1, 2].map((k) => Math.round(((hit.point[k] - lo[k]) / ((hi[k] - lo[k]) || 1)) * 1e5) / 1e5));
    const key = st.pick.kind === "cyl" ? "face" : "upTo";
    if (st.pick.kind === "cyl" && f.kind === "ext" && hit.info.r !== undefined) {
      // devine : un trou si la normale du point cliqué regarde vers l'axe
      const c = hit.info; const w = hit.point.map((x, i) => x - c.p[i]); const t = dot(w, c.d); const radial = w.map((x, i) => x - c.d[i] * t);
      if (hit.normal && dot(hit.normal, radial) < 0) f.kind = "int";
      const dia = 2 * c.r; const iso = [[3, 0.5], [4, 0.7], [5, 0.8], [6, 1], [8, 1.25], [10, 1.5], [12, 1.75], [16, 2], [20, 2.5], [24, 3], [30, 3.5], [36, 4]];
      const target = f.kind === "int" ? dia / 0.85 : dia; const best = iso.reduce((a, b) => (Math.abs(b[0] - target) < Math.abs(a[0] - target) ? b : a));
      f.pitch = String(best[1]);
    }
    mutate(() => { f[key] = p; });
    stopPick(true); return;
  }
  if (st.pick.kind === "edges" || st.pick.kind === "faces") {
    const key = st.pick.kind === "edges" ? "edges" : "faces";
    const [lo, hi] = st.mesh.bb;
    const p = hit.point.map((c) => Math.round(c * 1000) / 1000);
    p.push(...[0, 1, 2].map((k) => Math.round(((hit.point[k] - lo[k]) / ((hi[k] - lo[k]) || 1)) * 1e5) / 1e5));
    mutate(() => {
      const list = f[key] || (f[key] = []);
      const i = list.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < tol);
      if (i >= 0) list.splice(i, 1); else list.push(p);
    });
  } else if (st.pick.kind === "points") {
    const pl = resolvePlane(f.plane, varsMap(doc.params));
    const d = hit.point.map((c, i) => c - pl.origin[i]);
    const w = dot(d, pl.n);
    if (Math.abs(w) > Math.max(0.05, viewer.size / 500)) { toast("Clique sur la face choisie pour ce perçage (celle du plan de perçage)."); return; }
    const u = round(dot(d, pl.x), 0.5), v = round(dot(d, pl.y), 0.5);
    mutate(() => { f.points = f.points || []; f.points.push([String(u), String(v)]); });
  }
  renderProps(); refreshMarkers();
}
function refreshMarkers() {
  const f = st.sel ? feat(st.sel) : null;
  if (!f) { viewer.setMarkers(st.pre ? [...st.pre.edges, ...st.pre.faces.filter((x) => !x.info?.plane || st.pre.faces.length > 1).map((x) => x.p)] : []); return; }
  if (f.type === "fillet" || f.type === "chamfer") viewer.setMarkers(f.edges || []);
  else if (f.type === "shell" || f.type === "draft") viewer.setMarkers(f.faces || []);
  else if (f.type === "hole") {
    try { const v = varsMap(doc.params); const pl = resolvePlane(f.plane, v); viewer.setMarkers((f.points || []).map((p) => toWorld(pl, evalExpr(p[0], v), evalExpr(p[1], v))), 0x2f6fb5); } catch { viewer.setMarkers([]); }
  } else viewer.setMarkers([]);
}
function banner(text, buttons = []) {
  const b = $("#banner");
  if (!text) { b.hidden = true; return; }
  b.innerHTML = ""; b.append(h("span", {}, text), ...buttons.map(([l, fn], i) => h("button", { class: i ? "ghost" : "", onclick: fn }, l)));
  b.hidden = false;
}

// ---------- Arbre de construction ----------
function select(id) {
  if (st.pick && st.pick.featId !== id) stopPick();
  if (id && st.editStart?.id !== id) st.editStart = { id, snap: JSON.stringify(doc) };
  if (!id) st.editStart = null;
  st.sel = id; renderTree(); renderProps(); renderOverlay(); refreshMarkers();
}
function renderTree() {
  const t = $("#tree"); t.innerHTML = "";
  t.append(h("div", { class: "feat origin" }, h("span", { class: "ic", html: ICONS.origin }), h("span", { class: "nm" }, "Origine et plans")));
  doc.features.forEach((f, i) => {
    if (st.stopAt !== null && i === st.stopAt) t.append(rollbar());
    const after = st.stopAt !== null && i >= st.stopAt;
    const err = st.errors[f.id];
    const inf = st.info[f.id];
    const row = h("div", {
      class: `feat${st.sel === f.id ? " sel" : ""}${f.suppressed ? " off" : ""}${after ? " after" : ""}`,
      title: err || (f.suppressed ? "Désactivée" : ""),
      onclick: () => select(f.id),
      ondblclick: () => { if (f.type === "sketch") openSketch(f.id); },
      oncontextmenu: (e) => { e.preventDefault(); featMenu(f, e.clientX, e.clientY); },
    },
    h("span", { class: "ic", html: ICONS[TYPES[f.type].icon] }),
    h("span", { class: "nm" }, f.name),
    err ? h("span", { class: "err" }) : (inf && (inf.found < inf.asked || inf.conflict) ? h("span", { class: "warn", title: inf.conflict ? "Contraintes incompatibles" : "Certaines arêtes choisies ont disparu" }) : null),
    h("button", { class: "more", title: "Plus d’actions", "aria-label": "Plus d’actions", onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); featMenu(f, r.left, r.bottom); } }, "⋯"));
    t.append(row);
  });
  if (st.stopAt === null && doc.features.length) t.append(rollbar());
  if (!doc.features.length) t.append(h("div", { class: "param-empty", style: "padding:10px 10px" }, "Commence par une esquisse : clique sur « Esquisse » en haut à gauche."));
}
function rollbar() {
  const r = h("div", { class: "rollbar", title: "Fin de la pièce : glisse-la vers le haut pour remonter dans l’historique" });
  r.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const rows = [...$("#tree").querySelectorAll(".feat:not(.origin)")];
    const mv = (ev) => {
      let idx = rows.length;
      for (let i = 0; i < rows.length; i++) { const b = rows[i].getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2) { idx = i; break; } }
      const ns = idx >= doc.features.length ? null : idx;
      if (ns !== st.stopAt) { st.stopAt = ns; renderTree(); requestBuild(60); }
    };
    const upf = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", upf); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", upf);
  });
  return r;
}
function featMenu(f, x, y) {
  closeMenu();
  const i = featIndex(f.id);
  const m = h("div", { class: "menu", id: "menu" },
    f.type === "sketch" ? h("button", { onclick: () => { closeMenu(); openSketch(f.id); } }, "Modifier l’esquisse") : null,
    h("button", { onclick: () => { closeMenu(); select(f.id); setTimeout(() => $("#props .head input")?.select(), 0); } }, "Renommer"),
    h("button", { onclick: () => { closeMenu(); mutate(() => { f.suppressed = !f.suppressed; }); } }, f.suppressed ? "Réactiver" : "Désactiver (sans supprimer)"),
    h("hr"),
    h("button", { disabled: i === 0, onclick: () => { closeMenu(); moveFeature(f.id, -1); } }, "Monter"),
    h("button", { disabled: i === doc.features.length - 1, onclick: () => { closeMenu(); moveFeature(f.id, 1); } }, "Descendre"),
    h("button", { onclick: () => { closeMenu(); st.stopAt = i + 1 >= doc.features.length ? null : i + 1; renderTree(); requestBuild(0); } }, "Placer la fin de la pièce ici"),
    st.stopAt !== null ? h("button", { onclick: () => { closeMenu(); st.stopAt = null; renderTree(); requestBuild(0); } }, "Remettre la fin tout en bas") : null,
    h("hr"),
    h("button", { class: "danger", onclick: () => { closeMenu(); deleteFeature(f.id); } }, "Supprimer"),
  );
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + "px"; m.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
  setTimeout(() => document.addEventListener("pointerdown", closeMenuOutside, true), 0);
}
function closeMenuOutside(e) { if (!e.target.closest("#menu")) closeMenu(); }
function closeMenu() { $("#menu")?.remove(); document.removeEventListener("pointerdown", closeMenuOutside, true); }
function moveFeature(id, d) {
  const i = featIndex(id), j = i + d; if (j < 0 || j >= doc.features.length) return;
  mutate((dd) => { const [f] = dd.features.splice(i, 1); dd.features.splice(j, 0, f); });
}
function deleteFeature(id) {
  const f = feat(id); if (!f) return;
  const users = doc.features.filter((x) => x.sketch === id);
  if (users.length && !confirm(fr(`« ${f.name} » sert à : ${users.map((u) => u.name).join(", ")}. Supprimer quand même ? Ces fonctions seront en erreur.`))) return;
  if (st.editSketch === id) closeSketch(true);
  if (st.pick?.featId === id) stopPick(false);
  mutate((d) => { const i = d.features.findIndex((x) => x.id === id); d.features.splice(i, 1); if (st.stopAt !== null && i < st.stopAt) st.stopAt = Math.max(0, st.stopAt - 1); if (st.stopAt !== null && st.stopAt >= d.features.length) st.stopAt = null; });
  if (st.sel === id) select(null);
}

// ---------- Paramètres (variables) ----------
function renderParams() {
  const box = $("#params"); box.innerHTML = "";
  const vb = extras.variantBox(); if (vb) box.append(vb);
  if (!doc.params.length) { box.append(h("div", { class: "param-empty" }, "Donne un nom à une cote (par exemple « longueur ») pour la réutiliser partout : tape longueur ou longueur/2 dans n’importe quelle case.")); return; }
  const v = varsMap(doc.params);
  doc.params.forEach((p, i) => {
    let val = ""; let bad = false;
    try { val = nf(evalExpr(p.value, v), 3); } catch { bad = true; }
    const nameIn = h("input", { value: p.name, spellcheck: "false", "aria-label": "Nom", onchange: (e) => {
      const nn = e.target.value.trim().replace(/[^\wÀ-ÿ]/g, "_");
      if (!nn || /^\d/.test(nn)) { toast("Le nom doit commencer par une lettre."); e.target.value = p.name; return; }
      const old = p.name; mutate(() => { p.name = nn; renameParamEverywhere(old, nn); }); renderParams();
    } });
    const valIn = h("input", { value: p.value, class: bad ? "bad" : "", title: bad ? "Valeur incorrecte" : "= " + val, "aria-label": "Valeur", oninput: (e) => { mutate(() => { p.value = e.target.value; }, true); }, onchange: () => { pushHistory(); renderParams(); renderProps(); } });
    box.append(h("div", { class: "param" }, nameIn, valIn, h("button", { class: "x", title: "Supprimer", "aria-label": "Supprimer", onclick: () => { mutate((d) => d.params.splice(i, 1)); renderParams(); } }, "✕")));
  });
}
function renameParamEverywhere(a, b) {
  const re = new RegExp(`(^|[^\\wÀ-ÿ])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\wÀ-ÿ(])`, "g");
  const fix = (v) => (typeof v === "string" ? v.replace(re, (m, p) => p + b) : v);
  const walk = (o) => { if (Array.isArray(o)) return o.map((x) => (typeof x === "object" && x ? walk(x) : fix(x))); for (const k in o) { if (k === "id" || k === "name" || k === "type" || k === "sketch") continue; const v = o[k]; o[k] = typeof v === "object" && v ? walk(v) : fix(v); } return o; };
  for (const f of doc.features) walk(f);
  for (const p of doc.params) p.value = fix(p.value);
}
function addParam() {
  let n = 1; while (doc.params.some((p) => p.name === "cote" + n)) n++;
  mutate((d) => d.params.push({ name: "cote" + n, value: "10" })); renderParams();
  setTimeout(() => { const ins = $("#params").querySelectorAll(".param input"); ins[ins.length - 2]?.select(); }, 0);
}

// ---------- Panneau de réglages ----------
function exprField(label, obj, key, unit = "mm", opts = {}) {
  const v = varsMap(doc.params);
  const calc = h("div", { class: "calc" });
  const input = h("input", { type: "text", value: obj[key] ?? "", spellcheck: "false", inputmode: "decimal" });
  const check = () => {
    const raw = input.value;
    if (opts.optional && !raw.trim()) { input.classList.remove("bad"); calc.classList.remove("bad"); calc.textContent = ""; input.placeholder = opts.optional; return; }
    try {
      const n = evalExpr(raw, v); input.classList.remove("bad"); calc.classList.remove("bad");
      calc.textContent = /^\s*-?[\d.,]+\s*$/.test(raw) ? "" : "= " + nf(n, 3) + (unit ? " " + unit : "");
    } catch (e) { input.classList.add("bad"); calc.classList.add("bad"); calc.textContent = fr(e.message); }
  };
  input.addEventListener("input", () => { check(); mutate(() => { obj[key] = input.value; opts.after?.(); }, true); });
  input.addEventListener("change", () => pushHistory());
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const n = Number(input.value.replace(",", ".")); if (!isFinite(n)) return;
      e.preventDefault(); const s = (e.shiftKey ? 10 : 1) * (opts.step || 1) * (e.key === "ArrowUp" ? 1 : -1);
      input.value = String(Math.round((n + s) * 1000) / 1000); input.dispatchEvent(new Event("input")); pushHistory();
    }
  });
  check();
  return h("div", { class: "field" }, h("label", {}, label), h("div", { class: "in" }, input, unit ? h("span", { class: "unit" }, unit) : null), calc);
}
function segField(label, obj, key, options, after) {
  return h("div", { class: "field" }, label ? h("label", {}, label) : null, h("div", { class: "seg" },
    options.map(([val, text]) => h("button", { class: obj[key] === val ? "on" : "", onclick: () => { mutate(() => { obj[key] = val; }); after?.(); renderProps(); } }, text))));
}
function checkField(label, obj, key, after) {
  const cb = h("input", { type: "checkbox", checked: !!obj[key], onchange: (e) => { mutate(() => { obj[key] = e.target.checked; }); after?.(); renderProps(); } });
  return h("label", { class: "check" }, cb, label);
}
function selectField(label, value, options, onchange) {
  const s = h("select", { onchange: (e) => onchange(e.target.value) }, options.map(([v, t]) => h("option", { value: v, selected: v === value }, t)));
  return h("div", { class: "field" }, h("label", {}, label), s);
}
function planeFields(f, allowFace = true, key = "plane", label = "Plan", withOffset = true) {
  const p = f[key] || (f[key] = { kind: "std", name: "dessus", offset: "0" });
  const opts = Object.entries(STD_PLANES).map(([k, v]) => [k, v.label]);
  const fi = featIndex(f.id);
  for (const r of doc.features.slice(0, fi < 0 ? doc.features.length : fi)) if (r.type === "plane") opts.push(["ref:" + r.id, r.name]);
  if (p.kind === "face") opts.push(["__face", p.label || "Face choisie"]);
  if (allowFace && st.mesh) opts.push(["__pick", "Choisir une face sur la pièce…"]);
  return [
    selectField(label, p.kind === "face" ? "__face" : p.kind === "ref" ? "ref:" + p.ref : p.name, opts, (val) => {
      if (val === "__pick") { pickFacePlane((np) => { mutate(() => { f[key] = np; }); renderProps(); refreshMarkers(); }); renderProps(); return; }
      if (val === "__face") return;
      if (val.startsWith("ref:")) { mutate(() => { f[key] = { kind: "ref", ref: val.slice(4), offset: p.offset || "0" }; }); renderProps(); refreshMarkers(); if (st.editSketch) updateSketchRefs(); return; }
      mutate(() => { f[key] = { kind: "std", name: val, offset: p.offset || "0" }; }); renderProps(); refreshMarkers();
      if (st.editSketch) updateSketchRefs();
    }),
    withOffset ? exprField("Décalage du plan", p, "offset", "mm", { after: () => { refreshMarkers(); if (st.editSketch) updateSketchRefs(); } }) : null,
  ];
}
// Liste des fonctions (ajout ou enlèvement) à répéter ou copier en miroir.
function featPicker(f) {
  const i = featIndex(f.id);
  const ok = doc.features.slice(0, i).filter((x) => ["extrude", "revolve", "hole", "loft", "sweep", "import"].includes(x.type));
  const box = h("div", { class: "field" }, h("label", {}, "Fonctions concernées"));
  if (!ok.length) box.append(h("div", { class: "calc" }, "Aucune fonction avant celle-ci."));
  for (const x of ok) {
    const on = (f.feats || []).includes(x.id);
    box.append(h("label", { class: "check", style: "padding:2px 0" }, h("input", { type: "checkbox", checked: on, onchange: (e) => { mutate(() => { f.feats = (f.feats || []).filter((y) => y !== x.id); if (e.target.checked) f.feats.push(x.id); }); } }), x.name));
  }
  return box;
}
function sketchOptions(f) {
  const i = featIndex(f.id);
  return doc.features.slice(0, i).filter((x) => x.type === "sketch").map((x) => [x.id, x.name]);
}
function renderProps() {
  const P = $("#props"); P.innerHTML = "";
  layoutMode();
  if (st.editSketch) { renderSketchProps(P); return; }
  const f = feat(st.sel);
  if (!f) {
    P.append(h("h2", {}, "Réglages"), h("div", { class: "note" }, "Clique sur une étape de l’historique pour la modifier. Toutes les cotes acceptent des calculs et des paramètres, par exemple ", h("b", {}, "longueur/2 + 3"), "."));
    return;
  }
  P.append(h("div", { class: "okbar" },
    h("button", { class: "ok", title: "Valider (Entrée)", "aria-label": "Valider", onclick: () => validateFeature() }, "✓"),
    h("button", { class: "ko", title: "Annuler les changements (Échap)", "aria-label": "Annuler", onclick: () => cancelFeature() }, "✕"),
    h("span", { class: "lbl" }, TYPES[f.type].label || "")));
  const head = h("div", { class: "head" }, h("span", { class: "ic", html: ICONS[TYPES[f.type].icon] }),
    h("input", { value: f.name, "aria-label": "Nom de l’étape", onchange: (e) => { mutate(() => { f.name = e.target.value.trim() || f.name; }); } }));
  P.append(head);
  if (st.errors[f.id]) P.append(h("div", { class: "note err" }, st.errors[f.id]));
  const add = (...els) => P.append(...els.flat().filter(Boolean));
  const vars = varsMap(doc.params);

  if (f.type === "sketch") {
    add(planeFields(f));
    add(h("div", { class: "note" }, `${(f.entities || []).length} forme(s) dans cette esquisse.`));
    const used = doc.features.some((x) => x.sketch === f.id || x.profile === f.id || x.path === f.id || (x.sketches || []).includes(f.id));
    if (!used) add(h("div", { class: "note ok" }, "Esquisse prête. Clique sur « Extruder » pour lui donner du volume."));
    add(h("div", { class: "btnrow" }, h("button", { class: "btn" + (used ? "" : " primary"), onclick: () => { select(f.id); toolAction("extrude"); } }, "Extruder"),
      h("button", { class: "btn" + (used ? " primary" : ""), onclick: () => openSketch(f.id) }, "Modifier l’esquisse"),
      h("button", { class: "btn", onclick: () => { select(f.id); toolAction("cut"); } }, "Enlever")));
  }
  if (f.type === "extrude") {
    add(selectField("Esquisse utilisée", f.sketch, [["", "—"], ...sketchOptions(f)], (v) => mutate(() => { f.sketch = v; })));
    add(segField("Effet", f, "mode", [["add", "Ajouter de la matière"], ["cut", "Enlever de la matière"]]));
    add(segField("Jusqu’à", f, "end", [["dist", "Une distance"], ["face", "Une face"]]));
    if (f.end === "face") {
      add(h("div", { class: "note" + (f.upTo ? "" : " err") }, f.upTo ? "Face d’arrivée choisie. Le sens est déduit de la face." : "Clique sur « Choisir la face d’arrivée »."));
      add(h("div", { class: "btnrow" }, st.pick?.featId === f.id ? h("button", { class: "btn primary", onclick: () => stopPick(true) }, "Annuler") : h("button", { class: "btn primary", onclick: () => startPick("upto", f.id) }, "Choisir la face d’arrivée")));
    } else {
      add(segField("Sens", f, "dir", [["normal", "Normal"], ["inverse", "Inversé"], ["sym", "Des deux côtés"]]));
      if (f.mode === "cut") add(checkField("À travers toute la pièce", f, "through"));
      if (!(f.mode === "cut" && f.through)) add(exprField(f.dir === "sym" ? "Épaisseur totale" : "Distance", f, "dist"));
    }
  }
  if (f.type === "revolve") {
    add(selectField("Esquisse utilisée", f.sketch, [["", "—"], ...sketchOptions(f)], (v) => mutate(() => { f.sketch = v; })));
    add(segField("Effet", f, "mode", [["add", "Ajouter"], ["cut", "Enlever"]]));
    add(segField("Axe de rotation", f, "axis", [["y", "Axe vertical de l’esquisse"], ["x", "Axe horizontal"]]));
    add(exprField("Angle", f, "angle", "°", { step: 15 }));
    add(h("div", { class: "note" }, "Le profil doit rester d’un seul côté de l’axe (ligne verte ou rouge de l’esquisse)."));
  }
  if (f.type === "hole") {
    add(planeFields(f));
    add(checkField("Percer dans l’autre sens", f, "flip"));
    add(segField("Type de trou", f, "kind", [["simple", "Simple"], ["lame", "Lamé"], ["fraise", "Fraisé"]]));
    add(exprField("Diamètre du trou", f, "d", "mm", { step: 0.5 }));
    add(checkField("Traversant", f, "through"));
    if (!f.through) add(exprField("Profondeur", f, "depth"));
    if (f.kind === "lame") add(exprField("Diamètre du lamage", f, "d2"), exprField("Profondeur du lamage", f, "depth2"));
    if (f.kind === "fraise") add(exprField("Diamètre de la fraisure", f, "d2"), exprField("Angle de la fraisure", f, "angle", "°"));
    add(h("h2", {}, "Positions des trous"));
    const box = h("div", { class: "pts" });
    (f.points || []).forEach((p, i) => {
      const mk = (j) => h("input", { value: p[j], "aria-label": j ? "Y" : "X", oninput: (e) => { mutate(() => { p[j] = e.target.value; }, true); refreshMarkers(); }, onchange: () => pushHistory() });
      box.append(h("div", { class: "pt" }, String(i + 1), mk(0), mk(1), h("button", { class: "x", title: "Retirer", onclick: () => { mutate(() => f.points.splice(i, 1)); renderProps(); refreshMarkers(); } }, "✕")));
    });
    add(box);
    add(h("div", { class: "btnrow" },
      st.pick?.featId === f.id ? null : h("button", { class: "btn", onclick: () => startPick("points", f.id) }, "Placer en cliquant"),
      h("button", { class: "btn", onclick: () => { mutate(() => { (f.points = f.points || []).push(["0", "0"]); }); renderProps(); refreshMarkers(); } }, "+ Ajouter une position")));
    add(h("div", { class: "note" }, "Positions en millimètres dans le plan du perçage (X vers la droite, Y vers le haut)."));
  }
  if (f.type === "fillet" || f.type === "chamfer") {
    add(exprField(f.type === "fillet" ? "Rayon" : "Distance", f, "r", "mm", { step: 0.5 }));
    const n = (f.edges || []).length; const inf = st.info[f.id];
    add(h("div", { class: "note" + (inf && inf.found < inf.asked ? " err" : "") }, `${n} arête(s) choisie(s)` + (inf && inf.found < inf.asked ? ` : ${inf.asked - inf.found} introuvable(s), reclique-les.` : ".")));
    add(h("div", { class: "btnrow" },
      st.pick?.featId === f.id ? null : h("button", { class: "btn", onclick: () => startPick("edges", f.id) }, "Choisir les arêtes"),
      n ? h("button", { class: "btn", onclick: () => { mutate(() => { f.edges = []; }); renderProps(); refreshMarkers(); } }, "Tout effacer") : null));
  }
  if (f.type === "rib") {
    add(selectField("Esquisse du trait", f.sketch, [["", "—"], ...sketchOptions(f)], (v) => mutate(() => { f.sketch = v; })));
    add(exprField("Épaisseur", f, "t", "mm", { step: 0.5 }));
    add(checkField("Remplir de l’autre côté (si le côté choisi automatiquement ne convient pas)", f, "flip"));
    add(h("div", { class: "note" }, "Dessine un simple trait (outil « Chemin ») entre deux parois, sur un plan qui coupe la pièce. La nervure remplit l’espace entre le trait et la pièce, centrée sur le plan de l’esquisse."));
  }
  if (f.type === "thread") {
    add(segField("Type", f, "kind", [["ext", "Vis (extérieur)"], ["int", "Taraudage (trou)"]]));
    add(exprField("Pas", f, "pitch", "mm", { step: 0.25 }));
    add(exprField("Longueur", f, "len", "mm", { optional: "toute la face" }));
    add(checkField("Commencer par l’autre bout", f, "flip"));
    add(h("div", { class: "note" + (f.face ? "" : " err") }, f.face ? "Filet métrique ISO à 60°. Pour un taraudage, perce d’abord au diamètre de perçage (par exemple 8,5 mm pour M10)." : "Clique sur la face cylindrique à fileter."));
    add(h("div", { class: "btnrow" }, st.pick?.featId === f.id ? h("button", { class: "btn primary", onclick: () => stopPick(true) }, "Annuler") : h("button", { class: "btn primary", onclick: () => startPick("cyl", f.id) }, f.face ? "Changer de face" : "Choisir la face")));
  }
  if (f.type === "helix") {
    add(planeFields(f));
    add(segField("Effet", f, "mode", [["add", "Ajouter de la matière"], ["cut", "Enlever"]]));
    add(exprField("Diamètre moyen", f, "d"), exprField("Pas (écart entre deux spires)", f, "pitch"), exprField("Hauteur", f, "height"), exprField("Diamètre du fil", f, "wire", "mm", { step: 0.5 }));
    add(exprField("Centre X", f, "cx"), exprField("Centre Y", f, "cy"));
    const n = (() => { try { return evalExpr(f.height, vars) / evalExpr(f.pitch, vars); } catch { return 0; } })();
    if (n) add(h("div", { class: "note" }, `${nf(n, 1)} spire(s).`));
  }
  if (f.type === "shell") {
    add(exprField("Épaisseur de paroi", f, "t", "mm", { step: 0.5 }));
    add(h("div", { class: "note" }, `${(f.faces || []).length} face(s) ouverte(s).`));
    add(h("div", { class: "btnrow" }, st.pick?.featId === f.id ? null : h("button", { class: "btn", onclick: () => startPick("faces", f.id) }, "Choisir les faces")));
  }
  if (f.type === "mirror") {
    add(segField("Copier", f, "target", [["part", "Toute la pièce"], ["features", "Des fonctions"]]));
    if (f.target === "features") add(featPicker(f));
    add(planeFields(f, false));
  }
  if (f.type === "pattern") {
    add(segField("Répéter", f, "target", [["part", "Toute la pièce"], ["features", "Des fonctions"]]));
    if (f.target === "features") add(featPicker(f));
    add(segField("Type", f, "kind", [["lin", "En ligne"], ["circ", "En cercle"]]));
    add(segField(f.kind === "circ" ? "Autour de l’axe" : "Le long de l’axe", f, "axis", [["x", "X"], ["y", "Y"], ["z", "Z"]]));
    add(exprField("Nombre d’exemplaires", f, "count", ""));
    if (f.kind === "circ") add(exprField("Angle total", f, "angle", "°", { step: 15 }));
    else {
      add(exprField("Écart entre deux exemplaires", f, "step"));
      add(checkField("Deuxième direction (grille)", f, "two"));
      if (f.two) add(segField("Deuxième axe", f, "axis2", [["x", "X"], ["y", "Y"], ["z", "Z"]]), exprField("Nombre dans la 2ᵉ direction", f, "count2", ""), exprField("Écart dans la 2ᵉ direction", f, "step2"));
    }
  }
  if (f.type === "plane") {
    add(planeFields(f, true, "base", "Part du plan", false));
    add(exprField("Distance (décalage)", f, "offset", "mm", { after: renderOverlay }));
    add(segField("Inclinaison autour de", f, "rot", [["x", "son axe horizontal"], ["y", "son axe vertical"]]));
    add(exprField("Angle d’inclinaison", f, "angle", "°", { step: 15, after: renderOverlay }));
    add(h("div", { class: "note" }, "Ce plan apparaît ensuite dans la liste « Plan » des esquisses et des perçages."));
  }
  if (f.type === "loft") {
    const opts = [["", "—"], ...sketchOptions(f)];
    (f.sketches || (f.sketches = ["", ""])).forEach((id, i) => {
      add(h("div", { class: "field" }, h("label", {}, `Esquisse ${i + 1}`), h("div", { class: "in" },
        h("select", { onchange: (e) => mutate(() => { f.sketches[i] = e.target.value; }) }, opts.map(([v, t]) => h("option", { value: v, selected: v === id }, t))),
        f.sketches.length > 2 ? h("button", { class: "btn", title: "Retirer", onclick: () => { mutate(() => f.sketches.splice(i, 1)); renderProps(); } }, "✕") : null)));
    });
    add(h("div", { class: "btnrow" }, h("button", { class: "btn", onclick: () => { mutate(() => f.sketches.push("")); renderProps(); } }, "+ Ajouter une esquisse")));
    add(segField("Effet", f, "mode", [["add", "Ajouter"], ["cut", "Enlever"]]));
    add(checkField("Faces droites entre les esquisses", f, "ruled"));
    add(h("div", { class: "note" }, "Chaque esquisse doit contenir un seul contour, sans trou, sur des plans différents."));
  }
  if (f.type === "sweep") {
    add(selectField("Profil (esquisse)", f.profile, [["", "—"], ...sketchOptions(f)], (v) => mutate(() => { f.profile = v; })));
    add(selectField("Chemin (esquisse)", f.path, [["", "—"], ...sketchOptions(f)], (v) => mutate(() => { f.path = v; })));
    add(segField("Effet", f, "mode", [["add", "Ajouter"], ["cut", "Enlever"]]));
    add(h("div", { class: "note" }, "Dessine le profil centré sur l’origine de son esquisse : il est placé automatiquement au début du chemin, perpendiculairement."));
  }
  if (f.type === "draft") {
    add(exprField("Angle de dépouille", f, "angle", "°", { step: 0.5 }));
    add(planeFields(f, false, "plane", "Plan neutre (reste fixe)"));
    add(h("div", { class: "note" }, `${(f.faces || []).length} face(s) choisie(s).`));
    add(h("div", { class: "btnrow" }, st.pick?.featId === f.id ? null : h("button", { class: "btn", onclick: () => startPick("faces", f.id) }, "Choisir les faces")));
  }
  if (f.type === "import") {
    add(h("div", { class: "note" }, `Fichier : ${f.file || "?"} (${(f.format || "").toUpperCase()}, ${nf((f.data || "").length * 0.75 / 1024, 0)} Ko)`));
    add(segField("Effet", f, "mode", [["add", "Ajouter"], ["cut", "Enlever"]]));
    add(exprField("Échelle", f, "scale", "×", { step: 0.1 }), exprField("Déplacement X", f, "tx"), exprField("Déplacement Y", f, "ty"), exprField("Déplacement Z", f, "tz"));
    if (f.format === "stl") add(h("div", { class: "note" }, "Un STL est un maillage : les congés et perçages fonctionnent mal dessus. Préfère le STEP quand tu l’as."));
  }
  if (f.type !== "sketch") add(h("div", { class: "note" }, "Tout s’applique en direct. Entrée ou ✓ pour valider, Échap ou ✕ pour annuler."));
  add(h("div", { class: "btnrow", style: "margin-top:6px" },
    h("button", { class: "btn danger", onclick: () => deleteFeature(f.id) }, "Supprimer"),
    h("button", { class: "btn ghost", title: "Met l’étape en pause sans la supprimer (pour comparer avec et sans)", onclick: () => mutate(() => { f.suppressed = !f.suppressed; }) || renderProps() }, f.suppressed ? "Réactiver" : "Mettre en pause")));
  void vars;
}

// ---------- Contraintes d'esquisse ----------
function solveAndWrite(f, pins = []) {
  if (!f.constraints?.length) return true;
  const v = varsMap(doc.params); const ents = [];
  for (const e of f.entities || []) { try { ents.push(evalEntity(e, v)); } catch { /* ignorée */ } }
  let r = solveSketch(ents, f.entities, f.constraints, v, pins);
  if (pins.length) r = solveSketch(ents, f.entities, f.constraints, v);
  if (r.ok || !pins.length) writeBack(ents, f.entities);
  return r.ok;
}
function measureOf(c, f) {
  const v = varsMap(doc.params); const byId = new Map();
  for (const e of f.entities) { try { byId.set(e.id, evalEntity(e, v)); } catch { /* ignorée */ } }
  const R = c.refs;
  const pt = (r) => { if (r.e === "origin") return [0, 0]; const o = byId.get(r.e); if (!o) return [0, 0]; if (o.pts) return o.pts[r.k]; if (o.type === "slot") return r.k ? [o.x2, o.y2] : [o.x1, o.y1]; return [o.cx, o.cy]; };
  if (c.type === "length") { const o = byId.get(R[0].e); const a = o.pts[R[0].k], b = o.pts[(R[0].k + 1) % o.pts.length]; return Math.hypot(b[0] - a[0], b[1] - a[1]); }
  if (c.type === "distance") { const a = pt(R[0]), b = pt(R[1]); return Math.hypot(b[0] - a[0], b[1] - a[1]); }
  if (c.type === "diameter") return byId.get(R[0].e).d;
  if (c.type === "fix") return pt(R[0]);
  return null;
}
function addConstraint(type, refs) {
  const f = feat(st.editSketch); if (!f) return;
  const c = { id: newId("c"), type, refs: refs.map((r) => ({ e: r.e, k: r.k, kind: r.kind })) };
  if (["length", "distance", "diameter"].includes(type)) c.value = String(Math.round(measureOf(c, f) * 100) / 100);
  if (type === "fix") c.at = measureOf(c, f).slice(0, 2);
  mutate(() => { f.constraints = f.constraints || []; f.constraints.push(c); solveAndWrite(f); });
  const ok = sketcher.evaluated() && sketcher.solveState?.ok !== false;
  if (!ok) toast("Cette contrainte entre en conflit avec les autres. Annule-la (Ctrl+Z) ou retire une autre contrainte.");
  renderProps(); sketcher.render();
}
function constraintPanel(f) {
  const out = [];
  const subs = sketcher.subs || [];
  const segs = subs.filter((r) => r.kind === "seg"), pts = subs.filter((r) => r.kind === "pt"), circs = subs.filter((r) => r.kind === "circ");
  const btns = [];
  const B = (type, refs, label) => btns.push(h("button", { class: "btn", title: C_LABELS[type], onclick: () => addConstraint(type, refs) }, h("b", { style: "color:#7a3fd1" }, C_GLYPH[type] + " "), label || C_LABELS[type]));
  if (segs.length === 1 && !pts.length && !circs.length) { B("horizontal", segs); B("vertical", segs); B("length", segs, "Cote de longueur"); }
  if (segs.length === 2 && !pts.length) {
    B("parallel", segs); B("perpendicular", segs); B("equal", segs, "Même longueur");
    if (segs[0].e === segs[1].e) B("tangent", segs);
  }
  if (circs.length === 1 && subs.length === 1) B("diameter", circs, "Cote de diamètre");
  if (circs.length === 2 && subs.length === 2) { B("equal", circs, "Même diamètre"); B("coincident", circs.map((c) => ({ e: c.e, k: "c", kind: "pt" })), "Concentriques"); }
  if (pts.length === 1 && subs.length === 1 && pts[0].e !== "origin") { B("fix", pts); B("onH", pts); B("onV", pts); B("coincident", [pts[0], { e: "origin", kind: "pt" }], "Sur l’origine"); }
  if (pts.length === 2 && subs.length === 2) { B("coincident", pts); B("distance", pts, "Cote de distance"); B("hAlign", pts); B("vAlign", pts); B("symV", pts); B("symH", pts); }
  out.push(h("h2", {}, "Contraintes"));
  const stt = sketcher.solveState;
  const nC = (f.constraints || []).length;
  if (stt && nC) out.push(h("div", { class: "dof" + (!stt.ok ? " bad" : stt.dof === 0 ? " full" : "") }, !stt.ok ? "Contraintes incompatibles : retire la dernière." : stt.dof === 0 ? "Esquisse entièrement contrainte." : `Encore ${stt.dof} degré(s) de liberté.`));
  if (btns.length) out.push(h("div", { class: "cbtns" }, btns));
  else out.push(h("div", { class: "param-empty" }, subs.length ? "Aucune contrainte possible pour cette sélection." : "Clique sur un côté, un point ou un cercle (Maj+clic pour en choisir plusieurs) pour proposer des contraintes."));
  const list = h("div", { class: "clist" });
  const name = (r) => { if (r.e === "origin") return "origine"; const e = f.entities.find((x) => x.id === r.e); const base = ENT_LABELS[e?.type] || "?"; if (r.kind === "seg") return `${base}, côté ${r.k + 1}`; if (r.kind === "pt") return typeof r.k === "number" ? `${base}, point ${r.k + 1}` : `${base}, centre`; return base; };
  for (const c of f.constraints || []) {
    list.append(h("div", { class: "citem", title: (c.refs || []).map(name).join(" + ") },
      h("span", { class: "g" }, C_GLYPH[c.type] || "?"),
      h("span", {}, C_LABELS[c.type]),
      c.value !== undefined ? h("input", { value: c.value, "aria-label": "Valeur", oninput: (e) => mutate(() => { c.value = e.target.value; solveAndWrite(f); }, true), onchange: () => { pushHistory(); renderProps(); } }) : h("span"),
      h("button", { class: "x", title: "Retirer", onclick: () => { mutate(() => { f.constraints = f.constraints.filter((x) => x !== c); }); renderProps(); sketcher.render(); } }, "✕")));
  }
  out.push(list);
  return out;
}

// ---------- Mode esquisse ----------
const SK_TOOLS = [["select", "Choisir"], ["rect", "Rectangle"], ["circle", "Cercle"], ["slot", "Rainure"], ["polygon", "Polygone"], ["ellipse", "Ellipse"], ["poly", "Contour libre"], ["spline", "Courbe"], ["path", "Chemin"], ["text", "Texte"], ["convert", "Reprendre"]];
const SK_HINTS = {
  select: "Clique sur une forme pour la choisir, puis glisse-la ou modifie ses cotes à droite. Molette : zoom. Clic droit ou glisser dans le vide : déplacer la vue.",
  rect: "Glisse d’un coin à l’autre (ou clique deux fois). Maj : sans accroche.",
  circle: "Clique au centre, puis au bord.",
  slot: "Clique au premier centre, puis au second. Règle la largeur à droite.",
  polygon: "Clique au centre, puis sur un sommet.",
  poly: "Clique chaque point. Pour fermer : reclique sur le premier point, double-clique, ou Entrée. Ensuite, tire le rond au milieu d’un côté pour le courber en arc.",
  text: "Clique où le texte doit commencer, puis tape-le à droite. Dans un contour, il est gravé à travers ; seul, il donne des lettres en relief.",
  ellipse: "Clique au centre, puis au coin du rectangle qui l’entoure.",
  spline: "Courbe lisse qui passe par chaque point cliqué. Reclique sur le premier point pour la fermer, ou double-clique (Entrée) pour la laisser ouverte, par exemple pour un balayage.",
  path: "Chemin ouvert pour un balayage : clique chaque point, puis double-clique ou Entrée pour finir.",
  convert: "Clique sur une arête de la pièce (en pointillé) pour la reprendre dans l’esquisse. Les arêtes qui se touchent se raccordent ; un tour fermé devient un contour qu’on peut extruder.",
};
let sketcher;
function openSketch(id, isNew = false) {
  stopPick(false); clearFaceSel();
  st.editSketch = id; st.sel = id; st.skSel = null; st.skNew = isNew; st.skSnap = JSON.stringify(doc);
  $("#sketch").hidden = false; $("#views").hidden = true; banner(null);
  sketcher.sel = null; sketcher.setTool(isNew ? "rect" : "select");
  updateSketchRefs();
  requestAnimationFrame(() => sketcher.fitView());
  renderTree(); renderProps(); requestBuild(0);
}
// ✕ de l'esquisse : oublie les changements faits depuis l'ouverture.
function cancelSketch() {
  const id = st.editSketch, isNew = st.skNew, snap = st.skSnap;
  st.afterSketch = null; closeSketch(true);
  if (snap) { doc = JSON.parse(snap); if (isNew) doc.features = doc.features.filter((f) => f.id !== id); pushHistory(); save(); }
  st.sel = null; renderAll(); requestBuild(0);
}
function closeSketch(silent) {
  if (!st.editSketch) return;
  const id = st.editSketch; st.editSketch = null; st.afterLabel = null;
  $("#sketch").hidden = true; $("#views").hidden = false; st.skPlane = null; viewer.setSketchView(null);
  document.querySelectorAll(".tbtn[data-tool]").forEach((b) => (b.disabled = false));
  if (silent) return;
  const f = feat(id);
  if (f && !(f.entities || []).length && st.skNew) { mutate((d) => d.features.splice(featIndex(id), 1)); st.sel = null; st.afterSketch = null; }
  else if (f && st.afterSketch) { const cb = st.afterSketch; st.afterSketch = null; st.afterLabel = null; cb(id); }
  else st.sel = id;
  renderAll(); requestBuild(0);
}
function updateSketchRefs() {
  const f = feat(st.editSketch); if (!f || !sketcher) return;
  let pl; try { pl = resolvePlane(f.plane, varsMap(doc.params)); } catch { return; }
  st.skPlane = pl;
  const lines = [], pts = [], edges = [];
  const m = st.mesh;
  if (m) {
    const L = m.lines; const tol = Math.max(0.01, viewer.size / 2000);
    const proj = (i) => { const d = [L[i] - pl.origin[0], L[i + 1] - pl.origin[1], L[i + 2] - pl.origin[2]]; return [dot(d, pl.x), dot(d, pl.y), dot(d, pl.n)]; };
    for (let i = 0; i + 5 < L.length; i += 6) {
      const a = proj(i), b = proj(i + 3);
      lines.push([[a[0], a[1]], [b[0], b[1]]]);
    }
    const seen = new Set();
    const addPt = (p) => { const q = [round(p[0], 0.001), round(p[1], 0.001)]; const k = q.join(","); if (!seen.has(k)) { seen.add(k); pts.push(q); } };
    for (const g of m.edgeGroups) {
      // arête projetée : polyligne 2D (les segments sont stockés par paires)
      const poly = []; let flat = true;
      for (let v = g.start; v < g.start + g.count; v++) {
        if (v > g.start && (v - g.start) % 2 === 0) continue;
        const p = proj(v * 3); if (Math.abs(p[2]) > tol) flat = false;
        poly.push([p[0], p[1]]);
      }
      const last = proj((g.start + g.count - 1) * 3); poly.push([last[0], last[1]]);
      const clean = poly.filter((p, i) => i === 0 || Math.hypot(p[0] - poly[i - 1][0], p[1] - poly[i - 1][1]) > 1e-6);
      if (clean.length >= 2) edges.push({ pts: clean, flat });
      addPt(proj(g.start * 3)); addPt(last);
    }
  }
  sketcher.refs = { lines, pts, edges };
  sketcher.render();
}
// Vue 3D calée sous l'esquisse : la pièce reste visible pendant qu'on dessine.
function syncSketchView() {
  if (!st.editSketch || !st.skPlane || !sketcher) { viewer.setSketchView(null); return; }
  const sv = $("#skSvg").getBoundingClientRect(), vr = $("#view").getBoundingClientRect();
  if (!sv.width || !vr.width) return;
  const sx = vr.left + vr.width / 2 - sv.left, sy = vr.top + vr.height / 2 - sv.top;
  const cu = (sx - sketcher.W / 2) / sketcher.zoom + sketcher.pan[0];
  const cv = (sketcher.H / 2 - sy) / sketcher.zoom + sketcher.pan[1];
  viewer.setSketchView({ pl: st.skPlane, cu, cv, zoom: sketcher.zoom });
}
function renderSketchTools() {
  const box = $("#skTools"); box.innerHTML = "";
  for (const [k, label] of SK_TOOLS) box.append(h("button", { class: "tbtn" + (sketcher.tool === k ? " on" : ""), onclick: () => sketcher.setTool(k) }, h("span", { html: ICONS[k] }), label));
  box.append(h("hr"), h("label", {}, "Pas de grille"),
    h("select", { onchange: (e) => { sketcher.snapStep = Number(e.target.value); sketcher.render(); } }, [0.1, 0.5, 1, 2, 5, 10].map((v) => h("option", { value: v, selected: v === sketcher.snapStep }, nf(v) + " mm"))),
    h("hr"), h("button", { class: "tbtn", onclick: () => sketcher.fitView() }, h("span", { html: ICONS.fit }), "Recadrer"),
    h("button", { class: "tbtn on", title: "Entrée", onclick: () => closeSketch() }, h("span", { html: ICONS.done }), st.afterLabel || "Valider"));
  $("#skHint").textContent = fr(SK_HINTS[sketcher.tool] || "");
}
const ENT_LABELS = { rect: "Rectangle", circle: "Cercle", polygon: "Polygone", slot: "Rainure", poly: "Contour libre", path: "Chemin", point: "Point", ellipse: "Ellipse", spline: "Courbe", text: "Texte" };
function renderSketchProps(P) {
  const f = feat(st.editSketch); if (!f) return;
  P.append(h("div", { class: "okbar" },
    h("button", { class: "ok", title: "Sortir de l’esquisse (Entrée)", "aria-label": "Valider", onclick: () => closeSketch() }, "✓"),
    h("button", { class: "ko", title: "Annuler l’esquisse (oublier les changements)", "aria-label": "Annuler", onclick: () => cancelSketch() }, "✕"),
    h("span", { class: "lbl" }, st.afterLabel ? `✓ = ${st.afterLabel}` : "Esquisse")));
  P.append(h("div", { class: "head" }, h("span", { class: "ic", html: ICONS.sketch }), h("input", { value: f.name, onchange: (e) => mutate(() => { f.name = e.target.value.trim() || f.name; }) })));
  P.append(...planeFields(f));
  const ents = f.entities || [];
  const e = ents.find((x) => x.id === st.skSel);
  if (e) {
    P.append(h("h2", {}, ENT_LABELS[e.type]));
    let err = null; try { const o = evalEntity(e, varsMap(doc.params)); outline(o); } catch (x) { err = x.message; }
    if (err) P.append(h("div", { class: "note err" }, err));
    const F = (label, key, unit = "mm", o = {}) => exprField(label, e, key, unit, o);
    if (e.type === "rect") P.append(F("Largeur", "w"), F("Hauteur", "h"), F("Centre X", "cx"), F("Centre Y", "cy"), F("Rayon des angles", "r"), F("Rotation", "a", "°", { step: 15 }));
    if (e.type === "circle") P.append(F("Diamètre", "d"), F("Centre X", "cx"), F("Centre Y", "cy"));
    if (e.type === "polygon") P.append(F("Nombre de côtés", "n", ""), F("Diamètre (cercle extérieur)", "d"), F("Centre X", "cx"), F("Centre Y", "cy"), F("Rotation", "a", "°", { step: 15 }));
    if (e.type === "slot") P.append(F("Largeur", "w"), F("Centre 1 : X", "x1"), F("Centre 1 : Y", "y1"), F("Centre 2 : X", "x2"), F("Centre 2 : Y", "y2"));
    if (e.type === "text") {
      const ti = h("input", { type: "text", value: e.txt ?? "", oninput: (ev) => mutate(() => { e.txt = ev.target.value; }, true), onchange: () => pushHistory() });
      P.append(h("div", { class: "field" }, h("label", {}, "Texte"), h("div", { class: "in" }, ti)), F("Hauteur des majuscules", "h"), F("Départ X", "cx"), F("Départ Y", "cy"), F("Rotation", "a", "°", { step: 15 }));
    }
    if (e.type === "ellipse") P.append(F("Demi-axe a", "rx"), F("Demi-axe b", "ry"), F("Centre X", "cx"), F("Centre Y", "cy"), F("Rotation", "a", "°", { step: 15 }));
    if (e.type === "spline") P.append(h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!e.closed, onchange: (ev) => { mutate(() => { e.closed = ev.target.checked; }); renderProps(); } }), "Courbe fermée"));
    if (e.type === "poly" || e.type === "path" || e.type === "spline") {
      if (e.type === "poly") P.append(F("Congé des angles", "r"));
      P.append(h("h2", {}, e.type === "spline" ? "Points de passage (X, Y)" : "Points (X, Y, flèche de l’arc)"));
      const box = h("div", { class: "pts" });
      e.pts.forEach((p, i) => {
        const mk = (j) => h("input", { value: p[j], "aria-label": j ? "Y" : "X", oninput: (ev) => mutate(() => { p[j] = ev.target.value; }, true), onchange: () => pushHistory() });
        const mk3 = e.type === "spline" ? h("span") : h("input", { value: p[2] ?? "", placeholder: "0", title: "Flèche : courbe le côté qui part de ce point (0 = droit)", oninput: (ev) => mutate(() => { p[2] = ev.target.value; }, true), onchange: () => pushHistory() });
        box.append(h("div", { class: "pt pt3" }, String(i + 1), mk(0), mk(1), mk3, h("button", { class: "x", title: "Retirer ce point", onclick: () => { if (e.pts.length <= (e.type === "path" || (e.type === "spline" && !e.closed) ? 2 : 3)) { toast("Il n’y a pas assez de points."); return; } mutate(() => { e.pts.splice(i, 1); f.constraints = (f.constraints || []).filter((c) => (c.refs || []).every((r) => r.e !== e.id)); }); renderProps(); } }, "✕")));
      });
      P.append(box);
    }
    const cons = h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!e.construction, onchange: (ev) => { mutate(() => { e.construction = ev.target.checked; }); renderProps(); } }), "Trait de construction (ignoré pour le volume)");
    P.append(cons, h("div", { class: "btnrow" },
      h("button", { class: "btn", onclick: () => { const c = JSON.parse(JSON.stringify(e)); c.id = newId("e"); const off = (k) => { const n = Number(String(c[k]).replace(",", ".")); if (isFinite(n)) c[k] = String(n + 5); }; ["cx", "x1", "x2"].forEach(off); ["cy", "y1", "y2"].forEach(off); if (c.pts) c.pts = c.pts.map((q) => q.map((v, k) => { const n = Number(v); return k < 2 && isFinite(n) ? String(n + 5) : v; })); mutate(() => f.entities.push(c)); st.skSel = c.id; sketcher.sel = c.id; renderProps(); sketcher.render(); } }, "Dupliquer"),
      h("button", { class: "btn danger", onclick: () => sketcher.deleteSel() }, "Supprimer")));
    P.append(h("h2", {}, "Copier autrement"), h("div", { class: "btnrow" },
      h("button", { class: "btn", title: "Copie symétrique par rapport à l’axe vertical (Y)", onclick: () => mirrorEntity(f, e, 0) }, "Symétrie gauche-droite"),
      h("button", { class: "btn", title: "Copie symétrique par rapport à l’axe horizontal (X)", onclick: () => mirrorEntity(f, e, 1) }, "Symétrie haut-bas")));
    if (e.type !== "point") {
      const dist = h("input", { type: "text", value: "2", inputmode: "decimal", style: "width:70px" });
      P.append(h("div", { class: "field" }, h("label", {}, "Décalage (positif : vers l’extérieur)"), h("div", { class: "in" }, dist, h("span", { class: "unit" }, "mm"),
        h("button", { class: "btn", onclick: () => offsetEntity(f, e, dist.value) }, "Créer le décalage"))));
    }
  }
  P.append(...constraintPanel(f));
  P.append(h("h2", {}, `Formes (${ents.length})`));
  const list = h("div", { class: "ents" });
  ents.forEach((x) => list.append(h("div", { class: "feat" + (x.id === st.skSel ? " sel" : ""), onclick: () => { st.skSel = x.id; sketcher.sel = x.id; sketcher.setTool("select"); renderProps(); sketcher.render(); } }, h("span", { class: "ic", html: ICONS[x.type] }), h("span", { class: "nm" }, ENT_LABELS[x.type] + (x.construction ? " (construction)" : "")))));
  if (!ents.length) list.append(h("div", { class: "param-empty" }, "Choisis un outil à gauche et dessine. Les formes placées à l’intérieur d’une autre deviennent des trous."));
  P.append(list);
  P.append(h("div", { class: "btnrow" }, h("button", { class: "btn primary", title: "Entrée", onclick: () => closeSketch() }, "✓ " + (st.afterLabel || "Valider l’esquisse"))));
}

// ---------- Symétrie et décalage d'esquisse ----------
const isNumStr = (v) => v !== undefined && v !== "" && isFinite(Number(String(v).replace(",", ".")));
const toN = (v) => Number(String(v).replace(",", "."));
const r6 = (v) => String(Math.round(v * 1e6) / 1e6);
const negE = (v) => (v === undefined || v === "" ? v : isNumStr(v) ? r6(-toN(v)) : `-(${v})`);
const addE = (v, d) => (isNumStr(v) && isNumStr(d) ? r6(toN(v) + toN(d)) : `(${v || 0})+(${d})`);
const mulE = (v, k) => (isNumStr(v) ? r6(toN(v) * k) : `(${v})*${r6(k)}`);
function addSketchEntity(f, c) {
  c.id = newId("e");
  mutate(() => f.entities.push(c)); st.skSel = c.id; sketcher.sel = c.id; renderProps(); sketcher.render();
}
function mirrorEntity(f, e, axis) {
  const c = JSON.parse(JSON.stringify(e)); const X = axis === 0 ? "x" : "y";
  if ("c" + X in c) c["c" + X] = negE(c["c" + X]);
  if (c.type === "slot") { c[X + "1"] = negE(c[X + "1"]); c[X + "2"] = negE(c[X + "2"]); }
  if (c.type === "rect" || c.type === "ellipse") c.a = negE(c.a || "0");
  if (c.type === "polygon") c.a = axis === 0 ? addE("180", negE(c.a || "0")) : negE(c.a || "0");
  if (c.pts) c.pts = c.pts.map((q) => { const r = [...q]; r[axis] = negE(q[axis]); if (r[2] !== undefined && r[2] !== "") r[2] = negE(r[2]); return r; });
  addSketchEntity(f, c);
}
function offsetEntity(f, e, dRaw) {
  const d = String(dRaw).replace(",", ".").trim(); if (!d) return;
  const c = JSON.parse(JSON.stringify(e)); delete c.construction;
  const vars = varsMap(doc.params); let dv; try { dv = evalExpr(d, vars); } catch { toast("Décalage invalide."); return; }
  if (c.type === "circle") c.d = addE(c.d, mulE(d, 2));
  else if (c.type === "slot") c.w = addE(c.w, mulE(d, 2));
  else if (c.type === "rect") { c.w = addE(c.w, mulE(d, 2)); c.h = addE(c.h, mulE(d, 2)); const r = evalExpr(String(c.r || 0), vars); c.r = r + dv > 0 ? addE(c.r || "0", d) : "0"; }
  else if (c.type === "ellipse") { c.rx = addE(c.rx, d); c.ry = addE(c.ry, d); }
  else if (c.type === "polygon") c.d = addE(c.d, mulE(d, 2 / Math.cos(Math.PI / evalExpr(String(c.n), vars))));
  else if (c.pts) {
    const o = evalEntity(e, vars); const P = o.pts; const n = P.length;
    const closed = c.type === "poly" || (c.type === "spline" && c.closed);
    if (P.some((q) => q[2])) { toast("Le décalage ne gère pas encore les côtés courbés : redresse-les ou dessine une courbe."); return; }
    let area = 0; for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const sg = closed ? (area > 0 ? 1 : -1) : -1; // fermé : vers l'extérieur ; ouvert : vers la droite
    const nrm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dy / L * sg, -dx / L * sg]; };
    c.pts = P.map((q, i) => {
      const prev = closed ? P[(i - 1 + n) % n] : P[i - 1], next = closed ? P[(i + 1) % n] : P[i + 1];
      const n1 = prev ? nrm(prev, q) : null, n2 = next ? nrm(q, next) : null;
      let m = n1 && n2 ? [n1[0] + n2[0], n1[1] + n2[1]] : (n1 || n2); const k = n1 && n2 ? 1 + n1[0] * n2[0] + n1[1] * n2[1] : 1;
      const s = n1 && n2 ? (k > 0.05 ? 1 / k : 20) : 1; m = [m[0] * s, m[1] * s];
      return [r6(q[0] + m[0] * dv), r6(q[1] + m[1] * dv)];
    });
    if (f.constraints?.length) { /* les contraintes ne sont pas copiées */ }
  }
  addSketchEntity(f, c);
}

// ---------- Esquisses en 3D ----------
function renderOverlay() {
  renderPlanes();
  const vars = varsMap(doc.params);
  const used = new Set(doc.features.filter((f) => f.sketch).map((f) => f.sketch));
  const list = [];
  for (const f of doc.features) {
    if (f.type !== "sketch" || f.suppressed) continue;
    const active = f.id === st.sel;
    if (!active && used.has(f.id)) continue;
    try {
      const pl = resolvePlane(f.plane, vars);
      const loops = (f.entities || []).map((e) => { let o = outline(evalEntity(e, vars)); if (e.type === "path" || (e.type === "spline" && !e.closed)) o = o.concat(o.slice(1, -1).reverse()); return o.map((p) => toWorld(pl, p[0], p[1])); });
      list.push({ loops, active });
    } catch { /* esquisse invalide */ }
  }
  viewer.setOverlay(list);
}

// ---------- Plans de référence en 3D ----------
function renderPlanes() {
  const vars = varsMap(doc.params); const refs = refPlanes(doc.features, vars);
  const size = Math.max(40, viewer.size * 0.6);
  const list = [];
  for (const f of doc.features) {
    if (f.type !== "plane" || f.suppressed || !refs[f.id]) continue;
    const r = refs[f.id]; list.push({ origin: r.origin, x: r.x, y: cross(r.n, r.x), size, active: st.sel === f.id });
  }
  viewer.setPlanes(list);
}

// ---------- Mesure ----------
let measurePts = [];
function toggleMeasure() {
  if (viewer.pickMode?.kind === "measure") { stopMeasure(); return; }
  if (!st.mesh) { toast("Il n’y a rien à mesurer pour l’instant."); return; }
  stopPick(); measurePts = []; viewer.setMeasure([]);
  banner("Clique sur deux points de la pièce (les coins sont aimantés).", [["Fermer", stopMeasure]]);
  viewer.setPick({ kind: "measure", onPick: (hit) => {
    if (measurePts.length >= 2) measurePts = [];
    measurePts.push(hit.p); viewer.setMeasure(measurePts);
    if (measurePts.length === 2) {
      const [a, b] = measurePts; const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      banner(`Distance : ${nf(Math.hypot(...d), 2)} mm (X ${nf(Math.abs(d[0]), 2)} · Y ${nf(Math.abs(d[1]), 2)} · Z ${nf(Math.abs(d[2]), 2)})`, [["Nouvelle mesure", () => { measurePts = []; viewer.setMeasure([]); }], ["Fermer", stopMeasure]]);
    } else banner(`Point 1 : ${a3(hit.p)}. Clique sur le second point.`, [["Fermer", stopMeasure]]);
  } });
  markTool("measure", true);
}
const a3 = (p) => p.map((v) => nf(v, 2)).join(" ; ");
function stopMeasure() { if (viewer.pickMode?.kind !== "measure") return; viewer.setPick(null); viewer.setMeasure([]); banner(null); markTool("measure", false); }
function markTool(k, on) { document.querySelector(`.tbtn[data-tool=${k}]`)?.classList.toggle("on", on); }

// ---------- Vue en coupe ----------
function toggleSection() {
  if (viewer.section) { viewer.setSection(null); $("#secbar")?.remove(); markTool("section", false); return; }
  const bb = (isAsm() && viewer.asmBox ? [viewer.asmBox.min.toArray(), viewer.asmBox.max.toArray()] : st.mesh?.bb) || [[-50, -50, -50], [50, 50, 50]];
  const sec = { axis: "y", pos: (bb[0][1] + bb[1][1]) / 2, flip: true };
  const range = () => { const k = { x: 0, y: 1, z: 2 }[sec.axis]; return [bb[0][k], bb[1][k]]; };
  const bar = h("div", { class: "secbar", id: "secbar" });
  const slider = h("input", { type: "range", min: 0, max: 1000, value: 500 });
  const lab = h("span", { class: "seclab" });
  const upd = () => { const [a, b] = range(); sec.pos = a + (b - a) * slider.value / 1000; lab.textContent = `${sec.axis.toUpperCase()} = ${nf(sec.pos, 1)} mm`; viewer.setSection({ ...sec }); };
  const seg = h("div", { class: "seg" }, ["x", "y", "z"].map((a) => h("button", { class: a === sec.axis ? "on" : "", onclick: (e) => { sec.axis = a; sec.flip = a === "y"; seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target)); upd(); } }, a.toUpperCase())));
  slider.addEventListener("input", upd);
  bar.append(h("b", {}, "Coupe"), seg, slider, lab, h("button", { class: "btn", onclick: () => { sec.flip = !sec.flip; upd(); } }, "Inverser"), h("button", { class: "btn", onclick: toggleSection }, "Fermer"));
  $(".stage").append(bar); upd(); markTool("section", true);
}

// ---------- Import STEP / STL ----------
function importFile() {
  const inp = h("input", { type: "file", accept: ".step,.stp,.stl", hidden: true });
  inp.addEventListener("change", async () => {
    const file = inp.files[0]; if (!file) return;
    if (file.size > 25e6) { toast("Fichier trop gros (25 Mo au maximum)."); return; }
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const format = /\.stl$/i.test(file.name) ? "stl" : "step";
    insertFeature({ id: newId("f"), type: "import", name: file.name.replace(/\.[^.]+$/, ""), file: file.name, format, data: btoa(bin), mode: "add", scale: "1", tx: "0", ty: "0", tz: "0" });
    st.firstFit = true;
  });
  document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
}

// ---------- Mise en plan ----------
function openDrawing() {
  if (!st.mesh) { toast("Crée d’abord une pièce."); return; }
  if (st.stopAt !== null || st.pick || st.editSketch) { toast("Termine l’édition en cours, puis remets la fin de la pièce tout en bas."); return; }
  const req = ++exportReq; showBusy(true, "Calcul des vues…");
  pendingExport.set(req, (views) => { showBusy(false); drawingDialog(views); });
  worker.postMessage({ type: "drawing", req, views: ["front", "top", "right", "iso"] });
}
function drawingDialog(views) {
  const opts = doc.drawing || (doc.drawing = { format: "A4", scale: "auto", hidden: true, dims: true, iso: true, author: "" });
  const dlg = $("#dlg"); dlg.innerHTML = ""; dlg.classList.add("wide");
  const prev = h("div", { class: "sheet" });
  let current = null;
  const mat = MATERIALS[doc.material] || MATERIALS.pla;
  const redraw = () => {
    current = sheetSVG(views, { ...opts, title: doc.name, material: mat[0], mass: nf(st.mesh.volume / 1000 * mat[1], 1) + " g", date: new Date().toLocaleDateString("fr-FR") });
    prev.innerHTML = current.svg;
  };
  const ctl = (label, el) => h("div", { class: "field" }, h("label", {}, label), el);
  const sel = (key, list) => h("select", { onchange: (e) => { opts[key] = e.target.value; save(); redraw(); } }, list.map(([v, t]) => h("option", { value: v, selected: String(opts[key]) === String(v) }, t)));
  const chk = (key, label) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!opts[key], onchange: (e) => { opts[key] = e.target.checked; save(); redraw(); } }), label);
  const side = h("div", { class: "sheet-side" },
    ctl("Format", sel("format", [["A4", "A4 paysage"], ["A3", "A3 paysage"]])),
    ctl("Échelle", sel("scale", [["auto", "Automatique"], ...[10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02].map((v) => [v, v >= 1 ? `${v} : 1` : `1 : ${Math.round(1 / v)}`])])),
    chk("hidden", "Arêtes cachées en pointillé"), chk("dims", "Cotes (encombrement et trous)"), chk("iso", "Vue en perspective"),
    ctl("Dessiné par", h("input", { type: "text", value: opts.author || "", oninput: (e) => { opts.author = e.target.value; save(); redraw(); } })),
    h("div", { class: "btnrow" },
      h("button", { class: "btn primary", onclick: () => printSheet(current) }, "Imprimer ou PDF"),
      h("button", { class: "btn", onclick: () => download(new Blob([current.svg], { type: "image/svg+xml" }), `${safeName()} - plan.svg`) }, "Télécharger SVG")),
    h("div", { class: "note" }, "Pour un PDF, choisis « Enregistrer au format PDF » comme imprimante."),
    h("div", { class: "btnrow" }, h("button", { class: "btn", onclick: () => { dlg.close(); dlg.classList.remove("wide"); } }, "Fermer")));
  dlg.append(h("div", { class: "dh" }, "Mise en plan"), h("div", { class: "sheet-wrap" }, side, prev));
  redraw(); dlg.showModal();
  dlg.addEventListener("close", () => dlg.classList.remove("wide"), { once: true });
}
function printSheet(cur) {
  const w = window.open("", "_blank");
  if (!w) { toast("Autorise les fenêtres pour imprimer, ou télécharge le SVG."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safeName()} - plan</title><style>@page{size:${cur.W}mm ${cur.H}mm;margin:0}html,body{margin:0}svg{display:block}</style></head><body>${cur.svg}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

// ---------- Barre d'état ----------
function renderStatus() {
  const s = $("#status"); s.innerHTML = "";
  const m = st.mesh;
  const mat = MATERIALS[doc.material] || MATERIALS.pla;
  const errCount = Object.keys(st.errors).length;
  if (m) {
    const [a, b] = m.bb; const vol = m.volume / 1000;
    s.append(
      h("span", {}, "Volume ", h("b", {}, nf(vol, 2) + " cm³")),
      h("span", {}, "Masse ", h("b", {}, nf(vol * mat[1], 1) + " g"), " en ",
        h("select", { "aria-label": "Matière", onchange: (e) => { mutate(() => { doc.material = e.target.value; }); renderStatus(); } }, Object.entries(MATERIALS).map(([k, v]) => h("option", { value: k, selected: k === doc.material }, v[0])))),
      h("span", {}, "Encombrement ", h("b", {}, `${nf(b[0] - a[0], 1)} × ${nf(b[1] - a[1], 1)} × ${nf(b[2] - a[2], 1)} mm`)),
      m.cog ? h("label", { class: "cogchk", title: m.cog.map((v) => nf(v, 2)).join(" ; ") }, h("input", { type: "checkbox", checked: st.showCog, onchange: (e) => { st.showCog = e.target.checked; viewer.setCog(st.showCog ? m.cog : null); renderStatus(); } }), "Centre de gravité", st.showCog ? h("b", {}, " " + a3(m.cog)) : null) : null,
    );
  } else s.append(h("span", {}, engineFailed ? "Moteur 3D indisponible dans cet aperçu." : !workerReady ? "Chargement du moteur 3D…" : "Aucun volume pour l’instant."));
  s.append(h("span", { class: "grow" }));
  if (errCount) s.append(h("span", { style: "color:var(--err)" }, `${errCount} étape(s) en erreur`));
  if (st.stopAt !== null) s.append(h("span", { style: "color:var(--blue)" }, "Historique remonté"));
  if (st.lastMs) s.append(h("span", {}, `Calcul ${nf(st.lastMs / 1000, 2)} s`));
  s.append(h("button", { class: "ver", title: "Version installée. Clique pour chercher une mise à jour.", onclick: () => checkUpdate() }, `v${typeof GABARIT_VERSION === "string" ? GABARIT_VERSION : "?"}`));
}
async function checkUpdate() {
  toast("Recherche d’une mise à jour…");
  try { const r = await navigator.serviceWorker?.getRegistration(); await r?.update(); } catch { /* hors ligne */ }
  setTimeout(() => { save(); location.reload(); }, 1200);
}

// ---------- Divers ----------
let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = fr(msg); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3800); }
function showBusy(on, text = "Calcul…") { const b = $("#busy"); b.hidden = !on; if (on) b.lastChild.textContent = fr(text); }
function layoutMode() {
  const M = document.querySelector("main");
  M.classList.toggle("asm", isAsm()); M.classList.toggle("editing", !isAsm() && !!(st.editSketch || feat(st.sel)));
  renderCorner();
}
function renderAll() { layoutMode(); if (isAsm()) { $("#docName").value = doc.name; asmUI.render(); return; } $("#docName").value = doc.name; renderTree(); renderParams(); renderProps(); renderStatus(); renderOverlay(); refreshMarkers(); }

// Accueil au lancement : continuer, nouveau, ouvrir, ou gérer ses pièces récentes.
function welcome(show) {
  const w = $("#welcome"); if (!show) { w.hidden = true; return; }
  const draw = () => {
    w.innerHTML = "";
    const lib = library();
    const names = Object.keys(lib).sort((a, b) => (lib[b].savedAt || 0) - (lib[a].savedAt || 0) || a.localeCompare(b, "fr"));
    const cur = (isAsm() || doc.features?.length) ? doc.name : null;
    const go = (fn) => { welcome(false); fn(); };
    w.append(h("div", { class: "card" },
      h("h1", {}, "Gabarit"),
      h("p", {}, "Ton atelier de conception 3D, gratuit et sans compte."),
      h("div", { class: "btnrow" },
        cur ? h("button", { class: "btn primary", onclick: () => go(() => {}) }, `Continuer : ${cur}`) : null,
        h("button", { class: "btn" + (cur ? "" : " primary"), onclick: () => go(() => { loadDoc(emptyDoc()); toolAction("sketch"); }) }, "Nouvelle pièce"),
        h("button", { class: "btn", onclick: () => go(() => loadDoc(emptyAsm())) }, "Nouvel assemblage"),
        h("button", { class: "btn", onclick: () => go(() => $("#fileIn").click()) }, "Ouvrir un fichier"),
        h("button", { class: "btn ghost", onclick: () => go(() => loadDoc(exampleDoc())) }, "Voir l’exemple")),
      names.length ? h("div", { class: "recents" }, h("h2", {}, "Mes pièces"),
        ...names.map((n) => h("div", { class: "rec" },
          h("button", { class: "rec-open", title: "Ouvrir", onclick: () => go(() => loadDoc(lib[n])) }, h("b", {}, n), h("span", {}, ` · ${lib[n].features.length} étape(s)`)),
          h("button", { class: "rec-del", title: `Supprimer « ${n} »`, "aria-label": `Supprimer ${n}`, onclick: () => { if (!deletePart(n)) return; draw(); } }, "Supprimer")))) : null));
    typoTree(w);
  };
  draw(); w.hidden = false;
}
// Supprime une pièce de « Mes pièces » ; si c'est celle ouverte, on repart d'une pièce vide.
function deletePart(n) {
  if (!confirm(fr(`Supprimer « ${n} » ? Elle disparaît de tes pièces (un fichier .gabarit enregistré ailleurs n’est pas touché).`))) return false;
  const lib = library(); delete lib[n];
  try { localStorage.setItem(LIB, JSON.stringify(lib)); } catch { /* */ }
  if (!isAsm() && (doc.name || "Pièce sans nom") === n) { loadDoc(emptyDoc()); try { localStorage.removeItem(STORE); } catch { /* */ } }
  toast(`« ${n} » supprimée.`);
  return true;
}
function help() {
  const dlg = $("#dlg"); dlg.innerHTML = "";
  dlg.append(h("div", { class: "dh" }, "Comment ça marche"), h("div", { class: "db", html: fr(`
    <h3>1. L’esquisse</h3><p>Clique sur <b>Esquisse</b>, choisis un plan (ou une face de la pièce), puis dessine des rectangles, cercles, rainures, polygones ou un contour libre. Tape les cotes exactes à droite. Une forme placée dans une autre devient un trou.</p>
    <h3>2. Le volume</h3><p><b>Extrusion</b> donne de l’épaisseur, <b>Enlèvement</b> creuse, <b>Révolution</b> fait tourner le profil autour d’un axe (pour les pièces rondes).</p>
    <h3>3. Les finitions</h3><p><b>Perçage</b> : clique sur la face, puis place les trous. <b>Congé</b> et <b>Chanfrein</b> : clique sur les arêtes. <b>Coque</b> : clique sur la face à ouvrir.</p>
    <h3>Formes avancées</h3><p><b>Plan</b> crée un plan décalé ou incliné pour y dessiner. <b>Lissage</b> relie plusieurs esquisses posées sur des plans différents. <b>Balayage</b> fait glisser un profil le long d’un <b>Chemin</b> (outil de l’esquisse). <b>Dépouille</b> incline des faces. <b>Répétition</b> et <b>Symétrie</b> copient toute la pièce ou seulement les fonctions choisies, en ligne, en grille ou en cercle. Dans un contour libre, tire le rond au milieu d’un côté pour le courber.</p>
    <h3>Plus de fonctions</h3><p>Dans l’esquisse : <b>Ellipse</b>, <b>Courbe</b> (lisse, passe par tes points), <b>Texte</b> (gravé dans un contour, en relief tout seul), et pour une forme choisie : <b>Symétrie</b> et <b>Décalage</b>. Dans la pièce : <b>Ressort</b>, <b>Filetage</b> (clique sur un axe ou un trou, le pas ISO est proposé), <b>Nervure</b> (un simple trait d’esquisse entre deux parois) et, dans une extrusion, <b>Jusqu’à : une face</b>. <b>Autres formats</b> : 3MF, OBJ, et DXF d’une esquisse pour la découpe laser.</p>
    <h3>Gagner du temps</h3><p><b>Ctrl+K</b> (ou « Rechercher ») : tape ce que tu veux faire, par exemple « trou », « arrondir » ou « filet ». <b>Partager</b> donne un lien qui contient toute la pièce. <b>Versions</b> garde des états de ta pièce pour y revenir. Dans les paramètres, <b>+ Variante</b> enregistre un jeu de valeurs (M6, M8…) que tu rappelles en un clic. <b>Impression 3D</b> colore les surplombs à soutenir et pose la pièce à plat automatiquement pour l’export STL et 3MF.</p>
    <h3>Outils</h3><p><b>Mesurer</b> : clique deux points. <b>Coupe</b> : regarde l’intérieur. <b>Mise en plan</b> : le plan 2D coté de ta pièce, à imprimer ou en PDF. <b>Importer</b> : ajoute une pièce STEP ou STL. Coche « Centre de gravité » en bas pour l’afficher.</p>
    <h3>Assemblages</h3><p><b>Nouveau → Assemblage</b>, puis <b>Insérer une pièce</b> : tes pièces sont rangées automatiquement dans <b>Mes pièces</b>. La première pièce est fixe. <b>Coïncidence</b> plaque deux faces planes, <b>Concentrique</b> aligne un axe dans un trou, <b>Distance</b> écarte deux faces. Ensuite : <b>Interférences</b> (les pièces se chevauchent-elles ?), <b>Vue éclatée</b>, <b>Nomenclature</b> (liste des pièces avec masses, exportable en tableur) et export STEP de tout l’assemblage.</p>
    <h3>4. L’historique</h3><p>À gauche, chaque étape reste modifiable : clique dessus et change ses valeurs, la pièce se recalcule. Glisse la ligne bleue « Fin de la pièce » vers le haut pour revenir en arrière dans la construction.</p>
    <h3>5. Les paramètres</h3><p>En bas à gauche, donne un nom à une cote (par exemple <b>longueur</b> = 80) et tape <b>longueur</b> ou <b>longueur/2</b> dans n’importe quelle case. Change la valeur : toute la pièce suit.</p>
    <h3>6. Exporter</h3><p><b>STL</b> pour ton trancheur d’impression 3D, <b>STEP</b> pour les autres logiciels de CAO. <b>Enregistrer</b> garde un fichier .gabarit que tu pourras rouvrir et modifier. Ton travail est aussi gardé automatiquement dans le navigateur.</p>
    <h3>Raccourcis</h3><ul><li>Ctrl+Z / Ctrl+Y : annuler / rétablir</li><li>Ctrl+S : enregistrer</li><li>Suppr : supprimer l’élément choisi</li><li>Échap : annuler l’outil en cours</li><li>F : recadrer la vue</li></ul>`) }),
  h("div", { class: "df" }, h("button", { class: "btn primary", onclick: () => dlg.close() }, "Compris")));
  dlg.showModal();
}
function saveFile() {
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" });
  download(blob, `${safeName()}.gabarit`); toast("Pièce enregistrée dans tes téléchargements.");
}
async function openFile(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.features) && d.kind !== "assembly") throw new Error();
    if (d.kind === "assembly") d.features = d.features || [];
    if (!isAsm() || d.kind === "assembly") { loadDoc(d); toast(`« ${d.name || file.name} » ouvert${d.kind === "assembly" ? "" : "e"}.`); }
    else { addToLibrary(d); toast(`« ${d.name || file.name} » ajoutée à ta bibliothèque : clique sur « Insérer une pièce ».`); }
  } catch { toast("Ce fichier n’est pas une pièce Gabarit valide."); }
}

// ---------- Démarrage ----------
const viewer = new Viewer($("#view"));
// Présélection (sans outil) : clic sur une arête ou une face, Maj pour en ajouter.
// Puis une barre d'actions propose la suite (esquisser, congé, chanfrein, coque…).
st.pre = { edges: [], faces: [] };
function refPoint(point) {
  const [lo, hi] = st.mesh.bb;
  const p = point.map((c) => Math.round(c * 1000) / 1000);
  p.push(...[0, 1, 2].map((k) => Math.round(((point[k] - lo[k]) / ((hi[k] - lo[k]) || 1)) * 1e5) / 1e5));
  return p;
}
function clearFaceSel() { st.facePlane = null; st.pre = { edges: [], faces: [] }; viewer.highlightFace(null); $("#faceAct")?.remove(); refreshMarkers(); }
function preAction(fn) { const pre = st.pre, pl = st.facePlane; clearFaceSel(); fn(pre, pl); }
// Menu du clic droit dans la vue 3D : actions selon ce qui est sous la souris.
viewer.onContext = (e) => {
  closeMenu();
  if (st.editSketch || isAsm()) return;
  const items = [];
  const fh = st.mesh && !viewer.pickMode ? viewer.hitFace(e) : null;
  const eh = st.mesh && !viewer.pickMode ? viewer.hitEdge(e) : null;
  const B = (label, fn, cls) => h("button", { class: cls || "", onclick: () => { closeMenu(); fn(); } }, label);
  if (eh) {
    items.push(B("Congé sur cette arête", () => { st.pre = { edges: [refPoint(eh.point)], faces: [] }; toolAction("fillet"); }));
    items.push(B("Chanfrein sur cette arête", () => { st.pre = { edges: [refPoint(eh.point)], faces: [] }; toolAction("chamfer"); }));
    items.push(h("hr"));
  } else if (fh) {
    if (fh.info?.plane) {
      const pl = planeFromFace(fh.info);
      items.push(B("✎ Esquisser sur cette face", () => createSketch(pl), "strong"));
      items.push(B("Percer sur cette face", () => { st.facePlane = pl; toolAction("hole"); }));
      items.push(B("Plan décalé depuis cette face", () => insertFeature({ id: newId("f"), type: "plane", name: nextName("plane"), base: pl, offset: "10", rot: "x", angle: "0" })));
      items.push(B("Normal à (vue de face)", () => viewer.fit(fh.info.n)));
    }
    items.push(B("Coque en ouvrant cette face", () => { st.pre = { edges: [], faces: [{ id: fh.faceId, p: refPoint(fh.point), info: fh.info }] }; toolAction("shell"); }));
    items.push(h("hr"));
  }
  if (lastTool) items.push(B(`Répéter : ${toolLabel(lastTool)} (Entrée)`, () => toolAction(lastTool)));
  items.push(B("Esquisse…", () => toolAction("sketch")));
  items.push(B("Recadrer (F)", () => viewer.fit()));
  items.push(B("Mesurer", () => toolAction("measure")));
  items.push(B("Coupe", () => toolAction("section")));
  const m = h("div", { class: "menu", id: "menu" }, ...items);
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + "px"; m.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + "px";
  setTimeout(() => document.addEventListener("pointerdown", closeMenuOutside, true), 0);
};
function toolLabel(k) { for (const g of TOOLBAR) for (const [kk, l] of g) if (kk === k) return l; return k; }
// Touche S : boîte à outils sous la souris (outils d'esquisse pendant l'esquisse).
let mouseAt = [innerWidth / 2, innerHeight / 2];
document.addEventListener("pointermove", (e) => { mouseAt = [e.clientX, e.clientY]; }, { passive: true });
const S_TOOLS = ["sketch", "extrude", "cut", "revolve", "hole", "fillet", "chamfer", "shell", "mirror", "pattern", "measure", "section"];
function shortcutBox() {
  closeMenu();
  const list = st.editSketch ? SK_TOOLS.map(([k, l]) => [k, l, () => sketcher.setTool(k)]) : S_TOOLS.map((k) => [k, toolLabel(k), () => toolAction(k)]);
  const m = h("div", { class: "menu sbox", id: "menu" }, ...list.map(([k, l, fn]) => h("button", { title: l, onclick: () => { closeMenu(); fn(); } }, h("span", { html: ICONS[k] || "" }), h("small", {}, l))));
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(mouseAt[0] - r.width / 2, innerWidth - r.width - 8)) + "px";
  m.style.top = Math.max(8, Math.min(mouseAt[1] - r.height / 2, innerHeight - r.height - 8)) + "px";
  setTimeout(() => document.addEventListener("pointerdown", closeMenuOutside, true), 0);
}
viewer.onFreeClick = (e) => {
  if (st.editSketch || isAsm() || !st.mesh) { clearFaceSel(); return; }
  const eh = viewer.hitEdge(e); const fh = eh ? null : viewer.hitFace(e);
  const keep = e.shiftKey || e.ctrlKey ? st.pre : { edges: [], faces: [] };
  clearFaceSel(); st.pre = keep;
  const tol = viewer.size / 120;
  const toggle = (list, p) => { const i = list.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < tol); if (i >= 0) list.splice(i, 1); else list.push(p); };
  if (eh) toggle(st.pre.edges, refPoint(eh.point));
  else if (fh) { const p = refPoint(fh.point); const i = st.pre.faces.findIndex((q) => q.id === fh.faceId); if (i >= 0) st.pre.faces.splice(i, 1); else st.pre.faces.push({ id: fh.faceId, p, info: fh.info }); }
  const { edges, faces } = st.pre;
  if (!edges.length && !faces.length) { refreshMarkers(); return; }
  if (faces.length === 1 && !edges.length && faces[0].info?.plane) st.facePlane = planeFromFace(faces[0].info);
  viewer.highlightFace(faces.length ? faces.at(-1).id : null);
  refreshMarkers();
  const btns = [];
  if (st.facePlane) {
    btns.push(h("button", { class: "btn primary", onclick: () => preAction((_, pl) => createSketch(pl)) }, "✎ Esquisser ici"));
    btns.push(h("button", { class: "btn", onclick: () => preAction((_, pl) => insertFeature({ id: newId("f"), type: "plane", name: nextName("plane"), base: pl, offset: "10", rot: "x", angle: "0" })) }, "Plan décalé"));
  }
  const withSel = (type, extra, pick) => preAction((pre) => { const f = { id: newId("f"), type, name: nextName(type), ...extra(pre) }; insertFeature(f); startPick(pick, f.id); });
  if (edges.length) {
    btns.push(h("button", { class: "btn" + (st.facePlane ? "" : " primary"), onclick: () => withSel("fillet", (pre) => ({ r: "2", edges: pre.edges }), "edges") }, "Congé"));
    btns.push(h("button", { class: "btn", onclick: () => withSel("chamfer", (pre) => ({ r: "1", edges: pre.edges }), "edges") }, "Chanfrein"));
  }
  if (faces.length && !edges.length) {
    btns.push(h("button", { class: "btn", onclick: () => withSel("shell", (pre) => ({ t: "2", faces: pre.faces.map((x) => x.p) }), "faces") }, "Coque"));
    btns.push(h("button", { class: "btn", onclick: () => withSel("draft", (pre) => ({ angle: "3", faces: pre.faces.map((x) => x.p), plane: { kind: "std", name: "dessus", offset: "0" } }), "faces") }, "Dépouille"));
  }
  const n = edges.length + faces.length;
  const host = $(".stage").getBoundingClientRect();
  const box = h("div", { id: "faceAct", class: "face-act", style: `left:${Math.max(8, Math.min(e.clientX - host.left + 12, host.width - 420))}px;top:${Math.max(8, e.clientY - host.top - 20)}px` },
    h("span", { class: "fa-n" }, n > 1 ? `${n} choisies` : edges.length ? "Arête" : "Face"),
    ...btns, h("button", { class: "x", title: "Fermer (Échap)", onclick: () => clearFaceSel() }, "✕"));
  $(".stage").append(box);
};
const asmUI = createAssemblyUI({
  h, $, nf, fr, toast, banner, viewer, newId, showBusy, library, addToLibrary, download, safeName, toggleSection,
  getDoc: () => doc, commit: () => pushHistory(),
  post: (m) => { if (workerReady) worker.postMessage(m); },
  request: (m, cb) => { const req = ++exportReq; pendingExport.set(req, cb); worker.postMessage({ ...m, req }); },
  material: (k) => MATERIALS[k] || MATERIALS.pla,
});
const extras = createExtras({
  h, $, fr, nf, toast, viewer, st, markTool,
  getDoc: () => doc, loadDoc: (d) => { welcome(false); loadDoc(d); }, mutate, renderParams, renderProps,
  setPrintDown: (g) => { if (g) doc.printDown = g; else delete doc.printDown; pushHistory(); },
  commands: () => commandList(),
});
const KEYS = {
  sketch: "dessin profil 2d croquis", extrude: "volume epaisseur bossage tirer", cut: "creuser enlever percer poche", revolve: "tourner tour axe rond",
  hole: "trou percer vis fraisage lamage", fillet: "arrondi arrondir rayon conge", chamfer: "biseau casser angle", shell: "evider creux boite paroi",
  thread: "filet filetage vis taraud taraudage m3 m4 m5 m6 m8 m10 m12", helix: "ressort helice spirale", rib: "renfort raidisseur gousset",
  mirror: "miroir symetrique", pattern: "repeter copier grille cercle reseau", loft: "transition relier", sweep: "tuyau chemin glisser",
  draft: "demoulage incliner", import: "step stl ouvrir modele", measure: "distance cote longueur", section: "couper interieur",
  print: "impression imprimante 3d support surplomb orientation trancheur", drawing: "plan 2d pdf imprimer cotation", plane: "plan reference decale incline",
};
function commandList() {
  const L = [];
  for (const g of TOOLBAR) for (const [k, label] of g) L.push({ label, hint: TOOL_TIPS[k], keys: KEYS[k], when: () => !isAsm() && !st.editSketch, run: () => toolAction(k) });
  for (const [k, label] of SK_TOOLS) L.push({ label: `Esquisse : ${label}`, keys: "dessiner " + k, when: () => !!st.editSketch, run: () => sketcher.setTool(k) });
  const act = (a) => document.querySelector(`[data-act=${a}]`)?.click();
  L.push(
    { label: "Nouvelle pièce ou nouvel assemblage", keys: "nouveau creer", run: () => newDialog() },
    { label: "Mes pièces", keys: "bibliotheque liste", run: () => libraryDialog() },
    { label: "Ouvrir un fichier", keys: "charger", run: () => act("open") },
    { label: "Enregistrer le fichier .gabarit", keys: "sauver sauvegarder", run: () => saveFile() },
    { label: "Partager par lien", keys: "envoyer lien url collaborer", run: () => extras.share() },
    { label: "Versions enregistrées", keys: "historique sauvegarde revenir", run: () => extras.versions() },
    { label: "Exporter en STL", keys: "impression trancheur", run: () => doExport("stl") },
    { label: "Exporter en 3MF", keys: "impression trancheur bambu prusa cura", run: () => doExport("3mf") },
    { label: "Exporter en STEP", keys: "cao solidworks fusion", run: () => doExport("step") },
    { label: "Exporter en OBJ", keys: "blender rendu", run: () => doExport("obj") },
    { label: "Exporter une esquisse en DXF", keys: "laser cnc decoupe", run: () => moreFormats() },
    { label: "Ajouter un paramètre", keys: "variable cote nommee", when: () => !isAsm(), run: () => addParam() },
    { label: "Annuler", keys: "ctrl z retour", run: () => undo() },
    { label: "Rétablir", keys: "ctrl y refaire", run: () => redo() },
    { label: "Vue : recadrer", keys: "zoom tout voir", run: () => viewer.fit() },
    { label: "Vue : 3D", keys: "iso perspective", run: () => viewer.fit([1, -1.3, 0.9]) },
    { label: "Vue : face", run: () => viewer.fit([0, -1, 0]) }, { label: "Vue : dessus", run: () => viewer.fit([0, 0, 1]) }, { label: "Vue : droite", run: () => viewer.fit([1, 0, 0]) },
    { label: "Aide", keys: "comment aide tutoriel", run: () => help() },
  );
  return L;
}
function newDialog() {
  const dlg = $("#dlg"); dlg.innerHTML = "";
  const go = (d) => { dlg.close(); loadDoc(d); if (!d.kind) toolAction("sketch"); };
  dlg.append(h("div", { class: "dh" }, "Nouveau"), h("div", { class: "db" },
    h("p", {}, "Ton travail actuel reste dans ta bibliothèque (les pièces) ; pense à l’enregistrer en fichier si tu veux le garder ailleurs."),
    h("div", { class: "planes" },
      h("button", { class: "btn", onclick: () => go(emptyDoc()) }, h("b", {}, "Pièce"), " : dessiner et modeler une pièce"),
      h("button", { class: "btn", onclick: () => go(emptyAsm()) }, h("b", {}, "Assemblage"), " : réunir plusieurs pièces et les positionner"))),
  h("div", { class: "df" }, h("button", { class: "btn", onclick: () => dlg.close() }, "Annuler")));
  dlg.showModal();
}
function moreFormats() {
  const dlg = $("#dlg"); dlg.innerHTML = "";
  const go = (k) => { dlg.close(); doExport(k); };
  const sks = isAsm() ? [] : doc.features.filter((f) => f.type === "sketch" && (f.entities || []).length);
  let skSel = st.editSketch || (feat(st.sel)?.type === "sketch" ? st.sel : sks.at(-1)?.id);
  const dxf = () => {
    const f = feat(skSel); if (!f) return;
    try { download(sketchDXF(f.entities, varsMap(doc.params)), `${safeName()} - ${f.name}.dxf`); dlg.close(); toast("Esquisse enregistrée en DXF (en millimètres)."); } catch (x) { toast("Export DXF impossible : " + x.message); }
  };
  dlg.append(h("div", { class: "dh" }, "Autres formats"), h("div", { class: "db" },
    h("div", { class: "planes" },
      h("button", { class: "btn", onclick: () => go("step") }, h("b", {}, "STEP"), " : pour les autres logiciels de CAO (Fusion, FreeCAD, Onshape…), la forme exacte"),
      h("button", { class: "btn", onclick: () => go("3mf") }, h("b", {}, "3MF"), " : pour l’impression 3D (Bambu Studio, PrusaSlicer, Cura), plus précis que le STL"),
      h("button", { class: "btn", onclick: () => go("obj") }, h("b", {}, "OBJ"), " : pour Blender, les moteurs de jeu et le rendu")),
    sks.length ? h("div", {},
      h("h3", {}, "Esquisse en DXF (découpe laser, CNC, logiciels 2D)"),
      h("div", { class: "field" }, h("label", {}, "Esquisse"), h("select", { onchange: (e) => { skSel = e.target.value; } }, sks.map((f) => h("option", { value: f.id, selected: f.id === skSel }, f.name)))),
      h("div", { class: "btnrow" }, h("button", { class: "btn", onclick: dxf }, "Enregistrer le DXF"))) : null),
  h("div", { class: "df" }, h("button", { class: "btn", onclick: () => dlg.close() }, "Fermer")));
  dlg.showModal();
}
function libraryDialog() {
  const dlg = $("#dlg"); dlg.innerHTML = "";
  const draw = () => {
    const lib = library(); const names = Object.keys(lib).sort((a, b) => a.localeCompare(b, "fr"));
    dlg.innerHTML = "";
    dlg.append(h("div", { class: "dh" }, "Mes pièces"), h("div", { class: "db" },
      names.length ? h("table", { class: "bom" }, names.map((n) => h("tr", {}, h("td", {}, h("b", {}, n)), h("td", {}, `${lib[n].features.length} étape(s)`),
        h("td", {}, h("button", { class: "btn", onclick: () => { dlg.close(); loadDoc(lib[n]); } }, "Ouvrir")),
        h("td", {}, h("button", { class: "btn danger", onclick: () => { if (deletePart(n)) draw(); } }, "Supprimer")))))
        : h("p", {}, "Ta bibliothèque est vide. Chaque pièce que tu crées y est rangée automatiquement.")),
    h("div", { class: "df" }, h("button", { class: "btn primary", onclick: () => dlg.close() }, "Fermer")));
    typoTree(dlg);
  };
  draw(); dlg.showModal();
}
sketcher = new Sketcher($("#skSvg"), {
  getSketch: () => feat(st.editSketch) || { entities: [] },
  getDoc: () => doc,
  update: (fn, transient) => mutate(() => { const f = feat(st.editSketch); if (f) { fn(f); solveAndWrite(f); } }, transient),
  drag: (ref, at) => mutate(() => {
    const f = feat(st.editSketch); if (!f) return;
    const ent = f.entities.find((x) => x.id === ref.e); if (!ent) return;
    const q = ent.pts[ref.k]; const old = [...q];
    ent.pts[ref.k] = q[2] !== undefined && q[2] !== "" ? [at[0], at[1], q[2]] : [at[0], at[1]];
    if (f.constraints?.length && !solveAndWrite(f, [{ ref, at }])) ent.pts[ref.k] = old;
  }, true),
  select: (id) => { st.skSel = id; renderProps(); },
  onTool: () => renderSketchTools(),
  onView: () => syncSketchView(),
});
renderTools();
$("#views").append(
  h("div", { class: "row" }, h("button", { title: "Tout voir (F)", onclick: () => viewer.fit() }, "Recadrer"), h("button", { title: "Vue isométrique (Ctrl 7)", onclick: () => viewer.fit([1, -1.3, 0.9]) }, "3D")),
);
viewer.mountCube($("#views"), (dir) => viewer.fit(dir));
document.querySelector(".file").addEventListener("click", (e) => {
  const a = e.target.closest("button")?.dataset.act; if (!a) return;
  if (a === "new") newDialog();
  if (a === "open") $("#fileIn").click();
  if (a === "save") saveFile();
  if (a === "undo") undo();
  if (a === "redo") redo();
  if (a === "stl") doExport("stl");
  if (a === "step") doExport("step");
  if (a === "help") help();
  if (a === "lib") libraryDialog();
  if (a === "more") moreFormats();
  if (a === "share") extras.share();
  if (a === "versions") extras.versions();
  if (a === "search") extras.palette();
  if (a === "install") installApp();
});
$(".params-box").addEventListener("click", (e) => { if (e.target.closest("[data-act=addParam]")) addParam(); });
$("#docName").addEventListener("change", (e) => { if (isAsm()) { doc.name = e.target.value.trim() || "Assemblage sans nom"; pushHistory(); return; } mutate(() => { doc.name = e.target.value.trim() || "Pièce sans nom"; }); });
$("#fileIn").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ""; });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); extras.palette(); return; }
  if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { if (!typing) { e.preventDefault(); undo(); } return; }
  if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { if (!typing) { e.preventDefault(); redo(); } return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveFile(); return; }
  if (mod && /^[1-8]$/.test(e.key) && !typing && !st.editSketch) {
    e.preventDefault();
    const V = { 1: [0, -1, 0], 2: [0, 1, 0], 3: [-1, 0, 0], 4: [1, 0, 0], 5: [0, 0, 1], 6: [0, 0, -1], 7: [1, -1.3, 0.9] };
    if (e.key === "8") { if (st.facePlane) viewer.fit(st.facePlane.n); else toast("Choisis d’abord une face plane (clic), puis Ctrl 8."); }
    else viewer.fit(V[e.key]);
    return;
  }
  if (typing) return;
  if (e.key === "Escape" && $("#menu")) { closeMenu(); return; }
  if (e.key === "Escape") {
    if (st.editSketch) { if (!sketcher.cancel()) { st.skSel = null; sketcher.sel = null; sketcher.subs = []; renderProps(); sketcher.render(); } return; }
    if (st.pick) { cancelFeature(); return; }
    if (viewer.pickMode) { viewer.setPick(null); banner(null); return; }
    if (st.pre?.edges.length || st.pre?.faces.length) { clearFaceSel(); return; }
    if (st.sel && feat(st.sel) && !isAsm()) { cancelFeature(); return; }
    select(null); return;
  }
  if (e.key === "Enter" && st.editSketch && ["poly", "path", "spline"].includes(sketcher.draft?.type)) { sketcher.finishPoly(); return; }
  if (e.key === "Enter" && st.editSketch && !sketcher.draft) { closeSketch(); return; }
  if (e.key === "Enter" && !isAsm() && (st.pick || (st.sel && feat(st.sel) && feat(st.sel).type !== "sketch"))) { e.preventDefault(); validateFeature(); return; }
  if (e.key === "Enter" && !isAsm() && !st.editSketch && !st.sel && lastTool) { e.preventDefault(); toolAction(lastTool); return; }
  if (e.key.toLowerCase() === "s" && !mod && !e.altKey) { e.preventDefault(); shortcutBox(); return; }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (st.editSketch) { sketcher.deleteSel(); return; }
    if (isAsm()) { asmUI.deleteSelected(); return; }
    if (st.sel) deleteFeature(st.sel);
    return;
  }
  if (e.key.toLowerCase() === "f" && !st.editSketch) viewer.fit();
});

// Installation (PWA)
let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); installEvt = e;
  if (!$("[data-act=install]")) $(".file").prepend(h("button", { "data-act": "install", class: "accent", title: "Installer Gabarit comme une application" }, "Installer"));
});
async function installApp() { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("[data-act=install]")?.remove(); }
if ("serviceWorker" in navigator && location.protocol === "https:" && !window.GABARIT_WASM_GZ) {
  const hadCtrl = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").then((r) => r.update()).catch(() => {});
  // nouvelle version téléchargée : proposer de recharger (ton travail est enregistré automatiquement)
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadCtrl || $("#updBar")) return;
    document.body.append(h("div", { id: "updBar", class: "upd-bar" }, "Nouvelle version de Gabarit prête.",
      h("button", { class: "btn primary", onclick: () => { save(); location.reload(); } }, "Mettre à jour"),
      h("button", { class: "btn", onclick: () => $("#updBar").remove() }, "Plus tard")));
  });
}

// Reprise du travail précédent
let saved = null; try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch { saved = null; }
const hasSaved = saved && (saved.kind === "assembly" || (Array.isArray(saved.features) && (saved.features.length || saved.params?.length)));
if (hasSaved) loadDoc(saved); else loadDoc(emptyDoc());
if (!location.hash.startsWith("#p=")) welcome(true);
typoTree(document.body);
startWorker();
extras.openFromHash();
window.addEventListener("hashchange", () => extras.openFromHash());
window.gabarit = { get doc() { return doc; }, st, viewer, sketcher, loadDoc, exampleDoc, emptyAsm, library, addToLibrary, asmUI };
if ("launchQueue" in window) window.launchQueue.setConsumer(async (p) => { for (const fh of p.files || []) openFile(await fh.getFile()); });
