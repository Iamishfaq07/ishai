# Performance

The budgets Orbit is held to, what was measured on 18 Oct 2026 (DECISIONS D72), and how to measure again. Numbers are
from local, seeded copies only: production is never load-tested or benchmarked (single read-only GETs at most).

## Budgets

### API (server time)
Measured in-process (the real app: middleware, auth, gzip; no network) on a seeded local Postgres, one request at a
time, for a heavy account (300 sessions, 40 documents, 400 tracked jobs, 80 stories, 150 saved answers, 200 evidence
claims) among 2,000 others. The network adds the rest: India to Singapore is ~70-100 ms a round trip, the Worker
proxy ~10-30 ms.

| what | p95 budget | queries |
|---|---|---|
| the app shell's reads (`auth/me`, `entitlements`, `usage`, `announcement`, `region`, `plans`) | 10 ms | fixed |
| a page's own list (sessions, documents, resumes, tracker, stories, answers, contacts) | 25 ms (40 ms for a list of hundreds) | fixed |
| one item (a session, a resume, a job, the mission room) | 15 ms | fixed |
| writes on the hot path (create session, live ticket) | 15 ms | fixed |
| admin reports (users, stats, costs) | 500 ms | must not grow with the number of accounts |

"Fixed" means the same number of SQL statements for an account with 2 of everything and one with 9:
`apps/api/tests/test_query_budget.py` checks that, and a ceiling per endpoint, on every test run. On Postgres each
statement is a round trip to the database (~0.3-1 ms on Railway's private network), so an N+1 costs real time there
even when SQLite hides it.

### Web
- **JavaScript** (gzip, first load: the entry plus what the page's chunk imports): `apps/web/scripts/bundle-budget.mjs`
  holds the budget per page and fails CI after the build when one is over (`pnpm --filter @orbit/web budget`).

  | entry (every page) | CSS | Home | front page | Sessions | Setup | Mock | Live | Resume AI | resume editor | Jobs AI |
  |---|---|---|---|---|---|---|---|---|---|---|
  | 170 kB | 32 kB | 211 | 206 | 185 | 200 | 206 | 246 | 205 | 255 | 280 |

  The public product pages (D79), signed out: Resume AI 226, Jobs AI 209, the copilot 212, Practice 207, LinkedIn AI
  207 kB (measured 215.0, 198.3, 201.1, 196.7 and 196.6 kB when they were built on the section kit; they were 194.0,
  189.9, 181.2 and 184.1 kB before, LinkedIn AI had no page). Home, the front page and Mock went up 1 kB for D79: the
  kit's shared pieces (the live answer and the sticky bar the front page shares, the one-tap rounds Mock shares with
  /mock-interview, the stage pill, the search preview, a few icons) became chunks of their own, and every chunk's name
  is in the entry's preload map, so every first load carries 0.3 kB more (Home 209.7 → 210.1, front page 204.1 →
  205.1, Mock 204.6 → 205.3 kB).

  About 5% over main as measured on 18 Oct 2026 after the merges of that day (entry 162.4, CSS 29.1, Home 201.9,
  front page 195.6, Sessions 177.7, Setup 191.8, Mock 197.6, Live 243.6, Resume AI 196.8, resume editor 243.6, Jobs
  AI 267.7 kB), so a real jump fails CI and a few lines don't. The first run on that main caught the video room
  (D69) adding ~14 kB to every live session's first load (Live 229 → 244 kB); Live's budget was raised for it. The
  product audit (D73) then loaded the room only for video interviews (Live 234 kB with the audit's additions), and
  Live's budget came back down to 246. Raising a budget needs its reason here.

  The entry, Sessions and Live went up 1 kB each on 18 Oct 2026 (entry 169.9 → 170.3, Sessions 185.5, Live 246.5
  with D79): D80 put the API client's direct route (the cookie-domain handshake, the fallback) in the entry, which
  every page loads, and D76's addendum added Saba's retry, `sayNaturalLine` and `voiceSetup` to Live. Both are
  behaviour that has to be there before the first call or the first line, not code a page could load later.

- **LCP** ≤ 2.5 s on a phone: Lighthouse mobile for the public pages; for signed-in pages, a warm cache under slow 4G
  (1.6 Mbps, 150 ms RTT) and a 4x CPU slowdown (`perf/web/profile.mjs`).
- **INP** ≤ 200 ms at p75, and no task over 200 ms while a page opens (total blocking time ≤ 300 ms), under the same
  phone profile. A list that can hold hundreds of items draws in batches (`lib/useProgressive.ts`).
- **CLS** ≤ 0.1.

### Live copilot (speech end → first word of the answer)
| stage | budget | measured |
|---|---|---|
| speech end → final transcript (Deepgram endpointing 300 ms + processing) | provider | ~0.6-1.0 s |
| the deliberate wait (Quick 0, Balanced 1.5 s, Patient 3 s) | a product setting, never trimmed | 0 / 1.5 / 3 s |
| final transcript → question fired (finalizer, server) | 1 ms | 0.12 ms |
| question fired → LLM request sent (retrieval + prompt, server) | 5 ms p95 | 2.3 ms p50 (408 indexed items) |
| LLM first token (DeepSeek) | provider | ~0.7-1.0 s; started early during the wait (speculation), so mostly hidden on Balanced |
| server work per streamed token | 0.2 ms | 0.06 ms |
| a chunk to the browser (Singapore → India) | network | ~40-60 ms |
| the browser's work per answer chunk (React) | 4 ms on a phone | well under it: the answer card is not the main-thread cost (see below) |
| connect: ticket → `session.started` (session, plan, index of the session's documents) | 150 ms | 60 ms (p95 75) |

Overall, Balanced: p50 ~2.6 s (2.58 s measured), of which Orbit's own server work is under 10 ms.

## Baseline and after (18 Oct 2026)

Before is origin/main at 7d7151c9, after is this work on it; the branch was then rebased onto main 8ced5c55 (the
budgets above are measured there).

### API — p50 / p95 in ms, in-process, seeded local Postgres 18, 30 calls each (`perf/bench.py`, `perf/ab.sh`)
Before = origin/main 7d7151c9, after = this branch, run back to back on the same database, best of two rounds.

| endpoint | p50 | p95 | queries |
|---|---|---|---|
| admin/costs | 1,443 → 357 | 1,669 → 457 | 4,002 → 13 |
| resumes (list, 30 resumes) | 60.5 → 5.1 | 89.4 → 6.0 | 3 |
| interview-styles | 16.1 → 2.8 | 17.2 → 3.3 | 2 |
| practice/queue (240 reviews) | 14.8 → 8.6 | 23.0 → 9.7 | 3 |
| jobs/tracker (400 jobs) | 26.5 → 17.2 | 46.9 → 19.4 | 5 |
| admin/stats | 80.2 → 49.6 | 220 → 182 | 17 → 16 |
| answers (150) | 20.9 → 16.8 | 23.5 → 17.9 | 3 |
| evidence (200) | 13.7 → 10.8 | 17.4 → 11.1 | 3 |
| sessions (200) | 13.2 → 10.3 | 18.0 → 11.8 | 7 |
| contacts (250) | 10.3 → 8.1 | 10.9 → 9.0 | 4 |
| stories (80) | 13.1 → 11.2 | 14.2 → 13.2 | 3 |
| jobs/feed | 7.0 → 5.7 | 8.1 → 6.3 | 8 |
| entitlements | 4.7 → 4.2 | 5.5 → 4.7 | 6 |
| auth/me | 2.3 → 2.2 | 2.7 → 2.7 | 2 |
| create session | 5.9 → 4.8 | 6.6 → 5.6 | 6 |

All 39 measured endpoints are in `perf/pg-table.md` (with the tools, below); none got slower beyond noise. No index was missing: the user
endpoints read by `user_id` indexes (EXPLAIN ANALYZE on the scratch Postgres), and the admin activity counts are a
full aggregate over the activity tables by design (~22 ms each at this size; now one pass instead of two).

What changed: the cost report looked up every account and its plan one by one (`plans_for_users`); resume list
scores are kept by content; the interview-style list is built and gzipped once per country; the practice queue no
longer rebuilds the drill-lead list per question; the tracker list skips each job's stored interview questions; gzip
runs at level 6 instead of 9 (a third less CPU on big lists for 1-2% more bytes).

### Live path (`perf/live_bench.py`, `perf/ws_bench.py`; mock STT and LLM, so only Orbit's code is timed)
| stage | before | after |
|---|---|---|
| build_prompt (retrieval over 408 items), p50 | 8.3 ms | 2.3 ms |
| question detected → first answer chunk (instant mock LLM), p50 | 8.6 ms | 2.6 ms |
| index build at connect (SQLite), p50 | 54 ms | 43 ms |
| final transcript → question.detected (Quick) | 0.12 ms | 0.12 ms |
| per streamed token | 0.06 ms | 0.06 ms |
| ticket → session.started over a real socket (Postgres), p50 / p95 | 77 / 87 ms | 60 / 75 ms |
| question.detected → first answer.chunk at the client, over the socket, p50 | 32 ms | 22 ms |

The 400 prompts built for the seeded account (5 sessions × 16 questions × 5 types, with follow-up memory) are
byte-identical before and after, and `tests/retrieval_eval.py` scores the same (0.43 → 0.18 ms a query).

With answers streamed at a real model's pace (a word every 30 ms), the server sends ~57 `answer.chunk` messages per
answer (~70 kB: each carries the whole answer so far, every 40 ms). The browser's React work for them is small; the
live page's main-thread time goes to its animations: the thinking orb and the voice visualizer repaint their
canvases every frame, ~110 ms of every second on a desktop core in headless Chrome (software canvas), several times
that on a phone. Not changed here (a design decision); see "Left to do".

### Web — signed-in pages (`perf/web/profile.mjs`: 390x844, 4x CPU, slow 4G, warm cache)
| page | before | after |
|---|---|---|
| Jobs tracker (400 jobs): total blocking time | 3.9-6.2 s | 0.65 s |
| Jobs tracker: longest task | 3.0-4.9 s | 0.19 s |
| Jobs tracker: elements | 65,030 | 9,442 |
| Jobs tracker: tap latency | 208-232 ms | 80 ms |
| Resume editor typing (`perf/web/typing.mjs`): keystroke p50 / p75 | 104-120 / 104-144 ms | 72-80 / 96-104 ms |
| Resume editor: script time while typing 46 characters (unthrottled) | ~1,080 ms | ~500 ms |

The tracker drew both layouts (the phone list and the desk board, one hidden by CSS) and every card's More menu;
now one layout, More's links when opened, and long lists in batches. Typing in the resume editor re-checked every
bullet against every evidence claim, re-reading each claim each time; claims are read once, and the preview and the
print copy follow the form a moment behind it (React's deferred value).

### Web — JavaScript (gzip, first load; `scripts/bundle-budget.mjs`)
| | before | after |
|---|---|---|
| entry (every page) | 159.7 kB | 159.7 kB |
| Home (signed in) | 216.4 kB | 197.1 kB |
| front page | 189.2 kB | 189.2 kB |
| Sessions / Setup / Mock | 176.7 / 183.3 / 189.4 kB | 176.5 / 183.4 / 189.2 kB |
| Live | 229.5 kB | 229.2 kB |
| Resume AI / resume editor | 196.1 / 238.3 kB | 195.6 / 237.8 kB |
| Jobs AI | 260.6 kB | 259.6 kB |

Home imported its usage card from the Billing page, and with it checkout, packs and referrals; the card now has its
own module. Taking the sign-in pages out of the entry was tried and reverted: the entry fell to 150.5 kB, but a
direct visit to /login then waited one more round trip for its chunk (Lighthouse below), and returning visitors have
the entry cached anyway.

### Web — public pages (Lighthouse 13.5 mobile, median of 3; the full build with its prerendered pages, served
locally over HTTP/2 with `/api` proxied: `perf/web/lh.sh`)
| page, throttling | before | after | with the sign-in split (reverted) |
|---|---|---|---|
| front page, simulated: score / LCP / TBT | 94 / 2,587 ms / 14 ms | 94 / 2,593 ms / 8 ms | 93 / 2,702 ms / 0 ms |
| front page, devtools: LCP / TBT | 2,212 / 201 ms | 2,177 / 150 ms | 2,133 / 112 ms |
| /login, simulated: LCP | 2,105 ms | 2,107 ms | 2,252 ms |
| /login, devtools: FCP / LCP | 2,526 / 3,382 ms | 2,553 / 3,409 ms | 3,200 / 3,311 ms |

CLS 0.003 and 0 throughout. The public pages were not this round's target (they're prerendered HTML, and the front
page is the brand work's); they stay where they were. The front page's simulated LCP is just over the 2.5 s target.
Its LCP element is text in the prerendered HTML (time to first byte ~10 ms, render delay ~240 ms); what holds the
first paint is render-blocking: the 29 kB stylesheet and `/theme-init.js`, ~450 ms by Lighthouse's estimate on a cold
visit (the theme script's new cache rule helps repeat visits only). Inlining the public pages' critical CSS and the
theme script would be the next step there (see "Left to do").

### Web — the product pages on the section kit (D79; Lighthouse 13.5 mobile, simulated, median of 3)
The full build with its prerendered pages, served over HTTP/2 with `/api` proxied to a local API (the same method).

| page | before: score / FCP / LCP / TBT / CLS | after |
|---|---|---|
| Resume AI | 85 / 2,807 / 2,957 ms / 3 ms / 0.137 | 92 / 2,598 / 2,823 ms / 27 ms / 0 |
| interview copilot | 96 / 2,103 / 2,403 ms / 0 ms / 0 | 94 / 2,495 / 2,570 ms / 0 ms / 0 |
| Jobs AI | 95 / 2,197 / 2,316 ms / 0 ms / 0 | 93 / 2,479 / 2,706 ms / 0 ms / 0 |
| Practice | 94 / 2,146 / 2,706 ms / 9 ms / 0 | 91 / 2,628 / 2,853 ms / 3 ms / 0 |
| LinkedIn AI (new) | — | 93 / 2,481 / 2,631 ms / 0 ms / 0 |

Accessibility 100 on every page. Resume AI's old hero sized itself in JavaScript after the first paint, so its rewrite
card moved (CLS 0.137); the new one is a box of a fixed size. Its first version on the kit measured 81 (FCP 3.4 s,
observed first paint 1.3 to 2.2 s): the app's first render drew five whole resume pages and the sample's Inter font
cost 130 kB. The templates behind the hero now draw just after the first paint, the carousel's only once it's near
the screen, and the public renders use Arial (one of the editor's fonts), so the page downloads no font but Plex.
The copilot's language card names the languages in English and its code block waits until it's near the screen, so
no Cyrillic or monospace font is fetched with the page. What's left is the HTML itself: the product pages are 17 to
23 kB gzipped instead of 10 to 12 (every section and render is in the built copy, finished), one more round trip on a
slow connection before the first paint, which is why the copilot's, Jobs AI's, Practice's and LinkedIn AI's simulated
LCP sit just over 2.5 s (observed on this machine: 0.3 to 0.5 s, or about 1.3 s in a run where the app's own copy
arrived before the first paint, which the front page and the old pages showed too). Inlining the critical CSS
(below) is the next step for all of them.

### Mobile access (headless, iPhone UA + touch; 25 signed-in pages at 360, 390, 414 and 768 px)
| | before | after |
|---|---|---|
| pages that scroll sideways | 0 | 0 |
| text fields under 16 px (iOS zooms into them) | 119 (57 at 768) | 0 |
| tap targets under 24 px | 239 | 26 |
| tap targets under 44 px | 3,069 | 1,645 |
| safe-area gaps (notch, home bar) | shell, bottom nav, live page, sheet, support chat | none found |
| support chat with the keyboard open | message box hidden | above the keyboard |
| iOS: mic after a call / Siri / lock | stayed off for the session | resumes |
| offline page load | the browser's error | Orbit's offline page |

Slow 3G (400 kbps, 400 ms RTT, 4x CPU) on a production build: sign-in usable at 6.2 s cold; sign in → Home 1.4 s;
Home → Mock 3.9 s; the theme script's revalidation was a round trip before every first paint (now cached a day).

### Desktop (Windows; not launched on the owner's screen)
- `cargo build --release`: `orbit-desktop.exe` 5.4 MB (5,401,088 bytes, frontend embedded); the release profile is
  already size-tuned (LTO, opt-level s, one codegen unit, strip, panic abort).
- Frontend: main chunk 533 kB (154 kB gzip), session chunk 240 kB (74 kB gzip), CSS 128 kB, fonts 501 kB in 21 files (four
  families, subsets loaded by unicode-range). Loaded from disk, so its cost is parse time, not the network.
- No WebView2 flags are set (defaults). Earlier isolated-build numbers stand: startup 0.57 s, idle 212 MB, live
  274 MB. A new live measurement needs the isolated test build (an own `WEBVIEW2_USER_DATA_FOLDER`, driven over CDP,
  docs/WINDOWS_RELEASE.md); not run here, so as not to touch the owner's screen.

## Caching (reviewed)
- `/assets/*` are content-hashed: a year, immutable (`public/_headers`). Icons, preview images and the camera
  model: a day to a week with stale-while-revalidate; `/theme-init.js` now too. HTML is revalidated every load
  (Cloudflare's ETag, 304), so a deploy is picked up at once.
- The API answers `no-store` for everything but `/v1/public/*`: per-user data never lands in a browser's disk cache.
  The public JSON that could be cached (`plans`, `billing/packs`, `billing/monthly`) is priced by the visitor's country
  and account, so a browser copy could show the wrong currency after a country change; it stays uncached. It's small
  (1-2 kB) and fetched once per page load.

## How to measure
The scripts live outside the repo, in `C:\Users\Ishfaq\tools\orbit-drive\perf\` (scratch databases only; each refuses
any other URL):
- `seed.py [scale]`: the seeded data above, into a temp SQLite or the throwaway Postgres on 127.0.0.1:55433.
- `bench.py out.json [n]`: p50/p95 and SQL statements per endpoint, in-process. `ab.sh` + `compare.py`: before vs after.
- `live_bench.py`, `ws_bench.py`: the live path's stages, in-process and over a socket.
- `web/profile.mjs`, `web/typing.mjs`, `web/live-ui.mjs`: signed-in pages under a phone's budget. Build the web app
  with `VITE_API_URL` **and** `VITE_LIVE_URL` set to the local API (`.env.production` points live sockets at
  production); `web/serve.mjs` refuses a build that talks to production.
- `web/lh.sh`: Lighthouse on the public pages; `mobile/audit.mjs`: the mobile checks.

## Left to do (expected gains)
- **Live page animations**: pause the idle orb after a few seconds of listening, or draw it at 30 fps, and make
  Gentle the default on phones: ~10% of a desktop core and much more of a phone's while a session only listens.
- **`answer.chunk` carries the whole answer each time**: deltas would cut a long answer's ~70 kB to ~10 kB and the
  client's re-parse per chunk; it's a protocol change for the web and desktop clients together.
- **Sessions, stories, answers lists** (4,500-4,700 elements at 80-200 items): the same batched drawing as the tracker
  would bring their tap latency (40-190 ms at 4x CPU) under 100 ms.
- **The public pages' first paint**: inline the critical CSS and the theme script in the prerendered HTML (~450 ms
  render-blocking on a cold mobile visit, Lighthouse's estimate); the front page and the Worker belong to the brand
  and search work.
- **The admin cost report** (357 ms): aggregate in SQL instead of reading every call of the month into Python.
- **Desktop**: lazy-load its heavier screens (main chunk 533 kB parsed at every start).
