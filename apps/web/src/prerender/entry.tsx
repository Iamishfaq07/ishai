// The public pages, rendered to HTML at build time (`pnpm --filter @orbit/web build`: vite builds this for Node, then
// scripts/prerender.mjs writes what `buildSite` returns into dist/). Crawlers and assistants that don't run
// JavaScript read the page itself, not an empty root; people see it at once, and the app takes over when it loads
// (lib/prerender.tsx). The same components as the app, so the two look the same. Which pages, and where each goes:
// the registry in routes.tsx.
import "./shim";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { SpaceBackdrop } from "@orbit/ui";
import { AuthProvider } from "../lib/auth";
import { pageDocument, sitemapXml, type PageAssets } from "./document";
import { markdownFile, pageMarkdown } from "./markdown";
import { publicRoutes, type PageMeta } from "./routes";
import { SITE, url } from "./seo";

export type { PageMeta, PublicRoute } from "./routes";
export { POLICIES } from "./routes";

/** A policy page (a plain HTML file in public/) as its Markdown copy: its own title, description and body. */
export function policyMarkdown(path: string, document: string, lastmod: string): string {
  const pick = (re: RegExp) => (document.match(re)?.[1] ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  const body = document.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "";
  return pageMarkdown({ title: pick(/<title>([^<]*)<\/title>/i), description: pick(/<meta name="description" content="([^"]*)"/i),
    canonical: url(path) }, body.replace(/<!--[\s\S]*?-->/g, ""), SITE, lastmod);
}

/** A page as the app draws it at that address, signed out, with the sky behind it (main.tsx). */
export function renderPage(path: string, page: ReactNode): string {
  return renderToString(
    <StaticRouter location={path}>
      <AuthProvider>
        <SpaceBackdrop />
        {page}
      </AuthProvider>
    </StaticRouter>,
  );
}

/** The files to write into dist/: every registered page with a component, as a whole document (from the built
 *  index.html, with `assets`' fonts preloaded), and the sitemap of every registered page; each page that may be indexed also as Markdown. */
export async function buildSite(
  template: string,
  pageMeta: PageMeta,
  warn: (message: string) => void = console.warn,
  assets: PageAssets = {},
): Promise<Array<{ file: string; contents: string }>> {
  const routes = await publicRoutes(pageMeta);
  const files: Array<{ file: string; contents: string }> = [];
  for (const route of routes) {
    if (!route.file || !route.render || !route.head) continue;
    let html: string;
    try {
      html = renderPage(route.path, route.render());
    } catch (e) {
      if (!route.optional) throw e;
      warn(`prerender: ${route.path} didn't render, so it's served as the app alone: ${(e as Error).message}`);
      continue;
    }
    files.push({ file: route.file, contents: pageDocument(template, { path: route.path, head: route.head, html }, assets) });
    // Its Markdown copy, for AI assistants and agents (markdown.ts); a draft has none.
    if (!route.head.noindex) files.push({ file: markdownFile(route.path), contents: pageMarkdown(route.head, html, SITE, route.lastmod) });
  }
  // The sitemap lists what may be found in search: not a draft waiting for review (noindex).
  const listed = routes.filter((r) => !r.head?.noindex);
  files.push({ file: "sitemap.xml", contents: sitemapXml(listed.map((r) => ({ loc: url(r.path), lastmod: r.lastmod }))) });
  return files;
}
