/**
 * The camera coach (mock interviews, ORBIT_VIDEO_MOCK): MediaPipe's face landmarker runs on this device, about ten
 * times a second, and keeps three numbers: how much of the time a face was in frame, how much of that time the head
 * was turned toward the camera, and how fast the head moved on average. No video, image or landmark leaves the
 * device; only those numbers are sent, with the session.
 *
 * "Facing the camera" is head direction (within FACING_DEG left/right and up/down), not where the eyes look. Nothing
 * here estimates confidence, emotion, honesty or engagement.
 */
import type { CameraMetrics } from "@orbit/types";

export const FACING_DEG = 20; // a straight-ahead face reads 10-17° of pitch on some devices: 15 was too tight
const SAMPLE_MS = 100;
const MAX_STEP_S = 1; // a gap longer than this (camera off, tab hidden) isn't counted as movement

export interface Pose {
  yaw: number; // degrees, left/right
  pitch: number; // degrees, up/down
}

/** Head direction from MediaPipe's 4x4 facial transformation matrix (column-major). */
export function headPose(m: ArrayLike<number>): Pose {
  // Rotation part, row r / column c at m[c * 4 + r].
  const r20 = m[2]!;
  const r21 = m[6]!;
  const r22 = m[10]!;
  const yaw = Math.asin(Math.max(-1, Math.min(1, -r20)));
  const pitch = Math.atan2(r21, r22);
  return { yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI };
}

export interface Sample {
  t: number; // ms
  pose: Pose | null; // null: no face in frame
}

/** Adds up samples into the numbers stored with the session. */
export class CoachTally {
  private samples = 0;
  private withFace = 0;
  private facing = 0;
  private turned = 0; // degrees moved between consecutive face samples
  private movingSeconds = 0;
  private first: number | null = null;
  private last: Sample | null = null;
  private seconds = 0;

  add(s: Sample): void {
    this.samples += 1;
    if (this.last) {
      const gap = (s.t - this.last.t) / 1000;
      if (gap > 0 && gap <= MAX_STEP_S) {
        this.seconds += gap;
        if (s.pose && this.last.pose) {
          this.turned += Math.hypot(s.pose.yaw - this.last.pose.yaw, s.pose.pitch - this.last.pose.pitch);
          this.movingSeconds += gap;
        }
      }
    }
    this.first ??= s.t;
    if (s.pose) {
      this.withFace += 1;
      if (Math.abs(s.pose.yaw) <= FACING_DEG && Math.abs(s.pose.pitch) <= FACING_DEG) this.facing += 1;
    }
    this.last = s;
  }

  /** A pause (camera off): the next sample doesn't count the gap as time or movement. */
  pause(): void {
    this.last = null;
  }

  summary(): CameraMetrics {
    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      seconds: round(this.seconds),
      samples: this.samples,
      face_in_frame_pct: this.samples ? round((100 * this.withFace) / this.samples) : 0,
      facing_camera_pct: this.withFace ? round((100 * this.facing) / this.withFace) : 0,
      head_movement_deg_s: this.movingSeconds ? Math.min(360, round(this.turned / this.movingSeconds)) : 0,
    };
  }
}

type Landmarker = {
  detectForVideo: (video: HTMLVideoElement, t: number) => { facialTransformationMatrixes?: { data: ArrayLike<number> }[]; faceLandmarks?: unknown[] };
  close: () => void;
};

let loading: Promise<Landmarker> | null = null;

/** The face landmarker, loaded once, from this site (/mediapipe): nothing is fetched from a CDN. */
function landmarker(): Promise<Landmarker> {
  loading ??= (async () => {
    const vision = await import("@mediapipe/tasks-vision");
    const files = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const create = (delegate: "GPU" | "CPU") =>
      vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task", delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
        outputFaceBlendshapes: false,
      });
    return (await create("GPU").catch(() => create("CPU"))) as unknown as Landmarker;
  })();
  loading.catch(() => {
    loading = null; // a failed load can be tried again
  });
  return loading;
}

/** Measures `video` into `tally` until the returned stop() is called. Rejects when the model can't load. */
export async function measure(video: HTMLVideoElement, tally: CoachTally): Promise<() => void> {
  const model = await landmarker();
  let stopped = false;
  let timer = 0;
  const tick = () => {
    if (stopped) return;
    if (video.readyState >= 2 && !document.hidden) {
      const now = performance.now();
      try {
        const out = model.detectForVideo(video, now);
        const matrix = out.facialTransformationMatrixes?.[0]?.data;
        tally.add({ t: now, pose: matrix && out.faceLandmarks?.length ? headPose(matrix) : null });
      } catch {
        // a dropped frame: skip it
      }
    } else {
      tally.pause();
    }
    timer = window.setTimeout(tick, SAMPLE_MS);
  };
  tick();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    tally.pause();
  };
}
