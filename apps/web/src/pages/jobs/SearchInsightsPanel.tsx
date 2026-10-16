import { useState } from "react";
import { Link } from "react-router-dom";
import type { JobTrackerEntry } from "@orbit/types";
import { ChartColumn, cx, focusRing } from "@orbit/ui";
import { Card } from "../../components/ui";
import { QUIET_DAYS, searchInsights, type SearchInsights } from "./insights";
import { JOBS_OUTREACH } from "./paths";

const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);
const weekLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

/** One headline number, with what it's out of. */
function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl bg-zinc-500/[0.05] p-3 dark:bg-white/[0.03]">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{detail}</p>
    </div>
  );
}

/** Applications a week, the last eight: one series, one hue, a tooltip per column, and the same as a table. */
function Weeks({ weeks }: { weeks: SearchInsights["weeks"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const W = 320;
  const H = 96;
  const gap = 8;
  const bw = (W - gap * (weeks.length - 1)) / weeks.length;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-sm font-medium">Applications a week</figcaption>
      <div className="relative max-w-md">
        <svg viewBox={`0 0 ${W} ${H + 18}`} className="h-auto w-full" role="img"
             aria-label={`Applications a week, the last eight weeks: ${weeks.map((w) => w.count).join(", ")}`}>
          <line x1={0} x2={W} y1={H + 0.5} y2={H + 0.5} className="stroke-zinc-300 dark:stroke-white/15" strokeWidth={1} />
          {weeks.map((w, i) => {
            const h = w.count ? Math.max(4, (w.count / max) * (H - 14)) : 0;
            const x = i * (bw + gap);
            return (
              <g key={w.start} tabIndex={0} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                 aria-label={`Week of ${weekLabel(w.start)}: ${w.count} application${w.count === 1 ? "" : "s"}`} className="outline-none">
                <rect x={x - gap / 2} y={0} width={bw + gap} height={H} fill="transparent" />
                {h > 0 && <path d={`M${x},${H} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z`} className={cx("fill-indigo-500 dark:fill-indigo-400", hover !== null && hover !== i && "opacity-60")} />}
                {i === weeks.length - 1 || i === 0 ? (
                  <text x={i === 0 ? x : x + bw} y={H + 14} textAnchor={i === 0 ? "start" : "end"} className="fill-zinc-500 text-[10px] dark:fill-zinc-400">
                    {i === weeks.length - 1 ? "This week" : weekLabel(w.start)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div role="tooltip" className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-zinc-900 px-2 py-1 text-xs text-white shadow dark:bg-zinc-100 dark:text-zinc-900"
               style={{ left: `${Math.min(80, Math.max(20, ((hover * (bw + gap) + bw / 2) / W) * 100))}%` }}>
            Week of {weekLabel(weeks[hover]!.start)}: <strong>{weeks[hover]!.count}</strong>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>Applications a week</caption>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.start}><th scope="row">Week of {weekLabel(w.start)}</th><td>{w.count}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/**
 * Your search, in numbers (pages/jobs/insights.ts): how many answered, how many reached an interview, how long it
 * takes, which channel works, and what's gone quiet. Shown once something's been applied to.
 */
export function SearchInsightsPanel({ entries }: { entries: JobTrackerEntry[] }) {
  const s = searchInsights(entries);
  if (!s.applied) return null;
  return (
    <Card className="mb-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
        <ChartColumn className="h-5 w-5 text-indigo-500" aria-hidden /> Your search, in numbers
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Applied" value={String(s.applied)} detail="from your tracker" />
        <Tile label="Heard back" value={pct(s.responseRate)} detail={`${s.heardBack} of ${s.applied}: a next step or a no`} />
        <Tile label="Reached interview" value={pct(s.interviewRate)} detail={`${s.interviews} of ${s.applied}${s.offers ? `, ${s.offers} offer${s.offers === 1 ? "" : "s"}` : ""}`} />
        <Tile label="Typical wait" value={s.medianDaysToHear === null ? "–" : `${s.medianDaysToHear} day${s.medianDaysToHear === 1 ? "" : "s"}`} detail={s.medianDaysToHear === null ? "no answers yet" : "from applying to an answer"} />
      </div>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <Weeks weeks={s.weeks} />
        <div className="min-w-0">
          <p className="mb-2 text-sm font-medium">Where it works</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                <th scope="col" className="pb-1 font-medium">Where you applied</th>
                <th scope="col" className="pb-1 text-right font-medium">Applied</th>
                <th scope="col" className="pb-1 pl-3 font-medium">Heard back</th>
              </tr>
            </thead>
            <tbody>
              {s.channels.map((c) => {
                const rate = c.heardBack / c.applied;
                return (
                  <tr key={c.channel} className="border-t border-zinc-200 dark:border-white/10">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal">{c.channel}</th>
                    <td className="py-1.5 text-right tabular-nums">{c.applied}</td>
                    <td className="py-1.5 pl-3">
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-500/15">
                          <span className="block h-full rounded-full bg-indigo-500 dark:bg-indigo-400" style={{ width: `${rate * 100}%` }} />
                        </span>
                        <span className="tabular-nums">{pct(rate)}</span>
                        {c.interviews > 0 && <span className="text-xs text-zinc-500 dark:text-zinc-400">· {c.interviews} interview{c.interviews === 1 ? "" : "s"}</span>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {s.quiet > 0 && (
            <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
              {s.quiet} application{s.quiet === 1 ? " has" : "s have"} had no answer for over {QUIET_DAYS} days.{" "}
              <Link to={JOBS_OUTREACH} className={cx("font-medium underline underline-offset-2", focusRing)}>
                Write a short follow-up
              </Link>
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
