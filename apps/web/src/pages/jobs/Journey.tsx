import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { JobTimelineEvent, OrbitSession } from "@orbit/types";
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
  association: "bg-zinc-400",
  application: "bg-sky-500",
  interview_round: "bg-violet-500",
  stage: "bg-emerald-500",
  next: "bg-emerald-400",
};

/**
 * One tracked job's journey, oldest first: saved, fit checks, the tailored resume, people, applied, rounds with the
 * company, where it stands and what's next (GET /v1/jobs/tracker/{id}/timeline). Loads when opened.
 */
type JourneyProps = { entryId: string; roundsOnly?: boolean; onLinked?: () => void };
export function Journey(props: JourneyProps) {
  return <OpportunityJourney key={props.entryId} {...props} />;
}

function OpportunityJourney({ entryId, roundsOnly = false, onLinked }: JourneyProps) {
  const scope = useRef(entryId); scope.current = entryId;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [sessions, setSessions] = useState<OrbitSession[] | null>(null);
  const [selected, setSelected] = useState("");
  const [picker, setPicker] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [events, setEvents] = useState<JobTimelineEvent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setEvents(null); setError(null); setSessions(null); setSelected(""); setPicker(false); setBusy(false);
    api.trackerTimeline(entryId).then((e) => live && setEvents(e), (err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [entryId, revision]);
  if (error && !events) return <div className="mt-2"><p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p><Button variant="secondary" onClick={() => setRevision((value) => value + 1)}>Retry journey</Button></div>;
  if (!events) return <Skeleton variant="line" count={3} label="Loading the journey" className="mt-2" />;
  const visible = roundsOnly ? events.filter((event) => event.kind === "round" || event.kind === "related_round").slice().reverse() : events;

  const context = new URLSearchParams({ job: entryId, career_from: roundsOnly ? "practice" : "timeline" });
  const associate = async (event: Pick<JobTimelineEvent, "session_id" | "detail">, remove = false) => {
    if (!event.session_id || busy) return;
    const job = entryId;
    if (!(await confirmDialog(remove ? {
      title: "Unlink this session from this opportunity?",
      body: `“${event.detail}” will stop counting here. Its original transcript, report and recorded context remain unchanged. You can review and link it again.`,
      confirmLabel: "Unlink session",
    } : {
      title: "Link this session to this opportunity?",
      body: `Review “${event.detail}” first. Matching names do not prove the session belongs to this job. Linking changes attribution only; it does not rewrite the original session context.`,
      confirmLabel: "Confirm association",
    }))) return;
    if (!mounted.current || scope.current !== job) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.call(`/v1/jobs/tracker/${encodeURIComponent(job)}/sessions/${remove ? "unlink" : "link"}`, { method: "POST", body: JSON.stringify({ session_id: event.session_id, confirmed: true }) });
      if (mounted.current && scope.current === job) {
        setNotice(remove ? "Session unlinked. Its report is preserved." : "Session linked after your review.");
        setRevision((value) => value + 1); onLinked?.();
      }
    } catch (failure) { if (mounted.current && scope.current === job) setError(errorText(failure)); }
    finally { if (mounted.current && scope.current === job) setBusy(false); }
  };
  const openPicker = async () => {
    const job = entryId;
    setPicker(true); setBusy(true); setError(null);
    try {
      const all = await api.listSessions();
      if (mounted.current && scope.current === job) setSessions(all.filter((session) => session.status === "ended" && !session.application_id));
    } catch (failure) { if (mounted.current && scope.current === job) setError(errorText(failure)); }
    finally { if (mounted.current && scope.current === job) setBusy(false); }
  };
  const sourceLabel = { candidate_recorded: "Recorded by you", executor_reported: "Executor report", outcome_uncertain: "Outcome uncertain", suggestion: "Unconfirmed suggestion", saved_record: "Saved record" };
  return (
    <div className="space-y-3">
    {notice && <p role="status" className="text-sm text-zinc-600 dark:text-zinc-300">{notice}</p>}
    {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
    {roundsOnly && !visible.length && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">No linked rounds yet. Start practice or review an existing completed session.</p>}
    <ol aria-label={roundsOnly ? "Rounds to review" : "Journey"} className="mt-3 space-y-2 border-l border-zinc-200 pl-4 dark:border-white/10">
      {visible.map((e, i) => (
        <li key={`${e.kind}-${e.at}-${i}`} className="relative text-xs">
          <span aria-hidden="true" className={cx("absolute -left-[1.3rem] top-1 h-2 w-2 rounded-full", DOT[e.kind], e.upcoming && "ring-2 ring-emerald-400/40")} />
          <span className="font-medium text-zinc-800 dark:text-zinc-100">
            {e.link ? (
              <Link to={(e.kind === "round" || e.kind === "related_round") ? careerToolHref(e.link, context) : e.link} className={cx("rounded hover:underline", focusRing)}>{e.title}{roundsOnly ? " · review" : ""}</Link>
            ) : (
              e.title
            )}
          </span>
          <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">{e.upcoming ? `on ${shortDate(e.at)}` : shortDate(e.at)}</span>
          {e.provenance && <span className="mt-1 block text-xs text-zinc-600 dark:text-zinc-400">{sourceLabel[e.provenance]}</span>}
          {e.kind === "round" && e.completed && <Button variant="ghost" disabled={busy} className="my-2" onClick={() => void associate(e, true)}>Unlink session</Button>}
          {e.kind === "related_round" && <div className="my-2"><p className="text-xs text-zinc-600 dark:text-zinc-400">Not counted toward this job. Review the session before linking it.</p><Button variant="secondary" disabled={busy} onClick={() => void associate(e)}>Review association</Button></div>}
          {e.detail && <span className="block break-words text-zinc-600 dark:text-zinc-300">{e.detail}</span>}
        </li>
      ))}
    </ol>
    <div className="border-t border-zinc-200 pt-3 dark:border-white/10">
      {!picker ? <Button variant="secondary" disabled={busy} onClick={() => void openPicker()}>Link a completed session</Button> : <div className="space-y-3">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">Recent completed sessions without an opportunity. Review the report first; a general session is not automatically evidence for this role.</p>
        {sessions === null ? <p role="status">{busy ? "Loading completed sessions…" : "Could not load sessions. Try again."}</p> : sessions.length === 0 ? <p className="text-sm">No unlinked completed sessions among your latest 200 sessions. Existing links remain in their own opportunity.</p> : <>
          <label className="block text-sm">Completed session<select value={selected} onChange={(event) => setSelected(event.target.value)} className={cx("mt-2 block min-h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-white p-2 dark:border-zinc-600 dark:bg-zinc-900", focusRing)}><option value="">Choose a session to review</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.title} · {shortDate(session.created_at)}</option>)}</select></label>
          {selected && <div className="flex flex-wrap gap-3"><Link className={cx("inline-flex min-h-11 items-center rounded text-sm underline", focusRing)} to={careerToolHref(`/sessions/${encodeURIComponent(selected)}`, context)}>Review selected report</Link><Button disabled={busy} onClick={() => void associate({ session_id: selected, detail: sessions.find((session) => session.id === selected)?.title ?? "Selected session" })}>Review and link session</Button></div>}
        </>}
        <Button variant="ghost" disabled={busy} onClick={() => { setPicker(false); setSelected(""); }}>Close session picker</Button>
      </div>}
    </div>
    </div>
  );
}
