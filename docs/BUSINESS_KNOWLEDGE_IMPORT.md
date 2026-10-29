# Business knowledge file import

Owners and admins can choose **Knowledge studio → Import policy file**. Uploading extracts a preview;
it does not create a document, publish anything or send content to an AI provider automatically.

## Review-before-save workflow

1. Choose a company policy/playbook in PDF, DOCX, UTF-8 TXT or Markdown format.
2. Read the extracted preview alongside the original file. Paragraph/table order can need repair. Import
   limits and omitted content are disclosed. Edit the title, category, audience, review date and plain text.
   The default audience is coordinators only, and takes effect only on publication.
3. Optionally ask AI to suggest checks for broken text, flattened tables or ambiguous instructions.
   The source file itself is not available to AI. Suggestions cannot certify extraction quality or repair text
   automatically. Editing the preview hides the old review and clears the manual confirmation.
4. Confirm that you reviewed the text against the original, then **Save imported draft**. Original bytes
   are not retained; source name, size and fingerprints are stored privately with the draft.
5. In the normal document editor, review the saved text and explicitly publish it with an action note.
   Readers, retrieval and reading acknowledgements continue to use only the published snapshot/audience.

Imports of identical file bytes warn about active references already imported in this company. The warning
links to the existing draft/publication. It does not overwrite or update a document, and a deliberate second
draft is still possible. Existing sources from other companies are never searched or disclosed.

**Download import preview** preserves source metadata, limitations and local edits without the expiring
receipt. If you leave/restart the preview or its receipt expires, keep that download before extracting again.
Importing is a new-document workflow; applying a new source to an existing document is not implemented.

## Supported content and limits

| Format | Extracted content | Limitations |
| --- | --- | --- |
| PDF | Text from every page using the existing pypdf dependency | At most 40 pages; encrypted files and any page with no readable text are rejected. No OCR. Reading order/table columns can change; an existing OCR text layer can contain errors. |
| DOCX | Body paragraphs and top-level tables, in document order; table cells separated with a vertical bar | Merged cells are deduplicated within each row. Nested tables, images, text boxes, headers/footers, footnotes, comments and tracked changes are not reliably preserved. Link targets are not imported. |
| TXT / Markdown | UTF-8 text, including a possible byte-order mark | Plain text is retained; Markdown/HTML is not rendered or executed. Invalid encoding is rejected. |

All formats require 50–20,000 extracted characters and at most 5 MiB of uploaded bytes. Oversized content
is rejected instead of silently clipped. Unsupported file extensions, mismatched document MIME/magic,
malformed archives and DOCX compression bombs are rejected. Input control/bidirectional formatting characters
are removed and line endings normalized. This can change formatting; compare with the original.

PDF/DOCX extraction runs in a short-lived spawned worker, with a 20-second response deadline and Linux
limits of 10 CPU seconds and 512 MiB address space. One Business import worker runs per API process; a busy
queue waits at most two seconds before failing with a retry message. DOCX archive limits are checked before
parsing, reusing the existing central-directory guard. Worker replies are bounded JSON with checked shape,
text length and page count. Timed-out/crashed/invalid workers fail closed and are cleaned up; there is no
in-process parser fallback. These are resource/process boundaries, not a claim of a separate OS sandbox.
Plain UTF-8 text needs no document parser and is handled directly within the upload/text bounds.

No websites, document links or embedded external resources are fetched. No parser, OCR model or dependency
was installed for this release. Scanned/image-only PDFs must be converted into a reviewed text source first.

## Provenance, authorization and retry behavior

Each successful preview returns a 30-minute signed receipt bound to the current company, importing user and
source metadata. It uses a separate HMAC-derived signing key, purpose and audience; it is not a login token.
The source metadata contains the file SHA-256, extracted-text SHA-256, safe base filename, byte count,
format, PDF page count when available, extracted character count and extraction time.

Saving checks the receipt, refreshed owner/admin permissions, active company status and the existing active
document capacity limit. It records the reviewed body hash and whether the initial save differs from the
extraction, in a private `imported` document-history event. This is initial provenance: later edits/publications
can differ from both the source file and that initial draft. Fingerprints identify bytes/text, not policy truth.
Only owners/admins receive this provenance in document detail/history; ordinary readers receive no filenames,
hashes, raw file or private import metadata.

The caller supplies an import request UUID. Concurrent retries with the same receipt, reviewed data and UUID
return the same document; a reused UUID with different data/provenance is rejected. A new extraction creates
a new expiring receipt. If an old save may have succeeded, inspect the library before starting a new import.
Permanent document deletion removes the import event with its other document history. Existing Business audit
records retain action/document IDs, format, byte count and file fingerprint, without copying the policy body.

Extraction releases the company lock before worker processing and rechecks authorization afterward. Preview
upload requests use a per-user burst/rate limit. Commit/review refresh authorization under the existing company
transaction lock. Uploaded temporary files are closed; no new file storage or vector copy is created.

## Optional AI extraction review

Up to six 1,000-character excerpts from the edited preview are sent to the configured LLM provider. For longer
previews, the first three and last three chunks are used; omitted middle text is disclosed. Each returned
suggestion must quote its supplied excerpt exactly. Quote validation checks attribution, not correctness or
completeness. AI has no tools and cannot publish, save or modify the preview.

Ten import-review attempts per company per UTC day are reserved durably, including provider/validation
failures. Manual import saves remain available when that allowance is used. Permissions and receipt expiry
are rechecked after generation. Results are hidden when the user changes the preview. AI tests use mocks,
not a live-provider quality study.

## API and rollout

Prefix `/v1/business/companies/{company_id}/knowledge-imports`:

| Endpoint | Purpose |
| --- | --- |
| `POST /preview` | Multipart `file` → extracted text, source metadata, duplicate references, limitations and receipt |
| `POST /review` | `{receipt, data}` → bounded quoted suggestions without saving |
| `POST /commit` | `{request_id, receipt, data, reviewed_original: true}` → unpublished document |

`data` uses the existing strict knowledge-content contract. Unexpected fields and non-boolean manual
confirmation are rejected. Preview tokens are scoped; current auth is still required for every request.
No database migration is required: provenance uses the existing private document-event table. Apply the API
and web changes together. This release changes Orbit Business only and does not change Personal parsing.
No production deployment or external messages were performed during implementation.

Tests cover successful text/DOCX/PDF extraction, table order, metadata privacy, duplicate warnings, auth changes
during extraction/generation, tampered/expired/cross-user receipts, non-session tokens, manual confirmation,
concurrent save retries, parser failures/timeouts, page/size/encoding/archive limits, quotas and explicit
publication. Chromium checks the full reviewed-import workflow, downloads, duplicate warning, mobile overflow
and automated accessibility rules.

Validation: 48 API/parser/migration checks, 46 Business unit tests, one Chromium workflow with automated
accessibility/overflow checks, API mypy (336 source files), Ruff, web lint/type checks and production
build/prerender (303 files). AI used mocks. Postgres CI includes the new API tests; it was not run locally.
The bundle-budget command still fails 21 limits; a separate untouched checkout of merged `main` at `99d2f964`
also fails the same 21 checks (entry 183.7 kB gzip, CSS 34.3 kB). No budget was raised. Three existing web lint
warnings and the existing dynamic-import build warning remain outside the import changes.
