import { useEffect, useId, useRef, useState } from "react";
import type { BizApplicationStatus } from "@orbit/types";
import { Button, Callout, Field, Select, Textarea, confirmDialog } from "@orbit/ui";
import { api } from "../lib/api";
import { requestKey, type PendingRequests } from "./requestKey";
import { errorText, Panel } from "./ui";

export function CandidateWithdrawal({ token, data, onSaved }: { token: string; data: BizApplicationStatus; onSaved: (status: BizApplicationStatus) => void }) {
  const id = useId();
  const [reason, setReason] = useState("none");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requests = useRef<PendingRequests>({});
  const withdraw = async () => {
    if (!(await confirmDialog({ title: "Withdraw this application?", body: `${data.job_title} at ${data.company.name}: ${data.withdrawal_notice} The team cannot reopen this application.`, confirmLabel: "Withdraw application", danger: true }))) return;
    setBusy(true); setError("");
    const body = { application_reference: data.reference, notice_version: data.withdrawal_notice_version, reason, note, acknowledge: true };
    try {
      onSaved(await api.call<BizApplicationStatus>(`/v1/public/business/applications/${encodeURIComponent(token)}/withdraw`, {
        method: "POST", body: JSON.stringify({ ...body, request_id: requestKey(requests.current, "withdraw", body) }),
      }));
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  if (data.application_state === "withdrawn") return <Callout tone="info" className="mt-6" title="You withdrew this application">
    {data.withdrawn_at && <>Saved {new Date(data.withdrawn_at).toLocaleString()}. </>}Outstanding Orbit interview invitations are cancelled. Update or remove any imported calendar event. The hiring team can read the saved history; you can still ask for data deletion below.
  </Callout>;
  if (!data.can_withdraw) return null;
  return <div className="mt-6"><Panel title="Manage this application" hint="You can stop being considered for this role without deleting your saved history.">
    <details><summary className="cursor-pointer text-sm font-medium">Withdraw from this hiring process</summary>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{data.withdrawal_notice}</p>
      <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void withdraw(); }}>
        <fieldset disabled={busy} className="space-y-3">
          <Field label="Reason (optional)" htmlFor={`${id}-reason`}><Select id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)}><option value="none">Prefer not to share</option><option value="role">Role no longer fits</option><option value="another_offer">Accepted another opportunity</option><option value="timing">Timing changed</option><option value="other">Other reason</option></Select></Field>
          <Field label="Note to the hiring team (optional)" htmlFor={`${id}-note`} hint="This note is shared with the hiring team. Keep personal documents, financial information and private details out of it."><Textarea id={`${id}-note`} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </fieldset>
        <Button type="submit" variant="danger" loading={busy}>Review withdrawal</Button>
        <p className="text-xs text-zinc-500">This affects only this application. It does not pause other applications or request data deletion.</p>
      </form>
    </details>{error && <Callout tone="error" className="mt-3">{error} Your unsent note remains here. Refresh to check the current application status.</Callout>}
  </Panel></div>;
}

export function CompanyWithdrawal({ cid, aid }: { cid: string; aid: string }) {
  return <WithdrawalRecord key={`${cid}/${aid}`} cid={cid} aid={aid} />;
}

// Kept in a separate component so the public form does not fetch any employer endpoint.
function WithdrawalRecord({ cid, aid }: { cid: string; aid: string }) {
  const [record, setRecord] = useState<{ created_at: string; reason: string; note: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api.call<{ withdrawal: typeof record }>(`/v1/business/companies/${encodeURIComponent(cid)}/applications/${encodeURIComponent(aid)}/withdrawal`)
      .then((next) => { if (live) setRecord(next.withdrawal); }).catch((e: unknown) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [cid, aid]);
  return <Panel title="Candidate withdrawal" hint="The candidate ended this hiring process. Their application cannot be moved, rejected or reopened by the team.">
    {record && <div className="space-y-2 text-sm"><p>Saved {new Date(record.created_at).toLocaleString()} · {record.reason}</p>{record.note && <p className="whitespace-pre-wrap break-words">{record.note}</p>}</div>}
    {error && <Callout tone="error">{error}</Callout>}
    {!record && !error && <p role="status" className="text-sm">Loading saved withdrawal…</p>}
  </Panel>;
}
