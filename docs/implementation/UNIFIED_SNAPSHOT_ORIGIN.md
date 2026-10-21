# Saved application materials: source continuity

2026-10-21. Base: 4a49967d (merged PR447). IMPLEMENTED / UNVERIFIED.

## Candidate outcome

In an Opportunity Room, each new saved resume exposes its creation-time source in a compact disclosure. A resume save records the original opaque resume ID and revision; deleting the editable source does not erase that observation. An application snapshot records its exact packet ID, the structured content fingerprint and whether applying was candidate-recorded or executor-reported. The existing packet screen remains the place for current confirmation evidence. No new destination, application engine, AI call or send authorization is added.

Legacy copies explicitly say that the original version/submission source was not recorded. We do not backfill from notes, live resume equality, timestamps, listing matches or company names. Saving a copy is not delivery. An executor report, confirmation message or screenshot does not prove the employer received this exact PDF. Packet snapshots do not contain the rendered/uploaded file or original design, and do not claim an original master revision.

## Authority and data contract

- Existing `ResumeSnapshot` owns saved content; its nullable `origin` JSON is written only at creation by the two existing writers. `SnapshotOrigin` validates the server-created shape in mission/comparison responses.
- Resume origin: source ID, revision, structured content/design/job-text SHA-256, UTC observation timestamp, saved_copy. Opaque reference is deliberately not a cascading FK. Existing nullable `resume_id` remains the live link.
- Packet origin: packet ID, source revision unknown, hash of exactly the stored snapshot parts, result/status as observed, candidate_recorded or executor_reported, design_captured=false. No confirmation text, screenshot bytes, submitted answers, private URLs or profile facts are duplicated into origin.
- Snapshot JD now comes from `ApplicationPacket.posting_text`, bounded to the same 20,000 characters used for its stored content/ATS calculation; no fallback to the current listing. Missing historical packet text stays missing.
- A restored editable copy records source_snapshot_id/application_id/origin in existing `Resume.prep_context`. It is a new resume, does not become master automatically and never edits the saved copy.
- Mission save uses the existing account transaction lock and an owned resume row lock. Updated web client supplies the displayed resume ID and updated_at; mismatches return409. Old clients can omit these optional guards and still save the current owned linked source. This is not a new global resume concurrency protocol.
- Hash is a content fingerprint, not a signature, approval, exact-PDF digest, employer receipt or independent factual verification. Current packet details can change after the captured observation; the UI says so.
- No extra per-snapshot DB joins. Existing snapshot export serializes all model columns, so origin is included. Existing job/account cascade deletes snapshots. Explicit snapshot deletion removes content and origin; the confirmation describes that loss. Copies retain their own historical reference. No extra retention or new public sharing.

## Schema and rollout

Migration `a84b0f2d573e`, parent `f73a9e1c462d`, adds one nullable JSON column with no backfill. Apply schema before deploying this ORM backend, including when the earlier interview-round flag is OFF. There is no new runtime flag for these source observations. Migration has NOT been applied or exercised. Older backend ignores the extra column on rollback. Downgrade drops provenance only; export/backup and operator approval are needed before that information loss. Do not downgrade the preceding round migration as a shortcut.

## Deferred acceptance and release gates

Owner explicitly prohibits testing. No tests, builds, lint, typechecks, migration commands, browser visits, screenshots, provider calls or security scans were run. Only source inspection/edits and Git/PR operations. Nothing here is a runtime pass.

When testing is authorized: validate existing route contracts, nullable legacy rows, two resume sources, source deletion, two-tab409, wrong owner/job IDs, packet callback/manual result distinctions, mutable/missing JD, exact stored hash inputs, restore without master mutation, packet deletion404, export/account deletion, PostgreSQL migration upgrade/downgrade/upgrade and mobile/keyboard/light/dark/motion-OFF disclosures. Add/update regression suites and migration-head fixtures then; current fixtures were not altered to claim a pass.

Production NO-GO. Prior CI billing/spending and dependency notices remain separate open gates. This slice does not resolve exact-file delivery receipts, complete packet-to-master generation lineage, employer confirmation protocols, or the remaining full redesign phases. Those require further implementation and later verification; no data is inferred to fill those gaps.
