// Renders Orbit's app icons from the mark (marketing/brand/orbit-mark-dark.svg) in headless Chrome:
//   apps/web/public/apple-touch-icon.png (180, full square: iOS rounds it), icon-192.png, icon-512.png (rounded tile),
//   icon-maskable-512.png (full bleed, the mark inside Android's 80% safe zone), and
//   marketing/brand/orbit-app-icon-1024.png, the master for the desktop app (`pnpm --filter @orbit/desktop exec tauri icon <it>`).
// The tile is the front door's ink (#0B0F17 into #141B27), no stars, no glow; the mark keeps its brand gradient.
// usage (repo root, Node 22+): node marketing/brand/render-icons.mjs   (needs playwright-core and system Chrome)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const mark = readFileSync(join(here, "orbit-mark-dark.svg"), "utf8").replace(/<!--[\s\S]*?-->/g, "");

/** A tile `size` px square; the mark is `scale` of it; `radius` as a fraction (0 = square). */
function tile(size, scale, radius) {
  const m = Math.round(size * scale);
  return `<!doctype html><html><body style="margin:0;background:transparent">
  <div style="width:${size}px;height:${size}px;border-radius:${radius * size}px;overflow:hidden;
    background:linear-gradient(160deg,#18202E 0%,#0B0F17 70%);display:grid;place-items:center">
    <div style="width:${m}px;height:${m}px">${mark.replace("<svg ", `<svg width="${m}" height="${m}" `)}</div>
  </div></body></html>`;
}

const out = [
  [join(repo, "apps/web/public/apple-touch-icon.png"), 180, 0.62, 0],
  [join(repo, "apps/web/public/icon-192.png"), 192, 0.6, 0.22],
  [join(repo, "apps/web/public/icon-512.png"), 512, 0.6, 0.22],
  [join(repo, "apps/web/public/icon-maskable-512.png"), 512, 0.5, 0],
  [join(here, "orbit-app-icon-1024.png"), 1024, 0.6, 0.22],
];
const browser = await chromium.launch({ channel: "chrome" });
for (const [file, size, scale, radius] of out) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const html = join(here, ".icon-tmp.html");
  writeFileSync(html, tile(size, scale, radius));
  await page.goto(pathToFileURL(html).href);
  await page.screenshot({ path: file, omitBackground: radius > 0, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log(file);
}
await browser.close();
const { unlinkSync } = await import("node:fs");
unlinkSync(join(here, ".icon-tmp.html"));
