// Orbit for Business (D82): the API calls of the company app, the careers pages and the candidate's status page. Its
// own module, loaded with those pages only, so the candidate app's bundle doesn't carry them (packages/ui `call`).
import type {
  BizAdminCompany,
  BizAdminCompanyDetail,
  BizApplicationDetail,
  BizApplicationList,
  BizApplicationStatus,
  BizApplyPreview,
  BizApplyResult,
  BizAuditEntry,
  BizBulkResult,
  BizCompany,
  BizCompanyAnalytics,
  BizCompanyCreate,
  BizCompanyUpdate,
  BizInviteLookup,
  BizJob,
  BizJobAnalytics,
  BizJobAssist,
  BizJobAssistInput,
  BizJobBrief,
  BizJobDraft,
  BizJobInput,
  BizJobListItem,
  BizJobReport,
  BizMe,
  BizMembers,
  BizMoveRequest,
  BizNotification,
  BizOneClickApply,
  BizPlan,
  BizPlanStatus,
  BizPublicCompany,
  BizPublicJob,
  BizRejectRequest,
  BizRole,
  BizScorecardInput,
  BizSlotsInput,
  BizSource,
  BizTemplate,
  BizTemplateKind,
  BizVerification,
} from "@orbit/types";
import { api } from "../lib/api";

const e = encodeURIComponent;
const body = (v: unknown) => JSON.stringify(v);
const post = (v?: unknown): RequestInit => (v === undefined ? { method: "POST" } : { method: "POST", body: body(v) });
const patch = (v: unknown): RequestInit => ({ method: "PATCH", body: body(v) });
const put = (v: unknown): RequestInit => ({ method: "PUT", body: body(v) });
const del: RequestInit = { method: "DELETE" };
const c = (cid: string) => `/v1/business/companies/${e(cid)}`;

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export interface ApplicationQuery {
  stage?: string;
  q?: string;
  tag?: string;
  sort?: "score" | "applied" | "name";
  reveal?: boolean;
}

export const biz = {
  me: () => api.call<BizMe>("/v1/business/me"),
  createCompany: (input: BizCompanyCreate) => api.call<BizCompany>("/v1/business/companies", post(input)),
  company: (cid: string) => api.call<BizCompany>(c(cid)),
  updateCompany: (cid: string, input: BizCompanyUpdate) => api.call<BizCompany>(c(cid), patch(input)),
  uploadLogo: (cid: string, file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    return api.call<BizCompany>(`${c(cid)}/logo`, { method: "PUT", body: form });
  },
  deleteLogo: (cid: string) => api.call<BizCompany>(`${c(cid)}/logo`, del),

  verification: (cid: string) => api.call<BizVerification>(`${c(cid)}/verification`),
  verifyWithAccount: (cid: string) => api.call<BizVerification>(`${c(cid)}/verification/account`, post()),
  sendVerifyEmail: (cid: string, email: string) => api.call<BizVerification>(`${c(cid)}/verification/email`, post({ email })),
  confirmVerifyEmail: (cid: string, code: string) => api.call<BizVerification>(`${c(cid)}/verification/email/confirm`, post({ code })),
  checkDns: (cid: string) => api.call<BizVerification>(`${c(cid)}/verification/dns`, post()),

  members: (cid: string) => api.call<BizMembers>(`${c(cid)}/members`),
  invite: (cid: string, email: string, role: BizRole) => api.call<BizMembers>(`${c(cid)}/invites`, post({ email, role })),
  cancelInvite: (cid: string, id: string) => api.call<BizMembers>(`${c(cid)}/invites/${e(id)}`, del),
  setRole: (cid: string, mid: string, role: BizRole) => api.call<BizMembers>(`${c(cid)}/members/${e(mid)}`, patch({ role })),
  removeMember: (cid: string, mid: string) => api.call<BizMembers>(`${c(cid)}/members/${e(mid)}`, del),
  transfer: (cid: string, memberId: string) => api.call<BizMembers>(`${c(cid)}/transfer`, post({ member_id: memberId })),
  leave: (cid: string) => api.call<void>(`${c(cid)}/leave`, post()),
  lookupInvite: (token: string) => api.call<BizInviteLookup>(`/v1/public/business/invites/${e(token)}`),
  acceptInvite: (token: string) => api.call<BizCompany>("/v1/business/invites/accept", post({ token })),

  plan: (cid: string) => api.call<BizPlanStatus>(`${c(cid)}/plan`),
  requestPlan: (cid: string, plan: BizPlan) => api.call<BizPlanStatus>(`${c(cid)}/plan/request`, post({ plan })),

  jobs: (cid: string) => api.call<BizJobListItem[]>(`${c(cid)}/jobs`),
  createJob: (cid: string, input: BizJobInput) => api.call<BizJob>(`${c(cid)}/jobs`, post(input)),
  job: (cid: string, jid: string) => api.call<BizJob>(`${c(cid)}/jobs/${e(jid)}`),
  updateJob: (cid: string, jid: string, input: Partial<BizJobInput>) => api.call<BizJob>(`${c(cid)}/jobs/${e(jid)}`, patch(input)),
  jobAction: (cid: string, jid: string, action: "publish" | "pause" | "close" | "reopen") =>
    api.call<BizJob>(`${c(cid)}/jobs/${e(jid)}/${action}`, post()),
  draftJob: (cid: string, brief: BizJobBrief) => api.call<BizJobDraft>(`${c(cid)}/jobs/draft`, { ...post(brief), timeoutMs: 90_000 }),
  /** The job assistant (D85): a fill from a few words, or a refine of the form as it is. Nothing is saved. */
  assistJob: (cid: string, input: BizJobAssistInput) => api.call<BizJobAssist>(`${c(cid)}/jobs/assist`, { ...post(input), timeoutMs: 90_000 }),

  applications: (cid: string, jid: string, q: ApplicationQuery = {}) =>
    api.call<BizApplicationList>(`${c(cid)}/jobs/${e(jid)}/applications${qs({ ...q, reveal: q.reveal || undefined })}`),
  application: (cid: string, aid: string, reveal = false) =>
    api.call<BizApplicationDetail>(`${c(cid)}/applications/${e(aid)}${qs({ reveal: reveal || undefined })}`),
  move: (cid: string, req: BizMoveRequest) => api.call<BizBulkResult>(`${c(cid)}/applications/move`, post(req)),
  reject: (cid: string, req: BizRejectRequest) => api.call<BizBulkResult>(`${c(cid)}/applications/reject`, post(req)),
  unreject: (cid: string, aid: string) => api.call<BizApplicationDetail>(`${c(cid)}/applications/${e(aid)}/unreject`, post()),
  updateApplication: (cid: string, aid: string, input: { tags?: string[]; interviewers?: string[] }) =>
    api.call<BizApplicationDetail>(`${c(cid)}/applications/${e(aid)}`, patch(input)),
  addNote: (cid: string, aid: string, text: string) => api.call<BizApplicationDetail>(`${c(cid)}/applications/${e(aid)}/notes`, post({ body: text })),
  addScorecard: (cid: string, aid: string, input: BizScorecardInput) =>
    api.call<BizApplicationDetail>(`${c(cid)}/applications/${e(aid)}/scorecards`, post(input)),
  sendEmail: (cid: string, aid: string, input: { kind?: BizTemplateKind; subject?: string; body?: string }) =>
    api.call<BizApplicationDetail>(`${c(cid)}/applications/${e(aid)}/email`, post(input)),
  proposeSlots: (cid: string, aid: string, input: BizSlotsInput) =>
    api.call<BizApplicationDetail>(`${c(cid)}/applications/${e(aid)}/interview`, post(input)),
  rerank: (cid: string, aid: string) => api.call<BizApplicationDetail>(`${c(cid)}/applications/${e(aid)}/rerank`, post()),
  deleteApplication: (cid: string, aid: string) => api.call<void>(`${c(cid)}/applications/${e(aid)}`, del),
  exportCsv: async (cid: string, jid: string) => (await api.callRaw(`${c(cid)}/jobs/${e(jid)}/export.csv`)).blob(),

  templates: (cid: string) => api.call<BizTemplate[]>(`${c(cid)}/templates`),
  saveTemplate: (cid: string, kind: BizTemplateKind, subject: string, text: string) =>
    api.call<BizTemplate>(`${c(cid)}/templates/${e(kind)}`, put({ subject, body: text })),
  analytics: (cid: string) => api.call<BizCompanyAnalytics>(`${c(cid)}/analytics`),
  jobAnalytics: (cid: string, jid: string) => api.call<BizJobAnalytics>(`${c(cid)}/jobs/${e(jid)}/analytics`),
  audit: (cid: string, before?: string) => api.call<BizAuditEntry[]>(`${c(cid)}/audit${qs({ before })}`),
  notifications: () => api.call<BizNotification[]>("/v1/business/notifications"),
  readNotifications: (ids: string[]) => api.call<void>("/v1/business/notifications/read", post({ ids })),

  // Applying
  applyPreview: (jobId: string, pick: { resume_id?: string; document_id?: string } = {}) =>
    api.call<BizApplyPreview>(`/v1/business/apply/${e(jobId)}/preview${qs(pick)}`),
  applyOneClick: (jobId: string, input: BizOneClickApply) => api.call<BizApplyResult>(`/v1/business/apply/${e(jobId)}`, post(input)),
  applySignedOut: (jobId: string, form: FormData) =>
    api.call<BizApplyResult>(`/v1/public/business/jobs/${e(jobId)}/apply`, { method: "POST", body: form }),
  reportJob: (jobId: string, input: { reason: BizJobReport["reason"]; details: string; email?: string }) =>
    api.call<void>(`/v1/public/business/jobs/${e(jobId)}/report`, post(input)),

  // Public
  publicCompany: (slug: string) => api.call<BizPublicCompany>(`/v1/public/business/companies/${e(slug)}`),
  publicJob: (slug: string, jobSlug: string) => api.call<BizPublicJob>(`/v1/public/business/companies/${e(slug)}/jobs/${e(jobSlug)}`),
  status: (token: string) => api.call<BizApplicationStatus>(`/v1/public/business/applications/${e(token)}`),
  confirm: (token: string) => api.call<BizApplicationStatus>(`/v1/public/business/applications/${e(token)}/confirm`, post()),
  book: (token: string, slot: string) => api.call<BizApplicationStatus>(`/v1/public/business/applications/${e(token)}/book`, post({ slot })),
  requestDeletion: (token: string) =>
    api.call<BizApplicationStatus>(`/v1/public/business/applications/${e(token)}/delete-request`, post()),

  // Orbit admin
  adminCompanies: (q: { q?: string; status?: string } = {}) => api.call<BizAdminCompany[]>(`/v1/admin/business/companies${qs(q)}`),
  adminAudit: (cid: string) => api.call<BizAuditEntry[]>(`/v1/admin/business/companies/${e(cid)}/audit`),
  adminCompany: (cid: string) => api.call<BizAdminCompanyDetail>(`/v1/admin/business/companies/${e(cid)}`),
  adminSuspend: (cid: string, reason: string) => api.call<BizAdminCompanyDetail>(`/v1/admin/business/companies/${e(cid)}/suspend`, post({ reason })),
  adminUnsuspend: (cid: string) => api.call<BizAdminCompanyDetail>(`/v1/admin/business/companies/${e(cid)}/unsuspend`, post()),
  adminVerify: (cid: string) => api.call<BizAdminCompanyDetail>(`/v1/admin/business/companies/${e(cid)}/verify`, post()),
  adminGrantPlan: (cid: string, plan: BizPlan, days: number) =>
    api.call<BizAdminCompanyDetail>(`/v1/admin/business/companies/${e(cid)}/plan`, post({ plan, days })),
  adminTakeDown: (jid: string, reason: string) => api.call<void>(`/v1/admin/business/jobs/${e(jid)}/take-down`, post({ reason })),
  adminRestore: (jid: string) => api.call<void>(`/v1/admin/business/jobs/${e(jid)}/restore`, post()),
  adminReports: (status?: string) => api.call<BizJobReport[]>(`/v1/admin/business/reports${qs({ status })}`),
  adminReport: (id: string, status: BizJobReport["status"]) => api.call<BizJobReport>(`/v1/admin/business/reports/${e(id)}`, post({ status })),
};

export type { BizSource };
