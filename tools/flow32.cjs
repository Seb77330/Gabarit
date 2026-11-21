// v1.3 : zones fermées par plusieurs traits (lignes séparées, trait qui coupe un contour).
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "ok : " : "ÉCHEC : ") + m + (x !== undefined ? " → " + JSON.stringify(x) : "")); if (!c) fails++; };
  const sk = (entities) => ({ id: "s1", type: "sketch", name: "Esquisse 1", plane: { kind: "std", name: "dessus", offset: "0" }, entities });
  const ex = (o = {}) => ({ id: "f1", type: "extrude", name: "Extrusion 1", sketch: "s1", mode: "add", dist: "10", dir: "normal", through: false, ...o });
  const line = (id, ...pts) => ({ id, type: "path", pts });
  const rect = (id, cx, cy, w, h) => ({ id, type: "rect", cx, cy, w, h, r: 0, a: 0 });
  const load = async (features) => {
    await p.evaluate((features) => { const g = window.gabarit; g.st.mesh = undefined; g.loadDoc({ version: 1, name: "Zones", material: "pla", params: [], features }); }, features);
    await p.waitForFunction(() => window.gabarit.st.mesh !== undefined && !window.gabarit.st.building, null, { timeout: 60000 }); await p.waitForTimeout(250);
    return p.evaluate(() => ({ v: window.gabarit.st.mesh?.volume ?? null, err: window.gabarit.st.errors?.f1 || null }));
  };
  await p.goto("http://localhost:8765/?mode=expert");
  await p.waitForFunction(() => window.gabarit && window.gabarit.st);
  await p.click("text=Nouvelle pièce"); await p.waitForTimeout(400); await p.evaluate(() => document.querySelector("#dlg")?.close());
  const near = (a, b, t = 1) => a !== null && Math.abs(a - b) < t;

  let r = await load([sk([line("a", [0, 0], [30, 0]), line("b", [30, 0], [30, 20]), line("c", [30, 20], [0, 20]), line("d", [0, 20], [0, 0])]), ex()]);
  ok(near(r.v, 6000), "quatre traits séparés qui se rejoignent : extrudés comme un contour", r);
  r = await load([sk([line("a", [0, 0], [30, 0], [30, 20], [0, 20]), line("d", [0, 20], [0, 0]), { id: "h", type: "circle", cx: 15, cy: 10, d: 8 }]), ex()]);
  ok(near(r.v, 6000 - Math.PI * 16 * 10), "contour en traits + cercle dedans : le cercle fait un trou", r);
  r = await load([sk([line("a", [0, 0], [30, 0], [30, 20], [0, 20]), line("d", [0, 19], [0, 0])]), ex()]);
  ok(r.v === null && /aucun contour fermé/.test(r.err || "") && /bouts libres/.test(r.err || ""), "contour pas fermé : message clair", r);
  r = await load([sk([rect("r", 0, 0, 40, 20), line("l", [0, -10], [0, 10])]), ex()]);
  ok(near(r.v, 8000), "rectangle + trait en travers, sans choix de zone : tout le rectangle", r);
  r = await load([sk([rect("r", 0, 0, 40, 20), line("l", [0, -10], [0, 10])]), ex({ regions: [[-5, 2]] })]);
  ok(near(r.v, 4000), "zone de gauche seule : la moitié", r);
  r = await load([sk([rect("r", 0, 0, 40, 20), line("l", [0, -10], [0, 10]), { id: "h", type: "circle", cx: -10, cy: 0, d: 8 }]), ex({ regions: [[-5, 8]] })]);
  ok(near(r.v, 4000 - Math.PI * 16 * 10), "zone de gauche avec un cercle dedans : trou gardé", r);
  r = await load([sk([rect("r", 0, 0, 40, 20), line("l", [0, -10], [0, 10]), { id: "h", type: "circle", cx: -10, cy: 0, d: 8 }]), ex({ regions: [[-5, 8], [-10, 0]] })]);
  ok(near(r.v, 4000), "zone de gauche + le disque : moitié pleine", r);
  r = await load([sk([{ id: "c", type: "circle", cx: 0, cy: 0, d: 20 }, line("l", [-15, 5], [15, 5])]), ex({ regions: [[0, 8]] })]);
  ok(near(r.v, (100 * Math.acos(0.5) - 5 * Math.sqrt(75)) * 10, 0.5), "calotte d'un cercle coupé par une corde : volume exact", r);
  r = await load([sk([rect("r", 0, 0, 40, 20), line("l", [-10, 10], [-10, 16], [10, 16], [10, 10])]), ex({ regions: [[0, 0], [0, 13]] })]);
  ok(near(r.v, 8000 + 20 * 6 * 10), "rectangle + patte fermée par trois traits : les deux zones", r);
  r = await load([sk([{ id: "e", type: "ellipse", cx: 0, cy: 0, rx: 20, ry: 10, a: 0 }, line("l", [0, -15], [0, 15])]), ex({ regions: [[5, 0]] })]);
  ok(near(r.v, Math.PI * 200 * 10 / 2, 8), "demi-ellipse (bord en petits segments)", r);

  // dans l'application : le choix des zones est proposé tout seul
  await load([sk([rect("r", 0, 0, 40, 20), line("l", [0, -10], [0, 10])])]);
  await p.click("#tree >> text=Esquisse 1"); await p.waitForTimeout(200);
  await p.click(".tbtn[data-tool=extrude]");
  await p.waitForFunction(() => window.gabarit.st.pick?.kind === "regions" && window.gabarit.st.regions?.length, null, { timeout: 30000 });
  ok(await p.evaluate(() => window.gabarit.st.regions.length) === 2, "extruder : 2 zones proposées");
  await p.evaluate(() => window.gabarit.viewer.fit([0, 0, 1])); await p.waitForTimeout(400);
  const W = (w) => p.evaluate((w) => { const v = window.gabarit.viewer; const r = v.renderer.domElement.getBoundingClientRect(); const P = new v.camera.position.constructor(...w).project(v.camera); return [r.left + (P.x + 1) / 2 * r.width, r.top + (1 - P.y) / 2 * r.height]; }, w);
  const [x, y] = await W([10, 0, 0]); await p.mouse.click(x, y); await p.waitForTimeout(300);
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 60000 }); await p.waitForTimeout(600);
  const v = await p.evaluate(() => window.gabarit.st.mesh?.volume);
  ok(near(v, 4000), "clic sur la zone de droite : la moitié est extrudée", v);
  await p.evaluate(() => window.gabarit.viewer.fit([1, -1.3, 0.9])); await p.waitForTimeout(400);
  await p.screenshot({ path: TMP + "/shots/v13-zone-trait.png" });
  // quatre traits : pas de question, extrusion directe
  await load([sk([line("a", [0, 0], [30, 0]), line("b", [30, 0], [30, 20]), line("c", [30, 20], [0, 20]), line("d", [0, 20], [0, 0])])]);
  await p.click("#tree >> text=Esquisse 1"); await p.waitForTimeout(200);
  await p.click(".tbtn[data-tool=extrude]");
  await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 60000 }); await p.waitForTimeout(600);
  ok(await p.evaluate(() => window.gabarit.st.pick?.kind !== "regions" && Math.abs(window.gabarit.st.mesh.volume - 6000) < 1), "contour en quatre traits : extrudé sans rien demander");
  console.log("erreurs", JSON.stringify(logs));
  console.log(fails || logs.length ? `FLOW32 ÉCHECS ${fails}` : "FLOW32 OK");
  await b.close(); process.exit(fails || logs.length ? 1 : 0);
})();
