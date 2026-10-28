import type { BizRequisition, BizRequisitionAction, BizRequisitionIntake, BizRequisitionList, BizRequisitionReview, BizRequisitionReviewFocus, BizRequisitionState } from "@orbit/types";
import { api } from "../lib/api";
const path = (cid: string) => `/v1/business/companies/${encodeURIComponent(cid)}/requisitions`;
const post = (data: unknown) => ({ method: "POST", body: JSON.stringify(data) });
export const requisitions = {
  list: (cid: string, state: BizRequisitionState | "all", q: string, after?: string) => {
    const params = new URLSearchParams({ state, q }); if (after) params.set("after", after);
    return api.call<BizRequisitionList>(`${path(cid)}?${params}`);
  },
  read: (cid: string, id: string) => api.call<BizRequisition>(`${path(cid)}/${encodeURIComponent(id)}`),
  create: (cid: string, request_id: string, data: BizRequisitionIntake) => api.call<BizRequisition>(path(cid), post({ request_id, data })),
  save: (cid: string, id: string, base_revision: number, data: BizRequisitionIntake) => api.call<BizRequisition>(`${path(cid)}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ base_revision, data }) }),
  action: (cid: string, id: string, base_revision: number, action: BizRequisitionAction, note: string, approver_ids: string[] = []) => api.call<BizRequisition>(`${path(cid)}/${encodeURIComponent(id)}/actions`, post({ base_revision, action, note, approver_ids })),
  review: (cid: string, id: string, base_revision: number, focus: BizRequisitionReviewFocus) => api.call<BizRequisitionReview>(`${path(cid)}/${encodeURIComponent(id)}/review`, post({ base_revision, focus })),
};
