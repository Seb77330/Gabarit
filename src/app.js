// Gabarit : application principale (interface, historique, échanges avec le noyau 3D).
import { Viewer } from "./viewer.js";
import { Sketcher, newId, circle3 } from "./sketcher.js";
import { read3mf, toStl, simplify, readStl, zoneMap, zoneUnmap } from "./mesh3mf.js";
import { zipStore } from "./meshfiles.js";
const MAX_TRIS = 20000;
import { ICONS, SHAPE_ICONS } from "./icons.js";
import { evalExpr, varsMap } from "./expr.js";
import { resolvePlane as resolvePlaneRaw, refPlanes, evalEntity, outline, isOpen, toWorld, STD_PLANES, cross, dot, norm, scale } from "./geo.js";
import { arrange } from "./regions.js";
import { exampleDoc } from "./example.js";
import { TEMPLATES, CHALLENGES } from "./templates.js";
import { readDrawing, drawingEntities } from "./drawfiles.js";
import { sheetSVG } from "./drawing.js";
import { solveSketch, writeBack, C_LABELS, C_GLYPH } from "./constraints.js";
import { createAssemblyUI } from "./assembly.js";
import { sketchDXF } from "./dxf.js";
import { createExtras } from "./extras.js";
import { createFurniture } from "./furniture.js";
import { IDENT, MOVES, omul, oread, osame, odet } from "./orient.js";
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
  shape: { label: "Forme", icon: "shape" },
  slice: { label: "Coupe à plat", icon: "slice" },
  stretch: { label: "Partie allongée", icon: "stretch" },
  scale: { label: "Taille", icon: "scale" },
  orient: { label: "Sens de pose", icon: "orient" },
  fit: { label: "Remplissage", icon: "fill" },
};
const MATERIALS = { pla: ["PLA", 1.24], petg: ["PETG", 1.27], abs: ["ABS", 1.04], resine: ["Résine", 1.15], alu: ["Aluminium", 2.7], acier: ["Acier", 7.85], inox: ["Inox", 8.0], laiton: ["Laiton", 8.5], bois: ["Bois (chêne)", 0.75] };
const STORE = "gabarit-doc-v1";
// ---------- Mode (Simple ou Expert) et thème (clair ou sombre) ----------
const pref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage plein */ } };
// Pas du quadrillage (mm) : carreaux du sol, flèches à tirer, boutons − et +, grille du dessin.
const PAS = [10, 5, 1, 0.5, 0.1, 0.01];
const pasMm = () => { const v = Number(pref("gabarit-pas")); return PAS.includes(v) ? v : 1; };
const pasText = (v) => String(v).replace(".", ",") + " mm";
// Quelqu'un qui a déjà des pièces ici garde tous les outils ; une première visite commence en mode Simple.
const HAD_WORK = ["gabarit-doc-v1", "gabarit-lib", "gabarit-tabs"].some((k) => pref(k));
let mode = (() => {
  const q = new URLSearchParams(location.search).get("mode");
  if (q === "simple" || q === "expert") { setPref("gabarit-mode", q); return q; }
  const m = pref("gabarit-mode");
  return m === "simple" || m === "expert" ? m : HAD_WORK ? "expert" : "simple";
})();
const isSimple = () => mode === "simple";
document.body.classList.toggle("simple", isSimple());
function setMode(m, quiet) {
  if (m !== "simple" && m !== "expert") return;
  const changed = m !== mode; mode = m; setPref("gabarit-mode", m);
  if (changed && m === "simple") setPref("gabarit-coach", "1");
  applyMode();
  if (changed && !quiet) toast(m === "simple" ? "Mode Simple : l’essentiel, avec des mots de tous les jours." : "Mode Expert : tous les outils sont là.");
}
function applyMode() {
  document.body.classList.toggle("simple", isSimple());
  document.querySelectorAll("#modeSw button").forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  closeShapes(); renderTools(); treeTitle();
  if (!isAsm()) { renderTree(); if (!st.editSketch) renderProps(); }
  renderCoach();
}
function treeTitle() { $(".tree > h2").textContent = isAsm() ? "Assemblage" : isSimple() ? "Étapes de ta pièce" : "Historique"; }
function applyTheme(t) {
  if (t) { document.documentElement.dataset.theme = t; setPref("gabarit-theme", t); }
  const dark = document.documentElement.dataset.theme === "dark";
  const b = $("[data-act=theme]"); if (b) { b.innerHTML = dark ? ICONS.sun : ICONS.moon; b.title = dark ? "Passer au thème clair" : "Passer au thème sombre"; }
  document.querySelector("meta[name=theme-color]")?.setAttribute("content", dark ? "#0c1016" : "#17202b");
  viewer.setTheme(dark);
}

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
function setLib(fn) { const lib = library(); fn(lib); try { localStorage.setItem(LIB, JSON.stringify(lib)); } catch { /* stockage plein */ } }
// Deux enregistrements de la même pièce ? (la date d'enregistrement ne compte pas)
const sameDoc = (a, b) => { const strip = (x) => { const { savedAt: _s, ...r } = x || {}; return JSON.stringify(r); }; return strip(a) === strip(b); };
// ---------- Onglets : plusieurs pièces ouvertes, comme des pages ----------
// Chaque onglet retient : dirty (modifié depuis l'ouverture ou le dernier enregistrement), base (« lib » :
// la pièce vient de « Mes pièces », « new » : elle n'y était pas), baseName (son nom à l'ouverture) et wrote
// (les noms sous lesquels l'enregistrement automatique l'a rangée). Un onglet sans « base » date d'avant la v1.4.
const TABS = "gabarit-tabs";
let tabs = { list: [], active: null };
try { tabs = JSON.parse(localStorage.getItem(TABS) || "null") || tabs; } catch { /* rien */ }
const tabKey = (id) => "gabarit-tab-" + id;
const baseKey = (id) => "gabarit-base-" + id; // la version de « Mes pièces » à l'ouverture, pour y revenir
const curTab = () => tabs.list.find((x) => x.id === tabs.active);
const isBlank = (d) => d && d.kind !== "assembly" && !(d.features || []).length && !(d.params || []).length;
function saveTabs() { try { localStorage.setItem(TABS, JSON.stringify(tabs)); } catch { /* stockage plein */ } }
function stashActive() {
  const t = curTab(); if (!t) return;
  flushLib();
  t.name = doc.name; try { localStorage.setItem(tabKey(t.id), JSON.stringify(doc)); } catch { /* stockage plein */ }
}
function tabDoc(id) { if (id === tabs.active) return doc; try { return JSON.parse(localStorage.getItem(tabKey(id)) || "null"); } catch { return null; } }
// Enregistrement automatique dans « Mes pièces » : seulement une pièce modifiée (ou un onglet d'avant la v1.4).
function autoLib() {
  const t = curTab(); if (isAsm() || isBlank(doc) || (t && t.base !== undefined && !t.dirty)) return;
  addToLibrary(doc);
  const n = doc.name || "Pièce sans nom";
  if (t && !(t.wrote || []).includes(n)) { t.wrote = [...(t.wrote || []), n]; saveTabs(); }
}
function flushLib() { clearTimeout(libTimer); autoLib(); }
// La pièce de l'onglet actif vient de changer : un point sur l'onglet, et la question à la fermeture.
function markDirty() {
  const t = curTab(); if (!t || t.dirty || t.base === undefined) return;
  t.dirty = true;
  if (t.base === "lib") { const old = library()[t.baseName]; try { if (old) localStorage.setItem(baseKey(t.id), JSON.stringify(old)); } catch { /* stockage plein : pas de retour possible */ } }
  saveTabs(); renderTabs();
}
// Un nom libre : ni celui d'un autre onglet, ni celui d'une autre pièce rangée dans « Mes pièces ».
function freeName(base, d, skipTab) {
  const lib = library();
  const taken = (n) => tabs.list.some((t) => t.id !== skipTab && t.name === n) || (lib[n] && !(d && sameDoc(lib[n], d)));
  if (!taken(base)) return base;
  let i = 2; while (taken(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}
// Ouvre d dans un nouvel onglet (ou dans l'onglet actuel s'il est vide).
function openTab(d) {
  const cur = curTab(), reuse = cur && isBlank(doc);
  if (!isBlank(d) && d.kind !== "assembly") {
    const n = d.name || "Pièce sans nom", lib = library();
    // déjà ouverte dans un autre onglet : on y va, sans l'ouvrir deux fois
    const open = lib[n] && sameDoc(lib[n], d) && tabs.list.find((t) => t.name === n && !(t.id === tabs.active && isBlank(doc)));
    if (open) { if (open.id !== tabs.active) switchTab(open.id); return; }
    const free = freeName(n, d, reuse ? cur.id : null); if (free !== n) d = { ...d, name: free };
  }
  const inLib = d.kind !== "assembly" && !isBlank(d) && !!library()[d.name];
  const meta = { name: d.name || "Pièce sans nom", dirty: false, base: inLib ? "lib" : "new", baseName: d.name || "Pièce sans nom", wrote: inLib ? [d.name] : [] };
  if (reuse) { Object.assign(cur, meta); try { localStorage.removeItem(baseKey(cur.id)); } catch { /* rien */ } saveTabs(); loadDoc(d); renderTabs(); return; }
  stashActive();
  const id = newId("t"); tabs.list.push({ id, ...meta }); tabs.active = id; saveTabs();
  loadDoc(d); save(); renderTabs();
}
function switchTab(id) {
  if (id === tabs.active) return;
  if (st.editSketch) closeSketch(true);
  stashActive(); let d = null; try { d = JSON.parse(localStorage.getItem(tabKey(id)) || "null"); } catch { d = null; }
  tabs.active = id; saveTabs(); loadDoc(d || emptyDoc()); save(); renderTabs();
}
// Retire l'onglet, sans rien demander ni toucher à « Mes pièces ».
function dropTab(id) {
  const i = tabs.list.findIndex((x) => x.id === id); if (i < 0) return;
  tabs.list.splice(i, 1); try { localStorage.removeItem(tabKey(id)); localStorage.removeItem(baseKey(id)); } catch { /* rien */ }
  if (id === tabs.active) {
    clearTimeout(libTimer);
    const next = tabs.list[Math.min(i, tabs.list.length - 1)];
    if (next) { tabs.active = null; saveTabs(); switchTabTo(next.id); }
    else { const nid = newId("t"); tabs.list.push({ id: nid, name: "Pièce sans nom", dirty: false, base: "new", baseName: "Pièce sans nom", wrote: [] }); tabs.active = nid; saveTabs(); loadDoc(emptyDoc()); save(); }
  } else saveTabs();
  renderTabs();
}
// Range la pièce d de l'onglet t dans « Mes pièces » sous le nom nm. Si elle venait de « Mes pièces » sous
// un autre nom, l'ancienne retrouve son état d'avant (comme « Enregistrer sous »).
function commitLib(t, d, nm) {
  let old = null; try { old = JSON.parse(localStorage.getItem(baseKey(t.id)) || "null"); } catch { old = null; }
  setLib((lib) => {
    for (const w of t.wrote || []) if (w !== nm) { if (w === t.baseName && t.base === "lib") { if (old) lib[w] = old; } else delete lib[w]; }
    lib[nm] = { ...JSON.parse(JSON.stringify(d)), name: nm, savedAt: Date.now() };
  });
  try { localStorage.removeItem(baseKey(t.id)); } catch { /* rien */ }
  Object.assign(t, { name: nm, dirty: false, base: "lib", baseName: nm, wrote: [nm] });
}
// Ferme l'onglet. Une pièce modifiée depuis son dernier enregistrement : on demande d'abord quoi en faire.
function closeTab(id) {
  const t = tabs.list.find((x) => x.id === id); if (!t) return;
  if (id === tabs.active && st.editSketch) closeSketch(true);
  const d = tabDoc(id);
  if (!d || isBlank(d) || !(t.dirty || t.base === undefined)) {
    const name = d && !isBlank(d) ? d.name : "", kept = name && d.kind !== "assembly" && library()[name];
    dropTab(id);
    if (name) toast(kept ? `« ${name} » fermée. Tu la retrouves dans « Mes pièces ».` : `« ${name} » ${d.kind === "assembly" ? "fermé" : "fermée"}.`);
    return;
  }
  askClose(t, d);
}
function askClose(t, d) {
  const dlg = $("#dlg"); dlg.innerHTML = "";
  const asm = d.kind === "assembly", legacy = t.base === undefined;
  const name = h("input", { type: "text", id: "closeName", value: d.name || "", spellcheck: "false", autocomplete: "off" });
  const file = h("input", { type: "checkbox", id: "closeFile" });
  const yes = () => {
    const nm = asm ? d.name : name.value.trim() || d.name || "Pièce sans nom";
    if (!asm) {
      const other = library()[nm];
      if (other && nm !== t.baseName && !(t.wrote || []).includes(nm) && !confirm(fr(`Une autre pièce s’appelle déjà « ${nm} » dans « Mes pièces ». La remplacer ?`))) return;
    }
    dlg.close();
    if (!asm) { d.name = nm; commitLib(t, d, nm); }
    if (asm || file.checked) download(new Blob([JSON.stringify(d, null, 1)], { type: "application/json" }), `${(nm || "piece").replace(/[\\/:*?"<>|]+/g, "-").trim() || "piece"}.gabarit`);
    dropTab(t.id);
    toast(asm ? `« ${nm} » est enregistré dans tes téléchargements.` : file.checked ? `« ${nm} » est enregistrée dans « Mes pièces », et en fichier dans tes téléchargements.` : `« ${nm} » est enregistrée dans « Mes pièces ».`);
  };
  const no = () => {
    dlg.close();
    // on défait l'enregistrement automatique : la pièce retrouve son état d'avant, ou disparaît si elle était nouvelle
    if (!legacy && !asm) {
      let old = null; try { old = JSON.parse(localStorage.getItem(baseKey(t.id)) || "null"); } catch { old = null; }
      setLib((lib) => { for (const w of t.wrote || []) { if (w === t.baseName && t.base === "lib") { if (old) lib[w] = old; } else delete lib[w]; } });
    }
    dropTab(t.id);
    toast(legacy && !asm ? `« ${d.name} » fermée. Une copie faite automatiquement reste dans « Mes pièces ».` : asm ? `« ${d.name} » fermé sans l’enregistrer.` : t.base === "lib" ? `« ${d.name} » fermée sans enregistrer tes changements.` : `« ${d.name} » fermée sans l’enregistrer.`);
  };
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); yes(); } });
  dlg.append(h("div", { class: "dh" }, fr(`Enregistrer « ${d.name || "Pièce sans nom"} » avant de fermer ?`)),
    h("div", { class: "db closeask" },
      h("p", {}, asm ? "Cet assemblage a changé. Il s’enregistre dans un fichier, rangé dans tes téléchargements." : t.base === "lib" ? "Tu as modifié cette pièce depuis son dernier enregistrement." : "Cette pièce n’est pas encore enregistrée."),
      asm ? null : h("div", { class: "field" }, h("label", { for: "closeName" }, "Nom de la pièce"), h("div", { class: "in" }, name)),
      asm ? null : h("p", { class: "sub" }, "« Enregistrer » la range dans « Mes pièces » : tu la retrouves sur l’écran d’accueil, dans ce navigateur."),
      asm ? null : h("label", { class: "check" }, file, h("span", {}, "Télécharger aussi un fichier .gabarit, à garder où tu veux"))),
    h("div", { class: "df" },
      h("button", { class: "btn primary", "data-close": "yes", onclick: yes }, "Enregistrer"),
      h("button", { class: "btn", "data-close": "no", onclick: no }, "Ne pas enregistrer"),
      h("button", { class: "btn", "data-close": "cancel", onclick: () => dlg.close() }, "Annuler")));
  typoTree(dlg);
  dlg.showModal(); if (!asm) name.select();
}
function switchTabTo(id) { let d = null; try { d = JSON.parse(localStorage.getItem(tabKey(id)) || "null"); } catch { d = null; } tabs.active = id; saveTabs(); loadDoc(d || emptyDoc()); save(); }
function renderTabs() {
  const bar = $("#tabs"); if (!bar) return;
  const cur = tabs.list.find((x) => x.id === tabs.active); if (cur) cur.name = doc.name;
  bar.innerHTML = "";
  for (const t of tabs.list) {
    bar.append(h("div", { class: "tab" + (t.id === tabs.active ? " on" : ""), title: t.name, onclick: () => switchTab(t.id), onauxclick: (e) => { if (e.button === 1) closeTab(t.id); } },
      t.dirty ? h("span", { class: "dot", title: "Modifiée, pas encore enregistrée" }) : null,
      h("span", { class: "nm" }, t.name || "Pièce sans nom"),
      h("button", { class: "x", title: "Fermer cet onglet", "aria-label": "Fermer", onclick: (e) => { e.stopPropagation(); closeTab(t.id); } }, "✕")));
  }
  bar.append(h("button", { class: "tab-new", title: "Nouvelle pièce dans un nouvel onglet", onclick: () => { openTab(emptyDoc()); welcome(false); toolAction("sketch"); } }, "+"));
}
const feat = (id) => doc.features.find((f) => f.id === id);
const featIndex = (id) => doc.features.findIndex((f) => f.id === id);
// Mode Simple : les mêmes étapes, avec des mots de tous les jours.
const PLAIN_TYPE = { sketch: "Dessin", extrude: "Volume", revolve: "Tour", hole: "Trou", fillet: "Arrondi", chamfer: "Biseau", shell: "Évidement", import: "Fichier importé" };
const typeLabel = (type) => (document.body.classList.contains("simple") && PLAIN_TYPE[type]) || TYPES[type].label;
const PLAIN = {
  "Esquisse utilisée": "Dessin utilisé", "Zones à extruder": "Zones à remplir", "Jusqu’à": "Jusqu’où", "Une distance": "Une épaisseur", "Une face": "Jusqu’à une face",
  "Sens": "De quel côté", "Normal": "D’un côté", "Inversé": "De l’autre", "Distance": "Épaisseur", "Enlever de la matière": "Creuser", "Enlever": "Creuser",
  "Axe de rotation": "Tourner autour de", "Axe vertical de l’esquisse": "L’axe vertical du dessin", "Axe horizontal": "L’axe horizontal", "Angle": "Angle (360 = tour complet)",
  "Type de trou": "Forme du trou", "Lamé": "Tête cachée", "Fraisé": "Tête conique", "Traversant": "Traverse toute la pièce",
  "Diamètre du lamage": "Diamètre du logement de la tête", "Profondeur du lamage": "Profondeur du logement", "Diamètre de la fraisure": "Diamètre du cône", "Angle de la fraisure": "Angle du cône",
  "Des fonctions": "Certaines étapes", "Nombre d’exemplaires": "Combien en tout", "Écart entre deux exemplaires": "Écart entre deux", "Deuxième direction (grille)": "Répéter aussi dans un autre sens (grille)",
  "Rayon": "Rayon de l’arrondi", "Épaisseur de paroi": "Épaisseur des parois", "Échelle": "Taille (1 = taille d’origine)",
};
// Remplace, dans le panneau de réglages, les mots de métier par leur version simple.
function plainify(root) {
  for (const el of root.querySelectorAll("label, .seg button, h2")) {
    for (const n of el.childNodes) { if (n.nodeType !== 3) continue; const t = n.nodeValue.trim(); if (PLAIN[t]) n.nodeValue = n.nodeValue.replace(t, PLAIN[t]); }
  }
}
function nextName(type) {
  const base = typeLabel(type); let n = 1;
  const names = new Set(doc.features.map((f) => f.name));
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

// ---------- Historique d'annulation ----------
let hist = [], hidx = -1, pending = false; // pending : un réglage en direct n'est pas encore rangé dans l'historique
function pushHistory() {
  pending = false;
  const j = JSON.stringify(doc);
  if (hist[hidx] === j) return;
  const first = hidx < 0; // le chargement d'une pièce n'est pas une modification
  hist = hist.slice(0, hidx + 1); hist.push(j); if (hist.length > 300) hist.shift(); hidx = hist.length - 1;
  if (!first) markDirty();
  save();
}
let libTimer;
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(doc)); }
  catch { if (!st.saveWarned) { st.saveWarned = true; toast("Pièce trop lourde pour l’enregistrement automatique : pense à faire « Enregistrer » (Ctrl+S)."); } }
  if (!isAsm()) { clearTimeout(libTimer); libTimer = setTimeout(autoLib, 800); }
  const t = curTab();
  if (t && t.name !== doc.name) { t.name = doc.name; saveTabs(); renderTabs(); }
}
// Un réglage en cours (case pas encore validée, flèche tirée) compte comme un changement : on le range
// dans l'historique avant de reculer, pour qu'Annuler défasse bien la dernière chose visible.
function undo() {
  if (pending) pushHistory();
  if (hidx > 0) { hidx--; restore(); return true; }
  return false;
}
function redo() { if (hidx < hist.length - 1) { hidx++; restore(); return true; } return false; }
// Annuler / Rétablir avec un mot à l'écran : on voit que le raccourci a été pris, même si rien ne bouge.
function undoSay() { toast(undo() ? "Annulé. Ctrl+Y pour rétablir." : "Rien à annuler.", 1600); }
function redoSay() { toast(redo() ? "Rétabli." : "Rien à rétablir.", 1600); }
// Ctrl+Z dans une case : le navigateur défait d'abord ce qui vient d'être tapé ; s'il n'a rien à défaire,
// c'est la dernière modification de la pièce qui est annulée (avant, le raccourci ne faisait alors rien).
let nativeUndo = 0;
document.addEventListener("input", (e) => { if (e.inputType === "historyUndo" || e.inputType === "historyRedo") nativeUndo++; }, true);
function undoKey(e, back) {
  if (document.querySelector("dialog[open]")) return; // dans une fenêtre de question, le clavier reste au champ
  const a = document.activeElement;
  const typing = /^(INPUT|TEXTAREA)$/.test(a?.tagName) && !["checkbox", "radio", "range", "button"].includes(a.type);
  const go = () => { if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) document.activeElement.blur(); if (back) undoSay(); else redoSay(); };
  if (!typing) { e.preventDefault(); go(); return; }
  const n = nativeUndo; setTimeout(() => { if (nativeUndo === n) go(); }, 0);
}
function restore() {
  doc = JSON.parse(hist[hidx]); markDirty(); pending = false;
  if (isAsm()) { save(); asmUI.undoRefresh(); asmUI.render(); return; }
  if (st.sel && !feat(st.sel)) st.sel = null;
  if (st.editSketch && !feat(st.editSketch)) closeSketch(true);
  stopPick(); save(); renderAll(); requestBuild();
  if (st.editSketch) sketcher.render();
}
function mutate(fn, transient = false) {
  fn(doc);
  if (!transient) pushHistory(); else { pending = true; save(); }
  renderTree(); requestBuild();
  if (st.editSketch) sketcher.render();
}
function loadDoc(d, fit = true) {
  if (extras?.isPrintOpen()) extras.closePrint();
  meuble?.close();
  const wasAsm = isAsm();
  doc = Object.assign(d.kind === "assembly" ? emptyAsm() : emptyDoc(), d);
  document.body.classList.toggle("asm", isAsm());
  treeTitle();
  if (isAsm()) {
    closeSketch(true); stopPick(); viewer.setPick(null); banner(null); st.mesh = null; viewer.setCog(null); if (viewer.section) toggleSection();
    hist = []; hidx = -1; pushHistory();
    $("#docName").value = doc.name; layoutMode(); asmUI.enter(); return;
  }
  if (wasAsm) { renderTools(); viewer.setMesh(null); viewer.setPick(null); banner(null); if (viewer.section) toggleSection(); }
  st.sel = null; st.stopAt = null; st.errors = {}; closeSketch(true); stopPick();
  hist = []; hidx = -1; pushHistory(); goodSnap = null;
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
  if (m.type === "ready") { workerReady = true; clearTimeout(readyTimer); engineFailed = false; $(".engine-fail")?.remove(); showBusy(false); renderStatus(); if (isAsm()) asmUI.undoRefresh(); else if (skipBuild) skipBuild = false; else requestBuild(0); return; }
  if (m.type === "built" && m.preview) {
    if (m.req === buildReq && st.pick) {
      viewer.setGhost(m.mesh);
      // forme en cours de pose : on recule une fois pour la voir en entier
      if (st.pick.kind === "place" && !st.pick.fitted && m.mesh) { st.pick.fitted = true; viewer.fit(null, m.mesh.bb); }
    }
    return;
  }
  if (m.type === "built") {
    if (m.req !== buildReq) return;
    goodSnap = sentSnap;
    // pendant une sélection, la pièce affichée s'arrête avant l'étape : on calcule en plus l'aperçu du résultat
    const pf = st.pick?.featId ? feat(st.pick.featId) : null;
    if (m.regions && st.pick?.kind === "regions" && pf) { st.regions = m.regions; viewer.setRegions(m.regions, regionSel(pf)); }
    if (pf && ((["fillet", "chamfer", "shell", "draft"].includes(pf.type) && (pf.edges || pf.faces || []).length) || (pf.type === "extrude" && pf.regions?.length) || pf.type === "shape" || pf.type === "slice") && !pf.suppressed) worker.postMessage({ type: "build", req: buildReq, preview: true, doc, stopAt: featIndex(pf.id) + 1 });
    else viewer.setGhost(null);
    st.building = false; showBusy(false);
    if (m.heap > 1.4e9) setTimeout(restartWorker, 50); // libère la mémoire du noyau
    st.errors = m.errors; st.info = m.info; st.mesh = m.mesh; st.lastMs = m.ms;
    viewer.setMesh(m.mesh); extras.refreshPrint(); meuble?.refresh();
    viewer.setCog(st.showCog && m.mesh?.cog ? m.mesh.cog : null);
    if (st.firstFit && m.mesh) { viewer.fit([1, -1.3, 0.9]); st.firstFit = false; }
    if (st.editSketch) updateSketchRefs();
    renderTree(); renderStatus(); renderOverlay(); refreshMarkers(); if (doc.defi) renderCoach();
    if (!st.editSketch) renderProps();
    return;
  }
  if (m.type === "asmBuilt") { if (m.heap > 1.6e9) setTimeout(restartWorker, 50); asmUI.onBuilt(m); return; }
  if (m.type === "asmInterf") { const cb = pendingExport.get(m.req); pendingExport.delete(m.req); cb?.(m.list); return; }
  if (m.type === "drawing") { const cb = pendingExport.get(m.req); pendingExport.delete(m.req); cb?.(m.views); return; }
  if (m.type === "exported") { const cb = pendingExport.get(m.req); pendingExport.delete(m.req); cb?.(m.blob); return; }
  if (m.type === "whose") { const cb = pendingExport.get(m.req); pendingExport.delete(m.req); cb?.(m.owner); return; }
  if (m.type === "fixed") { const cb = pendingExport.get(m.req); pendingExport.delete(m.req); cb?.(m.value); return; }
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
    buildReq++; st.building = true; buildStart = Date.now(); sentSnap = JSON.stringify(doc);
    const mine = buildReq;
    setTimeout(() => { if (st.building) showBusy(true); }, 250);
    setTimeout(() => { if (st.building && buildReq === mine) { showBusy(true, "Calcul long… Échap pour l’annuler"); $("#busy").classList.add("long"); } }, 2500);
    const rf = st.pick?.kind === "regions" ? feat(st.pick.featId) : null;
    worker.postMessage({ type: "build", req: buildReq, doc, stopAt: currentStopAt(), regionsOf: rf?.sketch });
  }, delay);
}
// Annule le calcul en cours (Échap) : le moteur 3D est relancé et on revient à la dernière version calculée.
let buildStart = 0, sentSnap = null, goodSnap = null, skipBuild = false;
function cancelBuild() {
  if (!st.building || isAsm()) return false;
  clearTimeout(buildTimer); buildReq++;
  // le champ en cours de saisie est lâché : sa valeur entre dans l'historique et Ctrl+Z la retrouve
  const act = document.activeElement; if (act && act.closest?.("#props")) act.blur();
  try { worker.terminate(); } catch { /* déjà arrêté */ }
  workerReady = false; st.building = false; showBusy(false);
  const now = JSON.stringify(doc);
  if (goodSnap && goodSnap !== now) {
    pushHistory(); // la modification annulée reste dans l'historique (Ctrl+Z la retrouve)
    doc = JSON.parse(goodSnap);
    if (st.sel && !feat(st.sel)) st.sel = null;
    if (st.editSketch && !feat(st.editSketch)) closeSketch(true);
    stopPick(false); pushHistory(); renderAll();
    toast("Calcul annulé : retour à la dernière version calculée. Ctrl+Z retrouve ta modification.");
  } else { skipBuild = true; toast("Calcul annulé. Modifie la pièce ou mets une étape en pause : le calcul repartira."); }
  startWorker();
  return true;
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
  pendingExport.set(req, (blob) => { showBusy(false); download(blob, `${safeName()}.${kind}`); toast(msgs[kind]); if (doc.defi) { doc.defi.exported = true; save(); renderCoach(); } });
  worker.postMessage({ type: "export", req, kind, opts: { fine: true, name: doc.name, down: kind !== "step" ? doc.printDown || null : null } });
}
// Pack de publication : tout ce qu'il faut pour partager la pièce sur un site de modèles 3D
// (MakerWorld de Bambu Lab, Printables, Thingiverse…) : fichiers 3MF et STL, 4 images, une fiche, la pièce modifiable.
async function publishPack() {
  if (isAsm()) { toast("Le pack de publication se prépare depuis une pièce."); return; }
  if (!st.mesh) { toast("Crée d’abord un volume."); return; }
  showBusy(true, "Préparation du pack…");
  const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const exp = (kind) => new Promise((res, rej) => {
    const req = ++exportReq; const t = setTimeout(() => { pendingExport.delete(req); rej(new Error("export")); }, 90000);
    pendingExport.set(req, (blob) => { clearTimeout(t); res(blob); });
    worker.postMessage({ type: "export", req, kind, opts: { fine: true, name: doc.name, down: doc.printDown || null } });
  });
  try {
    const stl = await bytes(await exp("stl")), mf = await bytes(await exp("3mf"));
    const colored = viewer.mat.vertexColors; // vue « Impression 3D » ouverte : images sans les couleurs de surplomb
    if (colored) { viewer.mat.vertexColors = false; viewer.mat.color.set(0xc3ccd7); viewer.mat.needsUpdate = true; }
    const png = viewer.shots([[1, -1.3, 0.9], [-1, -1.3, 0.9], [0, -1, 0.02], [0.01, -0.01, 1]]).map((u) => { const bin = atob(u.split(",")[1]); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; });
    if (colored) { viewer.mat.vertexColors = true; viewer.mat.color.set(0xffffff); viewer.mat.needsUpdate = true; }
    const [lo, hi] = st.mesh.bb; const vol = st.mesh.volume / 1000; const mat = MATERIALS[doc.material] || MATERIALS.pla; const n = safeName();
    const dims = `${nf(hi[0] - lo[0], 1)} × ${nf(hi[1] - lo[1], 1)} × ${nf(hi[2] - lo[2], 1)} mm`;
    const fiche = [
      `${doc.name}`, "=".repeat(Math.max(8, doc.name.length)), "",
      `Dimensions : ${dims}`, `Volume : ${nf(vol, 2)} cm³`, `Masse estimée : ${nf(vol * mat[1], 1)} g en ${mat[0]} (pièce pleine)`,
      `Orientation d’impression : ${doc.printDown ? "posée à plat (celle choisie dans « Impression 3D »)" : "celle du modèle"}`, "",
      "Dans ce dossier", "---------------",
      `${n}.3mf : pour ton trancheur (Bambu Studio, OrcaSlicer, PrusaSlicer, Cura…)`, `${n}.stl : le même modèle, format universel`,
      "images/ : 4 vues de la pièce, à utiliser comme photos de présentation", `${n}.gabarit : la pièce modifiable, à rouvrir dans Gabarit`, "",
      "Pour la publier sur un site de modèles 3D (MakerWorld, Printables, Thingiverse…)", "--------------------------------------------------------------------------------",
      "1. Crée un nouveau modèle sur le site.", "2. Dépose le fichier 3MF (ou le STL).", "3. Ajoute les images du dossier « images ».", "4. Colle la description ci-dessous et complète-la.", "",
      "Description proposée", "--------------------",
      `${doc.name}. Dimensions : ${dims}. Environ ${nf(vol * mat[1], 0)} g de ${mat[0]}.`, "Modèle conçu avec Gabarit.", "",
    ].map((l) => l.replace(/ ([:;!?»])/g, "\u00a0$1").replace(/« /g, "«\u00a0")).join("\r\n");
    download(zipStore([[`${n}.3mf`, mf], [`${n}.stl`, stl], ["images/1-vue-3d.png", png[0]], ["images/2-vue-3d-arriere.png", png[1]], ["images/3-face.png", png[2]], ["images/4-dessus.png", png[3]], [`${n}.gabarit`, JSON.stringify(doc, null, 1)], ["fiche.txt", "\ufeff" + fiche]]), `${n}-publication.zip`);
    toast("Pack de publication enregistré : fichiers 3MF et STL, 4 images et une fiche.");
  } catch { toast("Le pack n’a pas pu être préparé. Réessaie après le calcul de la pièce."); }
  showBusy(false);
}
const safeName = () => (doc.name || "piece").replace(/[\\/:*?"<>|]+/g, "-").trim() || "piece";
function download(blob, name) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// ---------- Interface : outils ----------
const TOOLBAR = [
  ["Esquisse", [["sketch", "Esquisse"], ["plane", "Plan"]]],
  ["Volumes", [["extrude", "Extrusion"], ["cut", "Enlèvement"], ["revolve", "Révolution"], ["loft", "Lissage"], ["sweep", "Balayage"], ["helix", "Ressort"], ["shapes", "Formes"]]],
  ["Finitions", [["hole", "Perçage"], ["thread", "Filetage"], ["fillet", "Congé"], ["chamfer", "Chanfrein"], ["shell", "Coque"], ["draft", "Dépouille"], ["rib", "Nervure"], ["slice", "Coupe à plat"], ["stretch", "Allonger"]]],
  ["Copies", [["mirror", "Symétrie"], ["pattern", "Répétition"], ["import", "Importer"]]],
  ["Outils", [["measure", "Mesurer"], ["section", "Coupe"], ["print", "Impression 3D"], ["meuble", "Dans un meuble"], ["drawing", "Mise en plan"]]],
];
// Mode Simple : moins d'outils, des mots de tous les jours (les mêmes outils derrière).
const TOOLBAR_SIMPLE = [
  ["Créer", [["shapes", "Formes prêtes", "hero"], ["sketch", "Dessiner"], ["import", "Importer"]]],
  ["Volume", [["extrude", "Donner du volume"], ["cut", "Creuser"], ["revolve", "Faire tourner"], ["slice", "Couper à plat"], ["stretch", "Allonger"]]],
  ["Finitions", [["hole", "Percer"], ["fillet", "Arrondir"], ["chamfer", "Biseauter"], ["shell", "Vider"]]],
  ["Copies", [["mirror", "Symétrie"], ["pattern", "Répéter"]]],
  ["Vérifier", [["measure", "Mesurer"], ["print", "Imprimer en 3D"], ["meuble", "Dans un meuble"]]],
];
const toolbar = () => (isSimple() ? TOOLBAR_SIMPLE : TOOLBAR);
const TOOL_ICON = { shapes: "shape" };
function renderTools() {
  const t = $("#tools"); t.innerHTML = "";
  for (const [cap, grp] of toolbar()) {
    t.append(h("div", { class: "tgroup" },
      h("div", { class: "trow" }, grp.map(([k, label, cls]) => h("button", { class: "tbtn" + (cls ? " " + cls : ""), "data-tool": k, title: TOOL_TIPS[k], onclick: () => toolAction(k) }, h("span", { html: ICONS[TOOL_ICON[k] || k] }), label))),
      h("div", { class: "tcap" }, cap)));
  }
}
const TOOL_TIPS = {
  sketch: "Dessiner un profil 2D sur un plan ou une face",
  extrude: "Donner de l’épaisseur à une esquisse",
  cut: "Creuser la pièce avec une esquisse",
  revolve: "Faire tourner une esquisse autour d’un axe (pièces de tour)",
  hole: "Percer des trous simples, lamés ou fraisés, aux cotes d’une vis ou d’un insert",
  fillet: "Arrondir des arêtes",
  chamfer: "Casser des arêtes en biais",
  shell: "Évider la pièce en gardant une paroi",
  mirror: "Copier la pièce en miroir par rapport à un plan",
  pattern: "Répéter la pièce ou des fonctions, en ligne, en grille ou en cercle",
  plane: "Créer un plan de référence décalé ou incliné",
  loft: "Relier plusieurs esquisses par une forme qui passe de l’une à l’autre",
  sweep: "Faire glisser un profil le long d’un chemin (tuyau, poignée, ressort plat…)",
  draft: "Incliner des faces pour le démoulage",
  import: "Ajouter un fichier à la pièce : un modèle 3D (STL, 3MF de Bambu Lab ou Prusa, STEP) ou un dessin (SVG, DXF) qui devient une esquisse",
  shapes: "Poser une forme toute faite : boîte, cylindre, sphère, engrenage, texte…",
  helix: "Créer un ressort (fil enroulé en hélice)",
  thread: "Fileter un axe ou tarauder un trou (vrai filet en 3D)",
  rib: "Ajouter un renfort à partir d’un simple trait d’esquisse",
  measure: "Mesurer une distance entre deux points de la pièce",
  section: "Couper la vue pour voir l’intérieur",
  drawing: "Créer le plan 2D de la pièce, à imprimer ou en PDF",
  print: "Voir les surplombs à soutenir et poser la pièce à plat automatiquement",
  meuble: "Poser la pièce dans une case Kallax, une étagère Billy, un bac ou ton propre meuble : voir si elle rentre, combien tu en ranges, et jusqu’où l’agrandir",
  slice: "Couper la pièce bien droit et enlever tout ce qui dépasse d’un côté (raccourcir, retirer un socle…)",
  scale: "Agrandir ou réduire toute la pièce, en pourcentage ou en millimètres",
  stretch: "Choisir une partie de la pièce entre deux traits et lui donner une autre taille, sans déformer le reste (rallonger une tige, un pied, élargir une assise…)",
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
let meuble = null; // « Essayer dans un meuble », créé plus bas avec la vue
function toolAction(k) {
  if (!["measure", "section", "drawing", "print", "meuble", "import", "shapes"].includes(k)) lastTool = k;
  if (engineFailed && !["sketch", "plane", "measure", "section"].includes(k)) toast("Le moteur 3D n’a pas démarré dans cet aperçu : ouvre Gabarit.html dans Chrome, Edge ou Firefox pour créer des volumes.");
  if (st.editSketch) {
    if (["measure", "section"].includes(k)) { toast("Mesure et coupe : sors d’abord de l’esquisse."); return; }
    if (st.afterSketch && ["extrude", "cut", "revolve", "rib"].includes(k)) st.afterSketch = null; // l'outil cliqué l'emporte
    closeSketch();
  }
  if (k === "measure") { meuble?.close(); toggleMeasure(); return; }
  if (k === "section") { meuble?.close(); toggleSection(); return; }
  if (k === "drawing") { openDrawing(); return; }
  if (k === "print") { meuble?.close(); extras.printPanel(); return; }
  if (extras.isPrintOpen()) extras.closePrint();
  if (k === "meuble") {
    if (isAsm()) { toast("L’essai dans un meuble se fait sur une pièce : ouvre-la dans son onglet."); return; }
    stopPick(); stopMeasure(); if (viewer.section) toggleSection(); if (!meuble.isOpen()) select(null);
    meuble.panel(); return;
  }
  meuble.close();
  stopPick(); stopMeasure();
  if (k === "plane") { choosePlane((base) => { insertFeature({ id: newId("f"), type: "plane", name: nextName("plane"), base, offset: "10", rot: "x", angle: "0" }); }, "Le nouveau plan part de quel plan ?"); return; }
  if (k === "import") { importFile(); return; }
  if (k === "shapes") { shapesBox(); return; }
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
      const f = { id: newId("f"), type, name: k === "cut" ? nextNameRaw(isSimple() ? "Creux" : "Enlèvement") : nextName(type), sketch: skId, mode: k === "cut" ? "cut" : "add" };
      if (type === "extrude") Object.assign(f, { dist: k === "cut" ? "5" : "10", dir: k === "cut" ? "inverse" : "normal", through: false });
      else Object.assign(f, { axis: "y", angle: "360" });
      insertFeature(f);
      // contours qui se croisent : on demande quelles zones utiliser
      if (type === "extrude" && crossingContours(feat(skId))) startPick("regions", f.id);
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
  if (k === "scale") {
    if (!st.mesh) { toast("Il faut d’abord une pièce : ouvre un fichier 3D ou pose une forme."); return; }
    const f = tailStep("scale");
    if (f) select(f.id); else insertFeature({ id: newId("f"), type: "scale", name: nextName("scale"), k: "100" }, tailAt("scale"));
    return;
  }
  if (k === "orient") {
    if (!st.mesh) { toast("Il faut d’abord une pièce : ouvre un fichier 3D ou pose une forme."); return; }
    const f = tailStep("orient");
    if (f) select(f.id); else insertFeature({ id: newId("f"), type: "orient", name: nextName("orient"), m: [...IDENT] }, tailAt("orient"));
    return;
  }
  if (k === "stretch") {
    if (!st.mesh) { toast("Il faut d’abord une pièce : ouvre un fichier 3D ou pose une forme."); return; }
    // on complète l'étape « Partie allongée » si c'est elle qui est choisie ou la dernière, sinon on en crée une
    const live = doc.features.slice(0, st.stopAt ?? doc.features.length).filter((g) => !g.suppressed);
    let f = st.sel && feat(st.sel)?.type === "stretch" ? feat(st.sel) : live.at(-1)?.type === "stretch" ? live.at(-1) : null;
    if (f) { if (st.sel !== f.id) select(f.id); } else { f = { id: newId("f"), type: "stretch", name: nextName("stretch"), zones: [] }; insertFeature(f); }
    pickStretch(f); return;
  }
  if (k === "slice") {
    if (!st.mesh) { toast("Il faut d’abord une pièce à couper."); return; }
    const bb = st.mesh.bb; let axis = "z", at = (bb[0][2] + bb[1][2]) / 2;
    const pf = pre.faces.find((x) => x.info?.plane); // face plane déjà choisie : la coupe se met à son niveau
    if (pf) { const n = pf.info.n.map(Math.abs); const i = n.indexOf(Math.max(...n)); if (n[i] > 0.999) { axis = "xyz"[i]; at = pf.p[i]; } }
    const f = { id: newId("f"), type: "slice", name: nextName("slice"), axis, at: r2(at), keep: "below" };
    insertFeature(f); startPick("slice", f.id); return;
  }
  if (k === "mirror") { insertFeature({ id: newId("f"), type: "mirror", name: nextName("mirror"), target: "part", feats: [], plane: { kind: "std", name: "droite", offset: "0" } }); return; }
  if (k === "pattern") { insertFeature({ id: newId("f"), type: "pattern", name: nextName("pattern"), target: "part", feats: [], kind: "lin", axis: "x", count: "3", step: "20", angle: "360", two: false, axis2: "y", count2: "2", step2: "20" }); return; }
}
// ---------- Formes prêtes ----------
// [nom, valeurs de départ, champs de taille [clé, libellé, unité]]
const SHAPES = {
  box: ["Boîte", { a: "40", b: "30", h: "20", r: "0" }, [["a", "Longueur (X)"], ["b", "Largeur (Y)"], ["h", "Hauteur (Z)"], ["r", "Coins arrondis"]]],
  cyl: ["Cylindre", { d: "30", h: "30" }, [["d", "Diamètre"], ["h", "Hauteur"]]],
  sphere: ["Sphère", { d: "30" }, [["d", "Diamètre"]]],
  cone: ["Cône", { d: "30", d2: "0", h: "30" }, [["d", "Diamètre du bas"], ["d2", "Diamètre du haut (0 = pointu)"], ["h", "Hauteur"]]],
  tube: ["Tube", { d: "30", t: "3", h: "30" }, [["d", "Diamètre extérieur"], ["t", "Épaisseur de la paroi"], ["h", "Hauteur"]]],
  torus: ["Anneau", { d: "40", t: "10" }, [["d", "Diamètre extérieur"], ["t", "Grosseur de l’anneau"]]],
  prism: ["Prisme", { d: "30", n: "6", h: "20" }, [["d", "Diamètre"], ["n", "Nombre de côtés", ""], ["h", "Hauteur"]]],
  wedge: ["Rampe", { a: "40", b: "30", h: "20" }, [["a", "Longueur (X)"], ["b", "Largeur (Y)"], ["h", "Hauteur (Z)"]]],
  star: ["Étoile", { d: "40", n: "5", q: "45", h: "5" }, [["d", "Diamètre"], ["n", "Nombre de branches", ""], ["q", "Rayon du creux", "%"], ["h", "Épaisseur"]]],
  heart: ["Cœur", { a: "40", h: "5" }, [["a", "Largeur"], ["h", "Épaisseur"]]],
  gear: ["Engrenage", { n: "16", m: "2", d: "5", h: "6" }, [["n", "Nombre de dents", ""], ["m", "Taille des dents (module)"], ["d", "Trou au centre"], ["h", "Épaisseur"]]],
  text: ["Texte", { txt: "Gabarit", s: "12", h: "3" }, [["s", "Taille des lettres"], ["h", "Épaisseur"]]],
};
const r2 = (v) => String(Math.round(v * 100) / 100);
// Angles (autour de Y puis de Z) qui amènent l'axe de la forme sur la direction n.
function normalAngles(n) {
  const u = norm(n); if (Math.abs(u[2]) > 0.9999) return [u[2] > 0 ? 0 : 180, 0];
  return [(Math.acos(Math.max(-1, Math.min(1, u[2]))) * 180) / Math.PI, (Math.atan2(u[1], u[0]) * 180) / Math.PI];
}
function shapesOutside(e) { if (!e.target.closest("#shapes") && !e.target.closest("[data-tool=shapes]")) closeShapes(); }
function closeShapes() { $("#shapes")?.remove(); document.removeEventListener("pointerdown", shapesOutside, true); }
function shapesBox() {
  if ($("#shapes")) { closeShapes(); return; }
  const tip = !st.mesh ? "Choisis une forme : elle arrive au centre, puis tu règles sa taille."
    : st.facePlane ? "Choisis une forme : elle se pose sur la face que tu as choisie."
      : "Choisis une forme, puis clique sur la pièce pour la poser où tu veux.";
  const box = h("div", { id: "shapes", class: "shapes" }, h("h4", {}, "Formes prêtes"), h("p", {}, tip),
    h("div", { class: "sgrid" }, Object.entries(SHAPES).map(([k, [label]]) => h("button", { class: "sh", "data-shape": k, onclick: () => { closeShapes(); addShape(k); } }, h("span", { html: SHAPE_ICONS[k] }), label))));
  document.body.append(box);
  const b = document.querySelector(".tbtn[data-tool=shapes]")?.getBoundingClientRect(); const r = box.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(b ? b.left : 20, innerWidth - r.width - 8)) + "px"; box.style.top = ($("#tools").getBoundingClientRect().bottom + 6) + "px";
  document.addEventListener("pointerdown", shapesOutside, true);
}
function addShape(kind) {
  if (st.editSketch) closeSketch();
  if (extras.isPrintOpen()) extras.closePrint();
  meuble.close();
  stopPick(); stopMeasure();
  const [label, defs] = SHAPES[kind];
  const f = { id: newId("f"), type: "shape", kind, name: nextNameRaw(label), mode: "add", ...defs, x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0" };
  // Position de départ : sur la face choisie, sinon posée sur le dessus de la pièce.
  const face = st.pre?.faces?.length === 1 && st.pre.faces[0].info?.plane ? st.pre.faces[0] : null;
  const had = !!st.mesh;
  if (face) { const [ry, rz] = normalAngles(face.info.n); Object.assign(f, { x: r2(face.p[0]), y: r2(face.p[1]), z: r2(face.p[2]), ry: r2(ry), rz: r2(rz) }); }
  else if (had) { const [lo, hi] = st.mesh.bb; Object.assign(f, { x: r2((lo[0] + hi[0]) / 2), y: r2((lo[1] + hi[1]) / 2), z: r2(hi[2]) }); }
  clearFaceSel();
  insertFeature(f);
  if (had) startPick("place", f.id);
  else st.firstFit = true;
}
function nextNameRaw(base) { let n = 1; const names = new Set(doc.features.map((f) => f.name)); while (names.has(`${base} ${n}`)) n++; return `${base} ${n}`; }
function insertFeature(f, at = null) {
  const snap = JSON.stringify(doc);
  mutate((d) => { putFeature(d, f, at); });
  select(f.id); st.editStart = { id: f.id, snap, isNew: true };
}
function putFeature(d, f, at = null) {
  if (at !== null) { d.features.splice(at, 0, f); if (st.stopAt !== null) st.stopAt++; }
  else if (st.stopAt !== null) { d.features.splice(st.stopAt, 0, f); st.stopAt++; }
  else d.features.push(f);
}
// Les étapes qui règlent toute la pièce se rangent à la fin de l'historique, toujours dans cet ordre : le sens de
// pose, la taille, puis le remplissage d'un meuble. « tailStep » retrouve celle d'un type, « tailAt » dit où en
// glisser une nouvelle pour garder l'ordre.
const TAIL = ["orient", "scale", "fit"];
function tailRange() {
  const lim = st.stopAt ?? doc.features.length; let i = lim;
  while (i > 0 && TAIL.includes(doc.features[i - 1].type)) i--;
  return [i, lim];
}
function tailStep(type) { const [a, b] = tailRange(); for (let j = b - 1; j >= a; j--) if (doc.features[j].type === type && !doc.features[j].suppressed) return doc.features[j]; return null; }
function tailAt(type) {
  const [a, b] = tailRange(); const rank = TAIL.indexOf(type); let at = a;
  for (let j = a; j < b; j++) if (TAIL.indexOf(doc.features[j].type) <= rank) at = j + 1;
  return at;
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

// Vrai si deux contours fermés de l'esquisse se croisent (il faut alors choisir les zones).
function crossingContours(sk) {
  if (!sk) return false;
  const v = varsMap(doc.params); const L = [];
  // avec des traits ouverts : il y a un choix à faire dès qu'ils découpent plus de zones qu'il n'y a de contours
  const evs = []; for (const e of sk.entities || []) { try { const o = evalEntity(e, v); if (!o.construction && o.type !== "point" && o.type !== "text") evs.push(o); } catch { /* ignorée */ } }
  if (evs.some(isOpen)) {
    const open = evs.filter(isOpen);
    return arrange(evs).faces.length > evs.length - open.length + arrange(open).outers.length;
  }
  for (const e of sk.entities || []) { try { const o = evalEntity(e, v); if (o.type === "point" || o.type === "text" || o.construction || o.type === "path" || (o.type === "spline" && !o.closed)) continue; L.push(outline(o)); } catch { /* ignorée */ } }
  const segX = (a, b, c, d) => { const r = (p, q, s2) => (q[0] - p[0]) * (s2[1] - p[1]) - (q[1] - p[1]) * (s2[0] - p[0]); const d1 = r(c, d, a), d2 = r(c, d, b), d3 = r(a, b, c), d4 = r(a, b, d); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 && d2 && d3 && d4; };
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const A = L[i], B = L[j];
    for (let a = 0; a < A.length; a++) for (let b = 0; b < B.length; b++) if (segX(A[a], A[(a + 1) % A.length], B[b], B[(b + 1) % B.length])) return true;
  }
  return false;
}
// Zones choisies : index des zones (maillage) qui contiennent un point enregistré.
function regionSel(f) {
  const sk = feat(f.sketch); if (!sk || !st.regions || !f.regions?.length) return [];
  let pl; try { pl = resolvePlane(sk.plane, varsMap(doc.params)); } catch { return []; }
  const uv = (x, y, z) => { const d = [x - pl.origin[0], y - pl.origin[1], z - pl.origin[2]]; return [dot(d, pl.x), dot(d, pl.y)]; };
  const out = [];
  st.regions.forEach((T, i) => {
    for (let t = 0; t < T.length; t += 9) {
      const a = uv(T[t], T[t + 1], T[t + 2]), b = uv(T[t + 3], T[t + 4], T[t + 5]), c = uv(T[t + 6], T[t + 7], T[t + 8]);
      if (f.regions.some((p) => inTri([+p[0], +p[1]], a, b, c))) { out.push(i); break; }
    }
  });
  return out;
}
function inTri(p, a, b, c) {
  const s1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]), s2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]), s3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
  return (s1 >= -1e-9 && s2 >= -1e-9 && s3 >= -1e-9) || (s1 <= 1e-9 && s2 <= 1e-9 && s3 <= 1e-9);
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
    regions: "Les contours se croisent : clique les zones à extruder (reclique pour en retirer une), puis Entrée.",
    place: "Clique sur la pièce pour poser la forme à cet endroit, puis Entrée. Tu peux aussi régler sa position à gauche.",
    slice: "Clique sur la pièce à l’endroit où couper, puis Entrée. Tu peux aussi taper la position à gauche.",
  };
  banner(texts[kind]);
  viewer.setPick({ kind: kind === "edges" ? "edge" : kind === "regions" ? "region" : "face", onPick: (hit) => onPick(hit) });
  requestBuild(0); renderProps(); refreshMarkers(); refreshHandles();
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
  st.pick = null; st.regions = null; viewer.setRegions(null); viewer.setPick(null); viewer.setGhost(null); banner(null); refreshMarkers(); refreshHandles();
  if (rebuild !== false) { requestBuild(0); renderProps(); }
}
function onPick(hit) {
  const f = feat(st.pick.featId); if (!f) return;
  const tol = viewer.size / 120;
  if (st.pick.kind === "slice") {
    const k = { x: 0, y: 1, z: 2 }[f.axis] ?? 2;
    mutate(() => { f.at = r2(hit.point[k]); }); renderProps(); renderOverlay(); return;
  }
  if (st.pick.kind === "place") {
    // la forme se pose au point cliqué, son axe suit la face (vers l'extérieur pour ajouter, vers l'intérieur pour creuser)
    let n = hit.info?.plane ? hit.info.n : hit.normal || [0, 0, 1];
    const toCam = viewer.camera.position.toArray().map((c, i) => c - hit.point[i]);
    if ((dot(n, toCam) < 0) !== (f.mode === "cut")) n = n.map((c) => -c);
    const [ry, rz] = normalAngles(n);
    mutate(() => { Object.assign(f, { x: r2(hit.point[0]), y: r2(hit.point[1]), z: r2(hit.point[2]), rx: "0", ry: r2(ry), rz: r2(rz) }); });
    renderProps(); return;
  }
  if (st.pick.kind === "regions") {
    const sk = feat(f.sketch); const pl = resolvePlane(sk.plane, varsMap(doc.params));
    const d = hit.point.map((c, i) => c - pl.origin[i]); const p = [round(dot(d, pl.x), 0.001), round(dot(d, pl.y), 0.001)];
    const sel = regionSel(f);
    mutate(() => {
      if (sel.includes(hit.region)) { // déjà choisie : on la retire
        const T = st.regions[hit.region]; const uv = (k) => { const q = [T[k] - pl.origin[0], T[k + 1] - pl.origin[1], T[k + 2] - pl.origin[2]]; return [dot(q, pl.x), dot(q, pl.y)]; };
        f.regions = f.regions.filter((q) => { for (let t = 0; t < T.length; t += 9) if (inTri([+q[0], +q[1]], uv(t), uv(t + 3), uv(t + 6))) return false; return true; });
        if (!f.regions.length) delete f.regions;
      } else (f.regions = f.regions || []).push(p);
    });
    viewer.setRegions(st.regions, regionSel(f)); renderProps(); return;
  }
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
  if (!text) { b.hidden = true; renderGestures(); return; }
  b.innerHTML = ""; b.append(h("span", {}, text), ...buttons.map(([l, fn], i) => h("button", { class: i ? "ghost" : "", onclick: fn }, l)));
  b.hidden = false; $("#gestes")?.remove();
}

// ---------- Arbre de construction ----------
function select(id) {
  if (id !== st.sel) closeDimCard();
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
  if (!doc.features.length) t.append(h("div", { class: "param-empty", style: "padding:10px 10px" }, isSimple() ? "Ta pièce est vide. Clique sur « Formes prêtes » en haut à gauche, ou sur « Dessiner »." : "Commence par une esquisse : clique sur « Esquisse » en haut à gauche."));
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

// Trous pour vis, diamètres courants en mm. pass : la vis passe librement (ISO 273, série moyenne) ; tap : la vis fait son filet
// dans le plastique (avant-trou) ; insert : insert à chaud en laiton ; head : logement d'une tête cylindrique [diamètre, profondeur] ;
// cone : diamètre d'une tête fraisée à 90°.
const SCREWS = {
  M2: { pass: 2.4, tap: 1.6, insert: 3.2, head: [4.3, 2.2], cone: 4 },
  "M2,5": { pass: 2.9, tap: 2.1, head: [5, 2.7], cone: 5 },
  M3: { pass: 3.4, tap: 2.5, insert: 4, head: [6, 3.2], cone: 6.8 },
  M4: { pass: 4.5, tap: 3.3, insert: 5.6, head: [7.5, 4.2], cone: 9 },
  M5: { pass: 5.5, tap: 4.2, insert: 6.4, head: [9, 5.2], cone: 11.2 },
  M6: { pass: 6.6, tap: 5, insert: 8, head: [10.5, 6.2], cone: 13.5 },
  M8: { pass: 9, tap: 6.8, head: [13.5, 8.2], cone: 18 },
};
const SCREW_USE = [["", "Diamètre libre"], ["pass", "Laisser passer une vis"], ["tap", "Visser dans le plastique"], ["insert", "Poser un insert à chaud"]];
// Met le trou aux bonnes cotes pour la vis choisie (f.fit, f.screw).
function applyScrew(f) {
  const sc = SCREWS[f.screw]; if (!f.fit || !sc?.[f.fit]) return;
  f.d = String(sc[f.fit]);
  if (f.fit === "pass" && f.kind === "lame") { f.d2 = String(sc.head[0]); f.depth2 = String(sc.head[1]); }
  if (f.fit === "pass" && f.kind === "fraise") { f.d2 = String(sc.cone); f.angle = "90"; }
}
function screwNote(f) {
  const sc = SCREWS[f.screw]; if (!f.fit || !sc?.[f.fit]) return null;
  const d = nf(sc[f.fit], 2);
  if (f.fit === "pass") return `La vis ${f.screw} passe librement dans un trou de ${d} mm.` + (f.kind === "lame" ? " Le logement cache une tête cylindrique." : f.kind === "fraise" ? " La fraisure reçoit une tête conique à 90°." : "");
  if (f.fit === "tap") return `La vis ${f.screw} fait son filet dans un trou de ${d} mm. Visse doucement la première fois.`;
  return `Insert ${f.screw} en laiton : trou de ${d} mm, valeur courante. Vérifie la fiche de tes inserts, et prévois un trou plus profond que l’insert d’au moins 1 mm.`;
}

// ---------- Panneau de réglages ----------
// Boutons − et + d'un champ : un clic change d'un cran, rester appuyé fait défiler les chiffres
// (de plus en plus vite). Le panneau peut être redessiné pendant qu'on reste appuyé : « live » retrouve le champ.
let stepRun = null;
function stopStep() { if (!stepRun) return; clearTimeout(stepRun.t1); clearInterval(stepRun.t2); const r = stepRun; stepRun = null; r.done(); }
addEventListener("pointerup", stopStep, true); addEventListener("pointercancel", stopStep, true); addEventListener("blur", stopStep);
function stepButtons(live, step, done) {
  const bump = (dir, e, k = 1) => {
    const input = live(); if (!input) return false;
    const n = Number(String(input.value).replace(",", ".")); if (!isFinite(n) || !String(input.value).trim()) return false;
    const stp = typeof step === "function" ? step() : step;
    input.value = String(Math.round((n + (e.shiftKey ? 10 : 1) * stp * dir * k) * 1000) / 1000); input.dispatchEvent(new Event("input")); return true;
  };
  const mk = (dir, text, title) => h("button", { type: "button", class: "stepb", tabindex: "-1", title, "aria-label": title, "data-step": dir > 0 ? "plus" : "minus",
    onpointerdown: (e) => {
      if (e.button !== 0) return; e.preventDefault(); stopStep();
      if (!bump(dir, e)) { toast("Ce champ contient une formule : change-la au clavier."); return; }
      const run = { done, n: 0 }; stepRun = run;
      run.t1 = setTimeout(() => { run.t2 = setInterval(() => { run.n++; bump(dir, e, run.n > 60 ? 10 : run.n > 25 ? 5 : 1); }, 90); }, 400);
    } }, text);
  return [mk(-1, "−", "Diminuer. Reste appuyé pour faire défiler les chiffres."), mk(1, "+", "Augmenter. Reste appuyé pour faire défiler les chiffres.")];
}
function exprField(label, obj, key, unit = "mm", opts = {}) {
  const v = varsMap(doc.params);
  const calc = h("div", { class: "calc" });
  const input = h("input", { type: "text", value: obj[key] ?? opts.def ?? "", spellcheck: "false", inputmode: "decimal", "data-hk": key });
  const stp = () => opts.step || (unit === "mm" ? pasMm() : 1); // les longueurs avancent du pas choisi
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
      e.preventDefault(); const s = (e.shiftKey ? 10 : 1) * stp() * (e.key === "ArrowUp" ? 1 : -1);
      input.value = String(Math.round((n + s) * 1000) / 1000); input.dispatchEvent(new Event("input")); pushHistory();
    }
  });
  check();
  const [less, more] = stepButtons(() => (input.isConnected ? input : input.closest ? document.querySelector(`#props [data-hk="${key}"]`) : null), stp, () => pushHistory());
  return h("div", { class: "field" }, h("label", {}, label), h("div", { class: "in" }, less, input, more, unit ? h("span", { class: "unit" }, unit) : null), calc);
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
  const ok = doc.features.slice(0, i).filter((x) => ["extrude", "revolve", "hole", "loft", "sweep", "import", "shape"].includes(x.type));
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
// Message d'erreur d'une étape, avec le ou les boutons qui la réparent.
const FIX_KEYS = { fillet: ["r", "mm"], chamfer: ["r", "mm"], shell: ["t", "mm"], draft: ["angle", "°"] };
function errorNote(f) {
  const msg = st.errors[f.id]; const btns = [];
  const B = (label, fn, id) => btns.push(h("button", { class: "btn", "data-fix": id, onclick: fn }, label));
  const fk = FIX_KEYS[f.type];
  if (fk && /noyau 3D|impossible/i.test(msg)) B("Trouver la plus grande valeur qui marche", () => findWorkingValue(f, fk[0], fk[1]), "value");
  if (/n’exist(e|ent) plus/.test(msg)) {
    if (f.type === "fillet" || f.type === "chamfer") B("Choisir les arêtes à nouveau", () => { mutate(() => { f.edges = []; }); startPick("edges", f.id); }, "pick");
    else if (f.type === "shell" || f.type === "draft") B("Choisir les faces à nouveau", () => { mutate(() => { f.faces = []; }); startPick("faces", f.id); }, "pick");
  }
  if (/aucun contour fermé/.test(msg) && f.sketch && feat(f.sketch)) B("Ouvrir l’esquisse", () => openSketch(f.sketch), "sketch");
  return h("div", { class: "note err" }, h("div", {}, msg), btns.length ? h("div", { class: "fixes" }, btns) : null);
}
// Cherche, avec le moteur 3D, la plus grande valeur du réglage « key » pour laquelle l'étape se calcule.
let fixBusy = false;
function findWorkingValue(f, key, unit) {
  if (fixBusy || !workerReady) return;
  let cur; try { cur = evalExpr(f[key], varsMap(doc.params)); } catch { cur = NaN; }
  if (!(cur > 0)) { toast("Écris d’abord une valeur plus grande que 0."); return; }
  fixBusy = true; toast("Je cherche la plus grande valeur qui marche…");
  const req = ++exportReq;
  pendingExport.set(req, (v) => {
    fixBusy = false;
    if (!feat(f.id)) return;
    if (!(v > 0)) { toast("Aucune valeur ne marche ici : le problème vient d’ailleurs (arêtes ou faces choisies, forme de la pièce)."); return; }
    mutate(() => { f[key] = String(v); }); renderProps();
    toast(`${nf(cur, 2)} ${unit} ne passait pas : valeur réglée à ${nf(v, 2)} ${unit}, la plus grande qui marche.`);
  });
  worker.postMessage({ type: "fix", req, doc, id: f.id, key, value: cur });
}
// Le panneau est redessiné après chaque calcul : on garde le champ en cours de saisie, le curseur et le défilement.
function renderProps() {
  const P = $("#props"); const act = document.activeElement; let keep = null;
  if (act && P.contains(act) && /^(INPUT|SELECT|TEXTAREA)$/.test(act.tagName)) {
    const all = [...P.querySelectorAll("input, select, textarea")];
    keep = { idx: all.indexOf(act), n: all.length, hk: act.dataset.hk || "", tag: act.tagName, s: null, e: null, top: P.scrollTop };
    try { keep.s = act.selectionStart; keep.e = act.selectionEnd; } catch { /* champ sans curseur */ }
  }
  const top = P.scrollTop;
  drawProps();
  if (top) P.scrollTop = top;
  if (!keep) return;
  const all = [...P.querySelectorAll("input, select, textarea")];
  let el = all.length === keep.n ? all[keep.idx] : null;
  if (el && (el.tagName !== keep.tag || (el.dataset.hk || "") !== keep.hk)) el = null;
  if (!el && keep.hk) { const same = all.filter((x) => x.dataset.hk === keep.hk && x.tagName === keep.tag); if (same.length === 1) el = same[0]; }
  if (!el) return;
  el.focus({ preventScroll: true });
  if (typeof keep.s === "number" && el.setSelectionRange) { try { el.setSelectionRange(keep.s, keep.e); } catch { /* type de champ sans sélection */ } }
}
function drawProps() {
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
    h("span", { class: "lbl" }, f.type === "shape" ? (SHAPES[f.kind] || SHAPES.box)[0] : typeLabel(f.type) || "")));
  const head = h("div", { class: "head" }, h("span", { class: "ic", html: ICONS[TYPES[f.type].icon] }),
    h("input", { value: f.name, "aria-label": "Nom de l’étape", onchange: (e) => { mutate(() => { f.name = e.target.value.trim() || f.name; }); } }));
  P.append(head);
  if (st.errors[f.id]) P.append(errorNote(f));
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
    const nz = (f.regions || []).length, picking = st.pick?.featId === f.id && st.pick.kind === "regions";
    add(h("div", { class: "field" }, h("label", {}, "Zones à extruder"), h("div", { class: "note" + (picking && !nz ? " err" : "") }, nz ? `${nz} zone(s) choisie(s).` : picking ? "Clique les zones dans la vue." : "Tous les contours.")));
    add(h("div", { class: "btnrow" },
      picking ? h("button", { class: "btn primary", title: "Entrée", onclick: () => stopPick(true) }, "C’est bon") : h("button", { class: "btn", onclick: () => startPick("regions", f.id) }, "Choisir les zones"),
      nz ? h("button", { class: "btn", onclick: () => { mutate(() => { delete f.regions; }); if (st.regions) viewer.setRegions(st.regions, []); renderProps(); } }, "Tous les contours") : null));
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
    const useSel = selectField("Ce trou sert à", f.fit || "", SCREW_USE, (v) => { mutate(() => { f.fit = v; if (v) { if (!SCREWS[f.screw]?.[v]) f.screw = "M3"; if (v !== "pass") f.kind = "simple"; applyScrew(f); } }); renderProps(); });
    useSel.querySelector("select").id = "holeUse"; add(useSel);
    if (f.fit) {
      const sizeSel = selectField("Vis", f.screw || "M3", Object.keys(SCREWS).filter((k) => SCREWS[k][f.fit]).map((k) => [k, k]), (v) => { mutate(() => { f.screw = v; applyScrew(f); }); renderProps(); });
      sizeSel.querySelector("select").id = "holeScrew"; add(sizeSel);
    }
    if (!f.fit || f.fit === "pass") add(h("div", { class: "field" }, h("label", {}, "Type de trou"), h("div", { class: "seg" },
      [["simple", "Simple"], ["lame", "Lamé"], ["fraise", "Fraisé"]].map(([val, text]) => h("button", { class: f.kind === val ? "on" : "", onclick: () => { mutate(() => { f.kind = val; applyScrew(f); }); renderProps(); } }, text)))));
    // une cote tapée à la main : le trou redevient « diamètre libre »
    const free = () => { if (f.fit) { f.fit = ""; const u = $("#holeUse"); if (u) u.value = ""; $("#holeScrew")?.closest(".field")?.remove(); $("#holeNote")?.remove(); } };
    add(exprField("Diamètre du trou", f, "d", "mm", { step: 0.5, after: free }));
    if (screwNote(f)) add(h("div", { class: "note", id: "holeNote" }, screwNote(f)));
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
  if (f.type === "shape") {
    const fields = (SHAPES[f.kind] || SHAPES.box)[2];
    const later = featIndex(f.id) > 0;
    const flip = () => { const a = Number(String(f.ry || 0).replace(",", ".")); if (isFinite(a)) f.ry = r2((((a + 180) % 360) + 360) % 360); };
    const cur = f.mode || "add";
    add(h("div", { class: "field" }, h("label", {}, "Effet"), h("div", { class: "seg" },
      [["add", "Ajouter de la matière"], ["cut", "Creuser"]].map(([v, t]) => h("button", { class: cur === v ? "on" : "", "data-mode": v, onclick: () => { if (cur === v) return; mutate(() => { f.mode = v; if (later) flip(); }); renderProps(); } }, t)))));
    if (cur === "cut" && !later) add(h("div", { class: "note err" }, "Il n’y a encore rien à creuser : pose d’abord une forme pleine."));
    if (f.kind === "text") add(h("div", { class: "field" }, h("label", {}, "Texte"), h("div", { class: "in" },
      h("input", { type: "text", value: f.txt ?? "", spellcheck: "false", "data-k": "txt", oninput: (e) => mutate(() => { f.txt = e.target.value; }, true), onchange: () => pushHistory() }))));
    add(h("h2", {}, "Taille"));
    for (const [key, label, unit] of fields) add(exprField(label, f, key, unit ?? "mm"));
    add(h("h2", {}, "Position"));
    add(exprField("X (gauche, droite)", f, "x", "mm", { def: "0" }), exprField("Y (avant, arrière)", f, "y", "mm", { def: "0" }), exprField("Z (hauteur)", f, "z", "mm", { def: "0" }));
    const picking = st.pick?.featId === f.id && st.pick.kind === "place";
    add(h("div", { class: "btnrow" },
      later && !picking ? h("button", { class: "btn primary", onclick: () => startPick("place", f.id) }, "Poser sur la pièce") : null,
      h("button", { class: "btn", title: "Tourne la forme de l’autre côté", onclick: () => { mutate(flip); renderProps(); } }, "Retourner")));
    if (picking) add(h("div", { class: "note ok" }, "Clique sur la pièce : la forme se pose à cet endroit."));
    add(h("h2", {}, "Rotation"), exprField("Autour de X", f, "rx", "°", { step: 15, def: "0" }), exprField("Autour de Y", f, "ry", "°", { step: 15, def: "0" }), exprField("Autour de Z", f, "rz", "°", { step: 15, def: "0" }));
  }
  if (f.type === "scale") {
    // le tableau de taille : un pourcentage, ou une des trois dimensions (les autres suivent)
    const bb = st.info?.[f.id]?.bb, d0 = bb ? [0, 1, 2].map((i) => bb[1][i] - bb[0][i]) : null;
    add(h("div", { class: "note" }, "Toute la pièce grandit ou rétrécit, en gardant ses proportions. Tape un pourcentage ou une dimension : le reste suit."));
    const fields = {}; const kNow = () => { try { const v = evalExpr(f.k === undefined || f.k === "" ? 100 : f.k, vars); return v > 0 ? v : 100; } catch { return 100; } };
    const sync = (skip) => { const k = kNow(); const vals = { pct: k - 100, x: d0 ? d0[0] * k / 100 : 0, y: d0 ? d0[1] * k / 100 : 0, z: d0 ? d0[2] * k / 100 : 0 }; for (const [kk, inp] of Object.entries(fields)) if (kk !== skip) { inp.value = String(Math.round(vals[kk] * 100) / 100); inp.classList.remove("bad"); } };
    const mk = (kk, label, unit, step) => {
      const input = h("input", { type: "text", inputmode: "decimal", spellcheck: "false", autocomplete: "off", "data-sf": kk });
      input.addEventListener("input", () => {
        const v = Number(input.value.replace(",", ".")), i = "xyz".indexOf(kk), k = kk === "pct" ? 100 + v : d0 && d0[i] > 1e-9 ? v / d0[i] * 100 : NaN;
        const good = input.value.trim() !== "" && isFinite(k) && k > 0.5 && k < 100000; input.classList.toggle("bad", !good); if (!good) return;
        mutate(() => { f.k = String(Math.round(k * 1000) / 1000); }, true); sync(kk);
      });
      input.addEventListener("change", () => pushHistory());
      fields[kk] = input;
      const [less, more] = stepButtons(() => (input.isConnected ? input : document.querySelector(`#props [data-sf="${kk}"]`)), unit === "mm" ? pasMm : step, () => pushHistory());
      return h("div", { class: "field" }, h("label", {}, label), h("div", { class: "in" }, less, input, more, h("span", { class: "unit" }, unit)));
    };
    add(mk("pct", "Agrandir de (négatif pour réduire)", "%", 5));
    if (d0) add(h("h2", {}, "Ou donne une dimension"), mk("x", "Longueur (X)", "mm", 1), mk("y", "Largeur (Y)", "mm", 1), mk("z", "Hauteur (Z)", "mm", 1));
    sync();
    add(h("div", { class: "note" }, "Pour changer un seul sens, ou seulement une partie de la pièce (une tige, un pied, le milieu) :"),
      h("div", { class: "btnrow" }, h("button", { class: "btn", "data-size": "stretch", onclick: () => { validateFeature(); toolAction("stretch"); } }, "Allonger une partie")));
  }
  if (f.type === "orient") {
    // le sens de pose : des gestes en mots simples, qui s'ajoutent les uns aux autres
    const m = oread(f.m);
    add(h("div", { class: "note" }, "Tourne toute la pièce, couche-la ou retourne-la. Chaque clic s’ajoute au précédent, et la pièce reste posée au même endroit."));
    const go = (key, label, title) => h("button", { class: "btn", "data-turn": key, title, onclick: () => { mutate(() => { f.m = key ? omul(MOVES[key], oread(f.m)) : [...IDENT]; }); renderProps(); } }, label);
    add(h("h2", {}, "Tourner à plat"), h("div", { class: "btnrow turns" }, go("gauche", "Quart de tour à gauche", "90° vers la gauche, vue de dessus"), go("droite", "Quart de tour à droite", "90° vers la droite, vue de dessus"), go("demi", "Demi-tour", "180° : l’avant passe derrière")));
    add(h("h2", {}, "Coucher ou retourner"), h("div", { class: "btnrow turns" }, go("cote", "Coucher sur le côté", "Bascule de 90° vers la droite : la pièce repose sur son flanc"), go("avant", "Coucher vers l’avant", "Bascule de 90° vers l’avant : la pièce repose sur sa face avant"), go("envers", "Tête en bas", "Le dessus passe dessous")));
    add(h("h2", {}, "Miroir"), h("div", { class: "btnrow turns" }, go("miroir", "Miroir", "Inverse la gauche et la droite, comme dans un miroir : pratique pour faire la pièce symétrique d’une autre")));
    add(h("div", { class: "note" + (osame(m, IDENT) ? "" : " ok"), "data-turn-state": "" }, osame(m, IDENT) ? "La pièce est dans le sens où elle a été dessinée." : odet(m) < 0 ? "La pièce est tournée et vue dans un miroir." : "La pièce est tournée."));
    if (!osame(m, IDENT)) add(h("div", { class: "btnrow" }, go("", "Remettre droit", "Annule tous ces changements de sens")));
  }
  if (f.type === "fit") {
    // le remplissage : une taille visée par sens, vide = ce sens n'est pas étiré
    add(h("div", { class: "note" }, "La pièce est étirée, sens par sens, jusqu’à la taille donnée. Une case vide : ce sens garde sa taille. Le plus simple est de régler ça dans « Dans un meuble », onglet « Taille et remplissage »."));
    const mk = (a, label) => {
      const input = h("input", { type: "text", inputmode: "decimal", spellcheck: "false", autocomplete: "off", "data-ff": a, value: f[a] === null || f[a] === undefined ? "" : String(f[a]).replace(".", ",") });
      input.addEventListener("input", () => {
        const raw = input.value.trim(), v = Number(raw.replace(",", ".")); const good = raw === "" || (isFinite(v) && v > 0.01 && v < 100000); input.classList.toggle("bad", !good); if (!good) return;
        mutate(() => { f[a] = raw === "" ? null : String(Math.round(v * 1000) / 1000); }, true);
      });
      input.addEventListener("change", () => pushHistory());
      const [less, more] = stepButtons(() => (input.isConnected ? input : document.querySelector(`#props [data-ff="${a}"]`)), pasMm, () => pushHistory());
      return h("div", { class: "field" }, h("label", {}, label), h("div", { class: "in" }, less, input, more, h("span", { class: "unit" }, "mm")));
    };
    add(mk("x", "Largeur (X)"), mk("y", "Profondeur (Y)"), mk("z", "Hauteur (Z)"));
    add(h("div", { class: "note" }, "Après cette étape, les formes rondes deviennent de petites facettes très fines."));
  }
  if (f.type === "stretch") {
    const zs = f.zones || [], nums = zoneNums(f), cur = Math.min(st.zoneSel ?? zs.length - 1, zs.length - 1);
    zoneSyncFn = null;
    add(h("div", { class: "note" }, "Choisis une partie de la pièce entre deux traits, puis donne-lui sa taille. Ce qui est avant et après garde sa forme."));
    if (!zs.length) add(h("div", { class: "btnrow" }, h("button", { class: "btn primary", "data-zone": "pick", onclick: () => pickStretch(f) }, "Poser les deux traits sur la pièce")));
    zs.forEach((z, i) => {
      const n = nums[i], len = n ? n.b - n.a : 0, title = `Partie ${i + 1}, ${AX_WORD[z.axis] || AX_WORD.z}`;
      if (i !== cur) {
        add(h("button", { class: "zrow", "data-zone-row": i, title: "Régler cette partie", onclick: () => { st.zoneSel = i; renderProps(); renderOverlay(); } }, h("b", {}, title), h("span", {}, n ? `${nf(len, 1)} mm → ${nf(len + n.add, 1)} mm` : "à régler")));
        return;
      }
      const card = h("div", { class: "zcard", "data-zone-card": i });
      card.append(h("div", { class: "zt" }, h("b", {}, title), h("button", { class: "x", title: "Retirer cette partie", "aria-label": "Retirer cette partie", onclick: () => { mutate(() => { f.zones.splice(i, 1); }); st.zoneSel = Math.max(0, i - 1); renderProps(); renderOverlay(); } }, "✕")));
      if (n) {
        // trois façons de dire la même chose : la nouvelle taille, ce qu'on ajoute, ou un pourcentage
        const fields = {};
        const sync = (skip) => {
          let a = 0; try { a = evalExpr(z.add || 0, vars); } catch { a = 0; }
          const vals = { size: len + a, add: a, pct: a / len * 100 };
          for (const [kk, inp] of Object.entries(fields)) if (kk !== skip && inp !== document.activeElement) { inp.value = String(Math.round(vals[kk] * 100) / 100); inp.classList.remove("bad"); }
        };
        const mk = (kk, label, unit, step) => {
          const input = h("input", { type: "text", inputmode: "decimal", spellcheck: "false", autocomplete: "off", "data-zf": kk });
          input.addEventListener("input", () => {
            const v = Number(input.value.replace(",", ".")), a = kk === "size" ? v - len : kk === "pct" ? len * v / 100 : v;
            const good = input.value.trim() !== "" && isFinite(v) && a > -len + 0.01; input.classList.toggle("bad", !good); if (!good) return;
            mutate(() => { z.add = String(Math.round(a * 1000) / 1000); }, true); sync(kk); renderOverlay();
          });
          input.addEventListener("change", () => pushHistory());
          fields[kk] = input;
          const [less, more] = stepButtons(() => (input.isConnected ? input : document.querySelector(`#props [data-zf="${kk}"]`)), unit === "mm" ? pasMm : step, () => pushHistory());
          return h("div", { class: "field" }, h("label", {}, label), h("div", { class: "in" }, less, input, more, h("span", { class: "unit" }, unit)));
        };
        card.append(mk("size", `Nouvelle taille de cette partie (au départ ${nf(len, 1)} mm)`, "mm", 1), mk("add", "Soit, en plus (négatif pour raccourcir)", "mm", 1), mk("pct", "Ou en pourcentage", "%", 5));
        sync(); zoneSyncFn = () => sync();
        card.append(h("div", { class: "zpos" }, `Entre ${nf(n.a, 1)} et ${nf(n.b, 1)} mm, ${AX_WORD[z.axis] || AX_WORD.z}.`));
      } else card.append(h("div", { class: "note warn" }, "Cette partie est mal réglée : repose ses deux traits."));
      card.append(h("div", { class: "btnrow" }, h("button", { class: "btn", "data-zone": "again", onclick: () => pickStretch(f, i) }, "Reposer les deux traits")));
      add(card);
    });
    if (zs.length) {
      add(h("div", { class: "btnrow" }, h("button", { class: "btn primary", "data-zone": "more", onclick: () => pickStretch(f) }, "+ Allonger une autre partie")));
      add(h("div", { class: "note" }, "Dans la vue, tire la flèche orange pour allonger ou raccourcir : aucune touche à tenir, et Maj pour un réglage plus fin."));
      add(h("div", { class: "note" }, "À faire plutôt vers la fin : après cette étape la pièce devient un maillage fin, les arrondis et les perçages y marchent moins bien."));
    }
  }
  if (f.type === "slice") {
    const ax = f.axis || "z";
    add(h("div", { class: "field" }, h("label", {}, "Sens de la coupe"), h("div", { class: "seg" },
      [["z", "À l’horizontale"], ["x", "En travers"], ["y", "En long"]].map(([v, t]) => h("button", { class: ax === v ? "on" : "", "data-axis": v, onclick: () => {
        if (ax === v) return; const bb = st.info?.[f.id]?.bb; const k = "xyz".indexOf(v);
        mutate(() => { f.axis = v; if (bb) f.at = r2((bb[0][k] + bb[1][k]) / 2); }); renderProps(); renderOverlay();
      } }, t)))));
    add(exprField({ z: "Hauteur de la coupe (Z)", x: "Position de la coupe (X)", y: "Position de la coupe (Y)" }[ax], f, "at", "mm", { def: "0", after: () => renderOverlay() }));
    const sides = { z: ["Le bas", "Le haut"], x: ["La gauche", "La droite"], y: ["L’avant", "L’arrière"] }[ax];
    add(h("div", { class: "field" }, h("label", {}, "Je garde"), h("div", { class: "seg" },
      [["below", sides[0]], ["above", sides[1]]].map(([v, t]) => h("button", { class: (f.keep || "below") === v ? "on" : "", "data-keep": v, onclick: () => { mutate(() => { f.keep = v; }); renderProps(); } }, t)))));
    const picking = st.pick?.featId === f.id && st.pick.kind === "slice";
    if (picking) add(h("div", { class: "note ok" }, "Clique sur la pièce : la coupe se met à cet endroit."));
    else add(h("div", { class: "btnrow" }, h("button", { class: "btn primary", onclick: () => startPick("slice", f.id) }, "Choisir sur la pièce")));
  }
  if (f.type === "import") {
    add(h("div", { class: "note" }, `Fichier : ${f.file || "?"} (${(f.format || "").toUpperCase()}, ${nf((f.data || "").length * 0.75 / 1024, 0)} Ko)`));
    add(segField("Effet", f, "mode", [["add", "Ajouter"], ["cut", "Enlever"]]));
    // Taille réelle, réglable dans chaque direction (pour allonger ou épaissir un modèle téléchargé)
    const box = impBox(f);
    if (box && f.format === "stl") {
      const sc = Number(String(f.scale || 1).replace(",", ".")) || 1;
      const k = (a) => Number(String(f[a] ?? 1).replace(",", ".")) || 1;
      const AX = [["sx", "Longueur (X)", 0], ["sy", "Largeur (Y)", 1], ["sz", "Hauteur (Z)", 2]];
      add(h("h2", {}, "Taille"));
      for (const [key, label, i] of AX) {
        const cur = box[i] * sc * k(key);
        add(h("div", { class: "field" }, h("label", {}, label), h("div", { class: "in" },
          h("input", { type: "text", inputmode: "decimal", value: String(Math.round(cur * 100) / 100).replace(".", ","), "data-size": key,
            onchange: (e) => {
              const val = Number(String(e.target.value).replace(",", ".")); if (!(val > 0)) return;
              const r = val / (box[i] * sc);
              mutate(() => {
                if (f.keep) { const ratio = r / k(key); for (const [o] of AX) f[o] = String(Math.round(k(o) * ratio * 1e5) / 1e5); }
                else f[key] = String(Math.round(r * 1e5) / 1e5);
              });
              renderProps();
            } }), h("span", { class: "unit" }, "mm"),
h("span", { class: "unit pct" }, `${Math.round(k(key) * sc * 100)} %`))));
      }
      add(checkField("Garder les proportions", f, "keep"));
      if (["sx", "sy", "sz"].some((a) => k(a) !== 1) || sc !== 1) add(h("div", { class: "btnrow" }, h("button", { class: "btn", onclick: () => { mutate(() => { delete f.sx; delete f.sy; delete f.sz; f.scale = "1"; }); renderProps(); } }, "Taille d’origine")));
    } else add(exprField("Échelle", f, "scale", "×", { step: 0.1 }));
    if (f.format === "stl") {
      add(h("h2", {}, "Allonger une partie"));
      const ibb = st.info?.[f.id]?.bb;
      if (!f.zone) {
        add(h("div", { class: "note" }, "Pour rallonger une tige, un pied ou le milieu d’un objet sans déformer le reste : choisis la partie entre deux traits, puis donne-lui sa taille."));
        add(h("div", { class: "btnrow" }, h("button", { class: "btn primary", "data-zone": "tool", onclick: () => toolAction("stretch") }, "Allonger une partie")));
      } else {
        const z = f.zone; const edge = { x: "du bord gauche", y: "du bord avant", z: "du bas" }[z.axis] || "du bord";
        add(h("div", { class: "field" }, h("label", {}, "Dans quel sens"), h("div", { class: "seg" },
          [["x", "Longueur (X)"], ["y", "Largeur (Y)"], ["z", "Hauteur (Z)"]].map(([v, t]) => h("button", { class: z.axis === v ? "on" : "", "data-zaxis": v, onclick: () => {
            if (z.axis === v) return; const k = "xyz".indexOf(v); const len = ibb ? ibb[1][k] - ibb[0][k] - (z.axis === v ? Number(z.add) || 0 : 0) : 30;
            mutate(() => { z.axis = v; z.a = r2(len * 0.4); z.b = r2(len * 0.6); }); renderProps(); renderOverlay();
          } }, t)))));
        const aft = { after: () => renderOverlay() };
        add(exprField(`Début de la zone (à partir ${edge})`, z, "a", "mm", aft), exprField("Fin de la zone", z, "b", "mm", aft), exprField("Allonger de (négatif pour raccourcir)", z, "add", "mm", { def: "0", ...aft }));
        add(h("div", { class: "btnrow" },
          h("button", { class: "btn primary", onclick: () => pickZone(f) }, "Choisir sur la pièce"),
          h("button", { class: "btn", "data-zone": "remove", onclick: () => { mutate(() => { delete f.zone; }); renderProps(); renderOverlay(); } }, "Retirer la zone")));
        add(h("div", { class: "note" }, "Seule la partie entre les deux plans s’étire. Ce qui est avant et après garde sa forme."));
      }
    }
    add(h("h2", {}, "Rotation"), exprField("Autour de X", f, "rx", "°", { step: 90, def: "0" }), exprField("Autour de Y", f, "ry", "°", { step: 90, def: "0" }), exprField("Autour de Z", f, "rz", "°", { step: 90, def: "0" }));
    add(h("h2", {}, "Position"), exprField("Déplacement X", f, "tx"), exprField("Déplacement Y", f, "ty"), exprField("Déplacement Z", f, "tz"));
    if (f.format === "stl") add(h("div", { class: "note" }, "Un STL est un maillage : les congés et perçages fonctionnent mal dessus. Préfère le STEP quand tu l’as."));
  }
  if (f.type !== "sketch") add(h("div", { class: "note" }, "Tout s’applique en direct. Entrée ou ✓ pour valider, Échap ou ✕ pour annuler."));
  add(h("div", { class: "btnrow", style: "margin-top:6px" },
    h("button", { class: "btn danger", onclick: () => deleteFeature(f.id) }, "Supprimer"),
    h("button", { class: "btn ghost", title: "Met l’étape en pause sans la supprimer (pour comparer avec et sans)", onclick: () => mutate(() => { f.suppressed = !f.suppressed; }) || renderProps() }, f.suppressed ? "Réactiver" : "Mettre en pause")));
  void vars;
  if (isSimple()) plainify(P);
}

// ---------- Parties allongées ----------
const AX_WORD = { x: "en longueur (X)", y: "en largeur (Y)", z: "en hauteur (Z)" };
let zoneSyncFn = null; // remet à jour les trois champs de la partie réglée (pendant qu'on tire la flèche)
// Les zones de l'étape en chiffres : { k, a, b, add }, ou null pour une zone incomplète.
function zoneNums(f) {
  const vars = varsMap(doc.params);
  return (f.zones || []).map((z) => {
    try { const a = evalExpr(z.a ?? 0, vars), b = evalExpr(z.b ?? 0, vars), add = evalExpr(z.add || 0, vars), k = "xyz".indexOf(z.axis); return [a, b, add].every(isFinite) && b > a + 0.01 && add > -(b - a) ? { k: k < 0 ? 2 : k, a, b, add } : null; } catch { return null; }
  });
}
// Deux clics sur la pièce posent les deux traits. Le sens est celui où les deux clics sont le plus éloignés.
function pickStretch(f, zi) {
  if (st.pick) stopPick(false);
  const pts = [];
  banner("1 sur 2 : clique sur la pièce, là où commence la partie à allonger.");
  viewer.setPick({ kind: "face", onPick: (hit) => {
    if (!feat(f.id)) { viewer.setPick(null); banner(null); return; }
    pts.push(hit.point);
    if (pts.length === 1) { banner("2 sur 2 : clique maintenant là où elle finit. Seul ce qui est entre tes deux clics changera de taille."); viewer.setMarkers([hit.point], 0x2f6fb5); return; }
    viewer.setPick(null); banner(null); refreshMarkers();
    const d = [0, 1, 2].map((i) => Math.abs(pts[1][i] - pts[0][i])), k = d.indexOf(Math.max(...d));
    if (d[k] < 0.05) { toast("Les deux clics sont au même endroit : recommence en cliquant plus loin."); return; }
    // la pièce affichée est déjà allongée : on revient aux positions d'avant
    const un = zoneUnmap(zoneNums(f).filter(Boolean), k);
    const a = un(Math.min(pts[0][k], pts[1][k])), b = un(Math.max(pts[0][k], pts[1][k]));
    mutate(() => {
      if (zi !== undefined && f.zones?.[zi]) { const z = f.zones[zi]; Object.assign(z, { axis: "xyz"[k], a: r2(a), b: r2(b) }); if (!((Number(z.add) || 0) > -(b - a) + 0.01)) z.add = "0"; st.zoneSel = zi; }
      else { f.zones = [...(f.zones || []), { axis: "xyz"[k], a: r2(a), b: r2(b), add: "0" }]; st.zoneSel = f.zones.length - 1; }
    });
    renderProps(); renderOverlay();
    toast("Partie choisie. Tire la flèche orange, ou tape sa nouvelle taille à gauche.");
  } });
}

// Zone à allonger : deux clics sur la pièce donnent son début et sa fin.
function pickZone(f) {
  const pts = [];
  banner("Clique sur la pièce au début de la zone à allonger.");
  viewer.setPick({ kind: "face", onPick: (hit) => {
    const z = f.zone, bb = st.info?.[f.id]?.bb; if (!z || !bb) { viewer.setPick(null); banner(null); return; }
    const k = "xyz".indexOf(z.axis); const num = (v) => Number(String(v ?? 0).replace(",", ".")) || 0;
    const a = num(z.a), b = num(z.b), ad = num(z.add);
    let u = hit.point[k] - bb[0][k];
    if (ad && b > a && u > a) u = u >= b + ad ? u - ad : a + (u - a) * (b - a) / (b - a + ad); // on défait l'allongement déjà appliqué
    pts.push(Math.max(0, u));
    if (pts.length === 1) { banner("Clique maintenant à la fin de la zone."); viewer.setMarkers([hit.point], 0x2f6fb5); return; }
    viewer.setPick(null); banner(null); refreshMarkers();
    const lo = Math.min(...pts), hi = Math.max(...pts);
    if (hi - lo < 0.05) { toast("Les deux clics sont au même endroit : recommence en cliquant plus loin."); return; }
    mutate(() => { z.a = r2(lo); z.b = r2(hi); }); renderProps(); renderOverlay();
  } });
}

// Dimensions d'origine d'un STL importé (lues une fois dans le fichier).
const impBoxes = new Map();
function impBox(f) {
  if (f.format !== "stl" || !f.data) return null;
  const key = f.id + ":" + f.data.length; if (impBoxes.has(key)) return impBoxes.get(key);
  let box = null;
  try {
    const bin = atob(f.data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const t = readStl(u8); const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < t.length; i += 3) for (let c = 0; c < 3; c++) { if (t[i + c] < lo[c]) lo[c] = t[i + c]; if (t[i + c] > hi[c]) hi[c] = t[i + c]; }
    box = [0, 1, 2].map((c) => hi[c] - lo[c]);
  } catch { box = null; }
  impBoxes.set(key, box); return box;
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
// Contraintes possibles pour la sélection en cours : [type, références, libellé].
function constraintChoices(subs) {
  const segs = subs.filter((r) => r.kind === "seg"), pts = subs.filter((r) => r.kind === "pt"), circs = subs.filter((r) => r.kind === "circ");
  const ch = [];
  const B = (type, refs, label) => ch.push([type, refs, label || C_LABELS[type]]);
  if (segs.length === 1 && !pts.length && !circs.length) { B("horizontal", segs); B("vertical", segs); B("length", segs, "Cote de longueur"); }
  if (segs.length === 2 && !pts.length) {
    B("parallel", segs); B("perpendicular", segs); B("equal", segs, "Même longueur");
    if (segs[0].e === segs[1].e) B("tangent", segs);
  }
  if (circs.length === 1 && subs.length === 1) B("diameter", circs, "Cote de diamètre");
  if (circs.length === 2 && subs.length === 2) { B("equal", circs, "Même diamètre"); B("coincident", circs.map((c) => ({ e: c.e, k: "c", kind: "pt" })), "Concentriques"); }
  if (pts.length === 1 && subs.length === 1 && pts[0].e !== "origin") { B("fix", pts); B("onH", pts); B("onV", pts); B("coincident", [pts[0], { e: "origin", kind: "pt" }], "Sur l’origine"); }
  if (pts.length === 2 && subs.length === 2) { B("coincident", pts); B("distance", pts, "Cote de distance"); B("hAlign", pts); B("vAlign", pts); B("symV", pts); B("symH", pts); }
  if (pts.length === 1 && segs.length === 1 && subs.length === 2) { B("midpoint", [pts[0], segs[0]], "Au milieu du côté"); B("onLine", [pts[0], segs[0]], "Sur le côté"); }
  if (pts.length === 1 && circs.length === 1 && subs.length === 2) { B("coincident", [pts[0], { e: circs[0].e, k: "c", kind: "pt" }], "Au centre du cercle"); B("onCircle", [pts[0], circs[0]], "Sur le cercle"); }
  if (segs.length === 1 && circs.length === 1 && subs.length === 2) B("tangent", [segs[0], circs[0]], "Tangent");
  return ch;
}
// Petite fenêtre près du pointeur : les contraintes possibles pour ce qui est choisi (Ctrl+clic pour en ajouter).
function relBox(e, show) {
  $("#relBox")?.remove();
  if (!show || !e || !st.editSketch || sketcher.tool !== "select") return;
  const ch = constraintChoices(sketcher.subs || []).filter(([t]) => C_LABELS[t]); if (!ch.length) return;
  const sk = $("#sketch"), host = sk.getBoundingClientRect();
  const box = h("div", { id: "relBox", class: "rel-box", onpointerdown: (ev) => ev.stopPropagation() },
    h("div", { class: "t" }, sketcher.subs.length > 1 ? "Relier ces éléments" : "Contraindre"),
    ...ch.map(([t, refs, l]) => h("button", { onclick: () => { addConstraint(t, refs); $("#relBox")?.remove(); } }, h("b", {}, C_GLYPH[t]), fr(l))),
    sketcher.subs.length < 2 ? h("div", { class: "tip" }, fr("Ctrl+clic sur un autre élément pour les relier.")) : null);
  sk.append(box);
  const bw = box.offsetWidth, bh = box.offsetHeight;
  box.style.left = Math.max(4, Math.min(host.width - bw - 4, e.clientX - host.left + 16)) + "px";
  box.style.top = Math.max(4, Math.min(host.height - bh - 30, e.clientY - host.top + 16)) + "px";
}
function constraintPanel(f) {
  const out = [];
  const subs = sketcher.subs || [];
  const btns = constraintChoices(subs).filter(([t]) => C_LABELS[t]).map(([type, refs, label]) => h("button", { class: "btn", title: C_LABELS[type], onclick: () => addConstraint(type, refs) }, h("b", { style: "color:#7a3fd1" }, C_GLYPH[type] + " "), label));
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
const SK_TOOLS = [["select", "Choisir"], ["line", "Ligne"], ["rect", "Rectangle"], ["circle", "Cercle"], ["slot", "Rainure"], ["polygon", "Polygone"], ["ellipse", "Ellipse"], ["poly", "Contour libre"], ["spline", "Courbe"], ["path", "Chemin"], ["text", "Texte"], ["trim", "Ajuster"], ["fillet", "Congé"], ["convert", "Reprendre"]];
// Façons de tracer un rectangle ou un cercle (le bouton reprend la dernière choisie).
const SK_FAM = {
  rect: [["rect", "Coin à coin"], ["rectc", "Depuis le centre"], ["rect3", "3 points (incliné)"]],
  circle: [["circle", "Centre et bord"], ["circle3", "3 points"]],
};
const famOf = (t) => Object.keys(SK_FAM).find((k) => SK_FAM[k].some(([x]) => x === t));
const skMode = { rect: "rect", circle: "circle" };
const SK_ALL = SK_TOOLS.flatMap(([k, l]) => SK_FAM[k] ? SK_FAM[k].map(([v, vl]) => [v, `${l} : ${vl.toLowerCase()}`]) : [[k, l]]);
const SK_HINTS = {
  line: "Clique le début puis chaque point : les traits s’enchaînent. Reclique sur le premier point pour fermer le contour. Double-clic, Entrée ou Échap : finir la ligne. Un rond orange signale un bout de trait qui ne touche rien ; une zone bien fermée se colore.",
  rectc: "Clique au centre, puis à un coin.",
  rect3: "Clique les deux bouts d’un côté, puis un troisième point pour la largeur.",
  circle3: "Clique trois points par lesquels le cercle doit passer.",
  select: "Tire une forme pour la déplacer, tire un de ses points pour la déformer : aucune touche à tenir. Clique sur une forme pour régler ses cotes à gauche ; Ctrl+clic sur une autre pour voir les contraintes possibles. Échap : tout désélectionner. Clic droit maintenu : déplacer la vue, molette : zoomer.",
  rect: "Glisse d’un coin à l’autre (ou clique deux fois). Maj : sans accroche.",
  circle: "Clique au centre, puis au bord. Les centres des trous de la pièce (petites croix) servent d’accroche.",
  slot: "Clique au premier centre, puis au second. Règle la largeur à droite.",
  polygon: "Clique au centre, puis sur un sommet.",
  poly: "Clique chaque point. Pour fermer : reclique sur le premier point, double-clique, ou Entrée. Ensuite, tire le rond au milieu d’un côté pour le courber en arc.",
  text: "Clique où le texte doit commencer, puis tape-le à droite. Dans un contour, il est gravé à travers ; seul, il donne des lettres en relief.",
  ellipse: "Clique au centre, puis au coin du rectangle qui l’entoure.",
  spline: "Courbe lisse qui passe par chaque point cliqué. Reclique sur le premier point pour la fermer, ou double-clique (Entrée) pour la laisser ouverte, par exemple pour un balayage.",
  path: "Chemin ouvert pour un balayage : clique chaque point, puis double-clique ou Entrée pour finir.",
  convert: "Clique sur une arête de la pièce (en pointillé) pour la reprendre dans l’esquisse. Les arêtes qui se touchent se raccordent ; un tour fermé devient un contour qu’on peut extruder.",
  trim: "Passe sur un trait : le morceau en rouge, entre deux croisements, est celui qui sera retiré. Clique pour le couper. Un trait qui ne croise rien est retiré en entier.",
  fillet: "Règle le rayon à gauche, puis clique sur un coin entre deux traits droits. Le rayon reste modifiable ensuite, dans la liste des points. Rayon 0 : le coin redevient vif.",
};
let sketcher;
function openSketch(id, isNew = false) {
  meuble?.close(); if (extras?.isPrintOpen()) extras.closePrint(); // la pièce reprend sa place avant de dessiner dessus
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
// Centre d'une polyligne posée sur un cercle (au moins 5 points, écart < 1 %), sinon null.
function arcCenter(P) {
  if (P.length < 5) return null;
  const a = P[0], b = P[Math.floor(P.length / 2)], c = P.at(-1);
  const closed = Math.hypot(a[0] - c[0], a[1] - c[1]) < 1e-6;
  const k = circle3(a, closed ? P[Math.floor(P.length / 3)] : b, closed ? P[Math.floor(2 * P.length / 3)] : c);
  if (!k || k[2] < 1e-3) return null;
  for (const p of P) if (Math.abs(Math.hypot(p[0] - k[0], p[1] - k[1]) - k[2]) > k[2] * 0.01 + 1e-4) return null;
  return [k[0], k[1]];
}
function updateSketchRefs() {
  const f = feat(st.editSketch); if (!f || !sketcher) return;
  let pl; try { pl = resolvePlane(f.plane, varsMap(doc.params)); } catch { return; }
  st.skPlane = pl;
  const lines = [], pts = [], edges = [], centers = [];
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
      // arête circulaire (cercle entier ou arc) à plat : son centre sert d'accroche
      const ctr = flat && arcCenter(clean); if (ctr) { const k = [round(ctr[0], 0.001), round(ctr[1], 0.001)]; if (!centers.some((c) => Math.hypot(c[0] - k[0], c[1] - k[1]) < 1e-3)) { centers.push(k); addPt(k); } }
    }
  }
  sketcher.refs = { lines, pts, edges, centers };
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
  const cur = sketcher.tool, curFam = famOf(cur);
  for (const [k, label] of SK_TOOLS) {
    const fam = SK_FAM[k] ? k : null, on = fam ? curFam === fam : cur === k;
    const go = fam ? skMode[fam] : k;
    box.append(h("button", { class: "tbtn" + (on ? " on" : ""), "data-sk": k, title: on && k !== "select" ? "Reclique (ou Échap) pour arrêter de tracer" : label, onclick: () => sketcher.setTool(on && k !== "select" ? "select" : go) }, h("span", { html: ICONS[fam ? go : k] }), label));
  }
  $("#skMethod")?.remove();
  if (curFam) {
    skMode[curFam] = cur;
    $("#sketch").append(h("div", { id: "skMethod", class: "sk-method" }, ...SK_FAM[curFam].map(([v, l]) =>
      h("button", { class: v === cur ? "on" : "", "data-m": v, onclick: () => sketcher.setTool(v) }, h("span", { html: ICONS[v] }), l))));
  }
  box.append(h("hr"), h("label", {}, "Pas de grille"),
    h("select", { id: "skPas", title: "Taille des carreaux : les points se posent sur ce pas", onchange: (e) => setPas(Number(e.target.value)) }, [...new Set([...PAS, 2])].sort((a, b) => a - b).map((v) => h("option", { value: v, selected: v === sketcher.snapStep }, pasText(v)))),
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
  const fam = famOf(sketcher.tool);
  if (fam) {
    P.append(h("h2", {}, fam === "rect" ? "Type de rectangle" : "Type de cercle"),
      h("div", { class: "skm-list" }, ...SK_FAM[fam].map(([v, l]) => h("button", { class: "skm" + (sketcher.tool === v ? " on" : ""), "data-m": v, onclick: () => sketcher.setTool(v) }, h("span", { html: ICONS[v] }), l))));
  }
  if (sketcher.tool === "fillet") {
    const inp = h("input", { type: "text", id: "filletR", value: String(sketcher.filletR ?? 2).replace(".", ","), inputmode: "decimal", spellcheck: "false",
      oninput: (ev) => { const v = Number(ev.target.value.replace(",", ".")); const bad = !(v >= 0); ev.target.classList.toggle("bad", bad); if (!bad) sketcher.filletR = v; } });
    P.append(h("h2", {}, "Congé"), h("div", { class: "field" }, h("label", {}, "Rayon du congé"), h("div", { class: "in" }, inp, h("span", { class: "unit" }, "mm"))),
      h("div", { class: "note" }, "Clique sur un coin du dessin pour l’arrondir. Avec 0, le coin cliqué redevient vif."));
  }
  if (sketcher.tool === "trim") P.append(h("h2", {}, "Ajuster"), h("div", { class: "note" }, "Le morceau en rouge sous le pointeur est retiré au clic. Les formes coupées deviennent des traits : une zone se ferme dès que les traits se rejoignent."));
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
      P.append(h("h2", {}, e.type === "spline" ? "Points de passage (X, Y)" : "Points (X, Y, flèche de l’arc, rayon du coin)"));
      const box = h("div", { class: "pts" });
      e.pts.forEach((p, i) => {
        const mk = (j) => h("input", { value: p[j], "aria-label": j ? "Y" : "X", oninput: (ev) => mutate(() => { p[j] = ev.target.value; }, true), onchange: () => pushHistory() });
        const mk3 = e.type === "spline" ? h("span") : h("input", { value: p[2] ?? "", placeholder: "0", title: "Flèche : courbe le côté qui part de ce point (0 = droit)", oninput: (ev) => mutate(() => { p[2] = ev.target.value; }, true), onchange: () => pushHistory() });
        const mk4 = e.type === "spline" ? null : h("input", { value: p[3] ?? "", placeholder: "0", "data-rc": i, title: "Rayon du coin : arrondit ce coin entre deux côtés droits (0 = coin vif)", oninput: (ev) => mutate(() => { if (p[2] === undefined || p[2] === null) p[2] = 0; p[3] = ev.target.value; }, true), onchange: () => pushHistory() });
        box.append(h("div", { class: "pt " + (mk4 ? "pt4" : "pt3") }, String(i + 1), mk(0), mk(1), mk3, mk4, h("button", { class: "x", title: "Retirer ce point", onclick: () => { if (e.pts.length <= (e.type === "path" || (e.type === "spline" && !e.closed) ? 2 : 3)) { toast("Il n’y a pas assez de points."); return; } mutate(() => { e.pts.splice(i, 1); f.constraints = (f.constraints || []).filter((c) => (c.refs || []).every((r) => r.e !== e.id)); }); renderProps(); } }, "✕")));
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
// ---------- Flèches à tirer dans la vue 3D ----------
// Selon l'étape choisie : déplacer une forme prête ou un fichier importé, régler une épaisseur,
// déplacer une coupe. On tire la flèche, la valeur suit (au millimètre ; Maj pour le dixième).
const HCOL = [0xd9463c, 0x2f9e55, 0x2f6fb5];
let handleList = [];
function refreshHandles() {
  if (viewer.drag) return;
  handleList = [];
  // pendant qu'on choisit des zones ou une face d'arrivée, la flèche ne doit pas prendre les clics
  const busy = st.pick && (st.pick.kind === "regions" || st.pick.kind === "upto");
  const f = st.sel && !busy && !isAsm() && !st.editSketch && !stageTool() ? feat(st.sel) : null;
  if (f && !f.suppressed && !engineFailed) {
    const vars = varsMap(doc.params);
    const plain = (v) => /^\s*-?[\d.,]*\s*$/.test(String(v ?? "")); // une formule ne se tire pas à la souris
    const val = (v) => { try { return evalExpr(String(v ?? "").trim() === "" ? 0 : v, vars); } catch { return NaN; } };
    const AXV = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const move = (keys, origin, labels) => keys.forEach((key, k) => {
      if (plain(f[key]) && origin.every(isFinite)) handleList.push({ id: key, origin, dir: AXV[k], color: HCOL[k], obj: f, key, base: val(f[key]), label: labels[k] });
    });
    // arcs pour tourner : la pièce tourne d'abord autour de X, puis de Y, puis de Z ; chaque arc est
    // donc dessiné autour de l'axe tel qu'il se trouve après les rotations suivantes
    const turn = (origin) => {
      const r = [val(f.rx), val(f.ry), val(f.rz)]; if (!r.every(isFinite) || !origin.every(isFinite)) return;
      const rad = (d) => d * Math.PI / 180; const cy = Math.cos(rad(r[1])), sy = Math.sin(rad(r[1])), cz = Math.cos(rad(r[2])), sz = Math.sin(rad(r[2]));
      const axes = [[cz * cy, sz * cy, -sy], [-sz, cz, 0], [0, 0, 1]]; const from = [axes[1], axes[2], [1, 0, 0]]; // où commence chaque arc (celui de Z reste entre les flèches X et Y)
      ["rx", "ry", "rz"].forEach((key, k) => {
        if (plain(f[key])) handleList.push({ id: key, ring: true, origin, dir: axes[k], u: from[k], color: HCOL[k], obj: f, key, base: r[k], unit: "°", label: "Rotation " + "XYZ"[k] });
      });
    };
    try {
      if (f.type === "shape") { const o = [val(f.x), val(f.y), val(f.z)]; move(["x", "y", "z"], o, ["X", "Y", "Z"]); turn(o); }
      else if (f.type === "import" && st.info?.[f.id]?.bb) {
        const bb = st.info[f.id].bb; const o = [0, 1, 2].map((k) => (bb[0][k] + bb[1][k]) / 2);
        move(["tx", "ty", "tz"], o, ["Déplacement X", "Déplacement Y", "Déplacement Z"]); turn(o);
      } else if (f.type === "slice" && st.info?.[f.id]?.bb && plain(f.at)) {
        const bb = st.info[f.id].bb; const k = { x: 0, y: 1, z: 2 }[f.axis] ?? 2; const o = [0, 1, 2].map((i) => (bb[0][i] + bb[1][i]) / 2); o[k] = val(f.at);
        handleList.push({ id: "at", origin: o, dir: AXV[k], color: HCOL[k], obj: f, key: "at", base: val(f.at), label: "Coupe" });
      } else if (f.type === "stretch" && st.mesh?.bb) {
        // la flèche part du deuxième trait de la partie réglée : la tirer allonge ou raccourcit
        const nums = zoneNums(f), zi = Math.min(st.zoneSel ?? nums.length - 1, nums.length - 1), n = nums[zi], z = f.zones?.[zi];
        if (n && plain(z.add)) {
          const bb = st.mesh.bb; const o = [0, 1, 2].map((i) => (bb[0][i] + bb[1][i]) / 2); o[n.k] = zoneMap(nums.filter(Boolean), n.k)(n.b);
          handleList.push({ id: "add", origin: o, dir: AXV[n.k], color: 0xc4552b, obj: z, key: "add", base: n.add, min: Math.ceil((-(n.b - n.a) + 0.2) * 10) / 10, label: "Partie allongée de", after: () => { renderPlanes(); zoneSyncFn?.(); } });
        }
      } else if (f.type === "extrude" && f.end !== "face" && !f.through && plain(f.dist)) {
        // épaisseur : la flèche part du bout de la matière, au centre du dessin
        const sk = feat(f.sketch); const pl = resolvePlane(sk.plane, vars); const dist = val(f.dist);
        let n = 0, cu = 0, cv = 0;
        for (const e of sk.entities || []) { try { for (const q of outline(evalEntity(e, vars))) { cu += q[0]; cv += q[1]; n++; } } catch { /* entité incomplète */ } }
        if (n && dist > 0) {
          const dir = f.dir || "normal"; const sign = dir === "inverse" ? -1 : 1;
          const o = toWorld(pl, cu / n, cv / n, dir === "sym" ? dist / 2 : sign * dist);
          handleList.push({ id: "dist", origin: o, dir: pl.n.map((c) => c * sign), color: 0xc4552b, obj: f, key: "dist", base: dist, k: dir === "sym" ? 2 : 1, min: 0.1, label: f.mode === "cut" ? "Profondeur" : "Épaisseur" });
        }
      }
    } catch { handleList = []; }
  }
  viewer.setHandles(handleList.map(({ id, origin, dir, color, ring, u }) => ({ id, origin, dir, color, ring, u })), onHandleDrag);
  $("#handTip")?.remove(); renderGestures();
}
// Ce que fait une poignée quand on la tire (dit au survol, et dans l'aide des gestes).
const handleUse = (hd) => (hd.ring ? "tourner" : hd.key === "dist" ? (hd.label === "Profondeur" ? "changer la profondeur" : "changer l’épaisseur") : hd.key === "at" ? "déplacer la coupe" : hd.key === "add" ? "allonger ou raccourcir cette partie" : "déplacer");
function handleHover(id, e) {
  const hd = id ? handleList.find((x) => x.id === id) : null;
  if (!hd) { $("#handTip")?.remove(); return; }
  const tip = $("#handTip") || document.body.appendChild(h("div", { id: "handTip", class: "dragtip" }));
  tip.textContent = fr(`Tire pour ${handleUse(hd)}. Aucune touche à tenir.`); tip.style.left = e.clientX + 16 + "px"; tip.style.top = e.clientY + 16 + "px";
}
// ---------- Aide des gestes : ce qu'on peut faire maintenant avec la souris, toujours écrit en bas de la vue ----------
function renderGestures() {
  $("#gestes")?.remove();
  if (isAsm() || st.editSketch || !$("#welcome")?.hidden || stageTool() || $(".secbar")) return;
  if (viewer.pickMode || st.pick) return; // le bandeau du haut dit déjà où cliquer
  let items = [];
  const has = (fn) => handleList.some(fn);
  if (has((x) => !x.ring && !["dist", "at", "add"].includes(x.key))) items.push(["pull", "Tire une flèche : déplacer"]);
  if (has((x) => x.ring)) items.push(["turn", "Tire un arc : tourner"]);
  for (const x of handleList) if (["dist", "at", "add"].includes(x.key)) items.push(["pull", `Tire la flèche${x.key === "at" ? "" : " orange"} : ${handleUse(x)}`]);
  if (items.length) items.push(["keycap", "Aucune touche à tenir. Avec Maj : réglage fin"], ["digits", has((x) => x.ring) ? "Pour agrandir : les chiffres de « Taille » à gauche, ou leurs boutons − et +" : "Ou change les chiffres à gauche, avec leurs boutons − et +"]);
  else if (st.mesh) items = [["mouseL", "Clic sur une étape à gauche, ou double-clic sur la pièce : changer une taille"], ["mouseL", "Clic gauche maintenu : tourner la vue"], ["mouseR", "Clic droit maintenu : déplacer la vue"], ["wheel", "Molette : zoomer"], ["keycap", "Ctrl+Z : annuler"]];
  else return;
  if (pref("gabarit-gestes") === "0") {
    $(".stage").append(h("button", { id: "gestes", class: "gestes mini", title: "Afficher l’aide des gestes", onclick: () => { setPref("gabarit-gestes", "1"); renderGestures(); } }, h("i", { html: ICONS.mouseL }), "Gestes"));
    return;
  }
  const bar = h("div", { id: "gestes", class: "gestes" }, items.map(([ic, text]) => h("span", { class: "g" }, h("i", { html: ICONS[ic] }), text)),
    h("button", { class: "x", title: "Masquer cette aide (un bouton « Gestes » reste pour la retrouver)", "aria-label": "Masquer l’aide des gestes", onclick: () => { setPref("gabarit-gestes", "0"); renderGestures(); } }, "✕"));
  typoTree(bar); $(".stage").append(bar);
}
function onHandleDrag(id, delta, phase, e) {
  const hd = handleList.find((x) => x.id === id); if (!hd) return 0;
  const tip = $("#dragTip") || document.body.appendChild(h("div", { id: "dragTip", class: "dragtip" }));
  if (phase === "cancel") { tip.remove(); return 0; }
  if (phase === "end") { tip.remove(); pushHistory(); renderProps(); requestBuild(0); setTimeout(refreshHandles, 0); return 0; }
  const deg = hd.unit === "°";
  // au pas choisi (dix fois plus fin avec Maj) ; les angles par crans de 5° (au degré avec Maj)
  const pas = pasMm(); const step = deg ? (e.shiftKey ? 1 : 5) : e.shiftKey ? pas / 10 : pas; const k = hd.k || 1;
  let v = Math.round((hd.base + delta * k) / step) * step; if (hd.min !== undefined) v = Math.max(hd.min, v);
  v = Math.round(v * 10000) / 10000;
  let shown = v; if (deg) { shown = ((v % 360) + 360) % 360; if (shown > 180) shown -= 360; } // un angle reste entre −180° et 180°
  if (String(shown) !== String(hd.obj[hd.key])) {
    mutate(() => { hd.obj[hd.key] = String(shown); }, true);
    const inp = $(`#props [data-hk="${hd.key}"]`); if (inp) inp.value = String(shown);
    const mk = $(`#dimCard [data-mk="${hd.key}"]`); if (mk) mk.value = String(shown);
    if (hd.obj.type === "slice") renderPlanes();
    hd.after?.();
  }
  tip.textContent = deg ? `${hd.label} : ${nf(shown, 0)}°` : `${hd.label} : ${nf(v, pas < 0.1 || (e.shiftKey && pas < 1) ? 3 : 2)} mm`; tip.style.left = e.clientX + 16 + "px"; tip.style.top = e.clientY + 14 + "px";
  return (v - hd.base) / k;
}

function renderOverlay() {
  renderPlanes(); refreshHandles();
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
  // plan de coupe d'une « Coupe à plat », ou les deux plans d'une zone à allonger
  const sf = st.sel ? feat(st.sel) : null; const bb = sf && st.info?.[sf.id]?.bb;
  const AXV = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const cutPlane = (k, at) => {
    const u = (k + 1) % 3, w = (k + 2) % 3; const o = [0, 0, 0]; o[k] = at; o[u] = (bb[0][u] + bb[1][u]) / 2; o[w] = (bb[0][w] + bb[1][w]) / 2;
    list.push({ origin: o, x: AXV[u], y: AXV[w], size: Math.max(bb[1][u] - bb[0][u], bb[1][w] - bb[0][w]) * 1.25 + 4, active: true });
  };
  try {
    if (sf && bb && sf.type === "slice" && !sf.suppressed) cutPlane({ x: 0, y: 1, z: 2 }[sf.axis] ?? 2, evalExpr(sf.at ?? 0, vars));
    if (sf && sf.type === "stretch" && !sf.suppressed && st.mesh?.bb) {
      const nums = zoneNums(sf), all = nums.filter(Boolean), mb = st.mesh.bb, cur = Math.min(st.zoneSel ?? nums.length - 1, nums.length - 1);
      nums.forEach((n, i) => {
        if (!n) return; const g = zoneMap(all, n.k), u = (n.k + 1) % 3, w = (n.k + 2) % 3, mg = Math.max(mb[1][u] - mb[0][u], mb[1][w] - mb[0][w]) * 0.16 + 3;
        for (const at of [g(n.a), g(n.b)]) { const o = [0, 0, 0]; o[n.k] = at; o[u] = (mb[0][u] + mb[1][u]) / 2; o[w] = (mb[0][w] + mb[1][w]) / 2; list.push({ origin: o, x: AXV[u], y: AXV[w], w: (mb[1][u] - mb[0][u]) + mg, h: (mb[1][w] - mb[0][w]) + mg, active: i === cur }); }
      });
    }
    if (sf && bb && sf.type === "import" && sf.zone && !sf.suppressed) {
      const k = { x: 0, y: 1, z: 2 }[sf.zone.axis] ?? 0; const a = evalExpr(sf.zone.a ?? 0, vars), b = evalExpr(sf.zone.b ?? 0, vars), ad = evalExpr(sf.zone.add || 0, vars);
      cutPlane(k, bb[0][k] + a); cutPlane(k, bb[0][k] + b + ad);
    }
  } catch { /* valeur en cours de frappe */ }
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
  const inp = h("input", { type: "file", accept: ".3mf,.stl,.step,.stp,.svg,.dxf", hidden: true });
  inp.addEventListener("change", () => { const file = inp.files[0]; if (file) (DRAW_EXT.test(file.name) ? importDrawing(file) : importBlob(file)); });
  document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
}
const b64 = (u8) => { let bin = ""; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(bin); };
const MESH_EXT = /\.(3mf|stl|step|stp)$/i;
const DRAW_EXT = /\.(svg|dxf)$/i;
// Importe un dessin 2D (SVG ou DXF) : il devient une esquisse à la taille voulue, prête à prendre du volume.
async function importDrawing(file) {
  if (isAsm()) { toast("Ouvre une pièce pour importer ce dessin."); return; }
  if (file.size > 20e6) { toast("Dessin trop gros (20 Mo au maximum)."); return; }
  let dr;
  try { dr = readDrawing(file.name, await file.text()); } catch (e) { toast(e?.message?.length < 120 ? e.message : "Ce dessin est illisible."); return; }
  if (!dr.closed && !dr.open) { toast("Aucun trait trouvé dans ce dessin."); return; }
  const base = file.name.replace(/\.[^.]+$/, "");
  const w0 = dr.bb[2] - dr.bb[0], h0 = dr.bb[3] - dr.bb[1]; const byW = w0 > 1e-9;
  const dlg = $("#dlg"); dlg.innerHTML = "";
  const wIn = h("input", { type: "text", inputmode: "decimal", id: "drawW", spellcheck: "false", value: String(Math.round((byW ? w0 : h0) * 100) / 100) });
  const other = h("div", { class: "calc", id: "drawH" });
  const size = () => { const v = Number(String(wIn.value).trim().replace(",", ".")); return v > 0 && isFinite(v) ? v : NaN; };
  let here = true;
  const place = (plane) => {
    const width = byW ? size() : size() * w0 / (h0 || 1);
    const sk = { id: newId("f"), type: "sketch", name: nextNameRaw(isSimple() ? "Dessin importé" : "Esquisse importée"), plane, entities: drawingEntities(dr, byW ? width : 0).map((e) => ({ id: newId("e"), ...e })) };
    if (!byW) { const f = size() / (h0 || 1); for (const e of sk.entities) for (const q of e.pts || []) for (let i = 0; i < q.length; i++) q[i] = String(Math.round(Number(q[i]) * f * 1000) / 1000); }
    insertFeature(sk); st.editStart = null; st.firstFit = true;
    if (dr.closed) {
      // tout de suite en volume : 3 mm d'épaisseur, à régler avec la flèche ou au clavier
      toolAction("extrude");
      const f = feat(st.sel); if (f?.type === "extrude" && f.sketch === sk.id) { mutate(() => { f.dist = "3"; }, true); renderProps(); requestBuild(0); }
      toast(`Dessin importé : ${dr.closed} contour${dr.closed > 1 ? "s" : ""}. Règle l’épaisseur, puis valide.`);
    } else toast("Dessin importé. Il ne contient que des traits ouverts : ferme un contour pour lui donner du volume.");
  };
  const go = () => {
    if (!(size() > 0)) return; dlg.close();
    if (!here && !isBlank(doc)) { openTab(emptyDoc()); doc.name = base; $("#docName").value = base; }
    else if (isBlank(doc)) { doc.name = base; $("#docName").value = base; }
    if (isBlank(doc) || !st.mesh) place({ kind: "std", name: "dessus", offset: "0" });
    else choosePlane(place, "Sur quel plan poser ce dessin ?");
  };
  const ok = h("button", { class: "btn primary", id: "drawOk", onclick: go }, "Importer");
  const upd = () => { const v = size(); ok.disabled = !(v > 0); other.textContent = v > 0 && byW && h0 > 1e-9 ? `Hauteur : ${nf(h0 * v / w0)} mm` : v > 0 && !byW ? "" : "Écris une taille plus grande que 0."; };
  wIn.addEventListener("input", upd); wIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); go(); } });
  const parts = [`${dr.closed} contour${dr.closed > 1 ? "s" : ""} fermé${dr.closed > 1 ? "s" : ""}`];
  if (dr.open) parts.push(`${dr.open} trait${dr.open > 1 ? "s" : ""} ouvert${dr.open > 1 ? "s" : ""}`);
  dlg.append(h("div", { class: "dh" }, "Importer un dessin"), h("div", { class: "db" },
    h("p", {}, `« ${file.name} » : ${parts.join(", ")}. Le dessin devient une esquisse que tu peux épaissir, creuser ou modifier.`),
    dr.skipped ? h("p", {}, "Les textes, images et blocs du fichier ne sont pas repris : convertis-les en tracés dans ton logiciel de dessin.") : null,
    h("div", { class: "field" }, h("label", { for: "drawW" }, byW ? "Largeur voulue" : "Hauteur voulue"), h("div", { class: "in" }, wIn, h("span", { class: "unit" }, "mm")), other),
    isBlank(doc) ? null : h("div", { class: "field" }, h("label", {}, "Où le mettre"), h("div", { class: "seg", id: "drawWhere" },
      ...[[true, "Dans cette pièce"], [false, "Dans une nouvelle pièce"]].map(([v, t]) => h("button", { class: v ? "on" : "", onclick: (e) => { here = v; for (const b of e.currentTarget.parentNode.children) b.classList.toggle("on", b === e.currentTarget); } }, t)))),
  ), h("div", { class: "df" }, h("button", { class: "btn", onclick: () => dlg.close() }, "Annuler"), ok));
  upd(); dlg.showModal(); wIn.select();
}
// Importe un fichier 3MF (Bambu Studio, Orca, Prusa…), STL ou STEP dans la pièce ouverte.
async function importBlob(file) {
  if (isAsm()) { toast("Ouvre une pièce pour importer ce fichier (ou insère-le comme composant)."); return; }
  if (file.size > 60e6) { toast("Fichier trop gros (60 Mo au maximum)."); return; }
  const base = file.name.replace(/\.[^.]+$/, "");
  const buf = new Uint8Array(await file.arrayBuffer());
  if (/\.(3mf|stl)$/i.test(file.name)) {
    let objs, before = 0;
    try {
      showBusy(true, "Lecture du fichier…");
      await new Promise((r) => setTimeout(r, 30));
      const raw = /\.3mf$/i.test(file.name) ? await read3mf(buf) : [{ name: base, tris: readStl(buf) }];
      before = raw.reduce((n, o) => n + o.tris.length / 9, 0);
      // au-delà de MAX_TRIS, on allège pour que les modifications restent rapides
      if (before > MAX_TRIS) { showBusy(true, "Allègement du maillage…"); await new Promise((r) => setTimeout(r, 30)); for (const o of raw) o.tris = simplify(o.tris, Math.max(500, Math.round(MAX_TRIS * (o.tris.length / 9) / before))); }
      objs = toStl(raw);
    } catch (e) { showBusy(false); toast(e.message || "Ce fichier est illisible."); return; }
    showBusy(false);
    const total = objs.reduce((n, o) => n + o.count, 0);
    const feats = objs.map((o) => ({ id: newId("f"), type: "import", name: objs.length > 1 ? o.name : base, file: file.name, format: "stl", data: b64(o.stl), mode: "add", scale: "1", tx: "0", ty: "0", tz: "0" }));
    insertFeature(feats[0]);
    if (feats.length > 1) mutate((d) => { const i = d.features.findIndex((f) => f.id === feats[0].id); d.features.splice(i + 1, 0, ...feats.slice(1)); });
    st.firstFit = true;
    const nb = (v) => Math.round(v).toLocaleString("fr-FR");
    toast(fr(`« ${base} » importé${feats.length > 1 ? ` (${feats.length} objets)` : ""}. ${before > MAX_TRIS ? `Maillage allégé de ${nb(before)} à ${nb(total)} triangles pour rester fluide. ` : ""}Tu peux esquisser sur ses faces, extruder, percer…`));
    return;
  }
  if (file.size > 25e6) { toast("Fichier trop gros (25 Mo au maximum)."); return; }
  const format = /\.stl$/i.test(file.name) ? "stl" : "step";
  insertFeature({ id: newId("f"), type: "import", name: base, file: file.name, format, data: b64(buf), mode: "add", scale: "1", tx: "0", ty: "0", tz: "0" });
  st.firstFit = true;
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
  s.append(h("span", { class: "ver" }, `v${APP_V}`),
    h("button", { class: "upd" + (st.newVersion ? " new" : ""), title: st.newVersion ? `La version ${st.newVersion} est disponible` : "Chercher une mise à jour et relancer Gabarit", onclick: () => checkUpdate() }, st.newVersion ? `Mettre à jour (v${st.newVersion})` : "Mettre à jour"));
}
const APP_V = typeof GABARIT_VERSION === "string" ? GABARIT_VERSION : "?";
// Version publiée en ligne (lue dans sw.js, sans passer par le cache).
async function onlineVersion() {
  try { const t = await (await fetch("sw.js?v=" + Date.now(), { cache: "no-store" })).text(); return (/VERSION = "([\d.]+)/.exec(t) || [])[1] || null; } catch { return null; }
}
const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function watchVersion() {
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  const v = await onlineVersion();
  if (v && APP_V !== "?" && newer(v, APP_V) && st.newVersion !== v) { st.newVersion = v; renderStatus(); }
}
// Bouton « Mettre à jour » : télécharge la dernière version puis relance Gabarit (ton travail est gardé).
async function checkUpdate() {
  if (location.protocol === "file:") { toast("Version hors ligne (fichier) : télécharge le nouveau Gabarit.html pour mettre à jour."); return; }
  showBusy(true, "Mise à jour…");
  const v = await onlineVersion();
  if (v && !newer(v, APP_V) && v === APP_V) { showBusy(false); toast(`Tu as déjà la dernière version (v${APP_V}).`); return; }
  save(); stashActive(); saveTabs();
  try {
    await Promise.all(["./", "index.html", "app.js", "worker.js", "style.css"].map((f) => fetch(f + "?v=" + Date.now(), { cache: "reload" }).catch(() => {})));
    const r = await navigator.serviceWorker?.getRegistration(); await r?.update();
  } catch { /* hors ligne */ }
  setTimeout(() => location.reload(), 900);
}
setTimeout(watchVersion, 5000); setInterval(watchVersion, 20 * 60 * 1000);

// ---------- Divers ----------
let toastTimer;
function toast(msg, ms = 3800) { const t = $("#toast"); t.textContent = fr(msg); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms); }
function showBusy(on, text = "Calcul…") { const b = $("#busy"); b.hidden = !on; b.classList.remove("long"); if (on) b.lastChild.textContent = fr(text); }
function layoutMode() {
  const M = document.querySelector("main");
  M.classList.toggle("asm", isAsm()); M.classList.toggle("editing", !isAsm() && !!(st.editSketch || feat(st.sel)));
  renderCorner(); renderCoach(); renderGestures();
}
// Coup de pouce du mode Simple : propose la suite, sans jamais bloquer.
const defisDone = () => { try { return JSON.parse(pref("gabarit-defis") || "[]"); } catch { return []; } };
function startChallenge(ch) {
  setMode("simple", true);
  openTab({ ...(ch.start ? ch.start() : emptyDoc()), ...(ch.start ? {} : { name: ch.title }), defi: { key: ch.key, step: 0 } });
  st.firstFit = true;
}
function renderChallenge(ch) {
  const s = { sel: st.sel, ok: !Object.keys(st.errors || {}).length, vol: st.mesh?.volume ?? 0 };
  let i = Math.min(doc.defi.step || 0, ch.steps.length);
  if (!st.building) while (i < ch.steps.length) { let ok = false; try { ok = !!ch.steps[i].done(doc, s); } catch { ok = false; } if (!ok) break; i++; }
  if (i !== doc.defi.step) { doc.defi.step = i; save(); }
  const done = i >= ch.steps.length; const step = ch.steps[Math.min(i, ch.steps.length - 1)];
  if (done) { const l = defisDone(); if (!l.includes(ch.key)) setPref("gabarit-defis", JSON.stringify([...l, ch.key])); }
  const quit = () => { delete doc.defi; save(); renderCoach(); };
  $(".stage").append(h("div", { id: "coach", class: "coach defi", "data-step": String(i) },
    h("div", { class: "ct" }, h("i", { html: ICONS[done ? "check" : "flag"] || ICONS.bulb }), done ? "Bravo, défi réussi !" : `Défi : ${ch.title}`,
      h("button", { class: "x", title: "Quitter le défi", "aria-label": "Quitter le défi", onclick: quit }, "✕")),
    h("div", { class: "dots", "aria-hidden": "true" }, ch.steps.map((_, k) => h("span", { class: k < i ? "ok" : k === i ? "cur" : "" }))),
    done ? h("p", {}, "Tu sais maintenant poser une forme, la régler et l’exporter. La pièce est à toi : continue à la modifier si tu veux.")
      : h("p", {}, h("b", {}, `Étape ${i + 1} sur ${ch.steps.length}. `), step.text),
    h("div", { class: "cs row" },
      done ? h("button", { "data-defi": "more", onclick: () => { quit(); welcome(true); } }, "Un autre défi") : null,
      done ? h("button", { "data-defi": "keep", onclick: quit }, "Continuer cette pièce") : null,
      !done && step.tool && !st.sel && !st.pick ? h("button", { "data-defi": "show", onclick: () => toolAction(step.tool) }, h("span", { html: ICONS[TOOL_ICON[step.tool] || step.tool] }), "Montre-moi") : null)));
}
function renderCoach() {
  $("#coach")?.remove();
  const ch = !isAsm() && doc.defi && CHALLENGES.find((c) => c.key === doc.defi.key);
  if (stageTool()) return; // un outil occupe le bas de la vue
  if (ch && isSimple() && $("#welcome").hidden && !st.editSketch) { renderChallenge(ch); return; }
  if (!isSimple() || isAsm() || st.editSketch || st.sel || st.pick || viewer.pickMode || pref("gabarit-coach") === "0" || !$("#welcome").hidden) return;
  const has = !!st.mesh || doc.features.length > 0;
  const steps = has
    ? [["fillet", "Arrondir les bords"], ["hole", "Percer un trou"], ["shapes", "Ajouter une autre forme"], ["print", "Préparer l’impression 3D"]]
    : [["shapes", "Poser une forme prête"], ["sketch", "Dessiner ma propre forme"], ["import", "Ouvrir un fichier 3D ou un dessin (STL, 3MF, STEP, SVG, DXF)"]];
  $(".stage").append(h("div", { id: "coach", class: "coach" },
    h("div", { class: "ct" }, h("i", { html: ICONS.bulb }), has ? "Et maintenant ?" : "Par où commencer ?",
      h("button", { class: "x", title: "Masquer ces conseils", "aria-label": "Masquer ces conseils", onclick: () => { setPref("gabarit-coach", "0"); renderCoach(); } }, "✕")),
    h("p", {}, has ? "Ta pièce est là. Améliore-la, puis envoie-la à ton imprimante." : "Pose une forme toute faite, ou dessine la tienne."),
    h("div", { class: "cs" }, steps.map(([k, label]) => h("button", { "data-coach": k, onclick: () => toolAction(k) }, h("span", { html: ICONS[TOOL_ICON[k] || k] }), label)))));
}
function renderAll() { layoutMode(); if (isAsm()) { $("#docName").value = doc.name; asmUI.render(); return; } $("#docName").value = doc.name; renderTree(); renderParams(); renderProps(); renderStatus(); renderOverlay(); refreshMarkers(); }

// Accueil au lancement : continuer, nouveau, ouvrir, ou gérer ses pièces récentes.
function welcome(show) {
  const w = $("#welcome"); if (!show) { w.hidden = true; renderCoach(); renderGestures(); return; }
  const draw = () => {
    w.innerHTML = "";
    const lib = library();
    const names = Object.keys(lib).sort((a, b) => (lib[b].savedAt || 0) - (lib[a].savedAt || 0) || a.localeCompare(b, "fr"));
    const cur = (isAsm() || doc.features?.length) ? doc.name : null;
    const go = (fn) => { welcome(false); fn(); };
    const act = (icon, title, sub, fn, cls) => h("button", { class: "act" + (cls ? " " + cls : ""), onclick: fn }, h("span", { class: "ai", html: ICONS[icon] }), h("span", {}, h("b", {}, title), sub ? h("small", {}, sub) : null));
    const modeCard = (m, icon, title, sub) => h("button", { class: "mode" + (mode === m ? " on" : ""), "data-mode": m, "aria-pressed": mode === m, onclick: () => { setMode(m, true); draw(); } },
      h("span", { class: "mi", html: ICONS[icon] }), h("span", {}, h("b", {}, title), h("small", {}, sub)), h("span", { class: "dot" }));
    w.append(h("div", { class: "card" },
      h("div", { class: "hero" },
        h("div", { class: "logo" }, h("img", { src: $(".brand img").src, alt: "" }), h("h1", {}, "Gabarit")),
        h("p", { class: "tag" }, "Ton atelier de conception 3D. Gratuit, sans compte, et il marche même hors ligne."),
        h("h3", {}, "Comment veux-tu travailler ?"),
        h("div", { class: "modes" },
          modeCard("simple", "spark", "Simple", "Je découvre : l’essentiel, des formes prêtes et des mots de tous les jours."),
          modeCard("expert", "pro", "Expert", "J’ai l’habitude de la CAO : tous les outils, esquisses cotées, historique.")),
        h("div", { class: "foot" }, `Version ${APP_V}. Tu peux changer de mode à tout moment, en haut à droite.`)),
      h("div", { class: "side" },
        h("h2", {}, cur ? "Reprendre" : "Commencer"),
        h("div", { class: "acts" },
          cur ? act("play", `Continuer : ${cur}`, "Reprends là où tu t’es arrêté", () => go(() => {}), "primary") : null,
          act("plus", "Nouvelle pièce", isSimple() ? "Pars d’une forme prête ou de ton dessin" : "Commence par une esquisse", () => go(() => { openTab(emptyDoc()); if (!isSimple()) toolAction("sketch"); }), cur ? "" : "primary")),
        h("div", { class: "acts two", style: "margin-top:6px" },
          act("folder", "Ouvrir un fichier", "Gabarit, STL, 3MF, STEP, SVG, DXF", () => go(() => $("#fileIn").click())),
          act("eye", "Voir l’exemple", "Une pièce toute faite", () => go(() => openTab(exampleDoc()))),
          isSimple() ? null : act("asm", "Nouvel assemblage", "Réunir plusieurs pièces", () => go(() => openTab(emptyAsm())))),
        h("div", { class: "starters" }, h("h2", {}, "Modèles de départ"),
          h("div", { class: "sgrid4" }, TEMPLATES.map((t) => h("button", { class: "starter", "data-starter": t.key, title: t.sub, onclick: () => go(() => { openTab(t.doc()); st.firstFit = true; }) },
            h("span", { class: "si", html: ICONS[t.icon] }), h("b", {}, t.title), h("small", {}, t.sub))))),
        h("div", { class: "starters defis" }, h("h2", {}, "Mini-défis pour débuter (2 minutes chacun)"),
          h("div", { class: "sgrid3" }, CHALLENGES.map((c) => h("button", { class: "starter" + (defisDone().includes(c.key) ? " done" : ""), "data-defi": c.key, title: c.sub, onclick: () => go(() => startChallenge(c)) },
            h("span", { class: "si", html: ICONS[c.icon] }), h("b", {}, c.title.replace(/-/g, "-\u2060")), h("small", {}, defisDone().includes(c.key) ? "Réussi" : c.sub))))),
        names.length ? h("div", { class: "recents" }, h("h2", {}, "Mes pièces"),
          ...names.map((n) => h("div", { class: "rec" },
            h("button", { class: "rec-open", title: "Ouvrir", onclick: () => go(() => openTab(lib[n])) }, h("b", {}, n), h("span", {}, ` · ${lib[n].features.length} étape(s)`)),
            h("button", { class: "rec-del", title: `Supprimer « ${n} »`, "aria-label": `Supprimer ${n}`, onclick: () => { if (!deletePart(n)) return; draw(); } }, "Supprimer"))))
          : h("div", { class: "tips" }, h("h2", {}, "Ce que tu peux faire"),
            ...[["shape", "Poser des formes prêtes", "Boîte, cylindre, engrenage, texte… puis ajouter ou creuser."],
              ["import", "Reprendre un fichier d’impression 3D", "STL ou 3MF : l’allonger, l’élargir, le tourner, le percer."],
              ["sketch", "Dessiner à la cote", "Esquisses, contraintes, paramètres : tout reste modifiable."],
              ["print", "Envoyer à ton imprimante", "Surplombs colorés, pose à plat, export STL, 3MF ou STEP."]]
              .map(([ic, t, d]) => h("div", { class: "tip" }, h("span", { class: "ti", html: ICONS[ic] }), h("span", {}, h("b", {}, t), h("small", {}, d))))))));
    typoTree(w);
  };
  draw(); w.hidden = false; renderCoach();
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
    <h3>Deux modes</h3><p>En haut à droite, choisis <b>Simple</b> (l’essentiel, des formes prêtes, des mots de tous les jours) ou <b>Expert</b> (tous les outils). Tu peux passer de l’un à l’autre à tout moment, ta pièce ne change pas. Le bouton lune ou soleil change le thème.</p>
    <h3>Formes prêtes</h3><p><b>Formes prêtes</b> pose une boîte, un cylindre, une sphère, un engrenage, un texte… Clique ensuite sur la pièce pour la placer, règle sa taille à gauche, et choisis <b>Ajouter de la matière</b> ou <b>Creuser</b>.</p>
    <h3>Tout à la souris</h3><p>Quand tu choisis une forme prête, un fichier importé, une extrusion ou une coupe, des <b>flèches</b> apparaissent sur la pièce : tire-les pour déplacer ou pour régler l’épaisseur. La valeur avance du pas choisi (1 mm au départ) ; garde <b>Maj</b> enfoncée pour dix fois plus fin. Les <b>arcs</b> de couleur font tourner une forme prête ou un fichier importé, par crans de 5° (au degré près avec Maj). Tu peux toujours taper la valeur exacte à gauche.</p>
    <h3>Aucune touche à tenir</h3><p>Tout se fait à la souris, sans touche enfoncée : tire une flèche pour déplacer ou épaissir, tire un arc pour tourner. En bas de la vue, une ligne rappelle à chaque instant <b>ce que fait chaque geste</b>. Chaque chiffre a ses boutons <b>−</b> et <b>+</b> : un clic avance d’un cran, rester appuyé fait défiler.</p>
    <h3>Changer la taille</h3><p>Le bouton <b>Taille</b>, à droite de la vue, agrandit ou réduit toute la pièce : tape « 30 » pour 30 % de plus, ou donne une dimension en millimètres et le reste suit.</p>
    <h3>Annuler</h3><p><b>Ctrl+Z</b> annule la dernière modification, <b>Ctrl+Y</b> la rétablit (ou les deux flèches en haut de l’écran). Ça marche aussi quand le curseur est dans une case : ce que tu viens de taper est défait d’abord, puis les modifications de la pièce, une par une. Un petit mot confirme chaque annulation.</p>
    <h3>Quadrillage fin</h3><p>À droite de la vue, <b>Pas</b> règle la taille des plus petits carreaux, de 10 mm à 0,01 mm. Zoome : les petits carreaux apparaissent sur le sol. Les flèches, les boutons <b>−</b> et <b>+</b> et la grille du dessin avancent de ce pas, et dix fois plus fin avec <b>Maj</b>.</p>
    <h3>Tourner la pièce</h3><p>À droite de la vue, <b>Tourner</b> change le sens de toute la pièce : <b>quart de tour</b> à gauche ou à droite, <b>demi-tour</b>, la <b>coucher</b> sur le côté ou vers l’avant, la mettre <b>tête en bas</b>, ou la passer au <b>miroir</b> (gauche et droite inversées). Chaque clic s’ajoute au précédent, la pièce reste posée au même endroit, et « Remettre droit » annule tout.</p>
    <h3>Essayer dans un meuble</h3><p><b>Dans un meuble</b> pose ta pièce dans un meuble pour voir si elle <b>rentre</b>, combien il reste de place, <b>combien tu peux en ranger</b> et jusqu’où tu peux l’<b>agrandir</b>. Quatre onglets : <b>Meuble</b> (choisis le magasin, le type, puis le modèle : étagères, bureaux, tablettes, tiroirs, boîtes ; ou tape tes dimensions et clique sur « Garder ce meuble »), <b>Tourner</b> (quart de tour, coucher, miroir, « Trouver le bon sens »), <b>Placer</b> (à gauche, au centre, à droite, devant, au milieu, au fond, ou à un pourcentage précis ; avec l’<b>aimant</b>, la pièce glissée à la souris se colle aux parois et au milieu) et <b>Taille et remplissage</b> (« Remplir » étire la pièce pour qu’elle occupe toute la largeur, la profondeur ou la hauteur du meuble, avec le jeu que tu choisis). Les dimensions marquées « estimées » sont à vérifier avec un mètre.</p>
    <h3>Allonger une partie</h3><p>Pour changer seulement un morceau (le milieu d’une chaise pour en faire un banc, la tige d’une lampe), choisis <b>Allonger</b>, pose <b>deux traits</b> sur la pièce en cliquant deux fois, puis donne la taille de la partie comprise entre les deux, en millimètres ou en pourcentage, ou tire la flèche orange. Le reste de la pièce ne change pas. Tu peux allonger plusieurs parties, en hauteur, en largeur ou en longueur. Après cette étape, les formes rondes deviennent de petites facettes très fines : fais plutôt les arrondis et les trous avant.</p>
    <h3>Onglets</h3><p>Chaque pièce ouverte a son onglet. Un <b>point</b> sur l’onglet signale une pièce modifiée. Quand tu fermes l’onglet, Gabarit te demande si tu veux l’<b>enregistrer</b> : Enregistrer, Ne pas enregistrer ou Annuler.</p>
    <h3>Changer une cote sur la pièce</h3><p><b>Double-clique</b> sur une face : l’étape qui l’a faite s’ouvre, et ses cotes s’affichent à côté de la souris. Tape la nouvelle valeur, puis Entrée. Échap annule.</p>
    <h3>Importer un dessin</h3><p>Ouvre un fichier <b>SVG</b> ou <b>DXF</b> (un logo, un plan) : il devient une esquisse à la largeur que tu choisis, tout de suite épaissie de 3 mm. Les textes d’un SVG doivent d’abord être convertis en tracés dans ton logiciel de dessin.</p>
    <h3>Fichiers d’impression 3D</h3><p>Ouvre un STL ou un 3MF, puis clique sur son étape. <b>Taille</b> l’étire dans un seul sens. <b>Allonger une partie</b> étire un morceau entre deux traits sans déformer le reste (trous, clips, pas de vis). <b>Coupe à plat</b> enlève tout ce qui dépasse d’un côté d’un plan : pratique pour raccourcir ou retirer un socle.</p>
    <h3>Modèles de départ</h3><p>Sur l’écran d’accueil, quatre objets tout faits (porte-clés, boîte, crochet, support de téléphone) : ouvre-en un, clique sur ses étapes à gauche et change les tailles ou le texte. Juste en dessous, trois <b>mini-défis</b> te guident pas à pas pour fabriquer ton premier objet.</p>
    <h3>1. L’esquisse</h3><p>Clique sur <b>Esquisse</b>, choisis un plan (ou une face de la pièce), puis dessine des rectangles, cercles, rainures, polygones ou un contour libre. Tape les cotes exactes à droite. Une forme placée dans une autre devient un trou.</p>
    <h3>Traits, zones et retouches</h3><p>Plusieurs traits qui se rejoignent forment un contour : la zone fermée <b>se colore</b>, et un <b>rond orange</b> signale un bout de trait qui ne touche rien. Près d’un trait ou d’un cercle, le point que tu poses s’accroche dessus. Un trait qui traverse une forme la coupe en deux : à l’extrusion, clique les zones à garder. <b>Ajuster</b> retire le morceau de trait survolé, entre deux croisements. <b>Congé</b> arrondit le coin cliqué ; son rayon reste modifiable dans la liste des points.</p>
    <h3>2. Le volume</h3><p><b>Extrusion</b> donne de l’épaisseur, <b>Enlèvement</b> creuse, <b>Révolution</b> fait tourner le profil autour d’un axe (pour les pièces rondes).</p>
    <h3>3. Les finitions</h3><p><b>Perçage</b> : clique sur la face, puis place les trous. Avec « Ce trou sert à », choisis une vis (M2 à M8) : le diamètre se règle tout seul pour laisser passer la vis, la visser dans le plastique ou poser un insert à chaud. <b>Congé</b> et <b>Chanfrein</b> : clique sur les arêtes. <b>Coque</b> : clique sur la face à ouvrir.</p>
    <h3>Avant d’imprimer</h3><p><b>Impression 3D</b> vérifie la pièce pour ton imprimante : elle tient sur le plateau (au besoin en la tournant), les zones à soutenir, les ponts trop longs et les parois trop fines pour ta buse sont coloriés sur la pièce. Ce sont des estimations : ton trancheur garde le dernier mot.</p>
    <h3>Quand ça coince</h3><p>Une étape en erreur propose un bouton pour la corriger : trouver la plus grande valeur qui marche, choisir les arêtes à nouveau, ou ouvrir l’esquisse. Si un calcul dure, <b>Échap</b> l’annule et la pièce revient à sa dernière version calculée.</p>
    <h3>Formes avancées</h3><p><b>Plan</b> crée un plan décalé ou incliné pour y dessiner. <b>Lissage</b> relie plusieurs esquisses posées sur des plans différents. <b>Balayage</b> fait glisser un profil le long d’un <b>Chemin</b> (outil de l’esquisse). <b>Dépouille</b> incline des faces. <b>Répétition</b> et <b>Symétrie</b> copient toute la pièce ou seulement les fonctions choisies, en ligne, en grille ou en cercle. Dans un contour libre, tire le rond au milieu d’un côté pour le courber.</p>
    <h3>Plus de fonctions</h3><p>Dans l’esquisse : <b>Ellipse</b>, <b>Courbe</b> (lisse, passe par tes points), <b>Texte</b> (gravé dans un contour, en relief tout seul), et pour une forme choisie : <b>Symétrie</b> et <b>Décalage</b>. Dans la pièce : <b>Ressort</b>, <b>Filetage</b> (clique sur un axe ou un trou, le pas ISO est proposé), <b>Nervure</b> (un simple trait d’esquisse entre deux parois) et, dans une extrusion, <b>Jusqu’à : une face</b>. <b>Autres formats</b> : 3MF, OBJ, et DXF d’une esquisse pour la découpe laser.</p>
    <h3>Gagner du temps</h3><p><b>Ctrl+K</b> (ou « Rechercher ») : tape ce que tu veux faire, par exemple « trou », « arrondir » ou « filet ». <b>Partager</b> donne un lien qui contient toute la pièce. <b>Versions</b> garde des états de ta pièce pour y revenir. Dans les paramètres, <b>+ Variante</b> enregistre un jeu de valeurs (M6, M8…) que tu rappelles en un clic. <b>Impression 3D</b> contrôle la pièce avant l’impression et la pose à plat automatiquement pour l’export STL et 3MF.</p>
    <h3>Outils</h3><p><b>Mesurer</b> : clique deux points. <b>Coupe</b> : regarde l’intérieur. <b>Mise en plan</b> : le plan 2D coté de ta pièce, à imprimer ou en PDF. <b>Importer</b> : ajoute un fichier STL, 3MF ou STEP, que tu peux ensuite étirer dans un seul sens, tourner et modifier. Coche « Centre de gravité » en bas pour l’afficher.</p>
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
  download(blob, `${safeName()}.gabarit`);
  const t = curTab();
  if (t && !isAsm() && !isBlank(doc)) { clearTimeout(libTimer); commitLib(t, doc, doc.name || "Pièce sans nom"); saveTabs(); renderTabs(); toast("Pièce enregistrée : un fichier dans tes téléchargements, et une copie dans « Mes pièces »."); }
  else { if (t && isAsm()) { t.dirty = false; saveTabs(); renderTabs(); } toast(isAsm() ? "Assemblage enregistré dans tes téléchargements." : "Pièce enregistrée dans tes téléchargements."); }
}
async function openFile(file) {
  if (DRAW_EXT.test(file.name)) { importDrawing(file); return; }
  if (MESH_EXT.test(file.name)) {
    // fichier d'impression 3D ou de CAO : nouvelle pièce qui le reprend
    const dlg = $("#dlg"); if (dlg?.open) dlg.close();
    if (!isBlank(doc)) openTab(emptyDoc());
    doc.name = file.name.replace(/\.[^.]+$/, ""); $("#docName").value = doc.name;
    await importBlob(file); return;
  }
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.features) && d.kind !== "assembly") throw new Error();
    if (d.kind === "assembly") d.features = d.features || [];
    if (!isAsm() || d.kind === "assembly") { openTab(d); toast(`« ${d.name || file.name} » ouvert${d.kind === "assembly" ? "" : "e"}.`); }
    else { addToLibrary(d); toast(`« ${d.name || file.name} » ajoutée à ta bibliothèque : clique sur « Insérer une pièce ».`); }
  } catch { toast("Ce fichier n’est pas une pièce Gabarit valide."); }
}

// ---------- Démarrage ----------
const viewer = new Viewer($("#view"));
viewer.onHandleHover = handleHover;
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
function toolLabel(k) { for (const tb of [toolbar(), TOOLBAR]) for (const [, g] of tb) for (const [kk, l] of g) if (kk === k) return l; return k; }
// Touche S : boîte à outils sous la souris (outils d'esquisse pendant l'esquisse).
let mouseAt = [innerWidth / 2, innerHeight / 2];
document.addEventListener("pointermove", (e) => { mouseAt = [e.clientX, e.clientY]; }, { passive: true });
const S_TOOLS = ["sketch", "extrude", "cut", "revolve", "hole", "fillet", "chamfer", "shell", "mirror", "pattern", "measure", "section"];
function shortcutBox() {
  closeMenu();
  const list = st.editSketch ? SK_ALL.map(([k, l]) => [k, l, () => sketcher.setTool(k)]) : S_TOOLS.map((k) => [k, toolLabel(k), () => toolAction(k)]);
  const m = h("div", { class: "menu sbox", id: "menu" }, ...list.map(([k, l, fn]) => h("button", { title: l, onclick: () => { closeMenu(); fn(); } }, h("span", { html: ICONS[k] || "" }), h("small", {}, l))));
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(mouseAt[0] - r.width / 2, innerWidth - r.width - 8)) + "px";
  m.style.top = Math.max(8, Math.min(mouseAt[1] - r.height / 2, innerHeight - r.height - 8)) + "px";
  setTimeout(() => document.addEventListener("pointerdown", closeMenuOutside, true), 0);
}
// Double-clic sur une face : l'étape qui l'a faite s'ouvre, et ses cotes s'affichent à côté de la souris.
const DIM_ENT = { rect: [["w", "Largeur"], ["h", "Hauteur"], ["r", "Rayon des coins"]], circle: [["d", "Diamètre"]], polygon: [["d", "Diamètre"], ["n", "Nombre de côtés", ""]], slot: [["w", "Largeur"]], ellipse: [["rx", "Demi-axe 1"], ["ry", "Demi-axe 2"]], text: [["h", "Hauteur des lettres"]] };
function closeDimCard() { $("#dimCard")?.remove(); }
function dimCard(f, x, y) {
  closeDimCard();
  const rows = [];
  // les cotes de l'étape : les mêmes cases que dans le panneau de gauche, reliées entre elles
  for (const inp of [...document.querySelectorAll("#props .field input[data-hk]")].slice(0, 6)) {
    const field = inp.closest(".field"); const label = field?.querySelector("label")?.textContent || ""; const unit = field?.querySelector(".unit")?.textContent || "";
    const mine = h("input", { type: "text", value: inp.value, spellcheck: "false", inputmode: "decimal", "data-mk": inp.dataset.hk });
    mine.addEventListener("input", () => { inp.value = mine.value; inp.dispatchEvent(new Event("input")); mine.classList.toggle("bad", inp.classList.contains("bad")); });
    mine.addEventListener("change", () => inp.dispatchEvent(new Event("change")));
    rows.push(h("div", { class: "field" }, h("label", {}, label), h("div", { class: "in" }, mine, unit ? h("span", { class: "unit" }, unit) : null)));
  }
  // les cotes du dessin d'origine, quand il est simple et sans contraintes
  const sk = f.sketch ? feat(f.sketch) : null; let more = 0;
  if (sk && !(sk.constraints || []).length) {
    const ents = (sk.entities || []).filter((e) => DIM_ENT[e.type] && !e.construction);
    if (ents.length && ents.length <= 3) for (const e of ents) for (const [key, label, unit] of DIM_ENT[e.type]) {
      if (key === "r" && !Number(e.r)) continue;
      rows.push(exprField(`${label} (${ENT_LABELS[e.type].toLowerCase()})`, e, key, unit ?? "mm")); more++;
    }
  }
  const card = h("div", { id: "dimCard", class: "dimcard" },
    h("div", { class: "dc-h" }, h("span", { class: "ic", html: ICONS[TYPES[f.type].icon] }), h("b", {}, f.name), h("button", { class: "x", title: "Fermer", "aria-label": "Fermer", onclick: closeDimCard }, "✕")),
    rows.length ? h("div", { class: "dc-b" }, ...rows) : h("div", { class: "dc-b dc-none" }, "Les réglages de cette étape sont dans le panneau de gauche."),
    h("div", { class: "dc-f" },
      sk ? h("button", { class: "btn", onclick: () => { closeDimCard(); openSketch(sk.id); } }, isSimple() ? "Modifier le dessin" : "Modifier l’esquisse") : null,
      h("button", { class: "btn primary", title: "Entrée", onclick: () => { closeDimCard(); validateFeature(); } }, "C’est bon")));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); e.stopPropagation(); if (e.target.classList.contains("bad")) return; e.target.blur(); closeDimCard(); validateFeature(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeDimCard(); cancelFeature(); }
  });
  const host = $(".stage"); host.append(card);
  const hr = host.getBoundingClientRect(), cr = card.getBoundingClientRect();
  card.style.left = Math.max(8, Math.min(x - hr.left + 14, hr.width - cr.width - 8)) + "px";
  card.style.top = Math.max(8, Math.min(y - hr.top - 24, hr.height - cr.height - 8)) + "px";
  const first = card.querySelector("input[type=text]"); if (first) { first.focus(); first.select(); }
}
let whoseBusy = false;
$("#view").addEventListener("dblclick", (e) => {
  if (st.editSketch || isAsm() || !st.mesh || st.pick || !workerReady || whoseBusy || viewer.pickMode || stageTool()) return;
  const fh = viewer.hitFace(e); if (!fh) return;
  clearFaceSel(); whoseBusy = true;
  const req = ++exportReq; const x = e.clientX, y = e.clientY; const stamp = JSON.stringify(doc);
  pendingExport.set(req, (owner) => {
    whoseBusy = false;
    if (stamp !== JSON.stringify(doc) || st.editSketch || st.pick) return; // la pièce a changé entre-temps
    const f = owner && feat(owner);
    if (!f) { toast("Je n’ai pas retrouvé l’étape qui a fait cette face. Choisis-la dans la liste à gauche."); return; }
    clearFaceSel(); select(f.id); dimCard(f, x, y);
  });
  setTimeout(() => { if (whoseBusy && pendingExport.has(req)) { pendingExport.delete(req); whoseBusy = false; } }, 20000);
  worker.postMessage({ type: "whose", req, doc, stopAt: st.stopAt ?? undefined, point: fh.point });
});
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
  // la barre se met à droite du pointeur ; près du bord, elle passe au-dessus, jamais sous la souris
  // (sinon le second clic d'un double-clic tomberait sur un de ses boutons)
  const fx = e.clientX - host.left + 12, fmax = host.width - 420; const fy = e.clientY - host.top;
  const box = h("div", { id: "faceAct", class: "face-act", style: `left:${Math.max(8, Math.min(fx, fmax))}px;top:${Math.max(8, fy - 20)}px` },
    h("span", { class: "fa-n" }, n > 1 ? `${n} choisies` : edges.length ? "Arête" : "Face"),
    ...btns, h("button", { class: "x", title: "Fermer (Échap)", onclick: () => clearFaceSel() }, "✕"));
  $(".stage").append(box);
  if (fx > fmax) { const bh = box.getBoundingClientRect().height; box.style.top = (fy - bh - 14 >= 8 ? fy - bh - 14 : fy + 22) + "px"; }
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
  getDoc: () => doc, loadDoc: (d) => { welcome(false); openTab(d); }, replaceDoc: (d) => { welcome(false); loadDoc(d); markDirty(); save(); }, mutate, renderParams, renderProps,
  setPrintDown: (g) => { if (g) doc.printDown = g; else delete doc.printDown; pushHistory(); },
  commands: () => commandList(), publish: () => publishPack(),
});
// Essai dans un meuble : il règle la taille, le sens de pose et le remplissage par les mêmes étapes que les boutons
// à côté de la vue (« Taille », « Tourner »), rangées à la fin de l'historique.
function tailSet(type, make, change, transient = false) {
  const f = tailStep(type);
  if (f) mutate(() => change(f), transient);
  else mutate((d) => { const n = make(); change(n); putFeature(d, n, tailAt(type)); }, transient);
}
meuble = createFurniture({
  h, $, fr, nf, toast, viewer, st, markTool, stepButtons, pas: pasMm,
  getScale: () => { const f = tailStep("scale"); if (!f) return 100; try { const v = evalExpr(f.k === undefined || f.k === "" ? 100 : f.k, varsMap(doc.params)); return v > 0 ? v : 100; } catch { return 100; } },
  setScale: (k, transient) => { const v = String(Math.round(k * 1000) / 1000); tailSet("scale", () => ({ id: newId("f"), type: "scale", name: nextName("scale"), k: v }), (f) => { f.k = v; }, transient); },
  // m : le geste à ajouter (matrice de orient.js), ou null pour remettre la pièce droite
  turn: (m) => {
    const f = tailStep("orient");
    if (!m && !f) return;
    tailSet("orient", () => ({ id: newId("f"), type: "orient", name: nextName("orient"), m: [...IDENT] }), (g) => { g.m = m ? omul(m, oread(g.m)) : [...IDENT]; });
    if (st.sel && feat(st.sel)?.type === "orient") renderProps();
  },
  // tailles visées [largeur, profondeur, hauteur] en mm, null = ce sens n'est pas étiré
  getFit: () => { const f = tailStep("fit"); return ["x", "y", "z"].map((a) => { if (!f || f[a] === null || f[a] === undefined || f[a] === "") return null; try { const v = evalExpr(f[a], varsMap(doc.params)); return v > 0 ? v : null; } catch { return null; } }); },
  setFit: (dims) => {
    const f = tailStep("fit");
    if (dims.every((v) => v === null)) { if (f) mutate((d) => { const i = d.features.indexOf(f); d.features.splice(i, 1); if (st.stopAt !== null && i < st.stopAt) st.stopAt--; if (st.sel === f.id) st.sel = null; }); if (f) renderProps(); return; }
    tailSet("fit", () => ({ id: newId("f"), type: "fit", name: nextName("fit"), x: null, y: null, z: null }), (g) => { ["x", "y", "z"].forEach((a, i) => { g[a] = dims[i] === null ? null : String(dims[i]); }); });
    if (st.sel && feat(st.sel)?.type === "fit") renderProps();
  },
  commit: () => pushHistory(),
  changed: () => { renderGestures(); renderCoach(); },
});
function stageTool() { return !!(extras?.isPrintOpen() || meuble?.isOpen()); } // la vue est occupée par un outil : pas de flèches ni de double-clic
const KEYS = {
  sketch: "dessin profil 2d croquis", extrude: "volume epaisseur bossage tirer", cut: "creuser enlever percer poche", revolve: "tourner tour axe rond",
  hole: "trou percer vis fraisage lamage insert ecrou m3 m4 m5 passage", fillet: "arrondi arrondir rayon conge", chamfer: "biseau casser angle", shell: "evider creux boite paroi",
  thread: "filet filetage vis taraud taraudage m3 m4 m5 m6 m8 m10 m12", helix: "ressort helice spirale", rib: "renfort raidisseur gousset",
  mirror: "miroir symetrique", pattern: "repeter copier grille cercle reseau", loft: "transition relier", sweep: "tuyau chemin glisser",
  draft: "demoulage incliner", import: "step stl ouvrir modele svg dxf logo dessin", measure: "distance cote longueur", section: "couper interieur",
  print: "impression imprimante 3d support surplomb orientation trancheur", meuble: "meuble etagere ikea kallax billy eket besta ivar bureau plateau lagkapten micke tablette lack boite trofast samla bac casier rangement ranger rentre tient gridfinity tiroir remplir aimant magasin", drawing: "plan 2d pdf imprimer cotation", plane: "plan reference decale incline",
  scale: "taille agrandir reduire echelle pourcentage plus grand plus petit dimension",
  stretch: "etirer agrandir rallonger allonger raccourcir section zone partie banc tige pied",
  shapes: "forme prete primitive boite cube cylindre sphere boule cone tube anneau tore etoile coeur engrenage texte",
};
function commandList() {
  const L = [];
  for (const [, g] of TOOLBAR) for (const [k, label] of g) L.push({ label, hint: TOOL_TIPS[k], keys: KEYS[k], when: () => !isAsm() && !st.editSketch, run: () => toolAction(k) });
  for (const [k, [label]] of Object.entries(SHAPES)) L.push({ label: `Forme prête : ${label}`, keys: "forme primitive ajouter poser " + k, when: () => !isAsm() && !st.editSketch, run: () => addShape(k) });
  L.push({ label: "Mode Simple", hint: "L’essentiel, avec des mots de tous les jours", keys: "debutant facile decouvrir", run: () => setMode("simple") },
    { label: "Mode Expert", hint: "Tous les outils", keys: "avance complet solidworks cao", run: () => setMode("expert") },
    { label: "Thème sombre", keys: "nuit noir dark couleur", run: () => applyTheme("dark") },
    { label: "Thème clair", keys: "jour blanc light couleur", run: () => applyTheme("light") });
  L.push({ label: "Tourner la pièce", hint: "Quart de tour, demi-tour, la coucher, la retourner, miroir", keys: "orientation sens axe 90 180 degres pivoter rotation coucher flanc cote retourner miroir inverser symetrique", when: () => !isAsm() && !st.editSketch, run: () => toolAction("orient") });
  const skKeys = { trim: " couper rogner raccourcir enlever ce qui dépasse ciseaux", fillet: " arrondir coin rayon arrondi", line: " trait droite segment" };
  for (const [k, label] of SK_ALL) L.push({ label: `Esquisse : ${label}`, keys: "dessiner " + k + (skKeys[k] || ""), when: () => !!st.editSketch, run: () => sketcher.setTool(k) });
  const act = (a) => document.querySelector(`[data-act=${a}]`)?.click();
  L.push(
    { label: "Nouvelle pièce ou nouvel assemblage", keys: "nouveau creer", run: () => newDialog() },
    { label: "Mes pièces", keys: "bibliotheque liste", run: () => libraryDialog() },
    { label: "Ouvrir un fichier", keys: "charger", run: () => act("open") },
    { label: "Enregistrer le fichier .gabarit", keys: "sauver sauvegarder", run: () => saveFile() },
    { label: "Partager par lien", keys: "envoyer lien url collaborer", run: () => extras.share() },
    { label: "Versions enregistrées", keys: "historique sauvegarde revenir", run: () => extras.versions() },
    { label: "Exporter en STL", keys: "impression trancheur", run: () => doExport("stl") },
    { label: "Pack de publication (3MF, STL, images, fiche)", hint: "Tout ce qu’il faut pour partager ta pièce sur un site de modèles 3D", keys: "publier partager makerworld bambu printables thingiverse zip photos", when: () => !isAsm(), run: () => publishPack() },
    { label: "Exporter en 3MF", keys: "impression trancheur bambu prusa cura", run: () => doExport("3mf") },
    { label: "Exporter en STEP", keys: "cao solidworks fusion", run: () => doExport("step") },
    { label: "Exporter en OBJ", keys: "blender rendu", run: () => doExport("obj") },
    { label: "Exporter une esquisse en DXF", keys: "laser cnc decoupe", run: () => moreFormats() },
    { label: "Ajouter un paramètre", keys: "variable cote nommee", when: () => !isAsm(), run: () => addParam() },
    { label: "Annuler", keys: "ctrl z retour", run: () => undoSay() },
    { label: "Rétablir", keys: "ctrl y refaire", run: () => redoSay() },
    { label: "Vue : recadrer", keys: "zoom tout voir", run: () => viewer.fit() },
    { label: "Vue : 3D", keys: "iso perspective", run: () => viewer.fit([1, -1.3, 0.9]) },
    { label: "Vue : face", run: () => viewer.fit([0, -1, 0]) }, { label: "Vue : dessus", run: () => viewer.fit([0, 0, 1]) }, { label: "Vue : droite", run: () => viewer.fit([1, 0, 0]) },
    { label: "Aide", keys: "comment aide tutoriel", run: () => help() },
  );
  return L;
}
function newDialog() {
  const dlg = $("#dlg"); dlg.innerHTML = "";
  const go = (d) => { dlg.close(); openTab(d); if (!d.kind && !isSimple()) toolAction("sketch"); };
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
        h("td", {}, h("button", { class: "btn", onclick: () => { dlg.close(); openTab(lib[n]); } }, "Ouvrir")),
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
    const moved = [...q]; moved[0] = at[0]; moved[1] = at[1]; if (moved.length === 3 && (moved[2] === undefined || moved[2] === "")) moved.length = 2;
    ent.pts[ref.k] = moved;
    if (f.constraints?.length && !solveAndWrite(f, [{ ref, at }])) ent.pts[ref.k] = old;
  }, true),
  select: (id) => { st.skSel = id; renderProps(); },
  say: (m) => toast(m),
  onTool: () => { $("#relBox")?.remove(); renderSketchTools(); if (st.editSketch) renderProps(); },
  onPick: (e, still) => relBox(e, still),
  onView: () => syncSketchView(),
});
renderTools();
$("#views").append(
  h("div", { class: "row" }, h("button", { title: "Tout voir (F)", onclick: () => viewer.fit() }, "Recadrer"), h("button", { title: "Vue isométrique (Ctrl 7)", onclick: () => viewer.fit([1, -1.3, 0.9]) }, "3D")),
  h("div", { class: "row" }, h("button", { class: "wide", id: "sizeBtn", title: "Agrandir ou réduire toute la pièce, en % ou en mm", onclick: () => toolAction("scale") }, h("i", { html: ICONS.scale }), "Taille")),
  h("div", { class: "row" }, h("button", { class: "wide", id: "turnBtn", title: "Tourner toute la pièce : quart de tour, demi-tour, la coucher, la retourner, miroir", onclick: () => toolAction("orient") }, h("i", { html: ICONS.orient }), "Tourner")),
  h("label", { class: "pas", title: "Taille des plus petits carreaux. Les flèches, les boutons − et + et le dessin avancent de ce pas (dix fois plus fin avec Maj)." }, "Pas",
    h("select", { id: "pasSel", onchange: (e) => setPas(Number(e.target.value)) }, PAS.map((v) => h("option", { value: v, selected: v === pasMm() }, pasText(v))))),
);
// Change le pas partout : sol, flèches, boutons, dessin.
function setPas(v, quiet) {
  if (PAS.includes(v)) setPref("gabarit-pas", String(v));
  sketcher.snapStep = v; viewer.setPas(PAS.includes(v) ? v : pasMm());
  const a = $("#pasSel"); if (a && PAS.includes(v)) a.value = String(v);
  const b = $("#skPas"); if (b) b.value = String(v);
  if (st.editSketch) sketcher.render();
  if (!quiet) toast(`Pas de ${pasText(v)} : zoome pour voir les petits carreaux. Avec Maj, les flèches vont dix fois plus fin.`, 3200);
}
setPas(pasMm(), true);
viewer.mountCube($("#views"), (dir) => viewer.fit(dir));
document.querySelector(".file").addEventListener("click", (e) => {
  const mb = e.target.closest("[data-mode]"); if (mb) { setMode(mb.dataset.mode); return; }
  const a = e.target.closest("button")?.dataset.act; if (!a) return;
  if (a === "theme") applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  if (a === "new") newDialog();
  if (a === "open") $("#fileIn").click();
  if (a === "save") saveFile();
  if (a === "undo") undoSay();
  if (a === "redo") redoSay();
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
$("#docName").addEventListener("change", (e) => { if (isAsm()) { doc.name = e.target.value.trim() || "Assemblage sans nom"; pushHistory(); return; } const want = e.target.value.trim() || "Pièce sans nom", t = curTab();
  const nm = want === doc.name || isBlank(doc) || (t?.wrote || []).includes(want) ? want : freeName(want, null, t?.id);
  if (nm !== want) { e.target.value = nm; toast(`Une autre pièce s’appelle déjà « ${want} » : celle-ci s’appelle « ${nm} ».`); }
  mutate(() => { doc.name = nm; }); });
$("#fileIn").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ""; });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
  const mod = e.ctrlKey || e.metaKey;
  // un calcul qui dure : Échap l'annule avant toute autre chose
  if (e.key === "Escape" && st.building && Date.now() - buildStart > 1200 && !isAsm()) { e.preventDefault(); e.stopPropagation(); cancelBuild(); return; }
  if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); extras.palette(); return; }
  if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { undoKey(e, true); return; }
  if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { undoKey(e, false); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveFile(); return; }
  if (mod && /^[1-8]$/.test(e.key) && !typing && !st.editSketch) {
    e.preventDefault();
    const V = { 1: [0, -1, 0], 2: [0, 1, 0], 3: [-1, 0, 0], 4: [1, 0, 0], 5: [0, 0, 1], 6: [0, 0, -1], 7: [1, -1.3, 0.9] };
    if (e.key === "8") { if (st.facePlane) viewer.fit(st.facePlane.n); else toast("Choisis d’abord une face plane (clic), puis Ctrl 8."); }
    else viewer.fit(V[e.key]);
    return;
  }
  // Entrée dans un champ du panneau de réglages : la valeur est prise et l'étape est validée
  if (typing && e.key === "Enter" && !st.editSketch && !isAsm() && document.activeElement.tagName === "INPUT" && document.activeElement.closest("#props")
    && (st.pick || (st.sel && feat(st.sel) && feat(st.sel).type !== "sketch"))) {
    if (document.activeElement.classList.contains("bad")) return;
    e.preventDefault(); document.activeElement.blur(); validateFeature(); return;
  }
  // Échap dans un champ des réglages : le champ est lâché, puis Échap agit comme ailleurs (annuler l'étape)
  if (typing && e.key === "Escape" && document.activeElement.closest("#props") && !isAsm()) { document.activeElement.blur(); if (st.editSketch) return; }
  else if (typing) return;
  if (e.key === "Escape" && $("#menu")) { closeMenu(); return; }
  if (e.key === "Escape" && $("#shapes")) { closeShapes(); return; }
  if (e.key === "Escape") {
    if (st.editSketch) { if ($("#relBox")) { $("#relBox").remove(); return; } if (!sketcher.cancel()) { st.skSel = null; sketcher.sel = null; sketcher.subs = []; renderProps(); sketcher.render(); } return; }
    if (st.pick) { cancelFeature(); return; }
    if (viewer.pickMode) { viewer.setPick(null); banner(null); return; }
    if (st.pre?.edges.length || st.pre?.faces.length) { clearFaceSel(); return; }
    if (st.sel && feat(st.sel) && !isAsm()) { cancelFeature(); return; }
    select(null); return;
  }
  if (e.key === "Enter" && st.editSketch && ["poly", "path", "spline", "line"].includes(sketcher.draft?.type)) { sketcher.finishPoly(); return; }
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
// onglets : le document actif est celui enregistré en dernier
tabs.list = tabs.list.filter((t) => t && t.id);
if (!tabs.list.some((t) => t.id === tabs.active)) { const id = newId("t"); tabs.list.push({ id, name: doc.name }); tabs.active = id; }
// onglets d'avant la v1.4 : une pièce déjà rangée telle quelle dans « Mes pièces » est « enregistrée », les autres non
{
  const lib = library();
  for (const t of tabs.list) {
    if (t.base !== undefined) continue;
    const d = tabDoc(t.id), n = d?.name || t.name || "Pièce sans nom";
    if (!d || isBlank(d)) Object.assign(t, { dirty: false, base: "new", baseName: n, wrote: [] });
    else if (d.kind === "assembly") Object.assign(t, { dirty: !!(d.components || []).length, base: "new", baseName: n, wrote: [] });
    else { const same = !!lib[n] && sameDoc(lib[n], d); Object.assign(t, { dirty: !same, base: same ? "lib" : "new", baseName: n, wrote: same ? [n] : [] }); }
  }
  saveTabs();
}
renderTabs();
applyMode(); applyTheme();
if (!location.hash.startsWith("#p=")) welcome(true);
typoTree(document.body);
startWorker();
extras.openFromHash();
window.addEventListener("hashchange", () => extras.openFromHash());
window.gabarit = { get doc() { return doc; }, st, viewer, sketcher, loadDoc, openSketch, exampleDoc, emptyAsm, library, addToLibrary, asmUI, openTab, closeTab, mutate, insertFeature, select, showWelcome: () => welcome(true), rebuild: () => requestBuild(0), get history() { return { n: hist.length, i: hidx }; } };
if ("launchQueue" in window) window.launchQueue.setConsumer(async (p) => { for (const fh of p.files || []) openFile(await fh.getFile()); });
