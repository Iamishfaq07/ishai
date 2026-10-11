/**
 * The mock interview's "Stuck? Show a structure": a way to shape the answer for this kind of question, never the
 * answer itself (practice means saying it yourself). The kind is the server's reading of the question
 * (`question_type`); a few classic questions get their own shape from the wording.
 */
export interface AnswerHint {
  name: string;
  steps: Array<{ label: string; detail: string }>;
}

const H = (name: string, steps: Array<[string, string]>): AnswerHint => ({
  name,
  steps: steps.map(([label, detail]) => ({ label, detail })),
});

const INTRO = H("Present, past, future", [
  ["Present", "Your role now and one result you're proud of"],
  ["Past", "One or two steps that got you here"],
  ["Future", "Why this role is the natural next step"],
]);
const WHY = H("Them, you, fit", [
  ["Them", "One specific thing about the company or role that draws you"],
  ["You", "What you bring that matches it, with an example"],
  ["Fit", "Why now: what you'll learn and give"],
]);
const WEAKNESS = H("Real, working on it, progress", [
  ["Real", "A genuine weakness that won't sink the role"],
  ["Working on it", "What you do about it, concretely"],
  ["Progress", "What changed because of it"],
]);
const STAR = H("STAR", [
  ["Situation", "One or two lines of context"],
  ["Task", "What you had to achieve"],
  ["Action", "What you did (say \"I\"), the bulk of the answer"],
  ["Result", "The outcome, with a number if you have one"],
]);
const BY_TYPE: Record<string, AnswerHint> = {
  behavioral: STAR,
  leadership: STAR,
  resume: H("What, your part, result", [
    ["What", "The project or role in one line"],
    ["Your part", "What you owned and the decisions you made"],
    ["Result", "The impact, and what you'd do differently"],
  ]),
  technical: H("Define, how, trade-off", [
    ["Define", "What it is, in one sentence"],
    ["How", "How it works, step by step"],
    ["Trade-off", "When you'd use it and when you wouldn't"],
    ["Example", "Where you've used it"],
  ]),
  coding: H("Clarify, plan, code, check", [
    ["Clarify", "Inputs, outputs, edge cases"],
    ["Plan", "A simple approach first, then a better one"],
    ["Code", "Talk through it as you go"],
    ["Check", "Complexity, and a test or two"],
  ]),
  system_design: H("Requirements to trade-offs", [
    ["Requirements", "What it must do, and for how many users"],
    ["Scale", "Rough numbers: requests, data, growth"],
    ["Design", "The main parts and how data flows"],
    ["Deep dive", "The hardest part, in detail"],
    ["Trade-offs", "What you chose and what it costs"],
  ]),
  salary: H("Research, anchor, value", [
    ["Research", "The market range for this role and city"],
    ["Anchor", "A specific number near the top of that range"],
    ["Value", "Why you're worth it, briefly"],
    ["Package", "Stay open on bonus, equity and benefits"],
  ]),
  culture: WHY,
  follow_up: H("Point, proof, stop", [
    ["Point", "Answer exactly what was asked"],
    ["Proof", "One specific: a number, a name, a decision"],
    ["Stop", "Then pause; let them ask more"],
  ]),
};
const DEFAULT = H("Answer, example, why it matters", [
  ["Answer", "Your answer in one sentence first"],
  ["Example", "One real example"],
  ["Why it matters", "What it shows about how you work"],
]);

export function answerHint(question: string, questionType?: string | null): AnswerHint {
  const q = question.toLowerCase();
  if (questionType !== "follow_up") {
    if (/tell me about yourself|walk me through your (background|resume|cv)|introduce yourself/.test(q)) return INTRO;
    if (/weakness|area (of|for) improvement/.test(q)) return WEAKNESS;
    if (/why (do you want|are you interested|this (company|role|job)|us\b|join)/.test(q)) return WHY;
  }
  return (questionType && BY_TYPE[questionType]) || DEFAULT;
}
