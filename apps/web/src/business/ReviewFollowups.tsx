import { useEffect, useRef, useState } from "react";
import type { BizWorkflowRun } from "@orbit/types";
import { ArrowRight, Button, Callout, Field, Input, Select, Textarea, focusRing } from "@orbit/ui";
import { useAuth } from "../lib/auth";
import { useCompany } from "./BusinessApp";
import { reviewFollowups } from "./workflowApi";
import { LoadError, errorText } from "./ui";
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
export function ReviewFollowupControls({ step, index, data, onSaved }: { step: BizWorkflowRun["steps"][number]; index: number; data: BizWorkflowRun; onSaved: (data: BizWorkflowRun) => void }) {
  const { company } = useCompany(); const { user } = useAuth(); const review = step.review!;
  const [due, setDue] = useState(review.due_date ?? ""); const [enabled, setEnabled] = useState(review.reminders_enabled);
  const [until, setUntil] = useState(review.snoozed_until?.slice(0, 10) ?? day(1));
  const [reviewer, setReviewer] = useState(""); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<Error | null>(null);
  const live = useRef(true); const locked = useRef(false); const requestId = useRef(crypto.randomUUID());
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  if (review.status !== "pending" || review.invalidated_at || !review.valid || data.status !== "active") return null;
  const available = data.owners.filter(o => ![user?.id, step.owner_id, review.requester_id, review.reviewer_id].includes(o.id));
  const disabled = busy || company.status !== "active";
  const run = async (action: "save" | "snooze" | "resume" | "handoff") => {
    if (locked.current) return; locked.current = true; setBusy(true); setError(null);
    try {
      const next = action === "save" ? await reviewFollowups.configure(company.id, data.job_id, data.id, step.id, review.id, data.revision, due || null, enabled) : action === "handoff" ? await reviewFollowups.handoff(company.id, data.job_id, data.id, step.id, review.id, requestId.current, data.revision, reviewer, reason) : await reviewFollowups.snooze(company.id, data.job_id, data.id, step.id, review.id, data.revision, action === "resume" ? null : until);
      if (live.current) { requestId.current = crypto.randomUUID(); onSaved(next); }
    } catch (e) { if (live.current) setError(new Error(errorText(e))); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  return <details className="rounded-xl border border-zinc-200 p-3 dark:border-white/10"><summary className={`cursor-pointer text-sm font-medium ${focusRing}`}>Follow-ups and reviewer handoff for step {index + 1}</summary><div className="mt-4 space-y-5">
    {review.can_manage_followup && <fieldset disabled={disabled} className="space-y-3"><legend className="mb-2 text-sm font-semibold">Review due date and internal reminders</legend><Field label={`Review due date for step ${index + 1} (UTC)`} htmlFor={`review-due-${step.id}`}><Input id={`review-due-${step.id}`} type="date" value={due} max={day(365)} onChange={e => setDue(e.target.value)} /></Field><label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className={`mt-1 ${focusRing}`} checked={enabled} onChange={e => setEnabled(e.target.checked)} />Enable internal overdue reminders for this review</label><Button variant="secondary" disabled={disabled || (enabled && !due)} onClick={() => void run("save")}>Save review follow-ups for step {index + 1}</Button><p className="text-xs text-zinc-600 dark:text-zinc-400">Up to three in-app reminders per review chain, with at least 24 hours between them. No email is sent. A due date never approves or expires a review.</p></fieldset>}
    {review.can_decide && <fieldset disabled={disabled} className="space-y-3"><legend className="mb-2 text-sm font-semibold">Your reminder pause</legend><Field label={`Pause reminders until for step ${index + 1} (UTC)`} htmlFor={`review-pause-${step.id}`}><Input id={`review-pause-${step.id}`} type="date" value={until} min={day(1)} max={day(30)} onChange={e => setUntil(e.target.value)} /></Field><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={disabled || !until} onClick={() => void run("snooze")}>Pause reminders for step {index + 1}</Button>{review.snoozed_until && <Button variant="ghost" disabled={disabled} onClick={() => void run("resume")}>Resume reminders for step {index + 1}</Button>}</div><p className="text-xs text-zinc-600 dark:text-zinc-400">Only your reminders pause. The due date and your review responsibility stay the same.</p></fieldset>}
    {review.can_manage_followup && <fieldset disabled={disabled} className="space-y-3"><legend className="mb-2 text-sm font-semibold">Hand off the pending review</legend><Field label={`New reviewer for step ${index + 1}`} htmlFor={`review-handoff-${step.id}`}><Select id={`review-handoff-${step.id}`} value={reviewer} onChange={e => { setReviewer(e.target.value); requestId.current = crypto.randomUUID(); }}><option value="">Choose another independent coordinator</option>{available.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field><Field label={`Handoff reason for step ${index + 1}`} htmlFor={`review-handoff-note-${step.id}`}><Textarea id={`review-handoff-note-${step.id}`} value={reason} minLength={20} maxLength={600} onChange={e => { setReason(e.target.value); requestId.current = crypto.randomUUID(); }} /></Field><Button variant="secondary" disabled={disabled || !reviewer || reason.trim().length < 20} onClick={() => void run("handoff")}>Hand off review for step {index + 1}<ArrowRight className="ml-2 h-4 w-4" /></Button>{!available.length && <Callout>Add another eligible coordinator before handing off this review.</Callout>}<p className="text-xs text-zinc-600 dark:text-zinc-400">The previous request stays in history. Evidence, due date and reminder budget carry forward; the new reviewer must make their own decision.</p></fieldset>}
    {error && <LoadError error={error} />}
  </div></details>;
}
