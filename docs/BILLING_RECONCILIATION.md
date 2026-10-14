# Billing reconciliation

Credits are added only after Razorpay has **captured** the payment, and only once.

## States

| State | Meaning | Credits |
|---|---|---|
| `awaiting_payment` | Order created. Checkout may be open. | No |
| authorized (gateway only) | Bank authorised the card. Capture can still fail. | No |
| `approved` | Payment status at Razorpay is `captured`, amount in paise matches the pack, currency is INR, order id matches. | Yes, once |

`POST /v1/billing/razorpay/verify` checks the checkout signature, then reads the payment from Razorpay. A signature alone is not enough. Status `authorized` returns 409 and adds nothing.

The webhook accepts `payment.captured` and `order.paid` only when the payment entity is `captured`, currency is INR, and the amount matches. A second confirmation finds the row already `approved` and adds nothing.

## Refunds

`refund.processed` does not remove credits. A pack may already have been spent, and taking it back in code would change a balance the person can no longer see coming. The payment note and an audit row (`payment.refunded`) record the refund once. A person decides whether any credit should be removed.

Live gateway capture, webhook delivery and receipts were not exercised against Razorpay in this change. See `docs/RELEASE_VALIDATION.md`.
