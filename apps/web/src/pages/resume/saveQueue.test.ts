import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaveQueue, drafts, type SaveResult } from "./saveQueue";

/** A server stand-in: each PUT waits until the test settles it, and the "database" keeps whichever write lands. */
function server() {
  const pending: Array<{ id: string; text: string; base: number | undefined; settle: () => void }> = [];
  const db = new Map<string, { text: string; revision: number }>();
  const send = (id: string, text: string, base: number | undefined) =>
    new Promise<SaveResult>((resolve, reject) => {
      pending.push({
        id,
        text,
        base,
        settle: () => {
          const row = db.get(id) ?? { text: "", revision: 0 };
          if (base !== undefined && base !== row.revision) {
            reject(Object.assign(new Error("conflict"), { status: 409 }));
            return;
          }
          const next = { text, revision: row.revision + 1 };
          db.set(id, next);
          resolve({ revision: next.revision });
        },
      });
    });
  return { pending, db, send };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("resume save queue", () => {
  it("a 409 for a save this tab already replaced reads as superseded, not as another tab's edit", async () => {
    let fail: ((e: unknown) => void) | null = null;
    const q = createSaveQueue<string>(
      (_id, text) =>
        new Promise<SaveResult>((resolve, reject) => {
          if (text === "old") fail = reject;
          else resolve({ revision: 2 });
        }),
    );
    const old = q.save("A", "old");
    const newer = q.save("A", "new"); // waiting behind the old one
    fail!(Object.assign(new Error("conflict"), { status: 409 }));
    await expect(old).rejects.toMatchObject({ name: "AbortError" });
    await expect(newer).resolves.toEqual({ revision: 2 });
  });

  it("a 409 with nothing newer from this tab stays a conflict", async () => {
    const q = createSaveQueue<string>(async () => {
      throw Object.assign(new Error("conflict"), { status: 409 });
    });
    await expect(q.save("A", "x")).rejects.toMatchObject({ status: 409 });
  });

  it("aborts stale network saves as soon as text changes and advances a writer's monotonic revision", async () => {
    const requests: Array<{ signal: AbortSignal; clientRevision: number; clientId: string }> = [];
    const q = createSaveQueue<string>((_id, _payload, _base, request) => {
      requests.push(request);
      return new Promise((resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(new DOMException("superseded", "AbortError")));
        if (request.clientRevision === 2) resolve({ revision: 2 });
      });
    });
    const first = q.save("A", "older").catch((e: unknown) => e);
    q.supersede("A");
    const second = q.save("A", "newest");
    expect((await first as DOMException).name).toBe("AbortError");
    await second;
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(requests.map((r) => r.clientRevision)).toEqual([1, 2]);
    expect(requests[0]!.clientId).toBe(requests[1]!.clientId);
  });
  it("(the defect) two unqueued saves, as the old editor sent them, let the older text land last", async () => {
    const s = server();
    const v1 = s.send("A", "v1", undefined); // autosave in flight
    const v2 = s.send("A", "v2", undefined); // the route-change flush, not waiting for it
    s.pending[1]!.settle(); // the newer write reaches the server first
    s.pending[0]!.settle(); // then the older one
    await Promise.all([v1, v2]);
    expect(s.db.get("A")?.text).toBe("v1"); // the newer edits are gone
  });

  it("never has two saves of one resume in flight, so an older write can't land last", async () => {
    const s = server();
    const q = createSaveQueue<string>(s.send);
    q.setRevision("A", 0);
    const v1 = q.save("A", "v1"); // the autosave
    const v2 = q.save("A", "v2"); // the flush when the address moves to B
    await tick();
    expect(s.pending.map((p) => p.text)).toEqual(["v1"]); // v2 waits for v1
    s.pending[0]!.settle();
    await v1;
    await tick();
    expect(s.pending.map((p) => p.text)).toEqual(["v1", "v2"]);
    s.pending[1]!.settle();
    await v2;
    expect(s.db.get("A")).toEqual({ text: "v2", revision: 2 });
  });

  it("sends only the newest of several waiting saves, and settles every caller with it", async () => {
    const s = server();
    const q = createSaveQueue<string>(s.send);
    q.setRevision("A", 0);
    const first = q.save("A", "v1");
    const waiting = [q.save("A", "v2"), q.save("A", "v3"), q.save("A", "v4")];
    await tick();
    s.pending[0]!.settle();
    await first;
    await tick();
    expect(s.pending.map((p) => p.text)).toEqual(["v1", "v4"]);
    s.pending[1]!.settle();
    expect(await Promise.all(waiting)).toEqual([{ revision: 2 }, { revision: 2 }, { revision: 2 }]);
    expect(s.db.get("A")?.text).toBe("v4");
    await tick();
    expect(q.busy("A")).toBe(false);
  });

  it("A → B → A: each resume keeps its own order and B never waits on A", async () => {
    const s = server();
    const q = createSaveQueue<string>(s.send);
    q.setRevision("A", 0);
    q.setRevision("B", 0);
    const a1 = q.save("A", "a1");
    const b1 = q.save("B", "b1");
    const a2 = q.save("A", "a2");
    await tick();
    expect(s.pending.map((p) => p.text)).toEqual(["a1", "b1"]);
    s.pending[1]!.settle(); // B finishes first
    await b1;
    s.pending[0]!.settle();
    await a1;
    await tick();
    s.pending[2]!.settle();
    await a2;
    expect(s.db.get("A")?.text).toBe("a2");
    expect(s.db.get("B")?.text).toBe("b1");
  });

  it("a stale tab gets a conflict instead of overwriting the other tab's save", async () => {
    const s = server();
    const tab1 = createSaveQueue<string>(s.send);
    const tab2 = createSaveQueue<string>(s.send);
    tab1.setRevision("A", 0);
    tab2.setRevision("A", 0); // both opened revision 0
    const saved = tab1.save("A", "from tab 1");
    await tick();
    s.pending[0]!.settle();
    await saved;
    const stale = tab2.save("A", "from tab 2");
    await tick();
    s.pending[1]!.settle();
    await expect(stale).rejects.toMatchObject({ status: 409 });
    expect(s.db.get("A")?.text).toBe("from tab 1");
  });

  it("a failed save keeps the queue usable for the next one", async () => {
    let fail = true;
    const q = createSaveQueue<string>(async () => {
      if (fail) throw new Error("offline");
      return { revision: 7 };
    });
    await expect(q.save("A", "x")).rejects.toThrow("offline");
    fail = false;
    await expect(q.save("A", "y")).resolves.toEqual({ revision: 7 });
    expect(q.revision("A")).toBe(7);
  });
});

describe("unsaved drafts", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a draft per account and resume until it's cleared", () => {
    drafts.keep("u1", "A", { title: "Mine" }, 3);
    expect(drafts.load<{ title: string }>("u1", "A")?.payload.title).toBe("Mine");
    expect(drafts.load("u2", "A")).toBeNull();
    drafts.clear("u1", "A");
    expect(drafts.load("u1", "A")).toBeNull();
  });
});
