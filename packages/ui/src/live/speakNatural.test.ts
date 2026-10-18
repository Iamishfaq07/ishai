import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { NaturalVoiceError, sayNaturalLine, speakNatural, type SpeakFn } from "./naturalVoice";

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

const clip = () => ({ headers: new Headers(), blob: async () => new Blob(["mp3"]) }) as unknown as Response;

function speaker(): { speak: SpeakFn; asked: string[] } {
  const asked: string[] = [];
  const speak: SpeakFn = async (text) => {
    asked.push(text);
    return clip();
  };
  return { speak, asked };
}

/** Plays every clip to its end as it starts, until `done` settles. */
async function playThrough<T>(done: Promise<T>): Promise<T> {
  let settled = false;
  void done.finally(() => (settled = true)).catch(() => undefined);
  for (let n = 0; !settled && n < 50; n++) {
    await tick();
    FakeAudio.all.filter((a) => !a.paused && !a.ended).forEach((a) => a.finish());
  }
  return done;
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

  it("asks once more after a hiccup instead of switching to the device's voice mid-line", async () => {
    for (const hiccup of [new ApiError(502, "provider hiccup"), new TypeError("Failed to fetch")]) {
      let calls = 0;
      const flaky: SpeakFn = async () => {
        calls += 1;
        if (calls === 1) throw hiccup;
        return clip();
      };
      await playThrough(speakNatural("Tell me about yourself.", flaky, "aurora", new AbortController().signal));
      expect(calls).toBe(2);
    }
  });

  it("never asks again after a refusal that won't pass (the allowance, off, signed out)", async () => {
    let calls = 0;
    const refused: SpeakFn = async () => {
      calls += 1;
      throw new ApiError(429, "used up");
    };
    const err = await speakNatural("Tell me about yourself.", refused, "aurora", new AbortController().signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NaturalVoiceError);
    expect((err as NaturalVoiceError).rest).toBe("Tell me about yourself.");
    expect(calls).toBe(1);
  });
});

describe("a line in the natural voice, with the device's voice as its fallback (D76)", () => {
  beforeEach(() => {
    FakeAudio.all = [];
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** A request that never answers (until it's given up on). */
  const stuck: SpeakFn = (_text, _voice, signal) =>
    new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new DOMException("The request was cancelled.", "AbortError"))),
    );

  it("a slow line falls back for that line only: the next one is natural again", async () => {
    const slow = await sayNaturalLine("Tell me about yourself.", stuck, "aurora", new AbortController(), { limitMs: 20 });
    expect(slow).toEqual({ said: false, rest: "Tell me about yourself.", detail: "natural voice too slow", gone: false });
    const { speak, asked } = speaker();
    const next = await playThrough(sayNaturalLine("What broke first?", speak, "aurora", new AbortController(), { limitMs: 1000 }));
    expect(next).toEqual({ said: true });
    expect(asked).toEqual(["What broke first?"]);
  });

  it("turns the natural voice off for the session only when it won't come back", async () => {
    const fails = (err: unknown): SpeakFn => async () => {
      throw err;
    };
    const flaky = await sayNaturalLine("Why this company?", fails(new ApiError(502, "provider hiccup")), "aurora", new AbortController(), { limitMs: 1000 });
    expect(flaky).toMatchObject({ said: false, rest: "Why this company?", gone: false });
    const usedUp = await sayNaturalLine("Why this company?", fails(new ApiError(429, "used up")), "aurora", new AbortController(), { limitMs: 1000 });
    expect(usedUp).toMatchObject({ said: false, gone: true });
  });

  it("says nothing more when the caller stops it (the next line took over)", async () => {
    const stop = new AbortController();
    const line = sayNaturalLine("Tell me about yourself.", stuck, "aurora", stop, { limitMs: 1000 });
    stop.abort();
    expect(await line).toBeNull();
  });
});
