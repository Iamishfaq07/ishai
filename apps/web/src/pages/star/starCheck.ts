/**
 * STAR answer check: a behavioural answer scored against the STAR+R rubric interview coaches and open-source
 * interview simulators use (Situation, Task, Action, Result, and Reflection), plus the delivery basics: numbers,
 * ownership ("I" over "we"), length for about two minutes spoken, and filler words. Pattern-based and explainable:
 * every point quotes the sentence it came from. It reads structure, not truth; it never judges the story itself.
 */

export const QUESTIONS = [
  "Tell me about a time you solved a difficult problem.",
  "Tell me about a time you disagreed with a teammate or manager.",
  "Describe a time you missed a deadline or made a mistake.",
  "Tell me about a time you led something without being the manager.",
  "Describe a time you had to learn something quickly.",
  "Tell me about your proudest achievement.",
  "Tell me about a time you handled a difficult customer or stakeholder.",
  "Describe a time you improved a process.",
  "Tell me about a time you worked under pressure.",
  "Tell me about a time you failed. What did you learn?",
] as const;

export type PartId = "situation" | "task" | "action" | "result" | "reflection";

const PARTS: { id: PartId; label: string; points: number; re: RegExp; tip: string }[] = [
  { id: "situation", label: "Situation", points: 15,
    re: /\b(?:when I was|while I was|at my (?:last|previous|first)|in my (?:role|job|internship|final year|team|last)|during (?:my|our|the)|last (?:year|month|quarter|semester)|in (?:19|20)\d{2}|our (?:team|company|college|client)|the (?:company|project|team) (?:was|had))\b/i,
    tip: "Open with one or two sentences of context: where you were, when, and what was going on." },
  { id: "task", label: "Task", points: 10,
    re: /\b(?:my (?:goal|task|job|responsibility|role) was|I was (?:responsible|asked|tasked|expected)|I (?:needed|had) to|the (?:challenge|problem|goal|deadline) was|we (?:needed|had) to)\b/i,
    tip: "Say what you had to achieve, or the problem that was yours to solve." },
  { id: "action", label: "Action", points: 30,
    re: /\bI (?:then |first |also |personally )?(?:built|led|designed|wrote|created|analy[sz]ed|negotiated|organi[sz]ed|implemented|fixed|set up|proposed|spoke|talked|met|called|researched|tested|automated|rewrote|planned|coordinated|reached out|trained|mentored|reviewed|launched|migrated|debugged|prioriti[sz]ed|convinced|presented|decided|introduced|changed|started|asked|broke|split|tracked|measured)\b/i,
    tip: "Spend most of the answer on what you did, step by step, with \"I\" and a verb." },
  { id: "result", label: "Result", points: 25,
    re: /\b(?:as a result|which (?:led|meant|helped|cut|saved|brought)|resulting in|the (?:result|outcome) was|in the end|by the end|we (?:shipped|delivered|won|hit|met|launched)|(?:increased|reduced|cut|saved|improved|grew|doubled|halved|raised|lowered) (?:the |our |it |by )?)/i,
    tip: "End with what changed, ideally with a number: time saved, money, users, a grade, a deadline met." },
  { id: "reflection", label: "Reflection", points: 5,
    re: /\b(?:I learn(?:ed|t)|taught me|next time|in hindsight|looking back|I would (?:now )?do|I'd do|since then I|I now (?:always|make sure))\b/i,
    tip: "Close with one line on what you learnt or now do differently." },
];

const FILLERS = ["basically", "actually", "literally", "you know", "kind of", "sort of", "i mean", "like i said", "um", "uh", "very very", "so so"];
const NUMBER = /(?:₹|\$|£|€|rs\.?\s?)?\b\d[\d,.]*\s?(?:%|percent|x\b|k\b|lakh|crore|hours?|days?|weeks?|months?|users?|customers?|people|clients?|students?|minutes?|seconds?|ms\b)?/gi;

export function sentences(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).map((s) => s.trim()).filter(Boolean);
}

export interface Finding { id: PartId; label: string; points: number; got: number; quote: string | null; tip: string }

export interface StarReport {
  score: number;
  words: number;
  seconds: number;
  parts: Finding[];
  numbers: string[];
  i: number;
  we: number;
  fillers: { word: string; count: number }[];
  notes: string[];
}

const WPM = 140;

export function checkAnswer(text: string): StarReport {
  const list = sentences(text);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const parts = PARTS.map((p) => {
    const hits = list.filter((s) => p.re.test(s));
    // Actions earn more for more than one step; everything else is there or not.
    const got = !hits.length ? 0 : p.id === "action" ? Math.min(p.points, Math.round(p.points * (0.5 + 0.25 * (hits.length - 1)))) : p.points;
    return { id: p.id, label: p.label, points: p.points, got, quote: hits[0] ?? null, tip: p.tip };
  });
  const numbers = [...new Set((text.match(NUMBER) ?? []).map((n) => n.trim()).filter((n) => /\d/.test(n) && !/^(?:19|20)\d{2}$/.test(n)))];
  const lower = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ")} `;
  const count = (w: string) => lower.split(` ${w} `).length - 1;
  const i = count("i") + count("i'm") + count("i've") + count("i'd") + count("my");
  const we = count("we") + count("we're") + count("we've") + count("our");
  const fillers = FILLERS.map((word) => ({ word, count: count(word) })).filter((f) => f.count > 0);
  const seconds = Math.round((words / WPM) * 60);

  const notes: string[] = [];
  let extra = 0;
  if (numbers.length) extra += 5; else notes.push("Add at least one number: how many, how much, how fast, or by when.");
  if (words >= 150 && words <= 400) extra += 5;
  else if (words < 150) notes.push(`About ${seconds} seconds spoken. Most strong answers run 1½ to 2½ minutes (roughly 200 to 350 words).`);
  else notes.push(`About ${Math.round(seconds / 60)} minutes spoken. Trim the context and keep the action and result.`);
  if (i >= we) extra += 5; else notes.push("\"We\" outnumbers \"I\". Interviewers are scoring you: say what you did.");
  const fillerTotal = fillers.reduce((n, f) => n + f.count, 0);
  if (fillerTotal >= 3) notes.push(`${fillerTotal} filler words (${fillers.map((f) => f.word).join(", ")}). They read worse than they sound; cut most of them.`);

  const score = Math.min(100, parts.reduce((n, p) => n + p.got, 0) + extra);
  return { score, words, seconds, parts, numbers, i, we, fillers, notes };
}

export function band(score: number): { label: string; tone: "good" | "ok" | "weak" } {
  return score >= 80 ? { label: "Interview-ready", tone: "good" } : score >= 55 ? { label: "Good base, a few gaps", tone: "ok" } : { label: "Needs structure", tone: "weak" };
}
