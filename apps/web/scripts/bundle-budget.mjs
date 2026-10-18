// The JS budget (docs/PERFORMANCE.md): after `vite build`, the gzipped JavaScript a first visit downloads, for the
// entry (every page pays it) and for each budgeted page (its chunk and everything that chunk imports beyond the
// entry), against the budgets below. Exits 1 when something is over. CI runs it after the build (`pnpm budget`).
//
// usage: node scripts/bundle-budget.mjs [dist=dist]
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** kB of gzip (level 9, as Cloudflare serves the assets): the entry alone, and each page's first load in total. */
export const BUDGETS = {
  entry: 160,
  css: 32,
  pages: {
    Home: 205, // the signed-in landing: the page everyone opens
    Landing: 200, // the front page, signed out
    Auth: 175, // sign-in and sign-up
    Sessions: 185,
    SessionSetup: 190,
    Mock: 195,
    Live: 240, // the live copilot
    Resumes: 200,
    ResumeEditor: 250,
    JobsAiPages: 270,
  },
};

const IMPORT = /(?:import|export)\s*(?:[^"'`;]*?from\s*)?["']\.\/([^"']+\.js)["']/g;

/** The built JS by file name: its source and gzipped size. */
export function readAssets(dist) {
  const dir = join(dist, "assets");
  const out = new Map();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".js") && !name.endsWith(".css")) continue;
    const code = readFileSync(join(dir, name));
    out.set(name, { code: code.toString("utf8"), gz: gzipSync(code, { level: 9 }).length });
  }
  return out;
}

/** A chunk and every chunk it imports, transitively (static imports only: lazy pages aren't first-load). */
export function closure(assets, name, seen = new Set()) {
  if (seen.has(name) || !assets.has(name)) return seen;
  seen.add(name);
  for (const m of assets.get(name).code.matchAll(IMPORT)) closure(assets, m[1], seen);
  return seen;
}

const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;
const sum = (assets, names) => [...names].reduce((a, n) => a + assets.get(n).gz, 0);

/** Every budget line: [what, measured kB, budget kB]. */
export function measure(dist, budgets = BUDGETS) {
  const assets = readAssets(dist);
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const entry = html.match(/<script[^>]+src="\/assets\/([^"]+\.js)"/)?.[1];
  if (!entry || !assets.has(entry)) throw new Error("no entry script in dist/index.html");
  const base = closure(assets, entry);
  const rows = [["entry (every page)", kb(sum(assets, base)), budgets.entry]];
  // The stylesheet(s) the page links up front (a lazy page's own CSS comes with it).
  const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/assets\/([^"]+\.css)"/g)]
    .map((m) => m[1])
    .filter((n) => assets.has(n));
  rows.push(["css", kb(sum(assets, css)), budgets.css]);
  for (const [page, budget] of Object.entries(budgets.pages)) {
    const file = [...assets.keys()].find((n) => n.startsWith(`${page}-`) && n.endsWith(".js"));
    if (!file) throw new Error(`no chunk for ${page}: renamed? update BUDGETS in scripts/bundle-budget.mjs`);
    const own = [...closure(assets, file)].filter((n) => !base.has(n));
    rows.push([page, kb(sum(assets, base) + sum(assets, own)), budget]);
  }
  return rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = process.argv[2] ?? join(fileURLToPath(new URL("..", import.meta.url)), "dist");
  const rows = measure(dist);
  let over = 0;
  for (const [what, got, budget] of rows) {
    const bad = got > budget;
    over += bad ? 1 : 0;
    console.log(`${bad ? "OVER" : "ok  "} ${what.padEnd(20)} ${String(got).padStart(7)} kB gzip  (budget ${budget})`);
  }
  if (over) {
    console.error(`\n${over} over budget. Lazy-load what the page doesn't need first, or raise the budget in`
      + " scripts/bundle-budget.mjs with the reason in docs/PERFORMANCE.md.");
    process.exit(1);
  }
}
