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
