# Orbit Live Protocol — v1

Personal Orbit's hosted application worker uses a separate private protocol documented in
[HOSTED_APPLY.md](HOSTED_APPLY.md#private-worker-protocol). It shares Orbit Apply's candidate approvals and receipts;
it does not change the live interview event protocol below.

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
then reconnect. The ticket's other 409s carry their own codes too: `session_ended` (the session has ended and can't
be reopened) and `session_time_limit` (it ran its maximum length). Ticket errors 401/402/403/404/409 are never
retried, and the server's message is shown as-is (for example "Verify your email…").

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
write never double-counts. The row is charged to the balance of the account's plan (the credits, or a plan's own
allowance); if the plan changes mid-session (a grant starts or runs out), the rest of the connection goes to a new row
on the new balance. Remaining minutes are computed across all of the user's sessions at every beat: under
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
- **Where it's kept:** in process memory, for at most `ORBIT_ABANDONED_SESSION_MIN`, and on the session row
  (`sessions.carryover`, written every heartbeat and when the connection drops), so a server restart (every deploy)
  continues the session too. Both are dropped when the session ends. Without transcript storage, the copy on the row
  leaves out what was said word for word (recent turns, mock answers).

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
| `answer.request` | `{ question_text?: string, size?: AnswerSize, simpler?: boolean }` — manual answer; defaults to latest interviewer utterance. `size` / `simpler`: this answer only (the card's Shorter / Longer / Simpler on an auto-length session), the session's settings unchanged; servers before them ignore both |
| `mock.next` | `{}`. Mock interviews only: "I'm done", so the interviewer moves on without waiting for silence |
| `answer.pin` | `{ answer_id, pinned: boolean }` — a pinned answer is never auto-cancelled |
| `answer.clear` | `{}` |
| `chat.message` | `{ text }` — shares live context ("make this shorter", "give an example") |
| `settings.update` | `Partial<LiveSettings>` |
| `speaker.correct` | `{ turn_id, speaker }` |
| `dev.simulate` | `{ fixture, speed?: number (0.5–50) }` — replays a transcript fixture; only when the mock STT provider is active |

`LiveSettings = { auto_answer: boolean, length: "auto"|"short"|"standard"|"detailed", style: "natural"|"concise"|"story", answer_language?: string, response_timing?: "quick"|"balanced"|"patient", thinking?: "off"|"low"|"high"|"max", coding_language?: "python"|"java"|"javascript"|"typescript"|"cpp"|"csharp"|"go"|"rust"|"sql", experience?: "auto"|"fresher"|"junior"|"mid"|"senior" }`

`length: "auto"` (the default for new sessions; `POST /v1/sessions` without a length gets it) sizes each answer to
its question, with no model call (`routing.pick_size`): `AnswerSize = "brief"` (1–3 sentences, ~20–50 words: yes/no,
"Have you used X?", a notice period) | `"short"` (~50–80: "What is X?") | `"medium"` (~90–130: an intro, why us,
strengths, "how does X work") | `"long"` (~150–200: a story, an approach) | `"detailed"` (~250–350: system design,
deep or multi-part technical). "Briefly" / "in detail" in the question move it, and so do extra parts. The fixed
lengths work as before; clients from before "auto" (desktop 0.1.37 and older) send only those.

`experience` pitches answers at the candidate's level; `"auto"` (or unset) infers it from the session's resume (years
stated, dated roles, titles, "final-year student") and, when that says nothing, the target role.

Answers are spoken first-person prose (`direct_answer`, paragraphs separated by a blank line); `talking_points` is only filled if a model lists anyway. Legacy styles (`bullets`, `star`, `technical`, `executive`) are still accepted and mapped onto the new ones. `thinking` sets the model's reasoning effort (off answers in under a second; low/high/max add ~3–6 s before the first word).

`coding_language` fixes the language of code in coding answers (unset: the model picks, usually Python).

**Session languages** (DECISIONS D62) are set when the session is created, not live: `POST /v1/sessions` (and saved
setups) take `language`, the interview language (`"en"` by default, `"auto"`, `"hi"`, `"hinglish"`, `"es"`, `"fr"`,
`"de"`, `"pt"`, `"it"`, `"nl"`, `"ja"`, `"ru"`: what `GET /v1/auth/me` lists as `live_languages`), and
`answer_language`, what answers, key points and the review are written in (`null`: the same as the interview; on
`"auto"`, each question's own). A language the server doesn't offer is stored as English, and so is anything while
`ORBIT_LIVE_LANGUAGES` is off; a mock interview takes its practice language instead and never an answer language.
`LiveSettings.answer_language` is still ignored. Transcripts, questions and answers then carry text in that language
and script; the protocol is unchanged. A report in another language has `language` (the answer language).

`response_timing` is how long a detected question is held after the interviewer stops before it auto-fires (quick ≈ 0, balanced ≈ 1.5 s default, patient ≈ 3 s). Until the candidate actually starts answering (3+ words), anything the interviewer says within 8 s of their last pause continues the same question — even after it fired: the combined question is re-sent as `question.updated` and the answer regenerated. `answer.request` without `question_text` answers that whole (stitched) question.

## Server → client

| type | data |
|---|---|
| `session.started` / `paused` / `resumed` / `ended` | `{ state, settings }` |
| `state.changed` | `{ state: LiveState }` |
| `audio.mic_status` / `audio.system_status` | `{ state: "idle"\|"connected"\|"reconnecting"\|"error", detail? }` — sent when a channel's first audio arrives |
| `transcript.partial` | `{ turn_id, speaker, text }` — replaces the previous partial for `turn_id` |
| `transcript.final` | `{ turn_id, speaker, text, start_ms, end_ms, echo? }` — `echo: true`: the interviewer's voice heard by the mic (speakers, no headphones), not the candidate; clients drop the line (it isn't stored or used as conversation) |
| `question.detected` | `{ question_id, turn_id, text, type, confidence, is_follow_up }` |
| `question.updated` | `{ question_id, text }` |
| `answer.started` | `{ answer_id, question_id, length, size?, reasoning: "light"\|"deep", source: "auto"\|"manual"\|"chat"\|"screenshot" }` — `length` is the fixed length the answer was written to (on auto, the one nearest its size, so older clients still get a value they know); `size` only on auto, for the card's "Quick answer" / "Long answer" hint |
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
  "problem": null, "edge_cases": [], "tests": [],
  "terms": [{ "term": "pod", "meaning": "one running copy of the app" }]
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
- `terms`: at most 3 technical words the spoken answer actually says, each with its plain meaning (the model's
  optional `TERMS:` line, `term = meaning | …`; entries the answer doesn't say are dropped). Shown dimmed under the
  answer so the candidate understands what they're saying; never read out. Absent or `[]` for plain answers.
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

## Desktop sign-in with Google (REST, D81)
Not part of the live socket, but the one place the desktop app and the API agree on a handshake. RFC 8252 (native
apps: loopback redirect) with PKCE (RFC 7636, S256), on top of the web's server-side Google flow.

1. The app makes a verifier (32 random bytes, base64url: 43 characters), its challenge
   `BASE64URL(SHA256(verifier))`, a state (24 random bytes, base64url), and listens on `127.0.0.1:<port>` (a port the
   OS picks), for five minutes at most.
2. It opens the system browser at
   `GET /v1/auth/google/start?desktop_port=<1024-65535>&desktop_challenge=<43 chars>&desktop_state=<16-128 chars>`.
   All three are carried in the signed `orbit_google` state cookie. If any is present but one is malformed (a port
   outside 1024-65535, a challenge that isn't 43 base64url characters), the browser goes to the web sign-in page with
   `?error=google`, never to a loopback.
3. After Google, the API sends the browser to `http://127.0.0.1:<port>/callback?code=<code>&state=<state>`, always
   127.0.0.1, never a host from the request. No web session cookie is set. The code lives 60 s, is single use, and is
   kept only as a SHA-256 hash. A refusal goes to the same place as `?error=<code>&state=<state>`:
   `denied` (Cancel on Google's page), `google_off`, `busy` (the sign-in rate limit), `suspended`, `unverified`,
   `private` (an allowlisted server), `server`, or `google` (anything else). The app checks `state` and answers the tab
   with a self-contained page.
4. `POST /v1/auth/desktop/exchange` `{"code": "...", "verifier": "..."}` (the verifier is RFC 7636's 43-128
   characters of `[A-Za-z0-9._~-]`). Rate-limited with the other sign-in routes. Answers exactly as
   `POST /v1/auth/login` does for the desktop:
   - `200 {"user": {...}, "access_token": "..."}`: a new device row ("Orbit for Windows" from the app's user agent);
   - `200 {"two_factor_required": true, "challenge": "..."}` when the account has two-step sign-in on, finished at
     `POST /v1/auth/login/2fa` `{"challenge", "code"}` as after a password;
   - `400` "That sign-in expired or was already used…" for an unknown, expired, reused code, or a verifier that
     doesn't match its challenge (which spends the code too), or when the account signed out everywhere since;
   - `403` for a suspended account or one no longer on a private server's allowlist; `429` when rate-limited.

## Orbit Apply: the executor contract (REST, D84)
The server plans each application. External forms run in the hosted worker or a connected browser; Orbit Direct
uses its server submission path. Hosted execution is documented in [HOSTED_APPLY.md](HOSTED_APPLY.md).
Selected shortlist planning, captured postings and the advisory AI second reader are documented in
[APPLICATION_AGENT_DISCOVERY.md](APPLICATION_AGENT_DISCOVERY.md#api-and-data).
Types: `packages/types/src/autoApply.ts`; the extension's copy is `apps/extension/src/lib/autoApply/contract.ts`.
All routes take a Bearer token. An extension-scoped token (`POST /v1/extension/connect`) reaches these three and
`POST /v1/apply/pause|resume`, and nothing else of Orbit Apply (auth/security.py `SCOPED_PATHS` and `SCOPED_PATTERNS`); a
full sign-in works too. A bearer-token call to `/next` or `/status` records `executor_seen_at` (at most once a minute),
which the web app shows so the candidate knows the extension is on.

1. `GET /v1/apply/next`
   - `204` when nothing is due. `Retry-After` (seconds) says when to ask again when Orbit knows, and
     `X-Orbit-Apply-Why` says why: `not_set_up`, `paused`, `quiet_hours`, `daily_limit`, `busy` (one is already
     leased to another device of the candidate's; `Retry-After` is when that lease ends), `pacing` (60 s between any two, a random 3-8 min between two on the same ATS board), `no_quota` or
     `none`.
   - `200`: the packet, now leased to this caller for 15 minutes. Asking again from the same device (its session id,
     `lease_holder`) while the lease runs returns the same packet, unchanged (same `lease_expires_at`, held once): a
     restarted executor picks it up again. Don't press submit after `lease_expires_at`: it may be leased elsewhere then.
     ```
     {id, job: {url, apply_url, ats: "greenhouse"|"lever"|"ashby", company, title},
      resume: {filename, download_url},          // a signed link, 15 minutes, no session needed: a PDF
      cover_letter: string|null,                 // ends "Prepared with Orbit AI from my verified profile." unless off
      fields: {first_name, last_name, full_name, email, phone, location, linkedin, website, github,
               current_company, current_title, country},  // "" when the candidate gave none
      answers: [{question_id: string|null, label, kind, value: string|string[], source: "bank"|"profile"|"generated",
                 required, options}],            // question_id: Greenhouse `question_…` (the page may show the
                                                 // digits only), `demographic_<id>` (the page: `<id>`), the EEO
                                                 // names (`gender`, `veteran_status`…); Lever `cards[…][fieldN]`;
                                                 // Ashby the field path. A select's value is the option's label
                                                 // (one of `options`); a boolean or checkbox is "Yes"/"No"
      eeo: "decline"|"as_answered", not_before, expires_at, lease_expires_at}
     ```
     Fill the form from `fields` and `answers`. Leave a question out of `answers` blank. A *required* question (on the
     page, or `required` in its answer) that's neither a standard field nor in `answers` (or whose answer doesn't fit) is
     an `unknown_question`: report it, never guess. With `eeo: "as_answered"` a voluntary self-identification question
     takes the candidate's answer from `answers`, and one without an answer is still declined. Don't submit before
     `not_before`.
2. `POST /v1/apply/{id}/result`
   ```
   {status: "submitted"|"needs_you"|"failed"|"skipped",
    reason: "captcha"|"login"|"email_verification"|"unknown_question"|"form_changed"|"blocked"|"error"|null,
    unknown_questions: [{label, kind?, options?}], confirmation_text: string|null, final_url: string|null,
    screenshot_png_b64: string|null,             // PNG, 1.5 MB at most once decoded
    submitted: {fields, answers}|null}           // what was actually put in the form
   ```
   - The answer is `200 {id, status, charged, tracker_id}`.
   - `unknown_questions[].kind` is one of the answer kinds above (`select` for a radio group, `multiselect` for a
     checkbox group); anything else is a `422`.
   - `submitted` is the only status that's charged. It keeps the proof (the payload, the confirmation text and final
     address, and the screenshot when there is one: the extension usually can't take one and sends null), moves the
     Jobs AI tracker entry to Applied ("Applied (Orbit Apply)", `applied_via: "orbit_apply"`), and keeps the tailored
     resume as the version sent.
   - Every other status gives the lease's hold back. `needs_you` tells the candidate (in the app, and by email at
     most every 6 hours) with "Finish in one click" (`/jobs/applications?packet=<id>`). With `unknown_question`, the
     questions come back to the candidate to answer once (saved to their answer bank), and "Try again" requeues it.
   - Errors: `409` when the packet isn't leased (a result for a lease that ran out is still taken within 2 hours: it
     may have been submitted), `404` for anyone else's packet, `413` for a screenshot over 1.5 MB or a payload over
     200k characters, and `422` for a screenshot that isn't a PNG or an unknown status.
   - Captchas, logins and email checks are never solved, and job-site passwords are never asked for: report
     `needs_you`.
3. `GET /v1/apply/status`: `{configured, paused, today, limit, next_due_at, why_not, ready, needs_you, quota_left,
   sites_paused}`, for the extension's popup. `today` counts submissions in the candidate's own day plus the one in
   hand.

The server enforces the rest: a daily limit of at most 25, two per company per 30 days, the spacing, quiet hours,
and the per-site kill switch (8+ of the last 20 results in a day, with 40% or more a captcha, a block or a failure,
pause that site for 6 hours; the admin can pause or lift it at `PUT /v1/admin/apply/sites/{site}`).

The web app's own routes (a full sign-in only): `GET/PUT /v1/apply/setup`, `GET/PUT /v1/apply/bank`,
`POST /v1/apply/plan`, `GET /v1/apply/packets?group=prepared|applied|needs_you|skipped`, `GET /v1/apply/packets/{id}`
(and its `/screenshot`, `/resume.pdf`), and `POST /v1/apply/packets/{id}/answers|approve|dont-apply|retry|done`,
`POST /v1/apply/pause|resume`.

Personal hosted agent mode: `GET /v1/apply/agent` returns `{enabled, used_today, daily_allowance, applications}`;
applications contain owned packet summaries and bounded profile-matching observations. `PUT /v1/apply/agent` accepts
only `{enabled: boolean}`; enabling requires a verified, authorised hosted setup. Both routes require a full sign-in,
not an extension token. The private worker's existing `/questions` endpoint uses this permission after exact answers
fail. AI may select an approved profile source for an eligible text field; it cannot author facts or browser actions.
See [PERSONAL_FORM_AGENT.md](PERSONAL_FORM_AGENT.md) for limits, worker integration and deployment requirements.

Personal job networking: `GET /v1/jobs/network/{application_id}` returns same-company saved contacts, own recorded
company history, manual search links and a snapshot version. `POST /research` at that path uses the version plus
optional public-page/reply text and a live-search choice; it returns source-grounded leads for review. `POST /capture`
saves an explicitly reviewed lead to the owned contact book; `POST /draft` prepares role-specific outreach for an
owned contact at the job's company. These full-session routes never send messages or mark an interaction completed.
See [CAREER_OPS_INTEGRATION.md](CAREER_OPS_INTEGRATION.md) for the API shapes and optional search-provider setup.

## Orbit for Business (REST, D82)
Not part of the live socket. TypeScript DTOs: `packages/types/src/business.ts`; source of truth
`apps/api/orbit_api/business/`. A company is its own tenant on the same Orbit login. Every company route takes the
company id in the path and answers **404** (never 403) to anyone who isn't a member, so a company's existence isn't
confirmed to outsiders; a member whose role can't do something gets **403** `{"detail": {"code": "biz_forbidden"}}`.
A suspended company answers every write (verification, logo, members and invites, plan requests, templates, jobs,
applicants, re-ranking) with **403** `biz_suspended`; reads still work. Plan limits answer **402**
`{"detail": {"code": "biz_limit", "limit": "jobs"|"seats", "plan": ...}}`.

**Roles.** owner (everything, plan, transfer) · admin (everything but plan and transfer) · recruiter (jobs, all
applicants, emails, templates) · hiring_manager (only jobs whose `hiring_team` includes them: applicants, moves,
notes, scorecards) · interviewer (only applications whose `interviewers` include them: read, notes, scorecards).

**Company workspace** (`/v1/business`, signed in):
- `GET /me` → BizMe. `POST /companies` → BizCompany (201; the caller is owner; at most 3 companies owned).
- `GET|PATCH /companies/{cid}`; `PUT /companies/{cid}/logo` (multipart `file`, PNG/JPEG ≤ 1 MB) · `DELETE …/logo`.
- `GET /companies/{cid}/verification` → BizVerification. `POST …/verification/account` (the member's own verified
  email is at the domain), `POST …/verification/email {email}` (sends a 6-digit code to a work address at the
  domain), `POST …/verification/email/confirm {code}`, `POST …/verification/dns` (looks up the TXT record
  `orbit-verify=<token>` on the domain or `_orbit-verify.<domain>`). A company's `domain` is the registrable domain
  of its website (Public Suffix List: `jobs.acme.co.in` → `acme.co.in`); a bare public suffix (`co.in`, `github.io`)
  is a 422. Free-mail, throwaway-mail and hosting domains can't verify. The account and email-code routes need an
  address at the domain itself (`a@acme.com`); a subdomain mailbox (`a@eng.acme.com`) verifies by DNS only.
  Unverified companies can draft jobs; publishing answers **403** `biz_unverified`.
- Members: `GET …/members` → BizMembers · `POST …/invites {email, role}` · `DELETE …/invites/{id}` ·
  `PATCH …/members/{mid} {role}` · `DELETE …/members/{mid}` · `POST …/transfer {member_id}` (owner) ·
  `POST …/leave`. Invites: `GET /v1/public/business/invites/{token}` → BizInviteLookup;
  `POST /invites/accept {token}` (signed in as the invited address, verified).
- Plan: `GET …/plan` → BizPlanStatus · `POST …/plan/request {plan}` (Starter or Growth; the Orbit team grants it).
- Jobs: `GET …/jobs` → BizJobListItem[] · `POST …/jobs` (BizJobInput, a draft) · `GET|PATCH …/jobs/{jid}` ·
  `POST …/jobs/{jid}/publish|pause|close|reopen` · `POST …/jobs/draft {BizJobBrief}` → BizJobDraft (the AI writer).
- Job assistant (D85): `POST …/jobs/assist` BizJobAssistInput → BizJobAssist. A fill: `prompt` (+ `title`, `location`,
  `salary`, `experience`, `pasted`); a refine: `instruction` + `current` (the form). Returns every job field in
  BizJobInput names with `description_html`, `stages` (null: keep), `assumptions`, `inclusive_language_notes`,
  `changed_fields`, `source` ("ai" | "template"). Pay is only ever what the recruiter wrote. Nothing is saved; shares
  the AI writer's daily limit (429).
- Applications: `GET …/jobs/{jid}/applications?stage=&q=&tag=&sort=score|applied|name&reveal=` →
  BizApplicationList · `GET …/applications/{aid}?reveal=` → BizApplicationDetail · `POST …/applications/move
  {ids, stage_id, notify}` · `POST …/applications/reject {ids, send_email, subject?, body?}` ·
  → BizBulkResult `{moved, items, emails_waiting}` (move and reject; `emails_waiting`: emails not sent because
  those applicants haven't confirmed their address) · `POST …/applications/{aid}/unreject` · `PATCH …/applications/{aid} {tags?, interviewers?}` ·
  `POST …/applications/{aid}/notes {body}` (`@name` or `@email` mentions notify members) ·
  `POST …/applications/{aid}/scorecards` BizScorecardInput · `POST …/applications/{aid}/email {kind|subject+body}` ·
  `POST …/applications/{aid}/interview` BizSlotsInput (email and interview answer **409** `biz_email_unconfirmed`
  until the applicant's address is confirmed) · `POST …/applications/{aid}/rerank` (429 more than once per applicant
  per 10 minutes or 200 a day per company) ·
  `DELETE …/applications/{aid}` (delete-on-request; the audit log keeps the reference only) ·
  `GET …/jobs/{jid}/export.csv`. There is no automatic rejection: knock-out failures are flagged and sorted last.
- `GET|PUT …/templates[/{kind}]` (BizTemplate) · `GET …/analytics` → BizCompanyAnalytics ·
  `GET …/jobs/{jid}/analytics` → BizJobAnalytics · `GET …/audit?before=` → BizAuditEntry[] (owner, admin).
- `GET /notifications` → BizNotification[] · `POST /notifications/read {ids}`.

**Applying.** `GET /v1/business/apply/{job_id}/preview?resume_id=|document_id=` → BizApplyPreview and
`POST /v1/business/apply/{job_id}` BizOneClickApply (signed in, verified email): the chosen resume's text is copied
into the application (the company never reads the Orbit resume itself) and the job joins the candidate's Jobs AI
tracker (`source: "orbit_direct"`, listing id `biz:<job_id>`), moved as the company moves it. Signed out:
`POST /v1/public/business/jobs/{job_id}/apply` multipart (`name, email, phone, answers` JSON, `consent`,
`notice_version`, `source`, `file` PDF/DOCX ≤ 5 MB, `captcha_token`, honeypot `website`); a confirmation email
carries the status link. Both need `consent: true` and the current `notice_version` (recorded with the time, and
the retention in effect then). One application per email per job: a repeat answers `200 {"status":
"already_applied"}`, except that a signed-out application whose address was never confirmed is replaced by the next
one (signed out or one click) from that address. Until an applicant's address is confirmed (the status link opened,
or a one-click application from a verified Orbit email) only Orbit's fixed confirmation email goes to it: no company
template, custom email, stage or rejection email, or interview invite. The status link's token is random per
application (only its SHA-256 and a sealed copy are stored).

**Public** (`/v1/public/business`, no sign-in, cacheable): `GET /companies/{slug}` → BizPublicCompany
(`verified_domain`: the proven domain for the "Verified: acme.com" badge, null while unverified; also in
BizPublicJob's `company`) ·
`GET /companies/{slug}/jobs/{job_slug}` → BizPublicJob (with `json_ld` while open) · `GET /companies/{slug}/logo` ·
`GET /sitemap` → `[{loc, lastmod}]` · `POST /jobs/{job_id}/report {reason, details, email?}` ·
`GET /applications/{token}` → BizApplicationStatus · `POST /applications/{token}/confirm` ·
`POST /applications/{token}/book {slot}` · `POST /applications/{token}/delete-request`.

**Orbit admin** (`/v1/admin/business`): `GET /companies?q=&status=` → BizAdminCompany[] ·
`GET /companies/{cid}` → BizAdminCompanyDetail · `POST /companies/{cid}/suspend {reason}` · `/unsuspend` ·
`/verify` · `POST /companies/{cid}/plan {plan, days}` · `POST /jobs/{jid}/take-down {reason}` · `/restore` ·
`GET /reports?status=` → BizJobReport[] · `POST /reports/{id} {status}`.

**Business automation center** (company coordinator permissions, job access enforced):
`GET /v1/business/companies/{cid}/automations` returns playbooks and eligible owners.
`PUT /jobs/{jid}/automation {base_revision,recipe}` saves and reconciles;
`GET /jobs/{jid}/automation/preview` evaluates elapsed-time targets without writing tasks;
`POST /jobs/{jid}/automation/run` reconciles the saved playbook.
`GET /hiring-tasks?status=open&mine=false&job_id=&after=` returns a scoped queue, counts and cursor;
`POST /applications/{aid}/hiring-tasks {request_id,title,due_at,assignee_id}` creates a custom follow-up;
`POST /hiring-tasks/{tid} {base_revision,action,note,assignee_id?,until?}` handles, assigns, snoozes or reopens it.
These paths after the first share `/v1/business/companies/{cid}`. See [enterprise automations](BUSINESS_AUTOMATIONS.md).

**Interview coordination:** company application `POST /interview-options` suggests panel slots;
company and private candidate application `GET /scheduling-requests` lists requests; candidate
`POST /scheduling-requests` creates one and `POST /scheduling-requests/{id}/withdraw` withdraws it;
company `POST /scheduling-requests/{id}/reply` proposes alternatives or saves a message-only response.
Existing candidate `/book` confirms an offered alternative. See [contracts and booking guarantees](BUSINESS_COORDINATION.md).

## Candidate identity and reviewed session association

`GET /v1/jobs/launchpad/identity` returns the authenticated candidate’s selected master, saved resume summaries, review state, source version and existing career preferences. `PUT` on that path accepts version, action (select/approve/revoke), owned resume_id, resume_revision and optional independent_copy. A stale source returns 409; missing/foreign owned references return 404. Selection does not approve content; approval does not rewrite content.

`POST /v1/jobs/tracker/{entry_id}/sessions/link` accepts session_id and confirmed=true. Only the authenticated owner’s ended session may be attached, with no cross-opportunity rebinding. The timeline distinguishes round from related_round. session_id enables explicit association review; a related event is not counted toward job progress. Existing session creation with application_id remains the authority for practice launched from a job.

POST /v1/jobs/tracker/{entry_id}/sessions/unlink uses the same session_id/confirmed=true contract as link; both require owned ended resources and reject another opportunity's current association with409. Same-state retries are idempotent. Link/unlink history is candidate-controlled attribution, not a transcript/context rewrite or employer interview result. Timeline provenance values are saved_record/candidate_recorded/executor_reported/outcome_uncertain/suggestion. Additional kinds application/association do not count as completed rounds. Export adds opportunity_session_associations; no source data is placed in navigation URLs.

## Draft round history contract (default OFF, unverified)

GET /v1/jobs/tracker/{entry_id}/rounds returns enabled, tracker_version and owned rounds. Manual POST /rounds takes label/category/number, optional local_time with IANA time_zone, notes, request_id, strict confirmed=true and tracker_version; explicit use_for_preparation and mark_interviewing default false. PUT /rounds/{round_id} additionally takes round revision, planned/completed/cancelled and optional candidate outcome. POST /rounds/{round_id}/prepare selects a dated planned round with source/job versions. POST /rounds/preparation/clear explicitly releases selection. POST /rounds/calendar reparses full reviewed input and chosen event_id, preserving a hashed source key without storing calendar text.

Closed/stale context conflicts use409; foreign/missing owned resources404; unsupported time or consent422. Existing interview view/message state expose round_history_enabled. Session context/create/output optionally include interview_round_id/revision; creating against a stale/nonselected/foreign round is rejected. Timeline adds interview_round as candidate-recorded employer history, distinct from completed mock/live execution. Account export adds interview_rounds. No old source/history is inferred or rewritten. No current contract verification has run.


## Saved-material source continuity — 2026-10-21 (IMPLEMENTED / UNVERIFIED)

MissionSnapshot and ResumeVersionComparison add nullable SnapshotOrigin; old rows return null. POST mission/snapshots accepts optional resume_id and updated_at guards; legacy clients may omit them. Origin is server-captured, not client-writable. Packet source observation distinguishes candidate_recorded and executor_reported; neither proves delivery.

Owner instruction: no tests, builds, lint, typechecks, migrations or browser checks. [Scope, rollback and deferred acceptance](implementation/UNIFIED_SNAPSHOT_ORIGIN.md).


## Enterprise visual language — 2026-10-21 (unverified)

No backend/API/schema change. Today reuses /jobs/mission/:entryId with existing tab=resume/practice/interview/offer; existing old URLs remain. Device preference adds slate; legacy nebula resolves to slate without rewriting resume template colours or other explicit accent choices.

No tests or validation under owner instruction. [Scope and deferred release gates](implementation/UNIFIED_ENTERPRISE_DESIGN.md). Production NO-GO.
