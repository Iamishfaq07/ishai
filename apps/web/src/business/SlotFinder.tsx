import { useId, useState } from "react";
import { Button, Callout, Field, Input } from "@orbit/ui";
import { schedulingApi, localDateTime } from "./schedulingApi";
import { dayTime } from "./model";

export function SlotFinder({ cid, aid, duration, onUse }: { cid: string; aid: string; duration: number; onUse: (slots: string[]) => void }) {
  const id = useId();
  const [start, setStart] = useState(() => { const d = new Date(Date.now() + 2 * 86400000); d.setHours(9, 0, 0, 0); return localDateTime(d); });
  const [end, setEnd] = useState(() => { const d = new Date(Date.now() + 2 * 86400000); d.setHours(17, 0, 0, 0); return localDateTime(d); });
  const [found, setFound] = useState<{ slots: string[]; scope: string; duration: number } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const find = async () => {
    setBusy(true); setError(""); setFound(null); setSelected([]);
    try {
      const result = await schedulingApi.options(cid, aid, [{ start: new Date(start).toISOString(), end: new Date(end).toISOString() }], duration);
      setFound({ ...result, duration });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <details className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-white/10">
    <summary className="cursor-pointer font-medium">Find panel times</summary>
    <p className="my-2 text-xs text-zinc-500">Checks booked interviews in this company, using the assigned panel. External calendars are not connected. Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Window start" htmlFor={`${id}-start`}><Input id={`${id}-start`} type="datetime-local" value={start} onChange={(e) => { setStart(e.target.value); setFound(null); }} /></Field>
      <Field label="Window end" htmlFor={`${id}-end`}><Input id={`${id}-end`} type="datetime-local" value={end} onChange={(e) => { setEnd(e.target.value); setFound(null); }} /></Field></div>
    <Button className="mt-3" type="button" variant="secondary" size="sm" loading={busy} onClick={() => void find()}>Find available times</Button>
    {error && <Callout className="mt-3" tone="error">{error}</Callout>}
    {found && found.duration === duration && <div className="mt-3 space-y-3"><p className="text-xs text-zinc-500">{found.scope} Select 3–5 suggestions to copy into the invitation.</p>
      {found.slots.length ? <div className="grid max-h-64 gap-2 overflow-auto sm:grid-cols-2">{found.slots.map((slot) => <label key={slot} className="flex items-center gap-2 rounded-lg border border-zinc-200 p-2 dark:border-white/10">
        <input type="checkbox" checked={selected.includes(slot)} disabled={!selected.includes(slot) && selected.length >= 5} onChange={(e) => setSelected(e.target.checked ? [...selected, slot] : selected.filter((s) => s !== slot))} />{dayTime(slot)}
      </label>)}</div> : <p>No slots fit this window and the current panel bookings. Try another window.</p>}
      <Button type="button" size="sm" disabled={selected.length < 3} onClick={() => onUse(selected.map((s) => localDateTime(new Date(s))))}>Use selected times</Button>
    </div>}
  </details>;
}
