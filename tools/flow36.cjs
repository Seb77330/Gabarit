// v1.5 : Ctrl+Z qui marche aussi dans une case, pas du quadrillage (jusqu'à 0,01 mm), essai dans un meuble.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(250); };
  const clean = (t) => (t || "").replace(/[  ]/g, " ");
  const toast = async () => clean(await p.textContent("#toast"));
  const A = () => G(() => window.gabarit.doc.features[0].a);
  await p.goto("http://localhost:8765/?mode=simple");
  await p.click("text=Nouvelle pièce"); await p.waitForTimeout(300); await G(() => document.querySelector("#dlg")?.close());
  const box = { id: "b1", type: "shape", kind: "box", name: "Boîte 1", mode: "add", a: "120", b: "80", h: "200", r: "0", x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0" };
  await G((box) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Boîte à ranger", material: "pla", params: [], features: [box] }); g.st.mesh = null; }, box); await idle();

  // ---- Ctrl+Z ----
  const inp = '#props [data-hk="a"]';
  await p.keyboard.press("Control+z"); await p.waitForTimeout(200);
  ok((await toast()) === "Rien à annuler." && !(await G(() => document.querySelector("#toast").hidden)), "Ctrl+Z sans rien à annuler : c'est écrit à l'écran");
  await G(() => window.gabarit.select("b1")); await p.waitForTimeout(300);
  await p.click(inp);
  await p.locator('#props .field:has([data-hk="a"]) [data-step="plus"]').click(); await idle();
  ok((await A()) === "121", "le bouton + avance de 1 mm (pas de départ)");
  await p.click(inp);
  ok(await G(() => document.activeElement.dataset.hk === "a"), "le curseur est dans la case");
  await p.keyboard.press("Control+z"); await p.waitForTimeout(300); await idle();
  ok((await A()) === "120", "Ctrl+Z avec le curseur dans une case : la modification est annulée (" + (await A()) + ")");
  ok(/^Annulé/.test(await toast()), "un mot confirme l'annulation : « " + (await toast()) + " »");
  await p.keyboard.press("Control+y"); await p.waitForTimeout(300); await idle();
  ok((await A()) === "121" && (await toast()) === "Rétabli.", "Ctrl+Y rétablit");
  // ce qu'on vient de taper est défait d'abord par le navigateur, puis vient l'historique de la pièce
  await G(() => window.gabarit.select("b1")); await p.waitForTimeout(300);
  await p.click(inp); await p.keyboard.press("End"); await p.keyboard.type("5"); await idle();
  ok((await A()) === "1215", "saisie au clavier : 1215");
  await p.keyboard.press("Control+z"); await p.waitForTimeout(300); await idle();
  ok((await A()) === "121", "Ctrl+Z défait d'abord ce qui vient d'être tapé (" + (await A()) + ")");
  await p.keyboard.press("Control+z"); await p.waitForTimeout(300); await idle();
  ok((await A()) === "120", "un deuxième Ctrl+Z remonte dans l'historique de la pièce (" + (await A()) + ")");
  // une valeur tapée mais pas encore validée est annulée aussi (elle n'est pas perdue en route)
  await G(() => window.gabarit.select("b1")); await p.waitForTimeout(300);
  await p.fill(inp, "150"); await idle();
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  await p.locator('.file [data-act="undo"]').click(); await p.waitForTimeout(300); await idle();
  ok(["120", "150"].includes(await A()), "bouton Annuler en haut : il répond (" + (await A()) + ")");
  await G(() => window.gabarit.select(null)); await p.waitForTimeout(200);
  ok(clean(await p.textContent("#gestes")).includes("Ctrl+Z : annuler"), "le raccourci est écrit en bas de la vue");

  // ---- Pas du quadrillage ----
  await G((box) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Boîte à ranger", material: "pla", params: [], features: [box] }); g.st.mesh = null; }, box); await idle();
  ok(await p.isVisible("#pasSel") && (await p.inputValue("#pasSel")) === "1", "le réglage « Pas » est à côté de la vue, à 1 mm au départ");
  ok((await p.$$eval("#pasSel option", (l) => l.map((o) => o.value))).join() === "10,5,1,0.5,0.1,0.01", "pas proposés : de 10 mm à 0,01 mm");
  await p.selectOption("#pasSel", "0.1"); await p.waitForTimeout(300);
  ok(await G(() => Math.abs(window.gabarit.viewer.ground.material.uniforms.uPas.value - 0.1) < 1e-9 && localStorage.getItem("gabarit-pas") === "0.1" && window.gabarit.sketcher.snapStep === 0.1), "pas de 0,1 mm : le sol, le dessin et la préférence suivent");
  await G(() => window.gabarit.select("b1")); await p.waitForTimeout(300);
  await p.locator('#props .field:has([data-hk="a"]) [data-step="plus"]').click(); await idle();
  ok((await A()) === "120.1", "le bouton + avance maintenant de 0,1 mm (" + (await A()) + ")");
  await p.selectOption("#pasSel", "0.01"); await p.waitForTimeout(300);
  await p.locator('#props .field:has([data-hk="a"]) [data-step="plus"]').click(); await idle();
  ok((await A()) === "120.11", "au pas de 0,01 mm : 120,11 (" + (await A()) + ")");
  await G(() => window.gabarit.select(null));
  await p.mouse.move(760, 520); for (let i = 0; i < 10; i++) { await p.mouse.wheel(0, -400); await p.waitForTimeout(60); }
  await p.waitForTimeout(400); await p.screenshot({ path: TMP + "/shots/v15-pas.png" });
  ok(await G(() => { const c = window.gabarit.viewer.camera; return c.near < 1 && c.near > 0; }), "de très près, la vue ne coupe pas la pièce");
  await p.selectOption("#pasSel", "1"); await p.waitForTimeout(200);
  await G(() => window.gabarit.viewer.fit([1, -1.3, 0.9]));

  // ---- Essayer dans un meuble ----
  await G((box) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Boîte à ranger", material: "pla", params: [], features: [box] }); g.st.mesh = null; }, box); await idle();
  const chips = async () => Object.fromEntries(await p.$$eval("#meublebar .pchk", (l) => l.map((x) => [x.dataset.chk, [x.className.includes("ok") ? "ok" : x.className.includes("warn") ? "warn" : "info", x.textContent.replace(/[  ]/g, " ").slice(1)]])));
  ok(await p.isVisible('.tbtn[data-tool="meuble"]'), "l'outil « Dans un meuble » est dans la barre Simple");
  await p.click('.tbtn[data-tool="meuble"]'); await p.waitForTimeout(700);
  ok(await p.isVisible("#meublebar") && (await p.inputValue("#meubleSel")) === "kallax", "le panneau s'ouvre sur une case Kallax");
  const tab = async (k) => { await p.click(`#meubleTabs [data-tab="${k}"]`); await p.waitForTimeout(150); };
  ok((await p.$$eval("#meubleSel option", (l) => l.length)) >= 10 && (await p.$$eval("#meubleShops button", (l) => l.map((o) => o.textContent))).join("|").startsWith("IKEA|") && (await p.$$eval("#meubleSel option", (l) => l.at(-1).value)) === "libre", "on choisit le magasin (IKEA d'abord), puis le modèle, ou le sur-mesure");
  let c = await chips();
  ok(c.rentre[0] === "ok" && c.rentre[1].includes("215 mm en largeur") && c.rentre[1].includes("310 mm en profondeur") && c.rentre[1].includes("135 mm en hauteur"), "120 × 80 × 200 rentre dans la case : " + c.rentre[1]);
  ok(c.nombre && c.nombre[1].includes("ranger 8"), "nombre d'exemplaires : " + (c.nombre || [])[1]);
  ok(c.maxi && c.maxi[1].includes("167"), "taille maximale annoncée : " + (c.maxi || [])[1]);
  ok(await G(() => !!window.gabarit.viewer.furn && !document.querySelector("#coach") && !document.querySelector("#gestes")), "le meuble est dessiné, et les aides du bas laissent la place au panneau");
  await p.screenshot({ path: TMP + "/shots/v15-meuble.png" });
  // déplacer la pièce à la souris
  const before = c.place[1];
  const hit = await G(() => { const v = window.gabarit.viewer; v.mesh.geometry.computeBoundingBox(); const w = v.mesh.geometry.boundingBox.getCenter(v.part.position.clone()).applyMatrix4(v.part.matrixWorld).project(v.camera); const r = v.renderer.domElement.getBoundingClientRect(); return [r.left + (w.x + 1) / 2 * r.width, r.top + (1 - w.y) / 2 * r.height]; });
  await p.mouse.move(hit[0], hit[1]); await p.mouse.down(); await p.mouse.move(hit[0] + 50, hit[1], { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
  c = await chips();
  ok(c.place[1] !== before && c.rentre[0] === "ok", "la pièce se glisse à la souris dans le meuble : " + c.place[1]);
  ok(await G(() => { const v = window.gabarit.viewer; const bx = new v.furnBox.constructor().setFromObject(v.part); return bx.min.x >= -167.6 && bx.max.x <= 167.6 && bx.min.y >= -195.1 && bx.max.y <= 195.1 && Math.abs(bx.min.z) < 1e-6; }), "elle reste entre les parois, posée sur l'étagère");
  // agrandir : l'alerte arrive quand ça ne rentre plus
  await tab("remplir");
  await p.fill("#meublePct", "190"); await idle(); await p.waitForTimeout(200);
  c = await chips();
  ok(c.rentre[0] === "warn" && c.rentre[1].includes("trop haute de 45 mm") && c.sens, "agrandie à 190 % : " + c.rentre[1]);
  ok(await G(() => window.gabarit.doc.features.at(-1).type === "scale" && window.gabarit.doc.features.at(-1).k === "190"), "la taille passe par l'étape « Taille » de la pièce");
  await p.screenshot({ path: TMP + "/shots/v15-meuble-trop-grand.png" });
  await tab("tourner");
  await p.click("#meubleBest"); await idle(); await p.waitForTimeout(200);
  c = await chips();
  ok(c.rentre[0] === "ok" && clean(await p.textContent("#meubleTaille")).includes("380"), "« Trouver le bon sens » la couche et elle rentre : " + c.rentre[1]);
  for (const id of ["#meubleLay", "#meubleLay", "#meubleLay", "#meubleLay", "#meubleTurn", "#meubleTurn", "#meubleTurn", "#meubleTurn"]) { await p.click(id); await idle(); }
  ok((await chips()).rentre[0] === "ok" && clean(await p.textContent("#meubleTaille")).includes("380"), "coucher quatre fois et tourner quatre fois ramène au même sens");
  ok(await G(() => window.gabarit.doc.features.map((f) => f.type).join() === "shape,orient,scale"), "le sens de pose est une étape de la pièce, rangée avant la taille");
  await tab("remplir");
  await p.click("#meubleMax"); await idle(); await p.waitForTimeout(300);
  c = await chips();
  const pct = Number((await p.inputValue("#meublePct")).replace(",", "."));
  ok(c.rentre[0] === "ok" && pct > 190 && pct < 200, "« Taille maximale qui rentre » : " + pct + " %, et " + c.rentre[1]);
  // remplir
  await p.fill("#meublePct", "100"); await idle(); await p.waitForTimeout(200);
  await tab("placer");
  await p.check("#meubleCopies"); await p.waitForTimeout(400);
  const n = await G(() => { let k = 0; window.gabarit.viewer.furn.traverse((o) => { if (o.isInstancedMesh) k += o.count; }); return k; });
  c = await chips();
  ok(n + 1 === Number(/ranger (\d+)/.exec(c.nombre[1])[1]), "« Montrer tous les exemplaires » les dessine tous (" + (n + 1) + ")");
  await p.screenshot({ path: TMP + "/shots/v15-meuble-rempli.png" });
  await p.uncheck("#meubleCopies");
  // un autre meuble, puis le sien
  await tab("meuble");
  await p.selectOption("#meubleSel", "billy80"); await p.waitForTimeout(400);
  ok((await p.inputValue('#meublebar [data-md="0"]')) === "760" && (await p.inputValue('#meublebar [data-md="1"]')) === "260", "Billy 80 cm : 760 × 260 à l'intérieur");
  await p.fill('#meublebar [data-md="2"]', "150"); await p.waitForTimeout(300);
  c = await chips();
  ok((await p.inputValue("#meubleSel")) === "libre" && c.rentre[0] === "ok" && c.rentre[1].includes("en hauteur"), "changer une dimension passe en sur-mesure, la réponse suit : " + c.rentre[1]);
  p.once("dialog", (d) => d.accept("Étagère du garage"));
  await p.click("#meubleKeep"); await p.waitForTimeout(400);
  ok((await p.inputValue("#meubleSel")) === "moi:Étagère du garage" && await p.isVisible("#meubleDel"), "« Garder ce meuble » l'ajoute à « Mes meubles »");
  // fermer : tout revient en place, et Ctrl+Z annule le changement de taille
  await p.click("#meubleClose"); await p.waitForTimeout(400);
  ok(await G(() => { const v = window.gabarit.viewer; return !v.furn && v.part.position.length() === 0 && v.part.quaternion.w === 1 && !document.querySelector("#meublebar"); }), "fermer remet la pièce à sa place");
  await p.click('.tbtn[data-tool="meuble"]'); await p.waitForTimeout(500);
  ok((await p.inputValue("#meubleSel")) === "moi:Étagère du garage" && (await p.inputValue('#meublebar [data-md="2"]')) === "150" && await p.isVisible("#meubleDel"), "le dernier meuble essayé et le dernier onglet sont retenus");
  await p.click("#meubleDel"); await p.waitForTimeout(300);
  ok((await p.inputValue("#meubleSel")) === "libre" && !(await p.isVisible("#meubleDel")), "« Retirer » l'enlève de la liste");
  await p.click('#meubleShops [data-shop="ikea"]'); await p.waitForTimeout(300);
  ok((await p.inputValue("#meubleSel")) === "kallax", "revenir au magasin IKEA remet la case Kallax");
  await p.click('.tbtn[data-tool="print"]'); await p.waitForTimeout(600);
  ok(await G(() => !document.querySelector("#meublebar") && !!document.querySelector("#printbar") && !window.gabarit.viewer.furn), "ouvrir « Imprimer en 3D » ferme l'essai dans le meuble");
  await p.click('.tbtn[data-tool="print"]'); await p.waitForTimeout(400);
  ok(!logs.length, "aucune erreur dans la console" + (logs.length ? " : " + logs.slice(0, 3).join(" / ") : ""));
  await b.close();
  console.log(fails ? `FLOW36 : ${fails} ÉCHEC(S)` : "FLOW36 OK"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
