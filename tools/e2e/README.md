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
code walkthroughs, and the final debrief/radar/retry flow. `accessibility.spec.ts` runs axe-core (WCAG 2.0, 2.1 and 2.2,
A and AA) on the app's main screens in light and dark, and fails on any violation, naming the screen and the element.
Screenshots and traces are in `test-results/`.
The frontend CI job runs this gate; Postgres locking and career endpoint tests run in the API CI job.

The older `resume-race.mjs` script remains available for manual route-switch diagnostics.

`auto-apply.mjs` is Orbit Apply's run (D84), driven by hand: start `apps/api/scripts/e2e_auto_apply.py` (port 8039,
recorded ATS forms, fixture jobs, mock AI) and Vite on 5202 with `VITE_API_URL=http://127.0.0.1:8039`, then
`node tools/e2e/auto-apply.mjs`. It goes through the setup wizard, the planner, a needs_answer packet and a fake
executor (`apps/api/scripts/fake_executor.py`), and runs axe on each screen. Screenshots go to `%TEMP%\orbit-autoapply-e2e\`.
