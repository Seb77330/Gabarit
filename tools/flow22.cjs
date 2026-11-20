// v1.1 : flèches à tirer dans la vue 3D (déplacer une forme, régler une épaisseur, déplacer une coupe).
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(250); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(250); };
  const load = async (features) => { await G((features) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Essai", material: "pla", params: [], features }); g.st.mesh = null; }, features); await idle(); };
  // point de l'écran sur la flèche « id », à la fraction t de sa longueur ; et sa direction à l'écran
  const arrow = (id, t = 0.6) => G(([id, t]) => {
    const v = window.gabarit.viewer; const g = v.handles.find((x) => x.userData.hd.id === id); if (!g) return null;
    const r = v.renderer.domElement.getBoundingClientRect();
    const scr = (w) => { const q = w.clone().project(v.camera); return [r.left + (q.x + 1) / 2 * r.width, r.top + (1 - q.y) / 2 * r.height]; };
    const o = g.getWorldPosition(g.position.clone()); const d = g.userData.dir;
    const a = scr(o.clone().addScaledVector(d, g.scale.x * t)), e = scr(o.clone().addScaledVector(d, g.scale.x * (t + 1)));
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
    return { at: a, dir: [(e[0] - a[0]) / L, (e[1] - a[1]) / L], pxPerMm: L / g.scale.x };
  }, [id, t]);
  // tire la flèche de « mm » millimètres (le long de son axe)
  const drag = async (id, mm, opts = {}) => {
    const a = await arrow(id); const px = mm * a.pxPerMm;
    await p.mouse.move(a.at[0], a.at[1]); await p.waitForTimeout(120);
    if (opts.shift) await p.keyboard.down("Shift");
    await p.mouse.down();
    for (let i = 1; i <= 8; i++) { await p.mouse.move(a.at[0] + a.dir[0] * px * i / 8, a.at[1] + a.dir[1] * px * i / 8); await p.waitForTimeout(40); }
    if (opts.peek) await opts.peek();
    await p.mouse.up(); if (opts.shift) await p.keyboard.up("Shift");
    await idle();
  };
  await p.goto("http://localhost:8765/?mode=simple");
  await p.click("#welcome >> text=Nouvelle pièce"); await p.waitForTimeout(400);

  // ---- déplacer une forme prête ----
  const box = { id: "b1", type: "shape", kind: "box", name: "Boîte 1", mode: "add", a: "60", b: "30", h: "20", r: "0", x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0" };
  const cyl = { id: "c1", type: "shape", kind: "cyl", name: "Cylindre 1", mode: "add", d: "16", h: "25", x: "0", y: "0", z: "20", rx: "0", ry: "0", rz: "0" };
  await load([box, cyl]);
  ok(await G(() => window.gabarit.viewer.handles.length) === 0, "rien de choisi : pas de flèche");
  await p.click("#tree >> text=Cylindre 1"); await p.waitForTimeout(500); await idle();
  ok(await G(() => window.gabarit.viewer.handles.map((g) => g.userData.hd.id).join()) === "x,y,z,rx,ry,rz", "forme choisie : trois flèches X, Y, Z et trois arcs pour tourner");
  await p.screenshot({ path: "/tmp/claude-0/shots/v11-fleches.png" });
  let tipSeen = "";
  await drag("x", 17.3, { peek: async () => { tipSeen = await G(() => document.querySelector("#dragTip")?.textContent || ""); } });
  let f = await G(() => window.gabarit.doc.features[1]);
  ok(Math.abs(Number(f.x) - 17) <= 1 && Number.isInteger(Number(f.x)) && f.y === "0" && f.z === "20", "flèche X tirée d’environ 17 mm : X = " + f.x + " (au millimètre), Y et Z inchangés");
  ok(/^X\s:\s\d+ mm$/.test(tipSeen.replace(/\u202f|\u00a0/g, " ")), "valeur affichée près de la souris pendant qu’on tire : « " + tipSeen + " »");
  ok(await G(() => !document.querySelector("#dragTip")), "l’étiquette disparaît quand on lâche");
  const x1 = Number(f.x);
  const cx = await G(() => { const m = window.gabarit.st.mesh; return m.bb[1][0]; });
  ok(Math.abs(cx - Math.max(30, x1 + 8)) < 0.01, "la pièce est recalculée avec le cylindre déplacé");
  ok(await G(() => { const i = document.querySelector('#props [data-hk="x"]'); return i && i.value; }) === String(x1), "le champ X du panneau suit la flèche");
  await drag("z", -5);
  f = await G(() => window.gabarit.doc.features[1]);
  ok(Number(f.z) === 15 || Math.abs(Number(f.z) - 15) <= 1, "flèche Z tirée vers le bas : Z = " + f.z);
  await drag("y", 3.24, { shift: true });
  f = await G(() => window.gabarit.doc.features[1]);
  ok(Math.abs(Number(f.y) - 3.2) < 0.35 && Math.round(Number(f.y) * 10) === Number(f.y) * 10 || Math.abs(Number(f.y) * 10 - Math.round(Number(f.y) * 10)) < 1e-6, "avec Maj, au dixième de millimètre : Y = " + f.y);
  // annuler : un seul retour en arrière par geste
  await p.keyboard.press("Enter"); await p.waitForTimeout(200); // Entrée valide l'étape
  const before = f;
  await p.keyboard.press("Control+z"); await idle();
  f = await G(() => window.gabarit.doc.features[1]);
  ok(f.y === "0" && f.x === before.x && f.z === before.z, "Ctrl Z annule le dernier geste, et lui seul (Y revient à 0, X et Z gardés)");
  ok(await G(() => window.gabarit.viewer.handles.length) === 0, "sélection retirée : les flèches disparaissent");

  // ---- régler une épaisseur ----
  await load([
    { id: "s1", type: "sketch", name: "Esquisse 1", plane: { kind: "std", name: "dessus", offset: "0" }, entities: [{ id: "r", type: "rect", cx: "0", cy: "0", w: "40", h: "30", r: "0", a: "0" }] },
    { id: "e1", type: "extrude", name: "Extrusion 1", sketch: "s1", mode: "add", dir: "normal", dist: "10" }]);
  await p.click("#tree >> text=Extrusion 1"); await p.waitForTimeout(500); await idle();
  ok(await G(() => window.gabarit.viewer.handles.map((g) => g.userData.hd.id).join()) === "dist", "extrusion choisie : une flèche d’épaisseur");
  const o0 = await G(() => window.gabarit.viewer.handles[0].position.toArray());
  ok(Math.abs(o0[2] - 10) < 1e-6 && Math.abs(o0[0]) < 1e-6, "la flèche part du dessus de la matière, au centre du dessin");
  await drag("dist", 8);
  f = await G(() => window.gabarit.doc.features[1]);
  let v = await G(() => window.gabarit.st.mesh.volume);
  ok(Number(f.dist) >= 17 && Number(f.dist) <= 19 && Math.abs(v - 1200 * Number(f.dist)) < 1, "flèche tirée de 8 mm : épaisseur " + f.dist + " mm, volume recalculé");
  await drag("dist", -60);
  f = await G(() => window.gabarit.doc.features[1]);
  ok(Number(f.dist) === 0.1, "impossible de passer sous zéro : épaisseur minimale " + f.dist + " mm");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);

  // ---- déplacer une coupe à plat ----
  await load([box, { id: "k1", type: "slice", name: "Coupe à plat 1", axis: "z", at: "12", keep: "below" }]);
  await p.click("#tree >> text=Coupe à plat 1"); await p.waitForTimeout(500); await idle();
  ok(await G(() => window.gabarit.viewer.handles.map((g) => g.userData.hd.id).join()) === "at", "coupe choisie : une flèche");
  await drag("at", -4);
  f = await G(() => window.gabarit.doc.features[1]); v = await G(() => window.gabarit.st.mesh.volume);
  ok(Number(f.at) >= 7 && Number(f.at) <= 9 && Math.abs(v - 1800 * Number(f.at)) < 1, "coupe descendue à " + f.at + " mm, pièce recalculée");
  // tourner la vue marche toujours quand on tire à côté des flèches
  const cam0 = await G(() => window.gabarit.viewer.camera.position.toArray());
  await p.mouse.move(500, 700); await p.mouse.down(); await p.mouse.move(560, 720, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(300);
  const cam1 = await G(() => window.gabarit.viewer.camera.position.toArray());
  ok(Math.hypot(cam1[0] - cam0[0], cam1[1] - cam0[1], cam1[2] - cam0[2]) > 1, "tirer à côté des flèches fait toujours tourner la vue");
  f = await G(() => window.gabarit.doc.features[1]);
  ok(await G(() => window.gabarit.st.sel) === "k1", "et ne change rien à l’étape");
  console.log("erreurs", logs);
  ok(!logs.length, "aucune erreur dans la console");
  console.log(fails ? "FLOW22 ÉCHEC" : "FLOW22 OK");
  await b.close(); process.exit(fails ? 1 : 0);
})();
