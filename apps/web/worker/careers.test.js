import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index.js";
import {
  careersDocument,
  careersRoute,
  cleanDescription,
  companyBody,
  embedPage,
  embedScript,
  jobBody,
  jobHead,
  jobsSitemap,
  scriptJson,
  serveCareers,
} from "./careers.js";
import { robotsTxt } from "./seo.js";
import { routeKind } from "./routes.js";

const TEMPLATE = `<!doctype html><html lang="en"><head><title>Orbit</title>
<meta name="description" content="x" /><meta property="og:url" content="https://orbitanswer.com/" />
<link rel="canonical" href="https://orbitanswer.com/" /><meta property="og:title" content="x" /><meta property="og:description" content="x" />
<meta name="twitter:title" content="x" /><meta name="twitter:description" content="x" /></head>
<body><div id="root"></div></body></html>`;

const ORIGIN = "https://orbitanswer.com";
const LD = { "@context": "https://schema.org", "@type": "JobPosting", title: "Dev </script><script>alert(1)</script>", directApply: true };
const job = (over = {}) => ({
  id: "j1",
  slug: "backend-dev",
  status: "open",
  title: "Backend <Dev>",
  description_html: "<p>Build <strong>APIs</strong> $& more</p><script>alert(1)</script><img src=x onerror=alert(1)><a href=\"javascript:alert(1)\">x</a>",
  department: "Engineering",
  locations: ["Bengaluru"],
  location_line: "Bengaluru · Hybrid",
  workplace: "hybrid",
  allowed_countries: [],
  employment_type: "full_time",
  experience: "mid",
  salary: { min: 1000000, max: 2000000, currency: "INR", period: "year" },
  published_at: "2026-10-10T00:00:00Z",
  valid_through: null,
  questions: [],
  company: { slug: "acme", name: "Acme & Co", logo_url: null, website: "https://acme.com", verified: true },
  url: `${ORIGIN}/company/acme/jobs/backend-dev`,
  notice: { version: "1", text: "We use AI to sort applications. A person decides." },
  json_ld: LD,
  ...over,
});

describe("careers routes", () => {
  it("knows the careers addresses and nothing else", () => {
    expect(careersRoute("/company/acme")).toEqual({ kind: "company", slug: "acme" });
    expect(careersRoute("/company/acme/jobs/backend-dev")).toEqual({ kind: "job", slug: "acme", jobSlug: "backend-dev" });
    expect(careersRoute("/embed/company/acme")).toEqual({ kind: "embed", slug: "acme" });
    expect(careersRoute("/embed.js")).toEqual({ kind: "embedjs" });
    expect(careersRoute("/sitemap-jobs.xml")).toEqual({ kind: "sitemap" });
    for (const p of ["/company", "/company/Acme", "/company/acme/jobs", "/company/a_b", "/company/acme/jobs/x/y", "/companies/tcs"]) expect(careersRoute(p)).toBeNull();
    expect(routeKind("/company/acme")).toBe("public");
    expect(routeKind("/company/acme/jobs/backend-dev")).toBe("public");
    expect(routeKind("/business")).toBe("public");
    expect(routeKind("/business/app")).toBe("app");
    expect(routeKind("/business/app/c1/jobs/j1")).toBe("app");
    expect(routeKind("/business/invite/tok")).toBe("app");
    expect(routeKind("/application/tok")).toBe("app");
    expect(routeKind("/admin/business")).toBe("app");
  });

  it("robots names the jobs sitemap and keeps the app's pages out", () => {
    const txt = robotsTxt({}, new URL(`${ORIGIN}/robots.txt`));
    expect(txt).toContain(`Sitemap: ${ORIGIN}/sitemap-jobs.xml`);
    expect(txt).toContain("Disallow: /business/app/");
    expect(txt).toContain("Disallow: /application/");
    expect(txt).not.toMatch(/Disallow: \/company/);
  });
});

describe("escaping", () => {
  it("cleans the description to the editor's tags", () => {
    const out = cleanDescription(job().description_html);
    expect(out).toContain("<p>Build <strong>APIs</strong> $& more</p>");
    expect(out).not.toMatch(/<script|<img|onerror|javascript:/i);
    expect(cleanDescription('<a href="https://x.com/?a=1&amp;b=2" onclick="x">ok</a>')).toBe('<a href="https://x.com/?a=1&amp;b=2" rel="nofollow noopener" target="_blank">ok</a>');
    expect(cleanDescription("a < b <B>c</B> <div>d</div>")).toBe("a &lt; b <strong>c</strong> d");
    expect(cleanDescription("<p>x<!-- <script> --></p><style>p{}</style>")).toBe("<p>x</p>");
  });

  it("keeps JSON-LD inside its script element", () => {
    const text = scriptJson(LD);
    expect(text).not.toContain("</script>");
    expect(JSON.parse(text)).toEqual(LD);
  });

  it("writes the document with function replacers, so $& in data stays text", () => {
    const head = { ...jobHead(job({ title: "C$& dev" }), ORIGIN) };
    const doc = careersDocument(TEMPLATE, { path: "/company/acme/jobs/backend-dev", head, html: jobBody(job({ title: "C$& dev" })) });
    expect(doc).toContain("<title>C$&amp; dev at Acme &amp; Co (Bengaluru · Hybrid) | Orbit</title>");
    expect(doc).toContain('<link rel="canonical" href="https://orbitanswer.com/company/acme/jobs/backend-dev"');
    expect(doc).toContain('<div id="prerender" data-path="/company/acme/jobs/backend-dev">');
    expect(doc.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)).not.toBeNull();
    expect(doc).not.toContain("<script>alert(1)");
    expect(doc).toContain(">C$&amp; dev</h1>");
    expect(doc).not.toContain("alert(1) x");
  });
});

describe("JSON-LD only while open", () => {
  it("open: the API's JobPosting; paused or closed: none and noindex", () => {
    expect(jobHead(job(), ORIGIN)).toMatchObject({ noindex: false, jsonLd: LD });
    expect(jobHead(job({ status: "paused" }), ORIGIN)).toMatchObject({ noindex: true, jsonLd: null });
    expect(jobHead(job({ status: "closed" }), ORIGIN)).toMatchObject({ noindex: true, jsonLd: null });
    expect(jobBody(job({ status: "closed" }))).toContain("This job is closed");
  });

  it("lists a company's open jobs", () => {
    const html = companyBody({ slug: "acme", name: "Acme", website: "acme.com", logo_url: null, about: "We <b>make</b>", country: "IN", verified: false, jobs: [{ slug: "dev", title: "Dev", department: "Eng", location_line: "Remote", employment_type: "contract" }] });
    expect(html).toContain('href="/company/acme/jobs/dev"');
    expect(html).toContain("We &lt;b&gt;make&lt;/b&gt;");
    expect(html).toContain("Open jobs (1)");
  });

  it("names the verified domain on the badge", () => {
    const base = { slug: "acme", name: "Acme", website: "acme.com", logo_url: null, about: "", country: "IN", jobs: [] };
    expect(companyBody({ ...base, verified: true, verified_domain: "acme.com" })).toContain("Verified: acme.com");
    expect(companyBody({ ...base, verified: true, verified_domain: "<b>x</b>.com" })).toContain("Verified: &lt;b&gt;x&lt;/b&gt;.com");
    expect(companyBody({ ...base, verified: false, verified_domain: null })).not.toContain("Verified");
    expect(jobBody(job({ company: { slug: "acme", name: "Acme", logo_url: null, website: "https://acme.com", verified: true, verified_domain: "acme.com" } }))).toContain("Verified: acme.com");
  });
});

describe("sitemap and widget", () => {
  it("lists only our careers addresses", () => {
    const xml = jobsSitemap([{ loc: "/company/acme", lastmod: "2026-10-10T10:00:00Z" }, { loc: `${ORIGIN}/company/acme/jobs/dev` }, { loc: "https://evil.example/x" }, { nope: 1 }], ORIGIN);
    expect(xml).toContain(`<loc>${ORIGIN}/company/acme</loc><lastmod>2026-10-10</lastmod>`);
    expect(xml).toContain(`<loc>${ORIGIN}/company/acme/jobs/dev</loc>`);
    expect(xml).not.toContain("evil");
  });

  it("the widget page escapes and the loader only takes slugs", () => {
    const html = embedPage({ slug: "acme", name: "<Acme>", jobs: [{ slug: "dev", title: "<b>Dev</b>", employment_type: "full_time" }] }, ORIGIN);
    expect(html).toContain("&lt;b&gt;Dev&lt;/b&gt;");
    expect(html).toContain(`href="${ORIGIN}/company/acme/jobs/dev" target="_blank"`);
    const js = embedScript(ORIGIN);
    expect(js).toContain("/embed/company/");
    expect(js).toContain("^[a-z0-9-]{1,80}$");
  });
});

describe("serving through the Worker", () => {
  afterEach(() => vi.unstubAllGlobals());
  const assets = { fetch: async () => new Response(TEMPLATE, { headers: { "content-type": "text/html; charset=utf-8" } }) };
  const env = { API_URL: "https://api.orbit.example", ASSETS: assets, SITE_ORIGIN: ORIGIN };

  function api(routes) {
    const seen = [];
    vi.stubGlobal("fetch", async (input) => {
      const u = new URL(String(input));
      seen.push(u.pathname);
      const hit = routes[u.pathname];
      if (!hit) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(hit), { status: 200, headers: { "content-type": "application/json" } });
    });
    return seen;
  }

  it("an open job: 200 with the job in the HTML and its JSON-LD", async () => {
    const seen = api({ "/v1/public/business/companies/acme/jobs/backend-dev": job() });
    const res = await worker.fetch(new Request(`${ORIGIN}/company/acme/jobs/backend-dev`), env);
    expect(seen).toEqual(["/v1/public/business/companies/acme/jobs/backend-dev"]);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("application/ld+json");
    expect(html).toContain("Build <strong>APIs</strong>");
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });

  it("a closed job: 410, noindex, no JSON-LD", async () => {
    api({ "/v1/public/business/companies/acme/jobs/backend-dev": job({ status: "closed", json_ld: null }) });
    const res = await worker.fetch(new Request(`${ORIGIN}/company/acme/jobs/backend-dev`), env);
    expect(res.status).toBe(410);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(await res.text()).not.toContain("application/ld+json");
  });

  it("a paused job: 200 and noindex", async () => {
    api({ "/v1/public/business/companies/acme/jobs/backend-dev": job({ status: "paused", json_ld: LD }) });
    const res = await worker.fetch(new Request(`${ORIGIN}/company/acme/jobs/backend-dev`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(await res.text()).not.toContain("application/ld+json");
  });

  it("an unknown company: 404", async () => {
    api({});
    const res = await worker.fetch(new Request(`${ORIGIN}/company/nobody`), env);
    expect(res.status).toBe(404);
  });

  it("the API down: 503 with the app, retry later", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    const res = await serveCareers(new Request(`${ORIGIN}/company/acme`), env, new URL(`${ORIGIN}/company/acme`), { kind: "company", slug: "acme" }, () => assets.fetch(), ORIGIN);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("120");
  });

  it("the widget can be framed; nothing else can", async () => {
    api({ "/v1/public/business/companies/acme": { slug: "acme", name: "Acme", jobs: [] } });
    const res = await worker.fetch(new Request(`${ORIGIN}/embed/company/acme`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors *");
    const page = await worker.fetch(new Request(`${ORIGIN}/company/acme`), env);
    expect(page.headers.get("x-frame-options")).toBe("DENY");
  });

  it("serves the loader and the jobs sitemap", async () => {
    api({ "/v1/public/business/sitemap": [{ loc: "/company/acme", lastmod: "2026-10-01" }] });
    const js = await worker.fetch(new Request(`${ORIGIN}/embed.js`), env);
    expect(js.headers.get("content-type")).toMatch(/javascript/);
    const xml = await worker.fetch(new Request(`${ORIGIN}/sitemap-jobs.xml`), env);
    expect(await xml.text()).toContain(`<loc>${ORIGIN}/company/acme</loc>`);
  });
});
