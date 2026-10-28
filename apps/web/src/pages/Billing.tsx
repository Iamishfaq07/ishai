import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CreditCard, LoadGate, Skeleton, Sparkles, Spot, cx, focusRing, rupees } from "@orbit/ui";
import type { CreditPack, MonthlyPlan, UpiOrder } from "@orbit/types";
import { Button, Card, ErrorNote, PageHeader } from "../components/ui";
import { SpotArt } from "../components/SpotArt";
import { api } from "../lib/api";
import { contactHref } from "../lib/contactForm";
import { errorText, formatDate } from "../lib/format";
import { useAsync, useSettledOnce } from "../lib/useAsync";
import { UpiCheckout } from "./UpiCheckout";
import { InternationalPaymentError, payWithRazorpay } from "../lib/razorpay";
import { InternationalCheckout } from "../components/InternationalCheckout";
import { CreditPackGrid, PlanComparison, PricingTiers } from "../components/PricingTiers";
import { Cart } from "../components/Cart";
import { FirstOrderBanner, useFirstOrderPromotion } from "../components/FirstOrderBanner";
import { trackAction } from "../lib/activity";
import { CodeEntry, InviteFriends } from "../components/Referrals";
import { useAuth } from "../lib/auth";
import { useCountry } from "../lib/country";
import { CreditRows, UsageRows } from "./UsageSummary";

// Home's card lives with the balances it shows (./UsageSummary); still importable from here.
export { UsageSummary } from "./UsageSummary";

const STATUS: Record<UpiOrder["status"], { label: string; tone: string }> = {
  awaiting_payment: { label: "Not paid yet", tone: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300" },
  submitted: { label: "Checking your payment", tone: "bg-amber-500/10 text-amber-800 dark:text-amber-200" },
  approved: { label: "Paid · added", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  rejected: { label: "Couldn't confirm", tone: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  processing: { label: "Confirming the payment", tone: "bg-amber-500/10 text-amber-800 dark:text-amber-200" },
  expired: { label: "Not paid", tone: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300" },
};

/** Who confirms a card payment: Razorpay (India), PayPal (outside India). */
const gateway = (o: UpiOrder) => (o.method === "paypal" ? "PayPal" : "Razorpay");

/** Payments made (orders nobody paid for aren't worth listing), with a way back in to fix a UPI payment's UTR. */
function Payments({ orders, onOpen }: { orders: UpiOrder[]; onOpen: (o: UpiOrder) => void }) {
  const shown = orders.filter((o) => o.status !== "awaiting_payment" && o.status !== "expired");
  if (!shown.length) return null;
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-3 font-semibold"><Spot kind="receipt" />Your payments</h2>
      <ul className="divide-y divide-zinc-200 text-sm dark:divide-white/10">
        {shown.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
            <span className="font-medium">
              {o.label} · {o.amount_text || rupees(o.amount_inr)}
            </span>
            <span className="text-zinc-500">{formatDate(o.submitted_at ?? o.created_at)}</span>
            {o.method === "razorpay" || o.method === "paypal" ? (
              <span className="text-zinc-500">
                {gateway(o)} · <span className="font-mono tabular-nums">{o.reference}</span>
              </span>
            ) : (
              o.utr && <span className="tabular-nums text-zinc-500">UTR {o.utr}</span>
            )}
            <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS[o.status].tone)}>
              {o.status === "processing" ? `Confirming with ${gateway(o)}` : STATUS[o.status].label}
            </span>
            {(o.status === "rejected" || o.status === "submitted") && (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onOpen(o)}>
                {o.status === "rejected" ? "Send the right UTR" : "Correct the UTR"}
              </Button>
            )}
            {!!o.refunded_inr && (
              <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-800 dark:text-sky-200">
                Refunded {o.refunded_text || rupees(o.refunded_inr)}
              </span>
            )}
            {o.status === "processing" && (
              <span className="basis-full text-xs text-zinc-500">
                {gateway(o)} has your payment and is confirming it{o.method === "paypal" ? "" : " with your bank"}. The credits are added
                as soon as it's captured, usually within minutes; nothing more to do. Quote {o.reference} if you contact us.
              </span>
            )}
            {o.status === "rejected" && o.note && <span className="basis-full text-xs text-rose-700 dark:text-rose-300">{o.note}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function BillingPage() {
  const ent = useAsync(() => api.entitlements(), [], "entitlements");
  const packs = useAsync(() => api.listPacks(), [], "packs");
  const monthly = useAsync(() => api.listMonthly().catch(() => [] as MonthlyPlan[]), [], "monthly");
  const orders = useAsync(() => api.listUpiOrders().catch(() => [] as UpiOrder[]), [], "upi-orders");
  const [params, setParams] = useSearchParams();
  const [order, setOrder] = useState<UpiOrder | null>(null);
  const [starting, setStarting] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [bought, setBought] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const checkoutRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const country = useCountry();
  const [internationalPack, setInternationalPack] = useState<CreditPack | null>(null);
  // Referrals (when the server has them on): this account's first-purchase discount or a code box, and its invite link.
  const { user } = useAuth();
  const invite = useAsync(() => (user?.referrals ? api.myInvite() : Promise.resolve(null)), [user?.referrals], "referral-invite");
  const promotion = useFirstOrderPromotion();
  const [codeFromLink] = useState(() => params.get("code")); // /r/<code> followed while signed in
  const paidBefore = (orders.data ?? []).some((o) => o.status === "approved");
  // The first payment just landed: the discount is spent, so the prices go back to what they are.
  useEffect(() => {
    if (!paidBefore || !invite.data?.offer) return;
    invite.reload();
    packs.reload();
    monthly.reload();
  }, [paidBefore]); // eslint-disable-line react-hooks/exhaustive-deps

  // Buy opens the cart (the item, the first-purchase discount or a coupon's, the total); Pay there goes on to the
  // gateway. A pack that can't be paid for from abroad yet goes to the launch-access sheet instead.
  const [cart, setCart] = useState<CreditPack | MonthlyPlan | null>(null);
  const buy = (p: CreditPack | MonthlyPlan) => {
    const isPack = !("days" in p);
    if (isPack && country !== "IN" && !p.international) { setInternationalPack(p); return; }
    setBuyError(null);
    setCart(p);
    trackAction("Opened cart", p.id);
  };

  const pay = async (p: CreditPack | MonthlyPlan, domestic = false, code?: string) => {
    const isPack = !("days" in p);
    if (!domestic && isPack && country !== "IN" && !p.international) { setInternationalPack(p); return; }
    trackAction("Started payment", `${p.id} ${p.checkout ?? ""}`.trim());
    setStarting(true);
    setBuyError(null);
    setBought(null);
    setNotice(null);
    let leaving = false;
    try {
      if (p.checkout === "paypal") {
        // PayPal (outside India): its own page takes the payment and sends the buyer back here (?paypal=return),
        // where the server captures it. The page is left now, so the button stays busy.
        const checkout = await api.createPaypalOrder(p.id, code);
        leaving = true;
        window.location.assign(checkout.approve_url);
        return;
      }
      if (p.checkout === "razorpay") {
        // Razorpay: its window takes the payment; its signed answer is checked on the server, which adds the pack.
        const checkout = await api.createRazorpayOrder(p.id, code);
        setCart(null); // Razorpay's window takes over; the cart's focus trap mustn't pull focus out of it
        const paid = await payWithRazorpay(checkout);
        if (paid) {
          const done = await api.verifyRazorpay(paid);
          setBought(
            done.status === "approved"
              ? `${done.label} added. Thanks!`
              : `Razorpay has your payment and is confirming it. Your ${isPack ? "credits are" : "plan is"} added as soon as it's captured, usually within minutes. This page updates by itself.`,
          );
          orders.reload();
          ent.reload();
        }
      } else {
        // Paying a UPI ID by hand is no longer offered for new orders (Razorpay takes UPI apps in India).
        setBuyError("Payments aren't available right now. Try again in a few minutes, or write to us from Contact.");
      }
    } catch (err) {
      // The sheet offers a rupee checkout and a launch-access request: only true of a rupee order. A dollar order
      // is charged in dollars whatever the sheet says, so its card's failure is shown as it is.
      if (err instanceof InternationalPaymentError && country !== "IN" && isPack && p.currency !== "USD") {
        setCart(null);
        setInternationalPack(p);
      }
      else setBuyError(errorText(err));
    } finally {
      if (!leaving) setStarting(false);
    }
  };

  // Arriving from "Get credits" elsewhere (/billing?pack=starter, or a monthly plan's id): open that checkout.
  const wanted = params.get("pack");
  useEffect(() => {
    if (wanted === null || !packs.data || !monthly.data) return;
    const p = [...packs.data, ...monthly.data].find((x) => x.id === wanted && x.buyable);
    setParams({}, { replace: true });
    if (p) buy(p);
  }, [wanted, packs.data, monthly.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back from PayPal: ?paypal=return&token=<order id> after approving (the server takes the money and adds what was
  // bought, on PayPal's word), ?paypal=cancel after backing out. Either way the address is cleaned up.
  const paypalBack = params.get("paypal");
  const paypalOrder = params.get("token");
  useEffect(() => {
    if (paypalBack === null) return;
    setParams({}, { replace: true });
    if (paypalBack === "cancel") {
      setNotice("You left PayPal before paying, so nothing was charged.");
      return;
    }
    if (paypalBack !== "return" || !paypalOrder) return;
    setStarting(true);
    setBuyError(null);
    api.capturePaypal(paypalOrder)
      .then((done) => {
        if (done.status === "approved") setBought(`${done.label} added. Thanks!`);
        else if (done.status === "processing") {
          setBought("PayPal has your payment and is confirming it. It's added as soon as PayPal does, usually within minutes. This page updates by itself.");
        } else setNotice("PayPal hasn't confirmed a payment for this, so nothing was charged. Buy again if you meant to.");
        orders.reload();
        ent.reload();
      })
      .catch((err) => setBuyError(errorText(err)))
      .finally(() => setStarting(false));
  }, [paypalBack]); // eslint-disable-line react-hooks/exhaustive-deps

  // A payment the gateway is still confirming: check back every 15 s for a few minutes, so the credits show up here
  // without a reload once it's captured (the server credits it from the gateway's webhook or its own check).
  const confirming = (orders.data ?? []).some((o) => o.status === "processing");
  useEffect(() => {
    if (!confirming) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      orders.reload();
      ent.reload();
      if (tries >= 16) window.clearInterval(timer);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [confirming]); // eslint-disable-line react-hooks/exhaustive-deps

  // What a purchase said (added, still confirming, failed, back from PayPal) sits under the packs: far below a plan's
  // button, and below every pack on a phone. Bring it into view, or the click looks like it did nothing; once the
  // plans and packs above it are in, or they push it back down (back from PayPal, the page is still loading).
  const said = buyError ?? bought ?? notice;
  const shown = useSettledOnce(ent, packs, monthly, orders, invite);
  const laidOut = shown && Boolean(packs.data && monthly.data);
  useEffect(() => {
    if (said && laidOut) messageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [said, laidOut]);

  useEffect(() => {
    if (order) checkoutRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const e = ent.data;
  const list = packs.data ?? [];
  const months = monthly.data ?? [];
  const firstOffer = [...list, ...months].find((x) => x.offer_percent)?.offer_percent ?? 0;

  return (
    <div>
      <PageHeader eyebrow="Account" icon={CreditCard} title="Plan & billing" subtitle="Unlimited for a week, a month or a year, or credits that never expire. Nothing renews automatically." art={<SpotArt kind="plan" />} />
      {internationalPack && <InternationalCheckout pack={internationalPack} country={country} onClose={() => setInternationalPack(null)}
        onDomestic={() => { const p = internationalPack; setInternationalPack(null); void pay(p, true); }} />}
      <FirstOrderBanner />
      {cart && <Cart pack={cart} busy={starting} error={buyError} onClose={() => { if (!starting) setCart(null); }}
        onPay={(code, checkout) => void pay({ ...cart, checkout }, false, code)} />}
      {!shown ? (
        // One placeholder about the page's height until the plans, packs, balance and orders are in: drawn as each
        // arrived, the sections pushed each other down by hundreds of pixels (CLS 0.4 on a desktop, 0.8 on a phone).
        <Skeleton variant="card" count={3} label="Loading plans and credits" className="min-h-[70vh]" />
      ) : (
      <>
      {!invite.data && firstOffer > 0 && (
        <p role="status" className="mb-8 flex items-start gap-2 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-100">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span><span className="font-semibold">{firstOffer}% off your first purchase.</span> The prices below include it.</span>
        </p>
      )}
      {invite.data && orders.data && promotion.data?.enabled === false && (
        <div className="mb-8">
          <CodeEntry offer={invite.data.offer} canEnter={!paidBefore} prefill={codeFromLink}
                     onApplied={() => { invite.reload(); packs.reload(); monthly.reload(); }} />
        </div>
      )}
      {months.length > 0 && (
        <section aria-labelledby="monthly-title" className="mb-10 space-y-4">
          <div>
            <h2 id="monthly-title" className="flex items-center gap-3 font-semibold"><Spot kind="plan" />Plans</h2>
            <p className="text-sm text-zinc-500">
              Pay once for a week, a month or a year: a plan never renews by itself, and your credits stay for when it ends.
            </p>
          </div>
          <div className="pt-2">
            <PricingTiers monthly={months} current={e ? { plan: e.plan, until: e.until ?? null } : null} onBuy={(m) => buy(m)} busy={starting} />
          </div>
          <details className="group">
            <summary className={cx("tap-y cursor-pointer text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>Compare plans</summary>
            <PlanComparison monthly={months} />
          </details>
        </section>
      )}
      <section aria-labelledby="packs-title" className="mb-10 space-y-4">
        <div>
          <h2 id="packs-title" className="flex items-center gap-3 font-semibold"><Spot kind="credits" />Credits</h2>
          <p className="text-sm text-zinc-500">
            Pay as you go: 1 interview credit is 1 hour of live or mock interviews, and Resume credits come with
            every pack. Credits never expire and are used whenever you're not on a plan.
          </p>
        </div>
        <LoadGate loading={packs.loading && !packs.data} variant="card" count={2} label="Loading packs">
          {packs.error ? (
            <ErrorNote onRetry={packs.reload}>{errorText(packs.error)}</ErrorNote>
          ) : (
            <div className="pt-2">
              <CreditPackGrid packs={list} onBuy={(x) => buy(x)} busy={starting} />
            </div>
          )}
        </LoadGate>
        {said && (
          <div ref={messageRef} className="space-y-4">
            {buyError && <ErrorNote>{buyError}</ErrorNote>}
            {bought && (
              <p role="status" className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-800 dark:text-emerald-200">
                {bought}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-xl bg-zinc-500/10 px-4 py-3 text-sm text-zinc-700 dark:text-zinc-200">
                {notice}
              </p>
            )}
          </div>
        )}
        {/* Room for three lines is kept, and nothing is said until the packs say how they're paid: the UPI
            wording swapping to Razorpay's moved the page (layout shift). */}
        <p className="min-h-[3.75rem] text-xs text-zinc-500 sm:min-h-[2.5rem]">
          {!packs.data ? null : list.length > 0 && !list.some((p) => p.buyable) ? (
            // No checkout is on for this currency (dollars before PayPal, or rupees before UPI or Razorpay): the
            // how-to-pay wording below doesn't apply and every Buy button is off, so say so instead.
            <>
              {list[0]?.currency !== "INR"
                ? "Prices outside India are in US dollars. Paying in dollars isn't open yet."
                : "Payments aren't open here yet, so the Buy buttons are off."}{" "}
              <Link
                to={contactHref({ topic: "payment", from: "/billing" })}
                className={cx("font-medium text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300", focusRing)}
              >
                Tell us what you'd like to buy
              </Link>{" "}
              and we'll help.
            </>
          ) : list[0]?.checkout === "paypal"
            ? "Prices outside India are in US dollars, paid through PayPal: with your PayPal account, or a card where PayPal offers it. Nothing renews, and what you bought is added as soon as PayPal confirms the payment, usually within seconds."
            : list[0]?.checkout === "razorpay"
            ? `Pay once by card, UPI, netbanking or wallet, through Razorpay. ${
                list[0]?.international
                  ? list[0]?.currency === "USD"
                    ? "Prices outside India are in US dollars, charged by card."
                    : "Buyers outside India pay in US dollars."
                  : "Cards issued outside India can't be used yet; that's coming soon."
              } Nothing renews, and what you bought is added as soon as Razorpay confirms the payment, usually within seconds.`
            : "Pay once over UPI (Google Pay, PhonePe, Paytm or any bank app). Nothing renews or is charged automatically, and what you bought is added as soon as your payment is checked."}
        </p>
      </section>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="self-start lg:col-span-1">
          <h2 className="mb-1 flex items-center gap-3 font-semibold"><Spot kind="usage" />{e?.credits ? "Your credits" : "This month"}</h2>
          <p className="mb-4 text-sm text-zinc-500">
            {/* Packs add credits; they don't change the plan, so "Plan: Free" after buying one only confuses. */}
            {e?.credits ? "Pay as you go: buy a pack whenever you need more." : (
              <>Plan: <span className="font-medium text-zinc-800 dark:text-zinc-200">{e?.label ?? "—"}</span></>
            )}
            {e?.until && (
              <span className="block">
                Until {new Date(e.until).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric" })}
              </span>
            )}
          </p>
          <LoadGate loading={ent.loading && !e} variant="line" count={4} label="Loading your plan">
          {ent.error ? (
            <ErrorNote onRetry={ent.reload}>{errorText(ent.error)}</ErrorNote>
          ) : e ? (
            e.credits ? <CreditRows e={e} /> : <UsageRows e={e} />
          ) : null}
          </LoadGate>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <div ref={checkoutRef} className="scroll-mt-20">
            {order && (
              <UpiCheckout
                key={order.id}
                order={order}
                onClose={() => setOrder(null)}
                onChanged={() => {
                  orders.reload();
                  ent.reload();
                }}
              />
            )}
          </div>
          <Payments orders={orders.data ?? []} onOpen={setOrder} />
          {invite.data && <InviteFriends invite={invite.data} />}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
