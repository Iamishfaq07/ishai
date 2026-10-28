# Business team reading desk

Business → Team reading adds a published-only reading workflow beside Knowledge Studio and Policy Reviews.
It does not change Orbit Personal, hiring decisions or job publishing requirements.

## Reader workflow

1. Choose a reference from **My reading**. The default queue shows new or changed guidance that the reader
   has not acknowledged. Search and status filters also show current acknowledgements.
2. Read the full published text. Authors also see the publication here, never their private saved draft.
   Documents flagged for updates or past their review date show a warning.
3. Optionally generate a quoted **AI reading guide**, with practical actions and self-check questions.
   AI does not assess the reader or record an acknowledgement.
4. Tick the explicit personal reading confirmation and choose **Record my acknowledgement**.
   A content change while the page is open returns a conflict; reload and read the current text.
5. Download a current receipt, revisit changed guidance or withdraw a mistaken acknowledgement.

Receipts are optional self-reports that someone says they read a document. They are not proof of comprehension,
training results, signatures or compliance certifications. No mandatory assignment or approval gate is added.

## What makes a receipt current

SHA-256 fingerprints cover the exact published title, body, category and audience, serialized with stable keys.
Changing any of these fields requires a new acknowledgement. Private draft edits, review dates, review owners,
reminder settings and update flags do not reset receipts. Review-date confirmation therefore does not create
unread work for unchanged wording. Re-publishing identical content after archive/restore can reuse a matching
receipt. An archived or unpublished reference is unavailable to readers regardless of any prior receipt.

One latest receipt is retained per document/person. It includes the fingerprint, publication revision actually
acknowledged and UTC timestamp. Repeated submissions of the same content preserve that timestamp and create
one audit action. A new explicit acknowledgement replaces that person's previous receipt; the existing Business
audit records the action and identifiers, without copying policy text. Withdrawal deletes the latest receipt
and records an audit action; it does not erase historical audit actions.

## Owner/admin coverage

**Team coverage** counts current active members eligible to read each published document. All hiring roles can
read `all_hiring`; only owner/admin/recruiter roles can read `coordinators`. Removed or suspended members are
excluded. A role or audience change immediately affects eligibility and current acknowledgement counts.
Receipts retained after membership removal are not counted; rejoining can reuse the person's matching latest
receipt. Eligibility means access to an available reference, not a mandatory assignment.

Owners/admins can inspect eligible readers, their latest timestamp/version and whether the receipt matches
current content. Recruiters and other readers cannot inspect other people's receipts. Reader details are
paginated at 100; exports clearly distinguish the aggregate summary from the displayed reader page.
Summary aggregation runs in the database rather than loading the entire company's individual receipt history.
The active document library retains its existing 100-document limit.

## AI and scope

Reading help uses the existing configured LLM provider and validated workflow-advice contract. It sends up to
six 1,200-character excerpts from the published body: all chunks for shorter documents, otherwise the first
three and last three. Omitted middle passages are disclosed before using the result. Every returned tip must
quote a supplied passage exactly; invalid tips are filtered, and a result without usable tips fails validation.
Quote validation checks attribution, not the correctness of every generated suggestion. Verify suggestions
against the full original; these bounded excerpts cannot establish a complete policy review.

Ten generation attempts per company per UTC day are reserved durably, including provider/validation failures.
This is a separate allowance from library Q&A and owner change-review briefs. Access, company status and the
content fingerprint are rechecked after generation, before returning results. No model tools or external
actions are enabled. No new model, parser, embedding index or runtime dependency is installed.

## API and persistence

Prefix: `/v1/business/companies/{company_id}/knowledge-reading`.

| Method / path | Purpose |
| --- | --- |
| `GET /` | Caller-visible publications and caller's receipt status |
| `GET /coverage` | Owner/admin aggregate current-member coverage |
| `GET /{document_id}/readers?offset=0` | Owner/admin eligible reader page, at most 100 people |
| `GET /{document_id}` | Published text and caller's receipt |
| `POST /{document_id}/acknowledge` | Explicit self-report: `{content_hash, confirmed: true}` |
| `DELETE /{document_id}/acknowledge` | Withdraw caller's latest receipt |
| `POST /{document_id}/guide` | Read-only quoted advice: `{content_hash}` |

Writes use a company transaction lock and refreshed authorization. Company/document boundaries and the published
audience apply to all reader endpoints, including authors. There is no request field to acknowledge for someone
else. Strict request contracts reject unexpected fields. Receipt uniqueness is enforced by the composite
document/user primary key; document and user foreign keys cascade deletion. Document hard deletion removes
receipts as well as publication/event history. No independent policy-text copies are stored in receipts.

Migration `ef93a6c7d041`, parent `de82f4b5c930`, creates only `biz_knowledge_receipts`. Existing publications and
receipts are not inferred from prior page views. Upgrade/downgrade does not rebuild the document table;
downgrade drops receipts while preserving policy publications/history. Apply the migration before deploying
the API. No production migration or deployment was run in this task.

## Verification

API tests cover published-only content, strict confirmations, concurrent idempotency, withdrawal, wording and
audience changes, draft/review-date stability, tenant/role boundaries, archive/delete behavior, membership
coverage, pagination, source-quote validation, quota accounting and access/content changes during generation.
A migration roundtrip checks history preservation and cascading deletion. Business unit tests check queue
filtering/status. Chromium exercises reader and owner workflows, a stale checked page, receipt download,
withdrawal, mobile overflow and WCAG automated checks. AI checks use mocks, not a live-provider quality study.

The Business verification banner also now appears only for job-managing roles; the Verify action is restricted
to company managers. Interviewers no longer receive a company-setup action they cannot perform.
