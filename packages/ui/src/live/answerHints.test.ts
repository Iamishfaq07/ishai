import { describe, expect, it } from "vitest";
import { answerHint } from "./answerHints";

describe("answer hints", () => {
  it("shapes classic questions by their wording", () => {
    expect(answerHint("Let's start. Tell me about yourself.", "resume").name).toBe("Present, past, future");
    expect(answerHint("What is your biggest weakness?", "behavioral").name).toBe("Real, working on it, progress");
    expect(answerHint("Why do you want to join our company?", "culture").name).toBe("Them, you, fit");
  });

  it("uses the server's reading of the question otherwise", () => {
    expect(answerHint("Describe a conflict with a teammate.", "behavioral").name).toBe("STAR");
    expect(answerHint("How would you design a rate limiter?", "system_design").steps[0]?.label).toBe("Requirements");
    expect(answerHint("Reverse a linked list.", "coding").name).toBe("Clarify, plan, code, check");
  });

  it("gives a follow-up its own short shape, and anything else a general one", () => {
    expect(answerHint("Why did you choose that, exactly?", "follow_up").name).toBe("Point, proof, stop");
    expect(answerHint("Anything else?", undefined).name).toBe("Answer, example, why it matters");
    expect(answerHint("Anything else?", "something_new").name).toBe("Answer, example, why it matters");
  });
});
