import type { OrbitSession, SessionType } from "@orbit/types";
import type { AudioApp } from "./native";

/**
 * Which audio a session captures: the interviewer's app or output picked on Setup, kept across launches, and rebuilt
 * for a rejoin. Plain functions over plain data (no React, no Tauri) so they can be tested.
 */

/** What the live screen captures. */
export interface DesktopLaunch {
  micDeviceId?: string;
  systemAudio: boolean;
  /** Capture only this app's audio (process tree); undefined = an output device. */
  systemProcessId?: number;
  /** That app's exe: capture finds the app again if it restarts during the session. */
  systemProcessExe?: string;
  /** Output to capture when no app is chosen: "default" | "communications" | endpoint id. */
  systemDevice?: string;
}

export const MIC_KEY = "orbit.micDeviceId";
/** The output last picked under "Listen to": "out:default" | "out:communications" | "out:<endpoint id>". */
export const OUTPUT_KEY = "orbit.outputSource";
/** The audio of the session last started or rejoined, so rejoining it hears the same app again. */
const LAST_LAUNCH_KEY = "orbit.lastLaunch";

/**
 * Session types with an interviewer on the other end of a call. Phone / room: everyone is heard through the
 * microphone. Mock: the interviewer is Orbit's own voice from the speakers.
 */
export function usesSystemAudio(type: SessionType): boolean {
  return type !== "phone" && type !== "mock";
}

/** Meeting apps pre-selected as the interviewer audio source — only while they're playing (see `meetingAppPlaying`). */
const MEETING_APPS = new Set([
  "zoom.exe",
  "ms-teams.exe",
  "teams.exe",
  "webexmta.exe",
  "ciscocollabhost.exe",
  "skype.exe",
  "slack.exe",
  "discord.exe",
]);

const exeName = (exe: string): string => exe.split(/[\\/]/).pop()?.toLowerCase() ?? "";
const sameExe = (a: string, b: string): boolean => exeName(a) === exeName(b);

/**
 * The meeting app to pre-select: one playing sound now. An idle one (Slack, Discord or Teams sitting in the tray)
 * isn't where the interview is — that may well be a browser tab — and capturing it would hear nothing.
 */
export function meetingAppPlaying(apps: AudioApp[]): AudioApp | undefined {
  return apps.find((a) => a.active && MEETING_APPS.has(exeName(a.exe)));
}

/** The app `pid` + `exe` was, in a fresh list: the same process, else the same exe (it restarted), a playing one first. */
export function findApp(apps: AudioApp[], pid: number | undefined, exe: string): AudioApp | undefined {
  return (
    apps.find((a) => a.pid === pid && sameExe(a.exe, exe)) ??
    apps.find((a) => a.active && sameExe(a.exe, exe)) ??
    apps.find((a) => sameExe(a.exe, exe))
  );
}

/**
 * "Listen to" ("app:<pid>" | "out:…") after the app list is read again. Untouched by the user it follows the meeting
 * app that's playing, else the saved output. A choice the user made stays — following its app if it restarted
 * (a new PID) — until the app is gone; then it's the saved output.
 */
export function nextSource(
  current: string,
  previous: AudioApp[],
  apps: AudioApp[],
  touched: boolean,
  savedOutput: string,
): string {
  if (!touched) {
    const meeting = meetingAppPlaying(apps);
    return meeting ? `app:${meeting.pid}` : savedOutput;
  }
  if (!current.startsWith("app:")) return current;
  const pid = Number(current.slice(4));
  const chosen = previous.find((a) => a.pid === pid) ?? apps.find((a) => a.pid === pid);
  const app = chosen ? findApp(apps, pid, chosen.exe) : undefined;
  return app ? `app:${app.pid}` : savedOutput;
}

export type ChosenAppCheck =
  | { kind: "ok"; app: AudioApp }
  /** Not running (or no longer has any audio). */
  | { kind: "gone" }
  /** Silent while another app is playing: the interview is probably there. */
  | { kind: "idle"; app: AudioApp; playing: AudioApp };

/** Right before a session starts, against a fresh list: is the chosen app still there, and the one playing? */
export function checkChosenApp(apps: AudioApp[], pid: number, exe: string): ChosenAppCheck {
  const app = findApp(apps, pid, exe);
  if (!app) return { kind: "gone" };
  const playing = app.active ? undefined : apps.find((a) => a.active && a.pid !== app.pid);
  return playing ? { kind: "idle", app, playing } : { kind: "ok", app };
}

/** "out:communications" → "communications"; nothing saved = the default output. */
function outputDevice(saved: string | null): string | undefined {
  return saved?.startsWith("out:") ? saved.slice(4) : undefined;
}

interface LastLaunch extends DesktopLaunch {
  sessionId: string;
}

export interface SavedAudio {
  micDeviceId: string | null;
  output: string | null;
  last: LastLaunch | null;
}

export function loadSavedAudio(storage: Pick<Storage, "getItem"> = localStorage): SavedAudio {
  let last: LastLaunch | null = null;
  try {
    const parsed = JSON.parse(storage.getItem(LAST_LAUNCH_KEY) ?? "null") as LastLaunch | null;
    if (parsed && typeof parsed.sessionId === "string" && typeof parsed.systemAudio === "boolean") last = parsed;
  } catch {
    // unreadable: rejoin from the saved choices
  }
  return { micDeviceId: storage.getItem(MIC_KEY), output: storage.getItem(OUTPUT_KEY), last };
}

/** Called whenever a session starts or is rejoined. */
export function rememberLaunch(
  sessionId: string,
  launch: DesktopLaunch,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  const last: LastLaunch = { sessionId, ...launch };
  storage.setItem(LAST_LAUNCH_KEY, JSON.stringify(last));
}

/**
 * The audio for rejoining `session`: what that session last ran with, else the saved microphone and output. Its
 * app is looked up again by exe (it may have restarted under a new PID); if it isn't running now, capture waits for
 * it (process_loopback.rs). Phone and mock sessions never capture system audio.
 */
export function rejoinLaunch(
  session: Pick<OrbitSession, "id" | "type">,
  saved: SavedAudio,
  apps: AudioApp[],
  isMac: boolean,
): DesktopLaunch {
  const last = saved.last?.sessionId === session.id ? saved.last : null;
  const mic = last ? last.micDeviceId : (saved.micDeviceId ?? undefined);
  const micOnly: DesktopLaunch = { systemAudio: false, ...(mic ? { micDeviceId: mic } : {}) };
  if (isMac || !usesSystemAudio(session.type) || last?.systemAudio === false) return micOnly;
  if (last?.systemProcessExe) {
    const app = findApp(apps, last.systemProcessId, last.systemProcessExe);
    const pid = app?.pid ?? last.systemProcessId;
    if (pid) return { ...micOnly, systemAudio: true, systemProcessId: pid, systemProcessExe: app?.exe ?? last.systemProcessExe };
  }
  const device = (last && !last.systemProcessExe ? last.systemDevice : undefined) ?? outputDevice(saved.output);
  return { ...micOnly, systemAudio: true, ...(device ? { systemDevice: device } : {}) };
}
