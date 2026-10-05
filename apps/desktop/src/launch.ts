import type { SessionType } from "@orbit/types";
import type { AudioApp } from "./native";

/**
 * Which audio a session captures: the interviewer's app or output picked on Setup. Plain functions over plain data
 * (no React, no Tauri) so they can be tested.
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
