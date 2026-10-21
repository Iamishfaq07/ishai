import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { CandidateInterviewRound, CandidateInterviewRounds, InterviewRoundType } from "@orbit/types";
import { ROUND_TYPES, confirmDialog, cx, focusRing } from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, Select, Textarea } from "../../../components/ui";
import { api } from "../../../lib/api";
import { useCandidateDraft } from "../../../lib/useCandidateDraft";
import { errorText } from "../../../lib/format";
import { missionPath } from "../paths";
import { InterviewDebrief } from "./InterviewDebrief";

function when(at: string | null, zone: string): string {
  if (!at) return "Time not recorded";
  try { return `${new Date(at).toLocaleString(undefined, { timeZone: zone })} · ${zone}`; }
  catch { return `${at} · ${zone} (check the original time zone)`; }
}
function localInput(at: string | null, zone: string): string {
  if (!at) return "";
  try {
    const values = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at)).map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
  } catch { return ""; }
}

type Props = { entryId: string; onSaved: () => void };
export function InterviewRounds(props: Props) { return <OwnedRounds key={props.entryId} {...props} />; }
function OwnedRounds({ entryId, onSaved }: Props) {
  const base = `/v1/jobs/tracker/${encodeURIComponent(entryId)}/rounds`;
  const [data, setData] = useState<CandidateInterviewRounds | null>(null);
  const [editing, setEditing] = useState<CandidateInterviewRound | "new" | null>(null);
  const [debriefing, setDebriefing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++seq.current;
    try { const next = await api.call<CandidateInterviewRounds>(base); if (request === seq.current) { setData(next); setEditing((old) => old && old !== "new" ? next.rounds.find((item) => item.id === old.id) ?? null : old); setError(null); } }
    catch (failure) { if (request === seq.current) setError(errorText(failure)); }
  }, [base]);
  useEffect(() => { void refresh(); return () => { seq.current++; }; }, [refresh]);
  useEffect(() => {
    const changed = (event: Event) => { if ((event as CustomEvent<{ entryId?: string }>).detail?.entryId === entryId && !busy) void refresh(); };
    const returned = () => { if (!busy && !editing && document.visibilityState === "visible") void refresh(); };
    window.addEventListener("orbit:interview-rounds-changed", changed);
    window.addEventListener("focus", returned); document.addEventListener("visibilitychange", returned);
    return () => { window.removeEventListener("orbit:interview-rounds-changed", changed); window.removeEventListener("focus", returned); document.removeEventListener("visibilitychange", returned); };
  }, [entryId, busy, editing, refresh]);
  const save = async (body: Record<string, unknown>, row?: CandidateInterviewRound): Promise<boolean> => {
    if (!data || busy) return false;
    const request = ++seq.current;
    setBusy(true); setError(null); setNotice("");
    try {
      const next = await api.call<CandidateInterviewRounds>(row ? `${base}/${encodeURIComponent(row.id)}` : base, {
        method: row ? "PUT" : "POST", body: JSON.stringify({ ...body, tracker_version: data.tracker_version }),
      });
      if (request !== seq.current) return false;
      setData(next); setEditing(null); setNotice("Round saved. Existing preparation completion history is preserved."); onSaved(); return true;
    } catch (failure) { if (request === seq.current) setError(errorText(failure)); return false; }
    finally { if (request === seq.current) setBusy(false); }
  };
  const prepare = async (row: CandidateInterviewRound) => {
    const original = seq.current;
    if (!data || busy || !(await confirmDialog({ title: "Prepare for this recorded round?", body: `Use ${row.label} at ${when(row.scheduled_at, row.time_zone)} as this opportunity’s current preparation date. Earlier completed tasks stay in history. No interview stage or employer outcome is inferred.`, confirmLabel: "Use for preparation" }))) return;
    if (original !== seq.current) return;
    const request = ++seq.current; setBusy(true); setError(null);
    try {
      const next = await api.call<CandidateInterviewRounds>(`${base}/${encodeURIComponent(row.id)}/prepare`, {
        method: "POST", body: JSON.stringify({ tracker_version: data.tracker_version, revision: row.revision, confirmed: true }),
      });
      if (request === seq.current) { setData(next); setNotice("Preparation now uses this reviewed round. Start Saba from this opportunity."); onSaved(); }
    } catch (failure) { if (request === seq.current) setError(errorText(failure)); }
    finally { if (request === seq.current) setBusy(false); }
  };
  const clearPreparation = async () => {
    const original = seq.current;
    if (!data || busy || !(await confirmDialog({ title: "Clear the selected preparation round?", body: "The round and completed preparation history remain saved. Its matching preparation date is cleared; a different legacy date is retained. No other round is selected.", confirmLabel: "Clear preparation selection" }))) return;
    if (original !== seq.current) return;
    const request = ++seq.current; setBusy(true); setError(null);
    try {
      const next = await api.call<CandidateInterviewRounds>(`${base}/preparation/clear`, { method: "POST", body: JSON.stringify({ tracker_version: data.tracker_version, confirmed: true }) });
      if (request === seq.current) { setData(next); setNotice("Preparation selection cleared. Round history remains saved."); onSaved(); }
    } catch (failure) { if (request === seq.current) setError(errorText(failure)); }
    finally { if (request === seq.current) setBusy(false); }
  };
  if (data && !data.enabled) return null;
  if (!data) return error ? <ErrorNote onRetry={() => void refresh()}>Round history could not load. {error} Existing interview controls remain available.</ErrorNote> : null;
  const planned = data.rounds.filter((row) => row.status === "planned").sort((a, b) => (a.scheduled_at ?? "9999").localeCompare(b.scheduled_at ?? "9999"));
  const past = data.rounds.filter((row) => row.status !== "planned");
  const render = (row: CandidateInterviewRound) => <li key={row.id} className="min-w-0 space-y-3 border-t border-zinc-200 py-4 dark:border-white/10">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="break-words font-semibold">{row.number ? `Round ${row.number} · ` : ""}{row.label}</h3><span className="text-xs capitalize">{row.status.replaceAll("_", " ")}</span></div>
    <p className="text-sm text-zinc-600 dark:text-zinc-300">{when(row.scheduled_at, row.time_zone)}</p>
    <p className="text-xs text-zinc-600 dark:text-zinc-400">{row.source === "calendar_review" ? "Reviewed calendar record; sender and job match are not independently verified." : "Recorded by you; separate from Saba practice or a live session."}</p>
    {row.selected_for_preparation && <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Current preparation round · version {row.revision}</p>}
    {row.selection_stale && <p className="text-sm text-amber-800 dark:text-amber-200">The current preparation context differs from this record. Review and deliberately select a round again.</p>}
    <p className="text-xs text-zinc-600 dark:text-zinc-400">Completed Saba practice at this revision: {row.practice_sessions}{row.earlier_practice_sessions ? ` · ${row.earlier_practice_sessions} at earlier revisions (not silently carried forward)` : ""}</p>
    {row.notes && <p className="whitespace-pre-wrap break-words text-sm">{row.notes}</p>}
    {row.outcome && <p className="text-sm">Your recorded outcome: {row.outcome.replaceAll("_", " ")}. This does not automatically change the application stage.</p>}
    <div className="flex flex-wrap gap-3"><Button variant="secondary" disabled={busy || !data.editable} onClick={() => { setEditing(row); setNotice(""); }}>Edit round or debrief</Button>
      {row.status === "planned" && row.scheduled_at && !row.selected_for_preparation && <Button variant="secondary" disabled={busy || !data.editable} onClick={() => void prepare(row)}>Use for preparation</Button>}
      {row.outcome === "next_round" && <Button variant="secondary" disabled={busy || !data.editable || editing !== null} onClick={() => setEditing("new")}>Record the next confirmed round</Button>}
      {row.outcome === "offer" && <Link to={`${missionPath(entryId)}?tab=offer`} className={cx("inline-flex min-h-11 items-center rounded text-sm font-semibold underline", focusRing)}>Record offer terms for this opportunity</Link>}
      {row.selected_for_preparation && <Link to={`${missionPath(entryId)}?tab=practice`} className={cx("inline-flex min-h-11 items-center rounded text-sm font-semibold underline", focusRing)}>Practise this round with Saba</Link>}
      {row.status !== "cancelled" && <Button variant="secondary" aria-expanded={debriefing === row.id} onClick={() => setDebriefing(debriefing === row.id ? null : row.id)}>{debriefing === row.id ? "Close debrief" : "Debrief with AI"}</Button>}
    </div>
    {debriefing === row.id && <InterviewDebrief entryId={entryId} roundId={row.id} label={row.label} initialNotes={row.notes} />}
    <details><summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-medium", focusRing)}>Schedule and change history</summary><ol className="space-y-3 border-l border-zinc-200 pl-3 dark:border-white/10">{row.history.map((event, index) => <li key={`${event.revision}-${index}`} className="break-words text-xs"><p>Version {event.revision} · {new Date(event.at).toLocaleString()} · {event.action.replaceAll("_", " ")}</p>{event.previous && <p>Previously: {when(event.previous.scheduled_at, event.previous.time_zone)} · {event.previous.status}</p>}<p>{when(event.scheduled_at, event.time_zone)} · {event.status}</p></li>)}</ol></details>
  </li>;
  return <Card>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-lg font-semibold">Interview rounds</h2><p className="mt-2 max-w-prose text-sm text-zinc-600 dark:text-zinc-400">One opportunity, separate employer rounds. Record a date, prepare with Saba, then capture what actually happened. No round is inferred from practice or a company name.</p></div><Button disabled={busy || !data.editable || editing !== null} onClick={() => { setEditing("new"); setNotice(""); }}>Add interview round</Button></header>
    <Button className="mt-3" variant="secondary" aria-expanded={debriefing === "any"} onClick={() => setDebriefing(debriefing === "any" ? null : "any")}>{debriefing === "any" ? "Close debrief" : "Debrief an interview"}</Button>
    <Button className="mt-3" variant="ghost" disabled={busy} onClick={() => void refresh()}>Refresh round records</Button>
    {debriefing === "any" && <div className="mt-4"><InterviewDebrief entryId={entryId} label="Interview" /></div>}
    {data.preparation_round_id && <Button className="mt-3" variant="ghost" disabled={busy || !data.editable} onClick={() => void clearPreparation()}>Clear preparation selection</Button>}
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    {error && <div className="mt-3"><ErrorNote onRetry={() => void refresh()}>{error} Unsaved form inputs remain in this tab; refresh the records and review again.</ErrorNote></div>}
    {!data.editable && <p className="mt-3 text-sm">This opportunity is closed. History remains available; reopen it in the tracker before editing.</p>}
    {editing && <RoundForm key={editing === "new" ? "new" : `${editing.id}:${editing.revision}`} entryId={entryId} row={editing === "new" ? undefined : editing} trackerVersion={data.tracker_version} busy={busy} onSave={save} onClose={() => setEditing(null)} />}
    {!data.rounds.length && !editing && <div className="mt-5 rounded-xl border border-dashed border-zinc-300 p-5 dark:border-white/20"><h3 className="font-semibold">Record the first real round when you know it</h3><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">You can add an undated round, review an invitation under Help and updates, or practise generally with Saba now. Existing tracker dates are not automatically promoted into round history.</p></div>}
    <ol aria-label="Planned employer rounds" className="mt-4">{planned.map(render)}</ol>
    {past.length > 0 && <details className="mt-3"><summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-semibold", focusRing)}>Completed and cancelled rounds ({past.length})</summary><ol aria-label="Previous employer rounds">{past.map(render)}</ol></details>}
  </Card>;
}

type Inputs = { label: string; round_type: InterviewRoundType | ""; number: string; local_time: string; time_zone: string; notes: string };
function RoundForm({ entryId, row, trackerVersion, busy, onSave, onClose }: { entryId: string; row?: CandidateInterviewRound; trackerVersion: string; busy: boolean; onSave: (body: Record<string, unknown>, row?: CandidateInterviewRound) => Promise<boolean>; onClose: () => void }) {
  const id = useId();
  const [raw, setRaw] = useCandidateDraft(`round-input:${row?.id ?? "new"}`, entryId);
  const [fields, setFields] = useState<Inputs>(() => {
    let saved: Partial<Inputs> = {}; try { saved = raw ? JSON.parse(raw) as Partial<Inputs> : {}; } catch { /* A malformed input draft is not an approval. */ }
    const zone = row?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    return { label: saved.label ?? row?.label ?? "", round_type: saved.round_type ?? row?.round_type ?? "", number: saved.number ?? (row?.number ? String(row.number) : ""), local_time: saved.local_time ?? localInput(row?.scheduled_at ?? null, zone), time_zone: saved.time_zone ?? zone, notes: saved.notes ?? row?.notes ?? "" };
  });
  const requestId = useRef(crypto.randomUUID());
  const [status, setStatus] = useState<CandidateInterviewRound["status"]>(row?.status ?? "planned");
  const [outcome, setOutcome] = useState<CandidateInterviewRound["outcome"]>(row?.outcome ?? null);
  const [useForPrep, setUseForPrep] = useState(false);
  const [mark, setMark] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { setConfirmed(false); }, [trackerVersion]);
  const change = (patch: Partial<Inputs>) => { const next = { ...fields, ...patch }; setFields(next); setRaw(JSON.stringify(next)); setConfirmed(false); requestId.current = crypto.randomUUID(); };
  const save = async () => {
    if (!confirmed || busy) return;
    const body: Record<string, unknown> = { ...fields, local_time: fields.local_time || null, number: fields.number ? Number(fields.number) : null, round_type: fields.round_type || null, confirmed: true, mark_interviewing: mark, use_for_preparation: useForPrep };
    if (row) { body.revision = row.revision; body.status = status; body.outcome = status === "completed" ? outcome : null; }
    else body.request_id = requestId.current;
    if (await onSave(body, row)) setRaw("");
  };
  const close = async () => {
    if (raw && !(await confirmDialog({ title: "Discard these round inputs?", body: "Saved interview records remain unchanged. This clears the unsaved input draft in this tab.", confirmLabel: "Discard inputs" }))) return;
    setRaw(""); onClose();
  };
  return <section aria-label={row ? "Edit interview round" : "Add interview round"} className="mt-5 space-y-4 rounded-xl border border-indigo-200 p-4 dark:border-indigo-400/20">
    <h3 className="font-semibold">{row ? "Review this round and its outcome" : "Add a real employer round"}</h3>
    <p className="text-xs text-zinc-600 dark:text-zinc-400">Input drafts stay only in this tab; drafts older than an hour are not restored. Confirmation, outcomes and preparation choices are not restored as approvals.</p>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <Field label="Round label" htmlFor={`${id}-label`}><Input id={`${id}-label`} maxLength={160} value={fields.label} onChange={(event) => change({ label: event.target.value })} placeholder="For example, technical discussion" /></Field>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Round category (optional)" htmlFor={`${id}-type`}><Select id={`${id}-type`} value={fields.round_type} onChange={(event) => change({ round_type: event.target.value as Inputs["round_type"] })}><option value="">Not recorded</option>{ROUND_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</Select></Field><Field label="Round number (optional)" htmlFor={`${id}-number`}><Input id={`${id}-number`} type="number" min={1} max={20} step={1} value={fields.number} onChange={(event) => change({ number: event.target.value })} /></Field></div>
      <Field label="Local interview date and time (optional)" htmlFor={`${id}-time`}><Input id={`${id}-time`} type="datetime-local" step={1} value={fields.local_time} onChange={(event) => change({ local_time: event.target.value })} /></Field>
      <Field label="IANA time zone" htmlFor={`${id}-zone`}><Input id={`${id}-zone`} maxLength={100} value={fields.time_zone} onChange={(event) => change({ time_zone: event.target.value })} placeholder="Asia/Kolkata" /></Field>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">The time is interpreted in this named zone, not guessed from your location. Ambiguous or nonexistent daylight-saving times require correction. If switching to UTC, enter the actual UTC time from the invitation; changing the zone reinterprets the typed wall time.</p>
      {row && <Field label="What happened?" htmlFor={`${id}-status`}><Select id={`${id}-status`} value={status} onChange={(event) => { setStatus(event.target.value as CandidateInterviewRound["status"]); setConfirmed(false); setMark(false); }}><option value="planned">Planned or rescheduled</option><option value="completed">I confirm this employer round happened</option><option value="cancelled">Cancelled</option></Select></Field>}
      {row && status === "completed" && <Field label="Your recorded outcome (optional)" htmlFor={`${id}-outcome`}><Select id={`${id}-outcome`} value={outcome ?? ""} onChange={(event) => { setOutcome((event.target.value || null) as CandidateInterviewRound["outcome"]); setConfirmed(false); }}><option value="">Not known</option><option value="awaiting_reply">Awaiting a reply</option><option value="next_round">Invited to another round</option><option value="offer">Offer received (record separately)</option><option value="not_selected">Not selected</option><option value="other">Other — explain in notes</option></Select></Field>}
      <Field label="Private round notes or debrief" htmlFor={`${id}-notes`}><Textarea id={`${id}-notes`} rows={4} maxLength={4000} value={fields.notes} onChange={(event) => change({ notes: event.target.value })} /></Field>
      {(!row || !row.selected_for_preparation) && status === "planned" && <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={useForPrep} disabled={!fields.local_time} onChange={(event) => { setUseForPrep(event.target.checked); setConfirmed(false); }} />Use this dated round for current preparation and Saba.</label>}
      {row?.selected_for_preparation && <p className="text-sm">This is the selected preparation round. Rescheduling updates its prep date. Completing or cancelling it clears that selected date; another round is never chosen automatically. Completed preparation history stays saved.</p>}
      {status === "planned" && <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={mark} disabled={!fields.local_time} onChange={(event) => { setMark(event.target.checked); setConfirmed(false); }} />I have a confirmed employer interview; also mark this opportunity as interviewing.</label>}
      <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed this job, round, time zone and any status or preparation changes. Practice alone is not an employer interview.</label>
      <div className="flex flex-wrap gap-3"><Button disabled={!confirmed || !fields.label.trim()} loading={busy} onClick={() => void save()}>Save reviewed round</Button><Button variant="ghost" onClick={() => void close()}>Cancel editing</Button></div>
    </fieldset>
  </section>;
}
