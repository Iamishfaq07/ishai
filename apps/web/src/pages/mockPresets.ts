// One-tap mock interviews (Practice): each preset is the same session the Customise form would make, with India's
// usual first rounds as fixed questions where that helps (the campus HR round, "Tell me about yourself") and a ₹ offer
// for salary practice. Plain data, unit-tested (mockPresets.test.ts).
import type { CreateSessionRequest, MockConfig } from "@orbit/types";

export type PresetId = "hr5" | "tmay10" | "tech15" | "panel15" | "oneway10" | "salary";

export interface MockPreset {
  id: PresetId;
  /** "5-min HR round". */
  title: string;
  /** One line on the card. `{role}` is the role when it's known. */
  blurb: (role: string) => string;
  minutes: number;
}

/** A sample offer for salary practice, in the way Indian offers are written. */
export const SAMPLE_OFFER = "₹12 LPA fixed + ₹2 L variable";
export const SAMPLE_TARGET = "₹15 LPA fixed";

export const PRESETS: MockPreset[] = [
  { id: "hr5", title: "5-min HR round", minutes: 5, blurb: () => "Tell me about yourself, why us, strengths, relocation: the campus HR round." },
  { id: "tmay10", title: "Tell me about yourself", minutes: 10, blurb: () => "The full answer, a project from your resume, then the 30-second version." },
  {
    id: "tech15",
    title: "15-min technical",
    minutes: 15,
    blurb: (role) => (role ? `For ${role}: questions from your resume and the job post.` : "Questions from your resume and the job post you pick."),
  },
  {
    id: "panel15",
    title: "Panel round",
    minutes: 15,
    blurb: () => "Three interviewers take turns: the hiring manager, a senior engineer and HR.",
  },
  {
    id: "oneway10",
    title: "Video interview",
    minutes: 10,
    blurb: () => "One-way, HireVue-style: 30 s to think, 90 s to answer each prompt, on camera.",
  },
  { id: "salary", title: "Salary talk (₹)", minutes: 10, blurb: () => `A recruiter offers ${SAMPLE_OFFER}. Practise asking for more.` },
];

/** The campus HR round's usual questions (TCS, Infosys, Wipro and most service companies ask these first). */
export const HR_QUESTIONS = [
  "Tell me about yourself.",
  "Why do you want to join our company?",
  "What are your strengths? And one weakness you're working on?",
  "Are you open to relocating, or to working in shifts if the role needs it?",
];

function mockFor(id: PresetId): MockConfig {
  switch (id) {
    case "hr5":
      return {
        interview_type: "behavioral",
        persona: "recruiter",
        difficulty: "easy",
        duration_minutes: 5,
        drill: HR_QUESTIONS.map((question) => ({ question, kind: "prep" as const })),
      };
    case "tmay10":
      return {
        interview_type: "behavioral",
        persona: "hiring_manager",
        difficulty: "easy",
        duration_minutes: 10,
        drill: [
          {
            question: "Tell me about yourself.",
            kind: "prep",
            follow_up: true,
            feedback: "Check it covers who they are now, one or two things they did with a result, and why this role. Push on anything vague.",
          },
          { question: "Walk me through one project or internship from your resume that you're proud of.", kind: "prep", follow_up: true },
          { question: "Tell me about yourself.", kind: "concise" },
        ],
      };
    case "tech15":
      return { interview_type: "technical", persona: "engineer", difficulty: "medium", duration_minutes: 15 };
    case "panel15":
      return {
        interview_type: "mixed",
        persona: "hiring_manager",
        difficulty: "medium",
        duration_minutes: 15,
        panel: ["hiring_manager", "engineer", "recruiter"],
      };
    case "oneway10":
      return {
        interview_type: "behavioral",
        persona: "recruiter",
        difficulty: "medium",
        duration_minutes: 10,
        one_way: { think_seconds: 30, answer_seconds: 90 },
      };
    case "salary":
      return {
        interview_type: "negotiation",
        persona: "recruiter",
        difficulty: "medium",
        duration_minutes: 10,
        negotiation: { offer: SAMPLE_OFFER, target: SAMPLE_TARGET },
      };
  }
}

/** The session a preset starts: `role` from the profile (or a link), the documents Practice uses for context. */
export function presetSession(id: PresetId, role: string, documentIds: string[]): CreateSessionRequest {
  const preset = PRESETS.find((p) => p.id === id)!;
  const r = role.trim();
  return {
    title:
      id === "salary"
        ? "Negotiation — sample offer"
        : id === "tech15" && r
          ? `Mock — ${r} (technical)`
          : id === "panel15" && r
            ? `Panel — ${r}`
            : `Mock — ${preset.title}`,
    type: "mock",
    ...(r ? { role: r } : {}),
    language: "en",
    length: "standard",
    style: "natural",
    auto_answer: false,
    document_ids: documentIds,
    mock: mockFor(id),
  };
}

export function isPresetId(value: string | null): value is PresetId {
  return PRESETS.some((p) => p.id === value);
}
