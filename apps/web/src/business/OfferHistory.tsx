import { useEffect, useState } from "react";
import { Button, Callout } from "@orbit/ui";
import { cycleApi, type OfferSummary } from "./sabaApi";
import { errorText } from "./ui";

export function OfferHistory({ base }: { base: string }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<OfferSummary[] | null>(null);
  const [before, setBefore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || versions !== null) return;
    let live = true;
    cycleApi.offerHistory(base).then((next) => { if (live) { setVersions(next.versions); setBefore(next.next_before_revision); } })
      .catch((e: unknown) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [base, open, versions]);
  const older = async () => {
    setBusy(true); setError("");
    try {
      const next = await cycleApi.offerHistory(base, before ?? undefined);
      setVersions((current) => [...(current ?? []), ...next.versions.filter((v) => !current?.some((c) => c.id === v.id))]);
      setBefore(next.next_before_revision);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <details className="mt-4 border-t border-zinc-200 pt-4 dark:border-white/10" onToggle={(e) => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-medium">Offer version history</summary>
    <p className="mt-3 text-xs text-zinc-500">Original terms and responses remain readable. Only the current pending version can receive a new response.</p>
    {open && !versions && !error && <p role="status" className="mt-3 text-sm">Loading versions…</p>}
    <ol className="mt-3 space-y-3">{versions?.map((version) => <li key={version.id} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-white/10"><details>
      <summary className="cursor-pointer font-medium">Version {version.revision} · {version.status} · {version.role}</summary>
      <dl className="mt-3 space-y-2"><div><dt className="font-medium">Compensation</dt><dd>{version.compensation}</dd></div><div><dt className="font-medium">Proposed start</dt><dd>{version.start_date}</dd></div></dl>
      <p className="mt-3 whitespace-pre-wrap break-words">{version.terms}</p><p className="mt-3 text-xs text-zinc-500">Published {new Date(version.created_at).toLocaleString()}{version.responded_at ? ` · Response saved ${new Date(version.responded_at).toLocaleString()}` : ""}</p>
    </details></li>)}</ol>
    {before && <Button className="mt-3" size="sm" variant="secondary" loading={busy} onClick={() => void older()}>Load older offer versions</Button>}
    {error && <Callout tone="error" className="mt-3">{error} <Button size="sm" variant="ghost" loading={busy} onClick={() => void older()}>Retry offer history</Button></Callout>}
  </details>;
}
