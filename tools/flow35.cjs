// v1.4 : bouton « Taille » (toute la pièce en % ou en mm), question « Enregistrer ? » à la fermeture d'un onglet,
// aides de gestes toujours visibles.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(250); };
  const bb = () => G(() => window.gabarit.st.mesh.bb);
  const size = async () => { const B = await bb(); return [0, 1, 2].map((k) => Math.round((B[1][k] - B[0][k]) * 100) / 100); };
  const names = () => p.$$eval("#tabs .tab .nm", (l) => l.map((x) => x.textContent.replace(/\s/g, " ")));
  const lib = () => G(() => JSON.parse(localStorage.getItem("gabarit-lib") || "{}"));
  const clean = (t) => t.replace(/[\u00a0\u202f]/g, " ");
  await p.goto("http://localhost:8765/?mode=expert");
  await p.click("text=Nouvelle pièce"); await p.waitForTimeout(300); await G(() => document.querySelector("#dlg")?.close());

  // ---- le bouton Taille ----
  const box = { id: "b1", type: "shape", kind: "box", name: "Boîte 1", mode: "add", a: "60", b: "30", h: "20", r: "0", x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0" };
  await G((box) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Essai taille", material: "pla", params: [], features: [box] }); g.st.mesh = null; }, box); await idle();
  const B0 = await bb();
  ok(await p.isVisible("#sizeBtn"), "le bouton « Taille » est à côté de la vue");
  await p.click("#sizeBtn"); await idle();
  ok(await G(() => window.gabarit.doc.features.at(-1).type === "scale") && await p.isVisible('#props [data-sf="pct"]'), "un clic ouvre le tableau de taille");
  await p.fill('#props [data-sf="pct"]', "30"); await idle();
  ok((await size()).join() === "78,39,26", "agrandir de 30 % : 78 × 39 × 26 (" + (await size()).join(" × ") + ")");
  const B1 = await bb();
  ok(Math.abs(B1[0][2] - B0[0][2]) < 1e-6 && Math.abs((B1[0][0] + B1[1][0]) - (B0[0][0] + B0[1][0])) < 1e-6, "la pièce reste posée au même endroit");
  ok(await p.inputValue('#props [data-sf="x"]') === "78" && await p.inputValue('#props [data-sf="z"]') === "26", "les dimensions en mm suivent le pourcentage");
  await p.fill('#props [data-sf="x"]', "120"); await idle();
  ok((await size()).join() === "120,60,40" && await p.inputValue('#props [data-sf="pct"]') === "100", "longueur à 120 mm : tout double, le pourcentage affiche 100");
  // le bouton + du pourcentage, puis rester appuyé sur −
  const plus = p.locator('#props .field:has([data-sf="pct"]) .stepb[data-step="plus"]');
  await plus.click(); await idle();
  ok(await p.inputValue('#props [data-sf="pct"]') === "105", "bouton + : 105 % (" + await p.inputValue('#props [data-sf="pct"]') + ")");
  const minus = p.locator('#props .field:has([data-sf="pct"]) .stepb[data-step="minus"]'), mb = await minus.boundingBox();
  await p.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2); await p.mouse.down();
  // on tient le bouton jusqu'à ce que les chiffres aient défilé (une machine lente met plus longtemps)
  await p.waitForFunction(() => Number(document.querySelector('#props [data-sf="pct"]')?.value) <= 85, null, { timeout: 30000 }).catch(() => {});
  await p.mouse.up(); await idle();
  const after = Number(await p.inputValue('#props [data-sf="pct"]'));
  ok(after <= 85, "rester appuyé sur − fait défiler (" + after + " %)");
  await p.fill('#props [data-sf="pct"]', "-50"); await idle();
  ok((await size()).join() === "30,15,10", "réduire de 50 % : 30 × 15 × 10");
  await p.screenshot({ path: TMP + "/shots/v14-taille.png" });
  await p.click("#sizeBtn"); await p.waitForTimeout(300);
  ok(await G(() => window.gabarit.doc.features.filter((f) => f.type === "scale").length === 1), "un second clic rouvre le même tableau, sans ajouter d’étape");
  ok(await p.isVisible('#props [data-size="stretch"]'), "le tableau propose « Allonger une partie » pour un seul sens");

  // ---- les aides de gestes ----
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  ok(await p.isVisible("#gestes") && /Tourner|tourner/.test(clean(await p.innerText("#gestes"))), "les gestes sont écrits en bas de la vue : " + clean(await p.innerText("#gestes")).replace(/\n+/g, " | ").slice(0, 140));
  await p.click('.tree [data-id="b1"], #tree [data-id="b1"]').catch(() => G(() => window.gabarit.select?.("b1"))); await p.waitForTimeout(400);
  ok(/Aucune touche/.test(clean(await p.innerText("#gestes"))), "pièce choisie : « Aucune touche à tenir » est écrit");
  await p.click("#gestes .x"); await p.waitForTimeout(200);
  ok(await p.isVisible("#gestes.mini"), "✕ replie l’aide en un petit bouton « Gestes »");
  await p.click("#gestes.mini"); await p.waitForTimeout(200);
  ok(!(await p.isVisible("#gestes.mini")) && await p.isVisible("#gestes .g"), "le petit bouton la rouvre");

  // ---- fermer un onglet : la question ----
  await G(() => { localStorage.removeItem("gabarit-lib"); });
  await p.click("#tabs .tab-new"); await p.waitForTimeout(300); await G(() => document.querySelector("#dlg")?.close()); await p.keyboard.press("Escape");
  const n0 = (await names()).length;
  await p.click("#tabs .tab.on .x"); await p.waitForTimeout(300);
  ok((await names()).length === n0 - 1 && !(await p.isVisible("#closeName")), "un onglet vide se ferme sans question");
  // une pièce nouvelle, modifiée
  await p.click("#tabs .tab-new"); await p.waitForTimeout(300); await G(() => document.querySelector("#dlg")?.close()); await p.keyboard.press("Escape");
  await p.fill("#docName", "Banc"); await p.press("#docName", "Enter");
  await G((box) => { const g = window.gabarit; g.insertFeature ? g.insertFeature({ ...box, id: "bx" }) : g.mutate(() => g.doc.features.push({ ...box, id: "bx" })); }, box); await idle(); await p.waitForTimeout(1200);
  ok(await p.isVisible("#tabs .tab.on .dot"), "un point sur l’onglet signale la pièce modifiée");
  await p.click("#tabs .tab.on .x"); await p.waitForTimeout(300);
  ok(await p.isVisible("#closeName") && /Enregistrer « Banc » avant de fermer \?/.test(clean(await p.innerText("#dlg"))), "fermer une pièce modifiée pose la question : " + clean(await p.innerText("#dlg .dh")));
  await p.screenshot({ path: TMP + "/shots/v14-fermer.png" });
  await p.click('#dlg [data-close="cancel"]'); await p.waitForTimeout(200);
  ok((await names()).includes("Banc") && !(await p.isVisible("#closeName")), "Annuler : l’onglet reste ouvert");
  await p.click("#tabs .tab.on .x"); await p.waitForTimeout(300);
  await p.click('#dlg [data-close="no"]'); await p.waitForTimeout(400);
  ok(!(await names()).includes("Banc") && !(await lib()).Banc, "Ne pas enregistrer : l’onglet se ferme et rien ne reste dans « Mes pièces »");
  // enregistrer
  await p.click("#tabs .tab-new"); await p.waitForTimeout(300); await G(() => document.querySelector("#dlg")?.close()); await p.keyboard.press("Escape");
  await p.fill("#docName", "Lampe"); await p.press("#docName", "Enter");
  await G((box) => { const g = window.gabarit; g.insertFeature ? g.insertFeature({ ...box, id: "bx" }) : g.mutate(() => g.doc.features.push({ ...box, id: "bx" })); }, box); await idle(); await p.waitForTimeout(1200);
  await p.click("#tabs .tab.on .x"); await p.waitForTimeout(300);
  await p.fill("#closeName", "Lampe haute"); await p.click('#dlg [data-close="yes"]'); await p.waitForTimeout(400);
  const L = await lib();
  ok(!(await names()).includes("Lampe") && L["Lampe haute"] && !L.Lampe && L["Lampe haute"].features.length === 1, "Enregistrer sous un autre nom : la pièce est dans « Mes pièces » sous « Lampe haute » seulement");
  // rouvrir depuis Mes pièces, modifier, ne pas enregistrer : la pièce retrouve son état
  await G(() => { const g = window.gabarit; g.openTab(JSON.parse(localStorage.getItem("gabarit-lib"))["Lampe haute"]); }); await idle();
  ok(!(await p.isVisible("#tabs .tab.on .dot")), "une pièce rouverte sans changement n’a pas de point");
  await p.click("#tabs .tab.on .x"); await p.waitForTimeout(300);
  ok(!(await p.isVisible("#closeName")) && !(await names()).includes("Lampe haute"), "la refermer sans changement ne pose pas de question");
  await G(() => { const g = window.gabarit; g.openTab(JSON.parse(localStorage.getItem("gabarit-lib"))["Lampe haute"]); }); await idle();
  await G(() => { const g = window.gabarit; g.mutate(() => { g.doc.features[0].h = "55"; }); }); await idle(); await p.waitForTimeout(1300);
  ok((await lib())["Lampe haute"].features[0].h === "55", "pendant le travail, la copie de sécurité suit dans « Mes pièces »");
  await p.click("#tabs .tab.on .x"); await p.waitForTimeout(300);
  await p.click('#dlg [data-close="no"]'); await p.waitForTimeout(400);
  ok((await lib())["Lampe haute"].features[0].h === "20", "Ne pas enregistrer : la pièce retrouve son état d’avant dans « Mes pièces »");

  ok(!logs.length, "aucune erreur dans la console" + (logs.length ? " : " + logs.slice(0, 3).join(" / ") : ""));
  await b.close();
  console.log(fails ? `FLOW35 : ${fails} ÉCHEC(S)` : "FLOW35 OK"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
