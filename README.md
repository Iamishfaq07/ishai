# Orbit AI

Two products in one account:

- **Interview copilot**, for Windows and the web: Orbit listens to a live conversation, detects the interviewer's
  questions, grounds its answers in your resume, the job description, and your documents, and streams concise
  answers you can speak from.
- **Orbit Resume AI**, on the web: build a resume that gets interviews, with an ATS score, AI rewrites for every
  job, and interview prep from your own resume.

## Interview copilot

- **Hears both sides, separately.** Your mic and the interviewer's audio (your speakers/headset, or one app such as
  Teams or Zoom) are captured natively on Windows and transcribed live by Deepgram. No diarization guesswork.
- **Knows when to answer.** A question detector, with an AI second opinion for borderline cases, fires on real
  questions and instructions. It waits for the interviewer to finish and ignores filler and small talk. Follow-ups are
  stitched onto the question they belong to.
- **Answers in your voice.** First-person spoken answers from DeepSeek, grounded in your documents. Anything it had to
  invent is flagged *Suggested details*. **Key points** tick off as you say them, so you always know what's next.
- **Coding help.** Problem restated, code in your chosen language (highlighted, line-numbered), complexity, edge cases,
  and tests. Screenshot a problem and it's answered from the image (the image is analysed and discarded).
- **Practice.** Mock interviews where the AI plays the interviewer (persona, type, difficulty, duration) and speaks
  its questions aloud, followed by a review with scores.
- **Before and after.** A preflight checklist (mic, interviewer audio, AI, transcription, minutes) before you start.
  Saved setups per job ("workspaces"). Session history, reports, transcript, and Markdown export.
- **A good citizen.** A compact always-on-top window with adjustable transparency, a system tray, rebindable global
  shortcuts, and signed auto-updates. Accessible (WCAG AA) in light and dark themes.

Download the Windows app from [orbit-downloads.ishfaq.workers.dev](https://orbit-downloads.ishfaq.workers.dev) (free, no
sign-in; also on [Releases](https://github.com/Iamishfaq07/ishai/releases/latest)). It updates itself.

## Orbit Resume AI

At `/resume-ai` in the web app (a public product page when signed out). Each AI action uses a resume credit: one
comes free with a new account, more come in UPI packs; typing, the ATS score and downloads are always free.

- **ATS score and keyword match.** A score out of 100, read the way screening software reads a resume, with the job
  post's missing keywords and a fix for every point.
- **AI rewrites for every job.** Stronger bullets and a summary, tailored to the job post, one change at a time.
  Grounded in the resume: a number or tool it doesn't give is never added.
- **AI import.** From a PDF or Word file, LinkedIn's "Save to PDF", pasted text or a document already in Orbit.
- **Interview prep from your resume.** The questions it will get you asked with answer outlines, the skills the job
  wants that it doesn't show, and a mock interview on them.
- **Campus and fresher mode.** Education first with your CGPA, projects and positions of responsibility, on one page.
- **Cover letters**, in the tone and length you pick, and **Naukri and LinkedIn profiles and outreach messages**
  (referral requests, emails to HR, follow-ups, thank-you notes).
- **10 templates** (Campus and Harvard among them), Word and PDF downloads, and "Shorten with AI" to fit one page.

## Stack

- **Backend:** FastAPI · SQLAlchemy + Alembic · Postgres + pgvector (SQLite for dev) · DeepSeek (LLM) · Deepgram
  (STT). Code in `apps/api`.
- **Desktop:** Tauri 2 (Rust WASAPI audio + screen capture) + React. Code in `apps/desktop`.
- **Web:** React + Vite in `apps/web`. The live UI is shared from `packages/ui` and the types from `packages/types`.

Docs:
- [Architecture](docs/ARCHITECTURE.md)
- [Live protocol](docs/PROTOCOL.md)
- [Decisions](docs/DECISIONS.md)
- [Deploy](docs/DEPLOY.md)
- [Security](docs/SECURITY.md)
- [Privacy & your data](docs/PRIVACY.md)
- [Plans & billing](docs/BILLING.md)
- [AI providers & failover](docs/AI_PROVIDER.md)
- [Retrieval](docs/RETRIEVAL.md)
- [Windows release & updates](docs/WINDOWS_RELEASE.md)
- [Design system](docs/DESIGN.md)
- [Changelog](docs/CHANGELOG.md)

## Quick start (backend, no API keys needed)

```bash
cd apps/api
cp ../../.env.example .env      # leave keys empty → mock providers
# zero-dependency mode: set ORBIT_DATABASE_URL=sqlite+aiosqlite:///./orbit.db in .env
uv sync
uv run alembic upgrade head
uv run uvicorn orbit_api.main:app --reload     # http://localhost:8000/docs
uv run pytest                                   # unit + integration + E2E acceptance flow
```

With Postgres: `docker compose -f infra/docker-compose.yml up -d postgres`, then `uv run alembic upgrade head`.

For real answers and transcription, set `DEEPSEEK_API_KEY` and `DEEPGRAM_API_KEY` in `apps/api/.env`. Keys stay on the
server and are never shipped to the desktop or web clients. With the mock STT provider, the live screen offers
**Dev · simulate**, which replays a recorded interview through the whole pipeline without a microphone.

## Frontend

Requires Node 22.12+ and pnpm 9 (plus Rust stable for the desktop app):

```bash
pnpm install
pnpm dev:web        # http://localhost:5173
pnpm dev:desktop    # Tauri window
pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

## Responsible use

Orbit is built for interview preparation, mock interviews, and meetings where assistance is allowed. It alsot hide from
screen sharing .
