// v1.5.1 : tourner la pièce (quart de tour, coucher, miroir), aimant et pourcentage dans le meuble, remplir le meuble,
// catalogue par magasin et par type (bureaux, tablettes, tiroirs, boîtes).
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(250); };
  const clean = (t) => (t || "").replace(/[\u00a0\u202f]/g, " ");
  const size = () => G(() => { const m = window.gabarit.st.mesh.bb; return [0, 1, 2].map((i) => Math.round((m[1][i] - m[0][i]) * 100) / 100).join(" × "); });
  const lo = () => G(() => window.gabarit.st.mesh.bb[0].map((x) => Math.round(x * 100) / 100).join());
  const types = () => G(() => window.gabarit.doc.features.map((f) => f.type).join());
  const noErr = () => G(() => Object.keys(window.gabarit.st.errors || {}).length === 0);
  // où est le petit cylindre posé sur la boîte : le centre de masse de la pièce le dit (X et Y)
  const cyl = () => G(() => { const g = window.gabarit, v = g.viewer.mesh.geometry.attributes.position; let hi = -Infinity; for (let i = 0; i < v.count; i++) hi = Math.max(hi, v.getZ(i)); let sx = 0, sy = 0, n = 0; for (let i = 0; i < v.count; i++) if (v.getZ(i) > hi - 1e-3) { sx += v.getX(i); sy += v.getY(i); n++; } return [Math.round(sx / n), Math.round(sy / n), Math.round(hi)]; });
  await p.goto("http://localhost:8765/?mode=simple");
  await p.click("text=Nouvelle pièce"); await p.waitForTimeout(300); await G(() => document.querySelector("#dlg")?.close());
  const feats = [
    { id: "b1", type: "shape", kind: "box", name: "Boîte 1", mode: "add", a: "120", b: "80", h: "200", r: "0", x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0" },
    { id: "b2", type: "shape", kind: "cyl", name: "Cylindre 1", mode: "add", d: "30", h: "40", x: "40", y: "20", z: "200", rx: "0", ry: "0", rz: "0" },
  ];
  await G((f) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Pièce à tourner", material: "pla", params: [], features: f }); g.st.mesh = null; }, feats); await idle();
  ok((await size()) === "120 × 80 × 240" && (await cyl()).join() === "40,20,240", "départ : 120 × 80 × 240, le plot est en haut, à droite et vers le fond");
  const vol0 = await G(() => window.gabarit.st.mesh.volume);

  // ---- Tourner, depuis le bouton à côté de la vue ----
  ok(await p.isVisible("#turnBtn"), "le bouton « Tourner » est à côté de la vue, sous « Taille »");
  await p.click("#turnBtn"); await idle();
  ok((await types()) === "shape,shape,orient" && (await p.$$eval("#props [data-turn]", (l) => l.length)) === 7, "« Tourner » ouvre ses 7 gestes à gauche");
  const turn = async (k) => { await p.click(`#props [data-turn="${k}"]`); await idle(); };
  await turn("gauche");
  ok((await size()) === "80 × 120 × 240" && (await cyl()).join() === "-20,40,240" && (await lo()) === "-40,-60,0", "quart de tour à gauche : largeur et profondeur échangées, le plot a tourné, la pièce reste centrée au sol : " + (await cyl()).join());
  await turn("droite"); await turn("demi");
  ok((await size()) === "120 × 80 × 240" && (await cyl()).join() === "-40,-20,240", "retour puis demi-tour : le plot passe de l'autre côté");
  await turn("demi"); await turn("miroir");
  ok((await size()) === "120 × 80 × 240" && (await cyl()).join() === "-40,20,240" && await noErr(), "miroir : le plot passe à gauche sans changer de profondeur");
  ok(Math.abs((await G(() => window.gabarit.st.mesh.volume)) - vol0) < 1 && clean(await p.textContent("#props [data-turn-state]")).includes("miroir"), "le miroir garde le volume, et c'est écrit dans le panneau");
  await turn("miroir"); await turn("cote");
  ok((await size()) === "240 × 80 × 120" && (await lo()) === "-120,-40,0", "couchée sur le côté : 240 de large, posée au sol et centrée");
  await p.screenshot({ path: TMP + "/shots/v151-tourner.png" });
  await turn("avant");
  ok((await size()) === "240 × 120 × 80", "puis couchée vers l'avant : 240 × 120 × 80");
  await turn("envers");
  ok((await size()) === "240 × 120 × 80" && await noErr(), "tête en bas : même encombrement, aucune erreur");
  await p.click('#props [data-turn=""]'); await idle();
  ok((await size()) === "120 × 80 × 240" && (await cyl()).join() === "40,20,240" && !(await p.$('#props [data-turn=""]')), "« Remettre droit » ramène la pièce comme dessinée");
  await turn("cote"); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  await p.keyboard.press("Control+z"); await idle();
  ok((await size()) === "120 × 80 × 240", "Ctrl+Z annule le dernier geste");
  await p.keyboard.press("Control+y"); await idle();
  ok((await size()) === "240 × 80 × 120", "Ctrl+Y le rétablit");
  // « Taille » se range après le sens de pose
  await p.click("#sizeBtn"); await idle(); await p.fill('#props [data-sf="pct"]', "-50"); await idle(); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  ok((await types()) === "shape,shape,orient,scale" && (await size()) === "120 × 40 × 60", "la taille s'ajoute après le sens : 120 × 40 × 60");
  await p.click("#turnBtn"); await idle();
  ok(await G(() => { const g = window.gabarit; return g.doc.features.filter((f) => f.type === "orient").length === 1 && g.doc.features.find((f) => f.id === g.st.sel)?.type === "orient"; }), "« Tourner » rouvre la même étape, même si la taille est après");
  await p.keyboard.press("Enter"); await p.waitForTimeout(300);

  // ---- Dans un meuble : magasins et types ----
  const chips = async () => Object.fromEntries(await p.$$eval("#meublebar .pchk", (l) => l.map((x) => [x.dataset.chk, [x.className.includes("ok") ? "ok" : x.className.includes("warn") ? "warn" : "info", x.textContent.replace(/[\u00a0\u202f]/g, " ").slice(1)]])));
  const tab = async (k) => { await p.click(`#meubleTabs [data-tab="${k}"]`); await p.waitForTimeout(150); };
  await G(() => { localStorage.removeItem("gabarit-meuble"); });
  await p.click('.tbtn[data-tool="meuble"]'); await p.waitForTimeout(700);
  ok(clean(await p.$$eval("#meubleTabs button", (l) => l.map((x) => x.textContent).join("|"))) === "Meuble|Tourner|Placer|Taille et remplissage|Rangements", "le panneau a 5 onglets : Meuble, Tourner, Placer, Taille et remplissage, Rangements");
  ok(clean(await p.$$eval("#meubleShops button", (l) => l.map((x) => x.textContent).join("|"))) === "IKEA|Sans marque|Atelier|Mes meubles" && (await p.$$eval("#meubleType option", (l) => l.length)) === 6, "magasins : IKEA, Sans marque, Atelier, Mes meubles ; IKEA a 6 types de meubles");
  const total = async () => { let n = 0; for (const t of await p.$$eval("#meubleType option", (l) => l.map((o) => o.value))) { await p.selectOption("#meubleType", t); await p.waitForTimeout(120); n += (await p.$$eval("#meubleSel option", (l) => l.length)) - 1; } return n; };
  const nb = await total();
  ok(nb >= 50, "IKEA propose " + nb + " modèles");
  await p.selectOption("#meubleType", "bureaux"); await p.waitForTimeout(300);
  let c = await chips();
  ok((await p.inputValue("#meubleSel")) === "lagkapten120" && !(await p.isVisible('#meublebar [data-md="2"]')) && c.rentre[1].startsWith("Ça tient dessus") && !c.rentre[1].includes("hauteur") && c.mesure[1].includes("publiée"), "un bureau : pas de hauteur, « " + c.rentre[1] + " »");
  ok(await G(() => window.gabarit.viewer.furn.children.filter((o) => o.isMesh).length === 1), "le bureau est dessiné comme un simple plateau");
  await p.screenshot({ path: TMP + "/shots/v151-bureau.png" });
  await p.selectOption("#meubleType", "boites"); await p.waitForTimeout(300);
  c = await chips();
  ok(await G(() => window.gabarit.viewer.furn.children.filter((o) => o.isMesh).length === 5) && c.mesure[1].includes("estimé"), "une boîte : un fond et quatre parois, intérieur marqué « estimé »");
  await p.selectOption("#meubleType", "tablettes"); await p.waitForTimeout(300);
  ok(await G(() => window.gabarit.viewer.furn.children.filter((o) => o.isMesh).length === 2), "une tablette murale : la planche et le mur");
  await p.click('#meubleShops [data-shop="courant"]'); await p.waitForTimeout(300);
  ok((await p.inputValue("#meubleSel")) === "cube30" && (await p.$$eval("#meubleType option", (l) => l.length)) === 3, "« Sans marque » : casiers, bureaux, bacs");
  await p.click('#meubleShops [data-shop="ikea"]'); await p.waitForTimeout(300);
  ok((await p.inputValue("#meubleSel")) === "kallax", "retour à IKEA : la case Kallax");

  // ---- Placer : boutons, pourcentage, aimant ----
  await tab("placer");
  c = await chips();
  ok(c.place[1].includes("gauche 107,5 mm") && (await p.inputValue("#meubleAtX")) === "50" && (await p.inputValue("#meubleAtY")) === "50", "au départ la pièce est au centre (50 % et 50 %) : " + c.place[1]);
  await p.click('[data-at="0:0"]'); await p.click('[data-at="1:100"]'); await p.waitForTimeout(200);
  c = await chips();
  ok(c.place[1].includes("gauche 0 mm") && c.place[1].includes("derrière 0 mm") && c.place[1].includes("devant 350 mm"), "« À gauche » et « Au fond » la collent aux parois : " + c.place[1]);
  ok(await p.$eval('[data-at="1:100"]', (x) => x.classList.contains("on")), "le bouton choisi reste allumé");
  // elle reste collée au fond quand elle grandit
  await tab("remplir"); await p.fill("#meublePct", "100"); await idle(); await p.waitForTimeout(200);
  c = await chips();
  ok((await size()) === "240 × 80 × 120" && c.place[1].includes("gauche 0 mm") && c.place[1].includes("derrière 0 mm"), "agrandie, elle reste collée à gauche et au fond : " + c.place[1]);
  await tab("placer");
  await p.fill("#meubleAtX", "60"); await p.fill("#meubleAtY", "25"); await p.waitForTimeout(200);
  c = await chips();
  // largeur 335, pièce 240 : milieu à 60 % = 201, donc 81 à gauche (elle tient). Profondeur 390, pièce 80 : milieu à 25 % = 97,5, donc 57,5 devant.
  ok(c.place[1].includes("gauche 81 mm") && c.place[1].includes("devant 57,5 mm"), "à 60 % de la largeur et 25 % de la profondeur : " + c.place[1]);
  await p.fill("#meubleAtX", "5"); await p.waitForTimeout(200);
  ok((await chips()).place[1].includes("gauche 0 mm"), "un pourcentage trop près du bord : elle s'arrête à la paroi");
  await p.locator('label:has(#meubleAtY) [data-step="plus"]').click(); await p.waitForTimeout(250);
  ok((await p.inputValue("#meubleAtY")) === "30", "le bouton + avance de 5 %");
  // aimant : glissée près du centre, elle s'y colle
  await p.fill("#meubleAtX", "50"); await p.fill("#meubleAtY", "50"); await p.waitForTimeout(200);
  const hit = async () => G(() => { const v = window.gabarit.viewer; v.mesh.geometry.computeBoundingBox(); const w = v.mesh.geometry.boundingBox.getCenter(v.part.position.clone()).applyMatrix4(v.part.matrixWorld).project(v.camera); const r = v.renderer.domElement.getBoundingClientRect(); return [r.left + (w.x + 1) / 2 * r.width, r.top + (1 - w.y) / 2 * r.height]; });
  const drag = async (dx, dy, shift) => { const h = await hit(); if (shift) await p.keyboard.down("Shift"); await p.mouse.move(h[0], h[1]); await p.mouse.down(); await p.mouse.move(h[0] + dx, h[1] + dy, { steps: 8 }); await p.mouse.up(); if (shift) await p.keyboard.up("Shift"); await p.waitForTimeout(250); };
  await drag(40, 0);
  c = await chips(); const moved = c.place[1];
  ok(!moved.includes("gauche 47,5 mm"), "glissée franchement, elle quitte le centre : " + moved);
  await p.fill("#meubleAtX", "50"); await p.waitForTimeout(200);
  await drag(4, 0);
  ok((await chips()).place[1].includes("gauche 47,5 mm") && (await p.inputValue("#meubleAtX")) === "50", "glissée d'un rien avec l'aimant, elle reste collée au centre");
  await drag(4, 0, true);
  ok(!(await chips()).place[1].includes("gauche 47,5 mm"), "avec Maj, l'aimant est coupé : elle bouge finement");
  await p.uncheck("#meubleAimant"); await p.fill("#meubleAtX", "50"); await p.waitForTimeout(200); await drag(4, 0);
  ok(!(await chips()).place[1].includes("gauche 47,5 mm"), "aimant décoché : elle ne se colle plus");
  await p.check("#meubleAimant");
  await p.screenshot({ path: TMP + "/shots/v151-placer.png" });

  // ---- Tourner dans le meuble ----
  await tab("tourner");
  await p.click("#meubleStraight"); await idle();
  ok((await size()) === "120 × 80 × 240", "« Remettre droit » dans le meuble : " + (await size()));
  await p.click("#meubleMirror"); await idle(); await p.click("#meubleTurn"); await idle();
  ok((await size()) === "80 × 120 × 240" && clean(await p.textContent("#meubleTaille")).includes("80 × 120 × 240") && await noErr(), "miroir puis quart de tour : l'encombrement suit dans le panneau");
  await p.click("#meubleStraight"); await idle();

  // ---- Remplir le meuble ----
  await tab("remplir");
  ok((await p.inputValue("#meubleJeu")) === "1" && await p.isDisabled("#meubleUnfill"), "le jeu est de 1 mm au départ, rien n'est encore rempli");
  await p.click("#meubleFillX"); await idle();
  c = await chips();
  ok((await size()) === "334 × 80 × 240" && (await types()) === "shape,shape,orient,scale,fit" && c.rempli && c.rentre[1].includes("1 mm en largeur"), "« Remplir la largeur » : 334 mm (335 moins 1 mm de jeu), le reste ne change pas");
  ok((await cyl())[2] === 240 && await noErr(), "la pièce garde sa hauteur et son plot");
  await p.fill("#meubleJeu", "0"); await p.click("#meubleFillZ"); await idle();
  ok((await size()) === "334 × 80 × 335", "jeu à 0 puis « La hauteur » : 335 mm pile, la largeur déjà remplie reste à 334");
  await p.click("#meubleFillAll"); await idle();
  c = await chips();
  ok((await size()) === "335 × 390 × 335" && c.rentre[0] === "ok" && c.rempli[1].includes("tout le meuble"), "« Tout » : la pièce occupe exactement la case : " + c.rentre[1]);
  await p.screenshot({ path: TMP + "/shots/v151-remplir.png" });
  await p.click("#meubleMax"); await p.waitForTimeout(300);
  ok(clean(await p.textContent("#toast")).includes("remplit déjà"), "« Taille maximale » le dit quand tout est déjà rempli");
  // l'étape se règle aussi à gauche, et se retire
  await G(() => { const g = window.gabarit; g.select(g.doc.features.at(-1).id); }); await p.waitForTimeout(300);
  ok((await p.inputValue('#props [data-ff="x"]')) === "335" && (await p.inputValue('#props [data-ff="y"]')) === "390", "l'étape « Remplissage » montre ses tailles à gauche");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  await p.click("#meubleUnfill"); await idle();
  ok((await size()) === "120 × 80 × 240" && (await types()) === "shape,shape,orient,scale", "« Forme d'origine » retire le remplissage");
  await p.keyboard.press("Control+z"); await idle();
  ok((await size()) === "335 × 390 × 335", "Ctrl+Z le remet");
  await p.keyboard.press("Control+y"); await idle();
  // sur un bureau : pas de hauteur à remplir
  await tab("meuble"); await p.selectOption("#meubleType", "bureaux"); await p.waitForTimeout(300); await tab("remplir");
  ok(await p.isDisabled("#meubleFillZ"), "sur un bureau, « La hauteur » est grisée");
  await p.fill("#meubleJeu", "1");
  await p.click("#meubleClose"); await p.waitForTimeout(400);
  // enregistrer et rouvrir : le sens et le remplissage sont gardés
  await p.click('.tbtn[data-tool="meuble"]'); await p.waitForTimeout(500); await tab("meuble"); await p.click('#meubleShops [data-shop="ikea"]'); await p.waitForTimeout(200); await tab("tourner");
  await p.click("#meubleLay"); await idle(); await tab("remplir"); await p.click("#meubleFillY"); await idle();
  const s1 = await size();
  const json = await G(() => JSON.stringify(window.gabarit.doc));
  await G((j) => { const g = window.gabarit; g.loadDoc(JSON.parse(j)); g.st.mesh = null; }, json); await idle();
  ok((await size()) === s1 && s1 === "240 × 389 × 120", "rouverte, la pièce garde son sens et son remplissage : " + s1);
  ok(!logs.length, "aucune erreur dans la console" + (logs.length ? " : " + logs.slice(0, 3).join(" / ") : ""));
  await b.close();
  console.log(fails ? `FLOW37 : ${fails} ÉCHEC(S)` : "FLOW37 OK"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
