// The runner's recovery after its service worker was stopped mid-application, against a stand-in `chrome` and Orbit
// API (the browser can't be made to kill a worker at an exact moment in an end-to-end run). Before the submit button
// was pressed: nothing is reported and the same leased packet is filled again. After: never pressed again; reported
// to the candidate as needing them.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Store = Record<string, unknown>;
const store: Store = {};
const calls: { method: string; path: string; body?: unknown }[] = [];
const created: string[] = [];
let nextPacket: unknown = null;

const PACKET = {
  id: "11111111-2222-3333-4444-555555555555",
  job: { url: "https://jobs.ashbyhq.com/notion/x", apply_url: "https://jobs.ashbyhq.com/notion/x/application", ats: "ashby", company: "Notion", title: "Engineer" },
  resume: { filename: "Asha Rao - Resume.pdf", download_url: "http://orbit.test/api/v1/apply/x/resume.pdf?exp=1&sig=s" },
  cover_letter: null,
  fields: { first_name: "Asha", last_name: "Rao", email: "a@example.com", phone: "", location: "", linkedin: "", website: "", github: "" },
  answers: [],
  eeo: "decline",
  not_before: new Date(Date.now() - 60_000).toISOString(),
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  lease_expires_at: new Date(Date.now() + 900_000).toISOString(),
};

function install() {
  const local = {
    get: async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
    set: async (v: Store) => void Object.assign(store, v),
    remove: async (keys: string[]) => keys.forEach((k) => delete store[k]),
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local },
    windows: { remove: vi.fn(async () => undefined), create: vi.fn(async (o: { url: string }) => (created.push(o.url), { id: 9, tabs: [{ id: 99 }] })) },
    tabs: { get: vi.fn(async () => ({ id: 7, url: "https://jobs.ashbyhq.com/notion/x/application", status: "complete" })), group: vi.fn(async () => 1), onRemoved: { addListener() {}, removeListener() {} }, update: vi.fn() },
    tabGroups: { update: vi.fn() },
    alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setTitle: vi.fn() },
    permissions: { contains: vi.fn(async () => true) },
    scripting: { executeScript: vi.fn(async () => [{ result: null }]) },
    runtime: { getPlatformInfo: vi.fn() },
  };
  globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, "");
    calls.push({ method: init?.method ?? "GET", path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === "/v1/apply/status") return new Response(JSON.stringify({ configured: true, paused: false, today: 1, limit: 10, next_due_at: null, why_not: null, ready: 0, needs_you: 0, quota_left: 4, sites_paused: [] }), { status: 200 });
    if (path === "/v1/apply/next") return nextPacket ? new Response(JSON.stringify(nextPacket), { status: 200 }) : new Response(null, { status: 204 });
    if (path.endsWith("/result")) return new Response(JSON.stringify({ id: PACKET.id, status: "needs_you", charged: false, tracker_id: null }), { status: 200 });
    if (path.includes("resume.pdf")) return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-type": "application/pdf" } });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  calls.length = 0;
  created.length = 0;
  nextPacket = null;
  install();
  store.token = "t";
  store.autoApply = { enabled: true, paused: false };
});

const results = () => calls.filter((c) => c.path.endsWith("/result"));

describe("a service worker stopped mid-application", () => {
  it("after submit was pressed: reports needs_you with the page it was on, and never runs that packet again", async () => {
    const { recoverStale, tick } = await import("./runner");
    store.autoApplyCurrent = { id: PACKET.id, company: "Notion", title: "Engineer", url: PACKET.job.url, ats: "ashby", tabId: 7, windowId: 9, startedAt: Date.now() - 5000, submitAt: Date.now() - 1000 };
    await recoverStale();
    expect(store.autoApplyCurrent).toBeUndefined();
    expect(results()).toHaveLength(1);
    expect(results()[0]!.body).toMatchObject({ status: "needs_you", reason: "error", final_url: "https://jobs.ashbyhq.com/notion/x/application", submitted: { fields: {}, answers: [] } });
    expect((store.autoApplyHistory as { id: string; detail: string }[])[0]).toMatchObject({ id: PACKET.id, status: "needs_you" });
    // Should Orbit hand the same packet back, it's reported again and never opened.
    nextPacket = PACKET;
    await tick();
    expect(created).toEqual([]);
    expect(results()).toHaveLength(2);
    expect(results()[1]!.body).toMatchObject({ status: "needs_you", reason: "error" });
  });

  it("before submit was pressed: nothing is reported, and the same leased packet is opened again", async () => {
    const { recoverStale } = await import("./runner");
    store.autoApplyCurrent = { id: PACKET.id, company: "Notion", title: "Engineer", tabId: 7, windowId: 9, startedAt: Date.now() - 5000 };
    await recoverStale();
    expect(store.autoApplyCurrent).toBeUndefined();
    expect(results()).toHaveLength(0);
    expect(store.autoApplyRecovered).toBeUndefined();
  });
});
