import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { JobTrackerEntry, PlanItem, PrepPlan } from "@orbit/types";
import { ArrowRight, CalendarIcon, Check, LoadGate, cx, focusRing, toast } from "@orbit/ui";
import { Card, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { JOBS_TRACKER } from "./paths";
import { dayLabel, localToday, planItemLink } from "./plan";

const Coach = lazy(() => import("./GuidedOpportunity").then((m) => ({ default: m.OpportunityCoach })));

/** The plan to the interview: a countdown, each day's tasks with a way to do them, and a tick for each. */
/** `onOpenInterview`: in the Mission room, where the date is set on the Interview tab next to this one. */
export function PrepPlanPanel({ entry, onOpenInterview }: { entry: JobTrackerEntry; onOpenInterview?: () => void }) {
  const plan = useAsync(() => api.prepPlan(entry.id), [entry.id, entry.next_at, entry.status], `prep-plan:${entry.id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const seq = useRef(0);
  const [coach, setCoach] = useState(false);
  const cancel = useCallback(() => { seq.current++; }, []);
  useEffect(() => { cancel(); busyRef.current = false; setBusy(null); setCoach(false); return cancel; }, [entry.id, entry.next_at, entry.status, cancel]);
  const today = localToday();
  const p = plan.data;

  const tick = async (item: PlanItem) => {
    if (busyRef.current) return;
    const request = ++seq.current; busyRef.current = true; setBusy(item.key);
    try {
      const next: PrepPlan = await api.tickPlanItem(entry.id, item.key, !item.done);
      if (request === seq.current) plan.setData(() => next);
    } catch (err) {
      if (request === seq.current) toast({ message: errorText(err), tone: "error" });
    } finally {
      if (request === seq.current) { busyRef.current = false; setBusy(null); }
    }
  };

  return (
    <LoadGate loading={plan.loading && !p} variant="card" count={1} label="Building the plan">
      {plan.error && !p ? (
        <ErrorNote onRetry={plan.reload}>{errorText(plan.error)}</ErrorNote>
      ) : p && p.days.length === 0 ? (
        <Card>
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <CalendarIcon className="h-4 w-4 text-sky-500" aria-hidden /> No interview date yet
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {p.interview_at
              ? `The interview date has passed. Add the next one ${onOpenInterview ? "on the Interview tab" : "in the tracker"} for a new plan.`
              : `Add the interview date ${onOpenInterview ? "on the Interview tab" : "in the tracker (as applied or interviewing)"} and Orbit lays out each day until then.`}
          </p>
          {onOpenInterview ? (
            <button type="button" onClick={onOpenInterview} className={cx("mt-3 inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
              Add the date <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            <Link to={JOBS_TRACKER} className={cx("mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
              Open the tracker <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        </Card>
      ) : p ? (
        <div className="space-y-4">
          <Card className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">Interview</p>
              <p className="font-display text-2xl font-semibold tabular-nums">
                {p.days_left === 0 ? "Today" : p.days_left === 1 ? "Tomorrow" : `In ${p.days_left} days`}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">Tasks ticked</p>
              <p className="font-display text-2xl font-semibold tabular-nums">
                {p.done} <span className="text-base font-normal text-zinc-500">of {p.total}</span>
              </p>
            </div>
            <p className="min-w-0 basis-full text-xs text-zinc-500 sm:basis-0 sm:flex-1 dark:text-zinc-400">
              Built from your fit check's open requirements, the practice questions due again and your story bank. It changes when the date moves.
              {p.starts_on && p.starts_on > today && ` The plan starts on ${dayLabel(p.starts_on, 1, today)}.`}
            </p>
          </Card>
          <details className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10" onToggle={(e) => setCoach(e.currentTarget.open)}><summary className={cx("min-h-11 cursor-pointer rounded py-2 font-semibold", focusRing)}>Plan my interview preparation with AI</summary>
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Optional guidance from this job’s recorded date and unchecked preparation tasks. The coach uses a UTC-date plan; the checklist below follows your browser’s day. It does not change your calendar, complete tasks or verify employer questions.</p>
            {coach && <Suspense fallback={<p role="status">Opening preparation coach…</p>}><Coach key={JSON.stringify([entry.id, entry.next_at, p])} entryId={entry.id} focus="interview" /></Suspense>}
          </details>
          <ol className="space-y-3">
            {p.days.map((day) => {
              const isToday = day.date === today;
              return (
                <li key={day.date}>
                  <Card className={cx("!p-4", isToday && "ring-1 ring-indigo-500/40")}>
                    <h3 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold">
                      <span>{dayLabel(day.date, day.days_before, today)}</span>
                      {day.days_before > 0 && <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">{day.days_before} day{day.days_before === 1 ? "" : "s"} before</span>}
                    </h3>
                    <ul className="space-y-1.5">
                      {day.items.map((item) => {
                        const to = planItemLink(item.kind, entry);
                        return (
                          <li key={item.key} className="flex items-start gap-3">
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={item.done}
                              aria-label={`${item.done ? "Untick" : "Tick off"}: ${item.title}`}
                              disabled={busy !== null}
                              onClick={() => void tick(item)}
                              className={cx(
                                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors",
                                item.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 hover:border-indigo-400 dark:border-white/20",
                                focusRing,
                              )}
                            >
                              {item.done && <Check className="h-3.5 w-3.5" aria-hidden />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <p className={cx("text-sm", item.done && "text-zinc-500 line-through dark:text-zinc-400")}>{item.title}</p>
                              {item.detail && <p className="text-xs text-zinc-500 dark:text-zinc-400">{item.detail}</p>}
                            </div>
                            {to && !item.done && (
                              <Link to={to} className={cx("shrink-0 rounded text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
                                Start
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </LoadGate>
  );
}
