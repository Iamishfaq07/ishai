import type { BizKnowledgeAnswer, BizKnowledgeContent, BizKnowledgeSummary } from "@orbit/types";
export const EMPTY_KNOWLEDGE: BizKnowledgeContent = { title: "", body: "", category: "policy", audience: "all_hiring", review_due: "" };
export const KNOWLEDGE_CATEGORIES = { policy: "Hiring policy", interview: "Interview playbook", onboarding: "Joining guide", operations: "Operations procedure" } as const;
export const KNOWLEDGE_AUDIENCES = { all_hiring: "All company hiring members", coordinators: "Owners, admins and recruiters" } as const;
export const changedKnowledge = (a: BizKnowledgeContent, b: BizKnowledgeContent) => JSON.stringify(a) !== JSON.stringify(b);
export function filterKnowledge(rows: BizKnowledgeSummary[], query: string, status: string) {
  const term = query.trim().toLowerCase();
  return rows.filter(r => (!term || `${r.title} ${KNOWLEDGE_CATEGORIES[r.category]}`.toLowerCase().includes(term)) &&
    (status === "all" || status === "published" && !r.archived && r.published_revision !== null || status === "drafts" && !r.archived && r.has_draft_changes || status === "review" && !r.archived && r.review_overdue || status === "archived" && r.archived));
}
export const questionKey = (question: string, mode: string, version: string, ids: string[]) => JSON.stringify([question.trim(), mode, version, [...ids].sort()]);

/** Portable working notes retain the original question, exact quotes and source versions. */
export function knowledgeAnswerText(question: string, answer: BizKnowledgeAnswer): string {
  return ["AI-generated working notes — verify the cited guidance before use.", `Question: ${question.trim()}`,
    `Format: ${answer.mode}`, `Source snapshot: ${answer.source_version}`, answer.needs_update ? "Attention: a cited document has been flagged for updates." : "", answer.review_overdue ? "Attention: a cited document is past its review date." : "", "",
    ...answer.points.flatMap((point, i) => {
      const source = answer.sources.find(s => s.id === point.passage_id);
      return [`${i + 1}. ${point.text}`, `Source: ${source?.title ?? "Reference"} · version ${source?.revision ?? "unknown"}`,
        `Reference ID: ${source?.document_id ?? "unknown"}`, `Quote: ${point.quote}`, ""];
    })].join("\n");
}

export const KNOWLEDGE_ACTION_LABELS: Record<string, string> = {
  publish: "Published", archive: "Archived", restore: "Restored as draft", review_confirm: "Review confirmed",
  review_owner: "Review owner updated", needs_update: "Updates requested",
};
