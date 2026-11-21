// v1.3 : Échap annule un calcul long et revient à la dernière version calculée.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const built = async () => { await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(300); };
  const txt = async (sel) => (await p.locator(sel).innerText()).replace(/[  ]/g, " ");
  const cyl = { id: "c1", type: "shape", kind: "cyl", name: "Cylindre 1", mode: "add", d: "10", h: "160", x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0" };
  const thread = (pitch, len) => ({ id: "t1", type: "thread", name: "Filetage 1", face: [5, 0, 80], kind: "ext", pitch: String(pitch), len: String(len) });

  await p.goto("http://localhost:8765/?mode=expert");
  await p.waitForFunction(() => window.gabarit && window.gabarit.st);
  await p.click("#welcome >> text=Voir l’exemple").catch(() => {}); await p.waitForTimeout(300);

  // 1. Pièce rapide, puis une modification qui lance un calcul très long
  await G((features) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Essai", material: "pla", params: [], features }); g.st.mesh = null; }, [cyl, thread(2, 6)]);
  await built();
  ok(!Object.keys(await G(() => window.gabarit.st.errors)).length, "filetage court : calculé sans erreur");
  const vol0 = await G(() => window.gabarit.st.mesh.volume);
  await p.click("#tree .feat >> text=Filetage 1"); await p.waitForSelector("#props input[data-hk=len]");
  await p.fill("#props input[data-hk=pitch]", "0.4"); await p.fill("#props input[data-hk=len]", "150");
  await p.waitForFunction(() => window.gabarit.st.building, null, { timeout: 10000 });
  await p.waitForTimeout(3200);
  ok(await G(() => window.gabarit.st.building), "le calcul long est toujours en cours après 3 s");
  ok(/Échap pour l’annuler/.test(await txt("#busy")), "la pastille propose Échap → " + await txt("#busy"));
  await p.screenshot({ path: TMP + "/shots/v13-calcul-long.png" });
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  let f = await G(() => { const t = window.gabarit.doc.features[1]; return { pitch: t.pitch, len: t.len, sel: window.gabarit.st.sel }; });
  ok(f.pitch === "2" && f.len === "6", "Échap : retour aux valeurs calculées (pas 2, longueur 6) → " + JSON.stringify(f));
  ok(f.sel === "t1", "l’étape reste ouverte (Échap n’a annulé que le calcul)");
  await built();
  ok(Math.abs(await G(() => window.gabarit.st.mesh.volume) - vol0) < 1e-3 && !Object.keys(await G(() => window.gabarit.st.errors)).length, "le moteur 3D est relancé et la pièce est de nouveau calculée");
  // la modification annulée reste dans l'historique
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  await p.keyboard.press("Control+z"); await p.waitForTimeout(400);
  f = await G(() => { const t = window.gabarit.doc.features[1]; return { pitch: t.pitch, len: t.len }; });
  ok(f.pitch === "0.4" && f.len === "150", "Ctrl+Z retrouve la modification annulée → " + JSON.stringify(f));
  await p.waitForTimeout(2000); await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  await built();

  // 2. Un fichier ouvert dont le premier calcul est trop long : rien à quoi revenir, le calcul s'arrête simplement
  await G((features) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Long", material: "pla", params: [], features }); g.st.mesh = null; }, [cyl, thread(0.4, 150)]);
  await p.waitForFunction(() => window.gabarit.st.building, null, { timeout: 10000 }); await p.waitForTimeout(2000);
  await p.keyboard.press("Escape"); await p.waitForTimeout(500);
  ok(!(await G(() => window.gabarit.st.building)) && (await G(() => window.gabarit.doc.features[1].len)) === "150", "premier calcul annulé : la pièce reste telle quelle");
  await p.waitForFunction(() => document.querySelector("#busy").hidden, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  ok(!(await G(() => window.gabarit.st.building)) && !(await G(() => window.gabarit.st.mesh)), "le moteur est relancé sans recalculer tout seul");
  // mettre l'étape en pause relance le calcul
  await G(() => { const g = window.gabarit; g.doc.features[1].suppressed = true; g.rebuild(); });
  await built();
  ok(Math.abs(await G(() => window.gabarit.st.mesh.volume) - Math.PI * 25 * 160) < 60, "étape en pause : le cylindre est calculé");

  console.log("erreurs", JSON.stringify(logs));
  if (logs.length) fails++;
  console.log(fails ? "FLOW31 ÉCHECS " + fails : "FLOW31 OK");
  await b.close(); process.exit(fails ? 1 : 0);
})();
