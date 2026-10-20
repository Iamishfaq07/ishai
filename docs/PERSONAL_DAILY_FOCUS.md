# Personal Orbit: daily focus and job context

## What candidates see

Today recommends one saved action with an explanation and a specific button, such as **Answer questions**, **Review application** or **Prepare for interview**. Other saved actions remain visible. Choosing a filter shows that subset without a separate recommendation card.

The recommendation uses records and fixed rules. It does not consume an AI preview or infer a candidate's chance of being hired. The existing optional AI brief reads the same prioritised queue, with its source validation and daily allowance intact.

## Priority rules

1. A saved interview date has passed: record the outcome or update the next round.
2. A saved interview is within the next 24 hours: open preparation.
3. A follow-up date or an enabled follow-up rule is overdue.
4. An application needs an answer from the candidate.
5. A prepared application needs review.
6. A blocker, handoff, failed result or expired materials need review.
7. Other dates within the next seven days, earliest first.

Equal-priority packets use their saved update timestamp, then ID. The packet query also prioritises answers and reviews before its bounded fetch, so an answer request is not lost behind more than 100 older reviews. The displayed queue remains bounded to 100 actions and discloses truncation. Its counts describe displayed actions, not all application history.

Failed and expired materials open review; the recommendation does not retry or approve them. Existing confirmation, consent, quota and submission checks still apply in their workspaces.

## Lifecycle fixes

- Withdrawn jobs no longer produce date reminders; hired and rejected jobs remain excluded.
- Packet reminders are suppressed when an owned job with the matching listing or application ID is closed. This also covers prepared packets whose submission `application_id` is still empty.
- The agent's attention count uses the same owned packet selection and includes handoffs, failed results and expired materials.
- Independently saved contact reminders remain available; closing a job does not erase a relationship.
- The source version includes the displayed priority reasons and packet update timestamps. AI briefs still reject changed sources.

These reads do not change statuses, cancel packets, send messages or submit applications.

## Context between tools

Application review links directly to the saved job's workspace and preparation plan, and carries the listing ID into contact research and writing. Packet detail resolves `tracker_id` from an owned job with that listing ID even before submission. This means the field identifies a workspace; its presence does not establish that an application was sent.

Contact research no longer selects an unrelated saved job when a supplied listing ID is missing from the tracker. It shows a message and asks the candidate to explicitly choose a saved job. With no supplied listing ID, its usual default remains available.

The mission URL helper lives in `paths.ts`, with the old `mission.ts` export retained for compatibility. Consumers that only need an address avoid importing mission UI state and tool definitions.

## Verification

Real HTTP tests cover priority changes, stable source versions, all attention states, waiting/finished states, closed jobs, owned context, cross-account isolation, read-only behavior and a large review queue. Desktop and 360px browser fixtures cover Today → application review → preparation/contact research, withdrawal refresh, missing job context, accessibility and overflow. The existing navigation, playbook and AI brief scenarios are also exercised.

No real employer submission or external message is part of these tests. No new route, database migration or account permission is required.
