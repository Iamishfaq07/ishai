import type { BizAvailabilityWindow, BizScheduling, BizSchedulingReply } from "@orbit/types";
import { api } from "../lib/api";
const e = encodeURIComponent;
const a = (cid: string, aid: string) => `/v1/business/companies/${e(cid)}/applications/${e(aid)}`;
const p = (token: string) => `/v1/public/business/applications/${e(token)}/scheduling-requests`;
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
export const schedulingApi = {
  options: (cid: string, aid: string, windows: BizAvailabilityWindow[], duration: number, interviewId?: string) =>
    api.call<{ slots: string[]; scope: string }>(`${a(cid, aid)}/interview-options`, post({ windows, duration_min: duration, ...(interviewId ? { interview_id: interviewId } : {}) })),
  staff: (cid: string, aid: string) => api.call<BizScheduling>(`${a(cid, aid)}/scheduling-requests`),
  candidate: (token: string) => api.call<BizScheduling>(p(token)),
  create: (token: string, body: { request_id: string; interview_id: string; interview_revision: number; timezone: string; reason: string; windows: BizAvailabilityWindow[] }) =>
    api.call<BizScheduling>(p(token), post(body)),
  withdraw: (token: string, id: string, revision: number, key: string) =>
    api.call<BizScheduling>(`${p(token)}/${e(id)}/withdraw`, post({ base_revision: revision, request_id: key })),
  reply: (cid: string, aid: string, id: string, body: BizSchedulingReply) =>
    api.call<BizScheduling>(`${a(cid, aid)}/scheduling-requests/${e(id)}/reply`, post(body)),
};
export function localDateTime(date: Date): string {
  const part = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}
