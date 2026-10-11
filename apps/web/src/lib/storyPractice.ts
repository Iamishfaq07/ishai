import type { CreateSessionRequest, StoryCompetency, StoryInput } from "@orbit/types";

/**
 * The story bank's "Practise telling it": a short mock round asking the questions a story answers (one per
 * competency it's tagged with, the first two), each followed by a follow-up that tests it the way an interviewer
 * tests a STAR story: your own part, the decision, the result (mock_interviewer.py, drill kind "story").
 */
export const STORY_QUESTION: Record<StoryCompetency, string> = {
  leadership: "Tell me about a time you led a team or a project.",
  teamwork: "Tell me about a time you helped a team work better together.",
  conflict: "Tell me about a time you disagreed with a colleague. What did you do?",
  failure: "Tell me about a time something you worked on went wrong.",
  ownership: "Tell me about a time you took ownership of something nobody else would.",
  impact: "What's the achievement you're proudest of?",
  ambiguity: "Tell me about a time you had to work something out with little direction.",
  customer: "Tell me about a time you went the extra mile for a user or customer.",
  influence: "Tell me about a time you changed someone's mind.",
  learning: "Tell me about a time you had to learn something new quickly.",
  technical: "Tell me about the hardest technical problem you've solved.",
  deadline: "Tell me about a time you met a tight deadline.",
};

const DEFAULT_QUESTION = "Tell me about a project you're proud of.";
const MAX_QUESTIONS = 2;

/** What the follow-up may push on (never read out), within the server's 400 characters. */
function probe(story: StoryInput): string {
  const result = story.result.trim().replace(/\s+/g, " ");
  return `Their story: "${story.title.trim()}".${result ? ` The result they claim: ${result}` : ""}`.slice(0, 400);
}

export function storyQuestions(story: StoryInput): string[] {
  const asked = [...new Set(story.competencies.map((c) => STORY_QUESTION[c]).filter(Boolean))].slice(0, MAX_QUESTIONS);
  return asked.length ? asked : [DEFAULT_QUESTION];
}

export function storyPracticeSession(story: StoryInput): CreateSessionRequest {
  const feedback = probe(story);
  const questions = storyQuestions(story);
  return {
    title: `Story practice — ${story.title.trim()}`.slice(0, 200),
    type: "mock",
    language: "en",
    length: "standard",
    style: "natural",
    auto_answer: false,
    document_ids: [],
    mock: {
      duration_minutes: 5 * questions.length,
      drill: questions.map((question) => ({ question, kind: "story" as const, follow_up: true, feedback })),
    },
  };
}
