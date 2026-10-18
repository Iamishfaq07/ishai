import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// public/sw.js runs in a fake worker scope: what it answers, and above all what it leaves alone.
const SOURCE = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

type Handler = (event: unknown) => void;

function worker(network: (req: Request) => Promise<Response>, existing: string[] = []) {
  const handlers: Record<string, Handler> = {};
  const stored = new Map<string, Response>();
  // Caches the browser already has (an older worker's, the page's own), and the ones the worker deletes.
  const names = new Set(existing);
  const deleted: string[] = [];
  const self = {
    location: new URL("https://orbitanswer.com/sw.js"),
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    registration: { navigationPreload: { enable: async () => {} }, unregister: async () => true },
  };
  const caches = {
    open: async () => ({ put: async (key: string, res: Response) => void stored.set(key, res) }),
    keys: async () => [...names, ...([...stored.keys()].length ? ["orbit-offline-v1"] : [])],
    delete: async (name: string) => {
      deleted.push(name);
      return names.delete(name);
    },
    match: async (key: string) => stored.get(key)?.clone(),
  };
  const fetchFn = (input: string | { url: string }) =>
    network(new Request(new URL(typeof input === "string" ? input : input.url, "https://orbitanswer.com")));
  new Function("self", "caches", "fetch", SOURCE)(self, caches, fetchFn);

  async function install(): Promise<void> {
    let done: Promise<unknown> = Promise.resolve();
    handlers.install!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  }
  /** What the worker answers for a request: undefined when it lets the browser handle it untouched. */
  async function answer(url: string, init: { mode?: RequestMode; method?: string } = {}): Promise<Response | undefined> {
    let answered: Promise<Response> | undefined;
    const request = { url, mode: init.mode ?? "navigate", method: init.method ?? "GET" } as Request;
    handlers.fetch!({ request, preloadResponse: Promise.resolve(undefined), respondWith: (p: Promise<Response>) => (answered = p) });
    return answered;
  }
  async function activate(): Promise<void> {
    let done: Promise<unknown> = Promise.resolve();
    handlers.activate!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  }
  return { install, answer, activate, deleted };
}

const page = (body: string) => new Response(body, { headers: { "content-type": "text/html" } });

describe("the offline page's service worker", () => {
  it("never answers the API, other sites, the app's files or anything but a page load", async () => {
    const sw = worker(async () => page("online"));
    await sw.install();
    expect(await sw.answer("https://orbitanswer.com/api/v1/auth/me")).toBeUndefined();
    expect(await sw.answer("https://orbitanswer.com/api")).toBeUndefined();
    expect(await sw.answer("https://orbitanswer.com/assets/index-abc.js", { mode: "cors" })).toBeUndefined();
    expect(await sw.answer("https://orbitanswer.com/jobs", { mode: "cors" })).toBeUndefined(); // a fetch, not a load
    expect(await sw.answer("https://orbitanswer.com/contact", { method: "POST" })).toBeUndefined();
    expect(await sw.answer("https://checkout.razorpay.com/v1/checkout.js")).toBeUndefined();
  });

  it("loads pages from the network as they are, and shows the offline page only when that fails", async () => {
    let online = true;
    const sw = worker(async (req) => {
      if (!online) throw new TypeError("Failed to fetch");
      return new URL(req.url).pathname === "/offline.html" ? page("You're offline") : page(`page ${new URL(req.url).pathname}`);
    });
    await sw.install();
    expect(await (await sw.answer("https://orbitanswer.com/jobs"))!.text()).toBe("page /jobs");
    online = false;
    const offline = (await sw.answer("https://orbitanswer.com/jobs"))!;
    expect(await offline.text()).toBe("You're offline");
    expect(offline.headers.get("content-type")).toContain("text/html");
  });

  it("clears only its own old copies when it takes over, never the page's caches (Saba's voice clips)", async () => {
    const sw = worker(async () => page("You're offline"), ["orbit-offline-v0", "orbit-voice-v1"]);
    await sw.install();
    await sw.activate();
    expect(sw.deleted).toEqual(["orbit-offline-v0"]);
  });

  it("is switched off by one flag, kept in the file", () => {
    expect(SOURCE).toMatch(/^const RETIRE = false;$/m);
  });
});

describe("setUpOfflinePage", () => {
  it("registers nothing outside a production build", async () => {
    const { setUpOfflinePage } = await import("./offlinePage");
    expect(() => setUpOfflinePage({ PROD: false })).not.toThrow(); // node: no navigator.serviceWorker, no window
  });
});
