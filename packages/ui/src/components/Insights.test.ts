import { describe, expect, it } from "vitest";
import { facingInTrend } from "./Insights";

describe("the camera coach's trend", () => {
  it("gives facing the camera as a share of the time a face was in frame, and no number when there was no face", () => {
    expect(facingInTrend({ face_in_frame_pct: 96.5, facing_camera_pct: 71.2 })).toBe("71%");
    expect(facingInTrend({ face_in_frame_pct: 50, facing_camera_pct: 0 })).toBe("0%"); // a face, turned away
    expect(facingInTrend({ face_in_frame_pct: 0, facing_camera_pct: 0 })).toBe("–"); // no face: not "0% facing"
  });
});
