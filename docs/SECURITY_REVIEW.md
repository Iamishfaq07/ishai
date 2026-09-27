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
