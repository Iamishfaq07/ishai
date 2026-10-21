import type {
  InterviewPrepUpdate,
  InterviewPrepView,
  InterviewSessionContext,
  InterviewWrapUp,
  EngineeringTelemetry,
  TwoFactorChallenge,
  DesktopExchangeRequest,
  TwoFactorStatus,
  Passkey,
  VoiceStatus,
  CameraMetrics,
  PasskeyOptions,
  SecurityActivity,
  SignedInDevice,
  JobMission,
  OpportunityContext,
  JobSourceReview,
  RequirementPractice,
  ResumeVersionComparison,
  PrepPlan,
  JobTimelineEvent,
  LoopMemory,
  CareerContext,
  Debrief,
  DebriefAttempt,
  DefenseCard,
  FullPreparation,
  AdminActivityItem,
  AtsReport,
  AccessChange,
  AdminAuditPage,
  AdminAuditQuery,
  AdminConfig,
  AdminConfigUpdate,
  AdminPayment,
  AdminPayments,
  AdminReferralCode,
  AdminReferralCodeCreate,
  AdminReferralCodePatch,
  AdminReferrals,
  ReconcileResult,
  ReferralCodeInfo,
  ReferralInvite,
  ReferralOffer,
  AdminStats,
  AdminUser,
  AdminUserDetail,
  AdminUserFilter,
  AdminUserPatch,
  AdminUserQuery,
  AdminUsers,
  Announcement,
  ApiErrorBody,
  BulkCreditsResult,
  AuthConfig,
  ContactReceipt,
  ContactRequest,
  InboxMessage,
  InboxMessagePatch,
  InboxPage,
  InboxQuery,
  CostReport,
  CoverLetterLength,
  CoverLetterTone,
  CreditPack,
  MonthlyPlan,
  PaypalCheckout,
  RazorpayCheckout,
  RazorpayPaid,
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
  JobLinkInfo,
  JobManualTrack,
  JobAlert,
  CodeAttemptInput,
  CodeAttemptRecord,
  CodeProblem,
  CodeProblemSummary,
  JobOfferRecord,
  OfferScenario,
  OfferScenarioInput,
  LinkedInFixInput,
  LinkedInState,
  LinkedInSuggestionPatch,
  OfferInput,
  OfferMarket,
  JobAlertFrequency,
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
  JobContact,
  JobContactInput,
  OrbitSession,
  PracticeQueue,
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
  RemoveCreditsRequest,
  RemoveCreditsResult,
  ScreenshotAccepted,
  CompanyStyle,
  SavedAnswer,
  SavedAnswerInput,
  EvidenceItem,
  EvidenceSuggestRequest,
  EvidenceSuggestResponse,
  Story,
  TailorQueueItem,
  TailorQueueJob,
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

export interface SupportChatMessage {
  id: string;
  role: "user" | "bot" | "human";
  text: string;
  created_at: string;
}

export interface SupportSuggestion {
  id: string;
  label: string;
}

export interface SupportThread {
  id: string;
  status: "bot" | "waiting" | "closed";
  token?: string | null;
  messages: SupportChatMessage[];
  /** What to tap next. Empty once a person has the chat. `human` means talk to a person. */
  suggestions?: SupportSuggestion[];
  /** Admin only: who this is, their balance, and the last payment. */
  account?: string;
}

export interface SupportAdminItem {
  id: string;
  status: string;
  name: string;
  email: string;
  updated_at: string;
  preview: string;
}

export type ApiAuth =
  /** Browser: httpOnly session cookie set by the API. */
  | { mode: "cookie" }
  /** Desktop: bearer token held in the OS keychain, cached in memory. */
  | { mode: "bearer"; getToken: () => string | null };

/**
 * A web app whose `baseUrl` is its own edge proxy (/api) can call the API's own address instead (D80): the proxy
 * costs a second or more a call from where Cloudflare's free plan routes India (London, Paris, Seattle). Calls go
 * there once a reply through the proxy says the API's cookies are shared with it (COOKIE_DOMAIN_HEADER), except the
 * ones that still need the proxy, and back through the proxy for a day if that address can't be reached from here.
 */
export interface DirectRoute {
  /** The API's own address, e.g. https://api.orbitanswer.com. */
  url: string;
  /** Calls that still go through the proxy: the edge states the visitor's country only there (prices). */
  viaProxy: (path: string) => boolean;
  /** The page's own host (location.hostname): only a page on the cookies' domain goes direct (not a preview copy). */
  siteHost: string;
  /** Where the route is remembered between visits. */
  storage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
}

/** The API sets it on every reply when its cookies are shared with its own address (apps/api/orbit_api/main.py). */
export const COOKIE_DOMAIN_HEADER = "X-Orbit-Cookie-Domain";
const ROUTE_KEY = "orbit.apiRoute";
const UNREACHABLE_FOR_MS = 24 * 3600_000;

export interface ApiClientOptions {
  baseUrl: string;
  auth: ApiAuth;
  direct?: DirectRoute;
  /** Invoked on any 401 so the app can route to sign-in. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** The error code of a request made by (or signing in to) an account the admin suspended. */
export const ACCOUNT_SUSPENDED = "account_suspended";

/** `?a=1&b=x` from the defined, non-empty values (leading "?" included), or "". */
export function queryString(params: Record<string, string | number | boolean | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    q.set(key, String(value));
  }
  const text = q.toString();
  return text ? `?${text}` : "";
}

/** This browser's offset as `?tz_offset=` (minutes east of UTC), so "today" and "tomorrow" are the person's own days. */
const localDays = () => queryString({ tz_offset: -new Date().getTimezoneOffset() });

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

  // D80: through the proxy until a reply from it says the API's cookies are shared with its own address; not again
  // for a day after that address couldn't be reached from here (a network that blocks it).
  const direct = options.direct ? { ...options.direct, url: trimTrailingSlashes(options.direct.url) } : null;
  const saved = direct?.storage?.getItem(ROUTE_KEY) ?? "";
  let goDirect = saved === "direct";
  let unreachableUntil = saved.startsWith("unreachable:") ? Number(saved.slice("unreachable:".length)) || 0 : 0;
  const remember = (value: string) => direct?.storage?.setItem(ROUTE_KEY, value);
  const within = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
  function heardThroughProxy(response: Response): void {
    const domain = (response.headers.get(COOKIE_DOMAIN_HEADER) ?? "").toLowerCase();
    // Both this page and the API's own address on the domain the cookies are shared with, or they wouldn't go along.
    const shared = Boolean(domain) && within(direct!.siteHost.toLowerCase(), domain) && within(new URL(direct!.url).hostname, domain);
    if (shared && !goDirect && Date.now() >= unreachableUntil) {
      goDirect = true;
      remember("direct");
    } else if (!shared && goDirect && response.status < 500) {
      goDirect = false; // the API no longer shares them (a proxy error page wouldn't say either way)
      remember("");
    }
  }

  async function raw(path: string, request: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    const viaDirect = Boolean(direct && goDirect && !direct.viaProxy(path));
    const method = (request.method ?? "GET").toUpperCase();
    try {
      return await attempt(path, request, viaDirect);
    } catch (err) {
      if (!viaDirect || !(err instanceof ApiError) || err.code !== "offline") throw err;
      // The API's own address can't be reached from here: the proxy for a day, and a read is asked again through it.
      goDirect = false;
      unreachableUntil = Date.now() + UNREACHABLE_FOR_MS;
      remember(`unreachable:${unreachableUntil}`);
      if (method !== "GET" && method !== "HEAD") throw err; // a write may have landed: never sent twice
      return attempt(path, request, false);
    }
  }

  async function attempt(path: string, request: RequestInit & { timeoutMs?: number }, viaDirect: boolean): Promise<Response> {
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
      response = await doFetch(`${viaDirect ? direct!.url : baseUrl}${path}`, {
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
    if (direct && !viaDirect) heardThroughProxy(response);
    if (!response.ok) {
      const error = await toApiError(response);
      // Suspended by the admin: signed out like an expired session; signing in again says why.
      if (response.status === 401 || error.code === ACCOUNT_SUSPENDED) options.onUnauthorized?.();
      throw error;
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
    /** A JSON call to any path (CSRF, the direct route, errors and timeouts as every method here): for features whose
     *  methods live in their own lazily loaded module (Orbit for Business, apps/web/src/business/api.ts). */
    call: <T,>(path: string, init: RequestInit & { timeoutMs?: number } = {}) => json<T>(path, init),
    /** The same, returning the Response itself (a file download, a CSV). */
    callRaw: (path: string, init: RequestInit & { timeoutMs?: number } = {}) => raw(path, init),
    fullJobPrep: (id: string, resumeId?: string | null) => json<FullPreparation>(`/v1/jobs/listings/${encodeURIComponent(id)}/full-prep`,
      { method: "POST", body: body({ resume_id: resumeId ?? null }), timeoutMs: LONG_TIMEOUT_MS }),
    grillResume: (id: string, data: ResumeData, context: CareerContext) => json<OrbitSession>(`/v1/resumes/${encodeURIComponent(id)}/grill`,
      { method: "POST", body: body({ data, context }), timeoutMs: LONG_TIMEOUT_MS }),
    debrief: (id: string) => json<Debrief>(`/v1/sessions/${encodeURIComponent(id)}/debrief`),
    retryDebrief: (id: string, questionId: string, answer: string) => json<DebriefAttempt>(
      `/v1/sessions/${encodeURIComponent(id)}/debrief/${encodeURIComponent(questionId)}/retry`,
      { method: "POST", body: body({ answer }), timeoutMs: LONG_TIMEOUT_MS }),
    spokenWalkthrough: (id: string, answerId: string) => json<NonNullable<import("@orbit/types").LiveAnswer["walkthrough"]>>(
      `/v1/sessions/${encodeURIComponent(id)}/answers/${encodeURIComponent(answerId)}/walkthrough`, { method: "POST" }),
    defenseNotes: (id: string, notes: string) => json<DefenseCard>(`/v1/sessions/${encodeURIComponent(id)}/defense`,
      { method: "POST", body: body({ notes }), timeoutMs: LONG_TIMEOUT_MS }),
    defenseFile: (id: string, file: Blob, name: string, notes = "") => {
      const form = new FormData(); form.append("file", file, name); form.append("notes", notes);
      return json<DefenseCard>(`/v1/sessions/${encodeURIComponent(id)}/defense-file`, { method: "POST", body: form, timeoutMs: LONG_TIMEOUT_MS });
    },
    requestLaunchAccess: (pack: string, country: string) => json<{ reference: string; status: "requested"; message: string }>(
      "/v1/billing/launch-access", { method: "POST", body: body({ pack, country }) }),
    baseUrl,
    /** The address a call to `path` goes to now: the API's own once the direct route is on (D80), else baseUrl. For a
     *  page the browser itself opens (Google's sign-in start), which the client can't fetch for it. */
    urlFor: (path: string) => `${direct && goDirect && !direct.viaProxy(path) ? direct.url : baseUrl}${path}`,

    // Auth
    authConfig: () => json<AuthConfig>("/v1/auth/config"),
    register: (req: RegisterRequest) =>
      json<AuthResponse | RegisterPending>("/v1/auth/register", { method: "POST", body: body(req) }),
    login: (req: LoginRequest) => json<AuthResponse | TwoFactorChallenge>("/v1/auth/login", { method: "POST", body: body(req) }),
    /** The second step: a code from the authenticator app or a recovery code. After Google, `challenge` is in a cookie. */
    loginSecondStep: (code: string, challenge?: string | null) =>
      json<AuthResponse>("/v1/auth/login/2fa", { method: "POST", body: body({ code, challenge: challenge ?? null }) }),
    /** The desktop app's Continue with Google (D81): the loopback code and its PKCE verifier, for a sign-in. */
    desktopExchange: (req: DesktopExchangeRequest) =>
      json<AuthResponse | TwoFactorChallenge>("/v1/auth/desktop/exchange", { method: "POST", body: body(req) }),
    twoFactorStatus: () => json<TwoFactorStatus>("/v1/auth/2fa"),
    twoFactorSetup: (password: string) =>
      json<{ secret: string; otpauth_uri: string }>("/v1/auth/2fa/setup", { method: "POST", body: body({ password }) }),
    twoFactorEnable: (code: string) => json<{ recovery_codes: string[] }>("/v1/auth/2fa/enable", { method: "POST", body: body({ code }) }),
    twoFactorDisable: (code: string) => json<void>("/v1/auth/2fa/disable", { method: "POST", body: body({ code }) }),
    twoFactorNewCodes: (code: string) =>
      json<{ recovery_codes: string[] }>("/v1/auth/2fa/recovery-codes", { method: "POST", body: body({ code }) }),
    voiceStatus: () => json<VoiceStatus>("/v1/voice"),
    /** A sign-in only the browser extension can use, handed to it on the Connect page (never shown). */
    extensionConnect: () => json<{ token: string }>("/v1/extension/connect", { method: "POST" }),
    /** The camera coach's numbers so far for a mock session (sent again as they grow). `keepalive`: sent as the page
     *  closes, so the browser finishes the request after the tab is gone. */
    saveCameraMetrics: (sessionId: string, metrics: CameraMetrics, keepalive = false) =>
      json<void>(`/v1/sessions/${encodeURIComponent(sessionId)}/camera-metrics`, { method: "PUT", body: body(metrics), keepalive }),
    /** The interviewer's question as MP3, streamed (read the body as it arrives). */
    /** `speed`: the speaking pace (0.8–1.25); the response's X-Orbit-Speed says the pace it was made at. */
    speak: (text: string, voice: string, signal?: AbortSignal, opts?: { sessionId?: string; speed?: number }) =>
      raw("/v1/voice/speak", {
        method: "POST",
        body: body({ text, voice, session_id: opts?.sessionId ?? null, ...(opts?.speed && opts.speed !== 1 ? { speed: opts.speed } : {}) }),
        timeoutMs: 15000,
        ...(signal ? { signal } : {}),
      }),
    passkeys: () => json<Passkey[]>("/v1/auth/passkeys"),
    passkeyOptions: (password: string) => json<PasskeyOptions>("/v1/auth/passkeys/options", { method: "POST", body: body({ password }) }),
    addPasskey: (credential: Record<string, unknown>, name = "") =>
      json<Passkey>("/v1/auth/passkeys", { method: "POST", body: body({ credential, name }) }),
    renamePasskey: (id: string, name: string) =>
      json<Passkey>(`/v1/auth/passkeys/${encodeURIComponent(id)}`, { method: "PATCH", body: body({ name }) }),
    removePasskey: (id: string) => json<void>(`/v1/auth/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" }),
    passkeyLoginOptions: () => json<PasskeyOptions>("/v1/auth/login/passkey/options", { method: "POST" }),
    loginWithPasskey: (credential: Record<string, unknown>) =>
      json<AuthResponse>("/v1/auth/login/passkey", { method: "POST", body: body({ credential }) }),
    me: () => json<User>("/v1/auth/me"),
    logout: async () => {
      await json<void>("/v1/auth/logout", { method: "POST" });
      csrfToken = null;
    },
    updatePrivacy: (req: PrivacyUpdate) => json<User>("/v1/auth/me/privacy", { method: "PATCH", body: body(req) }),
    /** The country they're applying for jobs in (ISO 3166-1 alpha-2). */
    updateRegion: (country: string) => json<User>("/v1/auth/me/region", { method: "PATCH", body: body({ country }) }),
    /** Asks for the password again: a session left open somewhere can't delete the account. */
    deleteAccount: (password: string) => json<void>("/v1/auth/me", { method: "DELETE", body: body({ password }) }),
    /** A new password; every other device (and any live session) is signed out, this one stays signed in. */
    changePassword: (currentPassword: string, newPassword: string) =>
      json<AuthResponse>("/v1/auth/me/password", {
        method: "POST",
        body: body({ current_password: currentPassword, new_password: newPassword }),
      }),
    logoutAll: () => json<void>("/v1/auth/logout-all", { method: "POST" }),
    /** Signed-in devices, most recently used first. */
    devices: () => json<SignedInDevice[]>("/v1/auth/sessions"),
    /** Recent changes to how this account is signed in to (passkeys, two-step sign-in, password), newest first. */
    securityActivity: () => json<SecurityActivity>("/v1/auth/security-activity"),
    signOutDevice: (id: string) => json<void>(`/v1/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    requestEmailChange: (newEmail: string, password: string) =>
      json<{ status: string }>("/v1/auth/me/email", {
        method: "POST",
        body: body({ new_email: newEmail, password }),
      }),
    /** Changes the email; it signs nobody in (sign in with the new address and your password). */
    confirmEmailChange: (token: string) =>
      json<{ email: string; google_disconnected?: boolean }>("/v1/auth/email-change/confirm", {
        method: "POST",
        body: body({ token }),
      }),
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
    /** Sets the new password. With two-step sign-in on, nobody is signed in yet: the authenticator code comes next
     * (the challenge is also in a short httpOnly cookie, as after Google). */
    confirmPasswordReset: (token: string, password: string) =>
      json<AuthResponse | TwoFactorChallenge>("/v1/auth/password-reset/confirm", {
        method: "POST",
        body: body({ token, password }),
      }),

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
    /** How well-known companies interview (the Practice page's "What to expect at …"). */
    interviewStyles: () => json<CompanyStyle[]>("/v1/interview-styles"),
    // Answer bank
    savedAnswers: () => json<SavedAnswer[]>("/v1/answers"),
    saveAnswer: (req: SavedAnswerInput) => json<SavedAnswer>("/v1/answers", { method: "POST", body: body(req) }),
    updateSavedAnswer: (id: string, req: SavedAnswerInput) =>
      json<SavedAnswer>(`/v1/answers/${encodeURIComponent(id)}`, { method: "PUT", body: body(req) }),
    deleteSavedAnswer: (id: string) => json<void>(`/v1/answers/${encodeURIComponent(id)}`, { method: "DELETE" }),
    // Resume AI's tailoring queue
    tailorQueue: () => json<TailorQueueItem[]>("/v1/resumes/tailor-queue"),
    queueTailoring: (resumeId: string, jobs: TailorQueueJob[]) =>
      json<TailorQueueItem[]>(`/v1/resumes/${encodeURIComponent(resumeId)}/tailor-queue`, { method: "POST", body: body({ jobs }) }),
    removeTailoring: (itemId: string) =>
      json<void>(`/v1/resumes/tailor-queue/${encodeURIComponent(itemId)}`, { method: "DELETE" }),

    // Career Evidence Vault
    listEvidence: () => json<EvidenceItem[]>("/v1/evidence"),
    addEvidence: (claim: string) => json<EvidenceItem>("/v1/evidence", { method: "POST", body: body({ claim }) }),
    editEvidence: (id: string, claim: string) =>
      json<EvidenceItem>(`/v1/evidence/${encodeURIComponent(id)}`, { method: "PUT", body: body({ claim }) }),
    confirmEvidence: (id: string) =>
      json<EvidenceItem>(`/v1/evidence/${encodeURIComponent(id)}/confirm`, { method: "POST" }),
    deleteEvidence: (id: string) => json<void>(`/v1/evidence/${encodeURIComponent(id)}`, { method: "DELETE" }),
    /** Empty the vault, or only its unchecked suggestions. */
    clearEvidence: (only?: "suggested") =>
      json<void>(`/v1/evidence${only ? `?only=${only}` : ""}`, { method: "DELETE" }),
    suggestEvidence: (req: EvidenceSuggestRequest) =>
      json<EvidenceSuggestResponse>("/v1/evidence/suggest", { method: "POST", body: body(req) }),

    // Story bank
    listStories: () => json<Story[]>("/v1/stories"),
    createStory: (req: StoryInput) => json<Story>("/v1/stories", { method: "POST", body: body(req) }),
    updateStory: (id: string, req: StoryInput) =>
      json<Story>(`/v1/stories/${encodeURIComponent(id)}`, { method: "PUT", body: body(req) }),
    deleteStory: (id: string) => json<void>(`/v1/stories/${encodeURIComponent(id)}`, { method: "DELETE" }),
    draftStories: (req: StoryDraftRequest) =>
      json<StoryDraftResponse>("/v1/stories/draft", { method: "POST", body: body(req) }),
    /** Scores and speaking stats across ended sessions (minutes east of UTC, so the streak counts the person's own days). */
    progress: (tzOffset = -new Date().getTimezoneOffset()) => json<Progress>(`/v1/progress${queryString({ tz_offset: tzOffset })}`),
    // Resume maker
    listResumes: () => json<ResumeSummary[]>("/v1/resumes"),
    getResume: (id: string) => json<Resume>(`/v1/resumes/${encodeURIComponent(id)}`),
    createResume: (req: ResumeInput) => json<Resume>("/v1/resumes", { method: "POST", body: body(req) }),
    updateResume: (id: string, req: ResumeInput, opts: RequestOptions = {}) =>
      json<Resume>(`/v1/resumes/${encodeURIComponent(id)}`, { method: "PUT", body: body(req), ...opts }),
    deleteResume: (id: string) => json<void>(`/v1/resumes/${encodeURIComponent(id)}`, { method: "DELETE" }),
    ...resumeTools("/v1/resumes"),

    // Jobs: the latest jobs that match the resume, the profile behind the feed, the tracker
    jobProfile: () => json<JobProfile>("/v1/jobs/profile"),
    saveJobProfile: (prefs: JobPrefs, resumeId?: string | null) =>
      json<JobProfile>("/v1/jobs/profile", { method: "PUT", body: body({ prefs, resume_id: resumeId ?? null }) }),
    codeProblems: () =>
      json<{ patterns: string[]; problems: CodeProblemSummary[]; reviews_left: number | null }>(`/v1/code/problems${localDays()}`),
    codeProblem: (id: string) =>
      json<{ problem: CodeProblem; attempts: CodeAttemptRecord[]; reviews_left: number | null }>(`/v1/code/problems/${encodeURIComponent(id)}${localDays()}`),
    /** Save an attempt and get the AI interviewer's review (free, a day's allowance). */
    reviewCode: (id: string, attempt: CodeAttemptInput) =>
      json<CodeAttemptRecord>(`/v1/code/problems/${encodeURIComponent(id)}/attempts${localDays()}`, { method: "POST", body: body(attempt), timeoutMs: LONG_TIMEOUT_MS }),
    linkedin: () => json<LinkedInState>("/v1/linkedin"),
    /** LinkedIn's "Save to PDF" (AI read, free, a few a day; the file isn't kept). */
    readLinkedInFile: (file: File | Blob, filename?: string) => {
      const form = new FormData();
      if (filename) form.append("file", file, filename);
      else form.append("file", file);
      return json<LinkedInState>("/v1/linkedin/read-file", { method: "POST", body: form });
    },
    readLinkedInText: (text: string) => json<LinkedInState>("/v1/linkedin/read", { method: "POST", body: body({ text }) }),
    setLinkedInTarget: (role: string) => json<LinkedInState>("/v1/linkedin/target", { method: "PUT", body: body({ target_role: role }) }),
    deleteLinkedIn: () => json<void>("/v1/linkedin", { method: "DELETE" }),
    /** One part written as a suggestion: the AI's parts are a single resume fix (a fraction of a credit), the rest free. */
    linkedinFix: (input: LinkedInFixInput) =>
      json<LinkedInState & { suggestion_id: string }>("/v1/linkedin/fix", { method: "POST", body: body(input), timeoutMs: LONG_TIMEOUT_MS }),
    /** "Rewrite everything" from a resume: headline, About and skills (one resume credit). */
    linkedinRewrite: (resumeId: string) =>
      json<LinkedInState>("/v1/linkedin/rewrite", { method: "POST", body: body({ resume_id: resumeId }), timeoutMs: LONG_TIMEOUT_MS }),
    /** Into Orbit's copy of the profile (re-scores), or back as LinkedIn has it. */
    applyLinkedInSuggestion: (id: string, apply = true) =>
      json<LinkedInState>(`/v1/linkedin/suggestions/${encodeURIComponent(id)}/${apply ? "apply" : "unapply"}`, { method: "POST" }),
    patchLinkedInSuggestion: (id: string, patch: LinkedInSuggestionPatch) =>
      json<LinkedInState>(`/v1/linkedin/suggestions/${encodeURIComponent(id)}`, { method: "PATCH", body: body(patch) }),
    deleteLinkedInSuggestion: (id: string) =>
      json<LinkedInState>(`/v1/linkedin/suggestions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    offers: () => json<JobOfferRecord[]>("/v1/offers"),
    /** What-if figures for an offer (nothing saved). */
    offerScenario: (id: string, input: OfferScenarioInput) =>
      json<OfferScenario>(`/v1/offers/${encodeURIComponent(id)}/scenario`, { method: "POST", body: body(input) }),
    addOffer: (offer: OfferInput) => json<JobOfferRecord>("/v1/offers", { method: "POST", body: body(offer) }),
    updateOffer: (id: string, offer: OfferInput) =>
      json<JobOfferRecord>(`/v1/offers/${encodeURIComponent(id)}`, { method: "PUT", body: body(offer) }),
    deleteOffer: (id: string) => json<void>(`/v1/offers/${encodeURIComponent(id)}`, { method: "DELETE" }),
    /** Offer AI's negotiation plan (AI, free, a few a day; the same figures return the plan already made). */
    offerPlan: (id: string) => json<JobOfferRecord>(`/v1/offers/${encodeURIComponent(id)}/plan`, { method: "POST" }),
    payCheck: (role: string, city = "") =>
      json<OfferMarket | null>(`/v1/offers/pay?${new URLSearchParams({ role, city }).toString()}`),
    jobAlert: () => json<JobAlert>("/v1/jobs/alerts"),
    setJobAlert: (frequency: JobAlertFrequency) => json<JobAlert>("/v1/jobs/alerts", { method: "PUT", body: body({ frequency }) }),
    /** The alert email's "stop these emails" link: no sign-in, the token says whose. */
    stopJobAlerts: (token: string) => json<void>("/v1/jobs/alerts/off", { method: "POST", body: body({ token }) }),
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
    /** What a job's link says (site, title, company, city), read from its address: nothing is fetched. */
    jobLinkInfo: (url: string) => json<JobLinkInfo>("/v1/jobs/tracker/link", { method: "POST", body: body({ url }) }),
    /** Track a job found elsewhere. A 409 "already_tracked" error carries the entry's `id` in `details`. */
    trackManualJob: (req: JobManualTrack) =>
      json<JobTrackerEntry>("/v1/jobs/tracker/manual", { method: "POST", body: body(req) }),
    /** The people in the job search, follow-ups due first (optionally only those linked to one tracked job). */
    jobContacts: (applicationId?: string) =>
      json<JobContact[]>(`/v1/jobs/contacts${applicationId ? `?application_id=${encodeURIComponent(applicationId)}` : ""}`),
    addJobContact: (input: JobContactInput) => json<JobContact>("/v1/jobs/contacts", { method: "POST", body: body(input) }),
    updateJobContact: (id: string, patch: Partial<JobContactInput>) =>
      json<JobContact>(`/v1/jobs/contacts/${encodeURIComponent(id)}`, { method: "PATCH", body: body(patch) }),
    /** "I got in touch": last contacted now, next follow-up a week out (or none). */
    jobContactTouched: (id: string, opts: { noFollowUp?: boolean } = {}) =>
      json<JobContact>(`/v1/jobs/contacts/${encodeURIComponent(id)}/contacted`, {
        method: "POST",
        body: body({ no_follow_up: Boolean(opts.noFollowUp) }),
      }),
    deleteJobContact: (id: string) => json<void>(`/v1/jobs/contacts/${encodeURIComponent(id)}`, { method: "DELETE" }),

    /** Interview prep: likely questions from a job description, with answers drawn from the resume. */
    prep: (req: PrepRequest) => json<PrepResponse>("/v1/prep", { method: "POST", body: body(req) }),
    /** Read a job posting from a link (server-side, SSRF-safe); returns the text to check and edit. */
    importJobLink: (url: string) =>
      json<ImportedJobPosting>("/v1/prep/import-link", { method: "POST", body: body({ url }) }),
    /** The practice queue: questions answered weakly in a review, due again on a spaced schedule. */
    practiceQueue: () => json<PracticeQueue>("/v1/practice/queue"),
    /** A mock round on what's due in the practice queue (409 "nothing_due" when nothing is). */
    practiceQueueDrill: () => json<OrbitSession>("/v1/practice/queue/drill", { method: "POST" }),
    /** A mock round on the review's weak questions, or on one question of it (`question`, 1-based) again. */
    drillSession: (id: string, question?: number) =>
      json<OrbitSession>(`/v1/sessions/${encodeURIComponent(id)}/drill`,
        question === undefined ? { method: "POST" } : { method: "POST", body: body({ question }) }),
    retryReport: (id: string) =>
      json<OrbitSession>(`/v1/sessions/${encodeURIComponent(id)}/report/retry`, { method: "POST" }),
    exportSessionMarkdown: async (id: string): Promise<string> =>
      (await raw(`/v1/sessions/${encodeURIComponent(id)}/export.md${localDays()}`)).text(),
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
    /** The credit packs for sale (public). `currency`: the list in rupees or dollars, to read only (/pricing). */
    listPacks: (currency?: "INR" | "USD") => json<CreditPack[]>(`/v1/billing/packs${queryString({ currency })}`),
    /** The monthly plans for sale (public): 30 days, paid once; buy through the same orders as packs. `currency`: as
     *  for packs. */
    listMonthly: (currency?: "INR" | "USD") => json<MonthlyPlan[]>(`/v1/billing/monthly${queryString({ currency })}`),
    /** Start paying for a credit pack over UPI (an open order for the same pack is handed back). */
    createUpiOrder: (pack: string) =>
      json<UpiOrder>("/v1/billing/upi/orders", { method: "POST", body: body({ pack }) }),
    listUpiOrders: () => json<UpiOrder[]>("/v1/billing/upi/orders"),
    /** Razorpay: an order for the pack, to open the checkout with; then the checkout's answer, checked. */
    createRazorpayOrder: (pack: string) =>
      json<RazorpayCheckout>("/v1/billing/razorpay/orders", { method: "POST", body: body({ pack }) }),
    verifyRazorpay: (paid: RazorpayPaid) =>
      json<UpiOrder>("/v1/billing/razorpay/verify", { method: "POST", body: body(paid) }),
    /** PayPal (outside India): an order whose approval page the buyer is sent to; then, back from PayPal, its
     *  capture (credited only on PayPal's word that the money was taken). */
    createPaypalOrder: (pack: string) =>
      json<PaypalCheckout>("/v1/billing/paypal/orders", { method: "POST", body: body({ pack }) }),
    capturePaypal: (orderId: string) =>
      json<UpiOrder>("/v1/billing/paypal/capture", { method: "POST", body: body({ order_id: orderId }) }),
    /** "I've paid": the 12-digit UTR from the UPI app, for the admin to check. */
    submitUtr: (orderId: string, utr: string) =>
      json<UpiOrder>(`/v1/billing/upi/orders/${encodeURIComponent(orderId)}/utr`, {
        method: "POST",
        body: body({ utr }),
      }),
    /** Invite friends: the account's link (made the first time), what a friend gets, and how it's gone. */
    myInvite: () => json<ReferralInvite>("/v1/referrals/me"),
    /** A code entered at checkout, before the first payment: its discount comes off the next order. */
    redeemCode: (code: string) => json<ReferralOffer>("/v1/referrals/redeem", { method: "POST", body: body({ code }) }),
    /** Public: what a link's code gives, for the sign-up page (404 when it can't be used). */
    referralCode: (code: string) => json<ReferralCodeInfo>(`/v1/referrals/codes/${encodeURIComponent(code)}`),

    /** Job Mission Room: one tracked job as a workspace (stages, fit, resume, sent versions, offer, next step). */
    jobMission: (id: string) => json<JobMission>(`/v1/jobs/tracker/${encodeURIComponent(id)}/mission${localDays()}`),
    opportunityContext: (id: string) => json<OpportunityContext>(`/v1/jobs/tracker/${encodeURIComponent(id)}/mission/context`),
    jobSourceReview: (id: string) => json<JobSourceReview>(`/v1/jobs/tracker/${encodeURIComponent(id)}/mission/source`),
    requirementPractice: (id: string) => json<RequirementPractice>(`/v1/jobs/tracker/${encodeURIComponent(id)}/mission/practice`),
    linkMissionResume: (id: string, resumeId: string | null) =>
      json<JobMission>(`/v1/jobs/tracker/${encodeURIComponent(id)}/mission/resume${localDays()}`, { method: "PUT", body: body({ resume_id: resumeId }) }),
    /** Keep an immutable copy; this does not establish that it was submitted. */
    freezeMissionResume: (id: string, note = "", source?: { resume_id: string; updated_at: string }) =>
      json<JobMission>(`/v1/jobs/tracker/${encodeURIComponent(id)}/mission/snapshots${localDays()}`, { method: "POST", body: body({ note, ...source }) }),
    compareMissionSnapshot: (id: string, snapshotId: string) =>
      json<ResumeVersionComparison>(`/v1/jobs/tracker/${encodeURIComponent(id)}/mission/snapshots/${encodeURIComponent(snapshotId)}/compare`),
    /** Open a saved version as a new resume (the version itself never changes). */
    copyMissionSnapshot: (id: string, snapshotId: string) =>
      json<{ resume_id: string }>(
        `/v1/jobs/tracker/${encodeURIComponent(id)}/mission/snapshots/${encodeURIComponent(snapshotId)}/copy${localDays()}`,
        { method: "POST" },
      ),
    deleteMissionSnapshot: (id: string, snapshotId: string) =>
      json<JobMission>(`/v1/jobs/tracker/${encodeURIComponent(id)}/mission/snapshots/${encodeURIComponent(snapshotId)}${localDays()}`, {
        method: "DELETE",
      }),
    linkMissionOffer: (id: string, offerId: string | null) =>
      json<JobMission>(`/v1/jobs/tracker/${encodeURIComponent(id)}/mission/offer${localDays()}`, { method: "PUT", body: body({ offer_id: offerId }) }),
    /** The interview prep plan for a tracked job (minutes east of UTC, so the days are the person's own). */
    prepPlan: (id: string, tzOffset = -new Date().getTimezoneOffset()) =>
      json<PrepPlan>(`/v1/jobs/tracker/${encodeURIComponent(id)}/plan${queryString({ tz_offset: tzOffset, rehearsal: true })}`),
    tickPlanItem: (id: string, key: string, done: boolean, tzOffset = -new Date().getTimezoneOffset(), reuseFrom?: string) =>
      json<PrepPlan>(
        `/v1/jobs/tracker/${encodeURIComponent(id)}/plan/checks/${encodeURIComponent(key)}${queryString({ tz_offset: tzOffset, rehearsal: true })}`,
        { method: "PUT", body: body({ done, ...(reuseFrom ? { reuse_from: reuseFrom } : {}) }) },
      ),
    /** One tracked job's journey, oldest first. */
    trackerTimeline: (id: string) => json<JobTimelineEvent[]>(`/v1/jobs/tracker/${encodeURIComponent(id)}/timeline`),
    /** The candidate's earlier rounds with a company: questions asked, stories already told. */
    loopMemory: (company: string) => json<LoopMemory>(`/v1/sessions/loop-memory${queryString({ company })}`),
    /** Public: rolling 7-day live latency and how long the API has been up (the Technical details page). */
    engineeringTelemetry: () => json<EngineeringTelemetry>("/v1/public/engineering-telemetry"),

    // Interview day: a tracked job's interview prep, the copilot started with it, the wrap-up (job_portal/interview.py)
    /** The prep view: the round, the job post, the resume version used, matching stories, rounds so far. No AI. */
    interviewPrep: (id: string) => json<InterviewPrepView>(`/v1/jobs/tracker/${encodeURIComponent(id)}/interview`),
    updateInterviewPrep: (id: string, patch: InterviewPrepUpdate) =>
      json<InterviewPrepView>(`/v1/jobs/tracker/${encodeURIComponent(id)}/interview`, { method: "PUT", body: body(patch) }),
    /** The questions likely for this job, from its resume version and post: one resume credit. */
    interviewQuestions: (id: string) =>
      json<ResumeQuestionsResponse>(`/v1/jobs/tracker/${encodeURIComponent(id)}/interview/questions`, {
        method: "POST",
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    /** What a session for this interview starts with: saves the job post and the resume version as documents once. */
    interviewSessionContext: (id: string, tzOffset = -new Date().getTimezoneOffset()) =>
      json<InterviewSessionContext>(
        `/v1/jobs/tracker/${encodeURIComponent(id)}/session-context${queryString({ tz_offset: tzOffset })}`,
        { method: "POST" },
      ),
    /** After a round: what the user confirmed (the next round, waiting, an offer, not this time). */
    wrapUpInterview: (id: string, req: InterviewWrapUp) =>
      json<InterviewPrepView>(`/v1/jobs/tracker/${encodeURIComponent(id)}/wrap-up`, { method: "POST", body: body(req) }),

    // Admin / advanced settings
    adminStatus: () => json<{ is_admin: boolean }>("/v1/admin/status"),
    /** Admin: accounts, newest first unless sorted ("pending" = waiting for access), a page at a time. */
    adminUsers: (only: AdminUserFilter = "all", q = "", page: Omit<AdminUserQuery, "only" | "q"> = {}) =>
      json<AdminUsers>(`/v1/admin/users${queryString({ only, q: q.trim(), ...page })}`),
    /** Admin: the list as on screen (filter, search, order; every page) as a CSV file. */
    adminUsersCsv: async (query: Omit<AdminUserQuery, "offset" | "limit">) =>
      (await raw(`/v1/admin/users/export${queryString({ ...query, q: query.q?.trim() })}`)).blob(),
    /** Admin: one account in full (profile, wallet, ledger, sessions, content, payments, what was done to it). */
    adminUser: (userId: string) => json<AdminUserDetail>(`/v1/admin/users/${encodeURIComponent(userId)}`),
    /** Admin: name, email verified, private notes. */
    updateAdminUser: (userId: string, patch: AdminUserPatch) =>
      json<AdminUserDetail>(`/v1/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: body(patch) }),
    /** Admin: one account's history (credits in and out, sessions and their minutes, payments), newest first. */
    adminUserActivity: (userId: string) =>
      json<{ items: AdminActivityItem[] }>(`/v1/admin/users/${encodeURIComponent(userId)}/activity`),
    /** Admin: add resume credits and/or interview minutes to an account (they never expire). */
    giveCredits: (userId: string, add: { resume?: number; interview_minutes?: number; note?: string }) =>
      json<AdminUser>(`/v1/admin/users/${encodeURIComponent(userId)}/credits`, { method: "POST", body: body(add) }),
    /** Admin: take credits away, with a reason; never below zero (`clamped` says when less was there). */
    removeCredits: (userId: string, req: RemoveCreditsRequest) =>
      json<RemoveCreditsResult>(`/v1/admin/users/${encodeURIComponent(userId)}/credits/remove`, {
        method: "POST",
        body: body(req),
      }),
    /** Admin: the same credits for up to 100 accounts (the admin account is skipped). */
    bulkGiveCredits: (req: { user_ids: string[]; resume?: number; interview_minutes?: number; note?: string }) =>
      json<BulkCreditsResult>("/v1/admin/users/bulk-credits", { method: "POST", body: body(req) }),
    /** Admin: can't sign in or use Orbit until unsuspended; live sessions stop; they're shown the reason. */
    suspendUser: (userId: string, reason: string) =>
      json<AdminUser>(`/v1/admin/users/${encodeURIComponent(userId)}/suspend`, { method: "POST", body: body({ reason }) }),
    unsuspendUser: (userId: string) =>
      json<AdminUser>(`/v1/admin/users/${encodeURIComponent(userId)}/unsuspend`, { method: "POST" }),
    /** Admin: two-step sign-in off for someone who lost their phone and codes; `reason`: how you checked it's them. */
    turnOffTwoFactor: (userId: string, reason: string) =>
      json<AdminUser>(`/v1/admin/users/${encodeURIComponent(userId)}/2fa/off`, { method: "POST", body: body({ reason }) }),
    /** Admin: every device signs in again and live sessions stop; the password stays. */
    signOutUser: (userId: string) =>
      json<AdminUser>(`/v1/admin/users/${encodeURIComponent(userId)}/sign-out`, { method: "POST" }),
    /** Admin: email them the usual password-reset link. */
    sendPasswordReset: (userId: string) =>
      json<{ status: string; message: string }>(`/v1/admin/users/${encodeURIComponent(userId)}/password-reset`, {
        method: "POST",
      }),
    /** Admin: delete the account; `confirmEmail` must be its email. Its payments stay on the books. */
    deleteUser: (userId: string, confirmEmail: string) =>
      json<void>(`/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        body: body({ confirm_email: confirmEmail }),
      }),
    /** Admin: who did what, newest first. */
    adminAudit: (query: AdminAuditQuery = {}) =>
      json<AdminAuditPage>(`/v1/admin/audit${queryString({ ...query, q: query.q?.trim() })}`),
    /** Admin: sign-ups and minutes per day (in this browser's time zone), active accounts, this month's numbers. */
    adminStats: (days = 30, tzOffsetMinutes = -new Date().getTimezoneOffset()) =>
      json<AdminStats>(`/v1/admin/stats${queryString({ days, tz_offset: tzOffsetMinutes })}`),
    /** Public: the site-wide announcement banner, if the admin set one. */
    announcement: () => json<Announcement>("/v1/announcement"),
    /** Public: the country the visitor's request came from (the web app's edge says), or null when unknown. */
    visitorRegion: () => json<{ country: string | null }>("/v1/region"),
    /** Public (signed in or out): leave a message for the team; it waits in the admin's Inbox. */
    sendContact: (req: ContactRequest) => json<ContactReceipt>("/v1/contact", { method: "POST", body: body(req) }),
    /** Public: open a support chat. The token is the only way back into it. `page` puts that screen's topics first. */
    supportOpen: (page?: string) =>
      json<SupportThread>(`/v1/support/threads${queryString({ page })}`, { method: "POST", body: body({}) }),
    supportRead: (threadId: string, token: string, page?: string) =>
      json<SupportThread>(`/v1/support/threads/${encodeURIComponent(threadId)}${queryString({ page })}`, {
        headers: { "X-Orbit-Support-Token": token },
      }),
    supportSend: (threadId: string, token: string, text: string, choice?: string, page?: string) =>
      json<SupportThread>(`/v1/support/threads/${encodeURIComponent(threadId)}/messages`, {
        method: "POST",
        body: body({ token, text, ...(choice ? { choice } : {}), ...(page ? { page } : {}) }),
      }),
    supportHandoff: (threadId: string, token: string, name: string, email: string) =>
      json<SupportThread>(`/v1/support/threads/${encodeURIComponent(threadId)}/handoff`, {
        method: "POST",
        body: body({ token, name, email }),
      }),
    /** Public: the visitor deletes their own chat (and the Orbit team's copy of it), with its token. */
    supportDelete: (threadId: string, token: string) =>
      json<void>(`/v1/support/threads/${encodeURIComponent(threadId)}`, {
        method: "DELETE",
        headers: { "X-Orbit-Support-Token": token },
      }),
    /** Admin: chats waiting for a person, or every recent chat. */
    adminSupport: (only: "waiting" | "all" = "waiting") =>
      json<SupportAdminItem[]>(`/v1/admin/support?only=${only}`),
    adminSupportThread: (threadId: string) =>
      json<SupportThread>(`/v1/admin/support/${encodeURIComponent(threadId)}`),
    adminSupportReply: (threadId: string, text: string) =>
      json<SupportThread>(`/v1/admin/support/${encodeURIComponent(threadId)}/reply`, {
        method: "POST",
        body: body({ text }),
      }),
    adminSupportClose: (threadId: string) =>
      json<SupportThread>(`/v1/admin/support/${encodeURIComponent(threadId)}/close`, { method: "POST" }),
    /** Admin: the Contact page's messages, newest first ("todo" = new and open), with the counts per status. */
    adminInbox: (query: InboxQuery = {}) =>
      json<InboxPage>(`/v1/admin/inbox${queryString({ ...query, q: query.q?.trim() })}`),
    /** Admin: one message in full; an unread one is marked read. */
    adminInboxMessage: (messageId: string) => json<InboxMessage>(`/v1/admin/inbox/${encodeURIComponent(messageId)}`),
    /** Admin: done, spam, open again or back to unread; the private note. */
    updateInboxMessage: (messageId: string, patch: InboxMessagePatch) =>
      json<InboxMessage>(`/v1/admin/inbox/${encodeURIComponent(messageId)}`, { method: "PATCH", body: body(patch) }),
    /** Admin: email the sender from Orbit (Reply-To you); the message is then done. */
    replyInboxMessage: (messageId: string, text: string) =>
      json<InboxMessage>(`/v1/admin/inbox/${encodeURIComponent(messageId)}/reply`, {
        method: "POST",
        body: body({ text }),
      }),
    deleteInboxMessage: (messageId: string) =>
      json<void>(`/v1/admin/inbox/${encodeURIComponent(messageId)}`, { method: "DELETE" }),
    /** Admin: grant a plan for a while, approve for good, or revoke. */
    setUserAccess: (userId: string, change: AccessChange) =>
      json<AdminUser>(`/v1/admin/users/${encodeURIComponent(userId)}/access`, { method: "POST", body: body(change) }),
    /** Admin: UPI payments ("submitted" = a UTR waiting to be checked). */
    adminPayments: (only: "submitted" | "all" = "submitted", offset = 0) =>
      json<AdminPayments>(`/v1/admin/payments${queryString({ only, ...(offset ? { offset } : {}) })}`),
    /** Admin: ask Razorpay now about open orders (the server also does this on its own every few minutes). */
    adminReconcile: () => json<ReconcileResult>("/v1/admin/payments/reconcile", { method: "POST", body: body({}) }),
    /** Admin: creator and campus codes (and every invite link together), sign-ups to commission, and what to review. */
    adminReferrals: () => json<AdminReferrals>("/v1/admin/referrals"),
    createReferralCode: (req: AdminReferralCodeCreate) =>
      json<AdminReferralCode>("/v1/admin/referrals/codes", { method: "POST", body: body(req) }),
    updateReferralCode: (codeId: string, patch: AdminReferralCodePatch) =>
      json<AdminReferralCode>(`/v1/admin/referrals/codes/${encodeURIComponent(codeId)}`, { method: "PATCH", body: body(patch) }),
    /** Admin: the referral report as a CSV file (₹ and $ in their own columns). */
    adminReferralsCsv: async () => (await raw("/v1/admin/referrals/export")).blob(),
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
  if (status === 429) return "You're going a little fast. Wait a few seconds, then try again.";
  if (status >= 500) return "Orbit had a problem. Try again shortly.";
  return `Request failed (${status}).`;
}

export function base64ToBlob(base64: string, type = "image/png"): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}
