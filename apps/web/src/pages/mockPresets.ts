// One-tap mock interviews (Practice): each preset is the same session the Customise form would make, with the usual
// first rounds as fixed questions where that helps (the HR screen, "Tell me about yourself") and an offer for salary
// practice in the terms of the country the user applies in (India's ₹ LPA first). Plain data, unit-tested
// (mockPresets.test.ts).
import type { CreateSessionRequest, MockConfig } from "@orbit/types";
import { INDIA, isIndia, regionWords, sampleOffer } from "@orbit/ui";

export type PresetId = "hr5" | "tmay10" | "tech15" | "panel15" | "oneway10" | "salary";

export interface MockPreset {
  id: PresetId;
  /** "5-min HR round" (presetTitle words it for the country: a recruiter screen outside India, "(₹)" on India's salary talk). */
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
      `Tell me about yourself, why us, strengths, relocation: the ${isIndia(country) ? "campus HR round" : "first recruiter screen"}.`,
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

/** The card's title: the salary preset names the rupee in India, where it started; outside India the HR round is the
 *  recruiter screen. */
export function presetTitle(p: MockPreset, country: string = INDIA): string {
  if (p.id === "salary" && isIndia(country)) return "Salary talk (₹)";
  if (p.id === "hr5" && !isIndia(country)) return `5-min ${regionWords(country).screen}`;
  return p.title;
}

/** The HR screen's usual questions (in India, the campus round at TCS, Infosys, Wipro and most service companies). */
export const HR_QUESTIONS = [
  "Tell me about yourself.",
  "Why do you want to join our company?",
  "What are your strengths? And one weakness you're working on?",
  "Are you open to relocating, or to working in shifts if the role needs it?",
];

/**
 * The fixed questions in a Hindi or Hinglish mock (Practice → Language, offered in India with ORBIT_MULTILINGUAL): the
 * interviewer asks them as written, so they're written in the round's language (Hindi in Devanagari, Hinglish in Latin
 * script), technical words in English. "हमारी कंपनी" / "hamari company" names the company, as "our company" does.
 */
const IN_LANGUAGE: Record<string, { hr: string[]; tmay: string; project: string }> = {
  hi: {
    hr: [
      "अपने बारे में बताइए।",
      "आप हमारी कंपनी से क्यों जुड़ना चाहते हैं?",
      "आपकी strengths क्या हैं? और एक weakness, जिस पर आप काम कर रहे हैं?",
      "क्या आप relocate करने के लिए, या ज़रूरत हो तो shifts में काम करने के लिए तैयार हैं?",
    ],
    tmay: "अपने बारे में बताइए।",
    project: "अपने resume से किसी ऐसे project या internship के बारे में बताइए जिस पर आपको गर्व है।",
  },
  hinglish: {
    hr: [
      "Apne baare mein bataiye.",
      "Aap hamari company kyun join karna chahte hain?",
      "Aapki strengths kya hain? Aur ek weakness jis par aap kaam kar rahe hain?",
      "Kya aap relocate karne ke liye, ya zaroorat ho toh shifts mein kaam karne ke liye ready hain?",
    ],
    tmay: "Apne baare mein bataiye.",
    project: "Apne resume se kisi aise project ya internship ke baare mein bataiye jis par aapko proud feel hota hai.",
  },
};

/** The screen's questions for the country: India's as above; elsewhere shift work isn't a first-call question. In a
 *  practice language, India's in that language. */
export function hrQuestions(country: string = INDIA, language = "en"): string[] {
  const translated = IN_LANGUAGE[language];
  if (translated) return translated.hr;
  if (isIndia(country)) return HR_QUESTIONS;
  return HR_QUESTIONS.map((q) => (q.startsWith("Are you open to relocating") ? "Are you open to relocating if the role needs it?" : q));
}

function mockFor(id: PresetId, country: string, language: string): MockConfig {
  const translated = IN_LANGUAGE[language];
  switch (id) {
    case "hr5":
      return {
        interview_type: "behavioral",
        persona: "recruiter",
        difficulty: "easy",
        duration_minutes: 5,
        drill: hrQuestions(country, language).map((question) => ({ question, kind: "set" as const })),
      };
    case "tmay10": {
      const tmay = translated?.tmay ?? "Tell me about yourself.";
      return {
        interview_type: "behavioral",
        persona: "hiring_manager",
        difficulty: "easy",
        duration_minutes: 10,
        drill: [
          {
            question: tmay,
            kind: "set",
            follow_up: true,
            feedback: "Check it covers who they are now, one or two things they did with a result, and why this role. Push on anything vague.",
          },
          { question: translated?.project ?? "Walk me through one project or internship from your resume that you're proud of.", kind: "set", follow_up: true },
          { question: tmay, kind: "concise" },
        ],
      };
    }
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

/** The session a preset starts: `role` from the profile (or a link), the documents Practice uses for context, in the
 *  practice language picked (English by default). */
export function presetSession(id: PresetId, role: string, documentIds: string[], country: string = INDIA, language = "en"): CreateSessionRequest {
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
            : `Mock — ${presetTitle(preset, country)}`,
    type: "mock",
    ...(r ? { role: r } : {}),
    language,
    length: "standard",
    style: "natural",
    auto_answer: false,
    document_ids: documentIds,
    mock: mockFor(id, country, language),
  };
}

export function isPresetId(value: string | null): value is PresetId {
  return PRESETS.some((p) => p.id === value);
}
