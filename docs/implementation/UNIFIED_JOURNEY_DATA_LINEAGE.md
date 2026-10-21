# Current increment — Opportunity Room continuity, 2026-10-21

No new artifact association. Existing owned listing + null/matching packet.application_id drives mission preparation context; embedded packet expected tracker check is client defense, not proof of delivery or server mutation scope. Resume note is raw input in existing account/job bounded tab-memory; no restored consent. Saved sources/master/receipts remain separate. [Contract](UNIFIED_OPPORTUNITY_CONTINUITY.md).

**No tests run, by owner instruction.**

---

## 2026-10-21 — visual and navigation-only slice

No new data authority/association/schema. The selected Today opportunity is ephemeral component state; existing account-owned room routes receive opaque ID plus existing tab key. It does not scope the global server recommendation, count progress, link artifacts, create offers or change statuses. Existing source models own every displayed status/date. Legacy design preference nebula loads as slate; no resume content/template, profile approval, employer/business record or consent is migrated. No new telemetry/storage. Source inspection only; all behavior unverified.

## 2026-10-21 — immutable source observation on new snapshots

`ResumeSnapshot.origin` now captures server-observed source kind/opaque ID/revision where known, structured-content digest/time and saved/candidate/executor observation. It is not a receipt. Packet snapshots use captured packet.posting_text, never current listing content; design/exact PDF and master revision stay unknown. Legacy rows remain null. Existing owned export includes the new column; job/account cascade removes it; explicit snapshot delete removes history with a clearer confirmation. Restored copies retain reference in prep_context without modifying master. [Contract and limits](UNIFIED_SNAPSHOT_ORIGIN.md). Source changes only; all data/export/security behavior UNVERIFIED.

# Unified journey data authority and lineage

- Resume owns content/design/job text and optimistic revision. New CandidateIdentity is a typed projection, not a shadow facts store. A user-confirmed revision is not independent verification of employment or qualifications.
- JobSearchProfile.career_identity stores explicit master ID and optional review revision/fingerprint/time, plus source ID/revision when an independent master copy is requested. It is separate from the existing search-specific resume_id. No automatic existing-user approval or backfill. Later resume changes invalidate review by revision and full-content hash; deletion produces an explicit missing-source state.
- Master selection updates Discover's starting resume on explicit action, without writing resume content. Choosing a job-used resume requires an explicit independent-copy option. Job copies and snapshots remain independent; new master/shared bindings copy before allowing job editing, recording source_resume_id/source_revision/application_id. The target copy uses this opportunity’s already-saved owned job text or cached listing, and starts with no inherited cover letter. A previous employer’s job text is not carried across. No historical snapshot is relabeled as delivered.
- JobApplication remains opportunity authority; existing packet remains application/receipt authority. Saved resume, prepared form, candidate-recorded Applied and employer-confirmed delivery are different facts.
- LiveSessionRow.application_id is explicit session/job association. The URL trail and same-company matching are not proof of association. Reviewed linking now checks both owned resources, confirmed=true, ended state, and rejects a different existing opportunity. Possible matches are related_round, never counted. Completed progress requires an ended linked session; practice remains mock and separate from live sessions.
- CareerAction source is the existing queue/priority projection. AI only explains references with existing quota/source validation. No new background model request or autonomous submit.
- Export uses auth/export.py `_row(JobSearchProfile)` and includes the additive metadata. Account deletion's existing user/profile cascade removes it. Resume/job deletion keeps no new raw content in the metadata. Dedicated account export/delete and SQLite migration round-trip tests passed. This does not certify PostgreSQL, production deletion/backup policy, or legal compliance.
- New column has account-private retention, no raw CV/transcript/email body, no public sharing. Existing analytics redaction, session consent and business tenancy remain authoritative. No new raw audio/video retention, OAuth scope or application privilege.

## Navigation, drafts and failure boundaries

Job-specific editor links are navigation only until the server returns the same owned selected CV with resume_requires_copy=false. An unrelated/master/shared legacy link is stopped before mounting editable content. The candidate may return to the room to choose/create its independent copy, or explicitly edit the resume independently. Existing revision-conflict behavior is retained.

Replies/invitation input is retained only in bounded tab memory, keyed by authenticated user, opportunity and input kind. Only raw input is restored. Proposed dates/stages, source versions, confirmation and permissions must be reviewed again. Account cache clearing drops inputs; late writes from a prior generation are rejected. The authentication subtree remounts across user IDs and async cache setters reject stale account generations. No raw input is written to URLs, browser storage or added analytics.

## Remaining lineage work

Existing ResumeSnapshot content is preserved, but immutable origin revision/reference and actual submission receipt associations require a later migration. Do not reconstruct historical delivered versions. The new master review is one candidate-confirmed version, not field-by-field external verification. Every legacy specialist/automation consumer has not yet been migrated to require this approval projection. Complete source-version orchestration and audit-event coverage remain required for the full redesign.

## Reviewed attribution follow-on

POST /v1/jobs/tracker/{entry_id}/sessions/unlink accepts session_id and confirmed=true. It removes only the owned ended session's current opportunity association. Its source transcript/report/setup remain unchanged. Reassignment requires unlink then a fresh reviewed link; a stale prior room cannot remove a different job's association. No prior event is invented from company text.

Existing AuditLog stores career.session.link/unlink with opaque application:session IDs, owner and timestamp, only when state actually changes. Repeated operations do not duplicate events. Account export includes opportunity_session_associations with both IDs; account deletion explicitly deletes these career rows, unlike the existing retained security audit. History of deleted job/session IDs can remain as opaque activity references until account deletion; no titles/transcript/raw content are copied into audit. No change to recording consent, retention of actual session source records or external sends.

Timeline reads up to20 attribution changes and ten linked session previews; mission totals aggregate all owned ended sessions. Related-name suggestions remain bounded and uncounted. Optional review picker uses the existing most-recent200 owned sessions and only offers ended unbound ones; it does not imply exhaustiveness. Report return query carries navigation only, not artifact attribution.

Application timeline labels describe stored state only: candidate-recorded, executor-reported, uncertain or saved/prepared. Explicit owned packet.application_id is required. No raw packet answers, private confirmation text or final URLs are returned; no historical employer receipt or submitted resume version is reconstructed.

Local PostgreSQL16.15/pgvector0.8.7 migration round-trip and46 ownership/concurrency/lifecycle checks now PASS. Deployed PostgreSQL staging, backup/restore and remaining receipt/source-version migration remain separate gates.

## Draft round authority — unverified

JobInterviewRound stores candidate-recorded employer-round history, distinct from LiveSessionRow execution. Explicit job preparation reference/revision projects into existing next_at/type/number; matching dates/companies are not associations. Session source round ID/revision is checked at creation and preserved through replay; reschedule does not rewrite old practice. Preparation keys include selected round/version and keep historical completion snapshots. Legacy date/wrap-up writers clear selection. Export adds owned round rows and references; account/job cascade removes round content. Opaque historical references can remain on surviving owned sessions after job removal. No raw invitation/audio/video retained. Migration f73a9e1c462d has not been run. See UNIFIED_INTERVIEW_ROUNDS.md for guards, limits and deferred checks.
