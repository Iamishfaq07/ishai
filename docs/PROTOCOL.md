# Orbit Live Protocol — v1

Source of truth: `apps/api/orbit_api/live/events.py` (Pydantic). TypeScript mirror:
`packages/types/src/events.ts`. Change both together and bump `PROTOCOL_VERSION`.

## Connecting

1. `POST /v1/sessions/{id}/live-ticket` (authenticated) → `{ "ticket": "...", "expires_in": 60 }`
2. `WS /v1/sessions/{id}/live?ticket=...`

Tickets are single-use and short-lived, so a long-lived access token never goes in a URL.

**Close codes** (terminal: the client must not auto-reconnect): `1000` normal · `4001` invalid/expired ticket ·
`4003` live minutes used up (at connect, or mid-session after `usage.status { limit_reached: true }`) · `4004` session not found · `4009` session has ended · `4010` the session was opened in
another window/device (the newer connection wins) · `4029` another live session of this account is running (one at a time; normally refused earlier at the ticket, see below). Any other close means the client
should fetch a new ticket and reconnect with backoff.

**One live session per account.** A second live session is refused at `POST …/live-ticket` with `409
{"detail": {"code": "live_session_active", "session_id", "title", "message"}}` before any audio or AI spend. The
client closes for good, shows the message, and offers **End it and use this one**: `POST /v1/sessions/{other}/end`,
then reconnect. Ticket errors 401/402/403/404/409 are never retried, and the server's message is shown as-is
(for example "Verify your email…").

**Ending from elsewhere.** `POST /v1/sessions/{id}/end` also stops that session's live socket if one is open. The
engine sends `session.ended`, records usage, and the socket closes with `4009`.

**Reconnect semantics.** Only `session.end` (or `POST /v1/sessions/{id}/end`) ends a session and
queues its report. A dropped socket just detaches: usage is recorded and the session stays `live`.

**Ending is immediate; the report is a background job.** `session.ended` is sent as soon as live state is
persisted — it never waits for the report. The report is a durable DB job (survives restarts, retries a failed
AI narrative). `GET /v1/sessions[/{id}]` exposes `report_status`: `"pending"` while it runs, `"ready"`, or
`"failed"`; clients poll while pending.

**Live-minute metering (server-authoritative).** Each connection's live time is committed every
`ORBIT_LIVE_HEARTBEAT_S` (15 s) as one idempotent usage row, so a crash loses at most one interval and a retried
write never double-counts. Remaining minutes are computed across all of the user's sessions at every beat: under
5 minutes the server sends `usage.status { minutes_remaining, limit_reached: false }` once; at zero it sends
`usage.status { minutes_remaining: 0, limit_reached: true }`, ends the session (report included) and closes with
`4003`. Concurrent sessions can overshoot by at most about one heartbeat each.
Clients send `session.start` with the settings the user chose on every (re)connect: the initial ones plus every change
made in the session. A new connection's engine starts from the session's saved settings, and `session.started` goes
out before `session.start` is read, so clients keep their own choices over that echo. A new engine also starts
listening: a client whose user had paused sends `session.pause` again right after `session.start`.

**A reconnect continues the session** (`live/carryover.py`):
- **Conversation:** the new engine keeps the recent turns, rolling summary and questions asked, so follow-ups still
  have their thread.
- **Mock rounds:** they pick up at the same question and place ("2 of 3"), and the question is re-sent as
  `mock.question` with the same `question_id`. The round's clock keeps running, and a question that was being
  written when the connection dropped is asked by the new engine.
- **Where it's kept:** process memory only, for at most `ORBIT_ABANDONED_SESSION_MIN`, and dropped when the
  session ends. After a server restart, the saved rolling summary seeds the new engine.

## Envelope (both directions, JSON text frames)

```json
{ "v": 1, "type": "answer.chunk", "seq": 42, "ts": 1727100000000, "data": { } }
```

`seq` is per-connection, monotonically increasing, and set by the server (clients may omit it).

## Audio (client → server, binary frames)

`[1 byte channel][PCM16LE mono 16 kHz samples...]`, channel `0` = mic (candidate), `1` = system
(interviewer / others). Send ~20–100 ms per frame. Separate channels are preferred over diarization.
Desktop channel 1 is the chosen output device or one app's audio; web channel 1 is a shared tab.

## Client → server

| type | data |
|---|---|
| `session.start` | `{ settings?: Partial<LiveSettings> }` |
| `session.pause` / `session.resume` / `session.end` | `{}` |
| `answer.request` | `{ question_text?: string }` — manual answer; defaults to latest interviewer utterance |
| `mock.next` | `{}`. Mock interviews only: "I'm done", so the interviewer moves on without waiting for silence |
| `answer.pin` | `{ answer_id, pinned: boolean }` — a pinned answer is never auto-cancelled |
| `answer.clear` | `{}` |
| `chat.message` | `{ text }` — shares live context ("make this shorter", "give an example") |
| `settings.update` | `Partial<LiveSettings>` |
| `speaker.correct` | `{ turn_id, speaker }` |
| `dev.simulate` | `{ fixture, speed?: number (0.5–50) }` — replays a transcript fixture; only when the mock STT provider is active |

`LiveSettings = { auto_answer: boolean, length: "short"|"standard"|"detailed", style: "natural"|"concise"|"story", answer_language?: string, response_timing?: "quick"|"balanced"|"patient", thinking?: "off"|"low"|"high"|"max", coding_language?: "python"|"java"|"javascript"|"typescript"|"cpp"|"csharp"|"go"|"rust"|"sql" }`

Answers are spoken first-person prose (`direct_answer`, paragraphs separated by a blank line); `talking_points` is only filled if a model lists anyway. Legacy styles (`bullets`, `star`, `technical`, `executive`) are still accepted and mapped onto the new ones. `thinking` sets the model's reasoning effort (off answers in under a second; low/high/max add ~3–6 s before the first word).

`coding_language` fixes the language of code in coding answers (unset: the model picks, usually Python).

`response_timing` is how long a detected question is held after the interviewer stops before it auto-fires (quick ≈ 0, balanced ≈ 1.5 s default, patient ≈ 3 s). Until the candidate actually starts answering (3+ words), anything the interviewer says within 8 s of their last pause continues the same question — even after it fired: the combined question is re-sent as `question.updated` and the answer regenerated. `answer.request` without `question_text` answers that whole (stitched) question.

## Server → client

| type | data |
|---|---|
| `session.started` / `paused` / `resumed` / `ended` | `{ state, settings }` |
| `state.changed` | `{ state: LiveState }` |
| `audio.mic_status` / `audio.system_status` | `{ state: "idle"\|"connected"\|"reconnecting"\|"error", detail? }` — sent when a channel's first audio arrives |
| `transcript.partial` | `{ turn_id, speaker, text }` — replaces the previous partial for `turn_id` |
| `transcript.final` | `{ turn_id, speaker, text, start_ms, end_ms }` |
| `question.detected` | `{ question_id, turn_id, text, type, confidence, is_follow_up }` |
| `question.updated` | `{ question_id, text }` |
| `answer.started` | `{ answer_id, question_id, length, reasoning: "light"\|"deep", source: "auto"\|"manual"\|"chat"\|"screenshot" }` |
| `answer.chunk` | `{ answer_id, partial: LiveAnswer }` — full parsed state so far (idempotent; render directly) |
| `answer.completed` | `{ answer_id, answer: LiveAnswer, latency: { first_token_ms, total_ms } }` |
| `answer.cancelled` | `{ answer_id, reason: "superseded"\|"cleared"\|"session_ended" }` |
| `answer.failed` | `{ answer_id, error: { code, message, retryable } }` |
| `provider.status` | `{ provider: "stt"\|"llm", name, state: "connecting"\|"ok"\|"reconnecting"\|"down"\|"mock", detail? }` — STT starts `connecting` and reports `ok` only once **both** channel sockets are really open (audio is buffered meanwhile); it reports `down` if a handshake is rejected |
| `usage.status` | `{ minutes_remaining, limit_reached, reason: "monthly"\|"session" }` — 5-minute warning, or a limit ended the session: this month's allowance (live or mock minutes) or this session's maximum length (see BILLING.md) |
| `mock.question` | `{ question_id, text, is_follow_up, index, total, drill_kind? }`: the AI interviewer asks (clients may speak it aloud). `drill_kind` (re-drill sessions only) is `retry` \| `follow_up` \| `concise` |
| `mock.completed` | `{ questions, topics, follow_ups, answered, unanswered, average_answer_words, drill }`: the mock interview is over (question budget, drill plan or duration reached); the counts drive the end-of-round summary |
| `error` | `{ code, message }` |

**Screenshots** (`POST /v1/sessions/{id}/screenshots`, multipart `image`, PNG/JPEG ≤ 8 MB, needs a live socket)
are answered like a question (`source: "screenshot"`) and then discarded — never stored. A screenshot credit is
spent only when the answer completes; failed or cancelled analyses are free.

`answer.chunk` carries the whole parsed answer rather than a text delta, so the UI never
re-parses partial markup and renders are stable (no flicker, no scroll jumps).

## LiveState

`idle → listening → speech_detected → question_detected → generating → streaming → answer_complete`,
plus `follow_up_detected`, `stt_reconnecting`, `ai_reconnecting`, `error`, `paused`, `ended`.

## LiveAnswer

```json
{
  "question": "", "type": "technical", "direct_answer": "",
  "talking_points": [], "example": null,
  "code": { "language": "python", "content": "" },
  "time_complexity": null, "space_complexity": null,
  "follow_up": null, "context_used": [],
  "grounding": "verified", "key_points": [],
  "problem": null, "edge_cases": [], "tests": []
}
```

- `grounding` (brief §19: VERIFIED / INFERRED / UNSUPPORTED / GENERAL):
  - `"verified"`: the claims are stated in your documents;
  - `"inferred"`: built on a cited fact but adding details it doesn't state; the UI says to check them;
  - `"example"`: unsupported, meaning the event isn't in your documents; the UI shows *Suggested details*;
  - `"general"`: no personal claims;
  - `null`.

  The server downgrades `"verified"` that cites no verified fact (to `"inferred"` if it cites a JD or note fact,
  otherwise to `"example"`), and `"inferred"` that cites nothing becomes `"example"`.
- `sources`: `[{ref, chunk_id, doc_kind, document, label, excerpt, verified}]`, the document facts the answer's
  claims rely on. The prompt numbers the facts F1…Fn and the model names the ones it used in a trailing
  `SOURCES:` line. Unknown refs are ignored, never trusted.
- `key_points`: 3–6 short labels for the points the answer makes, in order. The client ticks them off as the
  candidate says them ("NEXT" guidance, local and deterministic, D25).
- `problem`, `edge_cases`, `tests`: coding answers only. The task restated in one line, edge cases to mention, and
  example tests (`input → expected`).

- `design` (system design mode): `[{title, text}]`, sections in this order: Requirements, Assumptions, Scale, APIs,
  Data model, Architecture, Storage, Caching, Queues, Reliability, Security, Trade-offs. `direct_answer` is the
  spoken talk track.
- `debug` (debug mode: a bug, error or failing test): `{root_cause, fix, why, diff}`, where `diff` is a unified
  diff. The corrected code is in `code`, and `direct_answer` is how to explain it aloud.
- Modes are chosen server-side:
  - `design` for system-design questions on plans with `system_design`;
  - `debug` for coding questions, or technical questions with code context, that carry bug cues (error,
    traceback, failing, wrong output…), on plans with `advanced_coding`;
  - screenshots, in any session, let the model decide from the image: a coding problem gets a coding answer (talk
    track plus `code`), an error the debug format (on plans with `advanced_coding`; otherwise the fix in `code`),
    anything else a plain answer.

`code` may be `null`. Any answer can carry `code`, not only coding ones: a technical answer whose question turned out
to need code, or a snippet that makes a point. In a coding or assessment session technical questions are answered as
coding ones (`type: "coding"`), and so is a follow-up to an answer that had code. `context_used` lists source labels (e.g. `"resume: Acme Corp — AppSec lead"`),
never raw document text.

## Re-drill
`POST /v1/sessions/{id}/drill` → `201` with a new `mock` session (same role, documents and interviewer settings).
It asks the reviewed session's weak questions again: those scored ≤ 3 or unanswered, weakest first, up to 3. The
first two each get one live follow-up, generated from the new answer and steered by the old feedback. Then comes one
"short version" drill. Errors are `409 no_review` (generate the review first) and `409 nothing_to_drill` (every
question scored 4+). Plan limits and the mock feature gate apply as for `POST /v1/sessions`.
