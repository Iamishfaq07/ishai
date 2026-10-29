import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { Entitlements, JobTrackerEntry, OrbitSession, SessionType, User } from "@orbit/types";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowRight,
  ArrowUpRight,
  Button,
  Card,
  ChevronRight,
  CopilotScene,
  CreditCard,
  ShieldCheck,
  Skeleton,
  Spot,
  X,
  buttonClass,
  cx,
  focusRing,
  interviewWhen,
  roundLabel,
  upcomingInterviews,
  wholeMinutes,
  type SpotKind,
} from "@orbit/ui";
import { WEB_URL, api } from "../api";
import { ScorePip, TypeMark } from "../bits";
import { openBilling, useEntitlements } from "../credits";
import { formatDuration, sessionKindLine } from "../format";
import { sessionLine } from "../sessionIcons";
import { TitleBar, type AccountMenuProps, type NavTarget } from "../TitleBar";
import { UpdateBanner } from "../UpdateBanner";
import { WindowPrivacyChoice } from "../WindowPrivacyCard";
import { countPromoVisit, hidePromo, loadPromoState, pickPromo, toolLink, webLink, type WebTool } from "../web";

/** The title bar's places and the account, from App. */
export interface Chrome {
  onNavigate: (to: NavTarget) => void;
  account?: AccountMenuProps;
}

const QUICK_START: Array<{ type: SessionType; title: string; body: string; spot: SpotKind }> = [
  { type: "interview", title: "Interview", body: "Answers from your resume and the job post.", spot: "copilot" },
  { type: "coding", title: "Coding round", body: "The approach, the code and its complexity.", spot: "code" },
  { type: "meeting", title: "Meeting", body: "Stay sharp in professional calls.", spot: "panel" },
  { type: "mock", title: "Mock interview", body: "The AI asks out loud; you practise.", spot: "intro" },
];

/** Each web tool's spot on Home's "More from Orbit" card (KashSec wears its own teal tile instead). */
const PROMO_SPOT: Record<Exclude<WebTool["id"], "kashsec">, SpotKind> = {
  practice: "intro",
  video: "video",
  atlas: "questions",
  resume: "ats",
  jobs: "briefcase",
  linkedin: "contact",
  code: "code",
  offer: "offer",
  learning: "lesson",
};

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/**
 * Home, the desktop dashboard (DESIGN.md "The desktop app"): one clear next step (start a session), the
 * interviews coming up from the Jobs AI tracker, recent sessions with their review scores, what's left to spend,
 * and one of Orbit's web tools at a time ("More from Orbit", D77). The copilot's scene is the view's one scene.
 */
export function HomeScreen({
  user,
  chrome,
  notice,
  hidePromos = false,
  onNewSession,
  onPrepareInterview,
  onResume,
  onOpenHistory,
  onOpenSession,
}: {
  user: User | null;
  chrome: Chrome;
  /** Account notice under the title bar (e.g. verify your email). */
  notice?: ReactNode;
  /** The welcome tour is open over Home: it already shows the web tools. */
  hidePromos?: boolean;
  onNewSession: (type?: SessionType) => void;
  /** Setup, filled in from one of the tracker's interviews. */
  onPrepareInterview: (entry: JobTrackerEntry) => void;
  onResume: (session: OrbitSession) => void;
  onOpenHistory: () => void;
  /** One past session's review (History). */
  onOpenSession: (id: string) => void;
}) {
  const [sessions, setSessions] = useState<OrbitSession[] | null>(null);
  const [sessionsError, setSessionsError] = useState(false);
  const [scores, setScores] = useState<Map<string, number>>(new Map());
  const [upcoming, setUpcoming] = useState<JobTrackerEntry[] | null>(null);
  const plan = useEntitlements();

  const loadSessions = () => {
    setSessionsError(false);
    api
      .listSessions()
      .then(setSessions)
      .catch(() => {
        setSessions([]);
        setSessionsError(true);
      });
    // The review scores live with the progress chart's points (no request per session).
    api
      .progress()
      .then((p) => setScores(new Map(p.points.filter((x) => x.overall_score !== null).map((x) => [x.id, x.overall_score!]))))
      .catch(() => undefined);
  };
  useEffect(loadSessions, []);
  useEffect(() => {
    let gone = false;
    api
      .jobTracker()
      .then((list) => !gone && setUpcoming(upcomingInterviews(list, Date.now(), 14, 3)))
      .catch(() => !gone && setUpcoming([]));
    return () => {
      gone = true;
    };
  }, []);

  const recent = (sessions ?? []).slice(0, 5);
  const firstName = user?.name?.split(" ")[0];

  return (
    <div className="flex h-full flex-col">
      <TitleBar current="home" update={false} {...chrome} />
      {notice}
      {/* Also where "Restart to update" waits after a session, for an update downloaded before it. */}
      <UpdateBanner />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-5 px-5 py-5 sm:px-6">
          <WindowPrivacyChoice />

          <section
            aria-labelledby="home-title"
            className="flex items-center gap-6 rounded-3xl border border-zinc-200 bg-white px-6 py-5 dark:border-white/[0.07] dark:bg-zinc-950"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {greeting()}
                {firstName ? `, ${firstName}` : ""}
              </p>
              <h1 id="home-title" className="mt-1 text-2xl font-semibold tracking-tight">
                Ready for your next interview?
              </h1>
              <p className="mt-1.5 max-w-md text-sm text-zinc-600 dark:text-zinc-300">
                Orbit listens to your call, spots the interviewer’s question, and streams a short answer you can glance
                at while you speak.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button size="lg" onClick={() => onNewSession()}>
                  Start a session
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button size="lg" variant="secondary" onClick={() => onNewSession("mock")}>
                  Practise first
                </Button>
              </div>
            </div>
            <CopilotScene className="hidden w-52 shrink-0 sm:block" />
          </section>

          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17.5rem]">
            <div className="min-w-0 space-y-5">
              <section aria-labelledby="quick-title">
                <h2 id="quick-title" className="mb-2.5 text-sm font-semibold">
                  Quick start
                </h2>
                <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {QUICK_START.map(({ type, title, body, spot }) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => onNewSession(type)}
                      className={cx(
                        "lift group flex flex-col items-start gap-2.5 rounded-2xl border border-zinc-200 bg-white p-3.5 text-left dark:border-white/[0.07] dark:bg-zinc-950",
                        focusRing,
                      )}
                    >
                      <Spot kind={spot} />
                      <span>
                        <span className="block text-sm font-semibold">{title}</span>
                        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{body}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section aria-labelledby="recent-title">
                <div className="mb-2.5 flex items-center justify-between">
                  <h2 id="recent-title" className="text-sm font-semibold">
                    Recent sessions
                  </h2>
                  <button
                    type="button"
                    onClick={onOpenHistory}
                    className={cx("inline-flex items-center gap-0.5 rounded text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}
                  >
                    All sessions
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
                <Card className="p-0">
                  {sessions === null ? (
                    <div className="p-4">
                      <Skeleton variant="line" count={3} label="Loading your sessions" />
                    </div>
                  ) : sessionsError ? (
                    <div className="flex flex-col items-center px-5 py-6 text-center">
                      <p className="text-sm font-medium">Couldn't load your sessions</p>
                      <p className="mt-0.5 text-xs text-zinc-500">Check your internet connection, then try again.</p>
                      <Button variant="secondary" size="sm" className="mt-3" onClick={loadSessions}>
                        Try again
                      </Button>
                    </div>
                  ) : recent.length === 0 ? (
                    <div className="flex items-center gap-3 px-4 py-5">
                      <Spot kind="timeline" />
                      <div>
                        <p className="text-sm font-medium">No sessions yet</p>
                        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                          After a session, its transcript, answers and review score show here.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
                      {recent.map((s) => (
                        <SessionRow key={s.id} session={s} score={scores.get(s.id) ?? null} onOpen={() => onOpenSession(s.id)} onResume={() => onResume(s)} />
                      ))}
                    </ul>
                  )}
                </Card>
              </section>
            </div>

            <aside className="min-w-0 space-y-5" aria-label="Your interviews and account">
              <UpcomingCard entries={upcoming} onPrepare={onPrepareInterview} />
              <MinutesCard plan={plan} />
              {!hidePromos && <MoreFromOrbit />}
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionRow({ session: s, score, onOpen, onResume }: { session: OrbitSession; score: number | null; onOpen: () => void; onResume: () => void }) {
  const active = s.status !== "ended";
  const line = sessionLine([sessionKindLine(s), shortWhen(s.started_at ?? s.created_at), s.duration_seconds ? formatDuration(s.duration_seconds) : null]);
  const body = (
    <>
      <TypeMark type={s.type} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{s.title}</span>
          {active && (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
              {s.status === "live" ? "Unfinished" : "Not started"}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{line}</span>
      </span>
    </>
  );
  if (active) {
    return (
      <li className="flex items-center gap-3 px-4 py-3">
        {body}
        <Button size="sm" onClick={onResume}>
          Rejoin
        </Button>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cx("group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-quick hover:bg-zinc-50 dark:hover:bg-white/[0.03]", focusRing)}
      >
        {body}
        {score !== null ? (
          <ScorePip score={score} />
        ) : (
          <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{s.question_count > 0 ? "Not scored" : "No questions"}</span>
        )}
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-zinc-400 motion-ok:transition-transform motion-ok:group-hover:translate-x-0.5" />
      </button>
    </li>
  );
}

function shortWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? `Today, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The tracker's interviews in the next two weeks, soonest first: each opens Setup with its job post and resume. */
function UpcomingCard({ entries, onPrepare }: { entries: JobTrackerEntry[] | null; onPrepare: (entry: JobTrackerEntry) => void }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <Spot kind="timeline" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Upcoming interviews</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">From your Jobs AI tracker</p>
        </div>
      </div>
      {entries === null ? (
        <Skeleton variant="line" count={2} />
      ) : entries.length === 0 ? (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Nothing booked in the next two weeks. Add an interview date to a job in{" "}
          <button
            type="button"
            onClick={() => void openUrl(webLink(WEB_URL, "/jobs/tracker", "home-upcoming"))}
            className={cx("rounded font-medium text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300", focusRing)}
          >
            Jobs AI
          </button>{" "}
          and it shows here, ready to prepare.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => {
            const date = e.next_at ? new Date(e.next_at) : null;
            const when = [interviewWhen(e.next_at), roundLabel(e.round_type, e.round_number)].filter(Boolean).join(" · ");
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onPrepare(e)}
                  className={cx(
                    "group flex w-full items-center gap-3 rounded-xl border border-zinc-200 p-2.5 text-left transition-colors duration-quick hover:border-zinc-300 hover:bg-zinc-50 active:bg-zinc-100 dark:border-white/[0.08] dark:hover:border-white/20 dark:hover:bg-white/[0.03] dark:active:bg-white/[0.06]",
                    focusRing,
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-zinc-100 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:ring-white/10"
                  >
                    <span className="text-[10px] font-medium leading-none text-zinc-500 dark:text-zinc-400">
                      {date ? date.toLocaleDateString(undefined, { month: "short" }) : "—"}
                    </span>
                    <span className="stat-value text-[15px] font-semibold leading-tight">{date ? date.getDate() : "?"}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{e.company}</span>
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{[e.title, when || "No date yet"].join(" · ")}</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                    Prepare
                    <span className="sr-only"> a session for {e.company}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** What's left to spend, with the way to add more (bought on the website). */
function MinutesCard({ plan }: { plan: Entitlements | null }) {
  const credits = plan?.credits ?? null;
  const left = credits ? wholeMinutes(credits.interview_minutes_left) : null;
  const low = left !== null && left < 10;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2.5">
        <Spot kind="credits" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{credits ? "Interview minutes" : "Your plan"}</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{credits ? "Live and mock sessions both use them" : (plan?.label ?? "Loading…")}</p>
        </div>
      </div>
      {credits && (
        <p className="mt-3 flex items-baseline gap-1.5">
          <span className={cx("stat-value text-2xl font-semibold tracking-tight", low && "text-amber-700 dark:text-amber-300")}>{left}</span>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">min left</span>
          {credits.resume !== null && (
            <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
              {credits.resume} Resume AI credit{credits.resume === 1 ? "" : "s"}
            </span>
          )}
        </p>
      )}
      {credits && left === 0 && credits.welcome_missed && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          The free starter minutes go to one new account per network each month, so this one didn't get them.
        </p>
      )}
      <button type="button" onClick={() => openBilling()} className={cx(buttonClass(low ? "primary" : "secondary", "sm"), "mt-3 w-full")}>
        <CreditCard className="h-3.5 w-3.5" aria-hidden />
        {credits ? (low ? "Buy minutes" : "Buy more minutes") : "Plan & billing"}
        <ArrowUpRight className="h-3 w-3 opacity-70" aria-hidden />
      </button>
    </Card>
  );
}

/**
 * "More from Orbit": one of Orbit's own web tools per visit, taking turns (web.ts pickPromo), with a way to hide
 * each for good. Never another company's product, never in a session, never more than one in a view (D77).
 */
function MoreFromOrbit() {
  const [state] = useState(loadPromoState);
  const [hidden, setHidden] = useState(state.hidden);
  // Counted once per visit to Home, so the next visit shows the next tool.
  useEffect(() => countPromoVisit(state.seen), [state.seen]);
  const tool = useMemo(() => pickPromo(state.seen, hidden), [state.seen, hidden]);
  if (!tool) return null;
  const kashsec = tool.id === "kashsec";
  return (
    <Card className={cx("relative p-4", kashsec && "!border-teal-600/30 dark:!border-teal-400/25")}>
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{kashsec ? "Free from the Orbit team" : "More from Orbit"}</p>
      <button
        type="button"
        onClick={() => {
          hidePromo(tool.id);
          setHidden(new Set([...hidden, tool.id]));
        }}
        aria-label={`Don't show ${tool.name} here again`}
        title="Don't show this again"
        className={cx(
          "absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200",
          focusRing,
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="mt-2.5 flex items-start gap-3">
        {tool.id === "kashsec" ? (
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-600/20 dark:bg-teal-400/10 dark:text-teal-300 dark:ring-teal-300/20"
          >
            <ShieldCheck className="h-6 w-6" />
          </span>
        ) : (
          <Spot kind={PROMO_SPOT[tool.id]} size="lg" />
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{tool.name}</h2>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{tool.line}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void openUrl(toolLink(WEB_URL, tool, "home-promo"))}
        className={cx(
          "mt-3 inline-flex items-center gap-1 rounded text-sm font-medium hover:underline",
          kashsec ? "text-teal-700 dark:text-teal-300" : "text-indigo-700 dark:text-indigo-300",
          focusRing,
        )}
      >
        {tool.action}
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">(opens in your browser)</span>
      </button>
    </Card>
  );
}
