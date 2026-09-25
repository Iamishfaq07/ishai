/**
 * Audio diagnostics (brief §23): per-channel capture health measured on the device from the capture frames'
 * levels, and a report that is safe to share. No audio, transcript, account or token ever goes into it, and
 * personal names in device names ("Sam's AirPods") are redacted.
 */

/** Native capture frames are 800 samples at 16 kHz. */
export const FRAME_MS = 50;
/** Below ~-54 dBFS: a muted mic or an app that isn't playing anything. */
const SILENT_RMS = 0.002;
/** Above ~-6 dBFS: close to clipping; transcription gets worse. */
const LOUD_RMS = 0.5;
/** A gap this long between frames is a dropout (frames normally arrive every 50 ms). */
const GAP_MS = 250;

export interface ChannelStats {
  frames: number;
  firstAt: number | null;
  lastAt: number | null;
  gaps: number;
  longestGapMs: number;
  silent: number;
  loud: number;
  peakRms: number;
  sumRms: number;
}

export function newChannelStats(): ChannelStats {
  return { frames: 0, firstAt: null, lastAt: null, gaps: 0, longestGapMs: 0, silent: 0, loud: 0, peakRms: 0, sumRms: 0 };
}

/** Record one frame (mutates and returns `s`, so it can live in a ref at 20 frames/s per channel). */
export function addFrame(s: ChannelStats, rms: number, atMs: number): ChannelStats {
  if (s.lastAt !== null) {
    const gap = Math.round(atMs - s.lastAt);
    if (gap >= GAP_MS) s.gaps += 1;
    s.longestGapMs = Math.max(s.longestGapMs, gap);
  }
  s.firstAt ??= atMs;
  s.lastAt = atMs;
  s.frames += 1;
  if (rms < SILENT_RMS) s.silent += 1;
  if (rms > LOUD_RMS) s.loud += 1;
  s.peakRms = Math.max(s.peakRms, rms);
  s.sumRms += rms;
  return s;
}

export type Verdict = "waiting" | "no_audio" | "dropouts" | "silent" | "too_loud" | "ok";

export interface ChannelSummary {
  verdict: Verdict;
  advice: string;
  seconds: number;
  frames: number;
  /** Frames received ÷ frames expected for the test's length (1 = none lost). */
  delivery: number | null;
  dropouts: number;
  longestGapMs: number;
  silentShare: number | null;
  loudShare: number | null;
  peakDbfs: number | null;
  averageDbfs: number | null;
}

const dbfs = (rms: number) => (rms > 0 ? Math.round(20 * Math.log10(rms)) : null);

/**
 * `startedAt` is when capture started; `now` is the current time. `kind` changes the advice: an interviewer
 * channel that's quiet usually just means nothing is playing yet.
 */
export function summarize(s: ChannelStats, startedAt: number, now: number, kind: "mic" | "system"): ChannelSummary {
  const elapsed = Math.max(0, now - startedAt);
  const seconds = Math.round(elapsed / 100) / 10;
  const expected = Math.floor(elapsed / FRAME_MS);
  const delivery = expected > 0 ? Math.min(1, Math.round((s.frames / expected) * 100) / 100) : null;
  const silentShare = s.frames ? Math.round((s.silent / s.frames) * 100) / 100 : null;
  const loudShare = s.frames ? Math.round((s.loud / s.frames) * 100) / 100 : null;
  const base = {
    seconds,
    frames: s.frames,
    delivery,
    dropouts: s.gaps,
    longestGapMs: s.longestGapMs,
    silentShare,
    loudShare,
    peakDbfs: s.frames ? dbfs(s.peakRms) : null,
    averageDbfs: s.frames ? dbfs(s.sumRms / s.frames) : null,
  };
  const who = kind === "mic" ? "your microphone" : "the interviewer's audio";
  // A stalled stream counts too: frames that stopped arriving are a dropout even without a later frame to show it.
  const stalled = s.lastAt !== null && now - s.lastAt >= GAP_MS * 4;
  if (elapsed < 2000) return { ...base, verdict: "waiting", advice: "Measuring…" };
  if (s.frames === 0) {
    return {
      ...base,
      verdict: "no_audio",
      advice: `No audio is arriving from ${who}. Check that the device is plugged in and not used exclusively by another app.`,
    };
  }
  if (stalled || s.gaps >= 3 || (delivery !== null && delivery < 0.8)) {
    return {
      ...base,
      verdict: "dropouts",
      advice: `Audio from ${who} is dropping out. Close other apps using the device, or pick another one.`,
    };
  }
  if (silentShare !== null && silentShare > 0.95) {
    return {
      ...base,
      verdict: "silent",
      advice:
        kind === "mic"
          ? "Your microphone is silent. Check it isn't muted (in Windows or on the headset) and speak while testing."
          : "Nothing is playing. Play something in the meeting app (or the source you chose) while testing.",
    };
  }
  if (loudShare !== null && loudShare > 0.2) {
    return {
      ...base,
      verdict: "too_loud",
      advice: `${kind === "mic" ? "Your microphone" : "The interviewer's audio"} is very loud and may distort. Lower its input or output volume.`,
    };
  }
  return { ...base, verdict: "ok", advice: kind === "mic" ? "Your microphone sounds good." : "The interviewer's audio is coming through." };
}

/** Device names can carry a person's name ("Sam's AirPods Pro"); keep the model, drop the name. */
export function redactDeviceName(name: string): string {
  return name.replace(/[\p{L}\p{N}._-]+['’]s\b/gu, "[name]'s");
}

export interface DiagnosticsEvent {
  /** Seconds since the test started. */
  t: number;
  channel: "mic" | "system";
  kind: "status" | "error";
  detail: string;
}

export interface DiagnosticsInput {
  appVersion: string | null;
  userAgent: string;
  selection: { mic: string; listenTo: string };
  devices: { mics: Array<{ name: string; isDefault: boolean }>; outputs: Array<{ name: string; isDefault: boolean }> };
  channels: { mic: ChannelSummary; system: ChannelSummary | null };
  events: DiagnosticsEvent[];
}

/** The shareable report: measurements and settings only. */
export function diagnosticsReport(input: DiagnosticsInput, generatedAt = new Date()): string {
  const clean = (d: { name: string; isDefault: boolean }) => ({ name: redactDeviceName(d.name), default: d.isDefault });
  const report = {
    report: "orbit-audio-diagnostics",
    generated_at: generatedAt.toISOString(),
    contains: "measurements and device settings only: no audio, transcripts, account details or keys",
    app_version: input.appVersion,
    platform: input.userAgent,
    selection: { mic: redactDeviceName(input.selection.mic), listen_to: redactDeviceName(input.selection.listenTo) },
    devices: { mics: input.devices.mics.map(clean), outputs: input.devices.outputs.map(clean) },
    channels: input.channels,
    events: input.events.map((e) => ({ ...e, detail: redactDeviceName(e.detail) })),
  };
  return JSON.stringify(report, null, 2);
}
