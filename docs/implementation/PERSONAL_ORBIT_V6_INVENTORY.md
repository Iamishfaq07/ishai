# Personal Orbit V6 inventory

Increment-2 delta against `47bececf`: F04/F08 now include `job_portal/calendar_intake.py:events_from/calendar_preview` and `pages/jobs/CalendarIntake.tsx`, integrated into the existing message review hub and guided interview step. F05 reuses `plan_for` in `opportunity_coach.source` and the existing coach in `PrepPlanPanel`. No parallel dashboard, coach engine, database, worker or calendar sync. Classification remains PARTIAL for full F04/F05/F08 acceptance; the initial inventory below is retained as base evidence. See `V6_INTERVIEW_INTAKE.md`.

Inspected 2026-10-20 on Windows; source base `9c39e601` (PR #437 merged). The supplied ZIP is not in this workspace; current GitHub main is the code source. No archived counts are adopted.

## Repository facts

- `apps/web/src/pages`: 215 files matching `*` (working source only).
- `apps/api/orbit_api`: 284 files matching `*.py` (working source only).
- `apps/api/alembic/versions`: 66 files matching `*.py` (working source only).
- `apps/desktop`: 194 files matching `*` (working source only).
- `apps/apply-worker/src`: 10 files matching `*` (working source only).
- `packages`: 220 files matching `*` (working source only).
- `.github/workflows`: 3 files matching `*` (working source only).

## Confirmed audit priorities at base (resolution in PROGRESS.md)

- R01 VERIFIED DEFECT: wrangler.jsonc previews.vars.API_URL points at production; apps/web/.env.production also bakes direct REST and live production URLs. Both paths require isolation, not just proxy secret separation.
- R02 VERIFIED DEFECT: docs/LAUNCH_SIGNOFF.md describes Render free and unpromoted deployments; docs/DEPLOY.md/config point to Railway. Live topology is separate evidence.
- R03 ALREADY SHIPPED in code: main.py create_app readiness and credits.py tests reject absent production proxy trust. Deployed secret rotation is OWNER ACTION.
- R04 OWNER ACTION: staging accounts, DB restore, live billing/provider and Windows signing/hardware gates need distinct operator evidence.
- R05 ALREADY SHIPPED architecture: auto_apply plus apply-worker constrained ATS execution; do not replace with generic browser agents. Full adversarial validation still required.
- R06/R07/R08/R10: ownership, grounding, export/delete and redaction suites exist; whole-product acceptance NOT VERIFIED until baseline completes.
- R09 VERIFIED DEFECT: baseline pnpm -r test fails existing interaction policy on WeeklyStudio transition-all and ToolExplorer duration-300. Fix with existing motion scale, do not weaken test.

## Feature mapping

### F01 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/jobs/JobMission.tsx: JobMissionPage; GuidedOpportunity.tsx; apps/api/orbit_api/job_portal/mission.py. Classification describes reuse; it does not certify all acceptance criteria.

### F02 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/jobs/ActionDesk.tsx: JobActionDeskPage; autoapply/AgentConsole.tsx; apps/api/orbit_api/auto_apply. Classification describes reuse; it does not certify all acceptance criteria.

### F03 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/Evidence.tsx; apps/api/orbit_api/evidence; apps/api/orbit_api/auto_apply. Classification describes reuse; it does not certify all acceptance criteria.

### F04 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/jobs/MessageUpdate.tsx: MessageUpdate; resume import; AddJob.tsx (separate reviewed intake paths). Classification describes reuse; it does not certify all acceptance criteria.

### F05 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/jobs/PrepPlan.tsx; interview/InterviewPrep.tsx; existing dated plan/check records. Classification describes reuse; it does not certify all acceptance criteria.

### F06 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/jobs/autoapply/ApplicationReview.tsx; PacketDetail.tsx; apps/api/orbit_api/auto_apply. Classification describes reuse; it does not certify all acceptance criteria.

### F07 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/jobs/SearchInsightsPanel.tsx; WeeklyStudio.tsx; insights.ts. Classification describes reuse; it does not certify all acceptance criteria.

### F08 — EXISTS BUT NEEDS INTEGRATION

apps/api/orbit_api/job_portal/message_updates.py: preview/confirm; manual paste shipped; OAuth mailbox import MISSING. Classification describes reuse; it does not certify all acceptance criteria.

### F09 — RESEARCH-ONLY

apps/api/orbit_api/job_portal/sources; source freshness exists; candidate-reviewed source diff not yet verified. Classification describes reuse; it does not certify all acceptance criteria.

### F10 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/learn; pages/code; Evidence.tsx; no uncompleted exercise-to-claim promotion authorized. Classification describes reuse; it does not certify all acceptance criteria.

### F11 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/SessionDetail.tsx; packages/ui/src; transcript/report infrastructure. Classification describes reuse; it does not certify all acceptance criteria.

### F12 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/Mock.tsx; VideoInterview.tsx; SessionSetup.tsx. Classification describes reuse; it does not certify all acceptance criteria.

### F13 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/jobs/People.tsx; ContactResearch.tsx; CSV permission/expiry acceptance not verified. Classification describes reuse; it does not certify all acceptance criteria.

### F14 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/offers; current tax/benefits correctness NOT VERIFIED. Classification describes reuse; it does not certify all acceptance criteria.

### F15 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/resume; sharing exists; portfolio expansion RESEARCH-ONLY. Classification describes reuse; it does not certify all acceptance criteria.

### F16 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/jobs/CareerLaunchpad.tsx; CareerCompanion.tsx; fit sources. Classification describes reuse; it does not certify all acceptance criteria.

### F17 — RESEARCH-ONLY

No employer send authorization or provider integration verified; manual review remains default. Classification describes reuse; it does not certify all acceptance criteria.

### F18 — EXISTS BUT NEEDS INTEGRATION

STT/language configuration exists; multilingual quality/hardware NOT VERIFIED. Classification describes reuse; it does not certify all acceptance criteria.

### F19 — RESEARCH-ONLY

Granular mentor review consent needs design; existing share routes do not prove this acceptance. Classification describes reuse; it does not certify all acceptance criteria.

### F20 — ALREADY SHIPPED

apps/extension; scoped worker/API integration; regression baseline required. Classification describes reuse; it does not certify all acceptance criteria.

### F21 — EXISTS BUT NEEDS INTEGRATION

apps/api/orbit_api/workflow_ai.py; workflow_advice.py; typed bounded previews. Classification describes reuse; it does not certify all acceptance criteria.

### F22 — EXISTS BUT NEEDS INTEGRATION

apps/web/src/pages/jobs/CompanyPanel.tsx; research sources; no broad verified-company claims. Classification describes reuse; it does not certify all acceptance criteria.

### F23 — RESEARCH-ONLY

apps/api/orbit_api/business; separate tenancy exists; new campus integrations deferred. Classification describes reuse; it does not certify all acceptance criteria.

### F24 — RESEARCH-ONLY

apps/desktop/src-tauri Windows audio; no Mac release/signing claimed. Classification describes reuse; it does not certify all acceptance criteria.

### F25 — RESEARCH-ONLY

Local model feasibility requires separate measurements; no offline parity claimed. Classification describes reuse; it does not certify all acceptance criteria.

## Route and ownership map

`App.tsx` keeps public/product routes and authenticated Layout separate; JobsAiSection shares owned profile/tracker. `/jobs/mission/:entryId` calls jobMission(entryId), preserving the tracked job ID. `paths.ts` owns encoded deep links. ApplicationReview/PacketDetail retain packet identity and reviewed content; prepared is not submitted. BusinessRoutes remains a separate company context. HomePage currently duplicates launchpad/next-step navigation. First slice reuses the grounded progress projection rather than inventing another dashboard API.

Final inventory note: guided Application now projects the exact owned packet; Today/navigation integration and two existing baseline defects are resolved in this increment. Full acceptance and remaining gates are in BASELINE.md and PROGRESS.md. The Inventory classifications above describe the starting checkout, not a whole-feature completion certification.
