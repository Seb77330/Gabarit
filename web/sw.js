// Garde Gabarit disponible hors ligne.
// Fichiers de l'appli : réseau d'abord (toujours la dernière version quand on est en ligne), cache si hors ligne.
// Moteur 3D (occt.wasm, 23 Mo) : cache d'abord, il ne change que si la version change.
const VERSION = "__VERSION__";
const FILES = ["./", "index.html", "style.css", "app.js", "worker.js", "occt.wasm", "icon.svg", "manifest.webmanifest"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  const url = new URL(e.request.url);
  if (url.pathname.endsWith(".wasm")) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
    return;
  }
  const fromCache = () => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html"));
  const net = fetch(new Request(url.href, { cache: "no-cache", credentials: "same-origin" }))
    .then((r) => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then((ca) => ca.put(e.request, c)); } return r; });
  // réseau lent : au bout de 4 s on sert la copie locale (la nouvelle version sera là au prochain lancement)
  const slow = new Promise((res) => setTimeout(res, 4000)).then(fromCache);
  e.respondWith(Promise.race([net.catch(fromCache), slow.then((r) => r || net)]));
});
