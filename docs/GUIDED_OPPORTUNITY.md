# Guided opportunity workspace

## Candidate flow

Opening a tracked job without an explicit tool opens five guided steps: Resume, Fit, Application, Interview and Outcome. The starting step follows recorded status: interviews open Interview, offers/closed records open Outcome, an applied job with a linked resume but no sent version opens Resume, and a saved job starts with linking its resume before reviewing fit. The selected step is recorded in the URL so ordinary updates do not move someone away while editing.

- All five steps can be opened immediately. Navigation never marks a stage complete, freezes a resume, generates AI content, enables automation or sends an application.
- Existing panels and mutation APIs are reused. The full workspace toggle retains the current tool; existing explicit `?tab=` bookmarks keep their existing full workspace view unless `guide=1` is requested.
- The resume step opens the existing guided editor with a validated job context. Save & return to job awaits the existing serialized save queue and retains the save error/conflict, stale route and changed-draft guards. It does not automatically link a new resume or approve one for an application.
- Step changes focus the heading and scroll below the sticky header. Icons and numbered indicators explain the sequence. Transitions respect reduced motion.
- The job/mission refresh on returning to a visible tab. The coach refreshes its source on return and every minute while open and visible, without starting model calls. Changing step, resume, fit, sent versions, offer or recorded status discards guidance tied to the previous context.
- For a job without a live listing, the suggested fit action opens its saved job details rather than a missing listing page.
- Mark as applied still requires the candidate's explicit action. Copy no longer describes a linked resume as proof of readiness. Hired records stop receiving the mission's apply/fit next-step suggestions.

## Optional opportunity coach

`GET /v1/jobs/tracker/{entry_id}/coach` reads an owned opportunity's resume link/version, prior fit check, frozen resume count, relevant application needing input, date indicator and linked offer indicator. Up to three requirement labels from an earlier fit check can ground evidence-review or practice suggestions. Requirements are explicitly labelled as prior-check material; the check may have used another resume.

`POST /v1/jobs/tracker/{entry_id}/coach/plan` takes a source version and one of the five step identifiers. It uses the configured LLM provider and the existing durable preview quota (five per user per UTC day, including failures). Permission and source checks happen before reserving quota; after generation the source is queried again, bypassing session identity caching.

Advice must use known fact IDs and exact source quotes, and explain the selected step first. Duplicate sources, unsupported quotes, wrong focus and unknown output fields are rejected. Paths come from the server's owned records rather than the model. An application awaiting input links to its exact review packet. Closed jobs do not surface stale application review actions.

Job titles, company names, contact values, notes, raw resume content, fit-check resume quotes and offer compensation are not included as model facts. Recorded field presence and stages do not verify skills, readiness or employer outcomes. The coach only proposes reviewable next steps or practice work; it has no write or submission tools.

## Review

1. Open a tracked job without a `tab` query; choose a resume.
2. Edit it from the guided link, save, and confirm return to the same job.
3. Continue through all five steps and check that the application stays at its original stage.
4. Open Get help with this step and explicitly request advice. Opening the panel alone must not call AI.
5. Change the job in another tab and return. Outdated guidance should disappear and recorded status should refresh.
6. Toggle all job tools and check old deep links. Test phone overflow and keyboard focus.

Browser verification uses the labelled mock provider, not paid live-provider calls. No schema migration or new external service is needed.
