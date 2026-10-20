import { useId, useState } from "react";
import { Button, Callout, Field, Input } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";

interface Playbook { revision: number; follow_up_days: number | null; prep_hours: number | null }
export function PlaybookEditor({ onChanged }: { onChanged: (saved: boolean) => void }) {
  const state = useAsync(() => api.call<Playbook>("/v1/jobs/playbook"), [], "career-playbook");
  const [reset, setReset] = useState(0);
  const reload = async () => {
    const next = await api.call<Playbook>("/v1/jobs/playbook");
    state.setData(() => next); setReset((n) => n + 1); onChanged(false);
  };
  return <details className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-zinc-900">
    <summary className="cursor-pointer rounded-lg font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">Your follow-up playbook</summary>
    <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Choose which reminders Orbit derives from your saved activity. Rules are off until you enable and save them. This adds actions here; it never sends a message or changes a job status.</p>
    {state.error && <Callout tone="error">{errorText(state.error)} <Button variant="ghost" onClick={state.reload}>Retry loading rules</Button></Callout>}
    {!state.data ? <p className="mt-3 text-sm">Loading your rules…</p> : <Editor key={`${state.data.revision}:${reset}`} initial={state.data}
      onReload={reload} onSaved={(next) => { state.setData(() => next); onChanged(true); }} />}
  </details>;
}

const RULES = [
  { key: "follow_up_days", name: "Application follow-ups", label: "Wait after application or latest contact (days)", min: 3, max: 60, initial: 7,
    detail: "For applied jobs without a next-step date. A linked contact marked as contacted resets the waiting period. Rejected, hired and interviewing jobs are excluded." },
  { key: "prep_hours", name: "Interview preparation window", label: "Prepare before interview (hours)", min: 1, max: 168, initial: 24,
    detail: "Highlights upcoming interviews inside your chosen preparation window. The calendar keeps the actual interview date." },
] as const;

function Editor({ initial, onSaved, onReload }: { initial: Playbook; onSaved: (next: Playbook) => void; onReload: () => Promise<void> }) {
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const { revision, ...rules } = draft;
      const next = await api.call<Playbook>("/v1/jobs/playbook", { method: "PUT", body: JSON.stringify({ ...rules, base_revision: revision }) });
      onSaved(next);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const reload = async () => {
    setBusy(true); setError(null);
    try { await onReload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <div className="grid gap-4 md:grid-cols-2">{RULES.map((rule) => <div key={rule.key} className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={draft[rule.key] !== null} disabled={busy}
        onChange={(e) => setDraft({ ...draft, [rule.key]: e.target.checked ? rule.initial : null })} />{rule.name}</label>
      <p className="my-3 text-xs text-zinc-500 dark:text-zinc-400">{rule.detail}</p>
      <Field label={rule.label} htmlFor={`${id}-${rule.key}`}><Input id={`${id}-${rule.key}`} type="number" min={rule.min} max={rule.max}
        value={draft[rule.key] === 0 ? "" : draft[rule.key] ?? ""} disabled={busy || draft[rule.key] === null} required={draft[rule.key] !== null}
        onChange={(e) => setDraft({ ...draft, [rule.key]: Number(e.target.value) })} /></Field>
    </div>)}</div>
    <div className="flex flex-wrap gap-2"><Button type="submit" loading={busy}>Save follow-up rules</Button>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void reload()}>Reload saved rules</Button></div>
    <p className="text-xs text-zinc-500 dark:text-zinc-400">Elapsed calendar days, including weekends. Saved next-step dates take priority. Record an outcome or change the source date to clear a reminder.</p>
    <div aria-live="polite">{error && <Callout tone="error">{error} Your draft is kept. Reload only when ready to discard these edits.</Callout>}</div>
  </form>;
}
