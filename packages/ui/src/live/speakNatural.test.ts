import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { speakNatural, type SpeakFn } from "./naturalVoice";

/** An <audio> that plays when asked and ends when the test says. */
class FakeAudio extends EventTarget {
  static all: FakeAudio[] = [];
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 2;
  preload = "";
  playbackRate = 1;
  volume = 1;
  constructor(readonly src: string) {
    super();
    FakeAudio.all.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    queueMicrotask(() => this.dispatchEvent(new Event("playing")));
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  removeAttribute(): void {}
  finish(): void {
    this.ended = true;
    this.dispatchEvent(new Event("ended"));
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function speaker(): { speak: SpeakFn; asked: string[] } {
  const asked: string[] = [];
  const speak: SpeakFn = async (text) => {
    asked.push(text);
    return { headers: new Headers(), blob: async () => new Blob(["mp3"]) } as unknown as Response;
  };
  return { speak, asked };
}

const LINE = "Glad to hear it. So, for the next 5 minutes or so, we'll focus on application security. I'll ask some "
  + "questions and may dig into your answers. When you're done with one, just pause. To start, could you briefly "
  + "introduce yourself and walk me through your background?";

describe("the natural voice asks for each piece when it'll be needed (D76)", () => {
  beforeEach(() => {
    FakeAudio.all = [];
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks for two pieces at once, and the third only when the second starts playing", async () => {
    const { speak, asked } = speaker();
    const done = speakNatural(LINE, speak, "vesta", new AbortController().signal);
    await tick();
    expect(asked).toHaveLength(2);
    expect(asked[0]).toBe("Glad to hear it.");
    await tick();
    FakeAudio.all[0]!.finish();
    await tick();
    await tick();
    expect(asked).toHaveLength(3); // the second plays: the third is made meanwhile
    FakeAudio.all[1]!.finish();
    await tick();
    await tick();
    FakeAudio.all[2]!.finish();
    await done;
    expect(asked.join(" ")).toContain("walk me through your background");
  });

  it("never makes the rest of a line she's cut off on", async () => {
    const { speak, asked } = speaker();
    const stop = new AbortController();
    const done = speakNatural(LINE, speak, "vesta", stop.signal);
    await tick();
    await tick();
    stop.abort(); // talked over in her first sentence
    await done;
    expect(asked).toHaveLength(2);
  });

  it("waits for an acknowledgement still being said before her line starts", async () => {
    const { speak } = speaker();
    let finishAck = () => undefined as void;
    const ack = new Promise<void>((r) => (finishAck = r));
    const done = speakNatural("Right. What broke first?", speak, "vesta", new AbortController().signal, {
      before: () => ack,
    });
    await tick();
    await tick();
    expect(FakeAudio.all).toHaveLength(0); // the clip is here, but the "Mm-hmm." isn't over
    finishAck();
    await tick();
    await tick();
    expect(FakeAudio.all).toHaveLength(1);
    FakeAudio.all[0]!.finish();
    await done;
  });
});
