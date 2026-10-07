import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyLiveAnswer, type AnswerSource, type LiveAnswer } from "@orbit/types";
import { AnswerCard, type AnswerCardProps } from "../components/AnswerCard";
import { SIZE_HINTS, SIZE_ORDER, resizeTarget } from "./answerSize";
import { EXPERIENCE_LEVELS, loadExperience, saveExperience } from "./preferences";
import type { AnswerView } from "./reducer";
import { answerRequest } from "./useLiveSession";

describe("Shorter / Longer targets", () => {
  it("steps a fixed length, and keeps it", () => {
    expect(resizeTarget("standard", undefined, -1)).toEqual({ length: "short" });
    expect(resizeTarget("standard", undefined, 1)).toEqual({ length: "detailed" });
    expect(resizeTarget("short", undefined, -1)).toBeNull();
    expect(resizeTarget("detailed", "detailed", 1)).toBeNull(); // a size on a fixed session changes nothing
  });

  it("on auto, asks for this answer one size down or up", () => {
    expect(resizeTarget("auto", "medium", -1)).toEqual({ size: "short" });
    expect(resizeTarget("auto", "medium", 1)).toEqual({ size: "long" });
    expect(resizeTarget("auto", "brief", -1)).toBeNull();
    expect(resizeTarget("auto", "detailed", 1)).toBeNull();
    expect(resizeTarget("auto", undefined, 1)).toBeNull(); // no size known (adopted after a reconnect)
  });

  it("has a hint for every size", () => {
    for (const size of SIZE_ORDER) expect(SIZE_HINTS[size].label).toMatch(/answer$/);
  });
});

describe("answer.request", () => {
  it("sends a one-off size or plainer words only when asked", () => {
    expect(answerRequest()).toEqual({});
    expect(answerRequest("  What is Kafka? ")).toEqual({ question_text: "What is Kafka?" });
    expect(answerRequest("What is Kafka?", { size: "brief" })).toEqual({ question_text: "What is Kafka?", size: "brief" });
    expect(answerRequest("What is Kafka?", { simpler: true, size: "short" })).toEqual({
      question_text: "What is Kafka?",
      size: "short",
      simpler: true,
    });
  });
});

describe("experience level preference", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to auto, round-trips, and ignores junk", () => {
    const m = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
    expect(loadExperience()).toBe("auto");
    saveExperience("fresher");
    expect(loadExperience()).toBe("fresher");
    localStorage.setItem("orbit.experience", "wizard");
    expect(loadExperience()).toBe("auto");
    expect(EXPERIENCE_LEVELS.map((l) => l.value)).toEqual(["auto", "fresher", "junior", "mid", "senior"]);
  });
});

function view(answer: Partial<LiveAnswer>, extra: Partial<AnswerView> = {}): AnswerView {
  return {
    answer_id: "a1",
    question_id: "q1",
    status: "complete",
    answer: { ...emptyLiveAnswer("Have you used Kubernetes?"), ...answer },
    length: "short",
    reasoning: "light",
    source: "auto" as AnswerSource,
    latency: null,
    error: null,
    has_content: true,
    spoken_from: 0,
    ...extra,
  };
}

function render(props: Partial<AnswerCardProps> & { answer: AnswerView }): string {
  return renderToStaticMarkup(createElement(AnswerCard, { pinned: false, onPin: () => {}, autoAnswer: true, ...props }));
}

describe("answer card", () => {
  const spoken = "I haven't used Kubernetes on a real project yet, but I know how pods get restarted.";

  it("says how much to say when the size was picked automatically", () => {
    const html = render({ answer: view({ direct_answer: spoken }, { size: "brief" }) });
    expect(html).toContain("Quick answer");
    expect(render({ answer: view({ direct_answer: spoken }) })).not.toContain("Quick answer"); // a fixed length
    // chat replies aren't said to the interviewer
    expect(render({ answer: view({ direct_answer: spoken }, { size: "brief", source: "chat" }) })).not.toContain("Quick answer");
  });

  it("shows the jargon it uses in plain words, dimmed under the answer", () => {
    const html = render({ answer: view({ direct_answer: spoken, terms: [{ term: "pod", meaning: "one running copy of the app" }] }) });
    expect(html).toContain('aria-label="Words in this answer"');
    expect(html).toContain("pod</dt>");
    expect(html).toContain("= one running copy of the app");
    expect(render({ answer: view({ direct_answer: spoken }) })).not.toContain("Words in this answer");
  });

  it("offers Simpler next to Shorter and Longer", () => {
    const actions = { onShorter: () => {}, onLonger: null, onSimpler: () => {} };
    const html = render({ answer: view({ direct_answer: spoken }), ...actions });
    expect(html).toContain("Shorter");
    expect(html).toContain("Simpler");
    expect(render({ answer: view({ direct_answer: spoken }), onShorter: () => {}, onLonger: null })).not.toContain("Simpler");
    // not while it's still being written
    expect(render({ answer: view({ direct_answer: spoken }, { status: "streaming" }), ...actions })).not.toContain("Simpler");
  });
});
