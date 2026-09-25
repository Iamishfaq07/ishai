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
| Download all your data (one JSON file) | Settings → Account | `GET /v1/auth/me/export` |
| Change your email (confirmed from the new inbox; the old one is told) | Settings → Account | `POST /v1/auth/me/email` |
| Sign out of every device | Settings → Privacy | `POST /v1/auth/logout-all` |
| Delete your account and everything in it | Settings → Privacy | `DELETE /v1/auth/me` |

Deleting an account cascades to every row above (`ON DELETE CASCADE`). The export includes everything above
except secrets (the password hash) and derived search data (chunk embeddings). The documents' full text is
included instead.

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

