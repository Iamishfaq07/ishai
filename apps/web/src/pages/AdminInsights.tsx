import { useState, type ReactNode } from "react";
import type { AdminInsights } from "@orbit/types";
import { ChartColumn, LoadGate, THead, Table, Th, Tr } from "@orbit/ui";
import { ErrorNote, PageHeader, Select } from "../components/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { AdminTabs, count } from "./admin/shared";

const PERIODS = [7, 30, 90] as const;
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");

/**
 * Admin: where candidates come from, how far they get and where they stop (everyone who signed up in the period),
 * and, for everyone active in it, the pages they use and the errors they hit. One account's own journey is in its
 * panel on Users.
 */
export function AdminInsightsPage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const data = useAsync(() => api.adminInsights(days), [days], `admin-insights-${days}`);
  return (
    <>
      <PageHeader title="Insights" subtitle="Where candidates come from, how far they get and where they stop." icon={ChartColumn} />
      <AdminTabs />
      <div className="mt-6 flex items-center gap-2">
        <label htmlFor="insights-days" className="shrink-0 text-sm text-zinc-600 dark:text-zinc-400">Sign-ups in the last</label>
        <div className="w-36">
          <Select id="insights-days" value={String(days)} onChange={(e) => setDays(Number(e.target.value) as (typeof PERIODS)[number])}>
            {PERIODS.map((d) => <option key={d} value={d}>{d} days</option>)}
          </Select>
        </div>
      </div>
      {data.error && !data.data ? (
        <div className="mt-6"><ErrorNote onRetry={data.reload}>{errorText(data.error)}</ErrorNote></div>
      ) : !data.data ? (
        <div className="mt-6"><LoadGate loading variant="card" count={3} label="Loading insights">{null}</LoadGate></div>
      ) : (
        <Report r={data.data} />
      )}
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{note}</p>}
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-white/10 dark:bg-zinc-900">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Report({ r }: { r: AdminInsights }) {
  const top = r.funnel[0]?.count ?? 0;
  const stops = [...r.funnel].filter((f) => f.stuck > 0).sort((a, b) => b.stuck - a.stuck);
  const phone = r.devices.find((d) => d.name === "phone")?.count ?? 0;
  const devices = r.devices.reduce((n, d) => n + d.count, 0);
  return (
    <div className="mt-6 space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Signed up" value={count(r.signups)} note={`last ${r.days} days`} />
        <Stat label="Active today" value={count(r.active_1)} />
        <Stat label="Active this week" value={count(r.active_7)} />
        <Stat label="On a phone" value={pct(phone, devices)} note="of people active in the period" />
      </div>

      <Panel title="How far they get" hint={`Of the ${count(r.signups)} who signed up in the last ${r.days} days: how many have done each step, and how many stopped right before it.`}>
        <ol className="space-y-2.5">
          {r.funnel.map((f) => (
            <li key={f.key} className="grid grid-cols-[minmax(8rem,12rem)_1fr_auto] items-center gap-3 text-sm">
              <span>{f.label}</span>
              <span className="h-2.5 rounded bg-zinc-100 dark:bg-white/5" aria-hidden>
                <span className="block h-full rounded bg-emerald-600 dark:bg-emerald-400" style={{ width: top ? `${(f.count / top) * 100}%` : 0 }} />
              </span>
              <span className="w-36 text-right tabular-nums">
                {count(f.count)} <span className="text-zinc-500">({pct(f.count, top)})</span>
                {f.stuck > 0 && <span className="block text-xs text-amber-700 dark:text-amber-300">{count(f.stuck)} stopped here</span>}
              </span>
            </li>
          ))}
        </ol>
        {stops[0] && (
          <p className="mt-4 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
            Most people stop before <strong>{stops[0].label.toLowerCase()}</strong> ({count(stops[0].stuck)} of {count(r.signups)}).
          </p>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Where they come from" hint="The link's campaign source, else the site that linked to Orbit. “direct”: typed or bookmarked.">
          {r.sources.length === 0 ? <p className="text-sm text-zinc-500">No sign-ups in this period.</p> : (
            <Table>
              <THead><Tr><Th>Source</Th><Th className="text-right">Signed up</Th><Th className="text-right">Added a resume</Th><Th className="text-right">Paid</Th></Tr></THead>
              <tbody>
                {r.sources.map((s) => (
                  <Tr key={s.source}>
                    <td className="py-2 pr-3">{s.source}</td>
                    <td className="py-2 text-right tabular-nums">{count(s.signups)}</td>
                    <td className="py-2 text-right tabular-nums">{pct(s.resume, s.signups)}</td>
                    <td className="py-2 text-right tabular-nums">{count(s.paid)}</td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel title="Errors people hit" hint="Messages shown to people in the period, by page. Each one counts once a minute per person.">
          {r.errors.length === 0 ? <p className="text-sm text-zinc-500">No errors shown in this period.</p> : (
            <ul className="divide-y divide-zinc-200 text-sm dark:divide-white/10">
              {r.errors.map((e) => (
                <li key={`${e.name}-${e.path}`} className="flex items-start justify-between gap-3 py-2">
                  <span className="min-w-0"><span className="block">{e.name}</span><code className="text-xs text-zinc-500">{e.path}</code></span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400">{count(e.count)} times<br />{count(e.people)} {e.people === 1 ? "person" : "people"}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Pages people use" hint="By how many people opened each, in the period.">
        {r.top_pages.length === 0 ? <p className="text-sm text-zinc-500">Nothing recorded yet.</p> : (
          <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {r.top_pages.map((p) => (
              <li key={p.name} className="flex justify-between gap-3"><code className="min-w-0 truncate">{p.name}</code><span className="tabular-nums text-zinc-600 dark:text-zinc-400">{count(p.count)}</span></li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
