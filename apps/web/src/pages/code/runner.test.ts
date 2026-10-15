import { describe, expect, it } from "vitest";
import { callText, failingText, sameAnswer, workerSource } from "./runner";

describe("Code AI runner", () => {
  it("compares answers as data", () => {
    expect(sameAnswer([2, 3], [2, 3])).toBe(true);
    expect(sameAnswer([3, 2], [2, 3])).toBe(false);
    expect(sameAnswer([3, 2], [2, 3], true)).toBe(true);
    expect(sameAnswer([["b", "a"], ["c"]], [["c"], ["b", "a"]], true)).toBe(true);
    expect(sameAnswer(true, true)).toBe(true);
    expect(sameAnswer(undefined, 0)).toBe(false);
  });

  it("describes calls and the first failure", () => {
    expect(callText("pairSum", [[4, 9], 8])).toBe("pairSum([4,9], 8)");
    expect(failingText("f", { passed: 1, total: 2, results: [
      { args: [1], expected: 1, got: 1, ok: true },
      { args: [2], expected: 4, got: 3, ok: false },
    ] })).toBe("f(2) gave 3, expected 4");
    expect(failingText("f", { passed: 1, total: 1, results: [{ args: [], expected: 1, error: "boom", ok: false }] })).toBe("f() threw boom, expected 1");
  });

  it("builds a script that calls the function on each test and reports back", () => {
    const src = workerSource("function sq(x) { return x * x; }", "sq", [{ args: [3] }, { args: [4] }]);
    const sent: unknown[] = [];
    new Function("postMessage", src)((m: unknown) => sent.push(m));
    expect(sent).toEqual([[{ got: 9 }, { got: 16 }]]);
    const missing: unknown[] = [];
    new Function("postMessage", workerSource("const x = 1;", "nope", [{ args: [] }]))((m: unknown) => missing.push(m));
    expect(missing).toEqual([[{ error: "No function named nope" }]]);
  });
});
