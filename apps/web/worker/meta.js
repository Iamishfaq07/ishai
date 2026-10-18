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
    title: "Orbit Resume AI: free ATS resume checker and builder",
    description:
      "An ATS score out of 100, what's missing for the job you want, and AI rewrites that keep your own numbers. Editing, the score and downloads are free.",
  },
  "/jobs": {
    title: "Orbit Jobs AI: jobs that fit your resume, from careers pages",
    description:
      "The latest openings from companies' careers pages, matched to your resume, with a tracker and free AI fit checks. Apply always opens the original post.",
  },
  "/warmup": {
    title: "Free Google Interview Warmup alternative | Orbit",
    description:
      "Practise interview questions out loud or by typing and get instant tips on length, structure and filler words. Free, no account needed.",
  },
  "/contact": {
    title: "Contact Orbit AI: support, payments and feedback",
    description:
      "Questions, payments, a technical problem or a job that looks wrong: send the Orbit team a message and we'll reply by email.",
  },
  "/technical": {
    title: "How Orbit works: live latency and security | Orbit",
    description:
      "Measured answer speed from real sessions, the live answer pipeline step by step, and how the desktop app keeps your sign-in and data safe.",
  },
  "/pricing": {
    title: "Orbit pricing: plans and credits in ₹ and US dollars",
    description:
      "Start free, then pay once: plans for a week, a month or a year, or credit packs that never expire. Prices in rupees in India and dollars elsewhere.",
  },
  "/interview-copilot": {
    title: "Orbit interview copilot: live answers from your resume",
    description:
      "In calls where AI help is allowed, Orbit hears the question and suggests an answer from your resume and the job post. In Chrome, Edge or on Windows.",
  },
  "/mock-interview": {
    title: "AI mock interviews with a scorecard and follow-ups | Orbit",
    description:
      "Practise out loud with an AI interviewer: HR, technical, panel, salary and video rounds that follow up on what you said, then score every answer.",
  },
};

/**
 * Each page's preview picture (public/og/, rendered by og/render.mjs). A page without one, or any other address,
 * keeps the front page's (index.html's /og-image.jpg). Kept apart from PAGE_META so adding a page there never
 * needs a picture first.
 */
export const PAGE_IMAGES = {
  "/": "/og/home.jpg",
  "/resume-ai": "/og/resume-ai.jpg",
  "/jobs": "/og/jobs.jpg",
  "/warmup": "/og/warmup.jpg",
  "/contact": "/og/contact.jpg",
  "/technical": "/og/technical.jpg",
  "/companies": "/og/companies.jpg",
  "/roles": "/og/roles.jpg",
};

/** The picture for a page's preview: its own, else the front page's. The built pages use it too
 * (src/prerender/seo.ts): each company guide shows /companies's card, each role guide /roles's. */
export function imageFor(path) {
  return Object.prototype.hasOwnProperty.call(PAGE_IMAGES, path) ? PAGE_IMAGES[path] : "/og-image.jpg";
}

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
    .on('meta[property="og:image"]', content(`${url.origin}${imageFor(meta.path)}`))
    .on('meta[name="twitter:image"]', content(`${url.origin}${imageFor(meta.path)}`))
    .on('link[rel="canonical"]', {
      element(el) {
        el.setAttribute("href", `${url.origin}${meta.path === "/" ? "/" : meta.path}`);
      },
    })
    .transform(response);
}
