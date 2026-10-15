// One-tap mock interviews (Practice): each preset is the same session the Customise form would make, with the usual
// first rounds as fixed questions where that helps (the HR screen, "Tell me about yourself") and an offer for salary
// practice in the terms of the country the user applies in (India's ₹ LPA first). Plain data, unit-tested
// (mockPresets.test.ts).
import type { CreateSessionRequest, MockConfig } from "@orbit/types";
import { INDIA, isIndia, sampleOffer } from "@orbit/ui";

export type PresetId = "hr5" | "tmay10" | "tech15" | "panel15" | "oneway10" | "salary";

export interface MockPreset {
  id: PresetId;
  /** "5-min HR round" (the salary preset's is presetTitle's: "(₹)" in India). */
  title: string;
  /** One line on the card, with the role when it's known, for the country the user applies in. */
  blurb: (role: string, country?: string) => string;
  minutes: number;
}

export const PRESETS: MockPreset[] = [
  {
    id: "hr5",
    title: "5-min HR round",
    minutes: 5,
    blurb: (_role, country = INDIA) =>
      `Tell me about yourself, why us, strengths, relocation: the ${isIndia(country) ? "campus HR round" : "first HR screen"}.`,
  },
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
    blurb: () => "The hiring manager, a senior engineer and HR. Whoever is best placed to dig into a gap in your answer asks next.",
  },
  {
    id: "oneway10",
    title: "Video interview",
    minutes: 10,
    blurb: () => "One-way, HireVue-style: 30 s to think, 90 s to answer each prompt, on camera.",
  },
  {
    id: "salary",
    title: "Salary talk",
    minutes: 10,
    blurb: (_role, country = INDIA) => `A recruiter offers ${sampleOffer(country).offer}. Practise asking for more.`,
  },
];

/** The card's title: the salary preset names the rupee in India, where it started. */
export function presetTitle(p: MockPreset, country: string = INDIA): string {
  return p.id === "salary" && isIndia(country) ? "Salary talk (₹)" : p.title;
}

/** The HR screen's usual questions (in India, the campus round at TCS, Infosys, Wipro and most service companies). */
export const HR_QUESTIONS = [
  "Tell me about yourself.",
  "Why do you want to join our company?",
  "What are your strengths? And one weakness you're working on?",
  "Are you open to relocating, or to working in shifts if the role needs it?",
];

function mockFor(id: PresetId, country: string): MockConfig {
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
        negotiation: { offer: sampleOffer(country).offer, target: sampleOffer(country).target },
      };
  }
}

/** The role a mock should use: the link (`?role=`), then the saved job-search title, then the welcome questions. */
export function roleForPractice(
  link: string | null | undefined,
  profileTitle: string | null | undefined,
  welcomeRole: string | null | undefined,
): string {
  for (const value of [link, profileTitle, welcomeRole]) {
    const role = value?.trim().slice(0, 120) ?? "";
    if (role) return role;
  }
  return "";
}

/** The session a preset starts: `role` from the profile (or a link), the documents Practice uses for context. */
export function presetSession(id: PresetId, role: string, documentIds: string[], country: string = INDIA): CreateSessionRequest {
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
    mock: mockFor(id, country),
  };
}

export function isPresetId(value: string | null): value is PresetId {
  return PRESETS.some((p) => p.id === value);
}
