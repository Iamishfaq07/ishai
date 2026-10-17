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
export const PUBLIC_APP_PAGES = ["/", "/resume-ai", "/jobs", "/warmup", "/contact", "/technical"];

/** The policies: plain HTML files in public/, served at their address without ".html". */
export const POLICY_PAGES = ["/privacy", "/terms", "/cookies", "/refund"];

/** Sections whose pages are built files (the question bank's guides): what isn't among the files there is a 404. */
export const PUBLIC_SECTIONS = ["/companies", "/roles"];

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
  /^\/jobs\/(?:matches|tracker|outreach|profile)$/,
  /^\/jobs\/(?:listing|mission)\/[^/]+$/,
  /^\/jobs\/alerts\/off$/,
  /^\/code\/[^/]+$/,
  /^\/offers\/[^/]+$/,
  /^\/extension\/connect$/,
  /^\/admin\/(?:users|payments|audit|inbox|support)$/,
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
];
/** Whole subtrees robots.txt keeps crawlers out of (the public page at "/jobs" and "/resume-ai" itself stays open). */
export const ROBOTS_DISALLOW_PREFIX = ["/api/", "/live/", "/sessions/", "/documents/", "/resume-ai/", "/jobs/", "/code/", "/offers/", "/extension/", "/admin/"];

/**
 * An address that moved, and where it is now (a 301, so search engines move their record too), or null. Mirrors the
 * app's own redirects (pages/resume/paths.ts movedResumePath, pages/jobs/paths.ts movedJobsPath).
 */
export function movedPath(pathname, search = "") {
  if (pathname === "/resume-maker") return { pathname: "/resume-ai", search };
  const resume = /^\/documents\/resumes(?:\/([^/]+))?$/.exec(pathname);
  if (resume) return { pathname: resume[1] ? `/resume-ai/${resume[1]}` : "/resume-ai", search };
  const jobs = /^\/resume-ai\/jobs(\/.*)?$/.exec(pathname);
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
  if (REFERRAL_ROUTE.test(pathname)) return "referral";
  if (APP_ROUTES.some((re) => re.test(pathname))) return "app";
  return null;
}

/** Fixed addresses (no id in them), which are safe to fold to lower case: "/Resume-AI" → "/resume-ai". */
export function isFixedAddress(pathname) {
  if (routeKind(pathname) === "public") return true;
  return APP_ROUTES.some((re) => re.test(pathname) && !/\[\^\/\]\+/.test(re.source));
}
