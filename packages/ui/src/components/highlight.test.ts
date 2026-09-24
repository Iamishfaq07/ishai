import { describe, expect, it } from "vitest";
import { normalizeLanguage, tokenize } from "./highlight";

const kinds = (code: string, lang: string) =>
  tokenize(code, lang).filter((t) => t.kind !== "plain").map((t) => `${t.kind}:${t.text}`);

describe("highlight", () => {
  it("python: keywords, strings, numbers, comments", () => {
    expect(kinds('def f(x):\n    return x + 1  # add one\n    s = "hi # not a comment"', "python")).toEqual([
      "keyword:def", "keyword:return", "number:1", "comment:# add one", 'string:"hi # not a comment"',
    ]);
  });

  it("c-like block comments, escaped quotes and types", () => {
    expect(kinds('/* x */ String s = "a\\"b"; // end', "java")).toEqual([
      "comment:/* x */", "keyword:String", 'string:"a\\"b"', "comment:// end",
    ]);
  });

  it("sql keywords are case-insensitive and -- starts a comment", () => {
    expect(kinds("SELECT name FROM users -- all\nwhere id = 3", "sql")).toEqual([
      "keyword:SELECT", "keyword:FROM", "comment:-- all", "keyword:where", "number:3",
    ]);
  });

  it("unknown languages and aliases", () => {
    expect(tokenize("anything <b>", "brainfuck")).toEqual([{ text: "anything <b>", kind: "plain" }]);
    expect(normalizeLanguage("C++")).toBe("cpp");
    expect(normalizeLanguage("py")).toBe("python");
  });

  it("loses no characters", () => {
    const code = 'fn main() {\n    let v: Vec<i32> = vec![1, 2]; // x\n    println!("{}", v.len());\n}';
    expect(tokenize(code, "rust").map((t) => t.text).join("")).toBe(code);
  });
});
