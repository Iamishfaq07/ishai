import type {
  AdminActivityItem,
  AtsReport,
  AccessChange,
  AdminConfig,
  AdminConfigUpdate,
  AdminPayment,
  AdminPayments,
  AdminUser,
  AdminUsers,
  ApiErrorBody,
  AuthConfig,
  CostReport,
  CoverLetterLength,
  CoverLetterTone,
  CreditPack,
  LinkedInProfile,
  NaukriProfile,
  OutreachInputs,
  OutreachKind,
  OutreachMessage,
  Entitlements,
  PlanInfo,
  AuthResponse,
  AnswerFeedbackReason,
  AnswerRating,
  FeedbackReport,
  CompanionShare,
  CompanionView,
  CreateSessionRequest,
  CreateTextDocumentRequest,
  DocumentKind,
  DocumentText,
  ImportedJobPosting,
  JobDetail,
  JobFeed,
  JobFeedQuery,
  JobFitResponse,
  JobPrefs,
  JobPrepareResponse,
  JobProfile,
  JobStats,
  JobStatus,
  JobTailorResponse,
  JobTrackerEntry,
  JobTrackerUpdate,
  LatencyReport,
  LiveTicket,
  LoginRequest,
  OrbitDocument,
  OrbitSession,
  PreflightReport,
  PrepRequest,
  Progress,
  FollowUp,
  PrepResponse,
  PrivacyUpdate,
  RegisterPending,
  Resume,
  ResumeAiAllowance,
  ResumeData,
  ResumeDesign,
  ResumeImportRequest,
  ResumeImportResponse,
  ResumeInput,
  ResumeFixRequest,
  ResumeFixResponse,
  ResumeQuestionsResponse,
  ResumeSkillGapResponse,
  ResumeSuggestRequest,
  ResumeSuggestion,
  ResumeSummary,
  RegisterRequest,
  ScreenshotAccepted,
  Story,
  StoryDraftRequest,
  StoryDraftResponse,
  StoryInput,
  SessionDetail,
  SessionSummary,
  UpdateDocumentRequest,
  UpiOrder,
  Usage,
  User,
  Workspace,
  WorkspaceInput,
} from "@orbit/types";
import { trimTrailingSlashes } from "../serverUrl";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = "http_error",
    /** Extra fields of a structured error (e.g. `session_id` for "live_session_active"). */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True when the server doesn't implement the endpoint yet (lets UI say so honestly). */
  get isNotImplemented(): boolean {
    return this.status === 404 || this.status === 405 || this.status === 501;
  }
}

export type ApiAuth =
  /** Browser: httpOnly session cookie set by the API. */
  | { mode: "cookie" }
  /** Desktop: bearer token held in the OS keychain, cached in memory. */
  | { mode: "bearer"; getToken: () => string | null };

export interface ApiClientOptions {
  baseUrl: string;
  auth: ApiAuth;
  /** Invoked on any 401 so the app can route to sign-in. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** How long a request may take before it gives up: a stalled phone connection otherwise leaves the screen waiting for
 * ever. Calls that run the AI or move big files say so with LONG_TIMEOUT_MS. */
export const DEFAULT_TIMEOUT_MS = 30_000;
export const LONG_TIMEOUT_MS = 150_000;

// Endpoints that run the AI, read a file or build one: slow on purpose, so they get LONG_TIMEOUT_MS. Matching by path
// means a new AI endpoint can't be cut off by forgetting to opt in; an explicit `timeoutMs` still wins.
const SLOW_PATH =
  /\/(?:import|import-file|suggest|cover-letter|docx|review|follow-up|draft|prep|import-link|drill|retry|screenshots|export|export\.md|text)(?:[/?]|$)/;

export function timeoutFor(path: string, body?: unknown): number {
  return body instanceof FormData || SLOW_PATH.test(path) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

export interface RequestOptions {
  /** Cancels the request (a newer one replaces it, or the user pressed Cancel). */
  signal?: AbortSignal;
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = trimTrailingSlashes(options.baseUrl);
  const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  // Cookie mode: the API's CSRF token for this session, taken from the latest auth response (/me, login,
  // register, password reset) and sent back on every state-changing request. See apps/api/orbit_api/csrf.py.
  let csrfToken: string | null = null;
  const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

  async function raw(path: string, request: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    const { timeoutMs = timeoutFor(path, request.body), signal: caller, ...init } = request;
    const headers = new Headers(init.headers);
    if (options.auth.mode === "bearer") {
      const token = options.auth.getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    } else if (csrfToken && UNSAFE.has((init.method ?? "GET").toUpperCase())) {
      headers.set("X-CSRF-Token", csrfToken);
    }
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    // One controller for both ways out: the caller cancelling, and the time limit.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const cancel = () => controller.abort();
    if (caller?.aborted) controller.abort();
    else caller?.addEventListener("abort", cancel, { once: true });
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
        credentials: options.auth.mode === "cookie" ? "include" : "omit",
      });
    } catch {
      if (caller?.aborted) throw new DOMException("The request was cancelled.", "AbortError");
      if (timedOut) throw new ApiError(0, "That took too long. Check your connection and try again.", "timeout");
      throw new ApiError(0, "Can't reach Orbit. Check your internet connection.", "offline");
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", cancel);
    }
    if (!response.ok) {
      if (response.status === 401) options.onUnauthorized?.();
      throw await toApiError(response);
    }
    return response;
  }

  async function json<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
    const response = await raw(path, init);
    if (response.status === 204) return undefined as T;
    const data = (await response.json()) as T;
    rememberCsrf(data);
    return data;
  }

  function rememberCsrf(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const d = data as { csrf_token?: unknown; user?: { csrf_token?: unknown } };
    const token = typeof d.csrf_token === "string" ? d.csrf_token : d.user?.csrf_token;
    if (typeof token === "string" && token) csrfToken = token;
  }

  const body = (value: unknown): string => JSON.stringify(value);

  /** The resume tools that don't touch saved resumes (score, AI, Word). */
  const resumeTools = (base: string) => ({
    scoreResume: (data: ResumeData, design: ResumeDesign, jobText: string, opts: RequestOptions = {}) =>
      json<AtsReport>(`${base}/score`, {
        method: "POST",
        body: body({ data, design, job_text: jobText }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      }),
    importResume: (req: ResumeImportRequest, opts: RequestOptions = {}) =>
      json<ResumeImportResponse>(`${base}/import`, {
        method: "POST",
        body: body(req),
        timeoutMs: LONG_TIMEOUT_MS,
        ...(opts.signal ? { signal: opts.signal } : {}),
      }),
    importResumeFile: (file: File | Blob, filename?: string, opts: RequestOptions = {}) => {
      const form = new FormData();
      if (filename) form.append("file", file, filename);
      else form.append("file", file);
      return json<ResumeImportResponse>(`${base}/import-file`, {
        method: "POST",
        body: form,
        timeoutMs: LONG_TIMEOUT_MS,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    },
    /** A cover letter from the resume and (if given) the job post; nothing it says goes beyond them. */
    coverLetter: (data: ResumeData, jobText: string, opts: { tone?: CoverLetterTone; length?: CoverLetterLength } = {}) =>
      json<{ text: string }>(`${base}/cover-letter`, { method: "POST", body: body({ data, job_text: jobText, ...opts }) }),
    /** Naukri's resume headline, profile summary and key skills, from the resume (one resume credit). */
    naukriProfile: (data: ResumeData, jobText: string) =>
      json<NaukriProfile>(`${base}/naukri-profile`, { method: "POST", body: body({ data, job_text: jobText }), timeoutMs: LONG_TIMEOUT_MS }),
    /** LinkedIn's headline, About and top skills, from the resume (one resume credit). */
    linkedinProfile: (data: ResumeData, jobText: string) =>
      json<LinkedInProfile>(`${base}/linkedin-profile`, { method: "POST", body: body({ data, job_text: jobText }), timeoutMs: LONG_TIMEOUT_MS }),
    /**
     * A referral request, cold email, follow-up or thank-you note, from the resume (one resume credit). With
     * `listingId`, for that job in Jobs AI: the server reads its posting (in place of `jobText`) and fills in a blank
     * company and role from it.
     */
    outreach: (data: ResumeData, jobText: string, kind: OutreachKind, inputs: OutreachInputs = {}, listingId: string | null = null) =>
      json<OutreachMessage>(`${base}/outreach`, {
        method: "POST",
        body: body({ data, job_text: jobText, kind, ...inputs, ...(listingId ? { listing_id: listingId } : {}) }),
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    /** The cover letter as a Word file, with the resume's name and contact line on top. */
    coverLetterDocx: async (text: string, data: ResumeData, design: ResumeDesign) =>
      (await raw(`${base}/cover-letter/docx`, { method: "POST", body: body({ text, data, design }) })).blob(),
    /** The resume as a Word file (.docx): one plain column, built from what the editor shows now. */
    resumeDocx: async (data: ResumeData, design: ResumeDesign) =>
      (await raw(`${base}/docx`, { method: "POST", body: body({ data, design }) })).blob(),
    /** `upgrade_required`: the free AI use is spent, so these are only the fixes that need no AI. */
    suggestResume: (req: ResumeSuggestRequest) =>
      json<{ suggestions: ResumeSuggestion[]; upgrade_required?: boolean }>(`${base}/suggest`, {
        method: "POST",
        body: body(req),
      }),
    /** "Fix with AI" from the ATS score: fixed, applied and re-checked on the server; at most one resume credit. */
    fixResume: (req: ResumeFixRequest) =>
      json<ResumeFixResponse>(`${base}/fix`, { method: "POST", body: body(req), timeoutMs: LONG_TIMEOUT_MS }),
    /** Unlimited AI on this plan, or how many resume credits are left (and the cheapest pack that adds more). */
    resumeAllowance: () => json<ResumeAiAllowance>(`${base}/allowance`),
    /** The questions an interviewer will ask about this resume, with answer outlines from it; one resume credit. */
    resumeQuestions: (data: ResumeData, jobText: string) =>
      json<ResumeQuestionsResponse>(`${base}/prep/questions`, {
        method: "POST",
        body: body({ data, job_text: jobText }),
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    /** What the job post asks for that the resume doesn't show, and what to do about each; one resume credit. */
    resumeSkillGap: (data: ResumeData, jobText: string) =>
      json<ResumeSkillGapResponse>(`${base}/prep/skill-gap`, {
        method: "POST",
        body: body({ data, job_text: jobText }),
        timeoutMs: LONG_TIMEOUT_MS,
      }),
  });

  return {
    baseUrl,

    // Auth
    authConfig: () => json<AuthConfig>("/v1/auth/config"),
    register: (req: RegisterRequest) =>
      json<AuthResponse | RegisterPending>("/v1/auth/register", { method: "POST", body: body(req) }),
    login: (req: LoginRequest) => json<AuthResponse>("/v1/auth/login", { method: "POST", body: body(req) }),
    me: () => json<User>("/v1/auth/me"),
    logout: async () => {
      await json<void>("/v1/auth/logout", { method: "POST" });
      csrfToken = null;
    },
    updatePrivacy: (req: PrivacyUpdate) => json<User>("/v1/auth/me/privacy", { method: "PATCH", body: body(req) }),
    /** Asks for the password again: a session left open somewhere can't delete the account. */
    deleteAccount: (password: string) => json<void>("/v1/auth/me", { method: "DELETE", body: body({ password }) }),
    /** A new password; every other device (and any live session) is signed out, this one stays signed in. */
    changePassword: (currentPassword: string, newPassword: string) =>
      json<AuthResponse>("/v1/auth/me/password", {
        method: "POST",
        body: body({ current_password: currentPassword, new_password: newPassword }),
      }),
    logoutAll: () => json<void>("/v1/auth/logout-all", { method: "POST" }),
    requestEmailChange: (newEmail: string, password: string) =>
      json<{ status: string }>("/v1/auth/me/email", {
        method: "POST",
        body: body({ new_email: newEmail, password }),
      }),
    /** Changes the email; it signs nobody in (sign in with the new address and your password). */
    confirmEmailChange: (token: string) =>
      json<{ email: string }>("/v1/auth/email-change/confirm", { method: "POST", body: body({ token }) }),
    /** Everything Orbit stores about the account, as a JSON file (Blob). */
    exportData: async () => (await raw("/v1/auth/me/export")).blob(),
    requestVerification: () => json<{ status: string }>("/v1/auth/verify-email/request", { method: "POST" }),
    confirmVerification: (token: string) =>
      json<User>("/v1/auth/verify-email/confirm", { method: "POST", body: body({ token }) }),
    requestPasswordReset: (email: string, captchaToken?: string) =>
      json<{ status: string }>("/v1/auth/password-reset/request", {
        method: "POST",
        body: body(captchaToken ? { email, captcha_token: captchaToken } : { email }),
      }),
    confirmPasswordReset: (token: string, password: string) =>
      json<AuthResponse>("/v1/auth/password-reset/confirm", { method: "POST", body: body({ token, password }) }),

    // Documents
    listDocuments: () => json<OrbitDocument[]>("/v1/documents"),
    uploadDocument: (file: File | Blob, kind: DocumentKind, filename?: string) => {
      const form = new FormData();
      if (filename) form.append("file", file, filename);
      else form.append("file", file);
      form.append("kind", kind);
      return json<OrbitDocument>("/v1/documents", { method: "POST", body: form });
    },
    createTextDocument: (req: CreateTextDocumentRequest) =>
      json<OrbitDocument>("/v1/documents/text", { method: "POST", body: body(req) }),
    getDocumentText: (id: string) =>
      json<DocumentText>(`/v1/documents/${encodeURIComponent(id)}/text`),
    updateDocument: (id: string, req: UpdateDocumentRequest) =>
      json<OrbitDocument>(`/v1/documents/${encodeURIComponent(id)}`, { method: "PATCH", body: body(req) }),
    deleteDocument: (id: string) => json<void>(`/v1/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),

    // Sessions
    createSession: (req: CreateSessionRequest) => json<OrbitSession>("/v1/sessions", { method: "POST", body: body(req) }),
    listSessions: () => json<OrbitSession[]>("/v1/sessions"),
    getSession: (id: string) => json<SessionDetail>(`/v1/sessions/${encodeURIComponent(id)}`),
    endSession: (id: string) => json<OrbitSession>(`/v1/sessions/${encodeURIComponent(id)}/end`, { method: "POST" }),
    /** (Re)generate the report + review scorecard for an ended session. */
    reviewSession: (id: string) =>
      json<SessionSummary>(`/v1/sessions/${encodeURIComponent(id)}/review`, { method: "POST" }),
    deleteSession: (id: string) => json<void>(`/v1/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    deleteTranscript: (id: string) =>
      json<void>(`/v1/sessions/${encodeURIComponent(id)}/transcript`, { method: "DELETE" }),
    /** Debrief + thank-you email for an ended session (cached server-side; `refresh` regenerates). */
    followUp: (id: string, refresh = false) =>
      json<FollowUp>(`/v1/sessions/${encodeURIComponent(id)}/follow-up${refresh ? "?refresh=true" : ""}`, {
        method: "POST",
      }),
    // Story bank
    listStories: () => json<Story[]>("/v1/stories"),
    createStory: (req: StoryInput) => json<Story>("/v1/stories", { method: "POST", body: body(req) }),
    updateStory: (id: string, req: StoryInput) =>
      json<Story>(`/v1/stories/${encodeURIComponent(id)}`, { method: "PUT", body: body(req) }),
    deleteStory: (id: string) => json<void>(`/v1/stories/${encodeURIComponent(id)}`, { method: "DELETE" }),
    draftStories: (req: StoryDraftRequest) =>
      json<StoryDraftResponse>("/v1/stories/draft", { method: "POST", body: body(req) }),
    /** Scores and speaking stats across ended sessions. */
    progress: () => json<Progress>("/v1/progress"),
    // Resume maker
    listResumes: () => json<ResumeSummary[]>("/v1/resumes"),
    getResume: (id: string) => json<Resume>(`/v1/resumes/${encodeURIComponent(id)}`),
    createResume: (req: ResumeInput) => json<Resume>("/v1/resumes", { method: "POST", body: body(req) }),
    updateResume: (id: string, req: ResumeInput) =>
      json<Resume>(`/v1/resumes/${encodeURIComponent(id)}`, { method: "PUT", body: body(req) }),
    deleteResume: (id: string) => json<void>(`/v1/resumes/${encodeURIComponent(id)}`, { method: "DELETE" }),
    ...resumeTools("/v1/resumes"),

    // Jobs: the latest jobs that match the resume, the profile behind the feed, the tracker
    jobProfile: () => json<JobProfile>("/v1/jobs/profile"),
    saveJobProfile: (prefs: JobPrefs, resumeId?: string | null) =>
      json<JobProfile>("/v1/jobs/profile", { method: "PUT", body: body({ prefs, resume_id: resumeId ?? null }) }),
    /** Fill the profile from a resume (AI, free, a few a day; else worked out from the resume as written). */
    suggestJobProfile: (resumeId?: string | null) =>
      json<JobProfile>("/v1/jobs/profile/suggest", { method: "POST", body: body({ resume_id: resumeId ?? null }) }),
    /** Ranked from the cache; never waits for the job boards (`refreshing` says new posts are on their way). */
    jobFeed: (query: JobFeedQuery = {}, opts: RequestOptions = {}) => {
      const q = new URLSearchParams();
      if (query.q?.trim()) q.set("q", query.q.trim());
      if (query.sort) q.set("sort", query.sort);
      if (query.page) q.set("page", String(query.page));
      if (query.page_size) q.set("page_size", String(query.page_size));
      const qs = q.toString();
      return json<JobFeed>(`/v1/jobs/feed${qs ? `?${qs}` : ""}`, opts.signal ? { signal: opts.signal } : {});
    },
    jobListing: (id: string) => json<JobDetail>(`/v1/jobs/listings/${encodeURIComponent(id)}`),
    /** How well the resume fits this job, by the AI: free, a daily allowance, cached per job and resume. */
    jobFitCheck: (id: string) =>
      json<JobFitResponse>(`/v1/jobs/listings/${encodeURIComponent(id)}/fit`, {
        method: "POST",
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    /** A copy of the resume aimed at this job (may read the full post from its page first). */
    tailorForJob: (id: string, resumeId?: string | null) =>
      json<JobTailorResponse>(`/v1/jobs/listings/${encodeURIComponent(id)}/tailor`, {
        method: "POST",
        body: body({ resume_id: resumeId ?? null }),
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    /** The job description saved to Documents for Practice's prep and mock interview (once per job). */
    prepareForJob: (id: string) =>
      json<JobPrepareResponse>(`/v1/jobs/listings/${encodeURIComponent(id)}/prepare`, {
        method: "POST",
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    jobTracker: () => json<JobTrackerEntry[]>("/v1/jobs/tracker"),
    /** Jobs AI's public page: fresh jobs and companies, and the free daily allowances (no session needed). */
    jobStats: () => json<JobStats>("/v1/jobs/stats"),
    /** Save a job from the feed, or mark it applied (an entry already there moves to `status`). */
    trackJob: (listingId: string, status: JobStatus = "saved") =>
      json<JobTrackerEntry>("/v1/jobs/tracker", { method: "POST", body: body({ listing_id: listingId, status }) }),
    updateTrackedJob: (id: string, patch: JobTrackerUpdate) =>
      json<JobTrackerEntry>(`/v1/jobs/tracker/${encodeURIComponent(id)}`, { method: "PATCH", body: body(patch) }),
    untrackJob: (id: string) => json<void>(`/v1/jobs/tracker/${encodeURIComponent(id)}`, { method: "DELETE" }),

    /** Interview prep: likely questions from a job description, with answers drawn from the resume. */
    prep: (req: PrepRequest) => json<PrepResponse>("/v1/prep", { method: "POST", body: body(req) }),
    /** Read a job posting from a link (server-side, SSRF-safe); returns the text to check and edit. */
    importJobLink: (url: string) =>
      json<ImportedJobPosting>("/v1/prep/import-link", { method: "POST", body: body({ url }) }),
    /** Re-drill: a new mock session asking this session's weak questions again (from its review). */
    drillSession: (id: string) =>
      json<OrbitSession>(`/v1/sessions/${encodeURIComponent(id)}/drill`, { method: "POST" }),
    retryReport: (id: string) =>
      json<OrbitSession>(`/v1/sessions/${encodeURIComponent(id)}/report/retry`, { method: "POST" }),
    exportSessionMarkdown: async (id: string): Promise<string> =>
      (await raw(`/v1/sessions/${encodeURIComponent(id)}/export.md`)).text(),
    liveTicket: (id: string) =>
      json<LiveTicket>(`/v1/sessions/${encodeURIComponent(id)}/live-ticket`, { method: "POST" }),
    /** 👍/👎 an answer (null clears it); a reason explains a 👎. */
    rateAnswer: (sessionId: string, answerId: string, rating: AnswerRating | null, reason?: AnswerFeedbackReason | null) =>
      json<{ answer_id: string; rating: AnswerRating | null; reason: AnswerFeedbackReason | null }>(
        `/v1/sessions/${encodeURIComponent(sessionId)}/answers/${encodeURIComponent(answerId)}/feedback`,
        { method: "PUT", body: body({ rating, reason: reason ?? null }) },
      ),
    /** Phone companion: a code for the QR (stable while valid); `stopCompanion` revokes it and disconnects phones. */
    startCompanion: (id: string) =>
      json<CompanionShare>(`/v1/sessions/${encodeURIComponent(id)}/companion`, { method: "POST" }),
    stopCompanion: (id: string) =>
      json<void>(`/v1/sessions/${encodeURIComponent(id)}/companion`, { method: "DELETE" }),
    /**
     * On the phone (no login): trade the scanned code for a single-use view ticket. The code is the credential, so it
     * goes in the body: a URL path ends up in server and proxy access logs.
     */
    redeemCompanion: (code: string) =>
      json<CompanionView>("/v1/companion/redeem", { method: "POST", body: body({ code }) }),
    uploadScreenshot: (id: string, image: Blob) => {
      const form = new FormData();
      form.append("image", image, "screenshot.png");
      return json<ScreenshotAccepted>(`/v1/sessions/${encodeURIComponent(id)}/screenshots`, {
        method: "POST",
        body: form,
      });
    },

    // Usage
    usage: () => json<Usage>("/v1/usage"),

    // Saved interview setups
    listWorkspaces: () => json<Workspace[]>("/v1/workspaces"),
    createWorkspace: (req: WorkspaceInput) => json<Workspace>("/v1/workspaces", { method: "POST", body: body(req) }),
    updateWorkspace: (id: string, req: WorkspaceInput) =>
      json<Workspace>(`/v1/workspaces/${encodeURIComponent(id)}`, { method: "PUT", body: body(req) }),
    deleteWorkspace: (id: string) => json<void>(`/v1/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" }),

    // Pre-session checklist
    preflight: (opts: { appVersion?: string; refresh?: boolean } = {}) => {
      const q = new URLSearchParams();
      if (opts.appVersion) q.set("app_version", opts.appVersion);
      if (opts.refresh) q.set("refresh", "true");
      const qs = q.toString();
      return json<PreflightReport>(`/v1/preflight${qs ? `?${qs}` : ""}`);
    },

    // Plans / entitlements
    listPlans: () => json<PlanInfo[]>("/v1/plans"),
    entitlements: () => json<Entitlements>("/v1/entitlements"),
    /** The credit packs for sale (public). */
    listPacks: () => json<CreditPack[]>("/v1/billing/packs"),
    /** Start paying for a credit pack over UPI (an open order for the same pack is handed back). */
    createUpiOrder: (pack: string) =>
      json<UpiOrder>("/v1/billing/upi/orders", { method: "POST", body: body({ pack }) }),
    listUpiOrders: () => json<UpiOrder[]>("/v1/billing/upi/orders"),
    /** "I've paid": the 12-digit UTR from the UPI app, for the admin to check. */
    submitUtr: (orderId: string, utr: string) =>
      json<UpiOrder>(`/v1/billing/upi/orders/${encodeURIComponent(orderId)}/utr`, {
        method: "POST",
        body: body({ utr }),
      }),

    // Admin / advanced settings
    adminStatus: () => json<{ is_admin: boolean }>("/v1/admin/status"),
    /** Admin: accounts, newest first ("pending" = waiting for access). */
    adminUsers: (only: "all" | "pending" = "all", q = "") =>
      json<AdminUsers>(`/v1/admin/users?only=${only}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`),
    /** Admin: one account's history (credits in and out, sessions and their minutes, payments), newest first. */
    adminUserActivity: (userId: string) =>
      json<{ items: AdminActivityItem[] }>(`/v1/admin/users/${encodeURIComponent(userId)}/activity`),
    /** Admin: add resume credits and/or interview minutes to an account (they never expire). */
    giveCredits: (userId: string, add: { resume?: number; interview_minutes?: number }) =>
      json<AdminUser>(`/v1/admin/users/${encodeURIComponent(userId)}/credits`, { method: "POST", body: body(add) }),
    /** Admin: grant a plan for a while, approve for good, or revoke. */
    setUserAccess: (userId: string, change: AccessChange) =>
      json<AdminUser>(`/v1/admin/users/${encodeURIComponent(userId)}/access`, { method: "POST", body: body(change) }),
    /** Admin: UPI payments ("submitted" = a UTR waiting to be checked). */
    adminPayments: (only: "submitted" | "all" = "submitted") =>
      json<AdminPayments>(`/v1/admin/payments?only=${only}`),
    /** `utr`: the one you checked against the bank statement; if the payer changed it since, nothing is decided. */
    decidePayment: (paymentId: string, action: "approve" | "reject", note?: string, utr?: string | null) =>
      json<AdminPayment>(`/v1/admin/payments/${encodeURIComponent(paymentId)}`, {
        method: "POST",
        body: body({ action, note: note ?? null, ...(utr ? { utr } : {}) }),
      }),
    getLatency: (days = 7) => json<LatencyReport>(`/v1/admin/latency?days=${days}`),
    getCosts: (days = 30) => json<CostReport>(`/v1/admin/costs?days=${days}`),
    getFeedbackReport: (days = 30) => json<FeedbackReport>(`/v1/admin/feedback?days=${days}`),
    getAdminConfig: () => json<AdminConfig>("/v1/admin/config"),
    updateAdminConfig: (req: AdminConfigUpdate) =>
      json<AdminConfig>("/v1/admin/config", { method: "PUT", body: body(req) }),
  };
}

async function toApiError(response: Response): Promise<ApiError> {
  let parsed: ApiErrorBody | null;
  try {
    parsed = (await response.json()) as ApiErrorBody;
  } catch {
    parsed = null;
  }
  if (parsed?.error) return new ApiError(response.status, parsed.error.message, parsed.error.code);
  const detail = parsed?.detail;
  if (typeof detail === "string") return new ApiError(response.status, detail);
  // Structured errors: { detail: { code, message } } (e.g. "email_unverified", "captcha_failed").
  if (detail && !Array.isArray(detail) && typeof detail === "object" && typeof detail.message === "string") {
    return new ApiError(
      response.status,
      detail.message,
      typeof detail.code === "string" ? detail.code : "http_error",
      detail as Record<string, unknown>,
    );
  }
  if (Array.isArray(detail) && detail.length > 0) {
    return new ApiError(response.status, detail.map((d) => d.msg).join("; "), "validation_error");
  }
  return new ApiError(response.status, defaultMessage(response.status));
}

function defaultMessage(status: number): string {
  if (status === 401) return "Please sign in again.";
  if (status === 403) return "You don't have access to this.";
  if (status === 404) return "Not found.";
  if (status === 413) return "That file is too large.";
  if (status === 429) return "Too many requests — slow down for a moment.";
  if (status >= 500) return "Orbit had a problem. Try again shortly.";
  return `Request failed (${status}).`;
}

export function base64ToBlob(base64: string, type = "image/png"): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}
