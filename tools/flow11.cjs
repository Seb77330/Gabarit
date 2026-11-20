const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  await p.goto("http://localhost:8765/?mode=expert");
  await p.click("text=Voir l’exemple");
  await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 60000 });
  await p.waitForTimeout(800);
  // point écran du centre d'une face plane tournée vers la caméra
  const pt = await p.evaluate(() => {
    const v = window.gabarit.viewer; const cam = v.camera; const d = v.data;
    const r = v.renderer.domElement.getBoundingClientRect();
    const dir = cam.position.clone().sub(v.controls.target).normalize();
    let best = null;
    Object.entries(d.faces).forEach(([id, f]) => { if (!f?.plane) return; const s = f.n[0] * dir.x + f.n[1] * dir.y + f.n[2] * dir.z; if (!best || s > best.s) best = { s, f, id }; });
    const P = new cam.position.constructor(22, 14, 5).project(cam);
    return { x: r.left + (P.x + 1) / 2 * r.width, y: r.top + (1 - P.y) / 2 * r.height, n: best.f.n };
  });
  console.log("face", JSON.stringify(pt));
  await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(300);
  console.log("faceAct", await p.locator("#faceAct").innerText().catch(() => "none"), JSON.stringify(await p.evaluate(() => ({ e: window.gabarit.st.pre.edges.length, f: window.gabarit.st.pre.faces.map((x) => x.info) }))));
  await p.screenshot({ path: "/tmp/claude-0/shots/70-face.png" });
  await p.click("#faceAct >> text=Esquisser ici");
  await p.waitForTimeout(400);
  await p.waitForFunction(() => !window.gabarit.st.building, null, { timeout: 60000 }); await p.waitForTimeout(500);
  console.log("sketch", await p.evaluate(() => [window.gabarit.st.editSketch, JSON.stringify(window.gabarit.doc.features.find((f) => f.id === window.gabarit.st.editSketch).plane), !!window.gabarit.viewer.sketchView, window.gabarit.sketcher?.refs?.edges?.length]));
  await p.screenshot({ path: "/tmp/claude-0/shots/71-sketch-on-face.png" });
  // outil Reprendre : cliquer sur chaque arête plate
  await p.click(".sk-tools >> text=Reprendre");
  const edges = await p.evaluate(() => { const s = window.gabarit.sketcher; const r = s.svg.getBoundingClientRect(); return s.refs.edges.filter((e) => e.flat).map((e) => { const a = e.pts[0], b = e.pts[1]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const q = s.toS(m); return [r.left + q[0], r.top + q[1]]; }); });
  console.log("flat edges", edges.length);
  for (const [x, y] of edges) { await p.mouse.move(x, y); await p.mouse.click(x, y); await p.waitForTimeout(80); }
  console.log("entities", JSON.stringify(await p.evaluate(() => window.gabarit.doc.features.find((f) => f.id === window.gabarit.st.editSketch).entities.map((e) => e.type + (e.pts ? ":" + e.pts.length : "")))));
  await p.screenshot({ path: "/tmp/claude-0/shots/72-converted.png" });
  console.log("errors", logs.length ? logs : "none");
  await b.close();
})();
