import { BAR, DRAW, FADE, IN, LINE, NUDGE, PAPER, POP, Scene, Stars, at, type SceneProps } from "./parts";

// KashSec's own colour, teal (its brand's), in place of the accent: this scene marks KashSec and nothing else.
const TEAL = "stroke-teal-600 dark:stroke-teal-400";
const TEAL_FILL = "fill-teal-600 dark:fill-teal-400";
const TEAL_SOFT = "fill-teal-500/10 dark:fill-teal-400/15";

/**
 * KashSec Academy: a terminal where the lesson's command is typed, the shield it teaches you to hold, and the path of
 * lessons from zero to a first job. The prompt line types itself, the cursor blinks, the shield ticks, the path draws.
 */
export function KashSecScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[16, 18, 1], [122, 12, 0.8], [228, 24, 1], [230, 142, 0.8], [14, 132, 0.8]]} />
      {/* The terminal. */}
      <g className={IN}>
        <rect x="16" y="24" width="116" height="80" rx="8" className={PAPER} />
        <path d="M16 38h116" className={LINE} />
        <circle cx="26" cy="31" r="2" className={BAR} />
        <circle cx="33" cy="31" r="2" className={BAR} />
        <circle cx="40" cy="31" r="2" className={BAR} />
      </g>
      <path d="M27 50l5 4-5 4" className={TEAL} strokeWidth="1.8" />
      <path d="M38 54h46" pathLength={1} className={`${TEAL} ${DRAW}`} strokeWidth="3" strokeOpacity="0.7" style={at(250)} />
      <g className={FADE} style={at(700)}>
        <path d="M27 68h62M27 77h48M27 86h56" className="stroke-zinc-200 dark:stroke-white/10" strokeWidth="3" />
      </g>
      <path d="M27 92v8" className={`${TEAL} scene-blink`} strokeWidth="1.8" style={at(950)} />
      {/* The shield. */}
      <g className={NUDGE}>
        <g className={POP} style={at(350)}>
          <path d="M184 22l30 11v23c0 22-14 35-30 41-16-6-30-19-30-41V33z" className={`${TEAL_SOFT} ${TEAL}`} strokeWidth="1.5" />
          <path d="M184 31l22 8v17c0 16-10 26-22 30.5-12-4.5-22-14.5-22-30.5V39z" className={TEAL} strokeOpacity="0.35" />
        </g>
      </g>
      <path d="M172 58l9 9 16-18" pathLength={1} className={`${TEAL} ${DRAW}`} strokeWidth="3" style={at(650)} />
      {/* The path of lessons: three done, the next, then the job. */}
      <path d="M30 132c30 0 40-12 70-12s44 14 74 14 30-10 44-12" className={LINE} strokeDasharray="2 5" />
      <path d="M30 132c30 0 40-12 70-12s44 14 74 14" pathLength={1} className={`${TEAL} ${DRAW}`} strokeWidth="1.5" style={at(400)} />
      {[[30, 132], [100, 120], [174, 134]].map(([x, y], i) => (
        <circle key={x} cx={x} cy={y} r="4.5" className={`${TEAL_FILL} ${POP}`} style={at(500 + i * 180)} />
      ))}
      <circle cx="218" cy="122" r="5" className={`${PAPER} ${TEAL}`} strokeWidth="1.5" />
    </Scene>
  );
}
