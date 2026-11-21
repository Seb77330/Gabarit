// v1.4 : outil « Allonger une partie » (deux traits sur la pièce, puis une taille), plusieurs parties,
// boutons − et + qui font défiler les chiffres.
const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  let fails = 0; const ok = (c, m) => { console.log((c ? "ok : " : "ÉCHEC : ") + m); if (!c) fails++; };
  const G = (fn, a) => p.evaluate(fn, a);
  const idle = async () => { await p.waitForTimeout(300); await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 120000 }); await p.waitForTimeout(250); };
  const load = async (features) => { await G((features) => { const g = window.gabarit; g.loadDoc({ version: 1, name: "Essai", material: "pla", params: [], features }); g.st.mesh = null; }, features); await idle(); };
  const vol = () => G(() => window.gabarit.st.mesh.volume);
  const bb = () => G(() => window.gabarit.st.mesh.bb);
  const errs = () => G(() => window.gabarit.st.errors);
  const size = async () => { const B = await bb(); return [0, 1, 2].map((k) => Math.round((B[1][k] - B[0][k]) * 100) / 100); };
  const world = (pt) => G((pt) => { const g = window.gabarit; const v = g.viewer.camera.position.clone().set(...pt).project(g.viewer.camera); const r = g.viewer.renderer.domElement.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, pt);
  const txt = (sel) => p.locator(sel).innerText().then((t) => t.replace(/[  ]/g, " "));
  await p.goto("http://localhost:8765/?mode=expert");
  await p.click("text=Nouvelle pièce"); await p.waitForTimeout(300); await G(() => document.querySelector("#dlg")?.close());

  const box = { id: "b1", type: "shape", kind: "box", name: "Boîte 1", mode: "add", a: "60", b: "30", h: "20", r: "0", x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0" };
  const st = (zones) => ({ id: "s1", type: "stretch", name: "Partie allongée 1", zones });
  // ---- le calcul ----
  await load([box, st([{ axis: "z", a: "5", b: "15", add: "10" }])]);
  ok((await size()).join() === "60,30,30" && Math.abs(await vol() - 60 * 30 * 30) < 2 && !Object.keys(await errs()).length, "boîte de 20 de haut, partie de 5 à 15 allongée de 10 : 60 × 30 × 30 (" + (await size()).join(" × ") + ")");
  await load([box, st([{ axis: "z", a: "5", b: "15", add: "10" }, { axis: "x", a: "-10", b: "10", add: "20" }])]);
  ok((await size()).join() === "80,30,30" && Math.abs(await vol() - 80 * 30 * 30) < 3, "deux parties, en hauteur et en longueur : 80 × 30 × 30 (" + (await size()).join(" × ") + ")");
  await load([box, st([{ axis: "z", a: "5", b: "15", add: "-5" }])]);
  ok((await size()).join() === "60,30,15", "raccourcir de 5 : 15 de haut");
  await load([box, st([{ axis: "z", a: "5", b: "15", add: "0" }])]);
  ok((await size()).join() === "60,30,20" && Math.abs(await vol() - 36000) < 1e-3, "sans changement de taille, la pièce n’est pas touchée");
  await load([box, st([{ axis: "z", a: "5", b: "15", add: "-10" }])]);
  ok(/raccourcir/.test((await errs()).s1 || ""), "raccourcir de toute la taille : message clair (" + (await errs()).s1 + ")");
  // une lampe : pied large, tige fine, tête ; on rallonge seulement la tige
  const lamp = [
    { id: "p", type: "shape", kind: "cyl", name: "Pied", mode: "add", d: "40", h: "5", x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0" },
    { id: "t", type: "shape", kind: "cyl", name: "Tige", mode: "add", d: "8", h: "45", x: "0", y: "0", z: "5", rx: "0", ry: "0", rz: "0" },
    { id: "h", type: "shape", kind: "sphere", name: "Tête", mode: "add", d: "30", x: "0", y: "0", z: "45", rx: "0", ry: "0", rz: "0" },
  ];
  await load(lamp); const v0 = await vol(), s0 = await size();
  await load([...lamp, st([{ axis: "z", a: "10", b: "40", add: "30" }])]);
  const v1 = await vol(), s1 = await size();
  const more = Math.PI * 16 * 30; // 30 mm de tige en plus
  ok(Math.abs(s1[2] - s0[2] - 30) < 0.05 && Math.abs(s1[0] - s0[0]) < 0.2 && Math.abs(v1 - v0 - more) < more * 0.03 && !Object.keys(await errs()).length, `lampe : la tige gagne 30 mm, le pied et la tête ne changent pas (hauteur ${s0[2]} → ${s1[2]}, matière en plus ${Math.round(v1 - v0)} pour ${Math.round(more)} attendus)`);
  await p.screenshot({ path: TMP + "/shots/v14-lampe.png" });

  // ---- par l'interface ----
  await load([box]);
  await p.click(".tbtn[data-tool=stretch]"); await p.waitForTimeout(500);
  ok(await G(() => window.gabarit.doc.features[1]?.type === "stretch") && /1 sur 2/.test(await txt("#banner")), "outil « Allonger » : étape créée, le bandeau demande le premier clic (" + await txt("#banner") + ")");
  let pt = await world([0, -15, 5]); await p.mouse.click(pt[0], pt[1]); await p.waitForTimeout(400);
  ok(/2 sur 2/.test(await txt("#banner")), "après le premier clic, le bandeau demande le deuxième");
  pt = await world([0, -15, 15]); await p.mouse.click(pt[0], pt[1]); await p.waitForTimeout(600); await idle();
  let z = await G(() => window.gabarit.doc.features[1].zones[0]);
  ok(z && z.axis === "z" && Math.abs(z.a - 5) < 0.7 && Math.abs(z.b - 15) < 0.7 && z.add === "0", "deux clics : une partie en hauteur, de " + z?.a + " à " + z?.b + " mm");
  const len = z.b - z.a;
  await p.fill('#props [data-zf="size"]', String(len + 20)); await idle();
  ok(Math.abs((await size())[2] - 40) < 0.01 && Math.abs(Number(await p.inputValue('#props [data-zf="add"]')) - 20) < 0.01 && Math.abs(Number(await p.inputValue('#props [data-zf="pct"]')) - 20 / len * 100) < 0.02, "nouvelle taille tapée : la pièce fait 40 de haut, les champs « en plus » et « % » suivent");
  await p.fill('#props [data-zf="pct"]', "50"); await idle();
  ok(Math.abs((await size())[2] - (20 + len / 2)) < 0.01, "50 % tapés : la partie grandit de moitié (" + (await size())[2] + " de haut)");
  // boutons − et + : un clic, puis rester appuyé
  await p.fill('#props [data-zf="add"]', "10"); await idle();
  await p.click('#props [data-zone-card] .field:nth-of-type(3) .stepb[data-step=plus]'); await idle();
  ok(await p.inputValue('#props [data-zf="add"]') === "11" && Math.abs((await size())[2] - 31) < 0.01, "bouton + : un cran de plus (11 mm, pièce de 31 de haut)");
  const minus = p.locator('#props [data-zone-card] .field:nth-of-type(3) .stepb[data-step=minus]');
  const mb = await minus.boundingBox(); await p.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2); await p.mouse.down();
  // on tient le bouton jusqu'à ce que les chiffres aient défilé (une machine lente met plus longtemps)
  await p.waitForFunction(() => Number(document.querySelector('#props [data-zf="add"]')?.value) <= 7, null, { timeout: 30000 }).catch(() => {});
  await p.mouse.up(); await idle();
  const held = Number(await p.inputValue('#props [data-zf="add"]'));
  ok(held <= 7 && held >= -len + 0.01, "rester appuyé sur − : les chiffres défilent (11 → " + held + ")");
  // la flèche à tirer
  await p.fill('#props [data-zf="add"]', "10"); await idle(); await p.locator('#props [data-zf="add"]').blur(); await p.waitForTimeout(300);
  const hk = await G(() => { const v = window.gabarit.viewer; const g = v.handles.find((x) => x.userData.hd.id === "add"); if (!g) return null; const r = v.renderer.domElement.getBoundingClientRect(); const s = (w) => { const q = w.clone().project(v.camera); return [r.left + (q.x + 1) / 2 * r.width, r.top + (1 - q.y) / 2 * r.height]; }; const o = g.getWorldPosition(g.position.clone()); const sc = g.scale.x; const a = s(o.clone().addScaledVector(g.userData.dir, sc * 0.6)), c = s(o.clone().addScaledVector(g.userData.dir, sc * 0.6 + 1)); const d = [c[0] - a[0], c[1] - a[1]], px = Math.hypot(...d); return { a, d: [d[0] / px, d[1] / px], px }; });
  if (hk) {
    await p.mouse.move(hk.a[0], hk.a[1]); await p.waitForTimeout(150); await p.mouse.down();
    for (let i = 1; i <= 6; i++) { await p.mouse.move(hk.a[0] + hk.d[0] * hk.px * 8 * i / 6, hk.a[1] + hk.d[1] * hk.px * 8 * i / 6); await p.waitForTimeout(40); }
    await p.mouse.up(); await idle();
    const ad = Number(await G(() => window.gabarit.doc.features[1].zones[0].add));
    ok(ad > 14 && ad < 22 && Number(await p.inputValue('#props [data-zf="size"]')) === Math.round((len + ad) * 100) / 100, "flèche orange tirée : la partie s’allonge (" + ad + " mm en plus) et les champs suivent");
  } else ok(false, "flèche à tirer absente");
  await p.screenshot({ path: TMP + "/shots/v14-allonger.png" });
  // une deuxième partie, dans l'autre sens, sur la pièce déjà allongée
  await p.click('#props [data-zone="more"]'); await p.waitForTimeout(300);
  pt = await world([-10, -15, 2]); await p.mouse.click(pt[0], pt[1]); await p.waitForTimeout(300);
  pt = await world([10, -15, 2]); await p.mouse.click(pt[0], pt[1]); await p.waitForTimeout(600); await idle();
  const zs = await G(() => window.gabarit.doc.features[1].zones);
  ok(zs.length === 2 && zs[1].axis === "x" && Math.abs(Number(zs[1].a) + 10) < 0.7 && Math.abs(Number(zs[1].b) - 10) < 0.7, "deuxième partie posée en longueur, de " + zs[1]?.a + " à " + zs[1]?.b + " mm");
  await p.fill('#props [data-zf="add"]', "15"); await p.keyboard.press("Enter"); await idle();
  ok(Math.abs((await size())[0] - 75) < 0.01 && await G(() => !window.gabarit.st.sel), "15 mm en plus puis Entrée : la pièce fait 75 de long, étape validée");
  ok(await G(() => window.gabarit.doc.features.length === 2), "les deux parties sont dans la même étape");
  console.log(fails ? `FLOW34 : ${fails} ÉCHEC(S)` : "FLOW34 OK", logs.length ? logs : "");
  await b.close(); process.exit(fails ? 1 : 0);
})();
