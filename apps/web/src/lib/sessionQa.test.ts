import { describe, expect, it } from "vitest";
import type { SessionAnswer } from "@orbit/types";
import { looseAnswers } from "./sessionQa";

const answer = (id: string, question_id: string | null) => ({ id, question_id }) as SessionAnswer;

describe("looseAnswers", () => {
  it("keeps the answers no listed question carries", () => {
    const answers = [answer("a1", "q1"), answer("a2", null), answer("a3", "gone")];
    expect(looseAnswers([{ id: "q1" }], answers).map((a) => a.id)).toEqual(["a2", "a3"]);
  });

  it("is every answer once the transcript (and its questions) is deleted", () => {
    const answers = [answer("a1", "q1"), answer("a2", "q2")];
    expect(looseAnswers([], answers)).toHaveLength(2);
    expect(looseAnswers([{ id: "q1" }, { id: "q2" }], answers)).toEqual([]);
  });
});
