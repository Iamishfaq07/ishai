import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { JobSourceReview as Review } from "@orbit/types";
import { Button, ErrorNote, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText, formatDate } from "../../lib/format";
import { safeUrl } from "./model";
import { jobPath } from "./paths";

const statusCopy: Record<Review["status"], { title: string; detail: string }> = {
  manual: { title: "Added by you · source not checked", detail: "This job has no linked feed observation. Review the employer’s original page before sharing an application." },
  missing: { title: "No current listing record in Orbit", detail: "Orbit may have aged out the post, filtered it out, or lost its feed observation. This does not prove that the employer closed or removed the role." },
  unknown: { title: "Source observation unknown", detail: "The stored source or observation date cannot establish a recent listing. Check the original page." },
  stale: { title: "Older source observation", detail: "Orbit has not seen this listing within the review window. Cached details may be out of date; check the original before applying." },
  recent: { title: "Recently seen by Orbit", detail: "This records a listing observation, not independently verified availability or a guarantee that applications are accepted." },
};

function Credit({ attribution }: { attribution: Review["attribution"] }) {
  const href = attribution && safeUrl(attribution.url);
  if (!attribution || !href) return null;
  return <p className="text-xs text-zinc-600 dark:text-zinc-400">via{" "}<a href={href} target="_blank" rel="noopener"
    className={cx(attribution.large ? "inline-flex min-h-[23px] min-w-[116px] items-center justify-center rounded bg-zinc-900 px-2 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900" : "inline-flex min-h-11 items-center rounded underline", focusRing)}>
    {attribution.label}<span className="sr-only"> (opens in a new tab)</span></a></p>;
}

/** Local records only: opening or refreshing never fetches a provider or calls AI. */
export function JobSourceReview({ entryId }: { entryId: string }) {
  const [params] = useSearchParams();
  const [open, setOpen] = useState(params.get("source") === "1");
  const [view, setView] = useState<Review | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const sequence = useRef(0);
  const busyRef = useRef(false);
  const refresh = useCallback(async (quiet = false) => {
    const request = ++sequence.current;
    busyRef.current = true; setBusy(true); setError(null); if (!quiet) setView(null);
    try {
      const next = await api.jobSourceReview(entryId);
      if (request === sequence.current) setView(next);
    } catch (err) { if (request === sequence.current) { setView(null); setError(errorText(err)); } }
    finally { if (request === sequence.current) { busyRef.current = false; setBusy(false); } }
  }, [entryId]);
  const cancel = useCallback(() => { sequence.current++; }, []);
  useEffect(() => {
    void refresh();
    return cancel;
  }, [refresh, cancel]);
  useEffect(() => { if (params.get("source") === "1") setOpen(true); }, [params]);
  useEffect(() => {
    const onReturn = () => { if (!busyRef.current && document.visibilityState === "visible") void refresh(true); };
    window.addEventListener("focus", onReturn); document.addEventListener("visibilitychange", onReturn);
    const timer = open ? window.setInterval(onReturn, 60_000) : undefined;
    return () => { window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); window.clearInterval(timer); };
  }, [refresh, open]);
  const copy = view && statusCopy[view.status];
  const fields = view ? view.fields.filter((field) => showAll || field.changed || !view.last_seen_at) : [];
  const savedPost = safeUrl(view?.fields.find((field) => field.key === "url")?.saved ?? "");
  return <section aria-label="Job source review" className="mb-4 min-w-0 rounded-2xl border border-zinc-200 bg-zinc-500/[0.025] p-4 dark:border-white/10">
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-semibold", focusRing)}>
        Review job source before applying
        {copy && <span className="mt-1 block text-xs font-normal text-zinc-600 dark:text-zinc-400">{copy.title}{Boolean(view?.changed_count) && ` · ${view?.changed_count} saved fields differ`}</span>}
      </summary>
      <div className="mt-3 min-w-0 space-y-4">
        {busy && <p role="status" className="text-sm">{view ? "Refreshing source status; the previous record is shown until this finishes…" : "Reading Orbit’s saved listing records…"}</p>}
        {error && <ErrorNote onRetry={() => void refresh()}>{error}</ErrorNote>}
        {view && copy && <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{copy.detail}</p>
          <ol aria-label="Source review steps" className="grid min-w-0 gap-2 text-xs sm:grid-cols-3">
            <li className="min-w-0 rounded-xl bg-zinc-500/5 p-3"><strong>1. Saved record</strong><p className="mt-1">Added {formatDate(view.saved_at)}</p></li>
            <li className="min-w-0 rounded-xl bg-zinc-500/5 p-3"><strong>2. Latest observation</strong><p className="mt-1 break-words">{view.source_label} · {view.direct ? "Company source" : "Feed or external source"}</p><p className="mt-1">Last seen {formatDate(view.last_seen_at)}</p></li>
            <li className="min-w-0 rounded-xl bg-indigo-500/5 p-3"><strong>3. Review original</strong><p className="mt-1">Check the role, location and application destination before continuing.</p></li>
          </ol>
          <Credit attribution={view.attribution} />
          <p className="text-xs text-zinc-600 dark:text-zinc-400">{view.first_seen_at && `This listing record first appeared in Orbit: ${formatDate(view.first_seen_at)}. `}Review window: {view.freshness_window_hours} hours (at least one day or twice the source’s refresh interval). A listing observation does not establish that every description field was reread.</p>
          {view.changed_count !== null && <p role="status" className="text-sm font-medium">{view.changed_count ? "Saved job details differ from the current cached post. Review them below." : "The five compared fields match. Description, requirements and salary have no saved baseline here."}</p>}
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />Show all saved job details</label>
          <div className="space-y-3">{fields.map((field) => <article key={field.key} className="min-w-0 rounded-xl border border-zinc-200 p-3 dark:border-white/10">
            <h3 className="text-sm font-semibold">{field.label} · {field.changed === null ? "no comparison" : field.changed ? "changed" : "same"}</h3>
            <dl className="mt-2 grid min-w-0 gap-3 text-xs sm:grid-cols-2">
              <div className="min-w-0"><dt className="font-medium text-zinc-500">Saved when added</dt><dd className="mt-1 whitespace-pre-wrap break-all">{field.saved || "Not stored"}</dd></div>
              <div className="min-w-0"><dt className="font-medium text-zinc-500">Current cached value</dt><dd className="mt-1 whitespace-pre-wrap break-all">{field.current === null ? "No cache value to compare" : field.current || "Not stated"}</dd></div>
            </dl>
            {field.key === "url" || field.key === "apply_url" ? <div className="mt-2 flex flex-wrap gap-x-4">
              {safeUrl(field.saved) && <a className={cx("inline-flex min-h-11 items-center rounded text-xs underline", focusRing)} href={safeUrl(field.saved)!} target="_blank" rel="noopener noreferrer">Open saved link<span className="sr-only"> (opens in a new tab)</span></a>}
              {field.current && field.changed && safeUrl(field.current) && <a className={cx("inline-flex min-h-11 items-center rounded text-xs underline", focusRing)} href={safeUrl(field.current)!} target="_blank" rel="noopener noreferrer">Open cached link<span className="sr-only"> (opens in a new tab)</span></a>}
            </div> : null}
          </article>)}</div>
          {view.duplicates.length > 0 && <section aria-label="Possible duplicate posts" className="space-y-2 rounded-xl bg-amber-500/5 p-3">
            <h3 className="text-sm font-semibold">Check before applying twice</h3><p className="text-xs text-zinc-600 dark:text-zinc-400">These posts share a normalized company, role and location key. They may be different vacancies; Orbit has not confirmed a duplicate or repost.</p>
            <ul className="space-y-3">{view.duplicates.map((item) => <li key={item.id} className="min-w-0"><Link to={jobPath(item.id)} className={cx("inline-flex min-h-11 items-center break-words rounded text-sm underline", focusRing)}>{item.title} · {item.company}</Link><p className="text-xs text-zinc-600 dark:text-zinc-400">{item.source_label} · last seen {formatDate(item.last_seen_at)}</p><Credit attribution={item.attribution} /></li>)}</ul>
            {view.more_duplicates && <p className="text-xs">Showing three possible matches. More exist in the current cache.</p>}
          </section>}
          <p className="text-xs text-zinc-600 dark:text-zinc-400">This comparison changes no saved job, resume, application kit or submission. It cannot compare an earlier job description, salary or requirement version. Review prepared materials separately if the source changed.</p>
          {savedPost && <a className={cx("inline-flex min-h-11 items-center rounded text-sm font-semibold text-indigo-700 underline dark:text-indigo-300", focusRing)} href={savedPost} target="_blank" rel="noopener noreferrer">Open saved original post<span className="sr-only"> (opens in a new tab)</span></a>}
        </>}
        <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>Refresh source status</Button>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">Reloading reads Orbit’s records only; it does not contact the employer. Cache updates continue through the existing feed refresh process.</p>
      </div>
    </details>
  </section>;
}
