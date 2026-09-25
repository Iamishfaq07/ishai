import { type ReactNode, useEffect, useState } from "react";
import type { OrbitSession, SessionType, User } from "@orbit/types";
import {
  ArrowRight,
  Briefcase,
  ClipboardCheck,
  Code2,
  FolderOpen,
  HistoryIcon,
  LogOut,
  Phone,
  PlanetHero,
  SettingsIcon,
  Sparkles,
  Spinner,
  SpotIllustration,
  Target,
  Users,
  Button,
  cx,
  focusRing,
  type LucideIcon,
} from "@orbit/ui";
import { api } from "../api";
import { formatDate, formatDuration, SESSION_TYPE_LABEL } from "../format";
import { TitleBar, TitleBarButton } from "../TitleBar";

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

/** Desktop landing: greeting, quick-start, recent sessions, and navigation to the other screens. */
export function HomeScreen({
  user,
  notice,
  onNewSession,
  onResume,
  onOpenDocuments,
  onOpenHistory,
  onOpenSettings,
  onSignOut,
}: {
  user: User | null;
  /** Account notice under the title bar (e.g. verify your email). */
  notice?: ReactNode;
  onNewSession: (type?: SessionType) => void;
  onResume: (session: OrbitSession) => void;
  onOpenDocuments: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const [sessions, setSessions] = useState<OrbitSession[] | null>(null);

  useEffect(() => {
    api
      .listSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  const recent = (sessions ?? []).slice(0, 5);
  const firstName = user?.name?.split(" ")[0];

  return (
    <div className="flex h-full flex-col">
      <TitleBar>
        <TitleBarButton icon={FolderOpen} label="Documents" onClick={onOpenDocuments} />
        <TitleBarButton icon={HistoryIcon} label="History" onClick={onOpenHistory} />
        <TitleBarButton icon={SettingsIcon} label="Settings" onClick={onOpenSettings} />
        <TitleBarButton icon={LogOut} label="Sign out" onClick={onSignOut} />
      </TitleBar>
      {notice}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <section className="glass-panel gradient-border relative animate-fade-up overflow-hidden rounded-3xl p-5 sm:p-7">
            <PlanetHero className="pointer-events-none absolute -right-10 -top-8 w-40 opacity-90 motion-safe:animate-float sm:-right-4 sm:w-56" />
            <p className="relative inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-200">
              <Sparkles className="h-3 w-3" />
              {firstName ? `Hi ${firstName}` : "Hi there"}
            </p>
            <h1 className="relative mt-3 max-w-[14rem] font-display text-2xl font-semibold leading-tight tracking-tight sm:max-w-md sm:text-3xl">
              Ready when <span className="text-gradient">you are.</span>
            </h1>
            <p className="relative mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-300">
              Orbit listens through your system or a chosen app, spots the interviewer’s question, and streams a concise
              answer you can glance at while you speak.
            </p>
            <Button size="lg" className="relative mt-5" onClick={() => onNewSession()}>
              New session
              <ArrowRight className="h-4 w-4" />
            </Button>
          </section>

          <section>
            <h2 className="mb-3 font-display text-sm font-semibold tracking-tight">Quick start</h2>
            <div className="stagger grid gap-3 sm:grid-cols-3">
              {QUICK_START.map(({ type, title, body, icon: Icon }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => onNewSession(type)}
                  className={cx(
                    "glass-panel lift flex items-start gap-3 rounded-2xl p-3.5 text-left hover:border-indigo-400/40 sm:flex-col sm:p-4",
                    focusRing,
                  )}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-glow-sm">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block font-display font-semibold">{title}</span>
                    <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{body}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold tracking-tight">Recent sessions</h2>
              <button type="button" onClick={onOpenHistory} className={cx("text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300", focusRing)}>
                View all
              </button>
            </div>
            <div className="glass-panel rounded-2xl">
              {sessions === null ? (
                <div className="p-5">
                  <Spinner />
                </div>
              ) : recent.length === 0 ? (
                <div className="flex flex-col items-center px-5 py-6 text-center">
                  <SpotIllustration icon={HistoryIcon} size={72} />
                  <p className="mt-2 text-sm font-medium">No sessions yet</p>
                  <p className="mt-0.5 text-xs text-zinc-500">Your transcripts and summaries will appear here.</p>
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                  {recent.map((s) => {
                    const active = s.status !== "ended";
                    const Icon = TYPE_ICON[s.type];
                    return (
                      <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {s.title}
                            {active && (
                              <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                {s.status === "live" ? "Unfinished" : "Not started"}
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-zinc-500">
                            {SESSION_TYPE_LABEL[s.type]} · {formatDate(s.started_at ?? s.created_at)} · {formatDuration(s.duration_seconds)}
                          </p>
                        </div>
                        {active ? (
                          <Button size="sm" onClick={() => onResume(s)}>
                            Rejoin
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={onOpenHistory}>
                            Open
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
