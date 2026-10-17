import { ACCENT, ACCENT_BAR, BAR, DRAW, FADE, NUDGE, PAPER, POP, Person, Scene, Stars, at, type SceneProps } from "./parts";

/** People and referrals: you, someone you know, and the link between you; a third person about to join. */
export function ReferralScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[18, 26, 1], [118, 16, 0.8], [226, 30, 1], [214, 142, 0.8], [26, 138, 0.8], [120, 140, 1]]} />
      <g className={POP}>
        <Person x={62} y={74} r={26} accent />
      </g>
      <rect x="46" y="112" width="32" height="3.5" rx="1.75" className={ACCENT_BAR} />
      {/* The link: a dotted line out, the chain, a dotted line on. */}
      <path d="M92 74h12M136 74h12" className={ACCENT} strokeOpacity="0.6" strokeDasharray="2 4" />
      <rect x="104" y="68" width="20" height="12" rx="6" pathLength={1} className={`${ACCENT} ${DRAW}`} strokeWidth="1.5" style={at(250)} />
      <rect x="116" y="68" width="20" height="12" rx="6" pathLength={1} className={`${ACCENT} ${DRAW}`} strokeWidth="1.5" style={at(400)} />
      <g className={POP} style={at(550)}>
        <Person x={178} y={74} r={26} />
      </g>
      <rect x="162" y="112" width="32" height="3.5" rx="1.75" className={BAR} />
      <g className={NUDGE}>
        <g className={FADE} style={at(800)}>
          <circle cx="204" cy="46" r="9" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
          <path d="M204 42v8M200 46h8" className={ACCENT} strokeWidth="1.5" />
        </g>
      </g>
    </Scene>
  );
}
