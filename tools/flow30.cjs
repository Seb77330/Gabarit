// v1.3 : boutons de correction dans les messages d'erreur, saisie lente dans un champ.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(250); await p.waitForFunction(() => !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(250); };
  const txt = async (sel) => (await p.locator(sel).innerText()).replace(/[  ]/g, " ");
  const load = async (features) => { await G((features) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Essai", material: "pla", params: [], features }); g.st.mesh = null; }, features); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(300); };
  const top = { kind: "std", name: "dessus", offset: "0" };
  const box = { id: "b1", type: "shape", kind: "box", name: "Boîte 1", mode: "add", a: "40", b: "30", h: "10", r: "0", x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0" };

  await p.goto("http://localhost:8765/?mode=expert");
  await p.waitForFunction(() => window.gabarit && window.gabarit.st);
  await p.click("#welcome >> text=Voir l’exemple").catch(() => {}); await p.waitForTimeout(300);

  // 1. Congé trop grand sur les 4 arêtes verticales d'une boîte 40 × 30 × 10 : 20 mm ne passe pas, 15 non plus (les arrondis se rejoignent)
  const edges = [[20, 15, 5], [-20, 15, 5], [20, -15, 5], [-20, -15, 5]];
  await load([box, { id: "f1", type: "fillet", name: "Congé 1", r: "20", edges }]);
  ok(!!(await G(() => window.gabarit.st.errors.f1)), "congé de 20 mm : erreur → " + await G(() => window.gabarit.st.errors.f1));
  await p.click("#tree .feat >> text=Congé 1"); await p.waitForSelector("#props .note.err [data-fix=value]");
  await p.screenshot({ path: TMP + "/shots/v13-erreur.png" });
  await p.click("#props .note.err [data-fix=value]");
  await p.waitForFunction(() => window.gabarit.doc.features[1].r !== "20", null, { timeout: 120000 }); await idle();
  const r = Number(await G(() => window.gabarit.doc.features[1].r));
  ok(r >= 12 && r < 15.01 && !(await G(() => window.gabarit.st.errors.f1)), "le bouton trouve un rayon qui marche : " + r + " mm, sans erreur");
  ok(Math.abs(r * 10 - Math.round(r * 10)) < 1e-6 || Math.abs(r * 2 - Math.round(r * 2)) < 1e-6, "la valeur trouvée est ronde (" + r + ")");
  ok(!(await p.$("#props .note.err")), "le message d’erreur a disparu");
  await p.keyboard.press("Control+z"); await idle();
  ok(await G(() => window.gabarit.doc.features[1].r) === "20", "Ctrl+Z revient à 20 mm");

  // 2. Arêtes disparues : bouton « Choisir les arêtes à nouveau »
  await load([box, { id: "f1", type: "fillet", name: "Congé 1", r: "2", edges: [[200, 200, 200]] }]);
  await p.click("#tree .feat >> text=Congé 1"); await p.waitForSelector("#props .note.err");
  ok(/n’existent plus/.test(await txt("#props .note.err")) && !!(await p.$("#props .note.err [data-fix=pick]")), "arêtes disparues : bouton pour les choisir à nouveau");
  await p.click("#props .note.err [data-fix=pick]"); await p.waitForTimeout(400);
  ok(await G(() => window.gabarit.st.pick?.kind) === "edges" && (await G(() => window.gabarit.doc.features[1].edges.length)) === 0, "le choix des arêtes démarre, l’ancienne liste est vidée");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);

  // 3. Esquisse sans contour fermé : bouton « Ouvrir l'esquisse »
  await load([box, { id: "s1", type: "sketch", name: "Esquisse 1", plane: top, entities: [{ id: "e1", type: "path", pts: [["0", "0"], ["30", "0"], ["30", "20"]] }] },
    { id: "x1", type: "extrude", name: "Extrusion 1", sketch: "s1", mode: "add", dist: "10", dir: "normal" }]);
  await p.click("#tree .feat >> text=Extrusion 1"); await p.waitForSelector("#props .note.err");
  ok(/aucun contour fermé/.test(await txt("#props .note.err")) && !!(await p.$("#props .note.err [data-fix=sketch]")), "esquisse ouverte : bouton « Ouvrir l’esquisse »");
  await p.click("#props .note.err [data-fix=sketch]"); await p.waitForTimeout(500);
  ok(await G(() => window.gabarit.st.editSketch) === "s1", "l’esquisse s’ouvre");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);

  // 4. Saisie lente : le curseur reste dans le champ pendant que la pièce se recalcule
  await load([box]);
  await p.click("#tree .feat >> text=Boîte 1"); await p.waitForSelector("#props input[data-hk=a]");
  await p.click("#props input[data-hk=a]", { clickCount: 3 });
  for (const ch of "125") { await p.keyboard.type(ch); await p.waitForTimeout(900); }
  ok(await G(() => window.gabarit.doc.features[0].a) === "125", "taper lentement 1, 2, 5 donne 125 → " + await G(() => window.gabarit.doc.features[0].a));
  ok(await G(() => document.activeElement?.dataset?.hk) === "a", "le curseur est resté dans le champ");

  console.log("erreurs", JSON.stringify(logs));
  if (logs.length) fails++;
  console.log(fails ? "FLOW30 ÉCHECS " + fails : "FLOW30 OK");
  await b.close(); process.exit(fails ? 1 : 0);
})();
