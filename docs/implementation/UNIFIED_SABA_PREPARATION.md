# Connected Saba preparation workspace

2026-10-21. Base24e29789 (owner-merged PR450). Branch orbit-saba-preparation-workspace-2026-10-21. IMPLEMENTED / UNVERIFIED. No testing.

## Candidate outcome

Prepare with Saba now leads with the selected opportunity, resume copy/edit timestamp, recorded round/date and stored-description availability. Candidate chooses audio/video and a 10-minute focused or20-minute fuller rehearsal. Planned minutes are a practice limit, not prepaid usage; existing metering/permissions/provider/session settings remain authoritative.

Within the same room, optional source-material disclosure reuses existing ResumeCard/JobPostCard and PUT interview selection, avoiding another upload or a trip to a different tool. Optional question disclosure reuses existing saved questions, credited generation and selected-question drill. Opening disclosures does not generate content. Existing source selection, job-specific copies/master guards and question quotas remain unchanged.

The workspace links directly to this job's plan and recorded rounds, then story/learning/coding tools using the existing bounded opportunity return trail. Linked practice/live counts and historical report/retry tools sit in a disclosure, distinct from employer rounds and unconfirmed related-company suggestions. No new score or status inference.

## Source continuity guards

- Before creating a practice session, compare the displayed job ID/role/company, selected resume kind/ID/timestamp and recorded round type/number/date against the fresh owned session context. An already-selected job document must still appear as the job_description document. Use the fresh context round to choose persona/format mapping.
- Main launch captures current UI briefing identity (including selected job-document ID/availability), suppresses duplicate rapid clicks, and checks the same active source visit before session creation/navigation. Context switches or unmount do not navigate a later job into an earlier launch.
- Session-context provisioning can create/reuse private documents under the existing endpoint. These are not LLM calls or resume edits. A rejected/stale launch can leave provisioned source documents. The check is not an atomic server transaction over job/resume/document creation and session creation.
- A session creation already in flight can succeed after navigation/source change. The UI does not automatically navigate it; it may remain a created session in Sessions, without having started live audio here. There is no invented cancellation or automatic paid retry.
- Existing server owner checks, owned document checks and explicit round revision guard remain authoritative. This client check does NOT validate full same-ID document body hashes, every latest fit requirement or all AI-source revisions. Those remain open architecture/verification work; no broad stale-AI guarantee is claimed.
- Saved question sets flagged stale cannot launch a selected-question drill. Question component keys follow source identity/generated_at; changing sources resets its local selection. Generation/drill callbacks are active-instance guarded and duplicate clicks suppressed. Generation may still finish server-side after leaving; source refresh reads saved result later. Stale set regeneration uses the existing deliberate credit action.

## Input and navigation behavior

Source/question disclosures mount lazily after first opening and remain mounted when collapsed in the same practice view. Raw job-text/question selections are not destroyed merely by closing a disclosure. Leaving the practice view still unmounts these editors; no new persisted drafts, offline cache or restored approvals were introduced. Save disables job-text editing while pending. Resume master/version and fact approval are not rewritten by practice itself.

Existing full Interview panel and specialist routes remain, with the same practice duration options and launch guards. Existing question drill duration remains derived from selected question count. A feature-disabled deployment shows practice unavailable rather than a usable-looking launch. Video permission/fallback/reconnection behavior is unchanged and unproven in this slice. No new provider, language, recording retention or sending permission.

## Design and source wording

Uses merged paper/graphite/Slate blue shared panels, wrapping two-column briefing, explicit source labels, one practice CTA and disclosed secondary controls. Replaces saved-as-sent wording in the selected resume helper: saved copy is not delivery. No fake hiring chance, confidence score or completion animation. All images/viewport/contrast/accessibility evidence remains historical until later checks are authorized.

## Source findings and deferred reproduction

Source-confirmed: practice launch fixed every ordinary rehearsal at20 minutes; material/question controls lived on Interview rather than Practice; startPractice used old view.round.type after reading fresh context; question drills did not block saved.stale or guard unmounted async navigation. Later verify short/full requests, selected-source changes during fetch, rapid clicks, question regeneration/source reset, stale drill, deleted resume, different jobs/accounts and no automatic live launch.

No runtime reproduction or provider proof is claimed. Existing automatic document provisioning and provider constraints are retained, not redesigned.

## Delivery, rollback and evidence

No tests, build, lint, typecheck, browser/screenshot/contrast/accessibility checks, migrations, provider/hardware calls or scans were run, per explicit owner NO TESTING instruction. Source reads/edits and Git/PR operations only. No CI gate weakened or skip marker/rerun requested.

No backend/schema/API change, dependency or new background AI cost. Optional question generation retains existing credit and per-day controls; practice uses existing usage while running. Revert UI slice to roll back; no data migration. Existing stored sources/sessions/questions remain.

Deferred acceptance: client compile/contracts,10/20-minute and selected-question sessions, feature OFF, stale source/409, missing JD/resume, saved-vs-editable source, two jobs/accounts, collapsed/left draft lifecycle, quotas/provider outages, audio/video permissions and real devices, reduced motion/light/dark/320–1920/zoom/keyboard/screen reader/screenshots, full available integration gates and prior migration/dependency/operator checks. Production NO-GO. Full V6/provider/live readiness is not complete. Open draft PR for owner review; do not merge or deploy automatically.
