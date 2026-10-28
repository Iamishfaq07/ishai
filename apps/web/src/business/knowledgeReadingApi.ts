import type { BizKnowledgeCoverage, BizKnowledgeReadingDocument, BizKnowledgeReadingGuide, BizKnowledgeReadingList, BizKnowledgeReaders } from "@orbit/types";
import { api } from "../lib/api";
const path = (cid: string) => `/v1/business/companies/${encodeURIComponent(cid)}/knowledge-reading`;
const documentPath = (cid: string, id: string) => `${path(cid)}/${encodeURIComponent(id)}`;
const post = (data: unknown) => ({ method: "POST", body: JSON.stringify(data) });
export const knowledgeReading = {
  list: (cid: string) => api.call<BizKnowledgeReadingList>(path(cid)),
  read: (cid: string, id: string) => api.call<BizKnowledgeReadingDocument>(documentPath(cid, id)),
  acknowledge: (cid: string, id: string, content_hash: string) => api.call(`${documentPath(cid, id)}/acknowledge`, post({ content_hash, confirmed: true })),
  withdraw: (cid: string, id: string) => api.call(`${documentPath(cid, id)}/acknowledge`, { method: "DELETE" }),
  guide: (cid: string, id: string, content_hash: string) => api.call<BizKnowledgeReadingGuide>(`${documentPath(cid, id)}/guide`, post({ content_hash })),
  coverage: (cid: string) => api.call<BizKnowledgeCoverage>(`${path(cid)}/coverage`),
  readers: (cid: string, id: string, offset = 0) => api.call<BizKnowledgeReaders>(`${documentPath(cid, id)}/readers?offset=${offset}`),
};
