import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { DEVICE_VOICE, naturalVoiceGone, orderVoices, voiceChunks, voiceForSpeaker } from "./naturalVoice";

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
    expect(naturalVoiceGone(new ApiError(429, "used up"))).toBe(true);
    expect(naturalVoiceGone(new ApiError(503, "off"))).toBe(true);
    expect(naturalVoiceGone(new ApiError(502, "provider hiccup"))).toBe(false); // next question tries again
    expect(naturalVoiceGone(new Error("autoplay refused"))).toBe(false);
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
