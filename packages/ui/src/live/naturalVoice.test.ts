import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { DEVICE_VOICE, naturalVoiceGone, orderVoices, voiceChunks, voiceForSpeaker, voiceSetup, worthRetrying } from "./naturalVoice";

const OPTIONS = [
  { id: "us", label: "Thalia" },
  { id: "uk", label: "Draco" },
  { id: "au", label: "Hyperion" },
];

describe("natural voice choices", () => {
  it("puts the chosen voice first, falls back to the server's default, and is off for the device voice", () => {
    expect(orderVoices(OPTIONS, "uk", "us")).toEqual(["uk", "us", "au"]);
    expect(orderVoices(OPTIONS, null, "us")).toEqual(["us", "uk", "au"]);
    expect(orderVoices(OPTIONS, "gone", "au")).toEqual(["au", "us", "uk"]); // a voice the server dropped
    expect(orderVoices(OPTIONS, DEVICE_VOICE, "us")).toBeNull();
    expect(orderVoices([], "us", "us")).toBeNull();
  });

  it("gives each panelist the next voice, round the list", () => {
    expect([0, 1, 2, 3].map((n) => voiceForSpeaker(["uk", "us", "au"], n))).toEqual(["uk", "us", "au", "uk"]);
    expect(voiceForSpeaker([], 0)).toBeUndefined();
  });

  it("stops asking for the session only when it won't come back", () => {
    expect(naturalVoiceGone(new ApiError(429, "used up", "voice_allowance_used"))).toBe(true);
    expect(naturalVoiceGone(new ApiError(503, "off", "voice_off"))).toBe(true);
    expect(naturalVoiceGone(new ApiError(401, "signed out"))).toBe(true);
    // The per-second limit, or the host restarting: only that line falls back.
    expect(naturalVoiceGone(new ApiError(429, "Too many requests"))).toBe(false);
    expect(naturalVoiceGone(new ApiError(503, "Service unavailable"))).toBe(false);
    expect(naturalVoiceGone(new ApiError(502, "provider hiccup"))).toBe(false); // next question tries again
    expect(naturalVoiceGone(new Error("autoplay refused"))).toBe(false);
  });

  it("asks once more only after a hiccup, never after a refusal or a request that took too long", () => {
    expect(worthRetrying(new TypeError("Failed to fetch"))).toBe(true);
    expect(worthRetrying(new ApiError(0, "Can't reach Orbit.", "offline"))).toBe(true);
    for (const status of [500, 502, 504]) expect(worthRetrying(new ApiError(status, "hiccup"))).toBe(true);
    expect(worthRetrying(new ApiError(0, "That took too long.", "timeout"))).toBe(false);
    for (const status of [401, 403, 429, 503]) expect(worthRetrying(new ApiError(status, "no"))).toBe(false);
    expect(worthRetrying(new DOMException("stopped", "AbortError"))).toBe(false);
  });
});

describe("only the admin picks the voice and pace (D76)", () => {
  const status = { available: true, voices: OPTIONS, default_voice: "us" };
  const old = { choice: "uk", pace: "brisk" as const };

  it("gives everyone else the default voice at the normal pace, whatever an older build saved", () => {
    expect(voiceSetup(status, old)).toEqual({ voices: ["us", "uk", "au"], pace: "normal" });
    expect(voiceSetup({ ...status, can_choose: false }, { choice: DEVICE_VOICE, pace: "slower" })).toEqual({
      voices: ["us", "uk", "au"],
      pace: "normal",
    });
    expect(voiceSetup({ ...status, available: false, voices: [] }, old)).toBeNull(); // the device's voice
  });

  it("uses the admin's saved voice and pace, the device's voice included", () => {
    const admin = { ...status, can_choose: true };
    expect(voiceSetup(admin, old)).toEqual({ voices: ["uk", "us", "au"], pace: "brisk" });
    expect(voiceSetup(admin, { choice: DEVICE_VOICE, pace: "slower" })).toEqual({ voices: [], pace: "slower" });
    expect(voiceSetup(admin, { choice: null, pace: "normal" })).toEqual({ voices: ["us", "uk", "au"], pace: "normal" });
  });
});

describe("pipelined natural voice", () => {
  it("speaks the first sentence on its own so it starts sooner", () => {
    expect(voiceChunks("Hi, my name is Saba. I'll be taking your interview today. Let's start.")).toEqual([
      "Hi, my name is Saba.",
      "I'll be taking your interview today. Let's start.",
    ]);
    expect(voiceChunks("Hi. Thanks for coming in today. Tell me about yourself.")).toEqual([
      "Hi. Thanks for coming in today.",
      "Tell me about yourself.",
    ]);
    expect(voiceChunks("Tell me about yourself.")).toEqual(["Tell me about yourself."]);
    expect(voiceChunks("  ")).toEqual([]);
  });
});
