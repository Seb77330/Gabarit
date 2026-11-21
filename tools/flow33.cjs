// v1.3 : esquisse — zones colorées, bouts libres, outils Ajuster et Congé.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "ok : " : "ÉCHEC : ") + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); if (!c) fails++; };
  const near = (a, b, t = 1) => typeof a === "number" && Math.abs(a - b) < t;
  const sk = (entities, constraints = []) => ({ id: "s1", type: "sketch", name: "Esquisse 1", plane: { kind: "std", name: "dessus", offset: "0" }, entities, constraints });
  const ex = { id: "f1", type: "extrude", name: "Extrusion 1", sketch: "s1", mode: "add", dist: "10", dir: "normal", through: false };
  const line = (id, ...pts) => ({ id, type: "path", pts });
  const idle = async () => { await p.waitForFunction(() => window.gabarit.st.mesh !== undefined && !window.gabarit.st.building, null, { timeout: 60000 }); await p.waitForTimeout(250); };
  const load = async (features) => { await p.evaluate((features) => { const g = window.gabarit; g.st.mesh = undefined; g.loadDoc({ version: 1, name: "Esquisse", material: "pla", params: [], features }); }, features); await idle(); };
  const open = async () => { await p.evaluate(() => window.gabarit.openSketch("s1")); await p.waitForTimeout(700); await p.evaluate(() => { const s = window.gabarit.sketcher; s.fitView(); s.zoom *= 0.7; s.render(); }); await p.waitForTimeout(150); };
  const close = async () => { await p.evaluate(() => window.gabarit.sketcher.setTool("select")); await p.click("#corner .ok"); await idle(); };
  const S = (w) => p.evaluate((w) => { const s = window.gabarit.sketcher; const r = s.svg.getBoundingClientRect(); const q = s.toS(w); return [r.left + q[0], r.top + q[1]]; }, w);
  const hover = async (w) => { const [x, y] = await S(w); await p.mouse.move(x - 3, y - 2); await p.mouse.move(x, y); await p.waitForTimeout(80); };
  const click = async (w) => { await hover(w); const [x, y] = await S(w); await p.mouse.click(x, y); await p.waitForTimeout(150); };
  const ents = () => p.evaluate(() => window.gabarit.doc.features.find((f) => f.id === "s1").entities);
  const cons = () => p.evaluate(() => window.gabarit.doc.features.find((f) => f.id === "s1").constraints || []);
  const count = (sel) => p.locator(sel).count();
  const vol = () => p.evaluate(() => window.gabarit.st.mesh?.volume ?? null);
  const toastTxt = async () => (await p.locator("#toast").innerText().catch(() => "")).replace(/[  ]/g, " ");
  const tool = async (k) => { await p.click(`#skTools [data-sk=${k}]`); await p.waitForTimeout(120); };

  await p.goto("http://localhost:8765/?mode=expert");
  await p.waitForFunction(() => window.gabarit && window.gabarit.st);
  await p.click("text=Nouvelle pièce"); await p.waitForTimeout(400); await p.evaluate(() => document.querySelector("#dlg")?.close());

  // ---- zones colorées et bouts libres ----
  await load([sk([line("a", [0, 0], [30, 0], [30, 20], [0, 20]), line("d", [0, 15], [0, 0])])]);
  await open();
  ok(await count("#skSvg .zone") === 0 && await count("#skSvg .free-end") === 2, "contour pas fermé : pas de zone colorée, deux bouts libres entourés", [await count("#skSvg .zone"), await count("#skSvg .free-end")]);
  await p.screenshot({ path: TMP + "/shots/v13-bouts-libres.png" });
  await p.evaluate(() => window.gabarit.sketcher.api.drag({ e: "d", k: 0 }, [0, 20])); await p.waitForTimeout(200);
  ok(await count("#skSvg .zone") === 1 && await count("#skSvg .free-end") === 0, "bout ramené sur l’autre trait : la zone se colore, plus de bout libre", [await count("#skSvg .zone"), await count("#skSvg .free-end")]);
  await close();

  // ---- Ajuster ----
  await load([sk([{ id: "r", type: "rect", cx: 0, cy: 0, w: 40, h: 20, r: 0, a: 0 }, line("l", [0, -15], [0, 15])]), ex]);
  await open(); await tool("trim");
  ok(/morceau\sen\srouge/.test((await p.locator("#skHint").innerText()).replace(/[  ]/g, " ")), "Ajuster : l’aide explique le morceau en rouge");
  await hover([0, 13]);
  ok(await count("#skSvg .trim-hot") === 1, "survol : le morceau qui dépasse est en rouge");
  await p.screenshot({ path: TMP + "/shots/v13-ajuster.png" });
  await click([0, 13]); await click([0, -13]);
  let E = await ents(); let L = E.find((x) => x.type === "path");
  ok(E.length === 2 && L && L.pts.length === 2 && L.pts[0][1] === -10 && L.pts[1][1] === 10, "les deux bouts qui dépassent sont coupés au bord du rectangle", L?.pts);
  await click([-10, 10]);
  E = await ents();
  ok(E.length === 2 && E.every((x) => x.type === "path") && E.some((x) => x.pts.length === 4), "moitié gauche du rectangle retirée : il reste un trait en U et le trait du milieu", E.map((x) => x.pts));
  ok(await count("#skSvg .zone") === 1 && await count("#skSvg .free-end") === 0, "la moitié droite forme une zone fermée");
  await close();
  ok(near(await vol(), 4000), "extrusion de ce qui reste : 20 × 20 × 10", await vol());

  // cercle coupé par une corde : il reste un arc exact
  await load([sk([{ id: "c", type: "circle", cx: 0, cy: 0, d: 20 }, line("l", [-15, 5], [15, 5])]), ex]);
  await open(); await tool("trim");
  await click([0, 10]); await click([-12, 5]); await click([12, 5]);
  E = await ents(); const arc = E.find((x) => x.pts.some((q) => q[2]));
  ok(E.length === 2 && arc && arc.pts.length === 2 && near(Math.abs(arc.pts[0][2]), 15, 1e-6), "calotte et bouts coupés : un seul arc (flèche 15 mm) et la corde", E.map((x) => x.pts));
  await close();
  ok(near(await vol(), (Math.PI * 100 - (100 * Math.acos(0.5) - 5 * Math.sqrt(75))) * 10, 0.5), "volume exact du disque sans sa calotte", await vol());

  // trait isolé : retiré en entier
  await load([sk([{ id: "r", type: "rect", cx: 0, cy: 0, w: 40, h: 20, r: 0, a: 0 }, line("l", [30, -5], [40, 5])], [{ id: "k1", type: "length", refs: [{ e: "l", k: 0 }], value: "14.142" }])]);
  await open(); await tool("trim"); await click([35, 0]);
  E = await ents();
  ok(E.length === 1 && E[0].type === "rect" && (await cons()).length === 0, "trait qui ne croise rien : retiré en entier, avec sa contrainte", E.map((x) => x.type));
  ok(/contraintes/.test(await toastTxt()), "message : les contraintes du trait ont été retirées", await toastTxt());
  await p.keyboard.press("Control+z"); await p.waitForTimeout(300);
  ok((await ents()).length === 2 && (await cons()).length === 1, "Ctrl+Z : le trait et sa contrainte reviennent");
  await close();

  // ---- Congé ----
  await load([sk([{ id: "q", type: "poly", pts: [[0, 0], [30, 0], [30, 20], [0, 20]], r: 0 }], [{ id: "k1", type: "horizontal", refs: [{ e: "q", k: 0 }] }, { id: "k2", type: "vertical", refs: [{ e: "q", k: 1 }] }]), ex]);
  await open(); await tool("fillet");
  ok(await p.locator("#filletR").inputValue() === "2", "Congé : rayon proposé à gauche (2 mm)");
  await p.fill("#filletR", "4");
  await hover([30, 0]);
  ok(await count("#skSvg .corner-hot") === 1, "survol : le coin visé est entouré");
  await click([30, 0]);
  E = await ents();
  ok(E[0].pts[1][3] === 4 && E[0].pts.length === 4 && (await cons()).length === 2, "coin arrondi : le rayon est porté par le point, les contraintes restent", E[0].pts);
  await p.screenshot({ path: TMP + "/shots/v13-conge.png" });
  ok(await p.locator("#props [data-rc='1']").inputValue() === "4", "le rayon du coin se retrouve dans la liste des points");
  await p.evaluate(() => window.gabarit.sketcher.setTool("fillet")); await p.fill("#filletR", "50"); await click([30, 20]);
  ok(/Rayon trop grand/.test(await toastTxt()) && (await ents())[0].pts[2][3] === undefined, "rayon trop grand : refusé avec le maximum possible", await toastTxt());
  await p.evaluate(() => window.gabarit.sketcher.api.drag({ e: "q", k: 1 }, [32, 0])); await p.waitForTimeout(200);
  E = await ents();
  ok(E[0].pts[1][3] === 4, "déplacer le point garde son rayon", E[0].pts[1]);
  await p.evaluate(() => window.gabarit.sketcher.api.drag({ e: "q", k: 1 }, [30, 0])); await p.waitForTimeout(200);
  await close();
  ok(near(await vol(), (600 - (16 - Math.PI * 4)) * 10, 0.5), "extrusion avec un coin arrondi de 4 mm : volume exact", await vol());
  await open(); await tool("fillet"); await p.fill("#filletR", "0"); await click([30, 0]);
  ok((await ents())[0].pts[1][3] === undefined, "rayon 0 : le coin redevient vif", (await ents())[0].pts[1]);
  await close();
  ok(near(await vol(), 6000, 0.5), "volume revenu à 30 × 20 × 10", await vol());

  // coin d'un rectangle : il devient un contour à points
  await load([sk([{ id: "r", type: "rect", cx: 0, cy: 0, w: 40, h: 20, r: 0, a: 0 }]), ex]);
  await open(); await tool("fillet"); await p.fill("#filletR", "5"); await click([20, 10]);
  E = await ents();
  ok(E.length === 1 && E[0].type === "poly" && E[0].pts.length === 4 && E[0].pts.filter((q) => q[3] === 5).length === 1 && (await cons()).length === 4, "rectangle : un seul coin arrondi, côtés gardés horizontaux et verticaux", [E[0].pts, (await cons()).map((c) => c.type)]);
  await close();
  ok(near(await vol(), (800 - (25 - Math.PI * 25 / 4)) * 10, 0.5), "rectangle avec un coin de 5 mm : volume exact", await vol());

  // deux traits séparés qui se touchent par un bout : réunis et arrondis
  await load([sk([line("a", [0, 0], [30, 0]), line("b", [30, 20], [30, 0])])]);
  await open(); await tool("fillet"); await p.fill("#filletR", "3"); await click([30, 0]);
  E = await ents();
  ok(E.length === 1 && E[0].type === "path" && E[0].pts.length === 3 && E[0].pts[1][3] === 3, "deux traits bout à bout : réunis en un seul, coin arrondi", E.map((x) => x.pts));
  await click([0, 0]);
  ok(/ne touche aucun autre trait/.test(await toastTxt()), "bout libre : pas de coin, message clair", await toastTxt());
  await close();

  // ---- accroche sur un trait : la ligne se pose sur le cercle et ferme deux zones ----
  await load([sk([{ id: "c", type: "circle", cx: 0, cy: 0, d: 20 }])]);
  await open(); await tool("line");
  await click([7.25, 7.02]); await click([-7.25, 7.02]); await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  E = await ents(); L = E.find((x) => x.type === "path");
  ok(L && L.pts.length === 2 && near(Math.hypot(L.pts[0][0], L.pts[0][1]), 10, 0.001) && near(Math.hypot(L.pts[1][0], L.pts[1][1]), 10, 0.001) && L.pts[0][1] === 7, "ligne tracée près du cercle : ses deux bouts se posent dessus (sur la grille en Y)", L?.pts);
  ok(await count("#skSvg .free-end") === 0, "aucun bout libre : la ligne touche vraiment le cercle");
  await close();
  await p.click(".tbtn[data-tool=extrude]");
  await p.waitForFunction(() => window.gabarit.st.pick?.kind === "regions" && window.gabarit.st.regions?.length, null, { timeout: 30000 });
  ok(await p.evaluate(() => window.gabarit.st.regions.length) === 2, "extruder : les deux zones du cercle coupé sont proposées");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);

  console.log("erreurs", JSON.stringify(logs));
  console.log(fails || logs.length ? `FLOW33 ÉCHECS ${fails}` : "FLOW33 OK");
  await b.close(); process.exit(fails || logs.length ? 1 : 0);
})();
