import { afterEach, describe, expect, it, vi } from "vitest";
import { contentWords, scoreKeyPoints } from "./coverage";
import {
  answerLanguages,
  interviewLanguages,
  loadAnswerLanguage,
  loadInterviewLanguage,
  offersLanguages,
  readAloudLanguage,
  reportLanguageNote,
  saveLiveLanguages,
  scriptLang,
  sessionLanguageLabel,
  tallScript,
} from "./languages";

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

const ALL = ["en", "auto", "hi", "hinglish", "es", "fr", "de", "pt", "it", "nl", "ja", "ru"];

describe("live languages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers what the server lists, and only English from an older server", () => {
    expect(interviewLanguages(ALL).map((l) => l.value)).toEqual(ALL);
    expect(offersLanguages(ALL)).toBe(true);
    expect(interviewLanguages(undefined).map((l) => l.value)).toEqual(["en"]);
    expect(offersLanguages(["en"])).toBe(false);
  });

  it("answers in the interview's language unless another is picked", () => {
    const options = answerLanguages("hi", ALL);
    expect(options[0]).toEqual({ value: "", label: "Same as the interview (Hindi)" });
    expect(options.map((o) => o.value)).not.toContain("hi");
    expect(options.map((o) => o.value)).not.toContain("auto");
    expect(options.map((o) => o.value)).toContain("en");
    expect(answerLanguages("auto", ALL)[0]!.label).toBe("Same as each question");
  });

  it("remembers the choice on the device, English by default", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(loadInterviewLanguage(ALL)).toBe("en");
    expect(loadAnswerLanguage("en", ALL)).toBe("");
    saveLiveLanguages("es", "en");
    expect(loadInterviewLanguage(ALL)).toBe("es");
    expect(loadAnswerLanguage("es", ALL)).toBe("en");
    expect(loadInterviewLanguage(["en"])).toBe("en"); // the server stopped offering it
    expect(loadAnswerLanguage("en", ALL)).toBe(""); // "en" can't be English's own answer language
  });

  it("labels a session that isn't English", () => {
    expect(sessionLanguageLabel("en", null)).toBeNull();
    expect(sessionLanguageLabel("es", null)).toBe("Spanish");
    expect(sessionLanguageLabel("hi", "en")).toBe("Hindi → English");
    expect(sessionLanguageLabel("auto", null)).toBe("Auto-detect");
    expect(reportLanguageNote("es")).toBe("Written in Spanish");
  });

  it("tags text in scripts IBM Plex Sans doesn't draw, and leaves Latin text alone", () => {
    expect(scriptLang("अपने बारे में बताइए")).toBe("hi");
    expect(scriptLang("自己紹介をお願いします")).toBe("ja");
    expect(scriptLang("Расскажите о себе")).toBe("ru");
    expect(scriptLang("Cuéntame sobre ti")).toBeUndefined();
    expect(scriptLang("Tell me about yourself")).toBeUndefined();
    expect(tallScript("hi") && tallScript("ja") && !tallScript("ru") && !tallScript(undefined)).toBe(true);
  });

  it("reads answers aloud in their language", () => {
    expect(readAloudLanguage(undefined)).toBe("en");
    expect(readAloudLanguage("en")).toBe("en");
    expect(readAloudLanguage("es")).toBe("es");
    expect(readAloudLanguage("hinglish")).toBe("en-IN");
    expect(readAloudLanguage("auto", "आप कैसे हैं")).toBe("hi");
    expect(readAloudLanguage("auto", "How are you")).toBe("en");
  });
});

describe("key points in other scripts", () => {
  it("English words are read exactly as before", () => {
    expect([...contentWords("Start at PR and build")]).toEqual(["start", "pr", "build"]);
  });

  it("ticks a Hindi point the candidate says", () => {
    const answer = "मैं सबसे पहले कैश लगाऊंगा। फिर डेटाबेस को शार्ड करूंगा।";
    const p = scoreKeyPoints(["कैश लगाना", "डेटाबेस शार्डिंग"], answer, "तो सबसे पहले मैं कैश लगाऊंगा");
    expect(p.points.map((x) => x.covered)).toEqual([true, false]);
  });

  it("ticks a Japanese point from characters, with no spaces to split on", () => {
    const answer = "まずキャッシュを置きます。次にデータベースを分割します。";
    const p = scoreKeyPoints(["キャッシュを置く", "データベース分割"], answer, "まずはキャッシュを置きます");
    expect(p.points.map((x) => x.covered)).toEqual([true, false]);
  });
});
