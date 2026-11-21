const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  const G = (fn) => p.evaluate(fn);
  const idle = () => p.waitForFunction(() => !window.gabarit.st.building, null, { timeout: 60000 });
  await p.goto("http://localhost:8765/?mode=expert"); await p.click("text=Voir l’exemple");
  await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 60000 }); await p.waitForTimeout(600);
  await p.screenshot({ path: TMP + "/shots/90-home.png" });
  // cube : vue de dessus
  await p.click(".vcube .vf >> text=Dessus"); await p.waitForTimeout(400);
  console.log("cam after Dessus", await G(() => window.gabarit.viewer.camera.position.toArray().map((v) => Math.round(v))));
  await p.screenshot({ path: TMP + "/shots/91-top.png" });
  await p.click(".views >> text=3D"); await p.waitForTimeout(400);
  // clic droit sur une face
  const pt = await G(() => { const v = window.gabarit.viewer, cam = v.camera, r = v.renderer.domElement.getBoundingClientRect(); const P = new cam.position.constructor(22, 14, 5).project(cam); return [r.left + (P.x + 1) / 2 * r.width, r.top + (1 - P.y) / 2 * r.height]; });
  await p.mouse.click(pt[0], pt[1], { button: "right" }); await p.waitForTimeout(300);
  console.log("context", await p.locator("#menu button").allInnerTexts());
  await p.screenshot({ path: TMP + "/shots/92-context.png" });
  await p.keyboard.press("Escape");
  // touche S
  await p.mouse.move(700, 450); await p.keyboard.press("s"); await p.waitForTimeout(200);
  console.log("S box", (await p.locator("#menu.sbox button").allInnerTexts()).length);
  await p.screenshot({ path: TMP + "/shots/93-sbox.png" });
  await p.click("#menu.sbox >> text=Congé"); await p.waitForTimeout(300);
  console.log("panel left", await G(() => [document.querySelector("main").className, getComputedStyle(document.querySelector("#props")).gridColumnStart, !!document.querySelector("#corner")]));
  await p.screenshot({ path: TMP + "/shots/94-edit.png" });
  // ✕ annule : le congé neuf disparaît
  const n0 = await G(() => window.gabarit.doc.features.length);
  await p.click("#corner .ko"); await idle(); await p.waitForTimeout(300);
  console.log("cancel", n0, "->", await G(() => window.gabarit.doc.features.length), await G(() => document.querySelector("main").className));
  // Entrée répète la dernière commande
  await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  console.log("repeat", await G(() => window.gabarit.doc.features.at(-1).type));
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  console.log("esc cancel", await G(() => [window.gabarit.doc.features.at(-1).type, window.gabarit.st.sel]));
  // esquisse puis ✕
  await p.click(".tbtn[data-tool=sketch]"); await p.click("#dlg >> text=Plan de dessus"); await p.waitForTimeout(300);
  const r = await p.locator("#skSvg").boundingBox();
  await p.mouse.move(r.x + 200, r.y + 200); await p.mouse.down(); await p.mouse.move(r.x + 300, r.y + 280, { steps: 4 }); await p.mouse.up();
  await p.screenshot({ path: TMP + "/shots/95-sketch.png" });
  await p.click("#corner .ko"); await idle();
  console.log("sketch cancel", await G(() => [window.gabarit.st.editSketch, window.gabarit.doc.features.map((f) => f.type).join(",")]));
  console.log("errors", logs.length ? logs : "none");
  await b.close();
})();
