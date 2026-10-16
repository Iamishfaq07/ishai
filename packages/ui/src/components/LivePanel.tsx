import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEV_FIXTURES,
  type AnswerFeedbackReason,
  type AnswerLength,
  type AnswerRating,
  type AnswerSize,
  type CodingLanguage,
} from "@orbit/types";
import { formatElapsed, useElapsed } from "../hooks/useElapsed";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useStickyScroll } from "../hooks/useStickyScroll";
import { resizeTarget } from "../live/answerSize";
import { currentRun, nudgeFor } from "../live/deliveryNudge";
import { DEFAULT_HOTKEYS, useHotkeys, type HotkeyMap } from "../live/hotkeys";
import { CODING_LANGUAGES } from "../live/preferences";
import { historyLabel, useAnswerHistory, type AnswerHistory } from "../live/useAnswerHistory";
import { useInterviewerVoice, voiceLanguage } from "../live/useInterviewerVoice";
import type { NaturalVoiceSource } from "../live/naturalVoice";
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
import { MockPanel, type CameraCoach } from "./MockPanel";
import { cx, focusRing } from "./cx";
import { QuestionCard } from "./QuestionCard";
import { StatusPill } from "./StatusPill";
import { OrbitalVisualizer, orbitalState } from "./OrbitalVisualizer";
import { DeviceCaptureHealthPill, type CaptureHealth } from "./DeviceCaptureHealthPill";
import { Teleprompter } from "./Teleprompter";
import { TranscriptView } from "./TranscriptView";
import { HeardBar } from "./HeardBar";
import { useBargeIn } from "../live/bargeIn";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Gauge,
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
import { safeLocal } from "../storage";

export type PanelMode = "compact" | "expanded";
type SideTab = "transcript" | "chat" | "reading";

const SIDE_TABS: Array<{ id: SideTab; label: string; icon: LucideIcon }> = [
  { id: "transcript", label: "Transcript", icon: ScrollText },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "reading", label: "Reading", icon: BookOpen },
];

const SIDE_PANEL_KEY = "orbit.sidePanel";

/** The session timer on its own: its once-a-second tick re-renders this, not the whole panel. */
function SessionClock({ startedAt, running, dragRegion }: { startedAt: number | null; running: boolean; dragRegion?: boolean }) {
  const elapsed = useElapsed(startedAt, running);
  return (
    <span
      data-tauri-drag-region={dragRegion ? "" : undefined}
      className="ml-auto shrink-0 font-mono text-xs tabular-nums text-zinc-500"
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
      return safeLocal.getItem(SIDE_PANEL_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const [narrowOpen, setNarrowOpen] = useState(false);
  const set = (open: boolean) => {
    if (!wide) return setNarrowOpen(open);
    setWideOpen(open);
    try {
      safeLocal.setItem(SIDE_PANEL_KEY, open ? "open" : "closed");
    } catch {
      // storage unavailable — still applies for this session
    }
  };
  return [wide ? wideOpen : narrowOpen, set];
}

/** The mock interviewer's voice muted: kept across sessions, on this device. */
const MUTE_KEY = "orbit.interviewerMuted";

export interface LivePanelProps {
  analyser?: AnalyserNode;
  audioAmplitude?: () => number;
  captureHealth?: CaptureHealth;
  screenCaptureHealth?: CaptureHealth;
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
  /** Open the session's transcript and review, offered once a mock round is over. */
  onViewReport?: () => void;
  onScreenshot?: () => void;
  screenshotUnavailableReason?: string;
  loadWalkthrough?: (answerId: string) => Promise<NonNullable<import("@orbit/types").LiveAnswer["walkthrough"]>>;
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
  /** The interviewer's natural voice (useNaturalVoiceSource); null or absent = the device's voice. */
  naturalVoice?: NaturalVoiceSource | null;
  /** A mock's practice language ("en", "hi", "hinglish"): which device voice reads the questions. */
  practiceLanguage?: string;
  /** The camera coach for mock rounds (web, when the server has it on). */
  cameraCoach?: CameraCoach;
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
    () => (live.mock && !live.mockCompleted
      ? { id: live.mock.questionId, text: live.mock.text, ...(live.mock.speaker ? { speaker: live.mock.speaker.persona } : {}) }
      : null),
    [live.mock, live.mockCompleted],
  );
  const [voiceMuted, setVoiceMuted] = useState(() => safeLocal.getItem(MUTE_KEY) === "1");
  const changeMuted = useCallback((m: boolean) => {
    setVoiceMuted(m);
    safeLocal.setItem(MUTE_KEY, m ? "1" : "0");
  }, []);
  const voice = useInterviewerVoice(mockQuestion, {
    enabled: Boolean(props.mockInterview) && !voiceMuted,
    natural: props.naturalVoice ?? null,
    lang: voiceLanguage(props.practiceLanguage),
  });
  const { onInterviewerSpeaking } = props;
  const reader = useReadAloud();
  const selfSpeaking = voice.speaking || reader.status === "playing";
  useEffect(() => onInterviewerSpeaking?.(selfSpeaking), [selfSpeaking, onInterviewerSpeaking]);
  // Barge-in: talking over the AI's voice stops it (speech synthesis can't be turned down mid-sentence), so the mic
  // goes back to the transcriber at once, and the core shows an emerald listening ring for a moment.
  const [heard, setHeard] = useState(false);
  useBargeIn({
    active: selfSpeaking,
    analyser: props.analyser,
    amplitude: props.audioAmplitude,
    onBargeIn: () => {
      voice.stop();
      reader.stop();
      setHeard(true);
    },
  });
  useEffect(() => {
    if (!heard) return;
    const t = window.setTimeout(() => setHeard(false), 2000);
    return () => window.clearTimeout(t);
  }, [heard]);
  // Chat replies and screenshot answers aren't spoken to the interviewer: no checklist for those.
  const keyPoints = useKeyPointProgress(live, answer && (answer.source === "auto" || answer.source === "manual")
    ? answer : null);
  const answerHistory = useAnswerHistory(live, actions);
  const { step } = answerHistory;
  const turns = useMemo(
    // The interviewer's voice heard by the mic is dropped: it read as "You: <their question>".
    () => live.turnOrder.map((id) => live.turns[id]).filter((t): t is TurnView => Boolean(t) && !t?.echo),
    [live.turnOrder, live.turns],
  );
  // Practice: the candidate's own turn while it's still being transcribed, shown as "Orbit heard…".
  const liveCandidateText = useMemo(() => {
    const t = turns[turns.length - 1];
    return props.mockInterview && t && t.speaker === "candidate" && !t.final ? t.text : "";
  }, [turns, props.mockInterview]);
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

  // "Shorter" / "Longer" / "Simpler": re-ask the same question. Only for spoken answers to a question (not chat
  // replies or screenshots), and not while one is still streaming. A fixed length steps (and keeps) the session's
  // length; on "auto" only this answer gets the next size, and the next question is sized on its own again.
  const canResize = Boolean(
    answer && againVia === "answer" && againText !== undefined && !screenshot && !ended && answer.status === "complete" &&
      (source === "auto" || source === "manual"),
  );
  const answerSize = answer?.size;
  const shorter = resizeTarget(live.settings.length, answerSize, -1);
  const longer = resizeTarget(live.settings.length, answerSize, 1);
  // As plain values, so the callbacks below (and the memoized card) only change when the target does.
  const shorterLength = shorter && "length" in shorter ? shorter.length : undefined;
  const shorterSize = shorter && "size" in shorter ? shorter.size : undefined;
  const longerLength = longer && "length" in longer ? longer.length : undefined;
  const longerSize = longer && "size" in longer ? longer.size : undefined;
  const resizeTo = useCallback(
    (length: AnswerLength | undefined, size: AnswerSize | undefined) => {
      if ((!length && !size) || againVia !== "answer" || againText === undefined) return null;
      return () => {
        followLive();
        if (size) {
          actions.answer(againText, { size });
        } else if (length) {
          actions.setLength(length);
          actions.answer(againText); // same socket, in order: the new length applies to this answer
        }
      };
    },
    [actions, againText, againVia, followLive],
  );
  const onShorter = useMemo(() => resizeTo(shorterLength, shorterSize), [resizeTo, shorterLength, shorterSize]);
  const onLonger = useMemo(() => resizeTo(longerLength, longerSize), [resizeTo, longerLength, longerSize]);
  const onSimpler = useMemo(() => {
    if (againVia !== "answer" || againText === undefined) return null;
    return () => {
      followLive();
      actions.answer(againText, { simpler: true, ...(answerSize ? { size: answerSize } : {}) });
    };
  }, [actions, againText, againVia, answerSize, followLive]);
  const mockStt = live.providers.stt?.state === "mock";

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* One row that never pushes its buttons out of view (on a phone, End is a mock's only way to stop): the clock
          and the buttons keep their size, and the status pill truncates when even that is too much (320 px). The title
          is left to screen readers on phones and in the compact overlay: there "Reconnecting…" matters more. */}
      <header
        data-tauri-drag-region={props.dragRegion ? "" : undefined}
        className="flex select-none items-center gap-1.5 border-b border-zinc-200 px-3 py-2.5 dark:border-white/[0.06] sm:gap-2.5 sm:px-4"
      >
        <span className={cx("shrink-0 rounded-full", heard && "listen-ring")}>
          <OrbitalVisualizer size={compact ? 30 : 42} state={heard ? "listening" : orbitalState(live.state)} analyser={props.analyser} amplitude={props.audioAmplitude} />
        </span>
        {(compact || !wide) && <h1 className="sr-only">{props.title ?? "Orbit"}</h1>}
        {!compact && wide && (
          <h1
            data-tauri-drag-region={props.dragRegion ? "" : undefined}
            className="max-w-[40%] truncate font-display text-sm font-semibold tracking-tight"
          >
            {props.title ?? "Orbit"}
          </h1>
        )}
        <StatusPill state={live.state} connection={live.connection} stt={live.providers.stt?.state} />
        {!compact && props.captureHealth && <DeviceCaptureHealthPill audio={paused || ended ? "muted" : props.captureHealth} screen={props.screenCaptureHealth} />}
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
              "shrink-0 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-white/5 dark:hover:text-zinc-200",
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
          className={cx("shrink-0 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-white/5 dark:hover:text-zinc-200", focusRing)}
        >
          {compact ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
        </button>
        {/* Mocks have no control bar, so End lives here in both modes (the only way to stop a mock early). */}
        {(compact || props.mockInterview) && (
          <button
            type="button"
            onClick={props.onEnd}
            disabled={ended}
            className={cx("shrink-0 rounded px-1.5 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:text-rose-400 dark:hover:bg-rose-950/40", focusRing)}
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
      {props.notice && <div className="max-h-[40vh] shrink-0 overflow-y-auto">{props.notice}</div>}

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
            <>
              {liveCandidateText && <HeardBar text={liveCandidateText} className="mx-3 mt-3 sm:mx-4" />}
              <MockPanel
                live={live}
                actions={actions}
                voice={voice}
                ended={ended}
                muted={voiceMuted}
                onMutedChange={changeMuted}
                {...(props.cameraCoach ? { cameraCoach: props.cameraCoach } : {})}
                {...(props.onViewReport ? { onViewReport: props.onViewReport } : {})}
              />
            </>
          ) : (
          <>
          <QuestionCard question={question} liveTurn={liveInterviewerTurn} compact={compact} />
          <div className="mx-4 h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent dark:via-white/10" />
          {answerHistory.liveIndex > 0 && !live.pinnedAnswerId && <HistoryNav nav={answerHistory} />}
          <AnswerCard
            answer={answer}
            {...(props.loadWalkthrough ? { loadWalkthrough: props.loadWalkthrough } : {})}
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
            {...(canResize ? { onShorter, onLonger, onSimpler } : {})}
            {...(offerLanguage ? { onCodeLanguage: codeLanguage } : {})}
          />
          <DeliveryNudge live={live} active={!ended && !paused} />
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
            {sideTab === "chat" && <ChatLog live={live} {...(!ended ? { onAsk: actions.chat } : {})} />}
            {sideTab === "reading" && <Teleprompter answer={answer} />}
            {sideTab === "chat" && <ChatInput ref={chatRef} onSend={actions.chat} disabled={ended} />}
          </aside>
        )}
      </div>

      {mockStt && !ended && (
        <div className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-dashed border-zinc-200 px-4 py-1.5 text-xs text-zinc-500 dark:border-zinc-800">
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

/**
 * A quiet coaching line while you answer (live/deliveryNudge.ts): running long, speaking fast, or a lot of "um"s.
 * It goes once you've stopped talking for a while, and "Hide" turns it off for the rest of the session.
 */
function DeliveryNudge({ live, active }: { live: LiveViewState; active: boolean }) {
  const run = currentRun(live);
  const nudge = nudgeFor(run);
  const signature = run ? `${run.turnIds.join(",")}:${run.words}` : "";
  const [changedAt, setChangedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setChangedAt(Date.now());
  }, [signature]);
  useEffect(() => {
    if (!nudge || hidden) return;
    const id = window.setInterval(() => setNow(Date.now()), 3000);
    return () => window.clearInterval(id);
  }, [nudge, hidden]);
  if (!active || hidden || !nudge || now - changedAt > 12_000) return null;
  return (
    <div
      role="status"
      className="mx-4 mb-3 flex animate-fade-in items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-200"
    >
      <Gauge className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
      <span className="min-w-0 flex-1">{nudge.text}</span>
      <button
        type="button"
        onClick={() => setHidden(true)}
        title="Hide delivery tips for this session"
        aria-label="Hide delivery tips for this session"
        className={cx("rounded p-0.5 hover:bg-amber-500/15", focusRing)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
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
  const reconnect = onReconnect ? (
    <button type="button" onClick={onReconnect} className={cx("shrink-0 font-medium underline", focusRing)}>
      Reconnect
    </button>
  ) : undefined;
  // Out of minutes before connecting (the ticket was refused with 402): buying helps, and Reconnect then picks the
  // session up (minutes bought in another tab don't reconnect this one by themselves).
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
    items.push({
      key: "conn",
      tone: "error",
      text: live.connectionDetail,
      action: (
        <span className="flex shrink-0 items-center gap-3">
          {buy("Buy minutes")}
          {reconnect}
        </span>
      ),
    });
  } else if (live.connection === "closed" && live.state !== "ended" && live.connectionDetail) {
    items.push({ key: "conn", tone: "error", text: live.connectionDetail, action: reconnect });
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

function ChatLog({ live, onAsk }: { live: LiveViewState; onAsk?: (text: string) => void }) {
  // Follow new replies like the transcript does: key on the chat's length, how much of the last reply has streamed
  // (replies are mostly prose), and its status and the "no reply" notes, which add a line.
  const last = live.chat[live.chat.length - 1];
  const lastReply = last?.kind === "answer" ? live.answers[last.answer_id] : undefined;
  const a = lastReply?.answer;
  const lastLen = a
    ? a.direct_answer.length + a.talking_points.reduce((n, p) => n + p.length, 0) + (a.code?.content.length ?? 0)
    : 0;
  const notes = live.chat.reduce((n, c) => n + (c.kind === "user" && c.unanswered ? 1 : 0), 0);
  const { ref, onScroll } = useStickyScroll<HTMLOListElement>(`${live.chat.length}:${lastLen}:${lastReply?.status}:${notes}`);
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
          <li key={entry.id} className="ml-8">
            <p className="rounded-2xl rounded-br-md bg-gradient-to-br from-indigo-500 to-indigo-700 px-3.5 py-2 text-white shadow-glow-sm">
              {entry.text}
            </p>
            {entry.unanswered && (
              <p className="mt-1 text-right text-xs text-rose-600 dark:text-rose-400">
                {entry.unanswered.reason}{" "}
                {onAsk && entry.unanswered.retryable && <ChatAction onClick={() => onAsk(entry.text)}>Send again</ChatAction>}
              </p>
            )}
          </li>
        ) : (
          <li key={entry.id} className="mr-4 rounded-2xl rounded-bl-md bg-zinc-100 px-3.5 py-2 ring-1 ring-zinc-200 dark:bg-white/[0.04] dark:ring-white/[0.06]">
            <ChatAnswer answer={live.answers[entry.answer_id]} {...(onAsk ? { onAsk } : {})} />
          </li>
        ),
      )}
    </ol>
  );
}

function ChatAction({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className={cx("font-medium underline", focusRing)}>
      {children}
    </button>
  );
}

/** Why a chat reply stopped early, said in its bubble (it used to stay on "Thinking…" when nothing had come yet). */
function stoppedNote(answer: AnswerView): string {
  if (answer.cancel_reason === "superseded") {
    return answer.has_content ? "Stopped part-way: a newer question took over." : "Stopped: a newer question took over.";
  }
  if (answer.cancel_reason === "session_ended") return "Stopped: the session ended.";
  return answer.has_content ? "Stopped part-way." : "Stopped.";
}

function ChatAnswer({ answer, onAsk }: { answer: AnswerView | undefined; onAsk?: (text: string) => void }) {
  if (!answer) return null;
  // Asking again sends the same message (a reply's message is known only on the computer that sent it).
  const askAgain = onAsk && answer.prompt ? () => onAsk(answer.prompt as string) : undefined;
  if (answer.status === "failed") {
    return (
      <span className="text-rose-600 dark:text-rose-400">
        {answer.error?.message ?? "Failed."}{" "}
        {askAgain && answer.error?.retryable !== false && <ChatAction onClick={askAgain}>Try again</ChatAction>}
      </span>
    );
  }
  if (!answer.has_content) {
    if (answer.status === "cancelled") {
      return (
        <span className="text-zinc-500">
          {stoppedNote(answer)} {askAgain ? <ChatAction onClick={askAgain}>Ask again</ChatAction> : "Ask again."}
        </span>
      );
    }
    return <span className="text-zinc-500">Thinking…</span>;
  }
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
      {answer.status === "cancelled" && <p className="text-xs text-zinc-500">{stoppedNote(answer)}</p>}
    </div>
  );
}

/** "‹ 3 of 5 ›" through earlier answers, with a way back to the live one. */
function HistoryNav({ nav }: { nav: AnswerHistory }) {
  const navBtn = cx(
    "inline-flex items-center rounded-md px-1 py-0.5 text-sm text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800",
    focusRing,
  );
  return (
    <div className="flex animate-fade-in items-center gap-1 px-4 pt-2 text-xs text-zinc-500 dark:text-zinc-400">
      <button type="button" className={navBtn} onClick={() => nav.step(-1)} disabled={!nav.canPrev}
              title="Previous answer (Alt+←)" aria-label="Previous answer">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="tabular-nums" aria-live="polite">
        {historyLabel(nav)}
      </span>
      <button type="button" className={navBtn} onClick={() => nav.step(1)} disabled={!nav.canNext}
              title="Next answer (Alt+→)" aria-label="Next answer">
        <ChevronRight className="h-4 w-4" />
      </button>
      <span className="flex-1" />
      {nav.browsing && (
        <button
          type="button"
          onClick={nav.backToLive}
          className={cx(
            "flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
            nav.newAnswer
              ? "animate-fade-up bg-indigo-600 text-white hover:bg-indigo-500"
              : "text-indigo-700 hover:bg-indigo-500/10 dark:text-indigo-300",
            focusRing,
          )}
        >
          <span className={cx("h-1.5 w-1.5 rounded-full", nav.newAnswer ? "animate-ping bg-white" : "bg-emerald-500")} />
          {nav.newAnswer ? "New answer — back to live" : "Back to live"}
        </button>
      )}
    </div>
  );
}
