# Orbit AI — Architecture

Built from scratch in this repo, starting 2026-09-23 (it held only a generated README). This page is kept current;
[CHANGELOG.md](CHANGELOG.md) has the history and [DECISIONS.md](DECISIONS.md) the reasoning.

## A. What exists
| Area | Status |
|---|---|
| Monorepo, env config, docker-compose (Postgres + pgvector), CI (lint, types, tests, cargo fmt + clippy, gitleaks), Dependabot | ✅ |
| Auth: argon2 + JWT (httpOnly cookie for web, Bearer + OS keyring for desktop), email verification, password reset, sign-out-everywhere, allowlist, account deletion | ✅ tested |
| Documents (resume / JD / notes: upload, parse, chunk, embed) and **workspaces** (saved setups per job: role, documents, settings) | ✅ tested |
| Live engine: per-channel STT → turns → question detector (+ AI classifier for the ambiguous band) → finalizer → dedup → retrieval → streamed answer | ✅ tested + real providers |
| DeepSeek provider: SSE streaming, cache-hit usage, error mapping, thinking levels, **vision** (DeepSeek-V4.1-Flash) | ✅ tested + real API |
| Deepgram nova-3 streaming STT: reconnect with timestamp continuity, keepalive, backlog, keyterms, `language=multi` for auto | ✅ tested + real API |
| Answers: spoken first-person prose, **sized to each question** (auto length: a sentence or two for "Have you used Docker?", two minutes for a design) and pitched at the candidate's level, **key points** (ticked off as the candidate covers them, or by hand), the jargon used with its plain meaning, **Read aloud** (local voices; audio isn't sent while it plays), grounding label (*Suggested details*), coding sections (problem / code / complexity / edge cases / tests) in a chosen language | ✅ tested |
| Screenshot → vision answer (analysed and discarded; credit spent only on success) | ✅ tested + real desktop build |
| **Mock interviewer**: persona / type / difficulty / duration, follow-ups, spoken questions (browser TTS), review | ✅ tested + real voice path |
| **Interview prep**: likely questions from a job description, with why / talking points / suggested answer from the resume, practised as a mock drill | ✅ tested |
| **Phone companion**: scan a QR code to follow the live question and answer on a phone (read-only, no sign-in, nothing captured) | ✅ tested |
| **Story bank**: STAR stories written once (or drafted from the resume or notes), used by live answers to behavioral questions as verified facts | ✅ tested |
| **Answer ratings**: 👍/👎 with a reason on live answers; repeated reasons become style hints in later sessions; admin satisfaction report | ✅ tested |
| **Job posting from a link** (Prep): SSRF-safe fetch, schema.org JobPosting or main-content extraction, save as a document | ✅ tested |
| **Salary negotiation practice**: AI recruiter presents your offer and negotiates back (flexible/realistic/tough); review graded on negotiation skill | ✅ tested |
| **Preflight** (`GET /v1/preflight` + local device checks) before a session starts | ✅ |
| Session memory, follow-up stitching, chat mode, manual answer, pin / clear, cancellation, answer history | ✅ tested |
| Session report (background DB job), review scores, transcript, Markdown export, privacy toggles | ✅ tested |
| Entitlements (free / pro / unlimited), live-minute heartbeat metering + mid-session enforcement, config-driven LLM cost (cache hit/miss, peak/off-peak) | ✅ tested; plans can't be bought yet (no billing, D17) |
| Durable persistence: recorder retries → `failed_writes` dead letters → spool → memory; replayed on boot, every minute, before each report and at shutdown | ✅ tested |
| Observability: JSON logs with request / user / session ids and redaction, latency metrics per session (`GET /v1/admin/latency`), optional Sentry | ✅ (Sentry off until `ORBIT_SENTRY_DSN` is set, D18) |
| Windows desktop (Tauri 2): native WASAPI mic + loopback + per-app capture, device follow / reopen, region screenshots, tray, global shortcuts, signed auto-update, per-user NSIS installer | ✅ driven end-to-end on real hardware |
| Web app on the same shared live UI (`packages/ui`) | ✅ |
| Accessibility: axe WCAG 2.1 AA clean on every desktop screen, light + dark; rem-based text sizes; one icon set (lucide) | ✅ |

## B. Not built (by choice, for now)
- **Billing** (Stripe). Plans exist, but nothing can be purchased yet (D17).
- **Multi-instance live state** (Redis). Production runs one instance by design (D12).
- **Tracing** (OpenTelemetry).
- **Code signing** (SmartScreen); see WINDOWS_RELEASE.md.
- **macOS and Linux desktop builds**, deferred because Orbit is Windows-first.

## C. Architecture
```
Desktop (Tauri: Rust WASAPI capture + React)     Web (React)
   mic ─┐  interviewer (output or one app) ─┐        │
        └─ PCM16 16 kHz frames [chan byte] ─────────┤  WS /v1/sessions/{id}/live  (JSON events + binary audio)
                                                    ▼
                         FastAPI ── LiveEngine (per connection)
                           │   ├─ STTProvider (Deepgram | Mock), one stream per channel
                           │   ├─ detect() → classify() (ambiguous band) → QuestionFinalizer → Deduplicator
                           │   ├─ MockInterviewer (session_type "mock": the AI asks the questions)
                           │   ├─ SessionIndex (selected docs) + SessionMemory
                           │   ├─ build_prompt() → LLMProvider (DeepSeek | Mock) stream → AnswerStreamParser
                           │   ├─ LatencySamples (AudioClock-based) → sessions.metrics
                           │   └─ DbRecorder (async queue → retries → dead letters)
                           ├─ jobs.worker (reports), usage heartbeat, preflight, admin
                           └─ Postgres + pgvector
```
All provider keys live only in the API process. Clients stream audio to the API, and the API relays it to Deepgram.

## D. Data model
`users, app_config, email_tokens, subscriptions, documents, document_chunks (embedding: pgvector on Postgres, JSON on
SQLite), workspaces, workspace_documents, sessions, session_documents, session_turns, questions, answers,
session_summaries, usage, failed_writes, jobs, provider_requests, audit_logs`. See `apps/api/orbit_api/models.py`.
User-owned rows hang off `users.id` with `ON DELETE CASCADE`, so deleting an account deletes all of that user's data.

## E. Live session state machine
```
idle → listening → speech_detected → question_detected|follow_up_detected → generating → streaming
     → answer_complete → (speech) speech_detected …
any → paused → listening        STT drop → stt_reconnecting → listening
LLM retryable error → ai_reconnecting → (retry once) → streaming | error → listening
session.end → ended
```
New speech during streaming doesn't change the state, so the UI doesn't flicker. When a new question arrives, any
unpinned in-flight answer is cancelled (`answer.cancelled{reason:"superseded"}`).

## F. Audio / STT pipeline
Separate channels (mic → candidate, system → interviewer) instead of diarization.
- **Capture:** on Windows, the "interviewer" channel is the default output device, the communications device, a
  specific output device, or one app's audio (process loopback). Capture is supervised: when a device is unplugged or
  the default changes, it reopens and follows, and fills silence so timestamps stay continuous.
- **Deepgram** runs with `interim_results`, `endpointing=300`, `utterance_end_ms=1000` and `vad_events`, with
  resume/JD skills sent as `keyterm`s.
- **Partials** are accumulated per turn, and the UI replaces them by `turn_id`.
- **The finalizer**, with Deepgram, fires on Deepgram's endpoint for a complete question. If that endpoint event is
  lost (noisy audio, a dropped message), it falls back after 2.5 s of silence.
- **Without provider endpoints** (mock STT), it fires on the first of:
  - `?` plus 250 ms of silence;
  - a complete question plus 650 ms;
  - 1.3 s of silence.
- **Response timing:** before firing, it holds a detected question for a grace period after the interviewer stops
  (quick 0, balanced 1.5 s, patient 3 s).
- **Follow-on speech:** until the candidate starts answering, anything the interviewer adds within 8 s extends the
  same question and regenerates the answer.

## G. Answer pipeline
1. Detect.
2. Classify: a heuristic first, and an AI classifier (2.5 s budget) only for the ambiguous 0.35–0.6 band.
3. Choose the thinking level, and with the auto length the answer's size (`routing.pick_size`: the question's type
   and wording, its parts, "briefly" / "in detail"; no model call).
4. Retrieve the top facts. Question type boosts the relevant ones, verified facts rank higher, and the JD is
   guaranteed a slot.
5. Build a compact prompt: at most ~1.2k tokens of context, the last 6 turns, a rolling summary, and fenced
   `<reference_data>`. It carries the candidate's level (inferred once from the resume and role, `live/background.py`,
   unless the user set one) and the technologies the question asks about that the verified facts never show, so
   the answer doesn't fake hands-on expertise there.
6. Stream the answer through an incremental line-format parser. The model writes tagged sections: `GROUNDED:`
   first, then `PROBLEM` / `ANSWER` / `CODE` / `TIME` / `SPACE` / `EDGE` / `TESTS` / `TERMS` / `FOLLOWUP`, and a trailing
   `POINTS:` line so the first spoken word isn't delayed. The parser sends `answer.chunk` snapshots every ≥40 ms and
   finishes with `answer.completed`, which carries the latency.

## H. Phases (upgrade brief, 2026-09)
| Phase | Scope | Status |
|---|---|---|
| 1 Critical fixes | metering, durable writes, report jobs, admin config, pricing, server-URL safety | ✅ #53 |
| 2 Platform | real-provider smoke suite, Deepgram fixes, latency metrics, structured logs, Sentry, clippy | ✅ #54 |
| 3 Windows audio | WASAPI endpoints, device follow / reopen, per-app capture | ✅ #55 |
| 4 AI quality | detector overhaul, ambiguous-band classifier, grounding labels | ✅ #56 |
| 5 UX features | preflight + workspaces, key points, coding answers, mock interviewer | ✅ #57–#60 |
| 6 Polish | text scale + in-app dialogs, accessibility, icon library, installer lifecycle, docs | ✅ #62–#66 |
