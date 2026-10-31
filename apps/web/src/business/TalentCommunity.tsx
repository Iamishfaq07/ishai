import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { BizJobListItem, BizTalentMember, BizTalentPool, BizTalentSearch, BizTalentSuggestion } from "@orbit/types";
import { Button, Callout, Field, Input, Select, Textarea, buttonClass, focusRing } from "@orbit/ui";
import { downloadText } from "../lib/format";
import { PageTitle, useCompany } from "./BusinessApp";
import { biz } from "./api";
import { talent, talentSearches, type TalentPoolDraft } from "./talentApi";
import { TalentSavedSearches } from "./TalentSavedSearches";
import { LoadError, Loading, Panel, errorText } from "./ui";

export function TalentCommunity() { const { company } = useCompany(); return <Workspace key={company.id} />; }
function Workspace() {
  const { company } = useCompany();
  const [pools, setPools] = useState<BizTalentPool[] | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const allowed = company.permissions.all_jobs;
  useEffect(() => { let live = true; if (allowed) void talent.pools(company.id).then(next => { if (live) { setPools(next.items); setError(null); } }).catch((e: unknown) => { if (live) setError(new Error(errorText(e))); }); return () => { live = false; }; }, [company.id, allowed, refresh]);
  const picked = pools?.find(p => p.id === selected) ?? pools?.[0];
  if (!allowed) return <Callout>Talent communities are available to workspace owners, admins and recruiters.</Callout>;
  return <div className="space-y-5">
    <PageTitle title="Talent communities" subtitle="Rediscover candidates who explicitly choose to hear about future opportunities in their application portal." />
    {error && <LoadError error={error} />}
    <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setRefresh(n => n + 1)}>Refresh communities</Button>{company.permissions.manage_company && <Button disabled={company.status !== "active" || (pools?.length ?? 0) >= 25} onClick={() => setCreating(true)}>New talent community</Button>}</div>
    {creating && <PoolEditor onCancel={() => setCreating(false)} onSaved={pool => { setCreating(false); setSelected(pool.id); setRefresh(n => n + 1); }} />}
    {!pools ? !error && <Loading label="Loading talent communities" /> : !pools.length ? <Callout>Create a community with a clear purpose and retention period. Applicants can then choose to join from their private status page.</Callout> : <>
      <Field label="Talent community" htmlFor="talent-pool"><Select id="talent-pool" value={picked?.id ?? ""} onChange={e => setSelected(e.target.value)}>{pools.map(p => <option key={p.id} value={p.id}>{p.name}{p.enabled ? "" : " · paused"}</option>)}</Select></Field>
      {picked && <><PoolEditor key={`${picked.id}:${picked.revision}`} pool={picked} onSaved={() => setRefresh(n => n + 1)} onCancel={() => undefined} /><Directory key={`${picked.id}:${picked.revision}:${refresh}`} pool={picked} /></>}
    </>}
  </div>;
}
function PoolEditor({ pool, onSaved, onCancel }: { pool?: BizTalentPool; onSaved: (pool: BizTalentPool) => void; onCancel: () => void }) {
  const { company } = useCompany();
  const [draft, setDraft] = useState<TalentPoolDraft>({ name: pool?.name ?? "", purpose: pool?.purpose ?? "", retention_days: pool?.retention_days ?? 180, enabled: pool?.enabled ?? false });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<Error | null>(null);
  const live = useRef(true); const locked = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const editable = company.permissions.manage_company && company.status === "active";
  const save = async () => { if (locked.current) return; locked.current = true; setBusy(true); setError(null); try { const next = pool ? await talent.save(company.id, pool.id, pool.revision, draft) : await talent.create(company.id, draft); if (live.current) onSaved(next); } catch (e) { if (live.current) setError(new Error(errorText(e))); } finally { locked.current = false; if (live.current) setBusy(false); } };
  const remove = async () => { if (!pool || locked.current || !window.confirm("Delete this community, all member profiles and all role suggestions? Original applications will stay as they are.")) return; locked.current = true; setBusy(true); setError(null); try { await talent.remove(company.id, pool.id); if (live.current) onSaved(pool); } catch (e) { if (live.current) setError(new Error(errorText(e))); } finally { locked.current = false; if (live.current) setBusy(false); } };
  return <Panel title={pool ? "Community settings" : "Create talent community"} hint="Changing the name, purpose or retention period deletes existing community profiles and suggestions; candidates must consent again. Pausing only hides the community until reopened.">
    <fieldset disabled={!editable || busy} className="space-y-4"><legend className="sr-only">Community consent settings</legend>
      <Field label="Community name" htmlFor={`talent-name-${pool?.id ?? "new"}`}><Input id={`talent-name-${pool?.id ?? "new"}`} value={draft.name} minLength={3} maxLength={120} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></Field>
      <Field label="Purpose shown to candidates" htmlFor={`talent-purpose-${pool?.id ?? "new"}`}><Textarea id={`talent-purpose-${pool?.id ?? "new"}`} value={draft.purpose} minLength={20} maxLength={1200} onChange={e => setDraft(d => ({ ...d, purpose: e.target.value }))} /></Field>
      <Field label="Consent duration in days (30–365)" htmlFor={`talent-days-${pool?.id ?? "new"}`}><Input id={`talent-days-${pool?.id ?? "new"}`} type="number" min={30} max={365} value={draft.retention_days} onChange={e => setDraft(d => ({ ...d, retention_days: Number(e.target.value) }))} /></Field>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className={focusRing} checked={draft.enabled} onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))} />Open for candidate opt-in and recruiter discovery</label>
    </fieldset>
    {error && <LoadError error={error} />}<div className="mt-4 flex flex-wrap gap-2">{editable && <Button disabled={busy || draft.name.trim().length < 3 || draft.purpose.trim().length < 20 || !Number.isInteger(draft.retention_days) || draft.retention_days < 30 || draft.retention_days > 365} onClick={() => { if (!pool || !["name", "purpose", "retention_days"].some(k => pool[k as keyof BizTalentPool] !== draft[k as keyof TalentPoolDraft]) || window.confirm("Changing these terms deletes all existing community profiles and role suggestions. Candidates must choose to join again. Continue?")) void save(); }}>{pool ? "Save community settings" : "Create community"}</Button>}{!pool && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}<Button variant="ghost" onClick={() => downloadText("orbit-community-settings.json", JSON.stringify(draft, null, 2), "application/json")}>Download settings draft</Button>{pool && editable && <Button variant="ghost" disabled={busy} onClick={() => void remove()}>Delete community</Button>}</div>
    {pool && <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Revision {pool.revision} · consent terms {pool.terms_revision}. Membership is linked to one application; no identities are merged across applications.</p>}
  </Panel>;
}
function Directory({ pool }: { pool: BizTalentPool }) {
  const { company } = useCompany();
  const [query, setQuery] = useState(""); const [applied, setApplied] = useState("");
  const [appliedSaved, setAppliedSaved] = useState<BizTalentSearch | null>(null);
  const [items, setItems] = useState<BizTalentMember[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<Error | null>(null);
  const [jobs, setJobs] = useState<BizJobListItem[]>([]);
  const live = useRef(true); const locked = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const search = useCallback(async (q: string, after = "", saved?: BizTalentSearch) => {
    if (locked.current) return; locked.current = true; setBusy(true); setError(null);
    try { const next = saved ? await talentSearches.run(company.id, pool.id, saved, after) : await talent.members(company.id, pool.id, q, after); if (live.current) { setItems(old => after ? [...old, ...next.items] : next.items); setCursor(next.next_cursor); setApplied(q); setAppliedSaved(saved ?? null); setReady(true); } } catch (e) { if (live.current) { setError(new Error(errorText(e))); setItems([]); setCursor(null); setAppliedSaved(null); setReady(false); } } finally { locked.current = false; if (live.current) setBusy(false); }
  }, [company.id, pool.id]);
  useEffect(() => { void search(""); let active = true; void biz.jobs(company.id).then(next => { if (active) setJobs(next.filter(j => j.status === "open")); }).catch((e: unknown) => { if (active) setError(new Error(errorText(e))); }); return () => { active = false; }; }, [company.id, search]);
  return <Panel title="Candidate discovery" hint="Current, confirmed, consented profiles only. Search matches candidate-provided skills and interests, with no AI ranking or demographic filters.">
    {!pool.enabled && <Callout>This community is paused. Profiles are hidden; existing consent still expires on its original date.</Callout>}
    <form className="mb-4 mt-3 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void search(query); }}><div className="min-w-0 flex-1"><Field label="Search skills or interests" htmlFor="talent-search"><Input id="talent-search" value={query} maxLength={80} onChange={e => setQuery(e.target.value)} /></Field></div><Button type="submit" disabled={busy}>Search community</Button></form>
    <TalentSavedSearches pool={pool} query={query} disabled={busy} onRun={saved => { setQuery(saved.query); void search(saved.query, "", saved); }} />
    {ready && <p role="status" className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">{appliedSaved ? `Current results for saved search “${appliedSaved.name}” (revision ${appliedSaved.revision})` : applied ? `Current results for “${applied}”` : "Current community profiles"}. Run the search again to refresh consent and availability.</p>}
    {error && <LoadError error={error} />}{!ready && !error && <Loading label="Loading consented profiles" />}{ready && !items.length && <p className="text-sm">No current profiles match this search. Candidates join voluntarily from their application status page.</p>}
    <div className="space-y-4">{items.map(m => <Member key={m.id} member={m} pool={pool} jobs={jobs} />)}</div>
    {cursor && <Button className="mt-4" disabled={busy} variant="secondary" onClick={() => void search(applied, cursor, appliedSaved ?? undefined)}>Load more profiles</Button>}
  </Panel>;
}
function Member({ member, pool, jobs }: { member: BizTalentMember; pool: BizTalentPool; jobs: BizJobListItem[] }) {
  const { company } = useCompany();
  const [jid, setJid] = useState(""); const [suggestions, setSuggestions] = useState<BizTalentSuggestion[] | null>(null);
  const [error, setError] = useState<Error | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const live = useRef(true); const locked = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const run = async (action: "load" | "suggest" | "remove", sid = "") => {
    if (locked.current) return; locked.current = true; setBusy(true); setError(null);
    try { if (action === "suggest") await talent.suggest(company.id, pool.id, member.id, jid); if (action === "remove") await talent.unsuggest(company.id, pool.id, member.id, sid); const next = await talent.suggestions(company.id, pool.id, member.id); if (live.current) { setSuggestions(next.items); setMessage(action === "suggest" ? "Role suggestion saved to the candidate portal." : action === "remove" ? "Role suggestion removed." : ""); } } catch (e) { if (live.current) { setError(new Error(errorText(e))); setSuggestions(null); setMessage(""); } } finally { locked.current = false; if (live.current) setBusy(false); }
  };
  return <section className="min-w-0 space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
    <h3 className="break-words font-semibold">{member.name}</h3><p className="break-words text-sm">{member.skills.join(" · ")}</p><p className="whitespace-pre-wrap break-words text-sm text-zinc-600 dark:text-zinc-400">{member.interests}</p><p className="text-xs text-zinc-500 dark:text-zinc-400">Consent expires {new Date(member.expires_at).toLocaleDateString()}</p>
    <div className="flex flex-wrap gap-2"><Link className={buttonClass("secondary", "sm")} to={`/business/app/${company.id}/applications/${member.application_id}`}>Review original application</Link><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("load")}>Review role suggestions</Button></div>
    <div className="space-y-3"><Field label={`Suggest a published role for ${member.name}`} htmlFor={`talent-role-${member.id}`}><Select id={`talent-role-${member.id}`} value={jid} onChange={e => setJid(e.target.value)}><option value="">Choose a role after reviewing the profile</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</Select></Field><Button disabled={busy || !jid || company.status !== "active"} onClick={() => void run("suggest")}>Suggest role in candidate portal</Button></div>
    {message && <p role="status" className="text-sm">{message}</p>}{error && <LoadError error={error} />}
    {suggestions && <ul className="space-y-2 text-sm">{suggestions.length ? suggestions.map(s => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2"><span className="break-words">{s.title} · {s.status}</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => void run("remove", s.id)}>Remove suggestion for {s.title}</Button></li>) : <li>No role suggestions saved.</li>}</ul>}
  </section>;
}
