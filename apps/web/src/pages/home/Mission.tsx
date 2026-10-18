import { Link } from "react-router-dom";
import type { JobStatus, JobTrackerEntry, OrbitSession } from "@orbit/types";
import { CalendarIcon, CompanyLogo, CountUp, LoadGate, Target, cx, focusRing, useInView } from "@orbit/ui";
import { Card } from "../../components/ui";
import { useAsync, type AsyncState } from "../../lib/useAsync";
import { api } from "../../lib/api";
import { STATUS_LABEL, STATUS_MARK } from "../jobs/model";
import { missionPath } from "../jobs/mission";
import { JOBS_MATCHES, JOBS_TRACKER } from "../jobs/paths";
import { RESUME_AI_HOME, resumePath } from "../resume/paths";
import { scoreTone } from "../resume/product";
import { PIPELINE_STAGES, countdown, lastWeek, pipeline, upcoming } from "./dashboard";

const link = cx("rounded text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing);

/**
 * The pipeline as one bar: each stage's share of what's tracked, in order, 2 px apart. It fills from the left the
 * first time it's in view (Full motion; a fade at Gentle). The counts below are its legend and its numbers.
 */
function StageBar({ stages }: { stages: Record<JobStatus, number> }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} data-shown={seen ? "" : undefined} aria-hidden className="chart mb-3">
      <div className="chart-marks chart-fill flex h-2 gap-0.5 overflow-hidden rounded-full">
        {PIPELINE_STAGES.filter((s) => stages[s] > 0).map((s) => (
          <span key={s} className={cx("h-full", STATUS_MARK[s])} style={{ flexGrow: stages[s] }} />
        ))}
      </div>
    </div>
  );
}

/** Applications by stage: the bar, then four counts (each a link into the tracker), each stage's colour by its name. */
export function Pipeline({ tracker }: { tracker: AsyncState<JobTrackerEntry[]> }) {
  const entries = tracker.data ?? [];
  const { stages, total } = pipeline(entries);
  const shown = PIPELINE_STAGES.reduce((a, s) => a + stages[s], 0);
  return (
    <Card>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-semibold">Applications</h2>
        <Link to={JOBS_TRACKER} className={cx(link, "tap-y")}>
          Open the tracker
        </Link>
      </div>
      <LoadGate loading={tracker.loading && !tracker.data} variant="line" count={2} label="Loading your applications">
        {total === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Nothing tracked yet.{" "}
            <Link to={JOBS_MATCHES} className={link}>
              Find a job that fits
            </Link>{" "}
            and save it: each stage is counted here.
          </p>
        ) : (
          <>
            {shown > 0 && <StageBar stages={stages} />}
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PIPELINE_STAGES.map((s) => (
                <li key={s}>
                  <Link
                    to={JOBS_TRACKER}
                    className={cx("block rounded-xl border border-zinc-200 px-3 py-2.5 hover:border-indigo-400/50 dark:border-white/10", focusRing)}
                  >
                    <span className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                      <span aria-hidden className={cx("h-2 w-2 rounded-full", STATUS_MARK[s])} />
                      {STATUS_LABEL[s]}
                    </span>
                    <CountUp to={stages[s]} className="stat-value mt-1 block font-display text-2xl font-semibold" />
                  </Link>
                </li>
              ))}
            </ul>
            {stages.rejected > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", STATUS_MARK.rejected)} />
                {stages.rejected} closed as "{STATUS_LABEL.rejected.toLowerCase()}".
              </p>
            )}
          </>
        )}
      </LoadGate>
    </Card>
  );
}

/** Interviews and follow-ups on the calendar, with how far away each is. */
export function Upcoming({ tracker }: { tracker: AsyncState<JobTrackerEntry[]> }) {
  const next = upcoming(tracker.data ?? []);
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold">
        <CalendarIcon className="h-4 w-4 text-sky-500" aria-hidden /> Coming up
      </h2>
      <LoadGate loading={tracker.loading && !tracker.data} variant="line" count={2} label="Loading your dates">
        {next.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No interview or follow-up dates. Add one to a job in the{" "}
            <Link to={JOBS_TRACKER} className={link}>
              tracker
            </Link>{" "}
            and it counts down here.
          </p>
        ) : (
          <>
          <ul className="space-y-1">
            {next.map((e) => (
              <li key={e.id}>
                <Link to={missionPath(e.id)} className={cx("flex items-center gap-3 rounded-xl px-1.5 py-2 hover:bg-zinc-900/5 dark:hover:bg-white/5", focusRing)}>
                  <CompanyLogo company={e.company} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{e.company}</span>
                    <span className="block truncate text-xs text-zinc-600 dark:text-zinc-400">
                      {STATUS_LABEL[e.status]} · {e.title}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-800 dark:text-sky-200">{countdown(e.next_at!)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {next[0] && (next[0].status === "interviewing" || next[0].status === "applied") && <PlanLine entry={next[0]} />}
          </>
        )}
      </LoadGate>
    </Card>
  );
}

/** What was done lately, counted: practice this week and the best resume score. Nothing estimated. */
export function AtAGlance({
  sessions,
  resumes,
  mockEnabled,
}: {
  sessions: OrbitSession[] | null;
  resumes: { id: string; title: string; score: number }[] | null;
  mockEnabled: boolean;
}) {
  const week = lastWeek(sessions ?? []);
  const best = resumes?.length ? resumes.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold">
        <Target className="h-4 w-4 text-orange-500" aria-hidden /> Last 7 days
      </h2>
      <dl className="grid grid-cols-2 gap-3">
        {mockEnabled && (
          <div>
            <dt className="text-xs text-zinc-600 dark:text-zinc-400">Mock interviews</dt>
            <dd className="stat-value font-display text-2xl font-semibold">{sessions ? <CountUp to={week.mocks} /> : "–"}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-zinc-600 dark:text-zinc-400">Live sessions</dt>
          <dd className="stat-value font-display text-2xl font-semibold">{sessions ? <CountUp to={week.lives} /> : "–"}</dd>
        </div>
      </dl>
      <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-white/10">
        {best ? (
          <Link to={resumePath(best.id)} className={cx("flex items-center gap-2 rounded text-sm hover:underline", focusRing)}>
            <span className={cx("inline-flex h-6 min-w-8 items-center justify-center rounded-md px-1 text-xs font-semibold tabular-nums ring-1", scoreTone(best.score))}>
              {best.score}
            </span>
            <span className="min-w-0 truncate">Best ATS check: {best.title}</span>
          </Link>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No resume yet.{" "}
            <Link to={RESUME_AI_HOME} className={link}>
              Add one
            </Link>{" "}
            to get its ATS check.
          </p>
        )}
      </div>
    </Card>
  );
}

/** The nearest interview's prep plan in one line: what's ticked, and the way into it. */
function PlanLine({ entry }: { entry: JobTrackerEntry }) {
  const plan = useAsync(() => api.prepPlan(entry.id), [entry.id, entry.next_at], `prep-plan:${entry.id}`);
  const p = plan.data;
  if (!p || p.total === 0) return null;
  return (
    <Link to={missionPath(entry.id)} className={cx("mt-3 flex items-center justify-between gap-2 rounded-xl bg-indigo-500/5 px-3 py-2 text-sm hover:bg-indigo-500/10", focusRing)}>
      <span>
        Prep plan for {entry.company}: <span className="font-medium tabular-nums">{p.done} of {p.total}</span> done
      </span>
      <span aria-hidden className="text-indigo-700 dark:text-indigo-300">Open</span>
    </Link>
  );
}
