# Decision log

**D1 — Line-tagged streaming format instead of JSON.** JSON can't be rendered until its keys close, so answers would
appear late and in bursts. The model emits `ANSWER:` / `- bullet` / `CODE:` / `TIME:` lines, and
`AnswerStreamParser` turns the buffer into a full `LiveAnswer` after each chunk. The UI renders the snapshot
as-is (it's idempotent), so a bullet appears the moment it's written and text that has already streamed never shifts.

**D2 — Audio is relayed through the API.** The desktop app never holds a Deepgram key (spec §15/§66). This costs one
extra hop (~tens of ms) but lets us meter usage and enforce auth on the server.

**D3 — Two audio channels instead of diarization.** Mic = candidate, system = interviewer. This is far more reliable than
diarizing a mixed stream. `speaker.correct` handles the edge cases.

**D4 — Per-session in-memory retrieval.** The chunks of the selected documents are loaded once when the WS connects, then
each question is scored locally in under 1 ms. pgvector (HNSW) stays the store and will back library-wide search.

**D5 — Local hashing embedder.** DeepSeek has no embeddings API. A deterministic feature-hashing embedder
(384-d) needs no key, runs offline, and handles lexical matching of resume facts well. Swap in a neural
embedder behind `Embedder` when recall needs it (a re-embed migration will be required).

**D6 — Cheap heuristic detection first.** It runs on every partial. The LLM classifier is reserved for the
ambiguous band (`needs_llm`) and isn't wired into the hot path yet.

**D7 — Single-use WS tickets.** Browsers can't set headers on a WebSocket, and a long-lived JWT must not appear in a URL.
The tickets are held in process memory (see D12).

**D8 — No "undetectable" features.** Orbit doesn't hide itself from screen sharing and doesn't try to defeat
proctoring (spec §64). Screenshots are only taken on explicit user action. Audio is never stored.

**D9 — Mock providers are labelled, never disguised.** `/health` and `provider.status` report `mock`, and mock
answers are prefixed `[mock]`. Production config refuses to start with mock providers or the dev JWT secret.

**D10 — Token versioning for revocation.** JWTs carry the user's `token_version`, and `current_user`
rejects any mismatch. A password reset or "sign out of all devices" bumps the version, which revokes every
web cookie and desktop keychain token immediately, with no token denylist to maintain.

**D11 — Email tokens.** Tokens are random, single-use and expiring (48 h to verify, 1 h to reset), and only their
SHA-256 is stored. Issuing a new token voids the older unused ones. Reset requests always return the same 202
body, and the email is sent *after* the response, so neither the content nor the timing reveals whether an
account exists. The web pages strip `?token=` from the URL on load and send `no-referrer`.

**D12 — Production runs exactly one API instance (for now).** WS tickets, live-socket ownership (one socket per
session, 2 per user), the engine registry that screenshot uploads feed, and rate-limit buckets live in process
memory. That is correct only with a single instance, which is what the Render deploy runs. Scaling out requires
moving those to Redis first (`ORBIT_REDIS_URL` is reserved for it). Usage, cost, jobs and dead letters are in
Postgres and are already multi-instance safe (job claims are conditional UPDATEs).

**D13 — The admin is explicit in production.** `ORBIT_ADMIN_EMAIL` is required (the server refuses to start
without it); registration order never confers admin in production. Unset, sign-up would be open and the first
account would get unlimited use of the shared provider keys. Dev/test keep a first-user fallback for convenience.

**D14 — Metering is server-authoritative and idempotent.** Live minutes are committed on a heartbeat as one upserted
row per connection (`usage.idempotency_key = live:<connection>`); the limit is enforced mid-session. Screenshot
credits are spent only on a delivered answer (`shot:<question>`); attempts and failures are separate internal
metrics. LLM cost is estimated from config-driven prices with cache-hit/miss and DeepSeek peak/off-peak rates; an
unpriced model records cost `NULL` (unknown) with a warning — never `$0`.

**D15 — Live-session writes are durable.** The recorder retries each write with backoff; what still fails goes to
`failed_writes` (or a local spool file if the DB is unreachable) and is replayed at startup. Live teardown runs in
a shielded task so a cancelled handler (server shutdown) can't abort usage/transcript writes. Reports are DB-backed
jobs (`jobs` table) run by a worker in each API process, so ending a session is instant and a restart can't lose
a report.

**D16 — Remote servers must be HTTPS.** The desktop "Server" override accepts plain `http://` only for this
machine (`localhost`, `127.0.0.1`, `[::1]`) or in a development build; an insecure saved override is ignored.

**D17 — No billing or backup AI provider yet.** Orbit is a private, single-user deployment, so there is nobody to
charge: plans and limits are enforced server-side, but nothing is purchasable (no Stripe). A second LLM provider
would need another paid key; DeepSeek errors are retried once before the first token. Revisit both before opening
Orbit to other users.

**D18 — Crash reporting is built in but off.** Sentry starts only when `ORBIT_SENTRY_DSN` is set, with PII,
request bodies/headers/query strings and breadcrumbs stripped. Without it, structured JSON logs with correlation IDs
(and secret redaction) are the record.

**D19 — Latency is measured on the audio timeline.** Each STT channel keeps a map from "audio position sent to the
provider" to "server time it was sent", so speech-start/speech-end timestamps from Deepgram become server times even
across pauses. Deepgram timestamps restart at 0 on every socket, so each reconnect's events are shifted by the audio
sent to earlier sockets, giving one continuous session timeline.

**D20 — Native WASAPI capture on Windows (cpal only elsewhere).** Mic and output loopback open MMDevice endpoints by
stable id and ask the audio engine for 16 kHz mono directly (AUTOCONVERTPCM + SRC_DEFAULT_QUALITY), so Windows'
resampler replaces the hand-rolled one on this path. Each source runs a supervised loop: an invalidated/unplugged
device is reopened with backoff (same device if it returns, else the default), a stream following the default (or
the default *communications* device) re-targets within ~1 s when Windows switches it, and an explicitly chosen device
that was missing is switched back to as soon as it reappears. Output loopback delivers no packets while nothing
plays, so silence is synthesized after 100 ms — the transcriber needs to hear the pause to end the utterance.

**D21 — A classifier only for the ambiguous band.** The heuristic detector decides almost every utterance instantly.
One-word verbs double as nouns ("Design is a big part of our culture"), so they count as a request only when followed
by what they act on; the rest land in the 0.35–0.6 band. Utterances in that band go to one small JSON call (thinking
off, 2.5 s timeout, fenced transcript) only once the interviewer has finished (endpoint or long silence), never on
partials, and never in click-to-answer mode. It also rewrites references ("Expand on that.") into a standalone
question. If it's unavailable, the band is not auto-answered (the user can still press Answer).

**D22 — Answers declare where their personal claims come from.** The model starts every answer with
`GROUNDED: verified | example | general` (a few tokens, no extra call). "example" (a story, or details of a real
project that the documents don't contain) shows a "Suggested details" badge. A fabrication audit (real DeepSeek +
an LLM judge labelling each claim VERIFIED / INFERRED / GENERAL / UNSUPPORTED) showed invented personal detail can't be
fully prevented for questions the documents don't cover, but with the label every answer containing it was flagged
(12/12 across two runs). A personal question with no verified facts and no label defaults to "example".

**D23 — Preflight checks are real but cheap.** `GET /v1/preflight` pings DeepSeek with a 3-token request (cached 60 s)
and validates the Deepgram key with its free project-listing endpoint (cached 5 min), so the checklist reflects the
providers actually working — not just keys being present — at negligible cost. Warnings never block a session; a
failure turns the button into "Start anyway". Local checks (microphone, interviewer audio, documents, network round
trip) run in the desktop.

**D24 — Workspaces are saved setups, not a job tracker.** A workspace stores documents + answer preferences (role,
type, language, length, style, auto-answer). Audio devices stay per-machine (localStorage), since a setup may be used
on another PC. Deleting a workspace keeps its sessions (link set to NULL) and never touches documents.

**D25 — "NEXT" guidance is local and deterministic.** The model ends each answer with `POINTS:` (3–6 short labels, in
order) — after the answer, so the first word isn't delayed (+80 tokens of headroom so long answers still reach it;
a paragraph-opening fallback covers the rare answer without it). Coverage runs in the client on every transcript
update, with no model call: the candidate's words since the answer appeared are matched against each label (plus
common abbreviations, e.g. PR ↔ pull request) and against the answer sentence it summarises, by 5-letter stems. A
loose sentence match must also include one of the point's own words, so shared topic vocabulary alone ("build",
"scan") never ticks a point. Ticks are sticky per answer (no flicker); NEXT is the first unticked point after the
last ticked one. Chat and screenshot answers get no checklist. The user can hide it.

**D26 — Coding answers separate what to say from what to code.** For coding the spoken ANSWER is the talk track
(approach and why, never code read aloud), followed by PROBLEM (the task in one line), CODE, TIME/SPACE, EDGE and
TESTS. PROBLEM comes after the talk track in the stream so it never delays the first spoken word. A preferred code
language (`LiveSettings.coding_language`, remembered per device) goes into the prompt; changing it on an answer's
code re-asks the same question in that language (not for screenshots, whose image isn't kept). Highlighting is a small
built-in tokenizer rendered as React nodes (no dependency, no HTML injection).

**D27 — The mock interviewer lives in the live engine and speaks with the platform voice.** Mock sessions reuse the
whole live pipeline: mic → STT → transcript. A `MockInterviewer` asks one question at a time (one JSON call, thinking
off; persona, focus, difficulty, role, resume/JD as reference), decides follow-up vs new topic (at most two follow-ups
per topic), and moves on after 3 s of candidate silence following 3+ words, or on "I'm done". Questions are recorded as
interviewer turns + questions (source "mock"), so the existing report and review scorecard grade the practice. Speech
uses the built-in `speechSynthesis` (Windows voices; WebView2 exposes no voice list but speaks with the default
voice) — free and local. The mic is muted while the interviewer speaks so its voice isn't transcribed as the answer.
Practice mode never answers for the candidate: the answer controls are hidden and `answer.request` means "I'm done".
If the model fails, a fallback question list keeps the interview going.

**D28 — Releases are built by a script that proves they use the real sign-in store.** 0.1.11 was compiled with
`ORBIT_KEYRING_SERVICE=""` (left over from a test build), so it looked for the sign-in under an empty service name,
and every user appeared signed out. Now `secrets.rs` treats an empty value as unset, and
`scripts/release-desktop.ps1` clears the variable before building. After the build, the script reads rustc's
dep-info and refuses to publish if the variable was seen with a value. Each published installer is also
spot-checked by downloading it from GitHub and confirming it finds the installed app's sign-in (read-only).

**D29 — Accessibility contrast is fixed once in shared CSS, not class by class.** Secondary grey text (`zinc-400/500`)
failed WCAG AA (2.6–4.4:1) across both apps. Rather than editing dozens of call sites, `base.css` maps those
utilities to the lightest greys that pass on every surface in each theme: zinc-400 in dark mode, `#63636b` in light.
The result is verified by an axe audit of every real desktop screen in both themes.

**D30 — One icon library, curated.** Emoji and Unicode glyphs rendered differently per Windows font and couldn't be
styled. Icons come from lucide (tree-shaken, MIT), but only through `packages/ui/src/icons.ts`, so both apps share
one set. Lucide hides icons from screen readers by default, and every icon-only button carries an `aria-label` and a
tooltip.

**D31 — "Delete the application data" means all of it, including the sign-in.** The token is in Windows Credential
Manager, outside the folders Tauri's uninstaller deletes. An NSIS post-uninstall hook removes it under exactly
Tauri's conditions: the box is ticked, and this is not an update. Silent uninstalls and updates keep everything, so
a reinstall comes back signed in.
**D32 — Paid features require a verified email; the admin is exempt.** The server pays for every live minute, so
an account must prove it controls its inbox before it can spend provider money. The check is one dependency
(`require_verified_user`) on the paid routes, not scattered `if`s. The admin is configured by env, not by sign-up,
so it's trusted. Production refuses to boot if non-admins can sign in but no SMTP exists to verify them: a silent
lock-out is worse than a loud config error.

**D33 — CSRF via Origin check + session-bound token header, not a double-submit cookie.** The API and web app are
on different sites, so the web app can't read an API cookie, and a double-submit cookie doesn't work. The token is
an HMAC of (user id, token version), so it needs no storage and rotates on sign-out-everywhere. It's handed out
only in CORS-protected auth responses. Sending a custom header also forces a CORS preflight, which unknown origins
fail.

**D34 — Rate limits key on the account as well as the IP.** IPs are cheap to rotate, and accounts are gated by
email verification, so provider-cost endpoints are limited per user. Login is also limited per target email, which
throttles password guessing spread over many IPs.
**D35 — Limits are server configuration, checked by name.** Plans live in one table, with defaults in code and
overrides in env (`ORBIT_PLANS_JSON`), validated at boot, so prices and limits change without a release. Call
sites ask `plan.has("vision")`, never "is this the pro plan". The billing page renders `/v1/plans`, so the page
can't drift from what's enforced.

**D36 — Every session has a hard ceiling, even on Unlimited.** A session left running (a forgotten tab, a laptop
that never slept) would stream paid audio indefinitely. The ceiling counts time across reconnects, warns 5
minutes ahead, and ends through the normal end path, so nothing is lost.