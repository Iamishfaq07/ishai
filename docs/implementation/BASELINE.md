# V6 baseline and verification — 20 October 2026

Source base: `9c39e601`; Windows, PowerShell, Node24.21.0, pinned pnpm9.12.0 through Corepack, Python3.12.13, uv0.11.28, cargo1.98.1. Installed global pnpm11 is not the repository version; use Corepack. Cargo was found at the user's .cargo/bin after checking PATH. No provider key, database credential or payment secret is recorded here.

## Initial baseline (before feature changes)

- `pnpm -r typecheck`: PASS.
- `pnpm -r test`: FAIL existing interaction policy; WeeklyStudio used transition-all and ToolExplorer duration-300. Both fixed to existing tokens/property transitions; policy unchanged.
- API `pytest -q`: **3730 passed, 2 failed, 17 skipped**, 779.83s. The two old isolated migration fixtures stamp an earlier schema but omit application_packets/auto_apply_setups now altered by descendant revisions. Their prerequisite fixture tables are repaired; upgrades still target real head, downgrade/re-upgrade and retained rows still checked. Full graph convergence tests unchanged.
- Initial root browser attempt: blocked by global pnpm11 and stale persistent e2e.db. Restored lockfile dependencies with pinned pnpm9; root config now invokes repository-local Vite and uses a disposable database per run, matching the existing focused fixtures. No old local database was deleted.

## Final local results

Commands use `node <Corepack pnpm.js>` where pnpm is shown; local API .venv executables where pytest/ruff/mypy/alembic is shown. Logs reside under the session's Windows TEMP directory with names below.

- `pnpm install --frozen-lockfile --offline`: PASS; forced offline reinstall with the same lockfile repaired global-pnpm interference. No dependency/lockfile update shipped.
- API `uv sync --frozen --offline`: PASS, 85 packages checked.
- `pnpm -r typecheck`: PASS (web, desktop, UI, types, extension, apply worker).
- `pnpm -r lint`: PASS, 0 errors; two existing hook warnings (SupportChat.thread and SessionSetup.applyWorkspace) retained.
- `pnpm -r test`: PASS. UI595, web597, desktop82, extension41, apply worker7 Node tests +5 Vitest tests.
- API `ruff check .`: PASS. `mypy orbit_api`: PASS,284 source files.
- API **`pytest -q`:3734 passed,17 skipped**,851.59s. Log `orbit-v6-api-final.log`. Skipped cases are not certified as passed.
- Focused API mission/progress/opportunity/message/credit/security/resume/query suites:93 passed. Log `orbit-v6-api-focused-final.log`.
- Migration fixture/full-graph subset:5 passed, including either parent to one merged head and rollback/re-upgrade. `alembic heads`: one head `c407e21a6d93`. Log `orbit-v6-migrations.log`.
- `cargo fmt --check`: PASS. `cargo clippy --locked --all-targets -- -D warnings`: PASS. Offline attempt initially lacked static_vcruntime; normal locked resolution succeeded, no Cargo.lock change. `cargo test --locked`:55 passed,1 ignored (manual folder-frame capture helper); doc/main targets0 tests. Logs `orbit-v6-rust-fmt.log`, `orbit-v6-rust-clippy-online.log`, `orbit-v6-rust-test.log`. Unit tests are not microphone/device/installer verification.
- `pnpm --filter @orbit/web build`: PASS,151 prerendered files. `node apps/web/scripts/bundle-budget.mjs apps/web/dist`: all22 budget lines PASS. Log `orbit-v6-build-final.log`. Entry171.6/172kB, CSS32.4/32.6, Home187.7/213, CareerSpaces173.6/213, Jobs276.1/280, ResumeEditor252.6/255. Existing ceilings unchanged; new lazy CareerSpaces uses the existing Home ceiling. This is not measured p75 Web Vitals.
- `git diff --check`: PASS.
- `python tools/release/personal_orbit_report.py --output <TEMP>/orbit-v6-release-observations.json`: PASS; source/tool observations only, no tests implied.

## Browser verification

All calls use local mock API/ATS, synthetic users and local outbox. No employer application or external email/payment was sent.

- `pnpm exec playwright test -c tools/e2e/business-automation.config.ts personal-orbit-v6.e2e.ts career-flow.e2e.ts daily-focus.e2e.ts opportunity-guide.e2e.ts`: **12 passed**,1.3min. Final log `orbit-v6-journey-final.log`.
- `... guided-resume.e2e.ts`: **5 passed**,30.6s. Log `orbit-v6-guided-final.log`. An earlier combined visual run found real save-version contrast3.39:1; removed its opacity reduction and reran all five scenarios. No Axe rule was disabled.
- Root `pnpm test:e2e`:43 passed; one beforeAll fixture failed because OpenSSL was installed but absent from PATH, preventing7 further cases. Exposed Git's existing OpenSSL to this command's process PATH only; **all8 extension-autoapply cases passed on targeted rerun**,56.1s. Logs `orbit-v6-root-e2e.log` and `orbit-v6-extension.log`. Thus51 root scenarios passed across these two runs; do not describe the initial full invocation as green.
- 320/1440 returning-candidate journey: Today → exact reviewed kit → same job preparation → Back; no submission/status mutation. Prepare/My Career deep links and phone focus restoration.
- Empty Today captures320,360,390,768,1024,1280,1440,1920 at light/dark and explicit Motion Off; Axe at320/390/1440. Failure/retry and no automatic plan/brief/profile-suggest requests verified. Existing opportunity focus/scroll, source invalidation and save-race regressions retained.
- Preview unit tests cover proxy writes/reads, employer rendering, blank configuration, scheduled fetch suppression, trailing-dot hosts, production-build direct/live fallback and isolated-upstream redirects into production.

## Gates outside this local result

- **BLOCKED remote CI**: GitHub billing annotation on main run39435380739. Check the review PR separately; no local result substitutes for remote execution.
- **BLOCKED Postgres/staging verification**: Docker unavailable; no disposable managed DB credentials/provisioning. CI retains Postgres service and now explicitly upgrades/downgrades/upgrades and runs mission ownership regression there. These new CI steps were not executed locally.
- **OWNER ACTION**: independent staging service/domain/database/secrets/OAuth/sandbox payments and Access, documented in STAGING.md. No infrastructure was provisioned/deployed.
- **NOT VERIFIED**: production signed-in browser, real-provider failover/live audio, payments, backup restore/load, actual Windows devices/installer/Authenticode/updater, extension store packaging and manual screenreader audit. Mock/virtual browser tests do not satisfy these gates.

Read-only deployed health/readiness observations, captured independently, are in releases/2026-10-20-verification.md. No whole-product GO is inferred from this baseline.

## Review snapshot

Implementation commit: `f0dc41a83e47fbb959540377d93dcb6222fceea9`; review PR [#438](https://github.com/Iamishfaq07/ishai/pull/438), OPEN and not merged. Fresh GitHub CI run `39448349628` did not execute: API check `118716183300` and frontend check `118716183741` both explicitly report account payment/spending-limit failure. This is not a test-result failure from those runners. Workers Builds was IN_PROGRESS when observed; no passing deployment is claimed. No manual deployment or merge was performed.
