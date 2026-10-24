# Gmail application sending

Orbit supports connecting Gmail, preparing an application email with an optional PDF,
reviewing the saved recipient/body/attachment, and explicitly sending it from the
connected account. Settings → Gmail establishes the connection. Each opportunity room
has an Apply by Gmail section. A successful send saves Google's message ID and moves
an otherwise saved opportunity to applied. Gmail acceptance does not establish employer
receipt or an interview outcome.

## Server configuration

Use a Google Cloud OAuth **Web application** with the Gmail API enabled. Register the
exact callback URL (for example `https://api.example.com/v1/gmail/callback`) and set:

- `ORBIT_GOOGLE_CLIENT_ID`
- `ORBIT_GOOGLE_CLIENT_SECRET`
- `ORBIT_GMAIL_REDIRECT_URI` to that exact callback URL
- `ORBIT_CONFIG_SECRET` to a persistent encryption secret shared by API replicas
- the existing `ORBIT_WEB_URL` and frontend CORS/cookie settings for the deployed sites

Apply `uv run alembic upgrade head`; Gmail tables are migration `da02b4c6e8f0`.
The connection button stays disabled until the required configuration exists.
Google OAuth consent requests `openid`, `email` and `gmail.send`. It does not request
inbox-reading access. Configure consent-screen branding, privacy policy, authorized
domains and test users in Google Cloud. Complete Google's applicable production OAuth
verification before making it generally available. Google credentials/test accounts are
external deployment requirements; this checkout contains no real credentials.

## Delivery and recovery

OAuth uses PKCE, account-bound state, a nonce, verified Google ID-token claims and a
single-use ten-minute connection state. Refresh tokens are encrypted at rest using the
existing configuration encryption key. Disconnect deletes Orbit's connection; users can
also revoke the grant from Google's third-party access settings. Previously prepared
emails require the same connected sender account before sending.

Application drafts retain their MIME bytes, SHA-256, recipient, subject, body and optional
PDF. Only the owner can review them. Sending requires explicit confirmation, and a
conditional database update reserves the attempt before the Gmail request. The same
opportunity cannot receive another Gmail attempt unless its unsent draft is discarded.
Up to 20 retained drafts/attempts can be created per rolling day. PDFs are limited to
5 MB. Sending is not a bulk campaign or scheduled auto-send feature.

A Gmail receipt marks the attempt sent. A timeout, inconclusive response, or process crash
after reservation cannot cause automatic resend. `sending`/`uncertain` records require
manual checking in Gmail Sent. Rejected attempts are also retained and cannot be
resubmitted through this flow. Do not delete durable attempt records to retry delivery.
Pending drafts can be discarded and prepared again. Account/opportunity deletion cascades
attempt records; account exports include MIME/content records but never connection tokens.
A matching content hash is checked before send.

## Validation limits

Tests cover MIME composition, attachment preservation, header injection, send-once
transport outcomes, draft review, duplicate-send blocking, ownership, exports, OAuth
PKCE/state denial/replay and disconnect. Network calls are mocked. Live Google consent,
real Gmail delivery and production browser/cookie behavior require configured Google
credentials and test accounts; they have not been validated in this environment.

## Email-bearing job posts and automatic preparation

Jobs → Matches now includes “Find jobs that accept applications by email.” Candidates can
search the first 100 eligible matches from their saved profile for addresses present in
cached descriptions (up to ten results), or paste a LinkedIn/public job post with its
original URL, company and title. Orbit shows address excerpts; the candidate must confirm
which address the source actually designates for applications. It does not guess addresses,
verify recruiter identity, scrape logged-in LinkedIn pages or open supplied URLs.

Import saves the source post to Documents and links it to a tracked opportunity, subject
to existing document/tracker quotas. In that opportunity’s Apply by Gmail panel, select an
owned resume and choose “Tailor resume and prepare job email.” Orbit reuses its existing
fact-preserving tailoring engine: checked AI rewording when available, otherwise prioritizing
existing bullets/skills/projects. The UI states whether AI rewording was retained and shows
changes. No changes are made to the source resume. Preparation is limited to five requests
per UTC day, including failures, and stale resume/post edits invalidate preparation.

Each prepared email includes a job-specific DOCX resume and an application email built
from existing resume facts and the target role/company. Gmail also accepts manually chosen
PDF/DOCX files. Candidates can download the exact captured attachment, inspect the proposed
changes and message, then explicitly approve sending. They can discard an unsent draft to
prepare another version. Source resume identity/revision, post hash, recipient excerpt,
structured tailored resume and MIME bytes remain associated with the attempt.

This workflow automatically prepares applications; it does not send unattended or establish
that every address in a post belongs to a recruiter. No live LinkedIn discovery or live Gmail
delivery was exercised in local validation; Google OAuth deployment configuration is still
required for real connected accounts.
