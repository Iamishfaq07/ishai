# Plans, limits and billing

## Plans are server configuration
`apps/api/orbit_api/entitlements.py` holds the one plan table. Clients never decide limits: they render
`GET /v1/plans` (public) and `GET /v1/entitlements` (signed in).

| | Free | Pro | Unlimited |
|---|---|---|---|
| Live minutes / month | 30 | 600 | unlimited (fair use) |
| Mock interview minutes / month | 30 | 300 | unlimited |
| Screenshots / month | 10 | 500 | unlimited |
| Documents | 3 | 50 | unlimited |
| Max length of one session | 60 min | 180 min | 240 min |
| Features | live, documents, mock, vision | all | all |

These are the defaults. Override any of them without a code change:

```bash
ORBIT_PLANS_JSON='{"pro": {"live_minutes": 900, "price_usd_month": 29, "stripe_price_id": "price_..."},
                   "free": {"features": ["live", "documents", "mock"]}}'
FREE_MAX_SESSION_MINUTES=60   PRO_MAX_SESSION_MINUTES=180   UNLIMITED_MAX_SESSION_MINUTES=240
```

- **Settable per plan:**
  - the limits: `live_minutes`, `mock_minutes`, `screenshots`, `documents`, `max_session_minutes`;
  - `features`, from `live`, `documents`, `mock`, `vision`, `advanced_coding`, `system_design`,
    `provider_fallback`;
  - the display fields: `label`, `price_usd_month`, `stripe_price_id`.
- **Unlimited:** `null` means unlimited for a monthly limit. The session ceiling can't be unlimited.
- **Validation:** unknown plans, keys or features, and negative or non-integer limits stop the API at boot.
- **Admin:** the admin (`ORBIT_ADMIN_EMAIL`) always gets Unlimited.

## How limits are enforced
- **Monthly minutes:**
  - live sessions draw on `live_minutes` (metric `live_seconds`);
  - mock interviews draw on their own `mock_minutes` (`mock_seconds`);
  - committed every heartbeat (15 s) and checked at session create, live ticket and socket connect;
  - a warning comes 5 minutes before the limit, then the session ends cleanly: transcript and usage are
    written and the report is queued.
- **Session ceiling:** a session's total time across reconnects is capped at `max_session_minutes`, even on
  Unlimited, so a session left running by accident ends. The same warning and graceful end apply, with
  `usage.status {reason: "session"}`. A capped session can't be reopened (`409 session_time_limit`).
- **Features** are checked by name (`plan.has("vision")`):
  - screenshots need `vision`, and mock sessions need `mock`;
  - otherwise the request gets `403 feature_unavailable`;
  - `advanced_coding`, `system_design` and `provider_fallback` are defined for the features that use them.
- **Screenshots** spend a credit only when the answer is delivered.
- **Documents** are counted at upload.
- **One live session per account** bounds any overshoot to about one heartbeat.

## Payments
Not live yet: plans exist, but nothing can be bought. Stripe Checkout, the webhook-driven subscription state and
the customer portal come next. They will set `subscriptions.plan`, and the server derives everything above from
that.

## What it costs to run (admin → Settings → Costs)
`GET /v1/admin/costs?days=30` (desktop Settings, admin only) reports:
- **totals:** LLM (from token counts), speech-to-text (minutes × `ORBIT_STT_PRICE_PER_MINUTE`) and vision;
- **live:** cost per live hour and per session;
- **LLM efficiency:** the cache hit ratio and tokens per answer;
- **breakdowns:** per model (including backup calls), per request type, per user and per plan.

LLM calls on a model without a configured price are **counted and shown as unpriced, never as $0**.

A real measurement on one session: an answer cost about $0.0002 in AI tokens (with an 89% DeepSeek cache hit).
**Speech-to-text dominates**: two channels at the Nova-3 list price come to about $0.92 per live hour. Price plans
from the live-hour figure, not from AI tokens.
