# Deploying Orbit (free tier, private)

The live deployment is: API + WebSocket on **Render** (Docker, `render.yaml`), Postgres on **Neon**, and the
web app on **Cloudflare Workers static assets** (`wrangler.jsonc` at the repo root). AI keys are shared server
secrets; the desktop app talks to the same API.

```
Cloudflare (web)  ─┐
Desktop app       ─┼──►  Render (FastAPI + WebSocket, ONE instance)  ──►  Neon (Postgres)
                    │                  └──► DeepSeek / Deepgram
```

## 1. Database — Neon

Create a project → copy the **direct** connection string (not the `-pooler` one: asyncpg's prepared statements
break behind PgBouncer). Use the async driver scheme and drop `?sslmode=...`:
`postgresql+asyncpg://user:pass@ep-xxxx.ap-southeast-1.aws.neon.tech/orbit`

## 2. API — Render

Render dashboard → New → Blueprint → this repo (`render.yaml`). Set the prompted secrets:

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
| `ORBIT_LLM_PRICING_JSON` | no | extra/override LLM prices for internal cost estimates (see `providers/llm/pricing.py`) |
| `ORBIT_LIVE_HEARTBEAT_S` | no | live-minute commit/enforcement interval, default 15 |
| `ORBIT_SPOOL_DIR` | no | where dead-lettered writes spool if the DB is unreachable (default: temp dir) |
| `ORBIT_SMTP_*` | if others sign in | required as soon as anyone besides the admin can sign in (they must verify their email); admin-only deploys can skip it |
| `ORBIT_EMAIL_VERIFICATION` | no | `required` (production default) or `off`. `off` is allowed for a private list of exact addresses, or with `*` / `@domain` when sign-up approval is on (nobody spends anything before the admin looks) |
| `ORBIT_SIGNUP_APPROVAL` | no | `true` (production default) or `false`. New accounts can sign in but use nothing until the admin gives them access in **Settings → Users & access**: a plan for a while (e.g. Unlimited for 2 hours) or approval for good. The admin gets an email for each sign-up (once its email is verified). Accounts from before stay as they were. |
| `ORBIT_CAPTCHA_PROVIDER`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | no | bot check on sign-up / password reset (`turnstile`). Add the web hostname to the Turnstile widget |
| `ORBIT_CSRF_PROTECTION` | no | leave unset (on). See [SECURITY.md](SECURITY.md) |
| `ORBIT_SENTRY_DSN` | no | turns on Sentry error reporting (off when unset). Sends no PII, bodies, headers, query strings or breadcrumbs. |
| `ORBIT_LOG_FORMAT` | no | `json` (default in production) or `text`. Every line carries `request_id` / `user_id` / `session_id`; secrets are redacted. |
| `ORBIT_JOBS_REFRESH` | no | Jobs AI (`/jobs`, [DECISIONS.md](DECISIONS.md) D43): fetch job posts in the background. Default on (off only in tests). `false` serves what's cached and calls no job source. |
| `ORBIT_JOBS_SOURCES_OFF` | no | job sources to leave off, comma-separated: `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `himalayas`, `remoteok`, `jobicy`, `adzuna`, `jsearch` |
| `ORBIT_JOBS_BOARDS_JSON` | no | company job boards added to or taken off the built-in list (`job_portal/companies.py`), a JSON array: `[{"ats": "lever", "token": "acme", "company": "Acme"}, {"ats": "greenhouse", "token": "stripe", "off": true}]`. Checked at startup |
| `ORBIT_JOBS_FIT_DAILY`, `ORBIT_JOBS_PROFILE_DAILY` | no | free AI fit checks (default 15) and AI search-profile reads (default 5) per account per day (UTC). The admin has no cap. Jobs AI's public page shows both (from `GET /v1/jobs/stats`) |
| `ORBIT_ADZUNA_APP_ID`, `ORBIT_ADZUNA_APP_KEY` | no | turn on Adzuna India job search (free tier at developer.adzuna.com; Orbit stops at 90% of its 25 a minute / 250 a day / 2,500 a month). Its terms ask for the Adzuna logo (at least 116 × 23 px) linked to Adzuna on each of its jobs: the card shows a sized "Adzuna" badge, so add their logo file to it before switching this on |
| `ORBIT_JSEARCH_KEY`, `ORBIT_JSEARCH_MONTHLY_BUDGET` | no | turn on JSearch (RapidAPI, paid) and its monthly call budget (default 200; Orbit stops at 90%) |

`ORBIT_JWT_SECRET` and `ORBIT_CONFIG_SECRET` are generated by Render once and stay stable.

The container runs `alembic upgrade head` on boot (Postgres DDL is transactional: a failed migration rolls back
and the previous deploy keeps serving). Health: `/health` (liveness + deployed `commit`), `/ready` (DB).

**Run exactly one instance.** Live-session state (WS tickets, socket ownership, rate limits) is in process memory
(`docs/DECISIONS.md` D12). Don't scale the service out until that moves to Redis. `render.yaml` pins
`numInstances: 1`, and `ORBIT_API_REPLICAS` above 1 stops a production boot. Durable state (usage, cost, report
jobs, dead-lettered writes) is in Postgres.

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
as static assets (SPA fallback) plus `apps/web/worker/index.js`, whose 10-minute cron pings the API so the free
Render instance doesn't sleep.

**The web app talks to the API through its own origin.** The Worker proxies `/api/*` to `API_URL` (in
`wrangler.jsonc`), and the production build uses `VITE_API_URL=/api`. That makes the session cookie first-party: a
cookie set by a different site (the Render API) is dropped by browsers that block third-party cookies (Safari and
every browser on iOS, Firefox strict mode, Brave), and sign-in would bounce straight back to the login page. Live
WebSockets authenticate with a single-use ticket, so they still connect straight to the API (`VITE_LIVE_URL`). Keep
the web origin in `ORBIT_CORS_ORIGINS`/`ORBIT_WEB_URL`: the CSRF check still validates `Origin` on proxied requests.

## 4. Desktop app

Release builds bake the hosted API URL (`apps/desktop/.env.production`). A user can point the app at another
server on the sign-in screen; remote servers must be `https://` (plain `http://` only for `localhost`).
Releases: see `docs/WINDOWS_RELEASE.md`.

## Costs & limits

Free tiers sleep when idle (the first request after idle is a cold start). DeepSeek/Deepgram usage bills your
own accounts; per-request cost estimates are in `provider_requests.estimated_cost_usd` (`NULL` = model has no
configured price).
