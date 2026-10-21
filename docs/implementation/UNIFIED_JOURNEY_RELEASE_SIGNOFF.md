# Unified journey release decision — 2026-10-21

Draft PR: https://github.com/Iamishfaq07/ishai/pull/445. Hosted CI run39521859957 could not execute any steps; six jobs report failure. API and desktop annotations identify account payment/spending-limit blocking. Owner must resolve GitHub Billing & plans and rerun CI. Local evidence does not replace hosted gates. Existing Cloudflare Workers integration was building when inspected; no manual deployment was issued or provider/staging proof inferred.

**Review checkpoint: draft PR. Production release: NO-GO.** This is engineering evidence, not an owner deployment approval. No merge, production deploy, real application, recruiter email or charge was performed.

## Shipped scope in this branch

Phase 1 foundation: explicit owned master resume and source-bound candidate review, identity-first My Career, operational Today and reuse of the selected source in Discover. Phase 2 foundation: one Opportunity Room with preserved legacy tab/guide aliases, independent job materials, guarded editor links and input-only draft continuity. Phase 3 foundation: contextual Saba launch/report return, owned reviewed session association and truthful linked-session progress. Five primary candidate destinations remain; business navigation and the existing constrained application engine remain separate.

This is not the complete seven-phase transformation. Complete kit/receipt lineage and approval-consumer migration, real round/calendar authority, replay/provider orchestration, offer/joining continuity and all-screen design remain PARTIAL. See UNIFIED_JOURNEY_PLAN.md.

## Current follow-on validation

The follow-on source passes full API3807/17 skipped (876.46s), root browser87 (10.1m), V6 continuity21 (2.4m), final attribution proof1 (15.9s), and46 targeted contract/concurrency tests on each SQLite and portable PostgreSQL16.15/pgvector0.8.7. Full graph rollback and synthetic profile/resume/job preservation across identity downgrade/upgrade PASS; the safety tool refuses a populated or nonlocal/nonmatching database. Workspace tests/typecheck/lint/build/budgets PASS, with two existing lint warnings. Ruff PASS; mypy PASS291 modules. This supersedes the earlier local PostgreSQL block below; deployed staging, backup/restore, full-provider/hardware and hosted CI remain unverified.

Reviewed session unlink/reassignment and minimal association-history export/delete are now implemented; no source transcript/report/context is rewritten. Application timeline provenance distinguishes stored state from employer receipt. Immutable actual delivered-material lineage and full phase4+ are not complete.

## Initial foundation validation (historical checkpoint)

- API full suite: `uv run pytest -q` from apps/api: **3798 passed, 17 skipped, 1 warning**, 832.12 seconds. After this run a final text-only provenance correction distinguished candidate-recorded manual application from Orbit-executed delivery; affected suites `tests/test_auto_apply.py tests/test_candidate_identity.py tests/test_job_timeline.py tests/test_candidate_identity_migration.py`: **39 passed**, 29.66 seconds. The full suite was not rerun after that note-only correction.
- API `uv run ruff check .`: PASS. `uv run mypy orbit_api`: PASS, 290 source files. `uv run alembic heads`: single head `e62f8d0b351c`. SQLite full-graph upgrade/downgrade/upgrade, ownership, export/delete and master/job isolation are covered; PostgreSQL locking and migrations are not thereby certified.
- Workspace `corepack pnpm -r typecheck`, `-r lint`, `-r test`: PASS. Tests: web601, shared UI595, desktop82, extension41, worker Node7 + Vitest5. Lint retains two preexisting hook warnings in SupportChat and SessionSetup.
- Web build: PASS,151 prerendered pages. Bundle gate: PASS,22 budgets, thresholds unchanged. Entry169kB gzip; CSS32.5kB; JobsAiPages261kB. These are build measurements, not field Web Vitals. Existing api.ts dynamic-import warning remains.
- Root Playwright: `corepack pnpm exec playwright test --output=test-results/unified-pr-final`: **86 passed**,9.8 minutes. Git bundled OpenSSL added to PATH for fake ATS. Real Chromium/HTTP with synthetic accounts and mock providers, not live employer/provider verification.
- Deferred V6 flows: `corepack pnpm exec playwright test --config tools/e2e/business-automation.config.ts tools/e2e/personal-orbit-v6.e2e.ts tools/e2e/prep-continuity.e2e.ts tools/e2e/calendar-intake.e2e.ts tools/e2e/opportunity-guide.e2e.ts tools/e2e/employer-updates.e2e.ts --output=test-results/unified-pr-v6`: **21 passed**,2.7 minutes.
- Final mobile label layout refinement followed the full browser suite; the reviewed-identity cross-page journey and web build/budget were rerun separately. Their final results are recorded in UNIFIED_JOURNEY_PROGRESS.md; the full86-case gate predates that CSS-class-only refinement.
- Native baseline (Rust unchanged): cargo fmt/clippy PASS; cargo test55 passed/1 ignored. No signing/updater/audio hardware claim.

Baseline failures and intermediate mistakes are preserved in UNIFIED_JOURNEY_PROGRESS.md. Tests were not deleted, gates weakened or CI skipped. A changed disclosure/CTA selector does not remove the original route/security assertions.17 API skips and one existing TestClient deprecation warning remain visible.

## Privacy, security and migration

No new external send, scraping, recording retention, provider or dependency. Ownership and source/revision guards remain server-side. Resume import/review is explicit; job edits cannot implicitly promote to master. Old same-company sessions are suggestions until reviewed association. Input drafts stay in bounded tab memory; approvals are never restored. Account changes remount private state, invalidate late writes and notify other tabs through storage events and opaque BroadcastChannel notifications (including blocked-storage fallback).

Migration adds nullable review metadata to existing job_search_profiles; no destructive backfill or automatic approval. Old facts remain in versioned resumes. Default rollback is compatible UI/code revert while retaining the additive column. Export review metadata before a deliberate downgrade if history must be retained. No production downgrade without backup and operator approval.

## Remaining release gates and owner actions

- Local isolated PostgreSQL migration/locking tests now PASS for the current identity/association slice. Validate the deployment-specific PostgreSQL environment and any subsequent persisted round/receipt migrations before release. API tests use **ORBIT_TEST_DATABASE_URL**, not merely ORBIT_DATABASE_URL. Use a separate disposable DB with ORBIT_DATABASE_URL and test environment for Alembic, never production. A runnable command is `uv run alembic upgrade head`, then downgrade to d51e7c9a240b and upgrade head on that disposable DB; verify original rows and review metadata behavior.
- Provision isolated deployed staging with verified nonproduction endpoints/secrets and backup/restore evidence; run remaining J01–J16 and release gates there.
- Verify real LLM/STT/TTS, camera/mic denial/reconnect, costs/latency, permitted live assistance, Windows audio/signing/updater hardware and billing reconciliation with operator-approved resources.
- Finish immutable receipt/source lineage, all approved-identity consumers, explicit owned rounds/IANA/DST calendar history, offer/joining, remaining screen redesign and complete immutable association/source lineage.
- Complete real screen-reader/manual accessibility, actual browser200% zoom, all-state visual audit and field performance evidence. Counsel/operator review remains external where required.

Historical GitHub billing/spending blocks are not proof of current PR status. Inspect the new PR checks independently. Review approval does not remove the above production NO-GO.

Follow-on implementation commit be0c739b pushed to draft PR445. Its Actions run39565059170 executed no steps across six jobs; API check annotation again identifies account payments/spending-limit blocking. Resolve GitHub Billing & plans and rerun normal CI. No workflow was weakened, merge performed or manual deployment issued.
