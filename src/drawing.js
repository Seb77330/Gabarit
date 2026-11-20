// Mise en plan : feuille A4/A3 avec vues projetées (projection européenne), cotes d'encombrement et cartouche.
const SCALES = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
const scaleLabel = (s) => (s >= 1 ? `${Math.round(s * 10) / 10} : 1` : `1 : ${Math.round(1 / s * 10) / 10}`.replace(".", ","));
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n1 = (v) => String(Math.round(v * 100) / 100).replace(".", ",");

export function sheetSVG(views, meta) {
  const [W, H] = meta.format === "A3" ? [420, 297] : [297, 210];
  const m = 10, tbW = 120, tbH = 36;
  const area = { x: m + 6, y: m + 6, w: W - 2 * m - 12, h: H - 2 * m - tbH - 14 };
  const size = (v) => (v ? { w: v.bounds[1][0] - v.bounds[0][0], h: v.bounds[1][1] - v.bounds[0][1] } : { w: 0, h: 0 });
  const F = size(views.front), T = size(views.top), Rt = size(views.right), I = size(views.iso);
  const gap = 22;
  let s = SCALES.find((sc) => {
    const w = (Rt.w + F.w) * sc + gap + 20;
    const hh = (Math.max(F.h, Rt.h) + T.h) * sc + gap + 24;
    return w <= area.w * (meta.iso ? 0.72 : 1) && hh <= area.h;
  }) || SCALES[SCALES.length - 1];
  if (meta.scale && meta.scale !== "auto") s = Number(meta.scale);
  const mainW = (Rt.w + F.w) * s + gap;
  const x0 = area.x + (meta.iso ? 14 : Math.max(10, (area.w - mainW) / 2));
  const rowH = Math.max(F.h, Rt.h) * s;
  const y0 = area.y + 14;
  // la perspective prend la place libre en haut à droite, à sa propre échelle
  const isoX = x0 + mainW + gap, isoW = area.x + area.w - isoX - 6, isoH = area.h * 0.6;
  const si = I.w ? Math.min(s, isoW / I.w, isoH / I.h) : s;
  const place = {
    right: [x0, y0 + (rowH - Rt.h * s) / 2],
    front: [x0 + Rt.w * s + gap, y0 + (rowH - F.h * s) / 2],
    top: [x0 + Rt.w * s + gap, y0 + rowH + gap],
    iso: [isoX + Math.max(0, (isoW - I.w * si) / 2), y0],
  };
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">`);
  out.push(`<rect width="${W}" height="${H}" fill="#fff"/><rect x="${m}" y="${m}" width="${W - 2 * m}" height="${H - 2 * m}" fill="none" stroke="#000" stroke-width="0.7"/>`);
  const drawView = (key, label, sc = s) => {
    const v = views[key]; if (!v) return;
    const s = sc;
    const [px, py] = place[key]; const b = v.bounds;
    const tr = `translate(${px - b[0][0] * s} ${py + b[1][1] * s}) scale(${s})`;
    out.push(`<g transform="${tr}" fill="none" stroke-linecap="round" stroke-linejoin="round">`);
    if (meta.hidden && key !== "iso") for (const d of v.hidden) out.push(`<path d="${d}" stroke="#555" stroke-width="0.25" stroke-dasharray="1.6 0.9" vector-effect="non-scaling-stroke"/>`);
    for (const d of v.visible) out.push(`<path d="${d}" stroke="#000" stroke-width="0.5" vector-effect="non-scaling-stroke"/>`);
    out.push(`</g>`);
    const sz = size(v);
    out.push(`<text x="${px + sz.w * s / 2}" y="${key === "front" ? py + sz.h * s + 6 : py - 3}" font-size="3" text-anchor="middle" fill="#333">${esc(label)}</text>`);
    return { x: px, y: py, w: sz.w * s, h: sz.h * s, rw: sz.w, rh: sz.h, b, s, v, P: (u, vv) => [px + (u - b[0][0]) * s, py + (b[1][1] - vv) * s] };
  };
  const dim = (x1, y1, x2, y2, off, value, vertical) => {
    // cote avec flèches, décalée de off (mm sur la feuille)
    const a = 1.6;
    if (!vertical) {
      const y = y1 + off;
      out.push(`<path d="M${x1} ${y1}V${y + Math.sign(off) * 1.5}M${x2} ${y2}V${y + Math.sign(off) * 1.5}" stroke="#000" stroke-width="0.18"/>`);
      out.push(`<path d="M${x1} ${y}H${x2}" stroke="#000" stroke-width="0.25"/><path d="M${x1} ${y}l${a} ${-a / 3}v${2 * a / 3}zM${x2} ${y}l${-a} ${-a / 3}v${2 * a / 3}z" fill="#000"/>`);
      out.push(`<text x="${(x1 + x2) / 2}" y="${y - 1}" font-size="3.2" text-anchor="middle">${n1(value)}</text>`);
    } else {
      const x = x1 + off;
      out.push(`<path d="M${x1} ${y1}H${x + Math.sign(off) * 1.5}M${x2} ${y2}H${x + Math.sign(off) * 1.5}" stroke="#000" stroke-width="0.18"/>`);
      out.push(`<path d="M${x} ${y1}V${y2}" stroke="#000" stroke-width="0.25"/><path d="M${x} ${y1}l${-a / 3} ${a}h${2 * a / 3}zM${x} ${y2}l${-a / 3} ${-a}h${2 * a / 3}z" fill="#000"/>`);
      out.push(`<text transform="translate(${x - 1} ${(y1 + y2) / 2}) rotate(-90)" font-size="3.2" text-anchor="middle">${n1(value)}</text>`);
    }
  };
  // Cotation automatique des trous : axes, diamètres et positions.
  function holeDims(list, vt, vf) {
    for (const V of list) {
      const cs = V.v.circles || []; if (!cs.length) continue;
      const groups = new Map();
      for (const c of cs) {
        const [X, Y] = V.P(c.u, c.v); const R = c.r * V.s;
        // axes de centrage
        out.push(`<path d="M${X - R - 1.5} ${Y}H${X + R + 1.5}M${X} ${Y - R - 1.5}V${Y + R + 1.5}" stroke="#000" stroke-width="0.13" stroke-dasharray="3 0.8 0.6 0.8"/>`);
        const k = (c.hole ? "h" : "b") + Math.round(c.r * 2000);
        if (!groups.has(k)) groups.set(k, { c, n: 0, X, Y, R }); groups.get(k).n++;
      }
      let i = 0;
      for (const g of groups.values()) {
        if (g.R < 0.6) continue;
        const ang = -Math.PI / 4; const sx = g.X + g.R * Math.cos(ang), sy = g.Y + g.R * Math.sin(ang);
        const ex = Math.max(sx + 6, V.x + V.w + 11), ey = Math.min(sy - 4, V.y + 4) + i * 5; i++;
        const label = `${g.n > 1 ? g.n + " × " : ""}⌀${n1(g.c.r * 2)}`;
        out.push(`<path d="M${sx} ${sy}L${ex} ${ey}H${ex + label.length * 1.75}" stroke="#000" stroke-width="0.2" fill="none"/><path d="M${sx} ${sy}l${1.4} ${-0.4}l${-0.6} ${1.2}z" fill="#000" transform="rotate(${-45} ${sx} ${sy})"/>`);
        out.push(`<text x="${ex + 0.5}" y="${ey - 0.8}" font-size="3">${esc(label)}</text>`);
      }
    }
    // positions des trous dans la vue qui en montre le plus (dessus, sinon face)
    const V = [vt, vf].filter(Boolean).sort((a, b) => (b.v.circles || []).filter((c) => c.hole).length - (a.v.circles || []).filter((c) => c.hole).length)[0];
    const holes = (V?.v.circles || []).filter((c) => c.hole); if (!holes.length) return;
    const uniq = (arr) => arr.sort((a, b) => a - b).filter((x, j, a) => j === 0 || Math.abs(x - a[j - 1]) > 1e-3);
    const b = V.b; const us = uniq(holes.map((c) => c.u)).filter((u) => Math.abs(u - b[0][0]) > 1e-3).slice(0, 4);
    const vs = uniq(holes.map((c) => c.v)).filter((v) => Math.abs(v - b[0][1]) > 1e-3).slice(0, 4);
    const [x0, yb] = V.P(b[0][0], b[0][1]);
    us.forEach((u, j) => { const [X] = V.P(u, 0); dim(x0, yb, X, yb, 7 + j * 5.5, u - b[0][0], false); });
    vs.forEach((v, j) => { const [, Y] = V.P(0, v); dim(x0, Y, x0, yb, -7 - j * 5.5, v - b[0][1], true); });
  }
  const vf = drawView("front", "Vue de face");
  const vt = drawView("top", "Vue de dessus");
  const vr = drawView("right", "Vue de droite");
  if (meta.iso) drawView("iso", si < s ? `Vue en perspective (${scaleLabel(si).replace(/,/g, "")})` : "Vue en perspective", si);
  if (meta.dims) {
    if (vf) { dim(vf.x, vf.y, vf.x + vf.w, vf.y, -7, vf.rw, false); }
    if (vf) dim(vf.x + vf.w, vf.y, vf.x + vf.w, vf.y + vf.h, 7, vf.rh, true);
    if (vt) dim(vt.x + vt.w, vt.y, vt.x + vt.w, vt.y + vt.h, 7, vt.rh, true);
  }
  if (meta.dims) holeDims([vf, vt, vr].filter(Boolean), vt, vf);
  // cartouche
  const tx = W - m - tbW, ty = H - m - tbH;
  out.push(`<g stroke="#000" stroke-width="0.35" fill="none"><rect x="${tx}" y="${ty}" width="${tbW}" height="${tbH}"/>
    <path d="M${tx} ${ty + 14}H${tx + tbW}M${tx} ${ty + 25}H${tx + tbW}M${tx + 60} ${ty + 14}V${ty + tbH}M${tx + 90} ${ty + 14}V${ty + tbH}"/></g>`);
  const t = (x, y, txt, sz = 2.6, w = "normal") => out.push(`<text x="${x}" y="${y}" font-size="${sz}" font-weight="${w}">${esc(txt)}</text>`);
  t(tx + 3, ty + 4.5, "Titre", 2.2); t(tx + 3, ty + 11, meta.title, 5, "bold");
  t(tx + 3, ty + 17.5, "Matière", 2.2); t(tx + 3, ty + 22.5, meta.material, 3);
  t(tx + 63, ty + 17.5, "Masse", 2.2); t(tx + 63, ty + 22.5, meta.mass, 3);
  t(tx + 93, ty + 17.5, "Échelle", 2.2); t(tx + 93, ty + 22.5, scaleLabel(s), 3, "bold");
  t(tx + 3, ty + 28.5, "Dessiné par", 2.2); t(tx + 3, ty + 33.5, meta.author || "", 3);
  t(tx + 63, ty + 28.5, "Date", 2.2); t(tx + 63, ty + 33.5, meta.date, 3);
  t(tx + 93, ty + 28.5, "Format", 2.2); t(tx + 93, ty + 33.5, `${meta.format} · mm`, 3);
  // symbole de projection européenne
  const sx = tx - 22, sy = ty + tbH - 12;
  out.push(`<g stroke="#000" stroke-width="0.3" fill="none"><path d="M${sx} ${sy + 2}L${sx + 8} ${sy}V${sy + 10}L${sx} ${sy + 8}Z"/><circle cx="${sx + 15}" cy="${sy + 5}" r="4.5"/><circle cx="${sx + 15}" cy="${sy + 5}" r="2"/></g>`);
  t(sx - 2, sy - 2, "Projection européenne", 2);
  t(m + 2, H - m - 2, "Réalisé avec Gabarit", 2);
  out.push(`</svg>`);
  return { svg: out.join("\n"), scale: s, W, H };
}
