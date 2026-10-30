// The JS budget (docs/PERFORMANCE.md): after `vite build`, the gzipped JavaScript a first visit downloads, for the
// entry (every page pays it) and for each budgeted page (its chunk and everything that chunk imports beyond the
// entry), against the budgets below. Exits 1 when something is over. CI runs it after the build (`pnpm budget`).
//
// usage: node scripts/bundle-budget.mjs [dist=dist]
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** kB of gzip (level 9, as Cloudflare serves the assets): the entry alone, and each page's first load in total. Set
 *  about 5% over what main measured on 18 Oct 2026 (docs/PERFORMANCE.md), so a real jump fails and a few lines don't. */
export const BUDGETS = {
  // +1 kB for D80: the API client's direct route; +1 kB for D84: Orbit Apply's chunk in the preload map, its two
  // routes and tab (its own calls stay in its chunk, through the client's generic `call`) (docs/PERFORMANCE.md).
  // 30 Oct 2026: 171.0 → 161.4, the sign-in pages (pages/Auth.tsx) out of the entry; nobody signed in needs them.
  entry: 164,
  // Shared workspace switch and interactive tool cards: 32.4 kB measured; 34.3 kB on 29 Oct 2026 (docs/PERFORMANCE.md).
  css: 35,
  pages: {
    // +1 kB each for D79 (docs/PERFORMANCE.md): the product pages' shared pieces became chunks of their own, and each
    // chunk's name is in the entry's preload map (+0.3 kB on every first load); Landing shares the live answer and
    // the sticky bar with them, Mock its one-tap rounds with /mock-interview.
    // +1 kB on the signed-in pages for D82 (docs/PERFORMANCE.md): Orbit for Business's routes and its one loader in
    // the entry (+0.3 kB), and the table's sort arrow became a chunk of its own, shared with the business app. The
    // business app itself is lazy and in nobody's first load.
    Home: 213,
    CareerSpaces: 213, // shared workspace switch and discovery link; see docs/PERFORMANCE.md
    // The front page, signed out. +1 kB for SameBox (0.5 kB): its free line keeps its room until the server answers
    // (CLS 0; docs/PERFORMANCE.md).
    Landing: 208, // public workspace switch and tools navigation
    // 29 Oct 2026: Sessions, Live, Resumes, the editor, Jobs AI and the tool explorer to their measured size plus ~1.5%,
    // after the entry fell 14 kB (docs/PERFORMANCE.md: the workspace tool catalog and the empty-state scenes).
    Sessions: 204, // +1 kB for D80, through the entry; +1 kB for D82
    SessionSetup: 201,
    Mock: 207,
    // The live copilot; the video room (D69, ~14 kB) loads only for a video interview (D73). +1 kB for D80 and D76's
    // natural voice that holds (the retry, sayNaturalLine, voiceSetup).
    Live: 252, // shared navigation/preload map only; agent and explorer remain lazy
    Resumes: 222,
    // 30 Oct 2026: 271.2 → 242.5 (scoreTone from ./product, not the Resume home page; Interview prep loads when opened).
    ResumeEditor: 246,
    // 30 Oct 2026: Jobs AI's section, and its own pages as chunks of their own (Matches, a listing, the tracker,
    // outreach, the profile), so the Jobs home no longer downloads all five. The section was 295.6 kB with them.
    // Each page also loads the section (about 1.6 kB more) alongside; its line here is the page's chunk over the entry.
    JobsAiPages: 186,
    Matches: 238,
    JobDetail: 259,
    Tracker: 228,
    Outreach: 214,
    Profile: 200,
    // Orbit Apply's setup and Applications (D84), a lazy chunk of their own under Jobs AI's section.
    AutoApplyPages: 194, // 193.1 measured with captured posting and AI reviewer entry; see PERFORMANCE.md
    ToolExplorer: 195, // public feature catalog and interactive workflow, loaded on demand
    Journey: 210, // application agent controls and shortlist; loaded on demand
    // The public product pages (D79), signed out: the section kit and each page's own renders, lazy chunks.
    ResumeAiPublic: 226, // with the prices (PricingSection) and the real resume renderer
    JobsAiPublic: 209,
    CopilotPublic: 212, // with the live answer and the real code block
    PracticePublic: 207,
    LinkedInPublic: 207,
    // Orbit for Business (D82): its public page, signed out (through its small router chunk), and the careers pages.
    BusinessLanding: 203,
    CareersPages: 195,
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
