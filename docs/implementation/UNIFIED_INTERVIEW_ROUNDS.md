# Owned interview rounds — implementation draft

2026-10-21. Base3d9fa3b8 (PR445 merged by explicit owner request). Branch orbit-interview-round-continuity-2026-10-21.

**IMPLEMENTED / UNVERIFIED.** The owner's latest instruction prohibits testing. No tests, typechecks, lint, builds, migration commands, browser journeys, screenshots, provider smoke or performance checks were executed for this slice. Prior PR445 results do not validate it. Production NO-GO; experimental flag defaults OFF.

## Candidate outcome

Within the existing Opportunity Room > Interviews, a candidate can record separate real employer rounds, an optional confirmed date and IANA zone, notes, cancellation or a candidate-confirmed completed round/outcome. Saba mock sessions and live execution records remain distinct. A practice session does not assert an employer interview occurred.

A candidate deliberately selects a dated round for current preparation. The existing JobApplication next_at/type/number projection continues serving Today, preparation and existing clients. Selecting a round does not mark interviewing unless a separate explicit choice is confirmed. Editing the selected round reschedules that projection; completing/cancelling clears its matching selected date, never chooses a successor or claims a passed interview. Clearing selection preserves round and completed-preparation history. Legacy/manual date edits clear the round reference and remain available in a disclosure; no existing dates are silently promoted into real rounds.

Calendar intake reuses the current bounded parser and preview. When enabled, the confirmed event is reparsed server-side and retained as a round with its UTC instant and source IANA zone. Candidate may separately select it for preparation and explicitly mark interviewing. UID-derived source keys prevent a repeated event from silently creating another record; a rescheduled invitation for an existing UID prompts review/edit of that record. Calendar subscription, automatic cancellation/reschedule ingestion, recurrence, organizers, attachments and meeting links are not introduced. Existing parser rejection of ambiguous/nonexistent DST instants, unsupported/custom zones and cancelled/recurring invitations remains.

Round debrief keeps private notes and candidate-recorded outcomes. A next-round outcome provides an action to record the next confirmed round; an offer outcome links to the existing opportunity Offer section. Neither changes application status or invents offer terms. Existing follow-up drafting remains in the existing workflow; no email/send/accept/withdraw action was added.

## Authority and schema

- New JobInterviewRound extends existing JobApplication rather than creating another tracker. Owned by user_id and application_id, with cascade deletion, owner/application index, unique per-job source key, revision/status/number constraints.
- Round fields: label, existing round category, number, UTC instant, original IANA zone, planned/completed/cancelled, current private notes/outcome, confirmation timestamp, provenance, source key, revision and bounded schedule/status history. History records before/after schedule/status facts; it does not retain every prior private-note text. Candidate edits are not independently verified employer facts.
- JobApplication.preparation_round_id/revision are explicit versioned references. Its next_at/type/number remain the compatibility projection for current preparation. Comparison checks ID, source revision, status and exact schedule/category/number; matching company or time alone cannot select a round.
- LiveSessionRow.interview_round_id/revision retain the round source captured for practice/session setup. Authenticated session creation rechecks the selected owned planned round and source revision. Existing session transcript/context is not rewritten on reschedule or reassociation. Current-versus-earlier-revision practice counts are separate. Source identifiers are opaque references (like existing interview_version), checked server-side, not a second facts store or an inference from history. They can remain as historical identifiers after a job/round is deleted; no foreign source is exposed.
- Preparation item keys include selected round identity/revision, avoiding automatic completion carryover between equal-time rounds. Existing completion snapshots stay intact and reviewed reuse remains the existing mechanism. Calendar/legacy date writes and wrap-up clear explicit selection before changing the upcoming context. A stale selected reference blocks contextual launch until reviewed.
- Account export adds interview_rounds, and existing row export includes new job/session references. User/job cascades remove round content; account deletion already removes owned sessions/jobs. No audio/video retention or business data migration added.

Migration f73a9e1c462d follows e62f8d0b351c. Adds one table and four nullable reference columns. No historical backfill or automatic approval. Direct additive nullable columns avoid introducing cyclic foreign keys or SQLite table recreation; new round owner/job foreign keys retain ordinary cascade behavior. The migration has NOT been applied or validated. Existing ORM reads require the new schema even while the feature flag is off; default-OFF is an experience rollout guard, not a substitute for migration safety.

## APIs and consent

- GET /v1/jobs/tracker/{entry_id}/rounds: owned projection; enabled=false when disabled, otherwise bounded60-round history and grouped session counts.
- POST on that route: reviewed manual round with request_id and tracker version.
- PUT /rounds/{round_id}: complete reviewed edit with round revision + tracker version.
- POST /rounds/{round_id}/prepare: deliberately select a planned dated round.
- POST /rounds/preparation/clear: explicitly release selection without selecting another round.
- POST /rounds/calendar: full reviewed calendar input + parsed event_id; input is reparsed, original calendar body not retained.

Writes use authenticated ownership, existing account serialization, round row locks where applicable, and conditional tracker updates. Stale source/job revisions return409; missing/foreign records404; unsupported time/consent422. Confirmation and choice booleans are strict, extra fields rejected. Closed jobs cannot be edited through the round writer.60 records/job and100 schedule-history entries/round are explicit caps; existing history is never silently evicted. Uniqueness is for retry/duplicate prevention, not proof of employer delivery.

UI keeps input-only drafts in bounded existing tab memory (cleared on account change, expiring after an hour); confirmation and state-changing choices are not treated as approvals after remount. Source refresh can rebase an editor onto current record metadata while retaining raw inputs and requiring fresh confirmation. Async reads/mutations are scoped to the mounted owned opportunity. A local identifier-only event refreshes round history after reviewed calendar intake; no private text is broadcast or placed in URLs.

## Flag, costs and rollout

ORBIT_PERSONAL_INTERVIEW_ROUNDS=false by default. Example configuration updated; no real environment or provider secret changed. Backend reports the flag on the existing interview view so disabled clients retain the existing date controls without mounting the round manager or extra round-history fetch. Business routes/navigation unchanged. No new dependency, navigation destination, background model job or external action. Manual recording/intake are deterministic and introduce no LLM fee. Saba retains existing plan/minute/provider controls; actual cost/performance/bundle impact is UNMEASURED.

No new graphical assets, animation dependency or screenshots were produced. New panels reuse existing Card/Field/Select/disclosure/focus/motion primitives. Mobile, keyboard, screen-reader, themes, motion and scrolling remain UNVERIFIED for these changes.

Rollout requires deferred migration/ownership/contract/journey validation and operator approval before enabling. Prefer disabling the flag and compatible code rollback while retaining schema/history. An approved downgrade removes new round history/references; export/backup before any such action. Never run downgrade against production here.

## Deferred acceptance work (not executed)

Migration graph/fixtures/head expectations, populated PostgreSQL and SQLite upgrade/downgrade, account export/delete, foreign/cross-business IDs, same-version races, legacy date/wrap-up/calendar paths, DST folds/gaps and invalid zones, duplicate UID/request, active-round reschedule/cancel/clear, stale source launch, per-round Saba revision isolation/replay, plan-history retention/reviewed reuse, browser navigation/account switch/draft recovery, responsive/focus/scroll/motion and bundle/provider gates. All are pending by owner instruction. This is not completion of the full phase4/release brief.
