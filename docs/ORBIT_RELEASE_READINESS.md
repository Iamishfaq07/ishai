# Orbit release readiness — 14 October 2026

## Decision: **NO-GO** for an unrestricted public launch · **RESTRICTED BETA** acceptable for the web app in India

Restricted beta means the web app with Razorpay (India) open to sign-ups, desktop as a labelled beta download, and
no paid marketing push, **after** gates 1 and 2 below are closed. It changes to GO when every row is PASS.

## Gates

| # | Gate | Status | Owner | How to close it |
|---|---|---|---|---|
| 1 | Production proxy secret (V3-02) | **OPEN** | Owner | Confirm `ORBIT_PROXY_SECRET` (32+ random chars) is set in Render and the same value in the Worker (`wrangler secret put PROXY_SECRET`); then merge the held patch so production refuses to start without it |
| 2 | Web deploys reach production | **OPEN** | Owner | Cloudflare → orbit → Settings → Build: deploy command `npx wrangler deploy` (it is `npx wrangler preview`, which fails). Every web change since 14 Oct 05:16 IST is undeployed until then |
| 3 | Support transcript lifecycle (V3-01, V3-05, V3-14) | PASS (code + tests, SQLite and Postgres) | — | Verified by `tests/test_support_lifecycle.py`; migration cleanup runs on deploy |
| 4 | Payment settlement, refunds, reconciliation (V3-07/08/09/13) | PASS in code and tests; **live webhook and refund UNTESTED** | Owner | Razorpay checklist in `docs/RELEASE_VALIDATION.md`, rows 1–6, test mode then live |
| 5 | A real live purchase (V3-03) | Owner-observed once (Mini ₹499 credited, 14 Oct) | Owner | Record the payment and webhook ids from the checklist |
| 6 | International cards | OPEN (Razorpay review) | Owner | When Razorpay approves, set `ORBIT_RAZORPAY_INTERNATIONAL=true` |
| 7 | Résumé save durability (V3-06) | PASS (unit, API, and a browser before/after) | — | `tools/e2e/resume-race.mjs` |
| 8 | Support ordering and token isolation (V3-10/11/12) | PASS (tests, SQLite and Postgres) | — | Remove the `?token=` read after 30 days with no legacy reads in the log |
| 9 | CI green | **BLOCKED** | Owner | GitHub Actions billing block: every check fails in ~2 s without running. Local runs are the evidence until it's fixed |
| 10 | Staging migration + rollback on a copy of production data | **OPEN** | Owner / next session | The three new migrations pass up/down/up on an empty Postgres 16 here; not run against a copy of real data |
| 11 | Windows desktop (V3-04) | **NOT RUN** | Owner with Windows 10/11 hardware | Mic + system audio, Bluetooth headset, sleep/resume, 125–200% DPI, installer SmartScreen, updater + rollback. Tauri updater signing is not Authenticode |
| 12 | Google sign-in in a real browser | **NOT RUN** | Owner | Sign in, sign out, account switch, a failed callback |
| 13 | Playwright journeys in CI | **NOT RUN** | Next session | Only `tools/e2e/resume-race.mjs` exists, run by hand |
| 14 | Monitoring of billing and support | PARTIAL | — | Admin Payments shows processing / events to review / unlinked refunds; logs warn on stuck payments. No external alerting |
| 15 | Refund policy published | **OPEN** | Owner | Current behaviour (credits kept on refund) is written in `docs/BILLING_RECONCILIATION.md` for sign-off; the public refund page should match it |
| 16 | Timing-sensitive test | OPEN | Next session | `test_engine.py::test_an_early_answer_is_dropped_unseen_when_the_interviewer_keeps_talking` failed once under load |

## Deploying what's merged

- Render deploys `main` automatically and runs `alembic upgrade head` first (Dockerfile). New revisions:
  `c3e5a7b9d1f2` (support ticket link; **deletes Inbox copies of chats already deleted with their accounts**),
  `d5f7b9c1e3a4` (payment events and refunds; turns refund audit notes into refund rows),
  `e7a9c1d3f5b6` (resume revision).
- Rollback: redeploy the previous image in Render, then `alembic downgrade a8c1e3f5b7d9` if the schema must go back.
  The ticket cleanup in `c3e5a7b9d1f2` is not undone by a downgrade (those copies are gone by design); Neon's history
  keeps them until it expires.
- Before downgrading `d5f7b9c1e3a4`, note that refund rows and event rows are dropped with it.
