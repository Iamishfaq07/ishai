import { useId, useState } from "react";
import { Link } from "react-router-dom";
import type { JobContact, NetworkContext, NetworkDraft, NetworkPerson, NetworkResearch } from "@orbit/types";
import { focusRing } from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, Select, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useJobsAi } from "./JobsAi";
import { STATUS_LABEL } from "./model";
import { missionPath } from "./mission";

const root = (id: string) => `/v1/jobs/network/${encodeURIComponent(id)}`;
const post = <T,>(id: string, action: string, body: unknown) => api.call<T>(`${root(id)}/${action}`, {
  method: "POST", body: JSON.stringify(body), timeoutMs: 120_000,
});

export default function ContactResearch({ listingId, onSaved }: { listingId: string | null; onSaved: () => void }) {
  const selectId = useId();
  const { tracker } = useJobsAi();
  const jobs = tracker.data ?? [];
  const [choice, setChoice] = useState({ context: listingId, id: "" });
  const target = jobs.find((j) => j.id === (choice.context === listingId ? choice.id : ""))
    ?? jobs.find((j) => j.listing_id === listingId) ?? (listingId ? undefined : jobs[0]);
  return <section id="contact-research" aria-label="Contact finder" className="mt-4 space-y-4">
    <Field label="Job to research" htmlFor={selectId}><Select id={selectId} value={target?.id ?? ""} onChange={(e) => setChoice({ context: listingId, id: e.target.value })}>
      {!target && <option value="">{jobs.length ? "Choose a saved job" : "Save a job first"}</option>}
      {jobs.map((j) => <option key={j.id} value={j.id}>{j.title} · {j.company}</option>)}
    </Select></Field>
    {tracker.error && <ErrorNote onRetry={tracker.reload}>{errorText(tracker.error)}</ErrorNote>}
    {listingId && jobs.length > 0 && !target && <p className="rounded-xl bg-amber-500/10 p-3 text-sm">The linked job is not in your tracker. Save it first, or explicitly choose a different saved job to research.</p>}
    {!jobs.length ? <p className="text-sm">Save a job in <Link className="underline" to="/jobs/matches">Matches</Link> or add it to your tracker to start contact research.</p> :
      target && <JobNetwork key={target.id} applicationId={target.id} onSaved={onSaved} />}
  </section>;
}

function JobNetwork({ applicationId, onSaved }: { applicationId: string; onSaved: () => void }) {
  const state = useAsync(() => api.call<NetworkContext>(root(applicationId)), [applicationId], `network:${applicationId}`);
  return <>
    {state.error && <ErrorNote onRetry={state.reload}>{errorText(state.error)}</ErrorNote>}
    {state.data ? <Workspace data={state.data} reload={state.reload} onSaved={onSaved} /> : <p className="text-sm">Checking your saved contacts and company history…</p>}
  </>;
}

function Workspace({ data, reload, onSaved }: { data: NetworkContext; reload: () => void; onSaved: () => void }) {
  const inputId = useId();
  const id = data.job.id;
  const [pageUrl, setPageUrl] = useState("");
  const [paste, setPaste] = useState("");
  const [searchWeb, setSearchWeb] = useState(data.web_search_enabled && !data.saved_contacts.length);
  const [research, setResearch] = useState<NetworkResearch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<JobContact | null>(null);
  async function find() {
    setBusy(true); setError(null); setResearch(null);
    try { setResearch(await post<NetworkResearch>(id, "research", { version: data.version, page_url: pageUrl || null, pasted_text: paste, search_web: searchWeb })); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  const saved = (contact: JobContact) => { setTarget(contact); reload(); onSaved(); };
  return <div className="space-y-5">
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/5">
      <h3 className="font-semibold">Start with people you already saved</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Contacts at {data.job.company}, including people saved for earlier roles. A saved contact does not automatically mean you know them.</p>
      {data.saved_contacts.length ? <ul className="mt-3 space-y-2">{data.saved_contacts.map((contact) => <li key={contact.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3 dark:bg-zinc-950">
        <div><p className="text-sm font-semibold">{contact.name}</p><p className="text-xs text-zinc-500">{contact.title || "Role not recorded"}{contact.application_label ? ` · ${contact.application_label}` : ""}</p>
          <p className="mt-1 text-xs">{contact.last_contacted_at ? `Contact logged ${new Date(contact.last_contacted_at).toLocaleDateString()}` : "No prior contact logged"}</p></div>
        <Button variant="secondary" size="sm" onClick={() => setTarget(contact)}>Draft for {contact.name}</Button>
      </li>)}</ul> : <p className="mt-3 text-sm">No saved contact at this company yet.</p>}
    </div>
    <details className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <summary className="cursor-pointer font-semibold">Your history with {data.job.company}</summary>
      <p className="mt-2 text-xs text-zinc-500">Your own tracker records, including this role. These are recorded stages, not an assessment of the employer.</p>
      <dl className="mt-3 flex flex-wrap gap-3">{Object.entries(data.company_history.counts).map(([status, count]) => <div className="rounded-lg bg-zinc-100 p-2 dark:bg-white/5" key={status}><dt className="text-xs">{STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status}</dt><dd className="font-semibold">{count}</dd></div>)}</dl>
      {data.company_history.truncated && <p className="mt-2 text-xs">History covers your 2,000 most recently updated tracked jobs.</p>}
      <ul className="mt-3 space-y-1 text-sm">{data.company_history.applications.map((job) => <li key={job.id}><Link className="underline" to={missionPath(job.id)}>{job.title}</Link> · {STATUS_LABEL[job.status]}</li>)}</ul>
    </details>
    <div>
      <h3 className="font-semibold">Find a public contact or capture a reply</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Orbit checks the saved job post, a public company/team page, or text you paste from a recruiter reply. It suggests up to three leads with exact source excerpts.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Public company or team page (optional)" htmlFor={`${inputId}-page`}><Input id={`${inputId}-page`} type="url" value={pageUrl} maxLength={1000} placeholder="https://company.com/team" onChange={(e) => setPageUrl(e.target.value)} /></Field>
        <div className="flex flex-col justify-center gap-2 text-sm">{data.search_links.map((link) => <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline dark:text-indigo-300">{link.label} ↗</a>)}</div>
      </div>
      <div className="mt-3"><Field label="Recruiter reply or public profile text (optional)" htmlFor={`${inputId}-paste`}><Textarea id={`${inputId}-paste`} value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} maxLength={10000} placeholder={"From: Alex Rivera <alex@company.com>\nTitle: Talent Acquisition Partner\n\nPaste only relevant contact details and context."} /></Field></div>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className={focusRing} checked={searchWeb} disabled={!data.web_search_enabled || busy} onChange={(e) => setSearchWeb(e.target.checked)} />Search the public web for this company and role (one query)</label>
      {!data.web_search_enabled && <p className="text-xs text-zinc-500">Web search is unavailable here. Use a public company page, paste a reply, or open the search links.</p>}
      {data.web_search_provider === "searxng" && <p className="text-xs text-zinc-500">Open-source web search · no search API key. Review each result’s source before saving a contact.</p>}
      <Button className="mt-3" loading={busy} onClick={() => void find()}>Find contacts with AI</Button>
      <p className="mt-2 text-xs text-zinc-500">Up to 5 research runs per UTC day; failed runs count. Nothing is saved or sent until you choose a lead. Public roles and snippets may be outdated—review the source.</p>
      {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
    </div>
    {research && <div aria-live="polite" className="space-y-3">
      {research.provider === "mock" && <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Demo response · mock provider</p>}
      {research.warnings.map((warning) => <p className="text-sm text-amber-800 dark:text-amber-300" key={warning}>{warning}</p>)}
      {!research.people.length && <p className="rounded-xl bg-zinc-100 p-4 text-sm dark:bg-white/5">No contact could be grounded in these sources. Try a relevant public team page or paste a recruiter reply.</p>}
      {research.people.map((person) => <Lead key={`${person.source_id}:${person.name}`} person={person} source={research.sources.find((s) => s.id === person.source_id)} applicationId={id} onSaved={saved} />)}
    </div>}
    {target && <ContactDraft key={target.id} contact={target} applicationId={id} />}
  </div>;
}

function Lead({ person, source, applicationId, onSaved }: { person: NetworkPerson; source: NetworkResearch["sources"][number] | undefined; applicationId: string; onSaved: (contact: JobContact) => void }) {
  const [reviewed, setReviewed] = useState(false);
  const [remind, setRemind] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function capture() {
    setBusy(true); setError(null);
    try {
      const result = await post<{ created: boolean; contact: JobContact }>(applicationId, "capture", {
        person, source_url: source?.url ?? null, remind_in_days: remind ? 7 : null,
      });
      setSaved(result.created ? "Saved to People with its source." : "Already saved. Existing details and reminders kept."); onSaved(result.contact);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  return <Card className="p-4">
    <h4 className="font-semibold">{person.name}</h4><p className="text-sm text-zinc-500">{person.title || "Role not confirmed"}</p>
    {person.email && <p className="mt-1 break-all text-sm">{person.email}</p>}
    {person.linkedin_url && <a className="mt-1 block text-sm text-indigo-700 underline dark:text-indigo-300" href={person.linkedin_url} target="_blank" rel="noopener noreferrer">Published professional profile ↗</a>}
    <details className="mt-3 text-sm"><summary className="min-h-8 cursor-pointer">Review source evidence</summary><blockquote className="my-2 whitespace-pre-wrap break-words rounded-lg bg-zinc-100 p-3 text-xs dark:bg-white/5">{person.quote}</blockquote>
      {source?.url ? <a className="break-all text-indigo-700 underline dark:text-indigo-300" href={source.url} target="_blank" rel="noopener noreferrer">Open source ↗</a> : <p>Candidate-provided text; identity not independently verified.</p>}
      {source && <p className="mt-1 text-xs text-zinc-500">{source.kind === "search_snippet" ? "Search snippet, not a verified current role" : "Source supplied for this research"} · retrieved {new Date(source.checked_at).toLocaleString()}</p>}
    </details>
    <label className="mt-2 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className={focusRing} checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />I reviewed this lead and its source</label>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className={focusRing} checked={remind} onChange={(e) => setRemind(e.target.checked)} />Remind me about this contact in 7 days</label>
    <Button variant="secondary" loading={busy} disabled={!reviewed || !!saved} onClick={() => void capture()}>Save {person.name} to People</Button>
    {saved && <p className="mt-2 text-sm" role="status">{saved}</p>}{error && <ErrorNote>{error}</ErrorNote>}
  </Card>;
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
      {draft.provider === "mock" && <p className="text-sm text-amber-800 dark:text-amber-300">Demo response · mock provider</p>}
      {channel === "email" && <Field label="Subject" htmlFor={`${inputId}-subject`}><Input id={`${inputId}-subject`} value={draft.subject} maxLength={160} onChange={(e) => { setDraft({ ...draft, subject: e.target.value }); setCopied(false); }} /></Field>}
      <Field label="Outreach draft" htmlFor={`${inputId}-draft`}><Textarea id={`${inputId}-draft`} value={draft.message} rows={5} onChange={(e) => { setDraft({ ...draft, message: e.target.value }); setCopied(false); }} /></Field>
      <p className="text-xs" role="status">{draft.message.length}/{draft.character_limit} characters{draft.message.length > draft.character_limit ? " · shorten before copying" : ""}</p>
      <Button variant="secondary" disabled={draft.message.length > draft.character_limit} onClick={() => void copy()}>{copied ? "Copied" : "Copy draft"}</Button>
      <p className="text-xs text-zinc-500">Copying does not mark this person contacted. Log the interaction in People after you actually get in touch.</p>
    </div>}
  </div>;
}
