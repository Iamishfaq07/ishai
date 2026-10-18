// Opens one app screen as the films do (dist/app.html on the recorded API and the virtual clock) and saves a picture,
// with the page's errors and any API request the fixtures don't answer. For building and checking scenes.
//
//   node tools/peek.mjs <path> <out.png> [--w 1280 --h 800 --ms 2000 --flow resume --config '{"script":[...]}' --dpr 1]
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "./render.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const [path, out] = args;
const { chromium } = await import(pathToFileURL(join(REPO, "node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs")).href);
const server = await serve();
const browser = await chromium.launch({ channel: "chrome", args: ["--mute-audio", "--hide-scrollbars"] });
const page = await browser.newPage({ viewport: { width: Number(opt("w", 1280)), height: Number(opt("h", 800)) }, deviceScaleFactor: Number(opt("dpr", 1)) });
page.on("pageerror", (e) => console.log("page error:", e.message));
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && console.log(`console.${m.type()}:`, m.text().slice(0, 400)));
const config = { theme: opt("theme", "light"), motion: "full", flow: opt("flow"), clean: true, ...JSON.parse(opt("config", "{}")) };
await page.addInitScript((name) => { window.name = name; }, JSON.stringify(config));
await page.goto(`http://127.0.0.1:${server.address().port}${path}`);
for (let i = 0; i < 300 && !(await page.evaluate(() => Boolean(window.__video?.ready?.())).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
await page.waitForTimeout(800);
const ms = Number(opt("ms", 2000));
for (let t = 0; t <= ms; t += 1000 / 60) {
  await page.evaluate((t) => { window.__video.tick(t); return window.__video.settle(1); }, t);
}
await page.screenshot({ path: out, fullPage: args.includes("--full") });
console.log("misses:", await page.evaluate(() => [...new Set(window.__video.misses)].join(" | ")));
console.log("text:", (await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\s+/g, " "));
await browser.close();
server.close();
