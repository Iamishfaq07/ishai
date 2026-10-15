# F-01 · Job Mission Room

**Job to be done:** open a saved job and within 30 seconds know three things: what to do next, what evidence supports
this role, and exactly which resume version was sent.

## Scope
- Page `/jobs/mission/:entryId` (one tracker entry). Linked from the tracker card, the job page (once tracked) and
  Home's "Coming up".
- **Stages:** Discover, Prove, Prepare, Apply, Interview, Negotiate. Each is done only when a record exists
  (`job_portal/mission.py::stages_for`). There's no percentage and no readiness score.
- **Next step:** the first gap, with a sentence saying why (`next_step`). "Not now" hides it for 3 days for this
  account and job on this device.
- **Evidence & fit:** the latest fit check, requirement by requirement. The job's own words are quoted next to the
  resume (or evidence) line that shows each one. A requirement the resume doesn't show says so and adds "add it only
  if it's true".
- **Resume kit:** link one of the account's resumes and **freeze** it as the version sent (`resume_snapshots`). A
  frozen copy outlives edits and deletion of the resume, and can be opened again as a new resume.
- **Practice:** practice and live rounds counted from the job's timeline, and a practice link built from this job.
- **Timeline:** the existing journey (`GET /tracker/{id}/timeline`).
- **Offer:** link one of the account's offers, picked by the user. It's never matched by company name, and one offer
  belongs to one job at a time.

## Out of scope (later)
Server-side snooze, a contacts panel (it lives in Outreach), PDF preview of a sent version, company intelligence.

## Data
- New table `resume_snapshots`: user and application foreign keys with ON DELETE CASCADE, resume foreign key SET NULL.
  At most 20 per job.
- New column `job_offers.application_id`: foreign key SET NULL, indexed.
- Migration `b7d9f1a3c5e7`: upgrade, downgrade and upgrade again verified on SQLite and Postgres 16. The downgrade
  keeps every offer and drops only the link.
- Export: `job_search.sent_resume_versions`. Deletion: they go with the job or the account (cascade).

## Security
Every route loads the tracker entry by id **and** user. A resume, snapshot or offer is accepted only if it belongs to
the same account (404 otherwise). The offer picker lists only the account's own offers. Tests:
`tests/test_job_mission.py::test_nothing_crosses_accounts`. Rate limit `jobs-mission` is per user.

## Cost and latency
No AI calls. The ATS score is computed locally (CPU, off the event loop) for the linked resume and at freeze time.

## States
Loading skeletons. A job not in the tracker gets a clear message and a link back. Each tab has its own empty state:
not checked, not linked, no versions, no offer. Errors show a toast or a retry.

## Flag and rollout
The page is reached only from the tracker and Home and holds only the user's own records, so it ships enabled. Roll
back by reverting the web route. The API and migration are additive.

## Acceptance
API tests (6) on SQLite and Postgres. Vitest for the model (stages, requirement wording, snooze per account and job).
Playwright walk-through: link, freeze, offer link, timeline, 390 px without horizontal scroll.
