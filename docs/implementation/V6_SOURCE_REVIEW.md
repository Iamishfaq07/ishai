# V6 increment 5 — review the job source before applying

2026-10-21. Based on `018abd43` after PR #441 merged. F09 read-only integration slice. **Implemented / unverified: the owner explicitly requested no tests.** No test, build, lint, typecheck, browser check, screenshot or validation script was run. No tests were added or changed. Earlier verification does not validate this increment.

## Candidate journey

The existing opportunity's Understand and Apply steps contain **Review job source before applying**, with progressive disclosure rather than another tab. The compact summary shows the observation status and changed-field count. Inside, three cards explain saved record → cached observation → review original.

- Compare the job's saved role, company, location/work mode, post link and application link with the current cache. Saved fields remain unchanged; no proposal is automatically accepted.
- Show changed fields first; reveal all five fields when needed. Missing cache/manual jobs show saved values and no-comparison states.
- Display when the job was added, first seen in the current cache and last observed. First-seen history can restart when a cache entry is recreated; it is not the employer's first publication date.
- Distinguish manual, missing, unknown, older and recent observations. Missing cache can result from expiry, filtering or a refresh; it is not proof of employer closure/removal. No ghost-job, verified-active or fraud label is introduced.
- Compare exact normalized stored fields, including URL strings. Formatting or tracking parameters can therefore produce differences; this is not proof the vacancy changed substantively.
- Show up to three possible duplicate posts with the same existing normalized company/role/location key. Select at most four rows to indicate more matches. Candidates open the existing job detail page to compare; no record is merged or application suppressed. This heuristic does not establish repost identity.
- Preserve source attribution, including the existing larger credit format where required. Public links are restricted to HTTP(S), opened only by a candidate click with separate-tab disclosure.
- Keep disclosure and scroll position during background reloads; background refresh does not move focus. Read records on mount, return to a visible tab, and every minute while expanded/visible. Discard obsolete requests; clear old output on errors. No diff is persisted in browser storage.

**Refresh source status** reads Orbit's database only. It does not fetch an employer page or schedule a provider refresh. The existing feed refresh process, permitted adapters, budgets, backoff and worker privileges are unchanged.

## Source and AI boundaries

`GET /v1/jobs/tracker/{entry_id}/mission/source` reuses the authenticated mission owner check and read rate limit. `source_review.review` receives that owned entry, selects the public cached listing by both stable ID and source, and uses the existing location formatter. Manual `ext:` jobs skip cache lookup. It reads no business candidate records or other candidates' tracker data. Duplicate candidates come only from the shared public listing cache.

The review window is `max(24 hours, 2 × source TTL)`. It is a UI observation-age threshold, not an SLA or employer verification. Future timestamps and unrecognized sources have an unknown-observation state. A board list observation may retain older description details (for example, the existing partial SmartRecruiters fetch); the panel explicitly states it cannot establish every field was reread. First-party Orbit rows remain local published projections; no remote fetch is added.

The tracker stores no original description, salary or full requirement version. This slice cannot reconstruct that history or claim those fields are unchanged. It adds no source watch alerts, polling adapters, durable version ledger, closure inference, source-change acceptance writer, packet invalidation or automatic submission. Those remain future F09/F03/F06 work requiring separate verification.

The existing opportunity coach receives a new **Job source review** fact: fixed server-authored observation language, changed-field count and whether possible duplicates exist, plus an owned review link. No raw changed URLs, current description, salary or duplicate titles are added to model grounding. The coach version binds the displayed read model and a digest of current cached description/salary. Cache changes, removal and age-window transitions can therefore invalidate old guidance even when the tracker itself was not edited. Existing explicit AI generation, quota and post-generation source recheck remain. Opening source review makes no model call.

The UI also corrects one remaining interview snapshot timestamp label from “Sent” to “Saved.” A saved copy still does not prove submission or employer receipt.

## Privacy, rollout and rollback

No new data table, migration, dependency, configuration, token, permission, background worker, analytics payload or persistence writer. Existing tracker/cache records determine the comparison; existing export/delete covers the underlying private job record. This endpoint creates no additional retained personal data. Raw comparisons should not be put in logs or analytics. This is source inspection, not a passed security/privacy claim.

Review as a draft PR; no merge or manual deployment. Commits include `[skip ci]` to request skipping automatic GitHub Actions without changing workflows or protection rules. No CI dispatch/rerun is requested.

Deferred verification: authenticated ownership and foreign entry IDs; manual/absent/mismatched sources; stale/future/unknown timestamps and exact age boundaries; matching/changed/empty fields; partial-feed detail caveats; duplicate limits/order/attribution; literal untrusted strings and unsafe link schemes; coach source changes during generation and quota; refresh races/errors/account changes; disclosure/focus/mobile wrapping/scrolling; API/UI contracts, lint/typecheck/build/bundle budgets and regression suites. **None was executed for this increment.**

Rollback by reverting this increment's code. No schema or user-data rollback is needed. The previous resume comparison and existing feed/kit/worker flows remain independent.
