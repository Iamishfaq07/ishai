/**
 * The microphone and the shared tab, for the live pages: quiet streams made in the page, so no device is opened and
 * nothing is heard. (The render browser runs with --mute-audio too.) The level meters then read the scenario's
 * levels (`setLevel`), not a real signal.
 */
let ctx: AudioContext | null = null;
const gains: GainNode[] = [];
let oscStarted = false;

function audioStream(): MediaStream {
  ctx ??= new AudioContext();
  const osc = ctx.createOscillator();
  osc.frequency.value = 220;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain);
  const dest = ctx.createMediaStreamDestination();
  gain.connect(dest);
  osc.start();
  oscStarted = true;
  gains.push(gain);
  return dest.stream;
}

/** 0..1 on every quiet stream (a meter wants to move while someone "speaks"). */
export function setLevel(level: number): void {
  for (const g of gains) g.gain.value = Math.max(0, Math.min(1, level)) * 0.2;
}

if (navigator.mediaDevices) {
  navigator.mediaDevices.getUserMedia = async () => audioStream();
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const video = canvas.captureStream(1).getVideoTracks()[0] as MediaStreamTrack;
    (video as unknown as { getSettings: () => MediaTrackSettings }).getSettings = () => ({ displaySurface: "browser" }) as MediaTrackSettings;
    return new MediaStream([video, ...audioStream().getAudioTracks()]);
  };
  navigator.mediaDevices.enumerateDevices = async () => [
    { deviceId: "default", groupId: "g", kind: "audioinput", label: "Microphone (Realtek Audio)", toJSON: () => ({}) } as MediaDeviceInfo,
  ];
}
export const mediaReady = () => oscStarted;

// ── Audio on the virtual clock ─────────────────────────────────────────────────────────────────────────────────
// Saba's voice is an <audio> element whose decoded samples, read at its current time, drive her voice bars
// (packages/ui/src/live/voiceActivity.ts). Here an audio element "plays" on the film's clock instead of the wall's:
// its currentTime is the virtual time since play(), it ends when that passes its length, and nothing is heard (the
// film's soundtrack places the same files at the same moments, from the log below).
import { nowMs, onTick, pending } from "./virtualTime";

type PlayState = { start: number | null; offset: number; ended: boolean; logged?: number };
const plays = new WeakMap<HTMLMediaElement, PlayState>();
const playing = new Set<HTMLAudioElement>();
/** Every clip played: when (app ms), how long it is, and which served voice file it was (followed from the answer). */
export const mediaLog: Array<{ at: number; end: number | null; duration: number; served: string | null }> = [];
/** The voice files the fixture API served, in order (fixtureApi.ts): "file|app ms|the words asked for". */
export const served: string[] = [];
/** Which served file an answer, its bytes and their object URL are (so a play names its file). */
export const answered = new WeakMap<Response, string>();
const blobs = new WeakMap<Blob, string>();
const urls = new Map<string, string>();

const stateOf = (el: HTMLMediaElement): PlayState => {
  let s = plays.get(el);
  if (!s) {
    s = { start: null, offset: 0, ended: false };
    plays.set(el, s);
  }
  return s;
};
const timeOf = (el: HTMLMediaElement): number => {
  const s = stateOf(el);
  const d = Number.isFinite(el.duration) ? el.duration : Infinity;
  const t = s.start === null ? s.offset : s.offset + ((nowMs() - s.start) / 1000) * (el.playbackRate || 1);
  return Math.min(t, d);
};
const fire = (el: HTMLMediaElement, ...types: string[]) => {
  for (const type of types) el.dispatchEvent(new Event(type));
};

const audio = HTMLAudioElement.prototype as HTMLAudioElement & Record<string, unknown>;
audio.play = function (this: HTMLAudioElement) {
  const s = stateOf(this);
  if (s.start === null) {
    s.start = nowMs();
    s.ended = false;
    playing.add(this);
    s.logged = mediaLog.push({ at: nowMs(), end: null, duration: this.duration, served: urls.get(this.src) ?? null }) - 1;
  }
  queueMicrotask(() => fire(this, "play", "playing"));
  return Promise.resolve();
};
audio.pause = function (this: HTMLAudioElement) {
  const s = stateOf(this);
  if (s.start !== null) {
    s.offset = timeOf(this);
    s.start = null;
    playing.delete(this);
    fire(this, "pause");
  }
};
Object.defineProperty(audio, "currentTime", {
  configurable: true,
  get(this: HTMLAudioElement) {
    return timeOf(this);
  },
  set(this: HTMLAudioElement, v: number) {
    const s = stateOf(this);
    s.offset = Number(v) || 0;
    if (s.start !== null) s.start = nowMs();
    s.ended = false;
  },
});
Object.defineProperty(audio, "paused", { configurable: true, get(this: HTMLAudioElement) { return stateOf(this).start === null; } });
Object.defineProperty(audio, "ended", { configurable: true, get(this: HTMLAudioElement) { return stateOf(this).ended; } });
onTick(() => {
  for (const el of [...playing]) {
    fire(el, "timeupdate");
    if (Number.isFinite(el.duration) && timeOf(el) >= el.duration - 0.0005) {
      const s = stateOf(el);
      s.offset = el.duration;
      s.start = null;
      s.ended = true;
      playing.delete(el);
      if (s.logged !== undefined && mediaLog[s.logged]) mediaLog[s.logged]!.end = nowMs();
      fire(el, "pause", "ended");
    }
  }
});

// Decoding and reading a clip are real work: the frame waits for them (virtualTime.ts settle).
const ctxProto = BaseAudioContext.prototype as BaseAudioContext & { decodeAudioData: BaseAudioContext["decodeAudioData"] };
const nativeDecode = ctxProto.decodeAudioData;
ctxProto.decodeAudioData = function (this: BaseAudioContext, buf: ArrayBuffer, ok?: DecodeSuccessCallback | null, err?: DecodeErrorCallback | null) {
  const p = pending(nativeDecode.call(this, buf));
  if (ok) p.then(ok, err ?? undefined);
  return p;
} as BaseAudioContext["decodeAudioData"];
const nativeArrayBuffer = Response.prototype.arrayBuffer;
Response.prototype.arrayBuffer = function (this: Response) {
  return pending(nativeArrayBuffer.call(this));
};
const nativeBlob = Response.prototype.blob;
Response.prototype.blob = function (this: Response) {
  const label = answered.get(this);
  const p = pending(nativeBlob.call(this));
  return label ? p.then((b) => (blobs.set(b, label), b)) : p;
};
const nativeObjectUrl = URL.createObjectURL;
URL.createObjectURL = function (o: Blob | MediaSource) {
  const url = nativeObjectUrl.call(URL, o);
  const label = o instanceof Blob ? blobs.get(o) : undefined;
  if (label) urls.set(url, label);
  return url;
};
