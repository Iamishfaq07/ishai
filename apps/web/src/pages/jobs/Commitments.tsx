import { useId, useState } from "react";
import { Trash2, cx, focusRing } from "@orbit/ui";
import { Button, ErrorNote, Input } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";

export interface Commitment { id: string; text: string; due_at: string | null; done_at: string | null; created_at: string }

const base = (entryId: string) => `/v1/jobs/tracker/${encodeURIComponent(entryId)}/commitments`;

/** Tomorrow at 10:00 local time: a sensible default for "I'll send it". */
export function tomorrowMorning(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

export async function addCommitment(entryId: string, text: string, dueAt: string | null): Promise<Commitment> {
  return api.call<Commitment>(base(entryId), { method: "POST", body: JSON.stringify({ text: text.slice(0, 300), due_at: dueAt }) });
}

/**
 * Promises to keep for one job (GET/POST/PATCH /v1/jobs/tracker/{id}/commitments): what you told the employer you'd
 * do. Dated ones show on Today within a week of their date until ticked off. Orbit sends nothing for you.
 */
export function Commitments({ entryId }: { entryId: string }) {
  const id = useId();
  const list = useAsync(() => api.call<Commitment[]>(base(entryId)), [entryId], `commitments|${entryId}`);
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); list.reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const open = list.data?.filter((c) => !c.done_at) ?? [];
  const done = list.data?.filter((c) => c.done_at) ?? [];
  return <section aria-labelledby={`${id}-h`} className="workspace-panel space-y-3 p-4 sm:p-5">
    <div><h3 id={`${id}-h`} className="font-semibold">Promises to keep</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Things you told this employer you’d do. Dated ones show on Today until you tick them off.</p></div>
    {list.error && !list.data && <ErrorNote onRetry={list.reload}>{errorText(list.error)}</ErrorNote>}
    {open.length > 0 && <ul className="space-y-2">{open.map((c) => <li key={c.id} className="flex items-start gap-3 text-sm">
      <input type="checkbox" aria-label={`Done: ${c.text}`} className={cx("mt-1", focusRing)} disabled={busy}
        onChange={() => void run(() => api.call(`${base(entryId)}/${c.id}`, { method: "PATCH", body: JSON.stringify({ done: true }) }))} />
      <span className="min-w-0 flex-1 break-words">{c.text}{c.due_at && <span className={cx("ml-2 text-xs", new Date(c.due_at) < new Date() ? "text-amber-800 dark:text-amber-300" : "text-zinc-500")}>by {new Date(c.due_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>}</span>
      <button type="button" aria-label={`Delete: ${c.text}`} className={cx("rounded p-1 text-zinc-500 hover:text-rose-700", focusRing)} disabled={busy}
        onClick={() => void run(() => api.call(`${base(entryId)}/${c.id}`, { method: "DELETE" }))}><Trash2 className="h-4 w-4" aria-hidden /></button>
    </li>)}</ul>}
    {list.data && !open.length && <p className="text-sm text-zinc-600 dark:text-zinc-400">Nothing open. Promises from an interview debrief can be added in one click.</p>}
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim().length < 2) return;
      void run(async () => { await addCommitment(entryId, text.trim(), due ? new Date(`${due}T10:00`).toISOString() : null); setText(""); setDue(""); }); }}>
      <label className="min-w-0 flex-1 text-sm"><span className="sr-only">New promise</span><Input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="For example, send my portfolio link" /></label>
      <label className="text-sm"><span className="sr-only">Due date</span><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      <Button type="submit" variant="secondary" loading={busy} disabled={text.trim().length < 2}>Add</Button>
    </form>
    <div aria-live="polite">{error && <ErrorNote>{error}</ErrorNote>}</div>
    {done.length > 0 && <details><summary className={cx("cursor-pointer rounded text-xs text-zinc-600 dark:text-zinc-400", focusRing)}>Done ({done.length})</summary>
      <ul className="mt-2 space-y-1 text-sm text-zinc-500 line-through">{done.map((c) => <li key={c.id}>{c.text}</li>)}</ul></details>}
  </section>;
}
