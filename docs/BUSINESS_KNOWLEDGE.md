# Business knowledge studio

Open **Business → company → Knowledge studio** at `/business/app/:companyId/knowledge`.
This workspace contains company-owned hiring policies, interview playbooks, joining guides and operations
procedures. It does not query applicant records or Orbit Personal data.

[Policy review inbox](BUSINESS_KNOWLEDGE_REVIEWS.md) adds document responsibility, explicit confirmations,
update-request warnings and opt-in internal reminders after publication.

## Author, publish and review

Owners/admins can create a document from 50–20,000 characters of text. A private draft contains a title,
category, audience and optional review date. Saving a draft leaves the current published version unchanged.
A publisher explicitly reviews and publishes the saved version with an action note.

Published audiences are:

- **All company hiring members:** every current company member, including assigned interviewers.
- **Owners, admins and recruiters:** company coordinators; hiring managers/interviewers cannot read these sources.

An audience change takes effect when the saved version is published, together with its text. Readers receive
only the current published snapshot. Draft titles/content, past versions and action notes are restricted to
owners/admins. Publication versions can be downloaded by their version number; the screen lists the latest 20.
The latest 50 publication actions and their notes appear in the editor. Older records remain stored.

A review date is a freshness signal, not a guaranteed expiry or legal determination. Past-due guidance remains
available with a visible warning, including in answers citing it. Readers should confirm its currency with
its owner. Reader timestamps refer to publication, not a later private draft edit.

Archive removes a document from reader access and AI retrieval. Restore returns an unpublished draft and requires
explicit publication again. Permanent deletion removes the document, publication snapshots and action notes.
Company audit metadata retains action/document identifiers, without copying policy bodies or free-text notes.
Already-viewed or exported material cannot be recalled from people who previously received it.

## Ask questions and build checklists

A member can ask a question or request a practical checklist from published references available to their role.
They can use the full active library or select up to 20 published documents. Retrieval is local and lexical:
it ranks matching words in titles and text, returns at most eight 1,000-character passages, and limits any one
document to three passages. It is not semantic/vector search and can miss paraphrases or multilingual matches.

The model receives the question and selected source passages through the configured provider. Every answer point
must name a supplied passage and quote 8–600 characters exactly. Unsupported/forged references fail validation.
The user can inspect each quoted passage and open the original document. Quotes establish provenance; they do
not automatically establish that the model's interpretation is correct. Conflicting guidance should be reviewed
by the company rather than treated as an automatic policy decision.

With no lexical matches, the server returns **Not enough evidence** without calling a model. The model can also
abstain when matching passages do not answer the question. No candidate evaluation, external search or executable
tool action occurs. Answers and checklists do not approve requests, publish guidance, send communications or
change hiring stages.

Generated results are bound to the accessible published-source snapshot. The server rechecks company membership,
account/company suspension and source versions after generation. Publishing, archiving, deleting or changing
access during generation invalidates an outdated answer. The UI also discards replies to changed questions,
formats, selections or source snapshots. Refresh the library to discover changes made after an answer was shown.
Questions and answer threads are not persisted in a new conversation store; the existing provider usage ledger
records request metadata/cost. The active UI session retains its current answer until inputs/view change.

## Turn working notes into reviewed guidance

Readers can **Download cited notes** with the question, source snapshot, exact quotes, document IDs and versions.
Owners/admins can choose **Create draft playbook** from a generated checklist. The new draft keeps citations,
starts with coordinator-only access and remains unpublished. Its author reviews/edits it and explicitly publishes
it using the normal library controls. A source-version check blocks new derivations from stale knowledge; a
request ID makes retries of a successful creation idempotent. Draft content is still an author's working material,
not a model-certified policy. Publishing it is a deliberate company action.

## Bounds, permissions and rollout

A company can have 100 active documents; archive older material before adding/restoring another. Administrators
see up to the 200 latest updated documents, including archives, with a truncation notice. Reader lists include
only accessible active publications. AI retrieval covers the active accessible library, even if older active
references are outside an administrator's capped archive-heavy list.

Both AI formats share 10 generation attempts per company per UTC day, including invalid/unavailable/stale
attempts. Zero-match lookups do not consume a generation attempt. Existing rate limits and the provider cost
ledger apply. There is no new external service or dependency. Real-provider behavior depends on the configured
LLM; mock previews are visibly labelled and do not pretend to be live AI output.

All writes require an active company and a freshly checked owner/admin membership. Revision checks protect
concurrent editing/publication. Stale editors keep their unsaved text and can download it before reloading.
Unsaved edits live in the page; the back button and browser-close/reload warning help prevent accidental loss.

Apply `alembic upgrade head` before the API release. Migration `cd71e3a4b820`, after the hiring-request migration
`be39d8a2f710`, adds `biz_knowledge_documents`, `biz_knowledge_publications` and `biz_knowledge_events`.
Downgrading removes these new records, so preserve needed policy/history before rollback. No production migration
or deployment was performed by this task.

## Validation

Local results on 28 October 2026:

- 31 backend/retrieval/migration/regression tests passed, including the previous Business requisition workflow.
- 38 Business web unit tests passed, including portable citation exports and stale-response identity checks.
- Chromium workflow passed: owner/private draft → publication → interviewer access → cited answer/checklist →
  download → derived private playbook → two-tab conflict recovery → audience restriction → archive/restore.
  Long unbroken source titles, 390px mobile dark mode, reduced motion, axe and overflow checks passed.
- API mypy (329 source files), Ruff, web TypeScript, lint and the production build/prerender passed. Lint retains
  three existing hook warnings outside Business.

AI calls used mock providers. Live-provider answer faithfulness, retrieval quality on representative multilingual
company corpora, hosted PostgreSQL concurrency and non-Chromium/assistive-technology behavior require their own
validation. PostgreSQL CI includes the new Business knowledge API tests; this does not claim CI ran here.

Relevant suites: `tests/test_business_knowledge.py`, `tests/test_business_knowledge_retrieval.py`,
`tests/test_business_knowledge_migration.py`, `src/business/knowledgeModel.test.ts`, and
`tools/e2e/business-knowledge.spec.ts`. Browser fixtures require a disposable mock-provider API with a local outbox;
set `ORBIT_TEST_API_URL`, `ORBIT_TEST_OUTBOX` and `ORBIT_TEST_ADMIN_EMAIL` for custom addresses. The test grants a
fixture plan through the administrator API, sends only local development email and makes no payment.
