import type { BizCandidateExperience, BizExperienceBrief, BizExperienceDashboard, BizExperiencePlan } from "@orbit/types";
import { api } from "../lib/api";
const root = (cid: string) => `/v1/business/companies/${encodeURIComponent(cid)}/experience`;
const job = (cid: string, jid: string) => `${root(cid)}/${encodeURIComponent(jid)}`;
const candidate = (token: string) => `/v1/public/business/applications/${encodeURIComponent(token)}/experience`;
const post = (data: unknown) => ({ method: "POST", body: JSON.stringify(data) });
export const experience = {
  jobs: (cid: string) => api.call<{ items: Array<{ id: string; title: string; status: string }>; truncated: boolean }>(root(cid)),
  dashboard: (cid: string, jid: string) => api.call<BizExperienceDashboard>(job(cid, jid)),
  configure: (cid: string, jid: string, base_revision: number, enabled: boolean, stage_kinds: string[], expiry_days: number) => api.call<BizExperienceDashboard>(`${job(cid, jid)}/settings`, { method: "PUT", body: JSON.stringify({ base_revision, enabled, stage_kinds, expiry_days }) }),
  plan: (cid: string, jid: string, base_revision: number, data: BizExperiencePlan, source_version?: string | null) => api.call<BizExperienceDashboard>(`${job(cid, jid)}/plan`, { method: "PUT", body: JSON.stringify({ base_revision, data, source_version }) }),
  invite: (cid: string, jid: string) => api.call<{ created: number }>(`${job(cid, jid)}/invitations/run`, post({})),
  brief: (cid: string, jid: string, version: string) => api.call<BizExperienceBrief>(`${job(cid, jid)}/brief`, post({ version })),
  own: (token: string) => api.call<BizCandidateExperience>(candidate(token)),
  answer: (token: string, request_id: string, notice_version: string, ratings: Record<string, number>, improvement: string) => api.call<BizCandidateExperience>(candidate(token), post({ request_id, notice_version, acknowledge: true, ...ratings, improvement })),
  withdraw: (token: string) => api.call<BizCandidateExperience>(candidate(token), { method: "DELETE" }),
};
