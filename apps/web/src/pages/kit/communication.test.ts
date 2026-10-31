import { describe, expect, it } from "vitest";
import { BUILD, STORIES, newRound, roundScore, scoreItem, shuffled, wordMatch } from "./communication";

describe("communication test scoring", () => {
  it("scores a sentence said back word for word, and less for missing or extra words", () => {
    const s = "The meeting has been moved to the second floor.";
    expect(wordMatch(s, "the meeting has been moved to the second floor")).toBe(1);
    expect(wordMatch(s, "The meeting was moved to the second floor")).toBeLessThan(1);
    expect(wordMatch(s, "the meeting the meeting has been moved to the second floor")).toBeLessThan(1);
    expect(wordMatch("It starts at 9 in room 4", "it starts at nine in room four")).toBe(1); // digits as words
  });

  it("says which words were missed", () => {
    const r = scoreItem("repeat", "Could you send me the file before lunch?", "could you send the file", 5);
    expect(r.score).toBeLessThan(90);
    expect(r.note).toContain("me");
    expect(r.note).toContain("lunch");
  });

  it("finds a retelling's key points in the candidate's own words", () => {
    const story = STORIES[0]!;
    const full = scoreItem("retell", story.text, "Priya worked in a bakery. The power went out so she sold the bread outside at half price. By noon it was all gone and customers came back the next day.", 30, story);
    const thin = scoreItem("retell", story.text, "There was a bakery.", 5, story);
    expect(full.score).toBeGreaterThanOrEqual(90);
    expect(thin.score).toBeLessThan(40);
    expect(thin.note).toContain("the power went out");
  });

  it("rewards a reason and an example on an open question", () => {
    const answer = "I prefer working in a team because ideas get better when people disagree. For example, in my final year project our group found a bug I had missed for a week, and we fixed it together in an afternoon.";
    const good = scoreItem("open", "Team or alone?", answer, 20);
    const bare = scoreItem("open", "Team or alone?", "Team.", 20);
    expect(good.score).toBeGreaterThan(70);
    expect(bare.score).toBeLessThan(30);
    expect(scoreItem("open", "x", "", 10).score).toBe(0);
  });

  it("makes a round of every section and never leaves a sentence build in order", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const round = newRound(rand);
    expect(round.map((r) => r.section)).toEqual(["read", "read", "repeat", "repeat", "build", "build", "retell", "open"]);
    for (const parts of BUILD) expect(shuffled(parts, rand).join("|")).not.toBe(parts.join("|"));
    const results = round.map((r) => scoreItem(r.section, r.prompt, r.prompt, 20, r.story));
    expect(roundScore(results).bySection.map((s) => s.id)).toEqual(["read", "repeat", "build", "retell", "open"]);
  });
});
