import { useEffect, useRef, useState } from "react";
import type { BizTalentPool, BizTalentSearch } from "@orbit/types";
import { BookmarkCheck, Button, Field, Input } from "@orbit/ui";
import { useCompany } from "./BusinessApp";
import { talentSearches } from "./talentApi";
import { LoadError, Loading, errorText } from "./ui";

export function TalentSavedSearches({ pool, query, disabled, onRun }: {
  pool: BizTalentPool; query: string; disabled: boolean; onRun: (search: BizTalentSearch) => void;
}) {
  const { company } = useCompany();
  const [items, setItems] = useState<BizTalentSearch[] | null>(null);
  const [edit, setEdit] = useState<BizTalentSearch | null>(null);
  const [name, setName] = useState(""); const [criteria, setCriteria] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<Error | null>(null);
  const [message, setMessage] = useState("");
  const locked = useRef(false); const live = useRef(true);
  const request = useRef({ key: "", id: "" });
  useEffect(() => { live.current = true; void talentSearches.list(company.id, pool.id).then(data => { if (live.current) setItems(data.items); }).catch((e: unknown) => { if (live.current) setError(new Error(errorText(e))); }); return () => { live.current = false; }; }, [company.id, pool.id]);
  const refresh = async () => { const next = await talentSearches.list(company.id, pool.id); if (live.current) setItems(next.items); };
  const act = async (action: "save" | "delete" | "refresh", row?: BizTalentSearch) => {
    if (locked.current) return; locked.current = true; setBusy(true); setError(null); setMessage("");
    try {
      if (action === "save") {
        const body = { name: name.trim(), query: criteria.trim(), terms_revision: pool.terms_revision };
        const key = JSON.stringify(body);
        if (request.current.key !== key) request.current = { key, id: crypto.randomUUID() };
        if (edit) await talentSearches.save(company.id, pool.id, edit, body);
        else await talentSearches.create(company.id, pool.id, request.current.id, body);
        if (live.current) { setEdit(null); setName(""); setCriteria(""); setMessage("Shared search saved. Run it to load current consented profiles."); }
      }
      if (action === "delete" && row) { await talentSearches.remove(company.id, pool.id, row); if (live.current && edit?.id === row.id) { setEdit(null); setName(""); setCriteria(""); } }
      await refresh();
    } catch (e) { if (live.current) setError(new Error(errorText(e))); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  const startEdit = (row: BizTalentSearch) => { setEdit(row); setName(row.name); setCriteria(row.query); setMessage(""); setError(null); };
  return <section aria-labelledby="talent-saved-title" className="mb-6 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-400/20 dark:bg-indigo-400/5 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="talent-saved-title" className="flex items-center gap-2 font-semibold"><BookmarkCheck className="h-5 w-5 text-indigo-700 dark:text-indigo-300" aria-hidden="true" />Shared saved searches</h3><p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">Save repeatable skills or interests searches for your recruiting team. Each run reads current consented profiles; candidate results are never saved here.</p></div><Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("refresh")}>Refresh saved searches</Button></div>
    {error && <LoadError error={error} />}{message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {!items && !error && <Loading label="Loading saved talent searches" />}
    {items && <ul className="mt-4 space-y-3">{items.map(row => <li key={row.id} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <h4 className="break-words font-medium">{row.name}</h4><p className="mt-1 break-words text-sm text-zinc-600 dark:text-zinc-300">Literal search: {row.query}</p>
      {row.stale && <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">Community consent terms changed. The creator, owner or admin must review and save these criteria before reuse.</p>}
      <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={disabled || busy || row.stale || !pool.enabled} onClick={() => onRun(row)}>Run {row.name}</Button>{row.can_manage && <><Button size="sm" variant="secondary" disabled={busy} onClick={() => startEdit(row)}>Edit {row.name}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(`Delete saved search “${row.name}”? Candidate profiles and applications are unchanged.`)) void act("delete", row); }}>Delete {row.name}</Button></>}</div>
    </li>)}</ul>}
    {items?.length === 0 && <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">No shared searches yet. Save useful criteria below.</p>}
    <form className="mt-5 space-y-3 border-t border-zinc-200 pt-4 dark:border-white/10" onSubmit={e => { e.preventDefault(); void act("save"); }}>
      <h4 className="font-medium">{edit ? `Edit saved search: ${edit.name}` : "Save a repeatable search"}</h4>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Saved search name" htmlFor="talent-saved-name"><Input id="talent-saved-name" maxLength={80} minLength={3} value={name} onChange={e => setName(e.target.value)} disabled={busy} /></Field><Field label="Saved skills or interests query" htmlFor="talent-saved-query"><Input id="talent-saved-query" maxLength={80} value={criteria} onChange={e => setCriteria(e.target.value)} disabled={busy} /></Field></div>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">One literal phrase, matched without case. Wildcards are treated as text. Use job-related skills or interests; avoid personal information. Up to 20 shared searches per community.</p>
      {edit?.stale && <p className="text-sm text-amber-800 dark:text-amber-300">Review the current community purpose: {pool.purpose}. Saving confirms these criteria against consent terms {pool.terms_revision}.</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || name.trim().length < 3 || !criteria.trim() || (!edit && (items?.length ?? 20) >= 20)}>{edit ? "Save reviewed search" : "Save shared search"}</Button><Button variant="secondary" disabled={busy || !query.trim()} onClick={() => setCriteria(query)}>Use current discovery query</Button>{edit && <Button variant="ghost" disabled={busy} onClick={() => { setEdit(null); setName(""); setCriteria(""); }}>Cancel search edit</Button>}</div>
    </form>
  </section>;
}
