const { chromium } = require("playwright"); const fs = require("fs");
(async () => {
  const b = await chromium.launch(); const svg = fs.readFileSync("web/icon.svg", "utf8");
  for (const s of [192, 512]) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    const pad = Math.round(s * 0.1);
    await p.setContent(`<html><body style="margin:0;background:#1d2733;display:grid;place-items:center;height:${s}px">${svg.replace("<svg ", `<svg width="${s - pad * 2}" height="${s - pad * 2}" `)}</body></html>`);
    await p.screenshot({ path: `web/icon-${s}.png` });
  }
  await b.close();
})();
