# Privacy and your data

What Orbit keeps, what it never keeps, and the controls you have. The code behind each point is named so it can
be checked.

## Never stored
- **Audio.** It streams to the API and is relayed to transcription. Nothing is written to disk.
- **Screenshots.** They're sent to the AI model to answer, then discarded (`sessions/routes.py`).
- **Uploaded files.** Only the extracted text is kept; the original PDF or DOCX bytes are dropped
  (`documents/routes.py`).
- **Content in analytics.** Transcripts, resumes, JDs and answers never go to analytics. Logs redact secrets, and
  Sentry (opt-in) sends no bodies or PII.

## Stored, and why
| Data | Why | Where |
|---|---|---|
| Account (email, name, password hash) | sign-in | `users` |
| Documents' extracted text + searchable facts | grounding answers in your background | `documents`, `document_chunks` |
| Workspaces | saved setups | `workspaces` |
| Resume AI: resumes (content, design, the photo if you add one, the job post you tailor to) | editing and scoring them | `resumes` |
| Sessions: transcript, questions, answers, report | history and review | `session_turns`, `questions`, `answers`, `session_summaries` |
| Usage (minutes, screenshots) | plan limits | `usage` |
| Security log (sign-ins, resets, email changes) | account security | `audit_logs` |

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
| Sign out of every device | Settings → Privacy | `POST /v1/auth/logout-all` |
| Delete your account and everything in it | Settings → Privacy | `DELETE /v1/auth/me` |

Deleting an account cascades to every row above (`ON DELETE CASCADE`). The export includes everything above
except secrets (the password hash) and derived search data (chunk embeddings). The documents' full text is
included instead.

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

**The free resume maker needs no account.** Signed out, the one resume you make is kept only in your browser
(`localStorage`); the server never stores it, and it isn't tied to you. Scoring, Word export and the AI are done
per request and nothing is kept: the text you send for an AI fix goes to the AI provider the same way a signed-in
request does. Clearing your browsing data deletes the resume. If you later create an account, the editor offers to
save that resume to it.

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
