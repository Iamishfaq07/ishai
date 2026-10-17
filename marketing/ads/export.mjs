// Exports Orbit's ad creatives: templates/ad.html + ads.css, filled from copy.json, screenshotted in headless Chrome
// at each exact size. See README.md.
//
//   node marketing/ads/export.mjs                                  # all 42 PNGs, no prices
//   node marketing/ads/export.mjs --only copilot,banner --regions in --sizes 1080x1080
//   node marketing/ads/export.mjs --price-in 'copilot=₹1,649;practice=₹1,649;resume=₹499' --price-global 'copilot=$19.99'
//   node marketing/ads/export.mjs --prices-api https://api.orbitanswer.com   # read today's prices at export time
//   options: --html (keep the filled-in HTML in .build/ to preview)   --out <dir>   --chrome-path <exe>
//            --playwright <path to playwright-core's index.mjs>
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const list = (name) => opt(name, "")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

const COPY = JSON.parse(readFileSync(join(HERE, "copy.json"), "utf8"));
const OUT = resolve(opt("out", join(HERE, "out")));
const BUILD = join(HERE, ".build");
// Playwright from the repo (the root devDependency @playwright/test brings chromium); --playwright overrides.
const PW = opt("playwright", "@playwright/test");
// A path (./x, /x, C:/x, or with a backslash) is a file; anything else is a package name.
const { chromium } = await import(/^(\.|\/|[A-Za-z]:)|\\/.test(PW) ? pathToFileURL(resolve(PW)).href : PW);

const SIZES = [
  { format: "square", w: 1080, h: 1080, scale: 1 },
  { format: "portrait", w: 1080, h: 1350, scale: 1 },
  { format: "story", w: 1080, h: 1920, scale: 1 },
  { format: "landscape", w: 1200, h: 628, scale: 1 },
  // 1200 x 1200 is the square layout at 1.111x, so both squares match exactly.
  { format: "square", w: 1080, h: 1080, scale: 1200 / 1080, name: "1200x1200" },
];
const BANNER = { format: "banner", w: 1500, h: 500, scale: 1 };
const PRODUCTS = Object.keys(COPY.products);
const REGIONS = list("regions").length ? list("regions") : Object.keys(COPY.regions);
const only = list("only");
const sizes = list("sizes");
const sizeName = (s) => s.name ?? `${s.w}x${s.h}`;

// ─── Prices: never stored, only filled in at export ──────────────────────────────────────────────────────────────
function parsePrices(text) {
  const out = {};
  for (const part of (text ?? "").split(";").map((s) => s.trim()).filter(Boolean)) {
    const [k, ...v] = part.split("=");
    if (v.length) out[k.trim()] = v.join("=").trim();
    else for (const p of ["copilot", "practice", "resume"]) out[p] = part; // one price for every product that has one
  }
  return out;
}
const prices = { in: parsePrices(opt("price-in")), global: parsePrices(opt("price-global")) };
const api = opt("prices-api");
if (api) {
  // The public API prices by the caller's country: called from India it answers in rupees. A region whose currency
  // doesn't match what came back gets no price (pass --price-global for dollars).
  const packs = await (await fetch(`${api.replace(/\/$/, "")}/v1/billing/packs`)).json();
  const sell = packs.some((p) => p.buyable) ? packs.filter((p) => p.buyable) : packs;
  const cheapest = (pick) => sell.filter(pick).sort((a, b) => (a.price ?? a.price_inr) - (b.price ?? b.price_inr))[0];
  const interview = cheapest((p) => p.interview_minutes > 0);
  const resume = cheapest((p) => p.resume_credits > 0);
  const currency = (interview ?? resume)?.currency ?? "INR";
  const region = currency === "INR" ? "in" : "global";
  const text = (p) => p?.price_text ?? (p ? `₹${p.price_inr.toLocaleString("en-IN")}` : undefined);
  prices[region] = { copilot: text(interview), practice: text(interview), resume: text(resume), ...prices[region] };
  console.log(`prices from ${api} (${currency}) for "${region}":`, prices[region]);
}

// ─── Building one creative ───────────────────────────────────────────────────────────────────────────────────────
const TEMPLATE = readFileSync(join(HERE, "templates", "ad.html"), "utf8");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CHECK = '<svg width="0.95em" height="0.95em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const SHIELD = '<svg width="1.05em" height="1.05em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>';

function fill(vars) {
  return TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`template needs {{${k}}}`);
    return vars[k];
  });
}

function build(region, key, size) {
  const banner = key === "banner";
  const p = banner ? COPY.banner : COPY.products[key];
  const words = p[region];
  const dir = join(BUILD, region);
  const rel = (file) => relative(dir, file).replace(/\\/g, "/");
  const shot = (name) => rel(join(HERE, "..", "screens", "src", name));
  const theme = p.theme;
  const crop = (c) => `${c.x},${c.y},${c.w}`;
  const windows = banner
    ? [["w1", "copilot"]].map(([cls, k]) => {
        const src = COPY.products[k];
        return `<div class="window ${cls}" data-src="${shot(src.shot)}" data-crop="${crop(src.crop)}"></div>`;
      }).join("\n  ")
    : `<div class="window" data-src="${shot(p.shot)}" data-crop="${crop(p.crop)}"></div>`;
  const price = !banner && prices[region]?.[key] ? `<span class="price">${esc(COPY.regions[region].price.replace("{price}", prices[region][key]))}</span>` : "";
  return fill({
    lang: region === "in" ? "en-IN" : "en",
    title: esc(`Orbit ${banner ? "banner" : p.name} · ${region} · ${sizeName(size)}`),
    css: rel(join(HERE, "templates", "ads.css")),
    theme,
    format: size.format,
    color: banner ? "#7048F5" : p.color,
    windows,
    wordmark: rel(join(HERE, "..", "brand", `orbit-wordmark-${theme}.svg`)),
    productChip: banner ? "" : `<span class="product"><i></i>${esc(p.name)}</span>`,
    headline: esc(words.headline),
    subline: esc(words.subline),
    chips: !banner && words.chips?.length ? `<ul class="chips">${words.chips.map((c) => `<li>${CHECK}${esc(c)}</li>`).join("")}</ul>` : "",
    cta: esc(banner ? "Start free at orbitanswer.com" : COPY.cta),
    price,
    foot: esc(COPY.regions[region].foot),
    honest: p.honest ? `<p class="honest">${SHIELD}<span>${esc(p.honest)}</span></p>` : "",
  });
}

// ─── Rendering ───────────────────────────────────────────────────────────────────────────────────────────────────
const launch = { args: ["--allow-file-access-from-files"] };
if (opt("chrome-path")) launch.executablePath = opt("chrome-path");
else launch.channel = "chrome";
const browser = await chromium.launch(launch);
const made = [];
try {
  for (const region of REGIONS) {
    const jobs = [];
    for (const key of PRODUCTS) for (const s of SIZES) jobs.push([key, s]);
    jobs.push(["banner", BANNER]);
    for (const [key, size] of jobs) {
      if (only.length && !only.includes(key)) continue;
      if (sizes.length && !sizes.includes(sizeName(size))) continue;
      const html = build(region, key, size);
      const file = join(BUILD, region, `${key}-${sizeName(size)}.html`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, html);
      const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.scale });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(file).href);
      await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 15000 });
      const overflow = await page.evaluate(() => {
        // Text must never run past the canvas edge or under another block.
        const bad = [];
        for (const el of document.querySelectorAll("h1, .sub, .chips li, .cta, .foot, .honest, .price, .top")) {
          const r = el.getBoundingClientRect();
          if (r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5 || r.left < -0.5 || r.top < -0.5) bad.push(el.className || el.tagName);
        }
        return bad;
      });
      if (overflow.length) console.warn(`  ! ${region}/${key}-${sizeName(size)}: off the canvas: ${overflow.join(", ")}`);
      const out = join(OUT, region, `${key}-${sizeName(size)}.png`);
      mkdirSync(dirname(out), { recursive: true });
      await page.screenshot({ path: out });
      await ctx.close();
      made.push(out);
      console.log(`${relative(process.cwd(), out)}  ${Math.round(statSync(out).size / 1024)} KB`);
    }
  }
} finally {
  await browser.close();
  if (!flag("html")) rmSync(BUILD, { recursive: true, force: true });
}
console.log(`${made.length} creatives`);
