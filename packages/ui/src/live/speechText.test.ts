import { describe, expect, it } from "vitest";
import { speakable, SECOND_CHUNK_CHARS, speechChunks, syllableCount, wordTimeline } from "./speechText";

describe("text shaped for speech", () => {
  it("reads acronyms the way people say them", () => {
    expect(speakable("How would you index this SQL table on AWS?")).toBe("How would you index this sequel table on A W S?");
    expect(speakable("Your CI/CD pipeline and the API, in C++ or .NET?")).toBe("Your C I C D pipeline and the A P I, in C plus plus or dot net?");
    expect(speakable("Which KPIs, and the SDEs' OKRs?")).toBe("Which K P Is, and the S D Es' O K Rs?");
    expect(speakable("PostgreSQL vs. MySQL")).toBe("postgres versus my sequel");
    expect(speakable("I work in IT")).toBe("I work in I T");
  });

  it("says money, percentages, ranges and Indian salaries right", () => {
    expect(speakable("The CTC is ₹12 LPA, up 20%.")).toBe("The C T C is 12 lakhs per annum, up 20 percent.");
    expect(speakable("A ₹50,000 bonus or $120k?")).toBe("A 50,000 rupees bonus or 120 thousand dollars?");
    expect(speakable("2019-2021, 3-4 years")).toBe("2019 to 2021, 3 to 4 years");
  });

  it("doesn't read markdown, list numbers or links", () => {
    expect(speakable("**Tell me** about `useEffect`:\n1. why\n2. when")).toBe("Tell me about useEffect: why. when");
    expect(speakable("See [the docs](https://example.com) or https://x.y/z")).toBe("See the docs or the link");
    expect(speakable("Think about it - then answer")).toBe("Think about it, then answer");
  });

  it("leaves ordinary words and capitalised words alone", () => {
    expect(speakable("I think so. OK, go on.")).toBe("I think so. OK, go on.");
    expect(speakable("Priya at Infosys")).toBe("Priya at Infosys");
  });
});

describe("sentence by sentence", () => {
  it("says the first sentence alone so it starts sooner, and joins tiny sentences to a neighbour", () => {
    expect(speechChunks("Hi, my name is Saba. I'll be taking your interview today. Let's start.")).toEqual([
      "Hi, my name is Saba.",
      "I'll be taking your interview today. Let's start.",
    ]);
    expect(speechChunks("Hi. Thanks for coming in today. Tell me about yourself.")).toEqual([
      "Hi. Thanks for coming in today.",
      "Tell me about yourself.",
    ]);
    expect(speechChunks("Tell me about yourself.")).toEqual(["Tell me about yourself."]);
    expect(speechChunks("  ")).toEqual([]);
  });

  it("splits a long first sentence at a clause, and grows the pieces after it (at most three)", () => {
    const long = "So before we get into the technical part of today, I'd love to hear how you got into backend engineering in the first place.";
    const out = speechChunks(long);
    expect(out[0]).toBe("So before we get into the technical part of today,");
    expect(out.join(" ")).toBe(long);
    // The opening and the plan from a real run: four requests a line before (D76), three now, the first one short.
    const plan = "Glad to hear it. So, for the next 5 minutes or so, we'll focus on application security. I'll ask some questions and may dig into your answers. When you're done with one, just pause. To start, could you briefly introduce yourself and walk me through your background?";
    const pieces = speechChunks(plan);
    expect(pieces).toHaveLength(3);
    expect(pieces[0]).toBe("Glad to hear it.");
    expect(pieces[1]!.length).toBeLessThanOrEqual(SECOND_CHUNK_CHARS);
    expect(pieces.join(" ")).toBe(plan);
    expect(speechChunks("Hi Arjun, I'm Saba. Thanks for joining. How are you doing today?")).toEqual([
      "Hi Arjun, I'm Saba.",
      "Thanks for joining. How are you doing today?",
    ]);
    expect(speechChunks("One two three. Four five six. Seven eight nine. Ten eleven twelve. Thirteen fourteen fifteen.")).toHaveLength(2);
  });
});

describe("when each word is said", () => {
  it("spreads the words across the clip by syllables, with pauses at commas and sentence ends", () => {
    const t = wordTimeline("Okay, tell me about scalability.", 0.1, 2.1);
    expect(t.map((w) => w.start)).toEqual([0, 6, 11, 14, 20]);
    expect(t[0]!.at).toBeCloseTo(0.1);
    for (let i = 1; i < t.length; i++) expect(t[i]!.at).toBeGreaterThan(t[i - 1]!.at);
    // "scalability" (5 syllables) takes longer than "me".
    const gap = (i: number) => (i + 1 < t.length ? t[i + 1]!.at : 2.1) - t[i]!.at;
    expect(gap(4)).toBeGreaterThan(gap(2) * 2);
    // The comma after "Okay" is a pause: "Okay," takes longer than "tell".
    expect(gap(0)).toBeGreaterThan(gap(1));
    expect(t[t.length - 1]!.at).toBeLessThan(2.1);
  });

  it("counts syllables roughly", () => {
    expect(syllableCount("scalability")).toBe(5);
    expect(syllableCount("make")).toBe(1);
    expect(syllableCount("बताइए")).toBeGreaterThanOrEqual(1);
  });
});
