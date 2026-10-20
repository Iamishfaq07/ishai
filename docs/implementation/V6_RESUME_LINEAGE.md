# V6 increment 4 — review the version before using it

2026-10-21. Base `03d8ce37`, PR #440 merged. F03/F06 integration slice using the existing mission, resume snapshots, editor and opportunity coach. **Implemented, unverified: the owner explicitly deferred all testing.** No test, build, typecheck, lint or browser validation was run for this increment. Earlier results in BASELINE.md describe earlier commits only.

## Candidate journey

1. Open an opportunity's Resume step. The current linked resume opens in the existing editor with a return-to-job link.
2. Save a separate resume version for this job, or choose an existing saved version. Existing snapshot/copy/delete behavior remains; saving a new version still makes it the default for interview preparation, now disclosed next to the button.
3. Choose **Compare with linked resume**. The read-only panel compares stored contact/summary, experience, education, skills, projects, certifications, extras, section order/visibility/headings, other stored fields, design and target job text. Changed sections appear first as a short list; unchanged sections can be revealed. Open individual sections to read saved/current values side by side on large screens or stacked on small screens.
4. Current source missing? Show the saved copy with an explicit no-comparison state. Different linked resume? State that the source changed. A deleted original does not delete the saved copy; unknown source identity is not guessed.
5. Edit the linked resume and return to this job, or use the existing independent-copy action to work from the saved version. Neither action overwrites the immutable saved copy automatically.

Saved copies are labeled **saved**, not sent. The mission next-step explanation, interview version choices and preparation text follow the same distinction. Actual packet/application delivery paths are unchanged. Existing historical titles/notes are not rewritten. Fit results are explicitly prior checks: changing the linked resume does not rerun a fit check, and its quoted material may come from another resume/evidence version.

## Source and privacy boundaries

- GET `/v1/jobs/tracker/{entry_id}/mission/snapshots/{snapshot_id}/compare` uses the existing authenticated owner checks for the job and snapshot, including the snapshot's application ID. The current linked resume is selected only for the same user. There is no new mutation endpoint, table, migration, dependency, provider or permission.
- `resume_lineage.py` compares the stored values deterministically, preserving list order and distinguishing missing/default/internal fields. It is not a semantic skill diff, visual PDF diff, fit check, claim verifier or proof of delivery.
- Each side of a section is limited to 3,000 displayed characters, with explicit truncation indicators. The underlying full stored fields determine equality and the comparison digest. Photo data is replaced by a short fingerprint in the text view; photos, links and target-job text are not fetched or executed. The UI renders text through React, not raw HTML.
- The panel reads on selection/refresh/return to the tab, discards outdated requests, and is keyed by job/snapshot/current linked resume revision. Loading a fresh comparison removes the prior result; no diff is persisted or put into analytics/local storage.
- The digest describes current stored values, not a cryptographic attestation of who authored/submitted them. It is not a durable revision ledger or immutable employer receipt.
- The existing opportunity coach receives only derived status facts: latest saved copy matches/differs, section count, source availability and a link back to the owned comparison. Raw comparison excerpts, resume bodies and photo data are not included in model grounding. The coach's source version now binds stored resume content and the latest snapshot comparison; existing recheck-after-generation and daily quota remain.
- Coach guidance concerns the **latest** saved copy; manual comparison may select an older copy. The coach is instructed not to invent changed text or attest to accuracy/delivery. No automatic AI rewrite, claim approval, application send, calendar change or worker privilege is added.
- Existing account export/delete covers the underlying resumes/snapshots; the comparison creates no additional stored user data. Candidate resume text returned by the comparison is private account data and must not be logged or shared publicly.

## Review and deferred verification

No checks were executed, per the owner's direct instruction. The PR should remain a draft pending later verification. Commits include `[skip ci]` to request skipping automatic GitHub Actions; workflows and branch-protection requirements are not disabled or weakened. No workflow dispatch or rerun is requested.

Later verification should cover owner isolation and cross-job snapshot IDs; no-current/deleted/different sources; all section/design/photo/hidden-field/long-excerpt cases; no mutation/model call on comparison; stale results after link/edit/account changes; coach source invalidation and quota; copy/export/delete; small-screen overflow/focus/keyboard scrolling; existing interview document deduplication and changed wording expectations; typecheck/lint/build/bundle budgets. These are deferred review tasks, not passed tests.

Full F03 claim provenance and tamper-evident lineage, F06 packet approval/receipt identity, fit-source freshness across evidence changes, exact exported-document comparison and hosted once-only billing regression remain separate work. No new gate is declared passed and no whole-V6 completion or launch approval is claimed.

Rollback: revert this increment's code; no schema rollback or data rewrite is needed. Existing saved snapshots remain. Keep corrected delivery-truth copy where possible. No manual deployment or merge is performed.
