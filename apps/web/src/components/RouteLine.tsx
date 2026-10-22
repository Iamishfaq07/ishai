import type { JobStatus } from "@orbit/types";
import { cx } from "@orbit/ui";

/**
 * A job's route (the Route map direction): its stages as stops on one line. Stops already reached are filled, the
 * next stop is ringed in the accent, the rest are hollow. A closed job (no, withdrawn) greys the whole line. The words
 * always carry the stage too, so nothing depends on colour.
 */

export const ROUTE_STOPS: { status: JobStatus; label: string }[] = [
  { status: "saved", label: "Saved" },
  { status: "applied", label: "Applied" },
  { status: "interviewing", label: "Interviews" },
  { status: "offer", label: "Offer" },
];

const CLOSED: JobStatus[] = ["rejected", "withdrawn"];

/** How far along the route a status is: the index of the last stop reached, or -1 when the job is closed. */
export function routeIndex(status: JobStatus): number {
  if (CLOSED.includes(status)) return -1;
  if (status === "hired") return ROUTE_STOPS.length - 1;
  return Math.max(0, ROUTE_STOPS.findIndex((s) => s.status === status));
}

/** The next stop's name, or null at the end of the route or when it's closed. */
export function nextStop(status: JobStatus): string | null {
  const i = routeIndex(status);
  return i < 0 || i >= ROUTE_STOPS.length - 1 ? null : ROUTE_STOPS[i + 1]!.label;
}

export function RouteLine({ status, labels = false, className }: { status: JobStatus; labels?: boolean; className?: string }) {
  const at = routeIndex(status);
  const closed = at < 0;
  const summary = closed ? "Route closed" : status === "hired" ? "Hired" : `At ${ROUTE_STOPS[at]!.label}, stop ${at + 1} of ${ROUTE_STOPS.length}${nextStop(status) ? `; next: ${nextStop(status)}` : ""}`;
  const dot = labels ? "h-3 w-3" : "h-2 w-2";
  return <ol aria-label={summary} className={cx("flex items-start", className)}>
    {ROUTE_STOPS.map((stop, i) => {
      const reached = !closed && i <= at;
      const next = !closed && i === at + 1;
      return <li key={stop.status} className={cx("relative flex flex-1 flex-col items-center", labels ? "min-w-16" : "")} aria-current={!closed && i === at ? "step" : undefined}>
        {i < ROUTE_STOPS.length - 1 && <span aria-hidden className={cx("absolute left-1/2 h-0.5 w-full", !closed && i < at ? "bg-indigo-600 dark:bg-indigo-400" : "bg-zinc-300 dark:bg-zinc-700")}
          style={{ top: labels ? "5px" : "3px" }} />}
        <span aria-hidden className={cx("relative z-10 rounded-full", dot,
          reached ? "bg-indigo-600 dark:bg-indigo-400"
            : next ? "bg-white ring-2 ring-indigo-600 dark:bg-zinc-950 dark:ring-indigo-400"
              : "bg-white ring-1 ring-zinc-300 dark:bg-zinc-950 dark:ring-zinc-600")} />
        {labels && <span className={cx("mt-1.5 whitespace-nowrap text-[13px] leading-tight",
          !closed && i === at ? "font-semibold text-zinc-900 dark:text-zinc-100" : next ? "text-indigo-700 dark:text-indigo-300" : "text-zinc-600 dark:text-zinc-400")}>{stop.label}</span>}
      </li>;
    })}
  </ol>;
}
