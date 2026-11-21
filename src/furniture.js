// « Essayer dans un meuble » : la pièce posée dans une case d'étagère, un bac ou un tiroir, pour voir si elle rentre,
// combien on peut en ranger, et jusqu'où on peut l'agrandir.

// Dimensions INTÉRIEURES utiles en mm : [largeur, profondeur, hauteur]. Valeurs indicatives, toutes modifiables :
// elles viennent des dimensions publiées (extérieur, tablettes, accessoires prévus pour la case) et de l'épaisseur des panneaux.
export const FURNITURE = [
  { group: "Étagères et casiers IKEA", items: [
    { key: "kallax", name: "Kallax, une case", size: [335, 390, 335], back: false },
    { key: "billy80", name: "Billy 80 cm, un niveau", size: [760, 260, 320], back: true, free: "hauteur réglable" },
    { key: "billy40", name: "Billy 40 cm, un niveau", size: [360, 260, 320], back: true, free: "hauteur réglable" },
    { key: "eket", name: "Eket, cube de 35 cm", size: [318, 330, 318], back: true },
    { key: "besta", name: "Bestå 60 × 40 × 38 cm", size: [560, 360, 345], back: true },
  ] },
  { group: "Rangements courants", items: [
    { key: "cube30", name: "Casier cube de 30 cm", size: [300, 300, 300], back: true },
    { key: "etagere80", name: "Étagère de 80 cm, profonde de 30", size: [780, 300, 300], back: true, free: "hauteur réglable" },
    { key: "euro43", name: "Bac Euro 40 × 30 cm, haut de 22", size: [370, 270, 205], back: true },
    { key: "euro64", name: "Bac Euro 60 × 40 cm, haut de 22", size: [570, 370, 205], back: true },
  ] },
  { group: "Atelier et impression 3D", items: [
    { key: "grid11", name: "Gridfinity, 1 emplacement", size: [41.5, 41.5, 42], back: true },
    { key: "grid22", name: "Gridfinity, 2 × 2 emplacements", size: [83.5, 83.5, 42], back: true },
    { key: "grid42", name: "Gridfinity, 4 × 2 emplacements", size: [167.5, 83.5, 42], back: true },
  ] },
];
export const findFurniture = (key) => { for (const g of FURNITURE) for (const it of g.items) if (it.key === key) return it; return null; };

// ---------- Calculs (sans affichage, vérifiés à part) ----------
// Sens de pose : up = axe du modèle mis à la verticale (2 = comme dessinée, 1 = couchée sur le dos, 0 = couchée sur le côté),
// turn = quart de tour sur l'étagère.
const S = Math.SQRT1_2;
const QUP = [[0, -S, 0, S], [S, 0, 0, S], [0, 0, 0, 1]]; // up = 0 : tour de −90° autour de Y ; up = 1 : +90° autour de X
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
export const orientQuat = (o) => (o.turn ? qmul([0, 0, S, S], QUP[o.up]) : QUP[o.up]);
export function rotatePoint(o, [x, y, z]) {
  let v = o.up === 2 ? [x, y, z] : o.up === 1 ? [x, -z, y] : [-z, y, x];
  if (o.turn) v = [-v[1], v[0], v[2]];
  return v;
}
// Boîte englobante de la pièce une fois tournée : { min, size }.
export function rotatedBox(bb, o) {
  const a = rotatePoint(o, bb[0]), b = rotatePoint(o, bb[1]);
  const min = [0, 1, 2].map((i) => Math.min(a[i], b[i]));
  return { min, size: [0, 1, 2].map((i) => Math.abs(a[i] - b[i])) };
}
const EPS = 1e-6;
// La pièce (taille [x, y, z] une fois tournée) dans l'intérieur [L, P, H].
export function fitCheck(size, room) {
  const rest = [0, 1, 2].map((i) => room[i] - size[i]);
  const fits = rest.every((r) => r >= -EPS);
  const count = fits ? [0, 1, 2].map((i) => Math.max(1, Math.floor(room[i] / Math.max(size[i], 1e-9) + EPS))) : [0, 0, 0];
  // plus grande taille qui rentre encore (1 = taille actuelle), en gardant « jeu » mm de libre dans chaque sens
  const grow = (jeu = 0) => Math.min(...[0, 1, 2].map((i) => (room[i] - jeu) / Math.max(size[i], 1e-9)));
  return { fits, rest, count, total: count[0] * count[1] * count[2], grow };
}
export const ORIENTS = [{ up: 2, turn: 0 }, { up: 2, turn: 1 }, { up: 1, turn: 0 }, { up: 1, turn: 1 }, { up: 0, turn: 0 }, { up: 0, turn: 1 }];
// Meilleur sens de pose : d'abord ceux où elle rentre (le plus d'exemplaires possible, sinon le sens actuel),
// sinon celui où il manque le moins.
export function bestOrient(bb, room, cur) {
  let best = null;
  for (const o of ORIENTS) {
    const r = fitCheck(rotatedBox(bb, o).size, room);
    const same = cur && o.up === cur.up && o.turn === cur.turn;
    const score = r.fits ? 1e9 + r.total * 10 + (same ? 5 : 0) + (o.up === 2 ? 2 : 0) : Math.min(...r.rest) + (same ? 0.001 : 0);
    if (!best || score > best.score) best = { o, score, fits: r.fits };
  }
  return best;
}

// ---------- Panneau ----------
const PREF = "gabarit-meuble", MINE = "gabarit-meubles";
export function createFurniture(ctx) {
  const { h, $, fr, nf, toast, viewer, st } = ctx;
  let open = false, update = null;
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage plein */ } };
  const mine = () => (Array.isArray(read(MINE, [])) ? read(MINE, []) : []).filter((m) => m && m.name && Array.isArray(m.size));
  const mm = (x) => nf(Math.abs(x) < 0.005 ? 0 : x, 2);

  function panel() {
    if (open) { close(); return; }
    if (!st.mesh) { toast("Il faut d’abord une pièce : pose une forme ou ouvre un fichier 3D."); return; }
    open = true; ctx.markTool("meuble", true);
    const saved = read(PREF, {});
    const s = { key: "kallax", size: [...findFurniture("kallax").size], back: false, o: { up: 2, turn: 0 }, pos: null, copies: false };
    const pick = (key) => {
      const it = findFurniture(key) || (key.startsWith("moi:") ? mine().find((m) => "moi:" + m.name === key) : null);
      if (it) { s.key = key; s.size = it.size.map(Number); s.back = it.back !== false; }
      else { s.key = "libre"; }
    };
    if (saved.key) { pick(saved.key); if (s.key === "libre" && Array.isArray(saved.size)) s.size = saved.size.map((v) => Math.max(1, Number(v) || 1)); }
    const keep = () => write(PREF, { key: s.key, size: s.size });

    const bar = h("div", { class: "secbar printbar meublebar", id: "meublebar" });
    const chips = h("div", { class: "pchecks" });
    const chip = (key, ok, text) => h("span", { class: "pchk " + (ok === null ? "info" : ok ? "ok" : "warn"), "data-chk": key }, h("i", {}, ok === null ? "i" : ok ? "✓" : "!"), fr(text));
    const info = h("span", { class: "seclab", id: "meubleTaille" });
    const sel = h("select", { id: "meubleSel", title: "Le meuble ou le rangement à essayer", onchange: () => { pick(sel.value); s.pos = null; fill(); keep(); update(true); } });
    const dims = [0, 1, 2].map((i) => {
      const e = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", "data-md": String(i), title: ["Largeur intérieure (mm)", "Profondeur intérieure (mm)", "Hauteur intérieure (mm)"][i] });
      e.addEventListener("input", () => {
        const v = Number(e.value.replace(",", ".")); const good = e.value.trim() !== "" && isFinite(v) && v >= 1 && v <= 20000; e.classList.toggle("bad", !good); if (!good) return;
        s.size[i] = v; const it = findFurniture(s.key);
        if (!it || it.size.some((x, j) => Math.abs(x - s.size[j]) > 1e-9)) { s.key = "libre"; sel.value = "libre"; }
        keep(); update(false);
      });
      return e;
    });
    const options = () => {
      sel.replaceChildren(...FURNITURE.map((g) => h("optgroup", { label: g.group }, g.items.map((it) => h("option", { value: it.key }, `${it.name} (${it.size.map((v) => mm(v)).join(" × ")})`)))),
        ...(mine().length ? [h("optgroup", { label: "Mes meubles" }, mine().map((m) => h("option", { value: "moi:" + m.name }, `${m.name} (${m.size.map((v) => mm(v)).join(" × ")})`)))] : []),
        h("optgroup", { label: "Autre" }, h("option", { value: "libre" }, "Sur mesure : tape les dimensions")));
      sel.value = s.key;
    };
    const fill = () => { dims.forEach((e, i) => { e.value = String(s.size[i]).replace(".", ","); e.classList.remove("bad"); }); };
    const saveMine = () => {
      const name = prompt(fr("Nom de ce meuble (par exemple « Étagère du garage ») :"), "")?.trim(); if (!name) return;
      const list = mine().filter((m) => m.name !== name); list.push({ name, size: [...s.size], back: s.back }); write(MINE, list);
      s.key = "moi:" + name; options(); keep(); update(false); toast(`« ${name} » est gardé dans « Mes meubles ».`);
    };
    const dropMine = () => {
      if (!s.key.startsWith("moi:")) return; const name = s.key.slice(4);
      write(MINE, mine().filter((m) => m.name !== name)); s.key = "libre"; options(); keep(); update(false); toast(`« ${name} » est retiré de « Mes meubles ».`);
    };
    const delBtn = h("button", { class: "btn", id: "meubleDel", title: "Retirer ce meuble de « Mes meubles »", onclick: dropMine }, "Retirer");

    // taille de la pièce (en % de la taille d'origine) : même réglage que le bouton « Taille »
    const pct = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", id: "meublePct", title: "Taille de la pièce, en % de sa taille d’origine" });
    pct.addEventListener("input", () => { const v = Number(pct.value.replace(",", ".")); const good = pct.value.trim() !== "" && isFinite(v) && v > 0.5 && v < 100000; pct.classList.toggle("bad", !good); if (good) ctx.setScale(v, true); });
    pct.addEventListener("change", () => ctx.commit());
    const [less, more] = ctx.stepButtons(() => pct, 5, () => ctx.commit());

    const clampPos = (size) => {
      // dans un sens où elle rentre, la pièce reste entre les parois ; sinon elle est centrée (largeur) ou poussée au fond
      const lim = [s.size[0] - size[0], s.size[1] - size[1]];
      if (!s.pos) s.pos = [lim[0] / 2, lim[1] / 2];
      s.pos = [lim[0] >= 0 ? Math.max(0, Math.min(lim[0], s.pos[0])) : lim[0] / 2, lim[1] >= 0 ? Math.max(0, Math.min(lim[1], s.pos[1])) : lim[1]];
    };
    update = (frame) => {
      const m = st.mesh; if (!m) return;
      const box = rotatedBox(m.bb, s.o); const r = fitCheck(box.size, s.size);
      if (s.copies && r.fits) s.pos = [0, 0];
      clampPos(box.size);
      const at = (px, py, pz) => [-s.size[0] / 2 + px - box.min[0], -s.size[1] / 2 + py - box.min[1], pz - box.min[2]];
      let copies = null;
      if (s.copies && r.fits && r.total > 1) {
        copies = [];
        for (let k = 0; k < r.count[2] && copies.length < 400; k++) for (let j = 0; j < r.count[1] && copies.length < 400; j++) for (let i = 0; i < r.count[0] && copies.length < 400; i++) if (i || j || k) copies.push([...at(i * box.size[0], j * box.size[1], k * box.size[2]), i + j + k]);
      }
      viewer.setFurniture({ size: s.size, back: s.back, quat: orientQuat(s.o), pos: at(s.pos[0], s.pos[1], 0), ok: r.fits, copies });
      const k = ctx.getScale();
      if (document.activeElement !== pct) { pct.value = String(Math.round(k * 100) / 100).replace(".", ","); pct.classList.remove("bad"); }
      info.textContent = fr(`Ta pièce : ${box.size.map((v) => mm(v)).join(" × ")} mm`);
      delBtn.hidden = !s.key.startsWith("moi:");
      const list = [];
      const W = ["en largeur", "en profondeur", "en hauteur"], T = ["trop large", "trop profonde", "trop haute"];
      if (r.fits) list.push(chip("rentre", true, `Ça rentre. Il reste ${mm(r.rest[0])} mm ${W[0]}, ${mm(r.rest[1])} mm ${W[1]} et ${mm(r.rest[2])} mm ${W[2]}.`));
      else {
        list.push(chip("rentre", false, "Ça ne rentre pas : " + r.rest.map((v, i) => (v < -EPS ? `${T[i]} de ${mm(-v)} mm` : null)).filter(Boolean).join(", ") + "."));
        const b = bestOrient(m.bb, s.size, s.o);
        if (b.fits) list.push(chip("sens", null, "Dans un autre sens, elle rentre : clique sur « Trouver le bon sens »."));
      }
      if (r.fits && r.total > 1) list.push(chip("nombre", true, `Tu peux en ranger ${r.total} : ${r.count[0]} de front, ${r.count[1]} en profondeur` + (r.count[2] > 1 ? `, sur ${r.count[2]} étages.` : ".")));
      const g = r.grow(1) * k;
      if (g > 0.5) list.push(chip("maxi", null, r.fits ? `Elle peut grandir jusqu’à ${nf(Math.floor(g * 10) / 10, 1)} % avant de toucher.` : `Dans ce sens, elle rentre si tu la réduis à ${nf(Math.floor(g * 10) / 10, 1)} %.`));
      if (r.fits && !s.copies) {
        const left = s.pos[0], right = s.size[0] - box.size[0] - s.pos[0], front = s.pos[1], backv = s.size[1] - box.size[1] - s.pos[1];
        list.push(chip("place", null, `Vide à gauche ${mm(left)} mm, à droite ${mm(right)} mm, devant ${mm(front)} mm, derrière ${mm(backv)} mm.`));
      }
      chips.replaceChildren(...list);
      if (frame) viewer.fit([0.5, -1, 0.42], [[-s.size[0] / 2, -s.size[1] / 2, 0], [s.size[0] / 2, s.size[1] / 2, s.size[2]]], (bar.offsetHeight + 28) / Math.max(200, $(".stage").clientHeight));
    };
    // glisser la pièce à la souris, au pas choisi (dix fois plus fin avec Maj)
    let start = null;
    viewer.onFurnDrag = (dx, dy, phase, e) => {
      if (phase === "start") { start = s.pos ? [...s.pos] : [0, 0]; if (s.copies) { s.copies = false; cp.checked = false; } return; }
      if (phase === "end") { start = null; return; }
      if (!start) return;
      const pas = ctx.pas() * (e.shiftKey ? 0.1 : 1); const sn = (v) => Math.round(v / pas) * pas;
      s.pos = [sn(start[0] + dx), sn(start[1] + dy)]; update(false);
    };
    const maxi = () => {
      const m = st.mesh; if (!m) return; const r = fitCheck(rotatedBox(m.bb, s.o).size, s.size); const k = ctx.getScale();
      const g = Math.floor(r.grow(1) * k * 10) / 10;
      if (!(g > 0.5)) { toast("Ce meuble est trop petit pour cette pièce."); return; }
      ctx.setScale(g, false); toast(`Taille réglée à ${nf(g, 1)} % : c’est la plus grande qui rentre, avec 1 mm de jeu.`);
    };
    const cp = h("input", { type: "checkbox", id: "meubleCopies", onchange: () => { s.copies = cp.checked; if (!cp.checked) s.pos = null; update(false); } });
    options(); fill();
    bar.append(
      h("div", { class: "prow" }, h("b", {}, "Essayer dans un meuble"),
        h("label", {}, "Meuble ", sel),
        h("span", { class: "pcustom" }, "Intérieur", dims[0], "×", dims[1], "×", dims[2], "mm"),
        h("button", { class: "btn", id: "meubleKeep", title: "Garder ces dimensions sous un nom, pour les retrouver dans la liste (ton meuble, une autre marque…)", onclick: saveMine }, "Garder ce meuble"), delBtn,
        h("span", { class: "grow" }),
        h("button", { class: "btn", id: "meubleClose", onclick: close }, "Fermer")),
      h("div", { class: "prow" }, info,
        h("label", { class: "mpct" }, "Taille ", h("span", { class: "in" }, less, pct, more), " %"),
        h("button", { class: "btn primary", id: "meubleMax", title: "Agrandit (ou réduit) la pièce à la plus grande taille qui rentre dans ce sens, avec 1 mm de jeu", onclick: maxi }, "Taille maximale qui rentre"),
        h("button", { class: "btn", id: "meubleTurn", title: "Tourner la pièce d’un quart de tour sur l’étagère", onclick: () => { s.o = { up: s.o.up, turn: s.o.turn ? 0 : 1 }; s.pos = null; update(false); } }, "Quart de tour"),
        h("button", { class: "btn", id: "meubleLay", title: "Coucher la pièce sur un autre côté", onclick: () => { s.o = { up: (s.o.up + 2) % 3, turn: s.o.turn }; s.pos = null; update(false); } }, "Coucher"),
        h("button", { class: "btn", id: "meubleBest", title: "Essaie les 6 façons de poser la pièce et garde la meilleure", onclick: () => {
          const b = bestOrient(st.mesh.bb, s.size, s.o); s.o = { ...b.o }; s.pos = null; update(false);
          toast(b.fits ? "Voilà le sens où tu en ranges le plus." : "Elle ne rentre dans aucun sens : voilà celui où il manque le moins. Réduis-la avec « Taille maximale qui rentre ».");
        } }, "Trouver le bon sens"),
        h("label", { title: "Montre tous les exemplaires qui tiennent dans le meuble" }, cp, " Remplir le meuble")),
      chips,
      h("div", { class: "note mnote" }, "Glisse la pièce avec la souris pour la déplacer dans le meuble. Dimensions intérieures indicatives : vérifie avec un mètre, et corrige les chiffres au besoin. Les noms servent de repère : Gabarit n’est lié à aucune marque."));
    $(".stage").append(bar); ctx.changed?.(); update(true);
  }
  function close() {
    if (!open) return;
    open = false; update = null; viewer.onFurnDrag = null; viewer.setFurniture(null); $("#meublebar")?.remove(); ctx.markTool("meuble", false); viewer.fit(); ctx.changed?.();
  }
  function refresh() { if (open && st.mesh && update) update(false); }
  return { panel, close, refresh, isOpen: () => open };
}
