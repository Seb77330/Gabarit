// « Essayer dans un meuble » : la pièce posée dans une case d'étagère, sur un bureau, dans un bac ou un tiroir, pour voir
// si elle rentre, combien on peut en ranger, jusqu'où on peut l'agrandir, et la faire remplir le meuble.
import { MOVES, POSES, orientedBox } from "./orient.js";

// Le catalogue : un magasin, puis un type de meuble, puis le modèle. Dimensions utiles en mm : [largeur, profondeur, hauteur].
// kind : "case" (casier fermé sur les côtés et le dessus), "top" (plateau de bureau), "shelf" (tablette au mur),
// "box" (boîte, bac ou tiroir : ouvert dessus). src : "pub" = largeur et profondeur publiées par le fabricant
// (taille du plateau, de la tablette ou de l'intérieur du tiroir), "est" = intérieur estimé à partir de la taille
// extérieure publiée. Toutes les valeurs restent modifiables à l'écran.
const top = (key, name, w, d) => ({ key, name: `${name} ${w / 10} × ${d / 10} cm`, size: [w, d, 1000], kind: "top", src: "pub" });
const wall = (key, name, w, d) => ({ key, name: `${name} ${w / 10} × ${d / 10} cm`, size: [w, d, 1000], kind: "shelf", src: "pub" });
const box = (key, name, size) => ({ key, name, size, kind: "box", src: "est" });
export const STORES = [
  { key: "ikea", name: "IKEA", types: [
    { key: "etageres", name: "Étagères et casiers", items: [
      { key: "kallax", name: "Kallax, une case", size: [335, 390, 335], back: false, src: "est" },
      { key: "billy80", name: "Billy 80 × 28 cm, un niveau", size: [760, 260, 320], src: "est", free: true },
      { key: "billy40", name: "Billy 40 × 28 cm, un niveau", size: [360, 260, 320], src: "est", free: true },
      { key: "billy8039", name: "Billy 80 × 39 cm, un niveau", size: [760, 370, 320], src: "est", free: true },
      { key: "eket", name: "Eket 35 × 35 × 35 cm", size: [318, 330, 318], src: "est" },
      { key: "eket25", name: "Eket 35 × 25 × 35 cm", size: [318, 230, 318], src: "est" },
      { key: "besta", name: "Bestå 60 × 40 cm, un niveau", size: [560, 360, 345], src: "pub", free: true },
      { key: "ivar8330", name: "Ivar 83 × 30 cm, un niveau", size: [830, 300, 320], back: false, src: "pub", free: true },
      { key: "ivar8350", name: "Ivar 83 × 50 cm, un niveau", size: [830, 500, 320], back: false, src: "pub", free: true },
      { key: "ivar4230", name: "Ivar 42 × 30 cm, un niveau", size: [420, 300, 320], back: false, src: "pub", free: true },
      { key: "ivar4250", name: "Ivar 42 × 50 cm, un niveau", size: [420, 500, 320], back: false, src: "pub", free: true },
    ] },
    { key: "bureaux", name: "Bureaux et plateaux", items: [
      top("lagkapten120", "Lagkapten, plateau", 1200, 600), top("lagkapten140", "Lagkapten, plateau", 1400, 600), top("lagkapten200", "Lagkapten, plateau", 2000, 600),
      top("linnmon100", "Linnmon, plateau", 1000, 600),
      top("micke73", "Micke, bureau", 730, 500), top("micke105", "Micke, bureau", 1050, 500), top("micke142", "Micke, bureau", 1420, 500),
      top("alex100", "Alex, bureau", 1000, 480), top("alex132", "Alex, bureau", 1320, 580),
      top("malm140", "Malm, bureau", 1400, 650), top("malmcoif", "Malm, coiffeuse", 1200, 410),
      top("mittzon160", "Mittzon, bureau", 1600, 800), top("utespelare160", "Utespelare, bureau de jeu", 1600, 800),
      top("torald", "Torald, bureau", 650, 400), top("tonstad120", "Tonstad, bureau", 1200, 470), top("tonstad140", "Tonstad, bureau", 1400, 750),
      top("mullsjo", "Mullsjö, bureau", 1350, 700), top("beteshast", "Beteshäst, bureau", 1200, 600),
    ] },
    { key: "tablettes", name: "Tablettes murales", items: [
      wall("lack30", "Lack, tablette", 300, 260), wall("lack110", "Lack, tablette", 1100, 260),
      wall("bergshult8020", "Bergshult, tablette", 800, 200), wall("bergshult12020", "Bergshult, tablette", 1200, 200),
      wall("bergshult8030", "Bergshult, tablette", 800, 300), wall("bergshult12030", "Bergshult, tablette", 1200, 300),
      wall("burhult", "Burhult, tablette", 590, 200), wall("fjallbo", "Fjällbo, tablette", 1010, 200), wall("skomakare", "Skomakare, tablette", 650, 260),
    ] },
    { key: "tiroirs", name: "Tiroirs", items: [
      { key: "malm80", name: "Malm 80 cm, un tiroir", size: [720, 430, 140], kind: "box", src: "pub" },
      box("alex36", "Alex 36 × 70 cm, un tiroir", [270, 520, 90]),
    ] },
    { key: "boites", name: "Boîtes et bacs", items: [
      box("trofast10", "Trofast 42 × 30 × 10 cm", [360, 240, 90]), box("trofast23", "Trofast 42 × 30 × 23 cm", [360, 240, 220]), box("trofast36", "Trofast 42 × 30 × 36 cm", [360, 240, 350]),
      box("trofast20", "Trofast 20 × 30 × 10 cm", [150, 240, 90]),
      box("kuggis26", "Kuggis 26 × 35 × 15 cm", [245, 335, 140]), box("kuggis37", "Kuggis 37 × 54 × 21 cm", [355, 525, 200]), box("kuggis32", "Kuggis 32 × 32 × 32 cm", [305, 305, 310]),
      box("drona33", "Dröna 33 × 38 × 33 cm", [320, 370, 325]), box("drona25", "Dröna 25 × 35 × 25 cm", [240, 340, 245]),
      box("samla11", "Samla 39 × 28 × 14 cm (11 l)", [330, 220, 125]), box("uppdatera", "Uppdatera 24 × 32 × 15 cm", [225, 305, 140]),
      box("sockerbit38", "Sockerbit 38 × 51 × 30 cm", [360, 490, 290]), box("sockerbit19", "Sockerbit 19 × 26 × 15 cm", [175, 245, 140]),
    ] },
  ] },
  { key: "courant", name: "Sans marque", types: [
    { key: "etageres", name: "Étagères et casiers", items: [
      { key: "cube30", name: "Casier cube de 30 cm", size: [300, 300, 300] },
      { key: "etagere80", name: "Étagère de 80 cm, profonde de 30", size: [780, 300, 300], free: true },
    ] },
    { key: "bureaux", name: "Bureaux", items: [
      top("bureau120", "Bureau", 1200, 600), top("bureau140", "Bureau", 1400, 700), top("bureau160", "Bureau", 1600, 800), top("bureau180", "Bureau", 1800, 800),
    ] },
    { key: "bacs", name: "Bacs", items: [
      { key: "euro43", name: "Bac Euro 40 × 30 cm, haut de 22", size: [370, 270, 205], kind: "box" },
      { key: "euro64", name: "Bac Euro 60 × 40 cm, haut de 22", size: [570, 370, 205], kind: "box" },
    ] },
  ] },
  { key: "atelier", name: "Atelier", types: [
    { key: "gridfinity", name: "Gridfinity (impression 3D)", items: [
      { key: "grid11", name: "Gridfinity, 1 emplacement", size: [41.5, 41.5, 42], kind: "box" },
      { key: "grid22", name: "Gridfinity, 2 × 2 emplacements", size: [83.5, 83.5, 42], kind: "box" },
      { key: "grid42", name: "Gridfinity, 4 × 2 emplacements", size: [167.5, 83.5, 42], kind: "box" },
    ] },
  ] },
];
// La liste à plat (pour les essais et la recherche d'un modèle par sa clé).
export const FURNITURE = STORES.flatMap((st) => st.types.map((t) => ({ group: `${st.name} : ${t.name}`, store: st.key, type: t.key, items: t.items })));
export const findFurniture = (key) => { for (const g of FURNITURE) for (const it of g.items) if (it.key === key) return it; return null; };
const whereIs = (key) => { for (const g of FURNITURE) if (g.items.some((it) => it.key === key)) return g; return null; };
export const isOpenKind = (kind) => kind === "top" || kind === "shelf";

// ---------- Calculs (sans affichage, vérifiés à part) ----------
const EPS = 1e-6;
// La pièce (taille [x, y, z]) dans l'intérieur [L, P, H]. « open » : un plateau ou une tablette, sans limite de hauteur.
export function fitCheck(size, room, open = false) {
  const n = open ? 2 : 3, ax = [0, 1, 2].slice(0, n);
  const rest = [0, 1, 2].map((i) => (i < n ? room[i] - size[i] : Infinity));
  const fits = rest.every((r) => r >= -EPS);
  const count = fits ? [0, 1, 2].map((i) => (i < n ? Math.max(1, Math.floor(room[i] / Math.max(size[i], 1e-9) + EPS)) : 1)) : [0, 0, 0];
  // plus grande taille qui rentre encore (1 = taille actuelle), en gardant « jeu » mm de libre dans chaque sens ;
  // « skip » : les sens déjà réglés pour remplir le meuble, qui ne suivent pas la taille
  const grow = (jeu = 0, skip = []) => Math.min(...ax.filter((i) => !skip.includes(i)).map((i) => (room[i] - jeu) / Math.max(size[i], 1e-9)));
  return { fits, rest, count, total: count[0] * count[1] * count[2], grow };
}
// Meilleur sens de pose parmi les 6, à partir de la boîte actuelle : d'abord ceux où elle rentre (le plus
// d'exemplaires possible, sinon le sens actuel), sinon celui où il manque le moins. Renvoie le geste à appliquer.
export function bestOrient(bb, room, open = false) {
  let best = null;
  POSES.forEach((m, i) => {
    const r = fitCheck(orientedBox(bb, m).size, room, open);
    const score = r.fits ? 1e9 + r.total * 10 + (i === 0 ? 5 : 0) + (i < 2 ? 2 : 0) : Math.min(...r.rest) + (i === 0 ? 0.001 : 0);
    if (!best || score > best.score) best = { m, score, fits: r.fits, same: i === 0 };
  });
  return best;
}
// Où poser la pièce le long d'un sens : « at » en % (le milieu de la pièce à ce pourcentage de l'intérieur),
// sans jamais traverser une paroi. Si elle est trop grande, elle est centrée (ou poussée au fond avec « push »).
export function placeAt(at, room, size, push = false) {
  const lim = room - size;
  if (lim < 0) return push ? lim : lim / 2;
  return Math.max(0, Math.min(lim, at / 100 * room - size / 2));
}
// Aimant : près d'une paroi ou du milieu (à moins de « near » mm), la pièce s'y colle. Renvoie [position, % ou null].
export function magnet(pos, room, size, near) {
  const lim = room - size; if (lim < 0) return [pos, null];
  for (const [p, at] of [[0, 0], [lim, 100], [lim / 2, 50]]) if (Math.abs(pos - p) <= near) return [p, at];
  return [Math.max(0, Math.min(lim, pos)), null];
}

// ---------- Panneau ----------
const PREF = "gabarit-meuble", MINE = "gabarit-meubles";
const TABS = [["meuble", "Meuble"], ["tourner", "Tourner"], ["placer", "Placer"], ["remplir", "Taille et remplissage"]];
export function createFurniture(ctx) {
  const { h, $, fr, nf, toast, viewer, st } = ctx;
  let open = false, update = null;
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage plein */ } };
  const mine = () => (Array.isArray(read(MINE, [])) ? read(MINE, []) : []).filter((m) => m && m.name && Array.isArray(m.size));
  const mm = (x) => nf(Math.abs(x) < 0.005 ? 0 : x, 2);
  const num = (e) => Number(String(e.value).replace(",", "."));

  function panel() {
    if (open) { close(); return; }
    if (!st.mesh) { toast("Il faut d’abord une pièce : pose une forme ou ouvre un fichier 3D."); return; }
    open = true; ctx.markTool("meuble", true);
    const saved = read(PREF, {});
    // at : où est le milieu de la pièce, en % de la largeur et de la profondeur (null = posée librement à la souris)
    const s = { shop: "ikea", type: "etageres", key: "kallax", size: [...findFurniture("kallax").size], kind: "case", back: false, src: "est",
      at: [50, 50], pos: [0, 0], copies: false, jeu: 1, aimant: true, tab: "meuble" };
    const pick = (key) => {
      const it = findFurniture(key), me = !it && key.startsWith("moi:") ? mine().find((m) => "moi:" + m.name === key) : null;
      if (it) { const g = whereIs(key); s.shop = g.store; s.type = g.type; s.key = key; s.size = it.size.map(Number); s.kind = it.kind || "case"; s.back = it.back !== false; s.src = it.src || null; }
      else if (me) { s.shop = "moi"; s.key = key; s.size = me.size.map(Number); s.kind = me.kind || "case"; s.back = me.back !== false; s.src = null; }
      else { s.key = "libre"; s.src = null; }
    };
    if (saved.key) {
      pick(saved.key);
      if (s.key === "libre") { if (Array.isArray(saved.size)) s.size = saved.size.map((v) => Math.max(1, Number(v) || 1)); if (saved.kind) s.kind = saved.kind; if (saved.shop) s.shop = saved.shop; if (saved.type) s.type = saved.type; }
    }
    if (saved.jeu >= 0 && saved.jeu <= 50) s.jeu = Number(saved.jeu);
    if (saved.aimant === false) s.aimant = false;
    if (TABS.some((t) => t[0] === saved.tab)) s.tab = saved.tab;
    const keep = () => write(PREF, { key: s.key, size: s.size, kind: s.kind, shop: s.shop, type: s.type, jeu: s.jeu, aimant: s.aimant, tab: s.tab });
    const isOpen = () => isOpenKind(s.kind);
    const dimText = (it) => (isOpenKind(it.kind) ? "" : ` (intérieur ${it.size.map((v) => mm(v)).join(" × ")})`);

    const bar = h("div", { class: "secbar printbar meublebar", id: "meublebar" });
    const chips = h("div", { class: "pchecks" });
    const chip = (key, ok, text) => h("span", { class: "pchk " + (ok === null ? "info" : ok ? "ok" : "warn"), "data-chk": key }, h("i", {}, ok === null ? "i" : ok ? "✓" : "!"), fr(text));
    const info = h("span", { class: "seclab", id: "meubleTaille" });

    // ----- onglet « Meuble » : le magasin, le type, le modèle, les dimensions -----
    const shops = h("div", { class: "seg", id: "meubleShops", title: "Le magasin" });
    const typeSel = h("select", { id: "meubleType", title: "Le type de meuble", onchange: () => { s.type = typeSel.value; const first = store()?.types.find((t) => t.key === s.type)?.items[0]; if (first) pick(first.key); s.at = [50, 50]; lists(); fill(); keep(); update(true); } });
    const sel = h("select", { id: "meubleSel", title: "Le modèle à essayer", onchange: () => { pick(sel.value); s.at = [50, 50]; lists(); fill(); keep(); update(true); } });
    const typeLab = h("label", {}, "Type ", typeSel);
    const store = () => STORES.find((x) => x.key === s.shop);
    const lists = () => {
      shops.replaceChildren(...STORES.map((x) => h("button", { type: "button", class: s.shop === x.key ? "on" : "", "data-shop": x.key, onclick: () => setShop(x.key) }, x.name)),
        h("button", { type: "button", class: s.shop === "moi" ? "on" : "", "data-shop": "moi", onclick: () => setShop("moi") }, "Mes meubles"));
      const stn = store(); typeLab.hidden = !stn;
      if (stn) {
        if (!stn.types.some((t) => t.key === s.type)) s.type = stn.types[0].key;
        typeSel.replaceChildren(...stn.types.map((t) => h("option", { value: t.key }, `${t.name} (${t.items.length})`))); typeSel.value = s.type;
        const items = stn.types.find((t) => t.key === s.type).items;
        sel.replaceChildren(...items.map((it) => h("option", { value: it.key }, it.name + dimText(it))), h("option", { value: "libre" }, "Sur mesure : tape les dimensions"));
      } else {
        const list = mine();
        sel.replaceChildren(...list.map((m) => h("option", { value: "moi:" + m.name }, m.name + dimText(m))),
          h("option", { value: "libre" }, list.length ? "Sur mesure : tape les dimensions" : "Aucun pour l’instant : tape des dimensions, puis « Garder ce meuble »"));
      }
      sel.value = [...sel.options].some((o) => o.value === s.key) ? s.key : "libre";
    };
    const setShop = (key) => {
      s.shop = key; const stn = store();
      if (stn) { s.type = stn.types[0].key; pick(stn.types[0].items[0].key); } else { const m = mine()[0]; if (m) pick("moi:" + m.name); else s.key = "libre"; }
      s.at = [50, 50]; lists(); fill(); keep(); update(true);
    };
    const dims = [0, 1, 2].map((i) => {
      const e = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", "data-md": String(i), title: ["Largeur utile (mm)", "Profondeur utile (mm)", "Hauteur utile (mm)"][i] });
      e.addEventListener("input", () => {
        const v = num(e); const good = e.value.trim() !== "" && isFinite(v) && v >= 1 && v <= 20000; e.classList.toggle("bad", !good); if (!good) return;
        s.size[i] = v; const it = findFurniture(s.key);
        if (!it || it.size.some((x, j) => Math.abs(x - s.size[j]) > 1e-9)) { s.key = "libre"; s.src = null; sel.value = "libre"; }
        keep(); update(false);
      });
      return e;
    });
    const hx = h("span", { class: "mh" }, "×", dims[2]);
    const fill = () => { dims.forEach((e, i) => { e.value = String(s.size[i]).replace(".", ","); e.classList.remove("bad"); }); hx.hidden = isOpen(); };
    const saveMine = () => {
      const name = prompt(fr("Nom de ce meuble (par exemple « Étagère du garage ») :"), "")?.trim(); if (!name) return;
      const list = mine().filter((m) => m.name !== name); list.push({ name, size: [...s.size], back: s.back, kind: s.kind }); write(MINE, list);
      s.shop = "moi"; s.key = "moi:" + name; s.src = null; lists(); keep(); update(false); toast(`« ${name} » est gardé dans « Mes meubles ».`);
    };
    const dropMine = () => {
      if (!s.key.startsWith("moi:")) return; const name = s.key.slice(4);
      write(MINE, mine().filter((m) => m.name !== name)); s.key = "libre"; lists(); keep(); update(false); toast(`« ${name} » est retiré de « Mes meubles ».`);
    };
    const delBtn = h("button", { class: "btn", id: "meubleDel", title: "Retirer ce meuble de « Mes meubles »", onclick: dropMine }, "Retirer");

    // ----- onglet « Taille et remplissage » -----
    // taille de la pièce (en % de la taille d'origine) : même réglage que le bouton « Taille »
    const pct = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", id: "meublePct", title: "Taille de la pièce, en % de sa taille d’origine" });
    pct.addEventListener("input", () => { const v = num(pct); const good = pct.value.trim() !== "" && isFinite(v) && v > 0.5 && v < 100000; pct.classList.toggle("bad", !good); if (good) ctx.setScale(v, true); });
    pct.addEventListener("change", () => ctx.commit());
    const [less, more] = ctx.stepButtons(() => pct, 5, () => ctx.commit());
    const jeu = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", id: "meubleJeu", title: "Espace laissé libre, au total, dans chaque sens rempli : pour que la pièce entre sans forcer. Mets 0 pour remplir pile." });
    jeu.value = String(s.jeu).replace(".", ",");
    jeu.addEventListener("input", () => { const v = num(jeu); const good = jeu.value.trim() !== "" && isFinite(v) && v >= 0 && v <= 50; jeu.classList.toggle("bad", !good); if (good) { s.jeu = v; keep(); update(false); } });
    const box = () => { const m = st.mesh; return { min: m.bb[0], size: [0, 1, 2].map((i) => m.bb[1][i] - m.bb[0][i]) }; };
    const fitted = () => ctx.getFit().map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
    const SENS = ["la largeur", "la profondeur", "la hauteur"];
    const fillAxes = (axes) => {
      const next = [...ctx.getFit()];
      for (const i of axes) { const t = s.size[i] - s.jeu; if (!(t > 0.5)) { toast("Ce meuble est trop petit pour ce jeu."); return; } next[i] = Math.round(t * 1000) / 1000; }
      ctx.setFit(next);
      toast(`La pièce remplit ${axes.length === 3 ? "tout le meuble" : axes.map((i) => SENS[i]).join(" et ") + " du meuble"}` + (s.jeu ? `, avec ${mm(s.jeu)} mm de jeu.` : "."));
    };
    const fillBtn = (id, label, axes, title) => h("button", { class: "btn", id, title, onclick: () => fillAxes(isOpen() ? axes.filter((i) => i < 2) : axes) }, label);
    const fillZ = fillBtn("meubleFillZ", "La hauteur", [2], "Étire la pièce de bas en haut pour remplir la hauteur du meuble");
    const unfill = h("button", { class: "btn", id: "meubleUnfill", title: "Enlève le remplissage : la pièce reprend ses proportions", onclick: () => { ctx.setFit([null, null, null]); toast("La pièce a repris ses proportions."); } }, "Forme d’origine");
    const maxi = () => {
      const m = st.mesh; if (!m) return; const r = fitCheck(box().size, s.size, isOpen()); const k = ctx.getScale();
      const g = Math.floor(r.grow(s.jeu, fitted()) * k * 10) / 10;
      if (!isFinite(g)) { toast("Elle remplit déjà le meuble dans tous les sens."); return; }
      if (!(g > 0.5)) { toast("Ce meuble est trop petit pour cette pièce."); return; }
      ctx.setScale(g, false); toast(`Taille réglée à ${nf(g, 1)} % : c’est la plus grande qui rentre` + (s.jeu ? `, avec ${mm(s.jeu)} mm de jeu.` : "."));
    };

    // ----- onglet « Placer » : l'aimant -----
    const atIn = [0, 1].map((i) => {
      const e = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", id: i ? "meubleAtY" : "meubleAtX",
        title: i ? "Où est le milieu de la pièce dans la profondeur : 0 % = tout devant, 50 % = au milieu, 100 % = tout au fond" : "Où est le milieu de la pièce dans la largeur : 0 % = tout à gauche, 50 % = au centre, 100 % = tout à droite" });
      e.addEventListener("input", () => { const v = num(e); const good = e.value.trim() !== "" && isFinite(v) && v >= 0 && v <= 100; e.classList.toggle("bad", !good); if (good) { s.at[i] = v; s.copies = false; cp.checked = false; update(false); } });
      return e;
    });
    const atSteps = atIn.map((e) => ctx.stepButtons(() => e, 5, () => {}));
    const go = (i, v) => h("button", { class: "btn", "data-at": `${i}:${v}`, onclick: () => { s.at[i] = v; s.copies = false; cp.checked = false; update(false); } });
    const lab = (b, t, title) => { b.textContent = t; b.title = title; return b; };
    const am = h("input", { type: "checkbox", id: "meubleAimant", onchange: () => { s.aimant = am.checked; keep(); } }); am.checked = s.aimant;
    const cp = h("input", { type: "checkbox", id: "meubleCopies", onchange: () => { s.copies = cp.checked; update(false); } });

    update = (frame) => {
      const m = st.mesh; if (!m) return;
      const b = box(), op = isOpen(); const r = fitCheck(b.size, s.size, op);
      for (const i of [0, 1]) {
        if (s.at[i] !== null) s.pos[i] = placeAt(s.at[i], s.size[i], b.size[i], i === 1);
        else { const lim = s.size[i] - b.size[i]; s.pos[i] = lim >= 0 ? Math.max(0, Math.min(lim, s.pos[i])) : i ? lim : lim / 2; }
      }
      const pos = s.copies && r.fits ? [0, 0] : s.pos;
      const at = (px, py, pz) => [-s.size[0] / 2 + px - b.min[0], -s.size[1] / 2 + py - b.min[1], pz - b.min[2]];
      let copies = null;
      if (s.copies && r.fits && r.total > 1) {
        copies = [];
        for (let k = 0; k < r.count[2] && copies.length < 400; k++) for (let j = 0; j < r.count[1] && copies.length < 400; j++) for (let i = 0; i < r.count[0] && copies.length < 400; i++) if (i || j || k) copies.push([...at(i * b.size[0], j * b.size[1], k * b.size[2]), i + j + k]);
      }
      viewer.setFurniture({ size: s.size, kind: s.kind, back: s.back, pos: at(pos[0], pos[1], 0), ok: r.fits, copies });
      const k = ctx.getScale(), fit = fitted();
      if (document.activeElement !== pct) { pct.value = String(Math.round(k * 100) / 100).replace(".", ","); pct.classList.remove("bad"); }
      atIn.forEach((e, i) => { if (document.activeElement !== e) { e.value = String(Math.round((pos[i] + b.size[i] / 2) / s.size[i] * 1000) / 10).replace(".", ","); e.classList.remove("bad"); } });
      info.textContent = fr(`Ta pièce : ${b.size.map((v) => mm(v)).join(" × ")} mm`);
      delBtn.hidden = !s.key.startsWith("moi:"); fillZ.disabled = op; unfill.disabled = !fit.length;
      bar.querySelectorAll("[data-at]").forEach((x) => { const [i, v] = x.dataset.at.split(":").map(Number); x.classList.toggle("on", s.at[i] === v && !s.copies); });
      const list = [];
      const W = ["en largeur", "en profondeur", "en hauteur"], T = ["trop large", "trop profonde", "trop haute"];
      if (r.fits) list.push(chip("rentre", true, op ? `Ça tient dessus. Il reste ${mm(r.rest[0])} mm ${W[0]} et ${mm(r.rest[1])} mm ${W[1]}.` : `Ça rentre. Il reste ${mm(r.rest[0])} mm ${W[0]}, ${mm(r.rest[1])} mm ${W[1]} et ${mm(r.rest[2])} mm ${W[2]}.`));
      else {
        list.push(chip("rentre", false, (op ? "Ça dépasse : " : "Ça ne rentre pas : ") + r.rest.map((v, i) => (v < -EPS ? `${T[i]} de ${mm(-v)} mm` : null)).filter(Boolean).join(", ") + "."));
        const bo = bestOrient(m.bb, s.size, op);
        if (bo.fits) list.push(chip("sens", null, "Dans un autre sens, elle rentre : onglet « Tourner », puis « Trouver le bon sens »."));
      }
      if (fit.length) list.push(chip("rempli", true, fit.length === 3 ? "Elle est étirée pour remplir tout le meuble." : `Elle est étirée pour remplir ${fit.map((i) => SENS[i]).join(" et ")}.`));
      if (r.fits && r.total > 1) list.push(chip("nombre", true, `Tu peux en ranger ${r.total} : ${r.count[0]} de front, ${r.count[1]} en profondeur` + (r.count[2] > 1 ? `, sur ${r.count[2]} étages.` : ".")));
      const g = r.grow(s.jeu, fit) * k;
      if (isFinite(g) && g > 0.5) list.push(chip("maxi", null, r.fits ? `Elle peut grandir jusqu’à ${nf(Math.floor(g * 10) / 10, 1)} % avant de toucher.` : `Dans ce sens, elle rentre si tu la réduis à ${nf(Math.floor(g * 10) / 10, 1)} %.`));
      if (r.fits && !s.copies) {
        const left = pos[0], right = s.size[0] - b.size[0] - pos[0], front = pos[1], backv = s.size[1] - b.size[1] - pos[1];
        list.push(chip("place", null, `Vide à gauche ${mm(left)} mm, à droite ${mm(right)} mm, devant ${mm(front)} mm, derrière ${mm(backv)} mm.`));
      }
      if (s.src) list.push(chip("mesure", null, s.src === "pub" ? (op ? "Taille du plateau publiée par le fabricant." : "Largeur et profondeur publiées par le fabricant. La hauteur dépend de ton montage : corrige-la.") : "Intérieur estimé à partir de la taille extérieure : vérifie avec un mètre."));
      chips.replaceChildren(...list);
      if (frame) viewer.fit([0.5, -1, 0.42], [[-s.size[0] / 2, -s.size[1] / 2, 0], [s.size[0] / 2, s.size[1] / 2, op ? Math.max(b.size[2], Math.min(s.size[0], s.size[1]) / 2) : s.size[2]]], (bar.offsetHeight + 28) / Math.max(200, $(".stage").clientHeight));
    };
    // glisser la pièce à la souris, au pas choisi (dix fois plus fin avec Maj) ; l'aimant la colle aux parois et au milieu
    let start = null;
    viewer.onFurnDrag = (dx, dy, phase, e) => {
      if (phase === "start") { start = [...s.pos]; if (s.copies) { s.copies = false; cp.checked = false; start = [0, 0]; } return; }
      if (phase === "end") { start = null; return; }
      if (!start) return;
      const pas = ctx.pas() * (e.shiftKey ? 0.1 : 1); const sn = (v) => Math.round(v / pas) * pas; const b = box();
      [dx, dy].forEach((d, i) => {
        const p = sn(start[i] + d);
        if (s.aimant && !e.shiftKey) { const [q, at] = magnet(p, s.size[i], b.size[i], Math.max(2 * pas, 0.03 * s.size[i])); s.pos[i] = q; s.at[i] = at; }
        else { s.pos[i] = p; s.at[i] = null; }
      });
      update(false);
    };
    const turn = (id, key, label, title) => h("button", { class: "btn", id, title, onclick: () => ctx.turn(MOVES[key]) }, label);
    const best = () => {
      const bo = bestOrient(st.mesh.bb, s.size, isOpen());
      if (!bo.same) ctx.turn(bo.m);
      toast(bo.fits ? (bo.same ? "Elle est déjà dans le bon sens." : "Voilà le sens où tu en ranges le plus.") : "Elle ne rentre dans aucun sens : voilà celui où il manque le moins. Réduis-la avec « Taille maximale qui rentre ».");
    };
    const tabs = h("div", { class: "seg mtabs", id: "meubleTabs" });
    const panes = {};
    const showTab = (key) => {
      s.tab = key; keep();
      tabs.replaceChildren(...TABS.map(([k, t]) => h("button", { type: "button", class: k === key ? "on" : "", "data-tab": k, onclick: () => showTab(k) }, t)));
      for (const [k, el] of Object.entries(panes)) el.hidden = k !== key;
    };
    panes.meuble = h("div", { class: "prow", "data-pane": "meuble" }, shops, typeLab, h("label", {}, "Modèle ", sel),
      h("span", { class: "pcustom" }, "Dimensions", dims[0], "×", dims[1], hx, "mm"),
      h("button", { class: "btn", id: "meubleKeep", title: "Garder ces dimensions sous un nom, pour les retrouver dans « Mes meubles » (ton meuble, une autre marque…)", onclick: saveMine }, "Garder ce meuble"), delBtn);
    panes.tourner = h("div", { class: "prow", "data-pane": "tourner" },
      turn("meubleTurn", "gauche", "Quart de tour à gauche", "Tourne la pièce de 90° vers la gauche, vue de dessus"),
      turn("meubleTurnR", "droite", "Quart de tour à droite", "Tourne la pièce de 90° vers la droite, vue de dessus"),
      turn("meubleHalf", "demi", "Demi-tour", "Tourne la pièce de 180° : l’avant passe derrière"),
      turn("meubleLay", "cote", "Coucher sur le côté", "Bascule la pièce de 90° vers la droite : elle repose sur son flanc"),
      turn("meubleLayF", "avant", "Coucher vers l’avant", "Bascule la pièce de 90° vers l’avant : elle repose sur sa face avant"),
      turn("meubleFlip", "envers", "Tête en bas", "Retourne la pièce : le dessus passe dessous"),
      turn("meubleMirror", "miroir", "Miroir", "Inverse la gauche et la droite de la pièce, comme dans un miroir"),
      h("button", { class: "btn", id: "meubleStraight", title: "Annule tous les changements de sens : la pièce revient comme elle a été dessinée", onclick: () => ctx.turn(null) }, "Remettre droit"),
      h("button", { class: "btn primary", id: "meubleBest", title: "Essaie les 6 façons de poser la pièce et garde la meilleure", onclick: best }, "Trouver le bon sens"));
    panes.placer = h("div", { class: "prow", "data-pane": "placer" },
      h("span", { class: "mgrp" }, lab(go(0, 0), "À gauche", "Colle la pièce contre la paroi de gauche"), lab(go(0, 50), "Au centre", "Centre la pièce dans la largeur"), lab(go(0, 100), "À droite", "Colle la pièce contre la paroi de droite")),
      h("span", { class: "mgrp" }, lab(go(1, 0), "Devant", "Amène la pièce au bord avant"), lab(go(1, 50), "Au milieu", "Centre la pièce dans la profondeur"), lab(go(1, 100), "Au fond", "Pousse la pièce contre le fond")),
      h("label", { class: "mpct" }, "Largeur ", h("span", { class: "in" }, atSteps[0][0], atIn[0], atSteps[0][1]), " %"),
      h("label", { class: "mpct" }, "Profondeur ", h("span", { class: "in" }, atSteps[1][0], atIn[1], atSteps[1][1]), " %"),
      h("label", { title: "Quand tu glisses la pièce à la souris, elle se colle toute seule aux parois et au milieu. Maj enfoncée : pas d’aimant." }, am, " Aimant"),
      h("label", { title: "Montre tous les exemplaires qui tiennent dans le meuble" }, cp, " Montrer tous les exemplaires"));
    panes.remplir = h("div", { class: "prow", "data-pane": "remplir" },
      h("label", { class: "mpct" }, "Taille ", h("span", { class: "in" }, less, pct, more), " %"),
      h("button", { class: "btn primary", id: "meubleMax", title: "Agrandit (ou réduit) toute la pièce à la plus grande taille qui rentre dans ce sens, en gardant ses proportions", onclick: maxi }, "Taille maximale qui rentre"),
      h("span", { class: "mgrp" }, h("b", {}, "Remplir"),
        fillBtn("meubleFillX", "La largeur", [0], "Étire la pièce de gauche à droite pour remplir la largeur du meuble"),
        fillBtn("meubleFillY", "La profondeur", [1], "Étire la pièce d’avant en arrière pour remplir la profondeur du meuble"), fillZ,
        fillBtn("meubleFillAll", "Tout", [0, 1, 2], "Étire la pièce dans tous les sens pour remplir le meuble")),
      h("label", { class: "mpct" }, "Jeu ", jeu, " mm"), unfill);
    lists(); fill();
    bar.append(
      h("div", { class: "prow" }, h("b", {}, "Essayer dans un meuble"), tabs, h("span", { class: "grow" }), info, h("button", { class: "btn", id: "meubleClose", onclick: close }, "Fermer")),
      panes.meuble, panes.tourner, panes.placer, panes.remplir, chips,
      h("div", { class: "note mnote" }, "Glisse la pièce avec la souris pour la déplacer. Vérifie les dimensions avec un mètre et corrige les chiffres au besoin. Les noms servent de repère : Gabarit n’est lié à aucune marque."));
    showTab(s.tab);
    $(".stage").append(bar); ctx.changed?.(); update(true);
  }
  function close() {
    if (!open) return;
    open = false; update = null; viewer.onFurnDrag = null; viewer.setFurniture(null); $("#meublebar")?.remove(); ctx.markTool("meuble", false); viewer.fit(); ctx.changed?.();
  }
  function refresh() { if (open && st.mesh && update) update(false); }
  return { panel, close, refresh, isOpen: () => open };
}
