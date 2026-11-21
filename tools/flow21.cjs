// v1.1 : couper à plat, et allonger seulement une zone d'un fichier importé.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(250); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(250); };
  const load = async (features) => { await G((features) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Essai", material: "pla", params: [], features }); g.st.mesh = null; }, features); await idle(); };
  const vol = () => G(() => window.gabarit.st.mesh.volume);
  const bb = () => G(() => window.gabarit.st.mesh.bb);
  const errs = () => G(() => window.gabarit.st.errors);
  const world = (pt) => G((pt) => { const g = window.gabarit; const v = g.viewer.camera.position.clone().set(...pt).project(g.viewer.camera); const r = g.viewer.renderer.domElement.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, pt);
  await p.goto("http://localhost:8765/?mode=expert");
  await p.click("text=Nouvelle pièce"); await p.waitForTimeout(300); await G(() => document.querySelector("#dlg")?.close());

  // ---- Coupe à plat ----
  const box = { id: "b1", type: "shape", kind: "box", name: "Boîte 1", mode: "add", a: "60", b: "30", h: "20", r: "0", x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0" };
  await load([box, { id: "c1", type: "slice", name: "Coupe à plat 1", axis: "z", at: "12", keep: "below" }]);
  ok(Math.abs(await vol() - 60 * 30 * 12) < 1 && !Object.keys(await errs()).length, "coupe à 12 mm de haut, je garde le bas : 60 × 30 × 12");
  await load([box, { id: "c1", type: "slice", name: "Coupe à plat 1", axis: "z", at: "12", keep: "above" }]);
  let B = await bb();
  ok(Math.abs(await vol() - 60 * 30 * 8) < 1 && Math.abs(B[0][2] - 12) < 1e-6, "je garde le haut : 60 × 30 × 8, à partir de z = 12");
  await load([box, { id: "c1", type: "slice", name: "Coupe à plat 1", axis: "x", at: "10", keep: "below" }]);
  ok(Math.abs(await vol() - 40 * 30 * 20) < 1, "coupe en travers à x = 10 : il reste 40 mm de long");
  await load([box, { id: "c1", type: "slice", name: "Coupe à plat 1", axis: "z", at: "50", keep: "above" }]);
  ok(/toute la pièce/.test((await errs()).c1 || ""), "coupe qui enlèverait tout : message clair (" + (await errs()).c1 + ")");
  // par l'interface : outil, clic sur la pièce, Entrée
  await load([box]);
  await p.click(".tbtn[data-tool=slice]"); await p.waitForTimeout(600); await idle();
  ok(await G(() => { const g = window.gabarit; const f = g.doc.features[1]; return f?.type === "slice" && f.axis === "z" && f.at === "10" && g.st.pick?.kind === "slice"; }), "outil « Coupe à plat » : coupe proposée à mi-hauteur, en attente d’un clic");
  let pt = await world([0, -15, 15]); // face avant de la boîte, à 15 mm de haut
  await p.mouse.click(pt[0], pt[1]); await p.waitForTimeout(600);
  const at = await G(() => Number(window.gabarit.doc.features[1].at));
  ok(Math.abs(at - 15) < 0.6, "clic sur la pièce : la coupe se met à cette hauteur (" + at + " mm)");
  await p.fill("#props input >> nth=1", "5"); await p.keyboard.press("Enter"); await idle();
  ok(Math.abs(await vol() - 60 * 30 * 5) < 1 && await G(() => !window.gabarit.st.pick && !window.gabarit.st.sel), "5 mm tapés puis Entrée : étape validée, il reste 60 × 30 × 5");
  await p.screenshot({ path: TMP + "/shots/v11-coupe.png" });

  // ---- Allonger une zone d'un fichier importé ----
  // la pièce d'essai : une barre 80 × 20 × 10 avec un trou de 8 mm à chaque bout, exportée en STL puis rouverte
  const bar = { ...box, a: "80", b: "20", h: "10" };
  const hole = (id, x) => ({ id, type: "shape", kind: "cyl", name: id, mode: "cut", d: "8", h: "30", x: String(x), y: "0", z: "-5", rx: "0", ry: "0", rz: "0" });
  await load([bar, hole("h1", -30), hole("h2", 30)]);
  const v0 = await vol();
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-act=stl]")]);
  const stl = TMP + "/shots/barre.stl"; await dl.saveAs(stl);
  ok(fs.statSync(stl).size > 1000, "barre percée exportée en STL");
  await G(() => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Essai", material: "pla", params: [], features: [] }); }); await p.waitForTimeout(600);
  await p.setInputFiles("#fileIn", stl);
  await p.waitForFunction(() => window.gabarit.doc.features.some((f) => f.type === "import"), null, { timeout: 30000 });
  await G(() => { window.gabarit.st.mesh = null; }); await idle();
  const v1 = await vol(); B = await bb();
  ok(Math.abs(v1 - v0) < v0 * 0.01 && Math.abs(B[1][0] - B[0][0] - 80) < 0.01, "STL rouvert : même volume, 80 mm de long");
  const imp = () => G(() => window.gabarit.doc.features.find((f) => f.type === "import"));
  const setImp = async (patch, bad) => {
    await G((patch) => { const g = window.gabarit; const d = JSON.parse(JSON.stringify(g.doc)); Object.assign(d.features.find((f) => f.type === "import"), patch); g.loadDoc(d); g.st.mesh = null; g.st.errors = {}; }, patch);
    if (bad) { await p.waitForFunction(() => Object.keys(window.gabarit.st.errors).length && !window.gabarit.st.building, null, { timeout: 60000 }); await p.waitForTimeout(200); } else await idle();
  };
  // zone de 30 à 50 mm (entre les deux trous), allongée de 25 mm
  await setImp({ zone: { axis: "x", a: "30", b: "50", add: "25" } });
  let v2 = await vol(); B = await bb();
  ok(!Object.keys(await errs()).length && Math.abs(B[1][0] - B[0][0] - 105) < 0.01, "zone allongée de 25 mm : la barre fait 105 mm");
  ok(Math.abs(v2 - (v1 + 25 * 20 * 10)) < v1 * 0.004, "seul le milieu a grandi : volume + 25 × 20 × 10, les deux trous gardent leur diamètre (" + Math.round(v2 - v1) + " mm³ en plus)");
  ok(Math.abs(B[1][1] - B[0][1] - 20) < 0.01 && Math.abs(B[1][2] - B[0][2] - 10) < 0.01, "largeur et hauteur inchangées");
  // raccourcir
  await setImp({ zone: { axis: "x", a: "30", b: "50", add: "-10" } });
  v2 = await vol(); B = await bb();
  ok(Math.abs(B[1][0] - B[0][0] - 70) < 0.01 && Math.abs(v2 - (v1 - 10 * 20 * 10)) < v1 * 0.004, "zone raccourcie de 10 mm : 70 mm de long, trous intacts");
  // pièce tournée d'un quart de tour : la zone suit ce qu'on voit (ici, elle s'allonge le long de Y)
  await setImp({ rz: "90", zone: null }); const Br = await bb();
  await setImp({ rz: "90", zone: { axis: "y", a: "30", b: "50", add: "25" } });
  v2 = await vol(); B = await bb();
  ok(Math.abs((Br[1][1] - Br[0][1]) - 80) < 0.01 && Math.abs(B[1][1] - B[0][1] - 105) < 0.01 && Math.abs(B[1][0] - B[0][0] - 20) < 0.01 && Math.abs(v2 - (v1 + 5000)) < v1 * 0.004, "pièce tournée de 90° : la zone s’allonge dans le sens affiché (20 × 105)");
  ok(Math.abs(B[0][0] - Br[0][0]) < 0.01 && Math.abs(B[0][1] - Br[0][1]) < 0.01 && Math.abs(B[0][2] - Br[0][2]) < 0.01, "la pièce tournée reste à la même place");
  // erreurs expliquées
  await setImp({ rz: "0", zone: { axis: "x", a: "50", b: "30", add: "5" } }, true);
  ok(/fin doit être plus loin/.test(Object.values(await errs())[0] || ""), "zone à l’envers : message clair");
  await setImp({ zone: { axis: "x", a: "30", b: "50", add: "-20" } }, true);
  ok(/raccourcir plus/.test(Object.values(await errs())[0] || ""), "raccourcir plus que la zone : message clair");
  // par l'interface : bouton, deux clics sur la pièce, valeur tapée
  await setImp({ zone: null });
  await p.click("#tree >> text=barre"); await p.waitForTimeout(400);
  // depuis la v1.4, le fichier importé renvoie vers l'outil « Allonger une partie » ; l'ancienne zone d'un fichier déjà enregistré reste réglable
  ok(await p.isVisible("#props [data-zone=tool]"), "fichier importé : bouton « Allonger une partie » vers le nouvel outil");
  await setImp({ zone: { axis: "x", a: "32", b: "48", add: "0" } });
  await p.click("#tree >> text=barre"); await p.waitForTimeout(400);
  let z = (await imp()).zone;
  await p.click("#props >> text=Choisir sur la pièce"); await p.waitForTimeout(200);
  pt = await world([-15, -10, 5]); await p.mouse.click(pt[0], pt[1] - 1); await p.waitForTimeout(300);
  pt = await world([12, -10, 5]); await p.mouse.click(pt[0], pt[1] - 1); await p.waitForTimeout(500);
  z = (await imp()).zone;
  ok(Math.abs(z.a - 25) < 1 && Math.abs(z.b - 52) < 1, "deux clics sur la pièce : zone de " + z.a + " à " + z.b + " mm (attendu 25 à 52)");
  await p.fill("#props .field:has(label:text(\"Allonger de\")) input", "20"); await p.waitForTimeout(200); await idle();
  B = await bb();
  ok(Math.abs(B[1][0] - B[0][0] - 100) < 0.01, "« Allonger de » 20 mm : la barre fait 100 mm");
  ok(await G(() => window.gabarit.viewer.planeGroup?.children.length === 4), "les deux plans de la zone sont affichés sur la pièce");
  await G(() => window.gabarit.viewer.fit([1, -1.3, 0.9])); await p.waitForTimeout(500);
  await p.screenshot({ path: TMP + "/shots/v11-zone.png" });
  // deuxième choix sur la pièce déjà allongée : les clics sont ramenés aux cotes d'origine
  await p.click("#props >> text=Choisir sur la pièce"); await p.waitForTimeout(200);
  pt = await world([-20, -10, 5]); await p.mouse.click(pt[0], pt[1] - 1); await p.waitForTimeout(300);
  pt = await world([40, -10, 5]); await p.mouse.click(pt[0], pt[1] - 1); await p.waitForTimeout(500); await idle();
  z = (await imp()).zone;
  ok(Math.abs(z.a - 20) < 1 && Math.abs(z.b - 60) < 1.2, "nouveau choix sur la pièce allongée : zone de " + z.a + " à " + z.b + " mm (attendu 20 à 60)");
  await p.click("#props [data-zone=remove]"); await idle();
  B = await bb(); ok(!(await imp()).zone && Math.abs(B[1][0] - B[0][0] - 80) < 0.01, "« Retirer la zone » : la barre revient à 80 mm");
  console.log("erreurs", logs);
  ok(!logs.length, "aucune erreur dans la console");
  console.log(fails ? "FLOW21 ÉCHEC" : "FLOW21 OK");
  await b.close(); process.exit(fails ? 1 : 0);
})();
