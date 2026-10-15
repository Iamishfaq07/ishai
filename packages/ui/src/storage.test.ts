import { afterEach, describe, expect, it, vi } from "vitest";
import { readChoice, readJSON, safeLocal, safeSession } from "./storage";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CodeBlock } from "./components/CodeBlock";

function blocked(): Storage {
  const fail = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return { getItem: fail, setItem: fail, removeItem: fail, clear: fail, key: fail, get length() { return fail(); } } as unknown as Storage;
}

function working(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
}

afterEach(() => vi.unstubAllGlobals());

describe("safe storage", () => {
  it("never throws when site data is blocked, and remembers for the page", () => {
    vi.stubGlobal("localStorage", blocked());
    vi.stubGlobal("sessionStorage", blocked());
    expect(safeLocal.getItem("a")).toBeNull();
    expect(() => safeLocal.setItem("a", "1")).not.toThrow();
    expect(safeLocal.getItem("a")).toBe("1");
    expect(safeLocal.keys()).toContain("a");
    safeLocal.removeItem("a");
    expect(safeLocal.getItem("a")).toBeNull();
    expect(() => safeSession.setItem("b", "2")).not.toThrow();
  });

  it("works with no storage at all (server render, old webviews)", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(safeLocal.getItem("x")).toBeNull();
    expect(() => safeLocal.setItem("x", "y")).not.toThrow();
  });

  it("uses the real storage when it works", () => {
    const real = working();
    vi.stubGlobal("localStorage", real);
    safeLocal.setItem("k", "v");
    expect(real.getItem("k")).toBe("v");
    expect(safeLocal.getItem("k")).toBe("v");
    safeLocal.removeItem("k");
    expect(real.getItem("k")).toBeNull();
  });

  it("validates what it reads back, so a tampered value falls back", () => {
    vi.stubGlobal("localStorage", working());
    safeLocal.setItem("theme", "neon");
    expect(readChoice(safeLocal, "theme", ["light", "dark", "system"] as const, "system")).toBe("system");
    safeLocal.setItem("json", "{not json");
    expect(readJSON(safeLocal, "json", [1])).toEqual([1]);
    safeLocal.setItem("json", "[2]");
    expect(readJSON(safeLocal, "json", [] as number[], (v): v is number[] => Array.isArray(v))).toEqual([2]);
  });

  it("a live-answer code block renders with storage blocked", () => {
    vi.stubGlobal("localStorage", blocked());
    expect(() => renderToStaticMarkup(createElement(CodeBlock, { code: { language: "python", content: "print(1)" } }))).not.toThrow();
  });
});
