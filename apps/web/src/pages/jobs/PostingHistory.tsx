import { ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
interface History { note: string; versions: { observed_at: string; baseline: boolean; changes: { field: string; before: unknown; after: unknown }[] }[] }
const show = (v: unknown) => v == null ? "Not stated" : typeof v === "string" ? v : JSON.stringify(v);
export function PostingHistory({ entryId }: { entryId: string }) {
  const history = useAsync(() => api.call<History>(`/v1/jobs/tracker/${entryId}/posting-history`), [entryId], `posting-history:${entryId}`);
  return <details className="my-4 rounded-lg border border-zinc-200 p-3 dark:border-white/10"><summary className="cursor-pointer text-sm font-semibold">Posting changes over time</summary>
    {history.loading && <p role="status">Loading source observations…</p>}
    {history.error && <ErrorNote onRetry={history.reload}>Could not load posting history.</ErrorNote>}
    {history.data && <><p className="my-2 text-xs text-zinc-500">{history.data.note}</p>{!history.data.versions.length && <p className="text-sm">No version history recorded yet.</p>}
      <ol className="space-y-3">{history.data.versions.map((v, i) => <li key={i} className="text-sm"><p className="font-medium">{new Date(v.observed_at).toLocaleString()} · {v.baseline ? "Earliest retained observation" : `${v.changes.length} changed fields`}</p>
        {v.changes.map((c) => <details key={c.field} className="my-2"><summary className="cursor-pointer">{c.field}</summary><dl className="grid gap-3 sm:grid-cols-2"><div><dt>Earlier</dt><dd className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{show(c.before)}</dd></div><div><dt>Later</dt><dd className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{show(c.after)}</dd></div></dl></details>)}</li>)}</ol></>}
  </details>;
}
