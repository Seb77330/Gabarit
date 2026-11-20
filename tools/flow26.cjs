// v1.2 : double-clic sur une face = l'étape qui l'a faite s'ouvre, avec ses cotes près de la souris.
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(300); };
  const load = async (features) => { await G((features) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Essai", material: "pla", params: [], features }); g.st.mesh = null; }, features); await idle(); };
  const scr = (w) => G((w) => { const v = window.gabarit.viewer; const r = v.renderer.domElement.getBoundingClientRect(); const q = new v.camera.position.constructor(...w).project(v.camera); return [r.left + (q.x + 1) / 2 * r.width, r.top + (1 - q.y) / 2 * r.height]; }, w);
  const dbl = async (w) => { const [x, y] = await scr(w); await p.mouse.move(x, y); await p.waitForTimeout(80); await p.mouse.dblclick(x, y); };
  const card = async () => { await p.waitForSelector("#dimCard", { timeout: 20000 }); return (await p.locator("#dimCard").innerText()).replace(/[  ]/g, " "); };
  const sel = () => G(() => { const g = window.gabarit; return g.doc.features.find((f) => f.id === g.st.sel)?.name || null; });
  const vol = () => G(() => window.gabarit.st.mesh.volume);
  const near = (a, e, t = 0.5) => Math.abs(a - e) <= t;
  await p.goto("http://localhost:8765/?mode=expert");
  await p.click("#welcome >> text=Nouvelle pièce"); await p.waitForTimeout(400); await G(() => document.querySelector("#dlg")?.close());

  // plaque 60 × 40 × 10 (esquisse + extrusion), bossage rond de 8 mm de haut, trou percé, congé sur une arête
  const top = { kind: "std", name: "dessus", offset: "0" };
  const feats = [
    { id: "s1", type: "sketch", name: "Esquisse 1", plane: top, entities: [{ id: "e1", type: "rect", cx: "0", cy: "0", w: "60", h: "40", r: "0", a: "0" }] },
    { id: "x1", type: "extrude", name: "Extrusion 1", sketch: "s1", mode: "add", dist: "10", dir: "normal", through: false },
    { id: "c1", type: "shape", kind: "cyl", name: "Cylindre 1", mode: "add", d: "16", h: "8", x: "-15", y: "0", z: "10", rx: "0", ry: "0", rz: "0" },
    { id: "h1", type: "shape", kind: "cyl", name: "Trou 1", mode: "cut", d: "6", h: "30", x: "18", y: "0", z: "-5", rx: "0", ry: "0", rz: "0" },
  ];
  await load(feats);
  await G(() => window.gabarit.viewer.fit([1, -1.3, 0.9])); await p.waitForTimeout(500);
  const v0 = await vol();

  // face de côté de la plaque -> l'extrusion
  await dbl([30, 5, 5]);
  let t = await card();
  ok(await sel() === "Extrusion 1", "double-clic sur le côté de la plaque : « Extrusion 1 » s’ouvre");
  ok(/Extrusion 1/.test(t) && /Distance/.test(t) && /Largeur \(rectangle\)/.test(t) && /Hauteur \(rectangle\)/.test(t), "la carte montre l’épaisseur et les cotes du rectangle");
  ok(await G(() => document.activeElement?.dataset?.mk === "dist"), "la première cote est prête à être tapée");
  await p.screenshot({ path: "/tmp/claude-0/shots/v12-cotes.png" });
  await p.keyboard.type("14"); await idle();
  ok((await p.locator('#props [data-hk="dist"]').inputValue()) === "14", "le panneau de gauche suit la carte");
  let v = await vol(); ok(v > v0 + 60 * 40 * 3.5, "la pièce s’épaissit en direct : " + v.toFixed(0) + " mm³");
  // cote du dessin, changée depuis la carte
  const w = p.locator('#dimCard .field:has(label:text-matches("Largeur"))').locator("input");
  await w.fill("80"); await idle();
  let B = await G(() => window.gabarit.st.mesh.bb);
  ok(near(B[1][0] - B[0][0], 80, 0.01) && near(B[1][2], 18, 0.01), "largeur du rectangle passée à 80 mm depuis la carte : " + (B[1][0] - B[0][0]).toFixed(2));
  await w.press("Enter"); await idle();
  ok(!(await p.locator("#dimCard").count()) && await sel() === null, "Entrée valide et ferme la carte");
  let F = await G(() => window.gabarit.doc.features);
  ok(F[1].dist === "14" && F[0].entities[0].w === "80", "valeurs gardées : épaisseur 14, largeur 80");

  // dessus du bossage -> le cylindre ; face du trou -> le trou ; dessus de la plaque -> l'extrusion
  await dbl([-15, 0, 18]); t = await card();
  ok(await sel() === "Cylindre 1" && /Diamètre/.test(t), "double-clic sur le bossage : « Cylindre 1 » et son diamètre");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  ok(!(await p.locator("#dimCard").count()) && await sel() === null, "Échap ferme la carte sans rien changer");
  await G(() => window.gabarit.viewer.fit([0.3, -0.5, 1])); await p.waitForTimeout(500);
  await dbl([18 + 3 * Math.cos(1.2), 3 * Math.sin(1.2), 6]); t = await card();
  ok(await sel() === "Trou 1", "double-clic dans le trou : « Trou 1 » (" + (await sel()) + ")");
  await p.locator("#dimCard .x").click(); await p.waitForTimeout(200);
  await dbl([30, -15, 14]); t = await card();
  ok(await sel() === "Extrusion 1", "double-clic sur le dessus de la plaque : « Extrusion 1 »");
  // la flèche d'épaisseur et la carte restent d'accord
  const hk = await G(() => { const v = window.gabarit.viewer; const g = v.handles.find((x) => x.userData.hd.id === "dist"); if (!g) return null; const r = v.renderer.domElement.getBoundingClientRect(); const s = (w) => { const q = w.clone().project(v.camera); return [r.left + (q.x + 1) / 2 * r.width, r.top + (1 - q.y) / 2 * r.height]; }; const o = g.getWorldPosition(g.position.clone()); const a = s(o.clone().addScaledVector(g.userData.dir, g.scale.x * 0.6)), e = s(o.clone().addScaledVector(g.userData.dir, g.scale.x * 1.6)); const L = Math.hypot(e[0] - a[0], e[1] - a[1]); return { a, d: [(e[0] - a[0]) / L, (e[1] - a[1]) / L], px: L / g.scale.x }; });
  if (hk) {
    await p.mouse.move(hk.a[0], hk.a[1]); await p.waitForTimeout(120); await p.mouse.down();
    for (let i = 1; i <= 6; i++) { await p.mouse.move(hk.a[0] + hk.d[0] * hk.px * 6 * i / 6, hk.a[1] + hk.d[1] * hk.px * 6 * i / 6); await p.waitForTimeout(40); }
    await p.mouse.up(); await idle();
    const dv = await G(() => window.gabarit.doc.features[1].dist);
    ok(Number(dv) > 14 && (await p.locator('#dimCard [data-mk="dist"]').inputValue()) === dv, "flèche tirée : la carte affiche la nouvelle épaisseur (" + dv + " mm)");
  } else ok(false, "flèche d’épaisseur absente");
  await p.locator("#dimCard >> text=C’est bon").click(); await p.waitForTimeout(300);
  // bouton « Modifier l'esquisse »
  await dbl([30, -15, await G(() => Number(window.gabarit.doc.features[1].dist))]); await card();
  await p.locator("#dimCard >> text=Modifier l’esquisse").click(); await p.waitForTimeout(600);
  ok(await G(() => window.gabarit.st.editSketch === "s1"), "« Modifier l’esquisse » ouvre le dessin d’origine");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200); await p.keyboard.press("Escape"); await p.waitForTimeout(400);
  console.log("erreurs", JSON.stringify(logs));
  ok(logs.length === 0, "aucune erreur dans la console");
  console.log(fails ? "FLOW26 ÉCHEC (" + fails + ")" : "FLOW26 OK");
  await b.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
