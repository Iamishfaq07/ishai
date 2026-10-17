import { describe, expect, it } from "vitest";
import { NEAR_BOTTOM_PX, stickItems, stickJump, stickScrolled, stickStart } from "./stickToBottom";
import { groupLines, transcriptText, type TranscriptLine } from "../components/TranscriptLog";

describe("stick to the bottom", () => {
  it("follows new lines while you're at the bottom, or close to it", () => {
    let s = stickStart(3);
    s = stickItems(s, 4);
    expect(s).toEqual({ stuck: true, seen: 4, unseen: 0 });
    s = stickScrolled(s, NEAR_BOTTOM_PX, 4); // within 48 px still counts as the bottom
    expect(s.stuck).toBe(true);
    s = stickItems(s, 9);
    expect(s).toEqual({ stuck: true, seen: 9, unseen: 0 });
  });

  it("stops following when you scroll up to read, and counts what arrives", () => {
    let s = stickStart(10);
    s = stickScrolled(s, 400, 10);
    expect(s.stuck).toBe(false);
    s = stickItems(s, 11);
    s = stickItems(s, 13);
    expect(s).toEqual({ stuck: false, seen: 10, unseen: 3 });
    // Reading on further up changes nothing.
    expect(stickScrolled(s, 900, 13)).toBe(s);
  });

  it("follows again when you jump to the latest, or scroll back down yourself", () => {
    const up = stickItems(stickScrolled(stickStart(10), 400, 10), 25);
    expect(up.unseen).toBe(15);
    expect(stickJump(up, 25)).toEqual({ stuck: true, seen: 25, unseen: 0 });
    expect(stickScrolled(up, 12, 25)).toEqual({ stuck: true, seen: 25, unseen: 0 });
    // ...and then follows the next line.
    expect(stickItems(stickJump(up, 25), 26)).toEqual({ stuck: true, seen: 26, unseen: 0 });
  });

  it("copes with the list being cleared while you read back", () => {
    const up = stickItems(stickScrolled(stickStart(10), 400, 10), 12);
    expect(stickItems(up, 0)).toEqual({ stuck: false, seen: 0, unseen: 0 });
  });

  it("returns the same state when nothing changed (no extra renders)", () => {
    const s = stickStart(5);
    expect(stickItems(s, 5)).toBe(s);
    expect(stickScrolled(s, 0, 5)).toBe(s);
  });
});

describe("transcript lines", () => {
  const line = (id: string, speaker: TranscriptLine["speaker"], at: number, text = id, final = true): TranscriptLine => ({ id, speaker, text, final, at });

  it("groups consecutive lines from one speaker, and starts a new group after a long gap", () => {
    const groups = groupLines([line("a", "interviewer", 0), line("b", "candidate", 5), line("c", "candidate", 9), line("d", "candidate", 200), line("e", "interviewer", 201)]);
    expect(groups.map((g) => [g.speaker, g.lines.map((l) => l.id).join("")])).toEqual([
      ["interviewer", "a"],
      ["candidate", "bc"],
      ["candidate", "d"],
      ["interviewer", "e"],
    ]);
    expect(groups[1]!.at).toBe(5);
  });

  it("copies final lines as text, with names and times", () => {
    const text = transcriptText(
      [line("a", "interviewer", 3, "Tell me about yourself."), line("b", "candidate", 65, "I build payments systems."), line("c", "candidate", 70, "and…", false)],
      { interviewer: "Saba", candidate: "You", other: "Other", unknown: "Speaker" },
    );
    expect(text).toBe("Saba (0:03): Tell me about yourself.\nYou (1:05): I build payments systems.");
  });

  it("writes hours once a session runs past one", () => {
    expect(transcriptText([line("a", "candidate", 3725, "Still here.")])).toBe("You (1:02:05): Still here.");
  });
});
