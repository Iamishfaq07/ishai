// Which addresses are pages, as far as the Worker (and so every search engine) is concerned. The single-page app
// draws every address in the browser, so without this list any typo answered 200 with the app: a "soft 404" to
// Google. Now an address is one of:
//   - "public": a page anyone may find in search (the front page, the product pages, the policies, the guides);
//   - "app":    a page of the app itself (sign-in, the signed-in pages): 200, never indexed;
//   - "referral": an invite link (/r/<code>): 200, never indexed, its canonical is the front page;
//   - null:     anything else, which is a real 404 unless it's a file among the built assets.
//
// Keep APP_ROUTES in step with the router (apps/web/src/App.tsx); seo.test.js checks the two still agree.

/** The public pages the app draws (the Worker's PAGE_META pages, worker/meta.js). */
export const PUBLIC_APP_PAGES = ["/", "/resume-ai", "/jobs", "/warmup", "/contact", "/technical", "/pricing", "/interview-copilot", "/mock-interview", "/linkedin-ai", "/business"];

/** The policies: plain HTML files in public/, served at their address without ".html". */
export const POLICY_PAGES = ["/privacy", "/terms", "/cookies", "/refund"];

/** Sections whose pages are built files (the question bank's guides, Orbit's articles): what isn't among the files
 *  there is a 404. */
export const PUBLIC_SECTIONS = ["/companies", "/roles", "/guides"];

/** Orbit for Business (D82): the companies' careers pages and their jobs, drawn by the Worker from the API
 *  (careers.js). Slugs are lower case letters, digits and dashes. */
export const CAREERS_ROUTES = [/^\/company\/[a-z0-9-]+$/, /^\/company\/[a-z0-9-]+\/jobs\/[a-z0-9-]+$/];

/**
 * The app's own pages, signed in or on the way in: what React Router draws (App.tsx), as patterns over the path.
 * Exact segments only, so "/mock-interview" (a future public guide) is never mistaken for "/mock".
 */
export const APP_ROUTES = [
  /^\/(?:login|register|forgot-password|reset-password|verify-email|confirm-email-change|companion|welcome)$/,
  /^\/(?:start|sessions|documents|mock|interview|billing|settings|linkedin|learn|code|offers)$/,
  /^\/live\/[^/]+$/,
  /^\/sessions\/[^/]+$/,
  /^\/documents\/(?:stories|evidence|answers)$/,
  /^\/resume-ai\/[^/]+$/,
  /^\/jobs\/(?:matches|tracker|outreach|profile|auto-apply|applications)$/,
  /^\/jobs\/(?:listing|mission)\/[^/]+$/,
  /^\/jobs\/alerts\/off$/,
  /^\/code\/[^/]+$/,
  /^\/offers\/[^/]+$/,
  /^\/extension\/connect$/,
  /^\/admin\/[a-z-]+$/, // every admin page (users, payments, audit, inbox, support, and any added later)
  // Orbit for Business (D82): the company app, an invite, and an applicant's status page (the link in their email).
  /^\/business\/app(?:\/[^/]+)*$/,
  /^\/business\/invite\/[^/]+$/,
  /^\/application\/[^/]+$/,
];

/** Invite links (feat/referrals): /r/<code>. */
export const REFERRAL_ROUTE = /^\/r\/[^/]+$/;

/**
 * Where robots.txt keeps crawlers out: the API and the signed-in pages (nothing there for a crawler, and some
 * addresses carry one-time tokens). Sign-in, sign-up and invite links stay crawlable so their noindex is seen.
 * Each entry is written as "/x$" and "/x?" (seo.js), so "/mock" never blocks "/mock-interview"; subtrees are below.
 */
export const ROBOTS_DISALLOW_EXACT = [
  "/start",
  "/sessions",
  "/documents",
  "/mock",
  "/interview",
  "/billing",
  "/settings",
  "/linkedin",
  "/learn",
  "/code",
  "/offers",
  "/welcome",
  "/companion",
  "/reset-password",
  "/verify-email",
  "/confirm-email-change",
  "/business/app",
];
/**
 * The API calls the public pages make while they draw (prices, job counts, latency figures, whether someone is
 * signed in): open, so a crawler that renders the page (Googlebot) sees what a person sees. Each is longer than
 * "/api/", so it wins over that rule.
 */
export const ROBOTS_ALLOW_API = [
  "/api/v1/auth/me$",
  "/api/v1/plans",
  "/api/v1/billing/packs",
  "/api/v1/billing/monthly",
  "/api/v1/jobs/stats",
  "/api/v1/region",
  "/api/v1/public/",
];
/** Whole subtrees robots.txt keeps crawlers out of (the public page at "/jobs" and "/resume-ai" itself stays open). */
export const ROBOTS_DISALLOW_PREFIX = ["/api/", "/_prerender/", "/live/", "/sessions/", "/documents/", "/resume-ai/", "/jobs/", "/code/", "/offers/", "/extension/", "/admin/", "/business/app/", "/business/invite/", "/application/", "/embed/"];

/**
 * An address that moved, and where it is now (a 301, so search engines move their record too), or null. Mirrors the
 * app's own redirects (pages/resume/paths.ts movedResumePath, pages/jobs/paths.ts movedJobsPath).
 */
export function movedPath(pathname, search = "") {
  // security.txt's old address (RFC 9116 moved it under /.well-known/).
  if (pathname === "/security.txt") return { pathname: "/.well-known/security.txt", search: "" };
  // Without regard to case, like React Router; an id keeps its own case.
  if (/^\/resume-maker$/i.test(pathname)) return { pathname: "/resume-ai", search };
  const resume = /^\/documents\/resumes(?:\/([^/]+))?$/i.exec(pathname);
  if (resume) return { pathname: resume[1] ? `/resume-ai/${resume[1]}` : "/resume-ai", search };
  const jobs = /^\/resume-ai\/jobs(\/.*)?$/i.exec(pathname);
  if (jobs) {
    const params = new URLSearchParams(search);
    const view = params.get("view");
    params.delete("view");
    const rest = jobs[1] ?? "";
    const query = params.toString();
    return { pathname: rest ? `/jobs${rest}` : view === "tracker" ? "/jobs/tracker" : "/jobs/matches", search: query ? `?${query}` : "" };
  }
  return null;
}

/** "public", "app", "referral" or null (see the top of this file). `pathname` is already normalised (seo.js). */
export function routeKind(pathname) {
  if (PUBLIC_APP_PAGES.includes(pathname) || POLICY_PAGES.includes(pathname)) return "public";
  if (PUBLIC_SECTIONS.some((s) => pathname === s || pathname.startsWith(`${s}/`))) return "public";
  if (CAREERS_ROUTES.some((re) => re.test(pathname))) return "public";
  if (REFERRAL_ROUTE.test(pathname)) return "referral";
  if (APP_ROUTES.some((re) => re.test(pathname))) return "app";
  return null;
}

/** Fixed addresses (no id in them), which are safe to fold to lower case: "/Resume-AI" → "/resume-ai". */
export function isFixedAddress(pathname) {
  if (routeKind(pathname) === "public") return true;
  return APP_ROUTES.some((re) => re.test(pathname) && !/\[\^\/\]\+/.test(re.source));
}

/** Lower case, leaving percent-escapes ("%C3%A9") exactly as they were sent. */
export const lowerOutsideEscapes = (path) => path.replace(/(%[0-9A-Fa-f]{2})|[^%]+/g, (m, escape) => (escape ? m : m.toLowerCase()));

/**
 * The address in its one letter case: a fixed address all lower case ("/Resume-AI" → "/resume-ai"); an address that
 * ends in an id with only its fixed part folded ("/Resume-AI/AbC" → "/resume-ai/AbC": ids are always the last part).
 * Anything else stays as it is.
 */
export function foldCase(pathname) {
  const lower = lowerOutsideEscapes(pathname);
  if (lower === pathname) return pathname;
  if (isFixedAddress(lower)) return lower;
  const cut = pathname.lastIndexOf("/");
  const prefixed = lowerOutsideEscapes(pathname.slice(0, cut)) + pathname.slice(cut);
  return prefixed !== pathname && routeKind(prefixed) !== null ? prefixed : pathname;
}
