const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  await p.goto("http://localhost:8765/");
  const wait = async () => { await p.waitForTimeout(400); await p.waitForFunction(() => !window.gabarit.st.building, null, { timeout: 60000 }); await p.waitForTimeout(300); };
  const G = (fn) => p.evaluate(fn);
  await p.click("text=Commencer une pièce"); await p.click("text=Plan de dessus");
  const box = await p.locator("#skSvg").boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // contour libre : rectangle à 4 points puis courber un côté
  await p.click("#skTools >> text=Contour libre");
  for (const [x, y] of [[-150, 60], [150, 60], [150, -60], [-150, -60]]) await p.mouse.click(cx + x, cy + y);
  await p.keyboard.press("Enter");
  await p.click("#skTools >> text=Choisir");
  // poignée milieu du côté haut (de -150,-60 vers 150,-60 en écran = segment 0 ?)
  const mids = await p.locator("circle.handle.mid").all(); console.log("mid handles", mids.length);
  const mb = await mids[0].boundingBox();
  await p.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2); await p.mouse.down(); await p.mouse.move(mb.x + 4, mb.y - 40, { steps: 6 }); await p.mouse.up();
  console.log("pts", JSON.stringify(await G(() => window.gabarit.doc.features[0].entities[0].pts)));
  await p.screenshot({ path: "/tmp/claude-0/shots/20-arc.png" });
  await p.click("#skTools button[title=Entrée]");
  await p.click(".tbtn[data-tool=extrude]"); await p.waitForFunction(() => window.gabarit.st.mesh, null, { timeout: 30000 }); await wait();
  console.log("extrude", JSON.stringify(await G(() => [window.gabarit.st.errors, window.gabarit.st.mesh.bb])));
  // plan de référence décalé de 30 depuis le dessus
  await p.click(".tbtn[data-tool=plane]"); await p.click("dialog >> text=Plan de dessus"); await wait();
  // esquisse sur ce plan, via la liste
  await p.click(".tbtn[data-tool=sketch]"); await p.click("dialog >> text=Plan de dessus");
  await p.selectOption("#props select >> nth=0", { label: "Plan 1" });
  await p.click("#skTools >> text=Cercle");
  await p.mouse.click(cx, cy); await p.mouse.click(cx + 40, cy);
  await p.click("#skTools button[title=Entrée]"); await wait();
  // lissage entre esquisse 1 et 2 ? esquisse 1 déjà extrudée : on prend Esquisse 2 + une 3e au-dessus
  await p.evaluate(() => { const g = window.gabarit; const d = JSON.parse(JSON.stringify(g.doc));
    d.features.push({ id: "s3", type: "sketch", name: "Esquisse haut", plane: { kind: "ref", ref: d.features.find(f => f.type === "plane").id, offset: "25" }, entities: [{ id: "q", type: "rect", cx: "0", cy: "0", w: "6", h: "6", r: "0", a: "0" }] });
    g.loadDoc(d, false); });
  await wait();
  await p.click("#tree >> text=Esquisse 2"); await p.click(".tbtn[data-tool=loft]"); await wait();
  console.log("loft", JSON.stringify(await G(() => [window.gabarit.doc.features.at(-1).sketches, window.gabarit.st.errors, window.gabarit.st.mesh.bb])));
  // dépouille sur une face latérale (x max)
  await p.click(".tbtn[data-tool=draft]"); await p.waitForTimeout(1200);
  const q = await G(() => { const v = window.gabarit.viewer; const V = v.camera.position.constructor; const [a, b] = v.data.bb; const P = new V(b[0], 0, 4); P.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect(); return [r.left + (P.x + 1) / 2 * r.width, r.top + (1 - P.y) / 2 * r.height]; });
  await p.mouse.move(q[0] - 3, q[1]); await p.mouse.click(q[0] - 3, q[1]); await p.waitForTimeout(300);
  await p.click("#banner >> text=Valider"); await wait();
  console.log("draft", JSON.stringify(await G(() => [window.gabarit.doc.features.at(-1).faces, window.gabarit.st.errors])));
  // import du STEP exporté plus tôt
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click(".tbtn[data-tool=import]")]);
  await fc.setFiles("/tmp/claude-0/shots/test.step"); await p.waitForTimeout(500); await wait();
  await p.fill("#props .field input >> nth=1", "70"); await p.press("#props .field input >> nth=1", "Tab"); await wait();
  console.log("import", JSON.stringify(await G(() => [window.gabarit.st.errors, window.gabarit.st.mesh.bb])));
  // répétition de fonctions : perçage répété
  // centre de gravité + mesure + coupe
  await p.click(".cogchk input"); await p.waitForTimeout(300);
  await p.click(".tbtn[data-tool=section]"); await p.waitForTimeout(300);
  await p.click("text=Recadrer"); await p.waitForTimeout(500);
  await p.screenshot({ path: "/tmp/claude-0/shots/21-section.png" });
  await p.click("#secbar >> text=Fermer");
  await p.click(".tbtn[data-tool=measure]");
  const c1 = await G(() => { const v = window.gabarit.viewer; const V = v.camera.position.constructor; const out = []; for (const P0 of [[-29.9, -11.9, 9.9], [29.9, -11.9, 9.9]]) { const P = new V(...P0); P.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect(); out.push([r.left + (P.x + 1) / 2 * r.width, r.top + (1 - P.y) / 2 * r.height]); } return out; });
  for (const c of c1) { await p.mouse.move(c[0], c[1]); await p.mouse.click(c[0], c[1]); await p.waitForTimeout(200); }
  console.log("measure", await p.locator("#banner span").textContent());
  await p.screenshot({ path: "/tmp/claude-0/shots/22-measure.png" });
  await p.click("#banner >> text=Fermer");
  // mise en plan
  await p.click(".tbtn[data-tool=drawing]"); await p.waitForSelector(".sheet svg", { timeout: 60000 }); await p.waitForTimeout(500);
  await p.screenshot({ path: "/tmp/claude-0/shots/23-drawing.png" });
  console.log(logs.join("\n") || "no errors"); await b.close();
})();
