import { describe, expect, it } from "vitest";
import { DEFAULT_WINDOW_PRIVACY, parseWindowPrivacy } from "./windowPrivacy";

describe("window privacy", () => {
  it("is off and unanswered until the person chooses", () => {
    expect(parseWindowPrivacy(null)).toEqual(DEFAULT_WINDOW_PRIVACY);
    expect(DEFAULT_WINDOW_PRIVACY).toEqual({ shield: false, hideFromTaskbar: false, chosen: false });
  });
  it("reads a saved choice and ignores anything that isn't exactly true", () => {
    expect(parseWindowPrivacy('{"shield":true,"hideFromTaskbar":false,"chosen":true}')).toEqual({ shield: true, hideFromTaskbar: false, chosen: true });
    expect(parseWindowPrivacy('{"shield":"yes","hideFromTaskbar":1}')).toEqual(DEFAULT_WINDOW_PRIVACY);
    expect(parseWindowPrivacy("{broken")).toEqual(DEFAULT_WINDOW_PRIVACY);
  });
});
