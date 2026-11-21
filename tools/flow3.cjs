const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  await p.goto("http://localhost:8765/?mode=expert");
  await p.click("text=Nouvelle pièce"); await p.click("text=Plan de face");
  const box = await p.locator("#skSvg").boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await p.mouse.move(cx + 30, cy - 120); await p.mouse.down(); await p.mouse.move(cx + 120, cy + 60, { steps: 6 }); await p.mouse.up();
  const dim = p.locator("g.dim.edit").first(); const bb = await dim.boundingBox();
  await p.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.waitForTimeout(200);
  console.log("input?", await p.locator(".dim-input").count());
  await p.keyboard.press("Control+a"); await p.keyboard.type("22"); await p.keyboard.press("Enter");
  await p.waitForTimeout(200);
  console.log(JSON.stringify(await p.evaluate(() => window.gabarit.doc.features[0].entities)));
  await p.screenshot({ path: TMP + "/shots/10-dim.png" });
  await p.click("#skTools button[title=Entrée]");
  await p.click(".tbtn[data-tool=revolve]");
  await p.waitForFunction(() => window.gabarit.st.mesh, null, { timeout: 30000 }); await p.waitForTimeout(800);
  console.log("revolve", JSON.stringify(await p.evaluate(() => [window.gabarit.st.errors, window.gabarit.st.mesh.bb])));
  await p.screenshot({ path: TMP + "/shots/11-rev.png" });
  // coque : face du dessus
  await p.click(".tbtn[data-tool=shell]"); await p.waitForTimeout(1000);
  const q = await p.evaluate(() => { const v = window.gabarit.viewer; const V = v.camera.position.constructor; const [a, b] = v.data.bb; const P = new V((a[0]+b[0])/2*0.0+ (b[0]*0.6), 0, b[2]); P.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect(); return [r.left + (P.x + 1) / 2 * r.width, r.top + (1 - P.y) / 2 * r.height]; });
  await p.mouse.move(q[0], q[1]); await p.mouse.click(q[0], q[1]); await p.waitForTimeout(300);
  await p.click("#corner .ok"); await p.waitForTimeout(400);
  await p.waitForFunction(() => !window.gabarit.st.building, null, { timeout: 30000 }); await p.waitForTimeout(500);
  console.log("shell", JSON.stringify(await p.evaluate(() => [window.gabarit.doc.features.at(-1).faces, window.gabarit.st.errors, window.gabarit.st.mesh.volume])));
  await p.screenshot({ path: TMP + "/shots/12-shell.png" });
  // mobile
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(600);
  await p.screenshot({ path: TMP + "/shots/13-mobile.png" });
  console.log(logs.join("\n") || "no errors"); await b.close();
})();
