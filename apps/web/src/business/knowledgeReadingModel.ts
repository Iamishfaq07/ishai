import type { BizKnowledgeReadingItem } from "@orbit/types";

export function readingStatus(row: BizKnowledgeReadingItem): string {
  if (row.acknowledged) return "Acknowledged current text";
  return row.acknowledged_at ? "Updated since you last acknowledged" : "Not acknowledged";
}

export function filterReading<T extends BizKnowledgeReadingItem>(rows: T[], query: string, status: string): T[] {
  const term = query.trim().toLocaleLowerCase();
  return rows.filter(row => (!term || row.title.toLocaleLowerCase().includes(term)) &&
    (status === "all" || (status === "remaining" && !row.acknowledged) || (status === "current" && row.acknowledged)));
}

/** Paragraph navigation preserves every source character; the outline has at most twelve contiguous passages. */
export function readingPassages(body: string): string[] {
  if (!body) return [];
  const paragraphs: string[] = []; let start = 0;
  for (const match of body.matchAll(/\r?\n[ \t]*\r?\n/g)) {
    const end = match.index + match[0].length;
    paragraphs.push(body.slice(start, end)); start = end;
  }
  if (start < body.length) paragraphs.push(body.slice(start));
  const size = Math.max(1, Math.ceil(paragraphs.length / 12));
  const passages: string[] = [];
  for (let i = 0; i < paragraphs.length; i += size) passages.push(paragraphs.slice(i, i + size).join(""));
  return passages;
}

export function readingEstimate(body: string): { words: number; minutes: number } {
  const words = body.match(/\S+/g)?.length ?? 0;
  return { words, minutes: Math.ceil(words / 200) };
}

export function readingDocumentId(value: string | null): string | null {
  return value && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value) ? value.toLowerCase() : null;
}
