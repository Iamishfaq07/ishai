import { describe, expect, it } from "vitest";
import { CoachTally, FACING_DEG, headPose } from "./cameraCoach";

/** A column-major 4x4 rotation: yaw about Y, then pitch about X (degrees). */
function matrix(yawDeg: number, pitchDeg: number): number[] {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const ry = [[Math.cos(y), 0, Math.sin(y)], [0, 1, 0], [-Math.sin(y), 0, Math.cos(y)]];
  const rx = [[1, 0, 0], [0, Math.cos(p), -Math.sin(p)], [0, Math.sin(p), Math.cos(p)]];
  const r = ry.map((row, i) => [0, 1, 2].map((j) => row.reduce((acc, _, k) => acc + ry[i]![k]! * rx[k]![j]!, 0)));
  const m = new Array<number>(16).fill(0);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) m[col * 4 + row] = r[row]![col]!;
  m[15] = 1;
  return m;
}

describe("head pose", () => {
  it("reads yaw and pitch from the transformation matrix", () => {
    expect(headPose(matrix(0, 0)).yaw).toBeCloseTo(0, 5);
    expect(headPose(matrix(30, 0)).yaw).toBeCloseTo(30, 5);
    expect(headPose(matrix(-20, 0)).yaw).toBeCloseTo(-20, 5);
    expect(headPose(matrix(0, 10)).pitch).toBeCloseTo(10, 5);
    const both = headPose(matrix(25, -12));
    expect(both.yaw).toBeCloseTo(25, 4);
    expect(both.pitch).toBeCloseTo(-12, 4);
  });
});

describe("tally", () => {
  it("counts face in frame, facing the camera and head movement", () => {
    const t = new CoachTally();
    const facing = { yaw: 0, pitch: 0 };
    const away = { yaw: FACING_DEG + 15, pitch: 0 };
    // 10 samples, 100 ms apart: 6 facing, 2 turned away, 2 with no face.
    [facing, facing, facing, away, away, facing, facing, facing, null, null].forEach((pose, i) => t.add({ t: i * 100, pose }));
    const s = t.summary();
    expect(s.samples).toBe(10);
    expect(s.face_in_frame_pct).toBe(80);
    expect(s.facing_camera_pct).toBe(75); // 6 of the 8 with a face
    expect(s.seconds).toBe(0.9);
    // turned (FACING_DEG + 15)° away and back over 0.7 s of consecutive face samples
    expect(s.head_movement_deg_s).toBeCloseTo((2 * (FACING_DEG + 15)) / 0.7, 0);
  });

  it("doesn't count a pause as time or movement, and starts empty", () => {
    expect(new CoachTally().summary()).toEqual({ seconds: 0, samples: 0, face_in_frame_pct: 0, facing_camera_pct: 0, head_movement_deg_s: 0 });
    const t = new CoachTally();
    t.add({ t: 0, pose: { yaw: 0, pitch: 0 } });
    t.pause();
    t.add({ t: 60_000, pose: { yaw: 40, pitch: 0 } });
    expect(t.summary().seconds).toBe(0);
    expect(t.summary().head_movement_deg_s).toBe(0);
  });
});
