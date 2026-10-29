import { describe, expect, it } from "vitest";
import { WEB_TOOLS, kashsecLink, mentorLink, pickPromo, reportLink, toolLink, webLink } from "./web";

describe("links to Orbit on the web", () => {
  it("tag where in the app they were clicked", () => {
    expect(webLink("https://orbitanswer.com", "/resume-ai", "home-promo")).toBe(
      "https://orbitanswer.com/resume-ai?utm_source=orbit-desktop&utm_campaign=home-promo",
    );
    // A base with a trailing slash, and a path with its own query, both survive.
    expect(webLink("https://orbitanswer.com/", "/billing?pack=starter", "settings")).toBe(
      "https://orbitanswer.com/billing?pack=starter&utm_source=orbit-desktop&utm_campaign=settings",
    );
  });

  it("open the Contact form on a report, for Report a problem", () => {
    expect(reportLink("https://orbitanswer.com")).toBe(
      "https://orbitanswer.com/contact?topic=report&utm_source=orbit-desktop&utm_campaign=report",
    );
  });

  it("send KashSec to its own site with D70's tags", () => {
    expect(kashsecLink("onboarding")).toBe(
      "https://kashsec.vercel.app/?utm_source=orbit&utm_medium=referral&utm_campaign=desktop-onboarding",
    );
    const kashsec = WEB_TOOLS.find((t) => t.id === "kashsec")!;
    expect(toolLink("https://orbitanswer.com", kashsec, "home-promo")).toContain("kashsec.vercel.app");
  });

  it("only ever point at Orbit's own tools", () => {
    for (const tool of WEB_TOOLS) {
      const url = new URL(toolLink("https://orbitanswer.com", tool, "home-promo"));
      expect(["orbitanswer.com", "kashsec.vercel.app"]).toContain(url.hostname);
    }
  });
});

describe("Home's one promo", () => {
  it("takes turns visit by visit", () => {
    const first = pickPromo(0, new Set());
    const second = pickPromo(1, new Set());
    expect(first?.id).toBe(WEB_TOOLS[0]!.id);
    expect(second?.id).toBe(WEB_TOOLS[1]!.id);
    expect(pickPromo(WEB_TOOLS.length, new Set())?.id).toBe(first?.id);
  });

  it("never shows a tool the person hid, and goes away when they hid them all", () => {
    const hidden = new Set(["practice"]);
    for (let seen = 0; seen < 20; seen++) expect(pickPromo(seen, hidden)?.id).not.toBe("practice");
    expect(pickPromo(3, new Set(WEB_TOOLS.map((t) => t.id)))).toBeNull();
  });
});

describe("Ask a mentor", () => {
  it("opens the report's sharing card on the web, tagged as the history placement", () => {
    const url = new URL(mentorLink("https://orbitanswer.com", "abc-123"));
    expect(url.pathname).toBe("/sessions/abc-123");
    expect(url.hash).toBe("#mentor");
    expect(url.searchParams.get("utm_campaign")).toBe("history");
  });
});
