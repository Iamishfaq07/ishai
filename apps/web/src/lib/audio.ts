import { useEffect, useState } from "react";

export interface PcmFrame {
  pcm: Int16Array;
  rms: number;
}

export interface AudioCapture {
  analyser?: AnalyserNode;
  stop: () => void;
  /** Underlying stream (e.g. to detect the user ending a screen share). */
  stream: MediaStream;
}

const WORKLET_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer = 0;
  return Promise.race([
    promise.finally(() => window.clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

/**
 * Streams a MediaStream through the PCM16 worklet. One AudioContext per capture so
 * mic and system audio stay on separate channels end to end.
 */
export async function captureStream(stream: MediaStream, onFrame: (frame: PcmFrame) => void): Promise<AudioCapture> {
  const ctx = new AudioContext();
  let source: MediaStreamAudioSourceNode;
  let node: AudioWorkletNode;
  try {
    // A stuck audio engine (another app holding the device, a browser audio bug) never settles this promise:
    // fail with something the user can act on instead of a silent "Mic off".
    await withTimeout(
      ctx.audioWorklet.addModule("/pcm16-worklet.js"),
      WORKLET_TIMEOUT_MS,
      "the browser's audio engine didn't start. Close other tabs or apps using audio, then retry",
    );
    source = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, "pcm16-processor");
  } catch (err) {
    // Don't leave the mic (and its recording indicator) running when setup fails half way.
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
    throw err;
  }
  node.port.onmessage = (ev: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
    onFrame({ pcm: new Int16Array(ev.data.pcm), rms: ev.data.rms });
  };
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  analyser.connect(node);
  // The worklet produces no audio output; connecting keeps it pulled on all browsers
  // while a zero-gain node guarantees nothing is played back.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);

  // Mobile browsers (iOS Safari especially) start an AudioContext created outside a tap "suspended", and it
  // produces no frames until resumed from a user gesture: try now, then again on the next tap/keypress.
  let stopped = false;
  const halted = () => ctx.state !== "running" && ctx.state !== "closed"; // "suspended", or Safari's "interrupted"
  const resume = () => {
    if (!stopped && halted()) void ctx.resume().catch(() => {});
  };
  const unlockEvents = ["pointerdown", "keydown", "touchend"] as const;
  const unlock = () => {
    resume();
    if (!halted()) unlockEvents.forEach((e) => document.removeEventListener(e, unlock));
  };
  resume();
  unlockEvents.forEach((e) => document.addEventListener(e, unlock));
  // iOS also halts a running context later ("interrupted": a phone call, Siri, another app's audio, the screen
  // locking) and doesn't start it again by itself: the frames stop and the session hears nothing. Every time that
  // happens, resume when the page is back on screen, and on the next tap.
  const rearm = () => {
    if (stopped || !halted()) return;
    resume();
    unlockEvents.forEach((e) => document.addEventListener(e, unlock));
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") rearm();
  };
  ctx.addEventListener("statechange", rearm);
  document.addEventListener("visibilitychange", onVisible);

  return {
    stream,
    analyser,
    // Idempotent: unmount, "End", and a user-ended screen share can all call stop().
    stop: () => {
      if (stopped) return;
      stopped = true;
      unlockEvents.forEach((e) => document.removeEventListener(e, unlock));
      ctx.removeEventListener("statechange", rearm);
      document.removeEventListener("visibilitychange", onVisible);
      node.port.onmessage = null;
      source.disconnect();
      analyser.disconnect();
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      if (ctx.state !== "closed") void ctx.close().catch(() => {});
    },
  };
}

export async function openMicrophone(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });
}

/** What the user picked in the share window: a browser tab, an app window, or the whole screen. */
export type SharedSurface = "browser" | "window" | "monitor";
const sharedSurfaces = new WeakMap<MediaStream, SharedSurface>();

/** Which kind of surface a stream from openDisplayAudio came from (null when the browser doesn't say). */
export function sharedSurface(stream: MediaStream): SharedSurface | null {
  return sharedSurfaces.get(stream) ?? null;
}

/**
 * Browser "system audio" = audio of a shared tab/window/screen via getDisplayMedia.
 * Chrome/Edge require video: true and the user must tick "Share tab audio".
 * We drop the video track immediately — no screen pixels are recorded.
 *
 * The picker opens on the browser-tab list, without Orbit's own tab: for a meeting in the browser, its tab is the
 * right share. The whole screen's system audio still works (it's the only way to hear a desktop meeting app from
 * the browser), but Zoom mutes the user's microphone while a screen is shared with system audio, so the live page
 * says so when that's what was picked (see sharedSurface).
 */
export async function openDisplayAudio(): Promise<MediaStream> {
  if (!supportsDisplayAudio()) throw new Error(displayAudioHelp());
  const options = {
    video: { displaySurface: "browser" },
    audio: { suppressLocalAudioPlayback: false },
    preferCurrentTab: false,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "exclude",
    systemAudio: "include",
  } as DisplayMediaStreamOptions;
  // Some browsers show the share prompt and then never settle the promise (seen on Android): give up rather than
  // leave the session stuck on "Share tab audio".
  const stream = await withTimeout(
    navigator.mediaDevices.getDisplayMedia(options),
    SHARE_TIMEOUT_MS,
    "Tab audio sharing didn't start. Try again, or continue with your microphone only.",
  );
  const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
  if (surface === "browser" || surface === "window" || surface === "monitor") sharedSurfaces.set(stream, surface);
  stream.getVideoTracks().forEach((t) => {
    t.stop();
    stream.removeTrack(t);
  });
  if (stream.getAudioTracks().length === 0) {
    throw new Error(
      isMac()
        ? "No audio was shared. On a Mac only a Chrome tab’s audio can be shared: pick the meeting’s tab and leave “Share tab audio” on."
        : "No audio was shared. Pick the interview tab and enable “Share tab audio”.",
    );
  }
  return stream;
}

const SHARE_TIMEOUT_MS = 60_000;

/** A phone or tablet. Mobile browsers may expose getDisplayMedia (Android Chrome does) but can't share a tab's audio. */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData?.mobile) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || isIpadOs();
}

/** iPadOS reports itself as a Mac; touch points give it away. */
function isIpadOs(): boolean {
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

export function isAppleMobile(): boolean {
  return typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || isIpadOs());
}

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent) && !isIpadOs();
}

export function isWindows(): boolean {
  return typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);
}

/**
 * Whether this browser can capture a meeting's audio by sharing a tab. Only Chromium browsers on a computer can:
 * phones can't share another tab's or app's audio at all, and Safari and Firefox share video only.
 */
export type DisplayAudioSupport = "ok" | "phone" | "safari" | "firefox" | "unsupported";

export function displayAudioSupport(): DisplayAudioSupport {
  if (typeof navigator === "undefined") return "unsupported";
  if (isMobileDevice()) return "phone";
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\//.test(ua)) return "safari";
  return typeof navigator.mediaDevices?.getDisplayMedia === "function" ? "ok" : "unsupported";
}

export function supportsDisplayAudio(): boolean {
  return displayAudioSupport() === "ok";
}

/**
 * Whether a screenshot of a window or screen can be taken. Unlike tab audio, Safari and Firefox on a computer can
 * share video; phones can't share the screen usefully (or at all), even where getDisplayMedia exists.
 */
export function supportsScreenCapture(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
    !isMobileDevice()
  );
}

/** What to do instead when tab audio can't be shared here (or, on a Mac, what can be shared). */
export function displayAudioHelp(): string {
  switch (displayAudioSupport()) {
    case "phone":
      return isAppleMobile()
        ? "iPhone and iPad can’t share another app’s audio, and during a call on this same phone iOS gives the " +
            "microphone to the call. Use Phone / room audio: run the interview on another device on speaker, keep " +
            "this phone next to it, and keep Orbit open on screen."
        : "Phones can’t share another app’s audio, and a call on this same phone usually takes the microphone. Use " +
            "Phone / room audio: run the interview on another device on speaker and keep this phone next to it.";
    case "safari":
      return "Safari can’t share a tab’s audio. Open Orbit in Chrome or Edge to hear a meeting tab, or use Phone / " +
        "room audio with the call on your speakers.";
    case "firefox":
      return "Firefox can’t share a tab’s audio. Open Orbit in Chrome or Edge to hear a meeting tab, or use Phone / " +
        "room audio with the call on your speakers.";
    case "unsupported":
      return "This browser can’t share tab audio. Use Chrome or Edge, or Phone / room audio with the call on speaker.";
    case "ok":
      return isMac()
        ? "On a Mac, Chrome can share a browser tab’s audio but not the Zoom or Teams app: join the meeting in a " +
            "Chrome tab, or use Phone / room audio with the call on your speakers."
        : "In the browser, you’ll share the meeting tab with “Share tab audio” on. Only audio is used — no video is " +
            "recorded. Meeting in the Zoom or Teams app? Use the Orbit desktop app: sharing your whole screen’s audio " +
            "from the browser makes Zoom mute your microphone.";
  }
}

/** Captures one still frame from a user-chosen screen/window/tab. */
export async function captureScreenFrame(): Promise<Blob> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("Canvas unavailable");
    g.drawImage(video, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Screenshot failed"))), "image/png"),
    );
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export type MicPermission = "granted" | "denied" | "prompt" | "unknown";

export function useMicPermission(): MicPermission {
  const [state, setState] = useState<MicPermission>("unknown");
  useEffect(() => {
    let status: PermissionStatus | null = null;
    const update = () => status && setState(status.state as MicPermission);
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((s) => {
        status = s;
        update();
        s.addEventListener("change", update);
      })
      .catch(() => setState("unknown"));
    return () => status?.removeEventListener("change", update);
  }, []);
  return state;
}

export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput");
}

/** RMS → 0..1 meter value on a perceptual (dB) scale. */
export function levelFromRms(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}
