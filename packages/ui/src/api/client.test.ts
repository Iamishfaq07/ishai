import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_SUSPENDED, ApiError, DEFAULT_TIMEOUT_MS, LONG_TIMEOUT_MS, createApiClient, queryString, timeoutFor } from "./client";

type Call = { url: string; method: string; headers: Headers };

function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers) });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(next.status === 204 ? null : JSON.stringify(next.body ?? {}), { status: next.status });
  }) as typeof fetch;
  return { calls, impl };
}

const user = { id: "u", email: "a@b.c", name: null, email_verified: false, store_transcripts: true, store_screenshots: false };

describe("api client CSRF (cookie mode)", () => {
  it("sends the token from the latest auth response on state-changing requests only", async () => {
    const f = fakeFetch([
      { status: 200, body: { ...user, csrf_token: "tok-1" } }, // me()
      { status: 200, body: [] }, // listDocuments (GET)
      { status: 200, body: user }, // updatePrivacy (PATCH)
      { status: 204 }, // logout
      { status: 200, body: user }, // updatePrivacy after logout
    ]);
    const api = createApiClient({ baseUrl: "https://api.test", auth: { mode: "cookie" }, fetchImpl: f.impl });
    await api.me();
    await api.listDocuments();
    await api.updatePrivacy({ store_transcripts: false });
    await api.logout();
    await api.updatePrivacy({ store_transcripts: true });
    expect(f.calls[0]!.headers.get("X-CSRF-Token")).toBeNull();
    expect(f.calls[1]!.headers.get("X-CSRF-Token")).toBeNull(); // GET
    expect(f.calls[2]!.headers.get("X-CSRF-Token")).toBe("tok-1");
    expect(f.calls[3]!.headers.get("X-CSRF-Token")).toBe("tok-1"); // logout itself
    expect(f.calls[4]!.headers.get("X-CSRF-Token")).toBeNull(); // forgotten after logout
  });

  it("picks the token up from login/register responses ({ user: { csrf_token } })", async () => {
    const f = fakeFetch([{ status: 200, body: { user: { ...user, csrf_token: "tok-2" }, access_token: "x" } }, { status: 204 }]);
    const api = createApiClient({ baseUrl: "https://api.test", auth: { mode: "cookie" }, fetchImpl: f.impl });
    await api.login({ email: "a@b.c", password: "pw" });
    await api.deleteSession("s1");
    expect(f.calls[1]!.headers.get("X-CSRF-Token")).toBe("tok-2");
  });

  it("never sends it in bearer mode (desktop)", async () => {
    const f = fakeFetch([{ status: 200, body: { ...user, csrf_token: "tok-3" } }, { status: 204 }]);
    const api = createApiClient({ baseUrl: "https://api.test", auth: { mode: "bearer", getToken: () => "jwt" }, fetchImpl: f.impl });
    await api.me();
    await api.deleteSession("s1");
    expect(f.calls[1]!.headers.get("X-CSRF-Token")).toBeNull();
    expect(f.calls[1]!.headers.get("Authorization")).toBe("Bearer jwt");
  });
});

describe("api client errors", () => {
  it("maps structured { detail: { code, message } } errors", async () => {
    const f = fakeFetch([{ status: 403, body: { detail: { code: "email_unverified", message: "Verify your email." } } }]);
    const api = createApiClient({ baseUrl: "https://api.test", auth: { mode: "cookie" }, fetchImpl: f.impl });
    const err = await api.liveTicket("s1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("email_unverified");
    expect((err as ApiError).message).toBe("Verify your email.");
  });

  it("maps { error: { code, message } } (CSRF rejections)", async () => {
    const f = fakeFetch([{ status: 403, body: { error: { code: "csrf_token", message: "Reload the page." } } }]);
    const api = createApiClient({ baseUrl: "https://api.test", auth: { mode: "cookie" }, fetchImpl: f.impl });
    const err = (await api.deleteSession("s").catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("csrf_token");
  });
});

/** A fetch that never answers (a stalled phone connection) but, like the real one, fails when it is aborted. */
function stalledFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
}

describe("api client timeouts and cancelling", () => {
  afterEach(() => vi.useRealTimers());

  it("gives up on a stalled request with a message the screen can show", async () => {
    vi.useFakeTimers();
    const api = createApiClient({ baseUrl: "https://api.test", auth: { mode: "cookie" }, fetchImpl: stalledFetch() });
    const pending = api.listDocuments().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1);
    const err = await pending;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: "timeout" });
  });

  it("gives AI calls, uploads and exports far longer than ordinary ones", () => {
    expect(timeoutFor("/v1/resumes/score")).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutFor("/v1/resumes/123")).toBe(DEFAULT_TIMEOUT_MS);
    for (const slow of ["/v1/resumes/import", "/v1/resumes/import-file", "/v1/resumes/suggest",
      "/v1/resumes/cover-letter", "/v1/resumes/docx", "/v1/prep", "/v1/sessions/s1/review",
      "/v1/sessions/s1/follow-up?refresh=true", "/v1/stories/draft", "/v1/auth/me/export",
      "/v1/documents/d1/text"]) {
      expect(timeoutFor(slow), slow).toBe(LONG_TIMEOUT_MS);
    }
    expect(timeoutFor("/v1/documents", new FormData())).toBe(LONG_TIMEOUT_MS); // any upload
  });

  it("lets the caller cancel, and a cancel is not reported as a network error", async () => {
    const api = createApiClient({ baseUrl: "https://api.test", auth: { mode: "cookie" }, fetchImpl: stalledFetch() });
    const ctl = new AbortController();
    const pending = api.scoreResume({} as never, {} as never, "", { signal: ctl.signal }).catch((e: unknown) => e);
    ctl.abort();
    const err = await pending;
    expect(err).toBeInstanceOf(DOMException);
    expect(err).toMatchObject({ name: "AbortError" });
  });
});

describe("the resume maker's client", () => {
  it("uses the account endpoints for every tool (there's no signed-out maker)", async () => {
    const f = fakeFetch([]);
    const api = createApiClient({ baseUrl: "https://api.test", auth: { mode: "cookie" }, fetchImpl: f.impl });
    const data = { basics: {}, experience: [], education: [], skills: [], projects: [], certifications: [], extras: [] } as never;
    await api.scoreResume(data, {} as never, "");
    await api.suggestResume({ data });
    await api.importResume({ source: "text", text: "x" });
    await api.coverLetter(data, "");
    await api.resumeAllowance();
    expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/v1/resumes/score",
      "/v1/resumes/suggest",
      "/v1/resumes/import",
      "/v1/resumes/cover-letter",
      "/v1/resumes/allowance",
    ]);
    expect("guest" in api).toBe(false);
  });
});

describe("phone companion", () => {
  it("sends the share code in the body, never the URL (paths end up in access logs)", async () => {
    const seen: Array<{ url: string; method: string; body: unknown }> = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), method: init?.method ?? "GET", body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ session_id: "s1", title: "Acme", ticket: "t" }), { status: 200 });
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: "https://api.test", auth: { mode: "cookie" }, fetchImpl: impl });
    const code = "a-secret_code-123";
    expect(await api.redeemCompanion(code)).toEqual({ session_id: "s1", title: "Acme", ticket: "t" });
    expect(seen).toEqual([{ url: "https://api.test/v1/companion/redeem", method: "POST", body: { code } }]);
    expect(seen[0]!.url).not.toContain(code);
  });
});

describe("the admin console's client", () => {
  it("signs a suspended account out like an expired session, keeping the reason for the screen", async () => {
    const f = fakeFetch([
      { status: 403, body: { detail: { code: "account_suspended", message: "Your Orbit account is suspended." } } },
      { status: 403, body: { detail: { code: "email_unverified", message: "Verify your email." } } },
    ]);
    const onUnauthorized = vi.fn();
    const api = createApiClient({ baseUrl: "https://api.test", auth: { mode: "cookie" }, fetchImpl: f.impl, onUnauthorized });
    const err = (await api.listDocuments().catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe(ACCOUNT_SUSPENDED);
    expect(err.message).toBe("Your Orbit account is suspended.");
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await api.listDocuments().catch(() => undefined); // any other 403 is not a sign-out
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("builds list, CSV, audit and stats addresses from what's set, and deletes with the typed email", async () => {
    const seen: Array<{ url: string; method: string; body: string | null }> = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? String(init.body) : null });
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: "https://api.test", auth: { mode: "cookie" }, fetchImpl: impl });
    await api.adminUsers("pending");
    await api.adminUsers("paid", "  asha & co ", { sort: "paid", order: "desc", offset: 50, limit: 50 });
    await api.adminUsersCsv({ only: "active", q: "" });
    await api.adminAudit({ scope: "admin", user_id: "u1" });
    await api.adminStats(30, 330);
    await api.deleteUser("u/1", "a@b.c");
    expect(seen.map((s) => s.url.replace("https://api.test", ""))).toEqual([
      "/v1/admin/users?only=pending",
      "/v1/admin/users?only=paid&q=asha+%26+co&sort=paid&order=desc&offset=50&limit=50",
      "/v1/admin/users/export?only=active",
      "/v1/admin/audit?scope=admin&user_id=u1",
      "/v1/admin/stats?days=30&tz_offset=330",
      "/v1/admin/users/u%2F1",
    ]);
    expect(seen[5]).toMatchObject({ method: "DELETE", body: JSON.stringify({ confirm_email: "a@b.c" }) });
    expect(queryString({ a: undefined, b: "", c: 0, d: false })).toBe("?c=0&d=false");
  });

  it("sends the contact form and builds the Inbox's addresses", async () => {
    const seen: Array<{ url: string; method: string; body: string | null }> = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? String(init.body) : null });
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: "https://api.test", auth: { mode: "cookie" }, fetchImpl: impl });
    await api.sendContact({ name: "Asha", email: "a@b.c", topic: "payment", message: "Where are my credits?" });
    await api.adminInbox();
    await api.adminInbox({ status: "new", topic: "report_job", q: "  C-1A2B ", limit: 1 });
    await api.adminInboxMessage("m/1");
    await api.updateInboxMessage("m1", { status: "done" });
    await api.replyInboxMessage("m1", "Sorted.");
    await api.deleteInboxMessage("m1");
    expect(seen.map((s) => `${s.method} ${s.url.replace("https://api.test", "")}`)).toEqual([
      "POST /v1/contact",
      "GET /v1/admin/inbox",
      "GET /v1/admin/inbox?status=new&topic=report_job&q=C-1A2B&limit=1",
      "GET /v1/admin/inbox/m%2F1",
      "PATCH /v1/admin/inbox/m1",
      "POST /v1/admin/inbox/m1/reply",
      "DELETE /v1/admin/inbox/m1",
    ]);
    expect(JSON.parse(seen[0]!.body ?? "{}")).toMatchObject({ topic: "payment", name: "Asha" });
    expect(seen[5]!.body).toBe(JSON.stringify({ text: "Sorted." }));
  });
});

describe("the camera coach's last numbers", () => {
  it("go as a keepalive request when the page closes, so they outlive the tab", async () => {
    const seen: RequestInit[] = [];
    const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: "https://api.test", auth: { mode: "cookie" }, fetchImpl: impl });
    const metrics = { samples: 3, eye_contact: 0.5, smile: 0.1, head_still: 0.9 } as unknown as Parameters<typeof api.saveCameraMetrics>[1];
    await api.saveCameraMetrics("s1", metrics);
    await api.saveCameraMetrics("s1", metrics, true);
    expect(seen.map((i) => i.keepalive)).toEqual([false, true]);
  });
});
