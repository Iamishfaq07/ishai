// The last step of `pnpm --filter @orbit/web build`, after `vite build` (the app, in dist/) and
// `vite build --ssr src/prerender/entry.tsx` (the public pages' render, in .prerender/): writes each public page as
// HTML, and the sitemap, into dist/. What's written and where: src/prerender/entry.tsx.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PAGE_META } from "../worker/meta.js";

const web = fileURLToPath(new URL("..", import.meta.url));
const dist = join(web, "dist");
const { buildSite } = await import(pathToFileURL(join(web, ".prerender", "entry.mjs")).href);
const template = readFileSync(join(dist, "index.html"), "utf8");
const files = await buildSite(template, PAGE_META, (message) => console.warn(`⚠ ${message}`));
let bytes = 0;
for (const { file, contents } of files) {
  const out = join(dist, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, contents);
  bytes += Buffer.byteLength(contents);
}
console.log(`prerender: ${files.length} files (${Math.round(bytes / 1024)} kB) written into dist/`);
