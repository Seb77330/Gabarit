// v0.9.3 : outil Ligne, types de rectangle à gauche, zones à extruder quand les contours se croisent.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) process.exitCode = 1; };
  const idle = () => p.waitForFunction(() => window.gabarit.st.mesh !== undefined && !window.gabarit.st.building, null, { timeout: 60000 });
  await p.goto("http://localhost:8765/?mode=expert");
  await p.click("text=Nouvelle pièce"); await p.waitForTimeout(400); await p.evaluate(() => document.querySelector("#dlg")?.close());
  // esquisse avec deux cercles qui se croisent
  await p.evaluate(() => window.gabarit.loadDoc({ version: 1, name: "Zones", material: "pla", params: [], features: [{ id: "s1", type: "sketch", name: "Esquisse 1", plane: { kind: "std", name: "dessus", offset: "0" }, entities: [{ id: "c1", type: "circle", cx: "0", cy: "0", d: "20" }, { id: "c2", type: "circle", cx: "12", cy: "0", d: "20" }] }] }));
  await p.waitForTimeout(1500);
  // outil Ligne dans l'esquisse
  await p.evaluate(() => window.gabarit.openSketch("s1")); await p.waitForTimeout(800);
  const S = (w) => p.evaluate((w) => { const s = window.gabarit.sketcher; const r = s.svg.getBoundingClientRect(); const q = s.toS(w); return [r.left + q[0], r.top + q[1]]; }, w);
  const click = async (w) => { const [x, y] = await S(w); await p.mouse.move(x, y); await p.mouse.click(x, y); await p.waitForTimeout(80); };
  const ents = () => p.evaluate(() => window.gabarit.doc.features.find((f) => f.id === "s1").entities);
  await p.evaluate(() => { const s = window.gabarit.sketcher; s.zoom /= 2; s.render(); });
  await p.click(".sk-tools [data-sk=line]");
  await click([-20, 20]); await click([-10, 28]); await click([-2, 20]); await click([-20, 20]);
  let E = await ents(); ok(E.length === 3 && E[2].type === "poly" && E[2].pts.length === 3, "ligne fermée = triangle " + JSON.stringify(E[2]?.pts));
  await click([5, 20]); await click([15, 27]); await p.keyboard.press("Escape"); await p.waitForTimeout(100);
  E = await ents(); ok(E.length === 4 && E[3].type === "path" && E[3].pts.length === 2, "ligne en diagonale gardée après Échap");
  ok(await p.evaluate(() => window.gabarit.sketcher.tool) === "select", "Échap : fin de l'outil");
  // types de rectangle dans le panneau de gauche
  await p.click(".sk-tools [data-sk=rect]"); await p.waitForTimeout(150);
  const types = await p.locator(".skm-list").innerText().catch(() => "");
  ok(/Coin\sà\scoin/.test(types) && /Depuis\sle\scentre/.test(types) && /3\spoints/.test(types), "types de rectangle à gauche : " + types.replace(/\n/g, " | "));
  await p.screenshot({ path: TMP + "/shots/95-ligne-types.png" });
  // on retire le triangle et la ligne, puis on sort
  await p.evaluate(() => { const f = window.gabarit.doc.features.find((x) => x.id === "s1"); f.entities = f.entities.slice(0, 2); });
  await p.keyboard.press("Escape");
  await p.click("#corner .ok"); await p.waitForTimeout(400);
  await p.evaluate(() => window.gabarit.loadDoc(JSON.parse(JSON.stringify(window.gabarit.doc))));
  await p.waitForTimeout(800);
  await p.click("#tree >> text=Esquisse 1"); await p.waitForTimeout(200);
  await p.click(".tbtn[data-tool=extrude]");
  await p.waitForFunction(() => window.gabarit.st.pick?.kind === "regions" && window.gabarit.st.regions?.length, null, { timeout: 30000 });
  const n = await p.evaluate(() => window.gabarit.st.regions.length);
  ok(n === 3, "3 zones proposées (gauche, milieu, droite) : " + n);
  ok(/clique\sles\szones/i.test(await p.locator("#banner").innerText()), "bandeau : cliquer les zones");
  await p.evaluate(() => window.gabarit.viewer.fit([0, 0, 1])); await p.waitForTimeout(400);
  const W = (w) => p.evaluate((w) => { const v = window.gabarit.viewer; const r = v.renderer.domElement.getBoundingClientRect(); const P = new v.camera.position.constructor(...w).project(v.camera); return [r.left + (P.x + 1) / 2 * r.width, r.top + (1 - P.y) / 2 * r.height]; }, w);
  let [x, y] = await W([6, 0, 0]); await p.mouse.click(x, y); await p.waitForTimeout(300);
  await idle(); await p.waitForTimeout(800);
  await p.screenshot({ path: TMP + "/shots/96-zones.png" });
  await p.keyboard.press("Enter"); await idle(); await p.waitForTimeout(800);
  let v = await p.evaluate(() => window.gabarit.st.mesh?.volume);
  ok(Math.abs(v - 894.59) < 2, "seule la zone du milieu est extrudée : " + v);
  // on ajoute la zone de gauche
  await p.click("#tree >> text=Extrusion"); await p.waitForTimeout(200);
  await p.click("text=Choisir les zones");
  await p.waitForFunction(() => window.gabarit.st.regions?.length, null, { timeout: 30000 });
  [x, y] = await W([-5, 0, 0]); await p.mouse.click(x, y); await p.waitForTimeout(300);
  await p.keyboard.press("Enter"); await idle(); await p.waitForTimeout(800);
  v = await p.evaluate(() => window.gabarit.st.mesh?.volume);
  ok(Math.abs(v - 3141.59) < 3, "zones gauche + milieu = cercle de gauche : " + v);
  await p.evaluate(() => window.gabarit.viewer.fit([1, -1.3, 0.9])); await p.waitForTimeout(400);
  await p.screenshot({ path: TMP + "/shots/97-zones-extrudees.png" });
  console.log("errors", logs.length ? logs : "none");
  await b.close();
})();
