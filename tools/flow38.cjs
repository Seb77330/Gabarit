// v1.5.2 : « Ajuster au meuble » en un clic, « Combien » (plusieurs pièces côte à côte), tiroirs de cuisine Metod,
// onglet « Rangements » (bac à la taille du meuble, grille et bac Gridfinity, idées à importer).
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 180000 }); await p.waitForTimeout(300); };
  const clean = (t) => (t || "").replace(/[  ]/g, " ");
  const size = () => G(() => { const m = window.gabarit.st.mesh.bb; return [0, 1, 2].map((i) => Math.round((m[1][i] - m[0][i]) * 100) / 100).join(" × "); });
  const chips = async () => Object.fromEntries(await p.$$eval("#meublebar .pchk", (l) => l.map((x) => [x.dataset.chk, [x.className.includes("ok") ? "ok" : x.className.includes("warn") ? "warn" : "info", x.textContent.replace(/[  ]/g, " ").slice(1)]])));
  const tab = async (k) => { await p.click(`#meubleTabs [data-tab="${k}"]`); await p.waitForTimeout(150); };
  const copies = () => G(() => { let k = 0; window.gabarit.viewer.furn.traverse((o) => { if (o.isInstancedMesh) k += o.count; }); return k; });
  const toast = async () => clean(await p.textContent("#toast"));
  await p.goto("http://localhost:8765/?mode=simple");
  await p.click("text=Nouvelle pièce"); await p.waitForTimeout(300); await G(() => document.querySelector("#dlg")?.close());
  const box = { id: "b1", type: "shape", kind: "box", name: "Boîte 1", mode: "add", a: "120", b: "80", h: "200", r: "0", x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0" };
  await G((box) => { localStorage.removeItem("gabarit-meuble"); const g = window.gabarit; g.loadDoc({ version: 1, name: "Boîte à ajuster", material: "pla", params: [], features: [box] }); g.st.mesh = null; }, box); await idle();

  // ---- Ajuster au meuble, une pièce ----
  await p.click('.tbtn[data-tool="meuble"]'); await p.waitForTimeout(700);
  ok(await p.isVisible("#meubleAuto") && (await p.inputValue("#meubleN")) === "1", "« Ajuster au meuble » et « Combien ? » sont en haut du panneau, visibles dans tous les onglets");
  await p.click("#meubleAuto"); await idle();
  let c = await chips();
  // case Kallax 335 × 390 × 335, jeu 1 mm : la boîte 120 × 80 × 200 couchée (120 × 200 × 80) grandit de 389 / 200 = 194,5 %
  ok((await size()) === "233.4 × 389 × 155.6" && c.rentre[0] === "ok" && (await toast()).includes("194,5 %") && (await toast()).includes("tournée"), "un clic : la pièce est tournée et mise à 194,5 %, elle occupe la profondeur à 1 mm près : " + (await size()));
  ok(await G(() => window.gabarit.doc.features.map((f) => f.type).join() === "shape,orient,scale"), "l'ajustement passe par les étapes « Sens de pose » et « Taille »");
  await p.click("#meubleAuto"); await idle();
  ok((await size()) === "233.4 × 389 × 155.6", "un deuxième clic ne change plus rien");
  await p.keyboard.press("Control+z"); await idle(); await p.keyboard.press("Control+z"); await idle();
  ok((await size()) === "120 × 80 × 200", "deux Ctrl+Z ramènent la pièce de départ");

  // ---- Combien ? ----
  await p.fill("#meubleN", "3"); await p.waitForTimeout(300);
  c = await chips();
  ok(c.combien[0] === "ok" && c.combien[1].includes("Les 3 tiennent") && c.combien[1].includes("2 de front, sur 2 rangées") && (await copies()) === 2, "3 pièces : rangées de gauche à droite, 2 de front puis la suivante derrière : " + c.combien[1]);
  ok(await G(() => { const v = window.gabarit.viewer; const bx = new v.furnBox.constructor().setFromObject(v.part); return Math.abs(bx.min.x + 167.5) < 0.01 && Math.abs(bx.min.y + 195) < 0.01; }), "la première est tout à gauche, devant");
  await p.locator('label:has(#meubleN) [data-step="plus"]').click(); await p.locator('label:has(#meubleN) [data-step="plus"]').click(); await p.locator('label:has(#meubleN) [data-step="plus"]').click(); await p.waitForTimeout(300);
  ok((await p.inputValue("#meubleN")) === "6" && (await copies()) === 5, "le bouton + en ajoute une à chaque clic");
  await p.fill("#meubleN", "12"); await p.waitForTimeout(300);
  c = await chips();
  ok(c.combien[0] === "warn" && c.combien[1].includes("Les 12 ne tiennent pas") && c.combien[1].includes("il en rentre 8") && await G(() => window.gabarit.viewer.mat.color.getHexString() === "e9968a"), "12 pièces ne tiennent pas : c'est dit, et la pièce passe en rouge : " + c.combien[1]);
  await p.screenshot({ path: TMP + "/shots/v152-combien-trop.png" });
  await p.click("#meubleAuto"); await idle();
  c = await chips();
  // le meilleur rangement des 12 est choisi parmi les 6 sens de pose
  ok(c.combien[0] === "ok" && (await toast()).includes("Les 12 pièces tiennent") && (await toast()).includes("imprimer 12 fois"), "« Ajuster au meuble » règle la taille (et le sens) pour que les 12 tiennent : " + (await size()) + " · " + c.combien[1]);
  await p.screenshot({ path: TMP + "/shots/v152-combien.png" });
  await p.fill("#meubleN", "1"); await p.waitForTimeout(200);
  ok((await copies()) === 0 && !(await chips()).combien, "revenir à 1 enlève les copies");

  // ---- Tiroirs Metod et Gridfinity ----
  await tab("meuble"); await p.selectOption("#meubleType", "cuisine"); await p.waitForTimeout(300);
  ok((await p.$$eval("#meubleSel option", (l) => l.length)) === 13 && (await p.inputValue("#meubleSel")) === "maximera40bas" && (await p.inputValue('#meublebar [data-md="0"]')) === "338", "12 tiroirs de cuisine Metod (Maximera), le premier fait 338 mm de large à l'intérieur");
  await p.selectOption("#meubleSel", "maximera60moyen"); await p.waitForTimeout(300);
  await tab("rangements");
  ok(clean(await p.textContent("#meubleGrid")).includes("12 × 12 cases"), "le tiroir de 60 cm accepte 12 × 12 cases Gridfinity : " + clean(await p.textContent("#meubleGrid")));
  ok((await p.getAttribute("#meubleMW", "href")).startsWith("https://makerworld.com/") && (await p.getAttribute("#meublePR", "href")).includes("printables.com") && (await p.$$eval("#meubleIdea option", (l) => l.length)) >= 12, "12 idées de rangements à chercher sur MakerWorld ou Printables");
  await p.selectOption("#meubleIdea", "2"); 
  ok((await p.getAttribute("#meubleMW", "href")).includes("cutlery"), "le lien suit l'idée choisie");
  await p.screenshot({ path: TMP + "/shots/v152-rangements.png" });
  // un bac à la taille du tiroir
  await p.click("#meubleMkBac"); await idle(); await p.waitForTimeout(700);
  c = await chips();
  ok((await size()) === "537 × 519 × 120" && await p.isVisible("#meublebar") && c.rentre[0] === "ok" && (await G(() => window.gabarit.doc.name)).startsWith("Bac sur mesure"), "« Un bac à la taille du meuble » : nouvel onglet, bac de 537 × 519, le meuble rouvert dessus");
  await G(() => { const g = window.gabarit; const f = g.doc.features[0]; f.nx = "3"; f.ny = "2"; g.loadDoc(g.doc); g.st.mesh = null; }); await idle();
  ok(Object.keys(await G(() => window.gabarit.st.errors || {})).length === 0 && (await size()) === "537 × 519 × 120", "le bac accepte 3 × 2 compartiments");
  // la grille
  await p.click('.tbtn[data-tool="meuble"]'); await p.waitForTimeout(500); await tab("rangements");
  await p.click("#meubleMkPlate"); await idle(); await p.waitForTimeout(700);
  c = await chips();
  ok((await size()) === "252 × 252 × 4.65" && (await p.inputValue("#meubleN")) === "4" && c.combien[0] === "ok" && (await copies()) === 3, "« La grille Gridfinity » : plaque de 6 × 6 cases, et les 4 plaques qui couvrent le tiroir sont montrées");
  await p.screenshot({ path: TMP + "/shots/v152-grille.png" });
  await p.click("#meubleAuto"); await p.waitForTimeout(300);
  ok((await toast()).includes("taille standard") && (await size()) === "252 × 252 × 4.65", "« Ajuster » ne déforme pas une pièce Gridfinity");
  // un bac Gridfinity
  await tab("rangements"); await p.click("#meubleMkBin"); await idle(); await p.waitForTimeout(700);
  ok((await size()) === "83.5 × 83.5 × 42", "« Un bac Gridfinity » : 2 × 2 cases, 6 unités de haut (83,5 × 83,5 × 42)");
  await p.fill("#meubleN", "9"); await p.waitForTimeout(300);
  c = await chips();
  ok(c.combien[0] === "ok" && c.combien[1].includes("6 de front, sur 2 rangées"), "9 bacs Gridfinity dans le tiroir : " + c.combien[1]);
  await p.screenshot({ path: TMP + "/shots/v152-bacs.png" });
  await p.click("#meubleClose"); await p.waitForTimeout(300);
  // les trois formes sont aussi dans « Formes prêtes »
  ok(await G(() => { document.querySelector(".tbtn[data-tool=shapes]").click(); const l = [...document.querySelectorAll("#shapes [data-shape]")].map((e) => e.dataset.shape); document.querySelector(".tbtn[data-tool=shapes]").click(); return ["bac", "gridbin", "gridplate"].every((k) => l.includes(k)); }), "bac, bac Gridfinity et grille Gridfinity sont dans « Formes prêtes »");
  ok(!logs.length, "aucune erreur dans la console" + (logs.length ? " : " + logs.slice(0, 3).join(" / ") : ""));
  await b.close();
  console.log(fails ? `FLOW38 : ${fails} ÉCHEC(S)` : "FLOW38 OK"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
