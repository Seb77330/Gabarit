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
