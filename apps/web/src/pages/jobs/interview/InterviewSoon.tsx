import { Link } from "react-router-dom";
import type { JobTrackerEntry } from "@orbit/types";
import { CalendarIcon, CompanyLogo, InterviewDayScene, Rocket, interviewWhen, interviewsSoon, roundLabel } from "@orbit/ui";
import type { AsyncState } from "../../../lib/useAsync";
import { linkButton } from "../links";
import { copilotPath, interviewPrepPath } from "./links";

/**
 * Home: an interview today or tomorrow, from the tracker's dates (applied or interviewing jobs), with the way into its
 * prep and the copilot loaded with that job. Nothing shows without one.
 */
export function InterviewSoon({ tracker }: { tracker: AsyncState<JobTrackerEntry[]> }) {
  const soon = interviewsSoon(tracker.data ?? []);
  if (!soon.length) return null;
  const today = soon.some((x) => x.days === 0);
  const tomorrow = soon.some((x) => x.days === 1);
  const title = today && tomorrow ? "Interviews today and tomorrow" : today ? `Interview${soon.length > 1 ? "s" : ""} today` : `Interview${soon.length > 1 ? "s" : ""} tomorrow`;
  return (
    <section aria-labelledby="interview-soon" className="glass-panel gradient-border scene-host relative rounded-2xl p-5 xl:pr-52">
      <InterviewDayScene className="absolute right-6 top-1/2 hidden w-40 -translate-y-1/2 xl:block" />
      <h2 id="interview-soon" className="flex items-center gap-2 font-display text-lg font-semibold">
        <CalendarIcon className="h-4 w-4 text-sky-500" aria-hidden /> {title}
      </h2>
      <ul className="mt-3 space-y-3">
        {soon.map(({ entry }) => {
          const round = roundLabel(entry.round_type, entry.round_number);
          return (
            <li key={entry.id} className="flex flex-wrap items-center gap-3">
              <CompanyLogo company={entry.company} size="md" />
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-sm font-medium">
                  {entry.company} · {entry.title}
                </p>
                <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">{[interviewWhen(entry.next_at), round].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to={interviewPrepPath(entry.id)} className={linkButton("secondary", "sm")} aria-label={`Prepare for ${entry.company}`}>
                  Prepare
                </Link>
                <Link to={copilotPath(entry.id)} className={linkButton("primary", "sm")} aria-label={`Start copilot for ${entry.company}`}>
                  <Rocket className="h-3.5 w-3.5" aria-hidden /> Start copilot
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
