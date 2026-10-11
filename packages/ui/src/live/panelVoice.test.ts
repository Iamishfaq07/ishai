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
