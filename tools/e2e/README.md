# Browser regression checks

Run from the repository root:

```sh
pnpm install --frozen-lockfile
uv sync --project apps/api --frozen
pnpm exec playwright install chromium
pnpm test:e2e
```

Playwright starts an isolated test API on port 8000 and Vite on port 5173. It uses real HTTP, cookie auth,
WebSockets, database persistence and React UI. LLM/STT providers are explicitly test mocks, forbidden in production.
The disposable SQLite database and email outbox are ignored by Git. Stop other services on these ports before
running; local runs can reuse existing test servers. Do not point these tests at production.

Checks cover aborted autosaves, cross-tab conflicts, mobile context reloads, reduced motion, architecture critique,
code walkthroughs, and the final debrief/radar/retry flow. Screenshots and traces are in `test-results/`.
The frontend CI job runs this gate; Postgres locking and career endpoint tests run in the API CI job.

The older `resume-race.mjs` script remains available for manual route-switch diagnostics.
