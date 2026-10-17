import { ACCENT, ACCENT_FILL, ACCENT_SOFT, BAR, DRAW, FADE, IN, LINE, NUDGE, PAPER, POP, Scene, Stars, Tick, at, type SceneProps } from "./parts";

/** Learning AI: a path of lessons, two done, the one you're on, and the flag at the end; the open lesson beside it. */
export function LearningScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[20, 22, 1], [70, 14, 0.8], [228, 70, 1], [226, 142, 0.8], [120, 146, 1]]} />
      {/* The way ahead, then the part walked. */}
      <path d="M30 128C72 128 64 92 104 92S140 58 172 58s32-24 44-30" className={LINE} strokeDasharray="2 5" />
      <path d="M30 128C72 128 64 92 104 92" pathLength={1} className={`${ACCENT} ${DRAW}`} strokeWidth="1.5" />
      <g className={POP} style={at(100)}>
        <Tick x={30} y={128} r={8} solid />
      </g>
      <g className={POP} style={at(380)}>
        <Tick x={104} y={92} r={8} solid />
      </g>
      {/* The lesson you're on. */}
      <circle cx="172" cy="58" r="10" className={`${ACCENT} scene-ring`} style={at(900)} />
      <g className={POP} style={at(640)}>
        <circle cx="172" cy="58" r="9" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
        <circle cx="172" cy="58" r="3.5" className={ACCENT_FILL} />
      </g>
      <g className={FADE} style={at(800)}>
        <path d="M216 28V8" className={LINE} strokeWidth="1.5" />
        <path d="M216 8h15l-4 5 4 5h-15z" className={`${ACCENT_SOFT} ${ACCENT}`} />
      </g>
      {/* The open lesson. */}
      <g className={NUDGE}>
        <g className={IN} style={at(500)}>
          <rect x="124" y="100" width="84" height="42" rx="7" className={PAPER} />
          <rect x="134" y="110" width="32" height="4.5" rx="2.25" className={ACCENT_FILL} />
          <rect x="134" y="120" width="62" height="3" rx="1.5" className={BAR} />
          <rect x="134" y="127" width="50" height="3" rx="1.5" className={BAR} />
          <rect x="134" y="134" width="56" height="3" rx="1.5" className={BAR} />
        </g>
      </g>
    </Scene>
  );
}
