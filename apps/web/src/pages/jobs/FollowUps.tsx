import { useId, useState } from "react";
import { Link } from "react-router-dom";
import type { JobTrackerEntry } from "@orbit/types";
import { BookmarkCheck, CalendarIcon, Check, Plus, Send, Target, cx, focusRing } from "@orbit/ui";
import { Card, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync, type AsyncState } from "../../lib/useAsync";
import { textLink } from "./links";
import { STATUS_LABEL, followUps, inAWeek, nextUp, practiceLink, shortDate, type FollowUp } from "./model";
import { JOBS_TRACKER, jobPath, outreachPath } from "./paths";

/** The tracker with "Add a job you found elsewhere" open. */
export const ADD_JOB_PATH = `${JOBS_TRACKER}?add=1`;

export interface FollowUpsProps {
  /** The tracker, when the page already has it (Jobs AI's pages): changes here show there at once. Else it's loaded
   * here, sharing the "job-tracker" cache with Home and Jobs AI. */
  tracker?: AsyncState<JobTrackerEntry[]>;
  /** How many to show (the rest: "N more on your tracker"). */
  limit?: number;
  /** Render nothing when nothing is tracked or nothing is due (Home decides where the space goes). */
  hideWhenEmpty?: boolean;
  className?: string;
}

/**
 * "Follow-ups": what's due on the job tracker today (model.ts `followUps`). "Follow up with Razorpay: applied 7 days
 * ago" (write it in Outreach, or mark it done for a week), "Interview with Bosch tomorrow" (practise for it now).
 * Self-contained, no required props: Home mounts it as is. Never shows an empty state while loading.
 */
export function FollowUps({ tracker, ...rest }: FollowUpsProps = {}) {
  return tracker ? <FollowUpsCard tracker={tracker} {...rest} /> : <OwnTracker {...rest} />;
}

export default FollowUps;

function OwnTracker(props: Omit<FollowUpsProps, "tracker">) {
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");
  return <FollowUpsCard tracker={tracker} {...props} />;
}

function FollowUpsCard({ tracker, limit = 3, hideWhenEmpty = false, className }: FollowUpsProps & { tracker: AsyncState<JobTrackerEntry[]> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const entries = tracker.data;
  const due = entries ? followUps(entries) : [];
  const later = entries && !due.length ? nextUp(entries) : null;

  if (!entries && tracker.loading) {
    if (hideWhenEmpty) return null;
    return (
      <Shell className={className}>
        {/* TODO(ws-a): the design layer's Skeleton (delayed show, minimum time) once it lands. */}
        <div className="mt-3 space-y-2" aria-hidden="true">
          {[72, 56].map((w) => (
            <div key={w} className="skeleton-line h-3 motion-safe:animate-shimmer" style={{ width: `${w}%` }} />
          ))}
        </div>
      </Shell>
    );
  }
  if (!entries) {
    return hideWhenEmpty ? null : (
      <Shell className={className}>
        <div className="mt-3">
          <ErrorNote onRetry={tracker.reload}>{errorText(tracker.error)}</ErrorNote>
        </div>
      </Shell>
    );
  }
  if (!entries.length || !due.length) {
    if (hideWhenEmpty) return null;
    return (
      <Shell className={className} link={entries.length > 0}>
        {entries.length ? (
          <p className="mt-2 flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <span>
              No follow-ups due. Nice.
              {later && (
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  Next: {shortDate(later.next_at)}, {later.title} at {later.company}
                </span>
              )}
            </span>
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Track the jobs you apply to, even on Naukri or LinkedIn, and Orbit tells you when to follow up.
            </p>
            <Link to={ADD_JOB_PATH} className={cx(textLink, "mt-2 inline-flex items-center gap-1 text-sm")}>
              <Plus className="h-4 w-4" aria-hidden /> Add a job you applied to
            </Link>
          </>
        )}
      </Shell>
    );
  }

  const done = async (item: FollowUp) => {
    setBusy(item.entry.id);
    setError(null);
    try {
      const saved = await api.updateTrackedJob(item.entry.id, { next_at: inAWeek() });
      tracker.setData((prev) => prev?.map((e) => (e.id === saved.id ? saved : e)) ?? null);
      // TODO(ws-a): a toast with Undo ("Next follow-up in a week").
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const shown = due.slice(0, limit);
  return (
    <Shell className={className} link count={due.length}>
      <ul className="mt-3 space-y-2.5">
        {shown.map((item) => (
          <li key={item.entry.id} className="rounded-xl bg-zinc-500/[0.06] p-3 dark:bg-white/[0.03]">
            <p className="flex items-start gap-2 text-sm">
              {item.interview ? (
                <Target className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" aria-hidden />
              ) : item.kind === "follow_up" ? (
                <Send className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" aria-hidden />
              ) : (
                <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className={cx("font-medium", item.kind === "overdue" && "text-amber-800 dark:text-amber-200")}>{item.text}</span>
                <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {item.entry.title} · {STATUS_LABEL[item.entry.status]}
                </span>
              </span>
            </p>
            {/* Each action at least 24 px tall (WCAG 2.5.8), so a thumb can hit it. */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 pl-6 text-xs [&>*]:inline-flex [&>*]:min-h-6 [&>*]:items-center">
              {item.interview ? (
                item.kind === "overdue" ? (
                  <Link to={JOBS_TRACKER} className={textLink}>
                    How did it go? Update it
                  </Link>
                ) : (
                  <Link to={practiceLink(item.entry, jobPath)} className={textLink}>
                    Practise now
                  </Link>
                )
              ) : (
                <>
                  <Link to={outreachPath({ job: item.entry.listing_id, resume: item.entry.resume_id })} className={textLink}>
                    Write the follow-up
                  </Link>
                  <button
                    type="button"
                    disabled={busy === item.entry.id}
                    onClick={() => void done(item)}
                    className={cx("font-medium text-zinc-600 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-300 dark:hover:text-white", focusRing)}
                  >
                    {busy === item.entry.id ? "Saving…" : "Done · remind me in a week"}
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {due.length > shown.length && (
        <Link to={JOBS_TRACKER} className={cx(textLink, "mt-3 inline-block text-xs")}>
          {due.length - shown.length} more on your tracker
        </Link>
      )}
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, className, link = false, count }: { children: React.ReactNode; className?: string; link?: boolean; count?: number }) {
  const titleId = useId();
  return (
    <Card className={cx("!p-4", className)}>
      <section aria-labelledby={titleId}>
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="flex flex-1 items-center gap-2 font-display text-sm font-semibold">
            <BookmarkCheck className="h-4 w-4 text-indigo-500" aria-hidden /> Follow-ups
            {count ? <span className="rounded-full bg-indigo-500/10 px-1.5 text-xs tabular-nums text-indigo-700 dark:text-indigo-200">{count}</span> : null}
          </h2>
          {link && (
            <Link to={JOBS_TRACKER} className={cx(textLink, "text-xs")}>
              Open tracker
            </Link>
          )}
        </div>
        {children}
      </section>
    </Card>
  );
}
