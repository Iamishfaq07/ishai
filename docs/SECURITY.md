# Orbit security model

What protects what, and where it lives in the code. Report issues privately to the repository owner.

## Secrets
- **Provider keys** (DeepSeek, Deepgram) exist only in the API process: env vars, or admin overrides encrypted at
  rest with `ORBIT_CONFIG_SECRET`. They're never sent to the desktop or web clients. Audio is relayed through the
  API (D2).
- **Logs** are JSON with secrets redacted (`observability.py`: tokens, keys, `token=` values). Sentry is opt-in
  and sends no PII, bodies, headers or query strings.
- **Updater signing key and code-signing certificate** are never in the repo (WINDOWS_RELEASE.md).

## Authentication
- Passwords use argon2, and JWTs carry `token_version`. A password reset or "sign out everywhere" bumps the
  version, which kills every existing session on web and desktop.
- **Web:** httpOnly `SameSite=Lax; Secure` cookie. The web app calls the API through its own `/api` proxy, so the
  cookie is first-party (`ORBIT_COOKIE_SAMESITE=none` only for a web app that calls the API cross-site). Auth
  responses to the web app's own origin (`ORBIT_WEB_URL`) carry no `access_token`, so script on the page can never
  read a long-lived credential. Web sessions end after 3 days unused (`ORBIT_SESSION_IDLE_HOURS`). While in use, the
  cookie renews at most every 15 minutes, up to the 7-day cap from the original sign-in (the token's `auth` claim).
- **Sign-up** never reveals whether an email is taken when verification is required and mail can be delivered:
  - new and taken addresses get the same `202 {"status": "verify_email"}`, nobody is signed in, and every email goes
    out after the response;
  - the owner of a taken address is told by email;
  - the link only verifies, and the person then signs in with their password (so a pre-registered account can't be
    handed to its victim).
- **Desktop:** Bearer token in Windows Credential Manager.
- The **WebSocket** uses single-use, 60 s tickets minted by an authenticated POST. No long-lived token appears in
  a URL (D7).
- **Allowlist:** `ORBIT_ALLOWED_EMAILS` is re-checked on every request, so tightening it cuts off existing
  sessions.

## Email verification (`auth/guards.py`)
- `require_verified_user` gates everything that spends paid-provider money or stores uploads:
  - creating sessions (including mock);
  - live tickets;
  - screenshots;
  - AI review;
  - document upload and edit.
- Unverified users can still use `/me`, verify, resend, sign out, privacy settings and account deletion.
- **The error** is `403 {"detail": {"code": "email_unverified", "message": …}}`. Both apps show a banner with
  **Resend link** and **I've verified**, and preflight reports it as a failing check without calling any provider.
- **Tokens** are single-use and expire (48 h to verify, 1 h to reset). Resend has a per-user cooldown and an
  IP limit.
- **Policy** (`ORBIT_EMAIL_VERIFICATION`):
  - required in production, off in development and test unless set;
  - the admin (`ORBIT_ADMIN_EMAIL`) needs a verified address too whenever mail can be delivered. Otherwise the first
    person to register it would be admin. Only an admin-only deploy with no SMTP skips this.

## CSRF (`csrf.py`)
`SameSite=Lax` already keeps the cookie off cross-site POSTs; this is defence in depth (and covers deployments
that set `ORBIT_COOKIE_SAMESITE=none`). For POST/PUT/PATCH/DELETE:
1. `Origin` (or `Referer`) must be a configured frontend (`ORBIT_CORS_ORIGINS` + `ORBIT_WEB_URL`). Unknown origins
   are refused even when signed out, which also blocks login CSRF.
2. Requests carrying the cookie must send `X-CSRF-Token`. It's an HMAC of user id and token version, handed out in
   auth responses (`/me`, login, register, reset) and unreadable cross-site. The shared API client adds it
   automatically in cookie mode.

Bearer requests (desktop, API clients) are exempt: they carry no ambient credential. Sign-in entry points skip
the token check (a stale cookie must not block signing in) but keep the Origin check. Server-to-server webhooks
authenticate with their own signatures. The toggle is `ORBIT_CSRF_PROTECTION`: on everywhere except tests.

## Abuse limits (`ratelimit.py`)
In-process token buckets. They move to Redis before the API runs more than one instance (D12).

| What | Key | Limit |
|---|---|---|
| Sign-up | IP | 5 / hour |
| Sign-in | IP, and target email | 10 burst (IP); 10 / 15 min (email) |
| Password reset / verification email | IP, email / user cooldown | 5 burst; 3 / hour per email |
| Session create | IP + user | 10 burst, 30 / hour per user |
| Live ticket | user | 120 / hour (reconnects need headroom) |
| Screenshots | IP + user | 10 burst, 6 / min per user |
| AI review | IP + user | 3 burst, 10 / hour per user |
| Uploads / preflight | IP | 10 burst / 6 burst |
| Free resume maker, AI (signed out) | IP, and all signed-out callers | 6 burst, then 1 / min per IP; a rolling 24 h cap of `ORBIT_GUEST_RESUME_AI_DAILY` calls (default 300, `0` = AI off) |
| Free resume maker, score and Word export (signed out) | IP | 30 burst, 2 / s |

The free resume maker (`/v1/resume-maker/*`, `resumes/routes.py`) is the one public tool that spends money: it needs no
account, so nobody can be billed or banned. It stores nothing, never reads documents or follows links, and its AI
calls are logged without a user id so the daily cap (`guest_ai_gate`) can count them. A bot can therefore exhaust
the day's free AI but not run up more than that cap in cost; scoring and Word export keep working either way.

Client IPs (`ratelimit.client_ip`): the container runs uvicorn with `--forwarded-allow-ips='*'` because it's
reachable only through the host's proxy; without that flag every request would share the proxy's IP, and so one
bucket. But the left-most `X-Forwarded-For` entry is whatever a caller who reaches the API directly writes there. With
`ORBIT_PROXY_SECRET` set (the same value as the web Worker's `PROXY_SECRET`), only the Worker may state the client IP
(`X-Orbit-Client-IP`); every other request is keyed by the right-most entry, the one the host's own edge appended.
Sign-in is also limited per target email, so rotating IPs never buys more password guesses.

Request bodies are capped at the upload limit + 1 MB (`main.BodyLimit`, 413) before anything buffers them.

## Bot protection (`auth/captcha.py`)
- **Scope:** sign-up and password-reset requests.
- **Provider-neutral:** clients ask `GET /v1/auth/config` which widget to render. Cloudflare Turnstile is
  implemented (`ORBIT_CAPTCHA_PROVIDER=turnstile`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`).
- **Fails closed** if the provider is unreachable.
- **Bypass:** `CAPTCHA_ENABLED=false` is honoured only outside production.

## Production fail-fast (`config.py`)
The API refuses to boot in production with:
- a dev or short JWT secret;
- mock providers;
- SQLite;
- no admin;
- public sign-up (`*` or `@domain`) with verification off;
- verification required for non-admin users but no SMTP (nobody could verify);
- Turnstile selected without keys.

## Hostile uploads (`documents/parsing.py`)
- **Limits:**
  - 10 MB per upload;
  - magic bytes must match the extension;
  - 40 PDF pages;
  - 200k extracted characters.
- **Archive inspection, before any parser runs.** A DOCX is a ZIP, and its central directory alone is checked
  (nothing is decompressed):
  - at most 1,000 entries;
  - no entry over 25 MB;
  - no more than 50 MB uncompressed in total;
  - compression ratio at most 100:1 on entries over 1 MB;
  - no absolute paths, `..` or drive letters;
  - `word/document.xml` must be present.
- **Isolation.** PDF and DOCX extraction runs in a short-lived child process (spawned, never forked):
  - 20 s timeout;
  - on Linux, `RLIMIT_AS` 768 MB and `RLIMIT_CPU` 30 s.

  A parser that hangs, runs out of memory or crashes kills only the child, and the user gets a clear message.
  Plain text is decoded in-process.
- **Boot self-test.** At boot the API parses a tiny generated DOCX through the isolated path. If child processes
  don't work on the host, it logs a critical error (which reaches Sentry when enabled) and parses in-process, with
  the archive checks still applied, rather than rejecting every upload.

## Web app headers (`apps/web/vite.config.ts` → `dist/_headers`)
Generated at build time so they can't go stale:
- **CSP:** `default-src 'self'`; scripts from self, the inline theme script by SHA-256 hash (computed from the built
  `index.html`) and Cloudflare Turnstile; `connect-src` limited to self plus the API/live origins this build uses;
  `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests`.
- **Also:** HSTS (2 years), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP `same-origin`,
  and a `Permissions-Policy` that allows only the microphone and screen capture, only for the app itself.

The API sends its own: CSP `default-src 'none'`, `nosniff`, `DENY`, `no-store`, `no-referrer`, and HSTS in
production. Links it hands out (desktop installer downloads) come from `ORBIT_API_PUBLIC_URL` when set, never from
the request's `Host` header.

## Supply chain (`.github/`)
- Every third-party action is pinned to a full commit SHA, with the version as a comment. Dependabot bumps them.
- Checkouts use `persist-credentials: false`. The default token is read-only, except the release job, which needs
  `contents: write`.
- Workflow inputs reach shell scripts only through `env:`, never `${{ }}` inside `run:` (script injection).
- The API image's base images are pinned by digest, and Dependabot covers pip, npm, cargo, actions and docker.
- **CI `security` job:** `pip-audit` (the locked API dependencies), `bandit` (medium severity and up) and
  `pnpm audit --audit-level high`. The `secrets` job runs gitleaks over the full history.

The full review, its method and its accepted risks are in [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

## Data handling
- Screenshots are analysed and discarded, and audio is never written to disk.
- Uploaded files are parsed and dropped, and only extracted text chunks are stored.
- Deleting an account cascades to all of its data (`ON DELETE CASCADE`).
- Transcript storage can be turned off per account.

## Regression tests
`apps/api/tests/test_launch_security.py` covers:
- verification gating and the admin exemption;
- CSRF: allowed and evil origins, missing and wrong tokens, Referer fallback, multipart, delete, Bearer
  exemption, login CSRF;
- the CORS `PUT` preflight;
- per-IP, per-email and per-user limits;
- CAPTCHA;
- production fail-fast rules.

`tests/test_upload_hardening.py` covers:
- ZIP bombs, oversized parts and too many entries;
- traversal paths;
- archives that aren't real DOCX files;
- malformed PDFs;
- the timeout kill;
- an API-level bomb upload.

`packages/ui/src/api/client.test.ts` covers the client's CSRF header and structured errors.
