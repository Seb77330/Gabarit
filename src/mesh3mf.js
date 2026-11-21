// Lecture des fichiers .3mf (Bambu Studio, PrusaSlicer, Cura, Orca…) : on décompresse
// l'archive, on lit chaque objet (y compris les sous-fichiers de Bambu) et on en tire
// des maillages STL binaires, prêts pour l'import de Gabarit.

// ---- Décompression ZIP (stocké ou « deflate ») avec DecompressionStream ----
async function inflateRaw(data) {
  const ds = new DecompressionStream("deflate-raw");
  const out = new Response(new Blob([data]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}
export async function unzip(buf, want = () => true) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // fin du répertoire central
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Ce fichier n’est pas une archive 3MF valide.");
  let n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true);
  if (off === 0xffffffff || n === 0xffff) { // ZIP64
    const loc = eocd - 20;
    if (dv.getUint32(loc, true) === 0x07064b50) {
      const z = Number(dv.getBigUint64(loc + 8, true));
      n = Number(dv.getBigUint64(z + 32, true)); off = Number(dv.getBigUint64(z + 48, true));
    }
  }
  const files = new Map(); const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    let csize = dv.getUint32(off + 20, true);
    const nl = dv.getUint16(off + 28, true), xl = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true);
    let lho = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nl));
    if (csize === 0xffffffff || lho === 0xffffffff) { // champs ZIP64 dans l'extra
      let x = off + 46 + nl; const end = x + xl;
      while (x + 4 <= end) {
        const id = dv.getUint16(x, true), sz = dv.getUint16(x + 2, true);
        if (id === 1) {
          let q = x + 4;
          if (dv.getUint32(off + 24, true) === 0xffffffff) q += 8; // taille décompressée
          if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (lho === 0xffffffff) lho = Number(dv.getBigUint64(q, true));
        }
        x += 4 + sz;
      }
    }
    off += 46 + nl + xl + cl;
    if (name.endsWith("/") || !want(name)) continue;
    const ln = dv.getUint16(lho + 26, true), lx = dv.getUint16(lho + 28, true);
    const raw = u8.subarray(lho + 30 + ln + lx, lho + 30 + ln + lx + csize);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflateRaw(raw));
  }
  return files;
}

// ---- Lecture du modèle ----
const UNIT = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function parseT(s) { const v = (s || "").trim().split(/\s+/).map(Number); return v.length === 12 && v.every(isFinite) ? v : ID; }
// Composition (vecteurs lignes, convention 3MF) : d'abord a, puis b.
function mul(a, b) {
  const r = new Array(12);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j] + (i === 3 ? b[9 + j] : 0);
  }
  return r;
}
const attr = (el, local) => { for (const a of el.attributes) if (a.localName === local) return a.value; return null; };
const kids = (el, local) => Array.from(el.getElementsByTagNameNS("*", local));

// Renvoie [{ name, tris: Float32Array (9 valeurs par triangle, en mm) }], un par objet posé sur le plateau.
export async function read3mf(buf) {
  const files = await unzip(buf, (n) => /\.model$/i.test(n) || /_rels\/\.rels$/i.test(n));
  const dec = new TextDecoder();
  const docs = new Map(); // chemin -> { objects: Map(id -> el), unit }
  const norm = (p) => (p || "").replace(/^\//, "");
  const load = (path) => {
    path = norm(path);
    if (docs.has(path)) return docs.get(path);
    const data = files.get(path) || [...files].find(([k]) => k.toLowerCase() === path.toLowerCase())?.[1];
    if (!data) return null;
    const xml = new DOMParser().parseFromString(dec.decode(data), "application/xml");
    if (xml.getElementsByTagName("parsererror").length) throw new Error("Le modèle 3MF est illisible.");
    const root = xml.documentElement;
    const objects = new Map(); for (const o of kids(root, "object")) objects.set(attr(o, "id"), o);
    const d = { root, objects, unit: UNIT[attr(root, "unit") || "millimeter"] || 1 };
    docs.set(path, d); return d;
  };
  let main = "3D/3dmodel.model";
  const rels = [...files].find(([k]) => /^_rels\/\.rels$/i.test(k));
  if (rels) { const m = /Target="([^"]+\.model)"/i.exec(dec.decode(rels[1])); if (m) main = norm(m[1]); }
  if (!load(main)) { const any = [...files.keys()].find((k) => /^3D\/[^/]+\.model$/i.test(k)); if (!any) throw new Error("Aucun modèle 3D dans ce fichier."); main = any; load(main); }
  const top = docs.get(main);
  const out = [];
  // Ajoute les triangles d'un objet (et de ses composants), avec la transformation t.
  const emit = (path, id, t, acc, depth = 0) => {
    const d = load(path); const o = d?.objects.get(id); if (!o || depth > 16) return;
    const s = d.unit;
    const mesh = kids(o, "mesh")[0];
    if (mesh) {
      const vs = kids(mesh, "vertex"); const V = new Float64Array(vs.length * 3);
      vs.forEach((v, i) => {
        const x = +attr(v, "x") * s, y = +attr(v, "y") * s, z = +attr(v, "z") * s;
        V[i * 3] = x * t[0] + y * t[3] + z * t[6] + t[9];
        V[i * 3 + 1] = x * t[1] + y * t[4] + z * t[7] + t[10];
        V[i * 3 + 2] = x * t[2] + y * t[5] + z * t[8] + t[11];
      });
      for (const tr of kids(mesh, "triangle")) {
        const a = +attr(tr, "v1"), b = +attr(tr, "v2"), c = +attr(tr, "v3");
        if (a === b || b === c || a === c) continue;
        acc.push(V[a * 3], V[a * 3 + 1], V[a * 3 + 2], V[b * 3], V[b * 3 + 1], V[b * 3 + 2], V[c * 3], V[c * 3 + 1], V[c * 3 + 2]);
      }
    }
    const comps = o.getElementsByTagNameNS("*", "components")[0];
    if (comps) for (const c of kids(comps, "component")) {
      const p = attr(c, "path") ? norm(attr(c, "path")) : path;
      emit(p, attr(c, "objectid"), mul(parseT(attr(c, "transform")), t), acc, depth + 1);
    }
  };
  const build = kids(top.root, "build")[0];
  const items = build ? kids(build, "item") : [...top.objects.keys()].map((id) => ({ id }));
  for (const it of items) {
    const id = it.getAttribute ? attr(it, "objectid") : it.id;
    if (it.getAttribute && attr(it, "printable") === "0") continue;
    const acc = [];
    const p = it.getAttribute && attr(it, "path") ? norm(attr(it, "path")) : main;
    emit(p, id, it.getAttribute ? parseT(attr(it, "transform")) : ID, acc);
    if (!acc.length) continue;
    const o = load(p)?.objects.get(id);
    out.push({ name: (o && attr(o, "name")) || `Objet ${out.length + 1}`, tris: Float32Array.from(acc) });
  }
  if (!out.length) throw new Error("Ce fichier 3MF ne contient aucun objet.");
  return out;
}

// Recentre l'ensemble (posé sur z = 0, centré en x et y) puis fabrique un STL binaire par objet.
export function toStl(objs) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const o of objs) for (let i = 0; i < o.tris.length; i += 3) for (let k = 0; k < 3; k++) { const v = o.tris[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  const sh = [-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]];
  return objs.map((o) => {
    const nT = o.tris.length / 9; const buf = new ArrayBuffer(84 + nT * 50); const dv = new DataView(buf);
    dv.setUint32(80, nT, true);
    for (let t = 0; t < nT; t++) {
      const b = 84 + t * 50, q = t * 9;
      const P = [0, 1, 2].map((j) => [o.tris[q + j * 3] + sh[0], o.tris[q + j * 3 + 1] + sh[1], o.tris[q + j * 3 + 2] + sh[2]]);
      const u = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], v = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const L = Math.hypot(...n) || 1;
      dv.setFloat32(b, n[0] / L, true); dv.setFloat32(b + 4, n[1] / L, true); dv.setFloat32(b + 8, n[2] / L, true);
      for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) dv.setFloat32(b + 12 + j * 12 + k * 4, P[j][k], true);
    }
    return { name: o.name, stl: new Uint8Array(buf), count: nT };
  });
}

// ---- Allègement du maillage (réduction par erreur quadrique, d'après S. Forstmann) ----
// Un fichier d'impression peut compter des centaines de milliers de triangles : le noyau
// de CAO ne sait pas les modifier vite. On garde la forme en fusionnant les petits triangles.
export function indexMesh(tris) {
  const map = new Map(), V = [], F = [];
  const key = (x, y, z) => Math.round(x * 1e4) + "," + Math.round(y * 1e4) + "," + Math.round(z * 1e4);
  const id = (x, y, z) => { const k = key(x, y, z); let i = map.get(k); if (i === undefined) { i = V.length / 3; map.set(k, i); V.push(x, y, z); } return i; };
  for (let i = 0; i < tris.length; i += 9) {
    const a = id(tris[i], tris[i + 1], tris[i + 2]), b = id(tris[i + 3], tris[i + 4], tris[i + 5]), c = id(tris[i + 6], tris[i + 7], tris[i + 8]);
    if (a !== b && b !== c && a !== c) F.push(a, b, c);
  }
  return { V: Float64Array.from(V), F: Int32Array.from(F) };
}
export function simplify(tris, target) {
  const { V: V0, F: F0 } = indexMesh(tris);
  const nV = V0.length / 3, nT0 = F0.length / 3;
  if (nT0 <= target) return tris;
  const P = Array.from({ length: nV }, (_, i) => [V0[i * 3], V0[i * 3 + 1], V0[i * 3 + 2]]);
  const Q = Array.from({ length: nV }, () => new Float64Array(10));
  const vStart = new Int32Array(nV), vCount = new Int32Array(nV), border = new Uint8Array(nV);
  const T = [];
  for (let t = 0; t < nT0; t++) T.push({ v: [F0[t * 3], F0[t * 3 + 1], F0[t * 3 + 2]], err: [0, 0, 0, 0], del: false, dirty: false, n: [0, 0, 0] });
  let refs = [];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const det = (q, a11, a12, a13, a21, a22, a23, a31, a32, a33) => q[a11] * q[a22] * q[a33] + q[a13] * q[a21] * q[a32] + q[a12] * q[a23] * q[a31] - q[a13] * q[a22] * q[a31] - q[a11] * q[a23] * q[a32] - q[a12] * q[a21] * q[a33];
  const vErr = (q, x, y, z) => q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];
  const calcErr = (i, j, out) => {
    const q = new Float64Array(10); for (let k = 0; k < 10; k++) q[k] = Q[i][k] + Q[j][k];
    const bd = border[i] && border[j];
    const d = det(q, 0, 1, 2, 1, 4, 5, 2, 5, 7);
    if (d !== 0 && !bd) {
      out[0] = -1 / d * det(q, 1, 2, 3, 4, 5, 6, 5, 7, 8);
      out[1] = 1 / d * det(q, 0, 2, 3, 1, 5, 6, 2, 7, 8);
      out[2] = -1 / d * det(q, 0, 1, 3, 1, 4, 6, 2, 5, 8);
      return vErr(q, out[0], out[1], out[2]);
    }
    const p1 = P[i], p2 = P[j], p3 = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2];
    const e1 = vErr(q, ...p1), e2 = vErr(q, ...p2), e3 = vErr(q, ...p3);
    const m = Math.min(e1, e2, e3);
    const src = m === e1 ? p1 : m === e2 ? p2 : p3; out[0] = src[0]; out[1] = src[1]; out[2] = src[2];
    return m;
  };
  const updateMesh = (iter) => {
    if (iter > 0) { const keep = T.filter((t) => !t.del); T.length = 0; T.push(...keep); }
    vStart.fill(0); vCount.fill(0);
    for (const t of T) for (const v of t.v) vCount[v]++;
    let s = 0; for (let i = 0; i < nV; i++) { vStart[i] = s; s += vCount[i]; vCount[i] = 0; }
    refs = new Array(s);
    T.forEach((t, ti) => t.v.forEach((v, k) => { refs[vStart[v] + vCount[v]] = [ti, k]; vCount[v]++; }));
    if (iter === 0) {
      for (const t of T) {
        const n = nrm(crs(sub(P[t.v[1]], P[t.v[0]]), sub(P[t.v[2]], P[t.v[0]]))); t.n = n;
        const p = P[t.v[0]], d = -dt(n, p);
        const a = n[0], b = n[1], c = n[2];
        const pq = [a * a, a * b, a * c, a * d, b * b, b * c, b * d, c * c, c * d, d * d];
        for (const v of t.v) for (let k = 0; k < 10; k++) Q[v][k] += pq[k];
      }
      // bords (maillage ouvert) : on ne les déplace pas
      for (let i = 0; i < nV; i++) {
        const cnt = new Map();
        for (let r = vStart[i]; r < vStart[i] + vCount[i]; r++) for (const v of T[refs[r][0]].v) cnt.set(v, (cnt.get(v) || 0) + 1);
        for (const [v, c] of cnt) if (c === 1) { border[v] = 1; }
      }
      const tmp = [0, 0, 0];
      for (const t of T) { for (let j = 0; j < 3; j++) t.err[j] = calcErr(t.v[j], t.v[(j + 1) % 3], tmp); t.err[3] = Math.min(t.err[0], t.err[1], t.err[2]); }
    }
  };
  const flipped = (p, i1, v0, del) => {
    for (let r = vStart[v0]; r < vStart[v0] + vCount[v0]; r++) {
      const [ti, k] = refs[r]; const t = T[ti]; if (t.del) continue;
      const id1 = t.v[(k + 1) % 3], id2 = t.v[(k + 2) % 3];
      if (id1 === i1 || id2 === i1) { del[r - vStart[v0]] = 1; continue; }
      const d1 = nrm(sub(P[id1], p)), d2 = nrm(sub(P[id2], p));
      if (Math.abs(dt(d1, d2)) > 0.999) return true;
      const n = nrm(crs(d1, d2)); del[r - vStart[v0]] = 0;
      if (dt(n, t.n) < 0.2) return true;
    }
    return false;
  };
  let deleted = 0;
  const updateTris = (v0, vNew, del) => {
    const tmp = [0, 0, 0];
    for (let r = vStart[v0]; r < vStart[v0] + vCount[v0]; r++) {
      const [ti, k] = refs[r]; const t = T[ti]; if (t.del) continue;
      if (del[r - vStart[v0]]) { t.del = true; deleted++; continue; }
      t.v[k] = vNew; t.dirty = true;
      for (let j = 0; j < 3; j++) t.err[j] = calcErr(t.v[j], t.v[(j + 1) % 3], tmp);
      t.err[3] = Math.min(t.err[0], t.err[1], t.err[2]);
      refs.push([ti, k]);
    }
  };
  const p = [0, 0, 0];
  for (let iter = 0; iter < 100 && nT0 - deleted > target; iter++) {
    if (iter % 5 === 0) updateMesh(iter);
    for (const t of T) t.dirty = false;
    const thr = 1e-9 * Math.pow(iter + 3, 7);
    for (const t of T) {
      if (t.err[3] > thr || t.del || t.dirty) continue;
      for (let j = 0; j < 3; j++) {
        if (t.err[j] >= thr) continue;
        const i0 = t.v[j], i1 = t.v[(j + 1) % 3];
        if (border[i0] !== border[i1] || border[i0]) continue;
        calcErr(i0, i1, p);
        const d0 = new Uint8Array(vCount[i0]), d1 = new Uint8Array(vCount[i1]);
        if (flipped(p, i1, i0, d0) || flipped(p, i0, i1, d1)) continue;
        P[i0] = [p[0], p[1], p[2]];
        for (let k = 0; k < 10; k++) Q[i0][k] += Q[i1][k];
        const start = refs.length;
        updateTris(i0, i0, d0); updateTris(i1, i0, d1);
        const cnt = refs.length - start;
        vStart[i0] = start; vCount[i0] = cnt;
        break;
      }
      if (nT0 - deleted <= target) break;
    }
  }
  const out = [];
  for (const t of T) if (!t.del) for (const v of t.v) out.push(P[v][0], P[v][1], P[v][2]);
  return Float32Array.from(out);
}

// STL (binaire ou texte) → triangles.
export function readStl(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = u8.length >= 84 ? dv.getUint32(80, true) : 0;
  if (u8.length === 84 + n * 50) {
    const t = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) t[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true);
    return t;
  }
  const txt = new TextDecoder().decode(u8); const out = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g; let m;
  while ((m = re.exec(txt))) out.push(+m[1], +m[2], +m[3]);
  if (!out.length || out.length % 9) throw new Error("Fichier STL illisible.");
  return Float32Array.from(out);
}

// Triangles → STL binaire, tel quel (sans recentrage).
export function writeStl(tris) {
  const nT = Math.floor(tris.length / 9); const buf = new ArrayBuffer(84 + nT * 50); const dv = new DataView(buf);
  dv.setUint32(80, nT, true);
  for (let t = 0; t < nT; t++) {
    const b = 84 + t * 50, q = t * 9;
    const ux = tris[q + 3] - tris[q], uy = tris[q + 4] - tris[q + 1], uz = tris[q + 5] - tris[q + 2];
    const vx = tris[q + 6] - tris[q], vy = tris[q + 7] - tris[q + 1], vz = tris[q + 8] - tris[q + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(b, nx / L, true); dv.setFloat32(b + 4, ny / L, true); dv.setFloat32(b + 8, nz / L, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(b + 12 + k * 4, tris[q + k], true);
  }
  return new Uint8Array(buf);
}

// Coupe chaque triangle par le plan « coordonnée k = v » : après, aucun triangle ne traverse le plan.
export function splitAt(tris, k, v) {
  const out = []; const eps = 1e-5;
  // point d'un côté sur le plan, calculé toujours dans le même sens : deux triangles voisins trouvent les mêmes chiffres
  const cut = (p, q) => {
    const [a, b] = p[k] < q[k] ? [p, q] : [q, p];
    const t = (v - a[k]) / (b[k] - a[k]);
    const r = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; r[k] = v; return r;
  };
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const P = [[tris[i], tris[i + 1], tris[i + 2]], [tris[i + 3], tris[i + 4], tris[i + 5]], [tris[i + 6], tris[i + 7], tris[i + 8]]];
    const s = P.map((p) => (p[k] > v + eps ? 1 : p[k] < v - eps ? -1 : 0));
    if (!(s.includes(1) && s.includes(-1))) { out.push(...P[0], ...P[1], ...P[2]); continue; }
    const lo = [], hi = [];
    for (let j = 0; j < 3; j++) {
      const a = P[j], b = P[(j + 1) % 3], sa = s[j], sb = s[(j + 1) % 3];
      if (sa <= 0) lo.push(a);
      if (sa >= 0) hi.push(a);
      if (sa * sb < 0) { const c = cut(a, b); lo.push(c); hi.push(c); }
    }
    for (const poly of [lo, hi]) for (let j = 1; j + 1 < poly.length; j++) out.push(...poly[0], ...poly[j], ...poly[j + 1]);
  }
  return out;
}

// Allonge une zone le long de l'axe k : avant « a » rien ne bouge, entre « a » et « b » la matière
// s'étire, après « b » tout se décale d'un bloc. Les bouts (trous, clips, filets) gardent leur taille.
export function stretchZone(tris, k, a, b, add) {
  const t = splitAt(splitAt(tris, k, a), k, b); const f = (b - a + add) / (b - a);
  for (let i = k; i < t.length; i += 3) { const c = t[i]; t[i] = c <= a ? c : c >= b ? c + add : a + (c - a) * f; }
  return t;
}

// Plusieurs parties allongées en même temps. Chaque zone { k, a, b, add } est donnée dans le repère d'avant :
// le long de l'axe k, un point c devient c + la somme des « add » déjà franchis (en entier après b, en
// proportion entre a et b). Deux zones sur des axes différents ne se gênent pas.
export const zoneMap = (zones, k) => {
  const zs = zones.filter((z) => z.k === k);
  return (c) => { let o = c; for (const z of zs) o += z.add * Math.max(0, Math.min(1, (c - z.a) / (z.b - z.a))); return o; };
};
// L'inverse : où était, avant, le point qui se trouve maintenant en c (la fonction ci-dessus est croissante).
export const zoneUnmap = (zones, k) => {
  const f = zoneMap(zones, k), span = zones.filter((z) => z.k === k).reduce((t, z) => t + Math.abs(z.add), 0);
  return (c) => { if (!span) return c; let lo = c - span - 1, hi = c + span + 1; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) < c) lo = m; else hi = m; } return (lo + hi) / 2; };
};
export function stretchZones(tris, zones) {
  let t = tris;
  for (const z of zones) t = splitAt(splitAt(t, z.k, z.a), z.k, z.b);
  if (t === tris) t = Array.from(tris);
  for (let k = 0; k < 3; k++) {
    if (!zones.some((z) => z.k === k)) continue;
    const f = zoneMap(zones, k);
    for (let i = k; i < t.length; i += 3) t[i] = f(t[i]);
  }
  return t;
}

// Applique au maillage l'échelle puis les rotations autour du centre (comme le fait le noyau sur
// un solide) ; la pièce reste posée au même niveau. Renvoie les triangles et la boîte englobante.
export function bakeTris(src, sc, rot) {
  const t = Array.from(src, (v) => v * sc);
  const box = () => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < t.length; i++) { const c = i % 3; if (t[i] < lo[c]) lo[c] = t[i]; if (t[i] > hi[c]) hi[c] = t[i]; } return [lo, hi]; };
  let [lo, hi] = box();
  if (rot.some(Boolean)) {
    const z0 = lo[2]; const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
    const turn = (deg, u, w) => { // rotation dans le plan des axes u, w
      if (!deg) return; const r = deg * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
      for (let i = 0; i < t.length; i += 3) { const a = t[i + u] - c[u], b = t[i + w] - c[w]; t[i + u] = c[u] + a * co - b * si; t[i + w] = c[w] + a * si + b * co; }
    };
    turn(rot[0], 1, 2); turn(rot[1], 2, 0); turn(rot[2], 0, 1);
    [lo, hi] = box();
    const dz = z0 - lo[2]; if (Math.abs(dz) > 1e-9) { for (let i = 2; i < t.length; i += 3) t[i] += dz; lo[2] += dz; hi[2] += dz; }
  }
  return { tris: t, lo, hi };
}
