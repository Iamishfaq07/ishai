import { afterEach, describe, expect, it, vi } from "vitest";
import { lockScroll } from "./Sheet";

describe("stacked panels' scroll lock", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the page still until the last panel closes, whichever closes first", () => {
    const body = { style: { overflow: "auto" } };
    vi.stubGlobal("document", { body });
    const under = lockScroll();
    const over = lockScroll(); // a second panel opened from the first
    expect(body.style.overflow).toBe("hidden");
    under(); // the lower one closes first
    expect(body.style.overflow).toBe("hidden"); // the top one is still open
    under(); // releasing twice does nothing
    expect(body.style.overflow).toBe("hidden");
    over();
    expect(body.style.overflow).toBe("auto"); // back to what the page had
  });
});
