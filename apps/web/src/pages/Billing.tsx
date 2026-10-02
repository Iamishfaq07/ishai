import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CreditCard, Crown, cx } from "@orbit/ui";
import type { Entitlements, PlanInfo, UpiOrder } from "@orbit/types";
import { Button, Card, ErrorNote, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { errorText, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { UpiCheckout } from "./UpiCheckout";

/** Human copy for server feature names. Unknown names are skipped rather than shown raw. */
const FEATURE_COPY: Record<string, string> = {
  vision: "Screenshot answers",
  mock: "Mock interviews",
  advanced_coding: "Advanced coding help",
  system_design: "System design mode",
  provider_fallback: "Backup AI when the main one is down",
};
const RESUME_AI = "Unlimited resume AI: rewrites, tailoring, imports, cover letters";

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

function limitLine(n: number | null, unit: string): string {
  return n === null ? `Unlimited ${unit}` : `${n} ${unit}`;
}

function priceLine(p: PlanInfo): string {
  if (p.price_inr_month) return `₹${p.price_inr_month} / month`;
  if (p.price_inr_month === 0 || p.price_usd_month === 0) return "Free";
  if (p.price_usd_month) return `$${p.price_usd_month} / month`;
  return "Pricing coming soon";
}

function PlanCard({ p, current, busy, onBuy }: { p: PlanInfo; current: string | null; busy: boolean; onBuy: (p: PlanInfo) => void }) {
  const features = p.features.map((f) => FEATURE_COPY[f]).filter((f): f is string => Boolean(f));
  const mine = p.name === current;
  const free = p.price_inr_month === 0 || p.price_usd_month === 0;
  return (
    <Card className={cx("flex flex-col", mine ? "ring-2 ring-indigo-500" : p.buyable ? "ring-1 ring-amber-500/40" : undefined)}>
      <h3 className="flex items-center gap-1.5 font-semibold">
        {p.buyable && <Crown className="h-4 w-4 text-amber-500" />}
        {p.label}
      </h3>
      <p className="mt-1 text-sm text-zinc-500">{priceLine(p)}</p>
      <ul className="mt-3 flex-1 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        <li className={p.features.includes("resume_ai") ? "font-medium text-zinc-800 dark:text-zinc-200" : undefined}>
          · {p.features.includes("resume_ai") ? RESUME_AI : "1 free resume AI edit"}
        </li>
        <li>· {limitLine(p.live_minutes, "live minutes / month")}</li>
        <li>· {limitLine(p.mock_minutes, "mock minutes / month")}</li>
        <li>· {limitLine(p.screenshots, "screenshots / month")}</li>
        <li>· {limitLine(p.documents, "documents")}</li>
        <li>· Sessions up to {p.max_session_minutes} min</li>
        {features.map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
      {p.buyable ? (
        <Button className="mt-4 w-full" disabled={busy} onClick={() => onBuy(p)}>
          <Crown className="h-4 w-4" /> {mine ? `Add 30 days · ₹${p.price_inr_month}` : `Upgrade · ₹${p.price_inr_month}`}
        </Button>
      ) : (
        <p
          className={cx(
            "mt-4 rounded-xl px-3 py-2 text-center text-xs font-medium",
            mine
              ? "bg-indigo-500/10 text-indigo-700 ring-1 ring-indigo-500/25 dark:text-indigo-200"
              : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
          )}
        >
          {mine ? "Your current plan" : free ? "Included" : "Upgrades coming soon"}
        </p>
      )}
    </Card>
  );
}

const STATUS: Record<UpiOrder["status"], { label: string; tone: string }> = {
  awaiting_payment: { label: "Not paid yet", tone: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300" },
  submitted: { label: "Checking your payment", tone: "bg-amber-500/10 text-amber-800 dark:text-amber-200" },
  approved: { label: "Paid", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
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
              {o.plan_label} · ₹{o.amount_inr}
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

export function UsageSummary() {
  const ent = useAsync(() => api.entitlements(), [], "entitlements");
  if (ent.loading) return <Spinner />;
  if (ent.error) return <ErrorNote onRetry={ent.reload}>{errorText(ent.error)}</ErrorNote>;
  if (!ent.data) return null;
  return <UsageRows e={ent.data} />;
}

export function BillingPage() {
  const ent = useAsync(() => api.entitlements(), [], "entitlements");
  const plans = useAsync(() => api.listPlans(), [], "plans");
  const orders = useAsync(() => api.listUpiOrders().catch(() => [] as UpiOrder[]), [], "upi-orders");
  const current = ent.data?.plan ?? null;
  const [params, setParams] = useSearchParams();
  const [order, setOrder] = useState<UpiOrder | null>(null);
  const [starting, setStarting] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const checkoutRef = useRef<HTMLDivElement>(null);

  const buy = async (p: PlanInfo) => {
    setStarting(true);
    setBuyError(null);
    try {
      setOrder(await api.createUpiOrder(p.name));
    } catch (err) {
      setBuyError(errorText(err));
    } finally {
      setStarting(false);
    }
  };

  // Arriving from "Upgrade" in the resume maker (/billing?plan=resume_pro): open that plan's checkout straight away.
  const wanted = params.get("plan");
  useEffect(() => {
    if (!wanted || !plans.data) return;
    const p = plans.data.find((x) => x.name === wanted && x.buyable);
    setParams({}, { replace: true });
    if (p) void buy(p);
  }, [wanted, plans.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (order) checkoutRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader icon={CreditCard} title="Plan & billing" subtitle="Your plan, this month’s usage, and upgrades." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="mb-1 font-semibold">This month</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Current plan: <span className="font-medium text-zinc-800 dark:text-zinc-200">{ent.data?.label ?? "—"}</span>
            {ent.data?.until && (
              <span className="block">
                Until {new Date(ent.data.until).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric" })}
              </span>
            )}
          </p>
          {ent.loading ? (
            <Spinner />
          ) : ent.error ? (
            <ErrorNote onRetry={ent.reload}>{errorText(ent.error)}</ErrorNote>
          ) : ent.data ? (
            <UsageRows e={ent.data} />
          ) : null}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            {plans.loading ? (
              <Spinner />
            ) : plans.error ? (
              <ErrorNote onRetry={plans.reload}>{errorText(plans.error)}</ErrorNote>
            ) : (
              (plans.data ?? []).map((p) => <PlanCard key={p.name} p={p} current={current} busy={starting} onBuy={(x) => void buy(x)} />)
            )}
          </div>
          {buyError && <ErrorNote>{buyError}</ErrorNote>}
          <p className="text-xs text-zinc-500">
            Paid over UPI, 30 days at a time. Nothing renews or is charged automatically: when the 30 days end you're back
            on Free, and you can buy another month whenever you like.
          </p>
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
