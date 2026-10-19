import { useEffect, useId, useRef, useState } from "react";
import type { BizHiringRoom, BizInterviewFeedback } from "@orbit/types";
import { Button, Callout, Field, Textarea, confirmDialog } from "@orbit/ui";
import { hiringApi } from "./hiringApi";
import { errorText } from "./ui";

export function FeedbackAddenda({ feedback, cid, aid, editable = false, onSaved }: {
  feedback: BizInterviewFeedback; cid: string; aid: string; editable?: boolean; onSaved?: (room: BizHiringRoom) => void;
}) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const request = useRef("");
  useEffect(() => {
    if (!reason && !message) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [reason, message]);
  const save = async () => {
    if (!(await confirmDialog({ title: "Append this feedback context?", body: "This dated addendum will be shared under the same independent-feedback rules. Your original ratings and observations remain sealed.", confirmLabel: "Append context" }))) return;
    setBusy(true); setError(null); setNotice("");
    try {
      request.current ||= crypto.randomUUID();
      const room = await hiringApi.addendum(cid, aid, feedback.id, reason, message, feedback.addenda.length, request.current);
      onSaved?.(room);
      setReason(""); setMessage(""); request.current = "";
      setNotice("Context appended. The original feedback is unchanged.");
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  if (!feedback.addenda.length && !editable) return null;
  return <div className="mt-3 space-y-3">
    {feedback.addenda.length > 0 && <ol className="space-y-3" aria-label={`Addenda from ${feedback.author}`}>
      {feedback.addenda.map((addendum) => <li key={addendum.id} className="border-l-2 border-indigo-400 pl-3 text-sm">
        <p className="font-medium">Added context · {addendum.author}</p>
        <time dateTime={addendum.created_at} className="mt-1 block text-xs text-zinc-500">{new Date(addendum.created_at).toLocaleString()}</time>
        <p className="mt-2 font-medium">{addendum.reason}</p><p className="mt-1 whitespace-pre-wrap break-words">{addendum.message}</p>
      </li>)}
    </ol>}
    {editable && <details className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <summary className="cursor-pointer text-sm font-medium">Add context to your submitted feedback</summary>
      <p className="mt-2 text-sm text-zinc-500">Correct or clarify the record with a dated note. Original scores stay unchanged, and the team should revisit decisions when new context matters.</p>
      <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <fieldset disabled={busy} className="space-y-3">
          <Field label="Why are you adding context?" htmlFor={`${id}-reason`}><Textarea id={`${id}-reason`} rows={2} minLength={12} maxLength={400} required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label="Additional context" htmlFor={`${id}-message`}><Textarea id={`${id}-message`} rows={4} minLength={30} maxLength={3000} required value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        </fieldset>
        <Button type="submit" loading={busy}>Append context</Button>
      </form>
    </details>}
    {error && <Callout tone="error">{error} Your text is still here; copy it before reloading.</Callout>}
    {notice && <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">{notice}</p>}
  </div>;
}
