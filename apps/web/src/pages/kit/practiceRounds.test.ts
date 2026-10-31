import { describe, expect, it } from "vitest";
import { BRIEFS, checkWritten, timeLeft } from "./written";
import { QUESTIONS, checkSteps, pickQuestion } from "./guesstimate";

const leave = BRIEFS.find((b) => b.id === "leave")!;
const GOOD = `Dear Ms Rao,

I would like to request leave from 12 to 15 March for my sister's wedding in Jaipur. I will be travelling with my family and will not be able to work remotely during these days.

Before I leave, I will finish the login module tests and hand over the open tickets to Arun, who has agreed to cover for me. I will also share a short note with the status of each task so nothing is missed while I am away.

Please let me know if these dates work for the team, or if you would like me to change anything in the plan.

Regards,
Kiran`;

describe("written round checks", () => {
  it("passes a well-formed email", () => {
    const checks = checkWritten(leave, "Leave request: 12 to 15 March", GOOD);
    expect(checks.filter((c) => !c.ok).map((c) => c.label)).toEqual([]);
  });
  it("flags a missing subject, greeting and sign-off, chat spellings and a small i", () => {
    const failed = checkWritten(leave, "", "hey i need leave pls for my sisters wedding next month thx").filter((c) => !c.ok).map((c) => c.label);
    expect(failed).toEqual(expect.arrayContaining(["Subject line", "Length", "Greeting", "Sign-off", "No text-speak", "Capital I"]));
  });
  it("counts the clock down and stops at zero", () => {
    expect(timeLeft(0, 10, 60_000)).toBe(540);
    expect(timeLeft(0, 1, 120_000)).toBe(0);
  });
});

describe("guesstimate steps", () => {
  it("knows a complete, well-shaped answer from an empty one", () => {
    const full = checkSteps({
      clarify: "Only stalls and cafes, a normal weekday, not homes or offices.",
      approach: "Adults who drink tea outside × cups each per day",
      assumptions: "Adults: 1 crore\n30% drink tea outside\n1.5 cups each",
      calculation: "1 crore × 0.3 = 30 lakh\n30 lakh × 1.5 = 45 lakh",
      answer: "About 45 lakh cups a day",
      sanity: "About 20,000 stalls selling 200 cups each is 40 lakh, close enough.",
    });
    expect(full.every((c) => c.ok)).toBe(true);
    expect(checkSteps({}).some((c) => c.ok)).toBe(false);
  });
  it("never asks the same question twice in a row", () => {
    for (const q of QUESTIONS) expect(pickQuestion(q.id).id).not.toBe(q.id);
  });
});
