const { chromium } = require("playwright");
const S = (id, plane, ents, extra = {}) => ({ id, type: "sketch", name: id, plane, entities: ents, ...extra });
const dessus = (o = "0") => ({ kind: "std", name: "dessus", offset: o });
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = []; p.on("pageerror", (e) => logs.push("pageerror: " + e.message + e.stack)); p.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  await p.goto("http://localhost:8765/");
  await p.waitForFunction(() => !document.querySelector("#busy") || document.querySelector("#busy").hidden, null, { timeout: 60000 });
  const run = async (name, doc, shot) => {
    await p.evaluate((d) => { document.querySelector("#welcome").hidden = true; window.gabarit.loadDoc(d); }, doc);
    await p.waitForTimeout(300);
    await p.waitForFunction(() => !window.gabarit.st.building, null, { timeout: 120000 });
    const r = await p.evaluate(() => ({ err: window.gabarit.st.errors, vol: window.gabarit.st.mesh?.volume, bb: window.gabarit.st.mesh?.bb, ms: window.gabarit.st.lastMs }));
    console.log(name, JSON.stringify(r.err), "vol", r.vol && Math.round(r.vol), "bb", JSON.stringify(r.bb?.map((v) => v.map((x) => Math.round(x * 10) / 10))), "ms", Math.round(r.ms));
    if (shot) await p.screenshot({ path: `/tmp/claude-0/shots/${shot}.png` });
  };
  // 1. ellipse + courbe fermée + balayage sur courbe ouverte
  await run("ellipse/spline", { version: 1, name: "t1", material: "pla", params: [], features: [
    S("s1", dessus(), [{ id: "e1", type: "ellipse", cx: "0", cy: "0", rx: "30", ry: "15", a: "20" }, { id: "e2", type: "spline", closed: true, pts: [["-10", "0"], ["0", "6"], ["10", "0"], ["0", "-6"]] }]),
    { id: "x1", type: "extrude", name: "x", sketch: "s1", mode: "add", dir: "normal", dist: "5" },
    S("s2", { kind: "std", name: "face", offset: "0" }, [{ id: "c", type: "circle", cx: "0", cy: "0", d: "4" }]),
    S("s3", dessus(), [{ id: "p", type: "spline", closed: false, pts: [["40", "0"], ["50", "20"], ["30", "40"], ["45", "60"]] }]),
    { id: "w1", type: "sweep", name: "w", profile: "s2", path: "s3", mode: "add" },
  ] }, "50-ellipse-spline");
  // 2. extrusion jusqu'à la face (parallèle puis inclinée)
  await run("upto", { version: 1, name: "t2", material: "pla", params: [], features: [
    S("s1", dessus(), [{ id: "r", type: "rect", cx: "0", cy: "0", w: "40", h: "40", r: "0", a: "0" }]),
    { id: "x1", type: "extrude", name: "x", sketch: "s1", mode: "add", dir: "normal", dist: "10" },
    S("s2", dessus("30"), [{ id: "r", type: "rect", cx: "0", cy: "0", w: "10", h: "10", r: "0", a: "0" }]),
    { id: "x2", type: "extrude", name: "x2", sketch: "s2", mode: "add", end: "face", upTo: [5, 5, 10, 0.6, 0.6, 1] },
  ] });
  // 3. nervure sur l'équerre d'exemple
  const ex = await p.evaluate(() => window.gabarit.exampleDoc());
  ex.features.push(S("sr", { kind: "std", name: "face", offset: "0" }, [{ id: "l", type: "path", pts: [["5", "30"], ["35", "5"]] }]), { id: "rb", type: "rib", name: "Nervure 1", sketch: "sr", t: "4", flip: false });
  await run("rib", ex, "51-rib");
  // 4. filetage extérieur M10 sur un axe + taraudage
  await run("thread", { version: 1, name: "t4", material: "acier", params: [], features: [
    S("s1", dessus(), [{ id: "c", type: "circle", cx: "0", cy: "0", d: "10" }]),
    { id: "x1", type: "extrude", name: "x", sketch: "s1", mode: "add", dir: "normal", dist: "20" },
    { id: "t1", type: "thread", name: "Filetage 1", kind: "ext", pitch: "1.5", len: "12", face: [5, 0, 10, 1, 0.5, 0.5] },
  ] }, "52-thread");
  await run("tap", { version: 1, name: "t5", material: "acier", params: [], features: [
    S("s1", dessus(), [{ id: "c", type: "rect", cx: "0", cy: "0", w: "30", h: "30", r: "0", a: "0" }, { id: "h", type: "circle", cx: "0", cy: "0", d: "8.5" }]),
    { id: "x1", type: "extrude", name: "x", sketch: "s1", mode: "add", dir: "normal", dist: "12" },
    { id: "t1", type: "thread", name: "Filetage 1", kind: "int", pitch: "1.5", len: "", face: [4.25, 0, 6, 0.64, 0.5, 0.5] },
  ] });
  // 5. ressort
  await run("helix", { version: 1, name: "t6", material: "acier", params: [], features: [
    { id: "h1", type: "helix", name: "Ressort 1", plane: dessus(), cx: "0", cy: "0", d: "20", pitch: "5", height: "40", wire: "2", mode: "add" },
  ] }, "53-helix");
  console.log("LOGS", logs.join("\n"));
  await b.close();
})();
