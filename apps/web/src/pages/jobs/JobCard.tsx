import { Link } from "react-router-dom";
import type { JobListing, JobMatch } from "@orbit/types";
import {
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  Building2,
  Check,
  CircleAlert,
  Clock,
  FileText,
  MapPin,
  Sparkles,
  Target,
  Wand2,
  X,
  cx,
  focusRing,
} from "@orbit/ui";
import { Button, ErrorNote, Spinner } from "../../components/ui";
import { STATUS_LABEL, VERDICT_TONE, factsLine, isNew, matchTone, postedAgo, safeUrl, sourceLine } from "./model";
import { JOBS_TRACKER, jobPath } from "./paths";
import { useJobActions, type FitState, type JobActions } from "./useJobActions";

interface Props {
  job: JobListing;
  /** The resume the feed is matched to (tailoring copies it). */
  resumeId: string | null;
  /** The job's tracker state changed (saved, applied, removed). */
  onTracked: (jobId: string, tracked: JobListing["tracked"]) => void;
}

/**
 * One job in the feed: what it is, how well it matches, where it's from, and what Orbit can do with it. The title
 * opens the job's own page (everything about it, and the same actions).
 */
export function JobCard({ job, resumeId, onTracked }: Props) {
  const actions = useJobActions(job, resumeId, onTracked);
  return (
    <article className="glass-panel rounded-2xl p-4 sm:p-5" aria-labelledby={`job-${job.id}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={`job-${job.id}`} className="font-display text-base font-semibold leading-snug sm:text-lg">
            <Link to={jobPath(job.id)} className={cx("rounded hover:text-indigo-600 dark:hover:text-indigo-300", focusRing)}>
              {job.title}
            </Link>
          </h3>
          <JobPlace job={job} className="mt-1" />
          <JobWhen job={job} className="mt-1" />
        </div>
        {job.match && <MatchBadge match={job.match} />}
      </div>

      {job.snippet && <p className="mt-3 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-300">{job.snippet}</p>}

      {job.match && <SkillsMatch match={job.match} className="mt-3" />}

      <SourceCredit job={job} className="mt-3" />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ApplyLink job={job} actions={actions} />
        <TrackButton actions={actions} />
        <Button variant="secondary" size="sm" disabled={actions.fit.loading} aria-expanded={actions.fit.open} onClick={actions.checkFit}>
          <Sparkles className="h-4 w-4" aria-hidden /> {actions.fit.result && actions.fit.open ? "Hide fit check" : "Check my fit"}
        </Button>
        <TailorButton actions={actions} />
        <PrepareButton actions={actions} />
      </div>

      <ActionNotes actions={actions} />
      {actions.fit.open && <FitPanel fit={actions.fit} onClose={actions.closeFit} onTailor={actions.tailor} className="mt-4" />}
    </article>
  );
}

/** Company and place, with their icons. */
export function JobPlace({ job, className }: { job: JobListing; className?: string }) {
  return (
    <p className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-300", className)}>
      <span className="inline-flex min-w-0 items-center gap-1">
        <Building2 className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
        <span className="truncate">{job.company}</span>
      </span>
      {job.place && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
          <span className="truncate">{job.place}</span>
        </span>
      )}
    </p>
  );
}

/** "3h ago · New · Full-time · 3-5 years · ₹24L – ₹36L a year" (`facts` false: when it was posted only). */
export function JobWhen({ job, className, facts = true }: { job: JobListing; className?: string; facts?: boolean }) {
  const line = facts ? factsLine(job) : "";
  return (
    <p className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400", className)}>
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3" aria-hidden />
        <time dateTime={job.posted_at}>{postedAgo(job.posted_at)}</time>
      </span>
      {isNew(job.posted_at) && <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">New</span>}
      {line && (
        <>
          <span aria-hidden>·</span>
          <span>{line}</span>
        </>
      )}
    </p>
  );
}

/** "86% match", coloured from strong to weak. */
export function MatchBadge({ match, big = false }: { match: JobMatch; big?: boolean }) {
  return (
    <span
      className={cx(
        "flex shrink-0 flex-col items-center justify-center ring-1",
        big ? "h-16 w-16 rounded-2xl" : "h-12 w-12 rounded-xl",
        matchTone(match.score),
      )}
      aria-label={`Match ${match.score} percent`}
      title="How well this job matches your profile and resume"
    >
      <span className={cx("font-display font-semibold leading-none tabular-nums", big ? "text-2xl" : "text-lg")}>{match.score}%</span>
      <span className={cx("leading-none opacity-80", big ? "mt-0.5 text-xs" : "text-[0.625rem]")}>match</span>
    </span>
  );
}

/** The skills the job asks for that the resume shows (ticked), and up to `missing` of those it doesn't. */
export function SkillsMatch({ match, missing = 4, className }: { match: JobMatch; missing?: number; className?: string }) {
  if (!match.matched.length && !match.missing.length) return null;
  return (
    <div className={cx("space-y-1.5 text-xs", className)}>
      {match.matched.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Skills you have that this job asks for">
          {match.matched.map((s) => (
            <li key={s} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-800 dark:text-emerald-300">
              <Check className="h-3 w-3" aria-hidden /> {s}
            </li>
          ))}
        </ul>
      )}
      {match.missing.length > 0 && (
        <p className="text-zinc-500 dark:text-zinc-400">
          <span className="font-medium">Not on your resume:</span> {match.missing.slice(0, missing).join(", ")}
        </p>
      )}
    </div>
  );
}

/** Apply: the original post in a new tab, then "Did you apply?". */
export function ApplyLink({ job, actions, big = false }: { job: JobListing; actions: JobActions; big?: boolean }) {
  const apply = safeUrl(job.apply_url);
  if (!apply) return null;
  return (
    <a
      href={apply}
      target="_blank"
      rel="noopener"
      onClick={actions.applied}
      className={cx(
        "btn-sheen inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-indigo-500 to-indigo-600 text-sm font-medium text-white shadow-glow-sm hover:from-indigo-400 hover:to-indigo-500",
        big ? "px-5 py-2.5" : "px-3.5 py-1.5",
        focusRing,
      )}
    >
      Apply <ArrowUpRight className="h-4 w-4" aria-hidden />
      <span className="sr-only">(opens {job.direct ? `${job.company}'s site` : "the original post"} in a new tab)</span>
    </a>
  );
}

/** Save (or Saved, to take it off again); once it's further along, its status, linking to the tracker. */
export function TrackButton({ actions }: { actions: JobActions }) {
  const { tracked, busy } = actions;
  if (tracked && tracked.status !== "saved") {
    return (
      <Link
        to={JOBS_TRACKER}
        className={cx("inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-500/10 dark:text-indigo-300", focusRing)}
      >
        <BookmarkCheck className="h-4 w-4" aria-hidden /> {STATUS_LABEL[tracked.status]}
      </Link>
    );
  }
  return (
    <Button variant="secondary" size="sm" disabled={busy !== null} aria-pressed={Boolean(tracked)} onClick={actions.toggleSaved}>
      {tracked ? <BookmarkCheck className="h-4 w-4 text-indigo-500" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
      {tracked ? "Saved" : "Save"}
    </Button>
  );
}

export function TailorButton({ actions }: { actions: JobActions }) {
  return (
    <Button variant="ghost" size="sm" disabled={actions.busy !== null} onClick={actions.tailor} title="A copy of your resume aimed at this job, opened in Resume AI">
      <Wand2 className="h-4 w-4" aria-hidden /> {actions.busy === "tailor" ? "Making a copy…" : "Tailor my resume"}
    </Button>
  );
}

export function PrepareButton({ actions }: { actions: JobActions }) {
  return (
    <Button variant="ghost" size="sm" disabled={actions.busy !== null} onClick={actions.prepare} title="Saves the job description for Practice: interview questions and a mock interview">
      <Target className="h-4 w-4" aria-hidden /> {actions.busy === "prepare" ? "Saving the job…" : "Prepare"}
    </Button>
  );
}

/** What an action has to say: "Did you apply?", an error, or a note with where to go next. */
export function ActionNotes({ actions }: { actions: JobActions }) {
  const { askApplied, busy, error, note } = actions;
  return (
    <>
      {askApplied && (
        <div role="status" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-indigo-500/10 p-3 text-sm text-indigo-950 dark:text-indigo-100">
          <span className="min-w-0 flex-1">Did you apply? Orbit can keep track of it for you.</span>
          <Button size="sm" disabled={busy !== null} onClick={() => actions.track("applied")}>
            <Check className="h-4 w-4" aria-hidden /> {busy === "applied" ? "Saving…" : "Yes, I applied"}
          </Button>
          <Button variant="ghost" size="sm" onClick={actions.notYet}>
            Not yet
          </Button>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {note && (
        <div role="status" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-950 ring-1 ring-amber-500/25 dark:text-amber-100">
          <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{note.text}</span>
          <Link to={note.to} className={cx("font-medium underline", focusRing)}>
            {note.label}
          </Link>
        </div>
      )}
    </>
  );
}

/** Where the job came from, with the credit each feed's terms ask for (a followed link, its name). */
export function SourceCredit({ job, className }: { job: JobListing; className?: string }) {
  const a = job.attribution;
  const link = a ? safeUrl(a.url) : null;
  return (
    <p className={cx("text-xs text-zinc-500 dark:text-zinc-400", className)}>
      {job.direct || !a || !link ? (
        sourceLine(job)
      ) : a.large ? (
        <>
          via{" "}
          <a
            href={link}
            target="_blank"
            rel="noopener"
            className={cx("inline-flex min-h-[23px] min-w-[116px] items-center justify-center rounded-md bg-zinc-900 px-2 align-middle font-display text-sm font-semibold text-white dark:bg-white dark:text-zinc-900", focusRing)}
          >
            {a.label}
          </a>
        </>
      ) : (
        <>
          via{" "}
          <a href={link} target="_blank" rel="noopener" className={cx("font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-200", focusRing)}>
            {a.label}
          </a>
        </>
      )}
    </p>
  );
}

/**
 * The AI's fit check: the verdict, why you fit, the gaps and honest tweaks. `onClose` adds a close button; `card`
 * makes it a card of its own (a job's page) rather than a panel inside one (the feed's cards).
 */
export function FitPanel({
  fit,
  onClose,
  onTailor,
  card = false,
  className,
}: {
  fit: Pick<FitState, "loading" | "result" | "error">;
  onClose?: () => void;
  onTailor: () => void;
  card?: boolean;
  className?: string;
}) {
  return (
    <section
      aria-label="Fit check"
      className={cx(
        card ? "glass-panel rounded-2xl p-5" : "rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.03]",
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-indigo-500" aria-hidden />
        <h4 className="flex-1 font-display text-sm font-semibold">Fit check</h4>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close the fit check" className={cx("rounded-md p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white", focusRing)}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {fit.loading && <Spinner label="Comparing your resume with this job" state="searching" />}
      {fit.error && <p className="text-sm text-rose-700 dark:text-rose-300">{fit.error}</p>}
      {fit.result && (
        <div className="space-y-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1", VERDICT_TONE[fit.result.check.verdict])}>
              {fit.result.check.verdict} fit
            </span>
            <span className="text-zinc-700 dark:text-zinc-200">{fit.result.check.summary}</span>
          </p>
          <FitList title="Why you fit" items={fit.result.check.why} tone="text-emerald-600 dark:text-emerald-400" icon="check" />
          <FitList title="Gaps" items={fit.result.check.gaps} tone="text-amber-600 dark:text-amber-400" icon="gap" />
          {fit.result.check.tweaks.length > 0 && (
            <div>
              <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Honest resume tweaks</h5>
              <ul className="space-y-1.5">
                {fit.result.check.tweaks.map((t) => (
                  <li key={t.change} className="flex gap-2">
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" aria-hidden />
                    <span>
                      {t.change}
                      {t.why && <span className="text-zinc-500 dark:text-zinc-400"> {t.why}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-3 dark:border-white/10">
            <Button size="sm" onClick={onTailor}>
              <Wand2 className="h-4 w-4" aria-hidden /> Tailor my resume for this job
            </Button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Free.{" "}
              {fit.result.cached
                ? "You checked this before, so it didn't use a check."
                : fit.result.left === null
                  ? "No daily limit on your account."
                  : `${fit.result.left} fit ${fit.result.left === 1 ? "check" : "checks"} left today.`}{" "}
              Based only on what your resume says.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function FitList({ title, items, tone, icon }: { title: string; items: string[]; tone: string; icon: "check" | "gap" }) {
  if (!items.length) return null;
  return (
    <div>
      <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h5>
      <ul className="space-y-1">
        {items.map((s) => (
          <li key={s} className="flex gap-2">
            {icon === "check" ? <Check className={cx("mt-0.5 h-3.5 w-3.5 shrink-0", tone)} aria-hidden /> : <CircleAlert className={cx("mt-0.5 h-3.5 w-3.5 shrink-0", tone)} aria-hidden />}
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
