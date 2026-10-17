// What each built page says about itself in its <head>: the title and description (for search results and link
// previews), its one canonical address, and structured data that only states what the page shows (breadcrumbs, what
// the page is about, who publishes it). No ratings, reviews, prices or FAQ markup: nothing here is a review, and the
// practice questions aren't answers to questions people asked us.
//
// Who publishes the site (Organization, WebSite) and the shared pieces come from the Worker's worker/site.js, the one
// source for both the built pages and the head tags the Worker adds to the rest (DECISIONS D67).
import { COMPANIES_PATH, ROLES_PATH, companyPath, rolePath, type BankKind } from "../pages/bank/content";
import type { BankCard, BankCompany, BankRole } from "../pages/bank/types";
import { GUIDES_PATH, guidePath, type GuideArticle } from "../pages/guides/articles";
import { SITE, breadcrumbs, graph, organization, siteUrl, structuredDataFor, webPage as sitePage, website } from "../../worker/site.js";
import { imageFor } from "../../worker/meta.js";

/** The site's own address: canonical links and the sitemap always name it (never a preview deployment). */
export { SITE };

export interface Head {
  title: string;
  description: string;
  /** This page's own address, absolute. */
  canonical: string;
  /** Its link-preview image, absolute; the site's own (og-image.jpg) when left out. */
  ogImage?: string;
  /** Structured data (JSON-LD), when there's something true to say. */
  jsonLd?: Record<string, unknown>;
  /** Kept out of search results (a draft waiting for review): `<meta name="robots" content="noindex">`, and left
   *  out of the sitemap. */
  noindex?: boolean;
}

export const url = (path: string): string => siteUrl(path);

/** A page's link-preview card, absolute: the one PAGE_IMAGES (worker/meta.js) names for it, as the Worker serves. */
export const ogImage = (path: string): string => `${SITE}${imageFor(path)}`;

const webPage = (path: string, title: string, description: string, extra: Record<string, unknown> = {}) =>
  sitePage({ path, name: title, description, extra });

/** A title for search results: the page's own words first, Orbit last, and the longest wording that fits in the
 *  60 characters results show before cutting a title off. */
function titled(...wordings: string[]): string {
  for (const w of wordings) if (`${w} | Orbit`.length <= 60) return `${w} | Orbit`;
  return `${wordings[wordings.length - 1]} | Orbit`;
}

/** One of the pages people share (the front page, the product pages, the warm-up…), with its title and description
 *  from the Worker's PAGE_META (worker/meta.js), so the built page and a link preview say the same. */
export function staticHead(path: string, meta: { title: string; description: string }): Head {
  // The page's structured data as the Worker states it (the apps on the front page, each product's own app).
  const jsonLd = structuredDataFor(path, meta) ?? graph(organization(), website(), webPage(path, meta.title, meta.description));
  return { title: meta.title, description: meta.description, canonical: url(path), ogImage: ogImage(path), jsonLd };
}

export function indexHead(kind: BankKind, cards: readonly BankCard[]): Head {
  const company = kind === "company";
  const path = company ? COMPANIES_PATH : ROLES_PATH;
  const questions = cards.reduce((n, c) => n + c.questions, 0).toLocaleString("en-US");
  const title = company ? "Company interview guides: rounds and questions | Orbit" : "Interview questions and guides by role | Orbit";
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
    ogImage: ogImage(path),
    jsonLd: graph(
      organization(),
      website(),
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
    ? titled(
        `${entry.name} interview process and practice questions`,
        `${entry.name} interview process and questions`,
        `${entry.name} interview questions`,
        `${entry.name} interview guide`,
      )
    : titled(`${entry.name} interview questions and what to expect`, `${entry.name} interview questions`, `${entry.name} interview guide`);
  // The first wording that fits in the ~160 characters results show.
  const fits = (...wordings: string[]) => wordings.find((w) => w.length <= 160) ?? wordings[wordings.length - 1]!;
  const description = company
    ? fits(
        `How ${entry.name} interviews, as candidates commonly report it: the rounds, what interviewers listen for, and ${n} practice questions with what a good answer covers.`,
        `How ${entry.name} interviews, as candidates report it: the rounds, what interviewers listen for, and ${n} practice questions with what a good answer covers.`,
        `How ${entry.name} interviews: the rounds, what interviewers listen for, and ${n} practice questions with what a good answer covers.`,
      )
    : fits(
        `What ${entry.name.toLowerCase()} interviews usually test, the usual stages, and ${n} practice questions with what a good answer covers. Practise free in the warm-up.`,
        `What ${entry.name.toLowerCase()} interviews usually test, the usual stages, and ${n} practice questions with what a good answer covers.`,
      );
  const about = company ? { "@type": "Organization", name: entry.name } : { "@type": "Occupation", name: entry.name };
  return {
    title,
    description,
    canonical: url(path),
    // Every guide shows its list's card (one for the companies, one for the roles).
    ogImage: ogImage(company ? COMPANIES_PATH : ROLES_PATH),
    jsonLd: graph(
      organization(),
      website(),
      breadcrumbs([["Home", "/"], [company ? "Companies" : "Roles", company ? COMPANIES_PATH : ROLES_PATH], [entry.name, path]]),
      webPage(path, title, description, { about, dateModified: entry.reviewed }),
    ),
  };
}

/** /guides: the articles' list. Out of search results until at least one article is published (a list of drafts). */
export function guidesHubHead(published: number): Head {
  const title = "Interview guides: answers, rounds and practice | Orbit";
  const description =
    "How to answer the questions most interviews ask, how companies interview and what interviews for each kind of job test, with free practice.";
  return {
    title,
    description,
    canonical: url(GUIDES_PATH),
    noindex: published === 0,
    jsonLd: graph(organization(), website(), breadcrumbs([["Home", "/"], ["Guides", GUIDES_PATH]]), webPage(GUIDES_PATH, title, description, { "@type": "CollectionPage" })),
  };
}

/** One article: its own title and description, an Article in the structured data, noindex while it's a draft. */
export function articleHead(article: GuideArticle): Head {
  const path = guidePath(article.slug);
  return {
    title: article.title,
    description: article.description,
    canonical: url(path),
    noindex: !article.published,
    jsonLd: graph(
      organization(),
      website(),
      breadcrumbs([["Home", "/"], ["Guides", GUIDES_PATH], [article.headline, path]]),
      webPage(path, article.title, article.description),
      {
        "@type": "Article",
        "@id": `${url(path)}#article`,
        headline: article.headline,
        description: article.description,
        dateModified: article.reviewed,
        inLanguage: "en",
        isAccessibleForFree: true,
        author: { "@id": `${SITE}/#organization` },
        publisher: { "@id": `${SITE}/#organization` },
        mainEntityOfPage: { "@id": url(path) },
      },
    ),
  };
}
