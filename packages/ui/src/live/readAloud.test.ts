import { describe, expect, it } from "vitest";
import { applyOverrides, scoreKeyPoints } from "./coverage";
import { speechChunks, speechText } from "./readAloud";

const answer = (direct_answer: string, talking_points: string[] = []) =>
  ({ direct_answer, talking_points }) as unknown as Parameters<typeof speechText>[0];

describe("read aloud text", () => {
  it("reads the answer and talking points, never a [fill in] prompt verbatim", () => {
    const text = speechText(answer("At [company] I led the migration to `Postgres`.", ["Cut costs by half", "Zero downtime."]));
    expect(text).toBe("At … I led the migration to Postgres. Cut costs by half. Zero downtime.");
    expect(text).not.toContain("[");
  });

  it("reads values in brackets (an example's input and output), which aren't fill-ins", () => {
    expect(speechText(answer("For nums [2, 7, 11, 15] and target 9, I return [0, 1].")))
      .toBe("For nums [2, 7, 11, 15] and target 9, I return [0, 1].");
  });

  it("normalizes whitespace before punctuation without leaving a space", () => {
    expect(speechText(answer("Words      , separated\t\t!"))).toBe("Words, separated!");
  });

  it("normalizes long whitespace runs without losing punctuation or code formatting", () => {
    expect(speechText(answer(`Hello${" ".repeat(100_000)}, \`world\`!`))).toBe("Hello, world!");
  });

  it("is empty when there's nothing to say", () => {
    expect(speechText(answer(""))).toBe("");
  });

  it("chunks by sentence, within the limit, without splitting words", () => {
    const long = "word ".repeat(80).trim() + ".";
    const chunks = speechChunks(`First sentence. Second one! ${long} Last?`, 60);
    expect(chunks[0]).toBe("First sentence. Second one!");
    expect(chunks.every((c) => c.length <= 60)).toBe(true);
    expect(chunks.join(" ").split(/\s+/).filter((w) => w.startsWith("word")).length).toBe(80);
    expect(chunks.at(-1)).toBe("Last?");
  });

  it("keeps closing quotes with their sentence, drops stray end marks, and handles long unpunctuated text", () => {
    expect(speechChunks('He said "Ship it." Then? ...and "done"', 20)).toEqual(['He said "Ship it."', 'Then? and "done"']);
    expect(speechChunks(`${" ".repeat(100_000)}x`)).toEqual(["x"]);
  });
});

describe("manual key point overrides", () => {
  const POINTS = ["Start with the build", "Scan dependencies", "Block on critical findings"];
  const ANSWER = "I start with the build. I scan dependencies. I block only on critical findings.";

  it("a click ticks a point the transcript missed, and NEXT moves on", () => {
    const auto = scoreKeyPoints(POINTS, ANSWER, "");
    const p = applyOverrides(auto, new Map([[POINTS[0]!, true]]));
    expect(p.points[0]).toMatchObject({ covered: true, manual: true });
    expect(p.next).toBe(1);
  });

  it("a click unticks a false match", () => {
    const auto = scoreKeyPoints(POINTS, ANSWER, "I start with the build");
    expect(auto.points[0]!.covered).toBe(true);
    const p = applyOverrides(auto, new Map([[POINTS[0]!, false]]));
    expect(p.points[0]!.covered).toBe(false);
    expect(p.next).toBe(0);
  });

  it("all ticked by hand: nothing is next", () => {
    const p = applyOverrides(scoreKeyPoints(POINTS, ANSWER, ""), new Map(POINTS.map((label) => [label, true])));
    expect(p.next).toBeNull();
  });
});
