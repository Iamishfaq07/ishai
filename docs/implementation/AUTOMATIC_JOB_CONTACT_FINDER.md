# Automatic job contact finder

2026-10-21. Basea48b3512, including the already merged PR451 and later main changes. Scope: this feature only. IMPLEMENTED / UNVERIFIED. Owner explicitly prohibits testing.

## Candidate workflow

Open a saved Opportunity Room → Overview → Company & contacts → Find contacts here. The job is already selected. Outreach's existing contact finder also supports the same workflow.

Choose **Find hiring contacts automatically**. Orbit checks saved company contacts and the selected job description, runs up to three bounded public searches (hiring team, recruiting, relevant team), deduplicates returned URLs, then uses the existing AI extraction/validation flow to propose at most three people. Search and extraction run on the API; no extension, local CLI or user-operated search tabs are required. Opening the finder does not itself spend provider usage.

Each proposed name/title/email/profile needs its exact source excerpt. Search content/snippets must name the target company. Candidate email addresses and automatic mailboxes remain excluded. No guessed email pattern, fabricated person, inferred prior relationship or mailbox-deliverability claim. Results are leads to review, not a guarantee of current employment or assignment to this vacancy. Ranking is deterministic recruiter → literal hiring-manager title → other, then name; no fictitious confidence score.

Saved contacts remain first, with prior-company history separate from a real relationship. Candidate reviews before saving to existing People, with source quote/date and existing duplicate handling. Existing outreach drafting remains optional and draft-only. Nothing is emailed, messaged, applied or marked contacted by discovery.

Advanced disclosure retains a supplied public page, pasted recruiter reply, single-search mode and external search links. It uses the existing protected public-page importer only for an explicitly supplied URL. Automatic mode does not log into, crawl or drive LinkedIn/ATS pages; it uses search-provider results, including public page content returned by DeepSeek when available. Provider-generated summaries are not treated as literal source evidence.

## Provider setup

Priority is existing operator-managed SearXNG → existing Brave key → official DeepSeek Search. A failing preferred provider stops the search sequence; it does not silently switch to a potentially paid provider. Other supplied evidence can still be extracted, with warning. No automatic search retry.

DeepSeek uses the existing server `DEEPSEEK_API_KEY` or encrypted runtime-config override through `get_effective_config`. A separate browser/search key is unnecessary. Its endpoint is fixed to `https://api.deepseek.com/v1/tools/search`; custom LLM base URLs and browser input cannot receive this secret. Redirects and environment proxies are disabled. The key is never returned to the browser or logged in workflow metadata. Explicit mock-LLM mode does not automatically enable DeepSeek search.

`ORBIT_CONTACT_DEEPSEEK_SEARCH=true` enables that fallback (default). Set false to disable it. No actual environment/secret was changed during implementation. Existing runtime provider/key setup remains an operator responsibility. A missing provider disables the automatic button and leaves manual sources available; no fake successful discovery.

The adapter follows the documented POST query/count/need_content contract. Queries contain only bounded company/role strings, max128 characters. Each request is capped at10 seconds overall, eight-second HTTP timeout, five results and400KB response. DeepSeek page content is bounded to3,000 characters/source; snippets to1,500. Across searches at most10 distinct URLs become evidence. A single AI extraction follows the bounded source collection. No unconstrained agent, arbitrary tool-call loop, plugin or new dependency.

## Cost, quota and activity

The existing persisted `career_contact_research` reservation occurs before any provider network call. It allows five runs/user/UTC day including failures; automatic mode has at most three searches/run. Existing verified-email gate and rate limits remain. Failed search stops further search calls; quota is not reset or bypassed. No background poll, on-mount AI call or scheduled job introduced.

Existing ProviderRequest rows record search provider, latency, outcome and a configurable estimate, without query strings, contact text or private documents. DeepSeek's internal per-successful-nonempty-search estimate defaults to0.00075USD (`ORBIT_CONTACT_DEEPSEEK_SEARCH_COST_USD`); this is not an end-user charge or invoice. Unknown/failed/empty-filtered costs remain null rather than claiming free. AI token estimates remain in the existing extraction record. Provider billing remains authoritative.

Completed response includes actual search activity (query, provider, returned-source count, completed/empty/failed), not simulated real-time percentages. Browser shows these under a disclosure. Ten deduplicated sources is distinct from returned-source counts per query. No guarantee that every run finds a contact.

## Source, ownership and retention

Reuse owned JobApplication, JobListing, its owned job_description Document, JobContact and ProviderRequest; no schema/model/migration or second contact database. Manual jobs now reuse the owned saved job description rather than only looking at feed listings. Public queries never include the candidate resume, email, phone, transcript or pasted private reply. Supplied source text and saved JD still go to the existing extraction provider on the deliberate research action, as before.

Context adds a job-source fingerprint separate from the broader company-history version. Source changes reject in-flight server research via existing context guard; browser hides stale job results, ignores responses after unmount and suppresses duplicate clicks. Adding a contact does not alone invalidate the job-source fingerprint, allowing review of remaining leads. New clients also send this fingerprint on reviewed capture; the server returns409 if the job source changed before saving. The field is optional for legacy clients, whose existing explicit manual-review capture remains supported. In-room applicationId is exact and never falls back to an unrelated tracker row. Existing account-remount/cache and authenticated owner checks remain authoritative.

Research results/activity are transient browser response data. Saving creates only the existing reviewed contact with source quote/URL/date and job link. Existing contact export/delete and provider-metadata retention remain; no new public sharing, profile assertions or business-tenant access. Capture is candidate review, not independent identity verification or a cryptographically signed source receipt.

The HTTP request may continue after leaving the page. There is no durable background-task/resume/cancel protocol; no browser-closed completion promise. Full same-ID source races, provider reliability and billing reconciliation require later runtime evidence.

## Research and adoption boundary

- [Career-Ops contacto](https://github.com/career-ops-hq/career-ops/blob/main/modes/contacto.md): studied existing-contacts-first, bounded discovery, persona-specific outreach and explicit capture. [MIT license](https://github.com/career-ops-hq/career-ops/blob/main/LICENSE) reviewed. Orbit reuses its own existing flow; no upstream source or prompt copied. Unlike its per-contact early-stop CLI, Orbit gathers up to three query batches and extracts once to limit model calls.
- [JobScout](https://github.com/NaderLobandi/jobscout): studied opt-in per-job contact discovery and source-linked results. README reviewed, not a full codebase audit; attempted root LICENSE was unavailable, so no code/assets adopted and no license permission inferred.
- [DeepSeek Search API](https://api-docs.deepseek.com/api/search/) and [Search & Fetch guide](https://api-docs.deepseek.com/guides/search/): official endpoint/auth/response/billing reference, read2026-10-21. No live key/provider call performed. Documentation access is research, not integration verification.

## Validation and release

No tests, lint, typechecks, builds, migrations, browser checks, screenshots, provider requests using credentials, hardware smoke or security scans were run, per owner NO TESTING instruction. Source inspection/edits, public research and Git/PR operations only. Existing historical passes do not validate this change. No CI/required check weakened, skip marker or rerun requested.

Deferred checks when permitted: adapter contracts/timeouts/oversize/redirects/malformed/401/402/429/5xx; provider precedence/mock/OFF/runtime key; max query/source/daily budgets and cost records; job/document/candidate/business isolation; prompt injection and fabricated-field rejection; raw-source/secret redaction; source changes/double clicks/account switch; reviewed capture/dedupe/export/delete; responsive/keyboard/themes and full browser flow. Real provider smoke requires operator credentials/credit and separate authorization for verification.

Open draft PR for review; do not merge/deploy automatically. Production NO-GO until later validation/operator gates. Rollback is code revert and optionally disabling DeepSeek fallback; no data migration. Existing saved contacts and normal personal/business tools remain.
