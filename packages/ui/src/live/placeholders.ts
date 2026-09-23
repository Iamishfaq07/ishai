/**
 * The live prompt asks the model to leave details it can't verify as bracketed prompts the user fills in
 * from memory ("[the pushback you got from developers]"). These must look different on screen so they're
 * never read aloud verbatim.
 */
export type SpokenPart = { kind: "text"; text: string } | { kind: "fill"; text: string };

const PLACEHOLDER = /\[([^\][\n]{2,160})\]/g;

export function splitPlaceholders(text: string): SpokenPart[] {
  const parts: SpokenPart[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ kind: "text", text: text.slice(last, start) });
    parts.push({ kind: "fill", text: m[1] ?? "" });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}
