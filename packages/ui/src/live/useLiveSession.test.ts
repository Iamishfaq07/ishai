import { afterEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, type LiveSettings } from "@orbit/types";
import { LiveClient, type WebSocketLike } from "./client";
import { initialLiveState, liveReducer, type LiveAction, type LiveViewState } from "./reducer";
import { resumeSession } from "./useLiveSession";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  binaryType: BinaryType = "blob";
  onopen: ((ev: Event) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  sent: string[] = [];

  send(data: string | ArrayBuffer): void {
    if (typeof data === "string") this.sent.push(data);
  }
  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
  receive(type: string, data: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ v: PROTOCOL_VERSION, type, ts: Date.now(), data }) } as MessageEvent);
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "" } as CloseEvent);
  }
  frames(): Array<{ type: string; data: Record<string, unknown> }> {
    return this.sent.map((d) => JSON.parse(d) as { type: string; data: Record<string, unknown> });
  }
}

async function settle(ms = 50): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(ms / 5);
  }
}

/** useLiveSession's wiring without React: client events and status go through the reducer, and every open resumes the
 * session from the current state. `act` does what the hook's actions do (dispatch, then send). */
function harness(initial: LiveViewState) {
  let live = initial;
  const sockets: FakeSocket[] = [];
  const dispatch = (a: LiveAction) => {
    live = liveReducer(live, a);
  };
  const client = new LiveClient({
    apiBaseUrl: "https://api.orbit.test",
    sessionId: "s1",
    getTicket: async () => "ticket",
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    backoffMs: 10,
    maxBackoffMs: 10,
    onOpen: (c) => resumeSession(c, live),
  });
  client.on(dispatch);
  client.onStatus((status, detail, info) =>
    dispatch({ type: "local/connection", status, ...(detail ? { detail } : {}), ...(info ? { info } : {}) }),
  );
  return {
    client,
    sockets,
    dispatch,
    get live() {
      return live;
    },
  };
}

const SERVER_DEFAULTS: LiveSettings = { auto_answer: true, length: "standard", style: "natural", thinking: "off", response_timing: "balanced" };

afterEach(() => {
  vi.useRealTimers();
});

describe("reconnecting resumes the session the user had", () => {
  it("sends the settings the user asked for, not the server's defaults shown back", async () => {
    vi.useFakeTimers();
    const h = harness(initialLiveState({ auto_answer: true, length: "standard", style: "natural", thinking: "high" }));
    h.client.connect();
    await settle();
    const first = h.sockets[0]!;
    first.open();
    expect(first.frames()[0]).toMatchObject({ type: "session.start", data: { settings: { thinking: "high" } } });
    first.receive("session.started", { state: "listening", settings: SERVER_DEFAULTS });
    expect(h.live.settings.thinking).toBe("high");

    // Auto-answer off and a shorter length, mid-session.
    h.dispatch({ type: "local/settings", settings: { auto_answer: false, length: "short" } });
    h.client.send("settings.update", { auto_answer: false, length: "short" });

    first.drop();
    await settle();
    const second = h.sockets[1]!;
    second.open();
    expect(second.frames()[0]).toEqual({
      v: PROTOCOL_VERSION,
      type: "session.start",
      data: { settings: { auto_answer: false, length: "short", style: "natural", thinking: "high" } },
      ts: expect.any(Number),
    });
    second.receive("session.started", { state: "listening", settings: SERVER_DEFAULTS });
    expect(h.live.settings).toMatchObject({ auto_answer: false, length: "short", thinking: "high" });
  });

  it("pauses the new connection's engine again, and the UI never shows it listening", async () => {
    vi.useFakeTimers();
    const h = harness(initialLiveState());
    h.client.connect();
    await settle();
    const first = h.sockets[0]!;
    first.open();
    first.receive("session.started", { state: "listening", settings: SERVER_DEFAULTS });
    h.dispatch({ type: "local/pause", paused: true });
    h.client.send("session.pause", {});
    first.receive("session.paused", { state: "paused", settings: SERVER_DEFAULTS });

    first.drop();
    await settle();
    const second = h.sockets[1]!;
    second.open();
    expect(second.frames().map((f) => f.type)).toEqual(["session.start", "session.pause"]);
    second.receive("session.started", { state: "listening", settings: SERVER_DEFAULTS });
    second.receive("state.changed", { state: "listening" });
    expect(h.live.state).toBe("paused");
  });

  it("a pause pressed while disconnected reaches the next connection", async () => {
    vi.useFakeTimers();
    const h = harness(initialLiveState());
    h.client.connect();
    await settle();
    h.sockets[0]!.open();
    h.sockets[0]!.drop();
    h.dispatch({ type: "local/pause", paused: true });
    h.client.send("session.pause", {});
    expect(h.live.state).toBe("paused");
    await settle();
    h.sockets[1]!.open();
    // The queued pause follows the one the reconnect sends: harmless, pausing a paused engine changes nothing.
    expect(h.sockets[1]!.frames().map((f) => f.type)).toEqual(["session.start", "session.pause", "session.pause"]);
  });

  it("nothing extra after a resume: a resumed session reconnects listening", async () => {
    vi.useFakeTimers();
    const h = harness(initialLiveState());
    h.client.connect();
    await settle();
    h.sockets[0]!.open();
    h.dispatch({ type: "local/pause", paused: true });
    h.dispatch({ type: "local/pause", paused: false });
    h.sockets[0]!.drop();
    await settle();
    h.sockets[1]!.open();
    expect(h.sockets[1]!.frames().map((f) => f.type)).toEqual(["session.start"]);
  });
});
