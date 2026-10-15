import { describe, expect, it } from "vitest";
import { keywordPattern } from "./previewKeywords";

const found = (keywords: string[], text: string) => text.match(keywordPattern(keywords)!) ?? [];

describe("keywordPattern", () => {
  it("matches whole words in any case, the longest term first", () => {
    expect(found(["learning", "machine learning"], "Built machine learning pipelines; e-learning")).toEqual(["machine learning"]);
    expect(found(["Go"], "Go services, going strong, golang, GO")).toEqual(["Go", "GO"]);
  });

  it("matches tools written with symbols as written, not their stems", () => {
    expect(found(["C++", "Node.js", ".NET"], "C++ and Node.js on .NET, not C or Node")).toEqual(["C++", "Node.js", ".NET"]);
    expect(keywordPattern(["C"])).toBeNull(); // one letter matches too much to mark
    expect(found(["React"], "React-based UI, not Preact")).toEqual(["React"]);
  });

  it("has nothing to mark without keywords", () => {
    expect(keywordPattern([])).toBeNull();
    expect(keywordPattern([" ", "a"])).toBeNull();
  });
});
