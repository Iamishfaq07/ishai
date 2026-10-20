# AI workflows for personal Orbit and Business

Opt-in personal follow-up rules now feed the Action desk and its AI brief; see
[Outcome playbooks](OUTCOME_PLAYBOOKS.md#personal-orbit).

## Personal Orbit: Action desk

Open **Jobs → Action desk** (`/jobs/actions`). It automatically assembles saved next-step dates within seven days,
overdue interview outcomes, contact follow-ups, and Orbit Apply packets that need answers, review or a manual handoff.
Actions open the existing Mission Room, Outreach People section or application detail. Resolving, removing or
rescheduling the original record updates the queue; there is no second task list to keep in sync.

The screen refreshes every minute while visible and on window focus. Sources remain in the database when the
browser closes; this feature computes the queue when requested. It does not introduce a background notification
service, send messages, submit applications or retry uncertain submissions. Existing hosted auto-apply is unchanged.

**Build my AI brief** proposes up to five practical next steps from the first 30 actions. Each suggestion must name
an existing action and quote its title or description verbatim. Links come from server-built source records, never
model output. Suggestions are rendered as text. This verifies references, not every semantic claim in the generated
suggestion; people still review suggestions in the source workspace.

Results are rejected if the source queue changes during generation. Refreshing the screen also invalidates an older
brief. The queue displays at most 100 actions and explicitly indicates truncation. Dates are stored in UTC and
displayed in the browser's locale. A passed interview date prompts recording an outcome rather than claiming an
interview occurred.

## Business: interview plan composer

Open a job's **Interview plan → Draft interview plan with AI**. It reads the saved job's title, must-have requirements,
first 16,000 description characters, available stages and current saved interview plan. The AI proposes questions,
probes, rating anchors, discussion times and optionally a practical challenge. Every criterion must cite an exact
quote from the saved job. Candidate resumes, identities and private feedback are not inputs to this operation.

The preview validates the existing HiringPlan contract, stage membership, unique criterion IDs, full source coverage,
independent feedback and job-related questions/guidance. Existing fairness checks apply to questions and challenges.
**Use this draft in the editor** changes only the local editor; **Save interview plan** uses the existing versioned
save. Local changes invalidate a preview, including changes made while the request is in flight. Job changes during
generation or between preview and saving reject the stale draft. Existing interview feedback keeps its saved version.

Only members who can manage the job, or its assigned hiring manager, can generate. Company suspension, membership,
job scope and plan/source revisions are checked; membership and job access are checked again after the model call.
This feature designs interviews. It does not score candidates, decide hiring outcomes or change Saba.

## Provider, costs and failure behavior

Both use the existing configured LLM provider and a new small shared preview runner. Model input is fenced as
untrusted data. Each attempt has a 60-second timeout, a 3,000-token output ceiling and no automatic repair/retry loop.
Mock-provider output is visibly labelled **Demo AI**; production needs the existing real-provider configuration.
The test and screenshot evidence uses the mock provider, not a live paid model.

Durable ProviderRequest reservations limit personal briefs to **5 attempts per account per UTC day**, and Business
plans to **10 attempts per company per UTC day**, shared by its members. Failed attempts count toward these limits;
they do not spend resume or application credits. Reservations are committed under account/company locks before the
network call, so concurrent requests and restarts cannot bypass the allowance. Provider/model/token/cost/latency and
success metadata are recorded; prompts and generated drafts are not stored in that ledger. There is no new schema
migration. Provider failure leaves saved work and the manual workflows available.

## Open-source research (19 October 2026)

This is an independent implementation using Orbit's existing models and UI. No third-party code or dependencies
were copied or installed. Selected primary sources inspected at pinned revisions:

- [JobSync task queries](https://github.com/Gsync/jobsync/blob/2bd2284879d2037883cbd21ee3283cf27138a671/src/actions/task/queries.ts)
  ([MIT](https://github.com/Gsync/jobsync/blob/2bd2284879d2037883cbd21ee3283cf27138a671/LICENSE)):
  user-scoped task queries, due-date ordering and a shared application workflow informed the action queue.
- [Career OS provenance checker](https://github.com/Shanupower/career-os/blob/586f0e21ee6a0770eb9d8b5b31b91f775764d042/python/resume_generator/provenance_checker.py)
  ([AGPL-3.0](https://github.com/Shanupower/career-os/blob/586f0e21ee6a0770eb9d8b5b31b91f775764d042/LICENSE)):
  checking generated content against source facts informed exact requirement quotes and action references.
- [Frappe HRMS interview workflow](https://github.com/frappe/hrms/blob/837bf86073b121195c21554a1d1de4d90e35081f/hrms/hr/doctype/interview/interview.py)
  ([GPL-3.0](https://github.com/frappe/hrms/blob/837bf86073b121195c21554a1d1de4d90e35081f/license.txt)):
  linked interview rounds, expected skills, explicit outcome updates and feedback reminders informed the lifecycle
  review. Orbit already has interview coordination and Business reminders; this batch extends plan design and
  personal next-step discovery rather than adding duplicate systems.

## Verification

- `apps/api/tests/test_workflow_ai.py`: source ownership, automatic resolution, links, fabricated IDs/quotes,
  invalid/protected criteria and guidance, stale records and saves, concurrent allowance use, shared company budgets,
  authentication, email verification, revoked access and provider failure. Included in CI's PostgreSQL lifecycle run.
- `tools/e2e/workflow-ai.e2e.ts`: real API + browser flows on desktop/mobile, reviewed plan saving, local and in-flight
  edit protection, personal briefs, filters, source resolution, accessibility, overflow and reduced motion.
- Existing Business automation/coordination and personal tracker/contact/preparation regressions remain relevant.
  Screenshots are in `docs/screenshots/workflow-ai-*`.

No live external applications or messages are sent by these tests; mail goes to a local test outbox.
