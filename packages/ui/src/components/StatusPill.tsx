import type { LiveState } from "@orbit/types";
import type { ConnectionStatus } from "../live/client";
import { cx } from "./cx";

type Tone = "idle" | "live" | "busy" | "warn" | "error" | "done";

const STATE_META: Record<LiveState, { label: string; tone: Tone; pulse?: boolean }> = {
  idle: { label: "Ready", tone: "idle" },
  listening: { label: "Listening", tone: "live", pulse: true },
  speech_detected: { label: "Hearing speech", tone: "live", pulse: true },
  question_detected: { label: "Question detected", tone: "busy" },
  generating: { label: "Thinking…", tone: "busy", pulse: true },
  streaming: { label: "Answering", tone: "busy", pulse: true },
  answer_complete: { label: "Listening", tone: "live", pulse: true },
  follow_up_detected: { label: "Follow-up detected", tone: "busy" },
  stt_reconnecting: { label: "Reconnecting audio…", tone: "warn", pulse: true },
  ai_reconnecting: { label: "Reconnecting AI…", tone: "warn", pulse: true },
  error: { label: "Error", tone: "error" },
  paused: { label: "Paused", tone: "idle" },
  ended: { label: "Ended", tone: "done" },
};

const TONE_CLASSES: Record<Tone, { dot: string; text: string }> = {
  idle: { dot: "bg-zinc-400", text: "text-zinc-500 dark:text-zinc-400" },
  live: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" },
  busy: { dot: "bg-indigo-500", text: "text-indigo-700 dark:text-indigo-300" },
  warn: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" },
  error: { dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-300" },
  done: { dot: "bg-zinc-500", text: "text-zinc-600 dark:text-zinc-400" },
};

export interface StatusPillProps {
  state: LiveState;
  connection: ConnectionStatus;
}

/** Connection problems take precedence over the server-reported live state. */
export function StatusPill({ state, connection }: StatusPillProps) {
  const meta =
    connection === "connecting"
      ? { label: "Connecting…", tone: "idle" as Tone, pulse: true }
      : connection === "reconnecting"
        ? { label: "Reconnecting…", tone: "warn" as Tone, pulse: true }
        : connection === "closed" && state !== "ended"
          ? { label: "Disconnected", tone: "error" as Tone, pulse: false }
          : STATE_META[state];
  const tone = TONE_CLASSES[meta.tone];

  return (
    // Not an aria-live region: this label changes on every state transition (listening → hearing →
    // detected → thinking → answering …); announcing each one would talk over the answer. The answer
    // card's result region carries aria-live instead. `title` keeps it discoverable on hover.
    <span
      className={cx("inline-flex items-center gap-1.5 text-xs font-medium tracking-wide", tone.text)}
      title={meta.label}
    >
      <span className="relative flex h-2 w-2" aria-hidden="true">
        {meta.pulse && (
          <span
            className={cx("absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping", tone.dot)}
          />
        )}
        <span className={cx("relative inline-flex h-2 w-2 rounded-full", tone.dot)} />
      </span>
      {meta.label}
    </span>
  );
}
