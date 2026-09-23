# Orbit AI

A real-time interview and call copilot. Orbit listens to a live conversation, detects the interviewer's questions,
grounds its answers in your resume, the job description, and your documents, and streams concise answers you can speak from.

- **Backend:** FastAPI · Postgres + pgvector · DeepSeek (LLM) · Deepgram (STT) — `apps/api`
- **Desktop:** Tauri 2 (Rust audio/screen capture) + React — `apps/desktop`
- **Web:** React + Vite — `apps/web` · shared live UI in `packages/ui`, types in `packages/types`

Docs: [Architecture](docs/ARCHITECTURE.md) · [Live protocol](docs/PROTOCOL.md) · [Decisions](docs/DECISIONS.md) · [Windows release & updates](docs/WINDOWS_RELEASE.md)

## Quick start (backend, no API keys needed)

```bash
cd apps/api
cp ../../.env.example .env      # leave keys empty → mock providers
# zero-dependency mode: set ORBIT_DATABASE_URL=sqlite+aiosqlite:///./orbit.db in .env
uv sync
uv run uvicorn orbit_api.main:app --reload     # http://localhost:8000/docs
uv run pytest                                   # unit + integration + E2E acceptance flow
```

With Postgres: `docker compose -f infra/docker-compose.yml up -d postgres redis`, then
`uv run alembic upgrade head`.

For real answers and transcription, set `DEEPSEEK_API_KEY` and `DEEPGRAM_API_KEY` in `apps/api/.env`. Keys stay on the
server and are never shipped to the desktop or web clients.

## Frontend

Requires Node 20+ and pnpm 9 (plus Rust stable for the desktop app):

```bash
pnpm install
pnpm dev:web        # http://localhost:5173
pnpm dev:desktop    # Tauri window
```

## Responsible use

Orbit is built for interview preparation, mock interviews, and meetings where assistance is allowed. It doesn't hide from
screen sharing or try to defeat proctoring. Follow the rules of each interview or assessment you take.
