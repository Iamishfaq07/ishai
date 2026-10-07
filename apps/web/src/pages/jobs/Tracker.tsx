import { useState } from "react";
import { Link } from "react-router-dom";
import type { JobStatus, JobTrackerEntry, JobTrackerUpdate } from "@orbit/types";
import {
  ArrowUpRight,
  BookmarkCheck,
  Building2,
  CalendarIcon,
  FileText,
  MapPin,
  PenLine,
  Target,
  Trash2,
  confirmDialog,
  cx,
  focusRing,
} from "@orbit/ui";
import { Button, EmptyState, ErrorNote, Field, Input, Select, Spinner, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import type { AsyncState } from "../../lib/useAsync";
import { resumePath } from "./JobCard";
import { STATUSES, STATUS_LABEL, STATUS_TONE, byStatus, dateInput, fromDateInput, safeUrl, shortDate } from "./model";

/**
 * The job tracker: saved → applied → interviewing → offer / not this time, with notes and dates. A board of columns
 * on wide screens; on phones one list, filtered by status, each job with its own status menu.
 */
export function JobTracker({ tracker }: { tracker: AsyncState<JobTrackerEntry[]> }) {
  const [filter, setFilter] = useState<JobStatus | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const entries = tracker.data ?? [];
  const columns = byStatus(entries);

  const update = async (entry: JobTrackerEntry, patch: JobTrackerUpdate) => {
    setError(null);
    const before = tracker.data;
    if (patch.status) {
      // Moves show at once; the server's answer (with its dates) replaces it.
      tracker.setData((prev) => prev?.map((e) => (e.id === entry.id ? { ...e, status: patch.status!, status_at: new Date().toISOString() } : e)) ?? null);
    }
    try {
      const saved = await api.updateTrackedJob(entry.id, patch);
      tracker.setData((prev) => prev?.map((e) => (e.id === entry.id ? saved : e)) ?? null);
      return true;
    } catch (err) {
      tracker.setData(() => before);
      setError(errorText(err));
      return false;
    }
  };

  const remove = async (entry: JobTrackerEntry) => {
    const ok = await confirmDialog({
      title: `Remove “${entry.title}”?`,
      body: "It comes off your tracker with its notes. A resume you tailored for it stays in Resume AI.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    tracker.setData((prev) => prev?.filter((e) => e.id !== entry.id) ?? null);
    await api.untrackJob(entry.id).catch((err: unknown) => {
      setError(errorText(err));
      tracker.reload();
    });
  };

  if (tracker.loading && !tracker.data) return <Spinner label="Loading your tracker" state="searching" />;
  if (tracker.error && !tracker.data) return <ErrorNote onRetry={tracker.reload}>{errorText(tracker.error)}</ErrorNote>;
  if (!entries.length) {
    return (
      <EmptyState
        icon={BookmarkCheck}
        title="Nothing tracked yet"
        body="Save jobs from your matches, or say “Yes, I applied” after you apply. Then move each one along: applied, interviewing, offer."
        action={
          <Link to="/resume-ai/jobs" className={cx("font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
            See your matches
          </Link>
        }
      />
    );
  }

  const shown = filter === "all" ? [...entries].sort((a, b) => b.status_at.localeCompare(a.status_at)) : columns[filter];
  return (
    <div className="space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Phones and tablets: one list, with a filter. */}
      <div className="lg:hidden">
        <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1" role="group" aria-label="Show">
          {(["all", ...STATUSES] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={filter === s}
              onClick={() => setFilter(s)}
              className={cx(
                "shrink-0 rounded-full border px-3 py-1 text-sm font-medium",
                filter === s ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200" : "border-zinc-200 text-zinc-500 dark:border-white/10 dark:text-zinc-400",
                focusRing,
              )}
            >
              {s === "all" ? `All ${entries.length}` : `${STATUS_LABEL[s]} ${columns[s].length}`}
            </button>
          ))}
        </div>
        <ul className="space-y-3">
          {shown.map((e) => (
            <li key={e.id}>
              <TrackerCard entry={e} onUpdate={(p) => update(e, p)} onRemove={() => void remove(e)} />
            </li>
          ))}
        </ul>
      </div>

      {/* Wide screens: a board, one column per status. */}
      <div className="hidden gap-3 lg:grid lg:grid-cols-5">
        {STATUSES.map((s) => (
          <section key={s} aria-label={STATUS_LABEL[s]} className="min-w-0 rounded-2xl bg-zinc-500/[0.06] p-2.5 dark:bg-white/[0.02]">
            <h3 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold">
              <span className={cx("rounded-full px-2 py-0.5 text-xs ring-1", STATUS_TONE[s])}>{STATUS_LABEL[s]}</span>
              <span className="text-xs font-normal text-zinc-500 tabular-nums dark:text-zinc-400">{columns[s].length}</span>
            </h3>
            <ul className="space-y-2.5">
              {columns[s].map((e) => (
                <li key={e.id}>
                  <TrackerCard compact entry={e} onUpdate={(p) => update(e, p)} onRemove={() => void remove(e)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function TrackerCard({
  entry,
  compact = false,
  onUpdate,
  onRemove,
}: {
  entry: JobTrackerEntry;
  compact?: boolean;
  onUpdate: (patch: JobTrackerUpdate) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const original = safeUrl(entry.url);
  const apply = safeUrl(entry.apply_url);
  const dates = [
    entry.applied_at ? `Applied ${shortDate(entry.applied_at)}` : `Saved ${shortDate(entry.created_at)}`,
    entry.next_at ? `Next: ${shortDate(entry.next_at)}` : null,
  ].filter(Boolean);

  return (
    <article className={cx("glass-panel rounded-xl", compact ? "p-3" : "p-4")}>
      <h4 className={cx("font-medium leading-snug", compact ? "text-sm" : "text-base")}>
        {original ? (
          <a href={original} target="_blank" rel="noopener" className={cx("rounded hover:text-indigo-600 dark:hover:text-indigo-300", focusRing)}>
            {entry.title}
          </a>
        ) : (
          entry.title
        )}
      </h4>
      <div className="mt-1 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
        <span className="flex items-center gap-1">
          <Building2 className="h-3 w-3 shrink-0 text-zinc-400" aria-hidden />
          <span className="truncate">{entry.company}</span>
        </span>
        {entry.location && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3 shrink-0 text-zinc-400" aria-hidden />
            <span className="truncate">{entry.location}</span>
          </span>
        )}
      </div>
      <p className="mt-1.5 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        <CalendarIcon className="h-3 w-3 shrink-0" aria-hidden />
        {dates.join(" · ")}
      </p>
      {entry.notes && !editing && <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-xs text-zinc-600 dark:text-zinc-300">{entry.notes}</p>}
      {!entry.live && <p className="mt-1.5 text-xs text-zinc-400">This post is no longer listed in the feed.</p>}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        {entry.status === "saved" && apply && (
          <a href={apply} target="_blank" rel="noopener" className={cx("inline-flex items-center gap-0.5 font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
            Apply <ArrowUpRight className="h-3 w-3" aria-hidden />
          </a>
        )}
        {entry.resume_id && (
          <Link to={resumePath(entry.resume_id)} className={cx("inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
            <FileText className="h-3 w-3" aria-hidden /> Tailored resume
          </Link>
        )}
        {entry.document_id && (
          <Link to={`/mock?jd=${encodeURIComponent(entry.document_id)}`} className={cx("inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
            <Target className="h-3 w-3" aria-hidden /> Practise
          </Link>
        )}
      </div>

      {editing ? (
        <EditEntry entry={entry} onCancel={() => setEditing(false)} onSave={async (p) => (await onUpdate(p)) && setEditing(false)} />
      ) : (
        // On the board's narrow columns the menu gets its own line, so "Interviewing" fits.
        <div className={cx("mt-2.5 flex items-center gap-1.5", compact && "flex-wrap")}>
          <label className="sr-only" htmlFor={`st-${entry.id}`}>
            Move to
          </label>
          <Select
            id={`st-${entry.id}`}
            value={entry.status}
            onChange={(e) => void onUpdate({ status: e.target.value as JobStatus })}
            className={cx("min-w-0 !py-1.5 !text-xs", compact ? "!pl-2.5 !pr-7" : "!w-auto flex-1")}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <button type="button" onClick={() => setEditing(true)} aria-label={`Notes and dates for ${entry.title}`} title="Notes and dates" className={cx("rounded-md p-1.5 text-zinc-400 hover:bg-indigo-500/10 hover:text-indigo-600", compact && "ml-auto", focusRing)}>
            <PenLine className="h-4 w-4" />
          </button>
          <button type="button" onClick={onRemove} aria-label={`Remove ${entry.title}`} title="Remove" className={cx("rounded-md p-1.5 text-zinc-400 hover:bg-rose-500/10 hover:text-rose-600", focusRing)}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </article>
  );
}

function EditEntry({ entry, onCancel, onSave }: { entry: JobTrackerEntry; onCancel: () => void; onSave: (p: JobTrackerUpdate) => Promise<unknown> }) {
  const [notes, setNotes] = useState(entry.notes);
  const [applied, setApplied] = useState(dateInput(entry.applied_at));
  const [next, setNext] = useState(dateInput(entry.next_at));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const patch: JobTrackerUpdate = { notes };
    const appliedAt = fromDateInput(applied);
    if (appliedAt) patch.applied_at = appliedAt;
    const nextAt = fromDateInput(next);
    if (nextAt) patch.next_at = nextAt;
    else if (entry.next_at) patch.clear_next = true;
    await onSave(patch);
    setBusy(false);
  };
  return (
    <div className="mt-3 space-y-3 border-t border-zinc-200 pt-3 dark:border-white/10">
      <Field label="Notes" htmlFor={`n-${entry.id}`}>
        <Textarea id={`n-${entry.id}`} rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Who you spoke to, what's next…" className="!text-sm" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Field label="Applied on" htmlFor={`a-${entry.id}`}>
          <Input id={`a-${entry.id}`} type="date" value={applied} onChange={(e) => setApplied(e.target.value)} className="!py-1.5 !text-sm" />
        </Field>
        <Field label="Next interview or follow-up" htmlFor={`x-${entry.id}`}>
          <Input id={`x-${entry.id}`} type="date" value={next} onChange={(e) => setNext(e.target.value)} className="!py-1.5 !text-sm" />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
