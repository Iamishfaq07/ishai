import { useEffect, useRef, useState } from "react";
import { appIcon, audioLevels, type AudioApp } from "../../native";

/** A meter's 0..1 from a peak (linear amplitude): -50 dBFS and below is silence, 0 dBFS full. */
export function levelFromPeak(peak: number): number {
  if (!(peak > 0)) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(peak) + 50) / 50));
}

export interface LiveLevels {
  /** By AudioApp.pid. */
  apps: ReadonlyMap<number, number>;
  /** By output endpoint id, plus "default" and "communications". */
  outputs: ReadonlyMap<string, number>;
}

const EMPTY: LiveLevels = { apps: new Map(), outputs: new Map() };
const EVERY_MS = 200;

/**
 * Live levels for the "Listen to" tiles while `on`: what Windows' volume mixer shows for each app and output,
 * read from the audio engine's own peak meters a few times a second (native.ts `audioLevels`). Nothing is
 * captured or recorded, and the microphone is never opened: its meter moves only in "Test audio".
 */
export function useLiveLevels(on: boolean): LiveLevels {
  const [levels, setLevels] = useState<LiveLevels>(EMPTY);
  useEffect(() => {
    if (!on) {
      setLevels(EMPTY);
      return;
    }
    let alive = true;
    let timer = 0;
    const tick = async () => {
      // Hidden (in the tray, minimized): nothing to draw.
      if (document.visibilityState === "visible") {
        const read = await audioLevels();
        if (!alive) return;
        if (read) {
          const outputs = new Map(read.outputs.map((o) => [o.id, levelFromPeak(o.peak)]));
          outputs.set("default", levelFromPeak(read.default_output));
          outputs.set("communications", levelFromPeak(read.communications));
          setLevels({ apps: new Map(read.apps.map((a) => [a.pid, levelFromPeak(a.peak)])), outputs });
        }
      }
      if (alive) timer = window.setTimeout(() => void tick(), EVERY_MS);
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [on]);
  return levels;
}

/** Each app's icon as Windows shows it (a data URL), fetched once per app; null while unknown or when it has none. */
export function useAppIcons(apps: readonly AudioApp[]): ReadonlyMap<number, string | null> {
  const [icons, setIcons] = useState<ReadonlyMap<number, string | null>>(new Map());
  const asked = useRef(new Set<number>());
  useEffect(() => {
    for (const app of apps) {
      if (asked.current.has(app.pid)) continue;
      asked.current.add(app.pid);
      void appIcon(app.pid).then((url) => setIcons((prev) => new Map(prev).set(app.pid, url)));
    }
  }, [apps]);
  return icons;
}
