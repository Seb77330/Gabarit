// Chargé avant chaque essai par tools/all.cjs (node --require).
// Une capture d'écran sert à illustrer, pas à vérifier : sur certains PC (Windows, rendu logiciel) elle peut
// rester bloquée. On lui laisse 15 s, puis on la saute en l'écrivant dans la sortie, et l'essai continue.
const pw = require("playwright");
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...a) => {
  const b = await launch(...a), newContext = b.newContext.bind(b);
  b.newContext = async (...x) => {
    const c = await newContext(...x), newPage = c.newPage.bind(c);
    c.newPage = async (...y) => {
      const p = await newPage(...y), shot = p.screenshot.bind(p);
      p.screenshot = async (o = {}) => {
        try { return await shot({ timeout: 15000, ...o }); }
        catch (e) { console.log("capture sautée (" + (o.path || "sans fichier") + ") : " + String(e.message).split("\n")[0]); return null; }
      };
      return p;
    };
    return c;
  };
  return b;
};
