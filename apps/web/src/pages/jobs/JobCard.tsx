import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { JobFitResponse, JobListing, JobStatus } from "@orbit/types";
import {
  ApiError,
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
  practiceDocuments,
} from "@orbit/ui";
import { Button, ErrorNote, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { resumeToText } from "../resume/model";
import { STATUS_LABEL, VERDICT_TONE, factsLine, isNew, matchTone, postedAgo, safeUrl, sourceLine } from "./model";

/** Links into the resume editor (the Resume AI section). */
export const resumePath = (id: string) => `/resume-ai/${encodeURIComponent(id)}`;

interface Props {
  job: JobListing;
  /** The resume the feed is matched to (tailoring copies it). */
  resumeId: string | null;
  /** The job's tracker state changed (saved, applied, removed). */
  onTracked: (jobId: string, tracked: JobListing["tracked"]) => void;
}

/** One job in the feed: what it is, how well it matches, where it's from, and what Orbit can do with it. */
export function JobCard({ job, resumeId, onTracked }: Props) {
  const navigate = useNavigate();
  const [askApplied, setAskApplied] = useState(false);
  const [busy, setBusy] = useState<"save" | "applied" | "tailor" | "prepare" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; to: string; label: string } | null>(null);
  const [fit, setFit] = useState<{ loading: boolean; result: JobFitResponse | null; error: string | null; open: boolean }>({
    loading: false,
    result: null,
    error: null,
    open: false,
  });
  const apply = safeUrl(job.apply_url);
  const original = safeUrl(job.url);
  const tracked = job.tracked;

  const track = async (status: JobStatus) => {
    setBusy(status === "applied" ? "applied" : "save");
    setError(null);
    try {
      const entry = await api.trackJob(job.id, status);
      onTracked(job.id, { id: entry.id, status: entry.status });
      setAskApplied(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const unsave = async () => {
    if (!tracked) return;
    setBusy("save");
    setError(null);
    try {
      await api.untrackJob(tracked.id);
      onTracked(job.id, null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const checkFit = async () => {
    if (fit.result) {
      setFit((f) => ({ ...f, open: !f.open }));
      return;
    }
    setFit({ loading: true, result: null, error: null, open: true });
    try {
      setFit({ loading: false, result: await api.jobFitCheck(job.id), error: null, open: true });
    } catch (err) {
      const limit = err instanceof ApiError && err.code === "fit_check_limit";
      setFit({ loading: false, result: null, error: limit ? err.message : errorText(err), open: true });
    }
  };

  const tailor = async () => {
    setBusy("tailor");
    setError(null);
    try {
      const r = await api.tailorForJob(job.id, resumeId);
      if (!tracked) onTracked(job.id, { id: r.tracker_id, status: "saved" });
      if (r.note) setNote({ text: r.note, to: resumePath(r.resume_id), label: `Open “${r.title}”` });
      else navigate(resumePath(r.resume_id), { state: { fromJob: job.title } });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const prepare = async () => {
    setBusy("prepare");
    setError(null);
    try {
      const r = await api.prepareForJob(job.id);
      const to = `/mock?jd=${encodeURIComponent(r.document_id)}`;
      if (!tracked) onTracked(job.id, { id: r.tracker_id, status: "saved" });
      // Practice reads the resume from Documents: save the matched one there too, the way "Use in Orbit" does (kept
      // up to date, not copied). Without it the questions still come; the answers just can't use the resume.
      if (resumeId) {
        await api
          .getResume(resumeId)
          .then((resume) => practiceDocuments(api, { title: resume.title, resumeText: resumeToText(resume.data), jobText: "" }))
          .catch(() => undefined);
      }
      if (r.note) setNote({ text: r.note, to, label: "Go to Practice" });
      else navigate(to);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="glass-panel rounded-2xl p-4 sm:p-5" aria-labelledby={`job-${job.id}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={`job-${job.id}`} className="font-display text-base font-semibold leading-snug sm:text-lg">
            {original ? (
              <a href={original} target="_blank" rel="noopener" className={cx("rounded hover:text-indigo-600 dark:hover:text-indigo-300", focusRing)}>
                {job.title}
              </a>
            ) : (
              job.title
            )}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-300">
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
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden />
              <time dateTime={job.posted_at}>{postedAgo(job.posted_at)}</time>
            </span>
            {isNew(job.posted_at) && (
              <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">New</span>
            )}
            {factsLine(job) && (
              <>
                <span aria-hidden>·</span>
                <span>{factsLine(job)}</span>
              </>
            )}
          </p>
        </div>
        {job.match && (
          <span
            className={cx("flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl ring-1", matchTone(job.match.score))}
            aria-label={`Match ${job.match.score} percent`}
            title="How well this job matches your profile and resume"
          >
            <span className="font-display text-lg font-semibold leading-none tabular-nums">{job.match.score}%</span>
            <span className="text-[0.625rem] leading-none opacity-80">match</span>
          </span>
        )}
      </div>

      {job.snippet && <p className="mt-3 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-300">{job.snippet}</p>}

      {job.match && (job.match.matched.length > 0 || job.match.missing.length > 0) && (
        <div className="mt-3 space-y-1.5 text-xs">
          {job.match.matched.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Skills you have that this job asks for">
              {job.match.matched.map((s) => (
                <li key={s} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-800 dark:text-emerald-300">
                  <Check className="h-3 w-3" aria-hidden /> {s}
                </li>
              ))}
            </ul>
          )}
          {job.match.missing.length > 0 && (
            <p className="text-zinc-500 dark:text-zinc-400">
              <span className="font-medium">Not on your resume:</span> {job.match.missing.slice(0, 4).join(", ")}
            </p>
          )}
        </div>
      )}

      <SourceCredit job={job} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {apply && (
          <a
            href={apply}
            target="_blank"
            rel="noopener"
            onClick={() => tracked?.status !== "applied" && setAskApplied(true)}
            className={cx(
              "btn-sheen inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-indigo-500 to-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-glow-sm hover:from-indigo-400 hover:to-indigo-500",
              focusRing,
            )}
          >
            Apply <ArrowUpRight className="h-4 w-4" aria-hidden />
            <span className="sr-only">(opens {job.direct ? `${job.company}'s site` : "the original post"} in a new tab)</span>
          </a>
        )}
        {tracked && tracked.status !== "saved" ? (
          <Link
            to="/resume-ai/jobs?view=tracker"
            className={cx("inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-500/10 dark:text-indigo-300", focusRing)}
          >
            <BookmarkCheck className="h-4 w-4" aria-hidden /> {STATUS_LABEL[tracked.status]}
          </Link>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            aria-pressed={Boolean(tracked)}
            onClick={() => void (tracked ? unsave() : track("saved"))}
          >
            {tracked ? <BookmarkCheck className="h-4 w-4 text-indigo-500" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
            {tracked ? "Saved" : "Save"}
          </Button>
        )}
        <Button variant="secondary" size="sm" disabled={fit.loading} aria-expanded={fit.open} onClick={() => void checkFit()}>
          <Sparkles className="h-4 w-4" aria-hidden /> {fit.result && fit.open ? "Hide fit check" : "Check my fit"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void tailor()} title="A copy of your resume aimed at this job, opened in the editor">
          <Wand2 className="h-4 w-4" aria-hidden /> {busy === "tailor" ? "Making a copy…" : "Tailor my resume"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void prepare()} title="Saves the job description for Practice: interview questions and a mock interview">
          <Target className="h-4 w-4" aria-hidden /> {busy === "prepare" ? "Saving the job…" : "Prepare"}
        </Button>
      </div>

      {askApplied && (
        <div role="status" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-indigo-500/10 p-3 text-sm text-indigo-950 dark:text-indigo-100">
          <span className="min-w-0 flex-1">Did you apply? Orbit can keep track of it for you.</span>
          <Button size="sm" disabled={busy !== null} onClick={() => void track("applied")}>
            <Check className="h-4 w-4" aria-hidden /> {busy === "applied" ? "Saving…" : "Yes, I applied"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAskApplied(false)}>
            Not yet
          </Button>
        </div>
      )}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {note && (
        <div role="status" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-950 ring-1 ring-amber-500/25 dark:text-amber-100">
          <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{note.text}</span>
          <Link to={note.to} className={cx("font-medium underline", focusRing)}>
            {note.label}
          </Link>
        </div>
      )}
      {fit.open && <FitPanel fit={fit} onClose={() => setFit((f) => ({ ...f, open: false }))} onTailor={() => void tailor()} />}
    </article>
  );
}

/** Where the job came from, with the credit each feed's terms ask for (a followed link, its name). */
function SourceCredit({ job }: { job: JobListing }) {
  const a = job.attribution;
  const link = a ? safeUrl(a.url) : null;
  return (
    <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
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

function FitPanel({
  fit,
  onClose,
  onTailor,
}: {
  fit: { loading: boolean; result: JobFitResponse | null; error: string | null };
  onClose: () => void;
  onTailor: () => void;
}) {
  return (
    <section aria-label="Fit check" className="mt-4 rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-indigo-500" aria-hidden />
        <h4 className="flex-1 font-display text-sm font-semibold">Fit check</h4>
        <button type="button" onClick={onClose} aria-label="Close the fit check" className={cx("rounded-md p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white", focusRing)}>
          <X className="h-4 w-4" />
        </button>
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
