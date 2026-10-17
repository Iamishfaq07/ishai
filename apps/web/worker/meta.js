// Per-page link previews. WhatsApp, LinkedIn and X read a page's <meta> tags without running its scripts, and every
// address of this single-page app serves the same index.html, so a shared /resume-ai link would preview as the front
// page. For the public pages people share, the Worker swaps in that page's own title and description, and points
// og:url and og:image at the address it was asked for (so a custom domain previews correctly too). Streamed with
// HTMLRewriter; anything unexpected (not HTML, no HTMLRewriter) returns the page untouched.
//
// Keep the titles in step with index.html (the "/" defaults) and the pages themselves. The same pages are built as
// HTML with these titles (apps/web/src/prerender/routes.tsx); prerendered.js is how the Worker serves them.

/** @type {Record<string, { title: string; description: string }>} */
export const PAGE_META = {
  "/": {
    title: "Orbit AI: practise interviews, fix your resume, find jobs",
    description:
      "Interview practice and live help, a resume checker with an ATS score, and new jobs that fit you. One free account. No subscription.",
  },
  "/resume-ai": {
    title: "Orbit Resume AI: see your resume the way screening software does",
    description:
      "An ATS score out of 100, what's missing for the job you want, and AI rewrites that keep your own numbers. Editing, the score and downloads are free.",
  },
  "/jobs": {
    title: "Orbit Jobs AI: new jobs that fit you, from companies' own careers pages",
    description:
      "The latest openings from companies' careers pages, matched to your resume, with a tracker and free AI fit checks. Apply always opens the original post.",
  },
  "/warmup": {
    title: "Free interview warm-up: a Google Interview Warmup alternative | Orbit",
    description:
      "Practise interview questions out loud or by typing and get instant tips on length, structure and filler words. Free, no account needed.",
  },
  "/contact": {
    title: "Contact Orbit AI",
    description:
      "Questions, payments, a technical problem or a job that looks wrong: send the Orbit team a message and we'll reply by email.",
  },
  "/technical": {
    title: "How Orbit works: live latency and security | Orbit",
    description:
      "Measured answer speed from real sessions, the live answer pipeline step by step, and how the desktop app keeps your sign-in and data safe.",
  },
};

/** The page's own preview, or null for any other address (it keeps index.html's). "/jobs/" counts as "/jobs". */
export function metaFor(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return Object.prototype.hasOwnProperty.call(PAGE_META, path) ? { path, ...PAGE_META[path] } : null;
}

/** The asset response with this page's preview tags, or as it was. */
export function withPageMeta(response, url) {
  const meta = metaFor(url.pathname);
  const type = response.headers.get("content-type") || "";
  if (!meta || !response.ok || !type.includes("text/html") || typeof HTMLRewriter === "undefined") return response;
  const content = (value) => ({
    element(el) {
      el.setAttribute("content", value);
    },
  });
  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on('meta[name="description"]', content(meta.description))
    .on('meta[property="og:title"]', content(meta.title))
    .on('meta[property="og:description"]', content(meta.description))
    .on('meta[property="og:url"]', content(`${url.origin}${meta.path === "/" ? "/" : meta.path}`))
    .on('meta[name="twitter:title"]', content(meta.title))
    .on('meta[name="twitter:description"]', content(meta.description))
    .on('meta[property="og:image"]', content(`${url.origin}/og-image.jpg`))
    .on('meta[name="twitter:image"]', content(`${url.origin}/og-image.jpg`))
    .on('link[rel="canonical"]', {
      element(el) {
        el.setAttribute("href", `${url.origin}${meta.path === "/" ? "/" : meta.path}`);
      },
    })
    .transform(response);
}
