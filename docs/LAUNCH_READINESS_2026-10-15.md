# Orbit launch readiness — 15 October 2026

## Deployment status

The launch branch starts from latest main `3a16af508f9d158bc6a184261df969b5e7f63881` (PR #282).
Main was rechecked after implementation and still points to that commit.
The requested commits `fcb7fb1`, `4a0ca09` and PRs #55, #76, #154, #167, #230, #260, #262,
#264, #265, #266, #267 and #281 were inspected before changes.

**Remote CI is blocked by GitHub account billing.** All six requested jobs on both cited commits failed before
steps ran. Their annotations say recent payments failed or the spending limit needs increasing.
Resolve Settings → Billing & plans and rerun CI. The source changes cannot repair account billing.
The historical Cloudflare Workers build also failed; its check exposes a dashboard build link, without build logs.
Its root cause could not be verified through the available GitHub output.

No production deploy, database change, credential rotation, merge or release was performed.
Set the proxy secret before deploying this branch. Keep existing JWT and configuration encryption secrets.
Do not resync the old Render Blueprint: it can regenerate secrets and invalidate sessions or encrypted settings.

## Implemented

- Production requires a random proxy secret of 32+ characters; development and tests have a local default.
  Startup validates Google and Razorpay credential pairs and the production payment webhook secret.
- Resume edits abort obsolete saves. A writer identity, increasing client revision and database revision
  reject delayed packets and other-tab conflicts with 409. Local drafts survive failures.
- Existing verified Google account linking and reset behavior preserve account identity, balances, resumes
  and sessions, with a regression test. OAuth uses full-page navigation, first-party proxy cookies, state
  and PKCE; redirect paths reject encoded external/network paths. Account changes clear cached preparation.
- Role, company, interview stage, technology stack and requirements survive URLs, account-scoped browser
  storage and backend sessions, and reach live/mock prompts inside evidence boundaries.
- International checkout has a country-aware fallback and durable, idempotent launch-access request.
  It grants no unapproved credits and takes no payment; requests reach the existing admin Inbox.
- Uploads enforce 5 MB, content/MIME consistency, valid decoded images, UTF-8 code and invisible-character
  sanitization. Document evidence is fenced against injected closing tags.
- User/IP limits use sliding windows, including live voice traffic. Database account locks serialize
  resume-credit claims and analysis quota reservations; failed requests refund their reservations.
- Existing constant-time proxy/payment signature checks and transactional Razorpay settlement were audited
  and covered by existing/new tests. Desktop tokens remain in the OS keyring.
- Deep Space surfaces, top-lit glass, tabular telemetry, audio-reactive canvas orbitals, linked career-loop
  nodes, capture-health pills and animated inline resume diffs are integrated. Reduced motion renders
  content immediately and disables the decorative animation.
- Full job prep creates a reviewable tailored resume copy with durable suggestions and exact practice/coding
  links. A unique reservation prevents duplicate generation under simultaneous requests.
- Resume defense launches a grounded five-minute drill using current unsaved resume text.
- Debrief Studio pairs questions and candidate turns on a timestamped timeline, shows ideal answers/code,
  missing points and transcript-based delivery/clarity scores, and saves graded retries.
- Adaptive practice changes concept depth from 1–5 using the preceding answer's assessment; superseded
  prefetches cannot escalate the next question. Depth survives reconnection. A five-axis radar uses actual
  assessments and the latest retry; unassessed dimensions remain empty.
- Architecture notes/files/screenshots return a validated Defense Card with three answered follow-ups.
  Coding answers expose a 30-second walkthrough, with a generated/cacheable fallback for historical answers.
- New owned data is exported with the account and cascades on deletion. Deleting transcript questions
  also deletes their stored debrief attempts. Existing report-retention policy remains in effect.

## Verification

- Python: Ruff and mypy clean; complete suite **1,969 passed, 17 skipped**.
  Skips require external providers or environment-specific tooling; they do not certify real provider service.
- Frontend: types clean, lint zero errors (two existing hook-dependency warnings), **484 tests passed**;
  web and desktop production bundles built.
- Browser: **3 Playwright checks passed**, using real HTTP, cookie auth, database, WebSockets and React UI
  with explicitly test-only LLM/STT. Covers cancelled autosave, two tabs, mobile/reduced-motion context,
  defense, coding walkthrough and ended-session debrief/radar/retry.
- Windows desktop v0.1.25: `cargo fmt --check`, `cargo check --locked`,
  `cargo clippy --locked --all-targets -- -D warnings`, and **30 Rust tests passed**.
  Hardware unplug/reconnect and installer signing remain physical/release checks.
- SQLite migrations: upgrade to head, downgrade the new career migration, upgrade again passed.
  Postgres locking/migration checks are included in CI; no disposable local Postgres was available.
- Bandit medium severity/confidence: clean. Python dependency audit: no known vulnerabilities.
  pnpm audit: no known vulnerabilities after upgrading PostCSS selector parser to 7.1.6.
  Gitleaks: full 438-commit history clean with five exact historical fake-fixture fingerprints.
- Dockerfile/image configuration tests pass; Docker is not installed locally, so the actual image build
  remains a CI gate after billing is restored.
- Dependabot GLib alert #2 remains: Tauri's Linux GTK chain pins GLib 0.18.5; a compatible 0.20 upgrade is
  unavailable in that chain. `cargo tree --target x86_64-pc-windows-msvc -i glib` finds no Windows dependency.
  Keep Linux desktop distribution disabled pending an upstream migration. The alert was not dismissed.
  Sources: [RustSec advisory](https://rustsec.org/advisories/RUSTSEC-2024-0429.html),
  [Tauri upstream status](https://github.com/tauri-apps/tauri/issues/16264).

## Render — exact variable names

Apply to the active `orbit-api-sg` service. If `orbit-api` remains serving traffic, it also needs the proxy
secret and these production settings; keep its own existing public URL. Do not unintentionally run two live
API instances against the same database: session ownership and limits remain process-local.
Replace bracketed credential fields with dashboard values; they are deliberately not invented here.

```dotenv
ORBIT_ENV=production
ORBIT_API_REPLICAS=1
ORBIT_DATABASE_URL=[existing direct Neon postgresql+asyncpg URL]
ORBIT_DATABASE_SSL=verify
ORBIT_JWT_SECRET=[PRESERVE existing signing secret]
ORBIT_CONFIG_SECRET=[PRESERVE existing encryption secret]
ORBIT_PROXY_SECRET=[32+ random characters; identical to Cloudflare PROXY_SECRET]
ORBIT_ADMIN_EMAIL=[existing admin email]
ORBIT_WEB_URL=https://orbitanswer.com
ORBIT_API_PUBLIC_URL=https://orbit-api-sg.onrender.com
ORBIT_CORS_ORIGINS=["https://orbitanswer.com","https://orbit.ishfaq.workers.dev","http://tauri.localhost","tauri://localhost"]
ORBIT_ALLOWED_EMAILS=*
ORBIT_SIGNUP_APPROVAL=false
ORBIT_EMAIL_VERIFICATION=required
ORBIT_LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=[existing server provider key]
ORBIT_STT_PROVIDER=deepgram
DEEPGRAM_API_KEY=[existing server provider key]
ORBIT_GOOGLE_CLIENT_ID=[Google web OAuth client id]
ORBIT_GOOGLE_CLIENT_SECRET=[Google web OAuth client secret]
ORBIT_GOOGLE_REDIRECT_URI=https://orbitanswer.com/api/v1/auth/google/callback
ORBIT_RAZORPAY_KEY_ID=[live Razorpay key id]
ORBIT_RAZORPAY_KEY_SECRET=[live Razorpay key secret]
ORBIT_RAZORPAY_WEBHOOK_SECRET=[matching Razorpay webhook secret]
ORBIT_RAZORPAY_INTERNATIONAL=false
ORBIT_SMTP_HOST=[mail provider hostname]
ORBIT_SMTP_PORT=587
ORBIT_SMTP_USERNAME=[mail provider username]
ORBIT_SMTP_PASSWORD=[mail provider password]
ORBIT_SMTP_STARTTLS=true
ORBIT_EMAIL_FROM=Orbit <no-reply@orbitanswer.com>
```

The three public-signup settings enable self-service launch; retain approval instead if launching by invitation.
SMTP and the sending domain must actually deliver verification/reset mail. Google's registered redirect must
match exactly. Use the canonical site for OAuth: a Workers alias has a different cookie origin.
Set international payments true only after Razorpay enables them. If leaving Razorpay disabled, leave all three
Razorpay credentials unset and preserve configured `ORBIT_UPI_ID`/`ORBIT_UPI_NAME` for manual payments.
Preserve existing `ORBIT_UPDATES_GITHUB_REPO` and `ORBIT_UPDATES_GITHUB_TOKEN` for private desktop downloads.

## Cloudflare — exact names

The current repository uses **Workers static assets**, configured by root `wrangler.jsonc`.
Pages build variables alone do not install the required same-origin API proxy.

```dotenv
# Browser build (public)
VITE_API_URL=/api
VITE_LIVE_URL=https://orbit-api-sg.onrender.com
# Worker runtime variable
API_URL=https://orbit-api-sg.onrender.com
# Worker runtime SECRET, never a VITE_ value
PROXY_SECRET=[exact same value as Render ORBIT_PROXY_SECRET]
```

Set the runtime secret with `wrangler secret put PROXY_SECRET` or Cloudflare's Secrets dashboard for Worker
`orbit`. If using Pages separately, configure an equivalent same-origin `/api/*` proxy and the same secret.
Build command: `pnpm --filter @orbit/web build`; assets directory: `apps/web/dist`.
The desktop production build uses `VITE_API_URL=https://orbit-api-sg.onrender.com` and
`VITE_WEB_URL=https://orbitanswer.com`. No provider, proxy or payment secret belongs in either client.

## Launch sequence

1. Restore GitHub billing. Set matching proxy secrets on Render and Cloudflare; verify existing stable secrets.
2. Verify Google's canonical redirect, SMTP delivery and Razorpay webhook events `payment.captured` and
   `order.paid` at `https://orbit-api-sg.onrender.com/v1/billing/webhook`.
3. Back up the database. Merge only after remote API/Postgres, image, frontend, security, secrets and Windows
   gates pass. Render's image command runs `alembic upgrade head` before the API starts.
4. Check `/ready`, sign in/reset/Google on a real phone, buy a small live pack and confirm exactly one ledger
   credit on replay, then unplug/reconnect each Windows capture source and verify updater/installer signing.

For reproducible browser checks see `tools/e2e/README.md`. No fake provider output is allowed in production.
