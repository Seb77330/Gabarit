// v0.9.2 : ouvrir un fichier 3MF (format Bambu Studio) puis le modifier.
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) process.exitCode = 1; };
  const idle = () => p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building && !document.querySelector(".busy:not([hidden])"), null, { timeout: 120000 });
  await p.goto("http://localhost:8765/");
  await p.click("text=Nouvelle pièce");
  await p.waitForTimeout(500);
  await p.setInputFiles("#fileIn", "tools/fixtures/support.3mf");
  await p.waitForFunction(() => window.gabarit.doc.features.length, null, { timeout: 20000 });
  await idle(); await p.waitForTimeout(500);
  let m = await p.evaluate(() => ({ bb: window.gabarit.st.mesh.bb, v: window.gabarit.st.mesh.volume, name: window.gabarit.doc.name, f: window.gabarit.doc.features.map((f) => f.type + ":" + f.name) }));
  console.log(JSON.stringify(m));
  ok(Math.abs(m.v - 12000) < 1, "volume du 3MF importé = 12 000 mm³");
  ok(Math.abs(m.bb[0][0] + 20) < 1e-3 && Math.abs(m.bb[1][1] - 15) < 1e-3 && Math.abs(m.bb[0][2]) < 1e-3, "pièce recentrée, posée sur z = 0");
  ok(m.name === "support", "nom de la pièce = nom du fichier");
  await p.screenshot({ path: "/tmp/claude-0/shots/93-3mf.png" });
  // on la modifie : un cylindre extrudé sur le dessus, puis un trou
  await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.gabarit.doc));
    d.features.push({ id: "s1", type: "sketch", name: "Plot", plane: { kind: "std", name: "dessus", offset: "10" }, entities: [{ id: "c1", type: "circle", cx: "0", cy: "0", d: "10" }] });
    d.features.push({ id: "x1", type: "extrude", name: "Plot", sketch: "s1", mode: "add", dir: "one", dist: "5" });
    d.features.push({ id: "s2", type: "sketch", name: "Trou", plane: { kind: "std", name: "dessus", offset: "0" }, entities: [{ id: "c2", type: "circle", cx: "12", cy: "0", d: "4" }] });
    d.features.push({ id: "x2", type: "extrude", name: "Trou", sketch: "s2", mode: "cut", dir: "one", dist: "10" });
    window.gabarit.loadDoc(d);
  });
  await idle(); await p.waitForTimeout(500);
  m = await p.evaluate(() => ({ v: window.gabarit.st.mesh.volume, err: window.gabarit.st.errors }));
  const want = 12000 + Math.PI * 25 * 5 - Math.PI * 4 * 10;
  console.log(JSON.stringify(m), "attendu", want.toFixed(1));
  ok(Math.abs(m.v - want) < 2, "3MF modifié : plot ajouté et trou percé");
  await p.evaluate(() => window.gabarit.viewer.fit([1, -1.3, 0.9]));
  await p.waitForTimeout(400);
  await p.screenshot({ path: "/tmp/claude-0/shots/94-3mf-modifie.png" });
  // fichier plus détaillé (maillage courbe)
  const t0 = Date.now();
  await p.setInputFiles("#fileIn", "tools/fixtures/boule.3mf");
  await p.waitForFunction(() => window.gabarit.doc.name === "boule" && window.gabarit.doc.features.length, null, { timeout: 20000 });
  await idle();
  m = await p.evaluate(() => ({ v: window.gabarit.st.mesh.volume, n: window.gabarit.doc.features.length }));
  console.log("boule", JSON.stringify(m), (Date.now() - t0) + " ms");
  ok(m.v > 13900 && m.v < 14200, "boule importée et allégée");
  console.log("errors", logs.length ? logs : "none");
  await b.close();
})();
