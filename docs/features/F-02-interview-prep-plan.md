# F-02 · Interview prep plan with countdown

**V6 update, 2026-10-21:** the initial specification below is historical. Current task keys also bind content and schedule; completion snapshots survive date changes in owned history. Matching research/requirement preparation can be explicitly reviewed and reused; repeated practice/logistics remain fresh. New web clients opt into a date-free rehearsal plan with `rehearsal=true`. The existing AI coach uses the checklist's browser offset. See `../implementation/V6_PREP_CONTINUITY.md` for exact scope, additive migration, rollout and remaining F05 work.

**Job to be done:** "My interview is on Tuesday. What do I do each day until then?"

## Scope
- In the Job Mission Room, a **Prep plan** tab. It opens first when the job is applied or interviewing and has a date.
  Home's "Coming up" shows the nearest plan's progress ("Prep plan for Hooli: 3 of 11 done").
- `GET /v1/jobs/tracker/{id}/plan` gives the days from today to the interview (the last 14 when further out), up to 3
  tasks a day. The day of and the day before are light: warm-up, logistics, review. Earlier days take:
  - one open requirement from the fit check each day ("Prepare an example for: Kubernetes");
  - a mock round every other day;
  - the practice questions due again (the existing spaced-repetition queue);
  - STAR stories until there are three;
  - a first-day re-read of the post.
- Ticks go through `PUT /v1/jobs/tracker/{id}/plan/checks/{key}` and are stored in `job_plan_checks`. A key names its
  day and task. When the date moves, the plan is rebuilt: a tick stays only on a task that's still in the new plan
  (today's re-read, say), and ticks on the old interview day's tasks don't carry over. Ticking twice is a no-op. A
  key that isn't in the current plan gets a 404.
- Days are the person's own (`tz_offset` from the browser).

## Not in scope
Reminders or notifications (the brief says opt-in; later), calendar import, AI-written daily plans.

## Data, privacy and cost
- New table `job_plan_checks`: cascades with the job and the account. Unique per job and key. In the export as
  `job_search.prep_plan_ticks`.
- Migration `c8e0a2b4d6f8`: up, down and up again on SQLite and Postgres 16.
- No AI calls, no cost. Owner checks on every route, per-user rate limit `jobs-plan`.

## Truthfulness
The plan lists tasks and counts ticks. It never scores readiness. A gap task says "only from what you've really done".

## Acceptance
- `tests/test_job_plan.py`: the builder, far and past dates, no date, ticks, a moved date, privacy and export. Passes
  on SQLite and Postgres.
- Vitest for the link and day-label helpers.
- Playwright: tracker → mission room → plan tab → tick, Home line, 390 px.
