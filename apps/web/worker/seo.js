// What search engines and AI crawlers get from the Worker, around the app (DECISIONS D67):
//   - one address per page: http → https, www → the bare domain, no trailing slash, no ".html", lower case for fixed
//     addresses, moved pages, all as a single 301;
//   - real status codes: an address that isn't a page answers 404 (with a page that helps, and noindex), not the app
//     with 200; the app's own pages answer 200 with `X-Robots-Tag: noindex`;
//   - robots.txt, written here so the rules and the route list (routes.js) can't drift apart;
//   - the head tags a public page is missing (canonical, hreflang, link-preview tags, structured data, the search
//     engines' verification codes), added on the way out;
//   - noindex everywhere on any host that isn't the site's own (preview deployments, *.workers.dev).
// Everyone gets the same page: nothing here looks at who is asking (no cloaking).
import { metaFor, withPageMeta } from "./meta.js";
import { ROBOTS_ALLOW_API, ROBOTS_DISALLOW_EXACT, ROBOTS_DISALLOW_PREFIX, foldCase, movedPath, routeKind } from "./routes.js";
import { SITE, SITE_NAME, jsonLdText, structuredDataFor } from "./site.js";

/** The site's own origin; a deployment may say otherwise (SITE_ORIGIN, e.g. for a local check). A value that isn't
 *  an address is ignored, so a typo in the var can't take every page down. */
export function originOf(env) {
  const origin = String(env?.SITE_ORIGIN || SITE).replace(/\/+$/, "");
  try {
    return new URL(origin).origin;
  } catch {
    return SITE;
  }
}

// ---------------------------------------------------------------- redirects

/**
 * The one address this request should be at, or null when it's already there. GET and HEAD only; the API is never
 * touched (the caller handles /api first).
 */
export function canonicalLocation(url, env) {
  const site = new URL(originOf(env));
  let host = url.host;
  let protocol = url.protocol;
  if (host === `www.${site.host}`) host = site.host;
  if (host === site.host && protocol === "http:") protocol = site.protocol;

  let path = url.pathname;
  let search = url.search;
  // In this order, so "/privacy.html/" and "/x/index.html" are one hop too.
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "") || "/";
  path = path.replace(/\.html$/i, "").replace(/\/index$/i, "") || "/";
  path = foldCase(path);
  const moved = movedPath(path, search);
  if (moved) {
    path = foldCase(moved.pathname);
    search = moved.search;
  }

  if (host === url.host && protocol === url.protocol && path === url.pathname && search === url.search) return null;
  return `${protocol}//${host}${path}${search}`;
}

function redirect(location) {
  return new Response(null, { status: 301, headers: { location, "cache-control": "public, max-age=3600" } });
}

// ---------------------------------------------------------------- robots.txt

/** Crawlers that build a search or answer index, or fetch a page because a person asked: always welcome. */
export const SEARCH_CRAWLERS = [
  "Googlebot",
  "Bingbot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot",
  "DuckAssistBot",
  "YandexBot",
  "Amzn-SearchBot",
  "meta-webindexer",
  "MistralAI-User",
  "YouBot",
];
/** Crawlers that collect pages to train AI models. Allowed by default (D67); AI_TRAINING_CRAWLERS=block opts out. */
export const TRAINING_CRAWLERS = ["GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended", "CCBot", "meta-externalagent", "Amazonbot", "MistralAI-Training"];
/** No published documentation of what it's for or that it honours robots.txt, and no answer engine to appear in. */
export const BLOCKED_CRAWLERS = ["Bytespider"];

export function robotsTxt(env, url) {
  const origin = originOf(env);
  if (url && new URL(origin).host !== url.host) {
    return `# ${url.host} is not the site's own address (${origin}): nothing here should be indexed.\nUser-agent: *\nDisallow: /\n`;
  }
  const blockTraining = String(env?.AI_TRAINING_CRAWLERS || "allow").toLowerCase() === "block";
  const welcome = blockTraining ? SEARCH_CRAWLERS : [...SEARCH_CRAWLERS, ...TRAINING_CRAWLERS];
  const blocked = blockTraining ? [...TRAINING_CRAWLERS, ...BLOCKED_CRAWLERS] : BLOCKED_CRAWLERS;
  const disallow = [
    ...ROBOTS_DISALLOW_PREFIX,
    ...ROBOTS_DISALLOW_EXACT.flatMap((p) => [`${p}$`, `${p}?`]),
  ];
  return [
    `# ${origin}/robots.txt, written by the web Worker (apps/web/worker/seo.js; DECISIONS D67).`,
    "#",
    "# Every public page is open to search engines and AI assistants, so they can find, cite and link to Orbit.",
    "# The API and the signed-in app are closed: there's nothing there for a crawler, and some addresses carry",
    "# one-time tokens. Sign-in pages and invite links stay open so crawlers see their noindex.",
    `# AI training crawlers: ${blockTraining ? "kept out (AI_TRAINING_CRAWLERS=block)" : "welcome (the default; set AI_TRAINING_CRAWLERS=block to keep them out)"}.`,
    "",
    "User-agent: *",
    ...welcome.map((ua) => `User-agent: ${ua}`),
    "Allow: /",
    ...ROBOTS_ALLOW_API.map((p) => `Allow: ${p}`),
    ...disallow.map((p) => `Disallow: ${p}`),
    // Cloudflare's Content Signals (https://contentsignals.org): the same stance, in words some crawlers read.
    `Content-Signal: search=yes, ai-input=yes, ai-train=${blockTraining ? "no" : "yes"}`,
    "",
    ...blocked.map((ua) => `User-agent: ${ua}`),
    "Disallow: /",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- head tags

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s) =>
  String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/** The search engines' site-verification codes, from the Worker's vars (wrangler.jsonc): the owner pastes them there. */
export const VERIFICATION_VARS = {
  GOOGLE_SITE_VERIFICATION: "google-site-verification",
  BING_SITE_VERIFICATION: "msvalidate.01",
  YANDEX_VERIFICATION: "yandex-verification",
  NAVER_SITE_VERIFICATION: "naver-site-verification",
  SEZNAM_VERIFICATION: "seznam-wmt",
};

/**
 * What to add to a public page's <head>, given what it already has (`seen`). Only tags the page lacks: a page that
 * states its own canonical, preview tags or structured data (the prerendered pages) keeps them.
 */
export function headAdditions(path, seen, env) {
  // The page's own canonical where it states one (the alternates must name the same address), else this one.
  const canonical = seen.canonicalHref || `${originOf(env)}${path === "/" ? "/" : path}`;
  const title = seen.title ? unesc(seen.title.trim()) : null;
  const description = seen.description ? unesc(seen.description) : null;
  const out = [];
  if (!seen.canonical) out.push(`<link rel="canonical" href="${esc(canonical)}" />`);
  // One English site for everyone (prices follow the visitor's country on the same page): no language variants, so
  // the alternates only say this page is the English one and the default for every region.
  if (!seen.hreflang) {
    out.push(`<link rel="alternate" hreflang="en" href="${esc(canonical)}" />`);
    out.push(`<link rel="alternate" hreflang="x-default" href="${esc(canonical)}" />`);
  }
  const og = seen.og || {};
  if (!("og:type" in og)) out.push(`<meta property="og:type" content="website" />`);
  if (!("og:site_name" in og)) out.push(`<meta property="og:site_name" content="${esc(SITE_NAME)}" />`);
  if (!("og:url" in og)) out.push(`<meta property="og:url" content="${esc(canonical)}" />`);
  if (!("og:title" in og) && title) out.push(`<meta property="og:title" content="${esc(title)}" />`);
  if (!("og:description" in og) && description) out.push(`<meta property="og:description" content="${esc(description)}" />`);
  if (!("og:image" in og)) out.push(`<meta property="og:image" content="${esc(`${originOf(env)}/og-image.jpg`)}" />`);
  if (!seen.twitterCard) out.push(`<meta name="twitter:card" content="summary_large_image" />`);
  if (path === "/") {
    for (const [key, name] of Object.entries(VERIFICATION_VARS)) {
      const code = String(env?.[key] || "").trim();
      if (code && !seen.verification?.[name]) out.push(`<meta name="${name}" content="${esc(code)}" />`);
    }
  }
  if (!seen.jsonLd) {
    const data = structuredDataFor(path, { title, description });
    if (data) out.push(`<script type="application/ld+json">${jsonLdText(data)}</script>`);
  }
  return out.join("\n    ");
}

/** A public page with the head tags it lacks (headAdditions), streamed. Untouched without HTMLRewriter (tests). */
export function withSeoHead(response, path, env) {
  if (typeof HTMLRewriter === "undefined" || !isHtml(response) || response.status !== 200) return response;
  const seen = { og: {}, verification: {}, title: "" };
  const mark = (key) => ({ element: () => void (seen[key] = true) });
  const res = new HTMLRewriter()
    .on('link[rel="canonical"]', {
      element(el) {
        seen.canonical = true;
        seen.canonicalHref = el.getAttribute("href") || null;
      },
    })
    .on("link[hreflang]", mark("hreflang"))
    .on('script[type="application/ld+json"]', mark("jsonLd"))
    .on('meta[name="twitter:card"]', mark("twitterCard"))
    .on("meta[property]", {
      element(el) {
        const p = el.getAttribute("property") || "";
        if (p.startsWith("og:")) seen.og[p] = el.getAttribute("content") || "";
      },
    })
    .on("meta[name]", {
      element(el) {
        const n = (el.getAttribute("name") || "").toLowerCase();
        if (n === "description") seen.description = el.getAttribute("content") || "";
        if (Object.values(VERIFICATION_VARS).includes(n)) seen.verification[n] = true;
      },
    })
    .on("head > title", {
      text(chunk) {
        seen.title += chunk.text;
      },
    })
    .on("head", {
      element(el) {
        el.onEndTag((end) => {
          const add = headAdditions(path, seen, env);
          if (add) end.before(`  ${add}\n  `, { html: true });
        });
      },
    })
    .transform(response);
  return withoutEtag(res);
}

// ---------------------------------------------------------------- the 404 page and the app's own pages

const NOT_FOUND_TITLE = "Page not found | Orbit AI";
const NOT_FOUND_DESCRIPTION = "That address isn't a page on Orbit. Go to the front page, Resume AI, Jobs AI, the free interview warm-up, or contact us.";
/** What a 404 shows before the app loads (and all a crawler that doesn't run JavaScript reads). The app then draws
 *  its own "This page isn't here" (pages/NotFound.tsx) over it. */
export const NOT_FOUND_BODY = `<main id="main" class="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-16">
      <p class="text-sm font-semibold text-indigo-600">404</p>
      <h1 class="mt-2 font-display text-3xl font-semibold tracking-tight">This page isn't here</h1>
      <p class="mt-2 text-base text-zinc-600">The link may be old, or the address was typed wrong.</p>
      <ul class="mt-6 space-y-2">
        <li><a href="/">Orbit: interview practice, live interview help, Resume AI and Jobs AI</a></li>
        <li><a href="/resume-ai">Resume AI: ATS score and resume fixes</a></li>
        <li><a href="/jobs">Jobs AI: new jobs that fit you</a></li>
        <li><a href="/warmup">Free interview warm-up</a></li>
        <li><a href="/contact">Contact us</a></li>
      </ul>
    </main>`;

const isHtml = (response) => /text\/html/i.test(response.headers.get("content-type") || "");

function withoutEtag(response) {
  const res = new Response(response.body, response);
  res.headers.delete("etag");
  return res;
}

function withHeader(response, name, value) {
  const res = new Response(response.body, response);
  res.headers.set(name, value);
  return res;
}

/** The request without conditional or range headers: the page is rewritten on the way out, so the asset's 304 or 206
 *  for the original bytes would be wrong. */
function wholeRequest(request, target = request.url) {
  const headers = new Headers(request.headers);
  for (const h of ["if-none-match", "if-modified-since", "if-match", "if-unmodified-since", "range", "if-range"]) headers.delete(h);
  return new Request(target, { method: request.method === "HEAD" ? "HEAD" : "GET", headers });
}

/** The app's page (index.html) for this request, whole. */
const appShell = (env, request, url) => env.ASSETS.fetch(wholeRequest(request, new URL("/", url)));

/** The app with noindex, and without a canonical that would name another page (the shell's says "/"). */
function appPage(shell, { keepCanonical = false } = {}) {
  let res = withHeader(shell, "x-robots-tag", "noindex");
  if (!keepCanonical && typeof HTMLRewriter !== "undefined" && isHtml(res)) {
    res = new HTMLRewriter()
      .on('link[rel="canonical"]', { element: (el) => el.remove() })
      .on('meta[property="og:url"]', { element: (el) => el.remove() })
      .transform(res);
  }
  return withoutEtag(res);
}

const looksLikeFile = (path) => /\.[a-z0-9]{1,8}$/i.test(path) && !/\.html?$/i.test(path);

/** A real 404: the app's page (so the app still draws its own "not found" with links), status 404 and noindex. A
 *  missing file (a script, an image) gets a short plain answer instead. */
export async function notFound(env, request, url) {
  const headers = { "x-robots-tag": "noindex", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" };
  if (looksLikeFile(url.pathname) || !["GET", "HEAD"].includes(request.method)) {
    return new Response(request.method === "HEAD" ? null : "Not found\n", { status: 404, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
  }
  const shell = await appShell(env, request, url);
  if (!shell.ok || !isHtml(shell)) return new Response("Not found\n", { status: 404, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
  let body = shell.body;
  if (typeof HTMLRewriter !== "undefined") {
    body = new HTMLRewriter()
      .on("head > title", { element: (el) => el.setInnerContent(NOT_FOUND_TITLE) })
      .on('meta[name="description"]', { element: (el) => el.setAttribute("content", NOT_FOUND_DESCRIPTION) })
      .on('meta[property="og:title"], meta[name="twitter:title"]', { element: (el) => el.setAttribute("content", NOT_FOUND_TITLE) })
      .on('meta[property="og:description"], meta[name="twitter:description"]', { element: (el) => el.setAttribute("content", NOT_FOUND_DESCRIPTION) })
      .on('link[rel="canonical"]', { element: (el) => el.remove() })
      .on('meta[property="og:url"]', { element: (el) => el.remove() })
      .on("head", { element: (el) => el.append('<meta name="robots" content="noindex" />', { html: true }) })
      .on("#root", { element: (el) => el.setInnerContent(NOT_FOUND_BODY, { html: true }) })
      .transform(shell).body;
  }
  const res = new Response(request.method === "HEAD" ? null : body, { status: 404, headers: shell.headers });
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  for (const h of ["etag", "content-length", "last-modified"]) res.headers.delete(h);
  return res;
}

// ---------------------------------------------------------------- the whole policy

/**
 * Wraps the Worker's own handling of a page (`serve`, everything but the API proxy) with the rules above. Should
 * anything here fail, the page is served as `serve` made it.
 */
export async function withSeo(request, env, url, serve) {
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return serve(request);
  const method = request.method;
  const readable = method === "GET" || method === "HEAD";
  if (readable) {
    const to = canonicalLocation(url, env);
    if (to) return redirect(to);
  }
  const ownHost = url.host === new URL(originOf(env)).host;
  const path = url.pathname;

  if (readable && path === "/robots.txt") {
    return new Response(method === "HEAD" ? null : robotsTxt(env, url), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" },
    });
  }

  const kind = routeKind(path);
  let response;
  try {
    if (readable && path.startsWith("/_prerender/")) {
      // The built copies of public pages (the question bank's prerender) are for the Worker to serve at their own
      // address; asked for directly, they'd be duplicates of those pages.
      response = await notFound(env, request, url);
    } else if (readable && (kind === "app" || kind === "referral")) {
      // The app draws these in the browser: its page, never indexed. An invite link's canonical stays the front page.
      response = appPage(await appShell(env, request, url), { keepCanonical: kind === "referral" });
    } else {
      // A public page gets head tags added on the way out, so it's always fetched whole (never a 304 for the bytes).
      response = await serve(readable && kind === "public" ? wholeRequest(request) : request);
      if (readable && response.status === 404) {
        if (kind === "public" && metaFor(path)) {
          // A public page the app draws, with no built copy among the assets: the app, with this page's head.
          response = withPageMeta(await appShell(env, request, url), url);
        } else {
          response = await notFound(env, request, url);
        }
      }
      if (response.status === 200 && isHtml(response) && kind === "public") response = withSeoHead(response, path, env);
    }
    // Text files (llms.txt, the IndexNow key) say they're UTF-8.
    const type = response.headers.get("content-type") || "";
    if (/^text\/plain\s*$/i.test(type)) response = withHeader(response, "content-type", "text/plain; charset=utf-8");
  } catch {
    response = response || (await serve(request));
  }
  // A preview deployment, *.workers.dev or a local run: a copy of the site, which must never be indexed.
  if (!ownHost && !response.headers.has("x-robots-tag")) response = withHeader(response, "x-robots-tag", "noindex");
  return response;
}
