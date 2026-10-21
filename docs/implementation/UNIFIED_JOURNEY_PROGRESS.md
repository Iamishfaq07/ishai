# Unified journey progress — review checkpoint

## 2026-10-21: baseline and Phase 1 in progress

Base `e1426076`, clean checkout after merged PR444. New branch `orbit-unified-candidate-phase1-2026-10-21`. Previous increments4–7 were implemented without tests; their old status is historical, not validation. The current detailed owner instruction requires testing. No new skip-CI request.

### Commands actually run

- `corepack enable`; `corepack pnpm --version`:9.12.0.
- `corepack pnpm install --frozen-lockfile`:PASS. `uv sync --frozen` in apps/api:PASS (85 packages).
- Baseline `corepack pnpm -r typecheck`:PASS.
- Baseline `corepack pnpm -r lint`:PASS with five warnings (three from recent request-cancellation cleanup code; two existing SupportChat/SessionSetup).
- Baseline `corepack pnpm -r test`:FAIL. Web596 pass/1 fail, Tracker no longer discoverable for “interview”; UI595 pass, desktop82 pass, extension41 pass, worker node7 pass plus Vitest5 pass. Production keyword restored, test unchanged.
- Baseline `corepack pnpm --filter @orbit/web build`:PASS,151 prerendered pages. `corepack pnpm --filter @orbit/web budget`:PASS,22 budgets. Entry171.7/172 kB gzip, CSS32.5/32.6, JobsAiPages279.6/280. Those are base-code results, not final-change evidence.
- Baseline `uv run ruff check .`:FAIL,9 import/line-length errors in recent mission/coach/practice files. Fixes in progress. `uv run mypy orbit_api`:PASS,288 modules. `uv run alembic heads`:one head d51e7c9a240b before the new migration.
- Baseline `uv run pytest -q`:7 failed,3773 passed,17 skipped,1 warning,828.20s. Three stale saved-versus-sent label assertions; four migration checks encountered new-head prerequisites/expectations after the live graph changed during execution. It is not a pure immutable-base result. Those fixture/assertion changes preserve the actual safety checks.
- Desktop: direct `%USERPROFILE%/.cargo/bin/cargo.exe` (not originally on PATH); fmt PASS, clippy PASS, tests55 pass/1 ignored; doc/binary targets0 tests. These do not prove audio hardware, signing or updater behavior.
- Baseline `corepack pnpm test:e2e`:42 passed/2 failed/7 not run. Extension fake-ATS and live-coding failures require isolated diagnosis. A concurrent visual capture used the same default test-results folder and caused a trace ENOENT; do not attribute harness output collisions to product bugs. No baseline browser pass claimed.
- Before screenshots: `ORBIT_UNIFIED_BEFORE=1 corepack pnpm exec playwright test tools/e2e/unified-candidate.spec.ts`:13 passed/1 artifact-teardown failure. Images in screenshots/unified; manually inspected Today1440/light and My Career320/dark. Missing viewport evidence must be recaptured with an isolated output directory.

Detailed logs are in Windows TEMP, `orbit-unified-baseline-{typecheck,lint,frontend-tests,build,budget,ruff,mypy,api-tests,e2e,rust-fmt,rust-clippy,rust-tests}.log`, plus `orbit-unified-before-visual.log`. They are diagnostic local files, not public user data.

### Implementation

PARTIAL: explicit master/review metadata and typed identity projection; source/revision guards; no automatic approval; independent copy for selecting job resumes; proposed master/shared-job binding protection; new My Career identity layout and operational Today rewrite. API/UI tests, migration fixture updates and final screenshots still pending. No phase-complete or release-ready claim.

### Operator gates

Real LLM/STT/TTS/camera quality, Postgres concurrency/staged migrations, isolated deployed staging, production backup/restore, Windows audio/signing/updater and billing/legal/provider smoke remain UNVERIFIED. No real application, email send or production deploy performed.

## Integration work and fresh evidence

- DONE in code: explicit owned master/review projection, revision/fingerprint guards, account export and deletion coverage; independent master/job copies; Today/My Career rewrite and reuse by Discover.
- DONE in code: stable Opportunity Room with five contextual sections and More tools; legacy guide/tab query aliases retained, additional Jobs navigation suppressed inside the room. Existing packet review/execution engine retained.
- DONE in code: contextual Saba audio/video launch through existing session APIs, explicit job association and report return. Same-company history is a separate related_round suggestion; reviewed association checks both owners, rejects reassignment and is idempotent. Only linked ended sessions count completed practice/live progress.
- DONE in code: input-only reply/invitation drafts retained in bounded tab memory, no browser storage; logout/account change clears them and late writes are ignored. No approvals restored. Browser unload warning and explicit discard. Auth subtree remount and stale cache-write generation guard prevent old-account component state carrying forward.
- DONE in code: old/forged resume job URLs are checked against current owned room material before mounting the editor; legacy shared/master bindings require an explicit independent copy, with independent editing remaining an explicit choice.
- Fresh API identity/progress:20 passed. Subsequent mission/interview/timeline integration:51 passed/1 expected-behavior assertion updated to stop attributing same-company sessions. New migration/account-delete and final linkage checks tracked separately below.
- Fresh workspace suite: web601 passed90 files; UI595, desktop82, extension41, worker node7 plus Vitest5. Typecheck PASS. Lint PASS with two preexisting SupportChat/SessionSetup warnings after removing three recent cleanup warnings. Later edits require final rerun.
- First redesigned matrix:14 passed (light/dark,320/360/390/768/1024/1440/1920, Today and My Career, Motion Off); connected import journey initially failed due a new test’s wrong selector. Corrected selector; isolated rerun PASS,1 test16.2s including server startup.
- Dedicated SQLite identity migration upgrade/downgrade/upgrade:PASS,1 test5.05s after correcting the new fixture’s required created_at/updated_at values. Legacy metadata remains NULL and legacy profile is preserved. PostgreSQL remains BLOCKED: docker/psql/postgres not on PATH; C:/Program Files/PostgreSQL absent. No database URL/credentials for isolated PostgreSQL supplied.
- Build/budgets: initial new JobsAiPages280.4/280kB failed. Lazily loading the Opportunity Room reduced it to263.4kB; all22 budgets passed without raised thresholds. Fresh build after final safeguards is still required.
- Full root browser rerun includes OpenSSL on PATH for the fake ATS; extension and live-coding assertions have now passed. Full API and browser runs remain active; no premature full-suite pass claimed.

Current scope is the first independently reviewable integration slice, with parts of phases2/3 included. Later round/calendar authority, snapshot receipt/source associations, full consumer approval enforcement, hired/joining, broader screen redesign, complete J01–J16 and all operator gates remain PARTIAL/BLOCKED, not done.

### Verification corrections retained for audit

The first 68-case browser rerun finished67 pass/1 new draft-test failure: the test navigated back before the tracker screen committed, then toggled an already-open disclosure closed. Waiting for the destination and targeting its summary fixed it; isolated import/safe-editor/draft rerun2 PASS22.4s. The new editor guard initially omitted the Card import and its API response model initially omitted resume_requires_copy (Pydantic ignored the extra constructor key); typecheck and the browser guard path caught both. Both were repaired and the guarded legitimate edit path passed.

Deferred V6 browser run:17 pass/4 fail. Two were genuine selected-tab contrast failures (3.49 ratio under an accent); repaired with neutral high-contrast selected navigation. Two were legacy tests expecting a now-collapsed My Career utility without opening its disclosure; tests now exercise the actual disclosure while retaining the original route assertion. Rerun21 PASS2.8m, including calendar review, employer replies, source invalidation, editor round-trip and preparation reschedule/reuse.

A configured API run passed3795/17 skipped before final safety additions. Two subsequent long runs were deliberately interrupted after new safety code was added; they are not passes. A fresh frozen-source full run is in orbit-unified-final-scope-api.log. Final copy protection also avoids copying another employer’s JD/cover letter into a new opportunity: use this job’s already-saved owned text or cached listing, otherwise leave it blank. Focused copy/identity10 PASS; updated full run includes the regression.

An accidental root-directory mypy invocation did not load apps/api/pyproject.toml and reported363 errors. The actual configured gate, run from apps/api (`uv run mypy orbit_api`), PASS290 modules; no configuration weakened. Full Ruff PASS. All final results must be read from the last completed command, not from stale build/budget files.

## Final integration checkpoint — 2026-10-21

DONE for this bounded foundation: selected owned master/review, Today/My Career/Discover continuity, one job room, safe job copies/editor guard, contextual Saba/report return, reviewed session associations and bounded input drafts. Later phases remain partial as scoped in the plan.

Fresh final checks: API full3798 passed/17 skipped/1 warning (832.12s); final manual-application provenance note correction followed by affected API39 passed (29.66s). Ruff PASS; mypy PASS290 files; one Alembic head e62f8d0b351c. Workspace typecheck/lint/tests PASS (web601/UI595/desktop82/extension41/worker7+5), two preexisting lint warnings. Web build151 pages and22 unchanged bundle budgets PASS; entry169kB gzip, CSS32.5, JobsAiPages261. Native unchanged baseline55 pass/1 ignored, fmt/clippy pass.

Root browser86 PASS9.8m, isolated output unified-pr-final. V6 browser21 PASS2.7m, separate ports/DB/output unified-pr-v6. Additional reviewed-identity screenshot journey1 PASS18.0s before final mobile refinement. These are mock-provider/local Chromium results. Test logs are orbit-unified-final-scope-api.log, orbit-unified-final-provenance-api.log, orbit-unified-final-{ruff,mypy,typecheck,lint,workspace-tests,build,budget}.log, orbit-unified-pr-browser.log and orbit-unified-pr-v6.log in Windows TEMP.

The privacy regression was first reproduced red: tab A retained A's private resume after tab B logged into B. Storage-event plus same-origin BroadcastChannel sync now remounts/clears private state and guards late writes; both normal and blocked-localStorage browser cases pass. Notifications contain opaque identity IDs, not CV/profile text; the server remains authentication authority. No extra permission is requested.

Final manual provenance correction: candidate-recorded /done snapshots now say Candidate recorded applying from Orbit Apply, rather than claiming Orbit sent them. Existing worker-executed note remains. Regression asserts actual quota authority; no charge/status/execution logic changed. No historical receipt backfill inferred.

Screenshot manifest contains88 runtime PNGs with hashes. Manual filled320 inspection found midword resume-summary wrapping; use stacked metric rows below sm and rerun the affected import-to-Saba journey/build/budget. This final CSS-only refinement follows the86-case gate; results appended below rather than claiming the full suite reran.

NO-GO production. PostgreSQL, deployed isolated staging, live providers, real screen reader/zoom, backup/restore, hardware/signing/updater and remaining phase2–7 authority/journey work require further evidence. No merge, deploy, real send or credentials/provider result manufactured.

Final mobile refinement: reviewed-identity import/master/Discover/two-job/Saba browser journey1 PASS17.9s; web build151 pages PASS and22 budgets PASS. Updated populated320/390 screenshots copied byte-for-byte from unified-mobile-final; manifest regenerated88 PNGs. No further production edits after this checkpoint.
