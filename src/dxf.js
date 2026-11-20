// Export DXF (format R12, lisible partout) d'une esquisse : découpe laser, CNC, autres logiciels 2D.
import { evalEntity, outline } from "./geo.js";
const n = (v) => (Math.round(v * 1e6) / 1e6).toString();
function polyline(out, pts, closed, layer, bulges) {
  out.push("0", "POLYLINE", "8", layer, "66", "1", "70", closed ? "1" : "0", "10", "0", "20", "0", "30", "0");
  pts.forEach((p, i) => { out.push("0", "VERTEX", "8", layer, "10", n(p[0]), "20", n(p[1]), "30", "0"); if (bulges?.[i]) out.push("42", n(bulges[i])); });
  out.push("0", "SEQEND", "8", layer);
}
export function sketchDXF(entities, vars) {
  const out = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", "2",
    "0", "LAYER", "2", "CONTOUR", "70", "0", "62", "7", "6", "CONTINUOUS",
    "0", "LAYER", "2", "CONSTRUCTION", "70", "0", "62", "8", "6", "DASHED", "0", "ENDTAB", "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES"];
  for (const e of entities) {
    const o = evalEntity(e, vars); const layer = o.construction ? "CONSTRUCTION" : "CONTOUR";
    if (o.type === "point") { out.push("0", "POINT", "8", layer, "10", n(o.cx), "20", n(o.cy), "30", "0"); continue; }
    if (o.type === "text") { const t = [...o.txt].map((ch) => (ch.charCodeAt(0) < 128 ? ch : "\\U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0"))).join(""); out.push("0", "TEXT", "8", layer, "10", n(o.cx), "20", n(o.cy), "30", "0", "40", n(o.h), "1", t, "50", n(o.a || 0)); continue; }
    if (o.type === "circle") { out.push("0", "CIRCLE", "8", layer, "10", n(o.cx), "20", n(o.cy), "30", "0", "40", n(o.d / 2)); continue; }
    if (o.type === "poly" || o.type === "path") {
      const closed = o.type === "poly";
      if (closed && o.r > 0) { polyline(out, outline(o), true, layer); continue; }
      // flèche s (à gauche = positive) -> renflement DXF (positif = sens trigo, bombé à droite) : tan(angle/4) = 2s / corde
      const bul = o.pts.map((p, i) => { const q = o.pts[(i + 1) % o.pts.length]; const c = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return p[2] ? (-2 * p[2]) / c : 0; });
      polyline(out, o.pts, closed, layer, bul); continue;
    }
    if (o.type === "slot") {
      const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1), r = o.w / 2, ux = (o.x2 - o.x1) / L, uy = (o.y2 - o.y1) / L, px = -uy * r, py = ux * r;
      polyline(out, [[o.x1 + px, o.y1 + py], [o.x2 + px, o.y2 + py], [o.x2 - px, o.y2 - py], [o.x1 - px, o.y1 - py]], true, layer, [0, -1, 0, -1]); continue;
    }
    if (o.type === "spline") { polyline(out, outline(o), !!o.closed, layer); continue; }
    if (o.type === "rect" && !(o.r > 0)) { polyline(out, outline(o), true, layer); continue; }
    polyline(out, outline(o), true, layer);
  }
  out.push("0", "ENDSEC", "0", "EOF");
  return new Blob([out.join("\r\n") + "\r\n"], { type: "application/dxf" });
}
