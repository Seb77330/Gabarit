// Lance tous les essais automatiques l'un après l'autre, avec leur petit serveur local.
//   node tools/all.cjs              tous les essais
//   node tools/all.cjs flow3 flow8  seulement ceux-là
// Avant : npm ci, puis node tools/build.mjs. Il faut aussi Playwright et son Chromium
// (npm i --no-save playwright, puis npx playwright install chromium).
const http = require("http"), fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const repo = path.join(__dirname, ".."), root = path.join(repo, "dist");
const TMP = process.env.GABARIT_TMP || (process.platform === "win32" ? path.join(repo, "essais-tmp") : "/tmp/claude-0");
const LOG = path.join(repo, "essais-resultat.txt");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf", ".woff2": "font/woff2" };
const out = (s) => { console.log(s); fs.appendFileSync(LOG, s + "\n"); };
if (!fs.existsSync(path.join(root, "index.html"))) { console.error("Le dossier dist manque : lance d'abord node tools/build.mjs"); process.exit(2); }
for (const d of ["shots", "fixtures"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });
fs.writeFileSync(LOG, "");
const serve = (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(f).pipe(res);
};
// Les essais tournent dans des processus à part, sans bloquer celui-ci : il doit continuer à servir les pages.
const child = (args, env, timeout) => new Promise((done) => {
  const c = spawn(process.execPath, args, { cwd: repo, env }); let text = "", late = false;
  c.stdout.on("data", (d) => (text += d)); c.stderr.on("data", (d) => (text += d));
  const timer = setTimeout(() => { late = true; c.kill(); }, timeout);
  c.on("close", (code) => { clearTimeout(timer); done({ status: late ? null : code, text }); });
});
const run = async (servers) => {
  const all = fs.readdirSync(__dirname).filter((f) => /^flow\d*\.cjs$/.test(f)).map((f) => f.replace(".cjs", "")).sort((a, b) => (Number(a.slice(4)) || 1) - (Number(b.slice(4)) || 1));
  const list = process.argv.length > 2 ? process.argv.slice(2) : all;
  const env = { ...process.env, GABARIT_TMP: TMP }, t0 = Date.now(), bad = [];
  out(`Essais de Gabarit ${JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version} · node ${process.version} · ${process.platform} · ${new Date().toISOString()}`);
  if (process.argv.length <= 2) {
    const r = await child([path.join("tools", "regions.test.mjs")], env, 120000);
    const okU = r.status === 0 && /TOUT OK/.test(r.text);
    out(`=== regions.test ${okU ? "ok" : "ÉCHEC"}`); if (!okU) { bad.push("regions.test"); out(r.text.split("\n").filter((l) => !/^ok/.test(l)).slice(-30).join("\n")); }
  }
  const one = async (f, again) => {
    const t = Date.now();
    const r = await child([path.join("tools", f + ".cjs")], env, 420000), lines = r.text.split("\n");
    // un essai échoue s'il sort avec une erreur, ou s'il a écrit une ligne d'échec
    const marks = lines.filter((l) => /^(FAIL|ÉCHEC)\b|ÉCHECS \d|pageerror/.test(l));
    const failed = r.status !== 0 || marks.length > 0;
    out(`=== ${f} ${failed ? "ÉCHEC" : "ok"}${again ? " au 2ᵉ passage" : ""} (sortie ${r.status === null ? "délai dépassé" : r.status}, ${Math.round((Date.now() - t) / 1000)} s)`);
    if (failed) out([...marks, "--- fin de la sortie ---", ...lines.slice(-25)].join("\n"));
    return !failed;
  };
  const first = [];
  for (const f of list) if (!(await one(f))) first.push(f);
  // Second passage : un PC occupé fait dépasser des délais. Un essai qui échoue deux fois est un vrai échec.
  if (first.length) out(`--- 2ᵉ passage pour ${first.length} essai(s) : ${first.join(", ")} ---`);
  for (const f of first) if (!(await one(f, true))) bad.push(f);
  out(`TERMINÉ en ${Math.round((Date.now() - t0) / 1000)} s : ${list.length - bad.filter((x) => x !== "regions.test").length} essais réussis sur ${list.length}` + (first.length ? ` (dont ${first.length - bad.filter((x) => x !== "regions.test").length} au 2ᵉ passage)` : "") + (bad.length ? ` · en échec : ${bad.join(", ")}` : " · aucun échec"));
  for (const sv of servers) sv.close();
  process.exit(bad.length ? 1 : 0);
};
// Serveur local sur 127.0.0.1 (et ::1 quand la machine l'accepte) : « localhost » y mène dans les deux cas.
const v4 = http.createServer(serve);
v4.on("error", (e) => { if (e.code === "EADDRINUSE") { out("Le port 8765 sert déjà une copie de dist : on l'utilise."); run([]); } else throw e; });
v4.listen(8765, "127.0.0.1", () => { const v6 = http.createServer(serve); v6.on("error", () => run([v4])); v6.listen(8765, "::1", () => run([v4, v6])); });
