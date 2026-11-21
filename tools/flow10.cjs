const TMP = process.env.GABARIT_TMP || "/tmp/claude-0"; // dossier des captures et des fichiers d'essai
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  const p = await ctx.newPage();
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  await p.goto("http://localhost:8765/?mode=expert");
  await p.click("text=Voir l’exemple");
  await p.waitForFunction(() => window.gabarit.st.mesh && !window.gabarit.st.building, null, { timeout: 60000 });
  await p.screenshot({ path: TMP + "/shots/60-header.png" });
  // palette
  await p.keyboard.press("Control+k"); await p.keyboard.type("arrondir");
  console.log("palette", (await p.locator(".palette-item b").allInnerTexts()).slice(0, 3));
  await p.screenshot({ path: TMP + "/shots/61-palette.png" });
  await p.keyboard.press("Escape");
  await p.keyboard.press("Control+k"); await p.keyboard.type("filet"); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  console.log("thread started", await p.evaluate(() => [window.gabarit.doc.features.at(-1).type, window.gabarit.st.pick?.kind]));
  await p.keyboard.press("Escape"); await p.keyboard.press("Control+z"); await p.waitForTimeout(300);
  // impression 3D
  await p.click(".tbtn[data-tool=print]"); await p.waitForTimeout(300);
  console.log("print", await p.locator("#printbar .seclab").innerText());
  await p.click("#printbar >> text=Poser à plat automatiquement"); await p.waitForTimeout(300);
  console.log("print auto", await p.locator("#printbar .seclab").innerText(), JSON.stringify(await p.evaluate(() => window.gabarit.doc.printDown)));
  await p.screenshot({ path: TMP + "/shots/62-print.png" });
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), p.click("[data-act=stl]")]);
  const buf = require("fs").readFileSync(await dl.path()); const n = buf.readUInt32LE(80); let zmin = Infinity;
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) zmin = Math.min(zmin, buf.readFloatLE(84 + i * 50 + 12 + k * 12 + 8));
  console.log("stl tris", n, "zmin", zmin.toFixed(3));
  await p.click("#printbar >> text=Fermer");
  // variantes
  await p.click(".variants >> text=+ Variante").catch(() => {});
  // prompt : on passe par l'API
  p.on("dialog", (d) => d.accept(d.type() === "prompt" ? "Grande" : undefined));
  await p.click(".variants >> text=+ Variante");
  await p.evaluate(() => { const d = window.gabarit.doc; d.params.find((x) => x.name === "longueur").value = "90"; });
  p.removeAllListeners("dialog"); p.on("dialog", (d) => d.accept("Très grande"));
  await p.click(".variants >> text=+ Variante");
  await p.selectOption(".variants select", "Grande"); await p.waitForTimeout(300);
  console.log("variant", await p.evaluate(() => [window.gabarit.doc.params.find((x) => x.name === "longueur").value, window.gabarit.doc.variants.map((v) => v.name)]));
  // versions
  await p.click("[data-act=versions]"); await p.fill("#dlg input", "test"); await p.click("#dlg >> text=Enregistrer cette version");
  console.log("versions", await p.locator("#dlg table tr").count());
  await p.click("#dlg >> text=Fermer");
  // partage
  await p.click("[data-act=share]"); const url = await p.locator("#dlg input").inputValue(); await p.click("#dlg >> text=Fermer");
  console.log("url len", url.length, url.slice(0, 50));
  const p2 = await ctx.newPage(); p2.on("pageerror", (e) => logs.push("p2: " + e.message));
  await p2.goto("http://localhost:8765/?mode=expert" + url.slice(url.indexOf("#")));
  await p2.waitForFunction(() => window.gabarit?.st.mesh && !window.gabarit.st.building, null, { timeout: 90000 });
  console.log("shared open", await p2.evaluate(() => [window.gabarit.doc.name, window.gabarit.doc.features.length, location.hash, document.querySelector("#welcome").hidden]));
  console.log("LOGS", logs.join("\n"));
  await b.close();
})();
