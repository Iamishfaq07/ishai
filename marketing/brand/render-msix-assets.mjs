// Renders the Microsoft Store (MSIX) package's tile and icon assets from the Orbit mark, in headless Chrome, into
// apps/desktop/src-tauri/windows/msix/Assets/ (scripts/package-msix.ps1 copies them into the package and indexes them
// with makepri, so Windows picks the right scale and size).
//
// Three looks, all from marketing/brand/orbit-mark-dark.svg on the front door's ink (#18202E into #0B0F17):
//   app   - the app icon itself: the rounded tile, as in orbit-app-icon-1024.png and the exe's icon.ico. Used where
//           Windows shows the icon as-is: the taskbar, Start's lists, Alt+Tab (Square44x44Logo targetsize-*
//           altform-unplated / altform-lightunplated) and the package logo (StoreLogo).
//   mark  - the mark alone on transparent, for the "plated" variants Windows draws on the manifest's BackgroundColor
//           (the same ink), so they look like the tile too.
//   tile  - full-bleed ink with the mark in the middle: Windows 10's Start tiles (small, medium, wide, large).
//
// Sizes follow Microsoft's app icon guidance: scale-100/125/150/200/400 for every asset, and the targetsize set for
// the app list icon (16-256, plated, unplated and light-unplated).
// usage (repo root, Node 22+): node marketing/brand/render-msix-assets.mjs   (needs playwright-core and system Chrome)
import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const outDir = join(repo, "apps/desktop/src-tauri/windows/msix/Assets");
const { chromium } = await import(process.env.PLAYWRIGHT ?? "@playwright/test");
const mark = readFileSync(join(here, "orbit-mark-dark.svg"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const INK = "linear-gradient(160deg,#18202E 0%,#0B0F17 70%)";

/** `w`x`h` px; the mark is `scale` of the shorter side; `radius` a fraction of it (0 = square); `bg` or transparent. */
function html(w, h, scale, radius, bg) {
  const m = Math.round(Math.min(w, h) * scale);
  return `<!doctype html><html><body style="margin:0;background:transparent">
  <div style="width:${w}px;height:${h}px;border-radius:${radius * Math.min(w, h)}px;overflow:hidden;
    background:${bg ?? "transparent"};display:grid;place-items:center">
    <div style="width:${m}px;height:${m}px">${mark.replace("<svg ", `<svg width="${m}" height="${m}" `)}</div>
  </div></body></html>`;
}

const looks = {
  app: (w, h) => html(w, h, w <= 24 ? 0.64 : 0.6, 0.22, INK),
  mark: (w, h, scale) => html(w, h, scale, 0, null),
  tile: (w, h, scale) => html(w, h, scale, 0, INK),
};

const SCALES = [100, 125, 150, 200, 400];
const TARGET_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256];
const jobs = []; // [file, width, height, look, markScale]
const scaled = (name, w, h, look, s) => {
  for (const sc of SCALES) jobs.push([`${name}.scale-${sc}.png`, Math.round((w * sc) / 100), Math.round((h * sc) / 100), look, s]);
};
scaled("Square44x44Logo", 44, 44, "mark", 0.7); // app list, on the BackgroundColor plate
for (const t of TARGET_SIZES) {
  jobs.push([`Square44x44Logo.targetsize-${t}.png`, t, t, "mark", 0.8]);
  jobs.push([`Square44x44Logo.targetsize-${t}_altform-unplated.png`, t, t, "app"]);
  jobs.push([`Square44x44Logo.targetsize-${t}_altform-lightunplated.png`, t, t, "app"]); // the tile reads on light too
}
scaled("Square71x71Logo", 71, 71, "tile", 0.55); // small tile
scaled("Square150x150Logo", 150, 150, "tile", 0.5); // medium tile (the name shows under the mark)
scaled("Wide310x150Logo", 310, 150, "tile", 0.5); // wide tile
scaled("Square310x310Logo", 310, 310, "tile", 0.4); // large tile
scaled("StoreLogo", 50, 50, "app"); // package logo: Settings > Apps, App Installer

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const tmp = join(here, ".msix-tmp.html");
for (const [file, w, h, look, s] of jobs) {
  await page.setViewportSize({ width: w, height: h });
  writeFileSync(tmp, looks[look](w, h, s));
  await page.goto(pathToFileURL(tmp).href);
  await page.screenshot({ path: join(outDir, file), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}
await browser.close();
unlinkSync(tmp);
console.log(`${jobs.length} assets in ${outDir}`);
