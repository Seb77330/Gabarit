// Mode assemblage : composants, contraintes d'assemblage (solveur de positions), nomenclature, interférences.
import { ICONS } from "./icons.js";

const D2R = Math.PI / 180;
const COLORS = ["#c9d1da", "#e2a66b", "#8fb7d9", "#a8cf8e", "#d9a1c4", "#d8cf7a", "#9fd3c7", "#c7a4e8"];
const MLABEL = { coincident: "Coïncidence", concentric: "Concentrique", distance: "Distance", parallel: "Parallèles" };

// ----- petite algèbre -----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => mul(a, 1 / (len(a) || 1));
// R = Rz·Ry·Rx (rotation autour de X, puis Y, puis Z, axes fixes), angles en degrés
export function rotMat(r) {
  const [x, y, z] = r.map((v) => v * D2R);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}
const mv = (M, v) => [dot(M[0], v), dot(M[1], v), dot(M[2], v)];
const mm = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
function eulerOf(M) {
  const sy = Math.max(-1, Math.min(1, -M[2][0]));
  const y = Math.asin(sy);
  let x, z;
  if (Math.abs(sy) < 0.99999) { x = Math.atan2(M[2][1], M[2][2]); z = Math.atan2(M[1][0], M[0][0]); }
  else { x = Math.atan2(-M[1][2], M[1][1]); z = 0; }
  return [x / D2R, y / D2R, z / D2R].map((v) => Math.round(v * 1e6) / 1e6);
}
// rotation qui amène u sur v (vecteurs unitaires)
function alignMat(u, v) {
  const c = dot(u, v);
  if (c > 0.999999) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let ax = cross(u, v);
  if (len(ax) < 1e-9) { ax = Math.abs(u[0]) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0]); }
  ax = nrm(ax); const a = Math.acos(Math.max(-1, Math.min(1, c)));
  const [x, y, z] = ax, C = Math.cos(a), S = Math.sin(a), t = 1 - C;
  return [[t * x * x + C, t * x * y - S * z, t * x * z + S * y], [t * x * y + S * z, t * y * y + C, t * y * z - S * x], [t * x * z - S * y, t * y * z + S * x, t * z * z + C]];
}
const world = (c, p) => add(mv(rotMat(c.rot), p), c.pos);
const wdir = (c, d) => mv(rotMat(c.rot), d);

function mateResiduals(m, A, B) {
  const r = [];
  if (m.type === "coincident" || m.type === "distance" || m.type === "parallel") {
    const na = wdir(A, m.a.d), nb = wdir(B, m.b.d);
    const s = m.flip ? -1 : 1;
    // faces face à face (normales opposées) sauf si inversé
    const t = add(na, mul(nb, s)); r.push(t[0] * 20, t[1] * 20, t[2] * 20);
    if (m.type !== "parallel") {
      const pa = world(A, m.a.p), pb = world(B, m.b.p);
      r.push(dot(sub(pa, pb), nb) - (m.type === "distance" ? Number(m.value) || 0 : 0));
    }
  } else if (m.type === "concentric") {
    const da = wdir(A, m.a.d), db = wdir(B, m.b.d);
    const cr = cross(da, db); r.push(cr[0] * 20, cr[1] * 20, cr[2] * 20);
    const pa = world(A, m.a.p), pb = world(B, m.b.p);
    const off = cross(sub(pa, pb), nrm(db)); r.push(off[0], off[1], off[2]);
  }
  return r;
}

function solveLin(A, b) {
  const n = b.length; const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-14) continue; [M[c], M[p]] = [M[p], M[c]];
    for (let i = 0; i < n; i++) { if (i === c) continue; const f = M[i][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[i][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-14 ? 0 : row[n] / row[i]));
}

// Résout toutes les contraintes : déplace le moins possible les composants libres.
export function solveAssembly(asm) {
  const comps = new Map(asm.components.map((c) => [c.id, c]));
  const mates = asm.mates.filter((m) => !m.suppressed && comps.has(m.a.comp) && comps.has(m.b.comp));
  const free = asm.components.filter((c) => !c.fixed && mates.some((m) => m.a.comp === c.id || m.b.comp === c.id));
  const V = []; for (const c of free) { for (let k = 0; k < 3; k++) V.push({ c, arr: "pos", k }); for (let k = 0; k < 3; k++) V.push({ c, arr: "rot", k }); }
  const res = () => mates.flatMap((m) => mateResiduals(m, comps.get(m.a.comp), comps.get(m.b.comp)));
  let r = res(); let norm = Math.hypot(...r);
  for (let it = 0; it < 80 && norm > 1e-8 && V.length; it++) {
    const m = r.length, n = V.length; const J = Array.from({ length: m }, () => new Array(n).fill(0));
    V.forEach((v, j) => { const x0 = v.c[v.arr][v.k]; const hs = 1e-6 * Math.max(1, Math.abs(x0)); v.c[v.arr][v.k] = x0 + hs; const r2 = res(); v.c[v.arr][v.k] = x0; for (let i = 0; i < m; i++) J[i][j] = (r2[i] - r[i]) / hs; });
    // pas de norme minimale ; les angles pèsent comme des millimètres divisés par 10
    const W = V.map((v) => (v.arr === "rot" ? 10 : 1));
    const A = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, k) => { let s = 0; for (let j = 0; j < n; j++) s += J[i][j] * J[k][j] * W[j]; return s + (i === k ? 1e-9 : 0); }));
    const y = solveLin(A, r);
    const dx = V.map((_, j) => { let s = 0; for (let i = 0; i < m; i++) s += J[i][j] * y[i]; return -s * W[j]; });
    const x0 = V.map((v) => v.c[v.arr][v.k]); let t = 1, ok = false;
    for (let ls = 0; ls < 14; ls++) {
      V.forEach((v, j) => (v.c[v.arr][v.k] = x0[j] + t * dx[j]));
      const r2 = res(), n2 = Math.hypot(...r2);
      if (n2 < norm) { r = r2; norm = n2; ok = true; break; }
      t /= 2;
    }
    if (!ok) { V.forEach((v, j) => (v.c[v.arr][v.k] = x0[j])); break; }
  }
  for (const c of free) { c.pos = c.pos.map((v) => Math.round(v * 1e6) / 1e6); c.rot = c.rot.map((v) => Math.round(v * 1e6) / 1e6); }
  return { ok: norm < 1e-4, residual: norm };
}

// Pré-positionne le composant mobile pour que la nouvelle contrainte soit presque satisfaite.
function prealign(m, A, B) {
  if (m.type === "coincident" || m.type === "distance" || m.type === "parallel") {
    const na = wdir(A, m.a.d), nb = wdir(B, m.b.d);
    const target = mul(nb, m.flip ? 1 : -1);
    const Rm = alignMat(nrm(na), nrm(target));
    const R = mm(Rm, rotMat(A.rot)); A.rot = eulerOf(R);
    if (m.type !== "parallel") {
      const pa = world(A, m.a.p), pb = world(B, m.b.p);
      const d = dot(sub(pa, pb), nb) - (m.type === "distance" ? Number(m.value) || 0 : 0);
      A.pos = sub(A.pos, mul(nb, d));
    }
  } else if (m.type === "concentric") {
    const da = wdir(A, m.a.d), db = nrm(wdir(B, m.b.d));
    const target = dot(da, db) >= 0 ? db : mul(db, -1);
    const R = mm(alignMat(nrm(da), target), rotMat(A.rot)); A.rot = eulerOf(R);
    const pa = world(A, m.a.p), pb = world(B, m.b.p);
    const v = sub(pa, pb); const perp = sub(v, mul(db, dot(v, db)));
    A.pos = sub(A.pos, perp);
  }
}

export function createAssemblyUI(ctx) {
  const { h, $, nf, fr, toast, banner, viewer, newId } = ctx;
  let asmData = new Map(); // id -> { mesh, error }
  let selComp = null, selMate = null, explode = 0, interf = null, req = 0, built = false, fitCount = 0;
  const doc = () => ctx.getDoc();
  const comps = () => doc().components || (doc().components = []);
  const mates = () => doc().mates || (doc().mates = []);
  const keyOf = (c) => JSON.stringify(c.src).length + ":" + hash(JSON.stringify(c.src));
  function hash(s) { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return x; }

  function build() {
    const list = comps().map((c) => ({ id: c.id, key: keyOf(c), src: c.src }));
    ctx.showBusy(true, "Calcul de l’assemblage…");
    ctx.post({ type: "asm", req: ++req, comps: list });
  }
  function onBuilt(m) {
    if (m.req !== req) return;
    ctx.showBusy(false);
    asmData = new Map(m.parts.map((p) => [p.id, p]));
    viewer.setAssembly(poses().map((p) => ({ ...p, data: asmData.get(p.id)?.mesh })));
    const n = comps().length;
    if (!built || n > fitCount) { viewer.fitBox(built ? undefined : [1, -1.3, 0.9]); built = true; }
    fitCount = n;
    render();
  }
  function poses() {
    const asmC = assemblyCenter();
    return comps().map((c) => {
      let ex = [0, 0, 0];
      if (explode && asmC) { const cc = compCenter(c); if (cc) ex = mul(sub(cc, asmC), explode); }
      return { id: c.id, pos: c.pos, rot: c.rot, color: c.color, hidden: c.hidden, selected: c.id === selComp, explode: ex };
    });
  }
  function compCenter(c) { const m = asmData.get(c.id)?.mesh; if (!m) return null; const [a, b] = m.bb; return world(c, mul(add(a, b), 0.5)); }
  function assemblyCenter() { const cs = comps().map(compCenter).filter(Boolean); if (!cs.length) return null; return mul(cs.reduce(add, [0, 0, 0]), 1 / cs.length); }
  function refreshPoses() { viewer.updateAssembly(poses()); }

  function changed(rebuild = false) { ctx.commit(); if (rebuild) build(); else refreshPoses(); render(); }

  // ----- outils -----
  const TOOLS = [
    [["insert", "Insérer une pièce", "import"]],
    [["coincident", "Coïncidence", "plane"], ["concentric", "Concentrique", "revolve"], ["distance", "Distance", "measure"], ["parallel", "Parallèles", "mirror"]],
    [["interf", "Interférences", "section"], ["explode", "Vue éclatée", "pattern"], ["bom", "Nomenclature", "drawing"]],
    [["measure", "Mesurer", "measure"], ["section", "Coupe", "section"]],
  ];
  function renderTools() {
    const t = $("#tools"); t.innerHTML = "";
    for (const g of TOOLS) t.append(h("div", { class: "tgroup" }, g.map(([k, label, ic]) => h("button", { class: "tbtn", "data-tool": k, onclick: () => tool(k) }, h("span", { html: ICONS[ic] }), label))));
  }
  function tool(k) {
    if (k === "insert") return insertDialog();
    if (k === "section") return ctx.toggleSection();
    if (k === "measure") return measure();
    if (k === "interf") return checkInterf();
    if (k === "bom") return bom();
    if (k === "explode") { explode = explode ? 0 : 0.8; refreshPoses(); $(`.tbtn[data-tool=explode]`)?.classList.toggle("on", !!explode); return; }
    if (MLABEL[k]) return startMate(k);
  }

  // ----- insertion -----
  function insertDialog() {
    const dlg = $("#dlg"); dlg.innerHTML = "";
    const lib = ctx.library();
    const names = Object.keys(lib).sort((a, b) => a.localeCompare(b, "fr"));
    const add = (name, src) => { dlg.close(); insertComponent(name, src); };
    dlg.append(h("div", { class: "dh" }, "Insérer une pièce"),
      h("div", { class: "db" },
        names.length ? h("p", {}, "Tes pièces enregistrées dans ce navigateur :") : h("p", {}, "Aucune pièce dans ta bibliothèque pour l’instant. Chaque pièce que tu crées y est ajoutée automatiquement."),
        h("div", { class: "planes", style: "padding:4px 0" }, names.map((n) => h("button", { class: "btn", onclick: () => add(n, { kind: "part", doc: lib[n] }) }, h("b", {}, n), ` (${lib[n].features.length} étape(s))`)))),
      h("div", { class: "df" },
        h("button", { class: "btn", onclick: () => { dlg.close(); fileInsert(); } }, "Depuis un fichier (.gabarit, STEP, STL)…"),
        h("button", { class: "btn", onclick: () => dlg.close() }, "Annuler")));
    dlg.showModal();
  }
  function fileInsert() {
    const inp = h("input", { type: "file", accept: ".gabarit,.json,.step,.stp,.stl", hidden: true });
    inp.addEventListener("change", async () => {
      const f = inp.files[0]; if (!f) return;
      if (/\.(gabarit|json)$/i.test(f.name)) {
        try { const d = JSON.parse(await f.text()); if (!Array.isArray(d.features)) throw new Error(); insertComponent(d.name || f.name, { kind: "part", doc: d }); ctx.addToLibrary(d); }
        catch { toast("Ce fichier n’est pas une pièce Gabarit."); }
      } else {
        if (f.size > 25e6) { toast("Fichier trop gros (25 Mo au maximum)."); return; }
        const buf = new Uint8Array(await f.arrayBuffer()); let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        insertComponent(f.name.replace(/\.[^.]+$/, ""), { kind: /\.stl$/i.test(f.name) ? "stl" : "step", data: btoa(bin), file: f.name });
      }
    });
    document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
  }
  function insertComponent(name, src) {
    const list = comps();
    const n = list.filter((c) => c.name.replace(/ <\d+>$/, "") === name).length;
    // place la nouvelle pièce à côté des autres
    let x = 0;
    for (const c of list) { const m = asmData.get(c.id)?.mesh; if (m) x = Math.max(x, c.pos[0] + m.bb[1][0] + 20); }
    const c = { id: newId("k"), name: `${name} <${n + 1}>`, src, pos: [list.length ? x : 0, 0, 0], rot: [0, 0, 0], color: COLORS[list.length % COLORS.length], fixed: list.length === 0, hidden: false };
    list.push(c); selComp = c.id; selMate = null;
    changed(true);
    if (list.length === 1) toast("Premier composant : il est fixe. Les suivants se positionnent par rapport à lui.");
  }

  // ----- contraintes d'assemblage -----
  function startMate(type) {
    if (comps().length < 2) { toast("Insère au moins deux pièces."); return; }
    const wantCyl = type === "concentric";
    const what = wantCyl ? "une face cylindrique (trou, axe)" : "une face plane";
    const okFace = (hit) => (wantCyl ? !!hit.info?.cyl : !!hit.info?.plane);
    let first = null;
    banner(`Clique ${what} de la pièce à déplacer.`, [["Annuler", stop]]);
    viewer.setPick({ kind: "asm", filter: okFace, onPick: (hit) => {
      if (!okFace(hit)) { toast(`Choisis ${what}.`); return; }
      if (!first) { first = hit; banner(`Clique maintenant ${what} de destination, sur une autre pièce.`, [["Annuler", stop]]); return; }
      if (hit.comp === first.comp) { toast("Choisis une face d’une autre pièce."); return; }
      let A = first, B = hit;
      const cA = comps().find((c) => c.id === A.comp), cB = comps().find((c) => c.id === B.comp);
      if (cA.fixed && !cB.fixed) { [A, B] = [B, A]; }
      const ref = (x) => (wantCyl ? { comp: x.comp, kind: "axis", p: x.info.p, d: x.info.d } : { comp: x.comp, kind: "plane", p: x.info.c, d: x.info.n });
      const m = { id: newId("m"), type, a: ref(A), b: ref(B), flip: false, value: type === "distance" ? "10" : undefined };
      const cm = comps().find((c) => c.id === m.a.comp), cb = comps().find((c) => c.id === m.b.comp);
      if (cm.fixed) { toast("Les deux pièces sont fixes : décoche « Fixe » sur l’une d’elles."); stop(); return; }
      prealign(m, cm, cb);
      mates().push(m);
      const r = solveAssembly(doc());
      stop(); selMate = m.id; selComp = null;
      changed();
      if (!r.ok) toast("Cette contrainte n’est pas compatible avec les autres. Inverse-la ou supprime-la.");
    } });
    function stop() { viewer.setPick(null); banner(null); }
  }

  // ----- outils divers -----
  function measure() {
    let pts = [];
    banner("Clique deux points sur les pièces.", [["Fermer", stop]]);
    viewer.setPick({ kind: "asm", onPick: (hit) => {
      if (pts.length >= 2) pts = [];
      pts.push(hit.point); viewer.setMeasure(pts);
      if (pts.length === 2) { const d = sub(pts[1], pts[0]); banner(`Distance : ${nf(len(d), 2)} mm (X ${nf(Math.abs(d[0]), 2)} · Y ${nf(Math.abs(d[1]), 2)} · Z ${nf(Math.abs(d[2]), 2)})`, [["Fermer", stop]]); }
    } });
    function stop() { viewer.setPick(null); viewer.setMeasure([]); banner(null); }
  }
  function placedList() { return comps().filter((c) => !c.hidden && asmData.get(c.id)?.mesh).map((c) => ({ id: c.id, name: c.name, color: c.color, pos: c.pos, rot: c.rot })); }
  function checkInterf() {
    ctx.showBusy(true, "Recherche des interférences…");
    ctx.request({ type: "asmInterf", comps: placedList() }, (list) => {
      ctx.showBusy(false); interf = list;
      const name = (id) => comps().find((c) => c.id === id)?.name || "?";
      const dlg = $("#dlg"); dlg.innerHTML = "";
      dlg.append(h("div", { class: "dh" }, "Interférences"), h("div", { class: "db" },
        list.length ? h("ul", {}, list.map((x) => h("li", {}, `${name(x.a)} et ${name(x.b)} se chevauchent de ${nf(x.volume, 2)} mm³`))) : h("p", {}, "Aucune interférence : les pièces ne se chevauchent pas.")),
      h("div", { class: "df" }, h("button", { class: "btn primary", onclick: () => dlg.close() }, "Fermer")));
      dlg.showModal();
    });
  }
  function bomRows() {
    const rows = new Map();
    for (const c of comps()) {
      const base = c.name.replace(/ <\d+>$/, "");
      const m = asmData.get(c.id)?.mesh; const mat = c.src.kind === "part" ? ctx.material(c.src.doc.material) : ["—", 0];
      const r = rows.get(base) || { name: base, qty: 0, mat: mat[0], mass: m ? m.volume / 1000 * mat[1] : 0 };
      r.qty++; rows.set(base, r);
    }
    return [...rows.values()];
  }
  function bom() {
    const rows = bomRows();
    const total = rows.reduce((s, r) => s + r.qty * r.mass, 0);
    const csv = ["Repère;Désignation;Quantité;Matière;Masse unitaire (g)", ...rows.map((r, i) => `${i + 1};${r.name};${r.qty};${r.mat};${nf(r.mass, 1)}`)].join("\n");
    const dlg = $("#dlg"); dlg.innerHTML = "";
    dlg.append(h("div", { class: "dh" }, "Nomenclature"), h("div", { class: "db" },
      h("table", { class: "bom" }, h("tr", {}, ["Rep.", "Désignation", "Qté", "Matière", "Masse unit."].map((t) => h("th", {}, t))),
        rows.map((r, i) => h("tr", {}, h("td", {}, i + 1), h("td", {}, r.name), h("td", {}, r.qty), h("td", {}, r.mat), h("td", {}, nf(r.mass, 1) + " g")))),
      h("p", {}, `Masse totale : ${nf(total, 1)} g`)),
    h("div", { class: "df" }, h("button", { class: "btn", onclick: () => ctx.download(new Blob(["﻿" + csv], { type: "text/csv" }), `${ctx.safeName()} - nomenclature.csv`) }, "Télécharger (tableur)"), h("button", { class: "btn primary", onclick: () => dlg.close() }, "Fermer")));
    dlg.showModal();
  }

  // ----- panneaux -----
  function render() { renderTree(); renderProps(); renderStatus(); }
  function renderTree() {
    const t = $("#tree"); t.innerHTML = "";
    t.append(h("div", { class: "feat origin" }, h("span", { class: "ic", html: ICONS.origin }), h("span", { class: "nm" }, "Origine")));
    t.append(h("h2", {}, "Composants"));
    for (const c of comps()) {
      const err = asmData.get(c.id)?.error;
      t.append(h("div", { class: "feat" + (c.id === selComp ? " sel" : "") + (c.hidden ? " off" : ""), onclick: () => { selComp = c.id; selMate = null; refreshPoses(); render(); } },
        h("span", { class: "swatch", style: `background:${c.color}` }), h("span", { class: "nm" }, (c.fixed ? "(f) " : "") + c.name), err ? h("span", { class: "err", title: err }) : null));
    }
    if (!comps().length) t.append(h("div", { class: "param-empty", style: "padding:6px 10px" }, "Clique sur « Insérer une pièce » pour commencer."));
    t.append(h("h2", {}, "Contraintes d’assemblage"));
    for (const m of mates()) {
      const n = (id) => comps().find((c) => c.id === id)?.name || "?";
      t.append(h("div", { class: "feat" + (m.id === selMate ? " sel" : "") + (m.suppressed ? " off" : ""), onclick: () => { selMate = m.id; selComp = null; refreshPoses(); render(); } },
        h("span", { class: "ic", html: ICONS[m.type === "concentric" ? "revolve" : m.type === "parallel" ? "mirror" : "plane"] }), h("span", { class: "nm" }, `${MLABEL[m.type]} (${n(m.a.comp)}, ${n(m.b.comp)})`)));
    }
    if (!mates().length) t.append(h("div", { class: "param-empty", style: "padding:6px 10px" }, "Aucune contrainte : utilise « Coïncidence » ou « Concentrique » pour assembler les pièces."));
  }
  function num(label, obj, key, i, unit) {
    const inp = h("input", { type: "text", value: String(obj[key][i]), inputmode: "decimal", onchange: (e) => { const v = Number(e.target.value.replace(",", ".")); if (!isFinite(v)) { e.target.value = obj[key][i]; return; } obj[key][i] = v; solveAssembly(doc()); changed(); } });
    return h("div", { class: "field" }, h("label", {}, label), h("div", { class: "in" }, inp, h("span", { class: "unit" }, unit)));
  }
  function renderProps() {
    const P = $("#props"); P.innerHTML = "";
    const c = comps().find((x) => x.id === selComp);
    const m = mates().find((x) => x.id === selMate);
    if (c) {
      P.append(h("div", { class: "head" }, h("span", { class: "swatch big", style: `background:${c.color}` }), h("input", { value: c.name, onchange: (e) => { c.name = e.target.value.trim() || c.name; changed(); } })));
      const err = asmData.get(c.id)?.error; if (err) P.append(h("div", { class: "note err" }, err));
      P.append(h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!c.fixed, onchange: (e) => { c.fixed = e.target.checked; changed(); } }), "Fixe (ne bouge pas)"),
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!c.hidden, onchange: (e) => { c.hidden = e.target.checked; changed(); } }), "Masquer"),
        h("div", { class: "field" }, h("label", {}, "Couleur"), h("input", { type: "color", value: c.color, oninput: (e) => { c.color = e.target.value; refreshPoses(); }, onchange: () => changed() })),
        h("h2", {}, "Position"), num("X", c, "pos", 0, "mm"), num("Y", c, "pos", 1, "mm"), num("Z", c, "pos", 2, "mm"),
        h("h2", {}, "Rotation"), num("Autour de X", c, "rot", 0, "°"), num("Autour de Y", c, "rot", 1, "°"), num("Autour de Z", c, "rot", 2, "°"),
        h("div", { class: "btnrow" },
          h("button", { class: "btn", onclick: () => { c.rot[2] = (c.rot[2] + 90) % 360; solveAssembly(doc()); changed(); } }, "Tourner de 90°"),
          c.src.kind === "part" ? h("button", { class: "btn", onclick: () => updateFromLibrary(c) }, "Mettre à jour la pièce") : null,
          h("button", { class: "btn", onclick: () => insertComponent(c.name.replace(/ <\d+>$/, ""), JSON.parse(JSON.stringify(c.src))) }, "Dupliquer"),
          h("button", { class: "btn danger", onclick: () => removeComp(c.id) }, "Supprimer")));
      if (c.src.kind === "part") P.append(h("div", { class: "note" }, "Pour modifier cette pièce, ouvre-la depuis ta bibliothèque (Nouveau → Pièce), change-la, puis clique ici sur « Mettre à jour la pièce »."));
      return;
    }
    if (m) {
      P.append(h("div", { class: "head" }, h("span", { class: "ic", html: ICONS.plane }), h("input", { value: MLABEL[m.type], disabled: true })));
      if (m.type === "distance") P.append(h("div", { class: "field" }, h("label", {}, "Distance"), h("div", { class: "in" }, h("input", { type: "text", value: m.value, onchange: (e) => { m.value = e.target.value.replace(",", "."); solveAssembly(doc()); changed(); } }), h("span", { class: "unit" }, "mm"))));
      P.append(h("div", { class: "btnrow" },
        m.type !== "concentric" ? h("button", { class: "btn", onclick: () => { m.flip = !m.flip; prealign(m, comps().find((x) => x.id === m.a.comp), comps().find((x) => x.id === m.b.comp)); solveAssembly(doc()); changed(); } }, "Inverser le sens") : null,
        h("button", { class: "btn", onclick: () => { m.suppressed = !m.suppressed; solveAssembly(doc()); changed(); } }, m.suppressed ? "Réactiver" : "Désactiver"),
        h("button", { class: "btn danger", onclick: () => { doc().mates = mates().filter((x) => x !== m); selMate = null; changed(); } }, "Supprimer")));
      return;
    }
    P.append(h("h2", {}, "Assemblage"), h("div", { class: "note" }, "Insère des pièces, puis assemble-les : « Coïncidence » plaque deux faces planes l’une contre l’autre, « Concentrique » aligne deux trous ou axes, « Distance » écarte deux faces."));
  }
  function updateFromLibrary(c) {
    const base = c.name.replace(/ <\d+>$/, ""); const lib = ctx.library();
    const d = lib[base] || lib[c.src.doc?.name];
    if (!d) { toast("Pièce introuvable dans ta bibliothèque."); return; }
    for (const x of comps()) if (x.src.kind === "part" && (x.src.doc?.name === d.name)) x.src = { kind: "part", doc: JSON.parse(JSON.stringify(d)) };
    changed(true); toast("Pièce mise à jour dans l’assemblage.");
  }
  function removeComp(id) {
    doc().components = comps().filter((x) => x.id !== id);
    doc().mates = mates().filter((m) => m.a.comp !== id && m.b.comp !== id);
    selComp = null; changed(true);
  }
  function renderStatus() {
    const s = $("#status"); s.innerHTML = "";
    const rows = bomRows(); const total = rows.reduce((a, r) => a + r.qty * r.mass, 0);
    s.append(h("span", {}, "Assemblage : ", h("b", {}, `${comps().length} composant(s)`)), h("span", {}, "Contraintes : ", h("b", {}, String(mates().length))), h("span", {}, "Masse totale ", h("b", {}, nf(total, 1) + " g")));
  }
  return {
    enter() { built = false; selComp = null; selMate = null; explode = 0; renderTools(); render(); build(); },
    onBuilt, render, renderTools,
    deleteSelected() { if (selComp) removeComp(selComp); else if (selMate) { doc().mates = mates().filter((x) => x.id !== selMate); selMate = null; changed(); } },
    exportComps: placedList,
    fit: (dir) => viewer.fitBox(dir),
    undoRefresh() { build(); },
  };
}
