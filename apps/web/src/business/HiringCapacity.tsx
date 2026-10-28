import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Callout, Field, Input, Select, buttonClass, focusRing } from "@orbit/ui";
import { downloadText } from "../lib/format";
import { PageTitle, useCompany } from "./BusinessApp";
import { capacity, type CapacityBrief } from "./capacityApi";
import { CAPACITY_SIGNALS, CAPACITY_STATES, capacityTotals, filterCapacity, type CapacityItem, type CapacitySnapshot } from "./capacityModel";
import { LoadError, Loading, Panel, Stat, errorText } from "./ui";

export function HiringCapacity() { const { company } = useCompany(); return <CapacityWorkspace key={company.id} />; }

function CapacityWorkspace() {
  const { company } = useCompany();
  const [data, setData] = useState<CapacitySnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("all");
  const [focus, setFocus] = useState<"delivery" | "budget">("delivery");
  const [brief, setBrief] = useState<CapacityBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const live = useRef(true);
  const locked = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const run = ++generation.current;
    const next = await capacity.list(company.id);
    if (live.current && run === generation.current) { setData(next); setError(null); }
    return next.version;
  }, [company.id]);
  useEffect(() => {
    live.current = true;
    if (company.role !== "interviewer") void refresh().catch((e: unknown) => { if (live.current) setError(new Error(errorText(e))); });
    const pending = generation; return () => { live.current = false; pending.current++; };
  }, [refresh, company.role]);
  const run = async (fn: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null); setResult("");
    try { await fn(); } catch (e) { if (live.current) setError(new Error(errorText(e))); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  const reload = () => void run(async () => { setBrief(null); await refresh(); });
  if (company.role === "interviewer") return <Callout>Hiring capacity is available to recruiting teams and request owners.</Callout>;
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading label="Loading hiring capacity" />;
  const totals = capacityTotals(data.items);
  const shown = filterCapacity(data.items, query, mode);
  const disabled = busy || company.status !== "active";
  const generate = () => void run(async () => {
    setBrief(null);
    const next = await capacity.brief(company.id, data.version, focus);
    const current = await refresh();
    if (current !== next.version) throw new Error("Capacity changed. Request a fresh brief from the updated view.");
    if (live.current) setBrief(next);
  });
  return <div className="space-y-6">
    <PageTitle title="Hiring capacity" subtitle="Follow approved positions through job handoff and current recorded hires." actions={<><Link to={`/business/app/${company.id}/requisitions`} className={buttonClass("secondary")}>Hiring requests</Link><Button variant="ghost" disabled={busy} onClick={reload}>Refresh capacity</Button></>} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Approved positions" value={totals.positions} detail="Approved and handed-off requests in view" /><Stat label="Recorded hires" value={totals.hired} detail="Current hired application records" /><Stat label="Known positions remaining" value={totals.remaining} detail={`${totals.unknown} request${totals.unknown === 1 ? " has" : "s have"} unknown fulfillment`} /><Stat label="Requests needing review" value={totals.attention} detail="Target dates, overages and job-link gaps" /></div>
    {data.truncated && <Callout>Showing up to 200 visible approved or handed-off requests, with enabled watches first, then newest requests. Counts, envelopes and AI cover that selection.</Callout>}
    {error && <LoadError error={error} />}{result && <p role="status" className="text-sm">{result}</p>}
    <Panel title="Approved annual cost envelopes" hint="Planned capacity at approved per-position budgets. These are not payroll costs, actual spend or savings; currencies are kept separate.">
      <div className="grid gap-3 sm:grid-cols-2">{data.envelopes.map(e => <div key={e.currency} className="min-w-0 rounded-xl bg-zinc-50 p-4 dark:bg-white/5"><p className="font-medium">{e.currency}</p><p className="mt-2 break-words text-sm">Approved: {e.approved_annual_envelope.toLocaleString()}</p><p className="mt-2 break-words text-sm">Known remaining capacity: {e.remaining_annual_envelope.toLocaleString()}</p>{e.unknown_remaining_requests > 0 && <p className="mt-2 text-xs">{e.unknown_remaining_requests} request(s) excluded from remaining envelope because fulfillment or budget is unknown.</p>}</div>)}</div>
      {!data.envelopes.length && <p className="text-sm">Approve a hiring request to start tracking capacity.</p>}
    </Panel>
    <Panel title="Position tracking" hint="Hiring managers see their own requests. Job counts also require current access to the linked job.">
      <div className="mb-4 flex flex-wrap gap-3"><Input aria-label="Search hiring capacity" className="sm:max-w-sm" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find title or department" /><Select aria-label="Capacity view" className="sm:max-w-xs" value={mode} onChange={e => setMode(e.target.value)}><option value="all">All requests in view</option><option value="attention">Needs review</option><option value="remaining">Known positions remaining</option><option value="watched">Alerts enabled</option></Select><Button variant="ghost" onClick={() => downloadText("orbit-hiring-capacity.json", JSON.stringify({ ...data, exported_at: new Date().toISOString() }, null, 2), "application/json")}>Download capacity snapshot</Button></div>
      <div className="space-y-3">{shown.map(row => <CapacityCard key={`${row.id}:${row.watch.revision}:${row.watch.owner_available}`} row={row} data={data} onChanged={refresh} />)}</div>
      {!shown.length && <p className="text-sm">No matching approved requests. Adjust the filters or complete an approval in Hiring requests.</p>}
    </Panel>
    <Panel title="AI capacity planning" hint="Quoted suggestions from up to eight request summaries, prioritizing the review queue. No candidate names, resumes or feedback are sent.">
      <div className="flex flex-wrap items-end gap-3"><Field label="Planning focus" htmlFor="capacity-focus"><Select id="capacity-focus" value={focus} disabled={busy} onChange={e => { setFocus(e.target.value as "delivery" | "budget"); setBrief(null); }}><option value="delivery">Delivery and handoff gaps</option><option value="budget">Budget assumptions</option></Select></Field><Button disabled={disabled || !data.facts.length} onClick={generate}>Prepare capacity brief</Button></div>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Ten capacity-brief attempts per company per UTC day, including failures. AI uses the configured provider and cannot approve requests, change budgets, hire candidates or close jobs.</p>
      {brief?.version === data.version && <div className="mt-4 space-y-3"><h3 className="font-semibold">{brief.source === "mock" ? "Test capacity brief · no AI model called" : "AI capacity brief"}</h3><ul className="space-y-3">{brief.tips.map(t => <li key={t.fact_id} className="min-w-0 rounded-xl bg-zinc-50 p-4 text-sm dark:bg-white/5"><p className="break-words">{t.suggestion}</p><blockquote className="mt-3 break-words border-l-2 border-indigo-400 pl-3 text-xs">{t.source_quote}</blockquote><p className="mt-3 break-words text-xs">Check: {t.success_check}</p><details className="mt-3 text-xs"><summary>Read source summary</summary><p className="mt-2 break-words">{brief.facts.find(f => f.id === t.fact_id)?.text}</p></details></li>)}</ul><Button variant="secondary" onClick={() => downloadText("orbit-capacity-brief.json", JSON.stringify(brief, null, 2), "application/json")}>Download capacity brief</Button></div>}
    </Panel>
    {data.can_manage && <Panel title="Internal capacity alerts" hint="Opt in per request below. Enabled watches are checked about every five minutes while the API runs; reminders stay inside Orbit."><Button disabled={disabled} onClick={() => void run(async () => { const next = await capacity.run(company.id); if (live.current) { setResult(`${next.created} new internal capacity alerts. ${next.unavailable_owner} watches have an unavailable owner.`); await refresh(); } })}>Run opted-in capacity alerts</Button></Panel>}
    <p className="text-xs text-zinc-500 dark:text-zinc-400">As of {data.as_of} UTC. Recorded hires include only currently hired, email-confirmed applications without deletion requests. Reopened, withdrawn or deleted records leave the count. Accepted offers are not hires. This view covers linked requests, not employee headcount or unlinked jobs.</p>
  </div>;
}

function CapacityCard({ row, data, onChanged }: { row: CapacityItem; data: CapacitySnapshot; onChanged: () => Promise<string> }) {
  const { company } = useCompany();
  const [enabled, setEnabled] = useState(row.watch.enabled);
  const [owner, setOwner] = useState(row.watch.owner_available ? row.watch.owner_id ?? "" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const live = useRef(true);
  const locked = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const save = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try { await capacity.watch(company.id, row.id, { enabled, owner_id: owner || null }, row.watch.revision); if (live.current) await onChanged(); }
    catch (e) { if (live.current) setError(new Error(errorText(e))); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  return <article className="min-w-0 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold">{row.title}</h3><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{CAPACITY_STATES[row.state] ?? row.state} · {row.department || "No department"}</p></div><Link className={buttonClass("secondary", "sm")} to={`/business/app/${company.id}/requisitions?request=${row.id}`}>Open request</Link></div>
    <p className="mt-3 text-sm">{row.positions} approved · {row.hired ?? "Unknown"} recorded hires · {row.remaining ?? "Unknown"} remaining</p><p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{row.active ?? "Unknown"} active confirmed applications · Target: {row.target_date || "Not set"}{row.overage ? ` · ${row.overage} above approved positions` : ""}</p>
    {row.signals.length > 0 && <ul className="mt-3 flex flex-wrap gap-2 text-xs">{row.signals.map(s => <li key={s} className="rounded-lg bg-amber-100 px-2 py-1 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">{CAPACITY_SIGNALS[s] ?? s}</li>)}</ul>}
    {row.job_id && <Link className={`mt-3 inline-block rounded text-sm underline ${focusRing}`} to={`/business/app/${company.id}/jobs/${row.job_id}`}>Review linked pipeline</Link>}
    {data.can_manage && <details className="mt-4"><summary className="text-sm font-medium">Capacity alert settings</summary><div className="mt-4 space-y-3"><Field label="Alert owner" htmlFor={`capacity-owner-${row.id}`} hint="Assignment identifies responsibility; it does not grant access."><Select id={`capacity-owner-${row.id}`} disabled={busy || company.status !== "active"} value={owner} onChange={e => setOwner(e.target.value)}><option value="">Unassigned</option>{data.owners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className={focusRing} checked={enabled} disabled={busy || company.status !== "active"} onChange={e => setEnabled(e.target.checked)} />Enable internal capacity alerts</label>{row.watch.enabled && !row.watch.owner_available && <Callout>Assign a current active owner/admin to resume alerts.</Callout>}{error && <LoadError error={error} />}<Button variant="secondary" disabled={busy || company.status !== "active" || (enabled && !owner)} onClick={() => void save()}>Save capacity alert</Button><p className="text-xs text-zinc-500 dark:text-zinc-400">One alert per signal episode, deduplicated across runs. A healthy reconciliation resets the episode. Up to 100 enabled watches per company. No emails or automatic hiring changes.</p></div></details>}
  </article>;
}
