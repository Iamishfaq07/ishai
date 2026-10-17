// What each built page says about itself in its <head>: the title and description (for search results and link
// previews), its one canonical address, and structured data that only states what the page shows (breadcrumbs, what
// the page is about, who publishes it). No ratings, reviews, prices or FAQ markup: nothing here is a review, and the
// practice questions aren't answers to questions people asked us.
import { COMPANIES_PATH, ROLES_PATH, companyPath, rolePath, type BankKind } from "../pages/bank/content";
import type { BankCard, BankCompany, BankRole } from "../pages/bank/types";

/** The site's own address: canonical links and the sitemap always name it (never a preview deployment). */
export const SITE = "https://orbitanswer.com";

export interface Head {
  title: string;
  description: string;
  /** This page's own address, absolute. */
  canonical: string;
  /** Its link-preview image, absolute; the site's own (og-image.jpg) when left out. */
  ogImage?: string;
  /** Structured data (JSON-LD), when there's something true to say. */
  jsonLd?: Record<string, unknown>;
}

const ORGANIZATION = {
  "@type": "Organization",
  "@id": `${SITE}/#organization`,
  name: "Orbit AI",
  url: `${SITE}/`,
  logo: `${SITE}/icon-512.png`,
};

const WEBSITE = {
  "@type": "WebSite",
  "@id": `${SITE}/#website`,
  name: "Orbit AI",
  url: `${SITE}/`,
  publisher: { "@id": ORGANIZATION["@id"] },
  inLanguage: "en",
};

export const url = (path: string): string => `${SITE}${path === "/" ? "/" : path}`;

function breadcrumbs(items: Array<[string, string]>) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: url(path) })),
  };
}

function webPage(path: string, title: string, description: string, extra: Record<string, unknown> = {}) {
  return {
    "@type": "WebPage",
    "@id": url(path),
    url: url(path),
    name: title,
    description,
    inLanguage: "en",
    isPartOf: { "@id": WEBSITE["@id"] },
    publisher: { "@id": ORGANIZATION["@id"] },
    ...extra,
  };
}

const graph = (...nodes: Array<Record<string, unknown>>) => ({ "@context": "https://schema.org", "@graph": nodes });

/** A title for search results: the page's own words first, Orbit last, short enough not to be cut. */
function titled(long: string, short: string): string {
  const t = `${long} | Orbit`;
  return t.length <= 70 ? t : `${short} | Orbit`;
}

/** One of the pages people share (the front page, the product pages, the warm-up…), with its title and description
 *  from the Worker's PAGE_META (worker/meta.js), so the built page and a link preview say the same. */
export function staticHead(path: string, meta: { title: string; description: string }): Head {
  const jsonLd = graph(ORGANIZATION, WEBSITE, webPage(path, meta.title, meta.description));
  return { title: meta.title, description: meta.description, canonical: url(path), jsonLd };
}

export function indexHead(kind: BankKind, cards: readonly BankCard[]): Head {
  const company = kind === "company";
  const path = company ? COMPANIES_PATH : ROLES_PATH;
  const questions = cards.reduce((n, c) => n + c.questions, 0).toLocaleString("en-US");
  const title = company ? "Company interview guides: process and practice questions | Orbit" : "Interview questions and guides by role | Orbit";
  const description = company
    ? `How ${cards.length} companies interview, from TCS and Infosys to Google and Goldman Sachs: the rounds, what interviewers listen for, and ${questions} practice questions. Free.`
    : `What interviews for ${cards.length} jobs usually test, from campus placements and software engineering to nursing and sales, with ${questions} practice questions. Free.`;
  const list = {
    "@type": "ItemList",
    itemListElement: cards.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, url: url(company ? companyPath(c.slug) : rolePath(c.slug)) })),
  };
  return {
    title,
    description,
    canonical: url(path),
    jsonLd: graph(
      ORGANIZATION,
      WEBSITE,
      breadcrumbs([["Home", "/"], [company ? "Companies" : "Roles", path]]),
      { ...webPage(path, title, description), "@type": "CollectionPage", mainEntity: list },
    ),
  };
}

export function guideHead(kind: BankKind, entry: BankCompany | BankRole): Head {
  const company = kind === "company";
  const path = company ? companyPath(entry.slug) : rolePath(entry.slug);
  const n = entry.questions.length;
  const title = company
    ? titled(`${entry.name} interview process and practice questions`, `${entry.name} interview guide`)
    : titled(`${entry.name} interview questions and what to expect`, `${entry.name} interview guide`);
  const description = company
    ? `How ${entry.name} interviews, as candidates commonly report it: the rounds, what interviewers listen for, and ${n} practice questions with what a good answer covers.`
    : `What ${entry.name.toLowerCase()} interviews usually test, the usual stages, and ${n} practice questions with what a good answer covers. Practise free in the warm-up.`;
  const about = company ? { "@type": "Organization", name: entry.name } : { "@type": "Occupation", name: entry.name };
  return {
    title,
    description,
    canonical: url(path),
    jsonLd: graph(
      ORGANIZATION,
      WEBSITE,
      breadcrumbs([["Home", "/"], [company ? "Companies" : "Roles", company ? COMPANIES_PATH : ROLES_PATH], [entry.name, path]]),
      webPage(path, title, description, { about, dateModified: entry.reviewed }),
    ),
  };
}
