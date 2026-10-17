// Every public page, in one registry: its address, where its built HTML goes, its <head> (title, description,
// canonical address, optional preview image and structured data), when it last changed, and how to draw it. The
// build renders each one (entry.tsx) and the sitemap lists them all, in this order. To publish another public page
// as HTML, add it here (and, if the Worker should serve it, to PAGE_META in worker/meta.js).
import type { ReactNode } from "react";
import { companies as companyCards, roles as roleCards } from "virtual:question-bank/cards";
import { ContactPage } from "../pages/Contact";
import { LandingPage } from "../pages/Landing";
import { TechnicalPage } from "../pages/Technical";
import { WarmupPage } from "../pages/Warmup";
import { JobsAiPublicPage } from "../pages/jobs/JobsAiPublic";
import { ResumeAiPublicPage } from "../pages/resume/ResumeAiPublic";
import { BankIndexView, GuideView } from "../pages/bank/BankPages";
import { COMPANIES_PATH, ROLES_PATH, companyPath, rolePath } from "../pages/bank/content";
import { loadCompany, loadRole } from "../pages/bank/docs";
import { ARTICLES, GUIDES_PATH, guidePath, publishedArticles } from "../pages/guides/articles";
import { ArticleView, GuidesHubView } from "../pages/guides/GuidesPages";
import { articleHead, guideHead, guidesHubHead, indexHead, staticHead, type Head } from "./seo";

export type PageMeta = Record<string, { title: string; description: string }>;

export interface PublicRoute {
  /** The address ("/companies/amazon"). */
  path: string;
  /** Under dist/, where its built copy goes; none for a page that's already a file (public/privacy.html, at
   *  /privacy), which is only listed in the sitemap. */
  file?: string;
  head?: Head;
  /** ISO date it last changed, where we know it (the sitemap's lastmod). */
  lastmod?: string;
  /** The page as the app draws it at this address, signed out. */
  render?: () => ReactNode;
  /** A product page whose code changes often: if it ever fails to render, the build leaves it to the app (and says
   *  so) instead of failing; the tests still require it to render. A guide that fails stops the build. */
  optional?: boolean;
}

/** The pages in the Worker's PAGE_META and their components; the Worker serves their built copies (worker/prerendered.js). */
const WORKER_PAGES: Record<string, () => ReactNode> = {
  "/": () => <LandingPage />,
  "/resume-ai": () => <ResumeAiPublicPage />,
  "/jobs": () => <JobsAiPublicPage />,
  "/warmup": () => <WarmupPage />,
  "/contact": () => <ContactPage />,
  "/technical": () => <TechnicalPage />,
};

/** Where the Worker finds a PAGE_META page's built copy (worker/prerendered.js `prerenderedAsset`). */
export const workerFile = (path: string): string => `_prerender/${path === "/" ? "home" : path.slice(1)}.html`;

/**
 * The policies: plain HTML files in public/, served at their address without ".html" (the Worker redirects the
 * ".html" one), with the "Last updated" date each one shows (prerender.test.ts checks the two agree).
 */
export const POLICIES: ReadonlyArray<{ path: string; file: string; lastmod: string }> = [
  { path: "/privacy", file: "privacy.html", lastmod: "2026-10-18" },
  { path: "/terms", file: "terms.html", lastmod: "2026-10-17" },
  { path: "/cookies", file: "cookies.html", lastmod: "2026-10-17" },
  { path: "/refund", file: "refund.html", lastmod: "2026-10-17" },
];

const latest = (dates: string[]) => dates.reduce((a, b) => (b > a ? b : a), "");

export async function publicRoutes(pageMeta: PageMeta): Promise<PublicRoute[]> {
  const routes: PublicRoute[] = Object.entries(pageMeta).map(([path, meta]) => {
    const render = WORKER_PAGES[path];
    if (!render) throw new Error(`prerender: PAGE_META has ${path}, which routes.tsx doesn't render`);
    return { path, file: workerFile(path), head: staticHead(path, meta), render, optional: true };
  });

  const companies = (await Promise.all(companyCards.map((c) => loadCompany(c.slug)))).map((c, i) => {
    if (!c) throw new Error(`prerender: no guide file for ${companyCards[i]!.slug}`);
    return c;
  });
  routes.push({
    path: COMPANIES_PATH,
    file: "companies.html",
    head: indexHead("company", companyCards),
    lastmod: latest(companies.map((c) => c.reviewed)),
    render: () => <BankIndexView kind="company" />,
  });
  for (const c of companies) {
    routes.push({ path: companyPath(c.slug), file: `companies/${c.slug}.html`, head: guideHead("company", c), lastmod: c.reviewed, render: () => <GuideView kind="company" entry={c} /> });
  }

  const roles = (await Promise.all(roleCards.map((r) => loadRole(r.slug)))).map((r, i) => {
    if (!r) throw new Error(`prerender: no guide file for ${roleCards[i]!.slug}`);
    return r;
  });
  routes.push({
    path: ROLES_PATH,
    file: "roles.html",
    head: indexHead("role", roleCards),
    lastmod: latest(roles.map((r) => r.reviewed)),
    render: () => <BankIndexView kind="role" />,
  });
  for (const r of roles) {
    routes.push({ path: rolePath(r.slug), file: `roles/${r.slug}.html`, head: guideHead("role", r), lastmod: r.reviewed, render: () => <GuideView kind="role" entry={r} /> });
  }

  // Orbit's articles (pages/guides/articles.ts): a draft is built too, so the owner can read it at its address, but
  // it's noindex and the sitemap leaves it out (entry.tsx) until it's published.
  const published = publishedArticles();
  routes.push({
    path: GUIDES_PATH,
    file: "guides.html",
    head: guidesHubHead(published.length),
    lastmod: latest(published.map((a) => a.reviewed)) || undefined,
    render: () => <GuidesHubView articles={published} />,
  });
  for (const a of ARTICLES) {
    routes.push({ path: guidePath(a.slug), file: `guides/${a.slug}.html`, head: articleHead(a), lastmod: a.reviewed, render: () => <ArticleView article={a} /> });
  }

  routes.push(...POLICIES.map(({ path, lastmod }) => ({ path, lastmod })));
  return routes;
}
