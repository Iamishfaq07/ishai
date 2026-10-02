# Plans, limits and billing

## Plans are server configuration
`apps/api/orbit_api/entitlements.py` holds the one plan table. Clients never decide limits: they render
`GET /v1/plans` (public) and `GET /v1/entitlements` (signed in).

| | Free | Resume Pro | Pro | Unlimited |
|---|---|---|---|---|
| Price (UPI, 30 days) | free | ₹299 | not for sale yet | not for sale yet |
| Resume maker AI | 1 free AI action | unlimited | unlimited | unlimited |
| Live minutes / month | 30 | 30 | 600 | unlimited (fair use) |
| Mock interview minutes / month | 30 | 30 | 300 | unlimited |
| Screenshots / month | 10 | 10 | 500 | unlimited |
| Documents | 3 | 3 | 50 | unlimited |
| Max length of one session | 60 min | 60 min | 180 min | 240 min |
| Features | live, documents, mock, vision | Free's + `resume_ai` | all | all |

These are the defaults. Override any of them without a code change:

```bash
ORBIT_PLANS_JSON='{"pro": {"live_minutes": 900, "price_usd_month": 29, "stripe_price_id": "price_..."},
                   "free": {"features": ["live", "documents", "mock"]}}'
FREE_MAX_SESSION_MINUTES=60   PRO_MAX_SESSION_MINUTES=180   UNLIMITED_MAX_SESSION_MINUTES=240
```

- **Settable per plan:**
  - the limits: `live_minutes`, `mock_minutes`, `screenshots`, `documents`, `max_session_minutes`;
  - `features`, from `live`, `documents`, `mock`, `vision`, `advanced_coding`, `system_design`,
    `provider_fallback`, `resume_ai`;
  - `price_inr_month`: what 30 days cost over UPI, in whole rupees (`null` = not for sale). Setting it on Pro, say
    `{"pro": {"price_inr_month": 999}}`, puts Pro on sale too;
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

## The resume maker's free AI action
Without a plan that has `resume_ai`, the resume maker's AI has **one free action**: an import, a rewrite, tailoring
or a cover letter (`apps/api/orbit_api/resumes/allowance.py`).
- **Who gets it:** one per account, for good, and one per IP address per `ORBIT_FREE_RESUME_AI_IP_DAYS` (default 30;
  `0` = one per IP for good). Signed-out use counts against the IP. The window exists because mobile networks put
  thousands of people behind one IP.
- **What's free anyway:** typing, the ATS score, templates, PDF/Word downloads, and the fixes worked out without
  the AI (dates, skills the resume already proves).
- **After it's spent:** AI endpoints answer `402 upgrade_required` with the plan and price, and the editor shows
  Upgrade. `/suggest` still returns the AI-free fixes, with `upgrade_required: true`.
- **A failed AI call doesn't spend it.** IPs are stored only as an HMAC (`free_ai_uses.ip_hash`).
- **A daily cap for everyone:** at most `ORBIT_FREE_RESUME_AI_DAILY` (default 200) free actions a rolling day, new
  accounts and signed out together, so open sign-up has a bounded AI bill. Past it: `503`, and the use isn't spent.
- **Accounts waiting for sign-up approval** can use the resume maker (their free action, and buying Resume Pro);
  interview sessions stay locked until you approve them, and approving a payment approves the account.

### Opening sign-up to customers
With no SMTP, the safe public setup is anyone-can-sign-up plus your approval:
`ORBIT_ALLOWED_EMAILS=*`, `ORBIT_SIGNUP_APPROVAL=true`, `ORBIT_EMAIL_VERIFICATION=off`. (Public sign-up without
approval needs SMTP for email verification, or the API refuses to start.)

## Payments: UPI, checked by the admin
No payment gateway: people pay `ORBIT_UPI_ID` (shown as `ORBIT_UPI_NAME`) from any UPI app, and the admin confirms
each payment before the plan turns on (`apps/api/orbit_api/billing/upi.py`).
1. **Billing → Upgrade** makes an order: the amount, a reference (`ORB…`, in the UPI note), a QR and a `upi://pay`
   link (on phones, a button that opens GPay / PhonePe / Paytm). The UPI ID and amount are also shown for paying by
   hand.
2. **The payer enters the UTR**, the 12-digit number the UPI app shows for the payment. A UTR counts once, for
   anyone. The admin gets an email.
3. **The admin opens Settings → Payments** (or the header's "to check" badge), finds the credit in the bank or UPI
   app by UTR or reference, and approves or rejects it (a reason is shown to the payer, who can send the right UTR).
4. **Approving grants the plan for 30 days**, added on to a running grant of the same plan, and approves the
   account if sign-up approval was holding it. Nothing renews or is charged automatically.

Unset `ORBIT_UPI_ID` = nothing is for sale (`buyable: false` in `GET /v1/plans`).

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
