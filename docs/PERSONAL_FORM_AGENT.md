# Personal Orbit agent mode

## What ships

Personal Orbit → Jobs → Application agent (`/jobs/journey`) now offers an opt-in **Agent mode** and a durable decision history. This adds model-assisted profile matching to the existing hosted application worker, rather than starting a second executor.

The complete existing flow remains: approve a master resume and facts → find matches or select saved jobs → prepare application materials → review first or apply automatically → hosted form execution → employer receipt and tracker update. The separate worker can run while the candidate's browser and device are off. Worker availability is shown in the dashboard.

The new AI tool operates on unfamiliar required **contact/profile text fields revealed in the live browser**. For example, “Share a link to your professional network” can select the approved `linkedin` fact. The model chooses a source key; the server copies its exact saved value. The model receives field labels and source descriptions, not the candidate's resume or saved contact values.

This is a bounded application agent for Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable and Recruitee. It does not add arbitrary website navigation, job-board account logins or a universal apply-to-any-link tool. Required questions found during initial preparation can still require the candidate's answer before entering the hosted queue. Screening questions, employer checks and unknown attestations remain candidate handoffs.

## Use it

1. Configure Personal Orbit Apply with an approved resume, confirmed profile facts, filters and limits.
2. Choose hosted execution and explicitly authorise hosted applying. Verify the account email and resume applying if paused.
3. Open Application agent and turn on Agent mode. Existing unsent packets are rebuilt against the updated permission snapshot before execution; normal pacing still applies.
4. Find and prepare matches, or send a saved shortlist to the agent. Review-first packets still wait for approval.
5. Follow Agent decision history and open the linked application for materials, questions and receipts.

Turning off Agent mode withdraws AI matching permission. **Pause agent** stops applying. A submitted application is recorded only after the existing submission checkpoint and employer confirmation; an AI match is never proof of applying.

## Browser integration and boundaries

- The worker uses its existing observe → fill → inspect loop. When required questions are unknown, `/v1/internal/apply/{packet_id}/questions` tries the exact answer bank first, then the new profile-matching tool when enabled.
- Only plain contact/profile text fields with a recognised field family can be proposed. Legal/EEO seeds, protected or sensitive labels, credentials, choices, dates, numbers, files and unavailable profile values cannot become AI matches.
- JSON decisions have a strict schema, known question ids, one source from that question's allowed family, no duplicate questions, no answer text and a confidence threshold of 0.98. Uncertain or invalid outputs leave questions unanswered. Confidence is a model assertion, not an accuracy guarantee; review mode remains available.
- A durable reservation is committed before model I/O. There are at most 10 eligible fields per observation, 3 observations per packet and 5 AI calls per account per UTC day. Failed calls count. Completed identical observations are replayed without another model call; pending/failed reservations never create an automatic retry loop.
- Both sides of model I/O check current consent, hosted permission, candidate/resume approval, attempt ownership, lease expiry, packet state, site pause and approval fingerprint. Revocation, pause or profile edits during a model call cancel the result. Agent permission participates in the fingerprint, including withdrawal.
- The model cannot return browser commands, selectors, code or a submission decision. Existing employer URL isolation, CAPTCHA/login handoffs, quiet hours, quota holds, per-company limits and once-only submission fencing remain in the worker/API.
- A replaced/crashed lease may leave an “Observation reserved” entry. That label records a reservation and does not assert that a worker is currently running. A retry still needs the existing packet recovery rules.
- History stores labels, source key names, state, timestamp and provider, never a second copy of the fact values. Mock provider decisions are labelled simulated in the UI. Existing account export includes the setting/history and account deletion uses the existing owned-row cascades.

## API and deployment

- `GET /v1/apply/agent`: current user's setting, UTC-day allowance usage and the latest 20 applications with agent observations.
- `PUT /v1/apply/agent`, `{"enabled": true|false}`: full signed-in account; enabling requires a verified, authorised hosted setup. Extension-scoped tokens cannot use these routes.
- Private worker endpoints retain worker-secret plus per-attempt authentication. No new public executor endpoint or browser credential is introduced.
- Migration `91bd47e8c2a0` adds `AutoApplySetup.agent_mode` (default false for existing accounts) and nullable `ApplicationPacket.agent_decisions`. Apply migrations with the normal release process.
- Uses the deployment's configured LLM provider and existing telemetry/budget reservations. Mock mode is for fixtures/development. Hosted execution still requires the existing separately running apply worker and worker secret; this PR does not provision or deploy them.

## GitHub research

Inspected on 2026-10-20; no external agent package, script or source code was copied or executed.

- [Browser Use job application example, pinned `aa093a8`](https://github.com/browser-use/browser-use/blob/aa093a843da5edbf323c0b4145c9b6a0db3ecde8/examples/use-cases/apply_to_job.py): uses browser tools to extract a form, fill it and check completion. The repository has an MIT licence. Its example's fallback for missing information is unsuitable for Orbit's approved-facts model. Orbit adopts the observe/act/confirm structure while limiting AI to source selection.
- [Job Agent MCP filler, pinned `04bd6f8`](https://github.com/lordvacuum/job-agent/blob/04bd6f8acec7610bc44a4f8428b904684ddcf1b9/job_agent/application/mcp_filler.py): inspected its Claude/Playwright MCP orchestration and dry-run/submission prompt. The repository licence endpoint returned 404, so none of its code is reused. Orbit retains its own isolated worker, durable attempt fences and explicit answer bank.
- Earlier application/discovery research, including MadsLorentzen's resume/application workflow, is recorded in [APPLICATION_AGENT_DISCOVERY.md](APPLICATION_AGENT_DISCOVERY.md). That repository is a workflow reference, not Orbit's hosted submission runtime.

## Verification

All browser job pages in tests are local/intercepted fixtures. No real employer receives an application. Tests cover profile matching, model-output rejection, sensitive questions, permission/profile changes during AI, replay and concurrent reservations, call limits, account isolation, extension scope denial, migration defaults/rollback, mobile/desktop controls and accessibility, plus the real headless worker's fill/checkpoint/confirmation loop.
