# Plans, credits and billing

## Free accounts run on credits
A new account gets **welcome credits** (`apps/api/orbit_api/credits.py`), and buys **credit packs** (through Razorpay,
or over UPI) for more. Credits never expire and nothing renews.

- **Interview minutes:** live interviews and mock interviews both draw on one balance. They're metered by the live
  socket every heartbeat, and a session ends cleanly when the balance runs out.
- **Resume AI credits:** one per AI action in Resume AI: an import, a rewrite, tailoring, a cover letter, interview
  questions, a profile or a message.
  A **single AI fix** costs a fraction of a credit: one ATS check fixed, or one section or line rewritten.
  `ORBIT_RESUME_FIXES_PER_CREDIT` (default 5) fixes share one credit. The first fix spends the credit and leaves the
  rest prepaid (the `resume_fix` ledger kind, hidden from the admin's ledger), and the next fixes use those first.
  "Fix everything" on the whole resume is still one credit. The landing page's price table says "1/5": change it there
  if you change the setting.
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
The packs on sale, their prices and what each includes are in the table under "Monthly plans" below.

Replace them without a code change (validated at boot):
```bash
ORBIT_CREDIT_PACKS_JSON='[{"id": "starter", "label": "3 credits", "price_inr": 2599, "price_usd_cents": 5399, "resume_credits": 30, "interview_minutes": 180}]'
```
`price_usd_cents` is optional (the dollar price; without it, the rupee price converted, below).
An order keeps what the pack gave and what it cost when it was bought, so changing packs or prices never changes an
order already made: an order opened at an old price is still paid and settled at that price (D60).

## Prices outside India: US dollars
`apps/api/orbit_api/billing/pricing.py`.
- **Currency:** a buyer in India sees and pays rupees. Everyone else sees and pays **US dollars**.
- **Fixed dollar prices:** every default pack and plan has its own `price_usd_cents`, pinned on 2026-10-18 at what it
  cost in dollars before the rupee prices were cut (D60). Changing the rupee price, `ORBIT_USD_INR` or
  `ORBIT_INTL_MARKUP` doesn't move them; change a dollar price with `price_usd_cents` in
  `ORBIT_CREDIT_PACKS_JSON` / `ORBIT_MONTHLY_PLANS_JSON`.
- **Formula,** for a pack or plan from those variables without `price_usd_cents`: rupee price ÷ `ORBIT_USD_INR`
  (default 88) × `ORBIT_INTL_MARKUP` (default 1.3), rounded up to the next whole dollar less a cent. For example
  ₹3,599 → $53.99, ₹9,199 → $135.99, ₹35,999 → $531.99 (the old rupee prices, which is where the pinned dollar
  prices come from). `ORBIT_USD_INR` also gives a dollar sale's rupee equivalent for reports.
- **Where the country comes from:** the visitor's IP. The web app's Cloudflare Worker sends Cloudflare's country as
  `X-Orbit-Client-Country`.
  - The API believes it only with the proxy secret, like the client IP. The Worker sends both only when it has
    the `PROXY_SECRET` secret, so a Worker without it prices every web visitor as in India. The admin Overview
    then shows "The website isn't sending the proxy secret".
  - Without that header (the desktop app, a direct caller) it uses the account's saved country, then India.
  - A VPN into India shows rupees, but those orders are then paid with Indian methods.
- **Payments:**
  - Dollar orders go through **PayPal** when it's set up (below), else through Razorpay in USD. `payments.currency`
    is "USD", `amount_minor` holds cents, and `amount_inr` is the rupee equivalent for reports.
  - UPI is rupees only, so it is refused for buyers outside India. PayPal is dollars only, so it is refused for
    buyers in India (a PayPal India account can't take payments from India anyway).
- **Turning on dollar checkout (OWNER ACTION REQUIRED):**
  1. A way to take dollars: PayPal set up (the next section), or Razorpay's international card payments approved
     on your account with `ORBIT_RAZORPAY_INTERNATIONAL=true` on Railway. Until one of them is, dollar prices show
     with their Buy buttons off, and the API refuses a dollar order (409).
  2. The web Worker has the same secret as the API's `ORBIT_PROXY_SECRET` (Railway):
     `pnpm dlx wrangler@4 secret put PROXY_SECRET --name orbit`. Check with
     `pnpm dlx wrangler@4 secret list --name orbit`. Without it, nobody is ever shown dollars on the website.

## Monthly plans (paid once a month, never auto-renewing)
`apps/api/orbit_api/billing/monthly.py` sells a plan for 30 days through the same checkout as the packs (Razorpay, or
UPI with the admin's check). Buy one with `POST /v1/billing/razorpay/orders` or `/v1/billing/upi/orders` and
`{"pack": "<monthly id>"}`. `GET /v1/billing/monthly` lists them for the pricing pages.

The structure copies Parakeet AI's: a free start, interview credits where 1 credit = 1 hour and bigger packs add free
credits, and unlimited plans for a week, a month or a year. Each rupee price is about 30% under Parakeet's own rupee
price, as the owner checked it on 2026-10-18 (D60). Dollar prices weren't cut: they stay where they were (above). All
three unlimited plans give the same `premium` plan.

**Unlimited (billing/monthly.py)**

| Plan | Price in India | Outside India | Parakeet AI (₹, 2026-10-18) |
|---|---|---|---|
| Weekly (`premium_weekly`) | ₹3,499 / 7 days | $70.99 | ₹4,980 |
| Monthly (`premium_monthly`, "Most popular") | ₹6,599 / 30 days | $135.99 | ₹9,470 |
| Yearly (`premium_yearly`, "Best value") | ₹26,499 / 365 days (≈ ₹2,178 a month) | $531.99 | ₹37,900 |

Every 30 days the `premium` plan includes:
- unlimited Resume AI;
- 50 hours of live interview help (3,000 minutes, fair use) and 25 hours of mock and video interviews;
- unlimited screenshots and documents;
- sessions of up to 4 hours.

**Credit packs (billing/packs.py).** 1 interview credit = 60 minutes of live or mock interviews. Each pack also includes
10 Resume AI credits per hour.

| Pack (id) | Price in India | Outside India | Interview credits | Resume AI credits | Parakeet AI (₹, 2026-10-18) |
|---|---|---|---|---|---|
| AI credits (`mini`) | ₹499 | $7.99 | — | 25 | — (ours: Resume AI alone) |
| 1 credit (`single`) | ₹1,649 | $33.99 | 1 | 10 | ₹2,360 |
| 3 credits (`starter`) | ₹2,599 | $53.99 | 3 | 30 | ₹3,690 |
| 8 credits (`plus`, "Most popular") | ₹5,199 | $106.99 | 6 + 2 free | 80 | ₹7,380 |
| 15 credits (`pro`, "Best value") | ₹7,749 | $161.99 | 9 + 6 free | 150 | ₹11,070 |

- **Nothing renews.** A paid month sets `User.grant_plan` and `grant_until`, the same fields as the admin's
  time-limited grants. When it ends the account is back on Free, and the credits it had are still there.
- **Buying again:**
  - The same plan while it's running adds 30 days to the end.
  - A different plan starts now and replaces the old one. Leftover days aren't carried over; the page says "Add 30
    days" only on the plan you have.
- **Metering:** the allowance is per 30-day period counted back from the plan's end (`entitlements.period_start`), not
  per calendar month. A month bought on the 28th is one allowance, not two. Admin grants are metered the same way
  while they run.
- **Config:** `ORBIT_MONTHLY_PLANS_JSON` replaces the list, for example
  `[{"id": "pro_monthly", "label": "Pro", "price_inr": 3999, "plan": "pro", "days": 30}]`. `[]` sells none.
  An optional `price_usd_cents` fixes the dollar price, as for packs.
  - `plan` is one of `basic`, `pro` or `unlimited`. Change a plan's allowance with `ORBIT_PLANS_JSON`.
  - A bad value stops the API at boot.
- **Two months approved at the same moment** both add their days (the account row is locked while the end date is
  read).
- **OWNER ACTION REQUIRED:** check the prices against your costs (the table under "What it costs to run").
  - A subscriber who uses the whole 75 hours a month costs about ₹5,900 a month in speech-to-text at list price,
    before the model's cost.
  - On the yearly plan (≈ ₹2,178 a month) that loses money for the heaviest users, and the Monthly plan (₹6,599)
    barely covers them. Lower the `premium` plan's caps with `ORBIT_PLANS_JSON` if needed.
  - Parakeet AI's rupee prices were checked by the owner on 2026-10-18; re-check them before you rely on a "30% less"
    claim (no page says it today). The pricing pages also show an Enterprise tier with no price: its button opens the Contact form
  (topic "Business or partnership"), and you arrange group access by hand (an admin grant per account).

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
- **API keys** (Account & Settings → API Keys): the key id and secret go in Railway as the two variables above.
- **Webhook** (Account & Settings → Webhooks): URL `https://api.orbitanswer.com/v1/billing/webhook`, events `payment.captured`
  and `order.paid`, a secret of your choice in `ORBIT_RAZORPAY_WEBHOOK_SECRET`.
- **International cards:** ask Razorpay to enable international payments for the account. Buyers abroad are charged
  in rupees and their bank converts it; prices stay the ones above. Once Razorpay has enabled them, set
  `ORBIT_RAZORPAY_INTERNATIONAL=true` in Railway: until then the pricing, FAQ and Plan & billing tell visitors outside
  India that cards from other countries are coming soon, rather than promising a card that would be declined.

Razorpay payments show in Settings → Payments as approved, with nothing to check.

## Payments: PayPal (buyers outside India, in US dollars)
With `ORBIT_PAYPAL_CLIENT_ID` and `ORBIT_PAYPAL_CLIENT_SECRET` set, every dollar price (packs and plans) is bought
through PayPal (`apps/api/orbit_api/billing/paypal.py`, Orders v2). Buyers in India keep Razorpay or UPI in rupees.
1. **Buy** makes a PayPal order for the price (`POST /v1/billing/paypal/orders`), kept as a payment
   (`method: paypal`). Its invoice id is the payment's ORB… reference, so PayPal refuses to take one order twice.
2. **The buyer approves it on PayPal's own page** (their PayPal account, or a card where PayPal offers guest
   checkout) and PayPal sends them back to `/billing?paypal=return&token=<order id>`. Backing out returns to
   `/billing?paypal=cancel`: nothing is charged.
3. **On the way back the API captures the order** (`POST /v1/billing/paypal/capture`) and adds what was bought only
   when PayPal says the capture is COMPLETED for exactly the order's amount and currency. A capture PayPal holds as
   PENDING shows as "Confirming with PayPal" until it completes.
4. **If the buyer approved and never came back**, the webhook (`CHECKOUT.ORDER.APPROVED`) or the reconciler (every
   few minutes, the same one as Razorpay's) captures it. `PAYMENT.CAPTURE.COMPLETED` credits a pending capture;
   `PAYMENT.CAPTURE.REFUNDED` and `.REVERSED` (a chargeback) are recorded like Razorpay refunds, with the credits
   kept. Webhooks are believed only when PayPal's `verify-webhook-signature` says SUCCESS for the event as received.

Set-up (OWNER ACTION REQUIRED), at developer.paypal.com with your PayPal Business login:
- **Apps & Credentials → Create App** (type Merchant), first under **Sandbox** to try it with PayPal's test buyers,
  then under **Live**. The app's Client ID and Secret go in Railway as `ORBIT_PAYPAL_CLIENT_ID` and
  `ORBIT_PAYPAL_CLIENT_SECRET`, with `ORBIT_PAYPAL_ENV` = `sandbox` or `live` (one app, the same mode as its keys).
- **The app → Webhooks → Add Webhook:** URL `https://api.orbitanswer.com/v1/billing/paypal/webhook`, events
  *Checkout order approved*, *Payment capture completed*, *Payment capture pending*, *Payment capture refunded* and
  *Payment capture reversed*. PayPal then shows the webhook's ID: it goes in `ORBIT_PAYPAL_WEBHOOK_ID`. Without it
  webhooks are refused (logged at startup), and payments still land on the buyer's return or through the reconciler.
- **The PayPal Business account (India):** it can only take payments from outside India, which is exactly who it's
  offered to. PayPal asks Indian accounts for a purpose code for what's sold (software or services) and moves the
  balance to your bank account; check both in the account's settings.
- **Guest card checkout:** in the account settings, *Website payments → PayPal account optional* lets buyers pay by
  card without a PayPal account, where PayPal offers it.

PayPal payments show in Settings → Payments as approved, with nothing to check.

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
