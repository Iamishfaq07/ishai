import { useEffect, useId, useState, type FormEvent } from "react";
import type { BizScheduling } from "@orbit/types";
import { Button, Callout, Field, Input, Textarea } from "@orbit/ui";
import { schedulingApi } from "./schedulingApi";
import { dayTime } from "./model";

export function CandidateScheduling({ token, refreshStatus }: { token: string; refreshStatus: () => Promise<void> }) {
  const id = useId();
  const [data, setData] = useState<BizScheduling | null>(null);
  const [windows, setWindows] = useState([{ start: "", end: "" }]);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; schedulingApi.candidate(token).then((d) => { if (live) setData(d); })
    .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); }); return () => { live = false; }; }, [token]);
  const refresh = async () => {
    setBusy(true); setError("");
    try { setData(await schedulingApi.candidate(token)); await refreshStatus(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!data?.interview) return; setBusy(true); setError("");
    try {
      setData(await schedulingApi.create(token, { request_id: key, interview_id: data.interview.id,
        interview_revision: data.interview.revision, reason, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        windows: windows.map((w) => ({ start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() })) }));
      setKey(crypto.randomUUID()); setReason(""); setWindows([{ start: "", end: "" }]);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const withdraw = async (rid: string, revision: number) => {
    setBusy(true); setError("");
    try { setData(await schedulingApi.withdraw(token, rid, revision, crypto.randomUUID())); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  if (!data && !error) return <p role="status" className="mt-6 text-sm">Loading interview coordination…</p>;
  if (data && !data.interview && !data.requests.length) return null;
  const pending = data?.requests.some((r) => ["waiting", "awaiting_candidate"].includes(r.status));
  return <section className="mt-6 space-y-4 rounded-2xl border border-zinc-200 p-5 dark:border-white/10" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="text-lg font-semibold">Need different interview times?</h2>
    <p className="text-sm text-zinc-600 dark:text-zinc-400">Share availability with the hiring team. Your current booking stays in place until you select another offered time. This request does not cancel your interview.</p>
    <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => void refresh()}>Refresh scheduling updates</Button>
    {data?.requests.length ? <ul className="space-y-3">{data.requests.map((r) => <li key={r.id} className="rounded-xl bg-zinc-50 p-3 text-sm dark:bg-white/5">
      <p className="font-medium">Request: {r.status.replaceAll("_", " ")}</p><p className="mt-1 whitespace-pre-wrap">{r.reason}</p>
      <ul className="mt-2 text-xs">{r.windows.map((w, i) => <li key={i}>{dayTime(w.start)} – {dayTime(w.end)}</li>)}</ul>
      <p className="mt-1 text-xs text-zinc-500">Shared time zone: {r.timezone}</p>
      {r.reply && <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-white/10"><p className="font-medium">Hiring team reply</p><p className="mt-1 whitespace-pre-wrap">{r.reply.message}</p>
        {!!r.reply.slots.length && r.status === "awaiting_candidate" && <p className="mt-2">New times are offered. Refresh above, then select an offered time in Your interview.</p>}</div>}
      {data.accepting && ["waiting", "awaiting_candidate"].includes(r.status) && <Button type="button" className="mt-2" size="sm" variant="ghost" disabled={busy} onClick={() => void withdraw(r.id, r.revision)}>Withdraw time request</Button>}
    </li>)}</ul> : null}
    {data?.accepting && !pending && <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <p className="text-xs text-zinc-500">Availability uses your device time zone, {Intl.DateTimeFormat().resolvedOptions().timeZone}. Choose 1–3 windows, up to 12 hours each, within 60 days.</p>
      {windows.map((w, i) => <fieldset key={i} disabled={busy} className="rounded-xl border border-zinc-200 p-3 dark:border-white/10"><legend className="px-1 text-sm font-medium">Availability {i + 1}</legend>
        <div className="grid gap-3 sm:grid-cols-2"><Field label={`Start ${i + 1}`} htmlFor={`${id}-start-${i}`}><Input id={`${id}-start-${i}`} type="datetime-local" required value={w.start}
          onChange={(e) => { setWindows(windows.map((v, j) => j === i ? { ...v, start: e.target.value } : v)); setKey(crypto.randomUUID()); }} /></Field>
          <Field label={`End ${i + 1}`} htmlFor={`${id}-end-${i}`}><Input id={`${id}-end-${i}`} type="datetime-local" required value={w.end}
            onChange={(e) => { setWindows(windows.map((v, j) => j === i ? { ...v, end: e.target.value } : v)); setKey(crypto.randomUUID()); }} /></Field></div>
        {windows.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => { setWindows(windows.filter((_, j) => i !== j)); setKey(crypto.randomUUID()); }}>Remove window {i + 1}</Button>}
      </fieldset>)}
      <Button type="button" size="sm" variant="secondary" disabled={busy || windows.length >= 3} onClick={() => { setWindows([...windows, { start: "", end: "" }]); setKey(crypto.randomUUID()); }}>Add availability window</Button>
      <Field label="Scheduling note" htmlFor={`${id}-reason`} hint="Explain what times you need. Please avoid medical or other sensitive details."><Textarea id={`${id}-reason`} disabled={busy} required minLength={10} maxLength={800} value={reason} onChange={(e) => { setReason(e.target.value); setKey(crypto.randomUUID()); }} /></Field>
      <Button type="submit" size="sm" loading={busy}>Request different times</Button>
    </form>}
    {error && <Callout tone="error">{error}</Callout>}
  </section>;
}
