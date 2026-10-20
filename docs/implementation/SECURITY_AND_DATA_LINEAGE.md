# V6 security and data lineage

## Boundaries changed

- `worker/environment.js: isolatedApi` checks the configured HTTPS upstream and request hostname. The canonical production API is rejected from nonproduction hosts, or whenever DEPLOYMENT_ENV is preview/staging. Empty configuration fails before network I/O. DNS trailing dots are normalized. Proxy redirects from an isolated upstream into the canonical production API are refused. Existing manual redirects and trusted forwarding-header stripping stay in force.
- `lib/endpoints.ts: endpointBases` independently rejects baked production REST/direct/live URLs on preview hosts, including trailing-dot spelling. This matters because most production REST calls can bypass the Worker. Preview artifacts should still be built with `.env.preview`; runtime protection covers accidentally reused production builds.
- `/company/...` rendering can otherwise read the bound API before the proxy handler. It is guarded too. An unconfigured preview may show static pages but cannot sign in or load employer data.
- This detects the known production hostname, not arbitrary private infrastructure aliases. Operators must never configure a production Railway origin under another name as staging. Protect staging with independent resources, credentials and a separate registrable domain; see STAGING.md.

## Existing mission projection extension

`job_portal/mission.py: mission` adds `application` (id, status, submission_uncertain, updated_at) from ApplicationPacket only where user_id and listing_id match and application_id is absent or matches the current owned tracker entry. A unique user/listing index bounds this to one row. The existing entry ownership check runs first. One fixed projection query is added; there is no per-row query loop.

No resume body, application answers, approval fingerprint, worker token, contacts or provider credentials are selected. No new persistent record, claim, consent or outcome is created. A prepared kit is not submission evidence; ambiguous attempts remain unconfirmed. Packet detail remains the authority for reviewing material, execution and receipts.

Existing account export/delete remains authoritative for the source tracker and packet records. There is no second store or new retention period to add. Ownership projection tests cover two users with the same listing, conflicting explicit linkage and ambiguous outcome; existing lifecycle/export tests remain regression gates.

## Browser and automation

Today uses the existing launchpad progress projection and action priority, with no model request on mount. Optional plans retain source versions, source quotes, ownership checks and the existing daily cap. Visiting Discover or a job tool also no longer silently invokes profile suggestion; an explicit resume-to-search link or profile action can still request it. More tools never enables hosted execution or authorizes an application. My Career observes the Evidence Vault feature flag. Sign-in/sign-out cache generation protections remain unchanged.

No new analytics event, raw message storage, OAuth scope, employer email, secret, remote-browser runtime, AI model or third-party dependency is introduced. The employer reply helper from PR437 remains reviewed manual paste. This slice is not mailbox synchronization.

## Verification limits

Local adversarial/ownership/proxy/regression results are in BASELINE.md. Readiness GET reported proxy_secret=ok in production on 2026-10-20; that does not verify secret rotation, provider health, backup restore, country pricing, load capacity or every tenant path. No active production exploit/load test or live payment/application submission was performed.
