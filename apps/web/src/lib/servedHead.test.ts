import { describe, expect, it } from "vitest";
import { servedHeadOf } from "./servedHead";

const page = (href: string, canonical: string | null, title = "Amazon interview process and practice questions | Orbit") =>
  servedHeadOf({ href, title, canonical, description: "How Amazon interviews" });

describe("servedHeadOf (the head the app keeps on a public page)", () => {
  it("keeps the head of a page whose canonical names it, query and trailing slash aside", () => {
    expect(page("https://orbitanswer.com/companies/amazon", "https://orbitanswer.com/companies/amazon")).toEqual({
      path: "/companies/amazon",
      head: { title: "Amazon interview process and practice questions | Orbit", description: "How Amazon interviews" },
    });
    expect(page("https://orbitanswer.com/warmup?track=company%3Atcs", "https://orbitanswer.com/warmup")?.path).toBe("/warmup");
    expect(page("http://127.0.0.1:5187/", "https://orbitanswer.com/")?.path).toBe("/");
  });

  it("keeps nothing for the app's own pages (no canonical) or a page whose canonical is another page", () => {
    expect(page("https://orbitanswer.com/sessions", null)).toBeNull();
    expect(page("https://orbitanswer.com/r/FRIEND10", "https://orbitanswer.com/")).toBeNull();
    expect(page("https://orbitanswer.com/companies/amazon", "https://orbitanswer.com/companies/amazon", "")).toBeNull();
  });
});
