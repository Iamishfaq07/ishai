import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { SessionAnswer, SessionDetail, SessionSummary } from "@orbit/types";
import {
  AnswerRatingButtons,
  CodeBlock,
  CameraCard,
  DeliveryCard,
  FollowUpCard,
  ReportStatusNote,
  SessionReview,
  DebriefStudio,
  cx,
  focusRing,
  useAnswerRatings,
  useReportPolling,
  confirmDialog,
  CopyButton,
  CosmicEmptyState,
  LoadGate,
  TabPanel,
  Tabs,
  reportLanguageNote,
  scriptLang,
  sessionLanguageLabel,
} from "@orbit/ui";
import { BackLink } from "../components/BackLink";
import { Button, Card, ErrorNote, Input, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { SESSION_TYPE_LABEL, downloadText, errorText, formatClock, formatDate, formatDuration, isNotFound } from "../lib/format";
import { SESSION_TYPE_ICON } from "../lib/sessionIcons";
import { useAsync } from "../lib/useAsync";
import { looseAnswers } from "../lib/sessionQa";
import type { LiveLaunchState } from "./SessionSetup";
import { JOBS_MATCHES } from "./jobs/paths";
import { RESUME_AI_HOME } from "./resume/paths";
import { CounterOfferEmail } from "../components/CounterOfferEmail";
import { JobWrapUp } from "./jobs/interview/WrapUp";

type Tab = "review" | "summary" | "transcript" | "questions";

const nextLink = cx(
  "inline-flex min-h-10 items-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:border-zinc-300 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10",
  focusRing,
);

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

  if (detail.loading && !detail.data) return <LoadGate loading variant="card" count={2} label="Opening the session">{null}</LoadGate>;
  if (detail.error || !detail.data) {
    if (!detail.error || isNotFound(detail.error)) {
      return (
        <CosmicEmptyState
          variant="no-results"
          title="That session isn't here"
          body="It may have been deleted."
          action={<Link to="/sessions" className="text-indigo-600 underline dark:text-indigo-400">See your sessions</Link>}
        />
      );
    }
    return <ErrorNote onRetry={detail.reload}>{errorText(detail.error)}</ErrorNote>;
  }
  const { session } = detail.data;
  const qaCount = detail.data.questions.length + looseAnswers(detail.data.questions, detail.data.answers).length;

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
    if (!(await confirmDialog({ title: "Delete the transcript?", body: "What was said in this session is deleted: the transcript and its questions, also from the answers. The answers and the report (with its short quotes) are kept.", confirmLabel: "Delete transcript", danger: true }))) return;
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
          sessionLanguageLabel(session.language, session.answer_language),
          formatDate(session.started_at ?? session.created_at),
          session.duration_seconds ? formatDuration(session.duration_seconds) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        back={<BackLink to="/sessions">All sessions</BackLink>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void exportMd()}>
              Export Markdown
            </Button>
            {detail.data.turns.length > 0 && (
              <Button variant="secondary" onClick={() => void removeTranscript()}>
                Delete transcript
              </Button>
            )}
            <Button variant="danger" onClick={() => void remove()}>
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
      {session.status === "ended" && session.application_id && (
        <JobWrapUp session={session} followUp={session.type !== "mock" && (detail.data.turns.length > 0 || detail.data.questions.length > 0)} />
      )}
      {session.status === "ended" && (
        <nav aria-label="What to do next" className="mb-6 flex flex-col gap-3 rounded-2xl border border-zinc-200/80 bg-zinc-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Keep going</p>
          <div className="flex flex-wrap gap-2">
            <Link to={session.type === "mock" ? "/mock" : "/start"} className={nextLink}>
              {session.type === "mock" ? "Practise another round" : "Start another session"}
            </Link>
            <Link to={RESUME_AI_HOME} className={nextLink}>Work on your resume</Link>
            <Link to={JOBS_MATCHES} className={nextLink}>See jobs that fit</Link>
          </div>
        </nav>
      )}
      {/* The shared tabs: a sliding underline, arrow keys between them, each panel named by its tab. */}
      <Tabs
        label="Session"
        idBase="session"
        value={tab}
        onChange={setTab}
        className="mb-6"
        tabs={(
          [
            // [id, label, shorter label for phones]
            ["review", "Review", "Review"],
            ["summary", "Summary", "Summary"],
            ["transcript", `Transcript (${detail.data.turns.length})`, "Transcript"],
            ["questions", `Questions & answers (${qaCount})`, `Q&A (${qaCount})`],
          ] as const
        ).map(([id, label, short]) => ({
          value: id,
          label: (
            <>
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline">{label}</span>
            </>
          ),
        }))}
      />

      {tab === "review" && (
        <TabPanel idBase="session" value="review" className="space-y-6">
        <SessionReview
          review={detail.data.summary?.review}
          practiceQueue={!session.negotiation}
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
          onSaveAnswer={async (question, answer) => {
            await api.saveAnswer({ question, answer, session_id: session.id });
          }}
        />
        {detail.data.summary?.counter_offer_email && <CounterOfferEmail email={detail.data.summary.counter_offer_email} />}
        <DeliveryCard delivery={detail.data.summary?.delivery} />
        <CameraCard camera={detail.data.camera} />
        {session.status === "ended" && <DebriefStudio api={api} sessionId={session.id} refreshOn={detail.data.summary?.review} />}
        {session.status === "ended" && session.type !== "mock" && (detail.data.turns.length > 0 || detail.data.questions.length > 0) && (
          <div id="follow-up" className="scroll-mt-24">
            <FollowUpCard initial={detail.data.summary?.follow_up} load={(refresh) => api.followUp(session.id, refresh)} />
          </div>
        )}
        </TabPanel>
      )}
      {tab === "summary" && <TabPanel idBase="session" value="summary"><SummaryView summary={detail.data.summary} /></TabPanel>}
      {tab === "transcript" && <TabPanel idBase="session" value="transcript"><TranscriptTimeline detail={detail.data} /></TabPanel>}
      {tab === "questions" && <TabPanel idBase="session" value="questions"><QuestionsView detail={detail.data} /></TabPanel>}
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
  const turns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? detail.turns.filter((t) => t.text.toLowerCase().includes(q)) : detail.turns;
  }, [detail.turns, query]);

  // Says on the button whether it worked (refused or missing clipboard: "Couldn't copy").
  const transcript = () =>
    detail.turns.map((t) => `${formatClock(t.start_ms)} ${t.speaker === "candidate" ? "Candidate" : "Interviewer"}\n${t.text}`).join("\n\n");

  if (detail.turns.length === 0) {
    return <p className="text-sm text-zinc-500">No transcript was stored for this session.</p>;
  }
  return (
    <div>
      <div className="mb-4 flex gap-2">
        <Input type="search" placeholder="Search transcript…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search transcript" />
        <CopyButton size="md" icon={false} text={transcript} />
      </div>
      <ol className="space-y-4">
        {turns.map((t) => (
          <li key={t.id} className="grid grid-cols-[4.5rem_1fr] gap-3 text-sm">
            <span className="pt-0.5 font-mono text-xs tabular-nums text-zinc-400">{formatClock(t.start_ms)}</span>
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

  const loose = looseAnswers(detail.questions, detail.answers);
  const answerBlock = (a: SessionAnswer) => (
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
              <span>{q.source}</span>
              <span>{formatDate(q.created_at)}</span>
            </div>
            <p className="font-medium">{q.text}</p>
            {(answersByQuestion.get(q.id) ?? []).map(answerBlock)}
          </Card>
        </li>
      ))}
      {/* Asked in chat or with Answer, or their question went with the transcript: the answer is still kept. */}
      {loose.map((a) => (
        <li key={a.id}>
          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 font-medium text-indigo-700 dark:text-indigo-300">
                {a.question_id ? "Answer" : "You asked"}
              </span>
            </div>
            {a.content.question && <p className="font-medium">{a.content.question}</p>}
            {answerBlock(a)}
          </Card>
        </li>
      ))}
    </ol>
  );
}
