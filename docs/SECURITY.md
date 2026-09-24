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
- **Web:** httpOnly `SameSite=None; Secure` cookie (the API and web app are on different sites).
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
  - the admin (`ORBIT_ADMIN_EMAIL`) is exempt.

## CSRF (`csrf.py`)
The session cookie is `SameSite=None`, so a browser attaches it to requests any site triggers. For
POST/PUT/PATCH/DELETE:
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

Client IPs come from `X-Forwarded-For`. The container runs uvicorn with `--forwarded-allow-ips='*'` because it's
reachable only through the host's proxy. Without that flag every request would share the proxy's IP, and with it
one bucket.

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

`packages/ui/src/api/client.test.ts` covers the client's CSRF header and structured errors.
