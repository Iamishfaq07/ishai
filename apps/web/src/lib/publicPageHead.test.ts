import { describe, expect, it } from "vitest";
import { PAGE_META } from "../../worker/meta.js";
import { publicPageHead } from "./publicPageHead";
import { staticHead } from "../prerender/seo";
import { ARTICLES } from "../pages/guides/articles";

describe("route metadata", () => {
  it("matches static generation for every public product page", async () => {
    for (const [path, meta] of Object.entries(PAGE_META)) {
      expect(await publicPageHead(path), path).toEqual(staticHead(path, meta));
    }
  });
  it("resolves guides and keeps unpublished articles out of search", async () => {
    expect((await publicPageHead("/companies/tcs"))?.canonical).toBe("https://orbitanswer.com/companies/tcs");
    expect((await publicPageHead("/roles"))?.title).toContain("role");
    const draft = ARTICLES.find((a) => !a.published)!;
    expect((await publicPageHead(`/guides/${draft.slug}`))?.noindex).toBe(true);
    expect(await publicPageHead("/companies/this-company-does-not-exist")).toBeNull();
  });
  it("does not give private or unknown pages public metadata", async () => {
    for (const path of ["/billing", "/resume-ai/private-id", "/settings", "/missing", "/guides/missing"]) {
      expect(await publicPageHead(path), path).toBeNull();
    }
  });
});
