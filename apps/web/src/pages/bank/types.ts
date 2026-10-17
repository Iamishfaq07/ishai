// The question bank's files as the web app reads them (the format and its checks: the API's
// orbit_api/question_bank/schema.py). Loaded through the virtual modules in apps/web/questionBank.ts.

export type QuestionType = "behavioral" | "role" | "fit";
/** What kind of answer a question wants; the free warm-up checks an answer by it (lib/warmup/checks.ts). */
export type AnswerKind = "intro" | "story" | "motivation" | "knowledge" | "situational" | "reflection" | "case" | "closing";
export type CompanyGroup = "it-services" | "india-product" | "global-tech" | "consulting" | "finance" | "industry";
export type RoleGroup = "engineering" | "data" | "product-design" | "business" | "core-engineering" | "early-career" | "public-service";
export type Market = "india" | "india-first" | "global";

export interface BankQuestion {
  text: string;
  type: QuestionType;
  kind: AnswerKind;
  /** What a good answer covers. */
  covers: string[];
}

export interface BankSource {
  title: string;
  url: string;
}

interface Entry {
  slug: string;
  name: string;
  aliases: string[];
  summary: string;
  rounds: string[];
  looks_for: string[];
  questions: BankQuestion[];
  tips: string[];
  sources?: BankSource[];
  /** ISO date a person last checked it. */
  reviewed: string;
}

export interface BankCompany extends Entry {
  group: CompanyGroup;
  market: Market;
  /** What candidates outside India report instead (India's campus rounds); a field left out is the same. */
  abroad?: { rounds: string[]; looks_for?: string[]; questions?: BankQuestion[]; tips?: string[] };
}

export interface BankRole extends Entry {
  group: RoleGroup;
  mock: { interview_type: "behavioral" | "technical" | "system_design" | "mixed"; persona: string };
}

/** A list card: enough to show, search and link to a guide without loading it. */
export interface BankCard {
  slug: string;
  name: string;
  aliases: string[];
  group: string;
  market?: Market;
  summary: string;
  /** How many practice questions it has. */
  questions: number;
}
