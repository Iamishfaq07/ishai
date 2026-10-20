# Orbit security model

What protects what, and where it lives in the code.

## Reporting a vulnerability
Write to the Orbit team privately through the [Contact page](https://orbitanswer.com/contact) (topic "Technical
problem"). `/.well-known/security.txt` points there too. Say what you found and how to reproduce it, and please don't
post it publicly until it's fixed. Test only against your own account. Don't run automated scans against
production, and don't touch other people's data.

## Threat model (short)
- **Assets:**
  - accounts and their sign-in factors;
  - what people store: resumes, documents, transcripts, job search, payments;
  - credits and paid plans;
  - the provider keys;
  - the admin console;
  - the desktop app's access to the screen and microphone.
- **Attackers:**
  - an anonymous visitor;
  - another signed-in user (IDOR, cross-account data);
  - someone holding a victim's inbox, password or a stolen session (account takeover);
  - a hostile web page or job post (XSS, SSRF through the link fetchers, prompt injection);
  - a malicious or compromised update server (the desktop updater);
  - a buyer gaming payments or referrals.
- **Out of scope:**
  - a fully compromised device;
  - the hosting providers themselves (Railway, Cloudflare, the AI and payment providers);
  - an attacker who controls both the inbox and the second factor.
- **Where each is handled:** the sections below, the IDOR matrix (`tests/test_security_idor.py`), and
  [SECURITY_REVIEW.md](SECURITY_REVIEW.md), which holds the reviews and red-team findings with their accepted risks.

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

## The admin console (`admin/accounts.py`, `admin/overview.py`)
- **Admin only.** Every route uses `require_admin` (a normal user gets 403, nobody signed in 401), is in the
  route matrix of `tests/test_security_idor.py`, and writes an `audit_logs` row for every change (reads don't).
- **Never the admin account.** Suspend, delete, sign-out and taking credits away refuse the acting admin and the
  admin account (also the admin's address before it's verified). Its "email verified" flag can't be changed there.
- **Delete** needs the account's email typed (the API checks it too) and goes through the owner's own delete
  (D45). **Suspension** is checked by `current_user` on every request, at sign-in (after the password), at
  password-reset confirm and on the live socket; suspending also bumps `token_version` and ends live sessions.
- **Bounds:** reasons and notes ≤ 300 characters (private notes ≤ 4,000), bulk credits ≤ 100 accounts, CSV ≤ 20,000
  rows with cells starting `= + - @` quoted so a spreadsheet can't run them as formulas.

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

The signed-out resume maker (`/v1/resume-maker/*`) is gone. Resume scoring, Word export and the AI require an account,
so they sit on the signed-in limits above. A resume left in the browser from the old maker can still be saved after
sign-in; the server does not keep a signed-out copy.

Client IPs (`ratelimit.client_ip`): the container runs uvicorn with `--forwarded-allow-ips='*'` because it's
reachable only through the host's proxy; without that flag every request would share the proxy's IP, and so one
bucket. But the left-most `X-Forwarded-For` entry is whatever a caller who reaches the API directly writes there. With
`ORBIT_PROXY_SECRET` set (the same value as the web Worker's `PROXY_SECRET`), only the Worker may state the client IP
(`X-Orbit-Client-IP`); every other request is keyed by the right-most entry, the one the host's own edge appended.
Sign-in is also limited per target email, so rotating IPs never buys more password guesses.

Request bodies are capped at the upload limit + 1 MB (`main.BodyLimit`, 413) before anything buffers them.

## Support chat tokens (`support/routes.py`)
- A chat's token (32 random bytes, stored only as an HMAC) is the only way back into it. The web app sends it in the
  `X-Orbit-Support-Token` header and keeps it in localStorage scoped to the account (or "guest"); switching account
  clears the open chat from the page.
- A chat linked to an account (opened, or written in, while signed in) also needs that account signed in: the token
  alone gets 404 signed out or as anyone else, so a shared computer or a copied token doesn't open someone's chat.
- **Legacy `?token=` query (V3-11):** clients from before 14 Oct 2026 put the token in the address. It is still
  accepted, answered with `Deprecation: true` and `Cache-Control: no-store`, logged as a count without the token, and
  redacted from every log line including uvicorn's access log (`observability.py`). Plan: once the log shows no
  query-token reads for 30 days (the web app has sent the header since 14 Oct; desktop builds don't use the chat),
  remove the `token` query parameter from `read_thread`.
- One Inbox ticket per chat, deleted with it; see `docs/PRIVACY.md` (Support chat).

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
- **CSP:** one policy, generated here and not repeated in `public/_headers` (two policies are both enforced, and the
  stricter one was blocking Razorpay). Scripts from self, the inline theme script by SHA-256 hash, Cloudflare
  Turnstile and Razorpay Checkout. `connect-src` is self, Turnstile, Razorpay and the API/live origins this build
  uses. Frames are Turnstile and Razorpay only. `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`,
  `frame-ancestors 'none'`, `upgrade-insecure-requests`.
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
- **Checked again on 12 October 2026 and left in place.** `postcss-selector-parser` stays on 6.1.4. The patched
  release is 7.1.6, and forcing that under Tailwind 3 dropped variant classes (`md:`, `hover:`, `dark:`). The
  advisory applies when a server parses untrusted CSS. Orbit only parses its own CSS at build time. `cargo audit`
  found no vulnerabilities. The remaining Rust warnings (`proc-macro-error` unmaintained, a yanked `yoke-derive`,
  an unsound `glib` iterator) come through Tauri and GTK, and the Windows build does not compile `glib`.

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


## Two-step sign-in and devices (16 Oct 2026)

- **Two-step sign-in** (`auth/two_factor.py`):
  - TOTP per RFC 6238: SHA-1, 6 digits, 30 s, ±1 step. A used step is never accepted again.
  - The secret is Fernet-encrypted with `ORBIT_CONFIG_SECRET`.
  - 10 single-use recovery codes, stored only as SHA-256 hashes.
  - A correct password, or Google, gives a 5-minute **challenge**, never a session. The challenge is signed with
    its own derived key, and `decode_claims` refuses any token carrying `purpose`, so a challenge can't pass as a
    session (a test caught this before release).
  - After Google, the challenge travels in a short httpOnly cookie, not the URL.
  - Wrong codes are throttled: 5 per account per 15 minutes, plus a per-network limit on the code step. The token
    is taken before the code is checked and given back when it's right, and the check runs under the account lock, so
    guesses (or one code) sent at once can't outrun it. Wrong passwords at sign-in work the same way.
  - Turning 2FA off, or making new recovery codes, needs a current code.
  - **A password reset doesn't skip it** (D71): the reset sets the new password, then answers with a challenge (in
    the same httpOnly cookie as after Google), and the code still comes next.
  - Turning it on needs a verified email.
- **Devices** (`auth/devices.py`):
  - Each sign-in is a `user_sessions` row named by the token's `sid` claim, checked on every request.
  - Signing one device out ends its tokens on their next request.
  - Logout revokes the current device server-side.
- **Admin reminder:** the admin dashboard shows a banner while the signed-in admin has no two-step sign-in. It
  isn't forced, so the owner can't be locked out by a lost phone.
- **Passkeys** (`auth/passkeys.py`, py_webauthn):
  - The relying party is the host of `ORBIT_WEB_URL`, and only that exact origin is accepted. A look-alike domain
    can't use an Orbit passkey.
  - Discoverable credentials with user verification required, so a passkey sign-in skips the authenticator code
    (it is already two factors). Suspension and the allowed-email list still apply.
  - Challenges are 32 random bytes, single use (the row is deleted when spent), last 5 minutes, and are stored only
    as SHA-256. Adding a passkey ties its challenge to the account, asks for the password again (accounts that
    have one) and needs a verified email.
  - **No pre-account takeover** (D71): the first proof of an inbox by a reset link or a Google claim removes the
    passkeys and 2FA set up before it, so whoever registered the address first can't keep a way in.
  - Only public keys are stored. A sign count that goes backwards is refused (a cloned key).
  - Passkey sign-in is IP rate limited and CSRF-exempt like `/login`: the signature over a single-use challenge
    is the credential.
  - Tests (`tests/test_passkeys.py`) use a software P-256 authenticator, so the whole WebAuthn check runs. They
    cover replays, the wrong origin, a missing user verification, forged signatures, unknown keys and cloned
    counters. A Playwright run with Chromium's virtual authenticator covers the browser side.
  - The desktop app keeps password, Google and two-step sign-in. Passkeys are on the website only, because the
    app's webview origin isn't the site's.

## Preview data boundary

Canonical production API access is refused from previews at both Worker and browser endpoint selection, including production artifacts accidentally served on a preview host. Staging requires independent infrastructure/secrets/domain; configuration guards cannot identify every private production alias. See [STAGING.md](STAGING.md) and [verification limits](implementation/SECURITY_AND_DATA_LINEAGE.md).
