import { describe, expect, it } from "vitest";
import { changesServer, DEFAULT_API_URL, savedApiUrl } from "./api";

describe("the saved server override", () => {
  it("is used when it's a valid https server", () => {
    expect(savedApiUrl("https://orbit.example.com/")).toBe("https://orbit.example.com");
  });

  it("is dropped for a retired hosted address, so the app follows the API to its new home", () => {
    expect(savedApiUrl("https://orbit-api-sg.onrender.com")).toBeNull();
    expect(savedApiUrl("https://orbit-api-sg.onrender.com/")).toBeNull();
    expect(savedApiUrl("https://orbit-api-5kcx.onrender.com")).toBeNull();
  });

  it("is dropped when missing or not a URL", () => {
    expect(savedApiUrl(null)).toBeNull();
    expect(savedApiUrl("orbit example")).toBeNull();
  });
});

describe("switching server", () => {
  it("counts as a change unless it's the server already in use", () => {
    expect(changesServer("https://elsewhere.example", "https://api.orbit.example")).toBe(true);
    expect(changesServer("https://api.orbit.example/", "https://api.orbit.example")).toBe(false);
    expect(changesServer(null, DEFAULT_API_URL)).toBe(false);
    expect(changesServer(null, "https://custom.example")).toBe(true);
  });
});
