const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const logs = [];
  p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(m.type() + ": " + m.text()); });
  p.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await p.goto(process.argv[2] || "http://localhost:8765/?mode=expert");
  await p.waitForTimeout(800);
  await p.screenshot({ path: "/tmp/claude-0/shots/1-welcome.png" });
  await p.click("text=Voir l’exemple");
  await p.waitForFunction(() => window.gabarit.st.mesh, null, { timeout: 60000 });
  await p.waitForTimeout(800);
  console.log("errors", JSON.stringify(await p.evaluate(() => window.gabarit.st.errors)), "info", JSON.stringify(await p.evaluate(() => window.gabarit.st.info)));
  await p.screenshot({ path: "/tmp/claude-0/shots/2-example.png" });
  console.log(logs.join("\n"));
  await b.close();
})();
