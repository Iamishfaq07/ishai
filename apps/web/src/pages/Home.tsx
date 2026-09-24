import { Link, useNavigate } from "react-router-dom";
import type { SessionType } from "@orbit/types";
import { Download, OrbitLogo, cx, focusRing } from "@orbit/ui";
import { Button, Card, ErrorNote, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { SESSION_TYPE_LABEL, errorText, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { UsageSummary } from "./Billing";

const QUICK_START: Array<{ type: SessionType; title: string; body: string }> = [
  { type: "interview", title: "Interview", body: "Live answers grounded in your resume and the JD." },
  { type: "coding", title: "Coding", body: "Screenshot a problem — approach, code, complexity." },
  { type: "meeting", title: "Meeting", body: "Stay sharp in professional calls." },
];

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const sessions = useAsync(() => api.listSessions(), []);
  const documents = useAsync(() => api.listDocuments(), []);

  const recent = (sessions.data ?? []).slice(0, 5);
  const readyDocs = (documents.data ?? []).filter((d) => d.status === "ready");

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-zinc-200 bg-gradient-to-br from-indigo-500/10 via-transparent to-indigo-500/5 p-8 dark:border-zinc-800">
        <span className="pointer-events-none absolute -right-8 -top-8 opacity-80 motion-safe:animate-float" aria-hidden="true">
          <OrbitLogo size={160} />
        </span>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {user?.name ? `Hi ${user.name.split(" ")[0]} —` : "Hi —"} ready when you are.
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Start a live session</h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
          Orbit listens, spots the interviewer’s question, and streams a concise answer you can glance at while you speak.
        </p>
        <Button size="lg" className="mt-6" onClick={() => navigate("/start")}>
          Start Live Session
        </Button>
      </section>

      <DesktopPromo />

      <section aria-labelledby="quick-start">
        <h2 id="quick-start" className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Quick start
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_START.map((q) => (
            <Link
              key={q.type}
              to={q.type === "mock" ? "/mock" : `/start?type=${q.type}`}
              className={cx(
                "rounded-2xl border border-zinc-200 p-4 transition-colors hover:border-indigo-400/60 hover:bg-indigo-500/5 dark:border-zinc-800",
                focusRing,
              )}
            >
              <p className="font-medium">{q.title}</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{q.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Recent sessions</h2>
            <Link to="/sessions" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
              View all
            </Link>
          </div>
          {sessions.loading ? (
            <Spinner />
          ) : sessions.error ? (
            <ErrorNote onRetry={sessions.reload}>{errorText(sessions.error)}</ErrorNote>
          ) : recent.length === 0 ? (
            <p className="text-sm text-zinc-500">No sessions yet. Your transcripts and summaries will appear here.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {recent.map((s) => (
                <li key={s.id}>
                  <Link
                    to={s.status === "ended" ? `/sessions/${s.id}` : `/live/${s.id}`}
                    className={cx("flex items-center justify-between gap-4 py-2.5 hover:text-indigo-600 dark:hover:text-indigo-400", focusRing)}
                  >
                    <span className="truncate font-medium">{s.title}</span>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {SESSION_TYPE_LABEL[s.type]} · {formatDate(s.started_at ?? s.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Documents</h2>
              <Link to="/documents" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
                Manage
              </Link>
            </div>
            {documents.loading ? (
              <Spinner />
            ) : readyDocs.length === 0 ? (
              <p className="text-sm text-zinc-500">Upload your resume and a job description so answers are grounded in your background.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {readyDocs.slice(0, 5).map((d) => (
                  <li key={d.id} className="truncate">
                    {d.title}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold">Usage</h2>
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
    <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 to-indigo-800 p-6 text-white shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold">Get Orbit for Windows</h2>
          <p className="mt-1 text-sm text-indigo-100">
            You’re on the browser version. The desktop app hears far more — whole-system audio (any call
            app, not just a tab), per-app capture to target one window, plus screenshots and global hotkeys.
          </p>
        </div>
        <a
          href={DESKTOP_DOWNLOAD_URL}
          target="_blank"
          rel="noreferrer"
          className={cx(
            "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 shadow hover:bg-indigo-50",
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
