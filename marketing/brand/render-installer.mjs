// Renders the Windows installer's two bitmaps from the brand (DECISIONS D77) in headless Chrome:
//   apps/desktop/src-tauri/windows/installer/header.bmp   150 x 57: the wordmark on white, at the header's right
//   apps/desktop/src-tauri/windows/installer/sidebar.bmp  164 x 314: the mark on the app icon's ink, for the
//                                                         Welcome and Finish pages
// NSIS takes only BMP. Both are written as 8-bit palette BMPs (a median-cut palette of the art's own colours,
// uncompressed: RLE bitmaps don't load everywhere), about a third of 24-bit's size; the installer LZMA-compresses
// them again. Text is Segoe UI, the installer's own face, so the bitmaps sit with its words.
// usage (repo root, Node 22+): node marketing/brand/render-installer.mjs   (needs playwright and system Chrome)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const out = join(repo, "apps/desktop/src-tauri/windows/installer");
const { chromium } = await import(process.env.PLAYWRIGHT ?? "@playwright/test");
const clean = (f) => readFileSync(join(here, f), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const wordmarkLight = clean("orbit-wordmark-light.svg");
const markDark = clean("orbit-mark-dark.svg");

const page = (w, h, body) => `<!doctype html><html><head><style>
  html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; }
  body { font-family: "Segoe UI", system-ui, sans-serif; }
  /* Greyscale smoothing: ClearType's coloured fringes would be baked into the bitmap. */
  .text { filter: grayscale(1); }
</style></head><body>${body}</body></html>`;

const HEADER = page(150, 57, `
  <div style="width:150px;height:57px;background:#fff;display:flex;align-items:center;justify-content:flex-end;padding-right:12px;box-sizing:border-box">
    ${wordmarkLight.replace("<svg ", '<svg width="92" height="29" ')}
  </div>`);

// The app icon's tile (marketing/brand/render-icons.mjs): ink from #18202E into #0B0F17, the mark on it, and two
// faint orbits; under it what Orbit is and where it lives on the web (the page beside it says "Welcome to Orbit").
const SIDEBAR = page(164, 314, `
  <div style="position:relative;width:164px;height:314px;background:linear-gradient(160deg,#18202E 0%,#0B0F17 70%);color:#fff;overflow:hidden">
    <svg width="164" height="314" viewBox="0 0 164 314" style="position:absolute;inset:0" fill="none">
      <ellipse cx="82" cy="98" rx="70" ry="26" stroke="#ffffff" stroke-opacity=".07" transform="rotate(-18 82 98)"/>
      <ellipse cx="82" cy="98" rx="56" ry="56" stroke="#ffffff" stroke-opacity=".05"/>
      <circle cx="140" cy="76" r="2.2" fill="#A48BFA" fill-opacity=".7"/>
      <circle cx="26" cy="128" r="1.4" fill="#ffffff" fill-opacity=".35"/>
      <circle cx="120" cy="150" r="1" fill="#ffffff" fill-opacity=".3"/>
    </svg>
    <div style="position:absolute;left:0;right:0;top:62px;display:flex;justify-content:center">
      ${markDark.replace("<svg ", '<svg width="72" height="72" ')}
    </div>
    <div class="text" style="position:absolute;left:14px;right:14px;top:162px;text-align:center">
      <div style="font-size:15px;font-weight:600;line-height:1.3">Your interview copilot</div>
      <div style="margin-top:6px;font-size:11.5px;line-height:1.4;color:#C3C8D4">Practice, Resume AI, Jobs AI and more on the web</div>
    </div>
    <div class="text" style="position:absolute;left:16px;right:16px;bottom:18px;text-align:center;font-size:11px;color:#8A93A6">orbitanswer.com</div>
  </div>`);

/** RGBA pixels of the page as drawn (a screenshot, decoded in the page). */
async function pixels(browser, html, w, h) {
  const tab = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await tab.setContent(html);
  const png = await tab.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
  const data = await tab.evaluate(async ({ b64, w, h }) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    return Array.from(ctx.getImageData(0, 0, w, h).data);
  }, { b64: png.toString("base64"), w, h });
  await tab.close();
  return Uint8Array.from(data);
}

/** Median cut: up to `max` colours that cover the image, each the mean of its box. */
function palette(rgba, max = 256) {
  const counts = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const colours = [...counts].map(([k, n]) => ({ c: [(k >> 16) & 255, (k >> 8) & 255, k & 255], n }));
  if (colours.length <= max) return colours.map((x) => x.c);
  let boxes = [colours];
  while (boxes.length < max) {
    let best = -1;
    let bestRange = -1;
    let axis = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let a = 0; a < 3; a++) {
        let lo = 255;
        let hi = 0;
        for (const x of box) {
          lo = Math.min(lo, x.c[a]);
          hi = Math.max(hi, x.c[a]);
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo;
          best = i;
          axis = a;
        }
      }
    });
    if (best < 0) break;
    const box = boxes[best].sort((p, q) => p.c[axis] - q.c[axis]);
    const total = box.reduce((s, x) => s + x.n, 0);
    let run = 0;
    let cut = 1;
    for (; cut < box.length - 1; cut++) {
      run += box[cut - 1].n;
      if (run >= total / 2) break;
    }
    boxes = [...boxes.slice(0, best), box.slice(0, cut), box.slice(cut), ...boxes.slice(best + 1)];
  }
  return boxes.map((box) => {
    const n = box.reduce((s, x) => s + x.n, 0);
    return [0, 1, 2].map((a) => Math.round(box.reduce((s, x) => s + x.c[a] * x.n, 0) / n));
  });
}

/** An 8-bit palette BMP (BITMAPINFOHEADER, bottom-up rows, BI_RGB). */
function bmp8(rgba, w, h) {
  const pal = palette(rgba);
  const nearest = new Map();
  const index = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let i = nearest.get(key);
    if (i === undefined) {
      let d = Infinity;
      pal.forEach((p, j) => {
        const e = (p[0] - r) ** 2 * 2 + (p[1] - g) ** 2 * 4 + (p[2] - b) ** 2 * 3;
        if (e < d) {
          d = e;
          i = j;
        }
      });
      nearest.set(key, i);
    }
    return i;
  };
  const stride = (w + 3) & ~3;
  const offset = 14 + 40 + 256 * 4;
  const buf = Buffer.alloc(offset + stride * h);
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(offset, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(8, 28);
  buf.writeUInt32LE(0, 30); // BI_RGB
  buf.writeUInt32LE(stride * h, 34);
  buf.writeInt32LE(2835, 38); // 72 dpi
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(256, 46);
  buf.writeUInt32LE(0, 50);
  pal.forEach((p, j) => {
    const o = 54 + j * 4;
    buf[o] = p[2];
    buf[o + 1] = p[1];
    buf[o + 2] = p[0];
  });
  for (let y = 0; y < h; y++) {
    const row = offset + (h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[row + x] = index(rgba[i], rgba[i + 1], rgba[i + 2]);
    }
  }
  return buf;
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
for (const [name, html, w, h] of [
  ["header.bmp", HEADER, 150, 57],
  ["sidebar.bmp", SIDEBAR, 164, 314],
]) {
  const file = join(out, name);
  const data = bmp8(await pixels(browser, html, w, h), w, h);
  writeFileSync(file, data);
  console.log(`${file} ${w}x${h} ${data.length} bytes`);
}
await browser.close();
