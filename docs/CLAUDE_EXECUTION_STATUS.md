# Execution status — Orbit V3 master prompt

Started 14 October 2026 against `main` at `d534da2`. This file records what was run and what came back; nothing
here is inferred. Update it as work continues.

## Environment

| Item | Value |
|---|---|
| Machine | Linux cloud container (no Windows, no macOS) |
| Python / Node / pnpm / uv | 3.11 system (API venv 3.12) / 22.22.2 / 9.12.0 / 0.8.17 |
| Postgres | 16 + pgvector 0.x, local, `127.0.0.1:55432` (installed for this work) |
| Browser | Chromium 1194 (Playwright 1.56, headless) |
| Not available | Windows hardware, a live Razorpay account, Google sign-in, the deployed API (the network blocks `onrender.com` and `api.razorpay.com`), GitHub Actions (account billing block: every check fails in ~2 s without running) |

## Baseline at `d534da2` (before any change)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS (0 errors, 2 warnings: `SupportChat.tsx:194`, `SessionSetup.tsx:231`, react-hooks/exhaustive-deps) |
| `pnpm test` | PASS (web 228, ui 212) |
| `pnpm build` | PASS |
| `uv sync --frozen` | PASS |
| `uv run ruff check .` | PASS |
| `uv run mypy orbit_api` | PASS (141 files) |
| `uv run pytest -q` | PASS: 1884 passed, 16 skipped (295 s) |
| `uv run alembic heads` | `a8c1e3f5b7d9 (head)` |

## Changes (all merged to `main`)

| PR | Findings | What |
|---|---|---|
| #275 | V3-01, V3-05, V3-14 | Support handoff ticket linked to its chat (`contact_messages.source_support_thread_id`, unique, CASCADE); deleted with the chat / account / visitor delete / retention sweep; one ticket per chat under concurrency; closed chat 409; migration `c3e5a7b9d1f2` backfills, merges duplicates, deletes orphaned copies |
| #276 | V3-07, V3-08, V3-09, V3-13, V3-03 (checklist) | `payment_events`, `payment_refunds`, `billing/settle.py` (one credit path, reconciler with backoff and expiry), verify → `processing` instead of 409, buyer/admin status UI, truthful copy; migration `d5f7b9c1e3a4` |
| #277 | V3-06 | Per-resume save queue, `resumes.revision` + `base_revision` 409, conflict UI, local drafts; migration `e7a9c1d3f5b6`; browser reproduction script `tools/e2e/resume-race.mjs` |
| #278 | V3-10, V3-11, V3-12 | Row lock before stamping support lines; account-linked chats need the account; `?token=` deprecated with a header and a usage log line |

**Held, not merged: V3-02** (production refuses to start without `ORBIT_PROXY_SECRET`). The patch and its tests are
ready, but merging it while Render lacks the secret would stop the API on the next deploy. Needs the owner to confirm
the secret is set in Render and in the Cloudflare Worker (`wrangler secret put PROXY_SECRET`).

## Evidence

| Check | Command | Result |
|---|---|---|
| Support lifecycle, SQLite | `uv run pytest tests/test_support_lifecycle.py` | PASS 11 |
| Support lifecycle, Postgres 16 | `ORBIT_TEST_DATABASE_URL=postgresql+asyncpg://…/orbit_pg_t uv run pytest tests/test_support_lifecycle.py` | PASS 11 |
| Payment settlement, SQLite and Postgres | `… tests/test_payment_settlement.py tests/test_razorpay.py` | PASS 24 (SQLite), PASS 32 incl. support (Postgres) |
| Resume revision, SQLite and Postgres | `… tests/test_resume_revision.py` | PASS 5 / PASS 5 |
| Migrations on Postgres 16 + pgvector | `alembic upgrade head`, `downgrade -1`, `upgrade head` for each new revision | PASS |
| Migrations on SQLite | same, and `test_the_migration_links_old_tickets_and_drops_orphaned_copies` | PASS |
| Full API suite after billing | `uv run pytest -q` | 1916 passed, 16 skipped, **1 failed**: `test_engine.py::test_an_early_answer_is_dropped_unseen_when_the_interviewer_keeps_talking` (counts LLM requests against a 0.3 s wall-clock sleep; failed under CPU load from parallel jobs, passed 5/5 alone; engine code untouched) |
| Security suites after support changes | `pytest tests/test_security_*.py tests/test_launch_security.py` | PASS 726 |
| Web | `npx tsc`, `npx eslint`, `npx vitest run` | PASS, 235 tests |
| Desktop | `npx tsc --noEmit` | PASS |
| Resume race in a browser, **before** (old editor) | `node tools/e2e/resume-race.mjs` with `ResumeEditor.tsx` stashed | server kept `"A edited v1"`: newer edits lost (defect reproduced) |
| Resume race in a browser, **after** | same, with the fix | server kept `"A edited v2"`, editor shows v2; stale tab got the conflict; "Load the latest" offered a draft |
| Cloudflare build | `pnpm install --frozen-lockfile && pnpm --filter @orbit/web build && wrangler deploy --dry-run` locally | PASS; the live build log shows the build passes and the **deploy command is `npx wrangler preview`**, which fails for lack of a `previews` block. Fix: set the deploy command to `npx wrangler deploy` in Cloudflare (owner) |

## Feature matrix (from the code, 14 Oct)

| Area | State |
|---|---|
| Sign-up / sign-in / Google OAuth / reset / export / delete | existing; Google untested in a real browser here |
| Interview copilot (desktop audio, STT, live answers) | existing; Windows hardware untested |
| Mock interview, warm-up, company styles, answer bank, stories | existing |
| Resume AI (editor, ATS, AI rewrite/tailor, cover letter, Word/PDF) | existing; save race fixed (#277) |
| Jobs AI (feed, match, tracker, outreach, follow-ups, worldwide) | existing |
| Payments (Razorpay, UPI fallback, refunds, reconciliation) | existing; settlement hardened (#276); live webhook/refund untested |
| Support chat + human handoff + admin Inbox | existing; lifecycle fixed (#275, #278) |
| Admin (users, payments, inbox, support, audit) | existing |
| Playwright E2E in CI | missing (one script in `tools/e2e/`, run by hand) |
| Phase 5 redesign / Phase 6 features | not started (see `docs/ORBIT_UX_FEATURE_ROADMAP.md`) |

## Next

1. V3-02 once the owner confirms the proxy secret.
2. Fix the timing-sensitive engine test (`test_engine.py`, count assertion vs wall clock).
3. Phase 5 / Phase 6 per the roadmap, behind flags.
