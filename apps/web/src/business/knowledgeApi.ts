import type { BizKnowledgeAnswer, BizKnowledgeContent, BizKnowledgeDocument, BizKnowledgeLibrary } from "@orbit/types";
import { api } from "../lib/api";
const path = (cid: string) => `/v1/business/companies/${encodeURIComponent(cid)}/knowledge`;
const post = (data: unknown) => ({ method: "POST", body: JSON.stringify(data) });
export const knowledge = {
  list: (cid: string) => api.call<BizKnowledgeLibrary>(path(cid)),
  read: (cid: string, id: string) => api.call<BizKnowledgeDocument>(`${path(cid)}/${encodeURIComponent(id)}`),
  create: (cid: string, request_id: string, data: BizKnowledgeContent, source_version?: string) => api.call<BizKnowledgeDocument>(path(cid), post({ request_id, data, source_version })),
  save: (cid: string, id: string, base_revision: number, data: BizKnowledgeContent) => api.call<BizKnowledgeDocument>(`${path(cid)}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ base_revision, data }) }),
  action: (cid: string, id: string, base_revision: number, action: "publish" | "archive" | "restore" | "delete", note: string) => api.call<BizKnowledgeDocument | { deleted: true }>(`${path(cid)}/${encodeURIComponent(id)}/actions`, post({ base_revision, action, note })),
  version: (cid: string, id: string, revision: number) => api.call<{ revision: number; data: BizKnowledgeContent; actor: string; at: string }>(`${path(cid)}/${encodeURIComponent(id)}/versions/${revision}`),
  ask: (cid: string, question: string, mode: "answer" | "checklist", source_version: string, document_ids: string[]) => api.call<BizKnowledgeAnswer>(`${path(cid)}/ask`, post({ question, mode, source_version, document_ids })),
};
