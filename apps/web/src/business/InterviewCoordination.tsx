import { useEffect, useId, useState, type FormEvent } from "react";
import type { BizScheduling, BizTimeRequest } from "@orbit/types";
import { Button, Callout, Field, Textarea } from "@orbit/ui";
import { schedulingApi } from "./schedulingApi";
import { dayTime } from "./model";
import { Panel } from "./ui";

function RequestReply({ cid, aid, item, interview, onSaved }: { cid: string; aid: string; item: BizTimeRequest; interview: NonNullable<BizScheduling["interview"]>; onSaved: (data: BizScheduling) => void }) {
  const id = useId();
  const [message, setMessage] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [options, setOptions] = useState<string[] | null>(null);
  const [notify, setNotify] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const find = async () => {
    setBusy(true); setError(""); setSlots([]); setOptions(null); setKey(crypto.randomUUID());
    try { setOptions((await schedulingApi.options(cid, aid, item.windows, interview.duration_min, interview.id)).slots); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { onSaved(await schedulingApi.reply(cid, aid, item.id, { request_id: key, base_revision: item.revision,
      interview_revision: interview.revision, message, slots, notify })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <form onSubmit={(e) => void submit(e)} className="mt-3 space-y-3">
    <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => void find()}>Find times in shared availability</Button>
    {options && <div className="space-y-2"><p className="text-xs text-zinc-500">Select up to 5 times to offer. These check the interview's saved panel bookings inside this company, without reserving slots.</p>
      {options.length ? <fieldset><legend className="mb-2 text-sm font-medium">Replacement interview times</legend><div className="grid max-h-64 gap-2 overflow-auto sm:grid-cols-2">{options.map((s) => <label key={s} className="flex items-center gap-2 rounded-lg border border-zinc-200 p-2 text-xs dark:border-white/10">
        <input type="checkbox" checked={slots.includes(s)} disabled={!slots.includes(s) && slots.length >= 5} onChange={(e) => { setSlots(e.target.checked ? [...slots, s] : slots.filter((v) => v !== s)); setKey(crypto.randomUUID()); }} />{dayTime(s)}
      </label>)}</div></fieldset> : <p className="text-sm">No free slots fit. Reply to ask for another availability window.</p>}</div>}
    <Field label="Scheduling reply" htmlFor={`${id}-reply`} hint="Without selected times, your reply completes this request. Offering times keeps the current booking until the candidate chooses.">
      <Textarea id={`${id}-reply`} disabled={busy} required minLength={10} maxLength={2000} value={message} onChange={(e) => { setMessage(e.target.value); setKey(crypto.randomUUID()); }} />
    </Field>
    <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" disabled={busy} checked={notify} onChange={(e) => { setNotify(e.target.checked); setKey(crypto.randomUUID()); }} />Email this scheduling update to the candidate</label>
    <Button type="submit" size="sm" loading={busy}>{slots.length ? `Offer ${slots.length} replacement time${slots.length === 1 ? "" : "s"}` : "Save scheduling reply"}</Button>
    {error && <Callout tone="error">{error} Refresh the requests if someone else changed this interview.</Callout>}
  </form>;
}

export function InterviewCoordination({ cid, aid, onChanged }: { cid: string; aid: string; onChanged: () => void }) {
  const [data, setData] = useState<BizScheduling | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => { let live = true; schedulingApi.staff(cid, aid).then((d) => { if (live) { setData(d); setError(""); } })
    .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); }); return () => { live = false; }; }, [cid, aid, revision]);
  return <Panel title="Interview coordination" hint="Candidate availability and time requests. Bookings remain until the candidate confirms a replacement."
    actions={<Button type="button" variant="ghost" size="sm" onClick={() => setRevision((n) => n + 1)}>Refresh requests</Button>}>
    {!data && !error && <p role="status" className="text-sm">Loading time requests…</p>}
    {data?.requests.length ? <ul className="space-y-4">{data.requests.map((item) => <li key={item.id} className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
      <div className="text-sm"><h3 className="font-semibold">Time request · {item.status.replaceAll("_", " ")}</h3><p className="mt-1 whitespace-pre-wrap">{item.reason}</p>
        <p className="mt-2 text-xs text-zinc-500">Candidate zone: {item.timezone}. Windows below use your local zone.</p>
        <ul className="mt-1 space-y-1 text-xs">{item.windows.map((w, i) => <li key={i}>{dayTime(w.start)} – {dayTime(w.end)}</li>)}</ul>
        {item.reply && <div className="mt-3 rounded-lg bg-zinc-50 p-3 dark:bg-white/5"><p className="font-medium">Saved reply</p><p className="mt-1 whitespace-pre-wrap">{item.reply.message}</p></div>}
      </div>
      {data.accepting && data.interview && ["waiting", "awaiting_candidate"].includes(item.status) && <RequestReply key={`${item.id}:${item.revision}:${data.interview.revision}`} cid={cid} aid={aid} item={item} interview={data.interview} onSaved={(d) => { setData(d); onChanged(); }} />}
    </li>)}</ul> : data && <p className="text-sm text-zinc-500">No time requests yet. Candidates can share availability from their application page after an interview is offered.</p>}
    {error && <Callout tone="error">{error}</Callout>}
  </Panel>;
}
