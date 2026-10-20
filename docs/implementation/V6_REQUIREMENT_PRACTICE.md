# V6 increment 6 — requirement to reviewed practice

2026-10-21. Base `27cea82b`, PR #442 merged. F10 integration slice; F11 replay expansion remains separate. **Implemented / unverified. The owner explicitly requested no tests.** No tests, builds, lint, typecheck, browser checks, screenshots or validation scripts were run. No test files added or changed; earlier passing results do not apply.

## Candidate journey

Inside the existing opportunity's Understand step, open **Turn one requirement into a practice plan**. It opens on request, with no added primary tab or course marketplace.

1. Choose one requirement from the latest owned prior fit check. The first non-met requirement is a suggested starting selection, not a newly verified gap. All valid choices remain available. Choose a small project, explanation or coding exercise.
2. **Understand:** review the historical job quote and any candidate quote from that check. Long titles/quotes are bounded excerpts. Confirm the original job and clarify ambiguity.
3. **Try:** use the chosen format's small-task guidance and keep a concrete artifact. Existing Learning/Coding links open the appropriate tools. They do not automatically import the requirement or create an exercise.
4. **Review:** compare actual output with the original requirement. Record the date, artifact, contribution, observed result and limitations. Practice is not professional experience and does not change the historical fit result.
5. **Rehearse:** continue to this job's existing practice tools. After doing/reviewing the work, open the existing story bank or enabled evidence vault to record only truthful details. Opening these links creates no story, evidence or resume claim.

The four step buttons and previous/next controls show one stage at a time. Explicit step/selection changes focus and scroll the stage heading; background refresh does not move focus. Choice, format and stage can be represented by opaque source key and small enumerated query parameters, without raw requirement/evidence text in the URL. The workshop reads on opening, return to a visible tab and once per minute while expanded/visible, drops obsolete responses and clears output on failure. Replaced selections require choosing a current requirement instead of silently transferring a plan.

**Copy practice brief** writes the visible deterministic task guidance and requirement/date to the user's clipboard on click. It explicitly says it is a plan, not a completed achievement; generated AI suggestions are not included. No browser persistence or new saved project record is added.

## Optional AI continuity

The existing opportunity coach accepts optional `requirement_key` and `experiment_kind` parameters. The selected requirement comes from the server's current owned fit-check row, never from client-supplied task text. Its opaque key binds the check ID, original row index and full row content. A replaced/changed/absent requirement is rejected before AI reservation. The source version also binds the selected key/format and the existing opportunity/resume/source/fit context. The existing post-generation source recheck rejects guidance if that context changed during generation.

The selected requirement becomes the first Fit source fact, together with server-authored uncompleted-exercise language and the chosen format. Other generic requirement suggestions are omitted for this mode. Instructions request a bounded task, observable artifact, actual-result check and rehearsal prompt; no invented results, employer secrets or automatic resume claim. The requirement stays untrusted reference data inside the existing fenced workflow boundary. Existing quote validation and model-output contract remain; this is not semantic proof that generated advice is correct.

AI generation remains an explicit click, uses the existing `opportunity_coach` request kind and shared five-per-UTC-day reservation quota (including failures), and adds no agent tools, external requests, worker authority or application submission. Opening the workshop or coach reads local records only. A candidate quote is displayed privately in the workshop but is not added to model grounding. Existing callers without a selected requirement retain their request shape.

## Source and privacy boundaries

- GET `/v1/jobs/tracker/{entry_id}/mission/practice` uses the mission's existing authenticated owner check and read limit, then queries only that user's fit check for the tracked listing. The workshop and coach share the same deterministic latest-check ordering; the mission fit projection now uses the same tie-breaker.
- `requirement_practice.choices` reads at most twenty rows, bounds requirement titles to 500 characters and each quote to 600, skips malformed rows and labels unknown status explicitly. Prior model output does not prove a candidate lacks or possesses a skill.
- The Evidence link respects the existing server feature flag; no flag, permission or quota is enabled. No business candidate records, cross-account quotes, camera data, mailbox data or new analytics content are introduced.
- No new table, migration, dependency or persistence writer. Existing export/delete covers the underlying owned fit checks. No new exercise completion, evidence approval or artifact ledger is created. Do not log raw source quotes or practice briefs.
- Full F10 work tracking/artifact provenance and F11 debrief/retry comparison remain outstanding. This does not certify the earlier unverified F03/F06/F09 slices or expand their writers.

## Review, rollout and rollback

Draft PR for review; no merge or manual deployment. Backend first: new workshop route/coach options must be available before the new client. Older clients continue to use the existing coach fields. Reverting this increment's code requires no schema rollback or data rewrite. Copied user clipboard text is outside Orbit storage.

Commits include `[skip ci]` to request skipping automatic GitHub Actions; no workflow/protection rule is weakened, and no CI dispatch/rerun is requested.

Deferred verification: owned/foreign job and fit-check isolation; absent/malformed/long/unknown-status requirements; matching latest-check ties; row/check replacement and source changes before/during AI; malformed keys/unsupported formats; selected-step validation, quote grounding and shared quota; old-client compatibility; evidence flag; clipboard failure and no automatic writes; stale requests, tab/account changes, step URL restoration, focus, keyboard/mobile wrapping/scrolling; API/UI contracts, typecheck/lint/build/bundle budgets and regression suites. **None was run for this increment.**
