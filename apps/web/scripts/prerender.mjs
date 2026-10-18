// The last step of `pnpm --filter @orbit/web build`, after `vite build` (the app, in dist/) and
// `vite build --ssr src/prerender/entry.tsx` (the public pages' render, in .prerender/): writes each public page as
// HTML, and the sitemap, into dist/. What's written and where: src/prerender/entry.tsx.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PAGE_META } from "../worker/meta.js";

const web = fileURLToPath(new URL("..", import.meta.url));
const dist = join(web, "dist");
const { buildSite } = await import(pathToFileURL(join(web, ".prerender", "entry.mjs")).href);
const template = readFileSync(join(dist, "index.html"), "utf8");
// The built pages' first paint is drawn in IBM Plex Sans (latin), so they preload it (src/prerender/document.ts); the
// app's own pages don't (src/fonts.css).
const fonts = readdirSync(join(dist, "assets")).filter((name) => /^ibm-plex-sans-latin-wght-normal-[\w-]+\.woff2$/.test(name));
if (fonts.length !== 1) throw new Error(`prerender: expected one IBM Plex Sans latin font in dist/assets, found ${fonts.length}`);
const files = await buildSite(template, PAGE_META, (message) => console.warn(`⚠ ${message}`), { fonts: [`/assets/${fonts[0]}`] });
let bytes = 0;
for (const { file, contents } of files) {
  const out = join(dist, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, contents);
  bytes += Buffer.byteLength(contents);
}
console.log(`prerender: ${files.length} files (${Math.round(bytes / 1024)} kB) written into dist/`);
