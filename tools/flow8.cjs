const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  await p.goto("http://localhost:8765/?mode=expert");
  await p.click("text=Nouvelle pièce"); await p.click("text=Plan de dessus");
  const box = await p.locator("#skSvg").boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const G = (fn, a) => p.evaluate(fn, a);
  const toS = async (u, v) => { const s = await G(([u, v]) => window.gabarit.sketcher.toS([u, v]), [u, v]); return [box.x + s[0], box.y + s[1]]; };
  // ellipse
  await p.click("#skTools >> text=Ellipse");
  let a = await toS(0, 0), c = await toS(30, 15);
  await p.mouse.move(a[0], a[1]); await p.mouse.down(); await p.mouse.move(c[0], c[1], { steps: 5 }); await p.mouse.up();
  // courbe fermée
  await p.click("#skTools >> text=Courbe");
  for (const [u, v] of [[-10, 0], [0, 5], [10, 0], [0, -5], [-10, 0]]) { const q = await toS(u, v); await p.mouse.click(q[0], q[1]); }
  const sk = () => G(() => window.gabarit.doc.features[0].entities);
  console.log("ents", JSON.stringify(await sk()));
  // symétrie + décalage de l'ellipse
  await p.click("#skTools >> text=Choisir");
  await p.click("#props .ents >> text=Ellipse");
  await p.click("#props >> text=Décalage (positif");
  await p.click("#props >> text=Créer le décalage");
  console.log("after offset", JSON.stringify((await sk()).at(-1)));
  await p.click("#props .ents >> text=Courbe");
  await p.click("#props >> text=Symétrie gauche-droite");
  console.log("after mirror", JSON.stringify((await sk()).at(-1)));
  await p.screenshot({ path: "/tmp/claude-0/shots/54-sketch-new.png" });
  // DXF depuis l'esquisse
  await p.click("[data-act=more]");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#dlg >> text=Enregistrer le DXF")]);
  const txt = require("fs").readFileSync(await dl.path(), "utf8");
  console.log("dxf", dl.suggestedFilename(), txt.length, (txt.match(/POLYLINE/g) || []).length, "polylines");
  await p.click("#skTools button[title=Entrée]");
  await p.click(".tbtn[data-tool=extrude]");
  await p.waitForTimeout(500);
  // la courbe et sa symétrie se croisent : Gabarit demande les zones ; Entrée = tous les contours
  console.log("demande des zones", await G(() => window.gabarit.st.pick?.kind));
  if (await G(() => window.gabarit.st.pick?.kind === "regions")) await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 60000 });
  console.log("vol", await G(() => [Math.round(window.gabarit.st.mesh.volume), window.gabarit.st.errors]));
  for (const k of ["3mf", "obj"]) {
    await p.click("[data-act=more]");
    const [d2] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), p.click(`#dlg .planes button >> nth=${k === "3mf" ? 1 : 2}`)]);
    const buf = require("fs").readFileSync(await d2.path());
    console.log(k, d2.suggestedFilename(), buf.length, buf.slice(0, 4).toString("latin1"));
    if (k === "3mf") require("fs").writeFileSync("/tmp/claude-0/test.3mf", buf);
  }
  // filetage via clic réel sur un cylindre
  await p.evaluate(() => window.gabarit.loadDoc({ version: 1, name: "Vis", material: "acier", params: [], features: [
    { id: "s1", type: "sketch", name: "S", plane: { kind: "std", name: "dessus", offset: "0" }, entities: [{ id: "c", type: "circle", cx: "0", cy: "0", d: "10" }] },
    { id: "x1", type: "extrude", name: "Tige", sketch: "s1", mode: "add", dir: "normal", dist: "30" }] }));
  await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 60000 });
  await p.click(".tbtn[data-tool=thread]");
  await p.waitForTimeout(500);
  const vb = await p.locator("#view").boundingBox();
  // cherche un point du cylindre à l'écran
  let picked = false;
  for (let dx = -60; dx <= 60 && !picked; dx += 10) for (let dy = -60; dy <= 60 && !picked; dy += 10) {
    const hit = await G(([x, y]) => { const v = window.gabarit.viewer; const h = v.hitFace({ clientX: x, clientY: y }); return h?.info?.cyl ? 1 : 0; }, [vb.x + vb.width / 2 + dx, vb.y + vb.height / 2 + dy]);
    if (hit) { await p.mouse.click(vb.x + vb.width / 2 + dx, vb.y + vb.height / 2 + dy); picked = true; }
  }
  await p.waitForTimeout(500);
  await p.waitForFunction(() => !window.gabarit.st.building, null, { timeout: 120000 });
  console.log("thread", picked, await G(() => { const f = window.gabarit.doc.features[2]; return [f.kind, f.pitch, !!f.face, window.gabarit.st.errors, Math.round(window.gabarit.st.mesh.volume)]; }));
  await p.screenshot({ path: "/tmp/claude-0/shots/55-thread-ui.png" });
  console.log("LOGS", logs.join("\n"));
  await b.close();
})();
