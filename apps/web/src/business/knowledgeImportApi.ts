import type { BizKnowledgeContent, BizKnowledgeDocument, BizKnowledgeImportPreview, BizKnowledgeImportReview } from "@orbit/types";
import { api } from "../lib/api";
const path = (cid: string) => `/v1/business/companies/${encodeURIComponent(cid)}/knowledge-imports`;
export const knowledgeImport = {
  preview: (cid: string, file: File) => { const body = new FormData(); body.append("file", file); return api.call<BizKnowledgeImportPreview>(`${path(cid)}/preview`, { method: "POST", body }); },
  commit: (cid: string, request_id: string, receipt: string, data: BizKnowledgeContent) => api.call<BizKnowledgeDocument>(`${path(cid)}/commit`, { method: "POST", body: JSON.stringify({ request_id, receipt, data, reviewed_original: true }) }),
  review: (cid: string, receipt: string, data: BizKnowledgeContent) => api.call<BizKnowledgeImportReview>(`${path(cid)}/review`, { method: "POST", body: JSON.stringify({ receipt, data }) }),
};
