import { useEffect, useMemo, useRef } from "react";
import type { JobTrackerEntry } from "@orbit/types";
import { cx } from "@orbit/ui";
import { activityByDay, dayKey, grid, level, streak, total } from "./activity";

// One hue, light to dark (sequential); the empty step is the neutral track.
const STEPS = ["fill-zinc-100 dark:fill-white/10", "fill-indigo-200 dark:fill-indigo-900", "fill-indigo-400 dark:fill-indigo-700", "fill-indigo-600 dark:fill-indigo-500", "fill-indigo-800 dark:fill-indigo-300"];
const CELL = 11, GAP = 3;
const DAYS = ["Mon", "", "Wed", "", "Fri", "", ""];

/** Tracker → "Your search, day by day" (activity.ts): a contribution-style map of the last 26 weeks, with streak. */
export function ActivityMap({ entries }: { entries: JobTrackerEntry[] }) {
  const { weeks, days, max, sum, run, active } = useMemo(() => {
    const days = activityByDay(entries);
    const weeks = grid();
    const shown = weeks.flat().map((d) => total(days.get(dayKey(d))));
    return { weeks, days, max: Math.max(0, ...shown), sum: shown.reduce((a, b) => a + b, 0), run: streak(days), active: shown.filter(Boolean).length };
  }, [entries]);
  // On a narrow screen the map scrolls sideways: open it on the latest weeks, where today is.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth; }, [sum]);
  if (!sum) return null;
  const today = dayKey(new Date());
  const width = 28 + weeks.length * (CELL + GAP), height = 16 + 7 * (CELL + GAP);
  const summary = `${sum} actions on ${active} days in the last 26 weeks; current streak ${run} ${run === 1 ? "day" : "days"}.`;

  return <section aria-labelledby="activity-map" className="workspace-panel p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="activity-map" className="font-semibold">Your search, day by day</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400"><span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{run}</span>-day streak · <span className="tabular-nums">{active}</span> active {active === 1 ? "day" : "days"}</p>
    </div>
    <div ref={scroller} className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Activity map (scrolls sideways)">
      <svg width={width} height={height} role="img" aria-label={summary} className="block">
        {weeks.map((w, wi) => {
          const first = w[0]!;
          return <g key={wi}>
            {first.getDate() <= 7 && <text x={28 + wi * (CELL + GAP)} y={10} className="fill-zinc-500 text-[9px]">{first.toLocaleDateString(undefined, { month: "short" })}</text>}
            {w.map((d, di) => {
              const key = dayKey(d), c = days.get(key), n = total(c);
              if (key > today) return null;
              return <rect key={key} x={28 + wi * (CELL + GAP)} y={16 + di * (CELL + GAP)} width={CELL} height={CELL} rx={2}
                className={cx(STEPS[level(n, max)], key === today && "stroke-zinc-900 dark:stroke-zinc-100")} strokeWidth={key === today ? 1.5 : 0}>
                <title>{`${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: ${n ? [c!.saved && `${c!.saved} saved`, c!.applied && `${c!.applied} applied`, c!.moved && `${c!.moved} moved forward`].filter(Boolean).join(", ") : "nothing recorded"}`}</title>
              </rect>;
            })}
          </g>;
        })}
        {DAYS.map((l, i) => l && <text key={l} x={0} y={16 + i * (CELL + GAP) + 9} className="fill-zinc-500 text-[9px]">{l}</text>)}
      </svg>
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400">
      <span>Saves, applications and moves forward, from your tracker.</span>
      <span className="flex items-center gap-1" aria-hidden>Less{STEPS.map((s) => <svg key={s} width={CELL} height={CELL}><rect width={CELL} height={CELL} rx={2} className={s} /></svg>)}More</span>
    </div>
  </section>;
}
