// v1.2 : mini-défis guidés (mode Simple).
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(400); };
  const coach = async () => (await p.locator("#coach").innerText().catch(() => "")).replace(/[  ]/g, " ");
  const step = () => G(() => Number(document.querySelector("#coach")?.dataset.step ?? -1));
  const scr = (w) => G((w) => { const v = window.gabarit.viewer; const r = v.renderer.domElement.getBoundingClientRect(); const q = new v.camera.position.constructor(...w).project(v.camera); return [r.left + (q.x + 1) / 2 * r.width, r.top + (1 - q.y) / 2 * r.height]; }, w);
  const setHk = async (key, val) => { const i = p.locator(`#props [data-hk="${key}"]`); await i.fill(String(val)); await p.waitForTimeout(150); };
  await p.goto("http://localhost:8765/?mode=expert");
  await p.waitForSelector("#welcome .defis");
  const cards = (await p.locator("#welcome [data-defi]").allInnerTexts()).map((t) => t.replace(/\u2060/g, ""));
  ok(cards.length === 3 && /porte-clés/.test(cards[0]) && /boîte/i.test(cards[1]) && /prénom/.test(cards[2]), "accueil : 3 mini-défis proposés");
  await p.screenshot({ path: "/tmp/claude-0/shots/v12-accueil.png" });

  // ---- défi 1, joué en entier à la souris et au clavier ----
  await p.click('#welcome [data-defi="porte-cles"]'); await p.waitForTimeout(800);
  ok(await G(() => document.body.classList.contains("simple")), "un défi passe en mode Simple");
  let t = await coach();
  ok(/Défi : Mon premier porte-clés/.test(t) && /Étape 1 sur 5/.test(t) && /Formes prêtes/.test(t), "carte du défi : étape 1 sur 5");
  ok(await G(() => window.gabarit.doc.name) === "Mon premier porte-clés", "la pièce porte le nom du défi");
  await p.click('#coach [data-defi="show"]'); await p.waitForSelector("#shapes [data-shape=box]");
  ok(true, "« Montre-moi » ouvre les formes prêtes");
  await p.click("#shapes [data-shape=box]"); await idle();
  ok(await step() === 1, "boîte posée : étape 2");
  await setHk("a", 60); await setHk("b", 20); await setHk("h", 3); await idle();
  ok(await step() === 1, "tailles tapées mais pas encore validées : on reste à l’étape 2");
  await p.screenshot({ path: "/tmp/claude-0/shots/v12-defi.png" });
  await p.locator('#props [data-hk="h"]').press("Enter"); await idle();
  ok(await step() === 2 && /cylindre/.test(await coach()), "Entrée : étape 3 (le trou)");
  await p.click(".tbtn[data-tool=shapes]"); await p.click("#shapes [data-shape=cyl]"); await p.waitForTimeout(1200); await idle();
  ok(await step() === 2, "cylindre posé mais pas encore en « Creuser » : toujours l’étape 3");
  await p.click("#props [data-mode=cut]"); await p.waitForTimeout(500); await setHk("d", 5); await idle();
  ok(await step() === 3 && /Clique sur la plaque/.test(await coach()), "effet « Creuser » et diamètre 5 : étape 4");
  const [x, y] = await scr([-22, 0, 3]); await p.mouse.move(x, y); await p.mouse.click(x, y); await p.waitForTimeout(600); await idle();
  ok(await step() === 3, "trou posé, pas encore validé");
  await p.keyboard.press("Enter"); await idle(); await p.waitForTimeout(600);
  const vol = await G(() => window.gabarit.st.mesh.volume);
  ok(await step() === 4 && vol < 3600 - 30, "Entrée : la plaque est percée (" + vol.toFixed(0) + " mm³), étape 5");
  ok(/Exporter STL/.test(await coach()), "dernière étape : exporter");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-act=stl]")]);
  await p.waitForTimeout(800);
  t = await coach();
  ok(/Bravo, défi réussi/.test(t) && await step() === 5, "export fait : « Bravo, défi réussi ! » (" + dl.suggestedFilename() + ")");
  ok(JSON.parse(await G(() => localStorage.getItem("gabarit-defis"))).includes("porte-cles"), "le défi est noté comme réussi");
  await p.screenshot({ path: "/tmp/claude-0/shots/v12-defi-bravo.png" });
  // la progression est gardée après une relance
  await p.goto("http://localhost:8765/"); await p.waitForTimeout(1500);
  await p.click("#welcome >> text=Continuer"); await p.waitForTimeout(800);
  ok(/Bravo, défi réussi/.test(await coach()), "après relance, la carte du défi est toujours là");
  await p.click('#coach [data-defi="keep"]'); await p.waitForTimeout(400);
  ok(!(await G(() => window.gabarit.doc.defi)) && !/Défi/.test(await coach()), "« Continuer cette pièce » ferme le défi");

  // ---- défis 2 et 3 : on vérifie que chaque étape se valide quand la pièce est dans le bon état ----
  const play = async (key, states) => {
    await G(() => window.gabarit.showWelcome()); await p.waitForSelector("#welcome [data-defi]");
    await p.click(`#welcome [data-defi="${key}"]`); await p.waitForTimeout(900); await idle();
    const seen = [await step()]; play.first = await G(() => window.gabarit.doc.features.map((f) => f.name).join());
    for (const feats of states) {
      await G((feats) => { const g = window.gabarit; const d = JSON.parse(JSON.stringify(g.doc)); d.features = typeof feats === "string" ? d.features : feats; if (feats === "export") d.defi.exported = true; g.loadDoc(d); }, feats);
      await p.waitForTimeout(600); await idle(); await p.waitForTimeout(500); seen.push(await step());
    }
    return seen;
  };
  const S = (id, kind, mode, o) => ({ id, type: "shape", kind, name: id, mode, x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0", ...o });
  const box = S("b1", "box", "add", { a: "80", b: "50", h: "30", r: "0" });
  let seen = await play("boite", [
    [S("b1", "box", "add", { a: "40", b: "30", h: "20", r: "0" })],
    [box],
    [box, { id: "k1", type: "shell", name: "Évidement 1", t: "5", faces: [[0, 0, 30, 0.5, 0.5, 1]] }],
    [box, { id: "k1", type: "shell", name: "Évidement 1", t: "2", faces: [[0, 0, 30, 0.5, 0.5, 1]] }],
    "export",
  ]);
  ok(seen.join() === "0,1,2,3,4,5", "défi « boîte de rangement » : les 5 étapes se valident dans l’ordre (" + seen.join() + ")");
  const plate = S("p1", "box", "add", { a: "70", b: "24", h: "4", r: "5" });
  const txt = (o) => S("t1", "text", o.mode, { txt: o.txt, s: "10", h: o.h || "3", x: "0", y: "0", z: "4", ry: o.mode === "cut" ? "180" : "0" });
  seen = await play("prenom", [
    [plate, txt({ mode: "add", txt: "Gabarit" })],
    [plate, txt({ mode: "cut", txt: "Gabarit" })],
    [plate, txt({ mode: "cut", txt: "Léa", h: "1" })],
    "export",
  ]);
  ok(seen.join() === "0,1,1,3,4", "défi « graver mon prénom » : la plaque est fournie, les étapes se valident (" + seen.join() + ")");
  ok(play.first === "Plaque", "le défi du prénom démarre avec sa plaque");
  await G(() => window.gabarit.showWelcome()); await p.waitForSelector("#welcome [data-defi]");
  const done = await p.locator("#welcome [data-defi].done").count();
  ok(done === 3, "accueil : les 3 défis sont marqués « Réussi »");
  console.log("erreurs", JSON.stringify(logs));
  ok(logs.length === 0, "aucune erreur dans la console");
  console.log(fails ? "FLOW27 ÉCHEC (" + fails + ")" : "FLOW27 OK");
  await b.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
