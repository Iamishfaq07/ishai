/**
 * The job post's keywords marked on the on-screen preview (never the printed copy): painted with the CSS Custom
 * Highlight API, so the preview's DOM is untouched (React owns it) and nothing changes where it isn't supported.
 */

const HIGHLIGHT = "resume-keywords";

/** One pattern for all the keywords, longest first ("machine learning" before "learning"), whole words only, any
 *  case; null when there's nothing to mark. Terms like "C++", "Node.js" and ".NET" match as written. */
export function keywordPattern(keywords: string[]): RegExp | null {
  const terms = [...new Set(keywords.map((k) => k.trim()).filter((k) => k.length >= 2))].sort((a, b) => b.length - a.length);
  if (!terms.length) return null;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\p{L}\\p{N}-])(?:${escaped.join("|")})(?![\\p{L}\\p{N}+#])`, "giu");
}

type HighlightRegistry = { set: (name: string, h: unknown) => void; delete: (name: string) => void };

/** Mark the keywords under `root`; returns the clean-up. A no-op where the browser lacks CSS highlights. */
export function paintKeywords(root: HTMLElement, keywords: string[]): () => void {
  const registry = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  const pattern = keywordPattern(keywords);
  if (!registry || !HighlightCtor || !pattern) return () => undefined;
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      const r = document.createRange();
      r.setStart(node, m.index);
      r.setEnd(node, m.index + m[0].length);
      ranges.push(r);
    }
  }
  registry.set(HIGHLIGHT, new HighlightCtor(...ranges));
  return () => registry.delete(HIGHLIGHT);
}
