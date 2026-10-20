# Career Ops workflows in Personal Orbit

Reference inspected: [`career-ops-hq/career-ops`, `ca5e70b9321daf4765f5143a4aa4d2d135f0d397`](https://github.com/career-ops-hq/career-ops/tree/ca5e70b9321daf4765f5143a4aa4d2d135f0d397), 2026-10-20. MIT licence, copyright Santiago Fernández de Valderrama. The licence is retained in [third-party/career-ops-LICENSE.txt](third-party/career-ops-LICENSE.txt).

This is a native Orbit implementation of the workflows below. The reference CLI, local data stores and remote agent instructions are not installed or executed inside the hosted application.

## New tools

Open **Personal → Jobs → Outreach → Open contact finder**, or the **People at this company** card in a job's Company tab. The public Tool explorer also links to Job contact finder.

- **Saved-company contact discovery.** Each tracked job surfaces the candidate's saved contacts at the same company, including contacts attached to previous roles. Company comparison reuses Orbit's existing exact normalisation; similarly named companies are not treated as the same employer. A saved person is not presented as a personal relationship, internal referral or currently assigned recruiter.
- **Public lead research.** An explicit research run checks the saved job description, an optional public team/company page, optional pasted recruiter reply/profile text, and an optional live public search. AI may return up to three identities backed by exact source excerpts. Names, titles, email addresses and professional profile URLs must be present in the corresponding evidence. No email-pattern guessing or invented identities. Search snippets are visibly distinguished from current verified employment.
- **Reply capture and contact memory.** Review a sourced lead and save it to the existing People contact book with job association, source, evidence and review timestamp. Concurrent repeated saves are idempotent. Existing contact notes/details are preserved. Equal names with conflicting known email/profile identities are not silently merged.
- **Company history.** See your recorded application stages and earlier role titles beside the people at that company. These are your own records, not claims about employer responsiveness. History explicitly identifies truncation beyond the 2,000 most recently updated tracked jobs.
- **Persona-aware outreach.** Pick a saved contact and generate either a 200-character introduction or a 1,500-character email. The AI receives the contact role, tracked job stage and the job's owned linked resume when present. Without that resume it is instructed to make no qualification claims. Prior personal interaction requires explicit candidate confirmation; merely saving a contact never establishes it. Drafts are editable and copied manually. Generating or copying does not send anything or log a contact event.
- **Contact reminders.** A candidate can request a reminder seven days after capture. This uses existing contact follow-up dates and Action desk behaviour. It never sets `last_contacted_at`; the existing **I got in touch** action remains how a real interaction is recorded.

Orbit already has job discovery/ranking, application tracking, resume tailoring, interview preparation, weekly planning and follow-ups. These remain the native implementations; this integration connects contact research to them rather than duplicating the reference repository's file-based pipeline.

## Sources and deployment

Public pages use the same pinned-DNS, public-IP, redirect, content-type, decompression, size and deadline controls as Orbit's job-link importer. The contact-specific extractor preserves published `mailto:` and professional profile links in context, while the normal job-posting extractor stays separate. No browser sign-in or mailbox access is used. If a website cannot be read, the UI supports pasted relevant text.

**Keyless option:** set `ORBIT_CONTACT_SEARXNG_URL` to your managed SearXNG service. See [keyless search setup](KEYLESS_CONTACT_SEARCH.md). SearXNG takes precedence when both options are set.

**Alternative: automatic live web discovery with Brave requires `ORBIT_CONTACT_SEARCH_KEY` on the API server**, containing a Brave Search API key. It is optional and off when absent. Each research run makes at most one search request and reads up to five snippets. Only company and job-title terms are sent to search; candidate profile facts and resumes are not search inputs. The service endpoint is fixed; redirects and environment proxies are disabled. [Brave's official API reference](https://api-dashboard.search.brave.com/api-reference/web/search/get) documents the endpoint and authentication.

Without that key, saved-company contacts, public-page research, pasted reply capture, company history, drafts and manual search links still work. Reading a page and AI extraction require the configured API/LLM runtime; manual search links open in the candidate's browser. Nothing in this PR provisions a search account, deploys a worker or sends outreach.

Research uses the existing durable AI allowance: five runs/account/UTC day, including failures. The allowance is reserved **before** search/page tools run; exhausted accounts cannot trigger those tools. Outreach drafting has a separate five-run daily allowance. The model timeout remains 60 seconds; page fetches and search have their own bounded deadlines. Mock provider results are clearly labelled demo responses.

## Data and API

All routes require the candidate's own tracked application. Mutations use the existing verified-email guard; extension-scoped tokens have no access. Snapshot versions reject research when the job, posting, contacts or company history changes. Drafts recheck the job, contact and owned resume after AI. A contact's mailbox address is excluded if it belongs to the candidate's account, current Apply profile or the job's linked resume.

- `GET /v1/jobs/network/{application_id}` — saved company contacts, own company history, search availability, manual search links and snapshot version.
- `POST /v1/jobs/network/{application_id}/research` — `{version, search_web, page_url?, pasted_text}`; returns sourced people, warnings and provider label. No contact is saved here.
- `POST /v1/jobs/network/{application_id}/capture` — reviewed `{person, source_url?, remind_in_days?}`; returns `{created, contact}`. Duplicate captures preserve existing records.
- `POST /v1/jobs/network/{application_id}/draft` — `{contact_id, channel: connection|email, prior_relationship}`; returns an editable draft and character budget. No send action.

Saved data uses existing `JobContact` fields, ownership, export and account-deletion cascades. No new contact tables or columns are needed. The public source URL is attribution, not independent proof that a pasted identity is authentic. No automated messages, mailbox polling, bulk scraping, login bypass or contact enrichment database is introduced.

Release integration also includes the no-DDL merge revision `c407e21a6d93`: PRs #426 and #427 were merged during this work with independent migration heads (`82ac6d705f91` and `91bd47e8c2a0`). This joins them without changing their existing identities. Tests cover upgrade from either parent, downgrade to their shared ancestor, and upgrade again.

## Reference implementation inspected

- [`contact-lookup.mjs`](https://github.com/career-ops-hq/career-ops/blob/ca5e70b9321daf4765f5143a4aa4d2d135f0d397/contact-lookup.mjs): same-company saved-contact lookup before a cold search.
- [`contact-extract.mjs`](https://github.com/career-ops-hq/career-ops/blob/ca5e70b9321daf4765f5143a4aa4d2d135f0d397/contact-extract.mjs): capture recruiter/interviewer details from candidate-provided replies with explicit review.
- [`modes/contacto.md`](https://github.com/career-ops-hq/career-ops/blob/ca5e70b9321daf4765f5143a4aa4d2d135f0d397/modes/contacto.md): role-specific outreach and distinct treatment of saved contacts versus confirmed relationships.
- [`company-history.mjs`](https://github.com/career-ops-hq/career-ops/blob/ca5e70b9321daf4765f5143a4aa4d2d135f0d397/company-history.mjs): factual company evidence from the candidate's own records.

## Verification

Tests use mocked search responses, intercepted HTTP sources, pasted fixtures and the mock LLM. No real contact is discovered or messaged during verification. Coverage includes exact source validation, self/automatic-mailbox exclusion, private network refusal, allowance reservation before external tools, ownership, duplicate capture races, stale source snapshots, draft character budgets, desktop/mobile accessibility and the full capture/reminder/draft flow.
