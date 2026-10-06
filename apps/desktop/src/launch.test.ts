import { describe, expect, it } from "vitest";
import type { AudioApp } from "./native";
import {
  checkChosenApp,
  loadSavedAudio,
  meetingAppPlaying,
  nextSource,
  rejoinLaunch,
  rememberLaunch,
  usesSystemAudio,
  type SavedAudio,
} from "./launch";

const app = (pid: number, exe: string, active: boolean, name = exe.replace(/\.exe$/i, "")): AudioApp => ({ pid, exe, name, active });

const slackIdle = app(30, "slack.exe", false);
const teamsIdle = app(20, "ms-teams.exe", false);
const chromePlaying = app(10, "chrome.exe", true);
const zoomPlaying = app(40, "Zoom.exe", true);

describe("pre-selecting the interviewer's app", () => {
  it("never picks an idle chat or meeting app", () => {
    // the interview is in Chrome (Meet / Zoom web); Slack and Teams just sit in the tray
    expect(meetingAppPlaying([chromePlaying, slackIdle, teamsIdle])).toBeUndefined();
    expect(nextSource("out:default", [], [chromePlaying, slackIdle, teamsIdle], false, "out:default")).toBe("out:default");
  });

  it("picks a meeting app that is playing", () => {
    expect(meetingAppPlaying([slackIdle, zoomPlaying])).toBe(zoomPlaying);
    expect(nextSource("out:default", [], [slackIdle, zoomPlaying], false, "out:communications")).toBe("app:40");
  });

  it("follows the playing meeting app while the user hasn't chosen", () => {
    // the call ended: back to the saved output
    expect(nextSource("app:40", [zoomPlaying], [app(40, "Zoom.exe", false)], false, "out:default")).toBe("out:default");
  });

  it("keeps the user's choice, following its app across a restart, until it's gone", () => {
    expect(nextSource("app:30", [slackIdle], [slackIdle, zoomPlaying], true, "out:default")).toBe("app:30");
    expect(nextSource("app:30", [slackIdle], [app(31, "Slack.exe", false)], true, "out:default")).toBe("app:31");
    expect(nextSource("app:30", [slackIdle], [zoomPlaying], true, "out:default")).toBe("out:default");
    expect(nextSource("out:communications", [], [zoomPlaying], true, "out:default")).toBe("out:communications");
  });
});

describe("checking the chosen app at Start", () => {
  it("warns when the chosen app is silent while another plays", () => {
    expect(checkChosenApp([slackIdle, chromePlaying], 30, "slack.exe")).toEqual({ kind: "idle", app: slackIdle, playing: chromePlaying });
  });

  it("is fine when it plays, or when nothing does", () => {
    expect(checkChosenApp([zoomPlaying, chromePlaying], 40, "zoom.exe")).toEqual({ kind: "ok", app: zoomPlaying });
    expect(checkChosenApp([slackIdle, teamsIdle], 30, "slack.exe")).toEqual({ kind: "ok", app: slackIdle });
  });

  it("finds an app that restarted, and notices one that's gone", () => {
    const restarted = app(41, "Zoom.exe", true);
    expect(checkChosenApp([restarted], 40, "Zoom.exe")).toEqual({ kind: "ok", app: restarted });
    expect(checkChosenApp([chromePlaying], 40, "Zoom.exe")).toEqual({ kind: "gone" });
  });
});

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("rejoining a session", () => {
  const saved = (over: Partial<SavedAudio> = {}): SavedAudio => ({ micDeviceId: "mic-usb", output: "out:communications", last: null, ...over });

  it("uses the saved mic and output, not just the defaults", () => {
    expect(rejoinLaunch({ id: "s1", type: "interview" }, saved(), [], false)).toEqual({
      systemAudio: true,
      micDeviceId: "mic-usb",
      systemDevice: "communications",
    });
  });

  it("never captures system audio for phone or mock sessions, or on macOS", () => {
    expect(usesSystemAudio("phone")).toBe(false);
    expect(usesSystemAudio("mock")).toBe(false);
    expect(rejoinLaunch({ id: "s1", type: "phone" }, saved(), [], false)).toEqual({ systemAudio: false, micDeviceId: "mic-usb" });
    expect(rejoinLaunch({ id: "s1", type: "mock" }, saved(), [], false)).toEqual({ systemAudio: false, micDeviceId: "mic-usb" });
    expect(rejoinLaunch({ id: "s1", type: "interview" }, saved(), [], true)).toEqual({ systemAudio: false, micDeviceId: "mic-usb" });
  });

  it("listens to the same app again, found by exe when its PID changed", () => {
    const storage = memory();
    rememberLaunch("s1", { systemAudio: true, micDeviceId: "mic-usb", systemProcessId: 40, systemProcessExe: "Zoom.exe" }, storage);
    const last = loadSavedAudio(storage).last;
    expect(rejoinLaunch({ id: "s1", type: "interview" }, saved({ last }), [app(77, "Zoom.exe", true)], false)).toEqual({
      systemAudio: true,
      micDeviceId: "mic-usb",
      systemProcessId: 77,
      systemProcessExe: "Zoom.exe",
    });
    // not running right now: still that app (capture waits for it), never silently everything
    expect(rejoinLaunch({ id: "s1", type: "interview" }, saved({ last }), [], false)).toMatchObject({
      systemProcessId: 40,
      systemProcessExe: "Zoom.exe",
    });
  });

  it("keeps that session's own choices, and ignores another session's", () => {
    const storage = memory();
    rememberLaunch("s1", { systemAudio: false, micDeviceId: "mic-headset" }, storage);
    const last = loadSavedAudio(storage).last;
    expect(rejoinLaunch({ id: "s1", type: "interview" }, saved({ last }), [], false)).toEqual({
      systemAudio: false,
      micDeviceId: "mic-headset",
    });
    expect(rejoinLaunch({ id: "s2", type: "interview" }, saved({ last }), [], false)).toEqual({
      systemAudio: true,
      micDeviceId: "mic-usb",
      systemDevice: "communications",
    });
  });

  it("survives unreadable saved data", () => {
    const storage = memory();
    storage.setItem("orbit.lastLaunch", "{not json");
    expect(loadSavedAudio(storage).last).toBeNull();
  });
});
