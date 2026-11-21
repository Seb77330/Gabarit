// v1.3 : contrôles d'impression (plateau, supports, ponts, parois fines).
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(250); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(250); };
  const box = (id, a, b2, h, x, y, z) => ({ id, type: "shape", kind: "box", name: "Boîte " + id, mode: "add", a: String(a), b: String(b2), h: String(h), r: "0", x: String(x), y: String(y), z: String(z), rx: "0", ry: "0", rz: "0" });
  const chips = async () => Object.fromEntries(await p.$$eval("#printbar .pchk", (l) => l.map((e) => [e.dataset.chk, { ok: e.classList.contains("ok"), text: e.innerText.replace(/[  ]/g, " ").replace(/^[✓!]\s*/, "") }])));
  const openPrint = async () => { if (!(await p.$("#printbar"))) { await p.click(".tbtn[data-tool=print]"); await p.waitForSelector("#printbar .pchk"); } await p.waitForTimeout(300); };
  const load = async (features) => { await G((features) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Essai", material: "pla", params: [], features }); g.st.mesh = null; }, features); await idle(); await openPrint(); };

  await p.goto("http://localhost:8765/?mode=expert");
  await p.waitForFunction(() => window.gabarit && window.gabarit.st);
  await p.evaluate(() => { localStorage.removeItem("gabarit-printer"); });
  await p.click("#welcome [data-act=example], #welcome >> text=Voir l’exemple").catch(() => {});
  await p.waitForTimeout(300);

  // 1. Une boîte simple : tout va bien
  await load([box("b1", 60, 40, 20, 0, 0, 0)]);
  let c = await chips(); console.log(JSON.stringify(c));
  ok(c.plateau?.ok && /tient \(marge de 196 mm\)/.test(c.plateau.text), "boîte 60 × 40 : tient sur le plateau 256, marge 196 mm");
  ok(c.supports?.ok && c.parois?.ok && !c.ponts, "boîte : pas de support, pas de paroi fine, pas de pont");
  ok(await G(() => !!window.gabarit.viewer.plate), "le contour du plateau est dessiné");

  // 2. Imprimante plus petite, puis taille libre
  await p.selectOption("#printSel", "a1mini"); await p.waitForTimeout(200);
  c = await chips(); ok(/marge de 120 mm/.test(c.plateau.text), "A1 mini (180) : marge 120 mm → " + c.plateau.text);
  await p.selectOption("#printSel", "autre"); await p.waitForTimeout(200);
  await p.fill("#printbar .pcustom [data-dim='0']", "50"); await p.press("#printbar .pcustom [data-dim='0']", "Tab"); await p.waitForTimeout(250);
  c = await chips(); ok(c.plateau.ok && /marge de 10 mm/.test(c.plateau.text), "plateau de 50 × 256 : la pièce tient dans l’autre sens → " + c.plateau.text);
  await p.fill("#printbar .pcustom [data-dim='1']", "50"); await p.press("#printbar .pcustom [data-dim='1']", "Tab"); await p.waitForTimeout(250);
  c = await chips(); ok(!c.plateau.ok && /dépasse \(60 × 40 mm pour 50 × 50\)/.test(c.plateau.text), "plateau de 50 × 50 : la pièce dépasse → " + c.plateau.text);
  ok(await G(() => window.gabarit.viewer.plate.children[0].material.color.getHex() === 0xdb403a), "le plateau trop petit est dessiné en rouge");
  await p.selectOption("#printSel", "bambu"); await p.waitForTimeout(200);
  ok(JSON.parse(await G(() => localStorage.getItem("gabarit-printer"))).key === "bambu", "l’imprimante choisie est retenue");

  // 3. Longue barre : tient seulement en diagonale
  await load([box("b1", 300, 20, 10, 0, 0, 0)]);
  c = await chips(); ok(c.plateau.ok && /en la tournant de 45°/.test(c.plateau.text), "barre de 300 mm : tient en la tournant → " + c.plateau.text);
  ok(Math.abs(await G(() => window.gabarit.viewer.plate.rotation.z) - Math.PI / 4) < 0.02, "le plateau est dessiné tourné de 45°");

  // 4. Paroi fine : mur de 0,5 mm
  await load([box("b1", 60, 40, 3, 0, 0, 0), box("b2", 60, 0.5, 20, 0, 0, 3)]);
  c = await chips(); console.log(JSON.stringify(c));
  ok(!c.parois.ok && /le plus fin : 0,5 mm, il faut 0,8 mm/.test(c.parois.text), "mur de 0,5 mm signalé → " + c.parois.text);
  let n = await G(() => { const col = window.gabarit.viewer.geo.getAttribute("color").array; let k = 0; for (let i = 0; i < col.length; i += 3) if (Math.abs(col[i] - 0.62) < 0.01 && Math.abs(col[i + 2] - 0.86) < 0.01) k++; return k; });
  ok(n >= 6, "la paroi fine est peinte en violet (" + n + " sommets)");
  await p.screenshot({ path: TMP + "/shots/v13-parois.png" });
  await p.selectOption("#printNozzle", "0.2"); await p.waitForTimeout(250);
  c = await chips(); ok(c.parois.ok, "avec une buse de 0,2 mm, le mur de 0,5 mm passe");
  await p.selectOption("#printNozzle", "0.4"); await p.waitForTimeout(200);

  // 5. Pont de 40 mm entre deux piliers
  await load([box("p1", 10, 10, 20, -25, 0, 0), box("p2", 10, 10, 20, 25, 0, 0), box("t", 60, 10, 3, 0, 0, 20)]);
  c = await chips(); console.log(JSON.stringify(c));
  ok(c.ponts && !c.ponts.ok && /pont de 40 mm est trop long \(maximum 30 mm\)/.test(c.ponts.text), "pont de 40 mm trop long pour 30 → " + c.ponts?.text);
  ok(!c.supports.ok && /Supports : 4 cm²/.test(c.supports.text), "4 cm² à soutenir → " + c.supports.text);
  await p.selectOption("#printBridge", "50"); await p.waitForTimeout(250);
  c = await chips(); ok(c.ponts?.ok && /le plus long fait 40 mm/.test(c.ponts.text) && c.supports.ok, "avec 50 mm de pont maxi, ça passe sans support → " + c.ponts?.text);
  n = await G(() => { const col = window.gabarit.viewer.geo.getAttribute("color").array; let k = 0; for (let i = 0; i < col.length; i += 3) if (Math.abs(col[i] - 0.27) < 0.01 && Math.abs(col[i + 2] - 0.87) < 0.01) k++; return k; });
  ok(n >= 3, "le pont est peint en bleu (" + n + " sommets)");
  await p.screenshot({ path: TMP + "/shots/v13-pont.png" });
  await p.selectOption("#printBridge", "30"); await p.waitForTimeout(200);

  // 6. Porte-à-faux : pas un pont, il faut un support
  await load([box("p1", 10, 10, 20, -25, 0, 0), box("t", 60, 10, 3, 0, 0, 20)]);
  c = await chips(); ok(!c.ponts && !c.supports.ok && /Supports : 5 cm²/.test(c.supports.text), "porte-à-faux : 5 cm² à soutenir, pas de pont → " + c.supports.text);

  // 7. Petit trou horizontal : pas de support
  await load([box("b1", 40, 20, 30, 0, 0, 0), { id: "c1", type: "shape", kind: "cyl", name: "Cylindre 1", mode: "cut", d: "6", h: "40", x: "0", y: "-20", z: "15", rx: "-90", ry: "0", rz: "0" }]);
  c = await chips(); console.log(JSON.stringify(c), await G(() => window.gabarit.st.mesh.bb));
  ok(c.supports.ok, "trou horizontal de 6 mm : pas de support → " + c.supports.text);

  // 8. La pièce change, le contrôle suit ; fermeture
  await G(() => { const g = window.gabarit; g.doc.features[0].h = "300"; g.st.mesh = null; g.rebuild(); }); await idle(); await p.waitForTimeout(300);
  c = await chips(); ok(!c.plateau.ok && /trop haute \(300 mm pour 256\)/.test(c.plateau.text), "la pièce grandit : le contrôle se met à jour → " + c.plateau.text);
  await p.click("#printbar >> text=Fermer"); await p.waitForTimeout(200);
  ok(!(await p.$("#printbar")) && await G(() => !window.gabarit.viewer.plate), "fermeture : le plateau disparaît");

  console.log("erreurs", JSON.stringify(logs));
  if (logs.length) fails++;
  console.log(fails ? "FLOW28 ÉCHECS " + fails : "FLOW28 OK");
  await b.close(); process.exit(fails ? 1 : 0);
})();
