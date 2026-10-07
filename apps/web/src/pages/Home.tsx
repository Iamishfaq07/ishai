import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { OrbitDocument, OrbitSession, SessionType } from "@orbit/types";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Briefcase,
  Check,
  ClipboardCheck,
  Code2,
  Download,
  FileText,
  HistoryIcon,
  MOCK_INTERVIEW_ENABLED,
  Monitor,
  Phone,
  PlanetHero,
  Sparkles,
  SpotIllustration,
  Target,
  Users,
  X,
  cx,
  focusRing,
  type LucideIcon,
} from "@orbit/ui";
import { Button, Card, ErrorNote, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { displayAudioHelp, isWindows } from "../lib/audio";
import { useAuth } from "../lib/auth";
import { SESSION_TYPE_LABEL, errorText, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { AiPill } from "../components/products";
import { UsageSummary } from "./Billing";
import { STATUS_LABEL, byStatus } from "./jobs/model";
import { JOBS_AI_HOME, JOBS_TRACKER } from "./jobs/paths";
import { RESUME_AI_HOME, resumePath } from "./resume/paths";
import { scoreTone } from "./resume/product";

const QUICK_START: Array<{ type: SessionType; title: string; body: string; icon: LucideIcon }> = [
  { type: "interview", title: "Interview", body: "Live answers grounded in your resume and the JD.", icon: Briefcase },
  { type: "coding", title: "Coding", body: "Screenshot a problem — approach, code, complexity.", icon: Code2 },
  { type: "meeting", title: "Meeting", body: "Stay sharp in professional calls.", icon: Users },
];

const COPILOT_FEATURES: Array<{ icon: LucideIcon; label: string }> = [
  { icon: AudioLines, label: "Hears the question as it's asked" },
  { icon: FileText, label: "Answers from your resume and the JD" },
  { icon: Code2, label: "Coding help from a screenshot" },
  ...(MOCK_INTERVIEW_ENABLED ? [{ icon: Target, label: "Mock interviews with a scorecard" }] : []),
];

const TYPE_ICON: Record<SessionType, LucideIcon> = {
  interview: Briefcase,
  coding: Code2,
  meeting: Users,
  mock: Target,
  assessment: ClipboardCheck,
  phone: Phone,
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const sessions = useAsync(() => api.listSessions(), [], "sessions");
  const documents = useAsync(() => api.listDocuments(), [], "documents");
  const stories = useAsync(() => api.listStories(), [], "stories");

  const recent = (sessions.data ?? []).slice(0, 5);
  const readyDocs = (documents.data ?? []).filter((d) => d.status === "ready");
  const firstName = user?.name?.split(" ")[0];

  return (
    <div className="space-y-10">
      {/* Orbit's three products: the interview copilot, the larger card, with Resume AI and Jobs AI beside it (under it
          on tablets, side by side; one after another on phones). */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:gap-5">
        <section aria-labelledby="copilot-title" className="glass-panel gradient-border relative overflow-hidden rounded-3xl md:col-span-2 lg:col-span-1 lg:row-span-2">
          {/* In the corner, beside the buttons. Not on phones, so the other products and the setup checklist stay in view. */}
          <PlanetHero className="pointer-events-none absolute bottom-5 right-5 hidden w-24 motion-safe:animate-float md:block xl:bottom-6 xl:right-8 xl:w-32" />
          <div className="flex h-full flex-col justify-center">
            <div className="relative z-10 p-6 sm:p-8 xl:p-10">
              <p className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-200">
                <Sparkles className="h-3.5 w-3.5" />
                {greeting()}
                {firstName ? `, ${firstName}` : ""}
              </p>
              <p className="mt-5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
                <AudioLines className="h-3.5 w-3.5" aria-hidden />
                Interview copilot
              </p>
              <h1 id="copilot-title" className="mt-2 font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
                Your copilot is <span className="text-gradient">in orbit.</span>
              </h1>
              <p className="mt-4 max-w-md text-base text-zinc-600 dark:text-zinc-300">
                Orbit listens, spots the interviewer’s question, and streams a concise answer you can glance at while you
                speak.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button size="lg" onClick={() => navigate("/start")}>
                  Start live session
                  <ArrowRight className="h-4 w-4" />
                </Button>
                {MOCK_INTERVIEW_ENABLED && (
                  <Button size="lg" variant="secondary" onClick={() => navigate("/mock")}>
                    <Target className="h-4 w-4" />
                    Practice a mock
                  </Button>
                )}
              </div>
              {/* What it does, beside the other products' one-liners; room for it once the card is tall (lg). */}
              <ul aria-label="What the interview copilot does" className="mt-7 hidden max-w-lg flex-wrap gap-1.5 sm:flex lg:pr-24 xl:pr-32">
                {COPILOT_FEATURES.map(({ icon: Icon, label }) => (
                  <li
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-500/15 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10"
                  >
                    <Icon className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-300" aria-hidden />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
        <ResumeAiCard />
        <JobsAiCard />
      </div>

      {sessions.data && documents.data && (
        <GettingStarted sessions={sessions.data} documents={documents.data} storyCount={stories.data?.length ?? 0} />
      )}

      <section aria-labelledby="quick-start">
        <h2 id="quick-start" className="mb-4 font-display text-lg font-semibold tracking-tight">
          Quick start
        </h2>
        <div className="stagger grid gap-4 sm:grid-cols-3">
          {QUICK_START.map(({ type, title, body, icon: Icon }) => (
            <Link
              key={type}
              to={`/start?type=${type}`}
              className={cx(
                "glass-panel lift group relative flex flex-col rounded-2xl p-5 hover:border-indigo-400/40 dark:hover:border-indigo-400/30",
                focusRing,
              )}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-glow-sm">
                <Icon className="h-5 w-5" />
              </span>
              <p className="mt-4 font-display text-base font-semibold">{title}</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{body}</p>
              <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-zinc-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-indigo-500" />
            </Link>
          ))}
        </div>
      </section>

      <DesktopPromo />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-display font-semibold">
              <HistoryIcon className="h-4 w-4 text-indigo-500" />
              Recent sessions
            </h2>
            <Link to="/sessions" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">
              View all
            </Link>
          </div>
          {sessions.loading ? (
            <Spinner />
          ) : sessions.error ? (
            <ErrorNote onRetry={sessions.reload}>{errorText(sessions.error)}</ErrorNote>
          ) : recent.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center">
              <SpotIllustration icon={HistoryIcon} size={88} />
              <p className="mt-3 font-medium">No sessions yet</p>
              <p className="mt-1 max-w-xs text-sm text-zinc-500">Your transcripts and summaries will appear here.</p>
            </div>
          ) : (
            <ul className="space-y-1">
              {recent.map((s) => {
                const Icon = TYPE_ICON[s.type];
                return (
                  <li key={s.id}>
                    <Link
                      to={s.status === "ended" ? `/sessions/${s.id}` : `/live/${s.id}`}
                      className={cx(
                        "flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-zinc-900/5 dark:hover:bg-white/5",
                        focusRing,
                      )}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{s.title}</span>
                        <span className="block truncate text-xs text-zinc-500">
                          {SESSION_TYPE_LABEL[s.type]} · {formatDate(s.started_at ?? s.created_at)}
                        </span>
                      </span>
                      {s.status !== "ended" && (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                          {s.status === "live" ? "Unfinished" : "Not started"}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-display font-semibold">
                <FileText className="h-4 w-4 text-indigo-500" />
                Documents
              </h2>
              <Link to="/documents" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                Manage
              </Link>
            </div>
            {documents.loading ? (
              <Spinner />
            ) : documents.error ? (
              // Not "upload your resume": the documents may well be there, the list just didn't load.
              <ErrorNote onRetry={documents.reload}>{errorText(documents.error)}</ErrorNote>
            ) : readyDocs.length === 0 ? (
              <p className="text-sm text-zinc-500">Upload your resume and a job description so answers are grounded in your background.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {readyDocs.slice(0, 5).map((d) => (
                  <li key={d.id} className="flex items-center gap-2 truncate">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-aurora-400" aria-hidden="true" />
                    <span className="truncate">{d.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="mb-3 font-display font-semibold">Usage</h2>
            <UsageSummary />
          </Card>
        </div>
      </div>
    </div>
  );
}

/** One of Orbit's AI products on Home: its name with the AI pill, what it's for in a line, the way in, and `extra`. */
function ProductCard({
  id,
  icon: Icon,
  name,
  title,
  line,
  cta,
  to,
  extra,
}: {
  id: string;
  icon: LucideIcon;
  /** "Resume" for Resume AI: the pill adds "AI". */
  name: string;
  title: string;
  line: string;
  cta: string;
  to: string;
  extra?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <section aria-labelledby={id} className="glass-panel relative flex flex-col overflow-hidden rounded-3xl p-5 sm:p-6">
      <span aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full bg-aurora-400/15 blur-3xl" />
      <div className="relative flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-aurora-500 text-white shadow-glow-sm">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
          {name} <AiPill className="ml-0.5 align-[1px] normal-case tracking-normal" />
        </p>
      </div>
      <h2 id={id} className="relative mt-3 font-display text-xl font-semibold leading-tight tracking-tight">
        {title}
      </h2>
      <p className="relative mt-1.5 text-sm text-zinc-600 dark:text-zinc-300">{line}</p>
      <div className="relative mt-auto flex flex-wrap items-center gap-3 pt-5">
        <Button onClick={() => navigate(to)}>
          {cta}
          <ArrowRight className="h-4 w-4" />
        </Button>
        {extra}
      </div>
    </section>
  );
}

/** Orbit Resume AI on Home: what it does, how your best resume scores, and the way in. */
function ResumeAiCard() {
  const resumes = useAsync(() => api.listResumes(), [], "resumes");
  const list = resumes.data;
  const best = list?.length ? list.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  return (
    <ProductCard
      id="resume-ai-title"
      icon={Sparkles}
      name="Resume"
      title="Build a resume that gets interviews."
      line="ATS score, AI rewrites for every job, and interview prep from your own resume."
      cta={best ? "Open Resume AI" : "Make your resume"}
      to={RESUME_AI_HOME}
      extra={
        best && (
          <Link
            to={resumePath(best.id)}
            className={cx("flex min-w-0 items-center gap-2 rounded-xl py-1 pr-2 text-sm hover:bg-zinc-900/5 dark:hover:bg-white/5", focusRing)}
            aria-label={`${best.title}: ATS score ${best.score} out of 100. Open it`}
          >
            <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-sm font-semibold tabular-nums ring-1", scoreTone(best.score))}>
              {best.score}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">Best ATS score</span>
              <span className="block truncate font-medium">{best.title}</span>
            </span>
          </Link>
        )
      }
    />
  );
}

/** Orbit Jobs AI on Home: what it does, where your applications stand, and the way in. */
function JobsAiCard() {
  // The tracker only: cheap, and Home never asks the job boards for anything.
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");
  const entries = tracker.data ?? [];
  const columns = byStatus(entries);
  const going = (["interviewing", "applied", "offer"] as const).filter((s) => columns[s].length > 0);
  return (
    <ProductCard
      id="jobs-ai-title"
      icon={Briefcase}
      name="Jobs"
      title="Find jobs that fit your resume."
      line="The latest openings from companies' career pages, ranked by how well they match you."
      cta={entries.length ? "Open Jobs AI" : "Find jobs for you"}
      to={JOBS_AI_HOME}
      extra={
        going.length > 0 && (
          <Link
            to={JOBS_TRACKER}
            className={cx("flex min-w-0 items-center gap-2 rounded-xl py-1 pr-2 text-sm hover:bg-zinc-900/5 dark:hover:bg-white/5", focusRing)}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 font-display text-sm font-semibold tabular-nums text-indigo-700 ring-1 ring-indigo-500/25 dark:text-indigo-300">
              {going.reduce((n, s) => n + columns[s].length, 0)}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">Applications</span>
              <span className="block truncate font-medium">
                {going.map((s) => `${columns[s].length} ${STATUS_LABEL[s].toLowerCase()}`).join(" · ")}
              </span>
            </span>
          </Link>
        )
      }
    />
  );
}

const CHECKLIST_KEY = "orbit.checklistDismissed";

/**
 * First-run guide: the four things that make Orbit useful, ticked off from real data. It disappears once they're all
 * done, or for good when dismissed.
 */
function GettingStarted({
  sessions,
  documents,
  storyCount,
}: {
  sessions: OrbitSession[];
  documents: OrbitDocument[];
  storyCount: number;
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(CHECKLIST_KEY) === "1";
    } catch {
      return false;
    }
  });
  const steps = [
    {
      title: "Upload your resume",
      body: "Answers are grounded in your real experience.",
      done: documents.some((d) => d.kind === "resume"),
      to: "/documents",
    },
    {
      title: "Add a job description",
      body: "Orbit tailors answers to the role.",
      done: documents.some((d) => d.kind === "job_description"),
      to: "/documents",
    },
    {
      title: "Add a story",
      body: "A real example for “Tell me about a time…” questions.",
      done: storyCount > 0,
      to: "/documents/stories",
    },
    ...(MOCK_INTERVIEW_ENABLED
      ? [{ title: "Try a practice interview", body: "Orbit asks, you answer out loud.", done: sessions.some((s) => s.type === "mock"), to: "/mock" }]
      : []),
    {
      title: "Run a live session",
      body: "Test your mic and audio before the real thing.",
      done: sessions.some((s) => s.type !== "mock"),
      to: "/start",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (dismissed || doneCount === steps.length) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(CHECKLIST_KEY, "1");
    } catch {
      // storage unavailable — hidden for this visit
    }
  };

  return (
    <section aria-labelledby="getting-started" className="glass-panel rounded-2xl p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 id="getting-started" className="font-display text-lg font-semibold tracking-tight">
            Get set up
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {doneCount} of {steps.length} done — about five minutes to be interview-ready.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide setup checklist"
          title="Hide"
          className={cx("rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/5", focusRing)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-aurora-400 transition-[width] duration-500"
          style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }}
        />
      </div>
      <ol className={cx("mt-4 grid gap-2 sm:grid-cols-2", steps.length > 4 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
        {steps.map((step, i) => (
          <li key={step.title}>
            <Link
              to={step.to}
              className={cx(
                "flex h-full gap-3 rounded-xl p-3 ring-1 transition-colors",
                step.done
                  ? "ring-emerald-500/20 bg-emerald-500/5"
                  : "ring-zinc-200 hover:bg-zinc-900/[0.03] hover:ring-indigo-400/40 dark:ring-white/10 dark:hover:bg-white/[0.03]",
                focusRing,
              )}
            >
              <span
                className={cx(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  step.done ? "bg-emerald-500 text-white" : "bg-indigo-500/15 text-indigo-700 dark:text-indigo-200",
                )}
                aria-hidden="true"
              >
                {step.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cx("block text-sm font-medium", step.done && "text-zinc-500 line-through")}>
                  {step.title}
                  <span className="sr-only">{step.done ? " (done)" : ""}</span>
                </span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{step.body}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The web app captures a shared browser tab; the desktop app captures whole-system and per-app audio. The latest
 * installer, from the free public download site (scripts/publish-download.ps1): GitHub release downloads need a
 * GitHub sign-in while the repo is private. */
const DESKTOP_DOWNLOAD_URL: string =
  import.meta.env.VITE_DESKTOP_DOWNLOAD_URL ?? "https://orbit-downloads.ishfaq.workers.dev/Orbit-Setup.exe";

function DesktopPromo() {
  // The desktop app is Windows-only: elsewhere, say how to get the best capture from the browser instead.
  if (!isWindows()) {
    return (
      <section className="rounded-3xl border border-indigo-500/20 bg-indigo-500/5 p-5 sm:p-6">
        <div className="flex gap-4">
          <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 sm:flex dark:text-indigo-300">
            <Monitor className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold">Hearing the interviewer on this device</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{displayAudioHelp()}</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              The Orbit desktop app (system audio from any call app) is Windows-only for now.
            </p>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-zinc-950 p-6 text-white shadow-glow sm:p-8">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-aurora-400/25 blur-3xl"
      />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex max-w-2xl gap-4">
          <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 sm:flex">
            <Monitor className="h-6 w-6" />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold">Get Orbit for Windows</h2>
            <p className="mt-1 text-sm text-indigo-100">
              You’re on the browser version. The desktop app hears far more — whole-system audio (any call app, not just
              a tab), per-app capture to target one window, plus screenshots and global hotkeys.
            </p>
          </div>
        </div>
        <a
          href={DESKTOP_DOWNLOAD_URL}
          className={cx(
            "btn-sheen inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-indigo-700 shadow-lg hover:bg-indigo-50",
            focusRing,
          )}
        >
          <Download className="h-4 w-4" />
          Download for Windows
        </a>
      </div>
    </section>
  );
}
