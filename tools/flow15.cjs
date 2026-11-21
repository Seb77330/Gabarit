// v0.9.2 : centres des trous, rectangle depuis le centre / 3 points, cercle 3 points,
// contraintes en Ctrl+clic, désélection.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) process.exitCode = 1; };
  await p.goto("http://localhost:8765/?mode=expert");
  await p.click("text=Voir l’exemple");
  await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 60000 });
  await p.evaluate(() => { const d = window.gabarit.doc; d.features.push({ id: "fsk", type: "sketch", name: "Test", plane: { kind: "std", name: "dessus", offset: "ep" }, entities: [] }); window.gabarit.loadDoc(JSON.parse(JSON.stringify(d))); });
  await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 60000 });
  await p.evaluate(() => window.gabarit.openSketch("fsk"));
  await p.waitForTimeout(400);
  await p.waitForFunction(() => !window.gabarit.st.building, null, { timeout: 60000 }); await p.waitForTimeout(600);
  const centers = await p.evaluate(() => window.gabarit.sketcher.refs.centers);
  console.log("centers", JSON.stringify(centers));
  ok(centers.some((c) => Math.abs(c[0] - 40) < 0.01 && Math.abs(Math.abs(c[1]) - 10) < 0.01), "centres des trous de la pièce trouvés");
  const S = (w) => p.evaluate((w) => { const s = window.gabarit.sketcher; const r = s.svg.getBoundingClientRect(); const q = s.toS(w); return [r.left + q[0], r.top + q[1]]; }, w);
  const click = async (w, o = {}) => { const [x, y] = await S(w); await p.mouse.move(x, y); if (o.modifiers) await p.keyboard.down("Control"); await p.mouse.click(x, y); if (o.modifiers) await p.keyboard.up("Control"); await p.waitForTimeout(90); };
  const ents = () => p.evaluate(() => window.gabarit.doc.features.find((f) => f.id === "fsk").entities);
  const c0 = centers.find((c) => Math.abs(c[0] - 40) < 0.01 && c[1] > 0);
  // cercle concentrique au trou : accroche au centre (on vise un peu à côté)
  await p.click(".sk-tools [data-sk=circle]");
  await click([c0[0] + 0.4, c0[1] - 0.3]); await click([c0[0] + 4, c0[1]]);
  let E = await ents();
  ok(E.length === 1 && E[0].type === "circle" && Math.abs(E[0].cx - 40) < 1e-6 && Math.abs(E[0].cy - c0[1]) < 1e-6, "cercle centré sur le trou : " + JSON.stringify(E[0]));
  await p.screenshot({ path: TMP + "/shots/90-centre.png" });
  // cercle 3 points
  ok(await p.locator("#skMethod").isVisible(), "barre des façons de tracer visible");
  await p.click("#skMethod [data-m=circle3]");
  await click([10, 0]); await click([20, 0]); await click([15, 5]);
  E = await ents(); const c3 = E.at(-1);
  ok(c3.type === "circle" && Math.abs(c3.cx - 15) < 1e-6 && Math.abs(c3.cy) < 1e-6 && Math.abs(c3.d - 10) < 1e-6, "cercle 3 points : " + JSON.stringify(c3));
  // rectangle depuis le centre
  await p.click(".sk-tools [data-sk=rect]");
  await p.click("#skMethod [data-m=rectc]");
  await click([20, -2]); await click([26, 1]);
  E = await ents(); let r = E.at(-1);
  ok(r.type === "rect" && r.cx === 20 && r.cy === -2 && r.w === 12 && r.h === 6, "rectangle depuis le centre : " + JSON.stringify(r));
  // rectangle 3 points incliné
  await p.click("#skMethod [data-m=rect3]");
  await click([0, -12]); await click([8, -6]); await click([5, -1]);
  E = await ents(); r = E.at(-1);
  ok(r.type === "rect" && Math.abs(r.w - 10) < 1e-6 && Math.abs(r.a - 36.87) < 0.01 && r.h > 0, "rectangle 3 points : " + JSON.stringify(r));
  await p.screenshot({ path: TMP + "/shots/91-methodes.png" });
  // le bouton reprend la dernière façon choisie
  ok(await p.evaluate(() => window.gabarit.sketcher.tool) === "rect3", "outil rect3 actif");
  // Échap : on arrête de tracer
  await p.keyboard.press("Escape"); await p.waitForTimeout(100);
  ok(await p.evaluate(() => window.gabarit.sketcher.tool) === "select", "Échap : retour à Choisir");
  // clic droit : arrête l'outil aussi
  await p.click(".sk-tools [data-sk=circle]");
  const [rx, ry] = await S([28, 12]); await p.mouse.click(rx, ry, { button: "right" }); await p.waitForTimeout(100);
  ok(await p.evaluate(() => window.gabarit.sketcher.tool) === "select", "clic droit : retour à Choisir");
  ok((await ents()).length === 4, "aucun cercle en trop");
  // Ctrl+clic sur deux cercles → fenêtre de contraintes
  const e0 = (await ents())[0];
  await click([e0.cx + e0.d / 2, e0.cy]);
  ok(await p.locator("#relBox").isVisible(), "fenêtre de contraintes après un clic");
  await click([15, 5], { modifiers: ["Control"] });
  console.log("subs", JSON.stringify(await p.evaluate(() => window.gabarit.sketcher.subs)));
  const txt = await p.locator("#relBox").innerText().catch(() => "");
  console.log("relBox:", txt.replace(/\n/g, " | "));
  ok(/Même diamètre/.test(txt) && /Concentriques/.test(txt), "Ctrl+clic : contraintes proposées pour deux cercles");
  await p.screenshot({ path: TMP + "/shots/92-ctrl-contraintes.png" });
  await p.click("#relBox >> text=Même diamètre"); await p.waitForTimeout(200);
  E = await ents();
  ok(Math.abs(E[0].d - E[1].d) < 1e-3, `même diamètre appliqué (${E[0].d} / ${E[1].d})`);
  // Ctrl+clic sur un élément déjà choisi : il est retiré
  await click([E[0].cx + E[0].d / 2, E[0].cy]);
  await click([E[0].cx + E[0].d / 2, E[0].cy], { modifiers: ["Control"] });
  ok(await p.evaluate(() => window.gabarit.sketcher.subs.length) === 0, "Ctrl+clic retire de la sélection");
  // clic dans le vide : tout désélectionner
  await click([E[0].cx + E[0].d / 2, E[0].cy]);
  await click([30, 14]);
  ok(await p.evaluate(() => !window.gabarit.sketcher.sel && !window.gabarit.sketcher.subs.length && !document.querySelector("#relBox")), "clic dans le vide : rien de choisi");
  // point au centre du cercle et point sur un côté
  console.log("errors", logs.length ? logs : "none");
  await b.close();
})();
