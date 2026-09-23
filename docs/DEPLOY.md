# Deploying Orbit (free-tier, private)

This is a private, single-user setup: the API + WebSocket run on **Fly.io**, Postgres on **Neon**, and
the web app on **Cloudflare Pages**. AI keys are shared server secrets (your DeepSeek/Deepgram keys serve
only your usage). The desktop app talks to the same Fly API.

```
Cloudflare Pages (web)  ─┐
Desktop app             ─┼──►  Fly.io  (FastAPI + WebSocket)  ──►  Neon (Postgres)
                          │                 └──► DeepSeek / Deepgram
```

## 1. Database — Neon (free)

1. Create a project at neon.tech → copy the **connection string**.
2. Convert it to the async driver Orbit uses: change the scheme to `postgresql+asyncpg://` and drop any
   `?sslmode=...` (asyncpg negotiates TLS itself). Example:
   `postgresql+asyncpg://user:pass@ep-xxxx.us-east-2.aws.neon.tech/orbit`

## 2. API — Fly.io (free allowance)

From `apps/api/` (which has `fly.toml` + `Dockerfile`):

```bash
fly auth login
fly launch --no-deploy            # pick a unique app name; keep the existing fly.toml when asked
# Secrets (never commit these):
fly secrets set \
  ORBIT_DATABASE_URL='postgresql+asyncpg://...neon.tech/orbit' \
  ORBIT_JWT_SECRET="$(openssl rand -hex 32)" \
  DEEPSEEK_API_KEY='sk-...' \
  DEEPGRAM_API_KEY='...'
fly deploy
```

Then edit `fly.toml` `[env]` so `ORBIT_WEB_URL` and `ORBIT_CORS_ORIGINS` point at your Cloudflare Pages
URL (step 3), and `fly deploy` again. The container runs `alembic upgrade head` on boot, so the schema is
created automatically. Health: `https://<app>.fly.dev/ready`.

Notes:
- `ORBIT_ENV=production` (already in `fly.toml`) makes the app refuse to boot on SQLite or with missing
  AI keys — no silent mock in production.
- **Email is optional.** With no `ORBIT_SMTP_*`, verification/reset emails are disabled (fine for one
  user who knows their password). To enable them, set `ORBIT_SMTP_HOST/PORT/USERNAME/PASSWORD/EMAIL_FROM`.

## 3. Web app — Cloudflare Pages (free)

Connect the repo in the Cloudflare Pages dashboard with:

- **Framework preset:** None
- **Build command:** `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @orbit/web build`
- **Build output directory:** `apps/web/dist`
- **Root directory:** repository root (it's a pnpm monorepo; the build resolves `@orbit/ui`/`@orbit/types`)
- **Environment variable:** `VITE_API_URL = https://<your-app>.fly.dev`

`apps/web/public/_redirects` already sends client routes to `index.html` (SPA fallback). After the first
deploy, note the `*.pages.dev` URL and put it in the Fly `ORBIT_WEB_URL` / `ORBIT_CORS_ORIGINS`.

## 4. Desktop app

The desktop app is the fuller experience (system-audio + per-app capture). Point it at the Fly API:
- On the sign-in screen, click **Server → change** and enter `https://<your-app>.fly.dev`, or
- build it with `VITE_API_URL=https://<your-app>.fly.dev` baked in.

Installers come from CI (the `orbit-windows` artifact) or a local `pnpm --filter @orbit/desktop tauri build`.

## Costs & limits

Free tiers sleep when idle (first request after idle is a cold start of a few seconds) and have modest
limits — fine for private use. DeepSeek/Deepgram usage bills your own accounts.
