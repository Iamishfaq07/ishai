import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEV_FIXTURES,
  type AnswerFeedbackReason,
  type AnswerLength,
  type AnswerRating,
  type CodingLanguage,
} from "@orbit/types";
import { formatElapsed, useElapsed } from "../hooks/useElapsed";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useStickyScroll } from "../hooks/useStickyScroll";
import { DEFAULT_HOTKEYS, useHotkeys, type HotkeyMap } from "../live/hotkeys";
import { CODING_LANGUAGES } from "../live/preferences";
import { useAnswerHistory } from "../live/useAnswerHistory";
import { useInterviewerVoice } from "../live/useInterviewerVoice";
import { useKeyPointProgress } from "../live/useKeyPointProgress";
import { useReadAloud } from "../live/useReadAloud";
import {
  selectAskAgain,
  selectDisplayedAnswer,
  selectDisplayedQuestion,
  type AnswerView,
  type LiveViewState,
  type TurnView,
} from "../live/reducer";
import type { LiveActions } from "../live/useLiveSession";
import { AnswerCard } from "./AnswerCard";
import type { AnswerRatings } from "./AnswerRating";
import { ChatInput } from "./ChatInput";
import { CodeBlock } from "./CodeBlock";
import { ControlBar } from "./ControlBar";
import { MockPanel } from "./MockPanel";
import { cx, focusRing } from "./cx";
import { OrbitLogo } from "./OrbitLogo";
import { QuestionCard } from "./QuestionCard";
import { StatusPill } from "./StatusPill";
import { Teleprompter } from "./Teleprompter";
import { TranscriptView } from "./TranscriptView";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelRightClose,
  Pause,
  PanelRightOpen,
  ScrollText,
  X,
  type LucideIcon,
} from "../icons";

export type PanelMode = "compact" | "expanded";
type SideTab = "transcript" | "chat" | "reading";

const SIDE_TABS: Array<{ id: SideTab; label: string; icon: LucideIcon }> = [
  { id: "transcript", label: "Transcript", icon: ScrollText },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "reading", label: "Reading", icon: BookOpen },
];

const SIDE_PANEL_KEY = "orbit.sidePanel";
const LENGTH_STEPS: readonly AnswerLength[] = ["short", "standard", "detailed"];

/** The session timer on its own: its once-a-second tick re-renders this, not the whole panel. */
function SessionClock({ startedAt, running, dragRegion }: { startedAt: number | null; running: boolean; dragRegion?: boolean }) {
  const elapsed = useElapsed(startedAt, running);
  return (
    <span
      data-tauri-drag-region={dragRegion ? "" : undefined}
      className="ml-auto font-mono text-xs tabular-nums text-zinc-500"
      aria-label="Session time"
    >
      {formatElapsed(elapsed)}
    </span>
  );
}

/** Wide screens remember whether the side panel is shown; phones always start with it closed (it covers the answer). */
function useSidePanel(wide: boolean): [boolean, (open: boolean) => void] {
  const [wideOpen, setWideOpen] = useState(() => {
    try {
      return localStorage.getItem(SIDE_PANEL_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const [narrowOpen, setNarrowOpen] = useState(false);
  const set = (open: boolean) => {
    if (!wide) return setNarrowOpen(open);
    setWideOpen(open);
    try {
      localStorage.setItem(SIDE_PANEL_KEY, open ? "open" : "closed");
    } catch {
      // storage unavailable — still applies for this session
    }
  };
  return [wide ? wideOpen : narrowOpen, set];
}

export interface LivePanelProps {
  live: LiveViewState;
  actions: LiveActions;
  mode: PanelMode;
  onModeChange: (mode: PanelMode) => void;
  onEnd: () => void;
  onReconnect?: () => void;
  /** End another live session of this account (one live session at a time), so this one can connect. */
  onEndOtherSession?: (sessionId: string) => Promise<void>;
  /** Where to buy more interview minutes (the billing page), offered when they run low or out. */
  onBuyMinutes?: () => void;
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
  /** 👍/👎 on answers (useAnswerRatings). */
  ratings?: AnswerRatings;
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
  const wide = useMediaQuery("(min-width: 768px)");
  const [sideOpen, setSideOpen] = useSidePanel(wide);
  const sideId = useId();
  const sideVisible = !compact && sideOpen;
  const chatShowing = sideVisible && sideTab === "chat";
  const [simSpeed, setSimSpeed] = useState(1);
  const chatRef = useRef<HTMLTextAreaElement>(null);

  const ended = live.state === "ended";
  const paused = live.state === "paused";
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

  // Chat lives in the side panel (on phones the panel opens over the answer).
  const focusChat = () => {
    if (compact) props.onModeChange("expanded");
    setSideOpen(true);
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

  const toggleChat = () => {
    if (!chatShowing) return focusChat();
    // Wide: back to the transcript. Phone: close the overlay so the answer shows again.
    if (wide) setSideTab("transcript");
    else setSideOpen(false);
  };

  // The answer card and transcript are memoized: everything handed to them stays the same function between live
  // updates (it only changes with the answer or question it acts on).
  const answerId = answer?.answer_id ?? null;
  const source = answer?.source;
  // How the shown answer is asked again (see selectAskAgain), as plain values so the callbacks below stay put.
  const again = selectAskAgain(live, answer);
  const againVia = again?.via ?? null;
  const againText = again?.text;
  const screenshot = again?.via === "answer" && again.screenshot;
  const pinnedId = live.pinnedAnswerId;
  const viewedId = live.viewedAnswerId;
  // Asking again from the card: show the new answer as it comes (a pinned or browsed one would hide it).
  const followLive = useCallback(() => {
    if (pinnedId) actions.pin(pinnedId, false);
    if (viewedId) actions.viewAnswer(null);
  }, [actions, pinnedId, viewedId]);
  const retry = useMemo(() => {
    if (!againVia) return undefined;
    return () => {
      followLive();
      if (againVia === "chat") actions.chat(againText ?? "");
      else actions.answer(againText);
    };
  }, [actions, againText, againVia, followLive]);
  const pin = useCallback(
    (pinned: boolean) => {
      if (answerId) actions.pin(answerId, pinned);
    },
    [actions, answerId],
  );
  const rateAnswer = props.ratings?.rate;
  const rate = useCallback(
    (r: AnswerRating | null, why?: AnswerFeedbackReason | null) => {
      if (answerId) rateAnswer?.(answerId, r, why);
    },
    [rateAnswer, answerId],
  );
  const codeLanguage = useCallback(
    (lang: CodingLanguage) => {
      followLive();
      if (source === "chat") {
        // A chat reply has no question to ask again: say it in chat, and the server rewrites the code it's about.
        actions.setCodingLanguage(lang);
        actions.chat(`Now in ${CODING_LANGUAGES.find((l) => l.value === lang)?.label ?? lang}`);
      } else if (againVia === "answer" && againText !== undefined) {
        actions.setCodingLanguage(lang, againText);
      }
    },
    [actions, againText, againVia, followLive, source],
  );
  // A chat reply's picker only while it's the latest answer: "now in Java" applies to what the server answered last.
  const offerLanguage = Boolean(
    answer && !ended &&
      (source === "chat"
        ? answer.status === "complete" && answer.answer_id === live.currentAnswerId
        : againVia === "answer" && againText !== undefined),
  );

  // "Shorter" / "Longer": step the answer length and re-ask the same question. Only for spoken answers to a
  // question (not chat replies or screenshots), and not while one is still streaming.
  const lengthIndex = LENGTH_STEPS.indexOf(live.settings.length);
  const canResize = Boolean(
    answer && againVia === "answer" && againText !== undefined && !screenshot && !ended && answer.status === "complete" &&
      (source === "auto" || source === "manual"),
  );
  const shorterLength = LENGTH_STEPS[lengthIndex - 1];
  const longerLength = LENGTH_STEPS[lengthIndex + 1];
  const resizeTo = useCallback(
    (next: AnswerLength | undefined) => {
      if (!next || againVia !== "answer" || againText === undefined) return null;
      return () => {
        followLive();
        actions.setLength(next);
        actions.answer(againText); // same socket, in order: the new length applies to this answer
      };
    },
    [actions, againText, againVia, followLive],
  );
  const onShorter = useMemo(() => resizeTo(shorterLength), [resizeTo, shorterLength]);
  const onLonger = useMemo(() => resizeTo(longerLength), [resizeTo, longerLength]);
  const mockStt = live.providers.stt?.state === "mock";

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header
        data-tauri-drag-region={props.dragRegion ? "" : undefined}
        className="flex select-none items-center gap-2.5 border-b border-zinc-200 px-4 py-2.5 dark:border-white/[0.06]"
      >
        <OrbitLogo size={18} busy={live.state === "generating" || live.state === "streaming"} />
        {compact && <h1 className="sr-only">{props.title ?? "Orbit"}</h1>}
        {!compact && (
          <h1
            data-tauri-drag-region={props.dragRegion ? "" : undefined}
            className="max-w-[40%] truncate font-display text-sm font-semibold tracking-tight"
          >
            {props.title ?? "Orbit"}
          </h1>
        )}
        <StatusPill state={live.state} connection={live.connection} stt={live.providers.stt?.state} />
        <SessionClock startedAt={live.startedAt} running={!ended && !paused} dragRegion={props.dragRegion} />
        {props.headerEnd}
        {!compact && (
          <button
            type="button"
            onClick={() => setSideOpen(!sideOpen)}
            aria-expanded={sideOpen}
            aria-controls={sideId}
            title={sideOpen ? "Hide transcript panel" : "Show transcript, chat and reading"}
            aria-label={sideOpen ? "Hide transcript panel" : "Show transcript panel"}
            className={cx(
              "rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-white/5 dark:hover:text-zinc-200",
              sideOpen && "text-indigo-600 dark:text-indigo-300",
              focusRing,
            )}
          >
            {sideOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => props.onModeChange(compact ? "expanded" : "compact")}
          title={compact ? "Expand" : "Compact"}
          aria-label={compact ? "Switch to expanded mode" : "Switch to compact mode"}
          className={cx("rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-white/5 dark:hover:text-zinc-200", focusRing)}
        >
          {compact ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
        </button>
        {/* Mocks have no control bar, so End lives here in both modes (the only way to stop a mock early). */}
        {(compact || props.mockInterview) && (
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

      <Banners
        live={live}
        onReconnect={props.onReconnect}
        onEndOtherSession={props.onEndOtherSession}
        onBuyMinutes={props.onBuyMinutes}
        onDismiss={actions.dismissError}
      />
      {props.notice}

      {paused && !ended && (
        <div
          role="status"
          className="flex animate-fade-in items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-900 dark:text-amber-200"
        >
          <Pause className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
          <span className="min-w-0 flex-1">Paused — Orbit isn’t listening or answering.</span>
          <button
            type="button"
            onClick={actions.resume}
            className={cx("rounded-md px-2 py-0.5 font-semibold hover:bg-amber-500/15", focusRing)}
          >
            Resume
          </button>
        </div>
      )}

      <div className={cx("relative flex min-h-0 flex-1", sideVisible && "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]")}>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
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
            onPin={pin}
            {...(retry ? { onRetry: retry } : {})}
            onStop={actions.stop}
            {...(props.ratings && answer ? { rating: props.ratings.get(answer.answer_id), onRate: rate } : {})}
            compact={compact}
            autoAnswer={live.settings.auto_answer}
            progress={keyPoints?.progress ?? null}
            {...(keyPoints ? { onTogglePoint: keyPoints.toggle } : {})}
            reader={reader}
            {...(canResize ? { onShorter, onLonger } : {})}
            {...(offerLanguage ? { onCodeLanguage: codeLanguage } : {})}
          />
          </>
          )}
        </main>

        {sideVisible && (
          // Wide: a column beside the answer. Phone: a sheet over the answer (the controls stay reachable below).
          <aside
            id={sideId}
            aria-label="Transcript, chat and reading"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !wide) setSideOpen(false);
            }}
            className="absolute inset-0 z-20 flex min-h-0 animate-fade-in flex-col bg-white dark:bg-zinc-950 md:static md:z-auto md:animate-none md:border-l md:border-zinc-200 md:dark:border-white/[0.06]"
          >
            <div className="flex items-center gap-1 border-b border-zinc-200 px-2 py-2 dark:border-white/[0.06]">
              <div role="tablist" aria-label="Session panels" className="flex gap-1">
                {SIDE_TABS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={sideTab === id}
                    onClick={() => setSideTab(id)}
                    className={cx(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                      sideTab === id
                        ? "bg-indigo-500/10 text-indigo-700 ring-1 ring-indigo-500/25 dark:text-indigo-200"
                        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
                      focusRing,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSideOpen(false)}
                aria-label="Hide panel"
                title="Hide panel"
                className={cx(
                  "ml-auto rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-white/5 dark:hover:text-zinc-200",
                  focusRing,
                )}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {sideTab === "transcript" && (
              <TranscriptView turns={turns} onCorrectSpeaker={actions.correctSpeaker} />
            )}
            {sideTab === "chat" && <ChatLog live={live} />}
            {sideTab === "reading" && <Teleprompter answer={answer} />}
            {sideTab === "chat" && <ChatInput ref={chatRef} onSend={actions.chat} disabled={ended} />}
          </aside>
        )}
      </div>

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

      {/* Practice mode: no answer/screenshot/chat controls (Orbit never answers for you); End is in the header in
          either mode. */}
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
        chatOpen={chatShowing}
        onAnswer={() => actions.answer()}
        onScreenshot={props.onScreenshot}
        screenshotUnavailableReason={props.screenshotUnavailableReason}
        onToggleChat={toggleChat}
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
  onBuyMinutes,
  onDismiss,
}: {
  live: LiveViewState;
  onReconnect?: () => void;
  /** End another live session of this account (one live session at a time), so this one can connect. */
  onEndOtherSession?: (sessionId: string) => Promise<void>;
  onBuyMinutes?: () => void;
  onDismiss: () => void;
}) {
  const items: Array<{ key: string; tone: "warn" | "error"; text: string; action?: ReactNode }> = [];
  const buy = (label: string) =>
    onBuyMinutes ? (
      <button type="button" onClick={onBuyMinutes} className={cx("shrink-0 font-medium underline", focusRing)}>
        {label}
      </button>
    ) : undefined;
  // Out of minutes before connecting (the ticket was refused with 402): reconnecting can't help, buying can.
  const outOfMinutes = live.connectionInfo?.code === "http_402";

  const other = live.connectionInfo?.code === "live_session_active" ? live.connectionInfo.sessionId : undefined;
  if (live.connection === "closed" && live.state !== "ended" && live.connectionDetail && other && onEndOtherSession) {
    items.push({
      key: "conn",
      tone: "error",
      text: live.connectionDetail,
      action: <EndOtherButton onEnd={() => onEndOtherSession(other)} onDone={onReconnect} />,
    });
  } else if (live.connection === "closed" && live.state !== "ended" && live.connectionDetail && outOfMinutes) {
    items.push({ key: "conn", tone: "error", text: live.connectionDetail, action: buy("Buy minutes") });
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
          ? "This session reached the time limit and has ended. Start a new session to continue."
          : "You've run out of interview minutes, so the session has ended. Your transcript is saved in History.",
      ...(live.usage.reason === "session" ? {} : { action: buy("Buy minutes") }),
    });
  else if (live.usage && live.state !== "ended") {
    const n = Math.max(1, Math.round(live.usage.minutesRemaining));
    items.push({
      key: "usage",
      tone: "warn",
      text:
        live.usage.reason === "session"
          ? `${n} minute${n === 1 ? "" : "s"} left in this session — it ends automatically at the time limit.`
          : `${n} interview minute${n === 1 ? "" : "s"} left — the session ends when they run out.`,
      ...(live.usage.reason === "session" ? {} : { action: buy("Buy more") }),
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
  const lastAnswer = last?.kind === "answer" ? live.answers[last.answer_id]?.answer : undefined;
  const lastLen = lastAnswer ? lastAnswer.talking_points.length + (lastAnswer.code?.content.length ?? 0) : 0;
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
      {/* "Give me the code" in chat: the reply's code, not just its words */}
      {a.code?.content && (
        <div className="pt-1.5">
          <CodeBlock code={a.code} />
        </div>
      )}
      {(a.time_complexity || a.space_complexity) && (
        <p className="text-xs text-zinc-500">
          {[a.time_complexity && `Time ${a.time_complexity}`, a.space_complexity && `Space ${a.space_complexity}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
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
