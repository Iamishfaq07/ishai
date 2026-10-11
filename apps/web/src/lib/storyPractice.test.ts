import { describe, expect, it } from "vitest";
import type { StoryInput } from "@orbit/types";
import { STORY_QUESTION, storyPracticeSession, storyQuestions } from "./storyPractice";

const story = (over: Partial<StoryInput> = {}): StoryInput => ({
  title: "Payments cutover",
  situation: "s",
  task: "t",
  action: "a",
  result: "Shipped  two days early,\nzero downtime.",
  competencies: ["deadline", "ownership", "leadership"],
  ...over,
});

describe("story practice", () => {
  it("asks the questions the story answers, the first two of its competencies", () => {
    expect(storyQuestions(story())).toEqual([STORY_QUESTION.deadline, STORY_QUESTION.ownership]);
    expect(storyQuestions(story({ competencies: [] }))).toEqual(["Tell me about a project you're proud of."]);
  });

  it("starts a short mock round where each question is followed up with what the story claims", () => {
    const req = storyPracticeSession(story());
    expect(req.type).toBe("mock");
    expect(req.title).toBe("Story practice — Payments cutover");
    expect(req.mock?.duration_minutes).toBe(10);
    expect(req.mock?.drill).toEqual([
      expect.objectContaining({ question: STORY_QUESTION.deadline, kind: "story", follow_up: true }),
      expect.objectContaining({ question: STORY_QUESTION.ownership, kind: "story", follow_up: true }),
    ]);
    expect(req.mock?.drill?.[0]?.feedback).toBe('Their story: "Payments cutover". The result they claim: Shipped two days early, zero downtime.');
  });

  it("keeps what the follow-up may probe within the server's limit", () => {
    const req = storyPracticeSession(story({ result: "x".repeat(900), competencies: ["impact"] }));
    expect(req.mock?.drill?.[0]?.feedback?.length).toBe(400);
    expect(req.mock?.duration_minutes).toBe(5);
  });
});
