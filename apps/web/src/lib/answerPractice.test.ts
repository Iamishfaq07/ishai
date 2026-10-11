import { describe, expect, it } from "vitest";
import { answerPracticeSession } from "./answerPractice";

describe("answer practice", () => {
  it("asks the saved question with one follow-up on the prepared answer", () => {
    const s = answerPracticeSession({ question: " Tell me about yourself. ", answer: "I'm a backend\n engineer." });
    expect(s.type).toBe("mock");
    expect(s.title).toBe("Answer practice — Tell me about yourself.");
    expect(s.mock?.drill).toEqual([{ question: "Tell me about yourself.", kind: "answer", follow_up: true,
                                     feedback: "Their prepared answer: I'm a backend engineer." }]);
  });

  it("keeps within the server's limits", () => {
    const s = answerPracticeSession({ question: "q".repeat(500), answer: "a".repeat(3000) });
    expect(s.mock?.drill?.[0]?.question).toHaveLength(400);
    expect(s.mock?.drill?.[0]?.feedback).toHaveLength(400);
    expect(s.title.length).toBeLessThanOrEqual(200);
  });
});
