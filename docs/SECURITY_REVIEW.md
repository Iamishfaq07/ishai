# Security review (2026-09-27)

A full pass over the API, web app, Worker, desktop app, CI and deploy config:
- secrets scanning;
- dependency audits (SCA);
- static analysis (SAST);
- manual code review;
- attacks against a running API and web build (DAST).

Everything found was fixed in the same change, except the accepted risks listed at the end. How the protections
work is described in [SECURITY.md](SECURITY.md).

## Results at a glance

| Check | Tool | Result |
|---|---|---|
| Secrets: working tree + every commit on every ref | gitleaks 8.21 | none found |
| Python dependencies (locked) | pip-audit | no known vulnerabilities |
| npm dependencies (web, desktop, packages) | pnpm audit | no known vulnerabilities |
| Rust dependencies (desktop) | cargo-audit, RustSec DB | 0 vulnerabilities; 7 warnings, see below |
| Python SAST | bandit | nothing medium+; low findings reviewed (asserts, `try/except/pass`) |
| SAST: Actions, Dockerfile, FastAPI, JWT, Python security rules | semgrep | 4 real findings, fixed (below); 1 false positive |
| DAST: 85 attacks on a running API and web build | scripted (httpx, websockets, Playwright) | 85/85 pass (the WebSocket Origin check was added after a probe passed for the wrong reason) |

**The 7 Rust warnings** are all transitive through Tauri and GTK (Linux only), with no fix upstream:
- 6 crates flagged unmaintained: `proc-macro-error` and 5 `unic-*` crates;
- 1 unsound iterator in `glib` (RUSTSEC-2024-0429), which the shipped Windows build doesn't compile.

## Findings and fixes

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | **Script injection in `release.yml`.** `${{ inputs.version }}` was pasted into a bash script. Anyone who could run the workflow could run shell code with a `contents: write` token and the updater signing key. | Inputs and step outputs reach scripts only through `env:`, and the version is validated as `x.y.z`. |
| 2 | Medium | **Unpinned third-party actions.** A moved tag would run new code with repo secrets. | Every action is pinned to a commit SHA, and checkouts use `persist-credentials: false`. |
| 3 | Medium | **Spoofable client IP.** Uvicorn trusted the left-most `X-Forwarded-For` from anyone. A caller reaching the API directly could rotate it to escape per-IP limits (sign-up, reset emails, uploads) and write fake IPs into the audit log. Sign-in was already also limited per email. | `ORBIT_PROXY_SECRET`: only the Worker may state the client IP. Other requests use the right-most hop, the one the host's edge added. The Worker strips any client-sent copies of its headers. |
| 4 | Medium | **Session token in response bodies.** Login, register, reset and email-change returned the 7-day JWT in JSON to the web app too, so an XSS could read and exfiltrate it despite the httpOnly cookie. | Responses to the web app's own origin omit `access_token`. The desktop app (Tauri origin) still receives it for the keychain. |
| 5 | Medium | **`SameSite=None` session cookie.** Since the `/api` proxy it was needlessly cross-site, and CSRF rested entirely on the Origin + token checks. | `SameSite=Lax; Secure` in production (`ORBIT_COOKIE_SAMESITE` to override). The CSRF checks stay as defence in depth. |
| 6 | Medium | **No CSP or security headers on the web app.** | A build-time CSP with a hashed inline script and an exact `connect-src`, plus HSTS, `nosniff`, `DENY`, `no-referrer`, COOP and a `Permissions-Policy`. Checked in Chromium: every page renders, with no violations. |
| 7 | Low | **Unbounded request bodies.** A multi-GB multipart body was spooled to disk before the upload route's size check ran. | `BodyLimit`: upload cap + 1 MB, returning 413 on `Content-Length`, and counted for chunked bodies. |
| 8 | Low | **Host-derived update URLs.** Installer download links were built from the request's `Host` header. | `ORBIT_API_PUBLIC_URL` is used when set. |
| 9 | Low | **Base images not pinned** (`python:3.12-slim`, `uv:0.5`). | Pinned by digest; Dependabot's `docker` ecosystem bumps them. |
| 10 | Low | **`assert` for auth invariants.** Asserts are stripped under `python -O`, which would turn a missing user into a 500 or `None` access. | Explicit 401s. |
| 11 | Low | **Email addresses in production logs** when SMTP is off. | Masked (`j***@example.com`). |
| 12 | Info | `server: uvicorn` banner. | `--no-server-header`. |
| 13 | Info | Desktop CSP lacked `object-src`, `base-uri`, `form-action` and `frame-src`. | Added, all `'none'`. |
| 14 | Info | **WebSocket handshakes didn't check Origin.** They weren't exploitable: the single-use ticket comes from a CSRF-protected POST. | Live and companion sockets refuse foreign origins with 1008, before the ticket is redeemed (so a hostile page can't burn it). |

**Also hardened:**
- **Production config:** refuses a `*` CORS origin and a proxy secret shorter than 32 characters.
- **CI:** a `security` job runs `pip-audit`, `bandit` and `pnpm audit` on every push.
- **Dependabot:** now covers Docker too.

## DAST coverage (all passing)
- **Access control (IDOR).** As a second user, every endpoint that takes an object ID returns 403/404/405/422.
  - Documents: text, edit, delete.
  - Sessions: get, end, report retry, transcript delete, review, drill, export, live ticket, companion start/stop,
    follow-up, answer feedback, screenshots, delete.
  - Stories: update, delete.
  - Workspaces: get, update, delete.
  - Prep and session creation with another user's document ID.
  - Every list endpoint is scoped to its owner.
- **Authentication.**
  - JWTs with `alg: none`, the wrong key, an edited payload or a changed expiry, and garbage tokens: all 401.
  - "Sign out everywhere" revokes existing Bearer tokens.
  - Login and password-reset responses are identical for unknown and known emails.
  - Weak passwords are rejected, and mass assignment (`is_admin`, `email_verified`, `token_version`) is ignored.
- **Session cookie, CSRF and CORS.**
  - The web login has no token in the body, and the cookie is `HttpOnly` + `SameSite=Lax`.
  - Rejected: a foreign Origin, a missing or forged CSRF token, a cookie request with no Origin, and a
    form-encoded body.
  - Legitimate web requests work.
  - CORS is refused for foreign and `null` origins, and allowed with credentials for the web app.
- **WebSockets.**
  - A ticket for session A can't open session B.
  - Bogus or missing tickets are refused.
  - Tickets are single-use.
  - A foreign Origin is refused.
- **Uploads.**
  - Executables are rejected.
  - HTML disguised as a PDF is rejected.
  - Traversal filenames are neutralised.
  - A 300 MB-expanding DOCX zip bomb fails safely, and the API stays up.
  - Bodies over the cap get 413.
- **SSRF** (job-link import) is blocked for:
  - loopback (IPv4, IPv6, `0.0.0.0` and the decimal form `2130706433`);
  - private ranges;
  - cloud metadata (`169.254.169.254`);
  - `file:` and `gopher:` URLs.
- **Rate limits.**
  - Sign-in brute force is throttled, even while rotating `X-Forwarded-For`.
  - Sign-up is limited per IP.
  - Phone-companion code guessing gets 404, then 429 after 10 tries. Codes are 256-bit random.
- **Error handling.** Injection-style IDs and malformed JSON get clean 4xx responses with no stack traces.
- **Web app under the CSP (Chromium).**
  - Pages checked: sign-in, home, new session, sessions, session detail, documents, story bank, mock, settings,
    billing, prep, live and companion.
  - Every page renders with no CSP violations and no page errors.
  - The hashed theme script runs.
  - The session token is visible to no script: not in `localStorage` and not in `document.cookie`.

## Follow-up: resolved later the same day
- **Sign-up no longer reveals whether an email is registered.** When verification is required and mail can be
  delivered:
  - it answers `202 {"status": "verify_email"}` for new and taken addresses alike, signs nobody in, and sends every
    email after the response;
  - both paths run one argon2 operation, so timing doesn't tell them apart either;
  - the owner of a taken address gets a "you already have an account" email (at most 3 an hour);
  - the verification link only verifies: the person then signs in with their password, so pre-registering someone
    else's email and waiting for them to click can't take over an account.
- **Unused web sessions expire after 3 days** (`ORBIT_SESSION_IDLE_HOURS`). The cookie renews at most every 15
  minutes while in use, never past the 7-day cap counted from the original sign-in.
- **Admin rights need a verified email** whenever mail can be delivered. Before, whoever registered the admin
  address first became admin without proving the inbox.

## Accepted risks
- **Signing up still returns 409 for a taken email where verification is off** (development, or a private list
  with `ORBIT_EMAIL_VERIFICATION=off`). Nobody outside the list can sign up there. The same goes for an admin-only
  deploy with no SMTP.
- **Desktop tokens last until the 7-day cap.** They live in the OS keychain rather than a browser, and are revocable
  at any time: "sign out everywhere", password reset and email change all bump `token_version`.
- **An admin-only deploy with no SMTP can't verify the admin address.** There, register the admin account
  immediately after the first deploy.
- **The desktop CSP allows `connect-src https: wss:`,** because the server address can be changed in the app. The
  window loads only bundled code, and no remote scripts are allowed.
- **Rate limits and live tickets are in process memory,** which is fine for the single instance production
  enforces (D12).
- **`/health` reports the running commit and provider names.** Deploy checks and the desktop app use them; they
  contain no secrets.

## Deploy steps for the new settings
1. **Render:** set `ORBIT_PROXY_SECRET` (32+ random characters) and `ORBIT_API_PUBLIC_URL` (the service's https URL).
2. **Cloudflare:** run `wrangler secret put PROXY_SECRET` with the same value.
3. **Check `ORBIT_WEB_URL`:** it must be the exact web origin, so the web app stops receiving tokens in responses.

Nothing breaks if these steps aren't done yet: without the secret, the API keeps its old IP behaviour.

## Re-running the checks
```sh
gitleaks git . && gitleaks dir .                      # secrets
cd apps/api && uv export --frozen --no-hashes --no-emit-project > /tmp/req.txt \
  && uvx pip-audit --strict --disable-pip --no-deps -r /tmp/req.txt  # Python SCA
uvx bandit -r orbit_api -ll                           # Python SAST
pnpm audit --audit-level high                         # npm SCA
cd apps/desktop/src-tauri && cargo audit              # Rust SCA
```
The regression tests for this review are in `apps/api/tests/test_security_review.py`.

# Red team (18 October 2026)

An attacker's-eye pass over everything that landed since the September review: referrals, interview day, languages,
the SEO Worker, the redesign and scenes. It also re-checked the older surface. Every finding below was reproduced on a
local stack (mock providers, fresh SQLite) before it was fixed, and each fix has a test that fails on the old code.
Production was only read: headers, TLS, `/docs`, `/ready` and the public update manifest.

## Attack surface
- **API:** 248 HTTP routes and 2 WebSockets.
  - Public:
    - health and ready;
    - auth config;
    - plans, packs and monthly plans;
    - region;
    - job stats;
    - interview styles;
    - engineering telemetry;
    - desktop update and download;
    - referral code lookup.
  - Everything else needs a session. Paid-provider routes also need a verified email, and 39 admin routes need
    `require_admin`.
  - Webhooks carry their own signatures. The companion code and the support thread token are their own credentials.
- **Worker:** the `/api/*` proxy (fixed upstream, client IP and country only with the proxy secret), canonical 301s,
  `robots.txt`, prerendered pages, the SPA shell and static files.
- **Desktop:**
  - 17 Tauri commands;
  - no remote URLs in the capabilities;
  - no fs, shell or http plugins;
  - an https-only updater with a minisign key.
- **Extension:** no message handlers besides the connect page's `postMessage`. Scripts are injected only on a click
  (activeTab).
- **Outbound fetches from user input:** only `prep/job_link.py`, which pins a public IP and re-checks every
  redirect. Job sources call fixed hosts.
- **Code execution:** none. Code AI only reviews code with the model, and the browser runs code in a Web Worker.

## Findings fixed

| ID | Severity | Class | Where | What an attacker could do | Test |
|---|---|---|---|---|---|
| RT-01 | High | 2FA bypass | `POST /v1/auth/password-reset/confirm` | With the inbox alone, reset the password and get a full session on an account with two-step sign-in on. | `test_a_password_reset_still_asks_for_the_authenticator_code` |
| RT-02 | High | Pre-account takeover | passkey and 2FA setup, reset, Google claim | Register the victim's address without verifying it, sign in, add a passkey. After the victim resets and uses the account, sign in with that passkey. | `test_an_unproven_inbox_cannot_add_…`, `test_proving_the_inbox_by_reset_drops_…`, `test_google_claiming_…` |
| RT-03 | Medium | Throttle race | `ratelimit.blocked`/`failed` (login, `/login/2fa`, 2FA settings, password re-checks) | Send guesses at once: they all pass the check before any failure is counted (locally, 8 of 60 2FA codes got checked against a limit of 5). `/login/2fa` also had no per-network limit. | `test_wrong_codes_sent_at_once_…`, `test_attempt_takes_the_token_…` |
| RT-D1 | Medium | Update downgrade | `tauri.conf.json` updater | Serve a manifest that pairs "9.9.9" with an old genuine installer and its signature, rolling the app back. | `the_release_config_refuses_a_downgrade_…` |
| RT-04 | Low | Paid-provider abuse | `POST /v1/voice/speak` | From an unverified account, turn any text into speech on Orbit's TTS account. | `test_an_unproven_inbox_cannot_spend_the_natural_voice` |
| RT-W | Low | Header trust | Worker `/api` proxy | Send your own `Forwarded`, `X-Forwarded-Host` or `-Proto` to an API that trusts them. Redirect mode was only implicit. | `worker/index.test.js` |
| RT-D3 | Low | Least privilege | desktop capabilities | `opener:default` allowed reveal-in-folder for any path; a UNC path leaks the NTLM hash. | `the_windows_can_open_links_but_not_reveal_files` |
| RT-D5 | Low | Token scoping | desktop server switch | Get a keychain token sent to a newly typed server on the next launch. | `api.test.ts` "switching server" |
| RT-E2 | Low | Data exfiltration | extension Fill | A job page reads the profile back from fields nobody can see. | `fields.test.ts` "which fields are on show" |
| SCA | Low | Dependencies | desktop | rustls 0.23.45 (RUSTSEC-2026-0346..0349) and zip 4.6.1 (-0367..0369), not reachable as used. rustls is updated and zip is dropped. | `cargo audit`: 0 vulnerabilities |

## Not fixed: decisions or settings for the owner
- **First-purchase discount on several open orders (Low/Medium, business).**
  - The discount applies to every order made before the first payment lands, so a buyer with a 50% creator code can
    open several checkouts and pay them all.
  - Recommended: one discounted order at a time. Reuse the open one, and expire older open discounted orders when a
    new one is made. A payment that arrives later for an expired order is still credited.
- **Rupee prices through a direct API call (Low, business).**
  - Requests that don't come through the Worker fall back to `user.country`, which the user sets, and only the web
    app creates orders.
  - Recommended: in production, price checkout only from the Worker's signed country, and answer 409 "Buy on
    orbitanswer.com" without it.
  - A VPN still works, as with any geo-pricing.
- **Desktop capability split (Low).**
  - Give the region overlay its own capability, and add an app-command ACL (`tauri_build::try_build` with
    `AppManifest::commands`).
  - This needs a run of the app to confirm what the overlay uses.
- **Desktop release CSP `connect-src https: wss:` (accepted, as in September).** It keeps the custom-server option.
  Narrow it to the Orbit API in release builds if that option goes.
- **Extension token handoff (Low).**
  - The connect page passes the scoped token with `window.postMessage`. Recommended: `externally_connectable` limited
    to `<web>/extension/connect*`, with `chrome.runtime.sendMessage` to the two extension IDs.
  - Build the extension with `ORBIT_API_URL=https://api.orbitanswer.com`, so its host permissions don't include the
    web origin.
- **Worker-built responses (Low).**
  - The 301s, `robots.txt` and plain-text 404s carry no HSTS, frame or referrer headers. Pages and `/api` do
    (checked on production).
  - HSTS `preload` is the owner's call, since it's hard to undo.
- **Branch previews (Info).** In wrangler.jsonc, set `"workers_dev": false, "preview_urls": false`, or point
  previews at a staging API. Keep `ORBIT_CORS_ORIGINS` free of preview origins.
- **Cloudflare minimum TLS (Info).** Set SSL/TLS → Edge Certificates → Minimum TLS Version to 1.2. A Windows
  (Schannel) probe of the web host answered over TLS 1.1; the API host refuses it.
- **Job-link fetcher (Low, robustness).** Decode a page only as one of a short list of common text encodings
  (anything else as UTF-8 with replacement), and do it in the parsing thread.
- **Detection (Low).**
  - Email the owner when a passkey or two-step sign-in is added, or the password is reset.
  - Recovery for a lost authenticator plus lost recovery codes should be an audited admin action (D71).
- **Info:**
  - three `href`s in Jobs AI take server URLs without `safeUrl` (the server and React already block
    `javascript:`);
  - ids read from query strings are path-encoded but can be `..` (GET only; nothing harmful found);
  - the Razorpay event id header isn't signed (redeliveries stay idempotent by order status);
  - `/v1/extension/connect` adds a device row each time (rate limited);
  - prompt injection in a job post or document only steers that user's own answers: the support bot uses no model,
    and no model output reaches another account or the admin.

## Checked and fine
- **IDOR:** every route that takes an object id, including the new interview-day, mission, plan, offers, contacts,
  evidence, tailor-queue and passkey routes.
- **Admin:** only `ORBIT_ADMIN_EMAIL` with a verified inbox. Email change and Google can't take that address.
- **CSRF and CORS:** foreign and `null` Origins are refused.
- **JWT:** HS256 only. Challenges and state tokens can't pass as sessions.
- **WebSockets:** Origin is checked, and tickets are single-use.
- **SQL:** no raw SQL built from strings.
- **Downloads:** no headers built from user data.
- **Uploads:** size and pixel caps, magic bytes, the isolated parser.
- **Payments:** gateway signatures, matching amount, currency and order, applied once.
- **Rendering:** the SPA and desktop have no HTML sinks.
- **Worker:** no open proxy and no open redirect. JSON-LD and meta are escaped.
- **Production:**
  - `/docs`, `/openapi.json` and `/redoc` are 404;
  - `/ready` shows the proxy secret is set;
  - HSTS, CSP, `nosniff`, `DENY` and `no-referrer` are on pages and the API.
- **Secrets:** gitleaks 8.30.1 scanned 698 commits and the working tree. It found only test fixtures (an RFC 6238
  vector and fake test keys) and untracked local files (the dev outbox, `.venv`, `target/`). No real secret is
  committed.
- **Dependencies:** pip-audit, `pnpm audit` and `cargo audit` report 0 known vulnerabilities after the fixes, and
  bandit is clean at medium.
