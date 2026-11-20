// Formats de maillage (OBJ, 3MF) et petit écrivain ZIP sans compression.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zipStore(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
  for (const [name, data] of files) {
    const nb = enc.encode(name); const d = typeof data === "string" ? enc.encode(data) : data; const crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, d);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + d.length;
  }
  const csize = central.reduce((s, a) => s + a.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: "application/zip" });
}
const f6 = (v) => (Math.round(v * 1e6) / 1e6).toString();
export function objText(m, name) {
  const out = [`# ${name} - Gabarit`, `o ${name.replace(/\s+/g, "_")}`];
  for (let i = 0; i < m.vertices.length; i += 3) out.push(`v ${f6(m.vertices[i])} ${f6(m.vertices[i + 1])} ${f6(m.vertices[i + 2])}`);
  for (let i = 0; i < m.triangles.length; i += 3) out.push(`f ${m.triangles[i] + 1} ${m.triangles[i + 1] + 1} ${m.triangles[i + 2] + 1}`);
  return new Blob([out.join("\n") + "\n"], { type: "text/plain" });
}
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
// meshes : [{ name, vertices, triangles, color }]
export function threeMF(meshes) {
  const objs = meshes.map((m, k) => {
    const v = []; for (let i = 0; i < m.vertices.length; i += 3) v.push(`<vertex x="${f6(m.vertices[i])}" y="${f6(m.vertices[i + 1])}" z="${f6(m.vertices[i + 2])}"/>`);
    const t = []; for (let i = 0; i < m.triangles.length; i += 3) t.push(`<triangle v1="${m.triangles[i]}" v2="${m.triangles[i + 1]}" v3="${m.triangles[i + 2]}"/>`);
    return `<object id="${k + 1}" name="${esc(m.name)}" type="model"><mesh><vertices>${v.join("")}</vertices><triangles>${t.join("")}</triangles></mesh></object>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="fr-FR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Gabarit</metadata><resources>${objs.join("")}</resources><build>${meshes.map((_, k) => `<item objectid="${k + 1}"/>`).join("")}</build></model>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  const b = zipStore([["[Content_Types].xml", types], ["_rels/.rels", rels], ["3D/3dmodel.model", model]]);
  return new Blob([b], { type: "model/3mf" });
}
