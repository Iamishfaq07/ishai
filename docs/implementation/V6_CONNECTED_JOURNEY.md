# V6 increment 7 — connected tools, one opportunity

2026-10-21. Base `ddc03794`, PR #443 merged. Continues the V6 Phase 2/3 shared-context and F10/F11 integration work. **Implemented / unverified: the owner's no-tests instruction remains active.** No tests, builds, lint, typecheck, browser checks, screenshots or validation scripts were run. No test files added or changed. Earlier passing results do not validate this increment.

## Simpler candidate flow

- The existing five opportunity steps remain. Guided Fit/Company and Interview/Plan/Practice navigation uses small purpose-led cards, replacing the hidden tool selector. The complete-tools view and legacy routes remain available.
- One **Help and updates for this job** disclosure groups existing AI guidance, employer reply review and calendar invitation review, showing only the choices for the current step. AI generation and stage/date changes still require their existing explicit actions. Previously visited reply/invitation forms stay mounted while switching choices or closing this disclosure, preserving unsaved inputs in memory during the same mounted job view. A job change remounts the guided container. Leaving the page or switching out of guided mode can still discard unsaved inputs; no browser persistence is added.
- A fit-result action opens the requirement workshop directly. Its Learning, Coding, Story bank and Evidence links carry a bounded job-return trail, the selected requirement key, format and stage.
- Learning → Coding home → individual problem → All problems preserves that trail. Story/evidence pages and completed session review show the same owned opportunity banner. The library's Resume pointer returns to the selected job's linked-resume step when context is present.
- The banner gives one primary return and one relevant onward action, with other connected tools inside a disclosure. **Use this tool on its own** removes the trail while retaining unrelated page query parameters. Without a job trail, these pages stay ordinary standalone tools and make no new context request.
- The opportunity Practice step links to learning and the story bank, and opens **Review previous rounds, then try again** on request. It reuses the existing timeline, filtered to rounds with the newest first. Completed session links open the existing debrief/retry page with a return to the job. No transcript is automatically copied into a story or resume.
- Tracker tool-search descriptions/keywords now mention the connected requirement, learning, story and round-review flow.

## Navigation identity and ownership

`opportunityTrail.ts` carries only a bounded job ID, recognized mission tool, optional 64-character requirement key, enumerated format and stage, and workshop flag. It does not accept an arbitrary return URL or copy raw job text, evidence, transcript or message bodies into URLs. Context is forwarded only to supported local Learning/Coding/Story/Evidence/Session-review paths. Unsupported/external destinations do not receive added context; this helper is not a general-purpose URL sanitizer.

`GET /v1/jobs/tracker/{entry_id}/mission/context` uses the existing authenticated owner check and mission rate limit, returning only job identity, title/company and the existing evidence feature flag. It reads no fit body, private library item or business-candidate data. The banner remounts by authenticated account ID and job ID, uses no shared response cache, ignores obsolete requests, clears metadata on error, and rereads when returning to the visible page. Feature flags and existing library/session authorization remain authoritative.

The trail is **navigation context only**. It does not link a library artifact, confirm a skill, record completion or establish that a particular session was for that vacancy. The existing timeline includes sessions explicitly linked to the job and unlinked sessions matched by company name since the job was saved; that heuristic is disclosed in Practice. Session detail still enforces its own ownership. No new round matching or session association writer is introduced.

## Boundaries and remaining work

No new database, migration, dependency, AI request kind, model tool, application permission, evidence writer, analytics content or external-send flow. The existing coach/quota, message/calendar reviewed writers, resume snapshots, source review and requirement source checks remain. No model generation happens merely from opening the new context banner.

This connects existing F10/F11 tools; it does not implement durable experiment/artifact provenance, new transcript scoring, automatic story extraction or guaranteed cross-tool completion. A fresh live-session launch is outside this return-trail slice; session creation/association and launch consent are unchanged. Full F03/F06/F09/F10/F11 acceptance and earlier unverified slices still need later verification.

The browser URL can retain opaque navigation identity in normal history. It is not a public share token and never grants access. No new local/session-storage records or server-side user records are created. Existing export/delete covers the source job and personal tools. Raw URLs containing account/job identity should not be added to analytics payloads or public reports.

## Review and later verification

Draft PR for review; **do not merge**. No merge or manual deployment. Backend first for the new context route, then the client. Reverting this increment needs no schema rollback or data rewrite. Commits use `[skip ci]` to request automatic GitHub Actions skipping; no workflow/protection change, dispatch or rerun.

Deferred checks: owned/foreign/deleted jobs and account switches; malformed trail parameters and unsupported destinations; local URL encoding and native query preservation; no metadata leakage across accounts; requirement source replacement on return; evidence flag; standalone pages without a trail; Learning/Coding/library/session return loops; timeline heuristic disclosure; reply/invitation input preservation and explicit saves; hidden-panel focus/tab order; card navigation/history/focus/mobile scrolling; existing AI quotas and writer fences; API/UI contracts, lint/typecheck/build/bundle budgets and regression suites. **None was executed for this increment.**
