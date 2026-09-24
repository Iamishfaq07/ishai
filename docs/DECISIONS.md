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
