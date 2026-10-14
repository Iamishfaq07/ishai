import { describe, expect, it } from "vitest";
import { splitSettled } from "./HeardBar";
import { nextChunks } from "./StreamingText";

describe("heard bar", () => {
  it("keeps the last three words apart as still settling", () => {
    expect(splitSettled("I led the migration to Postgres")).toEqual({ settled: "I led the", tail: "migration to Postgres" });
    expect(splitSettled("Hello there")).toEqual({ settled: "", tail: "Hello there" });
    expect(splitSettled("  ")).toEqual({ settled: "", tail: "" });
  });
});

describe("streaming text chunks", () => {
  it("adds each new piece as its own chunk and folds old ones", () => {
    let c = nextChunks([], "Hello");
    expect(c).toEqual(["", "Hello"]);
    c = nextChunks(c, "Hello world");
    expect(c).toEqual(["", "Hello", " world"]);
    for (const more of ["!", " A", " B", " C", " D", " E"]) c = nextChunks(c, c.join("") + more);
    expect(c.length).toBe(6);
    expect(c.join("")).toBe("Hello world! A B C D E");
  });

  it("starts over when the text isn't a continuation", () => {
    expect(nextChunks(["", "Hello"], "Goodbye")).toEqual(["Goodbye"]);
    expect(nextChunks(["", "Hello"], "Hello")).toEqual(["", "Hello"]);
  });
});
