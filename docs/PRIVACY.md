# Privacy and your data

What Orbit keeps, what it never keeps, and the controls you have. The code behind each point is named so it can
be checked.

**Connected tool context (V6 increment 7, unverified):** selected tools can carry a bounded job ID and opaque practice-selection key in navigation URLs. The signed-in banner reads only your owned job title/company and evidence feature flag; these URLs grant no access and are not public shares. No raw requirement, transcript or employer-message body is added to the trail, and no library artifact is automatically attached. No new retained record or browser-storage entry is created. Reply/invitation inputs can remain in memory within the same mounted job view when switching support choices. Verification is deferred by owner request; see `implementation/V6_CONNECTED_JOURNEY.md`.

**Requirement practice (V6 increment 6, unverified):** the opportunity workshop reads your owned prior fit-check requirements and bounded historical quotes. Optional AI help receives the selected requirement and format through the existing coach; historical candidate quotes shown in the workshop are not newly added to model grounding. No exercise result, story, evidence or resume claim is automatically stored. Copying a brief writes to your clipboard on click. Existing fit-check export/delete applies. All verification is deferred by owner request; see `implementation/V6_REQUIREMENT_PRACTICE.md`.

**Job source review (V6 increment 5, unverified):** the signed-in opportunity compares your saved job fields with Orbit's shared public cache. No new comparison record or analytics content is stored. The existing coach receives derived observation/change indicators and a review link, not raw changed links or a new job-description body. Reloading this review makes no external provider request. Existing tracker export/deletion applies; all verification is deferred by owner request. See `implementation/V6_SOURCE_REVIEW.md`.

**Saved-version comparison (V6 increment4, not yet runtime-verified):** on your request, Orbit compares an owned job's saved resume copy with its currently linked owned resume. Bounded readable excerpts and photo fingerprints are returned to your signed-in page; no new comparison record is stored. Existing resume/snapshot export and deletion apply. The opportunity coach receives derived latest-version match/change counts and an owned link, not comparison excerpts, resume bodies or photo bytes. See `implementation/V6_RESUME_LINEAGE.md`. All testing for this increment is deferred by the owner's instruction.

## Never stored
- **Personal interview calendar imports.** The `.ics` body, event title, organizer and raw UID are not persisted or sent to an AI provider (`job_portal/calendar_intake.py`). Only a candidate-confirmed tracker date and optional stage are saved through the existing tracker flow. Invitation text is transient and cleared after a successful save. Interview coach requests may include the saved date and suggested preparation-task text under the existing AI policy; importing an invitation itself makes no model call.
- **Audio.** It streams to the API and is relayed to transcription. Nothing is written to disk.
- **Screenshots.** They're sent to the AI model to answer, then discarded (`sessions/routes.py`).
- **Uploaded files.** Only the extracted text is kept; the original PDF or DOCX bytes are dropped
  (`documents/routes.py`).
- **Content in analytics.** Transcripts, resumes, JDs and answers never go to analytics. Logs redact secrets, and
  Sentry (opt-in) sends no bodies or PII.

## Stored, and why

**Personal preparation completions:** `job_plan_checks.task_data` retains the task text, kind, planned day, recorded interview time and optional earlier-completion reference when you check/reuse a task. This preserves your work across date changes; it is candidate-recorded activity, not verified skills. Legacy checks have no invented task details. The latest50 appear in the job history; all participate in account export and job/account deletion. The AI preparation coach receives counts and current unchecked task text, not historical completion bodies. Unchecking a current task removes that completion; a separately reviewed reuse record remains independent. See `implementation/V6_PREP_CONTINUITY.md`.

| Data | Why | Where |
|---|---|---|
| Account (email, name, password hash) | sign-in | `users` |
| Documents' extracted text + searchable facts | grounding answers in your background | `documents`, `document_chunks` |
| Workspaces | saved setups | `workspaces` |
| Resume AI: resumes (content, design, the photo if you add one, the job post you tailor to) | editing and scoring them | `resumes` |
| Sessions: transcript, questions, answers, report | history and review | `session_turns`, `questions`, `answers`, `session_summaries` |
| Usage (minutes, screenshots) | plan limits | `usage` |
| Security log (sign-ins, resets, email changes) | account security | `audit_logs` |
| Messages sent from the Contact page (see below) | answering them | `contact_messages` |
| Orbit Apply, only if you turn it on (D84): the setup and consent, your answer bank, each prepared application (tailored resume, cover letter, answers) and its proof (what was entered, the confirmation text and address, a screenshot when the browser could take one) | applying for you, and showing what was sent | `auto_apply_setups`, `answer_bank`, `application_packets`, `apply_proofs` |

Transcript storage can be switched off (Settings → Privacy → *Store transcripts*). It's then used live and
discarded when the session ends.

## Your controls
| Control | Where | Endpoint |
|---|---|---|
| Delete a session (everything in it) | History | `DELETE /v1/sessions/{id}` |
| Delete just a session's transcript, keeping answers and report | History | `DELETE /v1/sessions/{id}/transcript` |
| Delete a document (and its searchable facts) | Documents | `DELETE /v1/documents/{id}` |
| Delete a workspace | Setup | `DELETE /v1/workspaces/{id}` |
| Delete a resume (and its photo) | Resume AI | `DELETE /v1/resumes/{id}` |
| Download all your data (one JSON file) | Settings → Account | `GET /v1/auth/me/export` |
| Change your email (confirmed from the new inbox; the old one is told) | Settings → Account | `POST /v1/auth/me/email` |
| See where you're signed in, and sign out one device | Settings → Devices | `GET /v1/auth/sessions`, `DELETE /v1/auth/sessions/{id}` |
| Sign out of every device | Settings → Privacy | `POST /v1/auth/logout-all` |
| Orbit Apply: pause or resume it; withdraw your agreement (nothing more is submitted); switch it off in the extension (which gives back its access to the four ATS sites) | Jobs → Applications, the extension popup | `POST /v1/apply/pause`, `/resume`, `PUT /v1/apply/setup {consent: false}` |
| Delete your account and everything in it | Settings → Privacy | `DELETE /v1/auth/me` |
| Privacy shield (keep the desktop window out of screenshots/recordings) and hide-from-taskbar: both off until chosen; changed 16 Oct 2026 from always-on | Desktop → Settings → Window privacy | local (`set_window_privacy`) |

## Cookies and other services
The web app sets one httpOnly sign-in cookie, and a second httpOnly cookie (`orbit_google`) for about 10 minutes
only while Continue with Google is in progress. It does not set an advertising or analytics cookie. Settings on the
device (theme, this notice, a support-chat token) stay in the browser's own storage. Razorpay loads only when
someone buys a pack. Deepgram transcribes audio. DeepSeek (and a backup model, only if DeepSeek is down) writes
answers. Cloudflare serves the site. Sentry stays off unless `ORBIT_SENTRY_DSN` is set, and then it sends no
bodies or PII (`observability.py`). Account email is transactional only. There is no newsletter.

## Age
Orbit is for students and job seekers, including people under 18. Sign-up does not ask for an age or a date of
birth. A parent can ask for an account to be deleted from the contact page.

Deleting an account cascades to every row above (`ON DELETE CASCADE`), and deletes support chats you started while
signed in (they name you and keep what you wrote), with the Inbox copy made when one asked for a person. Contact messages are the exception below. The export includes
everything above, plus those support chats, except secrets (the password hash, the support-chat token) and derived
search data (chunk embeddings). The documents' full text is included instead.

## Contact messages
The Contact page (`/contact`, `contact/routes.py`) works signed in or out. A message is kept in `contact_messages`
for the admin to answer in the console's Inbox; **no email is sent when one arrives**.
- **What's kept:** the name, email and (optional) phone or WhatsApp number as typed, the topic, the message, and a
  small context: a reported job's listing (id, title, company, link, from Orbit's job cache) and the app page the
  form was opened from. Signed in, the account is linked (`user_id`); nothing is copied from it.
- **Not kept:** the IP address. Only a keyed hash of the sender's network (an IPv4 address or IPv6 /64, HMAC with
  the server's secret, as the welcome grant does) is stored, for rate limits and "N messages from this network".
- **Who sees it:** only the admin (`/admin/inbox`). They can add a private note, mark it done or spam, delete it,
  and reply: a reply is emailed to the sender from Orbit's address with Reply-To the admin, and kept on the message.
- **How long:** a message marked done or spam is deleted 12 months after that (`ORBIT_CONTACT_RETENTION_DAYS`,
  default 365, by the server's periodic sweep); new and open ones stay until handled. The admin can delete any
  message at any time.
- **Deleting the account** keeps the messages typed on the Contact page, with the link to the account cleared
  (`ON DELETE SET NULL`): they were written to Orbit, and an open question shouldn't vanish. The sender can ask, from
  the Contact page, for one to be deleted.
- **The export** includes the account's own messages (sent while signed in) and the replies it was emailed, not the
  admin's note or the network hash.

## Support chat
The chat bubble (`support/routes.py`) works signed in or out; the browser keeps the chat's token, the only way back
into it (sent in the `X-Orbit-Support-Token` header).
- **What's kept:** the chat's lines (`support_threads`, `support_messages`), the name and email given, and, signed
  in, the account link.
- **Asking for a person** makes one Inbox ticket for the chat: a copy of the chat so far (up to 3,000 characters) in
  `contact_messages`, marked with the chat it came from (`source_support_thread_id`, one ticket per chat however many
  times the button is pressed). This copy is not a Contact page message: it lives and dies with its chat.
- **Deleting:** the visitor can delete their own chat from the chat panel (the bin icon), signed in or not; that
  deletes its lines and its Inbox ticket. Deleting the account deletes every chat started while signed in, with their
  tickets, in the same transaction. The admin can delete a chat on request (a guest writing in), ticket included.
- **How long:** a chat nobody is waiting on (the bot's, or closed) is deleted, with its ticket, after
  `ORBIT_CONTACT_RETENTION_DAYS` (default 365) without activity. A chat waiting for a person stays until handled.
- **The export** includes the account's chats (without the token) and, under `contact_messages`, each ticket with its
  `source_support_thread_id`, so the copy is identifiable as a copy.
- **Backups:** database backups taken before a deletion still hold the deleted rows until they expire on the
  provider's schedule (Neon's point-in-time history); deletion is not retroactive into those.

## What the server's admin sees and can do
The person who runs the server (`ORBIT_ADMIN_EMAIL`) has an admin console (`admin/accounts.py`, `admin/routes.py`):
- **Sees** each account's email, name, plan, credit balances and their full history, usage (minutes, and counts of
  documents, resumes, sessions and Jobs AI activity), payments, and the account's security log (sign-ins with their
  IP addresses). **Never the content:** no document text, transcripts, answers, resumes or session titles.
- **Can** give or take away credits (each change is in your history with the admin's reason), suspend the account
  (you're emailed and shown the reason, and can't sign in until it's lifted), sign it out everywhere, email you a
  password-reset link, and delete it. A deletion is the same as your own (`auth/accounts.py`): everything above
  goes, and an approved payment stays on the books without the account.
- The admin's private notes about an account aren't part of your export. Every admin action is in the audit log.
- **Reads, answers and handles Contact messages** in the Inbox (above).

**The resume editor needs an account.** A signed-out resume maker used to keep one resume in this browser only.
That maker is gone. If a resume from it is still on the device, the resume list offers to save it to the account.
Scoring, Word export and the AI run only once you are signed in.

Resume imports (a PDF, Word file, LinkedIn "Save to PDF" or pasted text) are read once and the file isn't kept:
only the structured resume you then save is stored.

## Where data lives
- **The API and database:** the configured host (see DEPLOY.md: Render and Neon Postgres).
- **Transcription:** Deepgram receives the audio stream.
- **AI answers:** DeepSeek receives the prompt: the question, retrieved facts and recent conversation. A configured
  backup AI provider receives the same prompt only when it's used.
- **Embeddings** for retrieval are computed on the Orbit server, not by a third party.

## Read aloud
*Read aloud* uses only the on-device voices built into Windows (or the browser), so the answer text is spoken on
your device and isn't sent to any speech service. Only when no on-device voice exists for the language does it
offer the browser's online voices, marked "(online)"; those send the text to the browser vendor's speech
service. While it plays, Orbit stops sending audio for transcription.

The mock interviewer's spoken questions may use an online "Natural" voice when one is installed, for a more
natural sound. Those questions are generated practice questions, not your answers.

## Audio diagnostics
*Test audio* measures levels on your device and sends nothing to the server. *Copy diagnostics* puts a report on
your clipboard for you to share if you choose. It holds measurements, device names (with personal names such as
"Sam's AirPods" redacted), the app version and the Windows version: no audio, transcripts, account details or keys.

## Personal career continuity

Today, Prepare and My Career reuse the signed-in account's existing records. The per-job application link projects packet identity and delivery state, without another resume/answer store. This navigation update introduces no new analytics content, OAuth permission or retention period. Optional AI plans still require a deliberate request. Existing source records remain covered by account export/delete.

## Implementation note: candidate identity and temporary drafts

The unified journey stores the chosen master resume identifier, reviewed revision/content fingerprint and review timestamp on the existing owned job-search profile. Account export includes this metadata. Existing account deletion removes the profile and its metadata. No new raw voice/video retention or external sharing is introduced by this slice.

Unconfirmed employer-message and calendar input can be retained in this tab’s memory to support navigation. It is not written to local/session storage, expires for restoration after one hour, is bounded to ten inputs, and clears when accounts change. Closing/reloading the tab discards it after the browser’s unsaved-input warning. Review proposals and sending/application approvals are never restored. This technical note does not change legal promises or replace counsel review.

Candidate account transitions also synchronize across same-origin tabs through storage events and opaque BroadcastChannel notifications; server authentication remains authoritative. Blocked browser storage is covered by the channel fallback. Raw resume or draft text is not broadcast.

Reviewed session linking/unlinking records only opaque job/session identifiers and time in the existing audit store. This career activity is included in account export and removed on account deletion. It does not record extra transcript/audio/video, rewrite source reports, or grant an employer access. Deleted job/session identifiers can remain as opaque activity references until account deletion. The optional picker reuses the existing private session history. This is an implementation note, not a new legal approval.

## Draft round-history implementation note

When explicitly enabled and a candidate confirms a save, round records store their label, schedule/time zone, notes, outcome and schedule/status history for an owned opportunity. Old note text is not duplicated into every schedule event. Original calendar content is reparsed during the request and not stored in the round database; input-only draft restoration uses existing bounded tab memory. Export includes owned round data; deleting the account/job cascades round content. Surviving owned sessions may retain opaque original round identifiers/revisions, like other historical source references. No new recording retention, calendar subscription, employer sharing, mailbox scope or analytics containing private content. Implementation is unverified; no new legal/counsel approval claimed.


## Saved-material source continuity — 2026-10-21 (IMPLEMENTED / UNVERIFIED)

Origin duplicates only opaque source IDs, revision, structured-content hash, observation/time/status. No new raw audio, confirmation body, screenshot, submitted answers or job/career text stored in this metadata. Existing owned export includes the column; snapshot/job/account deletion removes it. Technical implementation note, not a legal-policy approval.

Owner instruction: no tests, builds, lint, typechecks, migrations or browser checks. [Scope, rollback and deferred acceptance](implementation/UNIFIED_SNAPSHOT_ORIGIN.md).


## Enterprise visual language — 2026-10-21 (unverified)

This is a visual/navigation-only change. No new profile facts, telemetry, persistence, public sharing or audio/video retention. Journey links carry only opaque job IDs and existing tab keys. Business/candidate data authorities stay separate. Technical note, not a new legal claim.

No tests or validation under owner instruction. [Scope and deferred release gates](implementation/UNIFIED_ENTERPRISE_DESIGN.md). Production NO-GO.
