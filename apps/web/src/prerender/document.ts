// A built page's file: the app's own index.html with this page's <head> and its HTML in front of the app's root.
// String surgery on a file we write ourselves (apps/web/index.html); each tag must be found, so a changed template
// fails the build here rather than shipping a page with the front page's title.
import type { Head } from "./seo";

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** JSON that's safe inside a <script> element (no "</script>", no HTML comment openers). */
export const scriptJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

function swap(html: string, pattern: RegExp, replace: (...groups: string[]) => string, what: string): string {
  if (!pattern.test(html)) throw new Error(`prerender: index.html has no ${what}`);
  return html.replace(pattern, (...m: string[]) => replace(...m));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function content(html: string, attr: "name" | "property", name: string, value: string): string {
  const re = new RegExp(`(<meta ${attr}="${escapeRe(name)}" content=")[^"]*(")`);
  return swap(html, re, (_m, open, close) => `${open}${escapeHtml(value)}${close}`, `<meta ${attr}="${name}">`);
}

/** index.html as this page: its title, description, previews, canonical link and structured data, and its HTML
 *  in `<div id="prerender">` just before `<div id="root">` (lib/prerender.tsx hands over when the app is ready).
 *  Every built page is a front-door page, so `<html>` carries `site` (marketing/site.css) from the first paint; the
 *  app keeps it on a public page and drops it on hand-off to anything else. */
export function pageDocument(template: string, page: { path: string; head: Head; html: string }): string {
  const { head } = page;
  let out = swap(template, /<html lang="en">/, () => `<html lang="en" class="site">`, "<html lang=\"en\">");
  out = swap(out, /<title>[^<]*<\/title>/, () => `<title>${escapeHtml(head.title)}</title>`, "<title>");
  out = content(out, "name", "description", head.description);
  out = content(out, "property", "og:title", head.title);
  out = content(out, "property", "og:description", head.description);
  out = content(out, "property", "og:url", head.canonical);
  out = content(out, "name", "twitter:title", head.title);
  out = content(out, "name", "twitter:description", head.description);
  out = swap(out, /(<link rel="canonical" href=")[^"]*(")/, (_m, open, close) => `${open}${escapeHtml(head.canonical)}${close}`, "canonical link");
  if (head.ogImage) {
    out = content(out, "property", "og:image", head.ogImage);
    out = content(out, "name", "twitter:image", head.ogImage);
  }
  if (head.jsonLd) {
    const data = scriptJson(head.jsonLd);
    out = swap(out, /<\/head>/, () => `  <script type="application/ld+json">${data}</script>\n  </head>`, "</head>");
  }
  return swap(
    out,
    /<div id="root"><\/div>/,
    () => `<div id="prerender" data-path="${escapeHtml(page.path)}">${page.html}</div><div id="root"></div>`,
    '<div id="root">',
  );
}

/** sitemap.xml for these addresses (absolute), with the date each last changed where we know it. */
export function sitemapXml(entries: ReadonlyArray<{ loc: string; lastmod?: string }>): string {
  const urls = entries.map((e) => `  <url><loc>${escapeHtml(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
