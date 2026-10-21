# Current increment — automatic job contact finder, 2026-10-21

SOURCE-CONFIRMED: contact search supported only configured SearXNG/Brave and one generic query; CompanyPanel linked out instead of job-bound browser research; manual saved JD was ignored when absent from feed. New DeepSeek fallback/multi-query/manual-doc context/in-room entry implemented. Runtime/provider/source-validation/secret/owner/visual verification remains deferred. No guaranteed contact or mailbox verification. [Details](AUTOMATIC_JOB_CONTACT_FINDER.md).

**IMPLEMENTED / UNVERIFIED. No testing by owner instruction.**

---

# Current increment — Saba preparation workspace, 2026-10-21

SOURCE-CONFIRMED: ordinary Saba practice was hardcoded20 minutes, material/question selection lived elsewhere, old view.round.type was used after fetching fresh context, and saved stale questions could launch drills. New UI duration/source controls and client source/unmount/drill guards implemented, not runtime reproduced. Full same-ID content/hash and atomic session-source validation remains RISK/open; provider/audio/visual behavior unverified. [Details](UNIFIED_SABA_PREPARATION.md).

**IMPLEMENTED / UNVERIFIED. No testing by owner instruction.**

---

# Current increment — Opportunity Room continuity, 2026-10-21

SOURCE-CONFIRMED: local room sections still required an eight-tool select; Company/Plan/History discovery was indirect. SOURCE-CONFIRMED: version notes used transient component state; late mission saves lacked per-visit response guard. Updated contextual navigation, keyed panels, bounded note draft and per-visit guard are IMPLEMENTED / UNVERIFIED. Packet job-return links ALREADY EXISTED and are reused. Full reproduction/acceptance deferred. [Details](UNIFIED_OPPORTUNITY_CONTINUITY.md).

**No tests run, by owner instruction.**

---

## 2026-10-21 — design and navigation source findings

DESIGN OPPORTUNITY, owner-confirmed: default Nebula plus violet-tinted neutrals make even neutral UI read purple. Shared palette, stage marks, legacy-default alias and solid surfaces/logo now replace that direction. Source evidence: design.ts defaults/palettes, base.css ink/accent/stage variables; no new runtime reproduction claimed.

SOURCE-CONFIRMED NAVIGATION GAP: Home horizontal stage shortcuts used generic tracker/prepare/offers routes even after selecting a role. New secondary rail carries that owned opportunity ID into existing resume/practice/interview/offer tabs; selection remains list scope and global recommendation is clearly separate. No automatic source association or status change. Acceptance deferred.

REMAINING: binary PWA/native/social assets retain their prior artwork; full specialist-screen layout overhaul, contrast, screenshot/browser/motion/scroll/account-switch verification are open. All current changes IMPLEMENTED / UNVERIFIED. [Details](UNIFIED_ENTERPRISE_DESIGN.md).

## 2026-10-21 — source findings, no runtime reproduction

SOURCE-CONFIRMED: `mission.freeze_resume` stored only a nullable live resume FK, which is SET NULL on deletion, without original revision. Reproduction recipe for later: save revision, edit/delete source, inspect version. Impact: missing durable provenance. New creation-time origin captures ID/revision; legacy provenance remains unknown. Acceptance deferred.

SOURCE-CONFIRMED: `auto_apply.packets.track_applied` read current JobListing text rather than packet.posting_text. Recipe for later: prepare packet, change listing, report result, compare saved JD. Impact: historical materials could carry the wrong source description. New writer uses captured packet text, or empty when absent. Acceptance deferred.

SOURCE-CONFIRMED: snapshot UI marked every null resume_id “original deleted”, including packet snapshots never linked to a Resume. New UI labels only known deleted resume sources and distinguishes legacy unknown/packet origin. Runtime/visual behavior unverified.

RISK / remaining: exact uploaded-file delivery provenance and packet-generation master revision are not supplied by this change. A current packet link is not an immutable receipt. Full migration/runtime/security/UI acceptance remains deferred by owner instruction. [Details](UNIFIED_SNAPSHOT_ORIGIN.md).

# Unified journey gaps — evidence classes

## Confirmed regressions

- U01 — `pages/jobs/workspace.ts`, Tracker keywords: base `pnpm -r test` reproduces one failure in workspace.test.ts: INTERVIEW no longer finds Tracker. Impact: a previously supported candidate task disappears from tool search. Restore keyword, retain regression assertion; final rerun pending.
- U02 — `job_portal/{mission,opportunity_coach,requirement_practice}.py`: baseline Ruff reports9 import/line-length failures. Impact: enforceable API CI gate fails. Correct source, no suppression; rerun pending.

## Source-confirmed design/data gaps (not invented runtime exploits)

- U03 — `launchpad.snapshot`: no explicit master selection; fallback can choose newest owned resume. Existing search resume is not a master authority. Introduce explicit review metadata and distinguish source facts from candidate confirmation; tests pending.
- U04 — `mission.link_resume` and `interview.update_interview` can reference the same mutable resume from multiple jobs. Once a resume is designated master, job editing must use an independent copy. Add copy-on-bind for master/shared sources; isolation/revision tests pending.
- U05 — `HomePage` repeats launchpad/action/weekly/agent destinations; `CareerSpacesPage` flattens equally weighted cards. Actual before captures confirm excess hierarchy and long mobile catalogs. Redesign around one next action and one identity; visual/journey verification pending.
- U06 — navigation trail is not durable artifact association. Existing company-name round matching must not imply proven job progress. Keep navigation separate and add explicit reviewed linkage in the relevant phase.
- U07 — unsaved reply/invitation text remains memory-only and may be lost when leaving the page. Existing within-panel retention is not route-safe draft persistence. Guards/draft policy and account-switch tests remain future work.

## Baseline failures requiring classification

- Browser extension fake-ATS and live coding cases failed;42 passed,7 dependent/not-run. Rerun individually with isolated artifacts before classifying root causes.
- Concurrent Playwright runs shared default output and produced trace ENOENT during before captures. Harness issue, not proof of product failure; use distinct output folders and recapture.

## Risks / owner actions

- Real provider speech/camera quality, Postgres locking/migration/rollback, staging credentials, signing/updater/hardware, backups, legal and live billing remain operator evidence, not mock-test pass.
- Fresh final budgets must pass without raised thresholds. Current base entry and CSS have little headroom.
- Previous skipped test increments have no ownership/source/race coverage for their new APIs; add focused regressions before release.

## Current repair evidence

U01 is fixed with the original search assertion retained; web suite601 passed. U02 is fixed; full Ruff check passed (including new migration-fixture formatting). U03/U04 have explicit selection/review and copy protection with API ownership/stale/deletion/isolation coverage; old job-scoped editor URLs are guarded before editing. U05 has real new layouts and runtime captures. U06 now separates related_round suggestions and reviewed durable linking; completed session counts require an ended linked session. U07 now restores input only in bounded account/job-scoped tab memory; approvals and derived previews are never restored. Full browser account-switch and source-change proof is still being collected.

The baseline fake-ATS failure was OpenSSL missing from process PATH, not missing implementation; the executable exists in Git’s usr/bin and the isolated final run passed its assertions with that PATH. The baseline live-coding artifact failure was caused by concurrent test-results use; its assertions passed in the isolated final run. Earlier partial results remain in the log.

Confirmed remaining source gaps: ResumeSnapshot currently preserves saved content and live source ID, but not an immutable source revision/reference after source deletion; do not infer a sent version. The current tracker has a next round/date and linked sessions, not a complete IANA-aware multi-round calendar record. Explicit identity approval is not yet enforced by every historical specialist consumer. These require later bounded migration/orchestration slices and PostgreSQL/operator validation. No full hard-success-criteria claim.

## Additional confirmed repairs

- U08 — auth.tsx lacked cross-tab identity synchronization. Reproduction: open owned identity A in one tab, sign out and sign in as B in another; the first tab retained A’s heading. The new two-tab browser regression failed at the private-heading removal assertion before repair. Storage events and a same-origin BroadcastChannel now clear private state and reauthenticate; the received ID is never authentication authority. Standard and deliberately blocked-localStorage cases both pass. Account changes also remount private component state and invalidate late cached mutations.
- U09 — auto_apply/packets.py track_applied(by_orbit=False), called by the candidate’s manual `/done` action, previously saved the same “Sent by Orbit Apply” snapshot note as executor-confirmed flow. New manual copies are labeled “Candidate recorded applying from Orbit Apply”; no historical backfill or delivery inference. Existing CAPTCHA/manual-completion regression now checks the note and unchanged zero quota usage. The initially added test guessed a charged field on PacketDetail; corrected to assert the real setup quota authority. Final affected API group39 PASS.

No claim that every supported browser/provider/OS combination or every historical source association is verified. The rollout remains gated by the release sign-off.

## Follow-on confirmed gaps and repairs

- U10 — timeline.py timeline queried80 newest sessions across linked/unrelated records before filtering. Reproduce with an older linked practice and90 newer unrelated sessions: owned history falls out. mission.py also counted its ten-row preview, undercounting13 ended practices. Separate bounded linked/suggestion reads plus aggregate source counts repair both. Acceptance test: test_linked_history_is_not_evicted_and_counts_are_not_preview_counts; covered on SQLite/PostgreSQL. No claim that preview lists are exhaustive.
- U11 — reviewed association had no undo/audit controls. Add owned ended-only unlink, explicit subsequent reassignment, idempotent source history, export/delete and contextual review-return UI. Tests cover foreign/stale/active requests, competing links, source preservation and review navigation without automatic attribution. Existing legacy associations do not gain fabricated audit records.
- U12 — tracker timeline said Sent from your browser by Orbit Apply based only on legacy applied_via. It now labels that record conservatively, and explicit packet events separately show candidate/manual, executor report and uncertain outcome. Four parameterized owner/redaction tests verify state and no private receipt text/URL disclosure. Immutable snapshot source revision/actual delivery association remains an unresolved separate gap.

Local PostgreSQL absence was an environment limitation at the first checkpoint; now cleared with a portable isolated runtime, full graph rollback proof and46 targeted contract/concurrency tests. Deployed staging and full release gates remain unverified.

## Round continuity increment — implementation only

The prior tracker’s single upcoming date lacked independent real-round records and original IANA zone/history. Draft implementation adds owned rounds, deliberate preparation selection, source-revision-bound Saba/session context and reschedule/debrief controls. This addresses the design/data gap in code only; no runtime regression, migration, ownership, UI or DST validation was performed under the latest no-testing instruction. Existing historical date values are not backfilled into asserted interviews. Shared migration fixtures/head contracts and all release gates remain pending.
