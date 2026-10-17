import { ACCENT, ACCENT_FILL, BAR, DRAW, IN, LINE, NUDGE, PAPER, Scene, Stars, Tick, at, type SceneProps } from "./parts";

const DAYS = Array.from({ length: 20 }, (_, i) => [42 + (i % 5) * 16, 66 + Math.floor(i / 5) * 14] as const);

/** Interview day: the date ringed on the calendar, and the checklist for it, ticking down. */
export function InterviewDayScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[18, 22, 1], [130, 14, 0.8], [228, 26, 1], [222, 142, 0.8], [22, 140, 0.8]]} />
      <g className={IN}>
        <rect x="26" y="30" width="96" height="100" rx="8" className={PAPER} />
        <path d="M26 52h96" className={LINE} />
        <rect x="48" y="24" width="4" height="12" rx="2" className={PAPER} />
        <rect x="96" y="24" width="4" height="12" rx="2" className={PAPER} />
        <rect x="36" y="39" width="30" height="5" rx="2.5" className={ACCENT_FILL} />
        {DAYS.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.8" className={i === 13 ? ACCENT_FILL : BAR} />
        ))}
      </g>
      <circle cx="90" cy="94" r="7" pathLength={1} className={`${ACCENT} ${DRAW}`} strokeWidth="1.5" style={at(350)} />
      {/* The checklist for the day. */}
      <g className={NUDGE}>
        <g className={IN} style={at(200, { x: 8, y: 0 })}>
          <rect x="134" y="42" width="90" height="80" rx="8" className={PAPER} />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              {i < 2 ? <Tick x={147} y={62 + i * 20} r={5} delay={600 + i * 200} /> : <circle cx="147" cy="102" r="5" className={LINE} />}
              <rect x="158" y={60.5 + i * 20} width={[52, 44, 36][i]} height="3" rx="1.5" className={BAR} />
            </g>
          ))}
        </g>
      </g>
    </Scene>
  );
}
