import { useEffect, useRef, useState, type ComponentType } from "react";
import { feed, newTrack, sourceState, sourceText, type SourceChannel, type SourceState, type SourceTrack } from "../live/sourceActivity";
import { cx } from "./cx";

/** Both sources' tracks, fed from the capture frames (live/sourceActivity.ts). Stable: frames never re-render. */
export interface SourceTracker {
  tracks: Record<SourceChannel, SourceTrack>;
  feed: (channel: SourceChannel, rms: number) => void;
  /** A source switched on again: count from now, not from its last run. */
  reset: (channel: SourceChannel) => void;
}

export function useSourceTracker(): SourceTracker {
  const ref = useRef<SourceTracker | null>(null);
  ref.current ??= (() => {
    const tracks = { mic: newTrack(), system: newTrack() };
    return {
      tracks,
      feed: (channel, rms) => void feed(tracks[channel], rms, performance.now()),
      reset: (channel) => {
        tracks[channel] = newTrack();
      },
    };
  })();
  return ref.current;
}

const TONE: Record<SourceState, string> = {
  off: "bg-zinc-500/10 text-zinc-500 ring-zinc-500/15 dark:text-zinc-400",
  paused: "bg-zinc-500/10 text-zinc-500 ring-zinc-500/15 dark:text-zinc-400",
  waiting: "bg-amber-500/10 text-amber-800 ring-amber-500/30 dark:text-amber-200",
  silent: "bg-amber-500/10 text-amber-800 ring-amber-500/30 dark:text-amber-200",
  hearing: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  quiet: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
};

/**
 * One audio source on the live screen: on or off, and whether it's actually being heard, with a small level meter.
 * Silent too long, or no audio arriving, it turns amber and says what to check (`onAdvice` also gets it, for a
 * banner). It samples the tracker itself a few times a second, so only the chip re-renders.
 */
export function SourceChip({ tracker, channel, on, paused = false, icon: Icon, label, onAdvice, className }: {
  tracker: SourceTracker;
  channel: SourceChannel;
  on: boolean;
  paused?: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onAdvice?: (advice: string | null) => void;
  className?: string;
}) {
  const [snap, setSnap] = useState<{ state: SourceState; level: number }>({ state: on ? "waiting" : "off", level: 0 });
  const wasOn = useRef(on);
  useEffect(() => {
    if (on && !wasOn.current) tracker.reset(channel);
    wasOn.current = on;
  }, [on, channel, tracker]);
  useEffect(() => {
    const tick = () => {
      const t = tracker.tracks[channel];
      const state = sourceState(t, { on, paused, channel, now: performance.now() });
      const level = state === "hearing" || state === "quiet" ? Math.round(t.level * 10) / 10 : 0;
      setSnap((s) => (s.state === state && s.level === level ? s : { state, level }));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [tracker, channel, on, paused]);
  const { label: status, advice } = sourceText(channel, snap.state);
  const advise = useRef(onAdvice);
  advise.current = onAdvice;
  useEffect(() => advise.current?.(advice), [advice]);
  const bars = [0.25, 0.5, 0.75];
  return (
    <span
      title={advice ?? `${label}: ${status}`}
      className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 ring-1 transition-colors motion-reduce:transition-none", TONE[snap.state], className)}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>
        {label} <span className="font-medium">{status}</span>
      </span>
      {(snap.state === "hearing" || snap.state === "quiet") && (
        <span aria-hidden="true" className="flex h-3 items-end gap-[2px]">
          {bars.map((b, i) => (
            <span
              key={b}
              className={cx("w-[3px] rounded-full bg-current transition-opacity duration-150 motion-reduce:transition-none", snap.level >= b ? "opacity-100" : "opacity-25")}
              style={{ height: `${(i + 1) * 4}px` }}
            />
          ))}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {advice ?? ""}
      </span>
    </span>
  );
}
