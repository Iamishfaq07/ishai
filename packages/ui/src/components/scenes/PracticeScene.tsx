import { ACCENT, ACCENT_FILL, BAR, DRAW, IN, LABEL, NUDGE, PAPER, Scene, Stars, at, type SceneProps } from "./parts";

const ROWS: Array<[string, boolean]> = [
  ["Clear answer", true],
  ["STAR story", true],
  ["Numbers", false],
];

/** Practice: a microphone speaking, and the scorecard that comes back (its ticks drawing in), with one thing still to
 *  work on. */
export function PracticeScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[20, 26, 1], [24, 130, 0.8], [118, 140, 1], [228, 20, 0.8], [124, 18, 1.2]]} />
      {/* The microphone. */}
      <rect x="54" y="30" width="24" height="46" rx="12" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
      <path d="M60 44h12M60 51h12M60 58h12" className={ACCENT} strokeOpacity="0.45" />
      <path d="M46 62a20 20 0 0 0 40 0M66 82v24M54 106h24" className={ACCENT} strokeWidth="1.5" />
      {/* What it says, going out. */}
      <g className="stroke-aurora-400" strokeWidth="1.5">
        <path d="M94 42q7 11 0 22" className="motion-ok:animate-twinkle" />
        <path d="M102 36q11 17 0 34" strokeOpacity="0.7" className="motion-ok:animate-twinkle [animation-delay:0.3s]" />
        <path d="M110 30q15 23 0 46" strokeOpacity="0.4" className="motion-ok:animate-twinkle [animation-delay:0.6s]" />
      </g>
      {/* The scorecard. */}
      <g className={NUDGE}>
        <g className={IN} style={at(200, { x: 8, y: 0 })}>
          <rect x="130" y="26" width="94" height="102" rx="8" className={PAPER} />
          <rect x="140" y="36" width="34" height="4.5" rx="2" className={ACCENT_FILL} />
          <text x="214" y="41" textAnchor="end" className="fill-zinc-900 text-[10px] font-semibold tabular-nums dark:fill-white">
            78
          </text>
          {ROWS.map(([label, ok], i) => {
            const y = 58 + i * 20;
            return (
              <g key={label}>
                <circle cx="145" cy={y} r="5" className={ok ? "fill-emerald-500/15 stroke-emerald-500" : "fill-amber-500/15 stroke-amber-500"} />
                <path
                  d={ok ? `M142.6 ${y}l1.7 1.7 3.2-3.4` : `M145 ${y - 2.4}v2.6M145 ${y + 2.2}v.1`}
                  pathLength={ok ? 1 : undefined}
                  className={ok ? `stroke-emerald-600 dark:stroke-emerald-400 ${DRAW}` : "stroke-amber-600 dark:stroke-amber-400"}
                  style={ok ? at(550 + i * 180) : undefined}
                  strokeWidth="1.4"
                />
                <text x="155" y={y + 3} className={LABEL}>
                  {label}
                </text>
              </g>
            );
          })}
          <rect x="140" y="112" width="40" height="3" rx="1.5" className={BAR} />
        </g>
      </g>
    </Scene>
  );
}
