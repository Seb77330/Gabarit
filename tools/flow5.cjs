const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  await p.goto("http://localhost:8765/?mode=expert");
  await p.click("text=Nouvelle pièce"); await p.click("text=Plan de dessus");
  const box = await p.locator("#skSvg").boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const G = (fn) => p.evaluate(fn);
  await p.click("#skTools >> text=Contour libre");
  // quadrilatère irrégulier : 1er côté horizontal
  for (const [x, y] of [[-120, 60], [120, 60], [140, -50], [-110, -70]]) await p.mouse.click(cx + x, cy + y);
  await p.keyboard.press("Enter");
  console.log("auto", JSON.stringify(await G(() => window.gabarit.doc.features[0].constraints)));
  await p.click("#skTools >> text=Choisir");
  const sk = () => G(() => window.gabarit.doc.features[0]);
  const clickW = async (u, v, shift) => { const s = await p.evaluate(([u, v]) => window.gabarit.sketcher.toS([u, v]), [u, v]); const r = box; if (shift) await p.keyboard.down("Shift"); await p.mouse.click(r.x + s[0], r.y + s[1]); if (shift) await p.keyboard.up("Shift"); };
  let e = (await sk()).entities[0]; const P = e.pts;
  const mid = (i) => { const a = P[i], b = P[(i + 1) % P.length]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  // côté 2 vertical
  await clickW(...mid(1)); await p.click("#props >> text=Vertical");
  // côtés 1 et 3 parallèles
  await clickW(...mid(0)); await clickW(...mid(2), true); await p.click("#props >> text=Parallèles");
  // cote de longueur côté 1
  await clickW(...mid(0)); await p.click("#props >> text=Cote de longueur");
  await clickW(...mid(1)); await p.click("#props >> text=Cote de longueur");
  // point 1 sur l'origine
  await clickW(P[0][0], P[0][1]); await p.click("#props >> text=Sur l’origine");
  console.log("state", JSON.stringify(await G(() => window.gabarit.sketcher.solveState)));
  // changer la valeur de la cote du côté 1 à 60
  const inputs = p.locator(".clist .citem input"); await inputs.nth(0).fill("60"); await inputs.nth(0).press("Tab");
  await p.waitForTimeout(300);
  console.log("pts", JSON.stringify((await sk()).entities[0].pts), JSON.stringify(await G(() => window.gabarit.sketcher.solveState)));
  await p.screenshot({ path: "/tmp/claude-0/shots/30-constraints.png" });
  // glisser un sommet : la contrainte doit tenir
  e = (await sk()).entities[0];
  const s3 = await p.evaluate(([u, v]) => window.gabarit.sketcher.toS([u, v]), e.pts[3]);
  await p.mouse.move(box.x + s3[0], box.y + s3[1]); await p.mouse.down(); await p.mouse.move(box.x + s3[0] - 30, box.y + s3[1] - 20, { steps: 5 }); await p.mouse.up();
  console.log("after drag", JSON.stringify((await sk()).entities[0].pts), JSON.stringify(await G(() => window.gabarit.sketcher.solveState)));
  await p.click("#skTools button[title=Entrée]"); await p.click(".tbtn[data-tool=extrude]");
  await p.waitForFunction(() => window.gabarit.st.mesh, null, { timeout: 30000 }); await p.waitForTimeout(500);
  console.log("bb", JSON.stringify(await G(() => [window.gabarit.st.errors, window.gabarit.st.info, window.gabarit.st.mesh.bb])));
  console.log(logs.join("\n") || "no errors"); await b.close();
})();
