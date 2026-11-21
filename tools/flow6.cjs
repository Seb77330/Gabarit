const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  await p.goto("http://localhost:8765/?mode=expert");
  const G = (fn, a) => p.evaluate(fn, a);
  await G(() => {
    const g = window.gabarit;
    g.addToLibrary({ version: 1, name: "Platine", material: "alu", params: [], features: [
      { id: "s1", type: "sketch", name: "S", plane: { kind: "std", name: "dessus", offset: "0" }, entities: [{ id: "a", type: "rect", cx: "0", cy: "0", w: "60", h: "40", r: "0", a: "0" }, { id: "b", type: "circle", cx: "10", cy: "0", d: "8" }] },
      { id: "x1", type: "extrude", name: "E", sketch: "s1", mode: "add", dir: "normal", dist: "6" }] });
    g.addToLibrary({ version: 1, name: "Axe", material: "acier", params: [], features: [
      { id: "s1", type: "sketch", name: "S", plane: { kind: "std", name: "face", offset: "0" }, entities: [{ id: "a", type: "circle", cx: "0", cy: "0", d: "8" }] },
      { id: "x1", type: "extrude", name: "E", sketch: "s1", mode: "add", dir: "normal", dist: "20" }] });
  });
  await p.click("text=Nouvel assemblage");
  await p.click(".tbtn[data-tool=insert]"); await p.click("#dlg >> text=Platine");
  await p.waitForFunction(() => window.gabarit.viewer.asm?.size === 1, null, { timeout: 60000 });
  await p.click(".tbtn[data-tool=insert]"); await p.click("#dlg >> text=Axe");
  await p.waitForFunction(() => window.gabarit.viewer.asm?.size === 2, null, { timeout: 60000 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: TMP + "/shots/40-asm-insert.png" });
  console.log("comps", JSON.stringify(await G(() => window.gabarit.doc.components.map((c) => [c.name, c.pos, c.rot, c.fixed]))));
  // synthétise des clics sur les faces
  const pick = (comp, test) => G(([comp, test]) => {
    const v = window.gabarit.viewer; const id = window.gabarit.doc.components[comp].id; const a = v.asm.get(id);
    const f = new Function("f", "return " + test);
    const k = Object.keys(a.data.faces).find((k) => a.data.faces[k] && f(a.data.faces[k]));
    if (k === undefined) return "none";
    v.pickMode.onPick({ comp: id, faceId: Number(k), info: a.data.faces[k], point: [0, 0, 0] }); return k;
  }, [comp, test]);
  // concentrique : axe (comp 1) dans le trou (comp 0)
  await p.click(".tbtn[data-tool=concentric]");
  console.log("pick", await pick(1, "!!f.cyl"), await pick(0, "!!f.cyl && f.r < 5"));
  console.log("after concentric", JSON.stringify(await G(() => window.gabarit.doc.components[1])).slice(-200));
  // coïncidence : face d'extrémité de l'axe sur la face du dessus de la platine
  await p.click(".tbtn[data-tool=coincident]");
  console.log("pick", await pick(1, "f.plane && f.n[1] < -0.9"), await pick(0, "f.plane && f.n[2] > 0.9"));
  const c1 = await G(() => window.gabarit.doc.components[1]);
  console.log("pin pos", JSON.stringify(c1.pos), JSON.stringify(c1.rot));
  await p.waitForTimeout(300);
  await p.screenshot({ path: TMP + "/shots/41-asm-mated.png" });
  // interférences : aucune attendue (axe Ø8 dans trou Ø8, posé sur la face)
  await p.click(".tbtn[data-tool=interf]");
  await p.waitForSelector("#dlg[open] >> text=Interférences", { timeout: 60000 });
  console.log("interf", await p.locator("#dlg .db").innerText());
  await p.click("#dlg >> text=Fermer");
  // inverser la coïncidence : l'axe traverse la platine -> interférence ? (trou même diamètre : non) ; on teste distance
  await p.click("#tree >> text=Coïncidence");
  await p.click("#props >> text=Inverser le sens");
  console.log("flipped pos", JSON.stringify(await G(() => window.gabarit.doc.components[1].pos)));
  await p.click(".tbtn[data-tool=bom]");
  console.log("bom", await p.locator("#dlg .db").innerText());
  await p.screenshot({ path: TMP + "/shots/42-asm-bom.png" });
  await p.click("#dlg >> text=Fermer");
  await p.click(".tbtn[data-tool=explode]"); await p.waitForTimeout(200);
  await p.screenshot({ path: TMP + "/shots/43-asm-explode.png" });
  await p.click(".tbtn[data-tool=explode]");
  // vrai clic souris dans la vue en mode mesure
  await p.click(".tbtn[data-tool=measure]");
  const vb = await p.locator("#view").boundingBox(); await p.mouse.click(vb.x + vb.width / 2, vb.y + vb.height / 2); await p.mouse.click(vb.x + vb.width / 2 + 30, vb.y + vb.height / 2 + 10);
  console.log("banner", await p.locator("#banner").innerText().catch(() => "?"));
  await p.keyboard.press("Escape");
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), (async () => { await p.click("[data-act=more]"); await p.click("#dlg .planes button >> nth=0"); })()]);
  const path = await dl.path(); const txt = require("fs").readFileSync(path, "utf8");
  console.log("step", dl.suggestedFilename(), txt.length, (txt.match(/MANIFOLD_SOLID_BREP/g) || []).length, "solids");
  // undo, puis rechargement de la page : l'assemblage revient
  await p.keyboard.press("Control+z"); await p.waitForTimeout(500);
  await p.reload(); await p.waitForFunction(() => window.gabarit.viewer.asm?.size === 2, null, { timeout: 90000 });
  console.log("reload ok", await G(() => window.gabarit.doc.kind));
  // retour à une pièce
  await p.click("#welcome >> text=Nouvelle pièce"); await p.click("#dlg .planes button >> nth=0");
  await p.waitForTimeout(500);
  console.log("part mode", await G(() => [window.gabarit.doc.kind, !!window.gabarit.viewer.asm, document.querySelectorAll(".tbtn").length]));
  await p.keyboard.press("Escape");
  await p.click("[data-act=lib]"); console.log("lib", await p.locator("#dlg .db").innerText());
  console.log("LOGS", logs.join("\n"));
  await b.close();
})();
