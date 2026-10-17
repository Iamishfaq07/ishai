import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Progress, ProgressPoint } from "@orbit/types";
import { ArrowRight, Check, LoadGate, Target, cx, focusRing, regionWords } from "@orbit/ui";
import { Card, ErrorNote } from "../components/ui";
import { api } from "../lib/api";
import { SESSION_TYPE_LABEL, errorText } from "../lib/format";
import { useAuth } from "../lib/auth";
import { useCountry } from "../lib/country";
import { loadAnswers, practiceHref } from "../lib/onboarding";
import { GOAL_CHOICES, goalState, loadGoal, loadWarmupLog, saveGoal } from "../lib/weeklyGoal";
import { useAsync } from "../lib/useAsync";

const H = 180;
const PAD = { top: 16, right: 36, bottom: 24, left: 28 };
// Just enough plot area to draw into: the chart follows its card down to the narrowest phone instead of overflowing.
const MIN_W = PAD.left + PAD.right + 60;
const TIP_W = 208;

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(MIN_W, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

/**
 * Review score (1–5) per scored session, oldest → newest. One series: no legend (the heading names it), 2px line,
 * 8px markers with a surface ring, a crosshair + tooltip on hover, the latest value labelled, and a table view.
 */
function ScoreChart({ points }: { points: ProgressPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (score: number) => PAD.top + innerH - ((score - 1) / 4) * innerH;
  const coords = points.map((p, i) => [x(i), y(p.overall_score ?? 1)] as const);
  const line = coords.map(([cx_, cy], i) => `${i ? "L" : "M"}${cx_},${cy}`).join(" ");
  const area = `${line} L${coords.at(-1)?.[0] ?? 0},${PAD.top + innerH} L${coords[0]?.[0] ?? 0},${PAD.top + innerH} Z`;
  const last = points.at(-1);
  const lastXY = coords.at(-1);
  const hp = hover !== null ? points[hover] : null;
  const hc = hover !== null ? coords[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    let best = 0;
    coords.forEach(([cx_], i) => {
      if (Math.abs(cx_ - px) < Math.abs((coords[best]?.[0] ?? 0) - px)) best = i;
    });
    setHover(best);
  };

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={`Review score over your last ${points.length} scored sessions, latest ${last?.overall_score ?? "–"} out of 5`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        // pan-y: a finger dragging up or down still scrolls the page; sideways moves the crosshair.
        className="block touch-pan-y"
      >
        {[1, 2, 3, 4, 5].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="stroke-zinc-200 dark:stroke-white/10" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-zinc-500 text-[11px] dark:fill-zinc-400">
              {t}
            </text>
          </g>
        ))}
        <path d={area} className="fill-indigo-600/10 dark:fill-indigo-500/10" />
        <path d={line} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-indigo-600 dark:stroke-indigo-500" />
        {hc && <line x1={hc[0]} x2={hc[0]} y1={PAD.top} y2={PAD.top + innerH} className="stroke-zinc-300 dark:stroke-white/20" strokeWidth={1} />}
        {coords.map(([cx_, cy], i) => (
          <circle
            key={points[i]?.id}
            cx={cx_}
            cy={cy}
            r={hover === i ? 6 : 4}
            strokeWidth={2}
            className="fill-indigo-600 stroke-white dark:fill-indigo-500 dark:stroke-zinc-900"
          />
        ))}
        {last && lastXY && (
          <text x={lastXY[0] + 10} y={lastXY[1]} dy="0.32em" className="fill-zinc-900 text-xs font-semibold dark:fill-zinc-100">
            {last.overall_score}
          </text>
        )}
        <text x={PAD.left} y={H - 4} className="fill-zinc-500 text-[11px] dark:fill-zinc-400">
          {shortDate(points[0]?.ended_at ?? null)}
        </text>
        <text x={width - PAD.right} y={H - 4} textAnchor="end" className="fill-zinc-500 text-[11px] dark:fill-zinc-400">
          {shortDate(last?.ended_at ?? null)}
        </text>
      </svg>
      {hp && hc && (
        <div
          role="status"
          className="glass-panel pointer-events-none absolute z-10 rounded-xl p-2.5 text-xs shadow-popover"
          style={{
            width: Math.min(TIP_W, width),
            left: Math.max(0, Math.min(hc[0] - TIP_W / 2, width - TIP_W)),
            top: Math.max(hc[1] - 96, 0),
          }}
        >
          <p className="truncate font-medium">{hp.title}</p>
          <p className="text-zinc-500 dark:text-zinc-400">
            {SESSION_TYPE_LABEL[hp.type]} · {shortDate(hp.ended_at)}
          </p>
          <p className="mt-1 tabular-nums">
            Score <span className="font-semibold">{hp.overall_score}/5</span>
            {hp.words_per_minute !== null && ` · ${hp.words_per_minute} wpm`}
            {hp.fillers_per_minute !== null && ` · ${hp.fillers_per_minute} fillers/min`}
          </p>
        </div>
      )}
    </div>
  );
}

/** One figure. `value` null: nothing to show yet, said in words (with `detail` saying when it will), not a dash. */
function Tile({ label, value, detail }: { label: string; value: string | null; detail?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-zinc-500/5 p-3 ring-1 ring-zinc-200 dark:ring-white/[0.06]">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      {value === null ? (
        <p className="mt-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">Not yet</p>
      ) : (
        <p className="stat-value mt-1 text-2xl font-semibold">{value}</p>
      )}
      {detail && <p className="mt-0.5 text-xs">{detail}</p>}
    </div>
  );
}

function ScoreDelta({ recent, before }: { recent: number | null; before: number | null }) {
  if (recent === null || before === null) return null;
  const d = Math.round((recent - before) * 10) / 10;
  if (d === 0) return <span className="text-zinc-500 dark:text-zinc-400">Same as the 5 before</span>;
  return (
    <span className={d > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
      {d > 0 ? "▲" : "▼"} {d > 0 ? "+" : ""}
      {d} vs the 5 before
    </span>
  );
}

/** What counts toward the weekly goal: mock interviews that ended, and warm-up answers checked in this browser. */
function practiceTimes(progress: Progress | null, userId?: string | null): number[] {
  const mocks = (progress?.points ?? []).filter((p) => p.type === "mock" && p.ended_at).map((p) => Date.parse(p.ended_at!));
  return [...mocks, ...loadWarmupLog(userId)];
}

/**
 * "This week: 2 of 3": the weekly practice goal (lib/weeklyGoal.ts), weeks in a row, and the freeze that keeps a run
 * through one missed week. No reminders and no guilt: it's only here when you look. `progress` when the page has it;
 * without it the card loads it itself (sharing the "progress" cache), so Home can mount it with no props. `first`: no
 * sessions yet, so it also says how to get a first score.
 */
export function WeeklyGoal({ progress, first = false, className }: { progress?: Progress | null; first?: boolean; className?: string }) {
  return progress === undefined ? <OwnProgressGoal className={className} /> : <GoalCard progress={progress} first={first} className={className} />;
}

function OwnProgressGoal({ className }: { className?: string }) {
  const progress = useAsync<Progress>(() => api.progress(), [], "progress");
  if (!progress.data && progress.loading) return null;
  return <GoalCard progress={progress.data} first={!progress.data || progress.data.summary.sessions === 0} className={className} />;
}

function GoalCard({ progress, first, className }: { progress: Progress | null; first: boolean; className?: string }) {
  const { user } = useAuth();
  const screen = regionWords(useCountry()).screen;
  const userId = user?.id ?? null;
  const role = user ? loadAnswers(user.id)?.role : "";
  const [goalFor, setGoalFor] = useState(userId);
  const [goal, setGoal] = useState(() => loadGoal(userId));
  if (goalFor !== userId) {
    setGoalFor(userId);
    setGoal(loadGoal(userId));
  }
  const titleId = useId();
  const state = goalState(practiceTimes(progress, userId), goal);
  const pick = (n: number) => {
    setGoal(n);
    saveGoal(n, userId);
  };
  const left = Math.max(goal - state.done, 0);
  const days = state.daysLeft === 1 ? "day" : "days";
  return (
    <Card className={cx("!p-4 sm:!p-5", className)}>
      <section aria-labelledby={titleId}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-base font-semibold">
              This week: {state.done} of {goal}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {state.met ? (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
                  <Check className="h-4 w-4" aria-hidden /> Goal met. Nice.
                </span>
              ) : (
                <>
                  {left} to go, {state.daysLeft} {days} left this week.
                </>
              )}{" "}
              {state.weeks > 0 && (
                <>
                  {state.weeks} {state.weeks === 1 ? "week" : "weeks"} in a row.
                </>
              )}
            </p>
          </div>
          <div role="group" aria-label="Weekly goal" className="inline-flex shrink-0 items-center gap-0.5 rounded-xl bg-zinc-500/10 p-1 text-xs">
            {GOAL_CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={goal === n}
                aria-label={n + " a week"}
                onClick={() => pick(n)}
                className={cx(
                  "min-w-7 rounded-lg px-2 py-1 font-medium tabular-nums",
                  goal === n ? "bg-white text-zinc-900 shadow-sm dark:bg-white/10 dark:text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                  focusRing,
                )}
              >
                {n}
              </button>
            ))}
            <span className="px-1.5 text-zinc-500 dark:text-zinc-400" aria-hidden>
              a week
            </span>
          </div>
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-500/15"
          role="progressbar"
          aria-label="This week's practice"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={Math.min(state.done, goal)}
        >
          <div className="h-full rounded-full bg-indigo-600" style={{ width: Math.min(state.done / goal, 1) * 100 + "%" }} />
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Mock interviews and warm-up answers count.{" "}
          {state.frozeLastWeek
            ? "Last week was a miss, and your freeze kept the run going."
            : state.freezeReady
              ? "A freeze is ready: miss one week and your run stays."
              : "Your freeze comes back after four weeks on goal."}
        </p>
        {first && (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-200 pt-3 text-sm text-zinc-600 dark:border-white/10 dark:text-zinc-300">
            <span className="min-w-0 flex-1">Your first score shows up after your first mock. A 5-minute {screen} is the quickest way in.</span>
            <Link to={practiceHref({ preset: "hr5", role })} className={cx("inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
              <Target className="h-4 w-4" aria-hidden /> Do a 5-minute {screen}
            </Link>
          </p>
        )}
      </section>
    </Card>
  );
}

/** "Your progress": the weekly goal, practice cadence, review scores over time and the latest speaking tips. */
export function ProgressSection() {
  const progress = useAsync<Progress>(() => api.progress(), [], "progress");
  if (progress.loading && !progress.data) return <LoadGate loading variant="card" count={2} label="Loading your progress">{null}</LoadGate>;
  if (progress.error && !progress.data) return <ErrorNote onRetry={progress.reload}>{errorText(progress.error)}</ErrorNote>;
  const data = progress.data;
  // Nothing scored yet: the goal and how to get a first score, instead of a grid of zeros and "–".
  if (!data || data.summary.sessions === 0) return <WeeklyGoal progress={data} first />;

  const s = data.summary;
  const scored = data.points.filter((p) => p.overall_score !== null);
  const latestPace = [...data.points].reverse().find((p) => p.words_per_minute !== null)?.words_per_minute ?? null;

  return (
    <section aria-labelledby="progress-title" className="space-y-4">
      <WeeklyGoal progress={data} />
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="progress-title" className="font-display text-lg font-semibold">
              Your progress
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Review scores and speaking habits across your sessions.</p>
          </div>
          <Link to="/sessions" className={cx("inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300", focusRing)}>
            All sessions <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Every session, live and mock, over the last 7 days: the weekly goal above counts practice only. */}
          <Tile label="Sessions, last 7 days" value={String(s.this_week)} detail={<span className="text-zinc-500 dark:text-zinc-400">Live and mock</span>} />
          <Tile label="Streak" value={`${s.streak_days} day${s.streak_days === 1 ? "" : "s"}`} />
          <Tile
            label="Average score (last 5)"
            value={s.average_score_recent !== null ? `${s.average_score_recent}/5` : null}
            detail={
              s.average_score_recent !== null ? (
                <ScoreDelta recent={s.average_score_recent} before={s.average_score_before} />
              ) : (
                <span className="text-zinc-500 dark:text-zinc-400">After your first review</span>
              )
            }
          />
          <Tile
            label="Latest pace"
            value={latestPace !== null ? `${latestPace} wpm` : null}
            detail={
              latestPace !== null ? (
                <span className="text-zinc-500 dark:text-zinc-400">Words a minute; 120–160 is easy to follow</span>
              ) : (
                <span className="text-zinc-500 dark:text-zinc-400">After a round where you answer out loud</span>
              )
            }
          />
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold">Review score over time</h3>
          {scored.length >= 2 ? (
            <>
              <ScoreChart points={scored} />
              <details className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                <summary className={cx("cursor-pointer select-none", focusRing)}>Show as table</summary>
                <table className="mt-2 w-full text-left tabular-nums">
                  <thead>
                    <tr className="text-zinc-500">
                      <th className="py-1 font-medium">Session</th>
                      <th className="py-1 font-medium">Date</th>
                      <th className="py-1 font-medium">Score</th>
                      <th className="py-1 font-medium">Pace</th>
                      <th className="py-1 font-medium">Fillers/min</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-700 dark:text-zinc-300">
                    {scored.map((p) => (
                      <tr key={p.id} className="border-t border-zinc-200 dark:border-white/[0.06]">
                        <td className="max-w-[12rem] truncate py-1">
                          <Link to={`/sessions/${p.id}`} className="hover:underline">
                            {p.title}
                          </Link>
                        </td>
                        <td className="py-1">{shortDate(p.ended_at)}</td>
                        <td className="py-1">{p.overall_score}/5</td>
                        <td className="py-1">{p.words_per_minute ?? "–"}</td>
                        <td className="py-1">{p.fillers_per_minute ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Review two sessions to see your trend. Mock interviews are reviewed automatically.
            </p>
          )}
        </div>

        {s.latest_tips.length > 0 && (
          <div className="mt-5">
            <h3 className="text-sm font-semibold">From your latest session</h3>
            <ul className="mt-1.5 space-y-1.5 text-sm">
              {s.latest_tips.map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
}
