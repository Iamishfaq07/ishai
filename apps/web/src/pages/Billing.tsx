import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CreditCard, Crown, Mic, Sparkles, cx, focusRing } from "@orbit/ui";
import type { CreditPack, Entitlements, UpiOrder } from "@orbit/types";
import { Button, Card, ErrorNote, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { errorText, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { RESUME_AI_HOME } from "./resume/paths";
import { UpiCheckout } from "./UpiCheckout";

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

function minutes(n: number): string {
  return `${Math.round(n)} min`;
}

/** The credits left on a Free account: resume AI and interview minutes (live and mock share them). */
function CreditRows({ e }: { e: Entitlements }) {
  const c = e.credits;
  if (!c) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
          <Mic className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex justify-between text-sm">
            <span>Interview minutes</span>
            <span className="tabular-nums font-medium">{minutes(c.interview_minutes_left)} left</span>
          </div>
          <p className="text-xs text-zinc-500">Live interviews and mock interviews both use these.</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex justify-between text-sm">
            <span>Resume AI credits</span>
            <span className="tabular-nums font-medium">{c.resume === null ? "unlimited" : `${c.resume} left`}</span>
          </div>
          <p className="text-xs text-zinc-500">
            One per AI action in{" "}
            <Link to={RESUME_AI_HOME} className={cx("font-medium text-indigo-600 hover:underline dark:text-indigo-300", focusRing)}>
              Resume AI
            </Link>
            : an import, rewrite, tailoring, cover letter, profile or message.
          </p>
        </div>
      </div>
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
    <Card className={cx("relative flex flex-col", best ? "ring-2 ring-amber-500/70" : "ring-1 ring-zinc-500/10")}>
      {best && (
        <span className="absolute -top-2.5 left-4 rounded-full bg-amber-500 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-white">
          Best value
        </span>
      )}
      <h3 className="flex items-center gap-1.5 font-semibold">
        <Crown className="h-4 w-4 text-amber-500" /> {p.label}
      </h3>
      <p className="mt-1 font-display text-2xl font-semibold">₹{p.price_inr.toLocaleString("en-IN")}</p>
      <ul className="mt-3 flex-1 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        {p.interview_minutes > 0 && <li>· {p.interview_minutes} interview minutes (live or mock)</li>}
        {p.resume_credits > 0 && <li>· {p.resume_credits} Resume AI credits</li>}
        <li>· Never expire, no subscription</li>
        {perMinute && <li className="text-xs text-zinc-500">≈ ₹{perMinute.toFixed(perMinute < 10 ? 1 : 0)} per interview minute</li>}
      </ul>
      <Button className="mt-4 w-full" disabled={busy || !p.buyable} onClick={() => onBuy(p)} title={p.buyable ? undefined : "UPI payments aren't set up yet"}>
        Buy · ₹{p.price_inr.toLocaleString("en-IN")}
      </Button>
    </Card>
  );
}

const STATUS: Record<UpiOrder["status"], { label: string; tone: string }> = {
  awaiting_payment: { label: "Not paid yet", tone: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300" },
  submitted: { label: "Checking your payment", tone: "bg-amber-500/10 text-amber-800 dark:text-amber-200" },
  approved: { label: "Paid · credits added", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  rejected: { label: "Couldn't confirm", tone: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
};

/** Payments with a UTR (orders nobody paid for aren't worth listing), with a way back in to fix a UTR. */
function Payments({ orders, onOpen }: { orders: UpiOrder[]; onOpen: (o: UpiOrder) => void }) {
  const shown = orders.filter((o) => o.status !== "awaiting_payment");
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
            <span className="tabular-nums text-zinc-500">UTR {o.utr}</span>
            <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS[o.status].tone)}>{STATUS[o.status].label}</span>
            {(o.status === "rejected" || o.status === "submitted") && (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onOpen(o)}>
                {o.status === "rejected" ? "Send the right UTR" : "Correct the UTR"}
              </Button>
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
  if (ent.loading) return <Spinner />;
  if (ent.error) return <ErrorNote onRetry={ent.reload}>{errorText(ent.error)}</ErrorNote>;
  if (!ent.data) return null;
  return ent.data.credits ? <CreditRows e={ent.data} /> : <UsageRows e={ent.data} />;
}

export function BillingPage() {
  const ent = useAsync(() => api.entitlements(), [], "entitlements");
  const packs = useAsync(() => api.listPacks(), [], "packs");
  const orders = useAsync(() => api.listUpiOrders().catch(() => [] as UpiOrder[]), [], "upi-orders");
  const [params, setParams] = useSearchParams();
  const [order, setOrder] = useState<UpiOrder | null>(null);
  const [starting, setStarting] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const checkoutRef = useRef<HTMLDivElement>(null);

  const buy = async (p: CreditPack) => {
    setStarting(true);
    setBuyError(null);
    try {
      setOrder(await api.createUpiOrder(p.id));
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

  useEffect(() => {
    if (order) checkoutRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const e = ent.data;
  const list = packs.data ?? [];
  // The middle pack is the usual pick; with one or two, none is singled out.
  const bestId = list.length >= 3 ? [...list].sort((a, b) => a.price_inr - b.price_inr)[1]?.id : undefined;

  return (
    <div>
      <PageHeader icon={CreditCard} title="Plan & billing" subtitle="Your credits, and packs to top up. Credits never expire." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="mb-1 font-semibold">{e?.credits ? "Your credits" : "This month"}</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Plan: <span className="font-medium text-zinc-800 dark:text-zinc-200">{e?.label ?? "—"}</span>
            {e?.until && (
              <span className="block">
                Until {new Date(e.until).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric" })}
              </span>
            )}
          </p>
          {ent.loading ? (
            <Spinner />
          ) : ent.error ? (
            <ErrorNote onRetry={ent.reload}>{errorText(ent.error)}</ErrorNote>
          ) : e ? (
            e.credits ? <CreditRows e={e} /> : <UsageRows e={e} />
          ) : null}
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
              <div className="grid gap-4 pt-2 sm:grid-cols-3">
                {packs.loading ? (
                  <Spinner />
                ) : packs.error ? (
                  <ErrorNote onRetry={packs.reload}>{errorText(packs.error)}</ErrorNote>
                ) : (
                  list.map((p) => <PackCard key={p.id} p={p} best={p.id === bestId} busy={starting} onBuy={(x) => void buy(x)} />)
                )}
              </div>
              {buyError && <ErrorNote>{buyError}</ErrorNote>}
              <p className="text-xs text-zinc-500">
                Pay once over UPI (Google Pay, PhonePe, Paytm or any bank app). Nothing renews or is charged automatically,
                and the credits are added as soon as your payment is checked.
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
