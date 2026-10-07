import { useEffect, useId, useState, type ReactNode } from "react";
import type { AnswerLength, AnswerStyle, ResponseTiming, ThinkingLevel } from "@orbit/types";
import { formatHotkey, type HotkeyMap } from "../live/hotkeys";
import { ANSWER_STYLES, RESPONSE_TIMINGS, THINKING_LEVELS } from "../live/preferences";
import { Camera, ChevronDown, Eraser, Info, MessageSquare, Pause, Play, SlidersHorizontal, Square, Wand2, X } from "../icons";
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
  /** The chat is showing (Chat button pressed). */
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
  { value: "auto", label: "Auto", hint: "Auto — sized to each question: a sentence or two for a quick one, more for a deep one" },
  { value: "short", label: "30s", hint: "Short — about 20–30 seconds of speaking" },
  { value: "standard", label: "60s", hint: "Standard — about 45–75 seconds" },
  { value: "detailed", label: "Detailed", hint: "Detailed — about 90–150 seconds" },
];

/** "Thinking off" → "Off": the setting's own caption already says "Thinking". */
const THINKING_SHORT: Record<ThinkingLevel, string> = { off: "Off", low: "Low", high: "High", max: "Max" };

const SETTINGS_KEY = "orbit.liveSettingsOpen";

/** Remembered per device; the first time, open on wide screens and folded on phones (where it'd crowd the answer). */
function loadSettingsOpen(): boolean {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) return saved !== "closed";
  } catch {
    // storage unavailable — fall through to the default
  }
  return typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 640px)").matches;
}

const btn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const ghost = "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/5";
const pressed = "bg-indigo-500/10 text-indigo-700 ring-1 ring-indigo-500/25 dark:text-indigo-200";
const selectCls =
  "appearance-none rounded-lg border border-zinc-200 bg-white py-1 pl-2 pr-6 text-xs font-medium text-zinc-800 hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-100 dark:hover:border-white/20";

/**
 * The live session's bottom bar, in two rows:
 * 1. Actions — Answer, Screenshot, Chat, Clear … Settings, Pause, End.
 * 2. Answer settings — every control is labelled, and "What do these do?" explains each option in place (tooltips
 *    don't exist on touch screens). The settings row can be folded away and remembers that per device.
 */
export function ControlBar(props: ControlBarProps) {
  const { hotkeys, ended } = props;
  const screenshotDisabled = !props.onScreenshot || ended;
  const [settingsOpen, setSettingsOpen] = useState(loadSettingsOpen);
  const [helpOpen, setHelpOpen] = useState(false);
  const settingsId = useId();

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, settingsOpen ? "open" : "closed");
    } catch {
      // storage unavailable — the choice still applies for this session
    }
  }, [settingsOpen]);

  return (
    <div className="border-t border-zinc-200 px-3 py-2 dark:border-white/[0.06]">
      {/* Wraps rather than pushing End out of view when even the icon-only phone layout doesn't fit (320 px, or the
          large text size). */}
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={props.onAnswer}
          disabled={ended}
          title={`Answer now (${formatHotkey(hotkeys.answer)})`}
          className={cx(
            btn,
            "bg-gradient-to-b from-indigo-500 to-indigo-600 px-3 text-white shadow-glow-sm hover:from-indigo-400 hover:to-indigo-500",
            focusRing,
          )}
        >
          <Wand2 className="h-3.5 w-3.5" />
          Answer
        </button>
        <span title={screenshotDisabled ? props.screenshotUnavailableReason : undefined}>
          <ActionButton
            icon={<Camera className="h-3.5 w-3.5" />}
            label="Screenshot"
            compact={props.compact}
            onClick={props.onScreenshot}
            disabled={screenshotDisabled}
            title={screenshotDisabled ? undefined : `Screenshot (${formatHotkey(hotkeys.screenshot)})`}
          />
        </span>
        <ActionButton
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          label="Chat"
            compact={props.compact}
          onClick={props.onToggleChat}
          disabled={ended}
          active={props.chatOpen}
          title={`Chat (${formatHotkey(hotkeys.focusChat)})`}
        />
        <ActionButton
          icon={<Eraser className="h-3.5 w-3.5" />}
          label="Clear"
            compact={props.compact}
          onClick={props.onClear}
          disabled={ended}
          title={`Clear the answer (${formatHotkey(hotkeys.clear)})`}
        />

        <span className="ml-auto flex items-center gap-1">
          {props.compact ? (
            <>
              <button
                type="button"
                onClick={props.onTogglePause}
                disabled={ended}
                aria-pressed={props.paused}
                aria-label={props.paused ? "Resume listening" : "Pause listening"}
                title={`${props.paused ? "Resume" : "Pause"} listening (${formatHotkey(hotkeys.toggleListening)})`}
                className={cx(btn, ghost, props.paused && pressed, focusRing)}
              >
                {props.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </button>
              <AutoSwitch on={props.autoAnswer} disabled={ended} onChange={props.onAutoAnswer} />
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSettingsOpen((o) => !o)}
                aria-expanded={settingsOpen}
                aria-controls={settingsId}
                title={settingsOpen ? "Hide answer settings" : "Show answer settings"}
                className={cx(btn, ghost, settingsOpen && pressed, focusRing)}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Settings</span>
                <span className="sr-only sm:hidden">Answer settings</span>
              </button>
              <ActionButton
                icon={props.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                label={props.paused ? "Resume" : "Pause"}
                onClick={props.onTogglePause}
                disabled={ended}
                title={`${props.paused ? "Resume" : "Pause"} listening (${formatHotkey(hotkeys.toggleListening)})`}
              />
              <button
                type="button"
                onClick={props.onEnd}
                disabled={ended}
                title="End the session"
                className={cx(btn, "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10", focusRing)}
              >
                <Square className="h-3.5 w-3.5" />
                {/* Icon only on phones, like the buttons beside it (it asks before ending). */}
                <span className="hidden sm:inline">End</span>
                <span className="sr-only sm:hidden">End</span>
              </button>
            </>
          )}
        </span>
      </div>

      {!props.compact && settingsOpen && (
        <section
          id={settingsId}
          aria-label="Answer settings"
          className="mt-2 animate-fade-in rounded-xl bg-zinc-50 p-2.5 ring-1 ring-zinc-200 dark:bg-white/[0.03] dark:ring-white/[0.06]"
        >
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2.5">
            <Setting label="Length" labelId={`${settingsId}-length`}>
              <div
                role="radiogroup"
                aria-labelledby={`${settingsId}-length`}
                className="flex rounded-lg bg-zinc-200/60 p-0.5 dark:bg-white/[0.05]"
              >
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
                      "rounded-md px-2 py-0.5 text-xs font-medium",
                      props.length === l.value
                        ? "bg-white text-zinc-900 shadow-sm dark:bg-indigo-500/30 dark:text-white"
                        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
                      focusRing,
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </Setting>

            <Setting label="Auto-answer" labelId={`${settingsId}-auto`}>
              <AutoSwitch
                on={props.autoAnswer}
                disabled={ended}
                onChange={props.onAutoAnswer}
                labelledBy={`${settingsId}-auto`}
              />
            </Setting>

            <Setting label="Wait" labelId={`${settingsId}-wait`}>
              <MiniSelect
                labelledBy={`${settingsId}-wait`}
                title={
                  props.autoAnswer
                    ? RESPONSE_TIMINGS.find((t) => t.value === props.responseTiming)?.hint
                    : "Only applies to auto-answer"
                }
                value={props.responseTiming}
                disabled={ended || !props.autoAnswer}
                onChange={(v) => props.onResponseTiming(v as ResponseTiming)}
                options={RESPONSE_TIMINGS.map((t) => ({ value: t.value, label: t.label }))}
              />
            </Setting>

            <Setting label="Style" labelId={`${settingsId}-style`}>
              <MiniSelect
                labelledBy={`${settingsId}-style`}
                title={ANSWER_STYLES.find((s) => s.value === props.style)?.hint}
                value={ANSWER_STYLES.some((s) => s.value === props.style) ? props.style : "natural"}
                disabled={ended}
                onChange={(v) => props.onStyle(v as AnswerStyle)}
                options={ANSWER_STYLES.map((s) => ({ value: s.value, label: s.label }))}
              />
            </Setting>

            <Setting label="Thinking" labelId={`${settingsId}-thinking`}>
              <MiniSelect
                labelledBy={`${settingsId}-thinking`}
                title={THINKING_LEVELS.find((t) => t.value === props.thinking)?.hint}
                value={props.thinking}
                disabled={ended}
                onChange={(v) => props.onThinking(v as ThinkingLevel)}
                options={THINKING_LEVELS.map((t) => ({ value: t.value, label: THINKING_SHORT[t.value] }))}
              />
            </Setting>

            <button
              type="button"
              onClick={() => setHelpOpen((o) => !o)}
              aria-expanded={helpOpen}
              className={cx(
                "ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-500/10 dark:text-indigo-300",
                focusRing,
              )}
            >
              {helpOpen ? <X className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
              {helpOpen ? "Close help" : "What do these do?"}
            </button>
          </div>

          {helpOpen && (
            <SettingsHelp
              length={props.length}
              autoAnswer={props.autoAnswer}
              responseTiming={props.responseTiming}
              style={props.style}
              thinking={props.thinking}
              answerHotkey={formatHotkey(hotkeys.answer)}
            />
          )}
        </section>
      )}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  title,
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
  /** The small overlay: icon only at any screen size. */
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={cx(btn, ghost, active && pressed, focusRing)}
    >
      {icon}
      {/* Phones and the compact overlay: icon only (the label stays for screen readers). */}
      {compact ? (
        <span className="sr-only">{label}</span>
      ) : (
        <>
          <span className="hidden sm:inline">{label}</span>
          <span className="sr-only sm:hidden">{label}</span>
        </>
      )}
    </button>
  );
}

function Setting({ label, labelId, children }: { label: string; labelId: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      {children}
    </div>
  );
}

function MiniSelect({
  labelledBy,
  title,
  value,
  disabled,
  onChange,
  options,
}: {
  labelledBy: string;
  title?: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <span className="relative inline-flex">
      <select
        aria-labelledby={labelledBy}
        title={title}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cx(selectCls, focusRing)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400"
        aria-hidden="true"
      />
    </span>
  );
}

/** Plain-language guide to every answer setting, with the current choice highlighted. */
function SettingsHelp(props: {
  length: AnswerLength;
  autoAnswer: boolean;
  responseTiming: ResponseTiming;
  style: AnswerStyle;
  thinking: ThinkingLevel;
  answerHotkey: string;
}) {
  const rows: Array<{ term: string; about: string; options: Array<{ label: string; hint: string; current: boolean }> }> = [
    {
      term: "Length",
      about: "How long the suggested answer takes to say out loud.",
      options: LENGTHS.map((l) => ({
        label: l.label,
        hint: l.hint.replace(/^[^—]+— /, ""),
        current: l.value === props.length,
      })),
    },
    {
      term: "Auto-answer",
      about: "Whether Orbit answers on its own when it hears a question.",
      options: [
        { label: "On", hint: "Every complete interviewer question is answered automatically.", current: props.autoAnswer },
        {
          label: "Off",
          hint: `Nothing is generated until you press Answer (${props.answerHotkey}).`,
          current: !props.autoAnswer,
        },
      ],
    },
    {
      term: "Wait",
      about: "With auto-answer on: how long to wait after the interviewer stops talking.",
      options: RESPONSE_TIMINGS.map((t) => ({ label: t.label, hint: t.hint, current: t.value === props.responseTiming })),
    },
    {
      term: "Style",
      about: "How the answer sounds. All styles are first-person, ready to speak.",
      options: ANSWER_STYLES.map((s) => ({ label: s.label, hint: s.hint, current: s.value === props.style })),
    },
    {
      term: "Thinking",
      about: "More thinking gives deeper answers, but the first words appear later.",
      options: THINKING_LEVELS.map((t) => ({
        label: THINKING_SHORT[t.value],
        hint: t.hint,
        current: t.value === props.thinking,
      })),
    },
  ];
  return (
    <dl className="mt-3 grid max-h-[40vh] animate-fade-in gap-3 overflow-y-auto border-t border-zinc-200 pt-3 text-xs sm:grid-cols-2 lg:grid-cols-3 dark:border-white/[0.06]">
      {rows.map((r) => (
        <div key={r.term}>
          <dt className="font-semibold text-zinc-900 dark:text-zinc-100">{r.term}</dt>
          <dd className="mt-0.5 text-zinc-500 dark:text-zinc-400">{r.about}</dd>
          <dd>
            <ul className="mt-1 space-y-0.5">
              {r.options.map((o) => (
                <li
                  key={o.label}
                  className={cx(o.current ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400")}
                >
                  <span className={cx("font-medium", o.current && "text-indigo-600 dark:text-indigo-300")}>
                    {o.label}
                    {o.current && " (current)"}
                  </span>{" "}
                  — {o.hint}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Auto answer on/off. Off = click-to-answer: nothing is generated until Answer (or its hotkey) is pressed. */
function AutoSwitch({
  on,
  disabled,
  onChange,
  labelledBy,
}: {
  on: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
  /** Inside the labelled settings row the switch shows On/Off; alone (compact mode) it reads "Auto". */
  labelledBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!on)}
      title={on ? "Auto answer: answers detected questions automatically" : "Click to answer: press Answer when ready"}
      className={cx(btn, ghost, "px-1.5 py-1", focusRing)}
    >
      <span
        aria-hidden="true"
        className={cx(
          "relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors",
          on ? "bg-gradient-to-r from-indigo-500 to-indigo-600" : "bg-zinc-300 dark:bg-zinc-700",
        )}
      >
        <span
          className={cx(
            "absolute left-0 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform motion-reduce:transition-none",
            on ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
      {labelledBy ? (on ? "On" : "Off") : "Auto"}
    </button>
  );
}
