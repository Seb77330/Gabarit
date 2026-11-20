// v0.9.4 : étirer une pièce importée (3MF) dans une seule direction, puis la tourner.
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) process.exitCode = 1; };
  const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(300); };
  const bb = () => p.evaluate(() => window.gabarit.st.mesh.bb.map((v) => v.map((x) => Math.round(x * 100) / 100)));
  await p.goto("http://localhost:8765/?mode=expert");
  await p.click("text=Nouvelle pièce"); await p.waitForTimeout(400); await p.evaluate(() => document.querySelector("#dlg")?.close());
  await p.setInputFiles("#fileIn", "tools/fixtures/support.3mf");
  await p.waitForFunction(() => window.gabarit.doc.features.length, null, { timeout: 20000 }); await idle();
  await p.waitForSelector("[data-size=sx]");
  const sizes = await p.$$eval("[data-size]", (l) => l.map((x) => x.value));
  ok(sizes.join() === "40,30,10", "tailles affichées : " + sizes.join(" × "));
  await p.fill("[data-size=sx]", "70"); await p.press("[data-size=sx]", "Enter"); await idle();
  let B = await bb(); console.log(JSON.stringify(B));
  ok(Math.abs(B[1][0] - B[0][0] - 70) < 0.01 && Math.abs(B[1][1] - B[0][1] - 30) < 0.01 && Math.abs(B[1][2] - B[0][2] - 10) < 0.01, "allongée en X seulement : 70 × 30 × 10");
  await p.fill("[data-size=sz]", "25"); await p.press("[data-size=sz]", "Enter"); await idle();
  B = await bb(); ok(Math.abs(B[1][2] - B[0][2] - 25) < 0.01 && Math.abs(B[0][2]) < 0.01, "rehaussée à 25 mm, toujours posée sur z = 0");
  ok(Math.abs(await p.evaluate(() => window.gabarit.st.mesh.volume) - 70 * 30 * 25) < 1, "volume 70 × 30 × 25");
  await p.screenshot({ path: "/tmp/claude-0/shots/98-etirer.png" });
  // proportions gardées
  await p.click("label.check >> text=Garder les proportions"); await p.waitForTimeout(200);
  await p.fill("[data-size=sy]", "60"); await p.press("[data-size=sy]", "Enter"); await idle();
  B = await bb(); const d = [0, 1, 2].map((k) => Math.round((B[1][k] - B[0][k]) * 100) / 100);
  ok(d.join() === "140,60,50", "proportions gardées : " + d.join(" × "));
  // rotation
  await p.click("text=Taille d’origine"); await idle();
  await p.evaluate(() => { const f = window.gabarit.doc.features[0]; f.rz = "90"; window.gabarit.loadDoc(JSON.parse(JSON.stringify(window.gabarit.doc))); });
  await idle(); B = await bb();
  ok(Math.abs(B[1][0] - B[0][0] - 30) < 0.01 && Math.abs(B[1][1] - B[0][1] - 40) < 0.01, "tournée de 90° autour de Z");
  console.log("errors", logs.length ? logs : "none");
  await b.close();
})();
