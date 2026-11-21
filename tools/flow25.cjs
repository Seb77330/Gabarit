// v1.2 : importer un dessin SVG ou DXF, qui devient une esquisse puis un volume.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(300); };
  const vol = () => G(() => window.gabarit.st.mesh.volume);
  const size = async () => { const B = await G(() => window.gabarit.st.mesh.bb); return [0, 1, 2].map((k) => B[1][k] - B[0][k]); };
  const txt = async (sel) => (await p.locator(sel).innerText()).replace(/[  ]/g, " ");
  const near = (a, e, rel = 0.005) => Math.abs(a - e) <= Math.abs(e) * rel;
  const SVG = "tools/fixtures/logo.svg", DXF = "tools/fixtures/plaque.dxf";
  await p.goto("http://localhost:8765/?mode=simple");
  await p.click("#welcome >> text=Nouvelle pièce"); await p.waitForTimeout(400);

  // ---- SVG dans une pièce vide ----
  await p.setInputFiles("#fileIn", SVG);
  await p.waitForSelector("#dlg[open] #drawW", { timeout: 15000 });
  let t = await txt("#dlg");
  ok(/Importer un dessin/.test(t) && /4 contours fermés, 1 trait ouvert/.test(t), "fenêtre d’import : 4 contours fermés et 1 trait ouvert reconnus");
  ok(/textes, images et blocs/.test(t), "le texte du fichier est signalé comme non repris");
  ok((await p.inputValue("#drawW")) === "80" && /Hauteur : 40 mm/.test(await txt("#drawH")), "taille lue dans le fichier : 80 mm de large, 40 mm de haut");
  ok((await p.locator("#drawWhere").count()) === 0, "pièce vide : pas de question « où le mettre »");
  await p.screenshot({ path: TMP + "/shots/v12-import-dessin.png" });
  await p.click("#drawOk"); await idle();
  let F = await G(() => window.gabarit.doc.features);
  const kinds = (F[0]?.entities || []).map((e) => e.type).sort().join();
  ok(F.length === 2 && F[0].type === "sketch" && F[1].type === "extrude" && F[1].sketch === F[0].id && F[1].dist === "3", "une esquisse et un volume de 3 mm sont créés");
  ok(kinds === "circle,circle,path,poly,poly", "l’esquisse reprend 2 cercles, 2 contours et 1 trait : " + kinds);
  ok(/^Dessin importé 1$/.test(F[0].name.replace(/[  ]/g, " ")), "étape nommée en mots simples : " + F[0].name);
  ok(await G(() => window.gabarit.doc.name) === "logo", "la pièce prend le nom du fichier");
  let v = await vol(), S = await size();
  ok(near(v, 8509.78), "volume : plaque arrondie moins les 3 trous, sur 3 mm (" + v.toFixed(1) + " mm³, attendu 8509,8)");
  ok(near(S[0], 80, 0.001) && near(S[1], 40, 0.001) && near(S[2], 3, 0.001), "taille : " + S.map((x) => x.toFixed(2)).join(" × "));
  const c0 = F[0].entities.find((e) => e.type === "circle" && e.d === "12");
  ok(c0 && Number(c0.cx) === -24 && Number(c0.cy) === 0, "le cercle de 12 mm est à sa place, dessin centré sur l’origine : " + JSON.stringify(c0));
  ok(await G(() => window.gabarit.viewer.handles.some((g) => g.userData.hd.id === "dist")), "la flèche d’épaisseur est prête à tirer");
  await p.screenshot({ path: TMP + "/shots/v12-logo-volume.png" });
  await p.keyboard.press("Enter"); await idle();

  // ---- DXF dans une nouvelle pièce, à une autre taille ----
  await p.setInputFiles("#fileIn", DXF);
  await p.waitForSelector("#dlg[open] #drawW", { timeout: 15000 });
  t = await txt("#dlg");
  ok(/3 contours fermés/.test(t) && !/trait/.test(t.split("Largeur")[0].replace("traits, images", "")), "DXF : les 4 traits séparés forment un seul contour (3 contours fermés)");
  ok((await p.inputValue("#drawW")) === "60", "largeur d’origine : 60 mm");
  ok((await p.locator("#drawWhere button").count()) === 2, "pièce déjà commencée : on choisit où mettre le dessin");
  await p.fill("#drawW", "120");
  ok(/Hauteur : 60 mm/.test(await txt("#drawH")), "largeur 120 mm : la hauteur suit (60 mm)");
  await p.fill("#drawW", "0"); ok(await p.locator("#drawOk").isDisabled(), "taille nulle refusée");
  await p.fill("#drawW", "120");
  await p.click("#drawWhere >> text=Dans une nouvelle pièce");
  await p.click("#drawOk"); await idle();
  F = await G(() => window.gabarit.doc.features);
  ok(await G(() => window.gabarit.doc.name) === "plaque" && F.length === 2, "nouvelle pièce « plaque » dans un autre onglet");
  v = await vol(); S = await size();
  ok(near(v, 18515.04), "volume à 120 mm de large : " + v.toFixed(1) + " mm³ (attendu 18515,0)");
  ok(near(S[0], 120, 0.001) && near(S[1], 60, 0.001), "taille : " + S.map((x) => x.toFixed(2)).join(" × "));
  const slot = F[0].entities.find((e) => e.type === "poly" && e.pts.some((q) => q[2]));
  ok(slot && slot.pts.length === 4 && slot.pts.filter((q) => q[2]).length === 2, "le trou oblong garde ses deux vrais demi-cercles (4 points)");
  await p.keyboard.press("Enter"); await idle();

  // ---- dans la pièce ouverte : on choisit le plan ----
  await p.setInputFiles("#fileIn", SVG);
  await p.waitForSelector("#dlg[open] #drawW", { timeout: 15000 });
  await p.fill("#drawW", "40"); await p.keyboard.press("Enter");
  await p.waitForFunction(() => /Sur quel plan poser ce dessin/.test(document.querySelector("#dlg")?.innerText.replace(/[  ]/g, " ") || ""), null, { timeout: 10000 });
  await p.click("#dlg >> text=Plan de dessus"); await idle();
  F = await G(() => window.gabarit.doc.features);
  ok(F.length === 4 && F[2].type === "sketch" && F[3].type === "extrude", "le dessin s’ajoute à la pièce ouverte (4 étapes)");
  await p.keyboard.press("Escape"); await idle();
  F = await G(() => window.gabarit.doc.features);
  ok(F.length === 3 && F[2].type === "sketch", "Échap annule le volume, l’esquisse importée reste");

  // ---- fichiers sans dessin ----
  fs.mkdirSync(TMP + "/fixtures", { recursive: true });
  fs.writeFileSync(TMP + "/fixtures/vide.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text x="1" y="5">a</text></svg>');
  await p.setInputFiles("#fileIn", TMP + "/fixtures/vide.svg"); await p.waitForTimeout(700);
  ok(/Aucun trait trouvé/.test(await txt("#toast")), "SVG sans tracé : message clair");
  fs.writeFileSync(TMP + "/fixtures/binaire.dxf", Buffer.from([65, 117, 116, 111, 67, 65, 68, 32, 66, 105, 110, 97, 114, 121, 32, 68, 88, 70, 13, 10, 26, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
  await p.setInputFiles("#fileIn", TMP + "/fixtures/binaire.dxf"); await p.waitForTimeout(700);
  ok(/illisible|Aucun trait/.test(await txt("#toast")), "DXF binaire : message clair (" + (await txt("#toast")) + ")");
  ok(!(await p.locator("#dlg[open]").count()), "aucune fenêtre ouverte après un fichier refusé");

  // ---- mode Expert : nom du métier ----
  await p.goto("http://localhost:8765/?mode=expert"); await p.waitForTimeout(600);
  await p.click("#welcome >> text=Nouvelle pièce"); await p.waitForTimeout(400); await G(() => document.querySelector("#dlg")?.close());
  await G(() => window.gabarit.loadDoc({ version: 1, name: "Essai", material: "pla", params: [], features: [] })); await p.waitForTimeout(500);
  await p.setInputFiles("#fileIn", DXF); await p.waitForSelector("#dlg[open] #drawW", { timeout: 15000 });
  await p.click("#drawOk"); await idle();
  F = await G(() => window.gabarit.doc.features);
  ok(/^Esquisse importée 1$/.test(F[0].name.replace(/[  ]/g, " ")), "mode Expert : « " + F[0].name + " »");
  v = await vol(); ok(near(v, 4628.76), "volume d’origine : " + v.toFixed(1) + " mm³ (attendu 4628,8)");
  console.log("erreurs", JSON.stringify(logs));
  ok(logs.length === 0, "aucune erreur dans la console");
  console.log(fails ? "FLOW25 ÉCHEC (" + fails + ")" : "FLOW25 OK");
  await b.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
