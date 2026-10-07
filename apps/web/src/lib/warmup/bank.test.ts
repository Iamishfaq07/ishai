import { describe, expect, it } from "vitest";
import { ROUND, TRACKS, pickRound, trackById } from "./bank";

describe("the warm-up's question bank", () => {
  it("has about 150 questions across its tracks, each with an id, a kind and a tip", () => {
    const all = TRACKS.flatMap((t) => t.questions);
    expect(all.length).toBeGreaterThanOrEqual(140);
    expect(new Set(all.map((q) => q.id)).size).toBe(all.length); // ids are unique
    for (const q of all) {
      expect(q.text.trim().length).toBeGreaterThan(10);
      expect(q.tip.trim().length).toBeGreaterThan(10);
    }
    for (const t of TRACKS) expect(t.questions.length).toBeGreaterThanOrEqual(ROUND * 3);
  });

  it("is written for India: rupees and Indian companies, no dollars", () => {
    const text = JSON.stringify(TRACKS);
    expect(text).not.toContain("$");
    expect(text).toContain("TCS");
    expect(trackById("campus_hr")?.name).toBe("Campus HR round");
  });

  it("starts each round with the track's introduction, then mixes kinds, without repeats", () => {
    const track = trackById("sde")!;
    let seed = 0.13;
    const random = () => (seed = (seed * 9301 + 0.49297) % 1);
    const round = pickRound(track, [], ROUND, random);
    expect(round).toHaveLength(ROUND);
    expect(round[0]!.kind).toBe("intro");
    expect(new Set(round.map((q) => q.id)).size).toBe(ROUND);
    expect(new Set(round.map((q) => q.kind)).size).toBeGreaterThanOrEqual(3);
  });

  it("skips what was just asked while there's enough else", () => {
    const track = trackById("campus_hr")!;
    const first = pickRound(track);
    const second = pickRound(track, first.map((q) => q.id));
    const repeats = second.slice(1).filter((q) => first.some((f) => f.id === q.id));
    expect(repeats).toEqual([]);
  });
});
