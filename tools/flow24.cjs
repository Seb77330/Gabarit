// v1.2 : arcs à tirer pour tourner une forme prête ou un fichier importé.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(250); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(250); };
  const load = async (features) => { await G((features) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Essai", material: "pla", params: [{ name: "a", value: "10" }], features }); g.st.mesh = null; }, features); await idle(); };
  const bb = () => G(() => window.gabarit.st.mesh.bb);
  const size = async () => { const B = await bb(); return [0, 1, 2].map((k) => B[1][k] - B[0][k]); };
  const feat = (id) => G((id) => window.gabarit.doc.features.find((f) => f.id === id), id);
  // chemin de la souris pour tourner l'arc « id » de « deg » degrés : le long du cercle quand on le voit
  // de face, le long de la tangente quand on le voit par la tranche (comme le fait l'application)
  const path = (id, deg, n = 12) => G(([id, deg, n]) => {
    const v = window.gabarit.viewer; const g = v.handles.find((x) => x.userData.hd.id === id); if (!g) return null;
    const r = v.renderer.domElement.getBoundingClientRect();
    const scr = (w) => { const q = w.clone().project(v.camera); return [r.left + (q.x + 1) / 2 * r.width, r.top + (1 - q.y) / 2 * r.height]; };
    const V = g.position.constructor; const o = g.getWorldPosition(new V()); const dir = g.userData.dir; const R = 0.7 * g.scale.x;
    const u = new V(1, 0, 0).applyQuaternion(g.quaternion), w = new V(0, 1, 0).applyQuaternion(g.quaternion);
    const at = (a) => o.clone().addScaledVector(u, R * Math.cos(a)).addScaledVector(w, R * Math.sin(a));
    // un endroit de l'arc où c'est bien lui qui est sous la souris
    let a0 = null;
    for (const d of [45, 30, 60, 22, 68]) { const q = scr(at(d * Math.PI / 180)); if (v.handleAt({ clientX: q[0], clientY: q[1] }) === g) { a0 = d * Math.PI / 180; break; } }
    if (a0 === null) return null;
    const p0 = at(a0); const s0 = scr(p0); v.ray({ clientX: s0[0], clientY: s0[1] });
    const facing = Math.abs(v.raycaster.ray.direction.dot(dir)) > 0.25;
    const pts = [s0];
    if (facing) for (let i = 1; i <= n; i++) pts.push(scr(at(a0 + deg * Math.PI / 180 * i / n)));
    else {
      const tan = new V().crossVectors(dir, p0.clone().sub(o)).normalize(); const eps = R * 0.05; const e = scr(p0.clone().addScaledVector(tan, eps));
      const L = Math.hypot(e[0] - s0[0], e[1] - s0[1]); const px = deg * (L / eps) * R * Math.PI / 180;
      for (let i = 1; i <= n; i++) pts.push([s0[0] + (e[0] - s0[0]) / L * px * i / n, s0[1] + (e[1] - s0[1]) / L * px * i / n]);
    }
    return { pts, facing, axis: dir.toArray() };
  }, [id, deg, n]);
  const arc = (id) => path(id, 0, 1);
  const turn = async (id, deg, opts = {}) => {
    const a = await path(id, deg, Math.max(8, Math.ceil(Math.abs(deg) / 6))); if (!a) throw new Error("arc introuvable : " + id);
    await p.mouse.move(a.pts[0][0], a.pts[0][1]); await p.waitForTimeout(150);
    if (opts.shift) await p.keyboard.down("Shift");
    await p.mouse.down();
    for (const q of a.pts.slice(1)) { await p.mouse.move(q[0], q[1]); await p.waitForTimeout(35); }
    if (opts.peek) await opts.peek();
    await p.mouse.up(); if (opts.shift) await p.keyboard.up("Shift");
    await idle();
    return a;
  };
  const near = (a, b, t = 0.05) => Math.abs(a - b) <= t;
  await p.goto("http://localhost:8765/?mode=simple");
  await p.click("#welcome >> text=Nouvelle pièce"); await p.waitForTimeout(400);

  // ---- tourner une forme prête ----
  const box = { id: "b1", type: "shape", kind: "box", name: "Boîte 1", mode: "add", a: "60", b: "30", h: "20", r: "0", x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0" };
  await load([box]);
  await p.click("#tree >> text=Boîte 1"); await p.waitForTimeout(500); await idle();
  ok(await G(() => window.gabarit.viewer.handles.filter((g) => g.userData.ring).map((g) => g.userData.hd.id).join()) === "rx,ry,rz", "forme choisie : trois arcs pour tourner");
  let tip = "";
  await turn("rz", 47, { peek: async () => { tip = (await p.locator("#dragTip").innerText().catch(() => "")).replace(/[  ]/g, " "); } });
  let f = await feat("b1");
  ok(f.rz === "45" && f.rx === "0" && f.ry === "0", "arc Z tiré d’environ 47° : la boîte tourne de 45° (crans de 5°) : " + [f.rx, f.ry, f.rz]);
  ok(/Rotation Z\s*:\s*45\s*°/.test(tip), "angle affiché pendant le geste : « " + tip + " »");
  let S = await size(); const diag = 90 / Math.SQRT2;
  ok(near(S[0], diag, 0.1) && near(S[1], diag, 0.1) && near(S[2], 20), "pièce recalculée, tournée de 45° autour de Z : " + S.map((x) => x.toFixed(2)).join(" × "));
  ok((await p.locator('#props [data-hk="rz"]').inputValue()) === "45", "le champ « Autour de Z » suit l’arc");
  await p.screenshot({ path: TMP + "/shots/v12-tourner.png" });
  await turn("rz", 3.3, { shift: true });
  f = await feat("b1"); ok(f.rz === "48", "avec Maj, au degré près : " + f.rz);
  await p.keyboard.press("Control+z"); await idle();
  f = await feat("b1"); ok(f.rz === "45", "Ctrl Z annule le dernier geste : " + f.rz);
  // l'arc X suit la pièce : après 45° autour de Z, son axe est à 45° dans le plan du sol
  const ax = (await arc("rx")).axis;
  ok(near(ax[0], Math.SQRT1_2, 0.01) && near(ax[1], Math.SQRT1_2, 0.01) && near(ax[2], 0, 0.01), "l’arc X a tourné avec la boîte : axe " + ax.map((x) => x.toFixed(2)).join(", "));
  await G(() => window.gabarit.viewer.fit([1, 0.6, 0.5])); await p.waitForTimeout(500);
  let t = await turn("rx", 90);
  f = await feat("b1"); S = await size();
  ok(t.facing && f.rx === "90" && f.rz === "45", "arc X vu de face, tiré de 90° : " + [f.rx, f.ry, f.rz]);
  ok(near(S[2], 30, 0.1), "la boîte est maintenant sur la tranche (30 mm de haut) : " + S.map((x) => x.toFixed(2)).join(" × "));
  // vu par la tranche (vue de dessus), l'arc se tire le long de sa tangente
  await G(() => window.gabarit.viewer.fit([0.02, -0.02, 1])); await p.waitForTimeout(500);
  t = await turn("rx", -40);
  f = await feat("b1");
  ok(!t.facing && Number(f.rx) >= 35 && Number(f.rx) <= 65 && f.rz === "45", "arc X vu par la tranche, tiré d’environ −40° : " + f.rx + "°");
  await G(() => window.gabarit.viewer.fit([1, -1.3, 0.9])); await p.waitForTimeout(400);
  await p.screenshot({ path: TMP + "/shots/v12-tourner-2.png" });
  // au-delà de 180°, l'angle repart de −180°
  await load([{ ...box, rz: "170" }]);
  await p.click("#tree >> text=Boîte 1"); await p.waitForTimeout(500); await idle();
  await turn("rz", 20);
  f = await feat("b1"); ok(f.rz === "-170", "170° + 20° s’écrit −170° : " + f.rz);
  // une formule ne se tire pas à la souris
  await load([{ ...box, rz: "a*2" }]);
  await p.click("#tree >> text=Boîte 1"); await p.waitForTimeout(500); await idle();
  ok(await G(() => window.gabarit.viewer.handles.filter((g) => g.userData.ring).map((g) => g.userData.hd.id).join()) === "rx,ry", "angle écrit avec une formule : pas d’arc pour celui-là");

  // ---- tourner un fichier importé ----
  await load([{ ...box, a: "80", b: "20", h: "10" }]);
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-act=stl]")]);
  const stl = TMP + "/shots/barre24.stl"; await dl.saveAs(stl);
  await G(() => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Essai", material: "pla", params: [], features: [] }); }); await p.waitForTimeout(600);
  await p.setInputFiles("#fileIn", stl);
  await p.waitForFunction(() => window.gabarit.doc.features.some((f) => f.type === "import"), null, { timeout: 30000 });
  await G(() => { window.gabarit.st.mesh = null; }); await idle();
  const impId = await G(() => window.gabarit.doc.features.find((f) => f.type === "import").id);
  if (!(await G((id) => window.gabarit.st.sel === id, impId))) await p.click("#tree >> text=barre24"); // juste après l'ouverture, le fichier est déjà choisi
  await p.waitForTimeout(500); await idle();
  ok(await G(() => window.gabarit.viewer.handles.map((g) => g.userData.hd.id).join()) === "tx,ty,tz,rx,ry,rz", "fichier importé choisi : flèches et arcs");
  await turn("rz", 90);
  f = await feat(impId); S = await size();
  ok(f.rz === "90", "arc Z tiré de 90° sur le fichier importé : " + f.rz);
  ok(near(S[0], 20, 0.1) && near(S[1], 80, 0.1) && near(S[2], 10, 0.1), "la barre est tournée : " + S.map((x) => x.toFixed(2)).join(" × "));
  await turn("ry", -90);
  f = await feat(impId); S = await size(); const B = await bb();
  ok(f.ry === "-90", "arc Y tiré de −90° : " + f.ry);
  ok(near(S[2], 80, 0.1) || near(S[2], 20, 0.1), "la barre est redressée : " + S.map((x) => x.toFixed(2)).join(" × "));
  ok(near(B[0][2], 0, 0.05), "et reste posée au même niveau (Z = " + B[0][2].toFixed(2) + ")");
  // tirer à côté fait toujours tourner la vue
  const cam0 = await G(() => window.gabarit.viewer.camera.position.toArray());
  await p.mouse.move(500, 700); await p.mouse.down(); await p.mouse.move(560, 720, { steps: 4 }); await p.mouse.up();
  await p.waitForTimeout(300);
  const cam1 = await G(() => window.gabarit.viewer.camera.position.toArray());
  ok(Math.hypot(cam1[0] - cam0[0], cam1[1] - cam0[1], cam1[2] - cam0[2]) > 1, "tirer à côté des arcs fait toujours tourner la vue");
  console.log("erreurs", JSON.stringify(logs));
  ok(logs.length === 0, "aucune erreur dans la console");
  console.log(fails ? "FLOW24 ÉCHEC (" + fails + ")" : "FLOW24 OK");
  await b.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
