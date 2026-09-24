import { describe, expect, it } from "vitest";
import { contentWords, fallbackPoints, scoreKeyPoints } from "./coverage";

const ANSWER =
  "I'd start at the pull request and the build, so problems show up before anything ships. " +
  "In the pipeline I run SAST, SCA and secret scanning on every change. " +
  "I only block the build on high-confidence critical findings, and everything else goes to a triage queue. " +
  "Later, DAST runs against the integration environment. " +
  "At Northwind that cut critical findings in production by sixty percent.";
const POINTS = ["Start at PR and build", "SAST + SCA + secret scanning", "Risk-based blocking", "DAST in integration", "Measurable outcome"];

describe("key point coverage", () => {
  it("nothing said yet: the first point is next", () => {
    const p = scoreKeyPoints(POINTS, ANSWER, "");
    expect(p.points.every((x) => !x.covered)).toBe(true);
    expect(p.next).toBe(0);
  });

  it("ticks points as the candidate paraphrases them, and points at the next one", () => {
    const spoken =
      "So I'd begin right at the pull request and the build stage. Then we scan: static analysis, SCA and " +
      "secrets scanning on each commit.";
    const p = scoreKeyPoints(POINTS, ANSWER, spoken);
    expect(p.points.map((x) => x.covered)).toEqual([true, true, false, false, false]);
    expect(p.next).toBe(2);
  });

  it("the sentence a point summarises counts too (label words alone aren't required)", () => {
    // "risk-based" is never said, but the blocking sentence is paraphrased
    const spoken = "we block the build only for high confidence critical findings, the rest go to triage";
    expect(scoreKeyPoints(POINTS, ANSWER, spoken).points[2]!.covered).toBe(true);
  });

  it("skipping ahead: next is the point after the last one covered", () => {
    const spoken = "DAST runs against the integration environment later on";
    const p = scoreKeyPoints(POINTS, ANSWER, spoken);
    expect(p.points[3]!.covered).toBe(true);
    expect(p.next).toBe(4);
  });

  it("never un-ticks, and reports done when everything is covered", () => {
    const p = scoreKeyPoints(POINTS, ANSWER, "unrelated words", new Set([0, 1, 2, 3, 4]));
    expect(p.points.every((x) => x.covered)).toBe(true);
    expect(p.next).toBeNull();
  });

  it("an on-topic answer that makes different points ticks none of these", () => {
    const spoken = "Honestly we mostly relied on code review and a weekly security meeting with the team leads";
    expect(scoreKeyPoints(POINTS, ANSWER, spoken).points.filter((x) => x.covered)).toEqual([]);
  });

  it("filler speech covers nothing", () => {
    const p = scoreKeyPoints(POINTS, ANSWER, "um yeah so okay I think that's a really good question, right");
    expect(p.points.some((x) => x.covered)).toBe(false);
  });

  it("falls back to paragraph openings when the answer came without points", () => {
    const answer = "First you'd hash the long URL into a short code, using base62.\n\n" +
      "Then store the mapping in a key-value store with a cache in front.\n\nOne paragraph more.";
    expect(fallbackPoints(answer)).toEqual([
      "you'd hash the long URL into a…", "store the mapping in a key-value store…", "One paragraph more"]);
    expect(fallbackPoints("Just one paragraph.")).toEqual([]);
  });

  it("stems plural/verb forms together and drops stop words", () => {
    expect([...contentWords("The scanners were scanning secrets")].sort()).toEqual(["scann", "secre"]);
  });
});
