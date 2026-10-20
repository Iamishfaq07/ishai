# Follow-up and offer playbooks

Built on merged PR #425 (`e049d981`). This batch adds opt-in rules using saved application activity and offer events.

## Personal Orbit

Open **Jobs → Action desk → Your follow-up playbook**. Both rules start off:

- **Application follow-ups:** choose 3–60 elapsed calendar days. Applied jobs with no saved next-step date become
  actions after that period. The anchor is the latest of recorded application date, status date, and a linked
  contact's most recent recorded contact date. Future contact timestamps are ignored. Rejected, hired, interviewing,
  offer and saved jobs are excluded. An application without a recorded applied date is not guessed.
- **Interview preparation:** choose 1–168 hours before a saved future interview date. The existing interview action
  gains preparation guidance and a playbook badge. It is not duplicated and its calendar date stays unchanged.

Rules are saved per account with revision checks. Concurrent edits return 409; the UI keeps the draft. Explicit
**Reload saved rules** discards local edits after fetching current settings. The existing AI brief can include these
source-linked actions, with its existing allowance and validation. A rule change invalidates an older AI brief.

The playbook reads saved data when the Action desk is requested; the page refreshes every minute while visible and
on focus. It does not run a personal notification scheduler, send messages, read an inbox, infer an employer reply,
change an application status or submit a job application. Reminders remain derivable with the browser closed and
appear on the next visit. Existing hosted applying continues independently.

To clear a follow-up, record progress, a next-step date or a linked contact interaction in the existing workspace.
Explicit next-step dates take priority. Disabling a rule removes only its derived actions; saved dates remain.
The queue displays at most 100 actions. Follow-up preparation scans up to 200 eligible due records and signals
truncation. Recent contact activity is filtered before that cap, so old contacted jobs cannot hide newer due jobs.

## Orbit for Business

Open **Company → Automations**, choose a role and enable either new rule:

- **Offer response deadline:** 1–168 hours before the latest published offer expires, create an internal review
  task. An expired offer stays an internal task until answered, withdrawn, superseded, handled or paused; the rule
  never withdraws an offer or marks a candidate rejected.
- **Accepted offer handoff:** 1–168 hours after the latest offer is accepted, flag a missing published joining plan.
  Publishing the plan resolves the source condition on the next reconciliation.

These rules follow the automation center's existing scope: active applications in open roles, no deletion request,
enabled playbook and an unsuspended company. Hiring or closing the role ends these tasks; the Joining desk remains
the place for post-hire work. Declined/withdrawn offers do not create handoff tasks. Old superseded offers cannot
create new tasks. A missing/unreadable legacy expiry does not acquire an invented deadline.

Preview creates no tasks. Saving or running reconciles the queue immediately; the existing five-minute Business
sweeper continues with the browser closed while the API is running. Stable offer-based source keys prevent
duplicates. Existing assignment, snooze, completion, permissions, audit and internal notifications apply. External
offer messages are still sent only through the existing explicit publishing flows, never by these recipes.

## API, migration and rollback

- `GET /v1/jobs/playbook` → `{revision, follow_up_days, prep_hours}`. Null disables a rule; default revision is zero.
- `PUT /v1/jobs/playbook` → `{base_revision, follow_up_days, prep_hours}`; full account sign-in, per-user rate limit,
  strict integer ranges, extra-field rejection and account-lock revision protection. Extension-scoped tokens cannot
  change these preferences. No recipient or outbound-message setting exists.
- Existing Business automation save/preview accepts nullable `offer_hours` and `handoff_hours`; zero in a preview
  disables the corresponding rule. Saved settings preserve both through the web client.
- Apply migration `82ac6d705f91` after `7fc84a231d90` before starting the API. It adds the account-owned
  `career_playbooks` table. Account export includes the settings; account deletion cascades the row. Downgrade
  removes saved personal rules. Export needed preferences before rollback. Business recipes remain JSON settings.

## Verification

Tests cover opt-in behavior, source priority, linked contact activity, stale/concurrent edits, invalid settings,
future/terminal records, retained interview dates, account export and capped-query ordering. Business tests cover
preview, deduplication, superseded/expired/withdrawn/declined offers and accepted-offer handoffs resolving from real
source events. New tests join the PostgreSQL CI gate. Local migration checks use SQLite upgrade/downgrade/upgrade.

Desktop/mobile browser coverage exercises configuration, saving, conflicting edits, reload, AI briefs, retained
preferences, offer deadlines, acceptance and joining-plan resolution, including accessibility and overflow checks.
Fixtures use local databases and a local mail outbox, not real employer submissions or external mail.
