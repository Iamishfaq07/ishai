import { useEffect, useMemo, useState } from "react";
import type { OrbitSession, SessionAnswer, SessionDetail, SessionSummary } from "@orbit/types";
import {
  ArrowLeft,
  Button,
  Card,
  AnswerRatingButtons,
  CodeBlock,
  cx,
  CosmicEmptyState,
  ErrorNote,
  focusRing,
  useAnswerRatings,
  Input,
  PageHeader,
  ReportStatusNote,
  SearchInput,
  SegmentedControl,
  SessionReview,
  DebriefStudio,
  DeliveryCard,
  FollowUpCard,
  Skeleton,
  Spinner,
  TabPanel,
  Tabs,
  useReportPolling, confirmDialog, ChevronRight, Clock, MessageCircle, reportLanguageNote, scriptLang,
  sessionLanguageLabel } from "@orbit/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WEB_URL, api } from "../api";
import { ScorePip, TypeMark } from "../bits";
import { downloadText, errText, formatClock, formatDate, formatDuration, SESSION_TYPE_LABEL, sessionKindLine } from "../format";
import { SESSION_TYPE_ICON, sessionLine } from "../sessionIcons";
import { TitleBar } from "../TitleBar";
import { mentorLink } from "../web";
import type { Chrome } from "./Home";

/** How a question reached Orbit, as the History list says it. */
const SOURCE_LABEL: Record<string, string> = {
  auto: "Heard in the call",
  manual: "You asked for an answer",
  chat: "From chat",
  screenshot: "From a screenshot",
};

/** Past sessions: a list (with each review's score), and a detail view with the review, summary, transcript and Q&A. */
export function HistoryScreen({ chrome, onResume, onDrill, initialSessionId }: {
  chrome: Chrome;
  onResume: (session: OrbitSession) => void;
  /** Opens a new re-drill session (mock, mic only). */
  onDrill: (session: OrbitSession) => void;
  /** Open on this session's review (e.g. from a session that just ended). */
  initialSessionId?: string;
}) {
  const [selected, setSelected] = useState<string | null>(initialSessionId ?? null);

  return (
    <div className="flex h-full flex-col">
      <TitleBar current="history" {...chrome} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-5 py-5 sm:px-6">
          {selected ? (
            <>
              <Button variant="ghost" size="sm" className="-ml-2 mb-3" onClick={() => setSelected(null)}>
                <ArrowLeft className="h-3.5 w-3.5" />
                All sessions
              </Button>
              <SessionDetailView id={selected} onDeleted={() => setSelected(null)} onDrill={onDrill} />
            </>
          ) : (
            <SessionList onOpen={setSelected} onResume={onResume} />
          )}
        </div>
      </div>
    </div>
  );
}

type ListFilter = "all" | "copilot" | "practice";

function SessionList({ onOpen, onResume }: { onOpen: (id: string) => void; onResume: (session: OrbitSession) => void }) {
  const [sessions, setSessions] = useState<OrbitSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<Map<string, number>>(new Map());
  const [filter, setFilter] = useState<ListFilter>("all");
  const [query, setQuery] = useState("");

  const load = () => {
    setError(null);
    api
      .listSessions()
      .then(setSessions)
      .catch((e) => setError(errText(e)));
    api
      .progress()
      .then((p) => setScores(new Map(p.points.filter((x) => x.overall_score !== null).map((x) => [x.id, x.overall_score!]))))
      .catch(() => undefined);
  };
  useEffect(load, []);

  const q = query.trim().toLowerCase();
  const shown = (sessions ?? []).filter(
    (s) =>
      (filter === "all" || (filter === "practice") === (s.type === "mock")) &&
      (!q || s.title.toLowerCase().includes(q) || (s.role ?? "").toLowerCase().includes(q) || (s.company ?? "").toLowerCase().includes(q)),
  );
  const scored = (sessions ?? []).filter((s) => scores.has(s.id));
  const average = scored.length ? Math.round((scored.reduce((sum, s) => sum + scores.get(s.id)!, 0) / scored.length) * 10) / 10 : null;

  return (
    <div>
      <PageHeader
        title="History"
        subtitle={
          sessions && sessions.length > 0
            ? `${sessions.length} session${sessions.length === 1 ? "" : "s"}${average !== null ? ` · average review ${average}/5` : ""}. Transcripts, answers and reviews.`
            : "Transcripts, detected questions, answers and reviews from past sessions."
        }
      />
      {sessions === null ? (
        error ? (
          <ErrorNote onRetry={load}>{error}</ErrorNote>
        ) : (
          <Card>
            <Skeleton variant="line" count={5} label="Loading your sessions" />
          </Card>
        )
      ) : sessions.length === 0 ? (
        <CosmicEmptyState variant="copilot" title="No sessions yet" body="When you end a live session, its transcript and summary are saved here." />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              label="Show"
              size="sm"
              options={[
                { value: "all", label: "All" },
                { value: "copilot", label: "Copilot" },
                { value: "practice", label: "Practice" },
              ]}
              value={filter}
              onChange={setFilter}
            />
            <span className="flex-1" />
            <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sessions" aria-label="Search sessions" className="w-56" />
          </div>
          <Card className="p-0">
            {shown.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">No sessions match.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
                {shown.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onOpen(s.id)}
                      className={cx("group flex min-w-0 flex-1 items-center gap-3.5 rounded-lg text-left", focusRing)}
                    >
                      <TypeMark type={s.type} />
                      <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                        <div className="min-w-0">
                          <p className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{s.title}</span>
                            {s.status !== "ended" && (
                              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                                {s.status === "live" ? "Unfinished" : "Not started"}
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {sessionLine([sessionKindLine(s), formatDate(s.started_at ?? s.created_at)])}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 sm:justify-end">
                          {s.duration_seconds ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-500/10 px-2 py-0.5 tabular-nums text-zinc-600 dark:text-zinc-300">
                              <Clock className="h-3 w-3" aria-hidden="true" />
                              {formatDuration(s.duration_seconds)}
                            </span>
                          ) : null}
                          {sessionLanguageLabel(s.language, s.answer_language) && (
                            <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-zinc-600 dark:text-zinc-300">
                              {sessionLanguageLabel(s.language, s.answer_language)}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-500/10 px-2 py-0.5 tabular-nums text-zinc-600 dark:text-zinc-300">
                            <MessageCircle className="h-3 w-3" aria-hidden="true" />
                            {s.question_count} question{s.question_count === 1 ? "" : "s"}
                          </span>
                        </div>
                      </div>
                      {scores.has(s.id) ? <ScorePip score={scores.get(s.id)!} /> : <span className="w-8 shrink-0" aria-hidden="true" />}
                      {s.status === "ended" && (
                        <ChevronRight
                          aria-hidden="true"
                          className="h-4 w-4 shrink-0 text-zinc-400 motion-ok:transition-transform motion-ok:group-hover:translate-x-0.5"
                        />
                      )}
                    </button>
                    {s.status !== "ended" && (
                      <Button size="sm" onClick={() => onResume(s)}>
                        Rejoin
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
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
    if (!(await confirmDialog({ title: "Delete the transcript?", body: "What was said in this session is deleted: the transcript and its questions, also from the answers. The answers and the report (with its short quotes) are kept.", confirmLabel: "Delete transcript", danger: true }))) return;
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
        icon={SESSION_TYPE_ICON[session.type]}
        subtitle={sessionLine([
          SESSION_TYPE_LABEL[session.type],
          session.role,
          sessionLanguageLabel(session.language, session.answer_language),
          formatDate(session.started_at ?? session.created_at),
          session.duration_seconds ? formatDuration(session.duration_seconds) : null,
        ])}
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
      <Tabs
        label="Session"
        idBase="session-detail"
        className="mb-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "review", label: "Review" },
          { value: "summary", label: "Summary" },
          { value: "transcript", label: `Transcript (${detail.turns.length})` },
          {
            value: "questions",
            label: `Questions & answers (${detail.questions.length + detail.answers.filter((a) => !a.question_id || !detail.questions.some((q) => q.id === a.question_id)).length})`,
          },
        ]}
      />
      {tab === "review" && (
        <TabPanel idBase="session-detail" value="review" className="space-y-6">
        <SessionReview
          review={detail.summary?.review}
          practiceQueue={!session.negotiation}
          ended={session.status === "ended"}
          empty={!detail.turns.length && !detail.questions.length}
          answers={detail.answers.length}
          onGenerate={async () => {
            await api.reviewSession(session.id);
            setDetail(await api.getSession(session.id));
          }}
          onDrill={async () => onDrill(await api.drillSession(session.id))}
          onRetry={async (question) => onDrill(await api.drillSession(session.id, question))}
          onSaveAnswer={async (question, answer) => {
            await api.saveAnswer({ question, answer, session_id: session.id });
          }}
        />
        {session.type === "mock" && session.status === "ended" && detail.summary?.review && (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Ask a mentor</h2>
              <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                Share this report by a private link with someone you trust; they comment on each answer, no account needed.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void openUrl(mentorLink(WEB_URL, session.id))}>
              Share for feedback <span className="sr-only">(opens in your browser)</span>
            </Button>
          </Card>
        )}
        <DeliveryCard delivery={detail.summary?.delivery} />
        {session.status === "ended" && <DebriefStudio api={api} sessionId={session.id} refreshOn={detail.summary?.review} />}
        {session.status === "ended" && session.type !== "mock" && (detail.turns.length > 0 || detail.questions.length > 0) && (
          <FollowUpCard
            initial={detail.summary?.follow_up}
            load={(refresh) => api.followUp(session.id, refresh)}
            openLink={(url) => void openUrl(url)}
          />
        )}
        </TabPanel>
      )}
      {tab !== "review" && (
        <TabPanel idBase="session-detail" value={tab}>
          {tab === "summary" && <SummaryView summary={detail.summary} />}
          {tab === "transcript" && <TranscriptTimeline detail={detail} />}
          {tab === "questions" && <QuestionsView detail={detail} />}
        </TabPanel>
      )}
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
        <p lang={scriptLang(summary.summary)} className="whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {summary.summary}
        </p>
        <p className="mt-3 text-xs text-zinc-500">
          {summary.questions_asked.length} question{summary.questions_asked.length === 1 ? "" : "s"} ·{" "}
          {summary.follow_up_count} follow-up{summary.follow_up_count === 1 ? "" : "s"}
          {summary.language ? ` · ${reportLanguageNote(summary.language)}` : ""}
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
            <span className="pt-0.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{formatClock(t.start_ms)}</span>
            <div>
              <p
                className={cx(
                  "text-xs font-semibold",
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
  // Answers no listed question carries: asked in chat or with Answer, or every one after "Delete transcript" (which
  // keeps the answers). Shown on their own, or they'd be kept but never seen (the web's Questions & answers does too).
  const loose = useMemo(() => {
    const listed = new Set(detail.questions.map((q) => q.id));
    return detail.answers.filter((a) => !a.question_id || !listed.has(a.question_id));
  }, [detail.answers, detail.questions]);

  const answer = (a: SessionAnswer) => (
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
  );

  if (detail.questions.length === 0 && loose.length === 0) return <p className="text-sm text-zinc-500">No questions were detected.</p>;
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
            {(answersByQuestion.get(q.id) ?? []).map(answer)}
          </Card>
        </li>
      ))}
      {loose.map((a) => (
        <li key={a.id}>
          <Card>
            {a.content.question && <p className="font-medium">{a.content.question}</p>}
            {answer(a)}
          </Card>
        </li>
      ))}
    </ol>
  );
}
