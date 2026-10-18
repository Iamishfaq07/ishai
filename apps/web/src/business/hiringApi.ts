import type * as H from "@orbit/types";
import { api, API_URL } from "../lib/api";

const e = encodeURIComponent;
const c = (cid: string) => `/v1/business/companies/${e(cid)}`;
const a = (cid: string, aid: string) => `${c(cid)}/applications/${e(aid)}`;
const p = (token: string) => `/v1/public/business/applications/${e(token)}`;
const put = (body: unknown): RequestInit => ({ method: "PUT", body: JSON.stringify(body) });
const post = (body?: unknown): RequestInit => ({ method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const hiringApi = {
  plan: (cid: string, jid: string) => api.call<H.BizHiringPlanRecord>(`${c(cid)}/jobs/${e(jid)}/hiring-plan`),
  savePlan: (cid: string, jid: string, plan: H.BizHiringPlan, baseRevision: number) =>
    api.call<H.BizHiringPlanRecord>(`${c(cid)}/jobs/${e(jid)}/hiring-plan`, put({ plan, base_revision: baseRevision })),
  room: (cid: string, aid: string) => api.call<H.BizHiringRoom>(`${a(cid, aid)}/hiring-room`),
  feedback: (cid: string, aid: string, content: H.BizFeedbackContent, stageId: string, baseRevision: number, planRevision: number, submit: boolean) =>
    api.call<H.BizHiringRoom>(`${a(cid, aid)}/interview-feedback`, put({ ...content, stage_id: stageId, base_revision: baseRevision, plan_revision: planRevision, submit })),
  assignSample: (cid: string, aid: string) => api.call<H.BizHiringRoom>(`${a(cid, aid)}/work-sample`, post()),
  decision: (cid: string, aid: string, outcome: H.BizHiringDecision["outcome"], rationale: string, evidenceVersion: string, acknowledgeGaps: boolean) =>
    api.call<H.BizHiringRoom>(`${a(cid, aid)}/hiring-decision`, post({ outcome, rationale, base_evidence_version: evidenceVersion, acknowledge_gaps: acknowledgeGaps })),
  compare: (cid: string, jid: string, ids: string[]) => api.call<H.BizHiringCompare>(
    `${c(cid)}/jobs/${e(jid)}/compare?${new URLSearchParams(ids.map((id) => ["ids", id]))}`),
  desk: (cid: string) => api.call<H.BizHiringDesk>(`${c(cid)}/hiring-desk`),
  sample: (token: string) => api.call<H.BizCandidateSample>(`${p(token)}/work-sample`),
  submitSample: (token: string, answer: H.BizSampleSubmission, baseRevision: number, followUp: boolean) =>
    api.call<H.BizCandidateSample>(`${p(token)}/work-sample?follow_up=${followUp}`, post({ ...answer, base_revision: baseRevision })),
  clarify: (token: string, message: string) => api.call<{ status: string; message: string }>(`${p(token)}/clarification`, post({ message })),
  calendar: (token: string) => `${API_URL}${p(token)}/calendar.ics`,
  cancelInterview: (cid: string, aid: string) => api.call<H.BizApplicationDetail>(`${a(cid, aid)}/interview/cancel`, post()),
};
