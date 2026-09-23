import type {
  AdminConfig,
  AdminConfigUpdate,
  ApiErrorBody,
  AuthResponse,
  CreateSessionRequest,
  CreateTextDocumentRequest,
  DocumentKind,
  DocumentText,
  LiveTicket,
  LoginRequest,
  OrbitDocument,
  OrbitSession,
  PrivacyUpdate,
  RegisterRequest,
  ScreenshotAccepted,
  SessionDetail,
  UpdateDocumentRequest,
  Usage,
  User,
} from "@orbit/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = "http_error",
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

  async function raw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (options.auth.mode === "bearer") {
      const token = options.auth.getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
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
    return (await response.json()) as T;
  }

  const body = (value: unknown): string => JSON.stringify(value);

  return {
    baseUrl,

    // Auth
    register: (req: RegisterRequest) => json<AuthResponse>("/v1/auth/register", { method: "POST", body: body(req) }),
    login: (req: LoginRequest) => json<AuthResponse>("/v1/auth/login", { method: "POST", body: body(req) }),
    me: () => json<User>("/v1/auth/me"),
    logout: () => json<void>("/v1/auth/logout", { method: "POST" }),
    updatePrivacy: (req: PrivacyUpdate) => json<User>("/v1/auth/me/privacy", { method: "PATCH", body: body(req) }),
    deleteAccount: () => json<void>("/v1/auth/me", { method: "DELETE" }),
    logoutAll: () => json<void>("/v1/auth/logout-all", { method: "POST" }),
    requestVerification: () => json<{ status: string }>("/v1/auth/verify-email/request", { method: "POST" }),
    confirmVerification: (token: string) =>
      json<User>("/v1/auth/verify-email/confirm", { method: "POST", body: body({ token }) }),
    requestPasswordReset: (email: string) =>
      json<{ status: string }>("/v1/auth/password-reset/request", { method: "POST", body: body({ email }) }),
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
    deleteSession: (id: string) => json<void>(`/v1/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    exportSessionMarkdown: async (id: string): Promise<string> =>
      (await raw(`/v1/sessions/${encodeURIComponent(id)}/export.md`)).text(),
    liveTicket: (id: string) =>
      json<LiveTicket>(`/v1/sessions/${encodeURIComponent(id)}/live-ticket`, { method: "POST" }),
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

    // Admin / advanced settings
    adminStatus: () => json<{ is_admin: boolean }>("/v1/admin/status"),
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
