import type { PlanId, Usage } from "@orbit/types";
import { Button, Card, ErrorNote, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const PLANS: Array<{ id: PlanId; name: string; features: string[] }> = [
  { id: "free", name: "Free", features: ["Trial live minutes", "Limited screenshots", "Resume + JD grounding"] },
  { id: "pro", name: "Pro", features: ["Monthly live minutes", "Documents library", "Coding copilot"] },
  { id: "unlimited", name: "Unlimited", features: ["High fair-use allowance", "Everything in Pro", "Priority models"] },
];

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

function UsageRows({ usage }: { usage: Usage }) {
  const rows = [
    { label: "Live minutes", used: Math.round(usage.live_minutes_used), limit: usage.live_minutes_limit },
    { label: "Screenshots", used: usage.screenshots_used, limit: usage.screenshots_limit },
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
    </div>
  );
}

export function UsageSummary() {
  const usage = useAsync(() => api.usage(), []);
  if (usage.loading) return <Spinner />;
  if (usage.error) return <ErrorNote onRetry={usage.reload}>{errorText(usage.error)}</ErrorNote>;
  if (!usage.data) return null;
  return <UsageRows usage={usage.data} />;
}

export function BillingPage() {
  const usage = useAsync(() => api.usage(), []);
  const current = usage.data?.plan ?? null;

  return (
    <div>
      <PageHeader title="Billing" subtitle="Your plan and this month’s usage." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="mb-1 font-semibold">This month</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Current plan: <span className="font-medium capitalize text-zinc-800 dark:text-zinc-200">{current ?? "—"}</span>
          </p>
          {usage.loading ? (
            <Spinner />
          ) : usage.error ? (
            <ErrorNote onRetry={usage.reload}>{errorText(usage.error)}</ErrorNote>
          ) : usage.data ? (
            <UsageRows usage={usage.data} />
          ) : null}
        </Card>

        <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
          {PLANS.map((p) => (
            <Card key={p.id} className={p.id === current ? "ring-2 ring-indigo-500" : undefined}>
              <h3 className="font-semibold">{p.name}</h3>
              <ul className="mt-3 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                {p.features.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
              <span className="mt-4 block" title={p.id === current ? undefined : "Payments aren’t enabled yet — coming with Stripe checkout."}>
                <Button variant={p.id === current ? "secondary" : "primary"} size="sm" disabled className="w-full">
                  {p.id === current ? "Current plan" : "Upgrade"}
                </Button>
              </span>
            </Card>
          ))}
          <p className="text-xs text-zinc-500 sm:col-span-3">
            Pricing is configured server-side. Checkout isn’t live yet, so no payment can be taken from this page.
          </p>
        </div>
      </div>
    </div>
  );
}
