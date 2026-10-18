// The voice-over on a film's clock: vo/manifest.json (tools/vo.py) gives each line's length and its words' times.
import manifest from "../../vo/manifest.json";
import type { Word } from "./ui";

type Line = { dur: number; caption: string; words: Word[] };
const M = manifest as unknown as Record<string, Line>;

export interface Placed {
  id: string;
  t: number;
  dur: number;
  text: string;
  words: Word[];
}

/** Line `id` starting at film time `at`. */
export function line(id: string, at: number): Placed {
  const m = M[id];
  if (!m) throw new Error(`no voice-over line ${id} (run tools/tts.mjs and tools/vo.py)`);
  return { id, t: at, dur: m.dur, text: m.caption, words: m.words.map(([w, s, e]) => [w, at + s, at + e] as Word) };
}

export function dur(id: string): number {
  return M[id]?.dur ?? 3;
}

/** When the `nth` time `word` is said in a placed line (punctuation and case ignored). */
export function when(p: Placed, word: string, nth = 0): number {
  const key = word.toLowerCase().replace(/[^\p{L}\p{N}%]/gu, "");
  const hits = p.words.filter((w) => w[0].toLowerCase().replace(/[^\p{L}\p{N}%]/gu, "") === key);
  return (hits[nth] ?? hits[hits.length - 1] ?? [word, p.t, p.t])[1];
}

/** When the line's words up to the `n`th sentence end (0 = the first sentence). */
export function sentenceEnd(p: Placed, n = 0): number {
  const ends = p.words.filter((w) => /[.?!]$/.test(w[0]));
  return (ends[n] ?? p.words[p.words.length - 1]!)[2];
}
