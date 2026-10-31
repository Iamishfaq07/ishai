# Shared talent searches

Recruiters can now save reusable skills/interests searches within a talent community and share them with other current company owners, admins and recruiters. This closes a repeat-work gap in the original discovery form: it previously required the same phrase to be entered on every visit.

## Workflow

1. Search the community by a job-related skill or interest.
2. Name a saved search and use the current query, or enter a different literal phrase.
3. Save the shared criteria. The library holds up to 20 searches per community.
4. Run a search to retrieve current eligible profiles. Results are not stored in the library.
5. The creator, company owner or admin can edit or remove criteria. Other directory staff can run them.

Search matches one case-insensitive literal phrase in candidate-provided skills and interests. `%` and `_` are ordinary characters, not wildcard operators. It does not introduce Boolean syntax, semantic/AI ranking, demographic fields, candidate scoring, bulk messages, or automatic role suggestions. Names and queries are bounded to 80 characters; names need at least three, and empty criteria are rejected. Staff should avoid including personal information in shared names or criteria.

## Current consent and stale criteria

Every replay goes through the existing discovery eligibility query: the company must remain verified, the community enabled, consent current and unexpired, the application confirmed and not pending deletion. Leaving, expiry, lost verification and pauses stop those profiles from appearing in subsequent runs. Search results reflect the database read at request time; an already displayed page is not a live subscription. Run again to refresh it. Candidate actions continue to recheck eligibility on the server.

Saved criteria remember the community's consent-terms revision. If its name, purpose or retention duration changes, the saved search is marked stale and cannot run. The creator or owner/admin must review the current community purpose and explicitly save the criteria against the new terms. This never renews candidate consent: the existing terms-change workflow removes profiles and requires candidates to opt in again. Pausing alone does not change the terms revision.

Each saved search also has its own revision. Edits, deletion and execution require the revision the client reviewed. Pagination uses the same saved revision, so a different tab cannot silently change criteria between pages. On a failed search, the UI clears the old results and pagination rather than retaining them below an error.

## Access, persistence and transactions

The `biz_talent_searches` table stores UUID, company/pool IDs, nullable creator ID, name, literal query, terms revision, edit revision, initial request fingerprint and creation timestamp. It stores no result IDs, candidate profile snapshots, resume text, application copies or cached counts. This is shared company metadata; staff-authored criteria can contain the text staff enter and should not be treated as guaranteed personal-data-free.

Company and community deletion cascade to saved searches. Deleting the creator's account clears the creator reference while leaving company-owned criteria available for an owner/admin to manage. Losing directory permissions immediately blocks list, replay and mutation access, even for a search's original creator. Hiring managers and interviewers cannot access this directory. API scope checks reject cross-company and cross-community IDs.

Writes and replays acquire the existing company lock and refresh the actor's permissions. Create uses a caller UUID plus a company/pool/creator/content fingerprint: exact retries return the same record, conflicting request reuse is rejected, and retries count once toward the cap. Updates and deletion use optimistic revisions. Audit events record search IDs and edit revision, not names, queries or candidate results. Replays create no audit event, persist no result set and trigger no model or external provider.

Migration `c6e0f2a4b8d1` follows the released `b5d9e1f3a7c0` head. It adds one table and two lookup indexes. Downgrade drops saved-search metadata while preserving the existing community and application schema. The upgrade is not a production deployment; run it through the normal release process.

## API

All routes use `/v1/business/companies/{company_id}/talent/{pool_id}/searches`:

| Method | Suffix | Purpose |
| --- | --- | --- |
| GET | `/` | List shared criteria and management/staleness flags |
| POST | `/` | Create with request UUID, base revision 0 and current terms revision |
| PUT | `/{id}` | Save reviewed criteria with the current saved revision and consent terms |
| DELETE | `/{id}?base_revision=N` | Remove only the reviewed saved revision |
| GET | `/{id}/members?base_revision=N&after=cursor` | Run against current eligible profiles, at most 50 per page |

## Verification

API tests cover retry identity, conflicting requests, shared access, creator/admin edit rules, stale writes/deletes/replays, cross-tenant IDs, role revocation, changed consent terms, literal queries, the cap, concurrent requests and all existing eligibility filters. Migration tests upgrade/downgrade twice, preserve the community's existing terms, and exercise creator deletion and community cascade. Existing migration-head tests and the full IDOR suite run with the new routes.

The candidate/recruiter browser flow saves a search, runs it after a manual miss, verifies mobile dark/reduced-motion accessibility, replays after candidate withdrawal, and reviews stale criteria after a terms change. Public Business showcase and company launchpad browser flows run alongside it. Postgres CI includes these locking/lifecycle tests; local execution uses SQLite.
