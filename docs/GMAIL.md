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
