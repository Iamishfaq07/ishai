import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { SessionAnswer, SessionDetail, SessionSummary } from "@orbit/types";
import {
  AnswerRatingButtons,
  CodeBlock,
  DeliveryCard,
  FollowUpCard,
  ReportStatusNote,
  SessionReview,
  cx,
  focusRing,
  useAnswerRatings,
  useReportPolling,
  confirmDialog,
} from "@orbit/ui";
import { Button, Card, ErrorNote, Input, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { SESSION_TYPE_LABEL, downloadText, errorText, formatClock, formatDate, formatDuration } from "../lib/format";
import { SESSION_TYPE_ICON } from "../lib/sessionIcons";
import { useAsync } from "../lib/useAsync";
import type { LiveLaunchState } from "./SessionSetup";

type Tab = "review" | "summary" | "transcript" | "questions";

export function SessionDetailPage() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const detail = useAsync(() => api.getSession(sessionId), [sessionId], `session:${sessionId}`);
  const [tab, setTab] = useState<Tab>("review");
  const [actionError, setActionError] = useState<string | null>(null);
  const { setData } = detail;
  useReportPolling(detail.data?.session.report_status, async () => {
    const fresh = await api.getSession(sessionId);
    setData(() => fresh);
  });

  if (detail.loading && !detail.data) return <Spinner />;
  if (detail.error || !detail.data) {
    return <ErrorNote onRetry={detail.reload}>{errorText(detail.error ?? new Error("Session not found."))}</ErrorNote>;
  }
  const { session } = detail.data;

  const exportMd = async () => {
    setActionError(null);
    try {
      const md = await api.exportSessionMarkdown(session.id);
      downloadText(`${session.title.replace(/[^\w-]+/g, "_") || "session"}.md`, md);
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  const refresh = async () => {
    const fresh = await api.getSession(session.id);
    setData(() => fresh);
  };

  const retryReport = async () => {
    setActionError(null);
    try {
      await api.retryReport(session.id);
      await refresh();
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  const removeTranscript = async () => {
    if (!(await confirmDialog({ title: "Delete the transcript?", body: "What was said in this session is deleted. The answers and the report are kept.", confirmLabel: "Delete transcript", danger: true }))) return;
    try {
      await api.deleteTranscript(session.id);
      await refresh();
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: "Delete this session?", body: "Its transcript, questions, answers and review are deleted. This can’t be undone.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await api.deleteSession(session.id);
      navigate("/sessions", { replace: true });
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  return (
    <div>
      <PageHeader
        title={session.title}
        icon={SESSION_TYPE_ICON[session.type]}
        subtitle={[
          SESSION_TYPE_LABEL[session.type],
          session.role,
          formatDate(session.started_at ?? session.created_at),
          session.duration_seconds ? formatDuration(session.duration_seconds) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void exportMd()}>
              Export Markdown
            </Button>
            {detail.data.turns.length > 0 && (
              <Button variant="secondary" size="sm" onClick={() => void removeTranscript()}>
                Delete transcript
              </Button>
            )}
            <Button variant="danger" size="sm" onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        }
      />
      {actionError && (
        <div className="mb-4">
          <ErrorNote>{actionError}</ErrorNote>
        </div>
      )}

      <ReportStatusNote status={session.report_status} onRetry={() => void retryReport()} />
      <div role="tablist" className="mb-6 flex gap-0 border-b sm:gap-1 border-zinc-200 dark:border-zinc-800">
        {(
          [
            // [id, label, shorter label for phones]
            ["review", "Review", "Review"],
            ["summary", "Summary", "Summary"],
            ["transcript", `Transcript (${detail.data.turns.length})`, "Transcript"],
            ["questions", `Questions & answers (${detail.data.questions.length})`, `Q&A (${detail.data.questions.length})`],
          ] as const
        ).map(([id, label, short]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx(
              "-mb-px whitespace-nowrap border-b-2 px-2 py-2 text-[13px] font-medium sm:px-3 sm:text-sm",
              tab === id ? "border-indigo-500 text-zinc-900 dark:text-white" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
              focusRing,
            )}
          >
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {tab === "review" && (
        <div className="space-y-6">
        <SessionReview
          review={detail.data.summary?.review}
          ended={session.status === "ended"}
          empty={!detail.data.turns.length && !detail.data.questions.length}
          onGenerate={async () => {
            await api.reviewSession(session.id);
            detail.reload();
          }}
          onDrill={async () => {
            const drill = await api.drillSession(session.id);
            const launch: LiveLaunchState = { systemAudio: false };
            navigate(`/live/${drill.id}`, { state: launch });
          }}
          onRetry={async (question) => {
            const drill = await api.drillSession(session.id, question);
            const launch: LiveLaunchState = { systemAudio: false };
            navigate(`/live/${drill.id}`, { state: launch });
          }}
        />
        <DeliveryCard delivery={detail.data.summary?.delivery} />
        {session.status === "ended" && session.type !== "mock" && (detail.data.turns.length > 0 || detail.data.questions.length > 0) && (
          <FollowUpCard initial={detail.data.summary?.follow_up} load={(refresh) => api.followUp(session.id, refresh)} />
        )}
        </div>
      )}
      {tab === "summary" && <SummaryView summary={detail.data.summary} />}
      {tab === "transcript" && <TranscriptTimeline detail={detail.data} />}
      {tab === "questions" && <QuestionsView detail={detail.data} />}
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <ul className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
        {items.map((item, i) => (
          <li key={i}>· {item}</li>
        ))}
      </ul>
    </Card>
  );
}

function SummaryView({ summary }: { summary: SessionSummary | null }) {
  if (!summary) {
    return <p className="text-sm text-zinc-500">No summary yet — summaries are generated when a session ends.</p>;
  }
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 text-sm font-semibold">Session summary</h2>
        <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{summary.summary}</p>
        <p className="mt-3 text-xs text-zinc-500">
          {summary.questions_asked.length} question{summary.questions_asked.length === 1 ? "" : "s"} ·{" "}
          {summary.follow_up_count} follow-up{summary.follow_up_count === 1 ? "" : "s"}
        </p>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <ListBlock title="Questions asked" items={summary.questions_asked} />
        <ListBlock title="Topics covered" items={summary.topics} />
        <ListBlock title="Important follow-ups" items={summary.important_follow_ups} />
        <ListBlock title="Potential weak areas" items={summary.potential_weak_areas} />
        <ListBlock title="Suggested preparation" items={summary.suggested_preparation} />
      </div>
    </div>
  );
}

function TranscriptTimeline({ detail }: { detail: SessionDetail }) {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const turns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? detail.turns.filter((t) => t.text.toLowerCase().includes(q)) : detail.turns;
  }, [detail.turns, query]);

  const copy = async () => {
    const text = detail.turns
      .map((t) => `${formatClock(t.start_ms)} ${t.speaker === "candidate" ? "Candidate" : "Interviewer"}\n${t.text}`)
      .join("\n\n");
    // Refused (no permission) or missing (insecure page): say so rather than fail silently.
    try {
      await navigator.clipboard.writeText(text);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(null), 1500);
  };

  if (detail.turns.length === 0) {
    return <p className="text-sm text-zinc-500">No transcript was stored for this session.</p>;
  }
  return (
    <div>
      <div className="mb-4 flex gap-2">
        <Input type="search" placeholder="Search transcript…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search transcript" />
        <Button variant="secondary" onClick={() => void copy()}>
          {copied === "copied" ? "Copied" : copied === "failed" ? "Couldn’t copy" : "Copy"}
        </Button>
      </div>
      <ol className="space-y-4">
        {turns.map((t) => (
          <li key={t.id} className="grid grid-cols-[4.5rem_1fr] gap-3 text-sm">
            <span className="pt-0.5 font-mono text-xs tabular-nums text-zinc-400">{formatClock(t.start_ms)}</span>
            <div>
              <p
                className={cx(
                  "text-xs font-semibold uppercase tracking-wider",
                  t.speaker === "candidate" ? "text-emerald-600 dark:text-emerald-400" : "text-indigo-600 dark:text-indigo-300",
                )}
              >
                {t.speaker === "candidate" ? "Candidate" : t.speaker === "interviewer" ? "Interviewer" : "Speaker"}
              </p>
              <p className="leading-relaxed text-zinc-800 dark:text-zinc-200">{t.text}</p>
            </div>
          </li>
        ))}
        {turns.length === 0 && <li className="text-sm text-zinc-500">No matches.</li>}
      </ol>
    </div>
  );
}

function QuestionsView({ detail }: { detail: SessionDetail }) {
  const ratings = useAnswerRatings(
    api,
    detail.session.id,
    Object.fromEntries(detail.answers.map((a) => [a.id, a.feedback])),
  );
  const answersByQuestion = useMemo(() => {
    const map = new Map<string, SessionAnswer[]>();
    for (const a of detail.answers) {
      if (!a.question_id) continue;
      map.set(a.question_id, [...(map.get(a.question_id) ?? []), a]);
    }
    return map;
  }, [detail.answers]);

  if (detail.questions.length === 0) return <p className="text-sm text-zinc-500">No questions were detected.</p>;
  return (
    <ol className="space-y-4">
      {detail.questions.map((q) => (
        <li key={q.id}>
          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 font-medium capitalize text-indigo-700 dark:text-indigo-300">
                {q.is_follow_up ? "follow-up" : q.type.replace("_", " ")}
              </span>
              <span>{q.source}</span>
              <span>{formatDate(q.created_at)}</span>
            </div>
            <p className="font-medium">{q.text}</p>
            {(answersByQuestion.get(q.id) ?? []).map((a) => (
              <div key={a.id} className="mt-3 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800">
                {a.content.direct_answer && <p className="whitespace-pre-line">{a.content.direct_answer}</p>}
                <ul className="mt-1 space-y-1 text-zinc-700 dark:text-zinc-300">
                  {a.content.talking_points.map((p, i) => (
                    <li key={i}>· {p}</li>
                  ))}
                </ul>
                {a.content.code && (
                  <div className="mt-2">
                    <CodeBlock code={a.content.code} />
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-zinc-400">
                    {a.first_token_ms !== null && `${a.model ?? "model"} · first token ${Math.round(a.first_token_ms)} ms`}
                  </p>
                  <AnswerRatingButtons value={ratings.get(a.id)} onRate={(r, why) => ratings.rate(a.id, r, why)} />
                </div>
              </div>
            ))}
          </Card>
        </li>
      ))}
    </ol>
  );
}
