// Orbit for Business (D82): the companies' careers pages, served by the Worker as full HTML so search engines (and
// Google for Jobs) read them without running JavaScript.
//   /company/<slug>                     the careers page: the company and its open jobs
//   /company/<slug>/jobs/<job-slug>     a job: its description, and the JobPosting JSON-LD while it's open
//   /sitemap-jobs.xml                   every open job and careers page (robots.txt names it)
//   /embed/company/<slug>               a small self-contained list of open jobs, for a company's own site (framable)
//   /embed.js                           the snippet's loader: an iframe of the above for <div data-orbit-jobs="slug">
// The content comes from the API's public routes (/v1/public/business/...), is escaped here, and sits in
// <div id="prerender"> in front of the app's root, as the built public pages do (src/prerender): the app takes over
// in the browser (with the Apply form). A paused job is a page without markup and noindex; a closed one answers 410
// so Google drops it (stale jobs are penalised); an unknown one 404.
//
// The classes below are Tailwind's (tailwind.config.ts scans this file), the same look as the app's own page.

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** JSON inside <script>: nothing in a value can end the element or open a comment. */
export const scriptJson = (value) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

const SLUG = "[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?";
const COMPANY_RE = new RegExp(`^/company/(${SLUG})$`);
const JOB_RE = new RegExp(`^/company/(${SLUG})/jobs/(${SLUG})$`);
const EMBED_RE = new RegExp(`^/embed/company/(${SLUG})$`);

/** What a careers address is, or null. */
export function careersRoute(pathname) {
  let m = JOB_RE.exec(pathname);
  if (m) return { kind: "job", slug: m[1], jobSlug: m[2] };
  m = COMPANY_RE.exec(pathname);
  if (m) return { kind: "company", slug: m[1] };
  m = EMBED_RE.exec(pathname);
  if (m) return { kind: "embed", slug: m[1] };
  if (pathname === "/embed.js") return { kind: "embedjs" };
  if (pathname === "/sitemap-jobs.xml") return { kind: "sitemap" };
  return null;
}

// ---------------------------------------------------------------- the job description's HTML

const ALLOWED = new Set(["p", "br", "strong", "em", "u", "ul", "ol", "li", "h3", "h4", "blockquote", "a", "b", "i"]);

/**
 * The description as the API sanitized it, cleaned once more here (defence in depth): only the editor's tags, no
 * attributes but a link's http(s)/mailto href, scripts and styles gone with their content, any other "<" escaped.
 */
export function cleanDescription(html) {
  let s = String(html ?? "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|iframe|object|embed|template|noscript|svg|math)\b[\s\S]*?<\/\1\s*>/gi, "");
  const out = [];
  let last = 0;
  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;
  for (let m; (m = TAG.exec(s)); ) {
    out.push(s.slice(last, m.index).replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    last = TAG.lastIndex;
    let tag = m[2].toLowerCase();
    if (!ALLOWED.has(tag)) continue;
    if (tag === "b") tag = "strong";
    if (tag === "i") tag = "em";
    if (m[1]) {
      out.push(tag === "br" ? "" : `</${tag}>`);
    } else if (tag === "a") {
      const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[3]);
      const value = href ? (href[2] ?? href[3] ?? "").replace(/&amp;/g, "&") : "";
      out.push(/^(https?:\/\/|mailto:)/i.test(value.trim()) ? `<a href="${esc(value.trim())}" rel="nofollow noopener" target="_blank">` : "<a>");
    } else {
      out.push(tag === "br" ? "<br>" : `<${tag}>`);
    }
  }
  out.push(s.slice(last).replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  return out.join("");
}

/** Plain text of HTML, for the meta description. */
export function plainText(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…`);

const EMPLOYMENT = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", temporary: "Temporary", internship: "Internship" };
const PERIOD = { year: "per year", month: "per month", hour: "per hour" };

export function salaryText(salary) {
  if (!salary || (salary.min == null && salary.max == null)) return null;
  const fmt = (n) => {
    try {
      return new Intl.NumberFormat(salary.currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency: salary.currency, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${salary.currency} ${n}`;
    }
  };
  const range = salary.min != null && salary.max != null ? `${fmt(salary.min)} – ${fmt(salary.max)}` : salary.min != null ? `From ${fmt(salary.min)}` : `Up to ${fmt(salary.max)}`;
  return `${range} ${PERIOD[salary.period] || ""}`.trim();
}

const dateText = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

const logo = (url, name, size = "h-14 w-14") =>
  url
    ? `<img src="${esc(url)}" alt="${esc(name)} logo" width="56" height="56" class="${size} shrink-0 rounded-xl border border-zinc-200 bg-white object-contain dark:border-white/10" />`
    : `<span aria-hidden="true" class="${size} flex shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-xl font-semibold text-zinc-600 dark:bg-white/5 dark:text-zinc-300">${esc((name || "?").slice(0, 1).toUpperCase())}</span>`;

// "Verified: acme.com": the badge names the domain the company proved, so a look-alike name can't borrow it.
const verifiedBadge = (on, domain) =>
  on
    ? `<span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-200">${domain ? `Verified: ${esc(domain)}` : "Verified company"}</span>`
    : "";

const shell = (inner) => `<main id="main" class="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">${inner}
      <p class="mt-12 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-white/10 dark:text-zinc-400">Hiring with <a href="/business" class="underline">Orbit for Business</a>.</p>
    </main>`;

/** The careers page's HTML (the open jobs). */
export function companyBody(company) {
  const jobs = Array.isArray(company.jobs) ? company.jobs : [];
  const items = jobs.length
    ? `<ul class="mt-4 divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-white/10 dark:border-white/10">${jobs
        .map(
          (j) => `
        <li class="p-4"><a href="/company/${esc(company.slug)}/jobs/${esc(j.slug)}" class="text-base font-semibold text-indigo-700 hover:underline dark:text-indigo-300">${esc(j.title)}</a>
          <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">${[j.department, j.location_line, EMPLOYMENT[j.employment_type]].filter(Boolean).map(esc).join(" · ")}</p></li>`,
        )
        .join("")}
      </ul>`
    : `<p class="mt-4 text-sm text-zinc-600 dark:text-zinc-400">No open jobs right now. Check back soon.</p>`;
  return shell(`
      <header class="flex items-center gap-4">${logo(company.logo_url, company.name)}
        <div class="min-w-0"><h1 class="font-display text-3xl font-semibold tracking-tight">Jobs at ${esc(company.name)}</h1>
          <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">${company.website ? `<a href="${esc(safeUrl(company.website))}" rel="nofollow noopener" class="underline">${esc(hostOf(company.website))}</a>` : ""} ${verifiedBadge(company.verified, company.verified_domain)}</p></div>
      </header>
      ${company.about ? `<p class="mt-6 max-w-2xl whitespace-pre-line text-[0.9375rem] leading-relaxed text-zinc-700 dark:text-zinc-300">${esc(company.about)}</p>` : ""}
      <h2 class="mt-10 text-lg font-semibold">Open jobs (${jobs.length})</h2>${items}`);
}

/** A job's HTML: its facts, the description, and how to apply (the app's form replaces the note). */
export function jobBody(job) {
  const co = job.company || {};
  const facts = [job.location_line, EMPLOYMENT[job.employment_type], job.department, salaryText(job.salary)].filter(Boolean);
  const state =
    job.status === "closed"
      ? `<p role="status" class="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-white/10 dark:bg-white/5">This job is closed and no longer takes applications. <a class="underline" href="/company/${esc(co.slug)}">See ${esc(co.name)}'s open jobs</a>.</p>`
      : job.status === "paused"
        ? `<p role="status" class="mt-6 rounded-xl border border-amber-300/50 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-100">This job isn't taking applications right now.</p>`
        : `<p class="mt-6"><a href="#apply" class="inline-flex items-center rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white">Apply for this job</a></p>`;
  const posted = dateText(job.published_at);
  return shell(`
      <nav aria-label="Breadcrumb" class="text-sm text-zinc-600 dark:text-zinc-400"><a href="/company/${esc(co.slug)}" class="underline">Jobs at ${esc(co.name)}</a></nav>
      <header class="mt-4 flex items-start gap-4">${logo(co.logo_url, co.name)}
        <div class="min-w-0"><h1 class="font-display text-3xl font-semibold tracking-tight">${esc(job.title)}</h1>
          <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400"><span>${esc(co.name)}</span> ${verifiedBadge(co.verified, co.verified_domain)}</p></div>
      </header>
      <ul class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-700 dark:text-zinc-300">${facts.map((f) => `<li>${esc(f)}</li>`).join("")}${posted ? `<li>Posted ${esc(posted)}</li>` : ""}</ul>
      ${state}
      <div class="biz-prose mt-8 max-w-none text-[0.9375rem] leading-relaxed text-zinc-800 dark:text-zinc-200">${cleanDescription(job.description_html)}</div>
      ${job.status === "open" && job.notice?.text ? `<section id="apply" class="mt-10 rounded-2xl border border-zinc-200 p-5 dark:border-white/10"><h2 class="text-lg font-semibold">Apply</h2><p class="mt-2 whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-400">${esc(job.notice.text)}</p></section>` : ""}`);
}

function safeUrl(u) {
  const s = String(u || "").trim();
  if (/^https?:\/\//i.test(s)) return s;
  return s ? `https://${s}` : "";
}
function hostOf(u) {
  try {
    return new URL(safeUrl(u)).hostname.replace(/^www\./, "");
  } catch {
    return String(u || "");
  }
}

/** The <head> of a careers page. */
export function companyHead(company, origin) {
  const n = Array.isArray(company.jobs) ? company.jobs.length : 0;
  return {
    title: `Jobs at ${company.name} | Orbit`,
    description: clip(`${n} open ${n === 1 ? "job" : "jobs"} at ${company.name}. ${plainText(company.about || "")}`.trim(), 158),
    canonical: `${origin}/company/${company.slug}`,
    noindex: false,
    jsonLd: null,
  };
}

/** The <head> of a job page: JSON-LD only while it's open (the API sends none otherwise, and this checks too). */
export function jobHead(job, origin) {
  const co = job.company || {};
  const lead = [job.location_line, EMPLOYMENT[job.employment_type]].filter(Boolean).join(", ");
  return {
    title: `${job.title} at ${co.name}${job.location_line ? ` (${job.location_line})` : ""} | Orbit`,
    description: clip(`${co.name} is hiring a ${job.title}${lead ? ` (${lead})` : ""}. ${plainText(cleanDescription(job.description_html))}`, 158),
    canonical: `${origin}/company/${co.slug}/jobs/${job.slug}`,
    noindex: job.status !== "open",
    jsonLd: job.status === "open" && job.json_ld && typeof job.json_ld === "object" ? job.json_ld : null,
  };
}

/**
 * The app's page (index.html) as this careers page: its head, and its HTML in front of the app's root. String
 * surgery on our own template; a tag that isn't there is simply skipped (the page still works).
 */
export function careersDocument(template, { path, head, html }) {
  let out = String(template);
  const content = (attr, name, value) => {
    const re = new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`);
    out = out.replace(re, (_m, a, b) => `${a}${esc(value)}${b}`);
  };
  // Function replacers throughout: a "$&" in a company's text must stay text.
  out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(head.title)}</title>`);
  content("name", "description", head.description);
  content("property", "og:title", head.title);
  content("property", "og:description", head.description);
  content("property", "og:url", head.canonical);
  content("name", "twitter:title", head.title);
  content("name", "twitter:description", head.description);
  out = out.replace(/(<link rel="canonical" href=")[^"]*(")/, (_m, a, b) => `${a}${esc(head.canonical)}${b}`);
  const extra = [];
  if (head.noindex) extra.push(`<meta name="robots" content="noindex" />`);
  if (head.jsonLd) extra.push(`<script type="application/ld+json">${scriptJson(head.jsonLd)}</script>`);
  if (extra.length) out = out.replace(/<\/head>/, () => `  ${extra.join("\n    ")}\n  </head>`);
  return out.replace(/<div id="root"><\/div>/, () => `<div id="prerender" data-path="${esc(path)}">${html}</div><div id="root"></div>`);
}

// ---------------------------------------------------------------- the embeddable widget

export function embedPage(company, origin) {
  const jobs = Array.isArray(company.jobs) ? company.jobs : [];
  const rows = jobs.length
    ? jobs
        .map(
          (j) =>
            `<li><a href="${esc(`${origin}/company/${company.slug}/jobs/${j.slug}`)}" target="_blank" rel="noopener">${esc(j.title)}</a><span>${[j.department, j.location_line, EMPLOYMENT[j.employment_type]].filter(Boolean).map(esc).join(" · ")}</span></li>`,
        )
        .join("")
    : `<li class="none">No open jobs right now.</li>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Open jobs at ${esc(company.name)}</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
body{margin:0;padding:12px;background:transparent;color:#18181b}
@media (prefers-color-scheme:dark){body{color:#f4f4f5}a{color:#a5b4fc}}
h1{font-size:16px;margin:0 0 8px}
ul{list-style:none;margin:0;padding:0}
li{padding:10px 0;border-top:1px solid rgba(127,127,127,.25)}
li:first-child{border-top:0}
a{color:#4338ca;font-weight:600;text-decoration:none}a:hover,a:focus-visible{text-decoration:underline}
span{display:block;font-size:13px;opacity:.75;margin-top:2px}
footer{margin-top:10px;font-size:12px;opacity:.7}
</style></head>
<body><h1>Open jobs at ${esc(company.name)}</h1><ul>${rows}</ul>
<footer><a href="${esc(`${origin}/company/${company.slug}`)}" target="_blank" rel="noopener">All jobs</a> · Hiring with Orbit</footer>
<script>(function(){function h(){try{parent.postMessage({orbitJobsHeight:document.documentElement.scrollHeight,slug:${scriptJson(company.slug)}},"*")}catch(e){}}h();addEventListener("load",h);addEventListener("resize",h)})();</script>
</body></html>`;
}

/** The loader a company pastes with `<div data-orbit-jobs="slug">`: an iframe per div, sized to its content. */
export function embedScript(origin) {
  return `(function(){var o=${scriptJson(origin)};var d=document.querySelectorAll("[data-orbit-jobs]");for(var i=0;i<d.length;i++){(function(el){var s=(el.getAttribute("data-orbit-jobs")||"").toLowerCase();if(!/^[a-z0-9-]{1,80}$/.test(s)||el.getAttribute("data-orbit-ready"))return;el.setAttribute("data-orbit-ready","1");var f=document.createElement("iframe");f.src=o+"/embed/company/"+s;f.title="Open jobs";f.loading="lazy";f.style.cssText="width:100%;border:0;min-height:200px";el.appendChild(f);addEventListener("message",function(e){if(e.origin===o&&e.data&&e.data.slug===s&&typeof e.data.orbitJobsHeight==="number"){f.style.height=Math.min(4000,e.data.orbitJobsHeight+4)+"px"}})})(d[i])}})();\n`;
}

// ---------------------------------------------------------------- the jobs sitemap

export function jobsSitemap(entries, origin) {
  const urls = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && typeof e.loc === "string")
    .map((e) => {
      const loc = e.loc.startsWith("/") ? `${origin}${e.loc}` : e.loc;
      if (!loc.startsWith(`${origin}/company/`)) return null; // only our own careers pages
      const lastmod = typeof e.lastmod === "string" && /^\d{4}-\d{2}-\d{2}/.test(e.lastmod) ? `<lastmod>${esc(e.lastmod.slice(0, 10))}</lastmod>` : "";
      return `  <url><loc>${esc(loc)}</loc>${lastmod}</url>`;
    })
    .filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

// ---------------------------------------------------------------- serving

/** A public business route of the API, as JSON: { status, data } (status 0 when it couldn't be reached). */
export async function fetchPublic(env, path) {
  const base = String(env?.API_URL || "").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/v1/public/business${path}`, { headers: { accept: "application/json", "user-agent": "orbit-web-worker" }, redirect: "manual" });
    if (!res.ok) return { status: res.status, data: null };
    return { status: res.status, data: await res.json() };
  } catch {
    return { status: 0, data: null };
  }
}

const HTML = "text/html; charset=utf-8";

/**
 * The answer for a careers address, or null when this isn't one (or the API says there's no such page: the caller
 * answers its 404). `shell` fetches the app's index.html.
 */
export async function serveCareers(request, env, url, route, shell, origin) {
  const head = request.method === "HEAD";
  if (route.kind === "embedjs") {
    return new Response(head ? null : embedScript(origin), {
      headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" },
    });
  }
  if (route.kind === "sitemap") {
    const r = await fetchPublic(env, "/sitemap");
    if (r.status !== 200) return new Response("Sitemap unavailable\n", { status: 503, headers: { "retry-after": "300", "content-type": "text/plain; charset=utf-8" } });
    return new Response(head ? null : jobsSitemap(r.data, origin), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=900" } });
  }
  const r = await fetchPublic(env, route.kind === "job" ? `/companies/${route.slug}/jobs/${route.jobSlug}` : `/companies/${route.slug}`);
  if (r.status === 404) return null;
  if (route.kind === "embed") {
    if (r.status !== 200) return new Response("Unavailable\n", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "120" } });
    return new Response(head ? null : embedPage(r.data, origin), {
      headers: {
        "content-type": HTML,
        "cache-control": "public, max-age=300",
        "x-robots-tag": "noindex",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        // Framable anywhere (it's the point), and runs only its own inline sizing script.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' https:; frame-ancestors *; base-uri 'none'; form-action 'none'",
      },
    });
  }
  const template = await shell();
  const templateHtml = template && template.ok ? await template.text() : null;
  if (r.status !== 200 || !templateHtml) {
    // The API couldn't be asked: the app (which will try again in the browser), and "come back later" for crawlers.
    const body = templateHtml ?? "Orbit is having trouble. Try again shortly.\n";
    return new Response(head ? null : body, { status: 503, headers: { "content-type": templateHtml ? HTML : "text/plain; charset=utf-8", "retry-after": "120", "x-robots-tag": "noindex", "cache-control": "no-store" } });
  }
  const data = r.data;
  const page =
    route.kind === "job"
      ? { path: url.pathname, head: jobHead(data, origin), html: jobBody(data) }
      : { path: url.pathname, head: companyHead(data, origin), html: companyBody(data) };
  const status = route.kind === "job" && data.status === "closed" ? 410 : 200;
  const headers = { "content-type": HTML, "cache-control": "public, max-age=120" };
  if (page.head.noindex) headers["x-robots-tag"] = "noindex";
  return new Response(head ? null : careersDocument(templateHtml, page), { status, headers });
}
