import { useMemo, useRef, useState, type ReactNode } from "react";
import { DEV_FIXTURES } from "@orbit/types";
import { formatElapsed, useElapsed } from "../hooks/useElapsed";
import { useStickyScroll } from "../hooks/useStickyScroll";
import { DEFAULT_HOTKEYS, useHotkeys, type HotkeyMap } from "../live/hotkeys";
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
import { cx, focusRing } from "./cx";
import { QuestionCard } from "./QuestionCard";
import { StatusPill } from "./StatusPill";
import { Teleprompter } from "./Teleprompter";
import { TranscriptView } from "./TranscriptView";

export type PanelMode = "compact" | "expanded";
type SideTab = "transcript" | "chat" | "reading";

export interface LivePanelProps {
  live: LiveViewState;
  actions: LiveActions;
  mode: PanelMode;
  onModeChange: (mode: PanelMode) => void;
  onEnd: () => void;
  onReconnect?: () => void;
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
      answer: () => !ended && actions.answer(),
      clear: () => !ended && actions.clear(),
      toggleListening: () => !ended && actions.togglePause(),
      focusChat,
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
        className="flex select-none items-center gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800"
      >
        <span data-tauri-drag-region={props.dragRegion ? "" : undefined} className="text-sm font-semibold tracking-tight">
          {compact ? "" : (props.title ?? "Orbit")}
        </span>
        <StatusPill state={live.state} connection={live.connection} />
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
          className={cx("rounded px-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800", focusRing)}
        >
          {compact ? "⤢" : "⤡"}
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

      <Banners live={live} onReconnect={props.onReconnect} onDismiss={actions.dismissError} />
      {props.notice}

      <div className={cx("flex min-h-0 flex-1", !compact && "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]")}>
        <main className="flex min-h-0 flex-1 flex-col">
          <QuestionCard question={question} liveTurn={liveInterviewerTurn} compact={compact} />
          <div className="mx-4 border-t border-zinc-100 dark:border-zinc-900" />
          <AnswerCard
            answer={answer}
            pinned={Boolean(answer && live.pinnedAnswerId === answer.answer_id)}
            onPin={(pinned) => answer && actions.pin(answer.answer_id, pinned)}
            onRetry={retry}
            compact={compact}
            autoAnswer={live.settings.auto_answer}
          />
        </main>

        {!compact && (
          <aside className="hidden min-h-0 flex-col border-l border-zinc-200 dark:border-zinc-800 md:flex">
            <div role="tablist" aria-label="Session panels" className="flex gap-1 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
              {(["transcript", "chat", "reading"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={sideTab === tab}
                  onClick={() => setSideTab(tab)}
                  className={cx(
                    "rounded-md px-2.5 py-1 text-xs font-medium capitalize",
                    sideTab === tab ? "bg-zinc-100 dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-dashed border-zinc-200 px-4 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-800">
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
              className="rounded bg-transparent text-[11px]"
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

      <ControlBar
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
      />

      {props.overlay}
    </div>
  );
}

function Banners({
  live,
  onReconnect,
  onDismiss,
}: {
  live: LiveViewState;
  onReconnect?: () => void;
  onDismiss: () => void;
}) {
  const items: Array<{ key: string; tone: "warn" | "error"; text: string; action?: ReactNode }> = [];

  if (live.connection === "closed" && live.state !== "ended" && live.connectionDetail) {
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
  if (live.lastError)
    items.push({
      key: "err",
      tone: "error",
      text: live.lastError.message,
      action: (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className={cx("px-1", focusRing)}>
          ×
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
          <li key={entry.id} className="ml-8 rounded-lg bg-indigo-600 px-3 py-2 text-white">
            {entry.text}
          </li>
        ) : (
          <li key={entry.id} className="mr-4 rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
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
