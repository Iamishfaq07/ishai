import type { LiveState, ProviderState } from "@orbit/types";
import type { ConnectionStatus } from "../live/client";
import { cx } from "./cx";

type Tone = "idle" | "live" | "busy" | "warn" | "error" | "done";

type Motion = "pulse" | "wave" | "spin";

const STATE_META: Record<LiveState, { label: string; tone: Tone; pulse?: boolean; motion?: Motion }> = {
  idle: { label: "Ready", tone: "idle" },
  listening: { label: "Listening", tone: "live", pulse: true },
  speech_detected: { label: "Hearing speech", tone: "live", pulse: true, motion: "wave" },
  question_detected: { label: "Question detected", tone: "busy" },
  generating: { label: "Thinking…", tone: "busy", pulse: true, motion: "spin" },
  streaming: { label: "Answering", tone: "busy", pulse: true, motion: "spin" },
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
  /** Transcription provider state: "Connecting audio…" until the STT socket is really up. */
  stt?: ProviderState;
}

/** Connection problems take precedence over the server-reported live state. */
export function StatusPill({ state, connection, stt }: StatusPillProps) {
  const meta =
    connection === "connecting"
      ? { label: "Connecting…", tone: "idle" as Tone, pulse: true }
      : connection === "reconnecting"
        ? { label: "Reconnecting…", tone: "warn" as Tone, pulse: true }
        : connection === "closed" && state !== "ended"
          ? { label: "Disconnected", tone: "error" as Tone, pulse: false }
          : stt === "connecting" && state !== "ended" && state !== "paused"
            ? { label: "Connecting audio…", tone: "idle" as Tone, pulse: true }
            : stt === "down" && state !== "ended"
              ? { label: "Transcription unavailable", tone: "error" as Tone, pulse: false }
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
      <Indicator motion={"motion" in meta ? meta.motion : undefined} pulse={Boolean(meta.pulse)} dot={tone.dot} />
      <span key={meta.label} className="animate-fade-in">
        {meta.label}
      </span>
    </span>
  );
}

/** Listening: a breathing dot. Hearing speech: a live sound wave. Thinking/answering: an orbiting spinner. */
function Indicator({ motion, pulse, dot }: { motion?: Motion; pulse: boolean; dot: string }) {
  if (motion === "wave") {
    return (
      <span className="flex h-3 items-center gap-[2px]" aria-hidden="true">
        {[0, 150, 300, 450].map((delay) => (
          <span
            key={delay}
            className={cx("h-3 w-[2px] origin-center rounded-full motion-safe:animate-wave", dot)}
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
    );
  }
  if (motion === "spin") {
    return (
      <span
        className="h-2.5 w-2.5 rounded-full border-2 border-indigo-500/25 border-t-indigo-500 motion-safe:animate-orbit-fast"
        aria-hidden="true"
      />
    );
  }
  return (
    <span className="relative flex h-2 w-2" aria-hidden="true">
      {pulse && (
        <span className={cx("absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping", dot)} />
      )}
      <span className={cx("relative inline-flex h-2 w-2 rounded-full", dot)} />
    </span>
  );
}
