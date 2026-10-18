import { afterEach, describe, expect, it, vi } from "vitest";
import { haptic, hapticsOk } from "./useFeedback";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function device(userAgent: string, motion: string, vibrate: ((p: number) => boolean) | undefined = () => true) {
  vi.stubGlobal("navigator", { userAgent, vibrate });
  vi.stubGlobal("document", { documentElement: { getAttribute: () => motion } });
}

describe("haptics (key confirmations only)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("buzz only on Android, at Full motion", () => {
    device(ANDROID, "full");
    expect(hapticsOk()).toBe(true);
    device(ANDROID, "reduced");
    expect(hapticsOk()).toBe(false);
    device(ANDROID, "off");
    expect(hapticsOk()).toBe(false);
  });

  it("never on an iPhone (no vibration API) or a desktop (a function, but no motor)", () => {
    device(IPHONE, "full", undefined);
    expect(hapticsOk()).toBe(false);
    device(IPHONE, "full");
    expect(hapticsOk()).toBe(false);
    device(DESKTOP, "full");
    expect(hapticsOk()).toBe(false);
  });

  it("is a short pulse, and a refusal is ignored", () => {
    const vibrate = vi.fn(() => true);
    device(ANDROID, "full", vibrate);
    haptic("light");
    haptic();
    expect(vibrate.mock.calls).toEqual([[8], [12]]);
    device(ANDROID, "full", () => {
      throw new Error("no user activation");
    });
    expect(() => haptic()).not.toThrow();
    const quiet = vi.fn(() => true);
    device(ANDROID, "reduced", quiet);
    haptic();
    expect(quiet).not.toHaveBeenCalled();
  });
});
