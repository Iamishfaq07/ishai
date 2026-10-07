import type { CSSProperties } from "react";
import { ACCENT, ACCENT_FILL, SPARK, Scene, Stars, type SceneProps } from "./parts";

const SPARKS = Array.from({ length: 8 }, (_, i) => i * 45 + 22.5);

/** All done: a ticked world with Orbit's sparks thrown around it. At Full motion they burst out once. */
export function CelebrationScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[22, 30, 1], [214, 24, 1], [30, 128, 0.8], [220, 134, 1.2], [64, 80, 0.8], [180, 84, 0.8]]} />
      <circle cx="120" cy="80" r="46" className="stroke-aurora-400" strokeOpacity="0.35" strokeDasharray="2 6" />
      <circle cx="120" cy="80" r="30" className={ACCENT} strokeOpacity="0.5" />
      <circle cx="120" cy="80" r="18" className={ACCENT_FILL} />
      <path d="M112 80.5l5.5 5.5L129 74" className="stroke-white" strokeWidth="3" />
      <g transform="translate(120 80)">
        {SPARKS.map((a, i) => {
          const r = i % 2 ? 52 : 40;
          return (
            <path
              key={a}
              d={SPARK(0, 0, i % 2 ? 3.5 : 5)}
              // Where each spark rests; the burst flies it there from the centre (base.css orbit-burst-in).
              style={{ "--a": `${a}deg`, "--r": `-${r}px`, transform: `rotate(${a}deg) translateY(-${r}px)` } as CSSProperties}
              className={`${i % 2 ? "fill-aurora-400" : ACCENT_FILL} motion-ok:animate-[orbit-burst-in_var(--dur-moment)_var(--ease-enter)_both]`}
            />
          );
        })}
      </g>
    </Scene>
  );
}
