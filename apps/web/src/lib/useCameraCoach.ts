import { useEffect, useMemo, useRef } from "react";
import type { CameraCoach } from "@orbit/ui";
import { api } from "./api";
import { CoachTally, measure } from "./cameraCoach";

const SAVE_EVERY_MS = 20_000;

/**
 * The camera coach for a mock session: one tally for the whole session (the camera can go off and on), saved with
 * the session every 20 seconds while it measures, when it stops, and when the page closes. Null when it's off.
 */
export function useCameraCoach(sessionId: string, enabled: boolean): CameraCoach | undefined {
  const tally = useRef(new CoachTally());
  const lastSaved = useRef(-1);
  const save = useMemo(
    () => (closing = false) => {
      const s = tally.current.summary();
      if (s.samples === 0 || s.samples === lastSaved.current) return;
      lastSaved.current = s.samples;
      // Closing the tab: a keepalive request outlives the page, or the last stretch (up to 20 s) was lost.
      void api.saveCameraMetrics(sessionId, s, closing).catch(() => {
        lastSaved.current = -1; // try again next time
      });
    },
    [sessionId],
  );
  useEffect(() => {
    tally.current = new CoachTally();
    lastSaved.current = -1;
  }, [sessionId]);
  useEffect(() => {
    if (!enabled) return;
    const closing = () => save(true);
    window.addEventListener("pagehide", closing);
    return () => {
      window.removeEventListener("pagehide", closing);
      save();
    };
  }, [enabled, save]);
  return useMemo(() => {
    if (!enabled) return undefined;
    return {
      start: async (video: HTMLVideoElement) => {
        const stop = await measure(video, tally.current);
        const timer = window.setInterval(() => save(), SAVE_EVERY_MS);
        return () => {
          window.clearInterval(timer);
          stop();
          save();
        };
      },
    };
  }, [enabled, save]);
}
