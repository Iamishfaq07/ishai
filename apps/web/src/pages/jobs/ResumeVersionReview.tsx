import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ResumeVersionComparison } from "@orbit/types";
import { Button, ErrorNote, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText, formatDate } from "../../lib/format";
import { resumePath } from "../resume/paths";
import { SnapshotSource } from "./SnapshotSource";

/** Read-only source comparison. No AI, snapshot mutation, approval or automatic delivery. */
export function ResumeVersionReview({ entryId, snapshotId, onClose }: { entryId: string; snapshotId: string; onClose: () => void }) {
  const [view, setView] = useState<ResumeVersionComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const sequence = useRef(0);
  const busyRef = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const cancel = useCallback(() => { sequence.current++; }, []);
  const refresh = useCallback(async (moveFocus = false) => {
    const request = ++sequence.current; busyRef.current = true; setBusy(true); setView(null); setError(null);
    try {
      const next = await api.compareMissionSnapshot(entryId, snapshotId);
      if (request !== sequence.current) return;
      setView(next);
      if (moveFocus) requestAnimationFrame(() => { if (request === sequence.current) { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "start" }); } });
    } catch (err) { if (request === sequence.current) setError(errorText(err)); }
    finally { if (request === sequence.current) { busyRef.current = false; setBusy(false); } }
  }, [entryId, snapshotId]);
  useEffect(() => { void refresh(true); return cancel; }, [refresh, cancel]);
  useEffect(() => {
    const onReturn = () => { if (!busyRef.current && document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onReturn); document.addEventListener("visibilitychange", onReturn);
    return () => { window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); };
  }, [refresh]);
  const sections = view ? view.sections.filter((item) => showAll || !view.current_id || item.changed)
    .sort((a, b) => Number(b.changed) - Number(a.changed)) : [];
  return <section aria-label="Compare saved resume version" className="min-w-0 space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-400/25 dark:bg-indigo-500/5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Saved copy → current resume → reviewed next step</p><h3 ref={heading} tabIndex={-1} className="mt-2 scroll-mt-28 rounded font-display text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">What changed in this resume?</h3></div><Button variant="secondary" onClick={onClose}>Close comparison</Button></header>
    <p className="text-sm text-zinc-600 dark:text-zinc-400">A free comparison of stored fields. It does not verify claims, employer requirements, a submitted document or delivery. No AI call or edits are made.</p>
    {busy && <p role="status">Reading the saved copy and current linked resume…</p>}
    {error && <ErrorNote onRetry={() => void refresh()}>{error}</ErrorNote>}
    {view && <>
      <SnapshotSource origin={view.origin} />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2"><div className="min-w-0 rounded-xl bg-zinc-500/5 p-3"><p className="text-xs font-semibold">Saved copy</p><p className="mt-1 break-words text-sm">{view.saved_title}</p><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Saved {formatDate(view.saved_at)} · unchanged by this comparison</p></div><div className="min-w-0 rounded-xl bg-zinc-500/5 p-3"><p className="text-xs font-semibold">Currently linked resume</p><p className="mt-1 break-words text-sm">{view.current_title ?? "No current owned resume is linked"}</p>{view.current_updated_at && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Edited {formatDate(view.current_updated_at)}</p>}</div></div>
      <p role="status" className="rounded-xl bg-zinc-500/5 p-3 text-sm">{view.content_matches === null ? "The saved copy is available, but there is no linked resume to compare. Link one above to continue." : view.content_matches ? "The stored content, design and target text match. This does not mean either version was submitted." : `${view.changed_sections.length} stored section${view.changed_sections.length === 1 ? " differs" : "s differ"}. Review the changes before choosing what to share or practise with.`}{view.same_source === false && " You are comparing a different linked resume from the one this saved copy came from."}</p>
      {view.current_id && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />Show unchanged sections too</label>}
      <div className="space-y-3">{sections.map((item) => <details key={item.key} className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3 dark:border-white/10 dark:bg-zinc-900"><summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-semibold", focusRing)}>{item.label} · {item.changed === null ? "saved fields" : item.changed ? "changed" : "same stored fields"}</summary><div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2"><div className="min-w-0"><h4 className="text-xs font-semibold">Saved copy</h4><pre tabIndex={0} aria-label={`${item.label}: saved copy`} className={cx("mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-500/5 p-3 text-xs", focusRing)}>{item.saved_text || "Empty"}</pre>{item.saved_truncated && <p className="mt-1 text-xs">Excerpt limited to 3,000 characters. Open a copy to inspect the complete saved resume.</p>}</div><div className="min-w-0"><h4 className="text-xs font-semibold">Current linked resume</h4><pre tabIndex={0} aria-label={`${item.label}: current linked resume`} className={cx("mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-500/5 p-3 text-xs", focusRing)}>{item.current_text === null ? "No linked resume available" : item.current_text || "Empty"}</pre>{item.current_truncated && <p className="mt-1 text-xs">Excerpt limited to 3,000 characters. Open the resume editor for the complete current version.</p>}</div></div></details>)}</div>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Photos are represented by a short fingerprint. Differences can include hidden sections or saved structure rather than changed wording. They do not establish a change in skills or a new qualification. Refresh after editing in another tab.</p>
      <div className="flex flex-wrap gap-3"><Button variant="secondary" onClick={() => void refresh()}>Refresh comparison</Button>{view.current_id && <Link className={cx("inline-flex min-h-11 items-center rounded text-sm font-semibold text-indigo-700 underline dark:text-indigo-300", focusRing)} to={`${resumePath(view.current_id)}?guide=1&job=${encodeURIComponent(entryId)}`}>Edit linked resume and return to this job</Link>}</div>
    </>}
  </section>;
}
