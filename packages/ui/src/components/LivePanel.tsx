import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEV_FIXTURES, type CodingLanguage } from "@orbit/types";
import { formatElapsed, useElapsed } from "../hooks/useElapsed";
import { useStickyScroll } from "../hooks/useStickyScroll";
import { DEFAULT_HOTKEYS, useHotkeys, type HotkeyMap } from "../live/hotkeys";
import { useAnswerHistory } from "../live/useAnswerHistory";
import { useInterviewerVoice } from "../live/useInterviewerVoice";
import { useKeyPointProgress } from "../live/useKeyPointProgress";
import { useReadAloud } from "../live/useReadAloud";
import {
  selectDisplayedAnswer,
  selectDisplayedQuestion,
  type AnswerView,
  type LiveViewState,
  type TurnView,
} from "../live/reducer";
import type { LiveActions } from "../live/useLiveSession";
import { AnswerCard } from "./AnswerCard";
import { ChatInput } from "./ChatInput";
import { ControlBar } from "./ControlBar";
import { MockPanel } from "./MockPanel";
import { cx, focusRing } from "./cx";
import { OrbitLogo } from "./OrbitLogo";
import { QuestionCard } from "./QuestionCard";
import { StatusPill } from "./StatusPill";
import { Teleprompter } from "./Teleprompter";
import { TranscriptView } from "./TranscriptView";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, X } from "../icons";

export type PanelMode = "compact" | "expanded";
type SideTab = "transcript" | "chat" | "reading";

export interface LivePanelProps {
  live: LiveViewState;
  actions: LiveActions;
  mode: PanelMode;
  onModeChange: (mode: PanelMode) => void;
  onEnd: () => void;
  onReconnect?: () => void;
  /** End another live session of this account (one live session at a time), so this one can connect. */
  onEndOtherSession?: (sessionId: string) => Promise<void>;
  onScreenshot?: () => void;
  screenshotUnavailableReason?: string;
  hotkeys?: HotkeyMap;
  title?: string;
  /** Desktop: mark the header as the window drag handle. */
  dragRegion?: boolean;
  /** Extra header controls (e.g. desktop "always on top" toggle). */
  headerEnd?: ReactNode;
  /** Banner area for capture prompts (e.g. web "share tab audio"). */
  notice?: ReactNode;
  /** Modal layer rendered over the panel (screenshot preview). */
  overlay?: ReactNode;
  /** Transcript fixtures offered when the server runs the mock STT provider (defaults to DEV_FIXTURES). */
  devFixtures?: readonly string[];
  /** Mock interview session: the AI interviewer's questions are shown and spoken instead of suggested answers. */
  mockInterview?: boolean;
  /**
   * Orbit's own voice started/stopped (the mock interviewer, or "Read aloud"). Stop sending audio while it plays,
   * so the speakers are never transcribed as part of the interview.
   */
  onInterviewerSpeaking?: (speaking: boolean) => void;
}

export function LivePanel(props: LivePanelProps) {
  const { live, actions, mode } = props;
  const hotkeys = props.hotkeys ?? DEFAULT_HOTKEYS;
  const compact = mode === "compact";
  const [sideTab, setSideTab] = useState<SideTab>("transcript");
  const [chatOpen, setChatOpen] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const chatRef = useRef<HTMLTextAreaElement>(null);

  const ended = live.state === "ended";
  const paused = live.state === "paused";
  const elapsed = useElapsed(live.startedAt, !ended && !paused);
  const answer = selectDisplayedAnswer(live);
  const question = selectDisplayedQuestion(live);
  const mockQuestion = useMemo(
    () => (live.mock && !live.mockCompleted ? { id: live.mock.questionId, text: live.mock.text } : null),
    [live.mock, live.mockCompleted],
  );
  const voice = useInterviewerVoice(mockQuestion, { enabled: Boolean(props.mockInterview) });
  const { onInterviewerSpeaking } = props;
  const reader = useReadAloud();
  const selfSpeaking = voice.speaking || reader.status === "playing";
  useEffect(() => onInterviewerSpeaking?.(selfSpeaking), [selfSpeaking, onInterviewerSpeaking]);
  // Chat replies and screenshot answers aren't spoken to the interviewer: no checklist for those.
  const keyPoints = useKeyPointProgress(live, answer && (answer.source === "auto" || answer.source === "manual")
    ? answer : null);
  const { history, index: historyIndex, browsing, newAnswer: newSinceBrowsing, step, backToLive } =
    useAnswerHistory(live, actions);
  const turns = useMemo(
    () => live.turnOrder.map((id) => live.turns[id]).filter((t): t is TurnView => Boolean(t)),
    [live.turnOrder, live.turns],
  );
  const liveInterviewerTurn = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      if (t && t.speaker !== "candidate") return t;
    }
    return null;
  }, [turns]);

  const focusChat = () => {
    if (compact) props.onModeChange("expanded");
    setChatOpen(true);
    setSideTab("chat");
    // Wait a frame for the input to mount.
    requestAnimationFrame(() => chatRef.current?.focus());
  };

  useHotkeys(
    hotkeys,
    {
      answer: () => !ended && (props.mockInterview ? actions.mockNext() : actions.answer()),
      clear: () => !ended && actions.clear(),
      toggleListening: () => !ended && actions.togglePause(),
      focusChat,
      prevAnswer: () => step(-1),
      nextAnswer: () => step(1),
      ...(props.onScreenshot ? { screenshot: props.onScreenshot } : {}),
    },
    !ended,
  );

  const retry = () => actions.answer(question?.text);
  const mockStt = live.providers.stt?.state === "mock";

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header
        data-tauri-drag-region={props.dragRegion ? "" : undefined}
        className="flex select-none items-center gap-2.5 border-b border-zinc-200 px-4 py-2.5 dark:border-white/[0.06]"
      >
        <OrbitLogo size={18} busy={live.state === "generating" || live.state === "streaming"} />
        {!compact && (
          <span
            data-tauri-drag-region={props.dragRegion ? "" : undefined}
            className="max-w-[40%] truncate font-display text-sm font-semibold tracking-tight"
          >
            {props.title ?? "Orbit"}
          </span>
        )}
        <StatusPill state={live.state} connection={live.connection} stt={live.providers.stt?.state} />
        <span
          data-tauri-drag-region={props.dragRegion ? "" : undefined}
          className="ml-auto font-mono text-xs tabular-nums text-zinc-500"
          aria-label="Session time"
        >
          {formatElapsed(elapsed)}
        </span>
        {props.headerEnd}
        <button
          type="button"
          onClick={() => props.onModeChange(compact ? "expanded" : "compact")}
          title={compact ? "Expand" : "Compact"}
          aria-label={compact ? "Switch to expanded mode" : "Switch to compact mode"}
          className={cx("rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-white/5 dark:hover:text-zinc-200", focusRing)}
        >
          {compact ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
        </button>
        {compact && (
          <button
            type="button"
            onClick={props.onEnd}
            disabled={ended}
            className={cx("rounded px-1.5 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:text-rose-400 dark:hover:bg-rose-950/40", focusRing)}
          >
            End
          </button>
        )}
      </header>

      <Banners live={live} onReconnect={props.onReconnect} onEndOtherSession={props.onEndOtherSession} onDismiss={actions.dismissError} />
      {props.notice}

      <div className={cx("flex min-h-0 flex-1", !compact && "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]")}>
        <main className="flex min-h-0 flex-1 flex-col">
          {props.mockInterview ? (
            <MockPanel live={live} actions={actions} voice={voice} ended={ended} />
          ) : (
          <>
          <QuestionCard question={question} liveTurn={liveInterviewerTurn} compact={compact} />
          <div className="mx-4 h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent dark:via-white/10" />
          {history.length > 1 && !live.pinnedAnswerId && (
            <HistoryNav
              index={historyIndex}
              total={history.length}
              browsing={browsing}
              newAnswer={newSinceBrowsing}
              onStep={step}
              onLive={backToLive}
            />
          )}
          <AnswerCard
            answer={answer}
            pinned={Boolean(answer && live.pinnedAnswerId === answer.answer_id)}
            onPin={(pinned) => answer && actions.pin(answer.answer_id, pinned)}
            onRetry={retry}
            compact={compact}
            autoAnswer={live.settings.auto_answer}
            progress={keyPoints?.progress ?? null}
            {...(keyPoints ? { onTogglePoint: keyPoints.toggle } : {})}
            reader={reader}
            // Screenshots can't be re-run (the image isn't kept), so their code has no language picker.
            {...(answer && answer.source !== "screenshot" && question && !ended
              ? { onCodeLanguage: (lang: CodingLanguage) => actions.setCodingLanguage(lang, question.text) }
              : {})}
          />
          </>
          )}
        </main>

        {!compact && (
          <aside className="hidden min-h-0 flex-col border-l border-zinc-200 dark:border-white/[0.06] md:flex">
            <div role="tablist" aria-label="Session panels" className="flex gap-1 border-b border-zinc-200 px-2 py-2 dark:border-white/[0.06]">
              {(["transcript", "chat", "reading"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={sideTab === tab}
                  onClick={() => setSideTab(tab)}
                  className={cx(
                    "rounded-full px-3 py-1 text-xs font-medium capitalize",
                    sideTab === tab
                      ? "bg-indigo-500/10 text-indigo-700 ring-1 ring-indigo-500/25 dark:text-indigo-200"
                      : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
                    focusRing,
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            {sideTab === "transcript" && (
              <TranscriptView
                turns={turns}
                onCorrectSpeaker={(turnId, speaker) => actions.correctSpeaker(turnId, speaker)}
              />
            )}
            {sideTab === "chat" && <ChatLog live={live} />}
            {sideTab === "reading" && <Teleprompter answer={answer} />}
            {sideTab === "chat" && <ChatInput ref={chatRef} onSend={actions.chat} disabled={ended} />}
          </aside>
        )}
      </div>

      {chatOpen && (compact || sideTab !== "chat") && (
        <div className="md:hidden">
          <ChatInput ref={chatRef} onSend={actions.chat} disabled={ended} />
        </div>
      )}

      {mockStt && !ended && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-dashed border-zinc-200 px-4 py-1.5 text-xs text-zinc-500 dark:border-zinc-800">
          <span title="The server is using the mock speech-to-text provider — replay a scripted conversation">
            Dev · simulate:
          </span>
          {(props.devFixtures ?? DEV_FIXTURES).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => actions.simulate(f, simSpeed)}
              className={cx("underline hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}
            >
              {f.replace(/_/g, " ")}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1">
            speed
            <select
              value={simSpeed}
              onChange={(e) => setSimSpeed(Number(e.target.value))}
              className="rounded bg-transparent text-xs"
            >
              {[1, 2, 5, 10].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* Practice mode: no answer/screenshot/chat controls (Orbit never answers for you); End is in the header. */}
      {!props.mockInterview && <ControlBar
        length={live.settings.length}
        autoAnswer={live.settings.auto_answer}
        responseTiming={live.settings.response_timing ?? "balanced"}
        style={live.settings.style}
        thinking={live.settings.thinking ?? "off"}
        paused={paused}
        ended={ended}
        hotkeys={hotkeys}
        compact={compact}
        chatOpen={chatOpen}
        onAnswer={() => actions.answer()}
        onScreenshot={props.onScreenshot}
        screenshotUnavailableReason={props.screenshotUnavailableReason}
        onToggleChat={() => (chatOpen ? setChatOpen(false) : focusChat())}
        onClear={actions.clear}
        onLength={actions.setLength}
        onAutoAnswer={actions.setAutoAnswer}
        onResponseTiming={actions.setResponseTiming}
        onStyle={actions.setStyle}
        onThinking={actions.setThinking}
        onTogglePause={actions.togglePause}
        onEnd={props.onEnd}
      />}

      {props.overlay}
    </div>
  );
}

function EndOtherButton({ onEnd, onDone }: { onEnd: () => Promise<void>; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        onEnd()
          .then(() => onDone?.())
          .finally(() => setBusy(false));
      }}
      className={cx("shrink-0 font-medium underline disabled:opacity-50", focusRing)}
    >
      {busy ? "Ending…" : "End it and use this one"}
    </button>
  );
}

function Banners({
  live,
  onReconnect,
  onEndOtherSession,
  onDismiss,
}: {
  live: LiveViewState;
  onReconnect?: () => void;
  /** End another live session of this account (one live session at a time), so this one can connect. */
  onEndOtherSession?: (sessionId: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const items: Array<{ key: string; tone: "warn" | "error"; text: string; action?: ReactNode }> = [];

  const other = live.connectionInfo?.code === "live_session_active" ? live.connectionInfo.sessionId : undefined;
  if (live.connection === "closed" && live.state !== "ended" && live.connectionDetail && other && onEndOtherSession) {
    items.push({
      key: "conn",
      tone: "error",
      text: live.connectionDetail,
      action: <EndOtherButton onEnd={() => onEndOtherSession(other)} onDone={onReconnect} />,
    });
  } else if (live.connection === "closed" && live.state !== "ended" && live.connectionDetail) {
    items.push({
      key: "conn",
      tone: "error",
      text: live.connectionDetail,
      action: onReconnect ? (
        <button type="button" onClick={onReconnect} className={cx("font-medium underline", focusRing)}>
          Reconnect
        </button>
      ) : undefined,
    });
  }
  if (live.mic.state === "error") items.push({ key: "mic", tone: "error", text: live.mic.detail ?? "Microphone unavailable." });
  if (live.system.state === "error")
    items.push({ key: "sys", tone: "warn", text: live.system.detail ?? "System audio unavailable — only your mic is being heard." });
  const llm = live.providers.llm;
  if (llm && (llm.state === "down" || llm.state === "reconnecting"))
    items.push({ key: "llm", tone: "warn", text: llm.detail ?? "AI is temporarily unavailable — retrying." });
  const stt = live.providers.stt;
  if (stt?.state === "down")
    items.push({ key: "stt", tone: "error", text: stt.detail ?? "Transcription is down." });
  else if (stt?.state === "reconnecting")
    items.push({ key: "stt", tone: "warn", text: stt.detail ?? "Transcription reconnecting…" });
  if (live.usage?.limitReached)
    items.push({
      key: "usage",
      tone: "error",
      text:
        live.usage.reason === "session"
          ? "This session reached its maximum length and has ended. Start a new session to continue."
          : "You've used this month's minutes — the session has ended.",
    });
  else if (live.usage && live.state !== "ended") {
    const n = Math.max(1, Math.round(live.usage.minutesRemaining));
    items.push({
      key: "usage",
      tone: "warn",
      text:
        live.usage.reason === "session"
          ? `${n} minute${n === 1 ? "" : "s"} left in this session — it ends automatically at your plan's maximum length.`
          : `${n} minute${n === 1 ? "" : "s"} left this month — the session ends when they run out.`,
    });
  }
  if (live.lastError)
    items.push({
      key: "err",
      tone: "error",
      text: live.lastError.message,
      action: (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className={cx("px-1", focusRing)}>
          <X className="h-3.5 w-3.5" />
        </button>
      ),
    });

  if (items.length === 0) return null;
  return (
    <div className="space-y-px" role="alert">
      {items.map((i) => (
        <div
          key={i.key}
          className={cx(
            "flex items-center gap-2 px-4 py-1.5 text-xs",
            i.tone === "error"
              ? "bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
              : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
          )}
        >
          <span className="flex-1">{i.text}</span>
          {i.action}
        </div>
      ))}
    </div>
  );
}

function ChatLog({ live }: { live: LiveViewState }) {
  // Follow new replies like the transcript does — key on chat length + streamed length of the last reply.
  const last = live.chat[live.chat.length - 1];
  const lastLen =
    last?.kind === "answer" ? (live.answers[last.answer_id]?.answer.talking_points.length ?? 0) : 0;
  const { ref, onScroll } = useStickyScroll<HTMLOListElement>(`${live.chat.length}:${lastLen}`);
  if (live.chat.length === 0) {
    return (
      <p className="flex-1 px-4 py-6 text-center text-sm text-zinc-500">
        Ask for a rewrite, an example, or anything else — Orbit uses this session’s context.
      </p>
    );
  }
  return (
    <ol
      ref={ref}
      onScroll={onScroll}
      className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm"
      aria-label="Chat"
    >
      {live.chat.map((entry) =>
        entry.kind === "user" ? (
          <li key={entry.id} className="ml-8 rounded-2xl rounded-br-md bg-gradient-to-br from-indigo-500 to-indigo-700 px-3.5 py-2 text-white shadow-glow-sm">
            {entry.text}
          </li>
        ) : (
          <li key={entry.id} className="mr-4 rounded-2xl rounded-bl-md bg-zinc-100 px-3.5 py-2 ring-1 ring-zinc-200 dark:bg-white/[0.04] dark:ring-white/[0.06]">
            <ChatAnswer answer={live.answers[entry.answer_id]} />
          </li>
        ),
      )}
    </ol>
  );
}

function ChatAnswer({ answer }: { answer: AnswerView | undefined }) {
  if (!answer) return null;
  if (answer.status === "failed") return <span className="text-rose-600">{answer.error?.message ?? "Failed."}</span>;
  if (!answer.has_content) return <span className="text-zinc-500">Thinking…</span>;
  const a = answer.answer;
  return (
    <div className="space-y-1">
      {a.direct_answer && <p className="whitespace-pre-line">{a.direct_answer}</p>}
      {a.talking_points.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4">
          {a.talking_points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "‹ 3 of 5 ›" through earlier answers, with a way back to the live one. */
function HistoryNav(props: {
  index: number;
  total: number;
  browsing: boolean;
  newAnswer: boolean;
  onStep: (delta: number) => void;
  onLive: () => void;
}) {
  const navBtn = cx(
    "inline-flex items-center rounded-md px-1 py-0.5 text-sm text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800",
    focusRing,
  );
  return (
    <div className="flex animate-fade-in items-center gap-1 px-4 pt-2 text-xs text-zinc-500 dark:text-zinc-400">
      <button type="button" className={navBtn} onClick={() => props.onStep(-1)} disabled={props.index <= 0}
              title="Previous answer (Alt+←)" aria-label="Previous answer">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="tabular-nums" aria-live="polite">
        {props.index + 1} of {props.total}
      </span>
      <button type="button" className={navBtn} onClick={() => props.onStep(1)} disabled={props.index >= props.total - 1}
              title="Next answer (Alt+→)" aria-label="Next answer">
        <ChevronRight className="h-4 w-4" />
      </button>
      <span className="flex-1" />
      {props.browsing && (
        <button
          type="button"
          onClick={props.onLive}
          className={cx(
            "flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
            props.newAnswer
              ? "animate-fade-up bg-indigo-600 text-white hover:bg-indigo-500"
              : "text-indigo-700 hover:bg-indigo-500/10 dark:text-indigo-300",
            focusRing,
          )}
        >
          <span className={cx("h-1.5 w-1.5 rounded-full", props.newAnswer ? "animate-ping bg-white" : "bg-emerald-500")} />
          {props.newAnswer ? "New answer — back to live" : "Back to live"}
        </button>
      )}
    </div>
  );
}
