# Enterprise hiring automations

The Business **Automations** workspace turns outstanding hiring work into persistent, assigned tasks.
It complements the hiring desk, interview studio, offers and joining plans. Personal Orbit is unchanged.

## Set up a role playbook

1. Open **Business → your company → Automations** and select a job.
2. Select the follow-ups and elapsed-time targets. All automations default off for existing and new jobs.
3. Optionally choose a default coordinator. Available owners are current owners/admins/recruiters, plus hiring
   managers on that job's hiring team. Unassigned tasks stay visible in the shared queue.
4. Use **Preview conditions** to count current signals without creating work. Preview includes already-handled
   source conditions; it is not a count of new tasks. Zero/unchecked rules are omitted.
5. Enable and save the playbook. Saving reconciles immediately. **Run saved playbook now** uses saved settings.

Targets use calendar hours/days in UTC, including weekends. UI dates display in the viewer's local time zone.
Choose a specific job to edit its playbook; the all-jobs view aggregates accessible tasks.

## Automatic follow-ups

- **Stalled pipeline:** one task for an active candidate whose current stage has not changed within the target.
  A subsequent stage-change episode can generate a new task.
- **Candidate questions:** one task per unanswered saved question after its target. Only a reply to that question
  clears the signal; sending a generic email does not.
- **Interview feedback:** one task per latest scheduled interview after its end plus the target, if a planned
  criterion stage is missing submitted feedback from a panel member. Private drafts do not count as submission.
  The interview plan's current applicable stage follows the same selection used by the hiring desk.
- **Assessment review:** one task per completed work sample, completed Saba interview or alternative interview
  request that has not been followed by a recorded human hiring decision.

Rules read workflow state and timestamps. They do not use resume scores, identity signals, nationality, VPN
information or private feedback text to decide who should be hired. They create internal tasks, not candidate
emails, automated rejections, stage changes, employment offers or calendar bookings.

## Work the queue

- Filter by job, status or **Assigned to me**. Open/overdue/snoozed/handled counts follow your access and filters.
- Expand a task to assign an owner, snooze it (up to 30 days), mark it handled or reopen it. Each change needs a
  short reason and checks the task revision, so a stale tab cannot overwrite another coordinator's update.
- Marking handled records your follow-up. It does not make a hiring decision or clear the underlying signal.
  Repeated runs do not recreate handled tasks for the same source episode.
- Automatic tasks resolve when their source clears, their rule is disabled, or the application/job stops being
  active. Re-enabling a rule can reopen a resolved task for the same still-live source, preserving its ID.
- Custom follow-ups can be added from an application with a due date. These remain open until handled, unless
  the application/job becomes inactive. Reopening a job does not automatically recreate resolved custom work.
- Task creation with an owner and assignment changes produce an internal Orbit notification. No email is sent.
  Changing the playbook's default owner applies to newly created tasks. A removed/ineligible owner is unassigned
  on reconciliation; the team's shared queue remains responsible for it.

Job access applies to every endpoint. Interviewers cannot configure or work the coordination queue. Blind review
masks candidate identifiers in titles and task notes. Public candidate activity excludes internal task events.
Private peer task notes follow the independent-feedback visibility gate. Application deletion also removes tasks.
Configuration, human actions and automatic creation/resolution are recorded in the company audit log.

## Runtime and deployment

Run `alembic upgrade head` before deploying the API. Migration `58ca94f2d7e3` adds `biz_automations` and
`biz_hiring_tasks` after the personal hosted-apply migration `47b9e3d0a6f2` (PR #414). Merge #414 before this stacked
PR. Enterprise automation itself needs no new service, secret, provider, subscription or dependency.

The existing API lifespan starts a new internal loop after 30 seconds, then runs approximately every five minutes.
It processes all due configured jobs, one company-locked transaction per job, with application scans in keyset
pages of 200. Large sweeps take longer than five minutes. Multiple API replicas share the lock and last-run
timestamp; unique application/source keys also prevent duplicate task rows. A failure is isolated to its job and
logged for retry on the next sweep. Suspended companies do not run. The API must stay running for background
automation; a sleeping or stopped API cannot reconcile tasks. The UI shows the last successful reconciliation.

Queues are snapshots, with 50 tasks per page ordered by due time and task ID. Refresh after changes to queue
filters or concurrent work; an invalidated page cursor asks for a refresh. Terminal application/job state blocks
task writes immediately; background reconciliation closes the pending tasks on its next run.

Rollback: turn off playbooks first, then deploy the previous API and downgrade migration `58ca94f2d7e3` to its
parent. Downgrade deletes automation settings and tasks; it preserves applications, interviews and hiring plans.
No production migration or live candidate communication is performed during development.

## Verification

Focused HTTP tests cover opt-in/preview, deduplication, background runs, concurrent saves and runs, lifecycle
cleanup, question-specific resolution, feedback/assessment completion, snoozing, invalid owners, blind review,
tenant/job permissions, suspended companies, manual-task retry and paging beyond 200 applications. A migration
test exercises upgrade/rollback/re-upgrade without enabling recipes. Browser tests cover preview → activation →
handled work → custom task on desktop/mobile, with accessibility and overflow checks. CI includes PostgreSQL
workflow tests and the browser flow.
