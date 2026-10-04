import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { cx } from "./cx";

export type { OrbState };

/**
 * What the app is doing, as one of thinking-orbs' dotted animations (MIT, github.com/Jakubantalik/thinking-orbs):
 * `working` general loading, `searching` reading or scanning, `solving` thinking something through, `listening` taking
 * in audio, `connecting` linking up, `weaving` combining sources, `composing` writing, `breathing` calm waiting,
 * `shaping` building. Monochrome, follows the light/dark theme, still under reduced motion, paused offscreen.
 */
export function Orb({ state = "working", size = 20, className, label }: {
  state?: OrbState;
  /** 20 sits in a line of text; 64 is for a page or panel that is loading. */
  size?: 20 | 64;
  className?: string;
  /** Spoken label; leave out when text beside the orb already says it. */
  label?: string;
}) {
  return (
    <ThinkingOrb
      state={state}
      size={size}
      className={cx("shrink-0", className)}
      {...(label ? { "aria-label": label } : { "aria-hidden": true, role: "presentation" })}
    />
  );
}
