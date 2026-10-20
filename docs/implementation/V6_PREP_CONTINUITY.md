# V6 increment 3 — preparation that survives a changed date

Date: 2026-10-21. Base `822c7d49` (PR #439 merged). Extends F05 using the existing opportunity, prep-plan builder/checks, practice links and opportunity coach. This is a review increment, not whole-V6 completion.

## Candidate workflow

1. Prepare → a saved job → Prep plan. A confirmed future date gives a scheduled plan. Without one, choose a three-day rehearsal path; no date is written to the tracker and no interview is implied.
2. A single suggested next task comes from the first unchecked item, with a contextual Start link. The current day is open. Future days and completed history are progressively disclosed, reducing scrolling.
3. Check a task after doing it. Orbit stores the task text, kind, planned day and recorded interview instant beside the existing checkmark. This records candidate activity, not verified competence or employer approval.
4. When the interview date/time changes, Orbit builds the new schedule and retains earlier completions in this job's history. It does not silently mark new tasks complete.
5. For exactly matching research or requirement-drill tasks, **Review earlier work** shows the earlier recorded task/date. The candidate checks the current job/materials, explicitly confirms it still meets the task, then chooses **Use this preparation**. A new completion references the earlier row. Repeated story-writing, mock practice, review, queue drills, warm-up and logistics cannot use this shortcut.
6. Optional interview guidance reuses the existing AI coach, now with the checklist's browser offset, rehearsal/scheduled context, completion count and unchecked tasks. Reading/opening does not call a model. The existing explicit request and five-request UTC-day quota remain authoritative.

## Implementation and truth boundaries

- `job_portal/plan.py` still owns scheduling, checks and account ownership. Scheduled plans remain bounded to14 days and3 tasks/day. Rehearsal is3 days, with no `days_before` interview countdown and no invented appointment. Closed/offer outcomes show history, without an active plan.
- New clients opt into rehearsal with `rehearsal=true` on plan reads/check writes. Requests without it retain the old empty no-date/past-date behavior, protecting older clients. Current routes and scheduled-plan API remain available.
- Keys bind planned day/kind/ordinal, a96-bit content digest and64-bit schedule digest within the existing64-character column. A moved instant or changed task text gets a new key. An obsolete loaded key is rejected; it cannot tick a different requirement occupying the same position. Failed UI saves clear reuse confirmation and refresh the plan.
- Existing checkmarks keep their original keys. Old records without task details appear as legacy history; Orbit does not invent their original content or automatically map them to current tasks. The candidate may do/review a task and record a fresh completion.
- A reuse request must name a completion owned by the same candidate and job, with matching kind/title/detail and an eligible kind. Source snapshots are server-derived; clients cannot submit task metadata. Unique job/key constraints keep duplicate completion writes idempotent. Rescheduled/changed-content keys are revalidated against the current plan.
- Completion history shows the latest50 records and the total count. Account export includes all records. Current task uncheck removes that completion; job/account deletion cascades all snapshots. Reuse creates a separate candidate-confirmed record; removing an original does not erase the copied record. There is no new retention period, sharing, analytics event, OAuth permission or external send.
- Coach guidance uses the same bounded browser offset as the checklist, replacing the prior UTC-only discrepancy. Source versions include the plan, history counts and supplied offset; completion and schedule changes invalidate guidance and are checked again after generation. Only grounding facts (saved-date/rehearsal context, counts and unchecked task text) reach the model. Historical task bodies remain outside model input.
- The UI's completion progress is a count of checked tasks, never a readiness/hiring probability. The plan does not observe completed practice automatically or infer a skill from a checked item. No notification enrollment, applications, calendar writes or live-interview concealment is added.

## Migration and release order

`d51e7c9a240b`, parent `c407e21a6d93`, adds nullable JSON `job_plan_checks.task_data`. It does not rewrite existing rows, keys, ownership or foreign keys. No new table/dependency/secret. Export's existing row serialization includes the column. Isolated migration tests retain legacy rows across upgrade/downgrade/re-upgrade; full-graph tests converge from either prior branch. Old stamped migration fixtures now include the actual pre-existing check table before upgrading to the real head; no migration error is suppressed.

Deploy the additive API migration/backend before the new web client. Old cached task keys may need a plan refresh after rollout; obsolete keys fail safely. For rollback, prefer reverting UI/code while retaining the additive nullable column and stored completion context. Downgrading the schema drops snapshot metadata (but retains checkmark rows); take/export a backup before any operator rollback. No real database migration/deployment was performed in this task.

## Remaining F05 work

This supports chronological interview date changes and history, not a new explicit multi-round calendar entity. Offline sync, per-item snooze/rejection, new reminders/notifications, historical completion editing, automatic practice-event matching and richer company/round adaptation remain later reviewed slices. The browser offset is the existing minutes-east-of-UTC contract; it is not a new IANA timezone or DST-aware calendar scheduling engine. History retention does not mean all previous work satisfies a new round.

## Verification and sign-off

Exact local commands/results and remote limitations are in `BASELINE.md`; visual captures are in `SCREENSHOT_MANIFEST.md`. SQLite/mock-provider evidence does not certify Postgres, managed staging, real providers, payments, hardware or launch readiness. CI keeps Postgres migration roundtrips and adds the continuity lifecycle suite there. No merge or manual deployment is authorized by this implementation.
