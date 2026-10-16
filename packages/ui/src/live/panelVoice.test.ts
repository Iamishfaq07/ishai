import { describe, expect, it } from "vitest";
import { panelVoice, pickVoices } from "./useInterviewerVoice";

const v = (name: string, lang = "en-US") => ({ name, lang }) as SpeechSynthesisVoice;

describe("panel voices", () => {
  it("orders the language's voices most natural first", () => {
    const voices = pickVoices([v("Zira"), v("Hindi", "hi-IN"), v("Aria Natural"), v("Basic")], "en");
    expect(voices.map((x) => x.name)).toEqual(["Aria Natural", "Zira", "Basic"]);
  });

  it("gives each panelist a different voice, and a different pitch once voices run out", () => {
    const voices = [v("A"), v("B")];
    expect(panelVoice(voices, 0)).toEqual({ voice: voices[0], pitch: 1 });
    expect(panelVoice(voices, 1)).toEqual({ voice: voices[1], pitch: 1 });
    expect(panelVoice(voices, 2)).toEqual({ voice: voices[0], pitch: 0.85 });
    expect(panelVoice([], 1)).toEqual({ voice: undefined, pitch: 0.85 });
  });
});

describe("practice-language voices", () => {
  const v = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice;
  const all = [v("Microsoft David", "en-US"), v("Google UK English", "en-GB"), v("Microsoft Heera", "en-IN"), v("Google हिन्दी", "hi-IN")];

  it("maps the practice language to a speech language", async () => {
    const { voiceLanguage } = await import("./useInterviewerVoice");
    expect(voiceLanguage("hi")).toBe("hi-IN");
    expect(voiceLanguage("hinglish")).toBe("en-IN");
    expect(voiceLanguage("en")).toBe("en");
    expect(voiceLanguage(undefined)).toBe("en");
  });

  it("prefers the region's own voice, then the language's others", async () => {
    const { pickVoice } = await import("./useInterviewerVoice");
    expect(pickVoice(all, "hi-IN")?.name).toBe("Google हिन्दी");
    expect(pickVoice(all, "en-IN")?.name).toBe("Microsoft Heera");
    expect(pickVoice(all, "en")?.name).toBe("Microsoft David"); // unchanged for plain English
    expect(pickVoices(all, "en-IN")[0]?.name).toBe("Microsoft Heera");
  });
});
