# Deploying Orbit

Business hiring playbooks run inside the API with no additional service or keys. Apply migration
`58ca94f2d7e3` after `47b9e3d0a6f2`, then keep the API running for background task reconciliation.
See [enterprise automation operations and rollback](BUSINESS_AUTOMATIONS.md).

The live deployment is: API + WebSocket on **Railway** (Hobby plan, Docker from `apps/api/Dockerfile`, Singapore)
at **`https://api.orbitanswer.com`**, Postgres on **Neon**, and the web app on **Cloudflare Workers static assets**
(`wrangler.jsonc` at the repo root). AI keys are shared server secrets; the desktop app talks to the same API. The
old Render service is retired (DECISIONS D55).

```
Cloudflare (web)  ─┐
Desktop app       ─┼──►  api.orbitanswer.com → Railway (FastAPI + WebSocket, ONE instance)  ──►  Neon (Postgres)
                    │                  └──► DeepSeek / Deepgram
```

## 1. Database — Neon

Create a project → copy the **direct** connection string (not the `-pooler` one: asyncpg's prepared statements
break behind PgBouncer). Use the async driver scheme and drop `?sslmode=...`:
`postgresql+asyncpg://user:pass@ep-xxxx.ap-southeast-1.aws.neon.tech/orbit`

## 2. API — Railway

The service (`orbit-api-sg`, region Singapore, next to Neon's `aws-ap-southeast-1`) is set up in the Railway
dashboard, not from a file: there's deliberately no `railway.json`/`railway.toml`, which would override the
dashboard's settings on the next deploy.

- **Source**: this repo, root directory `apps/api`, built from its `Dockerfile` (it runs `alembic upgrade head`,
  then uvicorn on `$PORT`). Railway injects `PORT` (8080 here): the custom domain's target port must match it.
- **Healthcheck path**: `/ready` (it checks the database, that it takes writes, and the proxy secret: D56).
- **Replicas: exactly 1** (see below; `ORBIT_API_REPLICAS` above 1 stops a production boot, D12).
- **Variables**: the same values the old host had: above all `ORBIT_JWT_SECRET` (a new one signs
  everyone out), `ORBIT_CONFIG_SECRET` (a new one can't read the settings saved in the app) and `ORBIT_PROXY_SECRET`
  (the web Worker's `PROXY_SECRET`). Plus `ORBIT_API_PUBLIC_URL=https://api.orbitanswer.com` (Railway's own
  `RAILWAY_PUBLIC_DOMAIN` is the fallback, and may be the `*.up.railway.app` name). `/health` shows the deployed
  commit from `RAILWAY_GIT_COMMIT_SHA`.
- **Custom domain**: `api.orbitanswer.com` in the service's Networking settings, with the `CNAME` it shows added in
  Cloudflare DNS as **DNS only (grey cloud)**. Not proxied: through Cloudflare's proxy every desktop request arrives
  from a Cloudflare edge address, and `ratelimit.client_ip` keys unsigned callers on the right-most
  `X-Forwarded-For` hop, so everyone near one edge would share sign-in limits and per-network welcome credits (the
  admin Overview warns, `api_cloudflare_proxied`). Check: `curl -s -D - -o /dev/null
  https://api.orbitanswer.com/health` shows no `cf-ray` and no `server: cloudflare`.
- **Database**: Neon's **direct** endpoint (step 1), as before.

The variables (the same on any host):

| Variable | Required | Notes |
|---|---|---|
| `ORBIT_DATABASE_URL` | yes | Neon string from step 1 |
| `DEEPSEEK_API_KEY`, `DEEPGRAM_API_KEY` | yes | production refuses to boot without them (no mock fallback) |
| `ORBIT_ADMIN_EMAIL` | **yes** | the owner account (unlimited plan, Advanced settings). Production refuses to boot without it; the admin is never inferred from registration order. Register this account right after the first deploy. |
| `ORBIT_WEB_URL`, `ORBIT_CORS_ORIGINS` | yes | the web URL; CORS: a JSON array or comma-separated list, incl. `http://tauri.localhost` |
| `ORBIT_ALLOWED_EMAILS` | no | who else may sign in (emails, `@domain`, or `*`). Unset = admin only. Re-checked per request. Anyone besides the admin needs SMTP (below) to verify their email. |
| `ORBIT_UPDATES_GITHUB_TOKEN` | no | fine-grained PAT (this repo, Contents read) so desktop auto-update works |
| `ORBIT_PLANS_JSON`, `FREE_/PRO_/UNLIMITED_MAX_SESSION_MINUTES` | no | plan limits, features, prices and the per-session ceiling. See [BILLING.md](BILLING.md) |
| `ORBIT_FALLBACK_LLM_*`, `ORBIT_LLM_FIRST_TOKEN_TIMEOUT_S` | no | backup LLM (any OpenAI-compatible API) used when DeepSeek fails before its first token. See [AI_PROVIDER.md](AI_PROVIDER.md) |
| `ORBIT_EMBEDDER` | no | `hash` (default) or `bge-small`: local neural retrieval, about +200 MB RAM, much better recall. See [RETRIEVAL.md](RETRIEVAL.md) |
| `ORBIT_STT_PRICE_PER_MINUTE` | no | per-minute speech-to-text price for the admin cost dashboard (default 0.0077, Deepgram Nova-3 streaming list price; set your rate, or empty = unknown) |
| `ORBIT_USD_INR` | no | rupees to the dollar for prices outside India (default 88) |
| `ORBIT_INTL_MARKUP` | no | how much more buyers outside India pay (default 1.3 = 30% more) |
| `ORBIT_RAZORPAY_INTERNATIONAL` | no | `true` once Razorpay has approved international cards: dollar prices become buyable |
| `ORBIT_PAYPAL_CLIENT_ID` / `ORBIT_PAYPAL_CLIENT_SECRET` | no | a PayPal REST app's keys: dollar prices outside India are paid through PayPal (docs/BILLING.md) |
| `ORBIT_PAYPAL_ENV` | no | `sandbox` (default, no real money) or `live`, matching the keys |
| `ORBIT_PAYPAL_WEBHOOK_ID` | no | the PayPal webhook's ID, so its events (`/v1/billing/paypal/webhook`) are believed |
| `ORBIT_GOOGLE_INDEXING_SA_JSON` | no | Orbit for Business (D82): the whole JSON key of a Google service account with the Indexing API enabled in its Cloud project, whose `client_email` is added as an **Owner** of the orbitanswer.com property in Search Console. Job pages are then pinged on publish, change and close. Unset: no pings (the jobs sitemap still lists them) |
| `ORBIT_BUSINESS_AI` | no | `fake` forces Orbit for Business's deterministic keyword matcher instead of `orbit_api.business_ai` (local runs only; tests use it automatically) |
| `ORBIT_BUSINESS_SWEEP_S` | no | how often the Business retention sweep runs, in seconds (default 21600) |
| `ORBIT_LLM_PRICING_JSON` | no | extra/override LLM prices for internal cost estimates (see `providers/llm/pricing.py`) |
| `ORBIT_LIVE_HEARTBEAT_S` | no | live-minute commit/enforcement interval, default 15 |
| `ORBIT_SPOOL_DIR` | no | where dead-lettered writes spool if the DB is unreachable (default: temp dir) |
| `ORBIT_SMTP_*` | if others sign in | required as soon as anyone besides the admin can sign in (they must verify their email); admin-only deploys can skip it. The Inbox's "Send reply" needs it too (without it the admin replies from their own mail app) |
| `ORBIT_EMAIL_VERIFICATION` | no | `required` (production default) or `off`. `off` is allowed for a private list of exact addresses, or with `*` / `@domain` when sign-up approval is on (nobody spends anything before the admin looks) |
| `ORBIT_SIGNUP_APPROVAL` | no | `true` (production default) or `false`. New accounts can sign in but use nothing until the admin gives them access in **Settings → Users & access**: a plan for a while (e.g. Unlimited for 2 hours) or approval for good. The admin gets an email for each sign-up (once its email is verified). Accounts from before stay as they were. |
| `ORBIT_CAPTCHA_PROVIDER`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | no | bot check on sign-up / password reset (`turnstile`). Add the web hostname to the Turnstile widget |
| `ORBIT_CSRF_PROTECTION` | no | leave unset (on). See [SECURITY.md](SECURITY.md) |
| `ORBIT_SENTRY_DSN` | no | turns on Sentry error reporting (off when unset). Sends no PII, bodies, headers, query strings or breadcrumbs. |
| `ORBIT_LOG_FORMAT` | no | `json` (default in production) or `text`. Every line carries `request_id` / `user_id` / `session_id`; secrets are redacted. |
| `ORBIT_JOBS_REFRESH` | no | Jobs AI (`/jobs`, [DECISIONS.md](DECISIONS.md) D43): fetch job posts in the background. Default on (off only in tests). `false` serves what's cached and calls no job source. |
| `ORBIT_JOBS_SOURCES_OFF` | no | job sources to leave off, comma-separated: `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `himalayas`, `remoteok`, `jobicy`, `adzuna`, `jsearch` |
| `ORBIT_JOBS_BOARDS_JSON` | no | company job boards added to or taken off the built-in list (`job_portal/companies.py`), a JSON array: `[{"ats": "lever", "token": "acme", "company": "Acme"}, {"ats": "greenhouse", "token": "stripe", "off": true}]`. Checked at startup |
| `ORBIT_JOBS_BOARD_COUNTRIES` | no | countries besides India that SmartRecruiters boards are asked for, one call per board and country every 6 hours (it answers one country at a time; the other boards send every country's posts at once). ISO codes, comma-separated; default `US,GB,CA,DE,AU`. India-first boards are only ever asked for India. Checked at startup |
| `ORBIT_JOBS_CPU_SHARE` | no | the share of one CPU the job refresh's own work may take (reading posts and their skills, writing them; `job_portal/pace.py`, [DECISIONS.md](DECISIONS.md) D52), so the refresh stays a small background load wherever the API runs: requests stay quick next to it and, where CPU is billed by use (Railway), its cost stays capped. Default `0.04`, which leaves most of even a tenth of a CPU (the worst case measured) to requests; raise it for faster first refreshes if the CPU is there. `0` = unpaced |
| `ORBIT_JOBS_FIT_DAILY`, `ORBIT_JOBS_PROFILE_DAILY` | no | free AI fit checks (default 15) and AI search-profile reads (default 5) per account per day (UTC). The admin has no cap. Jobs AI's public page shows both (from `GET /v1/jobs/stats`) |
| `ORBIT_ADZUNA_APP_ID`, `ORBIT_ADZUNA_APP_KEY` | no | turn on Adzuna India job search (free tier at developer.adzuna.com; Orbit stops at 90% of its 25 a minute / 250 a day / 2,500 a month). Its terms ask for the Adzuna logo (at least 116 × 23 px) linked to Adzuna on each of its jobs: the card shows a sized "Adzuna" badge, so add their logo file to it before switching this on |
| `ORBIT_CONTACT_DAILY_CAP`, `ORBIT_CONTACT_RETENTION_DAYS` | no | the Contact page ([DECISIONS.md](DECISIONS.md) D50): at most this many messages a rolling day from everyone together (default 300; each network also gets 5 an hour and 20 a day), and how many days after being marked done or spam a message is deleted (default 365; 0 = never). Messages go to the admin's Inbox only: no email is sent for them |
| `ORBIT_JSEARCH_KEY`, `ORBIT_JSEARCH_MONTHLY_BUDGET` | no | turn on JSearch (RapidAPI, paid) and its monthly call budget (default 200; Orbit stops at 90%) |

`ORBIT_JWT_SECRET` and `ORBIT_CONFIG_SECRET` were generated once (on the first host) and must stay the same wherever
the API runs (copy them, never regenerate).

The container runs `alembic upgrade head` on boot (Postgres DDL is transactional: a failed migration rolls back
and the previous deploy keeps serving). Health: `/health` (liveness + deployed `commit`), `/ready` (DB).

**Run exactly one instance.** Live-session state (WS tickets, socket ownership, rate limits) is in process memory
(`docs/DECISIONS.md` D12). Don't scale the service out until that moves to Redis: one replica on Railway (more
vCPUs on the one instance are fine), and `ORBIT_API_REPLICAS` above 1 stops a production boot. Durable state
(usage, cost, report jobs, dead-lettered writes) is in Postgres; report jobs are claimed with a conditional update.

**Background work runs in the API process.** Session reports are DB-backed jobs picked up by a worker inside each
API process; there's no separate worker service to deploy. A job cut off by a deploy goes back in the queue (and
one still "running" at boot is re-queued at once: with one instance, it was the previous process's). Dead-lettered
live-session writes are replayed on boot, every minute, before each session's report and at shutdown.

**Checking the real providers.** `RUN_PROVIDER_SMOKE=true uv run pytest tests/smoke -v` (from `apps/api`, keys from
the environment or `.env`) makes a handful of real DeepSeek + Deepgram calls — text, streaming, JSON, vision,
timeout mapping, interim/final transcripts, reconnect, every offered language. It costs a fraction of a cent and is
never part of normal CI (GitHub: Actions → *Provider smoke* → Run workflow, with `DEEPSEEK_API_KEY` /
`DEEPGRAM_API_KEY` repo secrets).

**Latency.** Admins see live-latency percentiles in desktop **Settings → Latency** (`GET /v1/admin/latency`),
measured from the interviewer's actual speech.

## 3. Web app — Cloudflare

`apps/web/.env.production` bakes `VITE_API_URL`. Cloudflare Workers Builds deploys on every push to `main`.
Manually: `pnpm --filter @orbit/web build`, then `wrangler deploy` from the repo root. That uploads `apps/web/dist`
as static assets plus `apps/web/worker/index.js`, whose 10-minute cron pings `API_URL` at `/health`
(Railway doesn't sleep; it's insurance against a host that does).

**The Worker runs first for every page address** (not the built files under `/assets/`): it serves the app for the
app's own addresses, a real 404 for anything else, one 301 to each page's canonical address, and robots.txt
(DECISIONS D67). Search-engine verification codes and the AI-crawler setting are `vars` in `wrangler.jsonc`; after a
deploy that changes public pages, tell Bing and the other IndexNow engines with `apps/web/scripts/indexnow.mjs`
(docs/SEO.md).

**The web app talks to the API through its own origin.** The Worker proxies `/api/*` to `API_URL` (in
`wrangler.jsonc`), and the production build uses `VITE_API_URL=/api`. That makes the session cookie first-party: a
cookie set by a different site (the API's host) is dropped by browsers that block third-party cookies (Safari and
every browser on iOS, Firefox strict mode, Brave), and sign-in would bounce straight back to the login page. Live
WebSockets authenticate with a single-use ticket, so they still connect straight to the API (`VITE_LIVE_URL`). Keep
the web origin in `ORBIT_CORS_ORIGINS`/`ORBIT_WEB_URL`: the CSRF check still validates `Origin` on proxied requests.

## 4. Desktop app

Release builds bake the API address (`apps/desktop/.env.production`): `https://api.orbitanswer.com`, the API's own
name, so a host move is a DNS change that installed apps (update checks included) follow without a release
(DECISIONS D53). Desktop 0.1.40 and older called the retired Render host directly: they stopped working when it
was suspended and need a fresh install from orbitanswer.com (D55). A user can point the app at another server on
the sign-in screen; remote servers must be `https://` (plain `http://` only for `localhost`). A saved override naming
a retired Render address is ignored, so it can't keep an app on the old host. Releases: see
`docs/WINDOWS_RELEASE.md`.

## Optional personal Orbit hosted auto-apply

The separate background browser worker and its API opt-in are documented in [HOSTED_APPLY.md](HOSTED_APPLY.md).
It must run continuously to apply while candidates' browsers are closed; merging code alone does not start it.
Existing accounts stay in browser mode until they separately authorise hosted execution.

## Moving the API to another host

Done once, Render → Railway (October 2026). Installed apps follow `api.orbitanswer.com`, so a move is:

1. The new service up with the same variables (step 2) and `api.orbitanswer.com` added as its custom domain.
2. Check the new host on its own address: `/ready` answers 200 and `/health` shows the expected commit.
3. Point the `api` record in Cloudflare at the new host's target, **DNS only**; then check
   `curl -s -D - -o /dev/null https://api.orbitanswer.com/health` has no `cf-ray` / `server: cloudflare`.
4. Move every webhook that names a host's own address (Razorpay, PayPal: docs/BILLING.md) to
   `https://api.orbitanswer.com/...`, then retire the old host.

## Costs & limits

Free tiers sleep when idle (the first request after idle is a cold start); Railway bills the API's CPU and memory
by use and doesn't sleep it unless its serverless setting is on. DeepSeek/Deepgram usage bills your
own accounts; per-request cost estimates are in `provider_requests.estimated_cost_usd` (`NULL` = model has no
configured price).

**The web Worker's requests.** Every `/api/*` call and every page load (each full page request, not each click
inside the app) invokes the Worker; the built files under `/assets/`, the icons, the camera model and the theme
script are served without it, free and unlimited. Cloudflare's Workers Free plan allows 100,000 Worker requests a
day (reset at midnight UTC, 10 ms CPU each); past that, every address the Worker runs first for answers 429 until the
reset, so the whole site (pages and API) would be down, not just the API. The API calls are most of the count (a
signed-in visit makes dozens; a page load adds one, a crawler's fetch one). Watch Workers & Pages → orbit → Metrics,
and move to Workers Paid ($5 a month, 10 million requests included) before daily requests pass about 50,000.

## Preview isolation (20 October 2026)

See [STAGING.md](STAGING.md). Branch previews no longer point at the production API and fail closed until an independent API is provisioned. Both direct browser REST/live URLs and the Worker proxy need isolation. Production defaults stay unchanged. Current read-only deployment observations are in [release verification](releases/2026-10-20-verification.md); the older Render launch snapshot is historical.

## Unified identity rollout gate

Apply additive migration `e62f8d0b351c` (parent d51e7c9a240b) before deploying clients that read explicit career identity. It adds nullable review metadata to job_search_profiles, without selecting or approving legacy resumes. Roll back UI independently; prior clients ignore the column. A database downgrade drops only review metadata: export/back up that metadata first if review history must survive. Do not execute an automatic production downgrade.

Before production: validate upgrade/downgrade/upgrade and account locking on isolated PostgreSQL with realistic fixtures; verify staging endpoints cannot reach production, backup/restore, live providers and platform-specific gates. This local branch is not deployment approval. Consult implementation/UNIFIED_JOURNEY_RELEASE_SIGNOFF.md for factual evidence and outstanding actions.
