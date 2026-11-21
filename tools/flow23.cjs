// v1.1 : modèles de départ, et réglages en mots simples dans le mode Simple.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(250); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(250); };
  await p.goto("http://localhost:8765/"); await p.waitForTimeout(600);
  ok(await p.locator("#welcome [data-starter]").count() === 4, "accueil : 4 modèles de départ");
  const want = { "porte-cles": ["Porte-clés", 3, [72, 22, 4.2]], boite: ["Boîte de rangement", 2, [90, 60, 35]], crochet: ["Crochet mural", 5, [26, 34.5, 70]], support: ["Support de téléphone", 4, [76, null, null]] };
  for (const [k, [name, n, dims]] of Object.entries(want)) {
    await G(() => { window.gabarit.st.mesh = null; });
    await p.click(`#welcome [data-starter=${k}]`); await idle();
    const r = await G(() => { const g = window.gabarit; const bb = g.st.mesh.bb; return { name: g.doc.name, n: g.doc.features.length, err: g.st.errors, vol: g.st.mesh.volume, d: [0, 1, 2].map((i) => Math.round((bb[1][i] - bb[0][i]) * 10) / 10), z0: bb[0][2], hidden: document.querySelector("#welcome").hidden }; });
    ok(r.name === name && r.n === n && !Object.keys(r.err).length && r.vol > 1000 && r.hidden, `modèle « ${name} » : ${n} étapes, aucune erreur, ${r.d.join(" × ")} mm`);
    ok(dims.every((v, i) => v === null || Math.abs(r.d[i] - v) < 0.2) && Math.abs(r.z0) < 0.01, `« ${name} » : taille attendue, posé sur le plateau`);
    if (k === "porte-cles") {
      // on change le prénom : la pièce suit
      await p.click("#tree >> text=Prénom"); await p.waitForTimeout(400);
      await p.fill("#props [data-k=txt]", "SEB"); await p.waitForTimeout(300); await idle();
      const v2 = await G(() => window.gabarit.st.mesh.volume);
      ok(Math.abs(v2 - r.vol) > 20 && !Object.keys(await G(() => window.gabarit.st.errors)).length, "porte-clés : le prénom se change dans le panneau, la pièce suit");
      await p.keyboard.press("Enter"); await p.waitForTimeout(300);
      await p.screenshot({ path: TMP + "/shots/v11-porte-cles.png" });
    }
    await p.reload(); await p.waitForTimeout(700);
  }
  // ---- mots simples ----
  await p.goto("http://localhost:8765/?mode=simple"); await p.waitForTimeout(600);
  await p.click("#welcome >> text=Nouvelle pièce"); await p.waitForTimeout(400);
  const doc = { version: 1, name: "Essai", material: "pla", params: [], features: [
    { id: "s1", type: "sketch", name: "Dessin 1", plane: { kind: "std", name: "dessus", offset: "0" }, entities: [{ id: "r", type: "rect", cx: "0", cy: "0", w: "40", h: "30", r: "0", a: "0" }] },
    { id: "e1", type: "extrude", name: "Volume 1", sketch: "s1", mode: "add", dir: "normal", dist: "10" },
    { id: "h1", type: "hole", name: "Trou 1", plane: { kind: "std", name: "dessus", offset: "10" }, kind: "lame", d: "5", d2: "9", depth2: "3", angle: "90", depth: "10", through: true, points: [["0", "0"]] }] };
  await G((doc) => { const g = window.gabarit; g.loadDoc(doc); g.st.mesh = null; }, doc); await idle();
  const labels = () => G(() => [...document.querySelectorAll("#props label, #props .seg button, #props .okbar .lbl")].map((e) => e.textContent.replace(/[\u00a0\u202f]/g, " ").trim()));
  await p.click("#tree >> text=Volume 1"); await p.waitForTimeout(400);
  let L = await labels();
  ok(L.includes("Volume") && L.includes("Dessin utilisé") && L.includes("De quel côté") && L.includes("D’un côté") && L.includes("Épaisseur") && !L.includes("Esquisse utilisée") && !L.includes("Sens"), "mode Simple, réglages d’un volume : « Dessin utilisé », « De quel côté », « Épaisseur »");
  await p.keyboard.press("Escape"); await p.click("#tree >> text=Trou 1"); await p.waitForTimeout(400);
  L = await labels();
  ok(L.includes("Trou") && L.includes("Forme du trou") && L.includes("Tête cachée") && L.includes("Diamètre du logement de la tête") && L.includes("Traverse toute la pièce"), "réglages d’un trou : « Forme du trou », « Tête cachée », « Diamètre du logement de la tête »");
  // les mêmes réglages en mode Expert gardent les mots du métier
  await p.click("#modeSw [data-mode=expert]"); await p.waitForTimeout(400);
  L = await labels();
  ok(L.includes("Perçage") && L.includes("Type de trou") && L.includes("Lamé") && L.includes("Diamètre du lamage") && L.includes("Traversant"), "mode Expert : les mots du métier reviennent (« Lamé », « Diamètre du lamage »)");
  await p.click("#modeSw [data-mode=simple]"); await p.waitForTimeout(300); await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  // un nouvel outil prend un nom simple
  await p.mouse.move(700, 500);
  await p.click(".tbtn[data-tool=fillet]"); await p.waitForTimeout(500);
  const nm = await G(() => window.gabarit.doc.features.at(-1).name);
  ok(nm === "Arrondi 1", "nouvelle étape nommée en mots simples : « " + nm + " »");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  // barre d'outils Simple : tout tient sur un écran de portable
  await p.setViewportSize({ width: 1280, height: 720 }); await p.waitForTimeout(400);
  const fit = await G(() => { const t = document.querySelector("#tools"); return [t.scrollWidth, t.clientWidth, [...t.querySelectorAll(".tbtn")].every((b) => b.getBoundingClientRect().right <= window.innerWidth + 0.5)]; });
  ok(fit[2] && fit[0] <= fit[1] + 1, "barre Simple (17 outils) : tout tient à 1280 px de large (" + fit.join(" ; ") + ")");
  await p.screenshot({ path: TMP + "/shots/v11-simple-1280.png" });
  await p.click("#modeSw [data-mode=expert]"); await p.waitForTimeout(400);
  const fit2 = await G(() => { const t = document.querySelector("#tools"); return [t.scrollWidth, t.clientWidth, [...t.querySelectorAll(".tbtn")].every((b) => b.getBoundingClientRect().right <= window.innerWidth + 0.5), t.querySelectorAll(".tbtn").length]; });
  ok(fit2[3] === 26 && (fit2[2] || fit2[0] > fit2[1]), "barre Expert (26 outils) à 1280 px : tout tient, ou la barre défile (" + fit2.join(" ; ") + ")");
  await p.screenshot({ path: TMP + "/shots/v11-expert-1280.png" });
  console.log("erreurs", logs);
  ok(!logs.length, "aucune erreur dans la console");
  console.log(fails ? "FLOW23 ÉCHEC" : "FLOW23 OK");
  await b.close(); process.exit(fails ? 1 : 0);
})();
