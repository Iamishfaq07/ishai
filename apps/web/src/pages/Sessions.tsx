import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SessionType } from "@orbit/types";
import {
  Badge, BookOpen, ChevronRight, Clock, CosmicEmptyState, Database, Laptop, LoadGate, MessageSquareQuote, Play, Reveal,
  Search, ShieldCheck, Target, confirmDialog, cx, focusRing, MessageCircle, sessionLanguageLabel,
} from "@orbit/ui";
import { Button, Card, ErrorNote, Input } from "../components/ui";
import { PRODUCTS } from "../components/products";
import { api } from "../lib/api";
import { errorText, formatDate, formatDuration, sessionKindLine } from "../lib/format";
import { SESSION_TYPE_ICON } from "../lib/sessionIcons";
import { useAsync } from "../lib/useAsync";
import { DESKTOP_BETA, DESKTOP_DOWNLOAD_URL } from "../lib/desktop";
import { linkButton } from "./jobs/links";
import { Stat, Tool, type ToolCard } from "./prepare/parts";

const TYPE_LABEL: Record<SessionType, string> = {
  interview: "Interview", coding: "Coding", meeting: "Meeting", assessment: "Assessment", phone: "Phone", mock: "Mock",
};

const TOOLS: ToolCard[] = [
  { title: "Start a live session", detail: "Choose the call type, language and context; answers appear as questions are asked.", icon: Play, to: "/start", ai: true },
  { title: "Context documents", detail: "The resume, job post and notes the copilot may draw on.", icon: Database, to: "/documents" },
  { title: "Answer library", detail: "Answers you saved from past sessions, ready to reuse.", icon: MessageSquareQuote, to: "/documents/answers" },
  { title: "Story bank", detail: "Your STAR stories, so answers use real examples.", icon: BookOpen, to: "/documents/stories" },
  { title: "Rehearse first", detail: "A mock round with Saba before the real call.", icon: Target, to: "/prepare", ai: true },
  { title: "Windows desktop app", detail: "Runs beside your call window with a privacy shield and taskbar controls.", icon: Laptop, to: DESKTOP_DOWNLOAD_URL, beta: DESKTOP_BETA },
];

export function SessionsPage() {
  const sessions = useAsync(() => api.listSessions(), [], "sessions");
  const navigate = useNavigate();
  const [ending, setEnding] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);
  // Unfinished sessions first (resume or end them), then the rest newest first as the server sends them.
  const sorted = [...(sessions.data ?? [])].sort((a, b) => Number(a.status === "ended") - Number(b.status === "ended"));
  const [query, setQuery] = useState("");
  const [type, setType] = useState<SessionType | "all">("all");
  const types = useMemo(() => [...new Set(sorted.map((s) => s.type))], [sorted]);
  const shown = sorted.filter((s) => (type === "all" || s.type === type)
    && (!query.trim() || s.title.toLowerCase().includes(query.trim().toLowerCase())));
  const all = sessions.data ?? null;
  const unfinished = all?.filter((s) => s.status !== "ended") ?? [];

  // Ending writes the summary report, like pressing End in the session. It can't be undone, so ask first (as Live does).
  const end = async (id: string) => {
    if (
      !(await confirmDialog({
        title: "End this session?",
        body: "It can't be resumed afterwards. The transcript and report are saved in Sessions.",
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
    <div className="workspace-page">
      <header className="workspace-heading">
        <div><h1>Copilot</h1>
          <p className="workspace-description">Live help during real calls where AI assistance is permitted, and every transcript, answer and summary afterwards.</p></div>
        <div className="flex flex-wrap gap-2">
          <Link to="/prepare" className={linkButton("secondary")}><Target className="h-4 w-4" aria-hidden /> Rehearse first</Link>
          <Link to="/start" className={linkButton("primary")}><Play className="h-4 w-4" aria-hidden /> Start a session</Link>
        </div>
      </header>

      {/* Four "None yet" boxes say nothing a first visit needs; the counts appear with the first session. */}
      {all?.length !== 0 && <Reveal stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sessions" value={all ? all.length : null} hint="Copilot and mock sessions" />
        <Stat label="Questions handled" value={all ? all.reduce((n, s) => n + s.question_count, 0) : null} hint="Detected across all sessions" />
        <Stat label="Minutes" value={all ? Math.round(all.reduce((n, s) => n + (s.duration_seconds ?? 0), 0) / 60) : null} hint="Time in sessions" />
        <Stat label="Unfinished" value={all ? unfinished.length : null} hint="Resume or end them below" />
      </Reveal>}

      {unfinished.length > 0 && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
        <p><span className="font-semibold">{unfinished.length} session{unfinished.length === 1 ? "" : "s"} still open.</span> Resume to continue, or end to save the report. Open sessions end on their own after an hour.</p>
        <Button size="sm" onClick={() => navigate(`/live/${unfinished[0]!.id}`)}>Resume “{unfinished[0]!.title}”</Button>
      </div>}

      <section aria-labelledby="copilot-tools">
        <h2 id="copilot-tools" className="font-semibold">Copilot toolkit</h2>
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">Set up the context before a call; the better the context, the better the answers.</p>
        <Reveal as="ul" stagger className="-mx-3 mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">{TOOLS.map((t) => <li key={t.title}><Tool t={t} /></li>)}</Reveal>
      </section>

      <p className="flex items-start gap-2 rounded-xl bg-emerald-50/70 p-3 text-xs text-emerald-900 dark:bg-emerald-500/5 dark:text-emerald-100"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Use the copilot only where the employer or meeting allows AI assistance. For practice, use Prepare.</p>

      <section aria-labelledby="history">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 id="history" className="font-semibold">Session history</h2>
          <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">Transcripts, detected questions, answers and summaries.</p></div>
        {(all?.length ?? 0) > 0 && <label className="relative block w-full sm:w-64"><span className="sr-only">Search sessions</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title" className="pl-9" /></label>}
      </div>
      {types.length > 1 && <div role="group" aria-label="Filter by type" className="mt-3 flex flex-wrap gap-1.5">{(["all", ...types] as const).map((t) =>
        <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}
          className={cx("min-h-9 rounded-full px-3 text-xs font-medium ring-1 motion-safe:transition-colors", type === t
            ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-950 dark:ring-zinc-100"
            : "text-zinc-700 ring-zinc-200 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-white/5", focusRing)}>
          {t === "all" ? `All (${sorted.length})` : `${TYPE_LABEL[t]} (${sorted.filter((s) => s.type === t).length})`}</button>)}</div>}
      <div className="mt-3">
      <LoadGate loading={sessions.loading && !sessions.data} variant="session-row" count={4} label="Loading sessions">
      {sessions.error ? (
        <ErrorNote onRetry={sessions.reload}>{errorText(sessions.error)}</ErrorNote>
      ) : (sessions.data ?? []).length === 0 ? (
        <CosmicEmptyState variant="copilot" title="No sessions yet" body="Start a session for a call where AI help is permitted. When it ends, its transcript and summary are saved here." />
      ) : (
        <>
          {endError && (
            <div className="mb-4">
              <ErrorNote>{endError}</ErrorNote>
            </div>
          )}
          <Card className="p-0">
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {!shown.length && <li className="px-5 py-6 text-sm text-zinc-600 dark:text-zinc-400">No sessions match. Clear the search or filter.</li>}
            {shown.map((s) => {
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
      </section>
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
