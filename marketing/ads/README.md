# Orbit ad creatives

Static creatives for Orbit's own campaigns: four products in five sizes, plus a profile banner, for India (`in`) and
everywhere else (`global`). The PNGs in `out/` are rendered from HTML, so every word lives in `copy.json` and every
size is one layout in `templates/ads.css`.

## Files

| Path | What it is |
| --- | --- |
| `copy.json` | All copy, per product and region; the crop of the product screen each one shows. |
| `templates/ad.html` | The one template. Its double-brace placeholders are filled in by `export.mjs`. |
| `templates/ads.css` | The brand (IBM Plex Sans, one violet accent, ink neutrals) and one layout per size. |
| `export.mjs` | Fills the template for each creative and screenshots it in headless Chrome at the exact size. |
| `out/<region>/<product>-<w>x<h>.png` | The exported creatives (42). |

Product renders come from `../screens/src/*.png`: real screenshots of the app with made-up demo data (see
`../screens/README.md`). The wordmark is `../brand/orbit-wordmark-{light,dark}.svg`.

| Product | Theme | Sizes |
| --- | --- | --- |
| `copilot` (Interview copilot) | dark | 1080x1080, 1080x1350, 1080x1920, 1200x628, 1200x1200 |
| `practice` (Practice) | light | the same five |
| `resume` (Resume AI) | light | the same five |
| `jobs` (Jobs AI) | dark | the same five |
| `banner` (all four products) | dark | 1500x500 |

Where each size goes: 1080x1080 and 1200x1200 Instagram and LinkedIn feeds; 1080x1350 the 4:5 feed post; 1080x1920
stories and reels covers (the top 230 px and bottom 300 px are left clear of the apps' own buttons and captions);
1200x628 LinkedIn and Facebook link ads; 1500x500 the X header and LinkedIn cover (the profile photo covers the bottom
left, so the copy starts 340 px in).

## Re-export

Needs Node, system Chrome (run headless) and the repo's dependencies: `pnpm install` at the root brings Playwright
(`@playwright/test`, used by default; `--playwright <path to playwright-core's index.mjs>` to use another) and the
fonts, which load from `apps/web/node_modules`. Run from the repo root.

```sh
node marketing/ads/export.mjs                                  # all 42, no prices
node marketing/ads/export.mjs --only copilot,banner            # some products ("banner" is the banner)
node marketing/ads/export.mjs --regions in --sizes 1080x1080,1200x628
node marketing/ads/export.mjs --html                           # keep the filled-in HTML in .build/ to preview in Chrome
node marketing/ads/export.mjs --out /tmp/ads-with-prices ...   # write somewhere else
```

The exporter warns when any text runs off the canvas. Look at every PNG after changing copy: long words wrap
differently at each size.

## Prices: filled in at export, never stored

Prices change (the rupee prices are being cut right now), so no price is written into `copy.json` or the template,
and the committed PNGs show none. "Free to start" is always true: new accounts get free interview minutes and an AI
credit, and the free tier exists. To show a price, fill it in when you export, into a separate `--out` folder:

```sh
# The same price on every product that has one (copilot, practice, resume)…
node marketing/ads/export.mjs --price-in '₹1,649' --price-global '$19.99' --out /tmp/ads-priced   # single quotes: "$1…" is a shell variable
# …or per product
node marketing/ads/export.mjs --price-in 'copilot=₹1,649;practice=₹1,649;resume=₹499' --out /tmp/ads-priced
# Or read today's prices from the public API at export time
node marketing/ads/export.mjs --prices-api https://api.orbitanswer.com --out /tmp/ads-priced
```

The line reads "From {price}, paid once. Nothing renews." (`copy.json` → `regions.*.price`). Jobs AI never shows one
(its matches and tracker are free).

`--prices-api` takes the cheapest pack with interview time for the copilot and Practice, and the cheapest pack with
Resume AI credits for Resume AI (buyable ones first). The public API prices by the caller's country, so run from India
it answers in rupees and fills only the `in` creatives. A signed-out call has no other country to go by (a local stack
answers in rupees too), so for dollars pass `--price-global`, with the prices orbitanswer.com shows a visitor from
outside India (or a signed-in account whose country isn't India). Check every number against the site before you
publish.

## Copy rules

- True of the live product, and checkable on the site or in the app. Nothing like "undetectable", "stealth",
  "invisible", "guaranteed job" or "get hired fast".
- No invented numbers, ratings, user counts, testimonials or employer logos. The companies in the product renders
  (Kestrel Pay, Juniper Logistics and the rest) and the person (Aditi Rao) are made up.
- Never name an AI vendor.
- The copilot creatives and the banner carry "For practice and interviews where AI help is allowed."
- Headlines in sentence case, 7 words at most. India: Indian English ("practise", "freshers", "placements",
  "HR round", "switch"), UPI. Elsewhere: international English, PayPal or card.
- One accent (violet #7048F5); product colours only on the small product mark; the only shadow is under the product
  window; no glows, starfields or gradient text.

Claims the copy makes, and where they're true: answers built from the resume with the lines used shown (the live
answer card's sources), Chrome and Edge tab audio and the Windows app in beta (front page FAQ), coding and screenshot
answers (live session), an AI interviewer with a scorecard per answer (session review), AI video interview (Practice),
ATS score out of 100 and a tailored copy per job, numbers kept (Resume AI), Word and PDF downloads free, jobs from
companies' own careers pages with a fit score and a free tracker (Jobs AI), free to start, no subscription, nothing
auto-renews (pricing), UPI in India and PayPal or card elsewhere (checkout).
