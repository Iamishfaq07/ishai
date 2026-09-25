import { Link, useNavigate } from "react-router-dom";
import type { SessionType } from "@orbit/types";
import {
  ArrowRight,
  ArrowUpRight,
  Briefcase,
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
  cx,
  focusRing,
  type LucideIcon,
} from "@orbit/ui";
import { Button, Card, ErrorNote, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { SESSION_TYPE_LABEL, errorText, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { UsageSummary } from "./Billing";

const QUICK_START: Array<{ type: SessionType; title: string; body: string; icon: LucideIcon }> = [
  { type: "interview", title: "Interview", body: "Live answers grounded in your resume and the JD.", icon: Briefcase },
  { type: "coding", title: "Coding", body: "Screenshot a problem — approach, code, complexity.", icon: Code2 },
  { type: "meeting", title: "Meeting", body: "Stay sharp in professional calls.", icon: Users },
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
  const sessions = useAsync(() => api.listSessions(), []);
  const documents = useAsync(() => api.listDocuments(), []);

  const recent = (sessions.data ?? []).slice(0, 5);
  const readyDocs = (documents.data ?? []).filter((d) => d.status === "ready");
  const firstName = user?.name?.split(" ")[0];

  return (
    <div className="space-y-10">
      <section className="glass-panel gradient-border relative overflow-hidden rounded-3xl">
        <div className="grid items-center gap-2 md:grid-cols-[1.2fr_1fr]">
          <div className="relative z-10 p-6 sm:p-10">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-200">
              <Sparkles className="h-3.5 w-3.5" />
              {greeting()}
              {firstName ? `, ${firstName}` : ""}
            </p>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
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
          </div>
          <div className="relative -mt-4 flex justify-center pb-8 md:mt-0 md:py-8 md:pr-8">
            <PlanetHero className="w-56 motion-safe:animate-float sm:w-72" />
          </div>
        </div>
      </section>

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

      <div className="grid gap-6 lg:grid-cols-3">
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
                        <span className="block text-xs text-zinc-500">
                          {SESSION_TYPE_LABEL[s.type]} · {formatDate(s.started_at ?? s.created_at)}
                        </span>
                      </span>
                      {s.status !== "ended" && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                          Live
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

/** The web app captures a shared browser tab; the desktop app captures whole-system and per-app audio. */
const DESKTOP_DOWNLOAD_URL: string =
  import.meta.env.VITE_DESKTOP_DOWNLOAD_URL ?? "https://github.com/Iamishfaq07/ishai/releases/latest";

function DesktopPromo() {
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
          target="_blank"
          rel="noreferrer"
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
