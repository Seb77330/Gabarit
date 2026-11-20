// Modèles de départ : de petits objets utiles, faits de formes prêtes, à adapter tout de suite.
// Chaque modèle est une pièce normale : toutes ses étapes restent modifiables.
const S = (id, kind, name, mode, o) => ({ id, type: "shape", kind, name, mode, x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0", ...o });

export const TEMPLATES = [
  {
    key: "porte-cles", title: "Porte-clés", sub: "Avec ton prénom en relief", icon: "tag",
    doc: () => ({ version: 1, name: "Porte-clés", material: "pla", params: [], features: [
      S("t1", "box", "Plaque", "add", { a: "72", b: "22", h: "3", r: "7" }),
      S("t2", "cyl", "Trou de l’anneau", "cut", { d: "5", h: "9", x: "-29", z: "-3" }),
      S("t3", "text", "Prénom", "add", { txt: "Prénom", s: "8.5", h: "1.2", x: "5", z: "3" }),
    ] }),
  },
  {
    key: "boite", title: "Boîte de rangement", sub: "Un bac ouvert, à ta taille", icon: "tray",
    doc: () => ({ version: 1, name: "Boîte de rangement", material: "pla", params: [], features: [
      S("t1", "box", "Extérieur", "add", { a: "90", b: "60", h: "35", r: "8" }),
      S("t2", "box", "Intérieur", "cut", { a: "86", b: "56", h: "40", r: "6", z: "2" }),
    ] }),
  },
  {
    key: "crochet", title: "Crochet mural", sub: "Deux vis, et ça tient", icon: "hook",
    doc: () => ({ version: 1, name: "Crochet mural", material: "petg", params: [], features: [
      S("t1", "box", "Plaque au mur", "add", { a: "26", b: "5", h: "70", r: "0" }),
      S("t2", "box", "Bras", "add", { a: "26", b: "32", h: "6", r: "0", y: "-16" }),
      S("t3", "box", "Rebord", "add", { a: "26", b: "6", h: "18", r: "0", y: "-29" }),
      S("t4", "cyl", "Trou de vis du haut", "cut", { d: "4.5", h: "12", y: "6", z: "55", rx: "90" }),
      S("t5", "cyl", "Trou de vis du bas", "cut", { d: "4.5", h: "12", y: "6", z: "28", rx: "90" }),
    ] }),
  },
  {
    key: "support", title: "Support de téléphone", sub: "Incliné, pour le bureau", icon: "stand",
    doc: () => ({ version: 1, name: "Support de téléphone", material: "pla", params: [], features: [
      S("t1", "box", "Socle", "add", { a: "76", b: "90", h: "6", r: "8" }),
      S("t2", "box", "Dossier", "add", { a: "76", b: "7", h: "100", r: "0", y: "12", z: "2", rx: "-18" }),
      S("t3", "box", "Butée", "add", { a: "76", b: "7", h: "14", r: "0", y: "-28" }),
      S("t4", "box", "Passage du câble", "cut", { a: "16", b: "30", h: "40", r: "0", y: "-28", z: "-5" }),
    ] }),
  },
];

// Mini-défis : quelques étapes guidées pour prendre l'outil en main, en mode Simple.
// « done(pièce, état) » dit si l'étape est faite ; état = { sel (étape ouverte), ok (aucune erreur), vol (volume en mm³) }.
const num = (v) => Number(String(v ?? "").trim().replace(",", "."));
const shapes = (d, kind, mode) => d.features.filter((f) => f.type === "shape" && f.kind === kind && (!mode || (f.mode || "add") === mode) && !f.suppressed);
const sized = (f, a, b, h) => num(f.a) === a && num(f.b) === b && num(f.h) === h;
export const CHALLENGES = [
  {
    key: "porte-cles", title: "Mon premier porte-clés", sub: "Une plaque et un trou", icon: "tag",
    steps: [
      { text: "Clique sur « Formes prêtes », en haut à gauche, puis sur la boîte.", tool: "shapes", done: (d) => shapes(d, "box").length > 0 },
      { text: "À gauche, donne-lui la taille d’un porte-clés : longueur 60, largeur 20, hauteur 3. Puis appuie sur Entrée.", done: (d, s) => !s.sel && shapes(d, "box").some((f) => sized(f, 60, 20, 3)) },
      { text: "Le trou de l’anneau : « Formes prêtes », puis le cylindre. À gauche, choisis l’effet « Creuser » et un diamètre de 5.", tool: "shapes", done: (d) => shapes(d, "cyl", "cut").some((f) => num(f.d) > 0 && num(f.d) <= 10) },
      { text: "Clique sur la plaque, près d’un bout : le trou se pose à cet endroit. Puis appuie sur Entrée.", done: (d, s) => !s.sel && s.ok && shapes(d, "cyl", "cut").length > 0 && s.vol > 0 && s.vol < 3600 - 10 },
      { text: "C’est prêt ! Clique sur « Exporter STL », en haut, pour l’envoyer à ton imprimante.", done: (d) => !!d.defi?.exported },
    ],
  },
  {
    key: "boite", title: "Une boîte de rangement", sub: "Une boîte qu’on vide", icon: "tray",
    steps: [
      { text: "Clique sur « Formes prêtes », puis sur la boîte.", tool: "shapes", done: (d) => shapes(d, "box").length > 0 },
      { text: "Donne-lui sa taille : longueur 80, largeur 50, hauteur 30. Puis appuie sur Entrée.", done: (d, s) => !s.sel && shapes(d, "box").some((f) => sized(f, 80, 50, 30)) },
      { text: "Clique sur l’outil « Vider », puis sur le dessus de la boîte : c’est la face qui sera ouverte.", tool: "shell", done: (d) => d.features.some((f) => f.type === "shell" && (f.faces || []).length > 0 && !f.suppressed) },
      { text: "À gauche, règle l’épaisseur des parois sur 2. Puis appuie sur Entrée.", done: (d, s) => !s.sel && s.ok && d.features.some((f) => f.type === "shell" && num(f.t) === 2) && s.vol > 0 && s.vol < 80 * 50 * 30 * 0.5 },
      { text: "C’est prêt ! Clique sur « Exporter STL », en haut, pour l’envoyer à ton imprimante.", done: (d) => !!d.defi?.exported },
    ],
  },
  {
    key: "prenom", title: "Graver mon prénom", sub: "Un texte creusé", icon: "text",
    start: () => ({ version: 1, name: "Plaque à mon nom", material: "pla", params: [], features: [S("p1", "box", "Plaque", "add", { a: "70", b: "24", h: "4", r: "5" })] }),
    steps: [
      { text: "La plaque est déjà là. Clique sur « Formes prêtes », puis sur le texte.", tool: "shapes", done: (d) => shapes(d, "text").length > 0 },
      { text: "À gauche, écris ton prénom à la place de « Gabarit », et choisis l’effet « Creuser ».", done: (d) => shapes(d, "text", "cut").some((f) => String(f.txt ?? "").trim() && String(f.txt).trim() !== "Gabarit") },
      { text: "Clique au milieu du dessus de la plaque pour y poser le texte. Règle l’épaisseur sur 1, puis appuie sur Entrée.", done: (d, s) => !s.sel && s.ok && shapes(d, "text", "cut").length > 0 && s.vol > 0 && s.vol < 6612 - 5 },
      { text: "C’est prêt ! Clique sur « Exporter STL », en haut, pour l’envoyer à ton imprimante.", done: (d) => !!d.defi?.exported },
    ],
  },
];
