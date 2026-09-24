import type { AnswerLength, AnswerStyle, ResponseTiming, ThinkingLevel } from "@orbit/types";
import { formatHotkey, type HotkeyMap } from "../live/hotkeys";
import { ANSWER_STYLES, RESPONSE_TIMINGS, THINKING_LEVELS } from "../live/preferences";
import { cx, focusRing } from "./cx";

export interface ControlBarProps {
  length: AnswerLength;
  autoAnswer: boolean;
  responseTiming: ResponseTiming;
  style: AnswerStyle;
  thinking: ThinkingLevel;
  paused: boolean;
  ended: boolean;
  hotkeys: HotkeyMap;
  compact?: boolean;
  chatOpen: boolean;
  onAnswer: () => void;
  onScreenshot?: () => void;
  /** Shown as a tooltip when screenshots aren't available on this platform/server. */
  screenshotUnavailableReason?: string;
  onToggleChat: () => void;
  onClear: () => void;
  onLength: (length: AnswerLength) => void;
  onAutoAnswer: (on: boolean) => void;
  onResponseTiming: (timing: ResponseTiming) => void;
  onStyle: (style: AnswerStyle) => void;
  onThinking: (level: ThinkingLevel) => void;
  onTogglePause: () => void;
  onEnd: () => void;
}

const LENGTHS: Array<{ value: AnswerLength; label: string; hint: string }> = [
  { value: "short", label: "30s", hint: "Short — about 20–30 seconds of speaking" },
  { value: "standard", label: "60s", hint: "Standard — about 45–75 seconds" },
  { value: "detailed", label: "Detailed", hint: "Detailed — about 90–150 seconds" },
];

const btn =
  "inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const ghost = "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800";
const miniSelect =
  "rounded-md bg-transparent py-1 pl-1 pr-5 text-[11px] font-medium text-zinc-600 disabled:opacity-40 dark:text-zinc-300";

export function ControlBar(props: ControlBarProps) {
  const { hotkeys, ended } = props;
  const screenshotDisabled = !props.onScreenshot || ended;

  return (
    <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={props.onAnswer}
          disabled={ended}
          title={`Answer now (${formatHotkey(hotkeys.answer)})`}
          className={cx(btn, "bg-indigo-600 text-white hover:bg-indigo-500", focusRing)}
        >
          Answer
        </button>
        <span title={screenshotDisabled ? props.screenshotUnavailableReason : undefined}>
          <button
            type="button"
            onClick={props.onScreenshot}
            disabled={screenshotDisabled}
            title={screenshotDisabled ? undefined : `Screenshot (${formatHotkey(hotkeys.screenshot)})`}
            className={cx(btn, ghost, focusRing)}
          >
            Screenshot
          </button>
        </span>
        <button
          type="button"
          onClick={props.onToggleChat}
          aria-pressed={props.chatOpen}
          disabled={ended}
          title={`Chat (${formatHotkey(hotkeys.focusChat)})`}
          className={cx(btn, ghost, props.chatOpen && "bg-zinc-100 dark:bg-zinc-800", focusRing)}
        >
          Chat
        </button>
        <button
          type="button"
          onClick={props.onClear}
          disabled={ended}
          title={`Clear (${formatHotkey(hotkeys.clear)})`}
          className={cx(btn, ghost, focusRing)}
        >
          Clear
        </button>
        {props.compact && (
          <span className="ml-auto">
            <AutoSwitch on={props.autoAnswer} disabled={ended} onChange={props.onAutoAnswer} />
          </span>
        )}
      </div>

      {!props.compact && (
        <div className="mt-1.5 flex items-center gap-1">
          <div role="radiogroup" aria-label="Answer length" className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
            {LENGTHS.map((l) => (
              <button
                key={l.value}
                type="button"
                role="radio"
                aria-checked={props.length === l.value}
                title={l.hint}
                disabled={ended}
                onClick={() => props.onLength(l.value)}
                className={cx(
                  "rounded-md px-2 py-1 text-[11px] font-medium",
                  props.length === l.value
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
                  focusRing,
                )}
              >
                {l.label}
              </button>
            ))}
          </div>

          <AutoSwitch on={props.autoAnswer} disabled={ended} onChange={props.onAutoAnswer} />
          <select
            aria-label="Wait before answering"
            title={
              props.autoAnswer
                ? RESPONSE_TIMINGS.find((t) => t.value === props.responseTiming)?.hint
                : "Only applies to auto answer"
            }
            value={props.responseTiming}
            disabled={ended || !props.autoAnswer}
            onChange={(e) => props.onResponseTiming(e.target.value as ResponseTiming)}
            className={cx(miniSelect, focusRing)}
          >
            {RESPONSE_TIMINGS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Answer style"
            title={ANSWER_STYLES.find((s) => s.value === props.style)?.hint ?? "Answer style"}
            value={ANSWER_STYLES.some((s) => s.value === props.style) ? props.style : "natural"}
            disabled={ended}
            onChange={(e) => props.onStyle(e.target.value as AnswerStyle)}
            className={cx(miniSelect, focusRing)}
          >
            {ANSWER_STYLES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Thinking"
            title={THINKING_LEVELS.find((t) => t.value === props.thinking)?.hint}
            value={props.thinking}
            disabled={ended}
            onChange={(e) => props.onThinking(e.target.value as ThinkingLevel)}
            className={cx(miniSelect, focusRing)}
          >
            {THINKING_LEVELS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={props.onTogglePause}
              disabled={ended}
              title={`${props.paused ? "Resume" : "Pause"} listening (${formatHotkey(hotkeys.toggleListening)})`}
              className={cx(btn, ghost, focusRing)}
            >
              {props.paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={props.onEnd}
              disabled={ended}
              className={cx(btn, "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50", focusRing)}
            >
              End
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Auto answer on/off. Off = click-to-answer: nothing is generated until Answer (or its hotkey) is pressed. */
function AutoSwitch({ on, disabled, onChange }: { on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      title={on ? "Auto answer: answers detected questions automatically" : "Click to answer: press Answer when ready"}
      className={cx(btn, ghost, "gap-1.5", focusRing)}
    >
      <span
        aria-hidden="true"
        className={cx(
          "relative inline-block h-3.5 w-6 shrink-0 rounded-full transition-colors",
          on ? "bg-indigo-500" : "bg-zinc-300 dark:bg-zinc-700",
        )}
      >
        <span
          className={cx(
            "absolute left-0 top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform motion-reduce:transition-none",
            on ? "translate-x-3" : "translate-x-0.5",
          )}
        />
      </span>
      Auto
    </button>
  );
}
