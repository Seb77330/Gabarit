// v0.9.4 : onglets de pièces (nouvel onglet, changer, fermer) et bouton Mettre à jour.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) process.exitCode = 1; };
  const names = () => p.$$eval("#tabs .tab .nm", (l) => l.map((x) => x.textContent.replace(/\s/g, " ")));
  await p.goto("http://localhost:8765/?mode=expert");
  await p.click("text=Voir l’exemple");
  await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 60000 });
  ok((await names()).join() === "Équerre de fixation", "un onglet pour l’exemple : " + (await names()).join(" | "));
  await p.click("#tabs .tab-new"); await p.waitForTimeout(300); await p.evaluate(() => document.querySelector("#dlg")?.close());
  ok((await names()).length === 2 && await p.evaluate(() => window.gabarit.doc.features.length === 0), "+ : nouvelle pièce vide dans un 2ᵉ onglet");
  await p.fill("#docName", "Ma boîte"); await p.press("#docName", "Enter"); await p.waitForTimeout(200);
  ok((await names())[1] === "Ma boîte", "le nom de l’onglet suit le nom de la pièce");
  await p.click("#tabs .tab >> nth=0"); await p.waitForTimeout(400);
  ok(await p.evaluate(() => window.gabarit.doc.name) === "Équerre de fixation", "retour au 1er onglet");
  // relance : les onglets restent
  await p.reload(); await p.waitForTimeout(800);
  if (await p.locator("#welcome:not([hidden])").count()) await p.click("#welcome >> text=Continuer");
  ok((await names()).join() === "Équerre de fixation,Ma boîte", "onglets gardés après relance");
  // fermer l'onglet actif
  await p.click("#tabs .tab.on .x"); await p.waitForTimeout(400);
  ok((await names()).join() === "Ma boîte" && await p.evaluate(() => window.gabarit.doc.name) === "Ma boîte", "✕ ferme l’onglet, on passe au suivant");
  await p.click("#tabs .tab.on .x"); await p.waitForTimeout(400);
  ok((await names()).length === 1 && await p.evaluate(() => window.gabarit.doc.features.length === 0), "fermer le dernier : pièce vide");
  ok(await p.locator(".status .upd").isVisible(), "bouton Mettre à jour en bas : " + await p.locator(".status .upd").innerText());
  await p.screenshot({ path: TMP + "/shots/99-onglets.png" });
  console.log("errors", logs.length ? logs : "none");
  await b.close();
})();
