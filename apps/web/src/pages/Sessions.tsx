import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SessionType } from "@orbit/types";
import { Badge, ChevronRight, Clock, CosmicEmptyState, LoadGate, confirmDialog, cx, focusRing, HistoryIcon, MessageCircle, sessionLanguageLabel } from "@orbit/ui";
import { Button, Card, ErrorNote, PageHeader } from "../components/ui";
import { PRODUCTS } from "../components/products";
import { api } from "../lib/api";
import { errorText, formatDate, formatDuration, sessionKindLine } from "../lib/format";
import { SESSION_TYPE_ICON } from "../lib/sessionIcons";
import { useAsync } from "../lib/useAsync";

export function SessionsPage() {
  const sessions = useAsync(() => api.listSessions(), [], "sessions");
  const navigate = useNavigate();
  const [ending, setEnding] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);
  // Unfinished sessions first (resume or end them), then the rest newest first as the server sends them.
  const sorted = [...(sessions.data ?? [])].sort((a, b) => Number(a.status === "ended") - Number(b.status === "ended"));

  // Ending writes the summary report, like pressing End in the session. It can't be undone, so ask first (as Live does).
  const end = async (id: string) => {
    if (
      !(await confirmDialog({
        title: "End this session?",
        body: "It can't be resumed afterwards. The transcript and report are saved to History.",
        confirmLabel: "End session",
        danger: true,
      }))
    )
      return;
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
      />
      <LoadGate loading={sessions.loading && !sessions.data} variant="session-row" count={4} label="Loading sessions">
      {sessions.error ? (
        <ErrorNote onRetry={sessions.reload}>{errorText(sessions.error)}</ErrorNote>
      ) : (sessions.data ?? []).length === 0 ? (
        <CosmicEmptyState variant="copilot" title="No sessions yet" body="When a session ends, its transcript and summary are saved here. Sessions left open end on their own after an hour." />
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
                      "group flex min-w-0 flex-1 items-center gap-3.5 px-4 py-3.5 hover:bg-zinc-900/[0.03] sm:px-5 dark:hover:bg-white/[0.03]",
                      focusRing,
                    )}
                  >
                    <TypeMark type={s.type} />
                    <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {s.title}
                          {open && (
                            <Badge tone="warning" className="ml-2">
                              {s.status === "live" ? "Unfinished" : "Not started"}
                            </Badge>
                          )}
                        </p>
                        <p className="truncate text-xs text-zinc-500">
                          {sessionKindLine(s)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 sm:justify-end">
                        <span>{formatDate(s.started_at ?? s.created_at)}</span>
                        {s.duration_seconds ? (
                          <Badge className="tabular-nums">
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            {formatDuration(s.duration_seconds)}
                          </Badge>
                        ) : null}
                        {sessionLanguageLabel(s.language, s.answer_language) && (
                          <Badge>{sessionLanguageLabel(s.language, s.answer_language)}</Badge>
                        )}
                        <Badge className="tabular-nums">
                          <MessageCircle className="h-3 w-3" aria-hidden="true" />
                          {s.question_count} question{s.question_count === 1 ? "" : "s"}
                        </Badge>
                      </div>
                    </div>
                    {!open && (
                      <ChevronRight
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-zinc-400 motion-ok:transition-transform motion-ok:group-hover:translate-x-0.5"
                      />
                    )}
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
      </LoadGate>
    </div>
  );
}

/** A session's type as a small icon tile: mock interviews in Practice's orange, the rest in the copilot's colour. */
function TypeMark({ type }: { type: SessionType }) {
  const Icon = SESSION_TYPE_ICON[type];
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1",
        type === "mock" ? PRODUCTS.practice.tile : PRODUCTS.interview.tile,
      )}
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}
