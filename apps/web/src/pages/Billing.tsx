import { CreditCard, cx } from "@orbit/ui";
import type { Entitlements, PlanInfo } from "@orbit/types";
import { Card, ErrorNote, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";

/** Human copy for server feature names. Unknown names are skipped rather than shown raw. */
const FEATURE_COPY: Record<string, string> = {
  vision: "Screenshot answers",
  mock: "Mock interviews",
  advanced_coding: "Advanced coding help",
  system_design: "System design mode",
  provider_fallback: "Backup AI when the main one is down",
};

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

function PlanCard({ p, current }: { p: PlanInfo; current: string | null }) {
  const features = p.features.map((f) => FEATURE_COPY[f]).filter((f): f is string => Boolean(f));
  return (
    <Card className={p.name === current ? "ring-2 ring-indigo-500" : undefined}>
      <h3 className="font-semibold">{p.label}</h3>
      <p className="mt-1 text-sm text-zinc-500">
        {p.price_usd_month === null ? "Pricing coming soon" : p.price_usd_month === 0 ? "Free" : `$${p.price_usd_month} / month`}
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-400">
        <li>· {limitLine(p.live_minutes, "live minutes / month")}</li>
        <li>· {limitLine(p.mock_minutes, "mock minutes / month")}</li>
        <li>· {limitLine(p.screenshots, "screenshots / month")}</li>
        <li>· {limitLine(p.documents, "documents")}</li>
        <li>· Sessions up to {p.max_session_minutes} min</li>
        {features.map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
      {/* Checkout isn't live yet: a status label, not a greyed-out button that looks broken. */}
      <p
        className={cx(
          "mt-4 rounded-xl px-3 py-2 text-center text-xs font-medium",
          p.name === current
            ? "bg-indigo-500/10 text-indigo-700 ring-1 ring-indigo-500/25 dark:text-indigo-200"
            : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
        )}
      >
        {p.name === current ? "Your current plan" : "Upgrades coming soon"}
      </p>
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
  const current = ent.data?.plan ?? null;

  return (
    <div>
      <PageHeader icon={CreditCard} title="Plan & billing" subtitle="Your plan and this month’s usage." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="mb-1 font-semibold">This month</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Current plan: <span className="font-medium text-zinc-800 dark:text-zinc-200">{ent.data?.label ?? "—"}</span>
          </p>
          {ent.loading ? (
            <Spinner />
          ) : ent.error ? (
            <ErrorNote onRetry={ent.reload}>{errorText(ent.error)}</ErrorNote>
          ) : ent.data ? (
            <UsageRows e={ent.data} />
          ) : null}
        </Card>

        <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
          {plans.loading ? (
            <Spinner />
          ) : plans.error ? (
            <ErrorNote onRetry={plans.reload}>{errorText(plans.error)}</ErrorNote>
          ) : (
            (plans.data ?? []).map((p) => <PlanCard key={p.name} p={p} current={current} />)
          )}
          <p className="text-xs text-zinc-500 sm:col-span-3">
            Paid plans open soon. Until then nothing can be bought here, and you won’t be charged.
          </p>
        </div>
      </div>
    </div>
  );
}
