import type { EvidenceItem } from "@orbit/types";

/** Where a claim comes from, in words. */
export function sourceLabel(item: Pick<EvidenceItem, "source_kind" | "source_title" | "source_id">): string {
  if (item.source_kind === "manual") return "In your own words";
  const what = item.source_kind === "story" ? "Story" : "Resume";
  const title = item.source_title || (item.source_kind === "story" ? "a story" : "your resume");
  return item.source_id ? `${what}: ${title}` : `${what}: ${title} (since deleted)`;
}

/** What a suggestion run says back: how many to check, and how many the AI proposed but couldn't back with a quote. */
export function suggestNote(added: number, dropped: number): string {
  const head = added
    ? `${added} new claim${added === 1 ? "" : "s"} to check below.`
    : "No new claims: everything found is already in your vault, or couldn't be backed up.";
  return dropped ? `${head} ${dropped} left out because the source doesn't say ${dropped === 1 ? "it" : "them"} word for word, or ${dropped === 1 ? "it's" : "they're"} already here.` : head;
}
