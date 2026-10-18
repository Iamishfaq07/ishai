import { afterEach, describe, expect, it, vi } from "vitest";

// captureStream with a fake Web Audio graph: what happens to the AudioContext when a phone halts it.
class FakeContext extends EventTarget {
  static last: FakeContext | null = null;
  state: string = "suspended";
  resumes = 0;
  audioWorklet = { addModule: async () => {} };
  destination = {};
  constructor() {
    super();
    FakeContext.last = this;
  }
  private node = () => ({ connect: (n: unknown) => n ?? {}, disconnect: () => {} });
  createMediaStreamSource = () => this.node();
  createAnalyser = () => ({ ...this.node(), fftSize: 0 });
  createGain = () => ({ ...this.node(), gain: { value: 1 } });
  resume = async () => {
    this.resumes += 1;
    this.set("running");
  };
  close = async () => this.set("closed");
  set(state: string) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

function install() {
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", class { port = { onmessage: null }; connect = (n: unknown) => n; disconnect = () => {}; });
  return doc;
}
const stream = () => ({ getTracks: () => [] }) as unknown as MediaStream;

afterEach(() => vi.unstubAllGlobals());

describe("captureStream on a phone", () => {
  it("starts a context the browser created suspended", async () => {
    install();
    const { captureStream } = await import("./audio");
    const cap = await captureStream(stream(), () => {});
    expect(FakeContext.last!.state).toBe("running");
    cap.stop();
  });

  it("starts it again after iOS interrupts it (a call, Siri, the screen locking), when the page is back", async () => {
    const doc = install();
    const { captureStream } = await import("./audio");
    const cap = await captureStream(stream(), () => {});
    const ctx = FakeContext.last!;
    // The resume on the state change itself is refused, as iOS does while the interruption lasts.
    ctx.resume = async () => {
      ctx.resumes += 1;
    };
    ctx.set("interrupted");
    expect(ctx.state).toBe("interrupted");
    ctx.resume = async () => {
      ctx.resumes += 1;
      ctx.set("running");
    };
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(ctx.state).toBe("running");
    // and a tap resumes it too, should it halt again
    ctx.state = "suspended";
    doc.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    expect(ctx.state).toBe("running");
    cap.stop();
  });

  it("leaves a stopped capture alone", async () => {
    const doc = install();
    const { captureStream } = await import("./audio");
    const cap = await captureStream(stream(), () => {});
    const ctx = FakeContext.last!;
    cap.stop();
    const before = ctx.resumes;
    doc.dispatchEvent(new Event("visibilitychange"));
    doc.dispatchEvent(new Event("pointerdown"));
    expect(ctx.resumes).toBe(before);
    expect(ctx.state).toBe("closed");
  });
});
