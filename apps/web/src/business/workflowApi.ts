import type { BizWorkflowBrief, BizWorkflowDraft, BizWorkflowPlan, BizWorkflowRun, BizWorkflowWorkspace } from "@orbit/types";
import { api } from "../lib/api";
const root = (cid: string) => `/v1/business/companies/${encodeURIComponent(cid)}/workflow-studio`;
const job = (cid: string, jid: string) => `${root(cid)}/${encodeURIComponent(jid)}`;
const run = (cid: string, jid: string, rid: string) => `${job(cid, jid)}/runs/${encodeURIComponent(rid)}`;
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
export const workflows = {
  index: (cid: string) => api.call<{ jobs: Array<{ id: string; title: string; status: string }>; truncated: boolean; templates: Array<{ id: string; plan: BizWorkflowPlan }> }>(root(cid)),
  workspace: (cid: string, jid: string) => api.call<BizWorkflowWorkspace>(job(cid, jid)),
  save: (cid: string, jid: string, base_revision: number, source_version: string, plan: BizWorkflowPlan) => api.call<BizWorkflowWorkspace>(`${job(cid, jid)}/plan`, json("PUT", { base_revision, source_version, plan })),
  draft: (cid: string, jid: string, version: string) => api.call<BizWorkflowDraft>(`${job(cid, jid)}/draft`, { ...json("POST", { version }), timeoutMs: 90000 }),
  start: (cid: string, jid: string, request_id: string, base_revision: number, start_date: string, default_owner_id: string | null) => api.call<BizWorkflowRun>(`${job(cid, jid)}/runs`, json("POST", { request_id, base_revision, start_date, default_owner_id })),
  run: (cid: string, jid: string, rid: string) => api.call<BizWorkflowRun>(run(cid, jid, rid)),
  action: (cid: string, jid: string, rid: string, sid: string, base_revision: number, action: "done" | "reopen" | "assign", note: string, owner_id: string | null = null) => api.call<BizWorkflowRun>(`${run(cid, jid, rid)}/steps/${encodeURIComponent(sid)}`, json("POST", { base_revision, action, note, owner_id })),
  cancel: (cid: string, jid: string, rid: string, base_revision: number) => api.call<BizWorkflowRun>(`${run(cid, jid, rid)}/cancel`, json("POST", { base_revision })),
  remove: (cid: string, jid: string, rid: string) => api.call<void>(run(cid, jid, rid), { method: "DELETE" }),
  brief: (cid: string, jid: string, rid: string, version: string) => api.call<BizWorkflowBrief>(`${run(cid, jid, rid)}/brief`, { ...json("POST", { version }), timeoutMs: 90000 }),
};
