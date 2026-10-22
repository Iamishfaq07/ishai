import { Link } from "react-router-dom";
import type { JobTrackerEntry } from "@orbit/types";
import { ChartColumn, CountUp, StatTile, cx, focusRing } from "@orbit/ui";
import { ColumnChart } from "../../components/ColumnChart";
import { Card } from "../../components/ui";
import { QUIET_DAYS, searchInsights, type SearchInsights } from "./insights";
import { JOBS_OUTREACH } from "./paths";

const share = (r: number | null) => (r === null ? null : Math.round(r * 100));
const pct = (r: number) => `${Math.round(r * 100)}%`;
const weekLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

/** One headline number (counted up once it's in view), with what it's out of. `value` null: nothing yet, a dash. */
function Tile({ label, value, format, detail }: { label: string; value: number | null; format: (n: number) => string; detail: string }) {
  return (
    <StatTile label={label} value={value === null ? "–" : <CountUp to={value} format={format} />} detail={detail} />
  );
}

const percent = (n: number) => `${n}%`;
/** Below this many applications a rate says more about luck than about the search, so counts show instead of percents. */
export const RATE_FROM = 5;
const days = (n: number) => (n === 0 ? "Same day" : `${n} day${n === 1 ? "" : "s"}`);

/** Applications a week, the last eight (the shared column chart: one hue, a tooltip per column, the table view). */
function Weeks({ weeks }: { weeks: SearchInsights["weeks"] }) {
  return (
    <ColumnChart
      title="Applications a week"
      columns={weeks.map((w) => ({ key: w.start, label: `Week of ${weekLabel(w.start)}`, value: w.count }))}
      unit={(n) => `${n} application${n === 1 ? "" : "s"}`}
      axis={[weeks[0] ? weekLabel(weeks[0].start) : "", "This week"]}
      header={["Week", "Applications"]}
      empty="None in the last eight weeks"
      className="max-w-md"
    />
  );
}

/**
 * Your search, in numbers (pages/jobs/insights.ts): how many answered, how many reached an interview, how long it
 * takes, which channel works, and what's gone quiet. Shown once something's been applied to.
 */
export function SearchInsightsPanel({ entries }: { entries: JobTrackerEntry[] }) {
  const s = searchInsights(entries);
  if (!s.applied) return null;
  const early = s.applied < RATE_FROM;
  return (
    <Card className="mb-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
        <ChartColumn className="h-5 w-5 text-zinc-500 dark:text-zinc-400" aria-hidden /> Your search, in numbers
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Applied" value={s.applied} format={String} detail="from your tracker" />
        {early ? <>
          <Tile label="Heard back" value={s.heardBack} format={String} detail={`of ${s.applied} so far; rates show from ${RATE_FROM} applications`} />
          <Tile label="Reached interview" value={s.interviews} format={String} detail={`of ${s.applied} so far${s.offers ? `, ${s.offers} offer${s.offers === 1 ? "" : "s"}` : ""}`} />
        </> : <>
          <Tile label="Heard back" value={share(s.responseRate)} format={percent} detail={`${s.heardBack} of ${s.applied}: a next step or a no`} />
          <Tile label="Reached interview" value={share(s.interviewRate)} format={percent} detail={`${s.interviews} of ${s.applied}${s.offers ? `, ${s.offers} offer${s.offers === 1 ? "" : "s"}` : ""}`} />
        </>}
        <Tile label="Typical wait" value={s.medianDaysToHear} format={days} detail={s.medianDaysToHear !== null ? "from applying to an answer" : s.heardBack ? "not enough to tell yet" : "no answers yet"} />
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
                        {early ? <span className="tabular-nums">{c.heardBack} of {c.applied}</span> : <>
                          <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-500/15">
                            <span className="block h-full rounded-full bg-indigo-500 dark:bg-indigo-400" style={{ width: `${rate * 100}%` }} />
                          </span>
                          <span className="tabular-nums">{pct(rate)}</span>
                        </>}
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
