# Orbit Live Protocol — v1

Source of truth: `apps/api/orbit_api/live/events.py` (Pydantic). TypeScript mirror:
`packages/types/src/events.ts`. Change both together and bump `PROTOCOL_VERSION`.

## Connecting

1. `POST /v1/sessions/{id}/live-ticket` (authenticated) → `{ "ticket": "...", "expires_in": 60 }`
2. `WS /v1/sessions/{id}/live?ticket=...`

Tickets are single-use and short-lived, so a long-lived access token never goes in a URL.

**Close codes** (terminal: the client must not auto-reconnect): `1000` normal · `4001` invalid/expired ticket ·
`4003` forbidden · `4004` session not found · `4009` session has ended · `4010` the session was opened in
another window/device (the newer connection wins) · `4029` too many live sessions for this user (max 2). Any other close means the client
should fetch a new ticket and reconnect with backoff.

**Reconnect semantics.** Only `session.end` (or `POST /v1/sessions/{id}/end`) ends a session and
generates its report. A dropped socket just detaches: usage is recorded and the session stays `live`.
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

`LiveSettings = { auto_answer: boolean, length: "short"|"standard"|"detailed", style: "bullets"|"star"|"technical"|"executive", answer_language?: string, response_timing?: "quick"|"balanced"|"patient" }`

`response_timing` is how long a detected question is held after the interviewer stops before it auto-fires (quick ≈ 0, balanced ≈ 0.8 s default, patient ≈ 1.6 s). If the interviewer keeps talking inside that window, the continuation is stitched onto the question; the candidate speaking ends the wait immediately. `answer.request` without `question_text` answers that held/stitched question if there is one.

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
| `answer.started` | `{ answer_id, question_id, length, reasoning: "light"\|"deep", source: "auto"\|"manual"\|"chat" }` |
| `answer.chunk` | `{ answer_id, partial: LiveAnswer }` — full parsed state so far (idempotent; render directly) |
| `answer.completed` | `{ answer_id, answer: LiveAnswer, latency: { first_token_ms, total_ms } }` |
| `answer.cancelled` | `{ answer_id, reason: "superseded"\|"cleared"\|"session_ended" }` |
| `answer.failed` | `{ answer_id, error: { code, message, retryable } }` |
| `provider.status` | `{ provider: "stt"\|"llm", name, state: "ok"\|"reconnecting"\|"down"\|"mock", detail? }` |
| `error` | `{ code, message }` |

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
