# Orbit AI — Architecture

## A. Repository audit (2026-09-23)
`Iamishfaq07/ishai` contained only an auto-generated `README.md` (one commit). No existing architecture
to preserve — Orbit was built from scratch here.

## B. What exists now
| Area | Status |
|---|---|
| Monorepo layout, env config, docker-compose (Postgres+pgvector, Redis), CI, Dependabot, gitleaks | ✅ |
| FastAPI backend: auth (argon2 + JWT cookie/Bearer), documents, sessions, usage, health | ✅ tested |
| Live engine: STT → turns → question detection → finalization → dedup → retrieval → streamed answer | ✅ tested |
| DeepSeek provider (SSE streaming, usage, error mapping, reasoner routing) | ✅ tested against a mock HTTP transport — **not yet run against the real API** |
| Deepgram streaming STT (reconnect, keepalive, backlog, keyterms) | ✅ parsing tested — **not yet run against the real API** |
| Mock LLM / STT / fixture replay (keyless dev + E2E) | ✅ |
| Session memory, follow-ups, chat mode, manual answer, pin/clear, cancellation | ✅ tested |
| Session report, transcript, Markdown export, privacy toggles, account deletion | ✅ tested |
| Entitlements (free/pro/unlimited), usage metering, provider cost records | ✅ basic |
| Alembic migrations (incl. `vector` extension + HNSW index) | ✅ |
| Web app, shared live UI, Tauri desktop shell | 🚧 see `apps/web`, `apps/desktop`, `packages/ui` |

## C. Missing core features (next)
Vision provider for screenshots (DeepSeek chat API takes no images — needs a real vision provider),
macOS system audio via ScreenCaptureKit, email verification / password reset, Stripe billing,
OpenTelemetry/Sentry, Redis-backed rate limits and WS tickets for multi-instance deploys,
LLM fallback classifier for the ambiguous question band, mock-interview question generation, TTS.

## D. Architecture
```
Desktop (Tauri: Rust capture + React)   Web (React)
   mic ─┐  system ─┐                        │
        └─ PCM16 16k frames [chan byte] ────┤  WS /v1/sessions/{id}/live  (JSON events + binary audio)
                                            ▼
                         FastAPI ── LiveEngine (per connection)
                           │   ├─ STTProvider (Deepgram | Mock) — one stream per channel
                           │   ├─ QuestionFinalizer + detector + Deduplicator
                           │   ├─ SessionIndex (selected docs, in-memory) + SessionMemory
                           │   ├─ ContextBuilder → LLMProvider (DeepSeek | Mock) stream
                           │   └─ DbRecorder (async queue → Postgres)
                           └─ Postgres + pgvector, Redis (planned: limits/tickets)
```
All provider keys live only in the API process. The desktop app streams audio to the API, and the API relays it to Deepgram.

## E. Data model
`users, subscriptions, documents, document_chunks(embedding vector(384)), sessions, session_documents,
session_turns, questions, answers, session_summaries, usage, provider_requests, audit_logs` —
see `apps/api/orbit_api/models.py`. Every row hangs off `users.id` with `ON DELETE CASCADE`, so deleting an account deletes all of that user's data.

## F. Live session state machine
```
idle → listening → speech_detected → question_detected|follow_up_detected → generating → streaming
     → answer_complete → (speech) speech_detected …
any → paused → listening        STT drop → stt_reconnecting → listening
LLM retryable error → ai_reconnecting → (retry once) → streaming | error → listening
session.end → ended
```
New speech during streaming doesn't change the state, so the UI doesn't flicker. When a new question arrives, any unpinned in-flight answer is cancelled
(`answer.cancelled{reason:"superseded"}`).

## G. Audio / STT pipeline
Separate channels (mic → candidate, system → interviewer) instead of diarization. Deepgram runs with
`interim_results`, `endpointing=300`, `utterance_end_ms=1000`, `vad_events`, and resume/JD skills as `keyterm`s.
Partials are accumulated per turn and the UI replaces partials by `turn_id`. The finalizer fires on the first of:
STT endpoint on a complete question · `?` + 250 ms silence · complete question + 650 ms · 1.3 s max silence.

## H. DeepSeek pipeline
detect → classify (heuristic) → `choose_reasoning_level` (reasoner only for complex coding/system design)
→ retrieve top facts (question type boosts, verified facts, JD guaranteed slot) → compact prompt (≤ ~1.2k
tokens of context, last 6 turns, rolling summary, fenced `<reference_data>`) → stream → incremental
line-format parser → `answer.chunk` snapshots every ≥40 ms → `answer.completed` with latency.

## I. Phases
| Phase | Scope | Status |
|---|---|---|
| 0 Foundation | monorepo, API, compose, CI, env | ✅ API · 🚧 web/desktop need Node/Rust to verify |
| 1 Auth + Documents | auth, upload, parsing, chunking | ✅ (verification/reset pending) |
| 2 AI backend | DeepSeek, streaming, context builder, retrieval, mock | ✅ |
| 3 Session engine | protocol, transcript/question/answer models, history | ✅ |
| 4 Audio + STT | Deepgram server side ✅ · native capture 🚧 |
| 5 Auto answer | detection, finalization, dedup, auto trigger | ✅ |
| 6 Floating live UI | 🚧 |
| 7 Screenshot/vision | ⏳ needs vision provider |
| 8 Coding copilot | prompts/format/routing ✅ · screenshot input ⏳ |
| 9 Memory + follow-ups | ✅ |
| 10 Mock + reports | reports ✅ · mock interviewer ⏳ |
| 11 Billing + prod | entitlements/usage ✅ · Stripe, telemetry ⏳ |
