import type * as H from "@orbit/types";
import { api } from "../lib/api";
const e = encodeURIComponent;
const c = (cid: string) => `/v1/business/companies/${e(cid)}`;
const post = (body?: unknown): RequestInit => ({ method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const automationApi = {
  settings: (cid: string) => api.call<{ jobs: H.BizAutomationJob[]; interval_seconds: number }>(`${c(cid)}/automations`),
  save: (cid: string, jid: string, recipe: H.BizAutomationRecipe, revision: number) => api.call<H.BizAutomationRecord>(
    `${c(cid)}/jobs/${e(jid)}/automation`, { method: "PUT", body: JSON.stringify({ recipe, base_revision: revision }) }),
  preview: (cid: string, jid: string, recipe: H.BizAutomationRecipe) => {
    const params = new URLSearchParams();
    for (const key of ["stalled_days", "question_hours", "feedback_hours", "assessment_hours", "scheduling_hours", "prep_hours", "offer_hours", "handoff_hours"] as const) {
      const value = recipe[key];
      if (value !== null) params.set(key, String(value));
      else params.set(key, "0");
    }
    return api.call<H.BizAutomationPreview>(`${c(cid)}/jobs/${e(jid)}/automation/preview?${params}`);
  },
  run: (cid: string, jid: string) => api.call<H.BizAutomationRecord>(`${c(cid)}/jobs/${e(jid)}/automation/run`, post()),
  tasks: (cid: string, status: string, mine: boolean, jid: string, after?: string) => {
    const params = new URLSearchParams({ status, mine: String(mine) });
    if (jid) params.set("job_id", jid);
    if (after) params.set("after", after);
    return api.call<H.BizTaskQueue>(`${c(cid)}/hiring-tasks?${params}`);
  },
  update: (cid: string, tid: string, body: H.BizTaskAction) => api.call<H.BizHiringTask>(`${c(cid)}/hiring-tasks/${e(tid)}`, post(body)),
  create: (cid: string, aid: string, body: { title: string; due_at: string; assignee_id: string | null; request_id: string }) =>
    api.call<H.BizHiringTask>(`${c(cid)}/applications/${e(aid)}/hiring-tasks`, post(body)),
};
