import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, Button, Callout, Field, Input, cx, focusRing } from "@orbit/ui";
import { WorkspaceHero, WorkflowAdvice, type WorkflowFact } from "../../components/WorkflowWorkspace";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";

interface Targets { applications: number; practice: number; contacts: number }
interface Metric extends WorkflowFact { count: number; target: number }
interface Week { week_start: string; week_end: string; revision: number; targets: Targets; metrics: Metric[]; days: { day: string; count: number }[]; version: string }
const LABELS: Record<keyof Targets, string> = { applications: "Applications", practice: "Mock interviews", contacts: "Contacts reached" };
const LIMITS = { applications: 100, practice: 30, contacts: 50 };

export function WeeklyStudioPage() {
  const [week, setWeek] = useState<Week | null>(null);
  const [draft, setDraft] = useState<Targets | null>(null);
  const [editingRevision, setEditingRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    const next = await api.call<Week>("/v1/jobs/weekly");
    if (mounted.current) { setWeek(next); setError(null); }
    return next.version;
  }, []);
  useEffect(() => {
    mounted.current = true;
    const reload = () => {
      if (document.visibilityState !== "hidden") void refresh().catch((e: unknown) => { if (mounted.current) setError(errorText(e)); });
    };
    reload();
    const timer = window.setInterval(reload, 60_000);
    window.addEventListener("focus", reload);
    return () => { mounted.current = false; window.clearInterval(timer); window.removeEventListener("focus", reload); };
  }, [refresh]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!draft) return;
    setBusy(true); setError(null);
    try {
      const next = await api.call<Week>("/v1/jobs/weekly/targets", { method: "PUT", body: JSON.stringify({ ...draft, base_revision: editingRevision }) });
      setWeek(next); setDraft(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await refresh().catch(() => undefined);
        setError("Your targets changed elsewhere. Your draft is still here. Cancel it and reopen targets to edit the latest version.");
      } else setError(errorText(e));
    }
    finally { setBusy(false); }
  };
  return <div className="space-y-6">
    <WorkspaceHero eyebrow="Personal growth, measured honestly" title="Your weekly studio"
      description="Choose a sustainable rhythm. Orbit counts saved applications, completed mock interviews and contacts you have reached, so your plan stays connected to real activity."
      labels={["Applications", "Practice", "Relationships"]} />
    {error && <Callout tone="error">{error}</Callout>}
    {!week ? <div role="status" className="flex items-center gap-3"><p>Opening your weekly plan…</p><Button variant="secondary" onClick={() => void refresh().catch((e: unknown) => setError(errorText(e)))}>Retry</Button></div> : <>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Week of {week.week_start}</h2>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Monday to Sunday in UTC · goals carry forward; progress starts fresh each week.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || Boolean(draft)} onClick={() => { setDraft({ ...week.targets }); setEditingRevision(week.revision); }}>Set my weekly targets</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void refresh().catch((e: unknown) => setError(errorText(e)))}>Refresh progress</Button></div></div>
      {draft && <form onSubmit={(e) => void save(e)} className="space-y-4 rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
        <h3 className="font-semibold">Make the week manageable</h3><p className="text-xs text-zinc-600 dark:text-zinc-400">Set a target to zero to pause that goal. Goals measure activity, not your likelihood of being hired.</p>
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3">{(Object.keys(LABELS) as (keyof Targets)[]).map((key) => <Field key={key} htmlFor={`weekly-${key}`} label={LABELS[key]}>
          <Input id={`weekly-${key}`} type="number" min={0} max={LIMITS[key]} required value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })} />
        </Field>)}</fieldset>
        <div className="flex gap-2"><Button type="submit" loading={busy}>Save weekly targets</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button></div>
      </form>}
      <div className="grid gap-4 sm:grid-cols-3">{week.metrics.map((metric) => <section key={metric.id} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-zinc-900">
        <h3 className="text-sm font-medium">{metric.label}</h3><p className="text-3xl font-semibold tabular-nums">{metric.count}<span className="text-sm font-normal text-zinc-500 dark:text-zinc-400"> / {metric.target === 0 ? "paused" : metric.target}</span></p>
        <div role="progressbar" aria-label={metric.label} aria-valuemin={0} aria-valuemax={Math.max(metric.count, metric.target, 1)} aria-valuenow={metric.count}
          aria-valuetext={metric.target ? `${metric.count} recorded, target ${metric.target}` : `${metric.count} recorded, goal paused`}
          className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10"><div className="h-full rounded-full bg-indigo-600 transition-[width] motion-reduce:transition-none" style={{ width: `${metric.target ? Math.min(100, metric.count / metric.target * 100) : 0}%` }} /></div>
        <Link to={metric.path} className={cx("inline-block rounded text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300", focusRing)}>Open workspace</Link>
      </section>)}</div>
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-zinc-900" aria-label="Weekly activity rhythm">
        <h3 className="font-semibold">Your activity rhythm</h3><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Saved records across the three goals. Contact activity uses each person's most recent contact date.</p>
        <ol className="mt-4 grid grid-cols-7 gap-2">{week.days.map((day) => <li key={day.day} className="rounded-lg bg-zinc-100 p-2 text-center dark:bg-white/5">
          <span className="block text-xs text-zinc-600 dark:text-zinc-400">{new Date(`${day.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}</span>
          <strong className="mt-2 block tabular-nums">{day.count}</strong><span className="sr-only"> records on {day.day}</span>
        </li>)}</ol>
      </section>
      <WorkflowAdvice endpoint="/v1/jobs/weekly/coach" version={week.version} facts={week.metrics} allowance="5 coaching attempts per day, UTC" onRefresh={refresh} disabled={busy || Boolean(draft)} />
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Application progress uses your saved applied date, including manual records. Practice counts ended mock interviews; live copilot sessions do not count. Contacts counts people, not messages. Nothing here sends applications or outreach.</p>
    </>}
  </div>;
}
