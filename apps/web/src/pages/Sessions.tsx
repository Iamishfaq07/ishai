import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AudioLines, cx, focusRing, HistoryIcon } from "@orbit/ui";
import { Button, Card, EmptyState, ErrorNote, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { SESSION_TYPE_LABEL, errorText, formatDate, formatDuration } from "../lib/format";
import { useAsync } from "../lib/useAsync";

export function SessionsPage() {
  const sessions = useAsync(() => api.listSessions(), [], "sessions");
  const navigate = useNavigate();
  const [ending, setEnding] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);
  // Unfinished sessions first (resume or end them), then the rest newest first as the server sends them.
  const sorted = [...(sessions.data ?? [])].sort((a, b) => Number(a.status === "ended") - Number(b.status === "ended"));

  // Ending writes the summary report, like pressing End in the session.
  const end = async (id: string) => {
    setEnding(id);
    setEndError(null);
    try {
      await api.endSession(id);
      sessions.reload();
    } catch (err) {
      setEndError(errorText(err));
    } finally {
      setEnding(null);
    }
  };

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
        <EmptyState icon={AudioLines} title="No sessions yet" body="When a session ends, its transcript and summary are saved here. Sessions left open end on their own after an hour." />
      ) : (
        <>
          {endError && (
            <div className="mb-4">
              <ErrorNote>{endError}</ErrorNote>
            </div>
          )}
          <Card className="p-0">
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {sorted.map((s) => {
              const open = s.status !== "ended";
              return (
                <li key={s.id} className="flex items-center gap-2 pr-3">
                  <Link
                    to={open ? `/live/${s.id}` : `/sessions/${s.id}`}
                    className={cx(
                      "grid min-w-0 flex-1 gap-1 px-5 py-4 hover:bg-zinc-900/[0.03] sm:grid-cols-[1fr_auto] dark:hover:bg-white/[0.03]",
                      focusRing,
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {s.title}
                        {open && (
                          <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                            {s.status === "live" ? "Unfinished" : "Not started"}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {SESSION_TYPE_LABEL[s.type]}
                        {s.role ? ` · ${s.role}` : ""}
                      </p>
                    </div>
                    <div className="text-xs text-zinc-500 sm:text-right">
                      <p>{formatDate(s.started_at ?? s.created_at)}</p>
                      <p>
                        {formatDuration(s.duration_seconds)} · {s.question_count} question{s.question_count === 1 ? "" : "s"}
                      </p>
                    </div>
                  </Link>
                  {open && (
                    <span className="flex shrink-0 gap-1">
                      <Button size="sm" onClick={() => navigate(`/live/${s.id}`)}>
                        {s.status === "live" ? "Resume" : "Start"}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={ending === s.id} onClick={() => void end(s.id)}>
                        {ending === s.id ? "Ending…" : "End"}
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          </Card>
        </>
      )}
    </div>
  );
}
