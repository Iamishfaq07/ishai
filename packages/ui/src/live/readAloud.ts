import type { AnswerView } from "./reducer";
import { splitPlaceholders } from "./placeholders";

/**
 * What "Read aloud" says for an answer: the spoken answer and its talking points. Code, diagrams and "[fill in]"
 * prompts become a pause: a placeholder read verbatim is exactly what the on-screen chips exist to prevent.
 */
export function speechText(answer: AnswerView["answer"]): string {
  const spoken = (s: string) =>
    normalizeSpeech(
      splitPlaceholders(s)
        .map((part) => (part.kind === "text" ? part.text : "…")) // a pause where they fill in their own detail
        .join(" "),
    );
  const parts = [answer.direct_answer, ...answer.talking_points].map(spoken).filter(Boolean);
  return parts.map((p) => (/[.!?]$/.test(p) ? p : `${p}.`)).join(" ");
}

function normalizeSpeech(text: string): string {
  const out: string[] = [];
  let pendingSpace = false;
  for (const char of text) {
    if (char === "`") continue;
    if (char.trim() === "") {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace && !",.;:!?".includes(char)) out.push(" ");
    out.push(char);
    pendingSpace = false;
  }
  return out.join("");
}

/**
 * Sentence-sized pieces (≤ `max` characters, never splitting a word). One utterance per piece keeps long answers
 * reliable in WebView2/Chromium, where a single long utterance can stall, and lets speed and voice changes apply
 * from the next sentence.
 */
export function speechChunks(text: string, max = 220): string[] {
  const sentences = splitSentences(text);
  const chunks: string[] = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };
  for (const s of sentences) {
    if (s.length > max) {
      push();
      for (const word of s.split(/\s+/)) {
        if (cur && cur.length + word.length + 1 > max) push();
        cur = cur ? `${cur} ${word}` : word;
      }
      push();
    } else if (cur.length + s.length > max) {
      push();
      cur = s;
    } else cur += s;
  }
  push();
  return chunks;
}

const ENDS = ".!?";
const CLOSERS = "\"')]";

/**
 * Sentences with their end punctuation, closing quotes/brackets and trailing space ("Hi!\" " → one piece); the last
 * piece may have no end mark. A scan rather than a regex, which backtracks quadratically on long unpunctuated text.
 */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  const skip = (chars: string | RegExp) => {
    while (i < text.length && (typeof chars === "string" ? chars.includes(text[i]!) : chars.test(text[i]!))) i++;
  };
  while (i < text.length) {
    if (!ENDS.includes(text[i]!)) {
      i++;
      continue;
    }
    const empty = i === start; // stray end marks with no words before them are dropped
    skip(ENDS);
    if (empty) {
      start = i;
      continue;
    }
    skip(CLOSERS);
    skip(/\s/);
    out.push(text.slice(start, i));
    start = i;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

export const READ_ALOUD_RATES = [0.75, 1, 1.25, 1.5] as const;
