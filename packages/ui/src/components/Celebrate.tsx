import type { CSSProperties } from "react";
import { useMotion } from "../hooks/useMotion";
import { cx } from "./cx";
import { SPARK } from "./Illustrations";
import { toast, type ToastOptions } from "./Toast";
import { safeLocal } from "../storage";

/**
 * Success moments: a milestone is celebrated once per device, with a toast that says what was reached and the next
 * step, and (Full motion only) a 700 ms orbit burst on the toast's icon. Never during a live session.
 *
 *   celebrate("first-ats-80", { message: "Your resume scores 82. Ready to apply?", action: { label: "Find jobs", onClick } });
 */
export type Milestone = "first-ats-80" | "first-mock" | "first-applied" | "first-interviewing" | "first-offer" | "stories-6";

const KEY = "orbit.celebrated";
// Remembered here too, so a browser without storage still celebrates once per visit, not on every save.
const seen = new Set<string>();

function stored(storage: Store | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store => safeLocal;

export function hasCelebrated(milestone: Milestone | string, storage: Store | undefined = local()): boolean {
  return seen.has(milestone) || stored(storage).includes(milestone);
}

/** Marks a milestone reached; true only the first time on this device. */
export function claimMilestone(milestone: Milestone | string, storage: Store | undefined = local()): boolean {
  if (hasCelebrated(milestone, storage)) return false;
  seen.add(milestone);
  try {
    storage?.setItem(KEY, JSON.stringify([...stored(storage), milestone]));
  } catch {
    // storage full or blocked: `seen` still holds it for this visit
  }
  return true;
}

/** Celebrates a milestone the first time it's reached. Returns whether it did. */
export function celebrate(milestone: Milestone | string, options: Omit<ToastOptions, "icon" | "tone">): boolean {
  if (typeof location !== "undefined" && location.pathname.startsWith("/live")) return false;
  if (!claimMilestone(milestone)) return false;
  toast({ duration: 8000, ...options, tone: "success", icon: <Celebrate /> });
  return true;
}

const SPARKS = Array.from({ length: 8 }, (_, i) => i * 45);

/**
 * A tick in the accent; at Full motion a ring opens around it and 8 of Orbit's sparks fly out once (700 ms, ends
 * invisible). Gentle and Off show the tick alone. Sized by its box (the toast's 16 px icon slot); decorative.
 */
export function Celebrate({ className }: { className?: string }) {
  const motion = useMotion();
  return (
    <span aria-hidden="true" className={cx("relative inline-flex h-4 w-4", className)}>
      <svg viewBox="0 0 16 16" className="h-full w-full">
        <circle cx="8" cy="8" r="8" className="fill-indigo-500" />
        <path d="M4.8 8.3 7 10.5l4.2-4.6" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {motion === "full" && (
        <svg viewBox="-24 -24 48 48" className="pointer-events-none absolute -inset-5 overflow-visible">
          <circle r="20" fill="none" strokeWidth="1.5" className="orbit-burst-ring stroke-indigo-400" />
          {SPARKS.map((a, i) => (
            <path
              key={a}
              d={SPARK(0, 0, i % 2 ? 2.2 : 3)}
              style={{ "--a": `${a}deg` } as CSSProperties}
              className={cx("orbit-burst-spark", i % 2 ? "fill-aurora-400" : "fill-indigo-400")}
            />
          ))}
        </svg>
      )}
    </span>
  );
}
