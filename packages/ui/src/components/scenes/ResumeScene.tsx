import type { CSSProperties } from "react";
import { ACCENT, ACCENT_FILL, BAR, LINE, PAPER, SPARK, Scene, Stars, type SceneProps } from "./parts";

const R = 17;
const RING = 2 * Math.PI * R;

/** Resume AI: a resume page in orbit, and its ATS score ring. `score` (0–100) sets the ring; 82 by default. */
export function ResumeScene({ score = 82, ...props }: SceneProps & { score?: number }) {
  const shown = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <Scene {...props}>
      <Stars at={[[20, 24, 1], [36, 132, 1.2], [214, 136, 0.8], [228, 96, 1], [128, 12, 0.8]]} />
      <ellipse cx="104" cy="86" rx="88" ry="24" transform="rotate(-10 104 86)" className={LINE} strokeDasharray="2 5" />
      <g transform="rotate(-4 104 76)">
        <rect x="72" y="28" width="64" height="86" rx="4" className={PAPER} />
        <rect x="80" y="37" width="30" height="4.5" rx="2" className={ACCENT_FILL} />
        <rect x="80" y="45" width="40" height="2.5" rx="1.25" className={BAR} />
        <rect x="80" y="55" width="14" height="2.5" rx="1.25" className={ACCENT_FILL} opacity="0.6" />
        <rect x="80" y="61" width="48" height="2.5" rx="1.25" className={BAR} />
        <rect x="80" y="66" width="44" height="2.5" rx="1.25" className={BAR} />
        <rect x="80" y="71" width="46" height="2.5" rx="1.25" className={BAR} />
        <rect x="80" y="81" width="14" height="2.5" rx="1.25" className={ACCENT_FILL} opacity="0.6" />
        <rect x="80" y="87" width="48" height="2.5" rx="1.25" className={BAR} />
        <rect x="80" y="92" width="36" height="2.5" rx="1.25" className={BAR} />
        <rect x="80" y="102" width="26" height="2.5" rx="1.25" className={BAR} />
      </g>
      {/* A moon on the page's orbit. */}
      <circle cx="71.2" cy="113.9" r="4" className="fill-aurora-400" />
      <g transform="translate(184 50)">
        <circle r="26" className={PAPER} />
        <circle r={R} className="stroke-zinc-200 dark:stroke-white/10" strokeWidth="4" />
        <circle
          r={R}
          transform="rotate(-90)"
          strokeWidth="4"
          strokeDasharray={`${(RING * shown) / 100} ${RING}`}
          style={{ "--len": RING } as CSSProperties}
          className={`${ACCENT} motion-ok:animate-[orbit-draw_var(--dur-moment)_var(--ease-enter)_both]`}
        />
        <text y="3.5" textAnchor="middle" className="fill-zinc-900 text-[13px] font-semibold tabular-nums dark:fill-white">
          {shown}
        </text>
        <text y="12.5" textAnchor="middle" className="fill-zinc-500 text-[6px] font-medium dark:fill-zinc-400">
          ATS
        </text>
      </g>
      <path d={SPARK(214, 20, 4)} className="fill-aurora-400 motion-ok:animate-twinkle" />
    </Scene>
  );
}
