import { ACCENT, ACCENT_FILL, BAR, FADE, IN, LINE, NUDGE, PAPER, POP, Scene, Stars, Tick, at, type SceneProps } from "./parts";

// The receipt's torn foot: 16 half-teeth across its 76 px.
const TEETH = Array.from({ length: 16 }, (_, i) => `l-4.75 ${i % 2 ? -4 : 4}`).join("");

/** Plan & credits: a receipt, paid, and the credit it bought, landing on the stack. */
export function BillingScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[18, 24, 1], [226, 20, 0.8], [220, 140, 1], [24, 140, 0.8], [140, 14, 0.8]]} />
      <g className={IN} style={at(0, { y: 10 })}>
        <path d={`M40 28a6 6 0 0 1 6-6h64a6 6 0 0 1 6 6v100${TEETH}z`} className={PAPER} />
        <rect x="50" y="34" width="30" height="4.5" rx="2.25" className={ACCENT_FILL} />
        {[50, 60, 70].map((y, i) => (
          <g key={y} className={FADE} style={at(200 + i * 90)}>
            <rect x="50" y={y} width={[38, 30, 34][i]} height="3" rx="1.5" className={BAR} />
            <rect x="94" y={y} width="12" height="3" rx="1.5" className={BAR} />
          </g>
        ))}
        <path d="M50 84h56" className={LINE} strokeDasharray="2 3" />
        <rect x="50" y="93" width="22" height="4" rx="2" className={BAR} />
        <rect x="84" y="92" width="22" height="6" rx="2" className={ACCENT_FILL} />
        <Tick x={98} y={114} r={7} delay={600} />
      </g>
      {/* The credit, landing on the ones you have. */}
      <circle cx="186" cy="98" r="20" className={PAPER} />
      <circle cx="186" cy="98" r="14" className={LINE} />
      <g className={NUDGE}>
        <g className={POP} style={at(380)}>
          <circle cx="172" cy="68" r="27" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
          <circle cx="172" cy="68" r="21" className={ACCENT} strokeOpacity="0.35" />
          <text x="172" y="70" textAnchor="middle" className="fill-zinc-900 text-[14px] font-semibold tabular-nums dark:fill-white">
            +1
          </text>
          <text x="172" y="80" textAnchor="middle" className="fill-zinc-500 text-[7px] font-medium dark:fill-zinc-400">
            credit
          </text>
        </g>
      </g>
    </Scene>
  );
}
