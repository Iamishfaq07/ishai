/**
 * Text as it should be spoken (DECISIONS D76): what a voice reads aloud isn't always what's written. Acronyms are read
 * the way people say them (SQL is "sequel", AWS is "A W S"), money, percentages and years come out right, markdown and
 * list numbers aren't read, and dashes and line breaks become pauses. Shared by Saba's natural voice, the device's
 * voice and the copilot's Read aloud.
 *
 * Also how a line is split for speaking sentence by sentence (the first one alone, so it starts sooner), and when each
 * word is said in a clip of a known length (the natural voice gives no word timestamps: estimated from the clip and
 * the words' syllables, for captions that reveal as she speaks).
 */

/** Words said as a word, not letter by letter, or with their own reading. Case-sensitive keys. */
const SAID: Record<string, string> = {
  SQL: "sequel",
  NoSQL: "no-sequel",
  MySQL: "my sequel",
  PostgreSQL: "postgres",
  GraphQL: "graph Q L",
  "C++": "C plus plus",
  "C#": "C sharp",
  "F#": "F sharp",
  ".NET": "dot net",
  "ASP.NET": "A S P dot net",
  "Node.js": "node J S",
  "Vue.js": "view J S",
  "Next.js": "next J S",
  "CI/CD": "C I C D",
  "UI/UX": "U I U X",
  "I/O": "I O",
  "A/B": "A B",
  JSON: "jason",
  SaaS: "sass",
  PaaS: "pass",
  IaaS: "I A A S",
  B2B: "B to B",
  B2C: "B to C",
  LPA: "lakhs per annum",
  OKR: "O K R",
  OKRs: "O K Rs",
  KPI: "K P I",
  KPIs: "K P Is",
  APIs: "A P Is",
  SDKs: "S D Ks",
  LLMs: "L L Ms",
  GIF: "gif",
  JPEG: "jay-peg",
  NASA: "NASA",
  NATO: "NATO",
  SCRUM: "scrum",
  OAuth: "oh auth",
  iOS: "eye O S",
  macOS: "mac O S",
  DevOps: "dev ops",
  "e.g.": "for example",
  "i.e.": "that is",
  "etc.": "et cetera",
  "vs.": "versus",
  vs: "versus",
};
/** Capitalised words that are words, not acronyms (left as they are). */
const WORDS = new Set(["I", "A", "OK", "NO", "SO", "OR", "AND", "NOT", "THE", "TO", "IN", "ON", "AT", "IF", "IS", "BE", "DO",
  "GO", "MY", "WE", "US.", "NASA", "NATO", "SCRUM", "AM", "PM"]);

/** Spaced letters for an acronym: "AWS" → "A W S", "SDEs" → "S D Es". */
function spell(token: string): string {
  const plural = /^[A-Z]{2,}s$/.test(token);
  const core = plural ? token.slice(0, -1) : token;
  return core.split("").join(" ") + (plural ? "s" : "");
}

function rupees(amount: string, unit: string | undefined): string {
  const n = amount.replace(/,/g, "");
  const u = (unit || "").toLowerCase();
  if (u === "lpa") return `${n} lakhs per annum`;
  if (u === "l" || u === "lakh" || u === "lakhs") return `${n} lakh rupees`;
  if (u === "cr" || u === "crore" || u === "crores") return `${n} crore rupees`;
  if (u === "k") return `${n} thousand rupees`;
  return `${amount} rupees`;
}

function dollars(amount: string, unit: string | undefined): string {
  const u = (unit || "").toLowerCase();
  if (u === "k") return `${amount} thousand dollars`;
  if (u === "m" || u === "mn") return `${amount} million dollars`;
  if (u === "b" || u === "bn") return `${amount} billion dollars`;
  return `${amount} dollars`;
}

/** `text` as a voice should read it. Idempotent enough to run twice. */
export function speakable(text: string): string {
  let t = text;
  // Markdown and lists aren't read: **bold**, `code`, # headings, "1." and "-" at the start of a line, links.
  t = t.replace(/\[([^\]]+)\]\((?:https?:\/\/)[^)]+\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, "the link");
  t = t.replace(/(\*\*|__|`+|~~)/g, "");
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/gm, "");
  t = t.replace(/(^|\s)\*(\S[^*]*\S)\*(?=\s|$|[.,!?])/g, "$1$2");
  // Lines and dashes are pauses.
  t = t.replace(/\s*\n+\s*/g, (m, offset: number) => (offset > 0 && !/[.!?:;,]$/.test(t.slice(0, offset)) ? ". " : " "));
  t = t.replace(/\s+[—–-]\s+/g, ", ").replace(/—/g, ", ");
  // Money, percentages, ranges.
  t = t.replace(/₹\s?([\d,]+(?:\.\d+)?)(?:\s?(LPA|lakhs?|L|crores?|cr|k)\b)?/gi, (_m, a: string, u?: string) => rupees(a, u));
  t = t.replace(/\b(?:Rs\.?|INR)\s?([\d,]+(?:\.\d+)?)(?:\s?(LPA|lakhs?|L|crores?|cr|k)\b)?/g, (_m, a: string, u?: string) => rupees(a, u));
  t = t.replace(/\b([\d.]+)\s?LPA\b/g, "$1 lakhs per annum");
  t = t.replace(/\$\s?([\d,]+(?:\.\d+)?)(?:\s?(k|m|mn|b|bn)\b)?/gi, (_m, a: string, u?: string) => dollars(a, u));
  t = t.replace(/(\d)\s?%/g, "$1 percent");
  t = t.replace(/(\d)\s?-\s?(\d)/g, "$1 to $2");
  t = t.replace(/\s&\s/g, " and ");
  // Words with their own reading, then other acronyms spelt out.
  t = t.replace(/(?<![\w.])(?:e\.g\.|i\.e\.|etc\.|vs\.)/g, (m) => SAID[m] ?? m);
  t = t.replace(/(?<![\w])(\.NET|ASP\.NET|C\+\+|C#|F#|CI\/CD|UI\/UX|I\/O|A\/B|Node\.js|Vue\.js|Next\.js)(?![\w])/g, (m) => SAID[m] ?? m);
  t = t.replace(/\b[A-Za-z][A-Za-z0-9]*\b/g, (w) => {
    if (SAID[w] !== undefined) return SAID[w];
    if (WORDS.has(w)) return w;
    if (/^[A-Z]{2,6}s?$/.test(w) && !/^[A-Z][a-z]/.test(w)) return spell(w);
    return w;
  });
  return t.replace(/\s{2,}/g, " ").trim();
}

/**
 * How a line is said, sentence by sentence: the first sentence alone (split at a comma if it's long), so the voice
 * starts as soon as it can; the rest a sentence each, a very short one joined to the next; at most `max` pieces.
 */
export function speechChunks(text: string, max = 4): string[] {
  const sentences = text.trim().split(/(?<=[.!?])\s+(?=\S)/).map((x) => x.trim()).filter(Boolean);
  if (!sentences.length) return [];
  const out: string[] = [];
  for (const sentence of sentences) {
    const last = out[out.length - 1];
    // A very short sentence ("Hi.", "Okay.") goes with its neighbour: a clip that short is mostly its own silence.
    const tinyLast = last !== undefined && last.split(/\s+/).length < 3;
    const tinyThis = sentence.split(/\s+/).length < 3 && out.length > 1;
    if (last !== undefined && (tinyLast || tinyThis)) out[out.length - 1] = `${last} ${sentence}`;
    else out.push(sentence);
  }
  // A long first sentence: its first clause on its own.
  const first = out[0]!;
  const words = first.split(/\s+/);
  if (words.length > 16) {
    const comma = first.indexOf(", ", 30);
    if (comma > 0 && comma < first.length - 20) out.splice(0, 1, first.slice(0, comma + 1), first.slice(comma + 2));
  }
  while (out.length > max) out.splice(max - 1, 2, `${out[max - 1]} ${out[max]}`);
  return out;
}

/** Roughly how many syllables a word has (its vowel groups; other scripts by length). */
export function syllableCount(word: string): number {
  const latin = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!latin) return Math.max(1, Math.min(6, Math.round([...word.replace(/[\s\p{P}]/gu, "")].length / 2.5)));
  const n = latin.match(/[aeiouy]+/g)?.length ?? 0;
  const silentE = n > 1 && /[^aeiouy]e$/.test(latin) ? 1 : 0;
  return Math.max(1, Math.min(7, n - silentE || 1));
}

export interface TimedWord {
  /** Offsets into the text the timeline was made for. */
  start: number;
  end: number;
  /** Seconds into the clip. */
  at: number;
}

/**
 * When each word of `text` is said in a clip that speaks from `from` to `to` seconds: by syllables, with pauses at
 * commas and sentence ends, the way a steady voice paces a sentence. An estimate for the natural voice, which gives no
 * word timestamps.
 */
export function wordTimeline(text: string, from: number, to: number): TimedWord[] {
  const words: Array<{ start: number; end: number; weight: number }> = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const w = m[0];
    const pause = /[.!?]["')\]]*$/.test(w) ? 2.2 : /[,;:]["')\]]*$/.test(w) ? 1.1 : 0;
    words.push({ start: m.index, end: m.index + w.length, weight: 0.45 + syllableCount(w) + pause });
  }
  const total = words.reduce((n, w) => n + w.weight, 0) || 1;
  const span = Math.max(0.1, to - from);
  let t = from;
  return words.map((w) => {
    const out = { start: w.start, end: w.end, at: t };
    t += (w.weight / total) * span;
    return out;
  });
}
