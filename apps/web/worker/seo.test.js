import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import worker from "./index.js";
import { APP_ROUTES, PUBLIC_APP_PAGES, POLICY_PAGES, isFixedAddress, movedPath, routeKind } from "./routes.js";
import {
  BLOCKED_CRAWLERS,
  SEARCH_CRAWLERS,
  SECURITY_TXT_EXPIRES,
  TRAINING_CRAWLERS,
  canonicalLocation,
  headAdditions,
  robotsTxt,
} from "./seo.js";
import { breadcrumbs, jsonLdText, structuredDataFor } from "./site.js";
import { faqsFor } from "./faqs.js";

const SITE = "https://orbitanswer.com";
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ---------------------------------------------------------------- a stand-in for Cloudflare's assets

const SHELL = '<!doctype html><html lang="en"><head><title>Orbit AI</title><link rel="canonical" href="https://orbitanswer.com/" /></head><body><div id="root"></div></body></html>';
/** The built files, as `not_found_handling: "none"` + `html_handling: "drop-trailing-slash"` serve them. */
const FILES = {
  "/": [SHELL, "text/html"],
  "/privacy": ["<html><head><title>Orbit privacy policy</title></head><body><h1>Privacy</h1></body></html>", "text/html"],
  "/companies/tcs": ["<html><head><title>TCS interview guide</title></head><body><h1>TCS</h1></body></html>", "text/html"],
  "/llms.txt": ["# Orbit AI\n", "text/plain"],
  "/favicon.ico": ["ico", "image/x-icon"],
};
const assets = {
  async fetch(input) {
    const url = new URL(typeof input === "string" ? input : input.url);
    const file = FILES[url.pathname];
    if (!file) return new Response(null, { status: 404 });
    return new Response(file[0], { status: 200, headers: { "content-type": file[1], etag: '"abc"' } });
  },
};
const ENV = { API_URL: "https://api.example", ASSETS: assets };
const get = (path, { host = "orbitanswer.com", method = "GET", protocol = "https:", env = ENV } = {}) =>
  worker.fetch(new Request(`${protocol}//${host}${path}`, { method }), env);

// ---------------------------------------------------------------- robots.txt, read the way Google reads it

function parseRobots(txt) {
  const groups = [];
  let current = null;
  let agentRun = false;
  const sitemaps = [];
  for (const raw of txt.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "user-agent") {
      if (!agentRun) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(m[2].toLowerCase());
      agentRun = true;
      continue;
    }
    agentRun = false;
    if (key === "sitemap") sitemaps.push(m[2]);
    else if (key === "allow" || key === "disallow") current.rules.push({ allow: key === "allow", path: m[2] });
  }
  return { groups, sitemaps };
}
/** Google: the group naming the crawler (else "*"); the longest matching rule wins, Allow on a tie. */
function allowed(robots, agent, path) {
  const a = agent.toLowerCase();
  const group = robots.groups.find((g) => g.agents.includes(a)) ?? robots.groups.find((g) => g.agents.includes("*"));
  let best = null;
  for (const r of group?.rules ?? []) {
    const anchored = r.path.endsWith("$");
    const body = (anchored ? r.path.slice(0, -1) : r.path).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    if (!new RegExp(`^${body}${anchored ? "$" : ""}`).test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

// ---------------------------------------------------------------- addresses

describe("canonicalLocation (one address per page)", () => {
  const at = (u) => canonicalLocation(new URL(u), {});
  it("sends www and plain http to https://orbitanswer.com, keeping the path and query", () => {
    expect(at("https://www.orbitanswer.com/jobs?utm_source=x")).toBe(`${SITE}/jobs?utm_source=x`);
    expect(at("http://orbitanswer.com/warmup")).toBe(`${SITE}/warmup`);
    expect(at("http://www.orbitanswer.com/")).toBe(`${SITE}/`);
  });

  it("drops trailing slashes, doubled slashes, .html and /index", () => {
    expect(at(`${SITE}/jobs/`)).toBe(`${SITE}/jobs`);
    expect(at(`${SITE}//warmup`)).toBe(`${SITE}/warmup`);
    expect(at(`${SITE}/privacy.html`)).toBe(`${SITE}/privacy`);
    expect(at(`${SITE}/index.html`)).toBe(`${SITE}/`);
    expect(at(`${SITE}/companies/tcs.html`)).toBe(`${SITE}/companies/tcs`);
  });

  it("fixes a trailing slash and .html or /index together, in one hop", () => {
    expect(at(`${SITE}/privacy.html/`)).toBe(`${SITE}/privacy`);
    expect(at(`${SITE}/index.html/`)).toBe(`${SITE}/`);
    expect(at(`${SITE}/index`)).toBe(`${SITE}/`);
    expect(at(`${SITE}/companies/index.html`)).toBe(`${SITE}/companies`);
    expect(at(`${SITE}/Companies/TCS.HTML/`)).toBe(`${SITE}/companies/tcs`);
  });

  it("folds only the fixed part of an address that ends in an id, and leaves percent-escapes alone", () => {
    expect(at(`${SITE}/Resume-AI/AbC`)).toBe(`${SITE}/resume-ai/AbC`);
    expect(at(`${SITE}/Jobs/Listing/Xy9`)).toBe(`${SITE}/jobs/listing/Xy9`);
    expect(at(`${SITE}/R/FRIEND10`)).toBe(`${SITE}/r/FRIEND10`);
    expect(at(`${SITE}/Resume-Maker`)).toBe(`${SITE}/resume-ai`);
    expect(at(`${SITE}/Documents/Resumes/AbC`)).toBe(`${SITE}/resume-ai/AbC`);
    expect(at(`${SITE}/Resume-AI/Jobs/Tracker`)).toBe(`${SITE}/jobs/tracker`);
    expect(at(`${SITE}/companies/caf%C3%A9`)).toBeNull();
  });

  it("always lands on an address that needs no further redirect", () => {
    for (const p of ["/Jobs/", "/privacy.html/", "//Warmup//", "/Resume-AI/AbC/", "/Documents/Resumes/", "/resume-ai/jobs/Tracker/", "/INDEX.HTML", "/r/abc/", "/Companies/Infosys.html"]) {
      const first = at(`${SITE}${p}`);
      expect(first, p).not.toBeNull();
      expect(at(first), `${p} -> ${first}`).toBeNull();
    }
  });

  it("folds fixed addresses to lower case, never an id", () => {
    expect(at(`${SITE}/Resume-AI`)).toBe(`${SITE}/resume-ai`);
    expect(at(`${SITE}/Companies/TCS`)).toBe(`${SITE}/companies/tcs`);
    expect(at(`${SITE}/LOGIN`)).toBe(`${SITE}/login`);
    expect(at(`${SITE}/resume-ai/AbC123`)).toBeNull();
    expect(at(`${SITE}/jobs/listing/Xy9`)).toBeNull();
    expect(at(`${SITE}/r/FRIEND10`)).toBeNull();
  });

  it("moves the old resume maker and Jobs addresses, as the app does", () => {
    expect(at(`${SITE}/resume-maker`)).toBe(`${SITE}/resume-ai`);
    expect(at(`${SITE}/documents/resumes`)).toBe(`${SITE}/resume-ai`);
    expect(at(`${SITE}/documents/resumes/r1`)).toBe(`${SITE}/resume-ai/r1`);
    expect(at(`${SITE}/resume-ai/jobs`)).toBe(`${SITE}/jobs/matches`);
    expect(at(`${SITE}/resume-ai/jobs?view=tracker&q=1`)).toBe(`${SITE}/jobs/tracker?q=1`);
    expect(at(`${SITE}/resume-ai/jobs/tracker/`)).toBe(`${SITE}/jobs/tracker`);
    expect(movedPath("/resume-ai/jobsearch")).toBeNull();
  });

  it("leaves a canonical address alone (no redirect loops)", () => {
    for (const p of ["/", "/jobs", "/resume-ai", "/warmup?x=1", "/sessions/abc", "/companies/tcs"]) expect(at(`${SITE}${p}`)).toBeNull();
    expect(canonicalLocation(new URL("http://127.0.0.1:5187/"), {})).toBeNull();
  });
});

describe("routeKind (which addresses are pages)", () => {
  it("knows the public pages, the app's pages and invite links", () => {
    for (const p of [...PUBLIC_APP_PAGES, ...POLICY_PAGES, "/companies", "/companies/tcs", "/roles/data-analyst"]) expect(routeKind(p)).toBe("public");
    for (const p of ["/login", "/sessions", "/sessions/s1", "/live/s1", "/resume-ai/r1", "/jobs/matches", "/jobs/listing/l1", "/jobs/alerts/off", "/admin/users", "/code/two-sum", "/extension/connect"]) {
      expect(routeKind(p)).toBe("app");
    }
    expect(routeKind("/r/FRIEND10")).toBe("referral");
    expect(routeKind("/admin/referrals")).toBe("app"); // any admin page, including ones other branches add
  });

  it("calls everything else not a page", () => {
    for (const p of ["/prices", "/mock-interviews", "/interview-copilots", "/jobsearch", "/jobs/nope", "/sessions/a/b", "/admin", "/wp-login.php", "/llms.txt", "/companiesx"]) {
      expect(routeKind(p)).toBeNull();
    }
    expect(isFixedAddress("/resume-ai/x")).toBe(false);
  });

  it("covers every route in the router (App.tsx)", () => {
    const app = read("../src/App.tsx");
    // Top-level `path="/x"` routes, and the signed-in layout's child routes (`path="x"`), with sample ids.
    const routePaths = (text) => [...text.matchAll(/<Route\s+(?:index\s+)?path="([^"]+)"/g)].map((m) => m[1]);
    const start = app.indexOf('<Route path="jobs"');
    const jobsChildren = routePaths(app.slice(start, app.indexOf("</Route>", start))).filter((p) => p !== "jobs");
    expect(jobsChildren).toContain("matches");
    const paths = routePaths(app).filter((p) => !jobsChildren.includes(p) || p === "*");
    let checked = 0;
    // Routes that exist only in development builds (`{DevOnly && <Route …>}`, e.g. the component gallery): a 404 in
    // production is right for them.
    const devOnly = new Set([...app.matchAll(/\{\s*\w+\s*&&\s*<Route\s+path="([^"]+)"/g)].map((m) => m[1]));
    for (const raw of [...paths, ...jobsChildren.filter((p) => p !== "*").map((p) => `jobs/${p}`)]) {
      if (raw === "*" || raw === "jobs" || devOnly.has(raw)) continue;
      const path = `/${raw.replace(/^\//, "").replace(/:[A-Za-z]+/g, "sample1").replace(/\/\*$/, "")}`;
      const kind = routeKind(path);
      const moved = movedPath(path);
      expect(kind !== null || moved !== null, `${raw} is in App.tsx but routes.js doesn't know it`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
    expect(APP_ROUTES.length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------- status codes and headers

describe("the Worker's answers", () => {
  it("answers an address that isn't a page with a real 404, the app's page and noindex", async () => {
    for (const p of ["/this-page-does-not-exist", "/companies/no-such-company", "/prices"]) {
      const res = await get(p);
      expect(res.status, p).toBe(404);
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      expect(await res.text()).toContain('id="root"'); // the app still draws its own "not found"
    }
  });

  it("never serves the prerender's built copies at their own address (they'd duplicate the pages)", async () => {
    FILES["/_prerender/home"] = [SHELL, "text/html"];
    try {
      const res = await get("/_prerender/home");
      expect(res.status).toBe(404);
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
    } finally {
      delete FILES["/_prerender/home"];
    }
  });

  it("answers a missing file with a short plain 404", async () => {
    const res = await get("/wp-login.php");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("serves the app's own pages with 200 and noindex", async () => {
    for (const p of ["/login", "/sessions", "/resume-ai/r1", "/jobs/matches", "/live/s1", "/r/FRIEND10"]) {
      const res = await get(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("x-robots-tag"), p).toBe("noindex");
      expect(await res.text()).toContain('id="root"');
    }
  });

  it("serves public pages with 200 and no robots header, from the built file or the app", async () => {
    for (const p of ["/", "/privacy", "/companies/tcs", "/resume-ai", "/jobs", "/warmup"]) {
      const res = await get(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("x-robots-tag"), p).toBeNull();
    }
  });

  it("redirects with one permanent 301", async () => {
    const res = await get("/Jobs/", { host: "www.orbitanswer.com", protocol: "http:" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${SITE}/jobs`);
  });

  it("leaves the API proxy alone", async () => {
    let seen = null;
    const env = { ...ENV, API_URL: "https://api.example" };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (req) => ((seen = req), new Response("{}", { status: 401, headers: { "content-type": "application/json" } }));
    try {
      const res = await get("/api/v1/me/", { env });
      expect(res.status).toBe(401);
      expect(new URL(seen.url).pathname).toBe("/v1/me/");
      expect(res.headers.get("x-robots-tag")).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("says UTF-8 for text files", async () => {
    const res = await get("/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("marks every answer on another host (a preview, workers.dev) noindex", async () => {
    for (const p of ["/", "/privacy", "/llms.txt"]) {
      const res = await get(p, { host: "abc123-orbit.example.workers.dev" });
      expect(res.headers.get("x-robots-tag"), p).toBe("noindex");
    }
    const robots = await (await get("/robots.txt", { host: "abc123-orbit.example.workers.dev" })).text();
    expect(robots).toMatch(/User-agent: \*\nDisallow: \/\n/);
  });

  it("answers HEAD like GET, without a body", async () => {
    const res = await get("/no-such-page", { method: "HEAD" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });
});

// ---------------------------------------------------------------- robots.txt

describe("robots.txt", () => {
  const robots = parseRobots(robotsTxt({}, new URL(`${SITE}/robots.txt`)));

  it("is served as text with the sitemap", async () => {
    const res = await get("/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(robots.sitemaps).toEqual([`${SITE}/sitemap.xml`, `${SITE}/sitemap-jobs.xml`]);
  });

  it("lets every search and answer crawler read every public page and the files pages need", () => {
    for (const bot of ["Googlebot", "Bingbot", "Some-New-Bot", ...SEARCH_CRAWLERS]) {
      for (const p of [...PUBLIC_APP_PAGES, ...POLICY_PAGES, "/companies", "/companies/tcs", "/roles/java-developer", "/llms.txt", "/sitemap.xml", "/assets/index-abc.js", "/assets/index.css", "/favicon.ico", "/og-image.jpg", "/mock-interview", "/linkedin-profile-tips"]) {
        expect(allowed(robots, bot, p), `${bot} ${p}`).toBe(true);
      }
    }
  });

  it("keeps crawlers out of the API and the signed-in app, but not sign-in or invite links", () => {
    for (const p of ["/api/v1/me", "/sessions", "/sessions/s1", "/start", "/start?type=coding", "/jobs/matches", "/jobs/alerts/off?token=x", "/resume-ai/r1", "/billing", "/admin/users", "/live/s1", "/mock", "/companion?code=1"]) {
      expect(allowed(robots, "Googlebot", p), p).toBe(false);
    }
    for (const p of ["/login", "/register", "/r/FRIEND10", "/jobs", "/resume-ai"]) expect(allowed(robots, "Googlebot", p), p).toBe(true);
  });

  it("lets a rendering crawler make the API calls public pages draw from, and no others", () => {
    for (const p of ["/api/v1/plans", "/api/v1/billing/packs", "/api/v1/billing/monthly", "/api/v1/jobs/stats", "/api/v1/region", "/api/v1/public/engineering-telemetry", "/api/v1/auth/me"]) {
      expect(allowed(robots, "Googlebot", p), p).toBe(true);
    }
    for (const p of ["/api/v1/auth/me/region", "/api/v1/sessions", "/api/v1/resumes", "/api/v1/admin/users", "/api/v1/auth/login"]) {
      expect(allowed(robots, "Googlebot", p), p).toBe(false);
    }
  });

  it("names every AI crawler, with training crawlers welcome by default and blockable by one setting", () => {
    for (const bot of [...SEARCH_CRAWLERS, ...TRAINING_CRAWLERS]) expect(robots.groups[0].agents).toContain(bot.toLowerCase());
    for (const bot of BLOCKED_CRAWLERS) expect(allowed(robots, bot, "/"), bot).toBe(false);
    const blocked = parseRobots(robotsTxt({ AI_TRAINING_CRAWLERS: "block" }, new URL(`${SITE}/robots.txt`)));
    for (const bot of TRAINING_CRAWLERS) expect(allowed(blocked, bot, "/"), bot).toBe(false);
    for (const bot of SEARCH_CRAWLERS) expect(allowed(blocked, bot, "/warmup"), bot).toBe(true);
  });
});

// ---------------------------------------------------------------- head tags and structured data

describe("headAdditions", () => {
  it("adds what a page lacks: canonical, hreflang, preview tags, structured data", () => {
    const add = headAdditions("/privacy", { og: {}, title: "Orbit privacy policy", description: "What Orbit keeps" }, {});
    expect(add).toContain(`<link rel="canonical" href="${SITE}/privacy" />`);
    expect(add).toContain(`hreflang="x-default" href="${SITE}/privacy"`);
    expect(add).toContain(`<meta property="og:title" content="Orbit privacy policy" />`);
    expect(add).toContain('<meta name="twitter:card"');
    expect(add).toContain('<script type="application/ld+json">');
  });

  it("keeps a page's own canonical for the alternates, and counts an empty preview tag as stated", () => {
    const seen = { canonical: true, canonicalHref: `${SITE}/companies/tcs`, og: { "og:image": "" }, title: "TCS &amp; you &#8217;26" };
    const add = headAdditions("/companies/tcs", seen, { SITE_ORIGIN: "http://127.0.0.1:5187" });
    expect(add).toContain(`hreflang="en" href="${SITE}/companies/tcs"`);
    expect(add).not.toContain("og:image");
    expect(add).toContain("content=\"TCS &amp; you ’26\"");
  });

  it("ignores a SITE_ORIGIN that isn't an address", () => {
    expect(canonicalLocation(new URL(`${SITE}/jobs`), { SITE_ORIGIN: "not a url" })).toBeNull();
  });

  it("adds nothing a page already states", () => {
    const seen = { canonical: true, hreflang: true, jsonLd: true, twitterCard: true, og: { "og:type": 1, "og:site_name": 1, "og:url": 1, "og:title": 1, "og:description": 1, "og:image": 1 }, title: "x" };
    expect(headAdditions("/companies/tcs", seen, {})).toBe("");
  });

  it("writes the search engines' verification codes on the front page only, when set", () => {
    const env = { GOOGLE_SITE_VERIFICATION: "g-code", BING_SITE_VERIFICATION: "b\"code" };
    const home = headAdditions("/", { og: {}, title: "" }, env);
    expect(home).toContain('<meta name="google-site-verification" content="g-code" />');
    expect(home).toContain('<meta name="msvalidate.01" content="b&quot;code" />');
    expect(home).not.toContain("yandex-verification");
    expect(headAdditions("/jobs", { og: {}, title: "" }, env)).not.toContain("verification");
  });
});

describe("structured data (site.js)", () => {
  const walk = (node, visit) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
    if (node && typeof node === "object") {
      visit(node);
      Object.values(node).forEach((v) => walk(v, visit));
    }
  };

  it("describes the front page with the organisation, the site and both apps", () => {
    const types = structuredDataFor("/", { title: "Orbit AI", description: "d" })["@graph"].map((n) => n["@type"]);
    expect(types).toEqual(["Organization", "WebSite", "WebPage", "WebApplication", "SoftwareApplication"]);
  });

  it("never states ratings, reviews or prices, and only valid JSON", () => {
    for (const p of ["/", ...PUBLIC_APP_PAGES, ...POLICY_PAGES]) {
      const doc = structuredDataFor(p, { title: "t", description: "d" });
      if (!doc) continue;
      expect(JSON.parse(jsonLdText(doc))).toEqual(JSON.parse(JSON.stringify(doc)));
      walk(doc, (n) => {
        for (const banned of ["aggregateRating", "review", "offers", "price"]) expect(n[banned], `${p} ${banned}`).toBeUndefined();
      });
    }
  });

  it("describes the pricing page and the copilot's and Practice's pages, with breadcrumbs (D73)", () => {
    const types = (p) => structuredDataFor(p, { title: "t", description: "d" })["@graph"].map((n) => n["@type"]);
    expect(types("/pricing")).toEqual(["Organization", "WebSite", "WebPage", "BreadcrumbList"]);
    expect(types("/interview-copilot")).toEqual(["Organization", "WebSite", "WebPage", "WebApplication", "BreadcrumbList", "FAQPage"]);
    expect(types("/mock-interview")).toEqual(["Organization", "WebSite", "WebPage", "WebApplication", "BreadcrumbList", "FAQPage"]);
  });

  it("states a product page's questions as FAQ markup only where the page shows them, word for word (D79)", () => {
    for (const p of ["/resume-ai", "/jobs", "/linkedin-ai", "/interview-copilot", "/mock-interview"]) {
      const faq = structuredDataFor(p, { title: "t", description: "d" })["@graph"].find((n) => n["@type"] === "FAQPage");
      expect(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]), p).toEqual(faqsFor(p).map(([q, a]) => [q, a]));
      expect(faq["@id"]).toBe(`${SITE}${p}#faq`);
      for (const [q, a] of faqsFor(p)) {
        expect(q.length + a.length, q).toBeGreaterThan(40);
        expect(`${q} ${a}`, q).not.toMatch(/[<>]|deepseek|undetectable|guaranteed/i);
      }
    }
    // Pages without a visible FAQ get none.
    for (const p of ["/", "/pricing", "/warmup", "/contact", "/technical"]) {
      expect(structuredDataFor(p, { title: "t", description: "d" })["@graph"].map((n) => n["@type"]), p).not.toContain("FAQPage");
    }
  });

  it("numbers breadcrumbs from 1 and escapes '<' so no value can end the script", () => {
    expect(breadcrumbs([["Home", "/"], ["Jobs AI", "/jobs"]]).itemListElement.map((i) => i.position)).toEqual([1, 2]);
    expect(jsonLdText({ name: "</script><b>" })).not.toContain("</script>");
  });
});

// ---------------------------------------------------------------- the public files crawlers read

// The sitemap is built with the site now: src/prerender/prerender.test.ts checks it against routeKind and canonicalLocation.
describe("llms.txt and llms-full.txt", () => {
  for (const file of ["llms.txt", "llms-full.txt"]) {
    it(`${file} follows the llms.txt format and links only to public pages`, () => {
      const text = read(`../public/${file}`);
      expect(text.startsWith("# ")).toBe(true);
      expect(text).toMatch(/\n> \S/);
      expect(text).toMatch(/\n## \S/);
      const links = [...text.matchAll(/^- \[[^\]]+\]\((https:\/\/[^)\s]+)\)/gm)].map((m) => new URL(m[1]));
      expect(links.length).toBeGreaterThan(5);
      for (const u of links) {
        expect(u.origin).toBe(SITE);
        expect(routeKind(u.pathname) === "public" || /^\/llms(-full)?\.txt$/.test(u.pathname), u.pathname).toBe(true);
      }
      expect(text).not.toMatch(/deepseek|undetectable|stealth|invisible/i);
    });
  }
});

// ---------------------------------------------------------------- security.txt

describe("security.txt (RFC 9116)", () => {
  it("is served at /.well-known/ as text, with a contact, an expiry, the language and its own address", async () => {
    const res = await get("/.well-known/security.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const text = await res.text();
    const fields = Object.fromEntries(
      text.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]),
    );
    expect(fields).toEqual({
      Contact: `${SITE}/contact`,
      Expires: SECURITY_TXT_EXPIRES,
      "Preferred-Languages": "en",
      Canonical: `${SITE}/.well-known/security.txt`,
    });
    expect(text).not.toMatch(/@|bounty|reward/i); // no personal email, and no bounty promised
  });

  it("has an old address that moves there, and an expiry renewed in time", async () => {
    const res = await get("/security.txt");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${SITE}/.well-known/security.txt`);
    const days = (Date.parse(SECURITY_TXT_EXPIRES) - Date.now()) / 86_400_000;
    // RFC 9116: less than a year ahead. Inside 30 days this fails on purpose: move SECURITY_TXT_EXPIRES on a year.
    expect(days, "renew SECURITY_TXT_EXPIRES in apps/web/worker/seo.js").toBeGreaterThan(30);
    expect(days).toBeLessThanOrEqual(366);
  });
});

// ---------------------------------------------------------------- what the Worker writes itself

describe("answers the Worker writes itself", () => {
  it("carry the security headers the built files get from _headers", async () => {
    const answers = [
      await get("/robots.txt"),
      await get("/.well-known/security.txt"),
      await get("/privacy/"), // a 301
      await get("/privacy", { protocol: "http:" }), // http → https, a 301
      await get("/missing.js"), // a plain 404
    ];
    for (const res of answers) {
      expect(res.headers.get("strict-transport-security"), res.url).toBe("max-age=63072000; includeSubDomains");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    }
    expect(answers[2].status).toBe(301);
    expect(answers[4].status).toBe(404);
  });

  it("never replace a page's own policy, and leave the API's answers alone", async () => {
    const page = await get("/");
    expect(page.headers.get("content-security-policy")).toBeNull(); // a page's CSP comes from _headers, not here
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    const own = new Response("<html></html>", { headers: { "content-type": "text/html", "content-security-policy": "script-src 'self'", "x-frame-options": "SAMEORIGIN" } });
    const { withBaseline } = await import("./seo.js");
    const kept = withBaseline(own);
    expect(kept.headers.get("content-security-policy")).toBe("script-src 'self'");
    expect(kept.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});
