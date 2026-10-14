# Plans, credits and billing

## Free accounts run on credits
A new account gets **welcome credits** (`apps/api/orbit_api/credits.py`), and buys **credit packs** (through Razorpay,
or over UPI) for more. Credits never expire and nothing renews.

- **Interview minutes:** live interviews and mock interviews both draw on one balance. They're metered by the live
  socket every heartbeat, and a session ends cleanly when the balance runs out.
- **Resume AI credits:** one per AI action in Resume AI: an import, a rewrite, tailoring, a cover letter, interview
  questions, a profile or a message.
  Typing, the ATS score, templates, PDF/Word downloads, and fixes worked out without the AI (dates, skills the resume
  already proves) are free. A failed AI call gives its credit back.

| | Free (credits) | Pro (granted) | Unlimited (granted, and the admin) |
|---|---|---|---|
| Interview minutes | welcome + packs | 600 live + 300 mock / month | unlimited (fair use) |
| Resume AI | welcome + packs | unlimited | unlimited |
| Screenshots / month | 10 | 500 | unlimited |
| Documents | 3 | 50 | unlimited |
| Max length of one session | 60 min | 180 min | 240 min |
| Features | live, documents, mock, vision | all | all |

Pro and Unlimited aren't sold: the admin grants them for a while (Users & access).

### Welcome credits
Every new account gets `ORBIT_WELCOME_RESUME_CREDITS` (1) resume credit and `ORBIT_WELCOME_INTERVIEW_MINUTES` (20)
interview minutes. Sign-up needs no approval or email check, so to stop throwaway accounts farming them:
- **one welcome per network:** an IP gets one every `ORBIT_WELCOME_IP_DAYS` (30; `0` = for good). Another account
  from that network starts at zero and can buy a pack. IPs are stored only as an HMAC;
- **a daily cap:** at most `ORBIT_WELCOME_DAILY` (100) accounts get the welcome a rolling day. With public sign-up and
  no verification or approval, the API refuses to start if this is above 1000.

### Credit packs
| Pack | Price | Interview minutes | Resume AI credits |
|---|---|---|---|
| Mini | ₹499 | 15 | 5 |
| Starter | ₹1,999 | 60 | 15 |
| Plus | ₹3,999 | 150 | 40 |
| Pro | ₹7,999 | 360 | 100 |

Replace them without a code change (validated at boot):
```bash
ORBIT_CREDIT_PACKS_JSON='[{"id": "starter", "label": "Starter", "price_inr": 1999, "resume_credits": 15, "interview_minutes": 60}]'
```
An order keeps what the pack gave when it was bought, so changing packs never changes a paid order.

## Plans are server configuration
`apps/api/orbit_api/entitlements.py` holds the plan table. Clients never decide limits: they render `GET /v1/plans`,
`GET /v1/billing/packs` (both public) and `GET /v1/entitlements` (signed in; `credits` holds a Free account's
balance). Override plans without a code change:

```bash
ORBIT_PLANS_JSON='{"pro": {"live_minutes": 900}, "free": {"features": ["live", "documents", "mock"]}}'
FREE_MAX_SESSION_MINUTES=60   PRO_MAX_SESSION_MINUTES=180   UNLIMITED_MAX_SESSION_MINUTES=240
```

- **Settable per plan:**
  - the limits: `live_minutes`, `mock_minutes`, `screenshots`, `documents`, `max_session_minutes`;
  - `features`, from `live`, `documents`, `mock`, `vision`, `advanced_coding`, `system_design`,
    `provider_fallback`, `resume_ai`;
  - the display fields: `label`, `price_usd_month`, `stripe_price_id`.
- **Unlimited:** `null` means unlimited for a monthly limit. The session ceiling can't be unlimited.
- **Validation:** unknown plans, keys or features, and negative or non-integer limits stop the API at boot.
- **Admin:** the admin (`ORBIT_ADMIN_EMAIL`) always gets Unlimited.

## How limits are enforced
- **Interview time:** checked at session create, live ticket and socket connect, and committed every heartbeat
  (15 s). A warning comes 5 minutes before the end, then the session ends cleanly: transcript and usage are written
  and the report is queued. On Free that's the credit balance; on Pro, this month's live or mock allowance.
- **Each minute comes out of one balance:** the plan the account is on when it's metered decides, and the usage row
  records it (`usage.pool`: `credits`, `pro`, `unlimited`). Time on a Pro or Unlimited grant never comes out of the
  credits, even after the grant ends, and credits spent earlier in the month don't shrink a Pro allowance. When a
  grant starts or runs out mid-interview, the next heartbeat moves the rest of the session to the new balance.
- **Session ceiling:** a session's total time across reconnects is capped at `max_session_minutes`, even on
  Unlimited, with the same warning and graceful end (`usage.status {reason: "session"}`). A capped session can't be
  reopened (`409 session_time_limit`).
- **Features** are checked by name (`plan.has("vision")`): otherwise `403 feature_unavailable`.
- **Resume AI:** without credits, `402 upgrade_required` with the cheapest pack; `/suggest` still returns the AI-free
  fixes, with `upgrade_required: true`.
- **One live session per account** bounds any overshoot to about one heartbeat.

## Payments: Razorpay (cards worldwide, UPI, netbanking)
With `ORBIT_RAZORPAY_KEY_ID` and `ORBIT_RAZORPAY_KEY_SECRET` set, **Buy** opens Razorpay's checkout and the credits
land the moment the payment goes through (`apps/api/orbit_api/billing/razorpay.py`); the manual UPI flow below isn't
used.
1. **Buy** makes an order at Razorpay for the pack's price in rupees, kept as a payment (`method: razorpay`).
2. **The checkout takes the payment** (cards, UPI, netbanking, wallets) and hands back a signature,
   HMAC-SHA256(`order_id|payment_id`) with the key secret, which the API checks before adding the pack's credits.
3. **The webhook** (`POST /v1/billing/webhook`, signed with `ORBIT_RAZORPAY_WEBHOOK_SECRET`) does the same for a
   payment whose page was closed first. Whichever arrives first credits it; a payment is credited once.

Set-up, in the Razorpay dashboard:
- **API keys** (Account & Settings → API Keys): the key id and secret go in Render as the two variables above.
- **Webhook** (Account & Settings → Webhooks): URL `https://<api host>/v1/billing/webhook`, events `payment.captured`
  and `order.paid`, a secret of your choice in `ORBIT_RAZORPAY_WEBHOOK_SECRET`.
- **International cards:** ask Razorpay to enable international payments for the account. Buyers abroad are charged
  in rupees and their bank converts it; prices stay the ones above. Once Razorpay has enabled them, set
  `ORBIT_RAZORPAY_INTERNATIONAL=true` in Render: until then the pricing, FAQ and Plan & billing tell visitors outside
  India that cards from other countries are coming soon, rather than promising a card that would be declined.

Razorpay payments show in Settings → Payments as approved, with nothing to check.

## Payments: UPI, checked by the admin (when Razorpay isn't set up)
No payment gateway: people pay `ORBIT_UPI_ID` (shown as `ORBIT_UPI_NAME`) from any UPI app, and the admin confirms
each payment before its credits land (`apps/api/orbit_api/billing/upi.py`).
1. **Plan & billing → Buy** makes an order: the amount, a reference (`ORB…`, in the UPI note), a QR and a
   `upi://pay` link (on phones, a button that opens GPay / PhonePe / Paytm). The UPI ID and amount are also shown for
   paying by hand.
2. **The payer enters the UTR**, the 12-digit number the UPI app shows for the payment. A UTR counts once, for
   anyone. The admin gets an email.
3. **The admin opens Settings → Payments** (or the header's "to check" badge), finds the credit in the bank or UPI
   app by UTR or reference, and approves or rejects it (a reason is shown to the payer, who can send the right UTR).
4. **Approving adds the pack's credits.** It also approves the account, if sign-up approval was holding it.

The admin can also add credits by hand (Users & access → Give credits). Unset `ORBIT_UPI_ID` = nothing can be bought
(`buyable: false`), unless Razorpay is set up.

### Opening sign-up to everyone
`ORBIT_ALLOWED_EMAILS=*`, `ORBIT_EMAIL_VERIFICATION=off` and `ORBIT_SIGNUP_APPROVAL=false`: anyone signs up and starts
on the welcome credits, which are network-limited and capped a day. With approval on instead, new accounts can use
the resume maker but wait for you before interviews.

## What it costs to run (admin → Settings → Costs)
`GET /v1/admin/costs?days=30` (desktop Settings, admin only) reports:
- **totals:** LLM (from token counts), speech-to-text (minutes × `ORBIT_STT_PRICE_PER_MINUTE`) and vision;
- **live:** cost per live hour and per session;
- **LLM efficiency:** the cache hit ratio and tokens per answer;
- **breakdowns:** per model (including backup calls), per request type, per user and per plan.

LLM calls on a model without a configured price are **counted and shown as unpriced, never as $0**.

A real measurement on one session: an answer cost about $0.0002 in AI tokens (with an 89% DeepSeek cache hit).
**Speech-to-text dominates**: two channels at the Nova-3 list price come to about $0.92 per live hour, roughly ₹1.3
per interview minute. The packs come to about ₹22-33 an interview minute.
