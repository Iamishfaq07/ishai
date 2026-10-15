/**
 * Is each audio source actually being heard? Measured on the device from the capture frames' levels (never sent
 * anywhere): a mic muted in the OS, or a shared meeting tab that plays nothing, still looks "on" to the capture, so
 * the live screen says what it hears instead: hearing, quiet (between turns), or silent long enough to check.
 */

/** Above ~-40 dBFS: someone talking, not room hiss. */
export const SOUND_RMS = 0.01;
/** Frames arrive every 50 ms; none for this long means the source isn't delivering. */
const STALLED_MS = 2_000;
/** Sound this recent counts as hearing it now. */
const HEARING_MS = 1_500;
/** Silent this long: worth a look. The interviewer can be quiet longer (you're answering), so it waits longer. */
export const SILENT_AFTER_MS = { mic: 45_000, system: 75_000 } as const;

export type SourceChannel = "mic" | "system";
export type SourceState = "off" | "paused" | "waiting" | "hearing" | "quiet" | "silent";

export interface SourceTrack {
  /** When the source was switched on (silence counts from here until the first sound). */
  onAt: number | null;
  lastFrameAt: number | null;
  lastSoundAt: number | null;
  /** 0..1, smoothed: rises at once, falls gently, for the meter. */
  level: number;
}

export function newTrack(): SourceTrack {
  return { onAt: null, lastFrameAt: null, lastSoundAt: null, level: 0 };
}

/** RMS → 0..1 on a perceptual (dB) scale, -60 dBFS to 0. */
export function meterLevel(rms: number): number {
  if (rms <= 0) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60));
}

/** Record one frame (mutates `t`: it lives in a ref, at 20 frames a second per source). */
export function feed(t: SourceTrack, rms: number, at: number): SourceTrack {
  t.onAt ??= at;
  t.lastFrameAt = at;
  if (rms >= SOUND_RMS) t.lastSoundAt = at;
  const level = meterLevel(rms);
  t.level = level > t.level ? level : t.level * 0.85 + level * 0.15;
  return t;
}

export function sourceState(t: SourceTrack, opts: { on: boolean; paused: boolean; channel: SourceChannel; now: number }): SourceState {
  if (!opts.on) return "off";
  if (opts.paused) return "paused";
  if (t.lastFrameAt === null || opts.now - t.lastFrameAt > STALLED_MS) return "waiting";
  if (t.lastSoundAt !== null && opts.now - t.lastSoundAt <= HEARING_MS) return "hearing";
  const since = t.lastSoundAt ?? t.onAt ?? opts.now;
  return opts.now - since >= SILENT_AFTER_MS[opts.channel] ? "silent" : "quiet";
}

/** One line for the chip, and the advice when something needs a look (null when all is well). */
export function sourceText(channel: SourceChannel, state: SourceState): { label: string; advice: string | null } {
  const mic = channel === "mic";
  switch (state) {
    case "off":
      return { label: "off", advice: null };
    case "paused":
      return { label: "paused", advice: null };
    case "waiting":
      return {
        label: "no audio",
        advice: mic ? "No sound is arriving from your microphone. Check it's plugged in and allowed." : "No sound is arriving from the shared audio. Share the meeting again if it stopped.",
      };
    case "hearing":
      return { label: "hearing", advice: null };
    case "quiet":
      return { label: "quiet", advice: null };
    case "silent":
      return {
        label: "silent",
        advice: mic
          ? "Your mic hasn't picked anything up for a while. Is it muted, or is another microphone selected?"
          : "Nothing heard from the interviewer's audio for a while. Is the meeting playing in the window or tab you shared, and not muted?",
      };
  }
}
