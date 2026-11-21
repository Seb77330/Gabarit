const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message)); p.on("dialog", (d) => d.accept());
  await p.goto("http://localhost:8765/?mode=expert"); await p.click("text=Voir l’exemple");
  await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 60000 }); await p.waitForTimeout(500);
  // depuis la v1.4, une pièce seulement regardée n'est plus rangée toute seule dans « Mes pièces » : on la modifie d'abord
  console.log("avant modification", await p.evaluate(() => Object.keys(window.gabarit.library())));
  await p.evaluate(() => { const g = window.gabarit; g.mutate(() => { g.doc.material = "petg"; }); });
  await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.reload(); await p.waitForTimeout(1500);
  console.log("welcome", await p.locator("#welcome .card button").allInnerTexts());
  await p.screenshot({ path: TMP + "/shots/96-accueil.png" });
  await p.click("#welcome .rec-del"); await p.waitForTimeout(400);
  console.log("after delete", await p.locator("#welcome .card button").allInnerTexts(), await p.evaluate(() => [window.gabarit.doc.features.length, Object.keys(window.gabarit.library())]));
  console.log("version", await p.locator(".status .ver").innerText());
  console.log("errors", logs.length ? logs : "none");
  await b.close();
})();
