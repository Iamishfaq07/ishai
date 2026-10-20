# Launch sign-off — historical snapshot

Latest Personal Orbit preparation review scope: [V6 increment3](implementation/V6_PREP_CONTINUITY.md), with exact tests and remote blockers in [BASELINE.md](implementation/BASELINE.md). This adds no deployment, production audit or whole-product launch approval.

**Superseded for current deployment facts by [20 October verification](releases/2026-10-20-verification.md) and [Personal Orbit increment sign-off](releases/2026-10-20-personal-orbit-signoff.md).** The report below records its original date/environment; its hosting, deployment and proxy-secret statements must not be treated as today's status.

# Launch sign-off — 16 October 2026

Against the enterprise launch brief of 16 October 2026. This records what was checked here and what wasn't. Nothing
in it is inferred from older reports.

## Verdict: **WEB-ONLY GO is possible once the owner actions below are done. Desktop stays BETA.** Today it's **NO-GO** for paid live traffic.

The blockers that are left aren't code. Hosting is on Render's free plan. Production deploys of the web app don't
promote (Cloudflare runs `wrangler versions upload`). CI can't run (GitHub billing). The installer is unsigned. The
legal identity and grievance contact aren't published, and the minors position hasn't been decided. Each of these
needs the owner or counsel.

## P0 status

| Brief id | Status | Evidence |
|---|---|---|
| P0-01 / REL-05: policy vs desktop behaviour | **Fixed in code** (#322). Window privacy is two user settings, both off until chosen. Privacy policy, terms, landing FAQ and READMEs match it. | `cargo test` (`window_privacy_is_off_until_the_user_chooses`), `windowPrivacy.test.ts`. Not verified on Windows hardware (Snipping Tool check pending). |
| P0-02 / REL-02: hosting capacity | **OWNER ACTION.** `render.yaml` is still `plan: free`, one instance. No load test was run (it needs a paid target). | — |
| P0-03 / REL-01: proxy secret | **Fixed in code** (#321). `/ready` returns 503 in production without it, welcome credits are held, and the admin sees a banner. | `tests/test_credits.py` (`…without_the_proxy_secret`, `test_readiness_and_the_admin_flag_a_missing_proxy_secret`). **Owner:** confirm `ORBIT_PROXY_SECRET` (Render) equals `PROXY_SECRET` (Cloudflare). Otherwise new deploys fail their health check and the previous deploy keeps serving. |
| P0-04 / REL-06: unsigned installer | **Partly done** (#322). The app is labelled Beta with a SmartScreen note until `VITE_DESKTOP_SIGNED=true`. **OWNER ACTION:** OV code-signing certificate; serve downloads from orbitanswer.com. | — |
| P0-05: legal identity, grievance officer, minors | **OWNER / COUNSEL ACTION.** Nothing was invented. The policy still says under-18s may use Orbit. An 18+ gate changes who the product is for, so it's left for the owner to decide. | — |
| P0-06 / REL-07: storage crashes | **Fixed** (#321). `safeLocal` / `safeSession` everywhere, and ESLint bans raw access. | `packages/ui/src/storage.test.ts`, which renders `CodeBlock` with storage throwing. |
| P0-07 / REL-08: closing a live tab | **Fixed** (#321). `beforeunload` is registered while a session is in progress. The `client-gone` beacon endpoint isn't built: a reload already reconnects. | Code review. No Playwright dialog test. |
| P0-08 / REL-09: flagged route "Not found" | **Fixed** (#321). `FlagGate`. | `flags.test.ts`. Playwright: the flag-off evidence link lands on `/documents` with a note. |
| P0-09 / REL-09: cookie notice covering content | **Fixed** (#321). It's now a slim bar that never meets the support button. | Playwright at 360, 390 and 1440: bounding boxes don't intersect. |
| REL-03: Cloudflare deploy | **OWNER ACTION.** Set the Workers Builds deploy command to `npx wrangler deploy`. | — |
| REL-04: billing | Already in place before this brief: captured, order, amount and INR checks (ORB-N01), idempotent webhooks, refunds recorded once. **OWNER:** refunds keep credits (ORB-N15). Confirm that's the policy you want published. | `tests/test_razorpay.py` |
| REL-10: CI | **OWNER ACTION.** GitHub Actions is blocked by billing, so every check here was run locally. | — |

## P1 done in this round

- `/health` returns only the status and commit (P1-SEC-04).
- A chunked upload over the size cap now gets a clean 413 (P1-SEC-06; `test_oversized_request_bodies_are_refused`
  now asserts 413).
- `robots.txt`, `sitemap.xml`, and a canonical link that the Worker sets per public page (P1-SEO-01).
- Already present: 404 title "Page not found", and share codes redacted from logs (P1-SEC-05).

## Kept on purpose, against the brief

- **KashSec promo on sign-in, and "AI" badges in the nav** (P1-FE-05, P1-FE-07): the owner asked for both on
  15 October. They stay until the owner says otherwise.

## Commands run (local, Linux container)

| Check | Result |
|---|---|
| `uv run pytest -q` (SQLite) | 2097 passed, 16 skipped |
| `uv run ruff check .` / `uv run mypy orbit_api` | clean / clean (169 files) |
| `pnpm -r typecheck` / `pnpm -r lint` | clean / 0 errors (2 old react-hooks warnings) |
| `pnpm -r test` | ui 234, desktop 29, web 289 passed |
| `cargo fmt --check` / `cargo test` (Linux) | clean / 21 passed |
| Web and desktop `vite build` | OK |

Not run here: Windows hardware, live Razorpay, the deployed API, Playwright against production, load tests.
