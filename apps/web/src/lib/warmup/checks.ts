// The Interview Warm-up's feedback (pages/Warmup.tsx): rule-based checks on an answer's words, no AI and nothing sent
// anywhere. Each check is a few cue lists and a verdict: how long it would take to say, whether it has the shape the
// question wants (STAR for a story; now, before, next for an introduction; steps for "what would you do"), numbers,
// filler words and hedges, and "I" against "we". They're rough on purpose, and say what they looked for.
import { INDIA, currencySymbol, isIndia } from "@orbit/ui";
import type { QuestionKind, WarmupQuestion } from "./bank";

export type CheckId = "length" | "structure" | "specifics" | "clarity" | "ownership";
export type Verdict = "good" | "ok" | "improve";

export interface Check {
  id: CheckId;
  label: string;
  verdict: Verdict;
  detail: string;
}

/** Below this, there's nothing to check yet. */
export const MIN_WORDS = 8;
/** An easy interview pace, words a minute. */
export const WPM = 130;

/** Good spoken lengths in words, by kind (about 25 s to 2 min at WPM). */
export const LENGTH: Record<QuestionKind, [number, number]> = {
  intro: [90, 190],
  story: [120, 280],
  motivation: [50, 160],
  knowledge: [50, 180],
  situational: [70, 220],
  reflection: [60, 180],
  case: [100, 300],
  closing: [25, 120],
};

const STRUCTURE_LABEL: Partial<Record<QuestionKind, string>> = {
  intro: "Shape",
  story: "STAR",
  situational: "Steps",
  case: "Approach",
  reflection: "Honesty",
  motivation: "Reasons",
  knowledge: "Example",
};

export function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9₹][a-z0-9₹'’%.,-]*/g)?.map((w) => w.replace(/[.,]+$/, "").replace(/’/g, "'")) ?? [];
}

/** "about 45 seconds", "about 1 min 20 s". */
export function spokenTime(wordCount: number): string {
  const s = Math.max(5, Math.round(((wordCount / WPM) * 60) / 5) * 5);
  if (s < 60) return `about ${s} seconds`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `about ${m} min ${rest} s` : `about ${m} min`;
}

function count(text: string, re: RegExp): number {
  return text.match(new RegExp(re.source, "g"))?.length ?? 0;
}

// ---- length ---------------------------------------------------------------------------------------------------------

export function checkLength(n: number, [min, max]: [number, number]): Check {
  const said = `${spokenTime(n)} spoken (${n} words)`;
  const aim = `Aim for ${spokenTime(min).replace("about ", "")} to ${spokenTime(max).replace("about ", "")}.`;
  if (n < min * 0.6) return { id: "length", label: "Length", verdict: "improve", detail: `Short: ${said}. ${aim} Add what you did and how it turned out.` };
  if (n < min) return { id: "length", label: "Length", verdict: "ok", detail: `A little short: ${said}. ${aim}` };
  if (n > max * 1.3) return { id: "length", label: "Length", verdict: "improve", detail: `Long: ${said}. ${aim} Interviewers drift after two minutes: keep the best part.` };
  if (n > max) return { id: "length", label: "Length", verdict: "ok", detail: `A little long: ${said}. ${aim}` };
  return { id: "length", label: "Length", verdict: "good", detail: `A good length: ${said}.` };
}

// ---- fillers and hedges ---------------------------------------------------------------------------------------------

const FILLERS: Array<[string, RegExp]> = [
  ["um", /\b(?:u+m+|u+h+m*|e+r+m+|hm+)\b/],
  ["basically", /\bbasically\b/],
  ["actually", /\bactually\b/],
  ["literally", /\bliterally\b/],
  ["you know", /\byou know\b(?! (?:how|what|why|where|when|that|the))/],
  ["I mean", /\bi mean\b/],
  ["like", /(?:,\s*like\b|\blike,)/],
  ["so yeah", /\bso,? yeah\b/],
  ["and all", /\band all(?: that)?\b(?! (?:the|of|my|our|these|those))/],
  ["matlab", /\bmatlab\b/],
  ["yaar", /\byaar\b/],
];
const HEDGES: Array<[string, RegExp]> = [
  ["I think", /\bi think\b/],
  ["I guess", /\bi guess\b/],
  ["maybe", /\bmaybe\b/],
  ["probably", /\bprobably\b/],
  ["kind of", /\b(?:kind|sort) of\b/],
  ["I feel like", /\bi feel like\b/],
  ["I'm not sure", /\bi'?m not (?:sure|confident)\b|\bi am not (?:sure|confident)\b/],
];

/** Each filler or hedge found, with how often. */
export function fillers(text: string): Array<[string, number]> {
  const low = text.toLowerCase().replace(/’/g, "'");
  return [...FILLERS, ...HEDGES].map(([label, re]) => [label, count(low, re)] as [string, number]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
}

export function checkClarity(text: string, n: number, spoken: boolean): Check {
  const found = fillers(text);
  const total = found.reduce((s, [, k]) => s + k, 0);
  const per100 = (total / Math.max(n, 1)) * 100;
  const list = found.slice(0, 3).map(([w, k]) => (k > 1 ? `“${w}” ×${k}` : `“${w}”`)).join(", ");
  const voice = spoken ? " Speech-to-text often leaves out “um” and “uh”, so there may be more." : "";
  if (!total) return { id: "clarity", label: "Fillers", verdict: "good", detail: `No filler words or hedges.${voice}` };
  if (per100 <= 2) return { id: "clarity", label: "Fillers", verdict: "good", detail: `Hardly any: ${list}.${voice}` };
  if (per100 <= 5) return { id: "clarity", label: "Fillers", verdict: "ok", detail: `A few: ${list}. A short pause sounds surer than a filler.${voice}` };
  return { id: "clarity", label: "Fillers", verdict: "improve", detail: `Lots: ${list}. Pause instead, and say “I did” rather than “I think I did”.${voice}` };
}

// ---- specifics -----------------------------------------------------------------------------------------------------

// ₹ amounts, figures with their unit (not a year like 2024), and the number words people say.
const NUMBER =
  /₹\s?\d[\d,.]*(?:\s*(?:lakhs?|lpa|crores?|cr|k|l)\b)?|\b(?!(?:19|20)\d\d\b)\d[\d,.]*(?:\s*(?:%|percent\b|lakhs?\b|lpa\b|crores?\b|cr\b|k\b|x\b))?|\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundreds?|thousands?|lakhs?|crores?|double|doubled|twice|half|tripled)\b/g;

/** The numbers an answer uses ("40%", "₹2 lakh", "three", not a year like "2024"). */
export function numbersIn(text: string): string[] {
  return (text.toLowerCase().match(NUMBER) ?? []).map((x) => x.trim()).filter(Boolean);
}

/** `country`: the examples of what to count use its money and, outside India, grades rather than marks and rank. */
export function checkSpecifics(text: string, country: string = INDIA): Check {
  const found = numbersIn(text);
  const shown = [...new Set(found)].slice(0, 3).join(", ");
  const india = isIndia(country);
  if (found.length >= 2) return { id: "specifics", label: "Numbers", verdict: "good", detail: `Specific: ${shown}. Numbers make it believable.` };
  if (found.length === 1)
    return { id: "specifics", label: "Numbers", verdict: "ok", detail: `One number (${shown}). Another would help: how many people, how much time saved, ${india ? "marks or rank" : "or a grade"}.` };
  return {
    id: "specifics",
    label: "Numbers",
    verdict: "improve",
    detail: `No numbers yet. Add one: how many users or people, hours or ${currencySymbol(country)} saved, ${india ? "marks, rank" : "grades"}, or a % change.`,
  };
}

// ---- I and we ------------------------------------------------------------------------------------------------------

export function checkOwnership(text: string): Check {
  const low = ` ${text.toLowerCase().replace(/’/g, "'")} `;
  const i = count(low, /\b(?:i|i'm|i've|i'd|i'll|me|my|mine|myself)\b/);
  const we = count(low, /\b(?:we|we're|we've|we'd|we'll|our|ours|us)\b/);
  if (we > i && we >= 3) return { id: "ownership", label: "Your part", verdict: "improve", detail: `Mostly “we” (${we}×) and little “I” (${i}×). Say what you did yourself.` };
  if (!i && !we) return { id: "ownership", label: "Your part", verdict: "ok", detail: "Say who did it: “I” for your own part." };
  return { id: "ownership", label: "Your part", verdict: "good", detail: we ? `Clear what you did (“I” ${i}×, “we” ${we}×).` : "Clear what you did." };
}

// ---- shape, by kind ------------------------------------------------------------------------------------------------

const STAR: Array<[string, RegExp]> = [
  ["situation", /\b(?:when (?:i|we) (?:was|were)|during (?:my|our|the|a|an)\b|at my (?:college|internship|job|company|previous)|in my (?:first|second|third|final|last) year|in (?:college|school|class)|last (?:year|semester|summer|month)|in my (?:previous|last|current) (?:job|role|company|team)|there was a time|our team (?:was|had)|we had (?:a|an)|the project was|while (?:i was|working))/],
  ["task", /\b(?:my (?:role|task|job|responsibility|goal|aim) was|i was (?:responsible|asked|tasked|supposed|given)|i had to|i needed to|we (?:needed|had) to|the (?:goal|aim|challenge|problem|task|target) was|our target|deadline)/],
  ["action", /\b(?:i (?:decided|did|built|created|made|wrote|designed|led|organi[sz]ed|started|spoke|talked|reached out|set up|automated|fixed|analy[sz]ed|learned|learnt|took|planned|proposed|suggested|convinced|split|scheduled|called|met|tested|implemented|developed|coordinated|handled|managed|asked|trained|taught|researched|prepared|reviewed|divided|delegated|negotiated|collected|improved|changed)|(?:first|then|so|next|after that),? i\b)/],
  ["result", /\b(?:as a result|in the end|finally|eventually|which (?:led|helped|meant|resulted|cut|saved|increased|reduced|improved|got)|resulted in|the (?:result|outcome) was|we (?:won|got|finished|delivered|launched|saved|reduced|increased|improved|completed|secured)|i (?:won|got selected|was selected|received|secured|finished|completed)|it (?:worked|helped|led|reduced|increased|improved|saved)|(?:increased|reduced|improved|saved|cut) (?:it )?(?:by|from|to)|i learn(?:ed|t)|lesson)/],
];
const INTRO: Array<[string, RegExp]> = [
  ["now", /\b(?:i am|i'm|currently|right now|at present|final[- ]year|pursuing|studying|i work|working as|graduat(?:e|ed|ing))\b/],
  ["before", /\b(?:i (?:did|completed|worked|interned|built|studied|graduated|led|made|developed|created|won|was|have (?:built|worked|done|led|made))|my (?:internship|project|experience)|during|previously|earlier|before (?:this|that))\b/],
  ["next", /\b(?:looking for|i want|i'd like|i would like|excited|keen|interested in|this (?:role|job|position|company)|join(?:ing)?\b|my goal|next step|hoping to|i see myself|that's why|which is why)/],
];
const PERSONAL = /\b(?:my (?:father|mother|parents|family|brother|sister|dad|mom|mum)|native place|hometown|home town|born and brought up|i belong to|my hobbies)\b/g;
const STEPS = /\b(?:first(?:ly)?|second(?:ly)?|then|next|after that|afterwards|finally|step|meanwhile|at the same time|lastly)\b/g;
const I_WOULD = /\b(?:i would|i'd|i will|i'll|i'd first|my first step)\b/;
const ASSUME = /\b(?:assum(?:e|ing|ption)|let's say|let us say|suppose|roughly|approximately|around|about \d|say \d)\b/;
const REASONING = /\b(?:so|therefore|which gives|that gives|that means|multiply|divide|times|per (?:year|month|day|person|household)|out of|i'd (?:check|look|split|compare))\b/;
const OWNS = /\b(?:my weakness|i struggle|i struggled|i used to|i wasn't|i was not|i made a mistake|my mistake|i realised|i realized|i failed|i'm not (?:good|great|confident)|i am not (?:good|great|confident)|i tend to|i find it hard)\b/;
const IMPROVES = /\b(?:working on|improv(?:e|ing)|i've started|i have started|now i|these days i|i learn(?:ed|t)|i practi[cs]e|i make sure|since then|to fix (?:this|it)|so i (?:started|began|joined|took))\b/;
const CLICHE = /\b(?:perfectionist|work too hard|too honest|too much of a|care too much)\b/;
const REASON = /\b(?:because|since|the reason|that's why|which is why|so that|as i|i (?:like|enjoy|love|want|believe)|excited)\b/;
const TO_THEM = /\b(?:your|you|this (?:role|job|company|team|position)|the (?:team|role|company)|here)\b/;
const EXAMPLE = /\b(?:for example|for instance|e\.?g\.?|such as|like when|imagine|say we|suppose|let's say|in my project|i used|for a|think of)\b/;

function sentences(text: string): string[] {
  return text.split(/[.!?]+\s*/).map((s) => s.trim()).filter((s) => words(s).length > 0);
}

function verdictOf(hits: number, of: number): Verdict {
  return hits >= of ? "good" : hits >= of - 1 ? "ok" : "improve";
}

function list(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function checkStructure(text: string, kind: QuestionKind): Check | null {
  const low = text.toLowerCase().replace(/’/g, "'");
  const label = STRUCTURE_LABEL[kind];
  if (!label) return null;
  const check = (verdict: Verdict, detail: string): Check => ({ id: "structure", label, verdict, detail });
  switch (kind) {
    case "story": {
      const have = STAR.filter(([, re]) => re.test(low)).map(([n]) => n);
      const missing = STAR.map(([n]) => n).filter((n) => !have.includes(n));
      const v = verdictOf(have.length, 4);
      if (!missing.length) return check(v, "Situation, task, action and result: all there.");
      return check(v, `Has ${list(have) || "none of the parts"}. Add the ${list(missing)}: ${missing.includes("result") ? "end with what happened, ideally a number." : "say where you were and what had to be done."}`);
    }
    case "intro": {
      const have = INTRO.filter(([, re]) => re.test(low)).map(([n]) => n);
      const personal = low.match(PERSONAL)?.length ?? 0;
      const order = ["improve", "ok", "good"] as const;
      let v = verdictOf(have.length, 3);
      if (personal) v = order[Math.max(order.indexOf(v) - 1, 0)]!;
      const missing = INTRO.map(([n]) => n).filter((n) => !have.includes(n));
      const parts = missing.length ? `Covers ${list(have) || "none of now, before and next"}; add ${list(missing.map((m) => (m === "now" ? "who you are now" : m === "before" ? "what you've done" : "why this job")))}.` : "Who you are now, what you've done, and why this job.";
      return check(v, personal ? `${parts} Skip family and hometown unless they ask: keep to studies, work and the job.` : parts);
    }
    case "situational": {
      const steps = low.match(STEPS)?.length ?? 0;
      const owned = I_WOULD.test(low);
      const v = verdictOf((steps >= 2 ? 1 : 0) + (owned ? 1 : 0), 2);
      return check(v, v === "good" ? "Clear steps, in order, and what you'd do." : `${steps >= 2 ? "" : "Give the steps in order (“first… then… finally…”). "}${owned ? "" : "Say what you would do: “I would…”."}`.trim());
    }
    case "case": {
      const parts = [ASSUME.test(low), REASONING.test(low), numbersIn(low).length >= 2];
      const v = verdictOf(parts.filter(Boolean).length, 3);
      const need = [!parts[0] && "say your assumptions", !parts[1] && "walk through the steps", !parts[2] && "put numbers on it"].filter(Boolean) as string[];
      return check(v, need.length ? `To be easy to follow: ${list(need)}.` : "Assumptions, steps and numbers: easy to follow.");
    }
    case "reflection": {
      if (CLICHE.test(low)) return check("improve", "“Perfectionist” or “I work too hard” sounds rehearsed. Pick a real weakness and what you're doing about it.");
      const owns = OWNS.test(low);
      const better = IMPROVES.test(low);
      const v = verdictOf((owns ? 1 : 0) + (better ? 1 : 0), 2);
      return check(v, v === "good" ? "Honest, and shows what you're doing about it." : `${owns ? "" : "Name it plainly. "}${better ? "" : "Then say what you're doing to get better."}`.trim());
    }
    case "motivation": {
      const why = REASON.test(low);
      const them = TO_THEM.test(low);
      const v = verdictOf((why ? 1 : 0) + (them ? 1 : 0), 2);
      return check(v, v === "good" ? "A clear reason, tied to them." : `${why ? "" : "Give a reason (“because…”). "}${them ? "" : "Tie it to this company or role, not only to you."}`.trim());
    }
    case "knowledge": {
      const example = EXAMPLE.test(low);
      const longest = Math.max(0, ...sentences(text).map((s) => words(s).length));
      const plain = longest <= 30;
      const v = verdictOf((example ? 1 : 0) + (plain ? 1 : 0), 2);
      return check(v, v === "good" ? "Plain words and an example." : `${example ? "" : "Add an example (“for example…”). "}${plain ? "" : "Break up the longest sentence: one idea each."}`.trim());
    }
    default:
      return null;
  }
}

/** Which checks a kind of question gets, after length, shape and fillers. */
const SPECIFICS: QuestionKind[] = ["intro", "story", "case"];
const OWNERSHIP: QuestionKind[] = ["story", "situational"];

/** Every check for one answer, in the order shown. `spoken`: the answer came from speech-to-text; `country`: where
 *  the user applies (the examples follow it). */
export function checkAnswer(text: string, question: Pick<WarmupQuestion, "kind" | "words">, spoken = false, country: string = INDIA): Check[] {
  const n = words(text).length;
  if (n < MIN_WORDS) return [];
  const out: Check[] = [checkLength(n, question.words ?? LENGTH[question.kind])];
  const shape = checkStructure(text, question.kind);
  if (shape) out.push(shape);
  if (SPECIFICS.includes(question.kind)) out.push(checkSpecifics(text, country));
  if (OWNERSHIP.includes(question.kind)) out.push(checkOwnership(text));
  out.push(checkClarity(text, n, spoken));
  return out;
}

export interface RoundSummary {
  answered: number;
  /** Checks that came out well in most answers that had them. */
  strengths: CheckId[];
  /** The check to work on: the one marked "improve" most often (null when nothing was). */
  focus: CheckId | null;
  /** Each check's label, for the summary's words. */
  labels: Partial<Record<CheckId, string>>;
}

/** What a round of answers says overall. */
export function summarise(results: Check[][]): RoundSummary {
  const tally = new Map<CheckId, { good: number; improve: number; all: number; label: string }>();
  for (const checks of results) {
    for (const c of checks) {
      const t = tally.get(c.id) ?? { good: 0, improve: 0, all: 0, label: c.id === "structure" ? "Structure" : c.label };
      t.all += 1;
      if (c.verdict === "good") t.good += 1;
      if (c.verdict === "improve") t.improve += 1;
      tally.set(c.id, t);
    }
  }
  const entries = [...tally.entries()];
  const strengths = entries.filter(([, t]) => t.good * 2 > t.all).map(([id]) => id);
  const worst = entries.filter(([, t]) => t.improve > 0).sort((a, b) => b[1].improve - a[1].improve)[0];
  return {
    answered: results.filter((r) => r.length > 0).length,
    strengths,
    focus: worst ? worst[0] : null,
    labels: Object.fromEntries(entries.map(([id, t]) => [id, t.label])),
  };
}
