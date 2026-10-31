import type { BizTalentMember, BizTalentOwn, BizTalentPool, BizTalentSearch, BizTalentSuggestion } from "@orbit/types";
import { api } from "../lib/api";
const root = (cid: string) => `/v1/business/companies/${encodeURIComponent(cid)}/talent`;
const pool = (cid: string, pid: string) => `${root(cid)}/${encodeURIComponent(pid)}`;
const member = (cid: string, pid: string, mid: string) => `${pool(cid, pid)}/members/${encodeURIComponent(mid)}/suggestions`;
const own = (token: string) => `/v1/public/business/applications/${encodeURIComponent(token)}/talent`;
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
export type TalentPoolDraft = Pick<BizTalentPool, "name" | "purpose" | "retention_days" | "enabled">;
export type TalentSearchDraft = Pick<BizTalentSearch, "name" | "query" | "terms_revision">;
const searches = (cid: string, pid: string) => `${pool(cid, pid)}/searches`;
export const talentSearches = {
  list: (cid: string, pid: string) => api.call<{ items: BizTalentSearch[] }>(searches(cid, pid)),
  create: (cid: string, pid: string, request_id: string, data: TalentSearchDraft) => api.call<BizTalentSearch>(searches(cid, pid), json("POST", { ...data, request_id, base_revision: 0 })),
  save: (cid: string, pid: string, search: BizTalentSearch, data: TalentSearchDraft) => api.call<BizTalentSearch>(`${searches(cid, pid)}/${encodeURIComponent(search.id)}`, json("PUT", { ...data, base_revision: search.revision })),
  remove: (cid: string, pid: string, search: BizTalentSearch) => api.call<void>(`${searches(cid, pid)}/${encodeURIComponent(search.id)}?${new URLSearchParams({ base_revision: String(search.revision) })}`, { method: "DELETE" }),
  run: (cid: string, pid: string, search: BizTalentSearch, after = "") => api.call<{ items: BizTalentMember[]; next_cursor: string | null; search: BizTalentSearch }>(`${searches(cid, pid)}/${encodeURIComponent(search.id)}/members?${new URLSearchParams({ base_revision: String(search.revision), after })}`),
};
export const talent = {
  pools: (cid: string) => api.call<{ items: BizTalentPool[] }>(root(cid)),
  create: (cid: string, data: TalentPoolDraft) => api.call<BizTalentPool>(root(cid), json("POST", { ...data, base_revision: 0 })),
  save: (cid: string, pid: string, base_revision: number, data: TalentPoolDraft) => api.call<BizTalentPool>(pool(cid, pid), json("PUT", { ...data, base_revision })),
  remove: (cid: string, pid: string) => api.call<void>(pool(cid, pid), { method: "DELETE" }),
  members: (cid: string, pid: string, q = "", after = "") => api.call<{ items: BizTalentMember[]; next_cursor: string | null }>(`${pool(cid, pid)}/members?${new URLSearchParams({ q, after })}`),
  suggestions: (cid: string, pid: string, mid: string) => api.call<{ items: BizTalentSuggestion[] }>(member(cid, pid, mid)),
  suggest: (cid: string, pid: string, mid: string, job_id: string) => api.call<{ id: string; job_id: string }>(member(cid, pid, mid), json("POST", { job_id })),
  unsuggest: (cid: string, pid: string, mid: string, sid: string) => api.call<void>(`${member(cid, pid, mid)}/${encodeURIComponent(sid)}`, { method: "DELETE" }),
  own: (token: string) => api.call<BizTalentOwn>(own(token)),
  join: (token: string, pid: string, data: { request_id: string; terms_revision: number; notice_version: string; acknowledge: boolean; skills: string[]; interests: string }) => api.call<BizTalentOwn>(`${own(token)}/${encodeURIComponent(pid)}`, json("PUT", data)),
  dismiss: (token: string, pid: string, jid: string) => api.call<BizTalentOwn>(`${own(token)}/${encodeURIComponent(pid)}/suggestions/${encodeURIComponent(jid)}`, { method: "DELETE" }),
  leave: (token: string, pid: string) => api.call<BizTalentOwn>(`${own(token)}/${encodeURIComponent(pid)}`, { method: "DELETE" }),
};
