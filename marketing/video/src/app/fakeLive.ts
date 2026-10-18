/**
 * The live session's WebSocket, in the page: a scenario plays the server's side (docs/PROTOCOL.md) on the virtual
 * clock, and the real live page draws it with its real components. What the page sends (audio, settings) is kept
 * in `sent` and otherwise ignored.
 */
import { real } from "./virtualTime";

type Listener = (ev: Event) => void;

export class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  extensions = "";
  protocol = "";
  url: string;
  onopen: Listener | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: Listener | null = null;
  sent: unknown[] = [];
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string | URL) {
    this.url = String(url);
    sockets.push(this);
    real.setTimeout(() => {
      this.readyState = 1;
      this.fire("open", new Event("open"));
      for (const f of onConnect) f(this);
    }, 0);
  }

  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatchEvent(ev: Event): boolean {
    this.fire(ev.type, ev);
    return true;
  }
  private fire(type: string, ev: Event): void {
    const on = (this as unknown as Record<string, unknown>)[`on${type}`];
    if (typeof on === "function") (on as Listener).call(this, ev);
    for (const fn of this.listeners.get(type) ?? []) fn.call(this, ev);
  }

  send(data: unknown): void {
    if (typeof data !== "string") return; // audio frames
    try {
      this.sent.push(JSON.parse(data));
    } catch {
      this.sent.push(data);
    }
  }
  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.fire("close", new CloseEvent("close", { code, reason, wasClean: true }));
  }

  /** A server → client event. */
  emit(type: string, data: unknown): void {
    if (this.readyState !== 1) return;
    this.fire("message", new MessageEvent("message", { data: JSON.stringify({ v: 1, type, ts: Date.now(), data }) }));
  }
}

export const sockets: FakeSocket[] = [];
const onConnect: Array<(s: FakeSocket) => void> = [];

/** Called with each socket as it opens (a scenario greets it as the server would). */
export function whenConnected(fn: (s: FakeSocket) => void): void {
  onConnect.push(fn);
}

/** The newest open socket's server side. */
export function server(type: string, data: unknown): void {
  const s = [...sockets].reverse().find((x) => x.readyState === 1);
  s?.emit(type, data);
}

const RealWebSocket = window.WebSocket;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).WebSocket = function (url: string | URL, protocols?: string | string[]) {
  const u = new URL(String(url), location.href);
  if (u.host === location.host && u.pathname.startsWith("/api/")) return new FakeSocket(u.href);
  return new RealWebSocket(url, protocols);
} as unknown as typeof WebSocket;
Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
