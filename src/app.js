// Gabarit : application principale (interface, historique, échanges avec le noyau 3D).
import { Viewer } from "./viewer.js";
import { Sketcher, newId } from "./sketcher.js";
import { ICONS } from "./icons.js";
import { evalExpr, varsMap } from "./expr.js";
import { resolvePlane, evalEntity, outline, toWorld, STD_PLANES, cross, dot, norm, scale } from "./geo.js";
import { exampleDoc } from "./example.js";

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
};
const MATERIALS = { pla: ["PLA", 1.24], petg: ["PETG", 1.27], abs: ["ABS", 1.04], resine: ["Résine", 1.15], alu: ["Aluminium", 2.7], acier: ["Acier", 7.85], inox: ["Inox", 8.0], laiton: ["Laiton", 8.5], bois: ["Bois (chêne)", 0.75] };
const STORE = "gabarit-doc-v1";

let doc = emptyDoc();
const st = {
  sel: null, editSketch: null, skSel: null, pick: null, afterSketch: null, stopAt: null,
  errors: {}, info: {}, mesh: null, building: false, lastMs: 0, firstFit: true,
};
function emptyDoc() { return { version: 1, name: "Pièce sans nom", material: "pla", params: [], features: [] }; }
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
function save() { try { localStorage.setItem(STORE, JSON.stringify(doc)); } catch { /* stockage indisponible */ } }
function undo() { if (hidx > 0) { hidx--; restore(); } }
function redo() { if (hidx < hist.length - 1) { hidx++; restore(); } }
function restore() {
  doc = JSON.parse(hist[hidx]);
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
  doc = Object.assign(emptyDoc(), d);
  st.sel = null; st.stopAt = null; st.errors = {}; closeSketch(true); stopPick();
  hist = []; hidx = -1; pushHistory();
  st.firstFit = fit; renderAll(); requestBuild();
}

// ---------- Noyau 3D (Worker) ----------
let worker, workerReady = false, buildReq = 0, buildTimer = null, pendingExport = new Map();
function startWorker() {
  const src = window.GABARIT_WORKER_SRC;
  worker = src ? new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" }))) : new Worker("worker.js");
  worker.onmessage = (ev) => onWorker(ev.data);
  worker.onerror = (e) => { showBusy(false); toast("Le noyau 3D n’a pas pu démarrer : " + (e.message || "erreur inconnue")); };
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
  })();
}
let wasmCache = null, restarts = [];
function restartWorker() {
  restarts = restarts.filter((t) => Date.now() - t < 30000); restarts.push(Date.now());
  if (restarts.length > 3) { showBusy(false); toast("Le moteur 3D bloque sur cette pièce. Annule la dernière modification (Ctrl+Z)."); return; } try { worker.terminate(); } catch { /* déjà arrêté */ } workerReady = false; st.building = false; startWorker(); }
function onWorker(m) {
  if (m.type === "ready") { workerReady = true; showBusy(false); requestBuild(0); return; }
  if (m.type === "built") {
    if (m.req !== buildReq) return;
    st.building = false; showBusy(false);
    if (m.heap > 1.4e9) setTimeout(restartWorker, 50); // libère la mémoire du noyau
    st.errors = m.errors; st.info = m.info; st.mesh = m.mesh; st.lastMs = m.ms;
    viewer.setMesh(m.mesh);
    if (st.firstFit && m.mesh) { viewer.fit([1, -1.3, 0.9]); st.firstFit = false; }
    if (st.editSketch) updateSketchRefs();
    renderTree(); renderStatus(); renderOverlay(); refreshMarkers();
    if (!st.editSketch) renderProps();
    return;
  }
  if (m.type === "exported") { const cb = pendingExport.get(m.req); pendingExport.delete(m.req); cb?.(m.blob); return; }
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
    buildReq++; st.building = true;
    setTimeout(() => { if (st.building) showBusy(true); }, 250);
    worker.postMessage({ type: "build", req: buildReq, doc, stopAt: currentStopAt() });
  }, delay);
}
let exportReq = 1e6;
function doExport(kind) {
  if (!st.mesh) { toast("Rien à exporter pour l’instant : la pièce est vide."); return; }
  if (st.stopAt !== null || st.pick || st.editSketch) { toast("Termine l’édition en cours, puis remets la fin de la pièce tout en bas."); return; }
  const req = ++exportReq;
  showBusy(true, "Export en cours…");
  pendingExport.set(req, (blob) => { showBusy(false); download(blob, `${safeName()}.${kind === "step" ? "step" : "stl"}`); toast(kind === "step" ? "Fichier STEP enregistré." : "Fichier STL enregistré, prêt pour ton trancheur."); });
  worker.postMessage({ type: "export", req, kind, opts: { fine: true } });
}
const safeName = () => (doc.name || "piece").replace(/[\\/:*?"<>|]+/g, "-").trim() || "piece";
function download(blob, name) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// ---------- Interface : outils ----------
const TOOLBAR = [
  [["sketch", "Esquisse"]],
  [["extrude", "Extrusion"], ["cut", "Enlèvement"], ["revolve", "Révolution"]],
  [["hole", "Perçage"], ["fillet", "Congé"], ["chamfer", "Chanfrein"], ["shell", "Coque"]],
  [["mirror", "Symétrie"], ["pattern", "Répétition"]],
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
  pattern: "Répéter la pièce en ligne ou en cercle",
};
function toolAction(k) {
  if (st.editSketch) { toast("Termine d’abord l’esquisse en cours."); return; }
  stopPick();
  if (k === "sketch") { choosePlane((plane) => createSketch(plane)); return; }
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
    else { toast("Dessine d’abord le profil, puis clique sur « Terminer »."); choosePlane((plane) => createSketch(plane, make)); }
    return;
  }
  if (!st.mesh) { toast("Crée d’abord un volume (esquisse puis extrusion)."); return; }
  if (k === "hole") {
    choosePlane((plane) => {
      const f = { id: newId("f"), type: "hole", name: nextName("hole"), plane, kind: "simple", d: "5", d2: "9", depth2: "3", angle: "90", depth: "10", through: true, points: [] };
      insertFeature(f); startPick("points", f.id);
    }, "Sur quelle face veux-tu percer ?");
    return;
  }
  if (k === "fillet" || k === "chamfer") {
    const f = { id: newId("f"), type: k, name: nextName(k), r: k === "fillet" ? "2" : "1", edges: [] };
    insertFeature(f); startPick("edges", f.id); return;
  }
  if (k === "shell") { const f = { id: newId("f"), type: "shell", name: nextName("shell"), t: "2", faces: [] }; insertFeature(f); startPick("faces", f.id); return; }
  if (k === "mirror") { insertFeature({ id: newId("f"), type: "mirror", name: nextName("mirror"), plane: { kind: "std", name: "droite", offset: "0" } }); return; }
  if (k === "pattern") { insertFeature({ id: newId("f"), type: "pattern", name: nextName("pattern"), kind: "lin", axis: "x", count: "3", step: "20", angle: "360" }); return; }
}
function nextNameRaw(base) { let n = 1; const names = new Set(doc.features.map((f) => f.name)); while (names.has(`${base} ${n}`)) n++; return `${base} ${n}`; }
function insertFeature(f) {
  mutate((d) => {
    if (st.stopAt !== null) { d.features.splice(st.stopAt, 0, f); st.stopAt++; }
    else d.features.push(f);
  });
  select(f.id);
}
function candidateSketch() {
  const s = feat(st.sel); if (s?.type === "sketch") return s;
  const used = new Set(doc.features.filter((f) => f.sketch).map((f) => f.sketch));
  const lim = st.stopAt ?? doc.features.length;
  for (let i = lim - 1; i >= 0; i--) { const f = doc.features[i]; if (f.type === "sketch" && !used.has(f.id) && !f.suppressed) return f; }
  return null;
}
function createSketch(plane, after) {
  const f = { id: newId("f"), type: "sketch", name: nextName("sketch"), plane, entities: [] };
  insertFeature(f); st.afterSketch = after || null; openSketch(f.id, true);
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
    faces: "Clique sur la ou les faces à ouvrir (elles seront retirées).",
    points: "Clique sur la face pour placer les trous. Tu peux corriger les cotes à droite.",
  };
  banner(texts[kind], [["Terminé", () => stopPick(true)]]);
  viewer.setPick({ kind: kind === "edges" ? "edge" : "face", onPick: (hit) => onPick(hit) });
  requestBuild(0); renderProps(); refreshMarkers();
}
function stopPick(rebuild) {
  if (!st.pick) return;
  st.pick = null; viewer.setPick(null); banner(null); refreshMarkers();
  if (rebuild !== false) { requestBuild(0); renderProps(); }
}
function onPick(hit) {
  const f = feat(st.pick.featId); if (!f) return;
  const tol = viewer.size / 120;
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
  if (!f) { viewer.setMarkers([]); return; }
  if (f.type === "fillet" || f.type === "chamfer") viewer.setMarkers(f.edges || []);
  else if (f.type === "shell") viewer.setMarkers(f.faces || []);
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
    err ? h("span", { class: "err" }) : (inf && inf.found < inf.asked ? h("span", { class: "warn", title: "Certaines arêtes choisies ont disparu" }) : null),
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
function planeFields(f, allowFace = true) {
  const p = f.plane || (f.plane = { kind: "std", name: "dessus", offset: "0" });
  const opts = Object.entries(STD_PLANES).map(([k, v]) => [k, v.label]);
  if (p.kind === "face") opts.push(["__face", p.label || "Face choisie"]);
  if (allowFace && st.mesh) opts.push(["__pick", "Choisir une face sur la pièce…"]);
  return [
    selectField("Plan", p.kind === "face" ? "__face" : p.name, opts, (val) => {
      if (val === "__pick") { pickFacePlane((np) => { mutate(() => { f.plane = np; }); renderProps(); refreshMarkers(); }); renderProps(); return; }
      if (val === "__face") return;
      mutate(() => { f.plane = { kind: "std", name: val, offset: p.offset || "0" }; }); renderProps(); refreshMarkers();
      if (st.editSketch) updateSketchRefs();
    }),
    exprField("Décalage du plan", p, "offset", "mm", { after: () => { refreshMarkers(); if (st.editSketch) updateSketchRefs(); } }),
  ];
}
function sketchOptions(f) {
  const i = featIndex(f.id);
  return doc.features.slice(0, i).filter((x) => x.type === "sketch").map((x) => [x.id, x.name]);
}
function renderProps() {
  const P = $("#props"); P.innerHTML = "";
  if (st.editSketch) { renderSketchProps(P); return; }
  const f = feat(st.sel);
  if (!f) {
    P.append(h("h2", {}, "Réglages"), h("div", { class: "note" }, "Clique sur une étape de l’historique pour la modifier. Toutes les cotes acceptent des calculs et des paramètres, par exemple ", h("b", {}, "longueur/2 + 3"), "."));
    return;
  }
  const head = h("div", { class: "head" }, h("span", { class: "ic", html: ICONS[TYPES[f.type].icon] }),
    h("input", { value: f.name, "aria-label": "Nom de l’étape", onchange: (e) => { mutate(() => { f.name = e.target.value.trim() || f.name; }); } }));
  P.append(head);
  if (st.errors[f.id]) P.append(h("div", { class: "note err" }, st.errors[f.id]));
  const add = (...els) => P.append(...els.flat().filter(Boolean));
  const vars = varsMap(doc.params);

  if (f.type === "sketch") {
    add(planeFields(f));
    add(h("div", { class: "note" }, `${(f.entities || []).length} forme(s) dans cette esquisse.`));
    add(h("div", { class: "btnrow" }, h("button", { class: "btn primary", onclick: () => openSketch(f.id) }, "Modifier l’esquisse"),
      h("button", { class: "btn", onclick: () => { select(f.id); toolAction("extrude"); } }, "Extruder"),
      h("button", { class: "btn", onclick: () => { select(f.id); toolAction("cut"); } }, "Enlever")));
  }
  if (f.type === "extrude") {
    add(selectField("Esquisse utilisée", f.sketch, [["", "—"], ...sketchOptions(f)], (v) => mutate(() => { f.sketch = v; })));
    add(segField("Effet", f, "mode", [["add", "Ajouter de la matière"], ["cut", "Enlever de la matière"]]));
    add(segField("Sens", f, "dir", [["normal", "Normal"], ["inverse", "Inversé"], ["sym", "Des deux côtés"]]));
    if (f.mode === "cut") add(checkField("À travers toute la pièce", f, "through"));
    if (!(f.mode === "cut" && f.through)) add(exprField(f.dir === "sym" ? "Épaisseur totale" : "Distance", f, "dist"));
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
      st.pick?.featId === f.id ? h("button", { class: "btn primary", onclick: () => stopPick(true) }, "Terminer le placement") : h("button", { class: "btn primary", onclick: () => startPick("points", f.id) }, "Placer en cliquant"),
      h("button", { class: "btn", onclick: () => { mutate(() => { (f.points = f.points || []).push(["0", "0"]); }); renderProps(); refreshMarkers(); } }, "+ Ajouter une position")));
    add(h("div", { class: "note" }, "Positions en millimètres dans le plan du perçage (X vers la droite, Y vers le haut)."));
  }
  if (f.type === "fillet" || f.type === "chamfer") {
    add(exprField(f.type === "fillet" ? "Rayon" : "Distance", f, "r", "mm", { step: 0.5 }));
    const n = (f.edges || []).length; const inf = st.info[f.id];
    add(h("div", { class: "note" + (inf && inf.found < inf.asked ? " err" : "") }, `${n} arête(s) choisie(s)` + (inf && inf.found < inf.asked ? ` : ${inf.asked - inf.found} introuvable(s), reclique-les.` : ".")));
    add(h("div", { class: "btnrow" },
      st.pick?.featId === f.id ? h("button", { class: "btn primary", onclick: () => stopPick(true) }, "Terminer la sélection") : h("button", { class: "btn primary", onclick: () => startPick("edges", f.id) }, "Choisir les arêtes"),
      n ? h("button", { class: "btn", onclick: () => { mutate(() => { f.edges = []; }); renderProps(); refreshMarkers(); } }, "Tout effacer") : null));
  }
  if (f.type === "shell") {
    add(exprField("Épaisseur de paroi", f, "t", "mm", { step: 0.5 }));
    add(h("div", { class: "note" }, `${(f.faces || []).length} face(s) ouverte(s).`));
    add(h("div", { class: "btnrow" }, st.pick?.featId === f.id ? h("button", { class: "btn primary", onclick: () => stopPick(true) }, "Terminer la sélection") : h("button", { class: "btn primary", onclick: () => startPick("faces", f.id) }, "Choisir les faces")));
  }
  if (f.type === "mirror") { add(planeFields(f, false)); add(h("div", { class: "note" }, "Toute la pièce est copiée en miroir et réunie à l’originale.")); }
  if (f.type === "pattern") {
    add(segField("Type", f, "kind", [["lin", "En ligne"], ["circ", "En cercle"]]));
    add(segField(f.kind === "circ" ? "Autour de l’axe" : "Le long de l’axe", f, "axis", [["x", "X"], ["y", "Y"], ["z", "Z"]]));
    add(exprField("Nombre total d’exemplaires", f, "count", ""));
    if (f.kind === "circ") add(exprField("Angle total", f, "angle", "°", { step: 15 }));
    else add(exprField("Écart entre deux exemplaires", f, "step"));
    add(h("div", { class: "note" }, "Toute la pièce construite jusqu’ici est répétée."));
  }
  add(h("div", { class: "btnrow", style: "margin-top:10px" },
    h("button", { class: "btn", onclick: () => mutate(() => { f.suppressed = !f.suppressed; }) || renderProps() }, f.suppressed ? "Réactiver" : "Désactiver"),
    h("button", { class: "btn danger", onclick: () => deleteFeature(f.id) }, "Supprimer")));
  void vars;
}

// ---------- Mode esquisse ----------
const SK_TOOLS = [["select", "Choisir"], ["rect", "Rectangle"], ["circle", "Cercle"], ["slot", "Rainure"], ["polygon", "Polygone"], ["poly", "Contour libre"]];
const SK_HINTS = {
  select: "Clique sur une forme pour la choisir, puis glisse-la ou modifie ses cotes à droite. Molette : zoom. Clic droit ou glisser dans le vide : déplacer la vue.",
  rect: "Glisse d’un coin à l’autre (ou clique deux fois). Maj : sans accroche.",
  circle: "Clique au centre, puis au bord.",
  slot: "Clique au premier centre, puis au second. Règle la largeur à droite.",
  polygon: "Clique au centre, puis sur un sommet.",
  poly: "Clique chaque point. Pour fermer : reclique sur le premier point, double-clique, ou Entrée.",
};
let sketcher;
function openSketch(id, isNew = false) {
  stopPick(false);
  st.editSketch = id; st.sel = id; st.skSel = null; st.skNew = isNew;
  $("#sketch").hidden = false; $("#views").hidden = true; banner(null);
  document.querySelectorAll(".tbtn[data-tool]").forEach((b) => (b.disabled = true));
  sketcher.sel = null; sketcher.setTool(isNew ? "rect" : "select");
  updateSketchRefs();
  requestAnimationFrame(() => sketcher.fitView());
  renderTree(); renderProps(); requestBuild(0);
}
function closeSketch(silent) {
  if (!st.editSketch) return;
  const id = st.editSketch; st.editSketch = null;
  $("#sketch").hidden = true; $("#views").hidden = false;
  document.querySelectorAll(".tbtn[data-tool]").forEach((b) => (b.disabled = false));
  if (silent) return;
  const f = feat(id);
  if (f && !(f.entities || []).length && st.skNew) { mutate((d) => d.features.splice(featIndex(id), 1)); st.sel = null; st.afterSketch = null; }
  else if (f && st.afterSketch) { const cb = st.afterSketch; st.afterSketch = null; cb(id); }
  else st.sel = id;
  renderAll(); requestBuild(0);
}
function updateSketchRefs() {
  const f = feat(st.editSketch); if (!f || !sketcher) return;
  let pl; try { pl = resolvePlane(f.plane, varsMap(doc.params)); } catch { return; }
  const lines = [], pts = [];
  const m = st.mesh;
  if (m) {
    const L = m.lines; const tol = Math.max(0.01, viewer.size / 2000);
    const proj = (i) => { const d = [L[i] - pl.origin[0], L[i + 1] - pl.origin[1], L[i + 2] - pl.origin[2]]; return [dot(d, pl.x), dot(d, pl.y), dot(d, pl.n)]; };
    for (let i = 0; i + 5 < L.length; i += 6) {
      const a = proj(i), b = proj(i + 3);
      lines.push([[a[0], a[1]], [b[0], b[1]]]);
    }
    for (const g of m.edgeGroups) {
      const s = g.start * 3, e = (g.start + g.count - 1) * 3;
      for (const i of [s, e]) { const p = proj(i); if (Math.abs(p[2]) < tol) pts.push([round(p[0], 0.001), round(p[1], 0.001)]); }
    }
  }
  sketcher.refs = { lines, pts };
  sketcher.render();
}
function renderSketchTools() {
  const box = $("#skTools"); box.innerHTML = "";
  for (const [k, label] of SK_TOOLS) box.append(h("button", { class: "tbtn" + (sketcher.tool === k ? " on" : ""), onclick: () => sketcher.setTool(k) }, h("span", { html: ICONS[k] }), label));
  box.append(h("hr"), h("label", {}, "Pas de grille"),
    h("select", { onchange: (e) => { sketcher.snapStep = Number(e.target.value); sketcher.render(); } }, [0.1, 0.5, 1, 2, 5, 10].map((v) => h("option", { value: v, selected: v === sketcher.snapStep }, nf(v) + " mm"))),
    h("hr"), h("button", { class: "tbtn", onclick: () => sketcher.fitView() }, h("span", { html: ICONS.fit }), "Recadrer"),
    h("button", { class: "tbtn on", onclick: () => closeSketch() }, h("span", { html: ICONS.done }), "Terminer"));
  $("#skHint").textContent = fr(SK_HINTS[sketcher.tool] || "");
}
const ENT_LABELS = { rect: "Rectangle", circle: "Cercle", polygon: "Polygone", slot: "Rainure", poly: "Contour libre", point: "Point" };
function renderSketchProps(P) {
  const f = feat(st.editSketch); if (!f) return;
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
    if (e.type === "poly") {
      P.append(F("Congé des angles", "r"));
      P.append(h("h2", {}, "Points"));
      const box = h("div", { class: "pts" });
      e.pts.forEach((p, i) => {
        const mk = (j) => h("input", { value: p[j], "aria-label": j ? "Y" : "X", oninput: (ev) => mutate(() => { p[j] = ev.target.value; }, true), onchange: () => pushHistory() });
        box.append(h("div", { class: "pt" }, String(i + 1), mk(0), mk(1), h("button", { class: "x", title: "Retirer ce point", onclick: () => { if (e.pts.length <= 3) { toast("Il faut au moins 3 points."); return; } mutate(() => e.pts.splice(i, 1)); renderProps(); } }, "✕")));
      });
      P.append(box);
    }
    const cons = h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!e.construction, onchange: (ev) => { mutate(() => { e.construction = ev.target.checked; }); renderProps(); } }), "Trait de construction (ignoré pour le volume)");
    P.append(cons, h("div", { class: "btnrow" },
      h("button", { class: "btn", onclick: () => { const c = JSON.parse(JSON.stringify(e)); c.id = newId("e"); const off = (k) => { const n = Number(String(c[k]).replace(",", ".")); if (isFinite(n)) c[k] = String(n + 5); }; ["cx", "x1", "x2"].forEach(off); ["cy", "y1", "y2"].forEach(off); if (c.pts) c.pts = c.pts.map((q) => q.map((v) => { const n = Number(v); return isFinite(n) ? String(n + 5) : v; })); mutate(() => f.entities.push(c)); st.skSel = c.id; sketcher.sel = c.id; renderProps(); sketcher.render(); } }, "Dupliquer"),
      h("button", { class: "btn danger", onclick: () => sketcher.deleteSel() }, "Supprimer")));
  }
  P.append(h("h2", {}, `Formes (${ents.length})`));
  const list = h("div", { class: "ents" });
  ents.forEach((x) => list.append(h("div", { class: "feat" + (x.id === st.skSel ? " sel" : ""), onclick: () => { st.skSel = x.id; sketcher.sel = x.id; sketcher.setTool("select"); renderProps(); sketcher.render(); } }, h("span", { class: "ic", html: ICONS[x.type] }), h("span", { class: "nm" }, ENT_LABELS[x.type] + (x.construction ? " (construction)" : "")))));
  if (!ents.length) list.append(h("div", { class: "param-empty" }, "Choisis un outil à gauche et dessine. Les formes placées à l’intérieur d’une autre deviennent des trous."));
  P.append(list);
  P.append(h("div", { class: "btnrow" }, h("button", { class: "btn primary", onclick: () => closeSketch() }, "Terminer l’esquisse")));
}

// ---------- Esquisses en 3D ----------
function renderOverlay() {
  const vars = varsMap(doc.params);
  const used = new Set(doc.features.filter((f) => f.sketch).map((f) => f.sketch));
  const list = [];
  for (const f of doc.features) {
    if (f.type !== "sketch" || f.suppressed) continue;
    const active = f.id === st.sel;
    if (!active && used.has(f.id)) continue;
    try {
      const pl = resolvePlane(f.plane, vars);
      const loops = (f.entities || []).map((e) => outline(evalEntity(e, vars)).map((p) => toWorld(pl, p[0], p[1])));
      list.push({ loops, active });
    } catch { /* esquisse invalide */ }
  }
  viewer.setOverlay(list);
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
    );
  } else s.append(h("span", {}, "Aucun volume pour l’instant."));
  s.append(h("span", { class: "grow" }));
  if (errCount) s.append(h("span", { style: "color:var(--err)" }, `${errCount} étape(s) en erreur`));
  if (st.stopAt !== null) s.append(h("span", { style: "color:var(--blue)" }, "Historique remonté"));
  if (st.lastMs) s.append(h("span", {}, `Calcul ${nf(st.lastMs / 1000, 2)} s`));
}

// ---------- Divers ----------
let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = fr(msg); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3800); }
function showBusy(on, text = "Calcul…") { const b = $("#busy"); b.hidden = !on; if (on) b.lastChild.textContent = fr(text); }
function renderAll() { $("#docName").value = doc.name; renderTree(); renderParams(); renderProps(); renderStatus(); renderOverlay(); refreshMarkers(); }

function welcome(show) {
  const w = $("#welcome"); if (!show) { w.hidden = true; return; }
  w.innerHTML = "";
  w.append(h("div", { class: "card" },
    h("h1", {}, "Bienvenue dans Gabarit"),
    h("p", {}, "Ton atelier de conception 3D, gratuit et sans compte. Tu dessines un profil, tu lui donnes du volume, puis tu perces, arrondis et exportes pour l’impression 3D. Chaque étape reste modifiable."),
    h("div", { class: "btnrow" },
      h("button", { class: "btn primary", onclick: () => { welcome(false); loadDoc(emptyDoc()); toolAction("sketch"); } }, "Commencer une pièce"),
      h("button", { class: "btn", onclick: () => { welcome(false); loadDoc(exampleDoc()); } }, "Voir l’exemple"),
      h("button", { class: "btn", onclick: () => { welcome(false); $("#fileIn").click(); } }, "Ouvrir un fichier"))));
  w.hidden = false;
}
function help() {
  const dlg = $("#dlg"); dlg.innerHTML = "";
  dlg.append(h("div", { class: "dh" }, "Comment ça marche"), h("div", { class: "db", html: fr(`
    <h3>1. L’esquisse</h3><p>Clique sur <b>Esquisse</b>, choisis un plan (ou une face de la pièce), puis dessine des rectangles, cercles, rainures, polygones ou un contour libre. Tape les cotes exactes à droite. Une forme placée dans une autre devient un trou.</p>
    <h3>2. Le volume</h3><p><b>Extrusion</b> donne de l’épaisseur, <b>Enlèvement</b> creuse, <b>Révolution</b> fait tourner le profil autour d’un axe (pour les pièces rondes).</p>
    <h3>3. Les finitions</h3><p><b>Perçage</b> : clique sur la face, puis place les trous. <b>Congé</b> et <b>Chanfrein</b> : clique sur les arêtes. <b>Coque</b> : clique sur la face à ouvrir.</p>
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
    if (!Array.isArray(d.features)) throw new Error();
    loadDoc(d); toast(`« ${d.name || file.name} » ouverte.`);
  } catch { toast("Ce fichier n’est pas une pièce Gabarit valide."); }
}

// ---------- Démarrage ----------
const viewer = new Viewer($("#view"));
sketcher = new Sketcher($("#skSvg"), {
  getSketch: () => feat(st.editSketch) || { entities: [] },
  getDoc: () => doc,
  update: (fn, transient) => mutate(() => { const f = feat(st.editSketch); if (f) fn(f); }, transient),
  select: (id) => { st.skSel = id; renderProps(); },
  onTool: () => renderSketchTools(),
});
renderTools();
$("#views").append(
  h("button", { onclick: () => viewer.fit() }, "Recadrer"),
  h("button", { onclick: () => viewer.fit([1, -1.3, 0.9]) }, "3D"),
  h("div", { class: "row" }, h("button", { onclick: () => viewer.fit([0, -1, 0]) }, "Face"), h("button", { onclick: () => viewer.fit([0, 1, 0]) }, "Arrière")),
  h("div", { class: "row" }, h("button", { onclick: () => viewer.fit([0, 0, 1]) }, "Dessus"), h("button", { onclick: () => viewer.fit([0, 0, -1]) }, "Dessous")),
  h("div", { class: "row" }, h("button", { onclick: () => viewer.fit([1, 0, 0]) }, "Droite"), h("button", { onclick: () => viewer.fit([-1, 0, 0]) }, "Gauche")),
);
document.querySelector(".file").addEventListener("click", (e) => {
  const a = e.target.closest("button")?.dataset.act; if (!a) return;
  if (a === "new") { if (!doc.features.length || confirm(fr("Commencer une nouvelle pièce ? Pense à enregistrer celle-ci si tu veux la garder."))) { loadDoc(emptyDoc()); } }
  if (a === "open") $("#fileIn").click();
  if (a === "save") saveFile();
  if (a === "undo") undo();
  if (a === "redo") redo();
  if (a === "stl") doExport("stl");
  if (a === "step") doExport("step");
  if (a === "help") help();
  if (a === "install") installApp();
});
$(".params-box").addEventListener("click", (e) => { if (e.target.closest("[data-act=addParam]")) addParam(); });
$("#docName").addEventListener("change", (e) => mutate(() => { doc.name = e.target.value.trim() || "Pièce sans nom"; }));
$("#fileIn").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ""; });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { if (!typing) { e.preventDefault(); undo(); } return; }
  if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { if (!typing) { e.preventDefault(); redo(); } return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveFile(); return; }
  if (typing) return;
  if (e.key === "Escape") {
    if (st.editSketch) { if (!sketcher.cancel()) { st.skSel = null; sketcher.sel = null; renderProps(); sketcher.render(); } return; }
    if (st.pick) { stopPick(true); return; }
    if (viewer.pickMode) { viewer.setPick(null); banner(null); return; }
    select(null); return;
  }
  if (e.key === "Enter" && st.editSketch && sketcher.draft?.type === "poly") { sketcher.finishPoly(); return; }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (st.editSketch) { sketcher.deleteSel(); return; }
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
if ("serviceWorker" in navigator && location.protocol === "https:" && !window.GABARIT_WASM_GZ) navigator.serviceWorker.register("sw.js").catch(() => {});

// Reprise du travail précédent
let saved = null; try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch { saved = null; }
if (saved && Array.isArray(saved.features) && (saved.features.length || saved.params?.length)) loadDoc(saved);
else { loadDoc(emptyDoc()); welcome(true); }
typoTree(document.body);
startWorker();
window.gabarit = { get doc() { return doc; }, st, viewer, loadDoc, exampleDoc };
if ("launchQueue" in window) window.launchQueue.setConsumer(async (p) => { for (const fh of p.files || []) openFile(await fh.getFile()); });
