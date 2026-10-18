import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ANSWER_SHAPE, loadAnswerShape, loadResponseTiming, saveAnswerShape, saveResponseTiming } from "./preferences";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe("response timing preference", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to balanced, round-trips, and ignores junk", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(loadResponseTiming()).toBe("balanced");
    saveResponseTiming("patient");
    expect(loadResponseTiming()).toBe("patient");
    localStorage.setItem("orbit.responseTiming", "whenever");
    expect(loadResponseTiming()).toBe("balanced");
  });

  it("works without storage (defaults, no throw)", () => {
    expect(loadResponseTiming()).toBe("balanced");
    expect(() => saveResponseTiming("quick")).not.toThrow();
  });
});

describe("answer copy text", () => {
  it("joins the spoken answer, any points, code and example", async () => {
    const { answerAsText } = await import("../components/AnswerCard");
    const { emptyLiveAnswer } = await import("@orbit/types");
    const a = { ...emptyLiveAnswer("q"), direct_answer: "First para.\n\nSecond para.", talking_points: ["one"] };
    expect(answerAsText(a)).toBe("First para.\n\nSecond para.\n- one");
  });

  it("includes system design sections and debug details", async () => {
    const { answerAsText } = await import("../components/AnswerCard");
    const { emptyLiveAnswer } = await import("@orbit/types");
    const design = { ...emptyLiveAnswer("q"), direct_answer: "Talk.", design: [{ title: "Scale", text: "10k rps" }] };
    expect(answerAsText(design)).toBe("Talk.\n\nScale: 10k rps");
    const debug = {
      ...emptyLiveAnswer("q"),
      direct_answer: "Off by one.",
      debug: { root_cause: "bound", fix: "drop +1", why: "len-1", diff: "-a\n+b" },
    };
    expect(answerAsText(debug)).toBe("Off by one.\n\nRoot cause: bound\nMinimal fix: drop +1\nWhy it failed: len-1\n\n-a\n+b");
  });
});

describe("answer shape preference (length, style, Auto-answer)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("remembers the last choice on this device, and ignores junk", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(loadAnswerShape()).toEqual(DEFAULT_ANSWER_SHAPE);
    saveAnswerShape({ length: "short", style: "concise", autoAnswer: false });
    expect(loadAnswerShape()).toEqual({ length: "short", style: "concise", autoAnswer: false });
    localStorage.setItem("orbit.answerShape", JSON.stringify({ length: "huge", style: 3, autoAnswer: "no" }));
    expect(loadAnswerShape()).toEqual(DEFAULT_ANSWER_SHAPE);
    localStorage.setItem("orbit.answerShape", "{not json");
    expect(loadAnswerShape()).toEqual(DEFAULT_ANSWER_SHAPE);
  });
});
