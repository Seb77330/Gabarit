// Pièce d'exemple : équerre de fixation paramétrique.
export function exampleDoc() {
  return {
    version: 1, name: "Équerre de fixation", material: "pla",
    params: [
      { name: "longueur", value: "60" }, { name: "hauteur", value: "50" },
      { name: "largeur", value: "40" }, { name: "ep", value: "5" }, { name: "trou", value: "5.5" },
    ],
    features: [
      { id: "f1", type: "sketch", name: "Profil en L", plane: { kind: "std", name: "face", offset: "0" }, entities: [
        { id: "e1", type: "poly", r: 0, pts: [["0", "0"], ["longueur", "0"], ["longueur", "ep"], ["ep", "ep"], ["ep", "hauteur"], ["0", "hauteur"]] },
      ] },
      { id: "f2", type: "extrude", name: "Corps", sketch: "f1", mode: "add", dir: "sym", dist: "largeur" },
      { id: "f3", type: "fillet", name: "Congé intérieur", r: "4", edges: [[5, 0, 5, 0.08333, 0.5, 0.1]] },
      { id: "f4", type: "fillet", name: "Angles arrondis", r: "8", edges: [[60, 20, 2.5, 1, 1, 0.05], [60, -20, 2.5, 1, 0, 0.05], [2.5, 20, 50, 0.04167, 1, 1], [2.5, -20, 50, 0.04167, 0, 1]] },
      { id: "f5", type: "hole", name: "Trous du pied", plane: { kind: "std", name: "dessus", offset: "ep" }, kind: "fraise", d: "trou", d2: "10", angle: "90", through: true, depth: "10", points: [["40", "-10"], ["40", "10"]] },
      { id: "f6", type: "hole", name: "Trous du dos", plane: { kind: "std", name: "droite", offset: "0" }, kind: "simple", d: "trou", through: true, depth: "10", points: [["-10", "35"], ["10", "35"]], flip: true },
    ],
  };
}
