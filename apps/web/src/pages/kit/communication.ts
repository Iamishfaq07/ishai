// Communication test practice: the spoken English rounds mass recruiters and BPOs run before any interview (the
// AI-scored Versant- and SVAR-style tests). Five kinds of item, each scored in the browser from what speech-to-text
// heard: how much of a sentence came back word for word (read aloud, repeat), the right order (sentence builds), the
// story's key points (retelling) and length, pace and fillers (open questions). The items are Orbit's own, written in
// the style of these tests; the real ones differ by employer and vendor.
import { fillers, words } from "../../lib/warmup/checks";

export type SectionId = "read" | "repeat" | "build" | "retell" | "open";

export interface Section {
  id: SectionId;
  name: string;
  how: string;
  /** Hidden until answered: the candidate hears it (speech synthesis), the way the test plays it. */
  listen: boolean;
  seconds: number; // a sensible time to answer, shown as a guide
}

export const SECTIONS: Section[] = [
  { id: "read", name: "Read aloud", how: "Read the sentence out loud, clearly and at a steady pace.", listen: false, seconds: 15 },
  { id: "repeat", name: "Repeat", how: "Listen to the sentence once, then say it back exactly.", listen: true, seconds: 10 },
  { id: "build", name: "Sentence builds", how: "The phrases are jumbled. Say them as one sentence, in an order that makes sense.", listen: false, seconds: 12 },
  { id: "retell", name: "Story retelling", how: "Listen to the short story, then retell it in your own words: who, what happened, and how it ended.", listen: true, seconds: 40 },
  { id: "open", name: "Open question", how: "Answer in about 30 to 45 seconds: a clear point, a reason and an example.", listen: false, seconds: 45 },
];

export const READ: string[] = [
  "The training session for new joiners will begin at nine thirty on Monday morning.",
  "Please keep your laptop charged and bring a photo identity card on the first day.",
  "Our team answers customer questions by phone, email and chat throughout the week.",
  "If a customer is unhappy, listen carefully before you explain what you can do.",
  "The office cafeteria serves breakfast until ten and lunch from half past twelve.",
  "Every project starts with a short meeting to agree on goals and deadlines.",
  "She updated the report with the latest figures and shared it with her manager.",
  "Clear writing saves time, because readers do not have to guess what you mean.",
];

export const REPEAT: string[] = [
  "The meeting has been moved to the second floor.",
  "Could you send me the file before lunch?",
  "Most of our customers call in the evening.",
  "He forgot to save his work before the system restarted.",
  "Please check the address twice before you ship the order.",
  "The new policy applies to every employee from next month.",
  "I would like to know when my refund will be processed.",
  "Our manager asked us to finish the testing by Friday.",
];

/** The phrases in their right order; the page shuffles them. Other orders can also be fine, so the check is lenient. */
export const BUILD: string[][] = [
  ["the report", "was sent", "to the client", "this morning"],
  ["please call me", "after you", "reach the office"],
  ["our team", "fixed the problem", "within an hour"],
  ["the store", "will remain closed", "on Sunday"],
  ["she asked", "for a day off", "next week"],
  ["the interview", "starts at ten", "in room four"],
];

export interface Story { text: string; points: Array<{ label: string; any: string[] }> }

/** Short stories with the key points a retelling should carry (any one of the words counts for a point). */
export const STORIES: Story[] = [
  {
    text: "Priya worked at a bakery near the bus station. One rainy morning the power went out and the ovens stopped. Instead of closing, she put the bread that was already baked on a table outside and sold it at half price. By noon everything was gone, and several customers came back the next day to buy more.",
    points: [
      { label: "Priya at a bakery", any: ["priya", "bakery", "baker"] },
      { label: "the power went out", any: ["power", "electricity", "light", "ovens"] },
      { label: "sold the bread outside, cheaper", any: ["half", "cheap", "discount", "outside", "table", "sold"] },
      { label: "it all sold by noon", any: ["noon", "gone", "sold out", "everything", "all"] },
      { label: "customers came back", any: ["came back", "returned", "next day", "again"] },
    ],
  },
  {
    text: "Arjun had his first job interview on Friday. On the way, his bus broke down. He called the company, explained what had happened and asked if he could join by video instead. The interviewer agreed. Arjun found a quiet corner in a cafe, answered every question calmly, and got the job a week later.",
    points: [
      { label: "Arjun's first interview", any: ["arjun", "interview"] },
      { label: "the bus broke down", any: ["bus", "broke", "late"] },
      { label: "he called and asked for video", any: ["called", "phone", "video", "online"] },
      { label: "interviewed from a cafe", any: ["cafe", "café", "corner", "quiet"] },
      { label: "he got the job", any: ["got the job", "selected", "hired", "offer", "job"] },
    ],
  },
  {
    text: "A small school in a village wanted a library but had no money for books. The students wrote letters to people in the nearby town asking for books they no longer read. Within two months they had collected over five hundred books, and the older students now run the library during lunch break.",
    points: [
      { label: "a village school wanted a library", any: ["school", "village", "library"] },
      { label: "no money for books", any: ["money", "afford", "no books"] },
      { label: "students wrote letters", any: ["letter", "wrote", "asked"] },
      { label: "collected hundreds of books", any: ["five hundred", "500", "hundreds", "collected"] },
      { label: "older students run it at lunch", any: ["lunch", "run", "older students", "manage"] },
    ],
  },
];

export const OPEN: string[] = [
  "Describe a place in your town that you think visitors should see, and why.",
  "Do you prefer working alone or in a team? Give a reason and an example.",
  "What is one skill you learned outside the classroom, and how did you learn it?",
  "Some people say mobile phones should not be allowed in classrooms. What do you think?",
  "Tell us about a time you helped someone solve a problem.",
  "Which would you choose for a first job: a big company or a small startup? Why?",
];

// ---- scoring ------------------------------------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, string> = { "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten", "12": "twelve" };

/** Lower case words without punctuation, with small numbers as words (speech-to-text writes "9" for "nine"). */
export function plain(text: string): string[] {
  return words(text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s]/g, " ")).map((w) => NUMBER_WORDS[w] ?? w);
}

/** How much of `expected` came back in order: the longest common subsequence of words, as a share (0 to 1). */
export function wordMatch(expected: string, said: string): number {
  const a = plain(expected);
  const b = plain(said);
  if (!a.length) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (const x of a) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) row[j] = x === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, row[j - 1]!);
    prev = row;
  }
  // Extra words said (a false start, "sorry") cost a little, so reading the sentence twice isn't a perfect score.
  const extra = Math.max(0, b.length - a.length);
  return Math.max(0, (prev[b.length]! - extra * 0.25) / a.length);
}

/** The words of `expected` that didn't come back, for "you missed: …". */
export function missedWords(expected: string, said: string): string[] {
  const heard = new Set(plain(said));
  return plain(expected).filter((w) => !heard.has(w));
}

/** Per-minute pace from words and seconds (null without a usable time). */
export function pace(said: string, seconds: number): number | null {
  return seconds >= 3 ? Math.round((plain(said).length / seconds) * 60) : null;
}

export function retellPoints(story: Story, said: string): boolean[] {
  const low = ` ${plain(said).join(" ")} `;
  return story.points.map((p) => p.any.some((w) => low.includes(` ${plain(w).join(" ")}`)));
}

export interface ItemResult { section: SectionId; score: number; note: string }

/** One item's score out of 100, with one line on what to work on. */
export function scoreItem(section: SectionId, prompt: string, said: string, seconds: number, story?: Story): ItemResult {
  const text = said.trim();
  if (!text) return { section, score: 0, note: "Nothing was heard. Speak a little closer to the microphone, or type what you said." };
  if (section === "read" || section === "repeat" || section === "build") {
    const m = wordMatch(prompt, text);
    const score = Math.round(Math.min(1, m) * 100);
    const missed = missedWords(prompt, text);
    const note = score >= 90 ? "Word for word. Keep the same steady pace."
      : missed.length ? `Missed or changed: ${missed.slice(0, 5).join(", ")}${missed.length > 5 ? "…" : ""}.`
      : "The words are there but not in order. Say the whole sentence once, without restarting.";
    return { section, score, note };
  }
  if (section === "retell") {
    const hit = retellPoints(story!, text);
    const n = hit.filter(Boolean).length;
    const length = plain(text).length;
    const score = Math.round((n / hit.length) * 85 + (length >= 35 ? 15 : (length / 35) * 15));
    const gaps = story!.points.filter((_, i) => !hit[i]).map((p) => p.label);
    return { section, score, note: gaps.length ? `Add: ${gaps.join("; ")}.` : "Every key point is there. Good." };
  }
  // open question: enough to say, a steady pace, few fillers, a reason and an example
  const n = plain(text).length;
  const wpm = pace(text, seconds);
  const filler = fillers(text).reduce((sum, [, k]) => sum + k, 0);
  const reason = /\b(because|so that|since|that's why|the reason)\b/i.test(text);
  const example = /\b(for example|for instance|once|when i|last year|in my)\b/i.test(text);
  let score = Math.min(40, n);
  if (wpm !== null && wpm >= 100 && wpm <= 170) score += 20;
  else if (wpm !== null && wpm >= 80 && wpm <= 190) score += 10;
  score += reason ? 15 : 0;
  score += example ? 15 : 0;
  score += filler === 0 ? 10 : filler <= 2 ? 5 : 0;
  const tips = [
    n < 40 && "Say more: aim for 60 to 100 words.",
    !reason && "Give a reason (\"because…\").",
    !example && "Add one example from your own life.",
    filler > 2 && "Fewer fillers: a short pause sounds surer.",
    wpm !== null && wpm > 170 && "Slow down a little.",
    wpm !== null && wpm < 100 && n >= 20 && "Speak a little faster and keep going.",
  ].filter(Boolean) as string[];
  return { section, score: Math.min(100, score), note: tips.length ? tips.join(" ") : "Clear point, reason and example. Good." };
}

export function band(score: number): { label: string; tone: "good" | "ok" | "improve" } {
  if (score >= 80) return { label: "Strong", tone: "good" };
  if (score >= 60) return { label: "Nearly there", tone: "ok" };
  return { label: "Keep practising", tone: "improve" };
}

/** A round: two items from each section, different each time (seeded so a test can fix it). */
export interface RoundItem { section: SectionId; prompt: string; story?: Story; parts?: string[] }

function pick<T>(list: T[], n: number, rand: () => number): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [copy[i], copy[j]] = [copy[j]!, copy[i]!]; }
  return copy.slice(0, n);
}

export function shuffled(parts: string[], rand: () => number = Math.random): string[] {
  for (let tries = 0; tries < 6; tries++) {
    const s = pick(parts, parts.length, rand);
    if (s.join("|") !== parts.join("|")) return s;
  }
  return [...parts].reverse();
}

export function newRound(rand: () => number = Math.random): RoundItem[] {
  return [
    ...pick(READ, 2, rand).map((prompt) => ({ section: "read" as const, prompt })),
    ...pick(REPEAT, 2, rand).map((prompt) => ({ section: "repeat" as const, prompt })),
    ...pick(BUILD, 2, rand).map((parts) => ({ section: "build" as const, prompt: parts.join(" "), parts: shuffled(parts, rand) })),
    ...pick(STORIES, 1, rand).map((story) => ({ section: "retell" as const, prompt: story.text, story })),
    ...pick(OPEN, 1, rand).map((prompt) => ({ section: "open" as const, prompt })),
  ];
}

/** The round's score by section (average) and overall. */
export function roundScore(results: ItemResult[]): { overall: number; bySection: Array<{ id: SectionId; name: string; score: number }> } {
  const bySection = SECTIONS.map((s) => {
    const mine = results.filter((r) => r.section === s.id);
    return { id: s.id, name: s.name, score: mine.length ? Math.round(mine.reduce((a, r) => a + r.score, 0) / mine.length) : 0 };
  }).filter((s) => results.some((r) => r.section === s.id));
  const overall = bySection.length ? Math.round(bySection.reduce((a, s) => a + s.score, 0) / bySection.length) : 0;
  return { overall, bySection };
}
