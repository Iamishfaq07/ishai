import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { JobContact, NetworkContext, NetworkDraft, NetworkPerson, NetworkResearch } from "@orbit/types";
import { ArrowUpRight, Search, cx, focusRing } from "@orbit/ui";
import { Button, ErrorNote, Field, Input, Select, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useJobsAi } from "./JobsAi";

const root = (id: string) => `/v1/jobs/network/${encodeURIComponent(id)}`;
const post = <T,>(id: string, action: string, body: unknown) => api.call<T>(`${root(id)}/${action}`, {
  method: "POST", body: JSON.stringify(body), timeoutMs: 120_000,
});

/**
 * The job contact finder: the people at a job's company (recruiters and HR, likely hiring managers, the team), found
 * on public professional profiles, each with the page it came from. One click saves a person to People; a message is
 * drafted for you to edit and send yourself. Nothing is sent from here.
 */
export default function ContactResearch({ listingId, applicationId, onSaved, autoRun = false }: {
  listingId: string | null; applicationId?: string; onSaved: () => void; autoRun?: boolean;
}) {
  const selectId = useId();
  const { tracker } = useJobsAi();
  const jobs = tracker.data ?? [];
  const [chosen, setChosen] = useState("");
  const target = applicationId ? jobs.find((j) => j.id === applicationId)
    : jobs.find((j) => j.id === chosen) ?? jobs.find((j) => j.listing_id === listingId) ?? jobs[0];
  return <section id="contact-research" aria-label="Contact finder" className="space-y-4">
    {!applicationId && jobs.length > 0 && <Field label="Job" htmlFor={selectId}><Select id={selectId} value={target?.id ?? ""} onChange={(e) => setChosen(e.target.value)}>
      {jobs.map((j) => <option key={j.id} value={j.id}>{j.title} · {j.company}</option>)}
    </Select></Field>}
    {tracker.error && <ErrorNote onRetry={tracker.reload}>{errorText(tracker.error)}</ErrorNote>}
    {!jobs.length && !tracker.loading ? <p className="text-sm text-zinc-600 dark:text-zinc-400">Save a job first, from <Link className="font-medium text-indigo-700 underline dark:text-indigo-300" to="/jobs/matches">Discover</Link> or your tracker, to find people there.</p>
      : target ? <Finder key={target.id} applicationId={target.id} onSaved={onSaved} autoRun={autoRun} />
      : <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">Loading your jobs…</p>}
  </section>;
}

type Group = "recruiting" | "manager" | "team";
const GROUPS: Array<{ id: Group; label: string }> = [
  { id: "recruiting", label: "Recruiters & HR" }, { id: "manager", label: "Likely hiring managers" }, { id: "team", label: "On the team" },
];
const groupOf = (title: string): Group =>
  /recruit|talent|sourc|hr\b|human resources|people (partner|ops|operations)|hiring partner/i.test(title) ? "recruiting"
    : /manager|head|director|lead|vp|vice president|chief|principal/i.test(title) ? "manager" : "team";
const STEPS = ["Recruiters and talent acquisition", "HR and people partners", "Hiring managers", "The team"];

function Finder({ applicationId, onSaved, autoRun }: { applicationId: string; onSaved: () => void; autoRun: boolean }) {
  const ctx = useAsync(() => api.call<NetworkContext>(root(applicationId)), [applicationId], `network:${applicationId}`);
  const data = ctx.data;
  const [result, setResult] = useState<NetworkResearch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftFor, setDraftFor] = useState<JobContact | null>(null);
  const started = useRef(false);
  const find = async () => {
    if (!data || busy) return;
    setBusy(true); setError(null);
    try { setResult(await post<NetworkResearch>(applicationId, "research", { version: data.version, automatic: true, search_web: true })); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!autoRun || started.current || !data?.web_search_enabled) return;
    started.current = true;
    void find();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the finder opens with its context
  }, [data]);

  if (ctx.error) return <ErrorNote onRetry={ctx.reload}>{errorText(ctx.error)}</ErrorNote>;
  if (!data) return <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">Opening the finder…</p>;
  const company = data.job.company;
  const saved = data.saved_contacts;
  const savedNames = new Set(saved.map((c) => c.name.toLowerCase()));
  const found = (result?.people ?? []).filter((p) => !savedNames.has(p.name.toLowerCase()));
  const searched = result !== null;
  return <div className="space-y-5">
    {saved.length > 0 && <div>
      <h3 className="text-sm font-semibold">Saved at {company}</h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">{saved.map((c) => <li key={c.id}>
        <PersonRow name={c.name} title={c.title} profile={c.linkedin_url}
          action={<Button size="sm" variant="secondary" onClick={() => setDraftFor(c)}>Write a message</Button>} />
      </li>)}</ul>
    </div>}

    {busy ? <div role="status" className="workspace-panel p-5">
      <p className="font-medium">Looking for people at {company}…</p>
      <ul className="mt-3 space-y-2 text-sm text-zinc-600 dark:text-zinc-400">{STEPS.map((s, i) => <li key={s} className="route-rise flex items-center gap-2" style={{ ["--i" as string]: i + 1 }}>
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-indigo-600 motion-safe:animate-pulse dark:bg-indigo-400" />{s}</li>)}</ul>
      <p className="mt-3 text-xs text-zinc-500">This takes up to a minute.</p>
    </div>
      : !searched ? <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void find()} disabled={!data.web_search_enabled} disabledReason="Automatic search isn't available right now. Use the LinkedIn searches below.">
          <Search className="h-4 w-4" aria-hidden /> Find people at {company}</Button>
        <span className="text-xs text-zinc-500">Only the company and role are searched, never anything about you.</span>
      </div>
      : found.length > 0 ? <div className="space-y-4">
        {GROUPS.map((g) => {
          const list = found.filter((p) => groupOf(p.title) === g.id);
          return list.length > 0 && <div key={g.id}>
            <h3 className="text-sm font-semibold">{g.label}</h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">{list.map((p, i) => <li key={`${p.source_id}:${p.name}`} className="route-rise" style={{ ["--i" as string]: i + 1 }}>
              <Lead person={p} source={result.sources.find((s) => s.id === p.source_id)?.url ?? null} applicationId={applicationId}
                jobVersion={result.job_version} onSaved={(c) => { ctx.reload(); onSaved(); setDraftFor(c); }} />
            </li>)}</ul>
          </div>;
        })}
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
          <span>Found on public profiles; roles change, so check the profile before reaching out.</span>
          <button type="button" onClick={() => void find()} className={cx("font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>Search again</button>
        </div>
      </div>
      : <div className="rounded-xl bg-zinc-100 p-4 text-sm dark:bg-white/5">
        <p className="font-medium">No public profiles at {company} turned up this time.</p>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">Try the LinkedIn searches below; they open with the company and role filled in.</p>
      </div>}
    {error && <ErrorNote onRetry={() => void find()}>{error}</ErrorNote>}
    {!data.web_search_enabled && <SearchOff reason={data.web_search_off_reason} known={"web_search_off_reason" in data} />}

    <div>
      <h3 className="text-sm font-semibold">Search yourself</h3>
      <div className="mt-2 flex flex-wrap gap-2">{data.search_links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
        className={cx("inline-flex min-h-10 items-center gap-1 rounded-lg border border-zinc-200 px-3 text-sm font-medium hover:border-indigo-400 dark:border-white/10", focusRing)}>
        {l.label} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /></a>)}</div>
      <p className="mt-2 text-xs text-zinc-500">Found someone there? Add them in <Link to="/jobs/outreach" className="font-medium text-indigo-700 underline dark:text-indigo-300">People</Link>.</p>
    </div>

    {draftFor && <ContactDraft key={draftFor.id} contact={draftFor} applicationId={applicationId} />}
  </div>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

function PersonRow({ name, title, profile, action, source }: { name: string; title: string; profile: string | null; action: ReactNode; source?: string | null }) {
  return <div className="workspace-panel flex h-full flex-col gap-3 p-4">
    <div className="flex items-start gap-3">
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-indigo-500/10 text-sm font-semibold text-indigo-700 dark:text-indigo-300">{initials(name)}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{name}</p>
        <p className="text-[13px] text-zinc-600 dark:text-zinc-400">{title || "Role not shown"}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
          {profile && <a href={profile} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">LinkedIn profile ↗</a>}
          {source && source !== profile && <a href={source} target="_blank" rel="noopener noreferrer" className="text-zinc-600 hover:underline dark:text-zinc-400">Where it was found ↗</a>}
        </div>
      </div>
    </div>
    <div className="mt-auto">{action}</div>
  </div>;
}

function Lead({ person, source, applicationId, jobVersion, onSaved }: { person: NetworkPerson; source: string | null; applicationId: string; jobVersion?: string; onSaved: (c: JobContact) => void }) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await post<{ created: boolean; contact: JobContact }>(applicationId, "capture", { person, job_version: jobVersion ?? null, source_url: source, remind_in_days: null });
      setSaved(true); onSaved(r.contact);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  return <>
    <PersonRow name={person.name} title={person.title} profile={person.linkedin_url} source={source}
      action={<Button size="sm" loading={busy} disabled={saved} disabledReason="Saved to People." onClick={() => void save()}>{saved ? "Saved" : "Save and write a message"}</Button>} />
    {error && <ErrorNote>{error}</ErrorNote>}
  </>;
}

/** Automatic search is off. Candidates see a plain note; only admins see why and what to change on the server. */
function SearchOff({ reason, known }: { reason: NetworkContext["web_search_off_reason"]; known: boolean }) {
  const admin = useAsync(() => api.adminStatus(), [], "admin-status");
  if (!admin.data?.is_admin) return null;
  const why = !known ? "The API is running an older version. Redeploy it."
    : reason === "no_key" ? "The API has no AI key, so automatic search is off. Set DEEPSEEK_API_KEY on the API service and redeploy."
    : reason === "mock_mode" ? "The API is in demo AI mode (LLM_PROVIDER=mock). Set it to auto and redeploy."
    : reason === "deepseek_off" ? "Search is switched off (ORBIT_CONTACT_DEEPSEEK_SEARCH=false). Remove that setting and redeploy."
    : "No search service is configured on the API.";
  return <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
    <p className="font-medium">Automatic search is off <span className="font-normal">(visible to admins only)</span></p>
    <p className="mt-1">{why}</p>
  </div>;
}

function ContactDraft({ contact, applicationId }: { contact: JobContact; applicationId: string }) {
  const inputId = useId();
  const [channel, setChannel] = useState<"connection" | "email">("connection");
  const [relationship, setRelationship] = useState(false);
  const [draft, setDraft] = useState<NetworkDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function write() {
    setBusy(true); setError(null); setDraft(null); setCopied(false);
    try { setDraft(await post<NetworkDraft>(applicationId, "draft", { contact_id: contact.id, channel, prior_relationship: relationship })); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  async function copy() {
    if (!draft) return;
    try { await navigator.clipboard.writeText(draft.subject ? `${draft.subject}\n\n${draft.message}` : draft.message); setCopied(true); }
    catch { setError("Clipboard unavailable. Select and copy the draft text manually."); }
  }
  return <div className="rounded-xl border border-indigo-200 p-4 dark:border-indigo-500/20">
    <h3 className="font-semibold">Draft for {contact.name}</h3>
    <p className="mt-1 text-sm text-zinc-500">Adapts to the saved role and this job. Qualifications come only from a resume linked to the tracked job. Review and edit before copying; nothing is sent.</p>
    <div className="mt-3"><Field label="Message format" htmlFor={`${inputId}-format`}><Select id={`${inputId}-format`} value={channel} disabled={busy} onChange={(e) => { setChannel(e.target.value as typeof channel); setDraft(null); setCopied(false); }}><option value="connection">Short introduction · 200 characters</option><option value="email">Email · 1,500 characters</option></Select></Field></div>
    <label className="my-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className={focusRing} checked={relationship} disabled={busy} onChange={(e) => { setRelationship(e.target.checked); setDraft(null); }} />I have personally interacted with this contact before</label>
    <Button loading={busy} onClick={() => void write()}>Draft outreach with AI</Button>
    {error && <ErrorNote>{error}</ErrorNote>}
    {draft && <div className="mt-4 space-y-3">
        {channel === "email" && <Field label="Subject" htmlFor={`${inputId}-subject`}><Input id={`${inputId}-subject`} value={draft.subject} maxLength={160} onChange={(e) => { setDraft({ ...draft, subject: e.target.value }); setCopied(false); }} /></Field>}
      <Field label="Outreach draft" htmlFor={`${inputId}-draft`}><Textarea id={`${inputId}-draft`} value={draft.message} rows={5} onChange={(e) => { setDraft({ ...draft, message: e.target.value }); setCopied(false); }} /></Field>
      <p className="text-xs" role="status">{draft.message.length}/{draft.character_limit} characters{draft.message.length > draft.character_limit ? " · shorten before copying" : ""}</p>
      <Button variant="secondary" disabled={draft.message.length > draft.character_limit} disabledReason={`Shorten the draft to ${draft.character_limit} characters first.`} onClick={() => void copy()}>{copied ? "Copied" : "Copy draft"}</Button>
      <p className="text-xs text-zinc-500">Copying does not mark this person contacted. Log the interaction in People after you actually get in touch.</p>
    </div>}
  </div>;
}
