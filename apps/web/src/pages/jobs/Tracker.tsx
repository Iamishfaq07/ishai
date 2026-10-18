import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { JobStatus, JobTrackerEntry, JobTrackerUpdate } from "@orbit/types";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Columns3,
  BookmarkCheck,
  CalendarIcon,
  CalendarPlus,
  FileText,
  MapPin,
  MoreHorizontal,
  PenLine,
  Plus,
  Send,
  SheetIcon,
  Sparkles,
  Target,
  Trash2,
  CompanyLogo,
  Route,
  LoadGate,
  confirmDialog,
  cx,
  focusRing,
  CosmicEmptyState,
  roundLabel,
  celebrate,
  useMediaQuery,
} from "@orbit/ui";
import { Button, ErrorNote, Field, IconButton, Input, PageHeader, Select, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { downloadText, errorText } from "../../lib/format";
import type { AsyncState } from "../../lib/useAsync";
import { useIndia } from "../../lib/country";
import { useProgressiveCount } from "../../lib/useProgressive";
import { resumePath } from "../resume/paths";
import { AddJob } from "./AddJob";
import { useJobsAi } from "./JobsAi";
import { linkButton } from "./links";
import {
  STATUSES,
  STATUS_LABEL,
  STATUS_MARK,
  byStatus,
  dateInput,
  fileSlug,
  fromDateInput,
  isManual,
  linkHost,
  nextDateIcs,
  nextDateTitle,
  postedAgo,
  practiceLink,
  safeUrl,
  shortDate,
  stillOpenAt,
  trackerCsv,
} from "./model";
import { StagePill } from "./StagePill";
import { JOBS_MATCHES, jobPath, outreachPath } from "./paths";
import { CompareDrawer } from "./CompareDrawer";
import { SearchInsightsPanel } from "./SearchInsightsPanel";
import { MAX_COMPARE } from "./compare";
import { Journey } from "./Journey";
import { missionPath } from "./mission";
import { SafetyCard } from "./SafetyCard";
import { interviewPrepPath } from "./interview/links";

/**
 * Jobs AI → Tracker: every job saved or applied to, and how far along each one is, including ones found elsewhere
 * (Naukri, LinkedIn, a campus portal): "Add a job" (`?add=1` opens it, so Home's follow-ups can link straight here).
 */
export function JobTrackerPage() {
  const { tracker } = useJobsAi();
  const [params, setParams] = useSearchParams();
  const adding = params.get("add") === "1";
  const setAdding = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set("add", "1");
    else next.delete("add");
    setParams(next, { replace: true });
  };
  const has = Boolean(tracker.data && tracker.data.length > 0);
  return (
    <>
      <PageHeader
        icon={BookmarkCheck}
        title="Your applications"
        subtitle="Saved, applied, interviewing, offer. Move each job along as it goes, with notes and dates."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAdding(true)} aria-haspopup="dialog">
              <Plus className="h-4 w-4" aria-hidden /> Add a job
            </Button>
            {has && (
              <Link to={JOBS_MATCHES} className={linkButton("secondary")}>
                <Sparkles className="h-4 w-4" aria-hidden /> Find more jobs
              </Link>
            )}
            {has && (
              <Button
                variant="secondary"
                title="Every job, its status, dates and notes, as a spreadsheet (Excel or Google Sheets)"
                onClick={() => downloadText(`orbit-applications-${dateInput(new Date().toISOString())}.csv`, trackerCsv(tracker.data ?? []), "text/csv;charset=utf-8")}
              >
                <SheetIcon className="h-4 w-4" aria-hidden /> Export CSV
              </Button>
            )}
          </div>
        }
      />
      {tracker.data && <SearchInsightsPanel entries={tracker.data} />}
      <JobTracker tracker={tracker} onAdd={() => setAdding(true)} />
      <SafetyCard compact className="mt-6" />
      <AddJob
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(entry) => {
          tracker.setData((prev) => [entry, ...(prev ?? []).filter((e) => e.id !== entry.id)]);
          tracker.reload();
        }}
      />
    </>
  );
}

/**
 * The job tracker: saved → applied → interviewing → offer / not this time, with notes and dates. A board of columns
 * on wide screens; on phones one list, filtered by status, each job with its own status menu.
 */
export function JobTracker({ tracker, onAdd }: { tracker: AsyncState<JobTrackerEntry[]>; onAdd?: () => void }) {
  const india = useIndia();
  // One layout is drawn, the one the screen shows: both (one hidden by CSS) doubled every card, 65,000 elements for
  // 400 jobs. Long lists come a batch at a time (lib/useProgressive.ts), so the page answers while they draw.
  const wide = useMediaQuery("(min-width: 1024px)");
  const drawn = useProgressiveCount(tracker.data?.length ?? 0);
  const [filter, setFilter] = useState<JobStatus | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const entries = tracker.data ?? [];
  const columns = byStatus(entries);
  // Jobs picked to compare side by side (CompareDrawer), in the order picked; a removed job drops out.
  const [picked, setPicked] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  // The card that just changed stage, so it flashes where it lands.
  const [moved, setMoved] = useState<string | null>(null);
  const pickedEntries = picked.map((id) => entries.find((e) => e.id === id)).filter((e): e is JobTrackerEntry => Boolean(e));
  const compareFor = (e: JobTrackerEntry) => ({
    picked: picked.includes(e.id),
    full: pickedEntries.length >= MAX_COMPARE,
    onToggle: () => setPicked((p) => (p.includes(e.id) ? p.filter((x) => x !== e.id) : [...p, e.id].slice(-MAX_COMPARE))),
  });

  const update = async (entry: JobTrackerEntry, patch: JobTrackerUpdate) => {
    setError(null);
    const before = tracker.data;
    if (patch.status) {
      // Moves show at once; the server's answer (with its dates) replaces it.
      setMoved(entry.id);
      tracker.setData((prev) => prev?.map((e) => (e.id === entry.id ? { ...e, status: patch.status!, status_at: new Date().toISOString() } : e)) ?? null);
    }
    try {
      const saved = await api.updateTrackedJob(entry.id, patch);
      tracker.setData((prev) => prev?.map((e) => (e.id === entry.id ? saved : e)) ?? null);
      if (patch.status === "offer") celebrate("first-offer", { message: `An offer from ${entry.company}. Add it to Offer AI to see what it's worth.` });
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

  if (tracker.loading && !tracker.data) return <LoadGate loading variant="job-card" count={3} label="Loading your tracker">{null}</LoadGate>;
  if (tracker.error && !tracker.data) return <ErrorNote onRetry={tracker.reload}>{errorText(tracker.error)}</ErrorNote>;
  if (!entries.length) {
    return (
      <CosmicEmptyState
        variant="tracker"
        title="Nothing tracked yet"
        body={`Save jobs from your matches, or add one you applied to on ${india ? "Naukri, LinkedIn or a campus portal" : "LinkedIn, Indeed or a company's site"}. Then move each one along: applied, interviewing, offer.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {onAdd && (
              <Button onClick={onAdd}>
                <Plus className="h-4 w-4" aria-hidden /> Add a job you found elsewhere
              </Button>
            )}
            <Link to={JOBS_MATCHES} className={linkButton(onAdd ? "secondary" : "primary")}>
              <Sparkles className="h-4 w-4" aria-hidden /> See your matches
            </Link>
          </div>
        }
      />
    );
  }

  const shown = filter === "all" ? [...entries].sort((a, b) => b.status_at.localeCompare(a.status_at)) : columns[filter];
  return (
    <div className="space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Phones and tablets: one list, with a filter. */}
      {!wide && <div className="lg:hidden">
        <div className="edge-fade-x -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1" role="group" aria-label="Show">
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
          {shown.slice(0, drawn).map((e) => (
            <li key={e.id}>
              <TrackerCard entry={e} onUpdate={(p) => update(e, p)} onRemove={() => void remove(e)} compare={compareFor(e)} moved={moved === e.id} />
            </li>
          ))}
        </ul>
      </div>}

      {/* Wide screens: a board, one column per status. */}
      {wide && <div className="hidden gap-3 lg:grid lg:grid-cols-5">
        {STATUSES.map((s) => (
          <section key={s} aria-label={STATUS_LABEL[s]} className="relative min-w-0 rounded-2xl bg-zinc-500/[0.06] p-2.5 dark:bg-white/[0.02]">
            <span aria-hidden="true" className={cx("absolute inset-x-4 top-0 h-0.5 rounded-full", STATUS_MARK[s])} />
            <h3 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold">
              <StagePill status={s} />
              <span className="text-xs font-normal text-zinc-500 tabular-nums dark:text-zinc-400">{columns[s].length}</span>
            </h3>
            <ul className="space-y-2.5">
              {columns[s].slice(0, drawn).map((e) => (
                <li key={e.id}>
                  <TrackerCard compact entry={e} onUpdate={(p) => update(e, p)} onRemove={() => void remove(e)} compare={compareFor(e)} moved={moved === e.id} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>}

      {pickedEntries.length > 0 && (
        <div role="region" aria-label="Compare jobs" className="sticky bottom-20 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-3 rounded-2xl border border-indigo-500/25 bg-white/95 px-4 py-2.5 shadow-popover backdrop-blur sm:bottom-6 dark:bg-zinc-950/90">
          <span className="text-sm">
            {pickedEntries.length === 1 ? "Pick one or two more to compare" : `${pickedEntries.length} jobs picked`}
          </span>
          <Button size="sm" disabled={pickedEntries.length < 2} onClick={() => setComparing(true)}>
            <Columns3 className="h-3.5 w-3.5" aria-hidden /> Compare
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
            Clear
          </Button>
        </div>
      )}
      <CompareDrawer entries={pickedEntries} open={comparing && pickedEntries.length >= 2} onClose={() => setComparing(false)} />
    </div>
  );
}

/** A card's own actions: small accent links, the same weight whether a link or a button. */
const cardAction = "inline-flex items-center gap-1 rounded font-medium text-indigo-600 hover:underline dark:text-indigo-400";
// A card's row or list of actions: on a touch screen each is a full 44 px tall to tap (with a mouse, as before).
const rowAction = cx(cardAction, "coarse:min-h-11");

function TrackerCard({
  entry,
  compact = false,
  onUpdate,
  onRemove,
  compare,
  moved = false,
}: {
  entry: JobTrackerEntry;
  compact?: boolean;
  /** It just changed stage: a ring that fades (base.css `.moved-flash`). */
  moved?: boolean;
  onUpdate: (patch: JobTrackerUpdate) => Promise<boolean>;
  onRemove: () => void;
  /** Picking jobs to compare side by side: picked, and whether there's room for this one. */
  compare?: { picked: boolean; full: boolean; onToggle: () => void };
}) {
  const [editing, setEditing] = useState(false);
  const [journey, setJourney] = useState(false);
  // What's under More is drawn once it's opened: on a long board it was a third of every card, never seen.
  const [more, setMore] = useState(false);
  const original = safeUrl(entry.url);
  const apply = safeUrl(entry.apply_url);
  const manual = isManual(entry);
  const open = entry.live ? stillOpenAt(entry) : null;
  const round = roundLabel(entry.round_type, entry.round_number);
  const dates = [
    entry.applied_at ? `Applied ${shortDate(entry.applied_at)}` : `Saved ${shortDate(entry.created_at)}`,
    entry.next_at ? `Next: ${shortDate(entry.next_at)}${round ? `, ${round}` : ""}` : null,
  ].filter(Boolean);
  // Interview day: the way into its prep (and from there the copilot) once there's an interview to prepare for.
  const preparing = entry.status === "applied" || entry.status === "interviewing";

  return (
    <article className={cx("glass-panel relative overflow-hidden rounded-xl", compact ? "p-3 pl-3.5" : "p-4 pl-5")}>
      {/* The status as a colour edge, so a long phone list (one column) still reads at a glance. */}
      <span aria-hidden="true" className={cx("absolute inset-y-0 left-0 w-1", STATUS_MARK[entry.status])} />
      {moved && <span key={entry.status} aria-hidden="true" className="moved-flash pointer-events-none absolute inset-0 rounded-[inherit]" />}
      <div className="flex items-start gap-2.5">
      <CompanyLogo company={entry.company} size={compact ? "md" : "lg"} />
      <div className="min-w-0 flex-1">
      <h4 className={cx("font-medium leading-snug", compact ? "text-sm" : "text-base")}>
        {/* The job's own page while it's in the feed; after that, the original post. */}
        {entry.live ? (
          <Link to={jobPath(entry.listing_id)} className={cx("rounded hover:text-indigo-600 dark:hover:text-indigo-300", focusRing)}>
            {entry.title}
          </Link>
        ) : original ? (
          <a href={original} target="_blank" rel="noopener" className={cx("rounded hover:text-indigo-600 dark:hover:text-indigo-300", focusRing)}>
            {entry.title}
          </a>
        ) : (
          entry.title
        )}
      </h4>
      <div className="mt-0.5 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
        <span className="block truncate font-medium">{entry.company}</span>
        {entry.location && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3 shrink-0 text-zinc-400" aria-hidden />
            <span className="truncate">{entry.location}</span>
          </span>
        )}
      </div>
      </div>
      </div>
      <p className="mt-1.5 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        <CalendarIcon className="h-3 w-3 shrink-0" aria-hidden />
        {dates.join(" · ")}
      </p>
      {entry.notes && !editing && <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-xs text-zinc-600 dark:text-zinc-300">{entry.notes}</p>}
      {manual ? (
        linkHost(entry.url) && <p className="mt-1.5 truncate text-xs text-zinc-500 dark:text-zinc-400">From {linkHost(entry.url)}</p>
      ) : !entry.live ? (
        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">This post is no longer listed in the feed.</p>
      ) : open ? (
        <p className="mt-1.5 text-xs text-sky-800 dark:text-sky-300" title="Found on the company's own careers page at Orbit's last check">
          Still open · checked {postedAgo(open).toLowerCase()}
        </p>
      ) : null}
      {entry.last_round && (
        <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-300">
          {entry.last_round.practice ? "Practice" : "Last round"} {shortDate(entry.last_round.at)}
          {entry.last_round.score !== null ? ` · ${entry.last_round.score}/5` : ""} ·{" "}
          <Link to={`/sessions/${entry.last_round.id}`} className={cx(cardAction, focusRing)}>
            {entry.last_round.practice ? "Review" : "Summary and scorecard"}
          </Link>
        </p>
      )}

      {/* The card leads with one place to work on the job (its mission room) and the step its stage calls for (apply
          while saved, practise while interviewing); everything else waits under More, so a board of cards reads at
          a glance. A job picked for comparing says so on the card. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs coarse:mt-1 coarse:gap-y-0">
        <Link
          to={missionPath(entry.id)}
          aria-label={`Open the mission room for ${entry.title} at ${entry.company}`}
          className={cx("inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline coarse:min-h-11 dark:text-indigo-300", focusRing)}
        >
          Mission room <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
        {entry.status === "saved" && apply && (
          <a href={apply} target="_blank" rel="noopener" className={cx(rowAction, focusRing)}>
            Apply <ArrowUpRight className="h-3 w-3" aria-hidden />
          </a>
        )}
        {preparing ? (
          <Link
            to={interviewPrepPath(entry.id)}
            aria-label={`Prepare for interview: ${entry.title} at ${entry.company}`}
            className={cx(rowAction, focusRing)}
          >
            <Target className="h-3 w-3" aria-hidden /> Prepare for interview
          </Link>
        ) : (
          entry.document_id && (
            <Link to={practiceLink(entry, jobPath)} className={cx(rowAction, focusRing)}>
              <Target className="h-3 w-3" aria-hidden /> Practise
            </Link>
          )
        )}
        {compare?.picked && (
          <button type="button" aria-pressed onClick={compare.onToggle} className={cx(rowAction, "!text-emerald-700 dark:!text-emerald-300", focusRing)}>
            <Check className="h-3 w-3" aria-hidden /> Comparing
          </button>
        )}
      </div>
      <details className="group mt-1.5 text-xs coarse:mt-0" onToggle={(e) => setMore(e.currentTarget.open)}>
        <summary
          className={cx(
            "inline-flex cursor-pointer list-none items-center gap-1 rounded font-medium text-zinc-500 hover:text-zinc-800 coarse:min-h-11 dark:text-zinc-400 dark:hover:text-zinc-100 [&::-webkit-details-marker]:hidden",
            focusRing,
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden /> More<span className="sr-only"> for {entry.title}</span>
        </summary>
        {more && <ul className="mt-1.5 space-y-1 border-l border-zinc-200 pl-3 coarse:mt-0 coarse:space-y-0 dark:border-white/10">
          {entry.resume_id && (
            <li>
              <Link to={resumePath(entry.resume_id)} className={cx(rowAction, focusRing)}>
                <FileText className="h-3 w-3" aria-hidden /> Tailored resume
              </Link>
            </li>
          )}
          <li>
            {/* A referral before applying, a follow-up after, a thank-you once interviewing (Outreach picks by status). */}
            <Link
              to={outreachPath({ job: entry.listing_id, resume: entry.resume_id })}
              aria-label={`Write outreach for ${entry.title}`}
              className={cx(rowAction, focusRing)}
            >
              <Send className="h-3 w-3" aria-hidden /> Write outreach
            </Link>
          </li>
          <li>
            <button type="button" aria-expanded={journey} onClick={() => setJourney((o) => !o)} className={cx(rowAction, focusRing)}>
              <Route className="h-3 w-3" aria-hidden /> {journey ? "Hide journey" : "Journey"}
            </button>
          </li>
          {compare && !compare.picked && (
            <li>
              <button
                type="button"
                aria-pressed={false}
                disabled={compare.full}
                onClick={compare.onToggle}
                title={compare.full ? `Compare up to ${MAX_COMPARE} at once` : undefined}
                className={cx(rowAction, "disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline", focusRing)}
              >
                <Columns3 className="h-3 w-3" aria-hidden /> Compare
              </button>
            </li>
          )}
          {entry.next_at && entry.status !== "rejected" && (
            <li>
              <button
                type="button"
                onClick={() => {
                  const ics = nextDateIcs(entry);
                  if (ics) downloadText(`${fileSlug(entry.company, entry.title)}.ics`, ics, "text/calendar;charset=utf-8");
                }}
                aria-label={`Add to calendar: ${nextDateTitle(entry)}, ${shortDate(entry.next_at)}`}
                title="A calendar file for this date: opens in Google Calendar, Outlook or your phone's calendar"
                className={cx(rowAction, focusRing)}
              >
                <CalendarPlus className="h-3 w-3" aria-hidden /> Add to calendar
              </button>
            </li>
          )}
        </ul>}
      </details>

      {journey && <Journey entryId={entry.id} />}

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
          <IconButton size="sm" icon={PenLine} onClick={() => setEditing(true)} label={`Notes and dates for ${entry.title}`} title="Notes and dates" className={cx("text-zinc-500", compact && "ml-auto")} />
          <IconButton size="sm" icon={Trash2} onClick={onRemove} label={`Remove ${entry.title}`} title="Remove" className="text-zinc-500 hover:!bg-rose-500/10 hover:!text-rose-700 dark:hover:!text-rose-300" />
        </div>
      )}
    </article>
  );
}

export function EditEntry({ entry, onCancel, onSave }: { entry: JobTrackerEntry; onCancel: () => void; onSave: (p: JobTrackerUpdate) => Promise<unknown> }) {
  const [notes, setNotes] = useState(entry.notes);
  const [applied, setApplied] = useState(dateInput(entry.applied_at));
  const [next, setNext] = useState(dateInput(entry.next_at));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const patch: JobTrackerUpdate = { notes };
    const appliedAt = fromDateInput(applied);
    if (appliedAt) patch.applied_at = appliedAt;
    else if (entry.applied_at) patch.clear_applied = true;
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
