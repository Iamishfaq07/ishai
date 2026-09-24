import { describe, expect, it } from "vitest";
import { ApiError, createApiClient } from "./client";

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
