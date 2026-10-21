import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { JobTimelineEvent } from "@orbit/types";
import { Button, Skeleton, confirmDialog, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { shortDate } from "./model";
import { careerToolHref } from "../../lib/opportunityTrail";

const DOT: Record<JobTimelineEvent["kind"], string> = {
  saved: "bg-zinc-400",
  fit: "bg-sky-400",
  resume: "bg-indigo-400",
  prep_doc: "bg-indigo-400",
  contact: "bg-violet-400",
  outreach: "bg-violet-400",
  applied: "bg-sky-500",
  round: "bg-amber-400",
  related_round: "bg-zinc-400",
  stage: "bg-emerald-500",
  next: "bg-emerald-400",
};

/**
 * One tracked job's journey, oldest first: saved, fit checks, the tailored resume, people, applied, rounds with the
 * company, where it stands and what's next (GET /v1/jobs/tracker/{id}/timeline). Loads when opened.
 */
export function Journey({ entryId, roundsOnly = false, onLinked }: { entryId: string; roundsOnly?: boolean; onLinked?: () => void }) {
  const [events, setEvents] = useState<JobTimelineEvent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setEvents(null); setError(null);
    api.trackerTimeline(entryId).then((e) => live && setEvents(e), (err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [entryId, revision]);
  if (error) return <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{error}</p>;
  if (!events) return <Skeleton variant="line" count={3} label="Loading the journey" className="mt-2" />;
  const visible = roundsOnly ? events.filter((event) => event.kind === "round" || event.kind === "related_round").slice().reverse() : events;
  if (roundsOnly && !visible.length) return <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">No rounds appear for this job yet. Start with a practice session, then return here to review it.</p>;
  const context = new URLSearchParams({ job: entryId, career_from: roundsOnly ? "practice" : "timeline" });
  const associate = async (event: JobTimelineEvent) => {
    if (!event.session_id || busy) return;
    if (!(await confirmDialog({ title: "Link this session to this opportunity?", body: `Review “${event.detail}” first. A matching company name alone does not show that it belongs to this job. Only confirm if this is the correct opportunity.`, confirmLabel: "Confirm association" }))) return;
    setBusy(true);
    try {
      await api.call(`/v1/jobs/tracker/${encodeURIComponent(entryId)}/sessions/link`, { method: "POST", body: JSON.stringify({ session_id: event.session_id, confirmed: true }) });
      setRevision((value) => value + 1); onLinked?.();
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  };
  return (
    <ol aria-label={roundsOnly ? "Rounds to review" : "Journey"} className="mt-3 space-y-2 border-l border-zinc-200 pl-4 dark:border-white/10">
      {visible.map((e, i) => (
        <li key={`${e.kind}-${e.at}-${i}`} className="relative text-xs">
          <span aria-hidden="true" className={cx("absolute -left-[1.3rem] top-1 h-2 w-2 rounded-full", DOT[e.kind], e.upcoming && "ring-2 ring-emerald-400/40")} />
          <span className="font-medium text-zinc-800 dark:text-zinc-100">
            {e.link ? (
              <Link to={e.kind === "round" ? careerToolHref(e.link, context) : e.link} className={cx("rounded hover:underline", focusRing)}>{e.title}{roundsOnly ? " · review" : ""}</Link>
            ) : (
              e.title
            )}
          </span>
          <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">{e.upcoming ? `on ${shortDate(e.at)}` : shortDate(e.at)}</span>
          {e.kind === "related_round" && <div className="my-2"><p className="text-xs text-zinc-600 dark:text-zinc-400">Not counted toward this job. Review the session before linking it.</p><Button variant="secondary" disabled={busy} onClick={() => void associate(e)}>Review association</Button></div>}
          {e.detail && <span className="block truncate text-zinc-600 dark:text-zinc-300">{e.detail}</span>}
        </li>
      ))}
    </ol>
  );
}
