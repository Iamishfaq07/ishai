import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REF_DAYS, captureRefFromUrl, clearRef, keepRef, normalizeCode, storedRef } from "./referral";

/** A cookie jar that behaves like document.cookie: each write sets one cookie (Max-Age=0 removes it). */
function jar() {
  const cookies = new Map<string, string>();
  const written: string[] = [];
  return {
    written,
    get cookie() {
      return [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(line: string) {
      written.push(line);
      const [pair, ...attrs] = line.split(";").map((s) => s.trim());
      const [name, value] = pair!.split("=");
      if (attrs.some((a) => a === "Max-Age=0")) cookies.delete(name!);
      else cookies.set(name!, value ?? "");
    },
  };
}

let store: Map<string, string>;
let doc: ReturnType<typeof jar>;
let replaced: string[];

function at(href: string) {
  const url = new URL(href);
  vi.stubGlobal("window", {
    location: { href, protocol: url.protocol },
    history: { state: null, replaceState: (_s: unknown, _t: string, to: string) => replaced.push(to) },
  });
}

beforeEach(() => {
  store = new Map();
  doc = jar();
  replaced = [];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("document", doc);
  at("https://orbitanswer.com/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeCode", () => {
  it("reads codes without regard to case or spaces, and refuses what can't be one", () => {
    expect(normalizeCode(" priya 10 ")).toBe("PRIYA10");
    expect(normalizeCode("iitb_2026-a")).toBe("IITB_2026-A");
    expect(normalizeCode("ab")).toBeNull();
    expect(normalizeCode("<script>")).toBeNull();
    expect(normalizeCode("-LEADING")).toBeNull();
    expect(normalizeCode(null)).toBeNull();
  });
});

describe("the link's code", () => {
  it("is kept in localStorage and a first-party cookie the API can read", () => {
    expect(keepRef("k7m2qx9p")).toBe("K7M2QX9P");
    expect(storedRef()).toBe("K7M2QX9P");
    expect(doc.written[0]).toBe(`orbit_ref=K7M2QX9P; Max-Age=${REF_DAYS * 86_400}; Path=/; SameSite=Lax; Secure`);
  });

  it("isn't marked Secure on a plain-http dev server (the browser would drop it)", () => {
    at("http://localhost:5178/r/ABC123");
    keepRef("ABC123");
    expect(doc.written[0]).not.toContain("Secure");
  });

  it("lasts 30 days, then is gone", () => {
    const then = Date.UTC(2026, 9, 1);
    keepRef("ABC123", then);
    expect(storedRef(then + (REF_DAYS - 1) * 86_400_000)).toBe("ABC123");
    doc = jar(); // the cookie expired with it
    vi.stubGlobal("document", doc);
    expect(storedRef(then + (REF_DAYS + 1) * 86_400_000)).toBeNull();
  });

  it("falls back to the cookie when storage is blocked or was cleared", () => {
    keepRef("ABC123");
    store.clear();
    expect(storedRef()).toBe("ABC123");
  });

  it("is the newest link's", () => {
    keepRef("FIRST1");
    keepRef("SECOND2");
    expect(storedRef()).toBe("SECOND2");
  });

  it("is forgotten after the sign-up it was for", () => {
    keepRef("ABC123");
    clearRef();
    expect(storedRef()).toBeNull();
    expect(doc.cookie).toBe("");
  });

  it("ignores a stored value that isn't a code", () => {
    store.set("orbit.ref", JSON.stringify({ code: "<img>", at: Date.now() }));
    expect(storedRef()).toBeNull();
    store.set("orbit.ref", "not json");
    expect(storedRef()).toBeNull();
  });

  it("is taken from ?ref= on any page, and out of the address bar", () => {
    at("https://orbitanswer.com/resume-ai?utm=x&ref=priya10#top");
    captureRefFromUrl();
    expect(storedRef()).toBe("PRIYA10");
    expect(replaced).toEqual(["/resume-ai?utm=x#top"]);
    replaced = [];
    at("https://orbitanswer.com/jobs");
    captureRefFromUrl();
    expect(replaced).toEqual([]);
  });
});
