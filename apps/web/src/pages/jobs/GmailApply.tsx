import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, ErrorNote, Input } from "../../components/ui";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
interface Delivery { number: number; status: string; recorded_at?: string; reserved_at: string; reason?: string }
interface Attempt { retryable?: boolean; retry_after?: string; deliveries?: Delivery[]; tailoring?: { ai_used: boolean; source_quote: string; changes: { label: string; before: string; after: string }[] }; id: string; status: string; sender: string; recipient: string; subject: string; body: string; attachment: string | null; message_id?: string; reason?: string }
export function GmailApply({ entryId }: { entryId: string }) {
  const records = useAsync(() => api.call<Attempt[]>(`/v1/gmail/attempts/${entryId}`), [entryId], `gmail-attempt:${entryId}`);
  const [recipient, setRecipient] = useState(""); const [subject, setSubject] = useState(""); const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null); const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [open, setOpen] = useState(() => window.location.hash === "#gmail-apply");
  useEffect(() => {
    const reveal = () => { if (window.location.hash === "#gmail-apply") setOpen(true); };
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  const attempt = records.data?.[0];
  const resumes = useAsync(() => api.listResumes(), [], "gmail-source-resumes");
  const [resumeId, setResumeId] = useState("");
  const prepareTailored = async () => {
    setBusy(true); setError("");
    try { await api.call(`/v1/gmail/jobs/${entryId}/tailor`, { method: "POST", timeoutMs: 90000, body: JSON.stringify({ resume_id: resumeId }) }); records.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not prepare this application."); }
    finally { setBusy(false); }
  };
  const downloadAttachment = async () => {
    if (!attempt) return;
    try { const response = await api.callRaw(`/v1/gmail/attempts/${attempt.id}/attachment`); const url = URL.createObjectURL(await response.blob()); const a = document.createElement("a"); a.href = url; a.download = attempt.attachment || "resume.docx"; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch { setError("Could not download the captured attachment."); }
  };
  const run = async (action: "draft" | "send" | "discard" | "retry") => {
    setBusy(true); setError("");
    try {
      if (action === "draft") { const form = new FormData(); form.append("payload", JSON.stringify({ recipient, subject, body })); if (file) form.append("file", file); await api.call(`/v1/gmail/draft/${entryId}`, { method: "POST", body: form }); }
      else if (attempt) await api.call(`/v1/gmail/attempts/${attempt.id}${action === "send" ? "/send" : action === "retry" ? "/retry" : ""}`, { method: action === "discard" ? "DELETE" : "POST", ...(action !== "discard" ? { body: JSON.stringify({ confirmed }) } : {}) });
      setConfirmed(false); records.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not complete this action. Reload the email record before retrying."); setConfirmed(false); records.reload(); }
    finally { setBusy(false); }
  };
  return <details id="gmail-apply" open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="my-4 rounded-xl border border-zinc-200 p-4 dark:border-white/10"><summary className="cursor-pointer font-semibold">Apply by Gmail</summary><div className="mt-3 space-y-3">
    <p className="text-sm">Send your application to the email address the employer published, from your own Gmail. <Link className="underline" to="/settings">Connect Gmail in Settings</Link>.</p>
    {records.loading && <p role="status">Loading your email…</p>}
    {records.error && <ErrorNote onRetry={records.reload}>Couldn't load this email.</ErrorNote>}
    {!attempt && records.data && <fieldset disabled={busy} className="space-y-3">
      <p className="text-sm">Choose a resume and Orbit writes a version tailored to this job, plus the application email. It only uses facts already in your resume. You review both before anything is sent. Up to 5 a day.</p>
      <select aria-label="Source resume for email tailoring" className="w-full rounded-lg border bg-transparent p-2" value={resumeId} onChange={(e) => setResumeId(e.target.value)}><option value="">Choose a resume</option>{resumes.data?.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select>
      <Button disabled={!resumeId} onClick={() => void prepareTailored()}>Tailor my resume and write the email</Button>
      <p className="text-xs text-zinc-500">Or write the email yourself and attach your resume.</p>
      <Input aria-label="Application recipient" type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="hiring@company.com" />
      <Input aria-label="Application email subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} placeholder="Application for…" />
      <label className="block text-sm">Application email<textarea className="mt-2 min-h-40 w-full rounded-lg border bg-transparent p-3" value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} /></label>
      <label className="block text-sm">Resume PDF or DOCX (optional, up to 5 MB)<input type="file" accept="application/pdf,.pdf,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <Button disabled={!recipient || subject.trim().length < 3 || body.trim().length < 20} onClick={() => void run("draft")}>Review before sending</Button>
    </fieldset>}
    {attempt && <><p className="text-sm font-medium">{attempt.status === "ready" ? "Ready to send" : attempt.status === "sent" ? "Gmail accepted your email" : attempt.status === "rejected" ? "Gmail rejected your email" : "Check Gmail before doing anything else"}</p><p className="break-all text-sm">From {attempt.sender} → {attempt.recipient}</p><p>{attempt.subject}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">{attempt.body}</pre><p className="text-sm">Attachment: {attempt.attachment || "None"}</p>
      {attempt.attachment && <Button variant="secondary" onClick={() => void downloadAttachment()}>Download the attached resume</Button>}
      {attempt.tailoring && <details><summary className="cursor-pointer">See what changed in your resume</summary><p className="text-xs">{attempt.tailoring.ai_used ? "Includes checked AI rewording." : "Existing facts prioritized for this job; no AI rewording was retained."} Download the DOCX to inspect the complete resume.</p><blockquote className="my-2 whitespace-pre-wrap text-xs">{attempt.tailoring.source_quote}</blockquote>{attempt.tailoring.changes.map((c, i) => <div key={i} className="my-3 text-xs"><strong>{c.label}</strong><p className="whitespace-pre-wrap">Before: {c.before}</p><p className="whitespace-pre-wrap">After: {c.after}</p></div>)}</details>}
      {attempt.status === "ready" ? <><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />I reviewed this recipient, email and attachment and authorize sending it from my Gmail.</label><Button disabled={!confirmed || busy} onClick={() => void run("send")}>Send email</Button>{!attempt.deliveries?.length && <Button variant="ghost" disabled={busy} onClick={() => void run("discard")}>Discard unsent draft</Button>}</>
      : <p className="text-sm">{attempt.status === "sent" ? `Gmail accepted the email. Message ID: ${attempt.message_id}. This does not prove employer receipt.` : "This attempt cannot be resent automatically. Check Gmail Sent before taking another action."} {attempt.reason}</p>}</>}
    {attempt?.status === "rejected" && attempt.retryable && (attempt.deliveries?.length ?? 0) < 5 && <div className="space-y-2">
      <p className="text-sm">Gmail explicitly rejected this send. Resolve the access or quota issue before retrying. {attempt.retry_after && <>Retry available after {new Date(attempt.retry_after).toLocaleString()}.</>} The same recipient, message and attachment will return for review.</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />Return this rejected email for review before another send.</label>
      <Button disabled={!confirmed || busy} onClick={() => void run("retry")}>Return rejected email to review</Button>
    </div>}
    {!!attempt?.deliveries?.length && <details><summary className="cursor-pointer text-sm">Delivery history ({attempt.deliveries.length}/5)</summary><ol className="list-inside list-decimal text-sm">{attempt.deliveries.map((d) => <li key={d.number}>{d.status} — {new Date(d.recorded_at || d.reserved_at).toLocaleString()}{d.reason && `: ${d.reason}`}</li>)}</ol></details>}
    {error && <ErrorNote>{error}</ErrorNote>}
  </div></details>;
}
