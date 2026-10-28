import { api } from "../lib/api";
import type { CapacitySnapshot, CapacityWatch } from "./capacityModel";
const root = (cid: string) => `/v1/business/companies/${encodeURIComponent(cid)}/capacity`;
export interface CapacityBrief { version: string; focus: "delivery" | "budget"; source: "mock" | "ai";
  facts: Array<{ id: string; text: string }>; tips: Array<{ fact_id: string; source_quote: string; suggestion: string; success_check: string }> }
export const capacity = {
  list: (cid: string) => api.call<CapacitySnapshot>(root(cid)),
  brief: (cid: string, version: string, focus: "delivery" | "budget") => api.call<CapacityBrief>(`${root(cid)}/brief`, { method: "POST", body: JSON.stringify({ version, focus }) }),
  watch: (cid: string, id: string, watch: Pick<CapacityWatch, "enabled" | "owner_id">, base_revision: number) => api.call(`${root(cid)}/${encodeURIComponent(id)}/watch`, { method: "PUT", body: JSON.stringify({ ...watch, base_revision }) }),
  run: (cid: string) => api.call<{ created: number; unavailable_owner: number }>(`${root(cid)}/alerts/run`, { method: "POST" }),
};
