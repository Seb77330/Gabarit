const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  await p.goto("http://localhost:8765/?mode=expert");
  await p.click("text=Voir l’exemple");
  // ajoute un texte gravé dans le dos de l'équerre
  await p.evaluate(() => {
    const d = window.gabarit.doc;
    d.features.push({ id: "st", type: "sketch", name: "Marquage", plane: { kind: "std", name: "dessus", offset: "5" }, entities: [{ id: "t1", type: "text", txt: "Gabarit é", cx: "20", cy: "-4", h: "6", a: "0" }] });
    d.features.push({ id: "xt", type: "extrude", name: "Gravure", sketch: "st", mode: "cut", dir: "inverse", dist: "1" });
    window.gabarit.loadDoc(JSON.parse(JSON.stringify(d)));
  });
  await p.waitForTimeout(500); await p.waitForFunction(() => !window.gabarit.st.building, null, { timeout: 120000 });
  console.log("text", await p.evaluate(() => [window.gabarit.st.errors, Math.round(window.gabarit.st.mesh.volume)]));
  await p.screenshot({ path: "/tmp/claude-0/shots/56-text.png" });
  await p.click("#tree >> text=Marquage"); await p.click("#props >> text=Modifier l’esquisse"); await p.waitForTimeout(400);
  await p.screenshot({ path: "/tmp/claude-0/shots/57-text-sketch.png" });
  await p.click("#skTools button[title=Entrée]");
  await p.click(".tbtn[data-tool=drawing]"); await p.waitForSelector(".sheet svg", { timeout: 60000 }); await p.waitForTimeout(500);
  await p.screenshot({ path: "/tmp/claude-0/shots/58-drawing-dims.png" });
  console.log("LOGS", logs.join("\n"));
  await b.close();
})();
