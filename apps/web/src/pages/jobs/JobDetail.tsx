import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { JobDetail, JobListing, JobStatus, JobTrackerEntry, JobTrackerUpdate } from "@orbit/types";
import {
  ArrowRight,
  ApiError,
  ArrowLeft,
  ArrowUpRight,
  BookmarkCheck,
  CircleAlert,
  CircleCheck,
  CalendarIcon,
  ExternalLink,
  FileText,
  Info,
  PenLine,
  Send,
  Sparkles,
  Target,
  Trash2,
  LoadGate,
  confirmDialog,
  cx,
  focusRing,
  isIndia,
  CosmicEmptyState,
} from "@orbit/ui";
import { Button, Card, ErrorNote, IconButton, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { useCountry } from "../../lib/country";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { practiceHref } from "../../lib/onboarding";
import { resumePath } from "../resume/paths";
import {
  ActionNotes,
  ApplyLink,
  FitPanel,
  FullPrepButton,
  JobPlace,
  JobWhen,
  MatchBadge,
  NoMatchNote,
  PrepareButton,
  SkillsMatch,
  SourceCredit,
  TailorButton,
  TrackButton,
  TrustBadges,
} from "./JobCard";
import { useJobsAi } from "./JobsAi";
import { linkButton, textLink } from "./links";
import { STATUSES, STATUS_LABEL, jobFacts, matchBasis, postedAgo, safeUrl, shortDate, stillOpenAt } from "./model";
import { StagePill } from "./StagePill";
import { SafetyCard } from "./SafetyCard";
import { EditEntry } from "./Tracker";
import { JOBS_MATCHES, outreachPath } from "./paths";
import { useJobActions } from "./useJobActions";
import { missionPath } from "./mission";
import { interviewPrepPath } from "./interview/links";

/**
 * Jobs AI → one job: everything Orbit may show about it (the post's summary, its key facts, where it's from, the
 * original post), how it matches the resume, the AI fit check, its place on the tracker, and every action.
 */
export function JobDetailPage() {
  const { listingId = "" } = useParams();
  const detail = useAsync(() => api.jobListing(listingId), [listingId], `job|${listingId}`);
  const missing = detail.error instanceof ApiError && detail.error.status === 404;
  return (
    <>
      <BackLink />
      <LoadGate loading={detail.loading && !detail.data} variant="job-card" count={1} label="Opening the job">
      {missing ? (
        <CosmicEmptyState
          variant="no-results"
          title="This job isn't listed any more"
          body="Posts leave the feed once the company takes them down, or after about 30 days. Your matches have the latest ones."
          action={
            <Link to={JOBS_MATCHES} className={linkButton("primary")}>
              <Sparkles className="h-4 w-4" aria-hidden /> See your matches
            </Link>
          }
        />
      ) : detail.error && !detail.data ? (
        <ErrorNote onRetry={detail.reload}>{errorText(detail.error)}</ErrorNote>
      ) : detail.data ? (
        <Job key={detail.data.job.id} detail={detail.data} onChanged={detail.reload} />
      ) : null}
      </LoadGate>
    </>
  );
}

/** Back where the job was opened from (the matches, with their search, or the tracker); else to the matches. */
function BackLink() {
  const navigate = useNavigate();
  const location = useLocation();
  const cls = cx("mb-4 inline-flex items-center gap-1.5 rounded-lg py-1 pr-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white", focusRing);
  // "default" is the first page of this tab: opened from a link elsewhere, so there's nothing in Orbit to go back to.
  if (location.key === "default") {
    return (
      <Link to={JOBS_MATCHES} className={cls}>
        <ArrowLeft className="h-4 w-4" aria-hidden /> All matches
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => navigate(-1)} className={cls}>
      <ArrowLeft className="h-4 w-4" aria-hidden /> Back
    </button>
  );
}

function Job({ detail, onChanged }: { detail: JobDetail; onChanged: () => void }) {
  const country = useCountry();
  const { profile, tracker } = useJobsAi();
  const resumeId = profile.data?.resume?.id ?? null;
  // A change made here shows at once; the page and the tracker are then asked again for the server's copy, which
  // replaces it when it lands.
  const [tracked, setTracked] = useState<JobListing["tracked"] | undefined>(undefined);
  const [seen, setSeen] = useState(detail);
  if (seen !== detail) {
    setSeen(detail);
    setTracked(undefined);
  }
  const job: JobListing = tracked === undefined ? detail.job : { ...detail.job, tracked };
  const changed = () => {
    onChanged();
    tracker.reload();
  };
  const actions = useJobActions(
    job,
    resumeId,
    (_, t) => {
      setTracked(t);
      changed();
    },
    detail.fit,
  );
  const original = safeUrl(job.url);
  const facts = jobFacts(job, country);
  const entry = detail.tracker && job.tracked ? detail.tracker : null;
  // No match % until there's a resume or skills to match against (model.ts `matchBasis`).
  const showMatch = profile.data ? matchBasis(profile.data) !== null : false;

  return (
    <article aria-labelledby="job-title" className="space-y-6">
      <header className="glass-panel relative overflow-hidden rounded-3xl p-5 sm:p-8">
        <div className="relative flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <SourceCredit job={job} />
            <h1 id="job-title" className="mt-2 font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {job.title}
            </h1>
            <JobPlace job={job} className="mt-2 sm:text-base" />
            <JobWhen job={job} className="mt-2" />
            <TrustBadges job={job} className="mt-3" />
            {!showMatch && <NoMatchNote className="mt-3" />}
          </div>
          {showMatch && job.match && <MatchBadge match={job.match} big />}
        </div>
        <div className="relative mt-6 flex flex-wrap items-center gap-2">
          <ApplyLink job={job} actions={actions} big />
          <TrackButton actions={actions} />
          {entry && (
            <Link to={missionPath(entry.id)} className={linkButton("secondary", "sm")}>
              Mission room <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
          {entry && entry.status !== "offer" && entry.status !== "rejected" && (
            <Link to={interviewPrepPath(entry.id)} className={linkButton("secondary", "sm")}>
              <Target className="h-4 w-4" aria-hidden /> Prepare for interview
            </Link>
          )}
          <TailorButton actions={actions} />
          <PrepareButton actions={actions} />
          {/* Written from the resume tailored for this job if there is one, else the one it's matched to. */}
          <Link
            to={outreachPath({ job: job.id, resume: entry?.resume_id ?? resumeId })}
            className={linkButton("ghost", "sm")}
            title={`A referral request, ${isIndia(country) ? "an email to HR" : "an email to a recruiter"}, a follow-up or a thank-you note for this job`}
          >
            <Send className="h-4 w-4" aria-hidden /> Write outreach
          </Link>
          {original && (
            <a href={original} target="_blank" rel="noopener" className={cx(linkButton("ghost", "sm"), "sm:ml-auto")}>
              <ExternalLink className="h-4 w-4" aria-hidden /> View original post
            </a>
          )}
        </div>
        <div className="relative">
          <ActionNotes actions={actions} />
      <FullPrepButton actions={actions} />
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <h2 className="font-display text-base font-semibold">About this job</h2>
            {job.snippet ? (
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{job.snippet}</p>
            ) : original ? (
              <a href={original} target="_blank" rel="noopener" className={cx(linkButton("secondary", "sm"), "mt-3")}>
                Read the post on {job.direct ? `${job.company}'s site` : "the original site"} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : null}
            <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-white/10 dark:text-zinc-400">
              {/* A summary and a link, not the whole post: the job sources' terms (docs/DECISIONS.md D43). */}
              <span>A summary of the post. The full description is on {job.direct ? `${job.company}'s careers page` : "the original post"}.</span>
              {original && (
                <a href={original} target="_blank" rel="noopener" className={cx(textLink, "inline-flex items-center gap-0.5")}>
                  Read it all <ArrowUpRight className="h-3 w-3" aria-hidden />
                </a>
              )}
            </p>
          </Card>

          {showMatch && job.match && (job.match.matched.length > 0 || job.match.missing.length > 0) && (
            <Card>
              <h2 className="font-display text-base font-semibold">How your resume matches</h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                The skills this job asks for, read the way screening software reads them. The match also weighs the title, place, experience and how recent it is.
              </p>
              <SkillsMatch match={job.match} missing={8} chips className="mt-3 text-sm" />
            </Card>
          )}

          {actions.fit.result || actions.fit.loading || actions.fit.error ? (
            <FitPanel fit={actions.fit} onTailor={actions.tailor} card />
          ) : (
            <Card className="flex flex-wrap items-center gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
                <Sparkles className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 basis-56">
                <h2 className="font-display text-base font-semibold">Check my fit</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  The AI compares your resume with this job: why you fit, the gaps, and honest tweaks. Free, a few a day.
                </p>
              </div>
              <Button onClick={actions.checkFit} className="w-full sm:w-auto">
                <Sparkles className="h-4 w-4" aria-hidden /> Check my fit
              </Button>
            </Card>
          )}
        </div>

        <aside className="min-w-0 space-y-6" aria-label="About this job">
          <Card>
            <h2 className="font-display text-base font-semibold">Key facts</h2>
            <dl className="mt-3 space-y-2 text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="flex gap-3">
                  <dt className="w-24 shrink-0 text-zinc-500 dark:text-zinc-400">{label}</dt>
                  <dd className="min-w-0 break-words font-medium">{value}</dd>
                </div>
              ))}
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-zinc-500 dark:text-zinc-400">Posted</dt>
                <dd className="font-medium">
                  <time dateTime={job.posted_at}>{new Date(job.posted_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</time>
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-zinc-500 dark:text-zinc-400">Source</dt>
                <dd className="min-w-0">
                  <SourceCredit job={job} className="!text-sm font-medium !text-zinc-900 dark:!text-zinc-100" />
                </dd>
              </div>
            </dl>
          </Card>

          <TrackerPanel
            entry={entry}
            title={job.title}
            busy={actions.busy !== null}
            onSave={actions.toggleSaved}
            onChanged={(e) => {
              setTracked(e ? { id: e.id, status: e.status } : null);
              changed();
            }}
          />

          <PostingCheck checks={detail.checks ?? []} />
          <Provenance job={job} also={detail.also_listed ?? []} />
          <SafetyCard job={{ id: job.id, title: job.title, company: job.company, url: job.url }} />
        </aside>
      </div>
    </article>
  );
}

/** This job on the tracker: how far along it is, its dates and notes; or a way to save it. */
function TrackerPanel({
  entry,
  title,
  busy,
  onSave,
  onChanged,
}: {
  entry: JobTrackerEntry | null;
  title: string;
  busy: boolean;
  onSave: () => void;
  /** Moved, edited or removed (null). */
  onChanged: (entry: JobTrackerEntry | null) => void;
}) {
  // The server's answer to a change here shows at once; a fresh copy of the page (or saving it from the header)
  // replaces it when it lands.
  const [shown, setShown] = useState(entry);
  const [given, setGiven] = useState(entry);
  if (given !== entry) {
    setGiven(entry);
    setShown(entry);
  }
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = async (patch: JobTrackerUpdate) => {
    if (!shown) return false;
    setError(null);
    try {
      const saved = await api.updateTrackedJob(shown.id, patch);
      setShown(saved);
      onChanged(saved);
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    }
  };
  const remove = async () => {
    if (!shown) return;
    const ok = await confirmDialog({
      title: `Remove “${title}” from your tracker?`,
      body: "It comes off your tracker with its notes. A resume you tailored for it stays in Resume AI.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.untrackJob(shown.id);
      onChanged(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (!shown) {
    return (
      <Card>
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <BookmarkCheck className="h-4 w-4 text-zinc-500 dark:text-zinc-400" aria-hidden /> Your tracker
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Save it to keep it in view, then move it along as you apply and interview.</p>
        <Button variant="secondary" size="sm" className="mt-3" disabled={busy} onClick={onSave}>
          <BookmarkCheck className="h-4 w-4" aria-hidden /> Save to tracker
        </Button>
      </Card>
    );
  }
  const dates = [
    shown.applied_at ? `Applied ${shortDate(shown.applied_at)}` : `Saved ${shortDate(shown.created_at)}`,
    shown.next_at ? `Next: ${shortDate(shown.next_at)}` : null,
  ].filter(Boolean);
  return (
    <Card>
      <h2 className="flex items-center gap-2 font-display text-base font-semibold">
        <BookmarkCheck className="h-4 w-4 text-zinc-500 dark:text-zinc-400" aria-hidden /> On your tracker
        <StagePill status={shown.status} className="ml-auto" />
      </h2>
      <p className="mt-2 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        <CalendarIcon className="h-3 w-3 shrink-0" aria-hidden />
        {dates.join(" · ")}
      </p>
      {shown.notes && !editing && <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-300">{shown.notes}</p>}
      {(shown.resume_id || shown.document_id) && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {shown.resume_id && (
            <Link to={resumePath(shown.resume_id)} className={cx(textLink, "inline-flex items-center gap-1")}>
              <FileText className="h-3 w-3" aria-hidden /> Tailored resume
            </Link>
          )}
          {shown.document_id && (
            <Link to={practiceHref({ jd: shown.document_id ?? undefined, role: shown.title, company: shown.company })} className={cx(textLink, "inline-flex items-center gap-1")}>
              <Target className="h-3 w-3" aria-hidden /> Practise
            </Link>
          )}
        </div>
      )}
      {editing ? (
        <EditEntry entry={shown} onCancel={() => setEditing(false)} onSave={async (p) => (await update(p)) && setEditing(false)} />
      ) : (
        <div className="mt-3 flex items-center gap-1.5">
          <label className="sr-only" htmlFor="detail-status">
            Move to
          </label>
          <Select id="detail-status" value={shown.status} onChange={(e) => void update({ status: e.target.value as JobStatus })} className="min-w-0 flex-1 !py-1.5 !text-sm">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <IconButton size="sm" icon={PenLine} onClick={() => setEditing(true)} label="Notes and dates" className="text-zinc-500" />
          <IconButton size="sm" icon={Trash2} onClick={() => void remove()} label="Remove from your tracker" title="Remove" className="text-zinc-500 hover:!bg-rose-500/10 hover:!text-rose-700 dark:hover:!text-rose-300" />
        </div>
      )}
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Card>
  );
}

const SIGNAL_ICON = { caution: CircleAlert, info: Info, good: CircleCheck } as const;
const SIGNAL_TONE = { caution: "text-amber-500", info: "text-zinc-400", good: "text-emerald-500" } as const;

/**
 * Is this a live opening? What Orbit can see (its age, whether it was re-dated or posted elsewhere earlier, standing-ad
 * wording, a pay range, the careers page): signals to weigh, never a verdict, since plenty of real roles stay up long.
 */
function PostingCheck({ checks }: { checks: NonNullable<JobDetail["checks"]> }) {
  if (!checks.length) return null;
  const cautions = checks.filter((c) => c.tone === "caution").length;
  return (
    <Card>
      <h2 className="font-display text-base font-semibold">Posting check</h2>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        {cautions ? `${cautions} thing${cautions === 1 ? "" : "s"} to weigh before you spend time on it.` : "Nothing here suggests it isn't a live opening."}
      </p>
      <ul className="mt-2 space-y-2 text-sm">
        {checks.map((c) => {
          const Icon = SIGNAL_ICON[c.tone];
          return (
            <li key={c.kind} className="flex gap-2">
              <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", SIGNAL_TONE[c.tone])} aria-label={c.tone === "caution" ? "Caution" : c.tone === "good" ? "Good sign" : "Note"} />
              <span>{c.text}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * Where this post came from: the source, whether it's the company's own careers page, when Orbit first saw it and
 * last found it still listed, and where else the same job is posted. Facts Orbit recorded, never a "verified" claim.
 */
function Provenance({ job, also }: { job: JobListing; also: NonNullable<JobDetail["also_listed"]> }) {
  const open = stillOpenAt(job);
  return (
    <Card>
      <h2 className="font-display text-base font-semibold">Where this post came from</h2>
      <dl className="mt-2 space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-zinc-500 dark:text-zinc-400">Source</dt>
          <dd className="text-right">{job.direct ? `${job.company}'s careers page (via ${job.source_label})` : job.source_label}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-zinc-500 dark:text-zinc-400">First seen by Orbit</dt>
          <dd className="text-right">{shortDate(job.first_seen_at ?? job.posted_at)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-zinc-500 dark:text-zinc-400">Still listed</dt>
          <dd className="text-right">{open ? `Yes, checked ${postedAgo(open).toLowerCase()}` : job.direct ? "Not found at the last check" : "Can't be re-checked for this source"}</dd>
        </div>
      </dl>
      {also.length > 0 && (
        <div className="mt-3 border-t border-zinc-200 pt-3 text-sm dark:border-white/10">
          <p className="text-zinc-500 dark:text-zinc-400">Also posted on</p>
          <ul className="mt-1 space-y-1">
            {also.map((a) => (
              <li key={a.id}>
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noopener" className={cx(textLink, "inline-flex items-center gap-0.5")}>
                    {a.direct ? `${job.company}'s careers page (${a.source_label})` : a.source_label} <ArrowUpRight className="h-3 w-3" aria-hidden />
                  </a>
                ) : (
                  a.source_label
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
