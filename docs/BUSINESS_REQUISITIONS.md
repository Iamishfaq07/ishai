# Business hiring requests and AI planning studio

Open **Business → company → Hiring requests**. The route is
`/business/app/:companyId/requisitions`; individual requests have a shareable `?request=:id` address
that still requires membership and permission. These are internal requests, not applicant records.

## Workflow

1. Create a request with a role title, then save its department, headcount, annual budget per position,
   target date, location, business case, desired outcomes and essential requirements.
2. Optionally use **AI planning studio** on the saved request. Choose intake clarification, interview
   evidence planning or budget-review questions. Each suggestion quotes a server-supplied fact, includes a
   success check and lets the reader expand the original fact. Invalid/unquoted responses fail validation.
3. Choose 1–3 different active owners/admins in approval order. The requester and person submitting cannot
   appear in that route. An independent colleague is required; existing team seat limits still apply.
4. Submit with a note. Submission requires a business case and outcomes of at least 20 characters each,
   at least one requirement and an annual budget. The submitted brief is fixed while reviewers act.
5. The current reviewer can approve their step or request changes. Changes return the request to draft
   and clear its approval route. Reopening an approved/pending request also clears approvals.
6. Once every step is approved, an authorized recruiter/owner/admin can explicitly create a linked job
   draft. Retries and concurrent handoffs return that same job. Active approver eligibility is rechecked.
   Review/edit the job before publishing; this handoff does not publish it or send candidate messages.

The draft includes the role outcomes, essential requirements, department, location and workplace. The internal
business case and budget are not copied. The budget is an internal annual cost envelope, not advertised salary.
A hiring-manager requester is assigned to the draft's hiring team if they still hold that role. Headcount stays
in the request; this release creates one job draft and does not calculate positions filled or actual spend.

This desk does not impose a new publishing gate on existing jobs or other job-creation paths. Requests are
an explicit planning workflow. Making company-wide requisition approval mandatory is future policy work.

## Access and consistency

- Interviewers cannot access the desk or its API.
- Owners, admins and recruiters see the company-wide desk. Hiring managers see their own requests.
- The requester and company owners/admins can edit draft content and submit/reopen/cancel requests.
  Recruiters can create their own requests and hand off approved requests using their existing job permission.
- Only the current assigned active owner/admin can approve. Requesters cannot approve their own request.
- Suspended companies cannot write or generate AI previews. Write permissions and membership are refreshed
  after acquiring the company lock; AI access and request revision are checked again after generation.
- Every mutation uses a revision check. A stale request returns 409. The UI keeps unsaved edits and offers
  **Download request** before reloading. Unsaved edits live in the page, not an automatic cross-device draft.
  Leaving via the page's back button or closing/reloading warns about unsaved changes.
- Each decision requires a note. Submission snapshots, approval steps, changes, cancellations and job handoffs
  are recorded in the request history and company audit metadata. Notes and private briefs stay in the request
  history rather than being copied into the long-lived company audit target text.
- Internal notifications alert the next reviewer and requester on changes/approval, linking to the desk.
  These do not send emails. Removed company members no longer receive notifications through the list API.

## Bounds and AI behavior

The desk loads 50 requests per page with keyset pagination and literal title search. Summary counts and budget
numbers cover loaded rows and current filters; separate currencies remain separate. A company can retain up to
500 active draft/pending/approved requests. Detail/download includes the latest 100 history events and labels
truncation; earlier events remain stored. Terminal requests are retained for the review trail.

All three AI modes share 10 attempts per company per UTC day, including malformed, unavailable and stale-result
attempts. The existing provider request ledger records usage and costs. Reference content is fenced as untrusted
data; output is bounded and validated against exact source quotes. Request text is sent to the configured AI
provider when a person requests a review. No resumes or candidate data are queried by this feature.

Mock previews are explicitly labelled in the UI. A live provider failure leaves saved work unchanged and returns
an actionable error. The model cannot call tools, approve requests, modify the budget or create/publish jobs.
Exact source quotes establish provenance; the user must still assess the usefulness of each suggestion.

## Rollout and verification

Apply `alembic upgrade head` before starting the new API. Migration `be39d8a2f710`, after `ad418a8cecb0`, adds only
`biz_requisitions` and `biz_requisition_events` plus their lookup indexes. No new secret or service is required.
Downgrade drops the new request history, so export/preserve it before any rollback after adoption.

Tests cover sequential approvals, independent review, eligibility changes, suspension, tenant/manager scope,
strict input bounds, idempotency, concurrent handoff, immutable submitted content, version conflicts, literal
search and paging, notifications, all AI modes, forged citations and stale AI responses. Migration tests cover
upgrade/downgrade/re-upgrade and both historical migration branches. Browser coverage exercises the UI across
requester and reviewer accounts, AI preview, a two-tab conflict with downloaded recovery, approval, one job draft,
private budget/business-case handling, mobile dark mode, reduced motion and accessibility checks.

- API: `uv run pytest tests/test_business_requisitions.py tests/test_business_requisition_migration.py`
- UI models: `pnpm --filter @orbit/web test src/business`
- Browser: `pnpm exec playwright test tools/e2e/business-requisitions.spec.ts`
  Set `ORBIT_TEST_API_URL`, `ORBIT_TEST_OUTBOX` and `ORBIT_TEST_ADMIN_EMAIL` when using custom fixtures.
  The disposable API must use that admin email, mock providers and a local development outbox. The fixture grants
  a test company plan through the administrator API and never makes a payment or calls a real email provider.

This work does not deploy production changes. Real-provider AI output quality, Postgres concurrency and broader
non-Chromium/assistive-technology behavior require their respective environments. Postgres CI includes the new
requisition suite; local verification does not claim those hosted checks ran successfully.

Local results (28 October 2026): 57 backend/migration/Business regression tests passed, 34 Business web unit
tests passed, and the end-to-end Chromium workflow passed. The web production build (including prerender),
API mypy (327 source files), Ruff and web lint passed; lint retains three pre-existing warnings outside Business.
AI calls used the mock provider; no live candidate email, production migration or deployment was performed.
