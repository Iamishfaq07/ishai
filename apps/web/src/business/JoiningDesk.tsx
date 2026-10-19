import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Callout, buttonClass } from "@orbit/ui";
import { api } from "../lib/api";
import { roomPath } from "./hiringModel";
import { errorText, Panel } from "./ui";

interface JoiningItem {
  application_id: string; name: string; reference: string; job_title: string; start_date: string;
  completed: number; total: number; blocked: number; deletion_requested: boolean;
}
interface JoiningPage { items: JoiningItem[]; next_before: string | null }
export function JoiningDesk({ cid, revision }: { cid: string; revision: number }) {
  const [data, setData] = useState<JoiningPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const read = (before?: string) => api.call<JoiningPage>(`/v1/business/companies/${encodeURIComponent(cid)}/joining-desk${before ? `?before=${encodeURIComponent(before)}` : ""}`);
  useEffect(() => {
    let live = true;
    setData(null); setError("");
    api.call<JoiningPage>(`/v1/business/companies/${encodeURIComponent(cid)}/joining-desk`)
      .then((next) => { if (live) setData(next); }).catch((e: unknown) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [cid, revision]);
  const more = async () => {
    setBusy(true); setError("");
    try {
      const next = await read(data?.next_before ?? undefined);
      setData((current) => ({ items: [...(current?.items ?? []), ...next.items.filter((n) => !current?.items.some((c) => c.application_id === n.application_id))], next_before: next.next_before }));
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <Panel title="Joining plans" hint="Shared next steps after an accepted offer or a confirmed hire. Most recently shared plans first; load older plans below.">
    {!data && !error && <p role="status" className="text-sm">Loading joining plans…</p>}
    {data && !data.items.length && <p className="text-sm text-zinc-500">No joining plans yet. Share one from Offer and hire in the interview workspace.</p>}
    <ul className="divide-y divide-zinc-200 dark:divide-white/10">{data?.items.map((item) => <li key={item.application_id} className="space-y-2 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{item.name}</h3><p className="text-xs text-zinc-500">{item.job_title} · {item.reference}</p></div><Link to={`${roomPath(cid, item.application_id)}?tab=offer`} className={buttonClass("secondary", "sm")}>Open joining plan</Link></div>
      <p className="text-sm">{item.completed}/{item.total} reported complete · Joining target {item.start_date}</p>
      {item.blocked > 0 && <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{item.blocked} blocked — review next steps</p>}
      {item.deletion_requested && <Callout tone="warning">Candidate requested data deletion. Updates are paused.</Callout>}
    </li>)}</ul>
    {data?.next_before && <Button variant="secondary" size="sm" loading={busy} onClick={() => void more()}>Load older joining plans</Button>}
    {error && <Callout tone="error">{error} <Button size="sm" variant="ghost" loading={busy} onClick={() => void more()}>Retry joining plans</Button></Callout>}
  </Panel>;
}
