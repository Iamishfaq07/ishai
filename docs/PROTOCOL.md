# Orbit Live Protocol — v1

Source of truth: `apps/api/orbit_api/live/events.py` (Pydantic). TypeScript mirror:
`packages/types/src/events.ts`. Change both together and bump `PROTOCOL_VERSION`.

## Connecting

1. `POST /v1/sessions/{id}/live-ticket` (authenticated) → `{ "ticket": "...", "expires_in": 60 }`
2. `WS /v1/sessions/{id}/live?ticket=...`

Tickets are single-use and short-lived, so a long-lived access token never goes in a URL.

**Close codes** (terminal: the client must not auto-reconnect): `1000` normal · `4001` invalid/expired ticket ·
`4003` live minutes used up (at connect, or mid-session after `usage.status { limit_reached: true }`) · `4004` session not found · `4009` session has ended · `4010` the session was opened in
another window/device (the newer connection wins) · `4029` too many live sessions for this user (max 2). Any other close means the client
should fetch a new ticket and reconnect with backoff.

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
Clients send `session.start` with their current settings on every (re)connect. In-memory conversation
context (recent turns, rolling summary) does not yet survive a reconnect.

## Envelope (both directions, JSON text frames)

```json
{ "v": 1, "type": "answer.chunk", "seq": 42, "ts": 1727100000000, "data": { } }
```

`seq` is per-connection, monotonically increasing, and set by the server (clients may omit it).

## Audio (client → server, binary frames)

`[1 byte channel][PCM16LE mono 16 kHz samples...]`, channel `0` = mic (candidate), `1` = system
(interviewer / others). Send ~20–100 ms per frame. Separate channels are preferred over diarization.

## Client → server

| type | data |
|---|---|
| `session.start` | `{ settings?: Partial<LiveSettings> }` |
| `session.pause` / `session.resume` / `session.end` | `{}` |
| `answer.request` | `{ question_text?: string }` — manual answer; defaults to latest interviewer utterance |
| `answer.pin` | `{ answer_id, pinned: boolean }` — a pinned answer is never auto-cancelled |
| `answer.clear` | `{}` |
| `chat.message` | `{ text }` — shares live context ("make this shorter", "give an example") |
| `settings.update` | `Partial<LiveSettings>` |
| `speaker.correct` | `{ turn_id, speaker }` |
| `dev.simulate` | `{ fixture, speed?: number (0.5–50) }` — replays a transcript fixture; only when the mock STT provider is active |

`LiveSettings = { auto_answer: boolean, length: "short"|"standard"|"detailed", style: "natural"|"concise"|"story", answer_language?: string, response_timing?: "quick"|"balanced"|"patient", thinking?: "off"|"low"|"high"|"max" }`

Answers are spoken first-person prose (`direct_answer`, paragraphs separated by a blank line); `talking_points` is only filled if a model lists anyway. Legacy styles (`bullets`, `star`, `technical`, `executive`) are still accepted and mapped onto the new ones. `thinking` sets the model's reasoning effort (off answers in under a second; low/high/max add ~3–6 s before the first word).

`response_timing` is how long a detected question is held after the interviewer stops before it auto-fires (quick ≈ 0, balanced ≈ 1.5 s default, patient ≈ 3 s). Until the candidate actually starts answering (3+ words), anything the interviewer says within 8 s of their last pause continues the same question — even after it fired: the combined question is re-sent as `question.updated` and the answer regenerated. `answer.request` without `question_text` answers that whole (stitched) question.

## Server → client

| type | data |
|---|---|
| `session.started` / `paused` / `resumed` / `ended` | `{ state, settings }` |
| `state.changed` | `{ state: LiveState }` |
| `audio.mic_status` / `audio.system_status` | `{ state: "idle"\|"connected"\|"reconnecting"\|"error", detail? }` |
| `transcript.partial` | `{ turn_id, speaker, text }` — replaces the previous partial for `turn_id` |
| `transcript.final` | `{ turn_id, speaker, text, start_ms, end_ms }` |
| `question.detected` | `{ question_id, turn_id, text, type, confidence, is_follow_up }` |
| `question.updated` | `{ question_id, text }` |
| `answer.started` | `{ answer_id, question_id, length, reasoning: "light"\|"deep", source: "auto"\|"manual"\|"chat"\|"screenshot" }` |
| `answer.chunk` | `{ answer_id, partial: LiveAnswer }` — full parsed state so far (idempotent; render directly) |
| `answer.completed` | `{ answer_id, answer: LiveAnswer, latency: { first_token_ms, total_ms } }` |
| `answer.cancelled` | `{ answer_id, reason: "superseded"\|"cleared"\|"session_ended" }` |
| `answer.failed` | `{ answer_id, error: { code, message, retryable } }` |
| `provider.status` | `{ provider: "stt"\|"llm", name, state: "ok"\|"reconnecting"\|"down"\|"mock", detail? }` |
| `usage.status` | `{ minutes_remaining, limit_reached }` — low-minutes warning, or the limit ended the session |
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
  "follow_up": null, "context_used": []
}
```

`code` may be `null`. `context_used` lists source labels (e.g. `"resume: Acme Corp — AppSec lead"`),
never raw document text.
