# Connected career workflows: implementation and remaining roadmap

This change implements a first set of connected workflows from the product review. It does
**not** complete the entire product roadmap or connect live external accounts.

## Delivered

| Workflow | Behavior | Boundaries |
| --- | --- | --- |
| Personal workspaces | Readiness, campus records, application-priority preferences and practical projects save to the signed-in account. | Explicit Save; account-scoped local drafts; revision conflicts return 409. Browser storage can fall back to memory. Downloads provide a backup. |
| Existing browser data | Candidates can inspect an old unowned browser record and choose to import it as a draft. | No automatic claim that legacy data belongs to the current account. Account switches and sign-out clear local career drafts. |
| Application progress | Tracker writes create stage observations in the same transaction. Reviewed-message bulk updates explicitly add their event. | No invented historical backfill. These are tracker observations, not verified employer outcomes. Future bulk status writers must add events explicitly. |
| Outcome statistics | Previously recorded interviews and completed employer rounds remain counted after rejection or withdrawal. | Existing five-application display threshold remains. Resume grouping still uses the current resume relationship; this is not causal attribution or a complete submission ledger. |
| Offline preparation | Opportunity rooms offer a private HTML prep download with notes, saved job text, current resume sections, rounds and saved questions. | Escaped text, no scripts or network requests; no implicit service-worker caching. Copies can become stale. Contact fields are excluded from resume sections, but user-written notes may contain personal data. |
| Practical work | Learning includes data analyst, backend and customer-support exercises, changed requirements, revisions and self-review rubrics. | Execution is in the candidate's own environment. No claimed skill certification or new code sandbox. |
| Reviewer sharing | Candidates inspect the exact project excerpt, then create a 7-day link. They can revoke it. API supports 1–30 days and 50 excerpts per account. | Anyone with a link can read/copy it. Token stored only as SHA-256; application logs redact its URL path. Configure edge/proxy logs to redact `/v1/career/evidence-shares/view/*` too. Copies cannot be revoked. |
| Posting versions | Refreshes retain up to 20 public-source versions for tracked posts, compare salary/location/level/requirements and other fields in source review. | History begins with observed refreshes; first 20,000 description characters only. Cache eviction does not prove closure. This is in-product review, not an email alert service. |
| Semantic comparison | Optional UI compares ordinary ranking with reciprocal-rank fusion using the configured BGE embedder. | Up to 40 already-eligible matches from the saved profile, top 10 displayed. Does not broaden recall. Temporary search-box overrides do not apply. Disabled when only hashing is available or the neural model is not ready. |
| Quality gate | A versioned 24-case synthetic employer-message set runs in CI with source-quote checks, language counts and dataset fingerprint. | Regression coverage, not a held-out production/model benchmark. Hindi/Hinglish cases check abstention only. |

## API and data lifecycle

- `GET/PUT /v1/career/workspace/{readiness|campus|priority|projects}`: strict nested
  contracts, 128 KB payload cap, account ownership and compare-and-swap revision.
- `GET /v1/career/prep-pack/{entry_id}`: owned, explicit portable material.
- `POST/GET /v1/career/evidence-shares`, `DELETE .../{share_id}`: create/list/revoke
  explicit excerpts. Public `GET .../view/{token}` returns escaped HTML with no-store,
  no-referrer, noindex and restrictive content security policy.
- `GET /v1/jobs/tracker/{entry_id}/posting-history`: owned opportunity's retained source
  comparisons. Public listing observations contain no user IDs; histories for untracked
  listings are pruned when those listings next refresh.
- `GET/POST /v1/jobs/semantic-preview`: model readiness and opt-in comparison.

Account export includes workspaces, stage history and shared excerpt content, excluding
share token hashes. Account deletion cascades through these account-owned tables. Deleting
an opportunity cascades its stage events. Shared excerpts are independent reviewed copies;
changing a project does not change an existing share. Explicit revocation removes its row.

Apply migration `b8e0f2a4c6d8` before running the new API against an existing database:

```sh
cd apps/api
uv run alembic upgrade head
```

No new dependencies or external credentials are required for the default workflows.
Semantic comparison reuses `ORBIT_EMBEDDER=bge-small` and the existing model warmup/cache.
It does not download a model from a request when unavailable. Keep the regular feed as the
default until representative relevance and performance evaluations justify promotion.

## Validation

- Focused API tests cover ownership, atomic revision conflicts, nested input rejection,
  exports, stage deletion, interview retention, excerpt expiry/revocation/escaping, portable
  prep, posting retention/cache eviction, and country/exclusion preservation in semantic
  comparison. Neural tests use a deterministic fake; no BGE quality result is claimed.
- Existing jobs, worldwide discovery, auto-apply, employer-message, timeline and manual
  tracker regression suites were exercised.
- Browser tests cover two-tab conflicts, another account's isolation, mobile excerpt
  review/sharing/revocation and horizontal layout. Chromium uses synthetic local accounts.
- SQLite migration upgrade → downgrade to previous head → upgrade was exercised on a
  disposable database. PostgreSQL deployment is not verified by this local check.
- Web build, TypeScript, lint, backend Ruff/Mypy and the synthetic message gate are part
  of the review checks. The two new browser tests are in `tools/e2e/career-workspace.spec.ts`.

Bundle-budget check: both unchanged base `845c61ff` and this implementation fail the same
six budgets (CSS, Sessions, Resumes, ResumeEditor, JobsAiPages and ToolExplorer). The entry
bundle measured 170.9 → 171.1 KB gzip; JobsAiPages measured 292.0 → 292.8 KB. Budgets were
not raised. Web lint reports three existing hook warnings outside the changed code. Ruff's
pre-existing long line in `f73a9e1c462d` was wrapped without changing migration behavior.

## Remaining work from the review

These items are **not implemented** by this change:

1. Recruitment mailbox OAuth, provider message identity and incremental sync; reviewed
   application matching; Google/Microsoft calendar reschedule and cancellation reconciliation.
   Needs a registered provider application, configured redirect URLs, credential storage and
   provider test accounts. Existing pasted-message/ICS workflows remain the available intake.
2. Immutable exact-file submission-attempt records with employer acknowledgement links.
   Existing packets, receipts and resume snapshots remain; the new stage ledger is not a
   substitute for this artifact chain.
3. Broader semantic candidate retrieval, learned reranking and representative relevance
   labels. Qwen/BGE model choices require an actual benchmark and licence review before a
   deployment choice; no additional model weights were installed here.
4. Full activation/outcome experiments and quality datasets for resume parsing, answer
   grounding, speech and interviews. The small message gate is a starting point.
5. Python/SQL isolated execution, independent reviewer feedback and evidence-vault linking.
   Project work and shared excerpts are candidate-authored, not execution-verified evidence.
6. Hindi/Hinglish speech/UI quality, device/network testing, and additional ASR/TTS evaluation.
7. Relationship/referral history, mentor feedback permissions, cohort/placement-team access,
   and external Business ATS/calendar integrations. Shared public excerpts do not grant
   workspace membership or editing rights.
8. Posting-change notifications, robust repost identity and sufficient-sample employer
   response statistics. Retained source changes alone cannot establish employer intent.

These require further implementation and validation; their absence is not described as a
configuration-only problem. This PR should be reviewed as the foundation release.

## Continuation: reviewed email-file intake

Employer-message review now accepts a single exported `.eml` file up to 512 KB.
The parser selects the main plain-text or HTML body, extracts text without loading
remote resources, and ignores attachments. Bodies must contain 20–10,000 characters.
Header sender/date values are explicitly unverified; the header date is never treated
as an interview date.

Import and preview retain no email on the server. A purpose-bound signed receipt
expires after 30 minutes and binds the extracted text to the account and opportunity.
Editing the text detaches the receipt in the UI; reopening the panel requires another
import to retain file provenance. Only explicit confirmation saves header metadata,
content hashes and chosen changes. A unique account/source constraint prevents replay
in the same transaction as the tracker update. Metadata appears in reviewed-import
history and account export, and cascades on account/opportunity deletion.

Migration `c9f1a3b5d7e9` follows the foundation migration. The existing pasted-message
workflow remains available. This is manual email-file intake, not mailbox OAuth,
continuous email synchronization, sender authentication or calendar reconciliation.

## Continuation: packet material preservation

New submission-associated resume snapshots also retain detached copies of packet answers,
form fields and the cover letter, with a canonical SHA-256 content digest. These are
captured alongside the existing candidate-recorded/executor-reported origin and travel
through the existing snapshot export/deletion lifecycle. Later nested packet edits do not
change captured materials. Historical snapshots are not reconstructed. This does not
capture uploaded binary file bytes or establish employer acknowledgement.

Captured packet materials can now be inspected and downloaded from packet-origin saved
versions in the opportunity resume panel. The owned read endpoint recomputes the canonical
content digest and reports mismatches explicitly. A matching digest establishes consistency
with the captured record, not authenticity, file delivery or employer receipt. Older saved
versions without captured packet content return an explicit unavailable result.

## Continuation: project-to-preparation tools

Projects with an initial solution and revision now offer a downloadable interview worksheet
with the candidate's work and prompts about contribution, tests, changed requirements and
tradeoffs. Accounts with the existing evidence-vault feature can also write a factual claim,
explicitly confirm its accuracy, and save it through the existing manual-evidence API.
Only the reviewed claim is copied; project notes and reviewer links are excluded. The claim
is candidate-authored and should identify synthetic practice, with no inferred certification.

## Continuation: project review plans

Practical projects now show next steps for missing initial work, revisions, reflections and
unchecked role-specific criteria. These reflect record completion and candidate self-review,
not correctness or skill assessment. A downloadable reviewer worksheet includes project
content plus spaces for supporting observations, missing evidence, suggested revisions and
one next task. Candidates review the file before sharing; downloaded copies cannot be revoked.

## Gmail delivery groundwork

The Gmail delivery module composes a reviewed plain-text application with an optional PDF
attachment and stable attempt Message-ID. Its send-once transport distinguishes a Gmail
message receipt, explicit rejection and uncertain delivery. Connection loss, inconclusive
server errors and success responses without a readable receipt remain uncertain and must
block automatic resend. Unit tests use HTTP mocks; no real email was sent.

This module is not yet exposed as a sending endpoint. OAuth connection, encrypted token
storage, persistent attempt reservation, account limits and the reviewed-send UI still need
to be connected before Gmail delivery is available to users.

## Gmail reviewed-send workflow

The Gmail groundwork is now connected to Settings and opportunity rooms. Account-bound
OAuth/PKCE stores encrypted refresh credentials; candidates prepare immutable email drafts,
review recipient/body/PDF and confirm each send. Durable conditional reservation blocks
repeat sends, including ambiguous/crashed attempts. Accepted sends retain Gmail's message
ID and move saved opportunities to applied. Tokens are excluded from exports. Deployment
configuration, behavior and live-validation limits are documented in `docs/GMAIL.md`.
Mailbox reading, continuous inbox synchronization and unattended automation rules remain
outside this sending workflow.
