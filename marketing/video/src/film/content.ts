// What the films' app frames show: the demo person's live session, word for word. All fictional (Aditi Rao, the
// employers in marketing/screens/seed.py); the facts are the ones on her resume.
import ids from "../../fixtures/ids.json";

export const IDS = ids as {
  resume: string;
  draft: string;
  document: string;
  mockReview: string;
  interviewReview: string;
  offer: string;
  tracker: Record<string, string>;
  liveInterview: string;
  liveMock: string;
};

export const QUESTION = "Tell me about a time you used data to change a product decision.";
export const ANSWER_TEXT =
  "At Juniper Logistics, most late deliveries came from the date we promised at checkout. I built a delivery-time " +
  "model from two years of orders, showed that a delivery window would be more honest than a single date, and made " +
  "the case to product. We tested it, it shipped, and late deliveries fell 18% in two quarters.";
export const ANSWER = {
  question: QUESTION,
  type: "behavioral",
  direct_answer: ANSWER_TEXT,
  talking_points: [],
  example: null,
  code: null,
  time_complexity: null,
  space_complexity: null,
  follow_up: "How did you choose what to measure?",
  context_used: ["resume: Juniper Logistics — Senior Data Analyst"],
  grounding: "verified",
  sources: [
    {
      ref: "F1", chunk_id: "demo-1", doc_kind: "resume", document: "Aditi Rao resume", label: "Juniper Logistics · Senior Data Analyst",
      excerpt: "Built the delivery-time model behind the checkout promise, cutting late deliveries by 18% in two quarters.", verified: true,
    },
  ],
  key_points: ["The checkout promise", "Built the delivery-time model", "Made the case to product", "18% fewer late deliveries"],
};
export const SAID =
  "Sure. At Juniper Logistics most of our late deliveries came from the date we promised at checkout, so I built a delivery-time model";

export const TURNS = [
  { turn_id: "t1", speaker: "interviewer", text: "Thanks for making time today. I had a look at your resume before the call." },
  { turn_id: "t2", speaker: "candidate", text: "Thank you, happy to be here." },
];
export const ASK = { turn_id: "t3", speaker: "interviewer", text: `Let's start with something concrete. ${QUESTION}` };

/** The live session from a question to its answer, at film seconds after `t0` (the frame's script). */
export function liveScript(t0: number, o: { say?: number; answer?: number; speak?: boolean } = {}) {
  const say = o.say ?? 2.6;
  const ans = o.answer ?? 3.6;
  const steps: Array<Record<string, unknown> & { at: number }> = [
    { at: 0.02, click: { text: "Share tab audio" } },
    { at: 0.03, hide: { sel: "summary", text: "Critique architecture" } },
    { at: 0.04, shiftClock: (12 * 60 + 31) * 1000 },
    ...TURNS.map((t, i) => ({ at: 0.05 + i * 0.01, live: "emit", data: { type: "transcript.final", data: { ...t, start_ms: i * 4000, end_ms: i * 4000 + 3000 } } })),
    { at: t0, live: "say", data: ASK, dur: say * 1000 },
    { at: t0 + say + 0.15, live: "emit", data: { type: "question.detected", data: { question_id: "q1", turn_id: "t3", text: QUESTION, type: "behavioral", confidence: 0.96, is_follow_up: false } } },
    { at: t0 + say + 0.35, live: "answer", data: { answer_id: "a1", question_id: "q1", answer: ANSWER }, dur: ans * 1000 },
  ];
  if (o.speak !== false) steps.push({ at: t0 + say + ans + 0.9, live: "speak", data: { turn_id: "t4", text: SAID }, dur: 3600 });
  return steps;
}
export const LIVE_HISTORY = { usr: { systemAudio: true }, key: "demo", idx: 0 };
