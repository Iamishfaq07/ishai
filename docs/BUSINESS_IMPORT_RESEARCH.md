# Policy import research and decisions

Primary documentation retrieved on 29 October 2026. This implements the policy-import gap from the existing
Business backlog. No third-party source was copied and no dependency or model was installed.

| Primary source | Evidence inspected | Decision for Orbit Business |
| --- | --- | --- |
| [pypdf extraction documentation](https://github.com/py-pdf/pypdf/blob/main/docs/user/extract-text.md) | Extraction can require substantial memory to parse a page content stream; tables are often positioned text; headers/footers and reading order are ambiguous; pypdf is not OCR. | Use bounded worker processes, reject oversized documents, explicitly disclose structure loss, and require comparison with the original. Do not claim OCR/completeness or silently import the first pages only. |
| [python-docx quickstart](https://github.com/python-openxml/python-docx/blob/master/docs/user/quickstart.rst) | Documents expose paragraphs, tables, cells and normal document editing. | Preserve body paragraph/table order and display cell text in the preview. Keep the original as the review reference; images/layout and other document parts are not represented by plain text. Reuse the existing installed library. |
| [Docling overview](https://github.com/docling-project/docling/blob/main/README.md) | Layout/table parsing, OCR, varied formats and local execution are described; code and individual models have separate license considerations. | A useful future option for evaluated high-fidelity/OCR ingestion. Current imports need a bounded plain-text workflow, provenance and publication review before adding a larger parser/model runtime. No Docling integration is claimed. |

The [implemented workflow](BUSINESS_KNOWLEDGE_IMPORT.md) adds extraction previews, private provenance,
same-file duplicate warnings, editable drafts, quoted AI review and separate explicit publication.
The original file is not stored. A signed receipt records which source was extracted; it does not prove the
edited policy is correct or that every visual part of a document was captured.

## Useful next improvements

1. Evaluated OCR/layout handling for scans and complex tables, with per-page preview and extraction-quality
   measurements on employer-approved examples. Model/license/runtime budgets should be reviewed first.
2. Import a revised source into an existing document, preserving publication/draft separation and showing a
   reviewed diff instead of silently replacing published guidance.
3. Controlled document storage/provenance versions for companies that explicitly need original-file retention,
   with access, retention and deletion controls. No original bytes are retained in the current workflow.
4. Approved semantic retrieval evaluation after extraction: compare lexical and hybrid retrieval, with source
   deletion propagation and ACL filtering. Importing text does not add semantic search.
5. Candidate experience feedback and notification digests remain separate Business workflow gaps from the
   [broader research backlog](BUSINESS_CAPACITY_RESEARCH.md).

SHA-256 evidence for the retrieved bytes:

| Source | SHA-256 |
| --- | --- |
| pypdf extract-text.md | `b7c8826b07e23356bb594b2d0e9b64658011fde9748c788c6ae54bab781ae078` |
| python-docx quickstart.rst | `6b1637398b70f1fc31780149245b5a6876afc674a217dd07a49286398c396fcc` |
| Docling README | `ce605634509dc87d79182131ad001e5fddf6053963b9045b971c6e87e6b9bfa1` |
