import { Link, useNavigate } from "react-router-dom";
import { AudioLines, cx, focusRing, HistoryIcon } from "@orbit/ui";
import { Button, Card, EmptyState, ErrorNote, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { SESSION_TYPE_LABEL, errorText, formatDate, formatDuration } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export function SessionsPage() {
  const sessions = useAsync(() => api.listSessions(), []);
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader
        icon={HistoryIcon}
        title="Sessions"
        subtitle="Transcripts, detected questions, answers, and summaries from past sessions."
        actions={<Button onClick={() => navigate("/start")}>New session</Button>}
      />
      {sessions.loading ? (
        <Spinner />
      ) : sessions.error ? (
        <ErrorNote onRetry={sessions.reload}>{errorText(sessions.error)}</ErrorNote>
      ) : (sessions.data ?? []).length === 0 ? (
        <EmptyState icon={AudioLines} title="No sessions yet" body="When you end a live session, its transcript and summary are saved here." />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {(sessions.data ?? []).map((s) => (
              <li key={s.id}>
                <Link
                  to={s.status === "ended" ? `/sessions/${s.id}` : `/live/${s.id}`}
                  className={cx("grid gap-1 px-5 py-4 hover:bg-zinc-50 sm:grid-cols-[1fr_auto] dark:hover:bg-zinc-900", focusRing)}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {s.title}
                      {s.status !== "ended" && (
                        <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          {s.status === "live" ? "Live" : "Not started"}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {SESSION_TYPE_LABEL[s.type]}
                      {s.role ? ` · ${s.role}` : ""} · {s.language.toUpperCase()}
                    </p>
                  </div>
                  <div className="text-xs text-zinc-500 sm:text-right">
                    <p>{formatDate(s.started_at ?? s.created_at)}</p>
                    <p>
                      {formatDuration(s.duration_seconds)} · {s.question_count} question{s.question_count === 1 ? "" : "s"}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
