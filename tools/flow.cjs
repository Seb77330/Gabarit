const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const logs = [];
  p.on("console", (m) => { if (m.type() === "error") logs.push("console: " + m.text()); });
  p.on("pageerror", (e) => logs.push("pageerror: " + e.message + "\n" + e.stack));
  await p.goto(process.argv[2] || "http://localhost:8765/");
  await p.waitForFunction(() => window.gabarit, null);
  await p.click("text=Nouvelle pièce");
  await p.click("text=Plan de dessus");
  await p.waitForTimeout(300);
  const box = await p.locator("#skSvg").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // rectangle par glisser
  await p.mouse.move(cx - 150, cy - 90); await p.mouse.down(); await p.mouse.move(cx + 150, cy + 90, { steps: 8 }); await p.mouse.up();
  // cercle : outil, clic centre, clic bord
  await p.click("#skTools >> text=Cercle");
  await p.mouse.click(cx + 60, cy); await p.mouse.move(cx + 90, cy, { steps: 4 }); await p.mouse.click(cx + 90, cy);
  // contour libre
  await p.click("#skTools >> text=Contour libre");
  for (const [x, y] of [[-120, -60], [-60, -60], [-90, 0]]) await p.mouse.click(cx + x, cy + y);
  await p.mouse.click(cx - 120, cy - 60);
  await p.screenshot({ path: "/tmp/claude-0/shots/3-sketch.png" });
  const ents = await p.evaluate(() => window.gabarit.doc.features[0].entities);
  console.log("entities", JSON.stringify(ents));
  await p.click("#skTools button[title=Entrée]");
  await p.click(".tbtn[data-tool=extrude]");
  await p.waitForFunction(() => window.gabarit.st.mesh, null, { timeout: 30000 });
  await p.waitForTimeout(500);
  // distance 15
  const inp = p.locator("#props .field input[type=text]").first();
  await inp.fill("15"); await inp.press("Tab");
  await p.waitForTimeout(1500);
  console.log("bb after extrude", JSON.stringify(await p.evaluate(() => window.gabarit.st.mesh.bb)), JSON.stringify(await p.evaluate(() => window.gabarit.st.errors)));
  await p.screenshot({ path: "/tmp/claude-0/shots/4-extrude.png" });
  // congé : cliquer sur une arête projetée
  await p.click(".tbtn[data-tool=fillet]");
  await p.waitForTimeout(1200);
  const pt = await p.evaluate(() => {
    const v = window.gabarit.viewer; const THREE_V = v.camera.position.constructor;
    const [a, b] = v.data.bb; const P = new THREE_V(b[0], 0, b[2]); P.project(v.camera);
    const r = v.renderer.domElement.getBoundingClientRect();
    return [r.left + (P.x + 1) / 2 * r.width, r.top + (1 - P.y) / 2 * r.height];
  });
  await p.mouse.move(pt[0], pt[1]); await p.mouse.click(pt[0], pt[1]);
  await p.waitForTimeout(800);
  console.log("fillet edges", JSON.stringify(await p.evaluate(() => window.gabarit.doc.features.at(-1).edges)));
  await p.click("#corner .ok");
  await p.waitForTimeout(2000);
  console.log("errors", JSON.stringify(await p.evaluate(() => window.gabarit.st.errors)), "vol", await p.evaluate(() => window.gabarit.st.mesh.volume));
  await p.screenshot({ path: "/tmp/claude-0/shots/5-fillet.png" });
  // perçage sur la face du dessus
  await p.click(".tbtn[data-tool=hole]");
  await p.click("text=Une face de la pièce…");
  const top = await p.evaluate(() => {
    const v = window.gabarit.viewer; const V = v.camera.position.constructor; const [a, b] = v.data.bb;
    const P = new V(12, -8, b[2]); P.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect();
    return [r.left + (P.x + 1) / 2 * r.width, r.top + (1 - P.y) / 2 * r.height];
  });
  await p.mouse.move(top[0], top[1]); await p.mouse.click(top[0], top[1]);
  await p.waitForTimeout(800);
  await p.mouse.move(top[0] + 5, top[1] + 3); await p.mouse.click(top[0] + 5, top[1] + 3);
  await p.waitForTimeout(500);
  console.log("hole", JSON.stringify(await p.evaluate(() => window.gabarit.doc.features.at(-1))));
  await p.click("#corner .ok");
  await p.waitForTimeout(2000);
  console.log("errors", JSON.stringify(await p.evaluate(() => window.gabarit.st.errors)));
  await p.screenshot({ path: "/tmp/claude-0/shots/6-hole.png" });
  // export
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), p.click("[data-act=stl]")]);
  const path = "/tmp/claude-0/shots/test.stl"; await dl.saveAs(path); console.log("stl", dl.suggestedFilename(), require("fs").statSync(path).size);
  const [dl2] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), (async () => { await p.click("[data-act=more]"); await p.click("#dlg .planes button >> nth=0"); })()]);
  await dl2.saveAs("/tmp/claude-0/shots/test.step"); console.log("step", dl2.suggestedFilename(), require("fs").statSync("/tmp/claude-0/shots/test.step").size);
  // annuler
  await p.keyboard.press("Control+z"); await p.waitForTimeout(300);
  console.log("after undo feats", await p.evaluate(() => window.gabarit.doc.features.length));
  console.log(logs.join("\n") || "no errors");
  await b.close();
})();
