// Petit évaluateur d'expressions sûr : nombres, variables, + - * / ^ ( ), fonctions.
const FN = {
  sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max, round: Math.round,
  floor: Math.floor, ceil: Math.ceil,
  sin: (d) => Math.sin(d * Math.PI / 180), cos: (d) => Math.cos(d * Math.PI / 180),
  tan: (d) => Math.tan(d * Math.PI / 180),
};
export function evalExpr(src, vars = {}, depth = 0) {
  if (typeof src === "number") return src;
  const s = String(src ?? "").replace(/,/g, ".").trim();
  if (s === "") throw new Error("valeur vide");
  let i = 0;
  const peek = () => { while (s[i] === " ") i++; return s[i]; };
  const num = () => {
    const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) throw new Error("nombre attendu");
    i += m[0].length; return parseFloat(m[0]);
  };
  function atom() {
    const c = peek();
    if (c === "(") { i++; const v = add(); if (peek() !== ")") throw new Error("parenthèse manquante"); i++; return v; }
    if (c === "-") { i++; return -pow(); }
    if (c === "+") { i++; return pow(); }
    if (/[\d.]/.test(c || "")) return num();
    const m = /^[A-Za-z_À-ÿ][\wÀ-ÿ]*/.exec(s.slice(i));
    if (!m) throw new Error("expression incorrecte");
    i += m[0].length;
    const name = m[0];
    if (peek() === "(") {
      const f = FN[name.toLowerCase()];
      if (!f) throw new Error(`fonction inconnue : ${name}`);
      i++; const args = [add()];
      while (peek() === ";" || peek() === "|") { i++; args.push(add()); }
      if (peek() !== ")") throw new Error("parenthèse manquante"); i++;
      return f(...args);
    }
    if (name.toLowerCase() === "pi") return Math.PI;
    if (!(name in vars)) throw new Error(`paramètre inconnu : ${name}`);
    if (depth > 20) throw new Error("paramètres en boucle");
    return evalExpr(vars[name], vars, depth + 1);
  }
  function pow() { const b = atom(); if (peek() === "^") { i++; return Math.pow(b, pow()); } return b; }
  function mul() { let v = pow(); for (;;) { const c = peek(); if (c === "*") { i++; v *= pow(); } else if (c === "/") { i++; v /= pow(); } else return v; } }
  function add() { let v = mul(); for (;;) { const c = peek(); if (c === "+") { i++; v += mul(); } else if (c === "-") { i++; v -= mul(); } else return v; } }
  const v = add();
  if (peek() !== undefined) throw new Error("expression incorrecte");
  if (!isFinite(v)) throw new Error("résultat impossible");
  return v;
}
export function varsMap(params = []) {
  const m = {};
  for (const p of params) if (p.name) m[p.name] = p.value;
  return m;
}
