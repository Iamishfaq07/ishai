---
name: seo
description: Orbit's search and AI-visibility playbook. Use when adding or changing a public page (front page, product pages, /companies, /roles, /guides, policies), titles, descriptions, structured data, the sitemap, robots.txt, llms.txt, redirects or Markdown copies, when planning SEO content (guides, comparison or programmatic pages), or when asked to audit or improve SEO, GEO/AEO (AI Overviews, ChatGPT, Perplexity, Claude citations) or Search Console reports.
---

# Orbit SEO

How orbitanswer.com earns search and AI-assistant visibility, and the rules every public-page change keeps. The
owner-facing setup (Search Console, Bing, Cloudflare, IndexNow) is in `docs/SEO.md`; the reasons are DECISIONS D67.

## Where things live

| What | File |
|---|---|
| Every public page: path, title, description, canonical, JSON-LD, lastmod, component | `apps/web/src/prerender/routes.tsx` |
| Head text and structured data per page kind | `apps/web/src/prerender/seo.ts` |
| Organization, WebSite, breadcrumbs, FAQ, apps (one source for build and Worker) | `apps/web/worker/site.js` |
| Redirects (http, www, slash, `.html`, case, moved pages), robots.txt, 404s, noindex, Markdown serving | `apps/web/worker/seo.js` |
| Public vs app vs referral addresses, robots rules, moved pages | `apps/web/worker/routes.js` |
| Built HTML + sitemap + Markdown copies | `apps/web/src/prerender/entry.tsx`, `document.ts`, `markdown.ts` |
| For AI assistants | `apps/web/public/llms.txt`, `llms-full.txt` |
| Product FAQs (visible and in FAQ markup, same words) | `apps/web/worker/faqs.js` |

## Rules (never break these)

1. **Truth first.** No invented numbers, ratings, reviews, prices, user counts, awards or quotes, in copy or in
   schema. Competitor facts only with a cited, dated public source. Draft articles stay `published: false` until the
   owner has read them.
2. **One address per page.** The Worker 301s every variant to the canonical. The sitemap, internal links and
   canonicals name only final addresses (no trailing slash, no `.html`, lower case, `https://orbitanswer.com`).
   Search Console's "Page with redirect" for those variants is expected; a real page in that report is a bug.
3. **Titles ≤ 60 characters, descriptions ≤ 160**, page words first and "Orbit" last (`seo.ts` builds them).
4. **Structured data states only what the page shows.** FAQ markup only next to the same visible questions; no
   Review/AggregateRating; BreadcrumbList on nested pages; Organization + WebSite on every page via `site.js`.
5. **App pages are noindex** (`X-Robots-Tag`), unknown addresses are real 404s, preview hosts are noindex.
6. **AI crawlers welcome** (search, answer and user-triggered always; training by default, `AI_TRAINING_CRAWLERS`).
7. **Every indexable built page has a Markdown copy** (`/x.md`, `/index.md`; `Accept: text/markdown` on the page
   itself) with `Link: rel="canonical"` to the page and `<link rel="alternate" type="text/markdown">` in its head.
8. **No thin programmatic pages.** A generated page (company, role, guide) needs content unique to it: its own
   process, questions, what a good answer covers, a review date. Swapping a name into a template is not a page.

## Adding a public page

1. Register it in `routes.tsx` (`WORKER_PAGES` + `PAGE_META` in `worker/meta.js` for a product page, or the bank /
   articles data for a guide). Give it a `lastmod` when you know one.
2. Add its path to `PUBLIC_APP_PAGES` in `worker/routes.js` (guides under `/companies`, `/roles`, `/guides` need
   nothing more).
3. Give it a preview image in `PAGE_IMAGES` (`worker/meta.js`) if it's a product page.
4. Link to it from at least one indexable page (footer, hub or related links) and mention it in `llms.txt`.
5. Build (`npx -y pnpm@9.12.0 --filter @orbit/web build`) and check `dist/` has its `.html`, its `.md` and a sitemap
   entry.

## Audit checklist

Run it against a local build or the live site (`docs/SEO.md` → "Checking it").

- **Crawl and index:** 200 for public pages, 301 (one hop) for variants, 404 + noindex for unknown, noindex on app
  pages; robots.txt from the Worker (starts `# https://orbitanswer.com/robots.txt, written by the web Worker`);
  sitemap has only 200, indexable, canonical URLs with true `lastmod` (no `priority`/`changefreq`).
- **Head:** unique title and description per page, self-canonical, `hreflang` en + x-default, OG/Twitter tags with a
  1200×630 image, Markdown alternate.
- **Structured data:** valid JSON-LD (validator.schema.org), types Google still supports for rich results where
  they apply (BreadcrumbList, Organization, SoftwareApplication); nothing the page doesn't show.
- **Content (E-E-A-T):** who publishes it, when it was last reviewed, sources or "as candidates commonly report it",
  first-hand product detail (what Orbit actually does, with limits), no keyword stuffing.
- **GEO / AI citation:** answer the page's question in the first 50–80 words; short sections under clear H2s;
  lists and tables for steps and comparisons; quotable, specific facts; consistent entity name ("Orbit AI",
  orbitanswer.com); `llms.txt` current; Markdown copy reads cleanly.
- **Internal links:** every guide links to its hub, related guides and the matching free tool; hubs link to every
  child; no orphan pages.
- **Performance (Core Web Vitals):** built pages paint from HTML + CSS + one font; the app loads after first paint
  (`docs/PERFORMANCE.md`); images sized, lazy below the fold, WebP/AVIF where possible.

## Content to grow next (in order)

1. Publish the reviewed drafts in `pages/guides/articles.ts`, then one article a week on questions candidates search
   (e.g. "how to answer <common question>", "<company> interview process <year>"), each linking to the matching
   company/role guide and the free warm-up.
2. More company and role guides where Orbit has real, reviewed material.
3. Comparison or "alternatives" pages only with dated, sourced facts and fair wording (rule 1).
4. Profiles that say who Orbit is (LinkedIn, X, YouTube, Product Hunt) added to `SAME_AS` in `site.js`.
