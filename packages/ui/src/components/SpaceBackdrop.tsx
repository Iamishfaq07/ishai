import { memo } from "react";
import { cx } from "./cx";

/** Legacy shell slot, now a still neutral canvas. No star layers or decorative animation loops. */
export const SpaceBackdrop = memo(function SpaceBackdrop({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("space-backdrop pointer-events-none fixed inset-0 -z-10 bg-zinc-50 dark:bg-zinc-950", className)} />;
});

/** Compatibility export for existing callers. */
export const CosmicBackground = SpaceBackdrop;
