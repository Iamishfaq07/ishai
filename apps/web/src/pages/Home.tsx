import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { OrbitSession, SessionType } from "@orbit/types";
import {
  ArrowRight,
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Code2,
  Download,
  HistoryIcon,
  MOCK_INTERVIEW_ENABLED,
  Monitor,
  Phone,
  Target,
  Users,
  X,
  cx,
  focusRing,
  type LucideIcon,
} from "@orbit/ui";
import { Card, ErrorNote, Spinner } from "../components/ui";
import { PRODUCTS, ProductMark, type ProductId } from "../components/products";
import { api } from "../lib/api";
import { displayAudioHelp, isWindows } from "../lib/audio";
import { useAuth } from "../lib/auth";
import { DESKTOP_DOWNLOAD_URL } from "../lib/desktop";
import { SESSION_TYPE_LABEL, errorText, formatDate } from "../lib/format";
import { checklist, loadAnswers, nextSteps, type ChecklistItem, type HomeFacts, type Step } from "../lib/onboarding";
import { openHelp } from "../lib/shell";
import { useAsync, type AsyncState } from "../lib/useAsync";
import { UsageSummary } from "./Billing";
import { FollowUps } from "./jobs/FollowUps";
import { STATUS_LABEL, byStatus } from "./jobs/model";
import { JOBS_AI_HOME, JOBS_MATCHES, JOBS_TRACKER } from "./jobs/paths";
import { RESUME_AI_HOME, resumePath } from "./resume/paths";
import { scoreTone } from "./resume/product";

const TYPE_ICON: Record<SessionType, LucideIcon> = {
  interview: Briefcase,
  coding: Code2,
  meeting: Users,
  mock: Target,
  assessment: ClipboardCheck,
  phone: Phone,
};

// TODO(ws-a): buttonClass("primary") / buttonClass("secondary") once the design layer exports it.
const primaryLink = cx(
  "btn-sheen inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-indigo-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-glow-sm hover:from-indigo-400 hover:to-indigo-500 hover:shadow-glow",
  focusRing,
);
const secondaryLink = cx(
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white/90 px-3.5 py-2 text-sm font-medium text-zinc-900 hover:border-zinc-300 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:border-white/20 dark:hover:bg-white/10",
  focusRing,
);

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/**
 * Home: one "Your next step" first, picked from the welcome answers and what the account already has
 * (lib/onboarding.ts), then anything due on the tracker, the set-up checklist, a row per product, and the rest.
 * On a phone, the first screen is the next step.
 */
export function HomePage() {
  const { user } = useAuth();
  const location = useLocation();
  const welcomed = Boolean((location.state as { welcomed?: boolean } | null)?.welcomed);
  const sessions = useAsync(() => api.listSessions(), [], "sessions");
  const documents = useAsync(() => api.listDocuments(), [], "documents");
  const stories = useAsync(() => api.listStories(), [], "stories");
  const resumes = useAsync(() => api.listResumes(), [], "resumes");
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");
  const profile = useAsync(() => api.jobProfile(), [], "job-profile");
  const answers = useMemo(() => (user ? loadAnswers(user.id) : null), [user]);

  // Ready once the lists that decide the next step have answered. A list that failed counts as "has it", so Home never
  // asks for a resume the account may well have; its own card says it didn't load.
  const settled = [sessions, documents, resumes, tracker, profile].every((s) => s.data !== null || s.error !== null);
  const facts = useMemo((): HomeFacts | null => {
    if (!settled) return null;
    const list = resumes.data ?? [];
    const best = list.length ? list.reduce((a, b) => (b.score > a.score ? b : a)) : null;
    const all = sessions.data ?? [];
    return {
      resumes: resumes.error ? 1 : list.length,
      bestResume: best ? { id: best.id, score: best.score } : null,
      resumeDocs: documents.error ? 1 : (documents.data ?? []).filter((d) => d.kind === "resume").length,
      mocks: sessions.error ? 1 : all.filter((s) => s.type === "mock").length,
      lives: sessions.error ? 1 : all.filter((s) => s.type !== "mock").length,
      stories: stories.error ? 1 : (stories.data?.length ?? 0),
      jobProfileSaved: profile.error ? true : Boolean(profile.data?.saved),
      tracker: tracker.data ?? [],
      mockEnabled: MOCK_INTERVIEW_ENABLED,
    };
  }, [settled, resumes.data, resumes.error, documents.data, documents.error, sessions.data, sessions.error, stories.data, stories.error, profile.data, profile.error, tracker.data]);

  const steps = facts ? nextSteps(answers, facts) : null;
  const firstName = user?.name?.split(" ")[0];
  const isNew = facts !== null && facts.resumes + facts.resumeDocs + facts.mocks + facts.lives + facts.tracker.length === 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </h1>
      </div>

      <NextStep steps={steps} welcomed={welcomed} askWelcome={!answers && isNew} />

      <FollowUps hideWhenEmpty />

      {facts && <SetUp items={checklist(answers, facts)} />}

      <section aria-labelledby="products-title">
        <h2 id="products-title" className="mb-3 font-display text-lg font-semibold tracking-tight">
          Your tools
        </h2>
        <div className="glass-panel divide-y divide-zinc-200/70 overflow-hidden rounded-2xl dark:divide-white/5">
          <InterviewRow sessions={sessions.data} />
          <ResumeRow />
          <JobsRow />
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-3">
        <RecentSessions sessions={sessions} />
        <Card className={cx(!sessions.data?.length && "lg:col-span-3")}>
          <h2 className="mb-3 font-display font-semibold">Usage</h2>
          <UsageSummary />
        </Card>
      </div>

      <DesktopPromo />

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Stuck on something?{" "}
        <button type="button" onClick={openHelp} className={cx("font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300", focusRing)}>
          Get help
        </button>{" "}
        or press <kbd className="rounded border border-zinc-300 px-1 font-sans text-xs dark:border-white/15">/</kbd> to search.
      </p>
    </div>
  );
}

/** The one thing to do now, big, with the two after it as quiet links. */
function NextStep({ steps, welcomed, askWelcome }: { steps: Step[] | null; welcomed: boolean; askWelcome: boolean }) {
  if (steps === null) {
    // TODO(ws-a): the Skeleton primitive (delayed, minimum time) instead of this placeholder block.
    return <div aria-hidden="true" className="glass-panel h-56 animate-pulse rounded-3xl motion-reduce:animate-none" />;
  }
  const [step, ...rest] = steps;
  if (!step) return <AllSet />;
  const { name } = PRODUCTS[step.product];
  return (
    <section aria-labelledby="next-step-title" className="glass-panel gradient-border relative overflow-hidden rounded-3xl">
      <span aria-hidden="true" className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-aurora-400/15 blur-3xl" />
      <div className="relative p-5 sm:p-8">
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{welcomed ? "From your answers, start here" : "Your next step"}</p>
        <div className="mt-3 flex items-start gap-4">
          <ProductMark product={step.product} size="lg" className="hidden sm:flex" />
          <div className="min-w-0 flex-1">
            <p className={cx("flex items-center gap-1.5 text-sm font-medium", PRODUCTS[step.product].text)}>
              <ProductMark product={step.product} size="sm" className="sm:hidden" />
              {name}
            </p>
            <h2 id="next-step-title" className="mt-1 text-balance font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {step.title}
            </h2>
            <p className="mt-2 max-w-2xl text-base text-zinc-600 dark:text-zinc-300">{step.body}</p>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
              <Link to={step.to} className={primaryLink}>
                {step.cta}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              {step.time && (
                <span className="inline-flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                  <Clock className="h-4 w-4" aria-hidden /> {step.time}
                </span>
              )}
            </div>
          </div>
        </div>
        {(rest.length > 0 || askWelcome) && (
          <div className="mt-6 border-t border-zinc-200/70 pt-4 dark:border-white/10">
            {rest.length > 0 && (
              <>
                <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">After that</h3>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2 sm:gap-2">
                  {rest.slice(0, 2).map((s) => (
                    <li key={s.id}>
                      <Link
                        to={s.to}
                        className={cx("flex min-h-11 items-center gap-3 rounded-xl px-2 py-2 hover:bg-zinc-900/5 dark:hover:bg-white/5", focusRing)}
                      >
                        <ProductMark product={s.product} size="sm" />
                        <span className="min-w-0 flex-1 text-sm font-medium">{s.title}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {askWelcome && (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                Not what you came for?{" "}
                <Link to="/welcome" className={cx("font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300", focusRing)}>
                  Answer 3 quick questions
                </Link>{" "}
                and Home puts it first.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function AllSet() {
  return (
    <section aria-labelledby="next-step-title" className="glass-panel rounded-3xl p-5 sm:p-8">
      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">You're set up</p>
      <h2 id="next-step-title" className="mt-1 font-display text-2xl font-semibold tracking-tight">
        Everything's ready for your next interview.
      </h2>
      <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-300">
        Practise again before the real thing, or keep your job search moving.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link to={MOCK_INTERVIEW_ENABLED ? "/mock" : "/start"} className={primaryLink}>
          Practise again <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link to={JOBS_MATCHES} className={secondaryLink}>
          See new jobs
        </Link>
      </div>
    </section>
  );
}

const CHECKLIST_KEY = "orbit.checklistDismissed";

/** A ring that fills as steps get done. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" className="h-11 w-11 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="18" cy="18" r={r} fill="none" strokeWidth="4" className="stroke-zinc-200 dark:stroke-white/10" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${(done / total) * c} ${c}`}
        className="stroke-emerald-500 transition-[stroke-dasharray] duration-500 motion-reduce:transition-none"
      />
    </svg>
  );
}

/**
 * "Get set up": five steps across the products after the account, ticked from real data. A list until two are done,
 * then one compact line with the ring (the list a tap away). Gone once all are done, or for good when dismissed.
 */
function SetUp({ items }: { items: ChecklistItem[] }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(CHECKLIST_KEY) === "1";
    } catch {
      return false;
    }
  });
  const real = items.filter((i) => i.id !== "account");
  const realDone = real.filter((i) => i.done).length;
  const [expanded, setExpanded] = useState(false);
  const done = items.filter((i) => i.done).length;
  if (dismissed || done === items.length) return null;
  const compact = realDone >= 2 && !expanded;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(CHECKLIST_KEY, "1");
    } catch {
      // storage unavailable: hidden for this visit
    }
  };

  return (
    <section aria-labelledby="getting-started" className="glass-panel rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <ProgressRing done={done} total={items.length} />
        <div className="min-w-0 flex-1">
          <h2 id="getting-started" className="font-display text-base font-semibold tracking-tight">
            Get set up
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {done} of {items.length} done
          </p>
        </div>
        {realDone >= 2 && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={!compact}
            aria-controls="setup-steps"
            className={cx("inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded-lg px-2.5 text-sm font-medium text-indigo-700 hover:bg-indigo-500/10 dark:text-indigo-300", focusRing)}
          >
            {/* Under 400 px the chevron alone, so the title keeps its line; the words are still read out. */}
            <span className="sr-only min-[400px]:not-sr-only">{compact ? "Show steps" : "Hide steps"}</span>
            <ChevronDown className={cx("h-4 w-4 transition-transform", !compact && "rotate-180")} aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide the set-up checklist"
          title="Hide"
          className={cx("flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/5", focusRing)}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {!compact && (
        <ol id="setup-steps" className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={item.to}
                className={cx(
                  "flex min-h-12 items-center gap-3 rounded-xl px-3 py-2.5 ring-1 transition-colors",
                  item.done
                    ? "bg-emerald-500/5 ring-emerald-600/20 dark:ring-emerald-400/20"
                    : "ring-zinc-200 hover:bg-zinc-900/[0.03] hover:ring-indigo-400/40 dark:ring-white/10 dark:hover:bg-white/[0.03]",
                  focusRing,
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                    item.done ? "bg-emerald-600 text-white" : "ring-2 ring-inset ring-zinc-300 dark:ring-white/20",
                  )}
                >
                  {item.done && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className={cx("min-w-0 flex-1 text-sm font-medium", item.done && "text-zinc-600 dark:text-zinc-400")}>
                  {item.title}
                  <span className="sr-only">{item.done ? " (done)" : ""}</span>
                </span>
                {!item.done && <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** One product on Home: its mark and name, where you are with it in a line, and its way in. */
function ProductRow({ product, status, children }: { product: ProductId; status: ReactNode; children: ReactNode }) {
  const { name } = PRODUCTS[product];
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProductMark product={product} />
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold">{name}</h3>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">{status}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-[3.25rem] sm:pl-0">{children}</div>
    </div>
  );
}

function InterviewRow({ sessions }: { sessions: OrbitSession[] | null }) {
  const ended = (sessions ?? []).filter((s) => s.status === "ended");
  const last = ended[0];
  return (
    <ProductRow
      product="interview"
      status={
        last
          ? `${ended.length} ${ended.length === 1 ? "session" : "sessions"}, the last on ${formatDate(last.started_at ?? last.created_at)}`
          : "Practise out loud with an AI interviewer, or get help during a live call."
      }
    >
      {MOCK_INTERVIEW_ENABLED && (
        <Link to="/mock" className={secondaryLink}>
          <Target className="h-4 w-4 text-indigo-600 dark:text-indigo-300" aria-hidden /> Practise
        </Link>
      )}
      <Link to="/start" className={secondaryLink}>
        Start live session
      </Link>
    </ProductRow>
  );
}

function ResumeRow() {
  const resumes = useAsync(() => api.listResumes(), [], "resumes");
  const list = resumes.data;
  const best = list?.length ? list.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  return (
    <ProductRow
      product="resume"
      status={
        best ? (
          <Link to={resumePath(best.id)} className={cx("inline-flex items-center gap-2 rounded hover:underline", focusRing)}>
            <span className={cx("inline-flex h-6 min-w-8 items-center justify-center rounded-md px-1 text-xs font-semibold tabular-nums ring-1", scoreTone(best.score))}>
              {best.score}
            </span>
            <span className="truncate">ATS score: {best.title}</span>
          </Link>
        ) : (
          "Check how screening software reads your resume, then fix it for each job."
        )
      }
    >
      <Link to={RESUME_AI_HOME} className={secondaryLink}>
        {best ? "Open Resume AI" : "Add my resume"}
      </Link>
    </ProductRow>
  );
}

function JobsRow() {
  // The tracker only: cheap, and Home never asks the job boards for anything.
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");
  const entries = tracker.data ?? [];
  const columns = byStatus(entries);
  const going = (["interviewing", "applied", "offer"] as const).filter((s) => columns[s].length > 0);
  return (
    <ProductRow
      product="jobs"
      status={
        going.length > 0 ? (
          <Link to={JOBS_TRACKER} className={cx("rounded hover:underline", focusRing)}>
            {going.map((s) => `${columns[s].length} ${STATUS_LABEL[s].toLowerCase()}`).join(", ")}
          </Link>
        ) : (
          "New openings from companies' own career pages, matched to you."
        )
      }
    >
      <Link to={entries.length ? JOBS_AI_HOME : JOBS_MATCHES} className={secondaryLink}>
        {entries.length ? "Open Jobs AI" : "See my matches"}
      </Link>
    </ProductRow>
  );
}

function RecentSessions({ sessions }: { sessions: AsyncState<OrbitSession[]> }) {
  const recent = (sessions.data ?? []).slice(0, 5);
  if (!sessions.loading && !sessions.error && recent.length === 0) return null;
  return (
    <Card className="lg:col-span-2">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display font-semibold">
          <HistoryIcon className="h-4 w-4 text-indigo-500" aria-hidden />
          Recent sessions
        </h2>
        <Link to="/sessions" className={cx("rounded text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
          View all
        </Link>
      </div>
      {sessions.loading ? (
        <Spinner />
      ) : sessions.error ? (
        <ErrorNote onRetry={sessions.reload}>{errorText(sessions.error)}</ErrorNote>
      ) : (
        <ul className="space-y-1">
          {recent.map((s) => {
            const Icon = TYPE_ICON[s.type];
            return (
              <li key={s.id}>
                <Link
                  to={s.status === "ended" ? `/sessions/${s.id}` : `/live/${s.id}`}
                  className={cx("flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-zinc-900/5 dark:hover:bg-white/5", focusRing)}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.title}</span>
                    <span className="block truncate text-xs text-zinc-600 dark:text-zinc-400">
                      {SESSION_TYPE_LABEL[s.type]} · {formatDate(s.started_at ?? s.created_at)}
                    </span>
                  </span>
                  {s.status !== "ended" && (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
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
  );
}

function DesktopPromo() {
  // The desktop app is Windows-only: elsewhere, say how to get the best capture from the browser instead, folded
  // away (it matters only once a live session is near).
  if (!isWindows()) {
    return (
      <details className="group rounded-2xl border border-indigo-500/20 bg-indigo-500/5">
        <summary className={cx("flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 [&::-webkit-details-marker]:hidden", focusRing)}>
          <Monitor className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden />
          <span className="flex-1 font-display text-base font-semibold">Hearing the interviewer on this device</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="px-4 pb-4 sm:pl-12">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{displayAudioHelp()}</p>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">The Orbit desktop app (system audio from any call app) is Windows-only for now.</p>
        </div>
      </details>
    );
  }
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-zinc-950 p-6 text-white sm:p-8">
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex max-w-2xl gap-4">
          <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 sm:flex">
            <Monitor className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold">Get Orbit for Windows</h2>
            <p className="mt-1 text-sm text-indigo-100">
              You’re on the browser version. The desktop app hears far more: whole-system audio (any call app, not just
              a tab), per-app capture to target one window, plus screenshots and global hotkeys.
            </p>
          </div>
        </div>
        <a
          href={DESKTOP_DOWNLOAD_URL}
          className={cx(
            "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-indigo-700 shadow-lg hover:bg-indigo-50",
            focusRing,
          )}
        >
          <Download className="h-4 w-4" aria-hidden />
          Download for Windows
        </a>
      </div>
    </section>
  );
}
