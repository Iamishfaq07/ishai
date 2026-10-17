# Search and AI visibility (SEO)

How orbitanswer.com presents itself to search engines and AI assistants, what the owner sets up once, and how to
check it. Why it's built this way: DECISIONS D67. Strategy, keywords and the content calendar:
`research/seo-strategy-2026-10-18.md` (outside the repo).

## What the site does on its own

All of it is in the web Worker, around the app (`apps/web/worker/seo.js`, `routes.js`, `site.js`), and runs first
for every address except the built files (`wrangler.jsonc` → `run_worker_first`).

| Address | Answer |
|---|---|
| A public page (`/`, `/resume-ai`, `/jobs`, `/warmup`, `/contact`, `/technical`, the policies, `/companies`, `/roles` and each guide) | 200, its built HTML (src/prerender), with any head tags it lacks added: canonical, `hreflang` `en` + `x-default`, Open Graph/Twitter tags, JSON-LD, verification codes (front page) |
| `/companies/<unknown>`, `/roles/<unknown>`, `/_prerender/*` | **404** (the built copies are served only at their own pages' addresses) |
| One of the app's own pages (sign-in, the signed-in pages; list in `routes.js`) | 200 (the app), `X-Robots-Tag: noindex`, no canonical |
| An invite link `/r/<code>` | 200, noindex, canonical `/` |
| Anything else | **404**, noindex. The body is still the app, so people see its "This page isn't here" with links; crawlers read static links |
| `http://`, `www.`, `/jobs/`, `/Resume-AI`, `/privacy.html`, `/index.html`, `//warmup`, `/resume-maker`, `/documents/resumes/…`, `/resume-ai/jobs/…` | one **301** to the single canonical address |
| `/robots.txt` | written by the Worker from the route list (below) |
| Any other host (a preview, `*.workers.dev`) | everything noindex, and robots.txt `Disallow: /` |

The sitemap is built with the site from the page registry (`apps/web/src/prerender/routes.tsx`), with each page's
real `lastmod` where it's known (a guide's review date, a policy's "Last updated" date). Files in `apps/web/public/`:
`llms.txt` and `llms-full.txt` (what Orbit is, for AI assistants: keep them true when products or pricing rules
change), `favicon.ico` (search results take ICO/PNG, not SVG), and `<32 hex>.txt`, the IndexNow key.

Structured data has one source, `apps/web/worker/site.js`: the build uses it for the prerendered pages and the
Worker for any public page without its own. Titles stay within 60 characters and descriptions within 160. Signed
out, the app keeps a public page's own title and description after it loads (`src/lib/servedHead.ts`), so Google,
which reads pages after their scripts run, sees the same head as crawlers that don't.

**Adding a public page:** register it in `src/prerender/routes.tsx` (title, description, canonical, structured data,
`lastmod`), and add its path to `PUBLIC_APP_PAGES` in `routes.js` (plus `PAGE_META` in `meta.js` if the Worker should
serve its built copy). Guides under `/companies` or `/roles` need nothing more. A new signed-in page: add it to
`APP_ROUTES` (the test `seo.test.js` fails if `App.tsx` has a route `routes.js` doesn't know), and to
`ROBOTS_DISALLOW_EXACT` if crawlers should stay out. After a merge, run `npx vitest run worker src/prerender` in
`apps/web` (the GitHub CI can't run).

**AI crawlers.** Search, answer and user-triggered crawlers are always allowed. Training crawlers (GPTBot, ClaudeBot,
Google-Extended, Applebot-Extended, CCBot, meta-externalagent, Amazonbot, MistralAI-Training) are allowed by default;
to keep them out, add `"AI_TRAINING_CRAWLERS": "block"` to `vars` in `wrangler.jsonc` and deploy. Bytespider is
always blocked.

## Owner setup (once, after this is deployed)

### 1. Cloudflare dashboard (5 minutes, do this first)

Cloudflare can block AI crawlers at the edge whatever robots.txt says.

1. Cloudflare → orbitanswer.com → **Security → Settings**, filter **Bot traffic**:
   - **Block AI bots / AI bot policies**: off, or "Allow" for Search and Agent crawlers. If you also want training
     crawlers kept out, set `AI_TRAINING_CRAWLERS` instead (above), so robots.txt and the edge agree.
   - **Manage robots.txt / Content Signals (managed robots.txt)**: **off**. The Worker writes robots.txt; Cloudflare's
     managed version would put `Disallow: /` for GPTBot, ClaudeBot, Google-Extended and others in front of it.
   - **Bot Fight Mode**: if on, check that "Verified bots" are allowed.
2. **AI Crawl Control → Crawlers**: every crawler you want (OAI-SearchBot, Claude-SearchBot, PerplexityBot,
   Googlebot, Bingbot…) on **Allow**.
3. Then open `https://orbitanswer.com/robots.txt`: it should start with
   `# https://orbitanswer.com/robots.txt, written by the web Worker`.

### 2. Google Search Console

1. https://search.google.com/search-console → **Add property** → **Domain** → `orbitanswer.com`.
2. Google shows a TXT record (`google-site-verification=…`). In Cloudflare → orbitanswer.com → **DNS → Records → Add
   record**: Type `TXT`, Name `@`, Content: the whole value Google shows, TTL Auto → Save. Back in Search Console →
   **Verify** (a few minutes; up to a day). Keep the record for good. (If Google offers to verify through Cloudflare
   automatically, that works too.)
   - Alternative, a URL-prefix property: copy only the code from Google's `<meta name="google-site-verification"
     content="CODE">` into `wrangler.jsonc` → `vars` → `"GOOGLE_SITE_VERIFICATION": "CODE"`, deploy, then Verify.
3. **Sitemaps** → submit `https://orbitanswer.com/sitemap.xml`.
4. **URL inspection** → `https://orbitanswer.com/` → **Request indexing**. Repeat for `/warmup`, `/resume-ai`, `/jobs`
   (there's a daily limit; the sitemap covers the rest).
5. In 1–2 weeks: **Pages** (indexing) report. Expect app pages under "Excluded by noindex" and "Blocked by
   robots.txt": that's intended. Anything under "Soft 404" or "Duplicate without user-selected canonical" is not.

### 3. Bing Webmaster Tools (also feeds Copilot and DuckDuckGo)

1. https://www.bing.com/webmasters → sign in → **Import** from Google Search Console (after step 2): it imports the
   site and its sitemap, verified. Or **Add site** manually and verify with the meta tag: paste the code from
   `<meta name="msvalidate.01" content="CODE">` as `"BING_SITE_VERIFICATION": "CODE"` in `wrangler.jsonc` → `vars`.
2. **Sitemaps**: check `https://orbitanswer.com/sitemap.xml` is there.
3. IndexNow needs no setup: the key file is part of the site. Submissions show under **IndexNow**.

### 4. Optional engines

- **Yandex Webmaster** (https://webmaster.yandex.com): only if you want Russian-language reach. Verify with the meta
  tag: `"YANDEX_VERIFICATION": "CODE"`. IndexNow already reaches Yandex.
- **Naver Search Advisor** (Korea) and **Seznam** (Czech Republic): not worth it for Orbit's markets; IndexNow already
  notifies both. If ever wanted: `"NAVER_SITE_VERIFICATION"`, `"SEZNAM_VERIFICATION"`.
- Baidu: skip (China only).

Each verification var is the code alone, not the whole tag. They're public (they appear in the page), so they go in
`vars`, not secrets. The Worker writes them on the front page only.

### 5. Tell search engines about changes (IndexNow)

After a deploy that adds or changes public pages, from the repo root:

```
node apps/web/scripts/indexnow.mjs --sitemap https://orbitanswer.com/sitemap.xml --all            # dry run: shows the list
node apps/web/scripts/indexnow.mjs --sitemap https://orbitanswer.com/sitemap.xml --all --send     # first time only
node apps/web/scripts/indexnow.mjs /warmup /companies/tcs --send                                  # just these pages
node apps/web/scripts/indexnow.mjs --sitemap https://orbitanswer.com/sitemap.xml --since 2026-11-01 --send  # changed since
```

It stops if `https://orbitanswer.com/<key>.txt` isn't live yet. Send changed pages only (the engines ask that
unchanged pages aren't resubmitted). To run it on every deploy, Cloudflare → Workers → orbit → **Settings → Build →
Deploy command**: `npx wrangler deploy && node apps/web/scripts/indexnow.mjs --sitemap
https://orbitanswer.com/sitemap.xml --since $(date -u +%F) --send || true` (picks pages whose sitemap `lastmod` is
today; pages without a `lastmod` are never picked, and a failed ping never fails the deploy).

### 6. Profiles that say who Orbit is

Create (or claim) Orbit's pages: LinkedIn company page, X, YouTube, Product Hunt, Microsoft Store (when listed),
Instagram if used. Each should link to `https://orbitanswer.com`. Then add their addresses to `SAME_AS` in
`apps/web/worker/site.js`: search engines use them to tie the profiles to the site (the knowledge panel).

## Checking it

- `node C:\Users\Ishfaq\tools\orbit-drive\seo\audit.mjs --base https://orbitanswer.com --render` (read-only, one
  request every 0.5 s): status codes, titles, descriptions, canonicals, robots, hreflang, preview tags, JSON-LD,
  links, images, redirects, HSTS, robots.txt per crawler, the sitemap, llms.txt. Writes a report with counts.
- Locally: build the web app, run `pnpm dlx wrangler@4 dev --local --port 5187 --var SITE_ORIGIN:http://127.0.0.1:5187`
  from the repo root, and point the audit at `http://127.0.0.1:5187`.
- Google's Rich Results Test (https://search.google.com/test/rich-results) and the Schema Markup Validator
  (https://validator.schema.org) for the structured data.
