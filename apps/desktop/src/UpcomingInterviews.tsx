import { useEffect, useState } from "react";
import type { InterviewSessionContext, JobTrackerEntry } from "@orbit/types";
import { CalendarIcon, X, contextSummary, cx, focusRing, interviewWhen, roundLabel, upcomingInterviews } from "@orbit/ui";
import { api } from "./api";

/**
 * Setup's "Upcoming interviews": the tracked jobs with an interview coming up (from the web app's Jobs AI tracker,
 * GET /v1/jobs/tracker). Picking one asks the server for that interview's context (POST .../session-context: the job
 * post and the resume version sent, saved once as documents; no AI, no credit) and fills the setup with it, so the
 * session starts with this job loaded and shows on the job afterwards. Nothing shows when there's none (or offline).
 */
export function UpcomingInterviews({
  picked,
  onPick,
  onClear,
}: {
  picked: InterviewSessionContext | null;
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

  const pick = async (entry: JobTrackerEntry) => {
    setBusy(entry.id);
    setError(null);
    try {
      onPick(await api.interviewSessionContext(entry.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load that interview.");
    } finally {
      setBusy(null);
    }
  };

  if (!entries?.length && !picked) return null;
  if (picked) {
    const loaded = contextSummary(picked);
    return (
      <section aria-label="Interview from your tracker" className="flex items-start gap-2 rounded-xl border border-indigo-300/60 bg-indigo-50/60 p-3 dark:border-indigo-800/60 dark:bg-indigo-950/30">
        <CalendarIcon className="mt-0.5 h-4 w-4 flex-none text-indigo-600 dark:text-indigo-300" aria-hidden />
        <div className="min-w-0 flex-1 text-xs">
          <p className="text-sm font-medium">{[picked.company, picked.round.label || picked.role].filter(Boolean).join(" · ")}</p>
          {loaded && <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">Loaded: {loaded}.</p>}
          {picked.notes.map((n) => (
            <p key={n} className="mt-0.5 text-amber-700 dark:text-amber-300">
              {n}
            </p>
          ))}
        </div>
        <button type="button" onClick={onClear} title="Don't use this interview" aria-label="Don't use this interview" className={cx("rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200", focusRing)}>
          <X className="h-3.5 w-3.5" />
        </button>
      </section>
    );
  }
  return (
    <fieldset className="space-y-1.5 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <legend className="px-1 text-xs font-medium">Upcoming interviews</legend>
      <p className="text-xs text-zinc-500">From your tracker in Jobs AI. Pick one to start with its job post and the resume you sent.</p>
      <ul className="space-y-1">
        {(entries ?? []).map((e) => {
          const when = [interviewWhen(e.next_at), roundLabel(e.round_type, e.round_number)].filter(Boolean).join(" · ");
          return (
            <li key={e.id}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void pick(e)}
                className={cx(
                  "flex w-full items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-left hover:border-indigo-400 hover:bg-indigo-50/40 disabled:opacity-60 dark:border-zinc-800 dark:hover:bg-indigo-950/20",
                  focusRing,
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {e.company} · {e.title}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">{when || "Interviewing · no date yet"}</span>
                </span>
                <span className="text-xs font-medium text-indigo-600 dark:text-indigo-300">{busy === e.id ? "Loading…" : "Use"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </fieldset>
  );
}
