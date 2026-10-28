import { useState } from "react";
import { Button, ErrorNote, Input } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";

interface Workflow {
  id: string; kind: string; attempts: number; updated_at: string; error_type: string; can_retry: boolean;
}
interface Health {
  counts: Record<string, number>; due: number; expired_leases: number; oldest_due_at: string | null;
  failed: Workflow[]; truncated: boolean;
}

export function WorkflowHealth() {
  const health = useAsync(() => api.call<Health>("/v1/admin/workflows"), [], "admin-workflow-health");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const retry = async (job: Workflow) => {
    setBusy(true); setError("");
    try {
      await api.call(`/v1/admin/workflows/${job.id}/retry`, { method: "POST", body: JSON.stringify({
        updated_at: job.updated_at, reason,
      }) });
      setReason(""); health.reload();
    } catch (e) { setError(errorText(e)); health.reload(); }
    finally { setBusy(false); }
  };
  return <section aria-labelledby="workflow-health-title" className="space-y-3 rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
    <div className="flex items-center justify-between gap-3"><h2 id="workflow-health-title" className="font-semibold">Background workflows</h2>
      <Button variant="secondary" disabled={busy || health.loading} onClick={health.reload}>Refresh workflows</Button></div>
    {health.loading && <p role="status" className="text-sm">Checking background work…</p>}
    {health.error && <ErrorNote onRetry={health.reload}>{errorText(health.error)}</ErrorNote>}
    {health.data && <>
      <p className="text-sm">{health.data.due} ready · {health.data.counts.running ?? 0} running · {health.data.counts.failed ?? 0} failed · {health.data.expired_leases} expired leases</p>
      {health.data.oldest_due_at && <p className="text-xs text-zinc-500">Oldest ready work: {new Date(health.data.oldest_due_at).toLocaleString()}</p>}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Expired leases are recovered by the worker. For failed reports or indexing, resolve the cause, record a reason, then retry. Resume tailoring requires its original product flow.</p>
      {health.data.failed.length > 0 ? <>
        <label className="block text-sm">Reason for retry<Input value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} maxLength={300} placeholder="Describe the issue you resolved (at least 10 characters)" /></label>
        <ul className="divide-y divide-zinc-200 dark:divide-white/10">{health.data.failed.map((job) => <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div><strong>{job.kind}</strong><p>{job.error_type} · {job.attempts} attempts · {new Date(job.updated_at).toLocaleString()}</p><p className="font-mono text-xs">{job.id}</p></div>
          {job.can_retry ? <Button variant="secondary" disabled={busy || reason.trim().length < 10} onClick={() => void retry(job)}>Retry {job.kind}</Button> : <span className="text-xs">Use original workflow for recovery</span>}
        </li>)}</ul>
        {health.data.truncated && <p className="text-xs">Showing the 25 most recent failures.</p>}
      </> : <p className="text-sm">No failed background workflows.</p>}
    </>}
    {error && <ErrorNote>{error}</ErrorNote>}
  </section>;
}
