import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ResumeSummary } from "@orbit/types";
import {
  ApiError,
  ArrowUpRight,
  Building2,
  FileText,
  Send,
  cx,
  focusRing,
  loadKit,
  messageKit,
  saveKit,
  withMessageKit,
  type SavedKit,
  LoadGate,
  isIndia,
  regionWords,
} from "@orbit/ui";
import { Card, EmptyState, ErrorNote, Field, PageHeader, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useCountry } from "../../lib/country";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { AllowanceContext, useResumeAllowance } from "../resume/allowance";
import { RESUME_AI_HOME, resumePath } from "../resume/paths";
import { useJobsAi } from "./JobsAi";
import { linkButton, textLink } from "./links";
import { STATUS_LABEL, STATUS_TONE, jobAsks, shortDate } from "./model";
import { LinkedInPart, MessagesPart, NaukriPart, jobTitle, type OutreachJob } from "./OutreachKit";
import { jobPath } from "./paths";
import { PeopleSection } from "./People";

type Part = "messages" | "naukri" | "linkedin";

// "Naukri" and "LinkedIn" alone on phones, so the three fit a 360 px screen.
const PARTS: Array<{ id: Part; label: string; more?: string }> = [
  { id: "messages", label: "Messages" },
  { id: "naukri", label: "Naukri", more: " profile" },
  { id: "linkedin", label: "LinkedIn", more: " profile" },
];

/**
 * Orbit Jobs AI → Outreach (`/jobs/outreach`; it was Resume AI's "Profiles & outreach" tab): the messages a job hunt
 * runs on (referral requests, emails to HR, follow-ups, thank-you notes) and the Naukri and LinkedIn profiles, written
 * from one of your resumes. `?resume=` picks the resume (else the one edited last) and `?job=` a job from Jobs AI to
 * write for (a job's page and the tracker open it that way). Each one written uses a resume credit; this browser
 * keeps what was written, per resume (and messages per job), as last edited.
 */
export function JobOutreachPage() {
  const country = useCountry();
  const india = isIndia(country);
  const [params, setParams] = useSearchParams();
  const resumes = useAsync(() => api.listResumes(), [], "resumes");
  const allowance = useResumeAllowance();
  const list = resumes.data;
  const wanted = params.get("resume");
  // Newest first (the list's order): a resume that isn't given, or is gone, falls back to the one edited last.
  const picked = list?.find((r) => r.id === wanted) ?? list?.[0] ?? null;
  const pick = (key: "resume" | "job", value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <AllowanceContext.Provider value={allowance}>
      <PageHeader
        icon={Send}
        title="Outreach"
        subtitle={`Referral requests, ${regionWords(country).coldEmails}, follow-ups and thank-you notes, and your ${india ? "Naukri and LinkedIn profiles" : "LinkedIn profile"}.`}
      />
      <LoadGate loading={resumes.loading && !list} variant="card" count={2} label="Getting your resumes">
      {resumes.error && !list ? (
        <ErrorNote onRetry={resumes.reload}>{errorText(resumes.error)}</ErrorNote>
      ) : list && !list.length ? (
        <NoResumeYet />
      ) : picked && list ? (
        <ResumeOutreach key={picked.id} picked={picked} resumes={list} jobId={params.get("job")} onPick={pick} />
      ) : null}
      </LoadGate>
      <PeopleSection />
    </AllowanceContext.Provider>
  );
}

function NoResumeYet() {
  return (
    <EmptyState
      icon={FileText}
      title="Make a resume first"
      body="Outreach is written from your resume: your experience, results and skills, and nothing it doesn't say. Make one in Resume AI, or import the one you have, then come back here."
      action={
        <Link to={RESUME_AI_HOME} className={linkButton("primary")}>
          <FileText className="h-4 w-4" aria-hidden /> Open Resume AI
        </Link>
      }
    />
  );
}

/** The job `?job=` names: its page in Jobs AI, else its copy on the tracker once the post has left the feed. */
function useOutreachJob(jobId: string | null) {
  const { tracker } = useJobsAi();
  const detail = useAsync(() => (jobId ? api.jobListing(jobId) : Promise.resolve(null)), [jobId], jobId ? `job|${jobId}` : undefined);
  const entry = jobId ? (tracker.data?.find((e) => e.listing_id === jobId) ?? null) : null;
  const gone = detail.error instanceof ApiError && detail.error.status === 404;
  const d = detail.data;
  let job: OutreachJob | null = null;
  if (jobId && d && d.job.id === jobId) {
    job = {
      id: jobId,
      title: d.job.title,
      company: d.job.company,
      place: d.job.place,
      live: true,
      asks: jobAsks(d.job.match),
      status: d.tracker?.status ?? d.job.tracked?.status ?? entry?.status ?? null,
    };
  } else if (jobId && entry && detail.error) {
    job = { id: jobId, title: entry.title, company: entry.company, place: entry.location, live: false, asks: [], status: entry.status };
  }
  return {
    job,
    entries: tracker.data ?? [],
    loading: Boolean(jobId) && !job && detail.loading,
    // Not in the feed and not on the tracker: nothing says what it was.
    gone: gone && !entry,
    failed: detail.error && !gone ? detail.error : null,
    retry: detail.reload,
  };
}

type JobState = ReturnType<typeof useOutreachJob>;

function ResumeOutreach({
  picked,
  resumes,
  jobId,
  onPick,
}: {
  picked: ResumeSummary;
  resumes: ResumeSummary[];
  jobId: string | null;
  onPick: (key: "resume" | "job", value: string | null) => void;
}) {
  const resume = useAsync(() => api.getResume(picked.id), [picked.id], `resume|${picked.id}`);
  const job = useOutreachJob(jobId);
  const india = isIndia(useCountry()); // Naukri is India's job site: its profile is offered there only
  const [part, setPart] = useState<Part>("messages");
  const [kit, setKit] = useState<SavedKit>(() => loadKit(picked.id));
  useEffect(() => saveKit(picked.id, kit), [picked.id, kit]);
  const r = resume.data;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* First on phones (what it's written from, at the top); the right-hand column from lg up. One card, so on a
          phone it takes little room above the writing. */}
      <aside aria-label="What it's written from" className="min-w-0 lg:col-start-2 lg:row-start-1">
        <Card className="!p-4">
          <ResumePicker picked={picked} resumes={resumes} onPick={(id) => onPick("resume", id)} />
          {part === "messages" && (
            <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-white/10">
              <JobPicker jobId={jobId} state={job} resumeJob={r && !jobId ? jobTitle(r.job_text) : ""} onPick={(id) => onPick("job", id)} />
            </div>
          )}
        </Card>
      </aside>

      <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
        <div role="group" aria-label="What to write" className="inline-flex gap-1 rounded-xl bg-zinc-500/10 p-1">
          {PARTS.filter((p) => p.id !== "naukri" || india).map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={part === p.id}
              onClick={() => setPart(p.id)}
              className={cx("whitespace-nowrap rounded-lg px-3 py-1 text-sm", part === p.id ? "bg-white font-medium shadow-sm dark:bg-white/10" : "text-zinc-500", focusRing)}
            >
              {p.label}
              {p.more && <span className="hidden sm:inline">{p.more}</span>}
            </button>
          ))}
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Only what your resume says goes in: no made-up numbers, skills or names. Edit anything, then copy it into the site.
        </p>

        <LoadGate loading={resume.loading && !r} variant="card" count={2} label="Opening your resume">
        {resume.error && !r ? (
          <ErrorNote onRetry={resume.reload}>{errorText(resume.error)}</ErrorNote>
        ) : r ? (
          <>
            {part === "naukri" && india && <NaukriPart resume={r} value={kit.naukri} onChange={(naukri) => setKit((k) => ({ ...k, naukri }))} />}
            {part === "linkedin" && <LinkedInPart resume={r} value={kit.linkedin} onChange={(linkedin) => setKit((k) => ({ ...k, linkedin }))} />}
            {part === "messages" && (
              <MessagesPart
                resume={r}
                jobId={jobId}
                job={job.job}
                jobLoading={job.loading}
                slot={messageKit(kit, jobId)}
                onSlot={(change) => setKit((k) => withMessageKit(k, jobId, change(messageKit(k, jobId))))}
              />
            )}
          </>
        ) : null}
        </LoadGate>
      </div>
    </div>
  );
}

/** The resume it's all written from, and the way to change it. */
function ResumePicker({ picked, resumes, onPick }: { picked: ResumeSummary; resumes: ResumeSummary[]; onPick: (id: string) => void }) {
  return (
    <>
      <Field label="Written from" htmlFor="outreach-resume">
        <Select id="outreach-resume" value={picked.id} onChange={(e) => onPick(e.target.value)}>
          {resumes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </Select>
      </Field>
      <p className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span>Edited {shortDate(picked.updated_at)}</span>
        <Link to={resumePath(picked.id)} className={cx(textLink, "inline-flex items-center gap-0.5")}>
          Open in Resume AI <ArrowUpRight className="h-3 w-3" aria-hidden />
        </Link>
      </p>
    </>
  );
}

/** Which job the messages are for: none, one on the tracker, or the one a job's page opened this for. */
function JobPicker({ jobId, state, resumeJob, onPick }: { jobId: string | null; state: JobState; resumeJob: string; onPick: (id: string | null) => void }) {
  const { job, entries, loading, gone, failed, retry } = state;
  const tracked = [...entries].sort((a, b) => b.status_at.localeCompare(a.status_at));
  const onTracker = Boolean(jobId && tracked.some((e) => e.listing_id === jobId));
  return (
    <>
      <Field label="For a job" htmlFor="outreach-job">
        <Select id="outreach-job" value={jobId ?? ""} onChange={(e) => onPick(e.target.value || null)}>
          <option value="">{resumeJob ? "The job post saved with this resume" : "No job in particular"}</option>
          {jobId && !onTracker && (
            <option value={jobId}>{job ? `${job.title} · ${job.company}` : loading ? "Opening the job…" : "A job that isn't listed any more"}</option>
          )}
          {tracked.length > 0 && (
            <optgroup label="On your tracker">
              {tracked.map((e) => (
                <option key={e.id} value={e.listing_id}>
                  {e.title} · {e.company}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      </Field>

      {job ? (
        <div className="mt-3 rounded-xl bg-zinc-500/[0.06] p-3 dark:bg-white/[0.03]">
          <p className="font-medium leading-snug">{job.title}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
            <Building2 className="h-3 w-3 shrink-0 text-zinc-400" aria-hidden />
            <span className="truncate">
              {job.company}
              {job.place ? ` · ${job.place}` : ""}
            </span>
          </p>
          {job.status && <span className={cx("mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1", STATUS_TONE[job.status])}>{STATUS_LABEL[job.status]}</span>}
          {job.asks.length > 0 && (
            <>
              <p className="mt-2.5 text-xs text-zinc-500 dark:text-zinc-400">It asks for</p>
              <ul className="mt-1 flex flex-wrap gap-1" aria-label="What the job asks for">
                {job.asks.map((s) => (
                  <li key={s} className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-900 ring-1 ring-indigo-500/20 dark:text-indigo-200">
                    {s}
                  </li>
                ))}
              </ul>
            </>
          )}
          {job.live ? (
            <Link to={jobPath(job.id)} className={cx(textLink, "mt-2.5 inline-flex items-center gap-0.5 text-xs")}>
              Open the job <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
          ) : (
            <p className="mt-2.5 text-xs text-zinc-500 dark:text-zinc-400">The post has left the feed, so the message uses the role and company from your tracker.</p>
          )}
        </div>
      ) : loading ? (
        <div className="mt-3">
          <Spinner label="Opening the job" />
        </div>
      ) : failed ? (
        <div className="mt-3">
          <ErrorNote onRetry={retry}>{errorText(failed)}</ErrorNote>
        </div>
      ) : gone ? (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">This job isn't listed any more. Pick another, or type the company and role yourself.</p>
      ) : null}

      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        {job
          ? "The message names the role and leans on what the post asks for that your resume shows."
          : resumeJob
            ? `Written for the job post saved with this resume: ${resumeJob}.`
            : "Pick one and the message names the role and leans on what the post asks for."}
      </p>
    </>
  );
}

