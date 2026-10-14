# Release validation — 14 October 2026

Decision: **NO-GO** for an unrestricted public launch. See `docs/ORBIT_RELEASE_READINESS.md` for the gate-by-gate
status and `docs/CLAUDE_EXECUTION_STATUS.md` for the commands and their output.

Checks below are against the git checkout and a local Postgres 16, not a deployed environment, unless marked
owner-observed.

| Gate | Result |
|---|---|
| Authorized Razorpay payment does not grant credits | PASS locally (`tests/test_razorpay.py`, `tests/test_payment_settlement.py`) |
| Duplicate / concurrent / reordered webhooks, refunds, reconciliation | PASS locally, SQLite and Postgres 16 (`tests/test_payment_settlement.py`) |
| Account deletion removes its support chats and their Inbox copies | PASS locally, SQLite and Postgres 16 (`tests/test_support_lifecycle.py`) |
| A real live-mode purchase through the checkout | Owner-observed 14 Oct: Mini ₹499 paid, "Mini pack added", credits shown. Not observed by the agent. |
| Live webhook delivery, refund, receipt email | UNTESTED (checklist below) |
| Google sign-in in a real browser | BLOCKED (no browser session with Google here) |
| Windows audio, signed installer, updater | BLOCKED (no Windows hardware) |
| Playwright journeys | UNTESTED |
| Production proxy secret actually set | UNTESTED (the owner must confirm in Render and the Worker) |
| Postgres migration up and down | PASS locally on Postgres 16 + pgvector (upgrade head, downgrade one, upgrade head) |

## Razorpay checklist (V3-03), for the owner, in test mode first

Do these with Razorpay in **Test mode** (test keys in Render, `rzp_test_…`), then repeat the first three in Live mode
with the smallest pack. Record each Razorpay payment / refund / event id next to the result.

| # | Do | Expect |
|---|---|---|
| 1 | Buy Mini with a test card (success) | "Mini pack added", credits up, Payments shows "Paid · credits added"; receipt email arrives; Razorpay → Webhooks shows 200 |
| 2 | Buy, then close the tab right after paying (before the page answers) | Within ~5 min the payment shows as paid and credits land (webhook or reconciler) |
| 3 | Pay with a test card that fails, close the window | "The payment didn't go through … Nothing was charged"; no credits |
| 4 | Set Payment Capture to manual, buy, then capture in the dashboard after a few minutes | Billing shows "Confirming with Razorpay"; credits land after the capture; set capture back to automatic |
| 5 | Webhooks → resend the captured event | 200; credits unchanged |
| 6 | Refund half, then the rest, from the dashboard | "Refunded ₹N" on the payment each time; credits kept (refund policy, docs/BILLING_RECONCILIATION.md) |
| 7 | Webhook secret wrong in Render, buy | Webhook shows 400 at Razorpay; the checkout still credits; fix the secret |
| 8 | Delete a test account right after paying | The payment is kept (approved, no account); nothing errors |
| 9 | Admin → Payments → "Check with Razorpay now" | Counts shown; nothing double-credited |

Do not describe the build as production-ready from this file.
