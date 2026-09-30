import type {
  AtsReport,
  AdminConfig,
  AdminConfigUpdate,
  ApiErrorBody,
  AuthConfig,
  CostReport,
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
  ResumeData,
  ResumeDesign,
  ResumeImportRequest,
  ResumeImportResponse,
  ResumeInput,
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
  Usage,
  User,
  Workspace,
  WorkspaceInput,
} from "@orbit/types";

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

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  // Cookie mode: the API's CSRF token for this session, taken from the latest auth response (/me, login,
  // register, password reset) and sent back on every state-changing request. See apps/api/orbit_api/csrf.py.
  let csrfToken: string | null = null;
  const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

  async function raw(path: string, init: RequestInit = {}): Promise<Response> {
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
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        credentials: options.auth.mode === "cookie" ? "include" : "omit",
      });
    } catch {
      throw new ApiError(0, "Can't reach Orbit. Check your internet connection.", "offline");
    }
    if (!response.ok) {
      if (response.status === 401) options.onUnauthorized?.();
      throw await toApiError(response);
    }
    return response;
  }

  async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    deleteAccount: () => json<void>("/v1/auth/me", { method: "DELETE" }),
    logoutAll: () => json<void>("/v1/auth/logout-all", { method: "POST" }),
    requestEmailChange: (newEmail: string, password: string) =>
      json<{ status: string }>("/v1/auth/me/email", {
        method: "POST",
        body: body({ new_email: newEmail, password }),
      }),
    confirmEmailChange: (token: string) =>
      json<AuthResponse>("/v1/auth/email-change/confirm", { method: "POST", body: body({ token }) }),
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
    scoreResume: (data: ResumeData, design: ResumeDesign, jobText: string) =>
      json<AtsReport>("/v1/resumes/score", { method: "POST", body: body({ data, design, job_text: jobText }) }),
    importResume: (req: ResumeImportRequest) =>
      json<ResumeImportResponse>("/v1/resumes/import", { method: "POST", body: body(req) }),
    importResumeFile: (file: File | Blob, filename?: string) => {
      const form = new FormData();
      if (filename) form.append("file", file, filename);
      else form.append("file", file);
      return json<ResumeImportResponse>("/v1/resumes/import-file", { method: "POST", body: form });
    },
    /** A cover letter from the resume and (if given) the job post; nothing it says goes beyond them. */
    coverLetter: (data: ResumeData, jobText: string) =>
      json<{ text: string }>("/v1/resumes/cover-letter", { method: "POST", body: body({ data, job_text: jobText }) }),
    /** The cover letter as a Word file, with the resume's name and contact line on top. */
    coverLetterDocx: async (text: string, data: ResumeData, design: ResumeDesign) =>
      (await raw("/v1/resumes/cover-letter/docx", { method: "POST", body: body({ text, data, design }) })).blob(),
    /** The resume as a Word file (.docx): one plain column, built from what the editor shows now. */
    resumeDocx: async (data: ResumeData, design: ResumeDesign) =>
      (await raw("/v1/resumes/docx", { method: "POST", body: body({ data, design }) })).blob(),
    suggestResume: (req: ResumeSuggestRequest) =>
      json<{ suggestions: ResumeSuggestion[] }>("/v1/resumes/suggest", { method: "POST", body: body(req) }),

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
    /** On the phone (no login): trade the scanned code for a single-use view ticket. */
    redeemCompanion: (code: string) =>
      json<CompanionView>(`/v1/companion/${encodeURIComponent(code)}`, { method: "POST" }),
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

    // Admin / advanced settings
    adminStatus: () => json<{ is_admin: boolean }>("/v1/admin/status"),
    getLatency: (days = 7) => json<LatencyReport>(`/v1/admin/latency?days=${days}`),
    getCosts: (days = 30) => json<CostReport>(`/v1/admin/costs?days=${days}`),
    getFeedbackReport: (days = 30) => json<FeedbackReport>(`/v1/admin/feedback?days=${days}`),
    getAdminConfig: () => json<AdminConfig>("/v1/admin/config"),
    updateAdminConfig: (req: AdminConfigUpdate) =>
      json<AdminConfig>("/v1/admin/config", { method: "PUT", body: body(req) }),
  };
}

async function toApiError(response: Response): Promise<ApiError> {
  let parsed: ApiErrorBody | null = null;
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
