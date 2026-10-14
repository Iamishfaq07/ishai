# Release validation — 14 October 2026

Decision: **NO-GO** for a public launch.

The archive named in the build prompt (`ishai-main (1).zip`) was not available. Checks below are against the git checkout, not a deployed environment.

| Gate | Result |
|---|---|
| Authorized Razorpay payment does not grant credits | PASS locally (`pytest tests/test_razorpay.py`) |
| Account deletion removes its support chat and export includes it | PASS locally (1 test) |
| Live Razorpay capture, webhook delivery, receipts | BLOCKED — no live gateway |
| Google sign-in in a real browser | BLOCKED |
| Windows audio, signed installer, updater | BLOCKED |
| Playwright journeys | UNTESTED |
| Production proxy secret actually set | UNTESTED |
| Staging Postgres migration up and down | UNTESTED in this run |

Do not describe the build as production-ready from this file.
