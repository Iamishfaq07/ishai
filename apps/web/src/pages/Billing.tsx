import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CircleCheck, CountUp, CreditCard, Crown, LoadGate, Mic, Sparkles, cx, focusRing, type LucideIcon } from "@orbit/ui";
import type { CreditPack, Entitlements, UpiOrder } from "@orbit/types";
import { Button, Card, ErrorNote, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { contactHref } from "../lib/contactForm";
import { errorText, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { RESUME_AI_HOME } from "./resume/paths";
import { UpiCheckout } from "./UpiCheckout";
import { payWithRazorpay } from "../lib/razorpay";

function Bar({ used, limit }: { used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
      <div
        className={pct >= 90 ? "h-full bg-rose-500" : "h-full bg-indigo-500"}
        style={{ width: limit ? `${pct}%` : "0%" }}
      />
    </div>
  );
}

// The two balances wear their product's colour: interview minutes the copilot's, Resume AI credits Resume AI's.
const BALANCE_TONE = {
  interview: { tile: "bg-indigo-500/[0.06] ring-indigo-500/15 dark:bg-indigo-400/[0.07] dark:ring-indigo-300/15", chip: "bg-indigo-500/15 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-200" },
  resume: { tile: "bg-emerald-500/[0.06] ring-emerald-600/15 dark:bg-emerald-400/[0.07] dark:ring-emerald-300/15", chip: "bg-emerald-500/15 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200" },
};

/** One balance as a big number (counting up the first time it shows), what it's for underneath. */
function Balance({ icon: Icon, tone, value, unit, label, children }: { icon: LucideIcon; tone: keyof typeof BALANCE_TONE; value: number | null; unit: string; label: string; children: ReactNode }) {
  const t = BALANCE_TONE[tone];
  return (
    <div className={cx("rounded-xl p-4 ring-1", t.tile)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span aria-hidden="true" className={cx("flex h-8 w-8 items-center justify-center rounded-lg", t.chip)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-1 font-display text-3xl font-semibold tracking-tight">
        {value === null ? "Unlimited" : <CountUp to={value} />}
        {value !== null && <span className="ml-1 text-sm font-medium text-zinc-500">{unit}</span>}
      </p>
      <p className="mt-1 text-xs text-zinc-500">{children}</p>
    </div>
  );
}

/** The credits left on a Free account: resume AI and interview minutes (live and mock share them). */
function CreditRows({ e, wide = false }: { e: Entitlements; wide?: boolean }) {
  const c = e.credits;
  if (!c) return null;
  const empty = Math.round(c.interview_minutes_left) <= 0 && c.resume === 0;
  return (
    <div className="space-y-4">
      {/* Side by side when the card has room for both (13rem each), stacked when it doesn't: Home puts this card in
          a full row or beside Recent sessions, Plan & billing in a narrow column. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-3">
        <Balance icon={Mic} tone="interview" value={Math.round(c.interview_minutes_left)} unit="min left" label="Interview minutes">
          Live interviews and mock interviews both use these.
        </Balance>
        <Balance icon={Sparkles} tone="resume" value={c.resume} unit="left" label="Resume AI credits">
          One per AI action in{" "}
          <Link to={RESUME_AI_HOME} className={cx("font-medium text-indigo-600 hover:underline dark:text-indigo-300", focusRing)}>
            Resume AI
          </Link>
          : an import, rewrite, tailoring, cover letter, profile or message.
        </Balance>
      </div>
      {empty && c.welcome_missed && (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-2.5 text-sm text-amber-900 dark:text-amber-100">
          <span className="font-medium">No free credits on this account.</span> The free starter credits go to one new
          account per network each month (Wi-Fi and mobile data are often shared) and one per inbox, so this one didn't
          get them. A pack adds credits right away.{" "}
          <Link
            to={contactHref({ topic: "payment", from: "/billing" })}
            className={cx("font-medium text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300", focusRing)}
          >
            Think that's wrong? Tell us
          </Link>
        </p>
      )}
      {empty && wide && (
        <Link to="/billing" className={cx("inline-flex items-center gap-1.5 text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
          <Crown className="h-4 w-4 text-amber-500" aria-hidden="true" /> Top up with a pack. Pay once, nothing renews.
        </Link>
      )}
      <p className="text-xs text-zinc-500">
        Credits never expire. Screenshots: {e.usage.screenshots} / {e.limits.screenshots ?? "∞"} this month · Documents:{" "}
        {e.usage.documents} / {e.limits.documents ?? "∞"} · Sessions up to {e.limits.max_session_minutes} min.
      </p>
    </div>
  );
}

/** Plans with their own monthly allowance (Pro or Unlimited, granted by the admin). */
function UsageRows({ e }: { e: Entitlements }) {
  const rows = [
    { label: "Live minutes", used: Math.round(e.usage.live_minutes), limit: e.limits.live_minutes },
    { label: "Mock interview minutes", used: Math.round(e.usage.mock_minutes), limit: e.limits.mock_minutes },
    { label: "Screenshots", used: e.usage.screenshots, limit: e.limits.screenshots },
    { label: "Documents", used: e.usage.documents, limit: e.limits.documents },
  ];
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>{r.label}</span>
            <span className="tabular-nums text-zinc-500">
              {r.used}
              {r.limit !== null ? ` / ${r.limit}` : " · unlimited"}
            </span>
          </div>
          {r.limit !== null && <Bar used={r.used} limit={r.limit} />}
        </div>
      ))}
      <p className="text-xs text-zinc-500">Each session can run up to {e.limits.max_session_minutes} minutes.</p>
    </div>
  );
}

function PackCard({ p, best, busy, onBuy }: { p: CreditPack; best: boolean; busy: boolean; onBuy: (p: CreditPack) => void }) {
  const perMinute = p.interview_minutes ? p.price_inr / p.interview_minutes : null;
  return (
    <Card className={cx("lift relative flex flex-col", best ? "!ring-2 ring-amber-500/70 dark:ring-amber-400/60" : "ring-1 ring-zinc-500/10")}>
      {best && (
        <span className="absolute -top-3 left-4 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-amber-950">
          Best value
        </span>
      )}
      <h3 className="flex items-center gap-1.5 font-semibold">
        <Crown className="h-4 w-4 text-amber-500" /> {p.label}
      </h3>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">₹{p.price_inr.toLocaleString("en-IN")}</p>
      {perMinute && <p className="text-xs text-zinc-500">≈ ₹{perMinute.toFixed(perMinute < 10 ? 1 : 0)} per interview minute, paid once</p>}
      <ul className="mt-4 flex-1 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        {p.interview_minutes > 0 && (
          <PackLine>
            <strong className="font-semibold tabular-nums">{p.interview_minutes}</strong> interview minutes (live or mock)
          </PackLine>
        )}
        {p.resume_credits > 0 && (
          <PackLine>
            <strong className="font-semibold tabular-nums">{p.resume_credits}</strong> Resume AI credits
          </PackLine>
        )}
        <PackLine>Never expire, no subscription</PackLine>
      </ul>
      <Button className="mt-5 w-full" variant={best ? "primary" : "secondary"} disabled={busy || !p.buyable} onClick={() => onBuy(p)} title={p.buyable ? undefined : "Payments aren't set up yet"}>
        Buy · ₹{p.price_inr.toLocaleString("en-IN")}
      </Button>
    </Card>
  );
}

function PackLine({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

const STATUS: Record<UpiOrder["status"], { label: string; tone: string }> = {
  awaiting_payment: { label: "Not paid yet", tone: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300" },
  submitted: { label: "Checking your payment", tone: "bg-amber-500/10 text-amber-800 dark:text-amber-200" },
  approved: { label: "Paid · credits added", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  rejected: { label: "Couldn't confirm", tone: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  processing: { label: "Confirming with Razorpay", tone: "bg-amber-500/10 text-amber-800 dark:text-amber-200" },
  expired: { label: "Not paid", tone: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300" },
};

/** Payments made (orders nobody paid for aren't worth listing), with a way back in to fix a UPI payment's UTR. */
function Payments({ orders, onOpen }: { orders: UpiOrder[]; onOpen: (o: UpiOrder) => void }) {
  const shown = orders.filter((o) => o.status !== "awaiting_payment" && o.status !== "expired");
  if (!shown.length) return null;
  return (
    <Card>
      <h2 className="mb-3 font-semibold">Your payments</h2>
      <ul className="divide-y divide-zinc-200 text-sm dark:divide-white/10">
        {shown.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
            <span className="font-medium">
              {o.label} · ₹{o.amount_inr}
            </span>
            <span className="text-zinc-500">{formatDate(o.submitted_at ?? o.created_at)}</span>
            {o.method === "razorpay" ? (
              <span className="text-zinc-500">
                Razorpay · <span className="font-mono tabular-nums">{o.reference}</span>
              </span>
            ) : (
              o.utr && <span className="tabular-nums text-zinc-500">UTR {o.utr}</span>
            )}
            <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS[o.status].tone)}>{STATUS[o.status].label}</span>
            {(o.status === "rejected" || o.status === "submitted") && (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onOpen(o)}>
                {o.status === "rejected" ? "Send the right UTR" : "Correct the UTR"}
              </Button>
            )}
            {!!o.refunded_inr && (
              <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-800 dark:text-sky-200">
                Refunded ₹{o.refunded_inr}
              </span>
            )}
            {o.status === "processing" && (
              <span className="basis-full text-xs text-zinc-500">
                Razorpay has your payment and is confirming it with your bank. The credits are added as soon as it's
                captured, usually within minutes; nothing more to do. Quote {o.reference} if you contact us.
              </span>
            )}
            {o.status === "rejected" && o.note && <span className="basis-full text-xs text-rose-700 dark:text-rose-300">{o.note}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Home's summary card: credits on Free, the monthly allowance otherwise. */
export function UsageSummary() {
  const ent = useAsync(() => api.entitlements(), [], "entitlements");
  return (
    <LoadGate loading={ent.loading && !ent.data} variant="line" count={4} label="Loading your plan">
      {ent.error ? (
        <ErrorNote onRetry={ent.reload}>{errorText(ent.error)}</ErrorNote>
      ) : ent.data ? (
        ent.data.credits ? <CreditRows e={ent.data} wide /> : <UsageRows e={ent.data} />
      ) : null}
    </LoadGate>
  );
}

export function BillingPage() {
  const ent = useAsync(() => api.entitlements(), [], "entitlements");
  const packs = useAsync(() => api.listPacks(), [], "packs");
  const orders = useAsync(() => api.listUpiOrders().catch(() => [] as UpiOrder[]), [], "upi-orders");
  const [params, setParams] = useSearchParams();
  const [order, setOrder] = useState<UpiOrder | null>(null);
  const [starting, setStarting] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [bought, setBought] = useState<string | null>(null);
  const checkoutRef = useRef<HTMLDivElement>(null);

  const buy = async (p: CreditPack) => {
    setStarting(true);
    setBuyError(null);
    setBought(null);
    try {
      if (p.checkout === "razorpay") {
        // Razorpay: its window takes the payment; its signed answer is checked on the server, which adds the pack.
        const checkout = await api.createRazorpayOrder(p.id);
        const paid = await payWithRazorpay(checkout);
        if (paid) {
          const done = await api.verifyRazorpay(paid);
          setBought(
            done.status === "approved"
              ? `${done.label} added. Thanks!`
              : "Razorpay has your payment and is confirming it. Your credits are added as soon as it's captured, usually within minutes. This page updates by itself.",
          );
          orders.reload();
          ent.reload();
        }
      } else {
        setOrder(await api.createUpiOrder(p.id));
      }
    } catch (err) {
      setBuyError(errorText(err));
    } finally {
      setStarting(false);
    }
  };

  // Arriving from "Get credits" elsewhere (/billing?pack=starter): open that pack's checkout straight away.
  const wanted = params.get("pack");
  useEffect(() => {
    if (wanted === null || !packs.data) return;
    const p = packs.data.find((x) => x.id === wanted && x.buyable);
    setParams({}, { replace: true });
    if (p) void buy(p);
  }, [wanted, packs.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // A payment Razorpay is still confirming: check back every 15 s for a few minutes, so the credits show up here
  // without a reload once it's captured (the server credits it from Razorpay's webhook or its own check).
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

  useEffect(() => {
    if (order) checkoutRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const e = ent.data;
  const list = packs.data ?? [];
  // The second-largest pack (Plus) is the usual pick: more per rupee than the small ones without the largest spend.
  // With one or two packs, none is singled out.
  const bestId = list.length >= 3 ? [...list].sort((a, b) => a.price_inr - b.price_inr)[list.length - 2]?.id : undefined;

  return (
    <div>
      <PageHeader icon={CreditCard} title="Plan & billing" subtitle="Your credits, and packs to top up. Credits never expire." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="self-start lg:col-span-1">
          <h2 className="mb-1 font-semibold">{e?.credits ? "Your credits" : "This month"}</h2>
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
          {e && !e.credits ? (
            <Card>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Your plan includes its own monthly allowance, so you don't need credit packs.
              </p>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 pt-2 sm:grid-cols-2">
                <LoadGate loading={packs.loading && !packs.data} variant="card" count={2} label="Loading packs" className="sm:col-span-2">
                {packs.error ? (
                  <ErrorNote onRetry={packs.reload}>{errorText(packs.error)}</ErrorNote>
                ) : (
                  list.map((p) => <PackCard key={p.id} p={p} best={p.id === bestId} busy={starting} onBuy={(x) => void buy(x)} />)
                )}
                </LoadGate>
              </div>
              {buyError && <ErrorNote>{buyError}</ErrorNote>}
              {bought && (
                <p role="status" className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-800 dark:text-emerald-200">
                  {bought}
                </p>
              )}
              <p className="text-xs text-zinc-500">
                {list[0]?.checkout === "razorpay"
                  ? `Pay once by card, UPI, netbanking or wallet, through Razorpay. ${
                      list[0]?.international
                        ? "Cards from outside India work too: you're charged in rupees and your bank converts it."
                        : "Cards issued outside India can't be used yet; that's coming soon."
                    } Nothing renews, and the credits are added as soon as Razorpay confirms the payment, usually within seconds.`
                  : "Pay once over UPI (Google Pay, PhonePe, Paytm or any bank app). Nothing renews or is charged automatically, and the credits are added as soon as your payment is checked."}
              </p>
            </>
          )}
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
        </div>
      </div>
    </div>
  );
}
