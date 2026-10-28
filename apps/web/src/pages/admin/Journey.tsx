import { useState } from "react";
import type { AdminJourney } from "@orbit/types";
import { Badge, CircleCheck, Circle, LoadGate, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { day, when } from "./shared";

type Filter = "all" | "page" | "action" | "error";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "page", label: "Pages" },
  { id: "action", label: "Steps" },
  { id: "error", label: "Errors" },
];

const SOURCE_FIELDS: Array<[string, string]> = [
  ["referrer", "Came from"],
  ["utm_source", "Campaign source"],
  ["utm_medium", "Medium"],
  ["utm_campaign", "Campaign"],
  ["ref", "Code"],
  ["landing", "First page"],
];

/** One account's journey: where it came from, how far it got (and where it stopped), and what it did lately. */
export function Journey({ userId }: { userId: string }) {
  const journey = useAsync(() => api.adminJourney(userId), [userId], `admin-journey-${userId}`);
  if (journey.error) return <p className="text-sm text-rose-600">{errorText(journey.error)}</p>;
  if (!journey.data) return <LoadGate loading variant="card" count={1} label="Loading the journey">{null}</LoadGate>;
  return <JourneyView j={journey.data} />;
}

export function JourneyView({ j }: { j: AdminJourney }) {
  const [filter, setFilter] = useState<Filter>("all");
  const events = j.timeline.filter((e) => filter === "all" || e.kind === filter);
  const phone = j.devices.find((d) => d.name === "phone")?.count ?? 0;
  const views = j.devices.reduce((n, d) => n + d.count, 0);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {j.stuck_at ? <Badge tone="warning">Stopped before: {j.stuck_at}</Badge> : <Badge tone="success">Every step done</Badge>}
        <Badge>From {j.source_label}</Badge>
        <span className="text-zinc-600 dark:text-zinc-400">
          {j.last_seen ? `Last seen ${when(j.last_seen)}` : "Not seen in the app yet"} · active {j.active_days_30} of the last 30 days
          {views > 0 && ` · ${Math.round((phone / views) * 100)}% on a phone`}
          {j.errors_30 > 0 && ` · ${j.errors_30} error${j.errors_30 === 1 ? "" : "s"} seen`}
        </span>
      </div>

      <ol aria-label="Journey steps" className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {j.steps.map((s) => (
          <li key={s.key} className={cx("flex items-center gap-2", !s.done_at && "text-zinc-500 dark:text-zinc-400")}>
            {s.done_at ? <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <Circle className="h-4 w-4 shrink-0" aria-hidden />}
            <span className="min-w-0 flex-1">{s.label}</span>
            <span className="shrink-0 text-xs tabular-nums">{s.done_at ? day(s.done_at) : <span className="sr-only">not yet</span>}</span>
          </li>
        ))}
      </ol>

      {j.source ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-zinc-50 p-3 text-xs dark:bg-white/[0.03]">
          {SOURCE_FIELDS.filter(([k]) => j.source?.[k]).map(([k, label]) => (
            <div key={k} className="contents">
              <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
              <dd className="min-w-0 break-words">{j.source?.[k]}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">No source recorded (signed up before this was kept, or from a device that blocks storage).</p>
      )}

      {j.top_pages.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Most opened, last 30 days</h4>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {j.top_pages.map((p) => (
              <li key={p.name} className="rounded-lg bg-zinc-100 px-2 py-1 text-xs dark:bg-white/5">
                <code>{p.name}</code> <span className="tabular-nums text-zinc-500">×{p.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">What they did</h4>
          <div role="group" aria-label="Show" className="flex gap-1">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
                      className={cx("rounded-lg px-2 py-1 text-xs", filter === f.id ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5", focusRing)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {events.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-2 max-h-80 divide-y divide-zinc-200 overflow-y-auto rounded-xl border border-zinc-200 dark:divide-white/10 dark:border-white/10">
            {events.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex items-start gap-3 px-3 py-2 text-xs">
                <span className="w-24 shrink-0 tabular-nums text-zinc-500">{when(e.at)}</span>
                <span className="min-w-0 flex-1">
                  <span className={cx("font-medium", e.kind === "error" && "text-rose-700 dark:text-rose-300")}>
                    {e.kind === "error" ? "Error: " : e.kind === "action" ? "Step: " : ""}{e.name}
                  </span>
                  {e.detail && e.detail !== e.name && <span className="block text-zinc-600 dark:text-zinc-400">{e.detail}</span>}
                  <span className="block text-zinc-500"><code>{e.path}</code>{e.device && ` · ${e.device}`}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
