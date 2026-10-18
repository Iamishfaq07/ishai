import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { ACKS, AckWarmer, WARM_ACKS, cachedAck, hasAck, type SpeakFn } from "./naturalVoice";
import { speakable } from "./speechText";

const clip = () => ({ headers: new Headers(), blob: async () => new Blob(["mp3"]) }) as unknown as Response;

/** The voice's speak requests: what was asked, and how many were out at once at most. */
function speaker(fail: (text: string) => boolean = () => false): { speak: SpeakFn; asked: string[]; most: () => number } {
  const asked: string[] = [];
  let out = 0;
  let most = 0;
  const speak: SpeakFn = async (text) => {
    asked.push(text);
    out += 1;
    most = Math.max(most, out);
    await new Promise((r) => setTimeout(r, 1));
    out -= 1;
    if (fail(text)) throw new TypeError("Failed to fetch");
    return clip();
  };
  return { speak, asked, most: () => most };
}

/** Quiet moment after quiet moment (each asks for one at most). */
async function quietMoments(warmer: AckWarmer, n = 8): Promise<void> {
  for (let i = 0; i < n; i++) await warmer.run();
}

// Clips are kept in memory for the page's life: each test has a voice of its own.
let n = 0;
const freshVoice = () => `test-voice-${++n}`;
const said = (texts: readonly string[]) => texts.map((t) => speakable(t));

describe("acknowledgements are kept ready sparingly (D76)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for the two most natural ones only, one a quiet moment, for her own voice", async () => {
    const voice = freshVoice();
    const { speak, asked, most } = speaker();
    const warmer = new AckWarmer(speak, voice, 1, () => true);
    await warmer.run();
    expect(asked).toEqual(said(ACKS.slice(0, 1))); // one request a quiet moment
    await quietMoments(warmer);
    expect(WARM_ACKS).toBe(2);
    expect(asked).toEqual(said(ACKS.slice(0, 2)));
    expect(most()).toBe(1);
    expect(await hasAck(voice, 1, ACKS[0])).toBe(true);
    expect(await hasAck(voice, 1, ACKS[2])).toBe(false);
    expect(await hasAck(freshVoice(), 1, ACKS[0])).toBe(false); // another voice: nothing made for it
  });

  it("asks only while she's listening: never while a line of hers is on its way", async () => {
    const { speak: base, asked } = speaker();
    await new AckWarmer(base, freshVoice(), 1, () => false).run();
    expect(asked).toEqual([]);
    // Her next line arrives while the first one is being made: nothing more until she's quiet again.
    let idle = true;
    const speak: SpeakFn = (...a) => {
      idle = false;
      return base(...a);
    };
    const warmer = new AckWarmer(speak, freshVoice(), 1, () => idle);
    await warmer.run();
    await warmer.run();
    expect(asked).toEqual(said(ACKS.slice(0, 1)));
    idle = true;
    await warmer.run();
    expect(asked).toEqual(said(ACKS.slice(0, 2)));
  });

  it("keeps one more ready each time she uses one, and never runs twice at once", async () => {
    const { speak, asked, most } = speaker();
    const warmer = new AckWarmer(speak, freshVoice(), 1, () => true);
    await quietMoments(warmer);
    warmer.used();
    await Promise.all([warmer.run(), warmer.run()]);
    expect(asked).toEqual(said(ACKS.slice(0, 3)));
    expect(most()).toBe(1);
    for (let i = 0; i < 10; i++) warmer.used();
    await quietMoments(warmer);
    expect(asked).toEqual(said(ACKS)); // all five at most, each once
  });

  it("asks for nothing a session before this one kept on the device (Cache Storage)", async () => {
    const voice = freshVoice();
    const stored = new Map<string, Response>();
    vi.stubGlobal("caches", {
      open: async () => ({
        match: async (key: string) => stored.get(key)?.clone(),
        put: async (key: string, res: Response) => void stored.set(key, res),
      }),
    });
    // The earlier session: its clips under the same keys (the voice, the pace, the words).
    const before = speaker();
    await quietMoments(new AckWarmer(before.speak, voice, 1, () => true));
    expect(stored.size).toBe(2);
    const keys = [...stored.keys()];
    expect(keys.every((k) => k.includes(encodeURIComponent(voice)))).toBe(true);
    // A new page (nothing in memory): a voice with only Cache Storage to go on still asks for nothing.
    const copy = freshVoice();
    for (const k of keys) stored.set(k.replace(encodeURIComponent(voice), encodeURIComponent(copy)), stored.get(k)!.clone());
    const now = speaker();
    await quietMoments(new AckWarmer(now.speak, copy, 1, () => true));
    expect(now.asked).toEqual([]);
    expect((await cachedAck(copy, 1, null))?.text).toMatch(/^(Mm-hmm\.|Okay\.)$/);
  });

  it("waits for the next quiet moment after a failure, and gives up for the session after three", async () => {
    let failing = true;
    const { speak, asked } = speaker(() => failing);
    const warmer = new AckWarmer(speak, freshVoice(), 1, () => true);
    await warmer.run();
    expect(asked).toHaveLength(1); // the rest wait: it's optional
    failing = false;
    await quietMoments(warmer);
    expect(asked).toEqual([...said(ACKS.slice(0, 1)), ...said(ACKS.slice(0, 2))]);
    failing = true;
    const other = speaker(() => true);
    const hopeless = new AckWarmer(other.speak, freshVoice(), 1, () => true);
    for (let i = 0; i < 5; i++) await hopeless.run();
    expect(other.asked).toHaveLength(3);
    // Today's allowance used: no more asking this session.
    let refusals = 0;
    const used: SpeakFn = async () => {
      refusals += 1;
      throw new ApiError(429, "used up", "voice_allowance_used");
    };
    const spent = new AckWarmer(used, freshVoice(), 1, () => true);
    for (let i = 0; i < 3; i++) await spent.run();
    expect(refusals).toBe(1);
  });

  it("stops asking once the room is gone", async () => {
    const { speak, asked } = speaker();
    const warmer = new AckWarmer(speak, freshVoice(), 1, () => true);
    warmer.stop();
    await warmer.run();
    expect(asked).toEqual([]);
  });

  it("never says the same one twice in a row, with what's kept", async () => {
    const voice = freshVoice();
    const { speak } = speaker();
    await quietMoments(new AckWarmer(speak, voice, 1, () => true));
    for (let i = 0; i < 20; i++) {
      expect((await cachedAck(voice, 1, "Mm-hmm."))?.text).toBe("Okay.");
      expect((await cachedAck(voice, 1, "Okay."))?.text).toBe("Mm-hmm.");
    }
    // Only one kept, and it was the last one said: none this time (never fetched on the spot).
    const lone = freshVoice();
    let calls = 0;
    const flaky: SpeakFn = async (...a) => (++calls > 1 ? Promise.reject(new TypeError("offline")) : speak(...a));
    await quietMoments(new AckWarmer(flaky, lone, 1, () => true));
    expect(await cachedAck(lone, 1, "Mm-hmm.")).toBeNull();
    expect((await cachedAck(lone, 1, null))?.text).toBe("Mm-hmm.");
  });
});
