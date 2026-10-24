import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, ErrorNote, Input } from "../../components/ui";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
interface Attempt { id: string; status: string; sender: string; recipient: string; subject: string; body: string; attachment: string | null; message_id?: string; reason?: string }
export function GmailApply({ entryId }: { entryId: string }) {
  const records = useAsync(() => api.call<Attempt[]>(`/v1/gmail/attempts/${entryId}`), [entryId], `gmail-attempt:${entryId}`);
  const [recipient, setRecipient] = useState(""); const [subject, setSubject] = useState(""); const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null); const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const attempt = records.data?.[0];
  const run = async (action: "draft" | "send" | "discard") => {
    setBusy(true); setError("");
    try {
      if (action === "draft") { const form = new FormData(); form.append("payload", JSON.stringify({ recipient, subject, body })); if (file) form.append("file", file); await api.call(`/v1/gmail/draft/${entryId}`, { method: "POST", body: form }); }
      else if (attempt) await api.call(`/v1/gmail/attempts/${attempt.id}${action === "send" ? "/send" : ""}`, { method: action === "send" ? "POST" : "DELETE", ...(action === "send" ? { body: JSON.stringify({ confirmed }) } : {}) });
      setConfirmed(false); records.reload();
    } catch { setError("Could not complete this action. Reload the email record before retrying; uncertain sends must not be resent."); records.reload(); }
    finally { setBusy(false); }
  };
  return <details className="my-4 rounded-xl border border-zinc-200 p-4 dark:border-white/10"><summary className="cursor-pointer font-semibold">Apply by Gmail</summary><div className="mt-3 space-y-3">
    <p className="text-sm">Use an employer’s published application address or a recipient you have approved. <Link className="underline" to="/settings">Connect Gmail in Settings</Link>.</p>
    {records.loading && <p role="status">Loading email record…</p>}
    {records.error && <ErrorNote onRetry={records.reload}>Could not load the email record.</ErrorNote>}
    {!attempt && records.data && <fieldset disabled={busy} className="space-y-3">
      <Input aria-label="Application recipient" type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="hiring@company.com" />
      <Input aria-label="Application email subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} placeholder="Application for…" />
      <label className="block text-sm">Application email<textarea className="mt-2 min-h-40 w-full rounded-lg border bg-transparent p-3" value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} /></label>
      <label className="block text-sm">Resume PDF (optional, up to 5 MB)<input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <Button disabled={!recipient || subject.trim().length < 3 || body.trim().length < 20} onClick={() => void run("draft")}>Prepare email for review</Button>
    </fieldset>}
    {attempt && <><p className="text-sm font-medium">Status: {attempt.status}</p><p className="break-all text-sm">From {attempt.sender} → {attempt.recipient}</p><p>{attempt.subject}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">{attempt.body}</pre><p className="text-sm">Attachment: {attempt.attachment || "None"}</p>
      {attempt.status === "ready" ? <><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />I reviewed this recipient, email and attachment and authorize sending it from my Gmail.</label><Button disabled={!confirmed || busy} onClick={() => void run("send")}>Send approved email</Button><Button variant="ghost" disabled={busy} onClick={() => void run("discard")}>Discard unsent draft</Button></>
      : <p className="text-sm">{attempt.status === "sent" ? `Gmail accepted the email. Message ID: ${attempt.message_id}. This does not prove employer receipt.` : "This attempt cannot be resent automatically. Check Gmail Sent before taking another action."} {attempt.reason}</p>}</>}
    {error && <ErrorNote>{error}</ErrorNote>}
  </div></details>;
}
