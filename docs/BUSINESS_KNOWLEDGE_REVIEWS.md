# Business policy review inbox

The knowledge-studio release was merged to main at `d48ba7de`. This follow-up connects published guidance to
explicit ownership, review decisions, optional internal reminders and a source-quoted AI change-review brief.
Open **Business → company → Policy reviews**, or follow **Review inbox** from Knowledge studio.

## Own and review guidance

Every newly authored document starts with its author as review owner. Existing documents are backfilled only
when their creator is still an active owner/admin in that company. Otherwise they appear as owner unavailable.
Ownership identifies who is responsible; it does not grant permission or change the document audience.

The inbox is available only to current owners/admins. It includes active publications, ordered by updates
requested, due, due within 14 days, unscheduled and later scheduled. Dates use UTC. Filter by status, title,
owner unavailable, or **Assigned to me**. Saved private draft differences remain visible as a separate signal.

Expand **Coordinate review** to:

- Assign a current active owner/admin and optionally enable internal reminders. Reminders default off.
- Confirm the currently published guidance with a note and a next review date, in the future within two years.
- Request document updates, with a note explaining the issue.
- Request a quoted AI brief about the saved draft and publication before deciding what needs attention.

Any authorized owner/admin can help review; assignment is not an exclusive approval or authorization mechanism.
Every ownership change and review decision checks the document revision. Decisions also name the publication
version being reviewed. A stale action retains the form note and offers **Download review notes** before refresh.
Publication action history uses readable labels and retains review notes with the document.

## Confirmation preserves private drafts

Confirmation reviews **only the published text**. It records a new publication snapshot containing the same text,
title and audience with a new review date. Private proposed wording, title or audience changes are not published.
If the draft still had the publication's old date, its date is advanced too; a separately edited draft date is
preserved. Other draft fields remain untouched. Concurrent editors must reload before saving their older revision.

Requesting updates marks the publication as needing attention without changing its text or audience. That flag
travels with retrieved AI passages and appears beside answers and in exported working notes. The published-source
fingerprint changes, so an answer generated against the older review state is rejected. A human confirmation or
an explicitly published reviewed draft clears the flag. Restoring an archived document clears active review flags
and still requires publishing again.

These actions do not change job requirements, hiring stages or candidate decisions. There is no automatic policy
approval, certification, or determination that guidance is legally correct.

## Opt-in reminder automation

**Run opted-in reminders** reconciles reminders immediately. The existing Business automation loop also checks
roughly every five minutes while the API is running, starting after 30 seconds. The knowledge and hiring sweeps
have independent error handling, so a failure in one does not skip the other. No additional worker or secret is
required, but an offline/sleeping API cannot perform scheduled checks.

A reminder is eligible when the publication is due today/earlier or has updates requested, reminders are enabled,
and its assigned review owner is still an active owner/admin in that company. Suspended companies are skipped.
Missing/ineligible owners are surfaced in the inbox and manual-run result; they are not silently reassigned.

One generic internal notification is sent per publication version, date, owner and update-request episode.
Repeated runs and concurrent replicas share the company lock and reminder key, preventing duplicate nudges for
the same episode. Reassignment or a new publication can start another eligible episode. Toggling reminders off
and back on does not resend an already-handled episode. Marking guidance for updates can create a new episode.
A future confirmation date stops due reminders until it becomes due, unless updates are requested meanwhile.

Notifications link to the review inbox and omit document titles, policy text and review notes. They are in-app
only; this feature sends no emails, Slack messages or external provider notifications. Reminder delivery does not
make a review decision or grant the recipient access. Historical notifications may remain after a later decision.

## AI change-review brief

The brief is available only to active owners/admins for a current publication. It reads saved publication/draft
metadata, the first 1,800 characters of each body and up to 4,000 characters of changed lines. Truncation is labelled.
It can suggest questions about visible changes, ambiguity, audience, review timing or missing operational steps.
The owner can inspect each exact source quote and full supplied fact, and open the full document before deciding.

Every returned tip must quote a supplied server fact exactly. Unsupported tips are dropped; no usable tip yields
a validation error. References are fenced as untrusted data. AI cannot confirm currency, publish, change ownership,
send reminders or certify compliance. Access, suspension and revision are rechecked after the generation call.
A role change or concurrent edit prevents a stale/private result from being returned.

There are 10 change-review generation attempts per company per UTC day, including failures, separate from the
knowledge Q&A allowance. Existing provider usage/cost metering is reused. Real behavior depends on the configured
provider; test previews are explicitly labelled. Review of excerpts is not a full-document or legal audit.

## Data and rollout

Apply `alembic upgrade head` before releasing the new API. Migration `de82f4b5c930` adds ownership, opt-in reminder
settings/state, an update-request marker and a reminder-scan index to `biz_knowledge_documents`, after `cd71e3a4b820`. Backfill does not
enable reminders. The owner ID is a logical responsibility reference, validated on assignment and before every
notification; removed or ineligible owners remain detectable for reassignment.

The migration adds/drops simple columns without rebuilding the knowledge parent table. Its round-trip test seeds
a historical document with an existing publication and action note and verifies that these survive upgrade and
rollback. This avoids losing dependent history through parent-table recreation under foreign-key enforcement.

Review action notes live in the existing document history and follow its deletion lifecycle. Company audit entries
keep document/action metadata without copying policy bodies or private notes. Downgrade removes the new review
settings/flags; existing publication/action history remains. Preserve needed review metadata before rolling back.

Local validation (28 October 2026): 59 backend/retrieval/migration/automation regression checks, 40 Business unit
tests, and the end-to-end Chromium journey passed. The browser flow covers opt-in deduplication, AI brief, update
warnings in reader citations, confirmation preserving private drafts, stale-note recovery, mobile dark mode,
reduced motion, axe and overflow checks. API mypy (330 source files), Ruff, TypeScript and the production build
passed. Lint retains three existing warnings outside Business.

AI validation used mock providers. Hosted PostgreSQL concurrency, live-provider usefulness/faithfulness and
broader browser/assistive-technology behavior remain environment-specific checks. PostgreSQL CI includes the new
review suite; local results do not imply CI or a production deployment ran.

Run `uv run pytest tests/test_business_knowledge_reviews.py tests/test_business_knowledge_review_migration.py`,
`pnpm --filter @orbit/web test src/business`, and
`pnpm exec playwright test tools/e2e/business-knowledge-reviews.spec.ts`. Browser fixtures need a disposable API,
mock providers, local outbox and the configured test admin email; use `ORBIT_TEST_API_URL`, `ORBIT_TEST_OUTBOX`,
and `ORBIT_TEST_ADMIN_EMAIL` for custom endpoints. Fixtures make no payments and send only local development mail.
