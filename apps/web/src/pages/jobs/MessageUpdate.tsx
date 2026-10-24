import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, ErrorNote, Field, Input, Select, Textarea, cx, focusRing, dateTimeInput, fromDateTimeInput } from "@orbit/ui";
import { useCandidateDraft } from "../../lib/useCandidateDraft";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useJobsAi } from "./JobsAi";

const EmailHistory = lazy(() => import("./EmailImportHistory").then((m) => ({ default: m.EmailImportHistory })));

const Calendar = lazy(() => import("./CalendarIntake").then((m) => ({ default: m.CalendarIntake })));

interface ImportedEmail { message: string; sender: string; subject: string; sent_at: string; source_receipt: string }
interface SavedJob { version: string; id: string; title: string; company: string; status: string; next_at: string | null; editable: boolean }
interface Proposal { version: string; source: string; event: string; summary: string; source_quote: string; suggested_status: string | null; date: { value: string; source_quote: string } | null; editable: boolean }
const link = cx("inline-flex min-h-11 items-center rounded text-sm font-semibold text-indigo-700 underline underline-offset-4 dark:text-indigo-300", focusRing);
const STAGES = [["applied", "Applied"], ["interviewing", "Interviewing"], ["offer", "Offer received"], ["rejected", "Rejected"]];
const LABELS: Record<string, string> = { application_received: "Application acknowledgement", interview: "Interview invitation", offer: "Offer message", rejected: "Rejection message", needs_reply: "A reply may be needed", other: "Needs manual review" };

export function MessageInbox() {
  const { tracker } = useJobsAi();
  const [params, setParams] = useSearchParams();
  const selected = params.get("job") ?? "";
  const calendar = params.get("input") === "calendar";
  return <section aria-label="Employer message helper" className="min-w-0 space-y-4">
    <header><h2 className="font-display text-xl font-semibold">Turn a reply into your next step</h2><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Choose the job, paste the relevant message and review changes before saving. Keep interviews and application progress together.</p></header>
    {tracker.error && <ErrorNote onRetry={tracker.reload}>{errorText(tracker.error)}</ErrorNote>}
    {!tracker.data ? <p role="status">Opening your tracked jobs…</p> : !tracker.data.length ? <p className="text-sm">Add the job to your tracker first. <Link className={link} to="/jobs/tracker?add=1">Add a job</Link></p> : <>
      <Field htmlFor="message-job" label="1. Choose the job this message is about"><Select id="message-job" value={selected} onChange={(event) => { const query = new URLSearchParams(params); query.set("job", event.target.value); setParams(query); }}><option value="">Choose a tracked job</option>{tracker.data.map((job) => <option key={job.id} value={job.id}>{job.title} · {job.company}</option>)}</Select></Field>
      <div role="group" aria-label="Update source" className="flex flex-wrap gap-2">{[false, true].map((value) => <Button key={String(value)} variant={calendar === value ? "primary" : "secondary"} aria-pressed={calendar === value} onClick={() => { const next = new URLSearchParams(params); if (value) next.set("input", "calendar"); else next.delete("input"); setParams(next); }}>{value ? "Calendar invitation" : "Employer message"}</Button>)}</div>
      {selected && (calendar ? <Suspense fallback={<p role="status">Opening invitation review…</p>}><Calendar key={selected} entryId={selected} onSaved={tracker.reload} /></Suspense> : <MessageUpdate key={selected} entryId={selected} onSaved={tracker.reload} />)}
    </>}
  </section>;
}

export function MessageUpdate({ entryId, onSaved }: { entryId: string; onSaved: () => void }) {
  const id = useId();
  const base = `/v1/jobs/tracker/${encodeURIComponent(entryId)}/message-update`;
  const [job, setJob] = useState<SavedJob | null>(null);
  const [message, setMessage] = useCandidateDraft("reply", entryId);
  const [imported, setImported] = useState<ImportedEmail | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [stage, setStage] = useState("");
  const [useStage, setUseStage] = useState(false);
  const [date, setDate] = useState("");
  const [useDate, setUseDate] = useState(false);
  const [clearDate, setClearDate] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"load" | "rules" | "ai" | "save" | "import" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const seq = useRef(0);
  const active = useRef(true);
  const busyRef = useRef(true);
  const review = useRef<HTMLHeadingElement>(null);
  const invalidate = () => { setProposal(null); setConfirmed(false); setSaved(false); };
  const refresh = useCallback(async () => {
    const request = ++seq.current; busyRef.current = true; setBusy("load"); setProposal(null); setConfirmed(false); setJob(null); setError(null);
    try { const next = await api.call<SavedJob>(base); if (request === seq.current) setJob(next); }
    catch (e) { if (request === seq.current) setError(errorText(e)); }
    finally { if (request === seq.current) { busyRef.current = false; setBusy(null); } }
  }, [base]);
  const cancel = useCallback(() => { seq.current++; active.current = false; }, []);
  useEffect(() => { active.current = true; void refresh(); return cancel; }, [refresh, cancel]);
  useEffect(() => {
    const onReturn = () => { if (document.visibilityState === "visible" && !busyRef.current && !(document.activeElement instanceof HTMLInputElement && document.activeElement.type === "file")) void refresh(); };
    window.addEventListener("focus", onReturn); document.addEventListener("visibilitychange", onReturn);
    return () => { window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); };
  }, [refresh]);
  const analyze = async (mode: "rules" | "ai") => {
    if (!job || busyRef.current) return;
    const request = ++seq.current; busyRef.current = true; setBusy(mode); setError(null); invalidate();
    try {
      const result = await api.call<Proposal>(`${base}/preview`, { method: "POST", timeoutMs: 70_000, body: JSON.stringify({ message: message.trim(), mode, version: job.version, source_receipt: imported?.source_receipt ?? null }) });
      if (request !== seq.current) return;
      setProposal(result); setStage(result.suggested_status ?? ""); setUseStage(Boolean(result.suggested_status && result.suggested_status !== job.status));
      setDate(result.date ? dateTimeInput(result.date.value) : ""); setUseDate(false); setClearDate(false);
      requestAnimationFrame(() => { if (active.current) { review.current?.focus({ preventScroll: true }); review.current?.scrollIntoView({ block: "start" }); } });
    } catch (e) { if (request === seq.current) setError(errorText(e)); }
    finally { if (request === seq.current) { busyRef.current = false; setBusy(null); } }
  };
  const save = async () => {
    if (!job || !proposal || !confirmed || busyRef.current) return;
    const request = ++seq.current; busyRef.current = true; setBusy("save"); setError(null);
    try {
      const result = await api.call<SavedJob>(`${base}/confirm`, { method: "POST", body: JSON.stringify({ version: proposal.version, confirmed: true,
        source_receipt: imported?.source_receipt ?? null, status: useStage ? stage : null, next_at: useDate ? fromDateTimeInput(date) : null, clear_next: clearDate }) });
      if (request !== seq.current) return;
      setJob(result); setMessage(""); setImported(null); setHistoryRevision((n) => n + 1); setProposal(null); setConfirmed(false); setSaved(true); onSaved();
    } catch (e) { if (request === seq.current) setError(errorText(e)); }
    finally { if (request === seq.current) { busyRef.current = false; setBusy(null); } }
  };
  const importEmail = async (file: File) => {
    if (!job || busyRef.current) return;
    if (file.size > 512000) { setError("Choose an .eml file of at most 512 KB."); return; }
    if (message.trim() && !window.confirm("Replace your current message draft with the imported email?")) return;
    const request = ++seq.current; busyRef.current = true; setBusy("import"); setError(null); invalidate();
    try {
      const form = new FormData(); form.append("file", file);
      const result = await api.call<ImportedEmail>(`${base}/import`, { method: "POST", body: form });
      if (request !== seq.current) return;
      setMessage(result.message); setImported(result);
    } catch (e) { if (request === seq.current) setError(errorText(e)); }
    finally { if (request === seq.current) { busyRef.current = false; setBusy(null); } }
  };
  const ready = Boolean(confirmed && ((useStage && stage && stage !== job?.status) || (useDate && date) || clearDate));
  return <section aria-label="Review an employer message" className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
    {error && <ErrorNote onRetry={() => void refresh()}>{error} Your message stays here; refresh to review the latest job.</ErrorNote>}
    {!job ? <p role="status">{busy ? "Opening the saved job…" : "Refresh to open this job."}</p> : <>
      <div><p className="font-semibold">{job.title} · {job.company}</p><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Current stage: {job.status}{job.next_at ? ` · Saved date: ${new Date(job.next_at).toLocaleString()}` : ""}</p></div>
      {saved && <div role="status" className="rounded-xl bg-indigo-500/10 p-4 motion-safe:animate-menu-in"><h3 className="font-semibold">Reviewed changes saved</h3><p className="mt-2 text-sm">Your tracker and saved-date actions now use these changes. The pasted message has been cleared.</p><Link className={link} to={`/jobs/mission/${entryId}?guide=1&tab=${job.status === "interviewing" ? "interview" : ["offer", "rejected"].includes(job.status) ? "offer" : "timeline"}`}>Continue with this job</Link></div>}
      {!job.editable && <p className="text-sm">This job is closed. Keep its current outcome here; use the tracker if you need to correct or reopen it. <Link className={link} to="/jobs/tracker">Open tracker</Link></p>}
      <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-3"><legend className="sr-only">Paste and interpret a message</legend>
        <Field htmlFor={`${id}-email`} label="Import an exported email (.eml, up to 512 KB)"><Input id={`${id}-email`} type="file" accept=".eml,message/rfc822" onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = ""; if (file) void importEmail(file);
        }} /></Field>
        {busy === "import" && <p role="status">Reading the email file…</p>}
        {imported && <div className="rounded-lg bg-zinc-500/5 p-3 text-sm"><p className="font-medium">Imported email · check it's from this employer and about this job</p>
          <p className="break-words">From: {imported.sender || "Not stated"}</p><p className="break-words">Subject: {imported.subject || "Not stated"}</p>
          {imported.sent_at && <p className="break-words">Sent {imported.sent_at} (the email's date, not an interview date)</p>}
          <p className="mt-2 text-xs">Review it within 30 minutes. Orbit keeps only the sender, subject and date, so the same email isn't imported twice: not the message itself or its attachments.</p></div>}
        <Field htmlFor={`${id}-message`} label="2. Paste the relevant employer message"><Textarea id={`${id}-message`} value={message} maxLength={10000} rows={5} onChange={(event) => { setMessage(event.target.value); setImported(null); invalidate(); }} placeholder="Paste the latest relevant reply, without unrelated email history." /></Field>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">The free review doesn't use AI. "Ask AI" sends this text to Orbit's AI to read it. The message isn't saved, attachments are ignored and links aren't opened.</p>
        <div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={!message} onClick={() => { setMessage(""); setImported(null); invalidate(); }}>Discard draft</Button><Button disabled={message.trim().length < 20} loading={busy === "rules"} onClick={() => void analyze("rules")}>Review message for free</Button><Button variant="secondary" disabled={message.trim().length < 20} loading={busy === "ai"} onClick={() => void analyze("ai")}>Ask AI to interpret</Button></div>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">AI: up to 5 a day. Orbit can't confirm who sent a pasted message.</p>
      </fieldset>
      {proposal && <div className="space-y-4 rounded-xl bg-zinc-500/5 p-4 motion-safe:animate-menu-in">
        <h3 ref={review} tabIndex={-1} className="scroll-mt-28 rounded font-semibold outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">3. Review suggested changes</h3>
        <p className="text-sm font-medium">{proposal.source === "rules" ? "Pattern suggestion" : proposal.source === "mock" ? "Demo AI suggestion" : "AI suggestion"} · {LABELS[proposal.event]}</p>
        <blockquote className="border-l-2 border-indigo-400 pl-3 text-sm whitespace-pre-wrap break-words">{proposal.source_quote}</blockquote><p className="text-sm">{proposal.summary}</p>
        {proposal.editable && <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-3"><legend className="sr-only">Choose changes to save</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={useStage} onChange={(event) => { setUseStage(event.target.checked); setConfirmed(false); }} />Update tracker stage</label>
          <Field htmlFor={`${id}-stage`} label="New tracker stage"><Select id={`${id}-stage`} value={stage} disabled={!useStage} onChange={(event) => { setStage(event.target.value); setConfirmed(false); }}><option value="">Choose a stage</option>{STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
          {proposal.date ? <p className="text-xs">Explicit date found: <q>{proposal.date.source_quote}</q>. Check the date and time below in your browser’s time zone.</p> : <p className="text-xs">No single ISO date with an explicit time zone was found. Enter a confirmed time if needed; relative dates are not guessed.</p>}
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={useDate} onChange={(event) => { setUseDate(event.target.checked); setClearDate(false); setConfirmed(false); }} />Set a confirmed next date</label>
          <Field htmlFor={`${id}-date`} label="Next date and time (your browser’s time zone)"><Input id={`${id}-date`} type="datetime-local" disabled={!useDate} value={date} onChange={(event) => { setDate(event.target.value); setConfirmed(false); }} /></Field>
          {job.next_at && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={clearDate} onChange={(event) => { setClearDate(event.target.checked); setUseDate(false); setConfirmed(false); }} />Clear the currently saved next date</label>}
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Stage: {job.status} → {useStage && stage ? stage : "keep current"}. Next date: {clearDate ? "clear saved date" : useDate && date ? new Date(date).toLocaleString() : "keep current"}.</p>
          <label className="flex min-h-11 items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I checked that this message is for this job and confirm these changes.</label>
          <Button disabled={!ready} loading={busy === "save"} onClick={() => void save()}>Save reviewed changes</Button>
        </fieldset>}
      </div>}
      <Suspense fallback={<p role="status">Loading imported-message history…</p>}><EmailHistory entryId={entryId} revision={historyRevision} /></Suspense>
    </>}
  </section>;
}
