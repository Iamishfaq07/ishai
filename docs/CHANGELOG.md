# Implementation log

## Launch hardening 1b — configurable plans, entitlements, session ceiling (2026-09-25)

- **One plan table in server config** (`entitlements.py`), overridable with `ORBIT_PLANS_JSON` and
  `*_MAX_SESSION_MINUTES`. Invalid config stops the API at boot.
- **Plan fields:** live minutes, mock minutes, screenshots, documents, max session length, features, display
  price, Stripe price id.
- **Entitlement service** `for_user()` behind `GET /v1/entitlements`, plus a public `GET /v1/plans`. The web
  Billing page and desktop Settings render from them instead of hard-coded copy.
- **Mock interviews have their own monthly allowance** (`mock_seconds`); before, they spent live minutes.
- **Feature flags are enforced** (before, they were defined but never checked):
  - screenshots need `vision` and mock sessions need `mock`, otherwise `403 feature_unavailable`;
  - the old defaults contradicted themselves: Free had screenshot credits but no `vision`.
- **Per-session ceiling (§7), even on Unlimited:**
  - Free 60 min, Pro 180, Unlimited 240, counted across reconnects;
  - a 5-minute warning (`usage.status {reason: "session"}`), then a graceful end (transcript, usage and report
    are all kept);
  - a capped session can't reopen (`409 session_time_limit`);
  - the live banner says which limit it hit.
- New `docs/BILLING.md`.
- Tests: 14 entitlement tests (config, fail-fast, endpoints, mock allowance, feature gates, ceiling) and 1
  reducer test. The Billing page was checked in Edge against a local API with price overrides.

## Launch hardening 1a, part 2 — one live session, truthful STT status, upload hardening (2026-09-25)

- **One live session per account.** A second one is refused at the ticket (`409 live_session_active`, naming the
  running session) before any audio or AI spend. The live screen offers **End it and use this one**.
  - Ticket errors (401/402/403/404/409) are no longer retried, and they keep the server's message, which used to
    be replaced by a generic "Not authorized".
- **Fixed:** `POST /sessions/{id}/end` didn't stop that session's live socket, so a session ended from another
  window or the web kept streaming audio to Deepgram until its client left. It now ends the engine
  (`session.ended`, usage recorded) and closes the socket with 4009.
- **Truthful STT status (§14).** Deepgram `connect()` suppressed its timeout, and the engine then reported
  transcription as `ok` regardless, so a slow or rejected handshake showed "ok" first.
  - Sessions now expose their real state.
  - The engine reports `connecting`, then `ok` only once both sockets are open, plus `reconnecting` / `down`.
  - The status pill says "Connecting audio…" / "Transcription unavailable".
- **Upload hardening (§20).** DOCX archives are inspected before parsing (ZIP bomb, size, entry count,
  traversal). PDF/DOCX extraction runs in an isolated child process with a timeout (and memory/CPU limits on
  Linux).
- **Per-app capture wording (§21).** Choosing a browser now says other tabs may be heard too, instead of "only
  this app".
- Tests:
  - 4 STT-status tests, 12 upload tests, a rewritten live-session test and 2 live-client tests.
  - Real desktop test build: a second session hit the conflict, "End it and use this one" ended the other (it
    received `session.ended`, then 4009) and connected. Chrome in "Listen to" shows the browser wording.

## Launch hardening 1a — verification, CSRF, abuse limits (2026-09-25)

- **Email verification is enforced.** `require_verified_user` gates session creation (live and mock), live
  tickets, screenshots, AI review and document uploads with `403 email_unverified`.
  - The admin is exempt.
  - Unverified users keep account access.
  - Both apps show a shared banner (Resend link / I've verified), and preflight reports it without spending
    provider calls.
- **CSRF defence** for cookie-authenticated browser requests: a strict Origin/Referer check plus an
  `X-CSRF-Token` HMAC of the session, which the shared client sends automatically. Bearer (desktop) requests are
  unaffected.
- **Abuse limits:**
  - sign-up 5/hour per IP;
  - login also limited per target email;
  - password reset per email;
  - per-user limits on session create, live tickets, screenshots and review, so rotating IPs doesn't multiply
    provider spend.
- **CAPTCHA abstraction:** Turnstile on sign-up and password reset when configured; the widget is chosen via
  `GET /v1/auth/config`.
- **Production fail-fast:** the API refuses to boot with public sign-up but verification off, verification
  required without SMTP, or Turnstile without keys.
- **Fixed (production):** CORS didn't allow `PUT`, so from the desktop app **editing a saved workspace and saving
  admin config were blocked** by the browser preflight.
- **Fixed (production):** uvicorn trusted `X-Forwarded-For` only from 127.0.0.1, so behind Render every request
  shared the proxy's IP: **per-IP rate limits were one global bucket** and audit IPs were wrong. The Dockerfile now
  passes `--forwarded-allow-ips='*'`.
- **Fixed (dev):** log redaction masked the dev outbox's links, so local verification and reset links couldn't be
  clicked. The dev outbox (never used in production) now also writes mail to `%TEMP%/orbit-dev-outbox.txt`.
- New `docs/SECURITY.md`.
- Tests:
  - 13 API regression tests (`test_launch_security.py`) and 5 client tests.
  - A real-browser drive of the web app (Edge) confirmed the verify flow, CSRF enforcement and the cross-origin
    PUT.
  - A real desktop test build confirmed the banner, the checklist entry and refused starts.

## Phase 6e — docs pass (2026-09-25)

Every doc was checked against the code, and stale statements were fixed:
- **README:** a "What Orbit does" overview and a download link.
- **ARCHITECTURE:** the status table, the "not built" list, the diagram, the data model (19 tables) and the phases
  are all current. The finalizer section had wrong timings: with Deepgram, questions fire on its endpoint, with a
  2.5 s fallback. The response-timing grace is a hold before firing.
- **PROTOCOL:** documents `mock.next`, `mock.question`, `mock.completed`, `coding_language`, and the answer fields
  `grounding`, `key_points`, `problem`, `edge_cases` and `tests`.
- **Desktop README:** rewritten.
  - Covers the WASAPI and per-app capture commands, updater, close dialog and all 9 global shortcuts.
  - Explains the test-build isolation.
  - Removed the macOS permission sections (deferred) and the "auto-update not wired" note.
- **Web README:** screenshots and mock interviews described as they work now.
- **DEPLOY:** `wrangler.jsonc` is at the repo root, and Workers Builds deploys `main`.
- **DECISIONS:** D28 (verified release script), D29 (contrast fixed in shared CSS), D30 (one curated icon set) and
  D31 ("delete app data" includes the sign-in).

## Phase 6d — installer lifecycle (2026-09-25)

- Tested install → upgrade → uninstall → reinstall on a real machine with the published installer (0.1.6 → 0.1.15).
  - Upgrade: sign-in and every setting kept.
  - Reinstall: signed in, settings byte-identical.
  - Uninstall removes the program, the Start-menu shortcut and the Add/Remove Programs entry.
- **Fixed:** "Delete the application data" in the uninstaller removed the settings and window state but left the
  **sign-in token** in Windows Credential Manager. A Tauri NSIS hook (`apps/desktop/src-tauri/windows/hooks.nsh`)
  now removes it under the same conditions: box ticked, and a real uninstall rather than an update. Covered by
  `scripts/test-uninstall-hook.ps1` (4 cases, throwaway credential).
- Documented where each piece of user state lives and what upgrade and uninstall do to it (WINDOWS_RELEASE.md). Also
  documented a WebView2 gotcha: an *empty* `WEBVIEW2_USER_DATA_FOLDER` silently swaps in a blank profile.

## Phase 6c — icon library (2026-09-25)

- Replaced every emoji / Unicode-glyph icon (📌 ◐ × ✕ ↻ ← ↓ ✓ → ○ ✎ ▾ ‹ ›) and the four hand-drawn SVGs with
  **lucide** icons, via one curated module (`packages/ui/src/icons.ts`) shared by desktop and web. Icons now share
  one stroke weight and render the same regardless of Windows emoji font; decorative icons are `aria-hidden`, and
  every icon-only button has an accessible name.
- Checklist status icons carry a spoken label ("OK" / "Warning" / "Problem") instead of the raw status id.
- **Fixed:** at the default 380 px Setup window, the title bar's text links pushed the transparency, minimize and
  **close** buttons off-screen. Documents / History / Settings / Sign out are now icon buttons with tooltips.
- axe (WCAG 2.1 AA): still 0 violations on all 8 screens in both themes. Web bundle +2 kB gzipped.

## Phase 6b — accessibility (2026-09-25)

- Audited every desktop screen with **axe-core (WCAG 2.1 A/AA)** in the real app, in both themes: Sign in, Home,
  Setup, Live (coding answer), End dialog, History, Settings, Documents.
- **Before:** 46 colour-contrast failures (grey secondary text at 2.6–4.4:1 against the 4.5:1 minimum) and 2 invalid
  ARIA attributes (level meters labelled without a role).
- **Fixed:** secondary text uses zinc-400 in dark mode (5.8–7.8:1) and a slightly darker grey in light mode (4.7–5.9:1
  on every light surface) — shared CSS, so web gets it too; level meters are `role="meter"` with values; the answer
  "Thinking…" placeholder is a `status`.
- **After: 0 violations on all 8 screens, light and dark.**

## Phase 6a — readable text, in-app dialogs, performance baseline (2026-09-25)

- **Text size setting now works everywhere:** 49 fixed-pixel text sizes (43 labels at 10–11 px, the question, the
  answer body, code) were converted to rem, so Settings → Text size scales them (they ignored it before). Sizes follow
  the brief: labels 12 px, answer 16 px, question 17 px, compact overlay 15 px (at the default size).
- **No more browser dialogs:** all 10 `window.confirm` / `window.prompt` uses (end session, delete document/session,
  remove key, sign out everywhere, delete account) use one accessible in-app `confirmDialog` (alertdialog, Esc to
  cancel, focus restored, danger styling, "type DELETE" for account deletion). Delete-session copy no longer claims
  to delete screenshots (they are never stored).
- **Performance baseline** (desktop app + WebView2, 8-core PC): startup to window 0.57 s; idle 212 MB / 1.7 % CPU;
  live simulated interview 274 MB / 1.7 % CPU.
- Verified in the real app: labels 12 → 13.5 px when the root size goes to Large; End shows the in-app dialog, Esc
  keeps the session, "End session" ends it; zero native dialogs; no console errors.

## Release incident — 0.1.11 forgot sign-ins (2026-09-25)

- **What happened:** 0.1.11 was built while `ORBIT_KEYRING_SERVICE` (a compile-time switch for test builds) was set
  to an empty string instead of unset; the app looked for the saved sign-in under an empty service name, so anyone
  who updated to it was signed out.
- **Found** before the next release: rustc's dep-info showed `ORBIT_KEYRING_SERVICE=`; a read-only `load_token` probe
  of every published installer confirmed only 0.1.11 was affected (0.1.7–0.1.10 and 0.1.12 find the saved sign-in).
  The owner's installed app (0.1.6) never took it.
- **Fixed:** 0.1.12 published (verified the same way), so the updater no longer offers 0.1.11; `secrets.rs` treats an
  empty value as unset (proved by building under the exact 0.1.11 condition); `scripts/release-desktop.ps1` refuses
  to release unless the variable is unset in the build.

## Phase 5d — AI mock interviewer (2026-09-25)

- New session type **Mock interview** (desktop Setup + web): pick interviewer (recruiter, hiring manager, senior/staff
  engineer, executive), focus (mixed, behavioral, technical, system design, coding), difficulty and length. The AI
  asks out loud, listens, follows up on what you actually said, moves on, and ends the session when the plan or time
  is used up; the normal report/review then grades the answers (D27). Migration `b7d2e4f6a8c1` (`sessions.mock_config`).
- Real DeepSeek run: a natural opener, a follow-up on a specific claim ("You mentioned leading the move to an
  event-sourced ledger…"), a push for specifics on a vague answer ("You said it went fine, but I'd like specifics"),
  a topic change after two follow-ups, and it caught an off-topic answer.
- Real desktop app: mock options shown, interviewer audio off, first question displayed and spoken
  (`speechSynthesis.speaking`), status moves from "Interviewer speaking…" to "Your turn", "I'm done" produced the next
  question, session recorded with its questions; no console errors.
- Not exercised end-to-end here: a full spoken answer through the real mic (the silence-after-answer path is covered by
  engine tests with the injected clock).

## Phase 5c — coding workspace (2026-09-25)

- Coding answers render as **Problem → Say (talk track) → Code → Edge cases → Tests**, plus complexity and key
  points. New `LiveAnswer.problem / edge_cases / tests` from `PROBLEM:` / `EDGE:` / `TESTS:` lines (D26).
- Code view: line numbers, syntax highlighting (Python, Java, JavaScript, TypeScript, C++, C#, Go, Rust, SQL),
  copy, remembered wrap toggle, and a language picker that regenerates the answer in the chosen language.
- Fixed while testing with real DeepSeek: "Find the second highest salary from an Employee table" was classified as
  a salary negotiation (no code). Pay words next to data cues (table, query, SQL, column…) are now coding.
- Real DeepSeek: two sum (auto → Python), reverse a linked list (Java), NPE debug (Java) produced every section in the
  requested language; first spoken words 0.51–0.86 s. In the real desktop app, the coding fixture showed all sections
  and switching Python → Java regenerated the code in Java; no console errors.

## Phase 5b — adaptive "NEXT" guidance (2026-09-25)

- Answers carry 3–6 key points (`LiveAnswer.key_points`, from a `POINTS:` line); the answer card shows them as a
  checklist that ticks off what the candidate has said and marks the next point (→). Local, instant, sticky, hideable
  (D25).
- Measured on real DeepSeek answers + DeepSeek-written "nervous candidate" paraphrases of the first half of each
  answer: all four cases ticked exactly the points in the spoken part, and an off-topic ramble ticked none. One false
  tick found during the evaluation (generic topic words against a long sentence) was fixed by requiring a label word
  for loose sentence matches. POINTS presence: 12/12 after marking the line required (a design answer had omitted it).
- Verified in the real desktop app with a real DeepSeek answer: five points, NEXT on the first, no false ticks from
  the candidate's unrelated line, Hide/Show works, no console errors.

## Phase 5a — pre-session checklist + saved setups (2026-09-25)

- **Checklist** (desktop Setup, above Start): microphone, interviewer audio source, resume/JD selected, network round
  trip, plus server checks (`GET /v1/preflight`: database, DeepSeek responding, Deepgram key valid, vision, live
  minutes / screenshot credits, app version) — each with a precise fix. Collapsed when all is well; failures expand
  and the button reads "Start anyway". Provider checks are cached (D23).
- **Saved setups** (`/v1/workspaces`, migration `a1f3c7e9d2b5`): save the current session setup under a name, pick it
  next time (documents + preferences restored, last one remembered), update or delete it. Sessions record the
  workspace they came from; a workspace's documents are used when a session doesn't pass its own.

**Verified in the real desktop app** (test build + local server with real keys): checklist showed real statuses
(DeepSeek 715 ms, Deepgram key valid, resume/JD missing flagged with fixes); a setup saved, restored after leaving
and reopening Setup, and the session started from it was linked (`session_count` 1). API 239 tests (+6).

## Phase 4 — answer quality (2026-09-24)

- **Question detection** (measured on the brief's phrases plus a monologue/filler corpus):
  - Before: missed "A little more on the security side.", "Go on.", "Say more about the rollout.", "Two sum, given an
    array of integers.", "So the next thing I wanted to ask is how you handle secrets"; "Expand on that.", "Talk me
    through your thinking.", "Hmm, and the database layer?" sat in the never-used LLM band. It also auto-answered 12
    statements such as "Design is a big part of our culture here." and "Tell me is what my manager always says."
  - After: all 22 required phrases trigger, 0 of 23 statements/fillers/logistics do (with and without a recent
    question). Bare continuers ("Go on.", "Why?") count only right after a question.
- **Ambiguous-band classifier** (`live/classifier.py`, D21). Real DeepSeek: 9/10 correct on hard cases, resisted an
  injected instruction, median 0.67 s (only for ambiguous utterances), and resolves references ("Hmm, the caching
  layer." → "How did you design the caching layer of the payments service?").
- **Fact safety** (D22): `GROUNDED` label + "Suggested details" badge; sharper rule that a verified fact anchors only
  what it says. Audit before: a fully invented failure story (7 unsupported claims) and invented rollout steps, both
  presented as fact. After: invented detail still appears for questions the resume can't support, but every such
  answer was labelled `example` (12/12 over two runs). Technical/design/coding answers are labelled `general`, first
  words unchanged (0.52–0.73 s).
- **Duplicate suppression**: the brief's "Tell me… / Tell me about… / Tell me about yourself" case is pinned by a test
  (one question, one answer).
- Real-audio regression run (Deepgram + DeepSeek): filler ignored, three questions answered, latency unchanged.

**Verified:** API 233 tests (+56) + 15 smoke (new: real classifier); ruff, strict mypy; UI 42 tests, typecheck, lint.
**Not done in this phase:** neural/hybrid retrieval (current lexical retrieval kept), token-level context budget
(a character budget exists), prepared/cached answers.

## Phase 3 — Windows audio reliability (2026-09-24)

- **Stable device identity:** microphones and outputs are listed and opened by MMDevice endpoint id (legacy saved
  names still resolve). The Setup screen remembers the mic and output choice.
- **Recovery:** unplug/replug, Bluetooth drop, device invalidation and default-device switches reopen capture by
  itself; a missing chosen device falls back to the default and switches back when it returns. Live shows
  "Microphone disconnected — reconnecting…" / "reconnected" / "switched to …".
- **Call audio:** new "Call audio — communications device" choice, plus any specific output. On the dev PC the
  default output (Realtek Digital Output) and the communications device (Speakers) differ, so a Teams call routed to
  the communications device was previously inaudible to Orbit.
- **Resampling:** Windows converts to 16 kHz mono (AUTOCONVERTPCM + SRC_DEFAULT_QUALITY) on the capture path.
- **Silence fill:** output loopback emits silence frames while nothing plays, keeping end-of-speech detection and
  the latency timeline working.

**Verified on real hardware** (test build driven over CDP): endpoint ids listed with default/communications flags;
TTS through the default output captured (RMS 0.097); 20 frames/s of silence with nothing playing; communications
choice opens Speakers; bogus saved ids fall back with a `fallback` status; switching the Windows default output
mid-capture (Digital → Speakers → Digital, restored afterwards) produced `switched` → `switched` with no frame gap.
Rust 18 tests, clippy -D warnings, fmt; desktop typecheck + lint.

**Needs manual hardware:** USB/Bluetooth unplug-replug, HDMI outputs and sleep/wake weren't physically exercised
(the same reopen path handles them: device invalidation → reopen); Teams/Zoom routing to the communications device.

## Phase 2 — platform (2026-09-24)

Decisions for a private deployment: one API instance (D12), no Stripe or backup provider yet (D17), Sentry built in
but off (D18).

- **Real-provider smoke suite** (`tests/smoke`, opt-in with `RUN_PROVIDER_SMOKE=true`; manual GitHub workflow).
  DeepSeek: text + priced usage, streaming, JSON mode, vision, timeout mapping. Deepgram: interim → final + endpoint,
  reconnect, every language in the app. **It found two real bugs**, both fixed:
  - `language: "auto"` sent `detect_language=true`, which Deepgram streaming rejects (HTTP 400) → now `language=multi`.
  - HTTP 400 handshakes were retried forever → now fatal ("unsupported transcription settings").
- **Deepgram reconnects keep one timeline:** timestamps restart at 0 on each socket; events are now shifted by the
  audio sent to earlier sockets (unit-tested). The unused "last packet → transcript" metric was removed.
- **Real latency metrics** (`live/metrics.py`): speech start → first partial, speech end → final / question /
  first AI word, question → first AI word; stored per session (`sessions.metrics`, migration `9d5e2f8a1b47`),
  p50/p95/p99 via `GET /v1/admin/latency` and desktop **Settings → Latency**. First real run: speech end → final
  326 ms, → question 1.88 s (mostly the Balanced 1.5 s wait), question → first word 679 ms, speech end → first word
  2.58 s.
- **Observability:** JSON logs in production with `request_id` / `user_id` / `session_id`, `X-Request-ID`
  propagation, secret redaction (keys, bearer tokens, JWTs, WS tickets, Deepgram tokens), optional Sentry with
  scrubbing.
- **CI:** `cargo fmt --check` + `cargo clippy -D warnings` added (the tree was formatted in a separate commit).

**Verified:** API 177 tests (+9) + 14 smoke (all green against the real providers), ruff, strict mypy; UI 42 tests,
typecheck, lint; Rust 17 tests, fmt, clippy -D warnings; migration round trip + `alembic check` on SQLite.

## Phase 1 — critical correctness & security (2026-09-24)

Audit of the upgrade brief's P0 list against `main` @ cab0d95; every item below was confirmed in code first.

| # | Issue | Fix |
|---|---|---|
| P0-3 | Per-app loopback built a Rust slice from a possibly-null WASAPI buffer before the silent check (UB) | Slice only built for a non-silent, non-null, non-empty packet; down-mix moved to a safe `packet_to_mono` helper (any channel count, short buffers padded) with unit tests |
| P0-4 | Production with `ORBIT_ADMIN_EMAIL` unset: open sign-up and first user = unlimited admin | Production refuses to boot without `ORBIT_ADMIN_EMAIL`; admin never inferred from registration order in production; allowlist never falls open |
| P0-5 | Pricing table knew only `deepseek-chat/reasoner`; production model `deepseek-flash` costed $0; cache hits ignored | `providers/llm/pricing.py`: DeepSeek list prices (cache hit/miss/output, peak/off-peak), `ORBIT_LLM_PRICING_JSON` overrides, unknown model → cost `NULL` + warning; `cached_input_tokens` parsed and stored |
| P0-6 | Live minutes written only at socket close (crash = unbilled) and checked only at connect | 15 s heartbeat commits one idempotent row per connection and enforces the limit mid-session across all the user's sessions; `usage.status` warning (< 5 min) and graceful end at 0 (`4003`) |
| P0-7 | In-process live state ambiguous for multiple instances | Documented decision: production is single-instance until live state moves to Redis (DECISIONS D12) |
| P0-10 | "Store screenshots" toggle did nothing (server always discards) | Toggle removed; truthful copy; API ignores the flag and always reports `false` |
| P0-11 | Screenshot credit charged before analysis | Credit spent only when the answer completes (keyed per question); `screenshot_attempts` / `screenshot_failures` internal metrics |
| P0-12 | Desktop accepted plain `http://` remote servers (password/token in cleartext) | `checkServerUrl`: https required except loopback / dev builds; insecure saved override ignored; inline reason shown |
| P0-14 | Recorder logged and dropped failed writes (usage, cost, transcript) | Bounded retries with backoff → `failed_writes` dead letter → local spool → replay on boot; fixed PKs + usage upserts make retries idempotent; live teardown shielded from handler cancellation and drained on shutdown |
| P0-15 | `session.ended` waited up to 30 s for the report; `/end` used a non-durable BackgroundTask | Reports are DB-backed jobs (claim via conditional UPDATE, retry with backoff, stale-job recovery, dedupe per session); `report_status` on sessions; History shows "Generating the report…" and polls |

Migration `8c4d1e7f2a30`: `usage.idempotency_key` (unique), `provider_requests.cached_input_tokens`,
nullable `estimated_cost_usd`, `failed_writes`, `jobs`.

**Verified:** API 168 tests (+16), ruff, strict mypy; UI 42 tests (+4), typecheck, lint; Rust 17 tests (+4),
clippy clean; migration upgrade/downgrade/`alembic check` on SQLite; a real DeepSeek-V4.1-Flash run recorded
cost with cache hits (1,408 of 1,602 input tokens) and charged each screenshot once.

**Not verified here:** the migration against Postgres (no local Postgres; runs on the next Render deploy, where a
failure rolls back and the old deploy keeps serving). The loopback fix changes code that only runs on real
per-app capture: it needs a desktop release to reach users.
