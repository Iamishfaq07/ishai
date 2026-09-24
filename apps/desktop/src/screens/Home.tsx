import { useEffect, useState } from "react";
import type { OrbitSession, SessionType, User } from "@orbit/types";
import { Button, Card, cx, focusRing, OrbitLogo, Spinner } from "@orbit/ui";
import { api } from "../api";
import { formatDate, formatDuration, SESSION_TYPE_LABEL } from "../format";
import { TitleBar } from "../TitleBar";

const QUICK_START: Array<{ type: SessionType; title: string; body: string }> = [
  { type: "interview", title: "Interview", body: "Live answers grounded in your resume and the JD." },
  { type: "coding", title: "Coding", body: "Screenshot a problem — approach, code, complexity." },
  { type: "meeting", title: "Meeting", body: "Stay sharp in professional calls." },
];

/** Desktop landing: greeting, quick-start, recent sessions, and navigation to the other screens. */
export function HomeScreen({
  user,
  onNewSession,
  onResume,
  onOpenDocuments,
  onOpenHistory,
  onOpenSettings,
  onSignOut,
}: {
  user: User | null;
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
        <button type="button" onClick={onOpenDocuments} className={navBtn}>
          Documents
        </button>
        <button type="button" onClick={onOpenHistory} className={navBtn}>
          History
        </button>
        <button type="button" onClick={onOpenSettings} className={navBtn}>
          Settings
        </button>
        <button type="button" onClick={onSignOut} className={navBtn}>
          Sign out
        </button>
      </TitleBar>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <section className="relative animate-fade-up overflow-hidden rounded-3xl border border-zinc-200 bg-gradient-to-br from-indigo-500/10 via-transparent to-indigo-500/5 p-6 dark:border-zinc-800">
            <span className="pointer-events-none absolute -right-6 -top-6 opacity-80 motion-safe:animate-float" aria-hidden="true">
              <OrbitLogo size={120} />
            </span>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{firstName ? `Hi ${firstName} —` : "Hi —"} ready when you are.</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Start a live session</h1>
            <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
              Orbit listens through your system or a chosen app, spots the interviewer’s question, and streams a concise
              answer you can glance at while you speak.
            </p>
            <Button size="lg" className="mt-5" onClick={() => onNewSession()}>
              New session
            </Button>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Quick start</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {QUICK_START.map((q) => (
                <button
                  key={q.type}
                  type="button"
                  onClick={() => onNewSession(q.type)}
                  className={cx(
                    "rounded-2xl border border-zinc-200 p-4 text-left transition-colors hover:border-indigo-400/60 hover:bg-indigo-500/5 dark:border-zinc-800",
                    focusRing,
                  )}
                >
                  <p className="font-medium">{q.title}</p>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{q.body}</p>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Recent sessions</h2>
              <button type="button" onClick={onOpenHistory} className={cx("text-sm text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
                View all
              </button>
            </div>
            <Card className="p-0">
              {sessions === null ? (
                <div className="p-5">
                  <Spinner />
                </div>
              ) : recent.length === 0 ? (
                <p className="p-5 text-sm text-zinc-500">No sessions yet. Your transcripts and summaries will appear here.</p>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {recent.map((s) => {
                    const active = s.status !== "ended";
                    return (
                      <li key={s.id} className="flex items-center justify-between gap-4 px-5 py-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {s.title}
                            {active && (
                              <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                {s.status === "live" ? "Live" : "Not started"}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-zinc-500">
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
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}

const navBtn = cx("rounded px-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200", focusRing);
