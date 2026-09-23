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
The tickets are held in process memory for now; they move to Redis before running more than one instance.

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
