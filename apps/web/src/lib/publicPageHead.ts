import { PAGE_META, imageFor } from "../../worker/meta.js";
import { SITE, structuredDataFor, graph, organization, website, webPage } from "../../worker/site.js";
import type { Head } from "../prerender/seo";

/** Resolve the same metadata as static generation, loading guide content only on a guide route. */
export async function publicPageHead(pathname: string): Promise<Head | null> {
  const path = pathname.replace(/\/+$/, "") || "/";
  const meta = PAGE_META[path];
  if (meta) return { ...meta, canonical: `${SITE}${path}`, ogImage: `${SITE}${imageFor(path)}`,
    jsonLd: structuredDataFor(path, meta) ?? graph(organization(), website(), webPage({ path, name: meta.title, description: meta.description })) };
  if (!/^\/(?:companies|roles|guides)(?:\/[^/]+)?$/.test(path)) return null;
  const seo = await import("../prerender/seo");
  if (path === "/guides" || path.startsWith("/guides/")) {
    const articles = await import("../pages/guides/articles");
    if (path === "/guides") return seo.guidesHubHead(articles.publishedArticles().length);
    const article = articles.articleFor(path.slice("/guides/".length));
    return article ? seo.articleHead(article) : null;
  }
  const company = path.startsWith("/companies");
  const kind = company ? "company" : "role";
  const base = company ? "/companies" : "/roles";
  if (path === base) {
    const cards = await import("virtual:question-bank/cards");
    return seo.indexHead(kind, company ? cards.companies : cards.roles);
  }
  const docs = await import("../pages/bank/docs");
  const entry = company ? await docs.loadCompany(path.slice(base.length + 1)) : await docs.loadRole(path.slice(base.length + 1));
  return entry ? seo.guideHead(kind, entry) : null;
}
