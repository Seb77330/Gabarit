// Mode Simple, formes prêtes (les 12), pose sur une face, creuser, thème sombre.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
const assert = (c, m) => { if (!c) { console.error("ÉCHEC :", m); process.exitCode = 1; } else console.log("ok :", m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 } });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await p.goto("http://localhost:8765/");
  await p.waitForFunction(() => window.gabarit, null, { timeout: 60000 });
  const built = () => p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 });
  const G = (fn, a) => p.evaluate(fn, a);
  // première visite : mode Simple proposé, barre d'outils courte
  assert(await G(() => document.body.classList.contains("simple")), "première visite en mode Simple");
  assert(await p.locator("#welcome .mode.on[data-mode=simple]").count() === 1, "accueil : carte Simple choisie");
  await p.click("text=Nouvelle pièce"); await p.waitForTimeout(400);
  assert(await p.locator("#dlg[open]").count() === 0, "mode Simple : pas de question de plan au départ");
  const tools = await p.locator("#tools .tbtn").allInnerTexts();
  assert(tools.length === 15 && tools[0].includes("Formes") && tools.some((t) => t.includes("Creuser")), "barre Simple : 15 outils en mots simples");
  assert(await p.locator("#coach button[data-coach]").count() === 3, "coup de pouce : 3 pistes pour commencer");
  // chaque forme prête se construit
  const kinds = await G(() => { document.querySelector(".tbtn[data-tool=shapes]").click(); return [...document.querySelectorAll("#shapes [data-shape]")].map((e) => e.dataset.shape); });
  assert(kinds.length === 12, "12 formes prêtes proposées");
  await p.keyboard.press("Escape"); await p.mouse.click(900, 500);
  const vols = {};
  for (const k of kinds) {
    await G((k) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "t", material: "pla", params: [], features: [{ id: "s1", type: "shape", kind: k, name: k, mode: "add" }] }); g.st.mesh = null; g.st.errors = {}; }, k);
    await p.waitForFunction(() => !window.gabarit.st.building && (window.gabarit.st.mesh || Object.keys(window.gabarit.st.errors).length), null, { timeout: 120000 });
    await p.waitForTimeout(250);
    const r = await G(() => ({ v: window.gabarit.st.mesh?.volume, e: window.gabarit.st.errors, bb: window.gabarit.st.mesh?.bb }));
    vols[k] = r.v ? Math.round(r.v) : JSON.stringify(r.e);
    if (!r.v) { assert(false, "forme " + k + " : " + JSON.stringify(r.e)); continue; }
    if (Math.abs(r.bb[0][2]) > 0.01) assert(false, "forme " + k + " pas posée sur sa base (z min = " + r.bb[0][2] + ")");
  }
  console.log("volumes", JSON.stringify(vols));
  assert(Math.abs(vols.box - 24000) < 2 && Math.abs(vols.cyl - 21206) < 30 && Math.abs(vols.sphere - 14137) < 40 && Math.abs(vols.cone - 7069) < 30, "volumes exacts : boîte, cylindre, sphère, cône");
  assert(kinds.every((k) => typeof vols[k] === "number" && vols[k] > 0), "les 12 formes donnent un volume");
  // parcours : boîte, puis cylindre posé sur le dessus, puis trou creusé sur le côté
  await G(() => window.gabarit.loadDoc({ version: 1, name: "Essai", material: "pla", params: [], features: [] })); await p.waitForTimeout(300);
  await p.click(".tbtn[data-tool=shapes]"); await p.waitForTimeout(300);
  await p.click("#shapes [data-shape=box]"); await built(); await p.waitForTimeout(500);
  assert(await G(() => window.gabarit.doc.features[0].name) === "Boîte 1", "boîte ajoutée et nommée");
  await p.fill("#props input >> nth=1", "60"); await p.waitForTimeout(300); // longueur
  await p.keyboard.press("Enter"); await built(); await p.waitForTimeout(400);
  assert(Math.abs(await G(() => window.gabarit.st.mesh.volume) - 36000) < 2, "longueur de la boîte changée : 60 × 30 × 20");
  await p.click(".tbtn[data-tool=shapes]"); await p.click("#shapes [data-shape=cyl]"); await p.waitForTimeout(1500);
  assert(await G(() => window.gabarit.st.pick?.kind) === "place", "cylindre : attente du clic pour le poser");
  const f2 = await G(() => { const f = window.gabarit.doc.features[1]; return [f.x, f.y, f.z, f.ry]; });
  assert(f2[2] === "20" && f2[3] === "0", "cylindre posé au départ sur le dessus de la boîte");
  // clic sur le dessus de la boîte, à un autre endroit
  const pt = await G(() => { const g = window.gabarit; const v = new g.viewer.camera.constructor(); void v; const P = g.viewer.camera; const q = { x: 15, y: 5, z: 20 };
    const vec = P.position.clone().set(q.x, q.y, q.z).project(P); const r = g.viewer.renderer.domElement.getBoundingClientRect();
    return [r.left + (vec.x + 1) / 2 * r.width, r.top + (1 - vec.y) / 2 * r.height]; });
  await p.mouse.click(pt[0], pt[1]); await p.waitForTimeout(900);
  const f3 = await G(() => { const f = window.gabarit.doc.features[1]; return [+f.x, +f.y, +f.z, +f.ry, +f.rz]; });
  assert(Math.abs(f3[0] - 15) < 0.6 && Math.abs(f3[1] - 5) < 0.6 && Math.abs(f3[2] - 20) < 0.05 && f3[3] === 0, "clic sur la pièce : le cylindre se pose à cet endroit (" + f3.join(" ; ") + ")");
  await p.keyboard.press("Enter"); await built(); await p.waitForTimeout(500);
  assert(Math.abs(await G(() => window.gabarit.st.mesh.volume) - (36000 + 21206)) < 40, "boîte + cylindre fusionnés");
  // trou : cylindre en mode Creuser posé sur la face avant (Y = -15)
  await p.click(".tbtn[data-tool=shapes]"); await p.click("#shapes [data-shape=cyl]"); await p.waitForTimeout(1500);
  await p.click("#props [data-mode=cut]"); await p.waitForTimeout(700);
  const pt2 = await G(() => { const g = window.gabarit; const P = g.viewer.camera; const vec = P.position.clone().set(-20, -15, 10).project(P); const r = g.viewer.renderer.domElement.getBoundingClientRect(); return [r.left + (vec.x + 1) / 2 * r.width, r.top + (1 - vec.y) / 2 * r.height]; });
  await p.mouse.click(pt2[0], pt2[1]); await p.waitForTimeout(900);
  const f4 = await G(() => { const f = window.gabarit.doc.features[2]; return [+f.x, +f.y, +f.z, +f.ry, +f.rz, f.mode]; });
  assert(Math.abs(f4[1] + 15) < 0.05 && f4[3] === 90 && f4[4] === 90 && f4[5] === "cut", "creuser : le cylindre entre dans la face avant (" + f4.join(" ; ") + ")");
  await p.fill("#props input >> nth=1", "8"); await p.waitForTimeout(200); // diamètre
  await p.keyboard.press("Enter"); await built(); await p.waitForTimeout(600);
  const v3 = await G(() => [window.gabarit.st.mesh.volume, window.gabarit.st.errors]);
  assert(Math.abs(v3[0] - (36000 + 21206 - Math.PI * 16 * 30)) < 60 && !Object.keys(v3[1]).length, "trou de 8 mm creusé à travers la boîte (volume " + Math.round(v3[0]) + ")");
  assert(await p.locator("#coach button[data-coach]").count() === 4, "coup de pouce : 4 pistes pour la suite");
  // passage en Expert puis retour, thème sombre gardé au rechargement
  await p.click("#modeSw [data-mode=expert]"); await p.waitForTimeout(300);
  assert((await p.locator("#tools .tbtn").count()) === 24 && !(await G(() => document.body.classList.contains("simple"))), "mode Expert : 24 outils");
  assert(await G(() => window.gabarit.doc.features.length) === 3, "changer de mode ne touche pas à la pièce");
  await p.click("[data-act=theme]"); await p.waitForTimeout(300);
  assert(await G(() => document.documentElement.dataset.theme) === "dark", "thème sombre activé");
  await p.reload(); await p.waitForFunction(() => window.gabarit, null, { timeout: 60000 });
  assert(await G(() => document.documentElement.dataset.theme === "dark" && !document.body.classList.contains("simple")), "thème et mode gardés après rechargement");
  await p.screenshot({ path: TMP + "/shots/flow20.png" });
  console.log("erreurs", errs);
  assert(!errs.length, "aucune erreur dans la console");
  await b.close();
  console.log(process.exitCode ? "FLOW20 ÉCHEC" : "FLOW20 OK");
})();
