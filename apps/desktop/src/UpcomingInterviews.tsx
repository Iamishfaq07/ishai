import { useEffect, useRef, useState } from "react";
import type { InterviewSessionContext, JobTrackerEntry } from "@orbit/types";
import { CalendarIcon, X, contextSummary, cx, focusRing, interviewWhen, roundLabel, upcomingInterviews } from "@orbit/ui";
import { api } from "./api";

/**
 * Setup's "Upcoming interviews": the tracked jobs with an interview coming up (from the web app's Jobs AI tracker,
 * GET /v1/jobs/tracker). Picking one asks the server for that interview's context (POST .../session-context: the job
 * post and the resume version sent, saved once as documents; no AI, no credit) and fills the setup with it, so the
 * session starts with this job loaded and shows on the job afterwards. Nothing shows when there's none (or offline).
 * `initialId` (Home's "Prepare") picks that interview as Setup opens.
 */
export function UpcomingInterviews({
  picked,
  initialId,
  onPick,
  onClear,
}: {
  picked: InterviewSessionContext | null;
  initialId?: string | undefined;
  onPick: (ctx: InterviewSessionContext) => void;
  onClear: () => void;
}) {
  const [entries, setEntries] = useState<JobTrackerEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    api
      .jobTracker()
      .then((list) => !gone && setEntries(upcomingInterviews(list)))
      .catch(() => !gone && setEntries([]));
    return () => {
      gone = true;
    };
  }, []);

  const pick = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      onPick(await api.interviewSessionContext(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load that interview.");
    } finally {
      setBusy(null);
    }
  };
  const started = useRef(false);
  useEffect(() => {
    if (!initialId || started.current) return;
    started.current = true;
    void pick(initialId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  if (picked) {
    const loaded = contextSummary(picked);
    return (
      <section aria-label="Interview from your tracker" className="flex items-start gap-3 rounded-xl border border-indigo-500/40 bg-indigo-500/[0.05] p-3 dark:border-indigo-400/40">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <CalendarIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 text-xs">
          <p className="text-sm font-semibold">{[picked.company, picked.round.label || picked.role].filter(Boolean).join(" · ")}</p>
          {loaded && <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">Loaded: {loaded}.</p>}
          {picked.notes.map((n) => (
            <p key={n} className="mt-0.5 text-amber-700 dark:text-amber-300">
              {n}
            </p>
          ))}
        </div>
        <button
          type="button"
          onClick={onClear}
          title="Don't use this interview"
          aria-label="Don't use this interview"
          className={cx("inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-zinc-200", focusRing)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </section>
    );
  }
  if (!entries?.length) return error ? <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p> : null;
  return (
    <section aria-labelledby="upcoming-title" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="upcoming-title" className="text-sm font-semibold">
          Upcoming interviews
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">From Jobs AI: starts with the job post and the resume you sent</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {entries.map((e) => {
          const when = [interviewWhen(e.next_at), roundLabel(e.round_type, e.round_number)].filter(Boolean).join(" · ");
          return (
            <li key={e.id}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void pick(e.id)}
                className={cx(
                  "flex w-full items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 text-left transition-colors duration-quick hover:border-zinc-300 hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-60 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/[0.03]",
                  focusRing,
                )}
              >
                <CalendarIcon className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {e.company} · {e.title}
                  </span>
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{when || "Interviewing · no date yet"}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-indigo-700 dark:text-indigo-300">{busy === e.id ? "Loading…" : "Use"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
    </section>
  );
}
