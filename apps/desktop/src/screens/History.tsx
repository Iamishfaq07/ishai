import { useEffect, useMemo, useState } from "react";
import type { OrbitSession, SessionAnswer, SessionDetail, SessionSummary } from "@orbit/types";
import {
  ArrowLeft,
  Button,
  Card,
  AnswerRatingButtons,
  CodeBlock,
  cx,
  EmptyState,
  ErrorNote,
  focusRing,
  useAnswerRatings,
  Input,
  PageHeader,
  ReportStatusNote,
  SessionReview,
  DeliveryCard,
  FollowUpCard,
  Spinner,
  useReportPolling, confirmDialog } from "@orbit/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { downloadText, errText, formatClock, formatDate, formatDuration, SESSION_TYPE_LABEL } from "../format";
import { TitleBar } from "../TitleBar";

/** How a question reached Orbit, as the History list says it. */
const SOURCE_LABEL: Record<string, string> = {
  auto: "Heard in the call",
  manual: "You asked for an answer",
  chat: "From chat",
  screenshot: "From a screenshot",
};

/** Past sessions: a list, and a detail view with summary / transcript / Q&A. */
export function HistoryScreen({ onBack, onResume, onDrill }: {
  onBack: () => void;
  onResume: (session: OrbitSession) => void;
  /** Opens a new re-drill session (mock, mic only). */
  onDrill: (session: OrbitSession) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <TitleBar title="History">
        <Button variant="ghost" size="sm" onClick={() => (selected ? setSelected(null) : onBack())}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
      </TitleBar>
      <div className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <SessionDetailView id={selected} onDeleted={() => setSelected(null)} onDrill={onDrill} />
        ) : (
          <SessionList onOpen={setSelected} onResume={onResume} />
        )}
      </div>
    </div>
  );
}

function SessionList({ onOpen, onResume }: { onOpen: (id: string) => void; onResume: (session: OrbitSession) => void }) {
  const [sessions, setSessions] = useState<OrbitSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api
      .listSessions()
      .then(setSessions)
      .catch((e) => setError(errText(e)));
  };
  useEffect(load, []);

  return (
    <div>
      <PageHeader title="Sessions" subtitle="Transcripts, detected questions, answers, and summaries from past sessions." />
      {sessions === null ? (
        error ? (
          <ErrorNote onRetry={load}>{error}</ErrorNote>
        ) : (
          <Spinner />
        )
      ) : sessions.length === 0 ? (
        <EmptyState title="No sessions yet" body="When you end a live session, its transcript and summary are saved here." />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-4">
                <button
                  type="button"
                  onClick={() => onOpen(s.id)}
                  className={cx("grid min-w-0 flex-1 gap-1 rounded text-left hover:opacity-80 sm:grid-cols-[1fr_auto]", focusRing)}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {s.title}
                      {s.status !== "ended" && (
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
                  <div className="text-xs text-zinc-500 sm:pr-3 sm:text-right">
                    <p>{formatDate(s.started_at ?? s.created_at)}</p>
                    <p>
                      {formatDuration(s.duration_seconds)} · {s.question_count} question{s.question_count === 1 ? "" : "s"}
                    </p>
                  </div>
                </button>
                {s.status !== "ended" && (
                  <Button size="sm" onClick={() => onResume(s)}>
                    Rejoin
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type Tab = "review" | "summary" | "transcript" | "questions";

function SessionDetailView({ id, onDeleted, onDrill }: {
  id: string;
  onDeleted: () => void;
  onDrill: (session: OrbitSession) => void;
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("review");
  const [actionError, setActionError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    api
      .getSession(id)
      .then(setDetail)
      .catch((e) => setLoadError(errText(e)));
  };
  useEffect(load, [id]);
  useReportPolling(detail?.session.report_status, async () => setDetail(await api.getSession(id)));

  if (detail === null) return loadError ? <ErrorNote onRetry={load}>{loadError}</ErrorNote> : <Spinner />;
  const { session } = detail;

  const exportMd = async () => {
    setActionError(null);
    try {
      const md = await api.exportSessionMarkdown(session.id);
      downloadText(`${session.title.replace(/[^\w-]+/g, "_") || "session"}.md`, md);
    } catch (err) {
      setActionError(errText(err));
    }
  };

  const retryReport = async () => {
    try {
      await api.retryReport(session.id);
      setDetail(await api.getSession(session.id));
    } catch (err) {
      setActionError(errText(err));
    }
  };

  const removeTranscript = async () => {
    if (!(await confirmDialog({ title: "Delete the transcript?", body: "What was said in this session is deleted. The answers and the report are kept.", confirmLabel: "Delete transcript", danger: true }))) return;
    try {
      await api.deleteTranscript(session.id);
      setDetail(await api.getSession(session.id));
    } catch (err) {
      setActionError(errText(err));
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: "Delete this session?", body: "Its transcript, questions, answers and review are deleted. This can’t be undone.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await api.deleteSession(session.id);
      onDeleted();
    } catch (err) {
      setActionError(errText(err));
    }
  };

  return (
    <div>
      <PageHeader
        title={session.title}
        subtitle={`${SESSION_TYPE_LABEL[session.type]}${session.role ? ` · ${session.role}` : ""} · ${formatDate(session.started_at ?? session.created_at)} · ${formatDuration(session.duration_seconds)}`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void exportMd()}>
              Export Markdown
            </Button>
            {detail.turns.length > 0 && (
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
      <div role="tablist" className="mb-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(
          [
            ["review", "Review"],
            ["summary", "Summary"],
            ["transcript", `Transcript (${detail.turns.length})`],
            ["questions", `Questions & answers (${detail.questions.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              tab === key ? "border-indigo-500 text-zinc-900 dark:text-white" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
              focusRing,
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "review" && (
        <div className="space-y-6">
        <SessionReview
          review={detail.summary?.review}
          ended={session.status === "ended"}
          empty={!detail.turns.length && !detail.questions.length}
          onGenerate={async () => {
            await api.reviewSession(session.id);
            setDetail(await api.getSession(session.id));
          }}
          onDrill={async () => onDrill(await api.drillSession(session.id))}
        />
        <DeliveryCard delivery={detail.summary?.delivery} />
        {session.status === "ended" && session.type !== "mock" && (detail.turns.length > 0 || detail.questions.length > 0) && (
          <FollowUpCard
            initial={detail.summary?.follow_up}
            load={(refresh) => api.followUp(session.id, refresh)}
            openLink={(url) => void openUrl(url)}
          />
        )}
        </div>
      )}
      {tab === "summary" && <SummaryView summary={detail.summary} />}
      {tab === "transcript" && <TranscriptTimeline detail={detail} />}
      {tab === "questions" && <QuestionsView detail={detail} />}
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
  if (!summary) return <p className="text-sm text-zinc-500">No summary yet — summaries are generated when a session ends.</p>;
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 text-sm font-semibold">Session summary</h2>
        <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{summary.summary}</p>
        <p className="mt-3 text-xs text-zinc-500">
          {summary.questions_asked.length} questions · {summary.follow_up_count} follow-ups
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
  const [copied, setCopied] = useState(false);
  const turns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? detail.turns.filter((t) => t.text.toLowerCase().includes(q)) : detail.turns;
  }, [detail.turns, query]);

  const copy = async () => {
    const text = detail.turns
      .map((t) => `${formatClock(t.start_ms)} ${t.speaker === "candidate" ? "Candidate" : "Interviewer"}\n${t.text}`)
      .join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (detail.turns.length === 0) return <p className="text-sm text-zinc-500">No transcript was stored for this session.</p>;
  return (
    <div>
      <div className="mb-4 flex gap-2">
        <Input type="search" placeholder="Search transcript…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search transcript" />
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
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
              <span>{SOURCE_LABEL[q.source] ?? "Detected"}</span>
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
                <div className="mt-2 flex items-center justify-end gap-2">
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
