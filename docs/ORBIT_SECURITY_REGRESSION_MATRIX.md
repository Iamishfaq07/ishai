# Security regression matrix

Each control with its positive and negative case, and where it's tested. "Test" names are in `apps/api/tests/`
unless noted. Status is as of 14 October 2026 on SQLite (the CI default); rows marked PG also pass on Postgres 16.
This is an engineering checklist, not a legal opinion on privacy law.

## Authentication and authorization

| Control | Positive | Negative | Test |
|---|---|---|---|
| Every route's owner check (IDOR) | owner reads/writes | another account gets 404/403, anonymous 401 | `test_security_idor.py` (route inventory must be complete) |
| Admin routes | admin works | a normal user gets 403 | `test_security_idor.py::test_admin_routes_*` |
| CSRF on cookie sessions | same-origin with token | foreign Origin 403 | `test_launch_security.py`, `test_security_review.py` |
| WebSocket origin | app origins | foreign origin refused, ticket not burned | `test_security_review.py` |
| Production config fail-fast | valid prod config starts | weak JWT secret, wildcard CORS, more than one replica, missing admin email refused | `test_launch_security.py`, `test_backend_hardening.py`, `test_security_review.py` |
| Proxy secret required in production (V3-02) | — | **held patch**: missing/short secret refused | patch ready, not merged (needs owner confirmation) |
| Client IP for rate limits | the Worker's stated IP with the secret | spoofed `X-Forwarded-For` / `X-Orbit-Client-IP` without it doesn't move the bucket | `test_security_review.py::test_client_ip_*`, `test_security_hardening.py` |

## Support chat

| Control | Positive | Negative | Test |
|---|---|---|---|
| Token is the only way in | holder reads | wrong token 404 | `test_support_chat.py` |
| Account-linked chat needs its account (V3-12) | owner with token | signed out or another account 404 (read, write, delete) | `test_support_lifecycle.py::test_a_signed_in_chat_needs_its_account_not_just_the_token` (PG) |
| Legacy `?token=` (V3-11) | still read | `Deprecation: true`, `no-store`, token redacted from logs | `test_support_lifecycle.py::test_the_old_query_token_*`, `test_security_hardening.py` (access-log redaction) |
| One handoff ticket per chat (V3-05) | first handoff | repeats and a 6-request burst add nothing | `test_support_lifecycle.py` (PG) |
| Transcript copy deleted with the account (V3-01) | export shows the copy, marked | after deletion: no row, no admin search hit, no admin thread | `test_support_lifecycle.py::test_handoff_ticket_is_linked_and_deleted_with_the_account` (PG) |
| Ordered lines under concurrency (V3-10) | 10 sends → 21 distinct ordered times | no interleaving | `test_support_lifecycle.py::test_lines_written_at_once_*` (PG) |

## Billing

| Control | Positive | Negative | Test |
|---|---|---|---|
| Checkout signature + capture check | captured, exact amount, INR → credited once | bad signature 400; `authorized` → processing, no credits; failed → 409 | `test_razorpay.py`, `test_payment_settlement.py` |
| Webhook HMAC over the raw body | signed → applied | forged 400, no event row | `test_payment_settlement.py::test_a_forged_or_mismatched_event_changes_nothing` |
| Exactly-once credit | one pack | redelivery, concurrent 6-event burst, checkout + webhook + reconciler | `test_payment_settlement.py` (PG) |
| Amount / currency mismatch | — | ignored, nothing credited | same |
| Refunds recorded once, before or after capture | partial + full sum; linked on capture | duplicates don't double; failed refund not counted | `test_payment_settlement.py` (PG) |
| Reconciler | lost webhook credited; delayed capture credited | never credits non-captured; backoff; expiry | `test_payment_settlement.py` (PG) |
| Payment for a deleted account | recorded | no credits, no error | `test_payment_settlement.py` |
| No payer PII in event rows | ids, amounts, statuses only | — | `test_payment_settlement.py::test_a_redelivered_event_is_applied_once` |

## Data integrity

| Control | Positive | Negative | Test |
|---|---|---|---|
| Resume optimistic concurrency (V3-06) | base revision matches → saved | stale base → 409, nothing written; 5-way burst → one lands | `test_resume_revision.py` (PG) |
| Client save ordering | newest text lands | an older in-flight save can't land last | `apps/web/src/pages/resume/saveQueue.test.ts`; `tools/e2e/resume-race.mjs` (browser) |

## Uploads, prompt injection, headers

Covered by the existing suites (`test_security_owasp.py`, `test_security_hardening.py`, `test_launch_security.py`,
`docs/SECURITY.md` "Hostile uploads" and "Web app headers"); unchanged in this round.

## Not covered here

- A real browser with Google sign-in, account switching across two real tabs (beyond the resume script).
- Live Razorpay webhooks and refunds (`docs/RELEASE_VALIDATION.md` checklist).
- Windows desktop (audio capture, updater integrity on real hardware).
