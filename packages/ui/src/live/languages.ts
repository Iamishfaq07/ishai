import { safeLocal } from "../storage";

/**
 * Live-session languages (the API's live_language.py): what the interviewer speaks, and what answers are written in.
 * The app's own labels stay English; only the session's speech and answers change language.
 */
export interface LiveLanguageOption {
  value: string;
  label: string;
}

/** Every language the copilot knows, in picker order. The server says which it offers (`User.live_languages`). */
export const LIVE_LANGUAGES: LiveLanguageOption[] = [
  { value: "en", label: "English" },
  { value: "auto", label: "Auto-detect" },
  { value: "hi", label: "हिन्दी (Hindi)" },
  { value: "hinglish", label: "Hinglish (Hindi + English)" },
  { value: "es", label: "Español (Spanish)" },
  { value: "fr", label: "Français (French)" },
  { value: "de", label: "Deutsch (German)" },
  { value: "pt", label: "Português (Portuguese)" },
  { value: "it", label: "Italiano (Italian)" },
  { value: "nl", label: "Nederlands (Dutch)" },
  { value: "ja", label: "日本語 (Japanese)" },
  { value: "ru", label: "Русский (Russian)" },
];

const NAMES: Record<string, string> = {
  en: "English", auto: "Auto-detect", hi: "Hindi", hinglish: "Hinglish", es: "Spanish", fr: "French", de: "German",
  pt: "Portuguese", it: "Italian", nl: "Dutch", ja: "Japanese", ru: "Russian",
};

/** "Spanish" for "es"; the code itself for one this app doesn't know. */
export function languageName(code: string | null | undefined): string {
  return NAMES[code ?? "en"] ?? code ?? "English";
}

/** The interview languages to offer: those the server lists (servers from before languages: English only). */
export function interviewLanguages(offered: string[] | null | undefined): LiveLanguageOption[] {
  const codes = offered?.length ? offered : ["en"];
  return LIVE_LANGUAGES.filter((l) => codes.includes(l.value));
}

/** Whether there's a language choice to show at all. */
export function offersLanguages(offered: string[] | null | undefined): boolean {
  return interviewLanguages(offered).length > 1;
}

/** Hints under the pickers. */
export const INTERVIEW_LANGUAGE_HINT =
  "What the interviewer speaks. Auto-detect follows them across languages, even mid-interview.";
export const ANSWER_LANGUAGE_HINT = "Answers, key points and your review are written in this language.";

/**
 * The answer language choices for an interview language: "Same as the interview" (value "") first, then every
 * offered language but the interview's own (and not Auto-detect, which isn't a language to write in).
 */
export function answerLanguages(interview: string, offered: string[] | null | undefined): LiveLanguageOption[] {
  const same = interview === "auto" ? "Same as each question" : `Same as the interview (${languageName(interview)})`;
  return [
    { value: "", label: same },
    ...interviewLanguages(offered).filter((l) => l.value !== "auto" && l.value !== interview),
  ];
}

const INTERVIEW_KEY = "orbit.liveLanguage";
const ANSWER_KEY = "orbit.answerLanguage";

/** A per-device preference, like the coding language: the last interview language picked (English by default). */
export function loadInterviewLanguage(offered: string[] | null | undefined): string {
  try {
    const raw = safeLocal.getItem(INTERVIEW_KEY) ?? "en";
    return interviewLanguages(offered).some((l) => l.value === raw) ? raw : "en";
  } catch {
    return "en";
  }
}

/** The last answer language picked for this interview language ("" = the same as the interview). */
export function loadAnswerLanguage(interview: string, offered: string[] | null | undefined): string {
  try {
    const raw = safeLocal.getItem(ANSWER_KEY) ?? "";
    return answerLanguages(interview, offered).some((l) => l.value === raw) ? raw : "";
  } catch {
    return "";
  }
}

export function saveLiveLanguages(interview: string, answer: string): void {
  try {
    safeLocal.setItem(INTERVIEW_KEY, interview);
    safeLocal.setItem(ANSWER_KEY, answer);
  } catch {
    // storage unavailable — the choice still applies to this session
  }
}

/** What a session shows next to its title when it isn't English ("Spanish", "Hindi → English"); null for English. */
export function sessionLanguageLabel(language: string | null | undefined, answer?: string | null): string | null {
  const heard = language || "en";
  if (heard === "en" && !answer) return null;
  return answer && answer !== heard ? `${languageName(heard)} → ${languageName(answer)}` : languageName(heard);
}

/**
 * The language tag for text in a script IBM Plex Sans doesn't carry (Devanagari, Japanese, Cyrillic), so the browser
 * picks a proper face for it (Japanese kanji drawn from a Chinese font look wrong) and screen readers read it right.
 * Undefined for Latin text: English, Spanish and the rest need nothing, and an English page is unchanged.
 */
export function scriptLang(text: string | null | undefined): "hi" | "ja" | "ru" | undefined {
  if (!text) return undefined;
  if (/[\u3040-\u30ff]/.test(text) || /[\u4e00-\u9fff]/.test(text)) return "ja";
  if (/[\u0900-\u097f]/.test(text)) return "hi";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  return undefined;
}

/** Scripts that need taller lines (Devanagari's marks above and below the line, Japanese's square characters). */
export function tallScript(lang: string | undefined): boolean {
  return lang === "hi" || lang === "ja";
}

/**
 * The speech language that reads an answer aloud: the session's answer language ("hinglish" as Indian English, which
 * is how its Latin-script Hindi reads best); on Auto-detect, the answer's own script, else English.
 */
export function readAloudLanguage(answerLanguage: string | null | undefined, text?: string | null): string {
  if (!answerLanguage || answerLanguage === "en") return "en";
  if (answerLanguage === "hinglish") return "en-IN";
  if (answerLanguage === "auto") return scriptLang(text) ?? "en";
  return answerLanguage;
}

/** What a report says about its language ("Written in Spanish"); for Auto-detect, the interview's own. */
export function reportLanguageNote(language: string): string {
  return language === "auto" ? "Written in the interview's language" : `Written in ${languageName(language)}`;
}
