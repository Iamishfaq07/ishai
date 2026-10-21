import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { JobTrackerEntry } from "@orbit/types";
import {
  ArrowRight, BookOpen, Building2, CalendarPlus, ClipboardCheck, Code2, ErrorNote, GraduationCap, Headphones,
  ListChecks, MOCK_INTERVIEW_ENABLED, Mic, NotebookPen, Play, Reveal, ShieldCheck, Sparkles,
  Target, UsersRound, Video, Zap, cx, focusRing,
} from "@orbit/ui";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { linkButton } from "../jobs/links";
import { STATUS_LABEL } from "../jobs/model";
import { missionPath } from "../jobs/paths";
import { StagePill } from "../jobs/StagePill";
import { Stat, Tool, type ToolCard } from "./parts";
import { MoreTools } from "../tools/MoreTools";

const CLOSED = new Set(["hired", "withdrawn", "rejected"]);
const MINUTE = 60_000;

/** The soonest interview still ahead, from jobs marked interviewing with a recorded date. */
export function nextInterview(jobs: JobTrackerEntry[], now: number): JobTrackerEntry | null {
  return jobs.filter((j) => j.status === "interviewing" && j.next_at && Date.parse(j.next_at) > now)
    .sort((a, b) => Date.parse(a.next_at!) - Date.parse(b.next_at!))[0] ?? null;
}

/** "in 2 days 4 h", "in 3 h 20 min", "in 12 min". */
export function countdown(at: string, now: number): string {
  const mins = Math.max(0, Math.round((Date.parse(at) - now) / MINUTE));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d) return `in ${d} day${d === 1 ? "" : "s"}${h ? ` ${h} h` : ""}`;
  if (h) return `in ${h} h${m ? ` ${m} min` : ""}`;
  return `in ${m} min`;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), MINUTE); return () => clearInterval(t); }, []);
  return now;
}

/**
 * Prepare: one place for interview preparation. The next recorded interview with a countdown and its prep steps,
 * every active job with direct links into its prep tabs, and the whole toolkit in view (nothing behind a fold).
 * Numbers are the candidate's own records only.
 */
export function PreparePage() {
  const now = useNow();
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");
  const stories = useAsync(() => api.listStories(), [], "stories");
  const sessions = useAsync(() => api.listSessions(), [], "sessions");
  const jobs = tracker.data?.filter((j) => !CLOSED.has(j.status)) ?? null;
  const next = jobs ? nextInterview(jobs, now) : null;
  const ahead = jobs?.filter((j) => j.status === "interviewing" && j.next_at && Date.parse(j.next_at) > now).length ?? null;
  // Per-job tools open on the next interview's job, else the most recent active one, else the tracker.
  const focus = next ?? jobs?.[0] ?? null;
  const jobTab = (tab: string) => (focus ? `${missionPath(focus.id)}?tab=${tab}` : "/jobs/tracker?add=1");

  const groups: { title: string; about: string; items: ToolCard[] }[] = [
    { title: "Rehearse", about: "Simulated interviews and quick drills, separate from real employer rounds.", items: [
      ...(MOCK_INTERVIEW_ENABLED ? [
        { title: "Mock interview with Saba", detail: "Choose role, format and length; Saba asks, listens and gives feedback.", icon: Headphones, to: "/mock", ai: true },
        { title: "Video interview", detail: "Rehearse on camera with on-device delivery notes: pace, pauses, filler words.", icon: Video, to: "/interview", ai: true },
      ] : []),
      { title: "Quick warm-up", detail: "One question, answered out loud, minutes before you go in.", icon: Zap, to: "/warmup", ai: true },
      { title: "Coding & system design", detail: "Practise problems in an editor and explain your approach to a voice interviewer.", icon: Code2, to: "/code", ai: true },
    ] },
    { title: "Build your answers", about: "Your own material, ready before the questions come.", items: [
      { title: "Tell me about yourself", detail: "30, 60 and 90 second answers from your resume, pointed at this job.", icon: Mic, to: jobTab("practice"), ai: true, perJob: true },
      { title: "Story bank", detail: "Truthful STAR stories from your projects, reused across interviews.", icon: BookOpen, to: "/documents/stories" },
      { title: "Evidence & fit", detail: "Each requirement matched to your experience, with practice for the gaps.", icon: Target, to: jobTab("fit"), ai: true, perJob: true },
      { title: "Learning", detail: "Close a gap without claiming a skill you haven't finished.", icon: GraduationCap, to: "/learn" },
    ] },
    { title: "For a specific interview", about: "Tied to one job, using its post, your resume and your notes.", items: [
      { title: "Prep plan & countdown", detail: "Day-by-day plan to the recorded interview date.", icon: ListChecks, to: jobTab("plan"), perJob: true },
      { title: "Company & people", detail: "How the company interviews, what it asked you before, and who's hiring.", icon: Building2, to: jobTab("company"), perJob: true },
      { title: "Interview debrief", detail: "After a round: questions asked, promises made, what to prepare next.", icon: NotebookPen, to: jobTab("interview"), ai: true, perJob: true },
      { title: "Promises to keep", detail: "What you said you'd send, dated, on Today until done.", icon: ClipboardCheck, to: jobTab("interview"), perJob: true },
      { title: "Prepare your references", detail: "A request and a brief for each reference.", icon: UsersRound, to: jobTab("interview"), ai: true, perJob: true },
      { title: "Import an invitation", detail: "Read a calendar file, pick the job and confirm the time.", icon: CalendarPlus, to: "/jobs?work=updates&input=calendar" },
    ] },
  ];

  return <div className="workspace-page">
    <header className="workspace-heading">
      <div><p className="workspace-eyebrow">Interview preparation</p><h1>Prepare</h1>
        <p className="workspace-description">Your next interview, every job you're preparing for and the full toolkit, in one place.</p></div>
      <div className="flex flex-wrap gap-2">
        <Link to="/jobs?work=updates&input=calendar" className={linkButton("secondary")}><CalendarPlus className="h-4 w-4" aria-hidden /> Import invitation</Link>
        <Link to={MOCK_INTERVIEW_ENABLED ? "/mock" : "/warmup"} className={linkButton("primary")}><Play className="h-4 w-4" aria-hidden /> Start practice</Link>
      </div>
    </header>

    <Reveal stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Interviews ahead" value={ahead} hint="Recorded on jobs marked interviewing" />
      <Stat label="Active jobs" value={jobs ? jobs.length : null} hint="Saved, applied, interviewing or at offer" />
      <Stat label="Stories ready" value={stories.data ? stories.data.length : null} hint="In your story bank" />
      <Stat label="Practice sessions" value={sessions.data ? sessions.data.length : null} hint="Rehearsals and copilot sessions" />
    </Reveal>

    <Reveal as="section" aria-labelledby="up-next" className="workspace-panel workspace-next">
      {tracker.error ? <ErrorNote onRetry={tracker.reload}>Your saved jobs could not load. The toolkit below still works.</ErrorNote>
        : !jobs ? <p role="status" className="text-sm">Loading your interviews…</p>
        : next ? <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-60 motion-safe:animate-ping" /><span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-600" /></span>
              Up next · {countdown(next.next_at!, now)}</p>
            <h2 id="up-next" className="mt-2 font-display text-2xl font-semibold">{next.title} · {next.company}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{new Date(next.next_at!).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}</p>
            <ol className="mt-4 grid gap-2 sm:grid-cols-2">{([
              ["plan", "Follow the prep plan", ListChecks], ["company", "Research the company and people", Building2],
              ["practice", "Rehearse “Tell me about yourself”", Mic], ["practice", "Run a mock round with Saba", Headphones],
            ] as const).map(([tab, label, I], i) => <li key={label}>
              <Link to={`${missionPath(next.id)}?tab=${tab}`} className={cx("group flex min-h-11 items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:border-indigo-400 dark:border-white/10", focusRing)}>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700 dark:bg-white/10 dark:text-zinc-200">{i + 1}</span>
                <I className="h-4 w-4 text-zinc-500" aria-hidden /><span className="flex-1">{label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-zinc-400 motion-safe:transition-transform group-hover:translate-x-0.5" aria-hidden /></Link></li>)}</ol>
          </div>
          <div className="flex flex-col gap-2 lg:w-56">
            <Link to={`${missionPath(next.id)}?tab=plan`} className={linkButton("primary")}>Open interview prep</Link>
            <Link to={`${missionPath(next.id)}?tab=interview`} className={linkButton("secondary")}>Debrief after the round</Link>
          </div>
        </div>
        : <div className="flex flex-wrap items-center justify-between gap-4">
          <div><h2 id="up-next" className="font-display text-xl font-semibold">No interview on your calendar yet</h2>
            <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">When a job is marked interviewing with a date, it shows here with a countdown and its prep steps. Until then, practise for a role or build your stories.</p></div>
          <div className="flex flex-wrap gap-2"><Link to="/jobs?work=updates&input=calendar" className={linkButton("secondary")}>Import invitation</Link><Link to="/jobs/tracker?add=1" className={linkButton("ghost")}>Add an interview</Link></div>
        </div>}
    </Reveal>

    {jobs && jobs.length > 0 && <section aria-labelledby="prep-jobs">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="prep-jobs" className="font-semibold">Prepare for a saved job</h2>
        <Link to="/jobs/tracker" className="text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300">All {jobs.length} in tracker</Link></div>
      <Reveal as="ul" stagger className="mt-3 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-zinc-900">
        {jobs.slice(0, 8).map((j) => <li key={j.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 motion-safe:transition-colors hover:bg-zinc-50 dark:hover:bg-white/5">
          <div className="min-w-0 flex-1"><Link to={`${missionPath(j.id)}?tab=plan`} className={cx("rounded font-semibold hover:underline", focusRing)}>{j.title} · {j.company}</Link>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500"><StagePill status={j.status} />
              {j.next_at && Date.parse(j.next_at) > now ? <span>Next step {countdown(j.next_at, now)}</span> : <span>{STATUS_LABEL[j.status]}</span>}</p></div>
          <nav aria-label={`Prepare for ${j.title}`} className="flex flex-wrap gap-1">{([["plan", "Plan"], ["fit", "Fit"], ["company", "Company"], ["practice", "Practise"], ["interview", "Interview"]] as const).map(([tab, label]) =>
            <Link key={tab} to={`${missionPath(j.id)}?tab=${tab}`} className={cx("inline-flex min-h-9 items-center rounded-lg px-2.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 hover:bg-indigo-50 hover:text-indigo-800 hover:ring-indigo-300 dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-indigo-500/10", focusRing)}>{label}</Link>)}</nav>
        </li>)}
      </Reveal>
    </section>}

    {groups.map((g) => <section key={g.title} aria-labelledby={`grp-${g.title}`}>
      <h2 id={`grp-${g.title}`} className="font-semibold">{g.title}</h2>
      <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{g.about}</p>
      <Reveal as="ul" stagger className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{g.items.map((t) => <li key={t.title}><Tool t={t} /></li>)}</Reveal>
    </section>)}

    <MoreTools home="prepare" shown={[...groups.flatMap((g) => g.items.map((t) => t.to)), "/jobs/tracker", "/prepare"]} />

    <section aria-labelledby="live-help" className="workspace-panel flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><ShieldCheck className="h-4 w-4" aria-hidden /></span>
        <div><h2 id="live-help" className="font-semibold">Live interview copilot</h2>
          <p className="mt-0.5 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">For real conversations only where the employer permits AI assistance. Separate from rehearsal.</p></div></div>
      <div className="flex flex-wrap gap-2"><Link to="/start" className={linkButton("secondary")}><Sparkles className="h-4 w-4" aria-hidden /> Open copilot</Link>
</div>
    </section>
  </div>;
}
