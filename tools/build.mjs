// Construit le site (dist/) et la version en un seul fichier (dist-standalone/Gabarit.html).
import * as esbuild from "esbuild";
import fs from "node:fs";
import zlib from "node:zlib";
const VERSION = JSON.parse(fs.readFileSync("package.json")).version;
fs.rmSync("dist", { recursive: true, force: true }); fs.mkdirSync("dist", { recursive: true });
const common = { bundle: true, minify: true, legalComments: "none", target: ["chrome110", "firefox115", "safari16.4"] };
await esbuild.build({ ...common, entryPoints: ["src/app.js"], outfile: "dist/app.js", format: "iife", define: { GABARIT_VERSION: JSON.stringify(VERSION) } });
await esbuild.build({ ...common, entryPoints: ["src/worker.js"], outfile: "dist/worker.js", format: "iife", platform: "browser", external: ["node:*"], define: { "import.meta.url": "self.location.href" }, logLevel: "error" });
for (const f of ["index.html", "style.css", "icon.svg", "manifest.webmanifest", "icon-192.png", "icon-512.png"]) if (fs.existsSync("web/" + f)) fs.copyFileSync("web/" + f, "dist/" + f);
fs.copyFileSync("node_modules/replicad-opencascadejs/dist/replicad_single.wasm", "dist/occt.wasm");
fs.writeFileSync("dist/sw.js", fs.readFileSync("web/sw.js", "utf8").replace("__VERSION__", VERSION + "-" + Date.now().toString(36)));
// index.html : script classique (bundle iife)
let html = fs.readFileSync("dist/index.html", "utf8").replace('<script type="module" src="app.js"></script>', '<script src="app.js" defer></script>');
fs.writeFileSync("dist/index.html", html);
fs.writeFileSync("dist/LICENSES.txt", fs.readFileSync("web/LICENSES.txt", "utf8"));
// Version autonome
fs.mkdirSync("dist-standalone", { recursive: true });
const css = fs.readFileSync("dist/style.css", "utf8");
const app = fs.readFileSync("dist/app.js", "utf8");
const wk = fs.readFileSync("dist/worker.js", "utf8");
const wasmGz = zlib.gzipSync(fs.readFileSync("dist/occt.wasm"), { level: 9 }).toString("base64");
const icon = "data:image/svg+xml;base64," + Buffer.from(fs.readFileSync("web/icon.svg")).toString("base64");
let one = fs.readFileSync("web/index.html", "utf8")
  .replace('<link rel="manifest" href="manifest.webmanifest">\n', "")
  .replace('<link rel="icon" href="icon.svg" type="image/svg+xml">', `<link rel="icon" href="${icon}">`)
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>${css}</style>`)
  .replace('<img src="icon.svg"', `<img src="${icon}"`)
  .replace('<script type="module" src="app.js"></script>', () =>
    `<script>window.GABARIT_WORKER_SRC=${JSON.stringify(wk).replace(/<\/script/gi, "<\\/script")};</script>\n<script>window.GABARIT_WASM_GZ="${wasmGz}";</script>\n<script>${app.replace(/<\/script/gi, "<\\/script")}</script>`);
fs.writeFileSync("dist-standalone/Gabarit.html", one);
console.log("ok", VERSION, (fs.statSync("dist-standalone/Gabarit.html").size / 1e6).toFixed(1) + " Mo");
