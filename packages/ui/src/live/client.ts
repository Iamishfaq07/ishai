import type {
  AudioChannel,
  ClientEventMap,
  ClientEventType,
  ServerEvent,
} from "@orbit/types";
import {
  encodeAudioBytes,
  encodeAudioFrame,
  makeClientEvent,
  parseServerFrame,
  toWebSocketUrl,
} from "./framing";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

/** Minimal WebSocket surface so tests (and non-browser hosts) can inject an implementation. */
export interface WebSocketLike {
  readonly readyState: number;
  binaryType: BinaryType;
  onopen: ((ev: Event) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}
export type WebSocketFactory = (url: string) => WebSocketLike;

export interface LiveClientOptions {
  apiBaseUrl: string;
  sessionId: string;
  /** Fetches a fresh single-use ticket (POST /v1/sessions/{id}/live-ticket). Called on every (re)connect. */
  getTicket: () => Promise<string>;
  createSocket?: WebSocketFactory;
  /** Initial backoff in ms; doubles per attempt up to maxBackoffMs. */
  backoffMs?: number;
  maxBackoffMs?: number;
  /** Give up after this many consecutive failed attempts. */
  maxAttempts?: number;
  /** Called once per successful open — used to (re)send `session.start`, which the server treats as idempotent. */
  onOpen?: (client: LiveClient, isReconnect: boolean) => void;
}

const OPEN = 1;
/** Server close codes that mean "don't retry" (auth / session gone / ended). */
const TERMINAL_CLOSE_CODES = new Set([1000, 4001, 4003, 4004, 4009]);
const MAX_QUEUED_CONTROL = 64;

type EventListener = (event: ServerEvent) => void;
type StatusListener = (status: ConnectionStatus, detail?: string) => void;

export class LiveClient {
  private readonly opts: Required<Omit<LiveClientOptions, "onOpen">> & Pick<LiveClientOptions, "onOpen">;
  private socket: WebSocketLike | null = null;
  private status: ConnectionStatus = "closed";
  private attempts = 0;
  private everOpened = false;
  private closedByUser = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on close(); an in-flight open() from an older generation abandons itself. */
  private generation = 0;
  private opening = false;
  private readonly queue: string[] = [];
  private readonly eventListeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(options: LiveClientOptions) {
    this.opts = {
      apiBaseUrl: options.apiBaseUrl,
      sessionId: options.sessionId,
      getTicket: options.getTicket,
      createSocket: options.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike),
      backoffMs: options.backoffMs ?? 500,
      maxBackoffMs: options.maxBackoffMs ?? 8000,
      maxAttempts: options.maxAttempts ?? 12,
      onOpen: options.onOpen,
    };
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  connect(): void {
    this.closedByUser = false;
    this.attempts = 0; // user-initiated (re)connect: clear the give-up counter so backoff starts fresh
    if (this.socket || this.retryTimer || this.opening) return;
    void this.open();
  }

  close(): void {
    this.closedByUser = true;
    this.generation += 1;
    this.opening = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "client closed");
    this.setStatus("closed");
  }

  on(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Control messages are queued (bounded) while disconnected and flushed on open. */
  send<K extends ClientEventType>(type: K, data: ClientEventMap[K]): void {
    const frame = JSON.stringify(makeClientEvent(type, data));
    if (this.socket && this.socket.readyState === OPEN) {
      this.socket.send(frame);
      return;
    }
    if (this.queue.length >= MAX_QUEUED_CONTROL) this.queue.shift();
    this.queue.push(frame);
  }

  /** Audio is real-time: dropped (not queued) while disconnected. Returns whether it was sent. */
  sendAudio(channel: AudioChannel, pcm: Int16Array): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(encodeAudioFrame(channel, pcm));
    return true;
  }

  sendAudioBytes(channel: AudioChannel, pcmLE: Uint8Array): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(encodeAudioBytes(channel, pcmLE));
    return true;
  }

  private async open(): Promise<void> {
    const gen = this.generation;
    this.opening = true;
    this.setStatus(this.everOpened || this.attempts > 0 ? "reconnecting" : "connecting");
    let ticket: string;
    try {
      ticket = await this.opts.getTicket();
    } catch (err) {
      if (gen !== this.generation || this.closedByUser) return;
      this.opening = false;
      // 401/403/404 from the ticket endpoint are not retryable.
      const status = (err as { status?: number } | null)?.status;
      if (status === 401 || status === 403 || status === 404) {
        this.setStatus("closed", "Not authorized for this session");
        return;
      }
      this.scheduleRetry(errorMessage(err));
      return;
    }
    if (gen !== this.generation || this.closedByUser) return;
    this.opening = false;

    const socket = this.opts.createSocket(toWebSocketUrl(this.opts.apiBaseUrl, this.opts.sessionId, ticket));
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      const isReconnect = this.everOpened;
      this.everOpened = true;
      this.attempts = 0;
      this.setStatus("open");
      this.opts.onOpen?.(this, isReconnect);
      while (this.queue.length > 0 && socket.readyState === OPEN) {
        socket.send(this.queue.shift() as string);
      }
    };
    socket.onmessage = (ev: MessageEvent) => {
      if (this.socket !== socket || typeof ev.data !== "string") return;
      const event = parseServerFrame(ev.data);
      if (!event) return;
      for (const listener of this.eventListeners) listener(event);
    };
    socket.onerror = () => {
      // onclose follows and drives the retry decision.
    };
    socket.onclose = (ev: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.closedByUser) return;
      if (TERMINAL_CLOSE_CODES.has(ev.code)) {
        this.setStatus("closed", ev.reason || undefined);
        return;
      }
      this.scheduleRetry(ev.reason || `connection lost (${ev.code})`);
    };
  }

  private scheduleRetry(detail: string): void {
    this.attempts += 1;
    if (this.attempts > this.opts.maxAttempts) {
      this.setStatus("closed", `Gave up reconnecting: ${detail}`);
      return;
    }
    const base = Math.min(this.opts.maxBackoffMs, this.opts.backoffMs * 2 ** (this.attempts - 1));
    const delay = Math.round(base * (0.75 + Math.random() * 0.5));
    this.setStatus("reconnecting", detail);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.open();
    }, delay);
  }

  private setStatus(status: ConnectionStatus, detail?: string): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status, detail);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
