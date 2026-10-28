// The public pages built as HTML (entry.tsx): what a crawler that doesn't run JavaScript gets.
import "./shim"; // first: the pages read browser globals as their modules load
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PAGE_META } from "../../worker/meta.js";
import { routeKind } from "../../worker/routes.js";
import { canonicalLocation, robotsTxt } from "../../worker/seo.js";
import { BANK_DIR } from "../../questionBank";
import type { BankCompany, BankRole } from "../pages/bank/types";
import { ARTICLES } from "../pages/guides/articles";
import { POLICIES, workerFile } from "./routes";

const web = join(BANK_DIR, "..", "..", "..", "web");
const template = readFileSync(join(web, "index.html"), "utf8");
// robots.txt as the Worker writes it for the site's own address (worker/seo.js).
const robots = robotsTxt({}, new URL("https://orbitanswer.com/robots.txt"));
const companies = readdirSync(join(BANK_DIR, "companies")).map((f) => JSON.parse(readFileSync(join(BANK_DIR, "companies", f), "utf8")) as BankCompany);
const roles = readdirSync(join(BANK_DIR, "roles")).map((f) => JSON.parse(readFileSync(join(BANK_DIR, "roles", f), "utf8")) as BankRole);

let files = new Map<string, string>();
const warnings: string[] = [];

beforeAll(async () => {
  const { buildSite } = await import("./entry");
  files = new Map((await buildSite(template, PAGE_META, (m) => warnings.push(m))).map((f) => [f.file, f.contents]));
}, 120_000);

/** The page's words, as a crawler reads them: the built copy's text, tags and entities gone. */
function text(html: string): string {
  const page = html.slice(html.indexOf('<div id="prerender"'), html.indexOf('<div id="root">'));
  return page
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
const tag = (html: string, re: RegExp) => re.exec(html)?.[1] ?? "";
const jsonLd = (html: string) => JSON.parse(tag(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/)) as { "@graph": Array<Record<string, unknown>> };
const squash = (s: string) => s.replace(/\s+/g, " ");

/** robots.txt's verdict for a path: the longest matching rule wins, Allow on a tie; `$` ends a rule. */
function allowedByRobots(path: string): boolean {
  let best = { length: -1, allow: true };
  for (const line of robots.split("\n")) {
    const m = /^(allow|disallow):\s*(\S*)/i.exec(line.trim());
    if (!m || !m[2]) continue;
    const rule = m[2];
    const re = new RegExp(`^${rule.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}`);
    const allow = m[1]!.toLowerCase() === "allow";
    if (re.test(path) && (rule.length > best.length || (rule.length === best.length && allow))) best = { length: rule.length, allow };
  }
  return best.allow;
}

describe("the built public pages", () => {
  it("renders every page the Worker names and every guide, with no page left to the app", () => {
    expect(warnings).toEqual([]);
    for (const path of Object.keys(PAGE_META)) expect(files.has(workerFile(path)), path).toBe(true);
    for (const c of companies) expect(files.has(`companies/${c.slug}.html`), c.slug).toBe(true);
    for (const r of roles) expect(files.has(`roles/${r.slug}.html`), r.slug).toBe(true);
    expect(files.has("companies.html") && files.has("roles.html") && files.has("sitemap.xml")).toBe(true);
  });

  it("puts a company's whole guide in the HTML: heading, rounds, values, every question and what it covers", () => {
    for (const c of companies) {
      const html = files.get(`companies/${c.slug}.html`)!;
      const words = text(html);
      expect(squash(tag(html, /<h1[^>]*>([\s\S]*?)<\/h1>/).replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&")), c.slug).toBe(
        `${c.name} interview process and questions (${c.reviewed.slice(0, 4)})`,
      );
      for (const s of [c.summary, ...c.rounds, ...c.looks_for, ...c.tips]) expect(words, c.slug).toContain(squash(s));
      for (const q of c.questions) {
        expect(words, c.slug).toContain(squash(q.text));
        for (const point of q.covers) expect(words, q.text).toContain(squash(point));
      }
      // Practise it: the mock in its style and the free warm-up on these questions.
      expect(html).toContain(`href="/warmup?track=company%3A${c.slug}"`);
      expect(words).toContain(`not questions taken from them`);
    }
  });

  it("puts a role's guide in the HTML too", () => {
    for (const r of roles) {
      const words = text(files.get(`roles/${r.slug}.html`)!);
      expect(words).toContain(`${r.name} interview questions and what to expect`);
      for (const q of r.questions) expect(words, r.slug).toContain(squash(q.text));
    }
  });

  it("lists and links every guide from the two list pages", () => {
    const list = files.get("companies.html")!;
    for (const c of companies) expect(list, c.slug).toContain(`href="/companies/${c.slug}"`);
    const roleList = files.get("roles.html")!;
    for (const r of roles) expect(roleList, r.slug).toContain(`href="/roles/${r.slug}"`);
    expect(text(list)).toContain("Company interview guides");
  });

  it("gives each page its own title, description, canonical address and honest structured data", () => {
    for (const [file, html] of files) {
      if (!file.endsWith(".html")) continue;
      const title = tag(html, /<title>([^<]*)<\/title>/);
      const description = tag(html, /<meta name="description" content="([^"]*)"/);
      const canonical = tag(html, /<link rel="canonical" href="([^"]*)"/);
      expect(title.length, file).toBeGreaterThan(10);
      expect(title.length, file).toBeLessThanOrEqual(80);
      expect(description.length, file).toBeLessThanOrEqual(200);
      expect(canonical, file).toMatch(/^https:\/\/orbitanswer\.com\//);
      expect(tag(html, /<meta property="og:url" content="([^"]*)"/), file).toBe(canonical);
      const doc = jsonLd(html);
      const data = JSON.stringify(doc);
      expect(data, file).not.toMatch(/aggregateRating|"Review"|"offers"/); // nothing we can't stand behind
      // FAQ markup only where the page shows those exact questions and answers (D67, D79).
      const faq = doc["@graph"].find((n) => n["@type"] === "FAQPage") as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> } | undefined;
      if (faq) {
        const words = text(html);
        expect(faq.mainEntity.length, file).toBeGreaterThan(0);
        for (const q of faq.mainEntity) {
          expect(words, `${file}: ${q.name}`).toContain(squash(q.name));
          expect(words, `${file}: ${q.name}`).toContain(squash(q.acceptedAnswer.text));
        }
      }
      expect(html.indexOf('<div id="prerender"'), file).toBeLessThan(html.indexOf('<div id="root"></div>'));
      // The app starts after the page's first paint (public/app-start.js): listed, not loaded with the page.
      expect(html, file).not.toMatch(/<script type="module"|rel="modulepreload"/);
      expect(JSON.parse(tag(html, /<script type="application\/json" id="orbit-app">([^<]*)<\/script>/)), file).toEqual(["/src/main.tsx"]);
    }
    const amazon = files.get("companies/amazon.html")!;
    expect(tag(amazon, /<link rel="canonical" href="([^"]*)"/)).toBe("https://orbitanswer.com/companies/amazon");
    const crumbs = jsonLd(amazon)["@graph"].find((n) => n["@type"] === "BreadcrumbList") as { itemListElement: Array<{ name: string; item: string }> };
    expect(crumbs.itemListElement.map((i) => i.name)).toEqual(["Home", "Companies", "Amazon"]);
    expect(files.get("_prerender/warmup.html")).toContain("Interview Warmup");
  });

  it("builds every product page with the section kit, finished, for a reader without JavaScript (D79)", () => {
    for (const path of ["/resume-ai", "/jobs", "/linkedin-ai", "/interview-copilot", "/mock-interview"]) {
      const html = files.get(workerFile(path))!;
      const page = html.slice(html.indexOf('<div id="prerender"'), html.indexOf('<div id="root">'));
      const title = tag(html, /<title>([^<]*)<\/title>/);
      const description = tag(html, /<meta name="description" content="([^"]*)"/).replace(/&#x27;|&#39;/g, "'");
      expect(title.length, path).toBeLessThanOrEqual(60);
      expect(description.length, path).toBeGreaterThanOrEqual(120);
      expect(description.length, path).toBeLessThanOrEqual(160);
      expect(page.match(/<h1[\s>]/g)?.length, path).toBe(1);
      expect(page, path).toContain('aria-label="Breadcrumb"');
      // Every animated render is in its final frame: data-still keeps the CSS parts where they end.
      const renders = page.match(/<[a-z]+\s[^>]*\bclass="kp[ "][^>]*>/g) ?? [];
      expect(renders.length, path).toBeGreaterThanOrEqual(5);
      for (const r of renders) expect(r, path).toContain('data-still=""');
      // The sections: facts, three steps, the toolkit, the questions (with their markup) and the last word.
      const words = text(html);
      for (const s of ["Step 1", "Step 2", "Step 3", "Questions people ask first"]) expect(words, `${path}: ${s}`).toContain(s);
      for (const id of ["toolkit", "faq"]) expect(page, `${path}: #${id}`).toContain(`id="${id}"`);
      expect(page, path).toMatch(/<dl[^>]*>[\s\S]*?<dt/); // the facts band
      expect(jsonLd(html)["@graph"].map((n) => n["@type"]), path).toContain("FAQPage");
      expect(words, path).not.toMatch(/deepseek|guaranteed/i);
    }
  });

  it("keeps the hero's free line's room for the server's answer, without saying it (SameBox)", () => {
    for (const path of ["/", "/resume-ai", "/jobs", "/interview-copilot", "/mock-interview"]) {
      const html = files.get(workerFile(path))!;
      const hero = html.slice(html.indexOf('id="hero-title"'), html.indexOf("</section>", html.indexOf('id="hero-title"')));
      expect(hero, path).toContain('<div aria-hidden="true" class="invisible [grid-area:1/1]">');
      expect(hero, path).toMatch(/data-like="[^"]*\d/); // the answered form, numbers and all, sized but not text
      // What a reader gets is only what's true without the server.
      expect(text(html), path).not.toMatch(/A new account gets \d|each day you get \d|Your first AI action|from ₹\d|from \$\d|Free to start: \d/);
    }
  });

  it("leaves no empty cell in a product page's grids at any column count", () => {
    // Auto-placement as the browser does it (no dense packing): a card that doesn't fit the rest of a row moves on.
    const empty = (spans: number[], cols: number) => {
      let col = 0;
      let gaps = 0;
      for (const span of spans.map((s) => Math.min(s, cols))) {
        if (col + span > cols) [gaps, col] = [gaps + cols - col, 0];
        col = (col + span) % cols;
      }
      return gaps + (col ? cols - col : 0);
    };
    const spans = (classes: string[], wide: RegExp) => classes.map((c) => (wide.test(c) ? 2 : 1));
    for (const path of ["/resume-ai", "/jobs", "/linkedin-ai", "/interview-copilot", "/mock-interview"]) {
      const html = files.get(workerFile(path))!;
      const from = html.indexOf('id="toolkit"');
      const cards = [...html.slice(from, html.indexOf("</section>", from)).matchAll(/<li class="([^"]*\bmk-surface p-5[^"]*)"/g)].map((m) => m[1]!);
      expect(cards.length, path).toBeGreaterThanOrEqual(3);
      expect(empty(spans(cards, /\bmd:col-span-2\b/), 2), `${path}: the toolkit at md`).toBe(0);
      expect(empty(spans(cards, /\bmd:col-span-2\b/), 3), `${path}: the toolkit at lg`).toBe(0);
    }
    // LinkedIn's hero: its seven section bars in two columns (wideBars).
    const linkedin = files.get(workerFile("/linkedin-ai"))!;
    const at = linkedin.indexOf('aria-label="Your score by section"');
    const bars = [...linkedin.slice(at, linkedin.indexOf("</ul>", at)).matchAll(/<li class="(-mx-1\.5[^"]*)"/g)].map((m) => m[1]!);
    expect(bars.length).toBe(7);
    expect(empty(spans(bars, /\bsm:col-span-2\b/), 2), "the LinkedIn hero's section bars").toBe(0);
  });

  it("keeps each guide page light", () => {
    for (const [file, html] of files) if (file.startsWith("companies/") || file.startsWith("roles/")) expect(html.length, file).toBeLessThan(110_000);
  });
});

describe("the built sitemap and robots.txt", () => {
  const locs = () => [...files.get("sitemap.xml")!.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);

  it("lists every public page once, at the site's own address", () => {
    const all = locs();
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((l) => l.startsWith("https://orbitanswer.com/"))).toBe(true);
    expect(all.length).toBe(Object.keys(PAGE_META).length + 2 + companies.length + roles.length + 4);
    for (const path of ["/", "/warmup", "/companies", "/roles", "/companies/tcs", "/roles/nurse", "/privacy"]) {
      expect(all).toContain(`https://orbitanswer.com${path}`);
    }
    expect(all.some((l) => l.includes("_prerender") || l.endsWith(".html"))).toBe(false);
    expect(files.get("sitemap.xml")).toMatch(/<loc>https:\/\/orbitanswer\.com\/companies\/amazon<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    expect(files.get("sitemap.xml")).toContain("<loc>https://orbitanswer.com/privacy</loc><lastmod>");
  });

  it("names each page at the address the Worker serves it from, as a public page (no redirect, no 404)", () => {
    for (const l of locs()) {
      expect(routeKind(new URL(l).pathname), l).toBe("public");
      expect(canonicalLocation(new URL(l)), l).toBeNull();
    }
  });

  it("dates each policy as the page itself does", () => {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    for (const p of POLICIES) {
      const m = /Last updated (\d{1,2}) ([A-Z][a-z]+) (\d{4})/.exec(readFileSync(join(web, "public", p.file), "utf8"));
      expect(m, p.file).not.toBeNull();
      const shown = `${m![3]}-${String(months.indexOf(m![2]!) + 1).padStart(2, "0")}-${m![1]!.padStart(2, "0")}`;
      expect(p.lastmod, p.file).toBe(shown);
    }
  });

  it("lets crawlers read every page in it, and nothing signed in", () => {
    for (const l of locs()) expect(allowedByRobots(new URL(l).pathname), l).toBe(true);
    for (const p of ["/_prerender/home", "/mock", "/sessions", "/jobs/matches", "/resume-ai/abc", "/api/v1/me"]) expect(allowedByRobots(p), p).toBe(false);
  });
});

describe("the articles (/guides)", () => {
  it("builds every article, a draft with noindex and out of the sitemap", () => {
    const sitemap = files.get("sitemap.xml")!;
    for (const a of ARTICLES) {
      const html = files.get(`guides/${a.slug}.html`);
      expect(html, a.slug).toBeDefined();
      expect(html!.includes('<meta name="robots" content="noindex" />'), a.slug).toBe(!a.published);
      expect(sitemap.includes(`/guides/${a.slug}<`), a.slug).toBe(a.published);
      expect(text(html!), a.slug).toContain(squash(a.summary));
      const types = jsonLd(html!)["@graph"].map((n) => n["@type"]);
      expect(types, a.slug).toEqual(expect.arrayContaining(["Article", "BreadcrumbList", "Organization", "WebSite"]));
    }
    expect(files.has("guides.html")).toBe(true);
    expect(files.get("guides.html")!.includes('content="noindex"')).toBe(ARTICLES.every((a) => !a.published));
  });

  it("gives each article a title within 60 characters and a description of 120 to 160", () => {
    const titles = new Set<string>();
    for (const a of ARTICLES) {
      expect(a.title.length, a.slug).toBeLessThanOrEqual(60);
      expect(a.title.endsWith(" | Orbit"), a.slug).toBe(true);
      expect(a.description.length, a.slug).toBeGreaterThanOrEqual(120);
      expect(a.description.length, a.slug).toBeLessThanOrEqual(160);
      expect(a.reviewed, a.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      titles.add(a.title);
    }
    expect(titles.size).toBe(ARTICLES.length);
  });

  it("links only to pages that exist", () => {
    const paths = new Set([...files.keys()].filter((f) => f.endsWith(".html")).map((f) => `/${f.replace(/\.html$/, "")}`));
    const exists = (p: string) => paths.has(p) || p === "/" || Object.keys(PAGE_META).includes(p) || routeKind(p) === "app";
    for (const a of ARTICLES) {
      const inline = JSON.stringify(a.sections).match(/\]\((\/[^)\s]*)\)/g)?.map((m) => m.slice(2, -1)) ?? [];
      for (const p of [...inline, ...a.related.map((r) => r.to)]) expect(exists(p.split("?")[0]!), `${a.slug} -> ${p}`).toBe(true);
    }
  });
});
