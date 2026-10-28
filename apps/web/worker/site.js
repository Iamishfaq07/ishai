// What Orbit says about itself to search engines and AI assistants: the site's one address, its name, and the
// structured data (schema.org JSON-LD) that only states what the pages themselves show. Shared by the Worker
// (seo.js) and, later, the build's prerendered pages, so both describe Orbit the same way.
//
// Rules (DECISIONS D67): no ratings or reviews (Orbit has none to show), no prices (they differ by country and change;
// the pricing section on the front page is the source), and FAQ markup only next to a visible FAQ with the same words
// (the product pages' questions live in faqs.js, which the pages draw their FAQ from too: D79).
import { faqsFor } from "./faqs.js";

/** The canonical origin. Links, canonicals and the sitemap always name it, whatever host served the request. */
export const SITE = "https://orbitanswer.com";

/** The name search results should show for the site (Google "site names": WebSite.name + og:site_name). */
export const SITE_NAME = "Orbit AI";

/** Other names people use for it, most preferred first (WebSite.alternateName). */
export const ALTERNATE_NAMES = ["Orbit", "orbitanswer.com"];

/**
 * Orbit's own profiles elsewhere (Organization.sameAs): the owner adds each one once it exists and links back to
 * orbitanswer.com. Empty entries are left out. Never list a profile Orbit doesn't control.
 */
export const SAME_AS = [
  // "https://www.linkedin.com/company/<orbit-page>",
  // "https://x.com/<orbit-handle>",
  // "https://www.youtube.com/@<orbit-channel>",
  // "https://www.producthunt.com/products/<orbit>",
  // "https://apps.microsoft.com/detail/<store-id>",
];

/** The Windows app's installer (the same address the site's download buttons use: apps/web/src/lib/desktop.ts). */
export const DESKTOP_DOWNLOAD_URL = "https://orbit-downloads.ishfaq.workers.dev/Orbit-Setup.exe";

export const ORGANIZATION_ID = `${SITE}/#organization`;
export const WEBSITE_ID = `${SITE}/#website`;

/** An absolute address on the site: "/jobs" → "https://orbitanswer.com/jobs". */
export const siteUrl = (path = "/") => `${SITE}${path === "/" ? "/" : path}`;

export function organization() {
  const sameAs = SAME_AS.filter(Boolean);
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: SITE_NAME,
    alternateName: ALTERNATE_NAMES,
    url: siteUrl("/"),
    // Google: at least 112×112, crawlable, looks right on white.
    logo: { "@type": "ImageObject", url: siteUrl("/icon-512.png"), width: 512, height: 512 },
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", url: siteUrl("/contact"), availableLanguage: ["English"] },
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export function website() {
  // No SearchAction: the site has no public search page (and Google retired the sitelinks search box).
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    alternateName: ALTERNATE_NAMES,
    url: siteUrl("/"),
    inLanguage: "en",
    publisher: { "@id": ORGANIZATION_ID },
  };
}

/** The Windows desktop app: the live interview copilot that can listen to any call app. */
export function desktopApp() {
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE}/#windows-app`,
    name: "Orbit for Windows",
    description:
      "The Orbit desktop app for Windows: real-time answer suggestions during a live interview, grounded in your own resume, from any call app.",
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Interview assistant",
    operatingSystem: "Windows 10, Windows 11",
    downloadUrl: DESKTOP_DOWNLOAD_URL,
    url: siteUrl("/"),
    publisher: { "@id": ORGANIZATION_ID },
  };
}

/** One product of the web app (Orbit itself at "/", or Resume, Jobs, the warm-up at their own pages). */
export function webApp({ id, name, path, description, category = "BusinessApplication" }) {
  return {
    "@type": "WebApplication",
    "@id": `${siteUrl(path)}#app${id ? `-${id}` : ""}`,
    name,
    description,
    url: siteUrl(path),
    applicationCategory: category,
    operatingSystem: "Any (web browser)",
    browserRequirements: "Requires JavaScript. Works in current Chrome, Edge, Safari and Firefox.",
    publisher: { "@id": ORGANIZATION_ID },
  };
}

/** A page of the site, tied to the WebSite and the publisher. `type` may be a WebPage subtype (ContactPage, AboutPage…). */
export function webPage({ path, name, description, type = "WebPage", extra = {} }) {
  return {
    "@type": type,
    "@id": siteUrl(path),
    url: siteUrl(path),
    name,
    ...(description ? { description } : {}),
    inLanguage: "en",
    isPartOf: { "@id": WEBSITE_ID },
    publisher: { "@id": ORGANIZATION_ID },
    ...extra,
  };
}

/** Breadcrumbs from [name, path] pairs, home first: [["Home", "/"], ["Resume", "/resume-ai"]]. */
export function breadcrumbs(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: siteUrl(path) })),
  };
}

/**
 * FAQ markup, ONLY for a page that shows these exact questions and answers (plain text). Google no longer shows FAQ
 * rich results (2026), so this is for other engines and assistants; never add it without the visible FAQ.
 */
export function faqPage(path, items) {
  return {
    "@type": "FAQPage",
    "@id": `${siteUrl(path)}#faq`,
    mainEntity: items.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })),
  };
}

/** One JSON-LD document of linked nodes. */
export const graph = (...nodes) => ({ "@context": "https://schema.org", "@graph": nodes.filter(Boolean) });

/** JSON for inside <script type="application/ld+json">: "<" escaped so no value can close the script element. */
export const jsonLdText = (doc) => JSON.stringify(doc).replace(/</g, "\\u003c");

const PRODUCT_PAGES = {
  "/interview-copilot": {
    crumb: "Interview copilot",
    app: {
      id: "interview-copilot",
      name: "Orbit interview copilot",
      description:
        "During a live interview or call where AI help is allowed, Orbit hears the question and suggests an answer from the user's own resume and the job description. In Chrome, Edge or the Orbit app for Windows.",
    },
  },
  "/mock-interview": {
    crumb: "Mock interviews",
    app: {
      id: "mock-interview",
      name: "Orbit mock interviews",
      description:
        "Mock interviews with an AI interviewer that asks out loud, follows up on what was said and scores every answer: HR, technical, panel, salary and video rounds.",
      category: "EducationalApplication",
    },
  },
  "/resume-ai": {
    crumb: "Resume",
    app: {
      id: "resume-ai",
      name: "Orbit Resume",
      description:
        "A resume builder and checker: an ATS score out of 100, what's missing for the job you want, and AI rewrites that keep your own numbers. Editing, the score and Word/PDF downloads are free.",
    },
  },
  "/linkedin-ai": {
    crumb: "LinkedIn",
    app: {
      id: "linkedin-ai",
      name: "Orbit LinkedIn",
      description:
        "A LinkedIn profile checker: a score out of 100, section by section, the fixes to paste in (headline, About, roles, skills, the custom URL) and a preview of how a recruiter's search shows the profile. Not made by LinkedIn.",
    },
  },
  "/jobs": {
    crumb: "Jobs",
    app: {
      id: "jobs-ai",
      name: "Orbit Jobs",
      description:
        "New openings from companies' own careers pages, matched to your resume, with a job tracker and AI fit checks. Apply opens the original post.",
    },
  },
  "/warmup": {
    crumb: "Interview warm-up",
    app: {
      id: "warmup",
      name: "Orbit interview warm-up",
      description:
        "Free interview practice without an account: answer common interview questions out loud or by typing and see what to improve straight away.",
      category: "EducationalApplication",
    },
  },
};

PRODUCT_PAGES["/interview-questions"] = {
  crumb: "Interview Atlas",
  app: {
    id: "atlas",
    name: "Orbit Interview Atlas",
    description:
      "A free search across company and role interview guides: the rounds candidates report, what interviewers listen for, practice questions and each company's open jobs.",
    category: "EducationalApplication",
  },
};

PRODUCT_PAGES["/business"] = {
  crumb: "Orbit for Business",
  app: {
    id: "business",
    name: "Orbit for Business",
    description:
      "Hiring software for companies: a careers page with Google for Jobs markup, one-click applications from Orbit job seekers, AI ranking that shows its evidence while a person decides, a shared pipeline, scorecards and data controls.",
    category: "BusinessApplication",
  },
};

const OTHER_PAGES = {
  "/contact": { crumb: "Contact", type: "ContactPage" },
  "/technical": { crumb: "How Orbit works", type: "WebPage" },
  "/pricing": { crumb: "Pricing", type: "WebPage" },
  "/privacy": { crumb: "Privacy policy", type: "WebPage" },
  "/terms": { crumb: "Terms of use", type: "WebPage" },
  "/cookies": { crumb: "Cookie policy", type: "WebPage" },
  "/refund": { crumb: "Refund policy", type: "WebPage" },
};

/**
 * The structured data for one public page, or null for a page that has nothing true to add. Every graph carries the
 * Organization and WebSite nodes the page's nodes point at (by @id), so each page's markup stands on its own.
 * `title` and `description` are the page's own (what its <head> says), so the markup never disagrees with the page.
 */
export function structuredDataFor(path, { title, description } = {}) {
  if (path === "/") {
    return graph(
      organization(),
      website(),
      webPage({ path: "/", name: title || SITE_NAME, description, extra: { about: { "@id": ORGANIZATION_ID } } }),
      webApp({
        name: SITE_NAME,
        path: "/",
        description:
          "Interview practice and live interview help grounded in your resume, a resume checker with an ATS score, and new jobs that fit you, in one free account.",
      }),
      desktopApp(),
    );
  }
  const product = PRODUCT_PAGES[path];
  if (product) {
    return graph(
      organization(),
      website(),
      webPage({ path, name: title || product.app.name, description, extra: { mainEntity: { "@id": `${siteUrl(path)}#app-${product.app.id}` } } }),
      webApp({ ...product.app, path }),
      breadcrumbs([["Home", "/"], [product.crumb, path]]),
      // The page's own questions, word for word, where it shows them.
      faqsFor(path).length > 0 && faqPage(path, faqsFor(path)),
    );
  }
  const other = OTHER_PAGES[path];
  if (other) {
    return graph(
      organization(),
      website(),
      webPage({ path, name: title || other.crumb, description, type: other.type }),
      breadcrumbs([["Home", "/"], [other.crumb, path]]),
    );
  }
  return null;
}
