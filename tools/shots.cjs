// Captures d'écran pour vérifier le style (clair, sombre, Simple, Expert).
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
const OUT = TMP + "/shots/";
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = async (url, theme) => {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1, colorScheme: theme || "light" });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await p.goto(url); await p.waitForFunction(() => window.gabarit, null, { timeout: 60000 });
    return p;
  };
  const ready = (p) => p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 });
  // 1. accueil (première visite : mode Simple)
  let p = await page("http://localhost:8765/");
  await p.waitForTimeout(600); await p.screenshot({ path: OUT + "v1-accueil.png" });
  // 2. mode Simple : pièce vide + formes
  await p.click("text=Nouvelle pièce"); await p.waitForTimeout(500); await p.screenshot({ path: OUT + "v1-simple-vide.png" });
  await p.click(".tbtn[data-tool=shapes]"); await p.waitForTimeout(300); await p.screenshot({ path: OUT + "v1-simple-formes.png" });
  await p.click("[data-shape=box]"); await ready(p); await p.waitForTimeout(700); await p.screenshot({ path: OUT + "v1-simple-boite.png" });
  await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  await p.click(".tbtn[data-tool=shapes]"); await p.click("[data-shape=cyl]"); await p.waitForTimeout(1500); await p.screenshot({ path: OUT + "v1-simple-poser.png" });
  await p.keyboard.press("Enter"); await ready(p); await p.waitForTimeout(800); await p.screenshot({ path: OUT + "v1-simple-piece.png" });
  console.log("simple doc", await p.evaluate(() => [window.gabarit.doc.features.map((f) => f.name), window.gabarit.st.errors, Math.round(window.gabarit.st.mesh.volume)]));
  // 3. mode Expert : exemple
  p = await page("http://localhost:8765/?mode=expert");
  await p.waitForTimeout(400); await p.screenshot({ path: OUT + "v1-accueil-expert.png" });
  await p.click("text=Voir l’exemple"); await ready(p); await p.waitForTimeout(900); await p.screenshot({ path: OUT + "v1-expert.png" });
  await p.click("#tree .feat:nth-child(3)"); await p.waitForTimeout(700); await p.screenshot({ path: OUT + "v1-expert-reglages.png" });
  await p.keyboard.press("Escape");
  // 4. thème sombre
  await p.click("[data-act=theme]"); await p.waitForTimeout(700); await p.screenshot({ path: OUT + "v1-sombre.png" });
  await p.evaluate(() => window.gabarit.openSketch(window.gabarit.doc.features[0].id)); await p.waitForTimeout(800); await p.screenshot({ path: OUT + "v1-sombre-esquisse.png" });
  console.log("errors", errs);
  await b.close();
})();
