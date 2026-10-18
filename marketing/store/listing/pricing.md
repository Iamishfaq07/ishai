# Pricing and availability

| Setting | Choice |
| --- | --- |
| Base price | **Free** |
| Free trial, sale pricing, organizational licensing | None |
| Markets | All possible markets (the default). Orbit already sells worldwide: rupees in India, US dollars elsewhere. |
| Visibility, first submission | **Private audience**: a known user group with your own Microsoft account and one tester. Install from the Store, check sign-in, capture and a live session, then make it public. |
| Visibility, after that check | Public audience, discoverable. |
| Schedule | As soon as possible; publishing is held under Submission options instead (see docs/MICROSOFT_STORE.md). |

**One-way switch.** Microsoft: "If you submit a product with this option set to **Public audience**, you can't choose
**Private audience** in a later submission." Source:
<https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/visibility-options>.

## Paying on the website is allowed for this app

Microsoft Store Policies 7.20, 10.8.1 (<https://learn.microsoft.com/en-us/windows/apps/publish/store-policies>).
Only games and Xbox products must use Microsoft's purchase API. For everything else:

> Non-game products made available on PC devices may either use a secure third-party purchase API or the Microsoft
> Store in-product purchase API for in-app purchases of digital items or services that are consumed or used within
> the product.

**What comes with that choice (10.8.2):**
- "your product must identify the commerce transaction provider, authenticate the user, and obtain the user's
  confirmation of the transaction". The website's checkout names Razorpay or PayPal, requires sign-in, and the user
  confirms the payment.
- "After installation of your product is completed, users may be directed to a browser to complete registration or
  transactions". That's what the app does: Buy opens orbitanswer.com/billing.
- "You must note the use of a secure third-party purchase API in Partner Center during the submission process". Tick
  the Properties declaration "This product allows users to make purchases, but does not use the Microsoft Store
  commerce system".
- PCI DSS applies to whoever takes the card. That's Razorpay and PayPal; Orbit never sees a card number (privacy
  policy).

**10.8.4:**

> Your product and its associated metadata must provide information about the types of in-product purchases offered
> and the range of prices.

The description's PRICE section does that.

**Prices in the listing** (defaults in `apps/api/orbit_api/billing/packs.py` and `monthly.py`, checked 2026-10-18):
- Packs: ₹499 / $7.99 (AI credits) up to ₹7,749 / $161.99 (15 credits).
- Plans: 7 days ₹3,499 / $70.99, 30 days ₹6,599 / $135.99, 365 days ₹26,499 / $531.99.
- All are paid once. Nothing renews.

The range in the description is ₹499–₹26,499 / US$7.99–US$531.99. If production overrides the prices
(`ORBIT_CREDIT_PACKS_JSON`, `ORBIT_MONTHLY_PLANS_JSON`), update the description in the next submission.

**Subscriptions.** None today. If Orbit ever adds auto-renewing plans, 10.8.6 also applies, including: "You may add
value to a subscription but may not remove value for users who have previously purchased it."
