const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  const G = (fn) => p.evaluate(fn);
  const idle = () => p.waitForFunction(() => !window.gabarit.st.building, null, { timeout: 60000 });
  await p.goto("http://localhost:8765/");
  await p.waitForFunction(() => window.gabarit && document.querySelector("#welcome"), null, { timeout: 60000 });
  // nouvelle pièce vide
  await p.click("text=Nouvelle pièce"); await p.waitForTimeout(500);
  console.log("start", await G(() => [window.gabarit.doc.kind || "part", window.gabarit.doc.features.length]));
  // 1) Esquisse → rectangle → clic direct sur Extrusion (sans Terminer)
  await p.click("#dlg >> text=Plan de dessus");
  await p.waitForTimeout(300);
  const r = await p.locator("#skSvg").boundingBox();
  await p.mouse.move(r.x + r.width / 2 - 80, r.y + r.height / 2 - 60); await p.mouse.down();
  await p.mouse.move(r.x + r.width / 2 + 80, r.y + r.height / 2 + 60, { steps: 5 }); await p.mouse.up();
  await p.waitForTimeout(200);
  console.log("toolbar enabled in sketch", await G(() => !document.querySelector(".tbtn[data-tool=extrude]").disabled));
  await p.click(".tbtn[data-tool=extrude]"); await p.waitForTimeout(300); await idle(); await p.waitForTimeout(300);
  console.log("after extrude click", await G(() => [window.gabarit.st.editSketch, window.gabarit.doc.features.map((f) => f.type).join(","), window.gabarit.st.sel && window.gabarit.doc.features.find((f) => f.id === window.gabarit.st.sel).type, !!window.gabarit.st.mesh]));
  await p.keyboard.press("Enter"); await p.waitForTimeout(200);
  console.log("after Enter", await G(() => window.gabarit.st.sel));
  // 2) Présélection d'une arête → barre d'actions → Congé
  await p.click("#views >> text=3D").catch(() => {}); await p.waitForTimeout(500);
  const ept = await G(() => {
    const v = window.gabarit.viewer; const cam = v.camera; const L = v.data.lines; const r = v.renderer.domElement.getBoundingClientRect();
    const g = v.data.edgeGroups.find((g) => { const s = g.start * 3; const e = (g.start + g.count - 1) * 3; return Math.abs(L[s + 2] - L[e + 2]) < 1e-6 && L[s + 2] > 1; });
    const s = g.start * 3, e = (g.start + g.count - 1) * 3;
    const P = new cam.position.constructor((L[s] + L[e]) / 2, (L[s + 1] + L[e + 1]) / 2, (L[s + 2] + L[e + 2]) / 2).project(cam);
    return { x: r.left + (P.x + 1) / 2 * r.width, y: r.top + (1 - P.y) / 2 * r.height };
  });
  await p.mouse.click(ept.x, ept.y); await p.waitForTimeout(300);
  console.log("preselect", await G(() => [window.gabarit.st.pre.edges.length, window.gabarit.st.pre.faces.length]), await p.locator("#faceAct button").allInnerTexts());
  await p.screenshot({ path: "/tmp/claude-0/shots/80-preselect.png" });
  await p.click("#faceAct >> text=Congé"); await idle(); await p.waitForTimeout(400);
  console.log("fillet", await G(() => { const f = window.gabarit.doc.features.at(-1); return [f.type, f.edges.length, window.gabarit.st.pick?.kind, JSON.stringify(window.gabarit.st.info[f.id] || {}), window.gabarit.st.errors, document.querySelector("#status").innerText.slice(0, 40)]; }));
  await p.screenshot({ path: "/tmp/claude-0/shots/81-fillet.png" });
  await p.keyboard.press("Enter"); await p.waitForTimeout(200);
  console.log("validated", await G(() => [window.gabarit.st.pick, window.gabarit.st.sel]));
  // 3) Extrusion d'abord (sans esquisse libre) : le bouton vert porte le nom de l'action
  await p.click(".tbtn[data-tool=extrude]"); await p.waitForTimeout(200);
  const dlg = await p.locator("#dlg").isVisible();
  if (dlg) await p.click("#dlg >> text=Plan de face");
  await p.waitForTimeout(300);
  console.log("done label", await p.locator(".sk-tools .tbtn.on").last().innerText());
  console.log("errors", logs.length ? logs : "none");
  await b.close();
})();
