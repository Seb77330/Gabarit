// v1.3 : trous aux cotes d'une vis ou d'un insert.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(250); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(250); };
  const vol = () => G(() => window.gabarit.st.volume ?? window.gabarit.st.mass?.volume ?? null);
  const txt = async (sel) => (await p.locator(sel).innerText()).replace(/[  ]/g, " ");
  const hole = () => G(() => { const f = window.gabarit.doc.features.find((x) => x.type === "hole"); return f && { fit: f.fit, screw: f.screw, d: f.d, d2: f.d2, depth2: f.depth2, angle: f.angle, kind: f.kind }; });

  await p.goto("http://localhost:8765/?mode=expert");
  await p.waitForFunction(() => window.gabarit && window.gabarit.st);
  await p.click("#welcome >> text=Voir l’exemple").catch(() => {}); await p.waitForTimeout(300);
  await G(() => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Essai", material: "pla", params: [], features: [
    { id: "b1", type: "shape", kind: "box", name: "Boîte 1", mode: "add", a: "60", b: "40", h: "10", r: "0", x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0" },
    { id: "h1", type: "hole", name: "Perçage 1", plane: { kind: "std", name: "dessus", offset: "10" }, kind: "simple", d: "5", d2: "9", depth2: "3", angle: "90", depth: "10", through: true, points: [["0", "0"]] }] }); g.st.mesh = null; });
  await idle();
  await p.click("#tree .feat >> text=Perçage 1"); await p.waitForSelector("#holeUse");
  ok(await p.$eval("#holeUse", (e) => e.value) === "" && !(await p.$("#holeScrew")), "au départ : diamètre libre, pas de liste de vis");

  // passage d'une vis M3
  await p.selectOption("#holeUse", "pass"); await idle();
  let f = await hole(); ok(f.fit === "pass" && f.screw === "M3" && f.d === "3.4", "passage M3 : trou de 3,4 mm → " + JSON.stringify(f));
  ok(/La vis M3 passe librement dans un trou de 3,4 mm/.test(await txt("#holeNote")), "la note explique le diamètre");
  await p.selectOption("#holeScrew", "M5"); await idle();
  f = await hole(); ok(f.d === "5.5", "passage M5 : 5,5 mm");
  // tête cachée (lamage) puis tête conique
  await p.click("#props .seg >> text=Lamé"); await idle();
  f = await hole(); ok(f.kind === "lame" && f.d2 === "9" && f.depth2 === "5.2", "lamage M5 : logement de 9 × 5,2 mm → " + JSON.stringify(f));
  await p.click("#props .seg >> text=Fraisé"); await idle();
  f = await hole(); ok(f.kind === "fraise" && f.d2 === "11.2" && f.angle === "90", "fraisure M5 : 11,2 mm à 90° → " + JSON.stringify(f));
  ok(!Object.keys(await G(() => window.gabarit.st.errors)).length, "la pièce se calcule sans erreur");
  // insert à chaud
  await p.selectOption("#holeUse", "insert"); await idle();
  f = await hole(); ok(f.fit === "insert" && f.screw === "M5" && f.d === "6.4" && f.kind === "simple", "insert M5 : trou simple de 6,4 mm → " + JSON.stringify(f));
  const sizes = await p.$$eval("#holeScrew option", (l) => l.map((o) => o.value));
  ok(sizes.join(" ") === "M2 M3 M4 M5 M6", "inserts proposés : " + sizes.join(" "));
  ok(!(await p.$("#props .seg >> text=Lamé")), "pas de lamage pour un insert");
  ok(/Insert M5 en laiton : trou de 6,4 mm/.test(await txt("#holeNote")), "note de l’insert");
  await p.selectOption("#holeScrew", "M3"); await idle();
  f = await hole(); ok(f.d === "4", "insert M3 : 4 mm");
  await p.screenshot({ path: TMP + "/shots/v13-vis.png" });
  // vissage direct
  await p.selectOption("#holeUse", "tap"); await idle();
  f = await hole(); ok(f.d === "2.5" && /fait son filet dans un trou de 2,5 mm/.test(await txt("#holeNote")), "vissage direct M3 : 2,5 mm");
  // une cote tapée à la main rend le diamètre libre, sans perdre le curseur
  await p.fill("#props input[data-hk=d]", "7"); await idle();
  f = await hole(); ok(f.d === "7" && f.fit === "" && await p.$eval("#holeUse", (e) => e.value) === "" && !(await p.$("#holeScrew")) && !(await p.$("#holeNote")), "diamètre tapé : retour à « diamètre libre » → " + JSON.stringify(f));
  const act = await G(() => { const a = document.activeElement; return a ? a.tagName + ":" + (a.dataset.hk || a.id || a.className) : "rien"; });
  ok(act === "INPUT:d", "le curseur reste dans le champ → " + act);
  // annuler revient au trou pour vis
  await p.keyboard.press("Escape"); await idle();

  console.log("erreurs", JSON.stringify(logs));
  if (logs.length) fails++;
  console.log(fails ? "FLOW29 ÉCHECS " + fails : "FLOW29 OK");
  await b.close(); process.exit(fails ? 1 : 0);
})();
