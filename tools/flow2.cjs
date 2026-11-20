const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const logs = [];
  p.on("console", (m) => { if (m.type() === "error") logs.push("console: " + m.text()); });
  p.on("pageerror", (e) => logs.push("pageerror: " + e.message + "\n" + e.stack));
  await p.goto("http://localhost:8765/");
  await p.click("text=Voir l’exemple");
  await p.waitForFunction(() => window.gabarit.st.mesh, null, { timeout: 60000 });
  const wait = async () => { await p.waitForTimeout(400); await p.waitForFunction(() => !window.gabarit.st.building, null, { timeout: 60000 }); await p.waitForTimeout(200); };
  const pin = p.locator("#params .param input");
  await pin.nth(1).fill("90"); await pin.nth(1).press("Tab"); // longueur
  await pin.nth(3).fill("70"); await pin.nth(3).press("Tab"); // hauteur
  await wait();
  console.log("param change", JSON.stringify(await p.evaluate(() => [window.gabarit.st.errors, window.gabarit.st.info, window.gabarit.st.mesh.bb])));
  await p.screenshot({ path: "/tmp/claude-0/shots/7-params.png" });
  // esquisse sur une face : la face du dessus du pied
  await p.click(".tbtn[data-tool=sketch]");
  await p.click("text=Une face de la pièce…");
  const scr = (x, y, z) => p.evaluate(([x, y, z]) => { const v = window.gabarit.viewer; const V = v.camera.position.constructor; const P = new V(x, y, z); P.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect(); return [r.left + (P.x + 1) / 2 * r.width, r.top + (1 - P.y) / 2 * r.height]; }, [x, y, z]);
  let q = await scr(70, 0, 5); await p.mouse.move(q[0], q[1]); await p.mouse.click(q[0], q[1]);
  await p.waitForTimeout(500);
  console.log("sketch plane", JSON.stringify(await p.evaluate(() => window.gabarit.doc.features.at(-1).plane)));
  // ajoute un cercle via doc (rapide) puis termine et extrude
  await p.evaluate(() => { const g = window.gabarit; g.doc.features.at(-1).entities.push({ id: "zz", type: "circle", cx: "70", cy: "0", d: "12" }); });
  await p.click("#skTools button[title=Entrée]");
  await p.click(".tbtn[data-tool=extrude]");
  await wait();
  console.log("boss", JSON.stringify(await p.evaluate(() => [window.gabarit.st.errors, window.gabarit.st.mesh.bb])));
  // révolution : nouvelle esquisse plan de face, profil décalé de l'axe
  await p.evaluate(() => { const g = window.gabarit; const d = JSON.parse(JSON.stringify(g.doc));
    d.features.push({ id: "rs", type: "sketch", name: "Profil bouton", plane: { kind: "std", name: "face", offset: "0" }, entities: [{ id: "r1", type: "rect", cx: "4", cy: "-6", w: "8", h: "12", r: "0", a: "0" }] });
    d.features.push({ id: "rv", type: "revolve", name: "Révolution 1", sketch: "rs", mode: "add", axis: "y", angle: "360" });
    d.features.push({ id: "pt", type: "pattern", name: "Répétition 1", kind: "circ", axis: "z", count: "4", angle: "360" });
    d.features.push({ id: "mi", type: "mirror", name: "Symétrie 1", plane: { kind: "std", name: "dessus", offset: "-12" } });
    g.loadDoc(d, false); });
  await wait();
  console.log("rev+pattern+mirror", JSON.stringify(await p.evaluate(() => [window.gabarit.st.errors, window.gabarit.st.mesh.bb, window.gabarit.st.lastMs])));
  await p.click("text=3D"); await p.waitForTimeout(300); await p.click("text=Recadrer"); await p.waitForTimeout(500);
  await p.screenshot({ path: "/tmp/claude-0/shots/8-complex.png" });
  // fin de pièce remontée
  await p.evaluate(() => { window.gabarit.st.stopAt = 2; }); 
  // ouvrir l'esquisse du profil en L
  await p.dblclick("#tree >> text=Profil en L");
  await p.waitForTimeout(800);
  await p.screenshot({ path: "/tmp/claude-0/shots/9-edit-sketch.png" });
  console.log(logs.join("\n") || "no errors");
  await b.close();
})();
