import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { JobTrackerEntry, PlanItem, PrepPlan } from "@orbit/types";
import { ArrowRight, Button, CalendarIcon, Check, LoadGate, cx, focusRing, toast } from "@orbit/ui";
import { Card, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { JOBS_TRACKER, missionPath } from "./paths";
import { dayLabel, localToday, planItemLink } from "./plan";

const Coach = lazy(() => import("./GuidedOpportunity").then((m) => ({ default: m.OpportunityCoach })));
const link = cx("inline-flex min-h-11 items-center gap-2 rounded text-sm font-semibold text-indigo-700 underline underline-offset-4 dark:text-indigo-300", focusRing);

/** One next action, an optional daily plan and reviewable completion history for the same opportunity. */
export function PrepPlanPanel({ entry, onOpenInterview }: { entry: JobTrackerEntry; onOpenInterview?: () => void }) {
  const plan = useAsync(() => api.prepPlan(entry.id), [entry.id, entry.next_at, entry.status], `prep-plan:${entry.id}:${entry.status}:${entry.next_at ?? ""}`);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const seq = useRef(0);
  const nextHeading = useRef<HTMLHeadingElement>(null);
  const planHeading = useRef<HTMLHeadingElement>(null);
  const [coach, setCoach] = useState(false);
  const [reuse, setReuse] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const cancel = useCallback(() => { seq.current++; }, []);
  useEffect(() => { cancel(); busyRef.current = false; setBusy(null); setCoach(false); setReuse(null); setConfirmed(false); setExpanded(false); return cancel; }, [entry.id, entry.next_at, entry.status, cancel]);
  const today = localToday();
  const p = plan.data;
  const next = p?.days.flatMap((day) => day.items).find((item) => !item.done);
  const taskPath = (item: PlanItem) => planItemLink(item.kind, entry) ?? `${missionPath(entry.id)}?guide=1&tab=company`;

  const tick = async (item: PlanItem, reuseFrom?: string) => {
    if (busyRef.current || plan.loading || (reuseFrom && !confirmed)) return;
    const request = ++seq.current; busyRef.current = true; setBusy(item.key);
    try {
      const updated: PrepPlan = await api.tickPlanItem(entry.id, item.key, reuseFrom ? true : !item.done, -new Date().getTimezoneOffset(), reuseFrom);
      if (request === seq.current) {
        plan.setData(() => updated); setReuse(null); setConfirmed(false);
        if (reuseFrom) requestAnimationFrame(() => {
          if (request !== seq.current) return;
          const target = nextHeading.current ?? planHeading.current;
          target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: "start" });
        });
      }
    } catch (err) {
      if (request === seq.current) { toast({ message: errorText(err), tone: "error" }); setReuse(null); setConfirmed(false); plan.reload(); }
    } finally {
      if (request === seq.current) { busyRef.current = false; setBusy(null); }
    }
  };

  return <LoadGate loading={plan.loading && !p} variant="card" count={1} label="Building the plan">
    {plan.error && <ErrorNote onRetry={plan.reload}>{errorText(plan.error)}</ErrorNote>}
    {p && <div className="min-w-0 space-y-4">
      <Card className="!p-4 sm:!p-5">
        <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Prepare · one task at a time</p>
        <h2 ref={planHeading} tabIndex={-1} className="mt-2 flex scroll-mt-28 items-start gap-2 rounded font-display text-xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><CalendarIcon aria-hidden className="mt-1 h-5 w-5 shrink-0" />{p.mode === "closed" ? "Your preparation stays with this job" : p.mode === "rehearsal" ? "Practice before an interview is booked" : p.days_left === 0 ? "Your interview is today" : p.days_left === 1 ? "Your interview is tomorrow" : `Interview in ${p.days_left} days`}</h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">{p.mode === "rehearsal" ? "A three-day practice path from your saved job, fit check, stories and practice queue. These are suggestions, not booked interview dates." : p.mode === "closed" ? "This job has moved beyond active preparation. Your recorded work remains in the history below." : "Your saved date sets the pace. Earlier work stays in history when a date moves; a new round still needs fresh warm-up and logistics checks."}</p>
        {p.mode === "rehearsal" && entry.next_at && entry.status !== "saved" && <p className="mt-2 text-sm">The recorded date has passed. Confirm the next date when you have one.</p>}
        {p.mode !== "closed" && <div className="mt-2">{onOpenInterview ? <Button variant="secondary" onClick={onOpenInterview}>{p.mode === "rehearsal" ? "Add a confirmed interview date" : "Review or change interview date"}</Button> : <Link className={link} to={JOBS_TRACKER}>Review the saved date</Link>}</div>}
        {p.total > 0 && <div className="mt-4"><p className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">{p.done} of {p.total} tasks checked in this plan · candidate-recorded activity, not a readiness score</p><progress aria-label="Tasks checked in this plan" className="h-2 w-full accent-indigo-600" max={p.total} value={p.done} /></div>}
      </Card>
      {next && <section aria-label="Suggested preparation task" className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 motion-safe:animate-menu-in dark:border-indigo-400/25 dark:bg-indigo-500/10">
        <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Your next prep task</p><h3 ref={nextHeading} tabIndex={-1} className="mt-2 scroll-mt-28 rounded font-semibold outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">{next.title}</h3><p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{next.detail}</p><Link className={link} to={taskPath(next)}>Start this task <ArrowRight aria-hidden className="h-4 w-4" /></Link><p className="text-xs text-zinc-600 dark:text-zinc-400">The first unchecked task in your plan. Choose another below if it suits you better.</p>
      </section>}
      {p.total > 0 && !next && <p role="status" className="rounded-xl bg-emerald-500/10 p-4 text-sm">All tasks in this plan are checked. Review your current date and materials before the actual interview.</p>}
      {p.days.length > 0 && <>
        <details className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10" onToggle={(e) => setCoach(e.currentTarget.open)}><summary className={cx("min-h-11 cursor-pointer rounded py-2 font-semibold", focusRing)}>Plan my interview preparation with AI</summary>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Optional help from this job’s saved date, completion counts and unchecked tasks, using the same browser-day plan as your checklist. Opening this panel makes no model call. Guidance never books interviews, completes tasks or verifies employer questions.</p>
          {coach && <Suspense fallback={<p role="status">Opening preparation coach…</p>}><Coach key={JSON.stringify([entry.id, entry.next_at, p])} entryId={entry.id} focus="interview" /></Suspense>}
        </details>
        <ol className="space-y-3">{p.days.slice(0, expanded ? p.days.length : 1).map((day, index) => <li key={day.date}>
          <details open={index === 0 ? true : undefined} className={cx("rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-900", day.date === today && "ring-1 ring-indigo-500/40")}>
            <summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-semibold", focusRing)}>{dayLabel(day.date, day.days_before, today)} · {day.items.filter((i) => i.done).length} of {day.items.length} checked{day.days_before !== null && day.days_before > 0 ? ` · ${day.days_before} day${day.days_before === 1 ? "" : "s"} before` : ""}</summary>
            <ul className="mt-2 space-y-3">{day.items.map((item) => <li key={item.key} className="min-w-0">
              <div className="flex items-start gap-3"><button type="button" role="checkbox" aria-checked={item.done} aria-label={`${item.done ? "Untick" : "Tick off"}: ${item.title}`} disabled={busy !== null || plan.loading} onClick={() => void tick(item)} className={cx("mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border motion-safe:transition-colors", item.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-300 hover:border-indigo-400 dark:border-white/20", focusRing)}>{item.done && <Check aria-hidden className="h-3.5 w-3.5" />}</button>
                <div className="min-w-0 flex-1"><p className={cx("break-words text-sm", item.done && "text-zinc-500 line-through dark:text-zinc-400")}>{item.title}</p>{item.detail && <p className="text-xs text-zinc-600 dark:text-zinc-400">{item.detail}</p>}{!item.done && <Link className={link} to={taskPath(item)}>Start</Link>}</div>
              </div>
              {!item.done && item.prior_completion && <div className="ml-9 mt-1 rounded-xl bg-zinc-500/5 p-3">
                <Button variant="secondary" disabled={busy !== null} onClick={() => { setReuse(reuse === item.key ? null : item.key); setConfirmed(false); }}>Review earlier work</Button>
                {reuse === item.key && <div className="mt-3 space-y-3" role="group" aria-label="Review earlier preparation"><p className="text-sm">You recorded “{item.prior_completion.title}” on {new Date(item.prior_completion.completed_at).toLocaleDateString()}. The task text matches; Orbit has not checked whether the job or your materials changed.</p><label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I checked the current job and materials. This earlier work still meets this task.</label><Button disabled={!confirmed || busy !== null || plan.loading} onClick={() => void tick(item, item.prior_completion!.id)}>Use this preparation</Button></div>}
              </div>}
            </li>)}</ul>
          </details>
        </li>)}</ol>
        {p.days.length > 1 && <Button variant="secondary" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Hide upcoming prep days" : `Show upcoming prep days (${p.days.length - 1})`}</Button>}
      </>}
      <details className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10"><summary className={cx("min-h-11 cursor-pointer rounded py-2 font-semibold", focusRing)}>Completed preparation ({p.completed_total ?? 0})</summary><p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Your recorded completions for this job, including previous schedules. These are activity records, not verified skills. The latest 50 appear here; account export includes all records. Unchecking a current task removes that completion.</p>
        {p.completed?.length ? <ol className="mt-3 space-y-3">{p.completed.map((item) => <li key={item.id} className="rounded-xl bg-zinc-500/5 p-3 text-sm"><p className="break-words font-medium">{item.title}</p><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Recorded {new Date(item.completed_at).toLocaleString()}{item.scheduled_on ? ` · Planned for ${item.scheduled_on}` : ""}{item.reused ? " · Earlier work reviewed and reused" : ""}</p>{item.legacy && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Legacy checkmark: original task text is unavailable, so it cannot be reused automatically.</p>}</li>)}</ol> : <p className="mt-3 text-sm">No completed preparation recorded for this job yet. Check a task only after doing it.</p>}
      </details>
    </div>}
  </LoadGate>;
}
