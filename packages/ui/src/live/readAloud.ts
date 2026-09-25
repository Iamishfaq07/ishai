import type { AnswerView } from "./reducer";
import { splitPlaceholders } from "./placeholders";

/**
 * What "Read aloud" says for an answer: the spoken answer and its talking points. Code, diagrams and "[fill in]"
 * prompts become a pause: a placeholder read verbatim is exactly what the on-screen chips exist to prevent.
 */
export function speechText(answer: AnswerView["answer"]): string {
  const spoken = (s: string) =>
    splitPlaceholders(s)
      .map((part) => (part.kind === "text" ? part.text : "…")) // a pause where they fill in their own detail
      .join(" ")
      .replace(/`/g, "")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  const parts = [answer.direct_answer, ...answer.talking_points].map(spoken).filter(Boolean);
  return parts.map((p) => (/[.!?]$/.test(p) ? p : `${p}.`)).join(" ");
}

/**
 * Sentence-sized pieces (≤ `max` characters, never splitting a word). One utterance per piece keeps long answers
 * reliable in WebView2/Chromium, where a single long utterance can stall, and lets speed and voice changes apply
 * from the next sentence.
 */
export function speechChunks(text: string, max = 220): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [];
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

export const READ_ALOUD_RATES = [0.75, 1, 1.25, 1.5] as const;
