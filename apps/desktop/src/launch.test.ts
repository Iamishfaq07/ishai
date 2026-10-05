import { describe, expect, it } from "vitest";
import type { AudioApp } from "./native";
import { checkChosenApp, meetingAppPlaying, nextSource } from "./launch";

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
