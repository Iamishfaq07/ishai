# Application agent and tool discovery

## Workspaces

**Jobs → Application agent** (`/jobs/journey`) promotes the next incomplete career step, shows runtime status,
daily counts and pause/resume, and offers an expandable full journey. It refreshes every 30 seconds.

**Shortlist preparation:** save live feed jobs, select up to 20, and prepare them through the existing planner.
Resume approval, current consent, pause/hired, threshold, search/filter, freshness, duplicate, company cap and queue
gates remain. This does not postpone the periodic whole-feed sweep. Automatic mode may send eligible packets;
review mode waits for approval. Preparation is not submission proof.

**Captured posting:** new packets retain the cached description used for their materials, surviving feed cache
eviction. It is visible in packet detail and account export. Rebuilding an unsubmitted packet refreshes both
materials and description. Legacy packets have no archive; they are not backfilled with newer text labelled as
original. The archive is a cached description, not a screenshot of the employer's live page.

**AI second reader:** open a packet and choose **Open AI second reader → Review with AI**. Advice compares the
captured posting, current posting if different, current source resume, prepared resume, cover letter and open
questions. Exact source quotes accompany suggestions. The current resume may have changed since approval. Advice
never pauses, edits, approves or submits a packet. Demo responses are labelled.

**Personal ↔ Business switch** appears in public, personal and company headers, including mobile. Company
selection, membership and role permissions still determine access.

**Explore tools** (`/tools`) has 18 cards, audience/workflow/AI/automation filters, searchable descriptions, native
SVG graphics and reduced-motion support. Filters survive reload and fast edits compose. Business cards preserve
the requested tool through company selection. Public navigation, Home, Explore, command palette and the Business
header link here. The page is prerendered and indexed.

## Extension-free execution

The existing hosted worker supports Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable and Recruitee
employer forms. A candidate's device can be off. New setups suggest hosted mode when enabled; general and hosted
consent remain explicit, and existing choices are preserved.

This PR does not deploy/provision the worker. An enabled, online worker, valid approvals, consent and quota are
required. Offline workers wait. CAPTCHA, login, 2FA, unknown attestations and unsupported sites need the candidate.
Orbit Direct uses its existing server path. See [HOSTED_APPLY.md](HOSTED_APPLY.md) for deployment, restrictions,
submission fences, receipts and rollback.

## API and data

- `POST /v1/apply/plan-shortlist`: `{ "listing_ids": ["owned-saved-listing-id"] }`, 1–20 IDs. All must still be
  saved by the caller. Returns the existing plan report and shares `/plan`'s rate limit.
- `GET /v1/apply/packets/{id}/review`: owned source facts and a version.
- `POST /v1/apply/packets/{id}/review`: `{ "version": "source-hash" }`, up to four tips using different source IDs.
  Changed sources return 409 before/after inference. Unsupported quotes, unknown IDs, duplicates, invalid lengths
  and malformed output are rejected. Text is fenced as untrusted data. No model action/link is executed.
- The workflow helper reserves five attempts per user per kind per UTC day, including failures, before inference.
  One call, 60-second timeout, 3,000 output tokens. Full account authentication and verification guards apply;
  extension tokens cannot reach shortlist/review. Suggestions are advisory, not truth certificates.
- Migration `7fc84a231d90`, after `69db05a3e8f4`, adds nullable `application_packets.posting_text`. Run migrations
  before the API. Export already serializes packet columns; deletion cascades packets. Downgrade removes posting
  archives, so export anything needed before rollback.

## Open-source research — 20 October 2026

No external skills, executable scripts or third-party agent code were installed or copied. References are pinned.

### MadsLorentzen/ai-job-search — MIT

[Repository d3308bb](https://github.com/MadsLorentzen/ai-job-search/tree/d3308bbd9f0485ad4c6cb64e6d3d826e7a91b80c),
[application workflow](https://github.com/MadsLorentzen/ai-job-search/blob/d3308bbd9f0485ad4c6cb64e6d3d826e7a91b80c/.claude/commands/apply.md).
It evaluates postings, drafts truthful documents, reviews them, checks PDFs, and records drafted work with an
archived posting. The inspected command is not an unattended SaaS submitter. Orbit adopts its review/traceability
ideas within the existing account/application system. Resume generation/readability scoring already exist.

### Yaima/agent-apply — MIT

[Repository e5061bc](https://github.com/Yaima/agent-apply/tree/e5061bc0455ea61b75b59edbe73296ab5bbe03ca),
[runner](https://github.com/Yaima/agent-apply/blob/e5061bc0455ea61b75b59edbe73296ab5bbe03ca/run.py).
Shortlists, liveness checks, dry runs and outcomes are useful patterns. Its live runner requires a visible browser
and human confirmation; Workday uses assistance. Orbit adds owned shortlist selection and retains hosted execution
and uncertain-submission fences. This reference does not establish universal unattended ATS coverage.

### browserbase/stagehand — MIT

[Repository c6b6f27](https://github.com/browserbase/stagehand/tree/c6b6f278c880d2f8b770ac0c1ecc63f248515968).
Structured extraction and separating observation/actions are useful browser-agent patterns. Orbit keeps its
deterministic executor and validates structured advice. A general agent would need equivalent domain, credential,
quota and submit fences. This PR does not install Stagehand or delegate submission to an LLM.

### browser-use/browser-use — MIT

[Repository aa093a8](https://github.com/browser-use/browser-use/tree/aa093a843da5edbf323c0b4145c9b6a0db3ecde8).
The general browser-agent framework is useful research for assisted navigation, not proof of reliable coverage on
every hiring site. Orbit retains its hosted adapters and introduces no unrestricted agent browser.

## Verification

API coverage includes shortlist ownership, selected-only preparation, pause/threshold/exclusion/consent gates,
duplicate preparation, periodic planning, grounded advice, stale/concurrent edits, durable AI budgets, retained
postings after cache changes/deletion, account export and legacy packets. Existing planner/hosted suites exercise
execution with fixtures. Browser coverage includes discovery, switching, company routing, shortlist, pause/resume,
captured postings and AI review on desktop/mobile, accessibility and reduced motion. No real employer applications
or external emails are sent by verification. SQLite upgrade → downgrade → upgrade is checked locally. PostgreSQL
checks are included in CI; container deployment and live employer sites are separate verification environments.
