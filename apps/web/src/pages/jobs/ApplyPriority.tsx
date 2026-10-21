import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { JobTrackerEntry, Resume, ResumeSummary } from "@orbit/types";
import { CompanyLogo, Gauge, Reveal, cx, focusRing, readJSON, safeLocal } from "@orbit/ui";
import { Card, EmptyState, ErrorNote, Input, PageHeader, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useJobsAi } from "./JobsAi";
import { linkButton, textLink } from "./links";
import { JOBS_MATCHES, JOBS_TRACKER, missionPath } from "./paths";
import {
  ADVICE, DEFAULT_WEIGHTS, DIMENSIONS, dealBreakers, freshScore, levelScore, matchScore, scoreJob, yearsOfExperience,
  type Dimension, type Scores, type Weights,
} from "./priority";

const KEY = "orbit.jobs.priority";
const MAX_READ = 15; // saved posts read against the resume per visit
interface Saved { resumeId: string | null; weights: Weights; ratings: Record<string, Scores>; breakers?: string[] }
const isSaved = (v: unknown): v is Saved => typeof v === "object" && v !== null && "weights" in v && "ratings" in v;
const EMPTY: Saved = { resumeId: null, weights: DEFAULT_WEIGHTS, ratings: {} };

const GRADE_TONE = {
  A: "bg-emerald-600 text-white", B: "bg-teal-600 text-white", C: "bg-amber-500 text-zinc-950",
  D: "bg-orange-600 text-white", F: "bg-zinc-500 text-white",
} as const;

/** Each saved post's keywords against one resume (POST /v1/resumes/score: the ATS report, no AI, no credit). */
function useMatches(resume: Resume | null, jobs: JobTrackerEntry[]) {
  const [found, setFound] = useState<Record<string, { matched: number; missing: number; top: string[]; text: string }>>({});
  const [reading, setReading] = useState(0);
  const todo = useMemo(() => jobs.filter((j) => j.document_id).slice(0, MAX_READ), [jobs]);
  useEffect(() => {
    if (!resume || !todo.length) return;
    const ctl = new AbortController();
    setFound({}); setReading(todo.length);
    let next = 0;
    const worker = async () => {
      while (next < todo.length && !ctl.signal.aborted) {
        const job = todo[next++]!;
        try {
          const doc = await api.getDocumentText(job.document_id!);
          const report = await api.scoreResume(resume.data, resume.design, doc.text, { signal: ctl.signal });
          if (!ctl.signal.aborted) {
            const k = report.keywords ?? { matched: [], missing: [] };
            setFound((f) => ({ ...f, [job.id]: { matched: k.matched.length, missing: k.missing.length, top: k.missing.slice(0, 4), text: doc.text.slice(0, 20000) } }));
          }
        } catch { /* a post that can't be read keeps "not known" */ }
        if (!ctl.signal.aborted) setReading((n) => n - 1);
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => ctl.abort();
  }, [resume, todo]);
  return { found, reading };
}

/**
 * Jobs → Apply priority: every saved job scored 1.0–5.0 and graded A–F on what matters to the candidate, so the
 * week's applications start at the top. Resume match, level and freshness are read from records; the rest the
 * candidate rates. Ratings and weights stay on this device.
 */
export function ApplyPriorityPage() {
  const { tracker } = useJobsAi();
  const [saved, setSaved] = useState<Saved>(() => ({ ...EMPTY, ...readJSON(safeLocal, KEY, EMPTY, isSaved) }));
  const update = (next: Saved) => { setSaved(next); safeLocal.setItem(KEY, JSON.stringify(next)); };
  const weights = useMemo(() => ({ ...DEFAULT_WEIGHTS, ...saved.weights }), [saved.weights]);

  const resumes = useAsync<ResumeSummary[]>(() => api.listResumes(), [], "resumes");
  const resumeId = saved.resumeId && resumes.data?.some((r) => r.id === saved.resumeId) ? saved.resumeId : resumes.data?.[0]?.id ?? null;
  const resume = useAsync<Resume | null>(() => resumeId ? api.getResume(resumeId) : Promise.resolve(null), [resumeId], `resume|${resumeId ?? ""}`);

  const breakers = useMemo(() => saved.breakers ?? [], [saved.breakers]);
  const [breakerText, setBreakerText] = useState(() => (saved.breakers ?? []).join(", "));
  const jobs = useMemo(() => (tracker.data ?? []).filter((j) => j.status === "saved"), [tracker.data]);
  const { found, reading } = useMatches(resume.data ?? null, jobs);
  const years = useMemo(() => resume.data ? yearsOfExperience(resume.data.data.experience) : null, [resume.data]);

  const ranked = useMemo(() => jobs.map((job) => {
    const m = found[job.id];
    const auto: Scores = { match: m ? matchScore(m.matched, m.missing) : null, level: levelScore(job.title, years), fresh: freshScore(job) };
    const vetoes = dealBreakers(`${job.title} ${job.location} ${m?.text ?? ""}`, breakers);
    const scored = scoreJob(auto, saved.ratings[job.id] ?? {}, weights);
    return { job, gaps: m?.top ?? [], ...scored, grade: vetoes.length ? "F" as const : scored.grade, vetoes, auto };
  }).sort((a, b) => (a.vetoes.length ? 1 : 0) - (b.vetoes.length ? 1 : 0) || b.score - a.score), [jobs, found, years, saved.ratings, weights, breakers]);

  const rate = (jobId: string, d: Dimension, n: number) => {
    const mine = { ...saved.ratings[jobId] };
    if (mine[d] === n) delete mine[d]; else mine[d] = n;
    update({ ...saved, ratings: { ...saved.ratings, [jobId]: mine } });
  };

  if (tracker.error && !tracker.data) return <ErrorNote onRetry={tracker.reload}>{errorText(tracker.error)}</ErrorNote>;
  const header = <PageHeader eyebrow="Applications" icon={Gauge} title="Apply priority"
    subtitle="Every saved job scored on what matters to you, graded A to F, so this week's applications start at the top." />;
  if (tracker.data && !jobs.length) return <>{header}<EmptyState icon={Gauge} title="No saved jobs to rank yet"
    body="Save a few jobs from Discover, or add one you found elsewhere. They'll be scored here."
    action={<Link to={JOBS_MATCHES} className={linkButton()}>Find jobs</Link>} /></>;

  const top = ranked.filter((r) => !r.vetoes.length && (r.grade === "A" || r.grade === "B")).slice(0, 3);
  return <>
    {header}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0 space-y-6">
        {top.length > 0 && <section aria-labelledby="apply-first">
          <h2 id="apply-first" className="font-display text-lg font-semibold">Apply first</h2>
          <Reveal stagger className="mt-3 grid gap-3 sm:grid-cols-3">{top.map((r) => <Link key={r.job.id} to={missionPath(r.job.id)}
            className={cx("workspace-panel group block p-4 motion-safe:transition-transform hover:-translate-y-0.5", focusRing)}>
            <div className="flex items-center justify-between gap-2"><CompanyLogo company={r.job.company} size="sm" />
              <span className={cx("rounded-lg px-2 py-0.5 text-sm font-bold", GRADE_TONE[r.grade])}>{r.grade}</span></div>
            <p className="mt-3 line-clamp-2 font-semibold group-hover:underline">{r.job.title}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{r.job.company}</p>
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400"><span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{r.score.toFixed(1)}</span> / 5 · {ADVICE[r.grade]}</p>
          </Link>)}</Reveal>
        </section>}

        <section aria-labelledby="all-ranked">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="all-ranked" className="font-display text-lg font-semibold">All saved jobs ({ranked.length})</h2>
            {reading > 0 && <p role="status" className="text-xs text-zinc-600 dark:text-zinc-400">Reading {reading} job {reading === 1 ? "post" : "posts"} against your resume…</p>}
          </div>
          <ol className="mt-3 space-y-3">{ranked.map((r, i) => <li key={r.job.id}><details className="workspace-panel group p-4">
            <summary className={cx("flex cursor-pointer list-none items-center gap-3 rounded", focusRing)}>
              <span className="w-5 shrink-0 text-right text-sm tabular-nums text-zinc-500">{i + 1}</span>
              <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-lg text-base font-bold", GRADE_TONE[r.grade])} aria-label={`Grade ${r.grade}`}>{r.grade}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.job.title}</span>
                <span className="block truncate text-sm text-zinc-600 dark:text-zinc-400">{r.job.company}{r.job.location ? ` · ${r.job.location}` : ""}</span></span>
              <span className="shrink-0 text-right"><span className="block font-semibold tabular-nums">{r.score.toFixed(1)}</span>
                <span className={cx("block text-xs", r.vetoes.length ? "font-medium text-rose-700 dark:text-rose-300" : "text-zinc-500")}>{r.vetoes.length ? "deal-breaker" : r.unknown ? `${r.unknown} to rate` : "of 5"}</span></span>
            </summary>
            <div className="mt-4 space-y-3 border-t border-zinc-200 pt-4 dark:border-white/10">
              {r.vetoes.length > 0 && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-800 dark:text-rose-200">Deal-breaker found: {r.vetoes.join(", ")}. Check the post: if it really applies, skip this one.</p>}
              <p className="text-sm">{ADVICE[r.grade]}{r.strongest && ` Strongest on ${r.strongest.label.toLowerCase()}`}{r.weakest && r.weakest.id !== r.strongest?.id && `, weakest on ${r.weakest.label.toLowerCase()}`}.</p>
              {r.gaps.length > 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">The post asks for {r.gaps.join(", ")}, which your resume doesn't show. Add them only if you have them.</p>}
              <ul className="space-y-2">{DIMENSIONS.map((d) => {
                const part = r.parts.find((p) => p.id === d.id)!;
                const auto = r.auto[d.id];
                return <li key={d.id} className="grid items-center gap-2 sm:grid-cols-[11rem_minmax(0,1fr)_auto]">
                  <span className="text-sm"><span className="font-medium">{d.label}</span><span className="block text-xs text-zinc-500">{auto != null ? `From your records: ${auto}` : d.auto ? "Not known yet: rate it" : d.hint}</span></span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10" aria-hidden><div className={cx("h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500", part.known ? "bg-indigo-500" : "bg-zinc-300 dark:bg-white/20")} style={{ width: `${((part.value ?? 3) / 5) * 100}%` }} /></div>
                  <div role="radiogroup" aria-label={`${d.label} for ${r.job.title}`} className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => {
                    const on = saved.ratings[r.job.id]?.[d.id] === n;
                    return <button key={n} type="button" role="radio" aria-checked={on} aria-label={`${n}`} onClick={() => rate(r.job.id, d.id, n)}
                      className={cx("h-8 w-8 rounded-md text-xs font-semibold ring-1 motion-safe:transition-colors", on ? "bg-indigo-600 text-white ring-indigo-600" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5", focusRing)}>{n}</button>;
                  })}</div>
                </li>;
              })}</ul>
              <Link to={missionPath(r.job.id)} className={linkButton("secondary", "sm")}>Open this job</Link>
            </div>
          </details></li>)}</ol>
        </section>
      </div>

      <aside className="space-y-4">
        <Card>
          <h2 className="font-semibold">Resume to compare</h2>
          {resumes.data?.length ? <Select aria-label="Resume to compare" className="mt-2 w-full" value={resumeId ?? ""} onChange={(e) => update({ ...saved, resumeId: e.target.value })}>
            {resumes.data.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</Select>
            : <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Make a resume to score resume match and level. <Link className={textLink} to="/resume-ai">Open Resume Studio</Link></p>}
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{years !== null ? `${years} years of work on this resume.` : "Add dates to your roles to score level fit."} Match uses each job's saved post; jobs without one are rated by you.</p>
        </Card>
        <Card>
          <h2 className="font-semibold">Deal-breakers</h2>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Words that rule a job out, separated with commas. A job whose title, place or saved post mentions one drops to F.</p>
          <Input aria-label="Deal-breakers" className="mt-2" value={breakerText} placeholder="night shift, bond, unpaid, relocation"
            onChange={(e) => setBreakerText(e.target.value)}
            onBlur={() => update({ ...saved, breakers: breakerText.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20) })} />
        </Card>
        <Card>
          <h2 className="font-semibold">How much each thing matters</h2>
          <ul className="mt-3 space-y-2">{DIMENSIONS.map((d) => <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
            <label htmlFor={`w-${d.id}`}>{d.label}</label>
            <Select id={`w-${d.id}`} value={weights[d.id]} onChange={(e) => update({ ...saved, weights: { ...weights, [d.id]: Number(e.target.value) } })}>
              {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 0 ? "Ignore" : n}</option>)}</Select>
          </li>)}</ul>
        </Card>
        <p className="px-1 text-xs text-zinc-600 dark:text-zinc-400">Grades: A from 4.2, B from 3.6, C from 3.0, D from 2.4. Anything not known counts as 3. A way to order your week, not a verdict on any job. Ratings stay on this device. <Link className={textLink} to={JOBS_TRACKER}>Back to the tracker</Link></p>
      </aside>
    </div>
  </>;
}
