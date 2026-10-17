import { describe, expect, it } from "vitest";
import { GLOBAL_DEFAULTS, formatAccelerator, inTurn, migrateShortcuts, type GlobalAction } from "./globalShortcuts";

/** What Settings saved before: the full map, with whatever the user changed. */
const OLD_SAVED: Record<GlobalAction, string> = {
  toggleWindow: "CommandOrControl+Shift+O",
  answer: "CommandOrControl+Shift+Enter",
  screenshot: "CommandOrControl+Shift+2",
  prevAnswer: "CommandOrControl+Alt+Left",
  nextAnswer: "CommandOrControl+Alt+Right",
  copyAnswer: "CommandOrControl+Shift+Y",
  togglePause: "CommandOrControl+Alt+P",
  moreTransparent: "CommandOrControl+Alt+Down",
  lessTransparent: "CommandOrControl+Alt+Up",
};

const effective = (saved: Partial<Record<GlobalAction, string>>) => ({ ...GLOBAL_DEFAULTS, ...migrateShortcuts(saved) });

describe("global shortcut defaults", () => {
  it("avoid the meeting apps' call controls", () => {
    const taken = [
      "CommandOrControl+Shift+O", // Teams: camera on/off; Zoom: AI panel
      "CommandOrControl+Shift+Y", // Teams: admit from the lobby; Zoom: reactions
      "CommandOrControl+Shift+M", // Teams: mute
      "CommandOrControl+Alt+P", // Meet: participants
      "CommandOrControl+Shift+Enter", // Teams: reset the pane width
      "CommandOrControl+Alt+Left", // Teams: previous calendar period
      "CommandOrControl+Alt+Right",
    ];
    for (const acc of Object.values(GLOBAL_DEFAULTS)) expect(taken).not.toContain(acc);
    expect(new Set(Object.values(GLOBAL_DEFAULTS)).size).toBe(Object.keys(GLOBAL_DEFAULTS).length);
  });

  it("move people still on the old defaults", () => {
    expect(effective(OLD_SAVED)).toEqual(GLOBAL_DEFAULTS);
  });

  it("keep a combo the user picked", () => {
    const got = effective({ ...OLD_SAVED, toggleWindow: "CommandOrControl+Alt+H", copyAnswer: "CommandOrControl+Shift+O" });
    expect(got.toggleWindow).toBe("CommandOrControl+Alt+H");
    expect(got.copyAnswer).toBe("CommandOrControl+Shift+O"); // someone else's old default, chosen on purpose
    expect(got.answer).toBe(GLOBAL_DEFAULTS.answer);
  });

  it("never move an action onto a combo another one already uses", () => {
    // the user put "answer" on what is now Show / hide's default: Show / hide stays where it was
    const got = effective({ ...OLD_SAVED, answer: "CommandOrControl+Shift+1" });
    expect(got.answer).toBe("CommandOrControl+Shift+1");
    expect(got.toggleWindow).toBe("CommandOrControl+Shift+O");
  });

  it("leave nothing saved alone, and are shown readably", () => {
    expect(effective({})).toEqual(GLOBAL_DEFAULTS);
    expect(formatAccelerator("CommandOrControl+Alt+PageUp")).toBe("Ctrl+Alt+PgUp");
    expect(formatAccelerator("CommandOrControl+Alt+Down")).toBe("Ctrl+Alt+↓");
  });
});

describe("registration runs one change at a time", () => {
  it("finishes a slow run before the next starts, even when one fails", async () => {
    const log: string[] = [];
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const first = inTurn(async () => {
      log.push("old: register A");
      await wait(20);
      log.push("old: register B");
    });
    const failing = inTurn(async () => {
      log.push("cleanup");
      throw new Error("unregister failed");
    });
    const next = inTurn(async () => {
      log.push("new: register A");
    });
    await Promise.all([first, failing, next]);
    expect(log).toEqual(["old: register A", "old: register B", "cleanup", "new: register A"]);
  });
});
