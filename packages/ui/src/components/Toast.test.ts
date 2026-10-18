import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToastQueue } from "./Toast";

const messages = (q: ReturnType<typeof createToastQueue>) => q.snapshot().map((t) => `${t.message}${t.leaving ? " (leaving)" : ""}`);

describe("toast queue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a toast, then fades it out after its time", () => {
    const q = createToastQueue({ exitMs: () => 160 });
    q.show("Copied");
    expect(messages(q)).toEqual(["Copied"]);
    vi.advanceTimersByTime(4999);
    expect(messages(q)).toEqual(["Copied"]);
    vi.advanceTimersByTime(1);
    expect(messages(q)).toEqual(["Copied (leaving)"]);
    vi.advanceTimersByTime(160);
    expect(messages(q)).toEqual([]);
  });

  it("gives an action and an error more time, and 0 means until closed", () => {
    const q = createToastQueue({ exitMs: () => 0 });
    q.show({ message: "Story deleted", action: { label: "Undo", onClick: () => {} } });
    q.show({ message: "Couldn't save", tone: "error" });
    const pinned = q.show({ message: "Offline", duration: 0 });
    vi.advanceTimersByTime(5000);
    expect(messages(q)).toEqual(["Story deleted", "Couldn't save", "Offline"]);
    vi.advanceTimersByTime(2000);
    expect(messages(q)).toEqual(["Story deleted", "Offline"]);
    vi.advanceTimersByTime(1000);
    expect(messages(q)).toEqual(["Offline"]);
    vi.advanceTimersByTime(60_000);
    expect(messages(q)).toEqual(["Offline"]);
    q.dismiss(pinned);
    expect(messages(q)).toEqual([]);
  });

  it("removes at once when motion is off", () => {
    let exit = 160;
    const q = createToastQueue({ exitMs: () => exit });
    const id = q.show("Saved");
    exit = 0;
    q.dismiss(id);
    expect(messages(q)).toEqual([]);
  });

  it("runs Undo once and closes the toast", () => {
    const q = createToastQueue({ exitMs: () => 0 });
    const undo = vi.fn();
    const id = q.show({ message: "Story deleted", action: { label: "Undo", onClick: undo } });
    q.act(id);
    q.act(id);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(messages(q)).toEqual([]);
  });

  it("keeps three on screen: a fourth pushes the oldest out", () => {
    const q = createToastQueue({ max: 3, exitMs: () => 160 });
    ["One", "Two", "Three", "Four"].forEach((m) => q.show(m));
    expect(messages(q)).toEqual(["One (leaving)", "Two", "Three", "Four"]);
    vi.advanceTimersByTime(160);
    expect(messages(q)).toEqual(["Two", "Three", "Four"]);
  });

  it("replaces a toast with the same id in place and restarts its time", () => {
    const q = createToastQueue({ exitMs: () => 0 });
    q.show({ id: "copy", message: "Copied" });
    q.show("Saved");
    vi.advanceTimersByTime(4000);
    q.show({ id: "copy", message: "Copied again" });
    expect(messages(q)).toEqual(["Copied again", "Saved"]);
    vi.advanceTimersByTime(1000);
    expect(messages(q)).toEqual(["Copied again"]);
    vi.advanceTimersByTime(4000);
    expect(messages(q)).toEqual([]);
  });

  it("brings back a toast re-shown while it was leaving", () => {
    const q = createToastQueue({ exitMs: () => 160 });
    const id = q.show({ id: "copy", message: "Copied" });
    q.dismiss(id);
    q.show({ id: "copy", message: "Copied" });
    vi.advanceTimersByTime(200);
    expect(messages(q)).toEqual(["Copied"]);
  });

  it("rewrites a toast on screen in place, on its old clock, and never brings one back", () => {
    const q = createToastQueue({ exitMs: () => 160 });
    q.show({ id: "ats", message: "Your resume scores 82. Ready to apply?", duration: 8000 });
    q.show("Saved");
    vi.advanceTimersByTime(3000);
    expect(q.update("ats", { message: "Your resume scores 99. Ready to apply?" })).toBe(true);
    expect(messages(q)).toEqual(["Your resume scores 99. Ready to apply?", "Saved"]);
    expect(q.snapshot()[0]).toMatchObject({ tone: "neutral", duration: 8000 });
    vi.advanceTimersByTime(5000); // 8 s from when it appeared, not from the rewrite
    expect(messages(q)).toEqual(["Your resume scores 99. Ready to apply? (leaving)"]);
    expect(q.update("ats", { message: "Your resume scores 100. Ready to apply?" })).toBe(false);
    vi.advanceTimersByTime(160);
    expect(q.update("ats", { message: "Your resume scores 100. Ready to apply?" })).toBe(false);
    expect(messages(q)).toEqual([]);
  });

  it("stops the clock while held for any reason, and goes on with the time that was left", () => {
    const q = createToastQueue({ exitMs: () => 0 });
    q.show("Saved to tracker");
    vi.advanceTimersByTime(3000);
    q.hold("pointer", true);
    q.hold("hidden", true);
    vi.advanceTimersByTime(60_000);
    q.hold("pointer", false);
    vi.advanceTimersByTime(60_000);
    expect(messages(q)).toEqual(["Saved to tracker"]);
    q.hold("hidden", false);
    vi.advanceTimersByTime(1999);
    expect(messages(q)).toEqual(["Saved to tracker"]);
    vi.advanceTimersByTime(1);
    expect(messages(q)).toEqual([]);
    // A toast that arrives while held waits too.
    q.hold("focus", true);
    q.show("Copied");
    vi.advanceTimersByTime(10_000);
    expect(messages(q)).toEqual(["Copied"]);
    q.hold("focus", false);
    vi.advanceTimersByTime(5000);
    expect(messages(q)).toEqual([]);
  });

  it("tells subscribers about every change, until they unsubscribe", () => {
    const q = createToastQueue({ exitMs: () => 0 });
    const seen = vi.fn();
    const off = q.subscribe(seen);
    const id = q.show("Copied");
    q.dismiss(id);
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    q.show("Saved");
    expect(seen).toHaveBeenCalledTimes(2);
    expect(q.snapshot()).toBe(q.snapshot());
  });
});
