/**
 * The live prompt asks the model to leave details it can't verify as bracketed prompts the user fills in
 * from memory ("[the pushback you got from developers]"). These must look different on screen so they're
 * never read aloud verbatim.
 */
export type SpokenPart = { kind: "text"; text: string } | { kind: "fill"; text: string };

const PLACEHOLDER = /\[([^\][\n]{2,160})\]/g;

/** One list item that is a value, not words: a number, a quoted string, true/false/null. */
const LITERAL = /^(?:-?\d[\d.,_]*|"[^"]*"|'[^']*'|`[^`]*`|true|false|null|none|nil|undefined)$/i;

/**
 * Brackets that hold data or code, which are said (and shown) as they are: an index (`arr[i]`, `grid[r][c]`), values
 * (`[2, 7, 11, 15]`, `["a", "b"]`), an expression (`[mid+1]`), or a list of bare names (`[left, right]`). A fill-in
 * is words: "[the metric you improved]", "[company]", "[X%]", "[team/project]".
 */
function isCode(inner: string, before: string): boolean {
  if (/[\w)\]]/.test(before)) return true; // an index
  if (!/[a-z]/i.test(inner) || /[{}]/.test(inner)) return true; // numbers and punctuation, or an object
  // An expression: operators, and no run of words ("[5+ years of experience]" is a fill-in).
  if (/[=<>+*^|&]/.test(inner) && (!/\s/.test(inner.trim()) || !/[a-z]{4,}/i.test(inner))) return true;
  const items = inner.split(",").map((item) => item.trim());
  if (items.every((item) => LITERAL.test(item))) return true;
  return items.length > 1 && items.every((item) => /^[\w.$+\-*/]+$/.test(item));
}

export function splitPlaceholders(text: string): SpokenPart[] {
  const parts: SpokenPart[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const start = m.index ?? 0;
    const inner = m[1] ?? "";
    if (isCode(inner, text[start - 1] ?? "")) continue; // stays part of the text around it
    if (start > last) parts.push({ kind: "text", text: text.slice(last, start) });
    parts.push({ kind: "fill", text: inner });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}
