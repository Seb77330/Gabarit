// Sens de pose de toute la pièce. Une orientation est une matrice 3 × 3 faite de 0, de 1 et de −1 (écrite ligne
// par ligne) : chaque axe de la pièce part sur un axe du monde, dans un sens ou dans l'autre. Les 24 rotations
// d'un quart de tour s'écrivent ainsi, et les 24 autres sont les mêmes vues dans un miroir.
export const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const omul = (a, b) => { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]); return r; };
export const odet = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
export const oapply = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
export const osame = (a, b) => a.every((v, i) => v === b[i]);
// Une orientation lue dans un fichier : 9 entiers, un seul ±1 par ligne et par colonne. Sinon : comme dessinée.
export function oread(m) {
  if (!Array.isArray(m) || m.length !== 9) return [...IDENT];
  const v = m.map((x) => Math.round(Number(x) || 0));
  if (v.some((x) => Math.abs(x) > 1) || Math.abs(odet(v)) !== 1) return [...IDENT];
  for (let i = 0; i < 3; i++) if (Math.abs(v[i * 3]) + Math.abs(v[i * 3 + 1]) + Math.abs(v[i * 3 + 2]) !== 1) return [...IDENT];
  return v;
}
// Les gestes proposés, dans le repère de l'écran (X vers la droite, Y vers le fond, Z vers le haut).
export const MOVES = {
  gauche: [0, -1, 0, 1, 0, 0, 0, 0, 1], // quart de tour vers la gauche, vu de dessus
  droite: [0, 1, 0, -1, 0, 0, 0, 0, 1],
  demi: [-1, 0, 0, 0, -1, 0, 0, 0, 1], // demi-tour
  cote: [0, 0, 1, 0, 1, 0, -1, 0, 0], // le haut bascule vers la droite : couchée sur le côté
  avant: [1, 0, 0, 0, 0, -1, 0, 1, 0], // le haut bascule vers l'avant : couchée sur la face avant
  envers: [1, 0, 0, 0, -1, 0, 0, 0, -1], // tête en bas
  miroir: [-1, 0, 0, 0, 1, 0, 0, 0, 1], // gauche et droite échangées
};
// Rotation (sans miroir) → axe et angle en degrés, pour le noyau.
export function axisAngle(m) {
  const c = Math.max(-1, Math.min(1, (m[0] + m[4] + m[8] - 1) / 2));
  if (c > 1 - 1e-9) return { axis: [0, 0, 1], deg: 0 };
  if (c < -1 + 1e-9) { // demi-tour : l'axe est la plus grande colonne de (R + I)
    const cols = [0, 1, 2].map((j) => [m[j] + (j === 0), m[3 + j] + (j === 1), m[6 + j] + (j === 2)]);
    const best = cols.reduce((a, b) => (Math.hypot(...b) > Math.hypot(...a) ? b : a)); const n = Math.hypot(...best);
    return { axis: best.map((v) => v / n), deg: 180 };
  }
  const ax = [m[7] - m[5], m[2] - m[6], m[3] - m[1]]; const n = Math.hypot(...ax);
  return { axis: ax.map((v) => v / n), deg: Math.acos(c) * 180 / Math.PI };
}
// Boîte englobante [[min], [max]] de la pièce une fois tournée : { min, size }.
export function orientedBox(bb, m) {
  const a = oapply(m, bb[0]), b = oapply(m, bb[1]);
  const min = [0, 1, 2].map((i) => Math.min(a[i], b[i]));
  return { min, size: [0, 1, 2].map((i) => Math.abs(a[i] - b[i])) };
}
// Les 6 façons de poser une boîte qui donnent des encombrements différents : debout, couchée vers l'avant,
// couchée sur le côté, chacune avec ou sans quart de tour.
export const POSES = [IDENT, MOVES.gauche, MOVES.avant, omul(MOVES.gauche, MOVES.avant), MOVES.cote, omul(MOVES.gauche, MOVES.cote)];
