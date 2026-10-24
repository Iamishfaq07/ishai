import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, ErrorNote, Input, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { useJobsAi } from "./JobsAi";
import { errorText } from "../../lib/format";
interface Address { email: string; quote: string }
interface Job { id: string; title: string; company: string; source_url: string; text: string }
export function EmailJobIntake() {
  const navigate = useNavigate();
  const { tracker } = useJobsAi();
  const [existingId, setExistingId] = useState("");
  const [sourceVersion, setSourceVersion] = useState("");
  const [selectedSummary, setSelectedSummary] = useState("");
  const selection = useRef(0);
  const selectOpportunity = async (id: string) => {
    const request = ++selection.current;
    setExistingId(id); setSourceVersion(""); setSelectedSummary(""); setConfirmed(false);
    if (!id) return;
    try {
      const current = await api.call<{ version: string; title: string; company: string }>(`/v1/jobs/tracker/${id}/message-update`);
      if (request === selection.current) { setSourceVersion(current.version); setSelectedSummary(`${current.title} · ${current.company}`); }
    } catch { if (request === selection.current) setError("Could not load the selected opportunity. Refresh it before attaching a source."); }
  };
  const [text, setText] = useState(""); const [title, setTitle] = useState(""); const [company, setCompany] = useState(""); const [url, setUrl] = useState("");
  const [addresses, setAddresses] = useState<Address[]>([]); const [recipient, setRecipient] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const run = async (action: "discover" | "preview" | "import") => {
    setBusy(true); setError("");
    try {
      if (action === "discover") { const result = await api.call<{ jobs: Job[]; note: string }>("/v1/gmail/jobs/discover"); setJobs(result.jobs); setNote(result.note); }
      else if (action === "preview") { const result = await api.call<{ recipients: Address[] }>("/v1/gmail/jobs/preview", { method: "POST", body: JSON.stringify({ text }) }); setAddresses(result.recipients); setRecipient(""); setConfirmed(false); }
      else {
        const version = sourceVersion;
        const result = await api.call<{ entry_id: string }>(existingId ? `/v1/gmail/jobs/${existingId}/source` : "/v1/gmail/jobs/import", { method: "POST", body: JSON.stringify(existingId ? { text, source_url: url || null, recipient, confirmed, version } : { text, title, company, source_url: url || null, recipient, confirmed }) });
        tracker.reload(); navigate(`/jobs/mission/${result.entry_id}?tab=resume`);
      }
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <details className="rounded-xl border border-zinc-200 p-4 dark:border-white/10"><summary className="cursor-pointer font-semibold">Find jobs that accept applications by email</summary><div className="mt-3 space-y-3">
    <p className="text-sm">Find email-bearing jobs in your eligible Orbit matches, or paste a job post from LinkedIn or another source. Review that the email is an application address. Orbit does not search your LinkedIn account or guess recruiter addresses.</p>
    <Button disabled={busy} variant="secondary" onClick={() => void run("discover")}>Find email-bearing matched jobs</Button>{note && <p className="text-xs">{note}</p>}
    <ul className="space-y-2">{jobs.map((job) => <li key={job.id}><Button variant="ghost" disabled={busy} onClick={() => { void selectOpportunity(""); setText(job.text); setTitle(job.title); setCompany(job.company); setUrl(job.source_url); setAddresses([]); setRecipient(""); setConfirmed(false); }}>{job.title} · {job.company}</Button></li>)}</ul>
    <fieldset disabled={busy} className="space-y-3">
      <Select aria-label="Attach source to existing opportunity" value={existingId} onChange={(e) => void selectOpportunity(e.target.value)}><option value="">Create a new tracked opportunity</option>{tracker.data?.filter((j) => !["withdrawn", "rejected", "hired"].includes(j.status)).map((j) => <option key={j.id} value={j.id}>{j.title} · {j.company}</option>)}</Select>
      {existingId && <><p className="text-sm">Selected: {selectedSummary || "Loading current opportunity…"}</p><Button variant="ghost" onClick={() => void selectOpportunity(existingId)}>Refresh selected opportunity</Button><p className="text-xs">Attach this reviewed source to the selected opportunity. The prior document is retained. Prepared Gmail drafts must be discarded before replacing their source.</p></>}<label className="block text-sm">Job post text<textarea className="mt-1 min-h-36 w-full rounded-lg border bg-transparent p-3" maxLength={20000} value={text} onChange={(e) => { setText(e.target.value); setAddresses([]); setRecipient(""); setConfirmed(false); }} /></label>
      <Input aria-label="Email job title" placeholder="Job title" value={title} maxLength={200} disabled={Boolean(existingId)} onChange={(e) => { setTitle(e.target.value); setConfirmed(false); }} />
      <Input aria-label="Email job company" placeholder="Company" value={company} maxLength={160} disabled={Boolean(existingId)} onChange={(e) => { setCompany(e.target.value); setConfirmed(false); }} />
      <Input aria-label="Original job post URL" placeholder="Original post URL (optional)" type="url" value={url} onChange={(e) => { setUrl(e.target.value); setConfirmed(false); }} />
      <Button disabled={text.trim().length < 50} onClick={() => void run("preview")}>Find email addresses in this post</Button>
      {!!addresses.length && <><Select aria-label="Application email from post" value={recipient} onChange={(e) => { setRecipient(e.target.value); setConfirmed(false); }}><option value="">Choose the application address</option>{addresses.map((a) => <option key={a.email} value={a.email}>{a.email}</option>)}</Select>
        {recipient && <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">{addresses.find((a) => a.email === recipient)?.quote}</blockquote>}
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I checked the original instructions and this is the application address for this job.</label>
        <Button disabled={!confirmed || !recipient || (Boolean(existingId) && !sourceVersion) || (!existingId && (title.trim().length < 2 || company.trim().length < 2))} onClick={() => void run("import")}>Save email job and prepare application</Button></>}
      {!addresses.length && text && <p className="text-xs">No application address selected. Find addresses in the post, then review the source excerpt.</p>}
    </fieldset>{error && <ErrorNote>{error}</ErrorNote>}
  </div></details>;
}
