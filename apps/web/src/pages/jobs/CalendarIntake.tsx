import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, ErrorNote, Field, Input, Select, Textarea, dateTimeInput, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { missionPath } from "./paths";

interface Job { version: string; title: string; company: string; status: string; next_at: string | null; editable: boolean }
interface Event { id: string; title: string; start_at: string; time_zone: string; source_quote: string; tentative: boolean }
interface Preview { version: string; events: Event[]; editable: boolean }
const link = cx("inline-flex min-h-11 items-center rounded text-sm font-semibold text-indigo-700 underline underline-offset-4 dark:text-indigo-300", focusRing);

/** Import review only; the existing human-confirmed tracker endpoint remains the sole writer. */
export function CalendarIntake({ entryId, onSaved }: { entryId: string; onSaved: () => void }) {
  const id = useId();
  const base = `/v1/jobs/tracker/${encodeURIComponent(entryId)}`;
  const [job, setJob] = useState<Job | null>(null);
  const [calendar, setCalendar] = useState("");
  const [proposal, setProposal] = useState<Preview | null>(null);
  const [selected, setSelected] = useState("");
  const [interviewing, setInterviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"load" | "file" | "preview" | "save" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const seq = useRef(0);
  const fileSeq = useRef(0);
  const active = useRef(false);
  const busyRef = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const invalidate = () => { setProposal(null); setSelected(""); setConfirmed(false); setInterviewing(false); setSaved(false); };
  const refresh = useCallback(async () => {
    const request = ++seq.current; busyRef.current = true; setBusy("load"); setError(null); setProposal(null); setConfirmed(false);
    try { const next = await api.call<Job>(`${base}/message-update`); if (request === seq.current) setJob(next); }
    catch (e) { if (request === seq.current) { setJob(null); setError(errorText(e)); } }
    finally { if (request === seq.current) { busyRef.current = false; setBusy(null); } }
  }, [base]);
  const cancel = useCallback(() => { active.current = false; seq.current++; fileSeq.current++; }, []);
  useEffect(() => { active.current = true; void refresh(); return cancel; }, [refresh, cancel]);
  useEffect(() => {
    const onReturn = () => { if (!busyRef.current && document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onReturn); document.addEventListener("visibilitychange", onReturn);
    return () => { window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); };
  }, [refresh]);
  const choose = (eventId: string, events = proposal?.events ?? []) => {
    const event = events.find((e) => e.id === eventId);
    setSelected(event ? eventId : ""); setConfirmed(false); setInterviewing(false);
  };
  const readFile = async (file: File | undefined) => {
    if (!file || busyRef.current) return;
    const request = ++fileSeq.current; invalidate(); setError(null); setCalendar(""); busyRef.current = true; setBusy("file");
    try {
      if (file.size > 131072) throw new Error("Choose an invitation smaller than 128 KiB.");
      const text = await file.text();
      if (active.current && request === fileSeq.current) setCalendar(text);
    } catch (e) { if (active.current && request === fileSeq.current) setError(errorText(e)); }
    finally { if (active.current && request === fileSeq.current) { busyRef.current = false; setBusy(null); } }
  };
  const preview = async () => {
    if (!job || busyRef.current) return;
    const request = ++seq.current; busyRef.current = true; setBusy("preview"); setError(null); invalidate();
    try {
      const next = await api.call<Preview>(`${base}/calendar-preview`, { method: "POST", body: JSON.stringify({ calendar, version: job.version }) });
      if (request !== seq.current) return;
      setProposal(next); if (next.events.length === 1) choose(next.events[0]!.id, next.events);
      requestAnimationFrame(() => { if (active.current) { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "start" }); } });
    } catch (e) { if (request === seq.current) setError(errorText(e)); }
    finally { if (request === seq.current) { busyRef.current = false; setBusy(null); } }
  };
  const event = proposal?.events.find((e) => e.id === selected);
  const nextAt = event?.start_at ?? null;
  const date = nextAt ? dateTimeInput(nextAt) : "";
  const dateChanged = Boolean(nextAt && new Date(nextAt).valueOf() !== new Date(job?.next_at ?? "").valueOf());
  const stageChanged = interviewing && job?.status !== "interviewing";
  const save = async () => {
    if (!job || !proposal || !event || !confirmed || !nextAt || (!dateChanged && !stageChanged) || busyRef.current) return;
    const request = ++seq.current; busyRef.current = true; setBusy("save"); setError(null);
    try {
      const next = await api.call<Job>(`${base}/message-update/confirm`, { method: "POST", body: JSON.stringify({ version: proposal.version,
        confirmed: true, ...(dateChanged ? { next_at: nextAt } : {}), ...(stageChanged ? { status: "interviewing" } : {}) }) });
      if (request !== seq.current) return;
      setJob(next); setCalendar(""); invalidate(); setSaved(true); onSaved();
    } catch (e) { if (request === seq.current) setError(errorText(e)); }
    finally { if (request === seq.current) { busyRef.current = false; setBusy(null); } }
  };
  return <section aria-label="Review a calendar invitation" className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
    <header><h3 className="font-display text-lg font-semibold">Invitation → reviewed date → preparation</h3><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Import a calendar file for this job. Review the time and stage before anything changes.</p></header>
    {error && <ErrorNote onRetry={() => void refresh()}>{error} Your pasted invitation stays here for review.</ErrorNote>}
    {!job ? <p role="status">{busy ? "Opening the saved job…" : "Refresh to load this job."}</p> : <>
      <p className="text-sm font-semibold">{job.title} · {job.company}</p>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Saved stage: {job.status} · Next date: {job.next_at ? new Date(job.next_at).toLocaleString() : "None"}</p>
      {!job.editable && <p className="text-sm">This job is closed. You can preview an invitation; correct or reopen the job in the tracker before saving a new date.</p>}
      {saved && <div role="status" className="rounded-xl bg-indigo-500/10 p-4 motion-safe:animate-menu-in"><h4 className="font-semibold">Interview update saved</h4><p className="mt-2 text-sm">Your saved-date actions use the reviewed time. The invitation text has been cleared.</p><Link className={link} to={`${missionPath(entryId)}?guide=1&tab=plan`}>Open preparation for this job</Link></div>}
      <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-3"><legend className="sr-only">Import an invitation</legend>
        <Field htmlFor={`${id}-file`} label="Choose an .ics invitation"><input id={`${id}-file`} type="file" accept=".ics,text/calendar" className="block min-h-11 w-full min-w-0 text-sm" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void readFile(file); }} /></Field>
        <Field htmlFor={`${id}-text`} label="Or paste iCalendar text"><Textarea id={`${id}-text`} rows={5} maxLength={131072} value={calendar} onChange={(e) => { setCalendar(e.target.value); invalidate(); }} /></Field>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">Free, no AI call. Up to 128 KiB and 20 standalone events. UTC and IANA time zones are supported; custom zone blocks, recurring/cancelled events and ambiguous times need manual review. Links, attendees, alarms and attachments are never opened. The calendar body is not stored.</p>
        <Button disabled={calendar.trim().length < 30} loading={busy === "preview"} onClick={() => void preview()}>Review invitation</Button>
      </fieldset>
      {proposal && <div className="space-y-3 rounded-xl bg-zinc-500/5 p-4 motion-safe:animate-menu-in">
        <h4 ref={heading} tabIndex={-1} className="scroll-mt-28 rounded font-semibold outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Review the event and changes</h4>
        <Field htmlFor={`${id}-event`} label="Event to use"><Select id={`${id}-event`} disabled={Boolean(busy)} value={selected} onChange={(e) => choose(e.target.value)}><option value="">Choose one event</option>{proposal.events.map((e) => <option key={e.id} value={e.id}>{e.title} · {new Date(e.start_at).toLocaleString()}</option>)}</Select></Field>
        {event && <><p className="text-sm">Source time zone: <strong>{event.time_zone}</strong>. {event.tentative && "This event is marked tentative; verify it before recording an interview."}</p><blockquote className="break-words border-l-2 border-indigo-400 pl-3 text-xs">{event.source_quote}</blockquote>
          <Link className={link} to={`${missionPath(entryId)}?guide=1&tab=interview`}>Edit a different time manually in this job</Link>
          <fieldset disabled={Boolean(busy) || !job.editable} className="min-w-0 space-y-3">
            <Field htmlFor={`${id}-date`} label="Invitation time (your browser’s time zone)"><Input id={`${id}-date`} type="datetime-local" value={date} readOnly /></Field>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={interviewing} onChange={(e) => { setInterviewing(e.target.checked); setConfirmed(false); }} />Mark this job as interviewing</label>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">Stage: {job.status} → {stageChanged ? "interviewing" : "keep current"}. Date: {nextAt ? new Date(nextAt).toLocaleString() : "Choose a time"}. Mark interviewing only for a real confirmed interview; the event does not verify its sender or job match.</p>
            {nextAt && new Date(nextAt).valueOf() < Date.now() && <p className="text-sm">This time is in the past. Check whether a rescheduled invitation is available.</p>}
            {!dateChanged && !stageChanged && <p className="text-sm">These choices are already saved. No duplicate update is needed.</p>}
            <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I verified this event belongs to this job and confirm the date and stage above.</label>
            <Button disabled={!confirmed || !nextAt || (!dateChanged && !stageChanged)} loading={busy === "save"} onClick={() => void save()}>Save reviewed invitation</Button>
          </fieldset>
        </>}
      </div>}
    </>}
  </section>;
}
