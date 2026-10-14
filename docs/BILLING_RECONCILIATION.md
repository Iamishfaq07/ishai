# Billing reconciliation

Credits are added only after Razorpay has **captured** the payment, and only once
(`apps/api/orbit_api/billing/settle.py`).

## States (`payments.status`, method `razorpay`)

| State | Meaning | Credits | Shown to the buyer |
|---|---|---|---|
| `awaiting_payment` | Order created. Checkout may be open. | No | No (an unpaid checkout is noise) |
| `processing` | Razorpay has a payment for the order that isn't captured yet (`authorized`), or the checkout answered but Razorpay couldn't be asked. The payment id is stored. | No | "Confirming with Razorpay", with the ORB reference |
| `approved` | Razorpay's payment is `captured`, the amount in paise matches the pack, currency is INR, the order id matches. | Yes, once | "Paid · credits added" |
| `expired` | Nobody paid the order within 72 hours (`RECONCILE_WINDOW`). | No | No |

Three ways can move an order to `approved`, and all three go through `settle.credit`:

1. **The checkout's answer** (`POST /v1/billing/razorpay/verify`): the signature is checked, then the payment is read
   from Razorpay. Captured → credited. `authorized`, or Razorpay not answering → `processing` (200, not an error).
   `failed` → 409 "nothing was charged".
2. **The webhook** (`POST /v1/billing/webhook`, `payment.captured` / `order.paid`): signature over the raw body, then
   the same checks.
3. **The reconciler** (`settle.reconcile`, every sweeper pass, ~5 minutes; also **Check with Razorpay now** in admin
   Payments): open orders from the last 72 hours, each checked on a backoff of 2, 4, 8 … 60 minutes. With a known
   payment id it reads that payment; without one it lists the order's payments (`GET /orders/{id}/payments`) and
   credits a captured one. It never credits anything Razorpay doesn't report as captured.

**Exactly once:** `credit` moves the order with a conditional update (`WHERE status IN (awaiting_payment,
processing)`); payment ids are unique; credit entries are unique per payment and kind. Two confirmations at once (the
checkout and the webhook, or two webhook deliveries) credit once; tested with a concurrent burst on SQLite and
Postgres (`tests/test_payment_settlement.py`).

## Webhook events (`payment_events`)

Every signed event is recorded by its id (`X-Razorpay-Event-Id`, or a hash of the signed body without one), with only
ids, amounts and statuses (no payer email, phone or card details).

| Status | Meaning |
|---|---|
| `processed` | Applied (or found already applied). A redelivery changes nothing. |
| `ignored` | Nothing to do (an event type we don't use, a payment not captured, an amount or currency that doesn't match). |
| `unmatched` | Its order or payment isn't known here (yet). Kept; a redelivery is tried again. |
| `error` | Applying it failed. The webhook answers 500 so Razorpay redelivers; the redelivery is applied. |

Admin Payments shows how many events need review (`unmatched` + `error`).

## Refunds (`payment_refunds`)

One row per Razorpay refund id (`refund.created`, `refund.processed`, `refund.failed`), however often it's delivered.
A refund that arrives **before** its payment is known here is stored unlinked (`payment_id` NULL, the gateway payment
id kept) and linked when the payment is credited, or by the reconciler. `payments.refunded_paise` is the sum of the
payment's `processed` refunds (partial refunds add up); failed refunds are kept and not counted. The buyer sees
"Refunded ₹N" on the payment; the admin sees it on the payment row.

**Refund policy (current behaviour, for the owner to confirm):** a refund does **not** remove credits. A pack may
already have been spent, and taking it back in code would change a balance the person can no longer see coming, or
push it below zero. Refunds are issued by a person in the Razorpay dashboard, who decides case by case; the refund
record and the audit row (`payment.refunded`) are the trail. If the business wants a different rule (for example,
refund only unused packs, or remove unspent credits on refund), that is a product decision to write down here first,
then implement as an admin action with its own audit row. Nothing in code claws credits back today.

## What's verified, and what isn't

Verified by tests against a mock of Razorpay's API (`tests/test_payment_settlement.py`, `tests/test_razorpay.py`), on
SQLite and Postgres 16: duplicate and concurrent webhook deliveries, forged signatures, amount and currency mismatches,
an event that fails then succeeds on redelivery, partial then full refunds, a failed refund, a refund before its
capture, a payment for a deleted account, a lost webhook with the page closed, a delayed capture after verify, a
gateway timeout at verify, two orders matched separately, the backoff and expiry, and a bank-failed payment.

**Not verified here:** a real Razorpay capture, refund and webhook delivery (test or live mode), receipts, and
`X-Razorpay-Event-Id` as Razorpay actually sends it. See `docs/RELEASE_VALIDATION.md` for the live checklist.
