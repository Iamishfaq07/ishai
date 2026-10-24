import { ErrorNote } from "@orbit/ui";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";

interface Imported { id: string; sender: string; subject: string; sent_at: string; reviewed_at: string; changes: { status?: string; next_at?: string | null } }
export function EmailImportHistory({ entryId, revision }: { entryId: string; revision: number }) {
  const history = useAsync(() => api.call<Imported[]>(`/v1/jobs/tracker/${entryId}/message-update/imports`),
    [entryId, revision], `email-imports:${entryId}:${revision}`);
  return <details className="rounded-lg border border-zinc-200 p-3 dark:border-white/10"><summary className="cursor-pointer text-sm font-medium">Reviewed email imports</summary>
    {history.error && <ErrorNote onRetry={history.reload}>Could not load import history.</ErrorNote>}
    {history.loading && <p role="status">Loading reviewed imports…</p>}
    {history.data && !history.data.length && <p className="mt-2 text-sm">No imported emails have been confirmed for this job.</p>}
    <ul className="space-y-3">{history.data?.map((item) => <li key={item.id} className="mt-3 text-sm">
      <p className="break-words font-medium">{item.subject || "No subject"}</p><p className="break-words">Sender in file: {item.sender || "Not stated"} · not verified</p>
      <p>Reviewed {new Date(item.reviewed_at).toLocaleString()}</p>
      {item.changes.status && <p>Recorded stage: {item.changes.status}</p>}
      {"next_at" in item.changes && <p>Recorded next date: {item.changes.next_at ? new Date(item.changes.next_at).toLocaleString() : "cleared"}</p>}
    </li>)}</ul>
    <p className="mt-2 text-xs text-zinc-500">Latest 50 confirmed imports. Original email bodies and attachments are not retained. This records your review, not proof of sender identity or an employer decision.</p>
  </details>;
}
