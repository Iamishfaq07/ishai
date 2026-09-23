import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIO_CHANNEL, PROTOCOL_VERSION, type ServerEvent } from "@orbit/types";
import { LiveClient, type WebSocketLike } from "./client";
import { encodeAudioBytes, encodeAudioFrame, parseServerFrame, toWebSocketUrl } from "./framing";

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  binaryType: BinaryType = "blob";
  onopen: ((ev: Event) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  sent: Array<string | ArrayBuffer> = [];

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }
  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
  // test helpers
  open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
  receive(data: unknown): void {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) } as MessageEvent);
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" } as CloseEvent);
  }
  jsonSent(): Array<{ type: string; data: unknown }> {
    return this.sent.filter((d): d is string => typeof d === "string").map((d) => JSON.parse(d) as { type: string; data: unknown });
  }
}

/** Drains pending promise callbacks (fake timers don't mock microtasks). */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Advance fake time in steps, draining microtasks between (async ticket fetches). */
async function advance(ms: number, steps = 10): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await flush();
    await vi.advanceTimersByTimeAsync(ms / steps);
  }
  await flush();
}

function makeClient(overrides: Partial<ConstructorParameters<typeof LiveClient>[0]> = {}) {
  let tickets = 0;
  return new LiveClient({
    apiBaseUrl: "https://api.orbit.test/",
    sessionId: "s1",
    getTicket: async () => `ticket-${++tickets}`,
    createSocket: (url) => new FakeSocket(url),
    backoffMs: 100,
    maxBackoffMs: 400,
    maxAttempts: 3,
    ...overrides,
  });
}

beforeEach(() => {
  FakeSocket.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("framing", () => {
  it("prefixes the channel byte and writes PCM16 little-endian", () => {
    const buf = encodeAudioFrame(AUDIO_CHANNEL.system, new Int16Array([1, -2, 0x1234]));
    const bytes = new Uint8Array(buf);
    expect(bytes.length).toBe(7);
    expect(Array.from(bytes)).toEqual([1, 0x01, 0x00, 0xfe, 0xff, 0x34, 0x12]);
  });

  it("wraps pre-encoded bytes", () => {
    const bytes = new Uint8Array(encodeAudioBytes(AUDIO_CHANNEL.mic, new Uint8Array([9, 8, 7, 6])));
    expect(Array.from(bytes)).toEqual([0, 9, 8, 7, 6]);
  });

  it("builds the ws url from an http base", () => {
    expect(toWebSocketUrl("https://api.orbit.test/", "s 1", "a/b")).toBe(
      "wss://api.orbit.test/v1/sessions/s%201/live?ticket=a%2Fb",
    );
    expect(toWebSocketUrl("http://localhost:8000", "s1", "t")).toBe("ws://localhost:8000/v1/sessions/s1/live?ticket=t");
  });

  it("rejects malformed, wrong-version, and unknown frames", () => {
    expect(parseServerFrame("not json")).toBeNull();
    expect(parseServerFrame(JSON.stringify({ v: 2, type: "error", ts: 1, data: {} }))).toBeNull();
    expect(parseServerFrame(JSON.stringify({ v: 1, type: "nope", ts: 1, data: {} }))).toBeNull();
    expect(parseServerFrame(JSON.stringify({ v: 1, type: "error", ts: 1, data: { code: "x", message: "y" } }))?.type).toBe(
      "error",
    );
  });
});

describe("LiveClient", () => {
  it("fetches a ticket, connects, sends session.start on open, and flushes queued control messages", async () => {
    const client = makeClient({ onOpen: (c) => c.send("session.start", { settings: { length: "short" } }) });
    client.send("answer.clear", {});
    client.connect();
    await flush();

    const socket = FakeSocket.instances[0] as FakeSocket;
    expect(socket.url).toBe("wss://api.orbit.test/v1/sessions/s1/live?ticket=ticket-1");
    expect(socket.binaryType).toBe("arraybuffer");
    socket.open();

    expect(socket.jsonSent().map((m) => m.type)).toEqual(["session.start", "answer.clear"]);
    expect(socket.jsonSent()[0]).toMatchObject({ v: PROTOCOL_VERSION, type: "session.start" });
    expect(client.connectionStatus).toBe("open");
  });

  it("drops audio while disconnected but sends it when open", async () => {
    const client = makeClient();
    expect(client.sendAudio(AUDIO_CHANNEL.mic, new Int16Array([1]))).toBe(false);
    client.connect();
    await flush();
    const socket = FakeSocket.instances[0] as FakeSocket;
    socket.open();
    expect(client.sendAudio(AUDIO_CHANNEL.mic, new Int16Array([1, 2]))).toBe(true);
    expect(socket.sent.at(-1)).toBeInstanceOf(ArrayBuffer);
  });

  it("dispatches valid server events only", async () => {
    const client = makeClient();
    const received: ServerEvent[] = [];
    client.on((e) => received.push(e));
    client.connect();
    await flush();
    const socket = FakeSocket.instances[0] as FakeSocket;
    socket.open();
    socket.receive({ v: 1, type: "state.changed", ts: 1, data: { state: "listening" } });
    socket.receive("garbage");
    expect(received.map((e) => e.type)).toEqual(["state.changed"]);
  });

  it("reconnects with a fresh ticket after an unexpected drop and reports isReconnect", async () => {
    vi.useFakeTimers();
    const opens: boolean[] = [];
    const client = makeClient({ onOpen: (_c, isReconnect) => opens.push(isReconnect) });
    const statuses: string[] = [];
    client.onStatus((s) => statuses.push(s));

    client.connect();
    await flush();
    (FakeSocket.instances[0] as FakeSocket).open();
    (FakeSocket.instances[0] as FakeSocket).drop(1006);
    expect(client.connectionStatus).toBe("reconnecting");

    await advance(1000);
    const second = FakeSocket.instances[1] as FakeSocket;
    expect(second.url).toContain("ticket=ticket-2");
    second.open();
    expect(opens).toEqual([false, true]);
    expect(statuses).toContain("reconnecting");
    expect(client.connectionStatus).toBe("open");
  });

  it("does not reconnect after a terminal close code", async () => {
    vi.useFakeTimers();
    const client = makeClient();
    client.connect();
    await flush();
    (FakeSocket.instances[0] as FakeSocket).open();
    (FakeSocket.instances[0] as FakeSocket).drop(4004);
    await advance(5000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.connectionStatus).toBe("closed");
  });

  it("gives up after maxAttempts", async () => {
    vi.useFakeTimers();
    const client = makeClient({ getTicket: async () => Promise.reject(new Error("offline")) });
    client.connect();
    await advance(10_000, 40);
    expect(client.connectionStatus).toBe("closed");
  });

  it("stops on unauthorized ticket responses", async () => {
    const client = makeClient({ getTicket: async () => Promise.reject(Object.assign(new Error("401"), { status: 401 })) });
    client.connect();
    await flush();
    expect(client.connectionStatus).toBe("closed");
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("close() is final — no reconnect", async () => {
    vi.useFakeTimers();
    const client = makeClient();
    client.connect();
    await flush();
    (FakeSocket.instances[0] as FakeSocket).open();
    client.close();
    await advance(5000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.connectionStatus).toBe("closed");
  });
});
