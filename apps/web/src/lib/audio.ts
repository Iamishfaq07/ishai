import { useEffect, useState } from "react";

export interface PcmFrame {
  pcm: Int16Array;
  rms: number;
}

export interface AudioCapture {
  stop: () => void;
  /** Underlying stream (e.g. to detect the user ending a screen share). */
  stream: MediaStream;
}

/**
 * Streams a MediaStream through the PCM16 worklet. One AudioContext per capture so
 * mic and system audio stay on separate channels end to end.
 */
export async function captureStream(stream: MediaStream, onFrame: (frame: PcmFrame) => void): Promise<AudioCapture> {
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule("/pcm16-worklet.js");
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm16-processor");
  node.port.onmessage = (ev: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
    onFrame({ pcm: new Int16Array(ev.data.pcm), rms: ev.data.rms });
  };
  source.connect(node);
  // The worklet produces no audio output; connecting keeps it pulled on all browsers
  // while a zero-gain node guarantees nothing is played back.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);

  let stopped = false;
  return {
    stream,
    // Idempotent: unmount, "End", and a user-ended screen share can all call stop().
    stop: () => {
      if (stopped) return;
      stopped = true;
      node.port.onmessage = null;
      source.disconnect();
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

/**
 * Browser "system audio" = audio of a shared tab/window/screen via getDisplayMedia.
 * Chrome/Edge require video: true and the user must tick "Share tab audio".
 * We drop the video track immediately — no screen pixels are recorded.
 */
export async function openDisplayAudio(): Promise<MediaStream> {
  if (!navigator.mediaDevices.getDisplayMedia) {
    throw new Error("This browser can't share tab audio. Use Chrome or Edge, or the Orbit desktop app.");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  stream.getVideoTracks().forEach((t) => {
    t.stop();
    stream.removeTrack(t);
  });
  if (stream.getAudioTracks().length === 0) {
    throw new Error("No audio was shared. Pick the interview tab and enable “Share tab audio”.");
  }
  return stream;
}

export function supportsDisplayAudio(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);
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
