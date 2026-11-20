// Fonctions « mieux que d'habitude » : partage par lien, recherche de commandes, impression 3D, variantes, versions.

// ---------- Partage par lien : la pièce compressée voyage dans l'adresse ----------
const b64url = (buf) => { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64url = (t) => Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
export async function encodeDoc(doc) {
  const data = new TextEncoder().encode(JSON.stringify(doc));
  const buf = await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer();
  return b64url(buf);
}
export async function decodeDoc(t) {
  const buf = await new Response(new Blob([unb64url(t)]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(buf));
}
export const ONLINE_URL = "https://seb77330.github.io/Gabarit/";

export function createExtras(ctx) {
  const { h, $, fr, nf, toast, viewer, st } = ctx;
  const doc = () => ctx.getDoc();

  // ---------- Partager ----------
  async function share() {
    const code = await encodeDoc(doc());
    const online = location.protocol === "https:";
    const base = online ? location.origin + location.pathname : ONLINE_URL;
    const url = `${base}#p=${code}`;
    const dlg = $("#dlg"); dlg.innerHTML = "";
    const inp = h("input", { type: "text", value: url, readonly: true, style: "width:100%", onfocus: (e) => e.target.select() });
    const kb = Math.round(url.length / 1024);
    dlg.append(h("div", { class: "dh" }, "Partager par lien"), h("div", { class: "db" },
      h("p", {}, "La pièce entière est rangée dans ce lien : pas de compte, pas de serveur. La personne qui l’ouvre obtient sa propre copie, qu’elle peut modifier."),
      h("div", { class: "field", style: "padding:0" }, inp),
      h("p", { class: "muted" }, `Longueur du lien : ${kb} Ko.` + (kb > 60 ? " C’est long (pièce importée ?) : certaines messageries le couperont. Envoie plutôt le fichier .gabarit." : "")),
      online ? null : h("div", { class: "note" }, "Ce lien ouvrira Gabarit en ligne. Il marchera dès que le site sera publié.")),
    h("div", { class: "df" },
      navigator.share ? h("button", { class: "btn", onclick: () => navigator.share({ title: doc().name, url }).catch(() => {}) }, "Envoyer…") : null,
      h("button", { class: "btn primary", onclick: async () => { try { await navigator.clipboard.writeText(url); toast("Lien copié."); } catch { inp.select(); document.execCommand("copy"); toast("Lien copié."); } } }, "Copier le lien"),
      h("button", { class: "btn", onclick: () => dlg.close() }, "Fermer")));
    dlg.showModal();
  }
  async function openFromHash() {
    const m = location.hash.match(/^#p=([\w-]+)/); if (!m) return false;
    try {
      const d = await decodeDoc(m[1]);
      if (!Array.isArray(d.features) && d.kind !== "assembly") throw new Error();
      history.replaceState(null, "", location.pathname + location.search);
      ctx.loadDoc(d); toast(`« ${d.name || "Pièce"} » ouverte depuis un lien. Ton travail précédent reste dans « Mes pièces ».`);
      return true;
    } catch { toast("Ce lien de partage est abîmé ou incomplet."); return false; }
  }

  // ---------- Recherche de commandes ----------
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  function palette() {
    if ($("#palette")) return;
    const cmds = ctx.commands();
    const wrap = h("div", { class: "palette-bg", id: "palette", onclick: (e) => { if (e.target === wrap) close(); } });
    const inp = h("input", { type: "text", placeholder: fr("Que veux-tu faire ? (trou, arrondir, filet, exporter…)"), spellcheck: "false" });
    const list = h("div", { class: "palette-list" });
    let items = [], cur = 0;
    const score = (c, q) => {
      if (!q) return 1;
      const hay = norm(c.label + " " + (c.keys || "")); const words = norm(q).split(/\s+/).filter(Boolean);
      let s = 0; for (const w of words) { const i = hay.indexOf(w); if (i < 0) return 0; s += i === 0 ? 3 : hay[i - 1] === " " ? 2 : 1; }
      return s;
    };
    const draw = () => {
      const q = inp.value.trim();
      items = cmds.filter((c) => !c.when || c.when()).map((c) => ({ c, s: score(c, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.c);
      cur = Math.min(cur, Math.max(0, items.length - 1));
      list.innerHTML = "";
      items.forEach((c, i) => list.append(h("button", { class: "palette-item" + (i === cur ? " on" : ""), onmouseenter: () => { cur = i; draw(); }, onclick: () => run(c) }, h("b", {}, c.label), c.hint ? h("span", {}, c.hint) : null)));
      if (!items.length) list.append(h("div", { class: "palette-empty" }, "Aucune commande ne correspond."));
    };
    const run = (c) => { close(); setTimeout(() => c.run(), 0); };
    const close = () => wrap.remove();
    inp.addEventListener("input", () => { cur = 0; draw(); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { cur = Math.min(items.length - 1, cur + 1); draw(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { cur = Math.max(0, cur - 1); draw(); e.preventDefault(); }
      else if (e.key === "Enter") { if (items[cur]) run(items[cur]); e.preventDefault(); }
      else if (e.key === "Escape") { close(); e.preventDefault(); e.stopPropagation(); }
    });
    wrap.append(h("div", { class: "palette" }, inp, list));
    document.body.append(wrap); draw(); inp.focus();
  }

  // ---------- Impression 3D ----------
  function overhangArea(m, g) {
    const V = m.vertices, T = m.triangles; let maxD = -Infinity;
    for (let i = 0; i < V.length; i += 3) maxD = Math.max(maxD, V[i] * g[0] + V[i + 1] * g[1] + V[i + 2] * g[2]);
    const tol = 0.02; let over = 0, bed = 0;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const u = [V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]], w = [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const area2 = Math.hypot(n[0], n[1], n[2]); if (!area2) continue;
      const cs = (n[0] * g[0] + n[1] * g[1] + n[2] * g[2]) / area2;
      const d = Math.min(...[a, b, c].map((k) => V[k] * g[0] + V[k + 1] * g[1] + V[k + 2] * g[2]));
      if (cs > 0.99 && d > maxD - tol) bed += area2 / 2;
      else if (cs > 0.7071) over += area2 / 2;
    }
    let lo = Infinity; for (let i = 0; i < V.length; i += 3) lo = Math.min(lo, V[i] * g[0] + V[i + 1] * g[1] + V[i + 2] * g[2]);
    return { over, bed, height: maxD - lo };
  }
  function candidates(m) {
    const list = [[0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
    const planes = Object.values(m.faces || {}).filter((f) => f?.plane).map((f) => f.n);
    for (const n of planes) if (!list.some((q) => q[0] * n[0] + q[1] * n[1] + q[2] * n[2] > 0.999)) list.push(n);
    return list.slice(0, 60);
  }
  let printOpen = false;
  function printPanel() {
    if (printOpen) { closePrint(); return; }
    const m = st.mesh; if (!m) { toast("Crée d’abord un volume."); return; }
    printOpen = true; ctx.markTool("print", true);
    const d = doc(); const g0 = d.printDown || [0, 0, -1];
    const bar = h("div", { class: "secbar printbar", id: "printbar" });
    const info = h("span", { class: "seclab" });
    const apply = (g) => {
      viewer.setPrintView(g); viewer.fit([1, -1.3, 0.9]);
      const r = overhangArea(m, g);
      info.textContent = fr(`Surplombs à soutenir : ${nf(r.over / 100, 1)} cm² · appui : ${nf(r.bed / 100, 1)} cm² · hauteur : ${nf(r.height, 1)} mm`);
    };
    const best = () => {
      let bestG = null, bs = Infinity;
      for (const g of candidates(m)) { const r = overhangArea(m, g); const sc = r.over - r.bed * 0.05 + r.height * 0.01; if (sc < bs) { bs = sc; bestG = g; } }
      return bestG;
    };
    bar.append(h("b", {}, "Impression 3D"), h("span", { class: "legend" }, h("i", { style: "background:#5cb873" }), "posé ", h("i", { style: "background:#ee9940" }), "limite ", h("i", { style: "background:#db403a" }), "support"), info,
      h("button", { class: "btn", onclick: () => { const g = best(); ctx.setPrintDown(g); apply(g); toast("Orientation choisie : le moins de supports possible. Elle sera utilisée pour l’export STL et 3MF."); } }, "Poser à plat automatiquement"),
      h("button", { class: "btn", onclick: () => { ctx.setPrintDown(null); apply([0, 0, -1]); } }, "Orientation d’origine"),
      h("button", { class: "btn", onclick: closePrint }, "Fermer"));
    $(".stage").append(bar); apply(g0);
  }
  function closePrint() { printOpen = false; viewer.setPrintView(null); $("#printbar")?.remove(); ctx.markTool("print", false); viewer.fit(); }
  function refreshPrint() { if (printOpen && st.mesh) viewer.setPrintView(doc().printDown || [0, 0, -1]); }

  // ---------- Variantes (familles de pièces) ----------
  function variantBox() {
    const d = doc(); const vs = d.variants || [];
    if (!d.params.length) return null;
    const sel = h("select", { "aria-label": "Variante", onchange: (e) => { const v = vs.find((x) => x.name === e.target.value); if (!v) return; ctx.mutate(() => { for (const p of d.params) if (p.name in v.values) p.value = v.values[p.name]; d.activeVariant = v.name; }); ctx.renderParams(); ctx.renderProps(); } },
      h("option", { value: "" }, vs.length ? "Choisir une variante…" : "Aucune variante"), vs.map((v) => h("option", { value: v.name, selected: v.name === d.activeVariant }, v.name)));
    const save = () => {
      const name = prompt(fr("Nom de la variante (par exemple « M8 » ou « Grande ») :"), d.activeVariant || ""); if (!name?.trim()) return;
      ctx.mutate(() => { d.variants = (d.variants || []).filter((x) => x.name !== name.trim()); d.variants.push({ name: name.trim(), values: Object.fromEntries(d.params.map((p) => [p.name, p.value])) }); d.activeVariant = name.trim(); });
      ctx.renderParams(); toast(`Variante « ${name.trim()} » enregistrée.`);
    };
    const del = () => { if (!d.activeVariant) return; ctx.mutate(() => { d.variants = vs.filter((x) => x.name !== d.activeVariant); d.activeVariant = ""; }); ctx.renderParams(); };
    return h("div", { class: "variants" }, sel, h("button", { class: "mini", title: "Enregistrer les valeurs actuelles comme variante", onclick: save }, "+ Variante"), d.activeVariant ? h("button", { class: "mini", title: "Supprimer cette variante", onclick: del }, "✕") : null);
  }

  // ---------- Versions enregistrées ----------
  const VKEY = "gabarit-versions";
  const allVersions = () => { try { return JSON.parse(localStorage.getItem(VKEY) || "{}"); } catch { return {}; } };
  const keyOf = () => doc().name || "Sans nom";
  function saveVersion(label) {
    const all = allVersions(); const k = keyOf(); const list = all[k] || [];
    list.unshift({ date: new Date().toISOString(), label: label || "", doc: JSON.parse(JSON.stringify(doc())) });
    all[k] = list.slice(0, 30);
    try { localStorage.setItem(VKEY, JSON.stringify(all)); return true; } catch { toast("Plus de place dans le navigateur : supprime d’anciennes versions."); return false; }
  }
  function versions() {
    const dlg = $("#dlg");
    const draw = () => {
      const all = allVersions(); const k = keyOf(); const list = all[k] || [];
      const label = h("input", { type: "text", placeholder: fr("Note (facultatif), par exemple « avant les congés »"), style: "flex:1" });
      dlg.innerHTML = "";
      dlg.append(h("div", { class: "dh" }, `Versions de « ${k} »`), h("div", { class: "db" },
        h("div", { class: "btnrow", style: "padding:0 0 10px" }, label, h("button", { class: "btn primary", onclick: () => { if (saveVersion(label.value.trim())) { toast("Version enregistrée."); draw(); } } }, "Enregistrer cette version")),
        list.length ? h("table", { class: "bom" }, list.map((v, i) => h("tr", {},
          h("td", {}, new Date(v.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })), h("td", {}, v.label || "—"), h("td", {}, `${(v.doc.features || v.doc.components || []).length} étape(s)`),
          h("td", {}, h("button", { class: "btn", onclick: () => { saveVersion("Avant retour en arrière"); dlg.close(); ctx.loadDoc(v.doc); toast("Version restaurée. L’état d’avant est gardé dans les versions."); } }, "Revenir")),
          h("td", {}, h("button", { class: "btn danger", onclick: () => { list.splice(i, 1); all[k] = list; try { localStorage.setItem(VKEY, JSON.stringify(all)); } catch { /* */ } draw(); } }, "✕")))))
          : h("p", {}, "Aucune version pour l’instant. Enregistre une version avant un gros changement : tu pourras y revenir à tout moment.")),
      h("div", { class: "df" }, h("button", { class: "btn", onclick: () => dlg.close() }, "Fermer")));
    };
    draw(); dlg.showModal();
  }

  return { share, openFromHash, palette, printPanel, closePrint, refreshPrint, variantBox, versions, isPrintOpen: () => printOpen };
}
