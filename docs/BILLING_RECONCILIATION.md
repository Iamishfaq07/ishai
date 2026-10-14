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

## Not done here

Refunds, partial refunds and disputes do not automatically remove credits. A refund after credits were spent needs a manual decision recorded in the admin audit log. Do not claw credits back in code until that rule is written.

Live gateway capture, webhook delivery and receipts were not exercised against Razorpay in this change. See `docs/RELEASE_VALIDATION.md`.
