import { Link } from "react-router-dom";
import type { JobTrackerEntry, OrbitSession } from "@orbit/types";
import { CalendarIcon, CompanyLogo, LoadGate, Target, cx, focusRing } from "@orbit/ui";
import { Card } from "../../components/ui";
import type { AsyncState } from "../../lib/useAsync";
import { STATUS_LABEL } from "../jobs/model";
import { missionPath } from "../jobs/mission";
import { JOBS_MATCHES, JOBS_TRACKER } from "../jobs/paths";
import { RESUME_AI_HOME, resumePath } from "../resume/paths";
import { scoreTone } from "../resume/product";
import { PIPELINE_STAGES, countdown, lastWeek, pipeline, upcoming } from "./dashboard";

const link = cx("rounded text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing);

// Each stage's mark (the tracker's own colours), always next to its name and count: never colour alone.
const STAGE_DOT: Record<string, string> = {
  saved: "bg-zinc-400",
  applied: "bg-indigo-500",
  interviewing: "bg-sky-500",
  offer: "bg-emerald-500",
};

/** Applications by stage: four counts, each a link into the tracker, and a thin bar of the same counts. */
export function Pipeline({ tracker }: { tracker: AsyncState<JobTrackerEntry[]> }) {
  const entries = tracker.data ?? [];
  const { stages, total } = pipeline(entries);
  const shown = PIPELINE_STAGES.reduce((a, s) => a + stages[s], 0);
  return (
    <Card>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-semibold">Applications</h2>
        <Link to={JOBS_TRACKER} className={link}>
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
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PIPELINE_STAGES.map((s) => (
                <li key={s}>
                  <Link
                    to={JOBS_TRACKER}
                    className={cx("block rounded-xl border border-zinc-200 px-3 py-2.5 hover:border-indigo-400/50 dark:border-white/10", focusRing)}
                  >
                    <span className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                      <span aria-hidden className={cx("h-2 w-2 rounded-full", STAGE_DOT[s])} />
                      {STATUS_LABEL[s]}
                    </span>
                    <span className="mt-1 block font-display text-2xl font-semibold tabular-nums">{stages[s]}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {shown > 0 && (
              <div aria-hidden className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
                {PIPELINE_STAGES.filter((s) => stages[s] > 0).map((s) => (
                  <span key={s} className={cx("h-full rounded-full", STAGE_DOT[s])} style={{ flexGrow: stages[s] }} />
                ))}
              </div>
            )}
            {stages.rejected > 0 && (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
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
            <dd className="font-display text-2xl font-semibold tabular-nums">{sessions ? week.mocks : "–"}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-zinc-600 dark:text-zinc-400">Live sessions</dt>
          <dd className="font-display text-2xl font-semibold tabular-nums">{sessions ? week.lives : "–"}</dd>
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
