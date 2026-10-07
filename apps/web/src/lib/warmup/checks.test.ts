import { describe, expect, it } from "vitest";
import {
  MIN_WORDS,
  checkAnswer,
  checkClarity,
  checkLength,
  checkOwnership,
  checkSpecifics,
  checkStructure,
  fillers,
  numbersIn,
  spokenTime,
  summarise,
  words,
} from "./checks";

const STAR_ANSWER =
  "During my third year, our college fest needed sponsors and the budget was short by ₹2 lakh. My role was to lead the sponsorship team of " +
  "five students. I split the city into areas, wrote a one-page pitch and called 40 local shops myself. As a result we raised ₹2.5 lakh, " +
  "25% more than the target, and I learnt to follow up the same day.";

const INTRO_ANSWER =
  "I'm a final-year B.Tech student in computer science at VIT, Vellore. During my internship at a fintech startup I built a dashboard in " +
  "React that the support team used every day, and it cut their report time from two hours to twenty minutes. I've also built two " +
  "projects with Python and SQL. I'm looking for a backend role where I can learn to build systems at scale, which is why this job " +
  "excites me.";

const n = (count: number) => Array.from({ length: count }, () => "word").join(" ");

describe("counting what was said", () => {
  it("counts words, ignoring punctuation", () => {
    expect(words("I built it, and it worked!")).toEqual(["i", "built", "it", "and", "it", "worked"]);
    expect(words("₹2.5 lakh, 25% more")).toEqual(["₹2.5", "lakh", "25%", "more"]);
    expect(words("   ")).toEqual([]);
  });

  it("says how long an answer takes to say at an easy pace", () => {
    expect(spokenTime(130)).toBe("about 1 min");
    expect(spokenTime(100)).toBe("about 45 seconds");
    expect(spokenTime(200)).toBe("about 1 min 30 s");
  });
});

describe("length", () => {
  it("is good inside the range, a nudge just outside, and a fix far outside", () => {
    expect(checkLength(120, [90, 190]).verdict).toBe("good");
    expect(checkLength(70, [90, 190]).verdict).toBe("ok");
    expect(checkLength(30, [90, 190])).toMatchObject({ verdict: "improve", detail: expect.stringContaining("Short") });
    expect(checkLength(210, [90, 190]).verdict).toBe("ok");
    expect(checkLength(300, [90, 190])).toMatchObject({ verdict: "improve", detail: expect.stringContaining("Long") });
  });
});

describe("STAR, for a story", () => {
  it("finds all four parts in a complete story", () => {
    expect(checkStructure(STAR_ANSWER, "story")).toMatchObject({ label: "STAR", verdict: "good" });
  });

  it("names the missing parts, and asks for a result", () => {
    const c = checkStructure("I organised the fest. I called many sponsors and I planned everything with my team.", "story")!;
    expect(c.verdict).toBe("improve");
    expect(c.detail).toContain("result");
    expect(c.detail).toContain("situation");
  });
});

describe("an introduction", () => {
  it("wants who you are now, what you've done, and why this job", () => {
    expect(checkStructure(INTRO_ANSWER, "intro")).toMatchObject({ label: "Shape", verdict: "good" });
    expect(checkStructure("I'm a final-year student at a college in Pune and I like coding a lot.", "intro")!.verdict).toBe("improve");
  });

  it("flags family and hometown details, a common habit in Indian interviews", () => {
    const c = checkStructure(`${INTRO_ANSWER} My father is a farmer and my native place is Nashik.`, "intro")!;
    expect(c.verdict).toBe("ok");
    expect(c.detail).toContain("Skip family and hometown");
  });
});

describe("the other kinds of question", () => {
  it("situational: steps in order, and what you would do", () => {
    expect(checkStructure("First I would listen and let them finish. Then I'd apologise and check the order. Finally I would fix it.", "situational")!.verdict).toBe("good");
    expect(checkStructure("The customer should calm down and the manager can handle it.", "situational")!.verdict).toBe("improve");
  });

  it("case: assumptions, steps and numbers", () => {
    const answer = "Let's say Bengaluru has about 1.3 crore people and 40 lakh households. Assume one in four buys a two-wheeler every 5 years, so that gives roughly 2 lakh a year.";
    expect(checkStructure(answer, "case")!.verdict).toBe("good");
    expect(checkStructure("It depends on many things like traffic and income.", "case")!.verdict).toBe("improve");
  });

  it("reflection: honest, with what you're doing about it, and no rehearsed 'perfectionist'", () => {
    expect(checkStructure("I used to avoid speaking in meetings. Now I volunteer to present once a week and I'm improving.", "reflection")!.verdict).toBe("good");
    expect(checkStructure("I am a perfectionist and I work too hard.", "reflection")).toMatchObject({ verdict: "improve", detail: expect.stringContaining("rehearsed") });
  });

  it("motivation: a reason, tied to the company or role", () => {
    expect(checkStructure("I want to join because your training programme is the best for freshers.", "motivation")!.verdict).toBe("good");
    expect(checkStructure("It is a big company with a good name.", "motivation")!.verdict).toBe("improve");
  });

  it("knowledge: plain words and an example", () => {
    expect(checkStructure("A stack is last in, first out. For example, the undo button takes back your latest change first.", "knowledge")!.verdict).toBe("good");
    expect(checkStructure("A stack is a linear data structure.", "knowledge")!.verdict).toBe("ok");
  });

  it("closing questions have no shape to check", () => {
    expect(checkStructure("What does a good first year look like here?", "closing")).toBeNull();
  });
});

describe("numbers", () => {
  it("finds rupees, percentages, figures and number words, but not years", () => {
    expect(numbersIn(STAR_ANSWER)).toEqual(expect.arrayContaining(["₹2 lakh", "five", "40", "₹2.5 lakh", "25%"]));
    expect(numbersIn("In 2024 I joined, and in 2025 I left.")).toEqual([]);
    expect(checkSpecifics(STAR_ANSWER).verdict).toBe("good");
    expect(checkSpecifics("We got 3 sponsors.").verdict).toBe("ok");
    expect(checkSpecifics("We got many sponsors.").verdict).toBe("improve");
  });
});

describe("I and we", () => {
  it("asks for your own part when it's all 'we'", () => {
    expect(checkOwnership("We planned it, we built it, and our team won. We were happy.").verdict).toBe("improve");
    expect(checkOwnership(STAR_ANSWER).verdict).toBe("good");
    expect(checkOwnership("The project was finished on time.").verdict).toBe("ok");
  });
});

describe("fillers and hedges", () => {
  it("counts them, Indian English and Hinglish ones too", () => {
    const text = "Basically I think I was, like, the lead. Matlab I basically handled the team, you know. So yeah.";
    expect(fillers(text)).toEqual(expect.arrayContaining([["basically", 2], ["I think", 1], ["like", 1], ["matlab", 1], ["you know", 1], ["so yeah", 1]]));
    expect(checkClarity(text, words(text).length, false).verdict).toBe("improve");
    expect(checkClarity(STAR_ANSWER, words(STAR_ANSWER).length, false).verdict).toBe("good");
  });

  it("doesn't count 'like' as a verb or 'you know how' as a filler", () => {
    expect(fillers("I like Python and you know how it is used in data work.")).toEqual([]);
  });

  it("says speech-to-text may have dropped some when the answer was spoken", () => {
    expect(checkClarity("I built it and it worked well for the team.", 10, true).detail).toContain("Speech-to-text");
  });
});

describe("a whole answer", () => {
  it("gets nothing until there's enough to read", () => {
    expect(checkAnswer("Hi.", { kind: "intro" })).toEqual([]);
    expect(checkAnswer(n(MIN_WORDS), { kind: "closing" }).map((c) => c.id)).toEqual(["length", "clarity"]);
  });

  it("gets the checks its kind of question wants, in order", () => {
    expect(checkAnswer(STAR_ANSWER, { kind: "story" }).map((c) => c.id)).toEqual(["length", "structure", "specifics", "ownership", "clarity"]);
    expect(checkAnswer(INTRO_ANSWER, { kind: "intro" }).map((c) => c.id)).toEqual(["length", "structure", "specifics", "clarity"]);
    expect(checkAnswer(INTRO_ANSWER, { kind: "knowledge" }).map((c) => c.id)).toEqual(["length", "structure", "clarity"]);
  });

  it("uses the question's own length when it has one (a 30-second intro)", () => {
    const length = checkAnswer(INTRO_ANSWER, { kind: "intro", words: [50, 60] })[0]!;
    expect(length.verdict).not.toBe("good");
  });
});

describe("a round", () => {
  it("names the strengths and the one thing to work on", () => {
    const story = checkAnswer(STAR_ANSWER, { kind: "story" });
    const thin = checkAnswer("We did the project. We finished it on time. It was fine for us.", { kind: "story" });
    const s = summarise([story, thin, []]);
    expect(s.answered).toBe(2);
    expect(s.strengths).toContain("clarity");
    expect(s.focus).not.toBeNull();
    expect(s.labels.structure).toBe("Structure");
    expect(summarise([]).focus).toBeNull();
  });
});
