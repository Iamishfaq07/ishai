# Business Hiring Studio

Review branch: `business-hiring-studio-2026-10-19`. Rebased onto main `4144f8a3` after its Orbit Apply update.
This change is for company hiring and the associated applicant portal. It does not add an automated hiring decision.

## What ships

- **A versioned interview plan per job.** Criteria, stage-specific questions, follow-up probes, strong/weak anchors,
  time guidance, candidate expectations and an internal response target. Suggested criteria start from the job's
  requirements and remain editable. Saving uses an explicit revision check.
- **An interview room per applicant.** Verified excerpts from the resume the applicant shared, consistent questions,
  a local pacing timer, private drafts and sealed submissions. A submitted score requires an actual observation;
  optional quotes must occur in the selected source. No model invents an interview observation.
- **Independent panel feedback.** Interviewers see eligible peer submissions only after submitting their own for that
  stage. Owners, admins and recruiters can coordinate the debrief. Other people's drafts are never exposed, including
  to coordinators. The older application, scorecard, notes and ranking routes respect the same visibility boundary.
- **Evidence coverage and debrief.** Unobserved criteria, panel disagreement, missing reviewers, old rubric versions
  and incomplete required challenges remain visible. A human records their rationale against the current evidence
  version. Final recommendations with gaps require acknowledgement. Recording a recommendation does not silently
  change the application's stage or send a rejection.
- **A practical task followed by a changed constraint.** The candidate first submits a solution and reasoning, then
  receives a follow-up asking them to adapt it. Both submissions and the assigned brief are preserved. Templates
  cover engineering, support, operations and sales; employers can edit them. Candidates disclose assistance.
  This is a conversation about work and judgement, with no automated grading, personality inference or cheating score.
- **Candidate preparation and clarification.** The existing private application link shows assessment areas, time
  guidance, the assigned task and a question form. Questions appear in the hiring desk and interview room; recruiters
  reply using the existing email workflow. It is not a live chat or a notification delivery guarantee.
- **Hiring desk and finalist comparison.** Upcoming booked interviews, feedback due after the interview ends,
  questions, deletion requests and stalled applications. Compare 2–4 applicants against the same criteria.
  There is no automatic winner.
- **Design and graphics.** Calm workbench surfaces, responsive layouts, actual evidence-coverage SVGs and a daily
  applications chart, accessible exact-value alternatives and reduced-motion-aware transitions.

## Bugs addressed

- Shared panel members could be double-booked across applications. Booking now serializes at the company boundary
  and checks overlapping active bookings inside Orbit.
- Retrying the same booking sent duplicate invitations. An identical retry now returns the existing booking.
- Calendar attachments used new identifiers on each booking. A booking now has a stable calendar UID and increasing
  sequence, and the candidate can download the current event.
- A booked interview had no usable cancellation/replacement path. A team member can revoke the old invitation,
  notify the candidate and offer new slots. A cancelled booking releases availability and disappears from the desk.
  Imported calendars still depend on the recipient importing/updating the event.
- Blind review masked the resume but could expose identity in free-text notes and evidence. Those surfaces are masked
  consistently; optional quotes can be checked against the redacted source too.
- Independent review could leak peer recommendations through legacy endpoints and notes. Those reads are gated;
  ranking scores and score-based ordering are withheld from independent reviewers.
- Company/application/job route changes could briefly display another selection's data. Loading boundaries and
  asynchronous response guards prevent those stale results from being shown.
- Analytics totals used a rolling 30-day timestamp while daily rows used a different window. Both now cover today
  and the previous 29 UTC calendar days, including zero-count days. Company analytics batches per-job data instead
  of issuing two additional queries per displayed job.

## Research and product decisions

Reviewed primary project documentation and repositories on 19 October 2026. Features below are documented patterns,
not a claim that Orbit invented structured interviews or is uniquely best in the market. No third-party source code
was copied and no new runtime dependency was introduced.

- [Frappe HRMS](https://github.com/frappe/hrms) and its
  [interview documentation](https://docs.frappe.io/hr/interview) show how recruitment, rounds and feedback fit into a
  broader HR system. Orbit keeps this release focused on the interview-to-decision gap instead of adding payroll.
  HRMS is GPL-3.0; it is a reference, not a dependency.
- [OpenATS](https://github.com/chamals3n4/OpenATS) covers careers, pipelines, assessments, candidate scoring and
  scheduling. [Its scoring guide](https://www.openats.dev/docs/using-openats/candidate-scoring) reinforces the need
  for explicit criteria. Orbit already had screening/ranking; the added coverage comes from human observations.
- [HireLens](https://github.com/abhay-yemekar/hirelens) includes evidence-linked resume assessment, blind review and
  interview preparation. Evidence maps alone are therefore not a defensible novelty claim. Orbit connects excerpts
  to private panel observations, an immutable practical task and a decision record.
- [HackerRank's hiring agent](https://github.com/interviewstreet/hiring-agent) demonstrates structured resume
  analysis. This release uses only the snapshot an applicant shared, and adds no background social-profile scraping.
- [Greenhouse's structured hiring guidance](https://www.greenhouse.com/guidance/an-introduction-to-structured-recruiting-and-greenhouse)
  and [scorecard visibility controls](https://support.greenhouse.io/hc/en-us/articles/16187220652059-Scorecard-visibility-options)
  support agreeing on criteria before interviews and controlling access to peer feedback.
- [Ashby debriefs](https://docs.ashbyhq.com/debriefs),
  [visibility options](https://docs.ashbyhq.com/visibility-options-for-users) and
  [take-home assignments](https://docs.ashbyhq.com/send-and-review-take-home-assignments)
  illustrate mature collaboration and assessment workflows. Orbit adopts the useful principle of independent
  feedback while making uncertainty and missing evidence visible.
- [Cal.diy](https://github.com/calcom/cal.diy), reached from the former Cal.com community repository, explicitly
  describes a personal-use community fork. It is not treated as a ready-made enterprise scheduling backend.
  Orbit's new conflict check is deliberately limited to its own company bookings.

The differentiating product direction is the connected loop: **plan → initial solution → changed constraint →
independent observation → evidence discussion → accountable human decision**. The follow-up invites candidates to
explain decisions and adaptation even when they use modern tools. Its usefulness should be validated with employers
and candidates; this release does not claim predictive validity or fairness certification.

## Boundaries and next integrations

- **External availability:** Google/Microsoft calendar OAuth, busy-time sync, time-zone preferences and webhook
  reconciliation are valuable next integrations. They need real provider credentials and recovery handling.
  This PR does not claim to check external calendars or cross-company bookings.
- **Meetings:** consent-based recording/transcription and links from approved meeting providers can follow.
  The local interview timer neither records nor transcribes a meeting.
- **Enterprise operations:** SSO/SCIM, configurable approval chains, richer offer workflows, validated HRIS exports
  and source attribution integrations deserve separate scoped changes and customer validation.
- **Assessment evolution:** additional role templates, calibrated rubric libraries and accessible submission formats
  can extend the existing versioned contracts. The current task accepts text/code, not executable uploads.
- Desk queues scan at most 2,000 active applications and display capped lists; feedback due covers the last seven
  days. The UI states those bounds. Large-company pagination should be the next scale improvement.
- Private drafts are explicitly saved. Sealed feedback and candidate submissions cannot be overwritten.
  Formal correction/addendum workflows are a useful future extension.

## Data and rollout

Migration `36a8f2c9d7e1` adds `biz_hiring_plans`, `biz_interview_feedback`, `biz_work_samples`, and panel/revision
columns on `biz_interviews`. Production uses `alembic upgrade head`. Existing jobs retain their older scorecard
workflow until a plan is saved. Existing interview rows use their assigned panel/creator as a fallback.

Application deletion removes the new feedback and task records. Existing candidate retention and deletion-request
rules remain in force. Company access and assigned-applicant rules apply to every authenticated endpoint.
Public routes use the existing high-entropy application token and rate limits; that link is a credential.

The migration is additive. Downgrading discards the new hiring evidence tables, so preserve those records before
rolling back a deployed feature. This PR is for review and is not merged or deployed by this task.

## Verification

- Backend integration coverage: plan revisions, tenant boundaries, protected screening prompts, independent feedback,
  draft/sealed semantics, source quotation checks, frozen rubric versions, two-phase immutable candidate work,
  deletion restrictions, blind masking, comparison boundaries, human decision acknowledgement/idempotency,
  booking conflicts, stable calendar identifiers, cancellation and candidate questions.
- Frontend model tests cover evidence counts, safe navigation, candidate response validation, template bounds and
  isolated plan edits. Repository-wide frontend tests also enforce the shared design and motion rules.
- `tools/e2e/business-hiring.spec.ts` exercises real HTTP, cookie auth, database persistence, DOCX parsing and React UI.
  It checks the company and signed-out candidate journeys, light/dark layouts, mobile width, reduced motion and axe.
  The API uses explicit mock/fake providers only in the test environment and a local dev email outbox.
- Existing migration-link regression checks now name the historical downgrade target explicitly and also cover the
  new migration's independent downgrade/upgrade.

Run: `uv run pytest -q tests/test_business_hiring_studio.py` in `apps/api`,
`pnpm test`, `pnpm --filter @orbit/web build`, and
`pnpm exec playwright test tools/e2e/business-hiring.spec.ts` from the repository root.
PR checks and the review summary record the actual results and any unavailable infrastructure.
